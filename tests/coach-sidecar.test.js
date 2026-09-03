// @artifact dev
// Real HTTP contract for the optional local PIP sidecar, with a fake Ollama.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'tools', 'coach', 'serve.py');

// The cap fixtures below must exceed the server's ASK_WORDS. Derive it from
// serve.py rather than hardcoding a count: this fixture previously emitted 90
// words against a cap of 76, and when the cap was raised to 95 the "capped"
// stream silently stopped being capped -- the assertion still passed a
// non-event and the real behaviour went untested. Read the number.
const SERVE_SRC = require('node:fs').readFileSync(SERVE, 'utf8');
const ASK_WORDS = Number((SERVE_SRC.match(/^ASK_WORDS\s*=\s*(\d+)/m) || [])[1]);
assert.ok(Number.isFinite(ASK_WORDS) && ASK_WORDS > 0,
  'could not read ASK_WORDS out of serve.py; the cap fixtures below depend on it');
const OVER_CAP_WORDS = ASK_WORDS + 40;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

async function freePort() {
  const holder = net.createServer();
  const port = await listen(holder);
  await new Promise((resolve, reject) => holder.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function waitForHealth(url, child, stderr) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode != null) throw new Error('coach exited early: ' + stderr());
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('coach health did not become ready: ' + stderr());
}

test('PIP sidecar serves the station and completes streamed and fallback conversations', { timeout: 15000 }, async (t) => {
  const ollamaCalls = [];
  const fakeOllama = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/chat') {
      res.writeHead(404).end('not found');
      return;
    }
    const body = JSON.parse(await readBody(req));
    ollamaCalls.push(body);
    res.setHeader('Content-Type', 'application/x-ndjson');
    const promptText = (body.messages || []).map((message) => message.content || '').join('\n');
    if (promptText.includes('EMPTY_STREAM_TEST')) {
      res.end('{malformed ndjson\n');
      return;
    }
    if (promptText.includes('EMPTY_FALLBACK_TEST')) {
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
      return;
    }
    if (promptText.includes('MALFORMED_MIDSTREAM_TEST')) {
      res.write(JSON.stringify({ message: { content: 'Partial answer' }, done: false }) + '\n');
      res.write('{malformed ndjson\n');
      res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
      return;
    }
    if (promptText.includes('TRUNCATED_STREAM_TEST')) {
      res.write(JSON.stringify({ message: { content: 'Check the selected point and compare' }, done: false }) + '\n');
      res.end(JSON.stringify({ message: {}, done: true, done_reason: 'length' }) + '\n');
      return;
    }
    if (promptText.includes('CAPPED_STREAM_TEST')) {
      res.write(JSON.stringify({ message: { content: Array.from({ length: OVER_CAP_WORDS }, (_, i) => 'word' + i).join(' ') }, done: false }) + '\n');
      res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
      return;
    }
    if (promptText.includes('TRUNCATED_FALLBACK_TEST')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: { content: 'Check the selected' }, done: true, done_reason: 'length' }));
      return;
    }
    if (promptText.includes('CAPPED_FALLBACK_TEST')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: { content: Array.from({ length: OVER_CAP_WORDS }, (_, i) => 'word' + i).join(' ') }, done: true, done_reason: 'stop' }));
      return;
    }
    if (promptText.includes('PREFIX_STREAM_TEST')) {
      res.write(JSON.stringify({ message: { content: 'FROZEN_MEAS' }, done: false }) + '\n');
      res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
      return;
    }
    if (promptText.includes('SPLIT_CAP_STREAM_TEST')) {
      const first = Array.from({ length: 75 }, (_, i) => 'word' + i).join(' ') + ' tem';
      res.write(JSON.stringify({ message: { content: first }, done: false }) + '\n');
      res.write(JSON.stringify({ message: { content: 'perature' }, done: false }) + '\n');
      res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
      return;
    }
    if (body.stream) {
      // Deliberately split a forbidden instructor-only fault id across chunks.
      // A trainee-safe stream must not make the reconstructed token observable.
      res.write(JSON.stringify({ message: { thinking: 'check TIC201' }, done: false }) + '\n');
      res.write(JSON.stringify({ message: { content: 'FROZEN_' }, done: false }) + '\n');
      res.write(JSON.stringify({ message: { content: 'MEASUREMENT and biased_' }, done: false }) + '\n');
      res.write(JSON.stringify({ message: { content: 'measurement are not trainee-safe. Check TIC201 against correlated temperature.' }, done: false }) + '\n');
      res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      message: { content: 'TIC201 is high. Check its PV against the related temperatures before moving the loop.' },
      done: true,
      done_reason: 'stop'
    }));
  });
  const ollamaPort = await listen(fakeOllama);
  t.after(() => new Promise(resolve => fakeOllama.close(() => resolve())));

  const coachPort = await freePort();
  let childErr = '';
  const child = spawn('python3', [SERVE], {
    cwd: ROOT,
    env: {
      ...process.env,
      COACH_PORT: String(coachPort),
      COACH_MODEL: 'test-coach:1b',
      OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', chunk => { childErr += chunk.toString('utf8'); });
  t.after(async () => {
    if (child.exitCode == null) child.kill('SIGTERM');
    if (child.exitCode == null) await new Promise(resolve => child.once('exit', resolve));
  });

  const base = `http://127.0.0.1:${coachPort}`;
  const health = await waitForHealth(base + '/api/coach/health', child, () => childErr);
  assert.equal(health.ok, true);
  assert.equal(health.model, 'test-coach:1b');
  assert.equal(health.stream, true);
  assert.equal(health.tools, false);

  const page = await (await fetch(base + '/')).text();
  assert.match(page, /OPS ASSISTANT/);
  assert.match(page, /fetch\('\/api\/coach\/stream'/);

  const request = {
    kind: 'ask',
    ask: 'Why is TIC201 high and what should I check?',
    projection: {
      screen: { display: 'graphic', displayName: 'UNIT GRAPHIC', unit: 'U1', selected: 'TIC201', unack: 1 },
      alarms: [{ tag: 'TIC201', cond: 'PVHI', priority: 'High', state: 'UNACK', pv: 171.2, sp: 150, op: 2, mode: 'AUTO' }],
      points: [{ tag: 'TIC201', desc: 'R-201 temperature', pv: 171.2, sp: 150, op: 2, mode: 'AUTO' }],
      catalog: [],
      drill: { id: 'A6', title: 'Hidden architecture diagnosis',
        observationGrade: 'SIMULATED_ARCHITECTURE_INDICATION',
        observations: ['U1 NETWORK PATH B — redundancy-degraded indication only'] }
    },
    history: [{ role: 'user', content: 'I am looking at U1.' }]
  };

  const streamRes = await fetch(base + '/api/coach/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify(request)
  });
  assert.equal(streamRes.status, 200);
  assert.match(streamRes.headers.get('content-type') || '', /application\/x-ndjson/);
  const streamText = await streamRes.text();
  const events = streamText.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.some(event => event.t === 'think'));
  assert.ok(events.some(event => event.t === 'text'));
  assert.ok(events.some(event => event.t === 'done' && event.ok));
  const visibleText = events.filter(event => event.t === 'text').map(event => event.d).join('');
  assert.doesNotMatch(visibleText, /FROZEN_MEASUREMENT/i);
  assert.doesNotMatch(visibleText, /BIASED_MEASUREMENT/i);
  assert.equal((visibleText.match(/\[hidden\]/g) || []).length, 2, visibleText);

  const emptyStreamRes = await fetch(base + '/api/coach/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify({ ...request, ask: 'EMPTY_STREAM_TEST' })
  });
  const emptyEvents = (await emptyStreamRes.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(emptyEvents.some(event => event.t === 'err'), 'an unterminated upstream stream must fail visibly');
  assert.ok(!emptyEvents.some(event => event.t === 'done' && event.ok), 'empty EOF cannot be a successful answer');

  const malformedRes = await fetch(base + '/api/coach/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify({ ...request, ask: 'MALFORMED_MIDSTREAM_TEST' })
  });
  const malformedEvents = (await malformedRes.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(malformedEvents.some(event => event.t === 'err'), 'malformed midstream NDJSON must poison the answer');
  assert.ok(!malformedEvents.some(event => event.t === 'done' && event.ok), 'partial text plus corruption cannot be success');

  const fallbackRes = await fetch(base + '/api/coach/advise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify(request)
  });
  assert.equal(fallbackRes.status, 200);
  const fallback = await fallbackRes.json();
  assert.equal(fallback.ok, true);
  assert.match(fallback.text, /TIC201 is high/);

  const emptyFallbackRes = await fetch(base + '/api/coach/advise', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify({ ...request, ask: 'EMPTY_FALLBACK_TEST' })
  });
  assert.equal(emptyFallbackRes.status, 503);
  const emptyFallback = await emptyFallbackRes.json();
  assert.equal(emptyFallback.ok, false);

  for (const ask of ['TRUNCATED_STREAM_TEST', 'CAPPED_STREAM_TEST']) {
    const res = await fetch(base + '/api/coach/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
      body: JSON.stringify({ ...request, ask })
    });
    const streamEvents = (await res.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.ok(streamEvents.some(event => event.t === 'err'), `${ask}: truncation must fail visibly`);
    assert.ok(!streamEvents.some(event => event.t === 'done' && event.ok), `${ask}: partial text cannot be success`);
  }

  for (const ask of ['TRUNCATED_FALLBACK_TEST', 'CAPPED_FALLBACK_TEST']) {
    const res = await fetch(base + '/api/coach/advise', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
      body: JSON.stringify({ ...request, ask })
    });
    assert.equal(res.status, 503, `${ask}: truncation must not be a healthy fallback response`);
    assert.equal((await res.json()).ok, false);
  }

  const prefixRes = await fetch(base + '/api/coach/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify({ ...request, ask: 'PREFIX_STREAM_TEST' })
  });
  const prefixEvents = (await prefixRes.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const prefixText = prefixEvents.filter(event => event.t === 'text').map(event => event.d).join('');
  assert.equal(prefixText, '[hidden]', 'a terminal banned-token prefix must not leak at final flush');
  assert.ok(prefixEvents.some(event => event.t === 'done' && event.ok));

  const splitCapRes = await fetch(base + '/api/coach/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: JSON.stringify({ ...request, ask: 'SPLIT_CAP_STREAM_TEST' })
  });
  const splitCapEvents = (await splitCapRes.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(splitCapEvents.some(event => event.t === 'done' && event.ok),
    'a final allowed word split across chunks must not be mistaken for truncation');
  assert.match(splitCapEvents.filter(event => event.t === 'text').map(event => event.d).join(''), /temperature$/);

  assert.equal(ollamaCalls.length, 11);
  assert.equal(ollamaCalls[0].model, 'test-coach:1b');
  assert.equal(ollamaCalls[0].stream, true);
  assert.equal(Object.prototype.hasOwnProperty.call(ollamaCalls[0], 'tools'), false,
    'the local model request must not expose a tool surface');
  assert.equal(ollamaCalls[3].stream, false);
  const prompt = ollamaCalls[0].messages.at(-1).content;
  assert.match(prompt, /TIC201/);
  assert.match(prompt, /Hidden architecture diagnosis/);
  assert.match(prompt, /authored simulated architecture indications, not measured process values/);
  assert.match(prompt, /do not promote them to confirmed board facts or a root cause/);
  assert.match(prompt, /Answer the operator's question/);

  const bad = await fetch(base + '/api/coach/advise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' },
    body: '{bad json'
  });
  assert.equal(bad.status, 400);
});
