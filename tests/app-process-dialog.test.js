// @artifact dev
// P2L-EXPANSION-SPEC section 2.2: the PROC dialog. The orientation document (src/process.js)
// is reachable from the Help menu and from the command zone, renders the SAME sections PIP
// reads, and the Ops Assistant's orientation chips resolve to authored topics instead of
// falling through to the model with nothing behind them.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Process = require('../src/process.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();
function boot() { const c = new Component({}); c.initSim(1700000000000); return c; }

test('command PROCESS (and its aliases) opens the plant orientation dialog', () => {
  for (const word of ['PROCESS', 'OVERVIEW', 'PLANT', 'ORIENTATION']) {
    const c = boot();
    assert.equal(c.runCmd(word), true, word);
    assert.deepEqual(c.state.dlg, { type: 'process' }, word);
    const dg = c.renderVals().dg;
    assert.equal(dg.open, true);
    assert.equal(dg.isProcess, true);
    assert.equal(dg.title, 'HELP — PLANT ORIENTATION');
    assert.equal(dg.w, 720);
  }
});

test('the Help menu offers it', () => {
  const c = boot();
  const help = c.renderVals().menus.find((m) => m.name === 'Help');
  const item = help.items.find((i) => /plant orientation/i.test(i.label));
  assert.ok(item, 'Help menu has no plant orientation item');
  item.cb();
  assert.deepEqual(c.state.dlg, { type: 'process' });
});

test('the dialog renders exactly the sections and sources PIP reads', () => {
  const c = boot();
  c.runCmd('PROCESS');
  const proc = c.renderVals().dg.proc;
  const src = Process.sections();
  assert.deepEqual(proc.sections.map((x) => x.title), src.map((x) => x.title));
  // The dialog re-joins hard-wrapped running lines; the words are identical to PIP's text.
  const words = (b) => b.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < src.length; i++) assert.equal(words(proc.sections[i].body), words(src[i].body), src[i].title);
  const route = proc.sections.find((x) => x.title === 'THE ROUTE THROUGH THE PLANT');
  assert.ok(route && /\n {2,}\S/.test(route.body), 'the indented route diagram must keep its line structure');
  const first = proc.sections.find((x) => x.title === 'READ THIS FIRST');
  assert.ok(first && !/[^\n]\n[^\n]/.test(first.body.replace(/\n\n/g, '\n\n')) || first.body.split('\n\n')[0].indexOf('\n') < 0, 'a running paragraph must be re-joined onto one line');
  assert.deepEqual(proc.sources, Process.sources());
  assert.ok(proc.sections.length >= 8, 'orientation document is suspiciously short');
  assert.ok(proc.sections.some((s) => s.title === 'READ THIS FIRST'));
  assert.ok(proc.sections.some((s) => /HOW GOOD ARE THE NUMBERS/.test(s.title)));
  assert.match(proc.lede, /does not exist/);
});

test('the sections are not built while the dialog is closed (renderVals runs on every setState)', () => {
  const c = boot();
  const dg = c.renderVals().dg;
  assert.equal(dg.isProcess, false);
  assert.deepEqual(dg.proc, { lede: '', sections: [], sources: [] });
});

test('every Ops Assistant chip resolves to an authored topic; the orientation chips resolve exactly', () => {
  const c = boot();
  c.setState({ assist: true });
  const chips = c.renderVals().asst.chips.map((ch) => ch.label);
  assert.deepEqual(chips.slice(0, 3), ['What am I looking at?', 'What does this plant make?', 'How do I drive this station?']);
  for (const [i, label] of chips.entries()) {
    c.setState({ assistQ: label });
    const hits = c.renderVals().asst.hits;
    assert.ok(hits.length > 0, `chip "${label}" matches no topics() keyword -- it would fall through to the model with nothing behind it`);
    if (i < 3) assert.equal(hits[0].t, label, `chip "${label}" must resolve to its own topic first, got "${hits[0].t}"`);
  }
});

test('the orientation topics only claim commands and tags that exist', () => {
  const c = boot();
  const orient = c.topics().slice(0, 3);
  for (const word of ['U1', 'U2', 'U3', 'ALM', 'EVT', 'TRN', 'KPI', 'ARCH', 'PROCESS', 'HELP']) {
    assert.equal(boot().runCmd(word), true, `topic prose names command ${word}, which runCmd does not accept`);
  }
  const named = new Set();
  for (const t of orient) for (const m of t.a.matchAll(/\b([A-Z]{2,3}[0-9]{3}|[A-Z]-[0-9]{3}|SCM202)\b/g)) named.add(m[1]);
  for (const tag of named) {
    const known = c.L[tag] || ['TK-101', 'R-201', 'E-301', 'V-401', 'R-202', 'H-310', 'R-310', 'SCM202'].includes(tag);
    assert.ok(known, `orientation topic names ${tag}, which is neither a point nor equipment on this board`);
  }
});
