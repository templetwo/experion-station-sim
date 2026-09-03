// @artifact dev
// The PIP cloud credential dialog (Anthony, 2026-09-03): an API key entered at the station
// through a masked field goes to the LOCAL sidecar only, and nowhere else on the page. What
// is pinned: the SUPV gate, the entry points (command words, Help menu, the KEY button),
// the request shape (relative /api/coach/credential with the station header), that the key
// leaves React state the moment it is sent, and that it never lands in an event, the
// journal, a snapshot, a message or the render tree; the provider change is journaled as a
// CONFIG entry without it. Offline (file://) the dialog says so and sends nothing.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'Experion Station Simulator.dc.html'), 'utf8');
const { Component } = load();
const KEY = 'sk-test-0123456789abcdefghijklmnop';

function boot(sec) {
  const c = new Component({});
  c.initSim(1700000000000);
  if (sec) c.setState({ sec });
  return c;
}
function stubFetch(calls, reply) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => reply };
  };
  return () => { globalThis.fetch = real; };
}
function onHttp(on) {
  const loc = globalThis.location;
  const prev = loc.protocol;
  loc.protocol = on ? 'http:' : 'file:';
  return () => { loc.protocol = prev; };
}

test('the dialog is SUPV or above: OPER is refused, SUPV opens it', () => {
  const oper = boot('OPER');
  oper.openCloudKey();
  assert.equal(oper.state.dlg, null);
  assert.match(oper.state.msg, /HIGHER SECURITY LEVEL REQUIRED \(SUPV\)/);
  const supv = boot('SUPV');
  supv.openCloudKey();
  assert.deepEqual(supv.state.dlg, { type: 'cloudkey' });
  const dg = supv.renderVals().dg;
  assert.equal(dg.isCloudKey, true);
  assert.equal(dg.title, 'PIP — CLOUD COACH CREDENTIAL');
  assert.equal(typeof dg.ck.save, 'function');
  assert.match(dg.ck.note, /never journaled, never snapshotted/);
});

test('every entry point reaches the same dialog', () => {
  for (const word of ['CLOUDKEY', 'CLOUD KEY', 'APIKEY', 'API KEY', 'PIP KEY']) {
    const c = boot('SUPV');
    assert.equal(c.runCmd(word), true, word);
    assert.deepEqual(c.state.dlg, { type: 'cloudkey' }, word);
  }
  const c = boot('SUPV');
  const help = c.renderVals().menus.find((m) => m.name === 'Help');
  const item = help.items.find((i) => /cloud credential/i.test(i.label));
  assert.ok(item, 'Help menu has no PIP cloud credential item');
  item.cb();
  assert.deepEqual(c.state.dlg, { type: 'cloudkey' });
  const d = boot('SUPV');
  d.setState({ assist: true });
  d.renderVals().asst.cloudKey();
  assert.deepEqual(d.state.dlg, { type: 'cloudkey' });
});

test('the template field is masked and never autocompleted', () => {
  const block = PAGE.slice(PAGE.indexOf('<sc-if value="{{ dg.isCloudKey }}"'), PAGE.indexOf('<sc-if value="{{ dg.isProcess }}"'));
  assert.ok(block.length > 100, 'cloud key dialog block not found');
  assert.match(block, /<input type="password" autocomplete="new-password" value="\{\{ dg\.ck\.key \}\}"/);
  const bindings = block.match(/\{\{ dg\.ck\.key \}\}/g) || [];
  assert.equal(bindings.length, 1, 'the key is bound exactly once');
  assert.match(block, /value="\{\{ dg\.ck\.key \}\}"/, 'and only as the input value, never rendered as text');
});

test('the key goes to the local sidecar with the station header, and nowhere else on the page', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const calls = [];
  const restoreFetch = stubFetch(calls, { ok: true, provider: 'anthropic', model: 'claude-opus-5', credential: 'session' });
  try {
    c.openCloudKey();
    c.setState({ dlgKey: KEY, dlgKeyModel: '' });
    const ok = await c.saveCloudKey();
    assert.equal(ok, true);
    const cred = calls.filter((x) => x.url === '/api/coach/credential');
    assert.equal(cred.length, 1, 'exactly one credential request');
    assert.equal(cred[0].opts.method, 'POST');
    assert.equal(cred[0].opts.headers['X-Coach-Station'], '1', 'the station header the sidecar requires');
    assert.deepEqual(JSON.parse(cred[0].opts.body), { key: KEY });
    assert.ok(calls.every((x) => x.url.startsWith('/api/coach/')), 'only the relative coach endpoints (gate 4)');

    // the key is gone from the page the moment it was sent
    assert.equal(c.state.dlgKey, '');
    assert.equal(c.state.dlg, null, 'the dialog closes on success');
    assert.equal(c.state.coachProvider, 'anthropic');
    assert.equal(c.state.coachCred, 'session');
    const everywhere = [
      JSON.stringify(c.state), JSON.stringify(c.events), JSON.stringify(c.instr.journal), JSON.stringify(c.msgs),
      JSON.stringify(c.snapshotData('after key')), JSON.stringify(c.renderVals()), c.state.msg,
    ].join('\n');
    assert.ok(!everywhere.includes(KEY), 'the key must not survive anywhere on the page');

    // the provider change is on the record, without the key
    const cfg = c.events.find((e) => e.type === 'CONFIG' && /PIP COACH PROVIDER CHANGE/.test(e.desc));
    assert.ok(cfg, 'the provider change must be a CONFIG (MOC) entry');
    assert.equal(cfg.oldV, 'LOCAL');
    assert.equal(cfg.newV, 'ANTHROPIC');
    assert.ok(c.events.some((e) => e.type === 'SYSTEM' && /PIP COACH — CLOUD KEY ENTERED — ANTHROPIC/.test(e.desc)));
    assert.match(c.state.msg, /PIP COACH: ANTHROPIC · claude-opus-5/);
  } finally { restoreFetch(); restoreLoc(); }
});

test('a model override rides along; USE LOCAL and FORGET send no key', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const calls = [];
  const restoreFetch = stubFetch(calls, { ok: true, provider: 'anthropic', model: 'claude-sonnet-5', credential: 'session' });
  try {
    c.openCloudKey();
    c.setState({ dlgKey: KEY, dlgKeyModel: 'claude-sonnet-5' });
    await c.saveCloudKey();
    assert.deepEqual(JSON.parse(calls[0].opts.body), { key: KEY, model: 'claude-sonnet-5' });
    c.openCloudKey();
    const view = c.renderVals().dg.ck;
    await view.useLocal();
    await view.forget();
    const bodies = calls.filter((x) => x.url === '/api/coach/credential').map((x) => JSON.parse(x.opts.body));
    assert.deepEqual(bodies.slice(1), [{ provider: 'ollama' }, { clear: true, provider: 'ollama' }]);
    assert.ok(!JSON.stringify(bodies.slice(1)).includes(KEY));
  } finally { restoreFetch(); restoreLoc(); }
});

test('a short or malformed key is refused on the page, before any request', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const calls = [];
  const restoreFetch = stubFetch(calls, { ok: true });
  try {
    c.openCloudKey();
    c.setState({ dlgKey: 'short' });
    assert.equal(await c.saveCloudKey(), false);
    c.setState({ dlgKey: 'has whitespace inside the key value here' });
    assert.equal(await c.saveCloudKey(), false);
    assert.equal(calls.length, 0);
    assert.match(c.state.msg, /ENTER THE FULL API KEY/);
  } finally { restoreFetch(); restoreLoc(); }
});

test('offline (file://) there is nowhere to hold a key: the dialog says so and sends nothing', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(false);
  const calls = [];
  const restoreFetch = stubFetch(calls, { ok: true });
  try {
    c.openCloudKey();
    assert.match(c.renderVals().dg.ck.status, /OFFLINE/);
    c.setState({ dlgKey: KEY });
    assert.equal(await c.saveCloudKey(), false);
    assert.equal(calls.length, 0);
    assert.equal(c.state.dlgKey, '');
    assert.match(c.state.msg, /PIP SIDECAR OFFLINE/);
  } finally { restoreFetch(); restoreLoc(); }
});

test('a refused or failed request clears the key and reports, without a record of the key', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ ok: false }) });
  try {
    c.openCloudKey();
    c.setState({ dlgKey: KEY });
    assert.equal(await c.saveCloudKey(), false);
    assert.equal(c.state.dlgKey, '');
    assert.match(c.state.msg, /CREDENTIAL REQUEST FAILED/);
    assert.ok(!JSON.stringify(c.events).includes(KEY) && !JSON.stringify(c.msgs).includes(KEY));
  } finally { globalThis.fetch = real; restoreLoc(); }
});

test('CANCEL or the close box clears a typed key from page state', () => {
  const c = boot('SUPV');
  c.openCloudKey();
  c.setState({ dlgKey: KEY, dlgKeyModel: 'claude-sonnet-5' });
  c.renderVals().dg.close();
  assert.equal(c.state.dlg, null);
  assert.equal(c.state.dlgKey, '', 'an abandoned key must not sit in state for the session');
  assert.equal(c.state.dlgKeyModel, '');
  assert.ok(!JSON.stringify(c.state).includes(KEY));
});

test('the key leaves page state BEFORE the sidecar answers, not after', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const real = globalThis.fetch;
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true, provider: 'anthropic', model: 'claude-opus-5', credential: 'session' }) }); });
  try {
    c.openCloudKey();
    c.setState({ dlgKey: KEY });
    const pending = c.saveCloudKey();
    assert.equal(c.state.dlgKey, '', 'while the request is still in flight the key is already gone from state');
    assert.ok(!JSON.stringify(c.state).includes(KEY));
    release();
    assert.equal(await pending, true);
  } finally { globalThis.fetch = real; restoreLoc(); }
});

test('invisible characters are refused on the page before any request', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const calls = [];
  const restoreFetch = stubFetch(calls, { ok: true });
  try {
    c.openCloudKey();
    for (const bad of ['sk-test-0123456789\u200babcdefghij', 'sk-test-0123456789abcdefghij\uFEFF', 'sk-test-0123456789abcdefghij\u00a0x']) {
      c.setState({ dlgKey: bad });
      assert.equal(await c.saveCloudKey(), false, JSON.stringify(bad));
    }
    assert.equal(calls.length, 0);
    assert.match(c.state.msg, /PRINTABLE CHARACTERS ONLY/);
  } finally { restoreFetch(); restoreLoc(); }
});

test('a refusal from the sidecar is reported by its reason', async () => {
  const c = boot('SUPV');
  const restoreLoc = onHttp(true);
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'no credential' }) });
  try {
    c.openCloudKey();
    await c.renderVals().dg.ck.useLocal();   // any request; the stub refuses everything with 409
    assert.match(c.state.msg, /NO CLOUD CREDENTIAL — ENTER A KEY FIRST/);
  } finally { globalThis.fetch = real; restoreLoc(); }
});

test('every coach POST from the page carries the station header the sidecar now requires', () => {
  const posts = PAGE.match(/fetch\('\/api\/coach\/(stream|advise|credential)'[^;]*?\{[^;]*?method:'POST'[^;]*?\}/gs) || [];
  assert.ok(posts.length >= 2, 'expected the advise and credential POSTs inline (the streamed ask builds its options separately), found ' + posts.length);
  for (const p of posts) assert.match(p, /'X-Coach-Station':'1'/, p.slice(0, 80));
  const opts = PAGE.match(/const opts=\{method:'POST'[^\n]*/);
  assert.ok(opts && /'X-Coach-Station':'1'/.test(opts[0]), 'the streamed ask goes through opts, which must carry the header too');
});
