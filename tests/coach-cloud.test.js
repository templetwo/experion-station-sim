// @artifact dev
// The optional CLOUD provider for the PIP sidecar (COACH_PROVIDER=anthropic), against a
// fake Anthropic Messages API. Same HTTP contract with the page as the local path
// (tests/coach-sidecar.test.js): NDJSON frames, the spoken-word cap, trainee-safe
// scrubbing, and honest failure reasons. What is specific to the cloud path and pinned
// here: the request shape (model, no tool surface, adaptive thinking, effort, the
// server-side fallback beta, a cacheable system block carrying the plant identity, a
// conversation that opens with a user turn), a policy decline reported as a decline,
// an early end reported as incomplete, missing credentials reported as credentials,
// and Ollama never being contacted.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'tools', 'coach', 'serve.py');
const SERVE_SRC = require('node:fs').readFileSync(SERVE, 'utf8');
const ASK_WORDS = Number((SERVE_SRC.match(/^ASK_WORDS\s*=\s*(\d+)/m) || [])[1]);
assert.ok(Number.isFinite(ASK_WORDS) && ASK_WORDS > 0, 'could not read ASK_WORDS out of serve.py');
const OVER_CAP_WORDS = ASK_WORDS + 40;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}
async function freePort() {
  const holder = net.createServer();
  const port = await listen(holder);
  await new Promise((resolve, reject) => holder.close((err) => err ? reject(err) : resolve()));
  return port;
}
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); }
async function waitForHealth(url, child, stderr) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode != null) throw new Error('coach exited early: ' + stderr());
    try { const res = await fetch(url); if (res.ok) return res.json(); } catch (_) {}
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('coach health did not become ready: ' + stderr());
}
async function frames(res) { return (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); }

// ---- a minimal Anthropic Messages streaming server (SSE), scripted by the ask text
function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  for (const [ev, data] of events) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}
const start = () => ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }];
const openText = (i) => ['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }];
const openThink = (i) => ['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } }];
const text = (i, t) => ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t } }];
const think = (i, t) => ['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: t } }];
const close = (i) => ['content_block_stop', { type: 'content_block_stop', index: i }];
const end = (stop_reason) => ['message_delta', { type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } }];
const fin = () => ['message_stop', { type: 'message_stop' }];
const answer = (parts, stop_reason = 'end_turn') => [start(), openThink(0), think(0, 'check the PV quality first'), close(0), openText(1), ...parts.map((p) => text(1, p)), close(1), end(stop_reason), fin()];

test('PIP sidecar on the cloud provider: same contract with the page, honest reasons, no Ollama', { timeout: 30000 }, async (t) => {
  const cloudCalls = [];
  const fakeAnthropic = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404).end('not found'); return; }
    const body = JSON.parse(await readBody(req));
    cloudCalls.push({ body, headers: req.headers });
    const askText = (body.messages || []).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    if (askText.includes('AUTH_TEST')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      return;
    }
    if (askText.includes('REFUSAL_TEST')) return sse(res, [start(), end('refusal'), fin()]);
    if (askText.includes('MAXTOK_TEST')) return sse(res, answer(['Check TIC201 against the'], 'max_tokens'));
    if (askText.includes('CAPPED_TEST')) return sse(res, answer([Array.from({ length: OVER_CAP_WORDS }, (_, i) => 'word' + i).join(' ')]));
    if (askText.includes('SPLIT_BANNED_TEST')) return sse(res, answer(['FROZEN_', 'MEASUREMENT is not for trainees; compare TIC201 with TIC202.']));
    return sse(res, answer(['E-301 is a preheater on hot oil; ', 'open TV-301 and the flash gets hotter, not colder.']));
  });
  const cloudPort = await listen(fakeAnthropic);
  t.after(() => new Promise((r) => fakeAnthropic.close(() => r())));

  // Ollama must never be contacted on the cloud provider.
  let ollamaHits = 0;
  const fakeOllama = http.createServer((req, res) => { ollamaHits++; res.writeHead(500).end(); });
  const ollamaPort = await listen(fakeOllama);
  t.after(() => new Promise((r) => fakeOllama.close(() => r())));

  const coachPort = await freePort();
  let childErr = '';
  const env = { ...process.env,
    COACH_PORT: String(coachPort), COACH_PROVIDER: 'anthropic', COACH_CLOUD_MODEL: 'claude-test', COACH_CLOUD_EFFORT: 'low',
    COACH_MODEL: 'granite-should-not-matter', OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudPort}`, ANTHROPIC_API_KEY: 'test-key' };
  delete env.ANTHROPIC_AUTH_TOKEN;
  const child = spawn('python3', [SERVE], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (c) => { childErr += c.toString('utf8'); });
  t.after(async () => { if (child.exitCode == null) child.kill('SIGTERM'); if (child.exitCode == null) await new Promise((r) => child.once('exit', r)); });

  const base = `http://127.0.0.1:${coachPort}`;
  const health = await waitForHealth(base + '/api/coach/health', child, () => childErr);
  assert.equal(health.ok, true);
  assert.equal(health.provider, 'anthropic');
  assert.equal(health.model, 'claude-test', 'the badge reports the model actually served, not COACH_MODEL');
  assert.equal(health.tools, false);

  const request = {
    kind: 'ask',
    ask: 'Is E-301 a cooler or a heater?',
    projection: {
      screen: { display: 'graphic', displayName: 'UNIT GRAPHIC', unit: 'U1', selected: 'TIC201', unack: 1 },
      alarms: [{ tag: 'TIC201', cond: 'PVHI', priority: 'High', state: 'UNACK', pv: 171.2, sp: 150, op: 2, mode: 'AUTO' }],
      points: [{ tag: 'TIC201', desc: 'R-201 temperature', pv: 171.2, sp: 150, op: 2, mode: 'AUTO' }],
      catalog: [{ tag: 'TIC301', desc: 'E-301 FLASH PREHEAT OUTLET TEMP' }],
    },
    history: [{ role: 'user', content: 'I am looking at U1.' }, { role: 'assistant', content: 'Understood.' }],
  };
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' }, body: JSON.stringify(body) });

  // ---- the happy path: think + text frames, a done frame, the answer intact
  const ok = await post('/api/coach/stream', request);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') || '', /application\/x-ndjson/);
  const okFrames = await frames(ok);
  assert.ok(okFrames.some((f) => f.t === 'think'), 'thinking summary frames reach the pal');
  assert.equal(okFrames.filter((f) => f.t === 'text').map((f) => f.d).join(''), 'E-301 is a preheater on hot oil; open TV-301 and the flash gets hotter, not colder.');
  const done = okFrames.find((f) => f.t === 'done');
  assert.ok(done && done.ok && done.model === 'claude-test', JSON.stringify(done));

  // ---- the request the cloud actually received
  assert.equal(cloudCalls.length, 1);
  const { body, headers } = cloudCalls[0];
  assert.equal(body.model, 'claude-test');
  assert.equal(body.stream, true);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'tools'), false, 'PIP is tool-free on the cloud too');
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(body.output_config, { effort: 'low' });
  assert.equal(body.fallbacks, 'default', 'a policy decline re-runs server-side on a fallback model');
  assert.match(String(headers['anthropic-beta'] || ''), /server-side-fallback-2026-07-01/);
  assert.equal(headers['x-api-key'], 'test-key');
  assert.ok(body.max_tokens >= 1000, 'thinking counts against max_tokens; the spoken cap is enforced by the sidecar');
  assert.ok(Array.isArray(body.system) && body.system[0].type === 'text');
  assert.match(body.system[0].text, /THE PLANT YOU ARE STANDING IN/, 'the plant identity rides in the system block');
  assert.match(body.system[0].text, /quick-eyed watchstander/i, 'prompt.txt rides in the system block');
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' }, 'the stable system block is marked cacheable');
  assert.equal(body.messages[0].role, 'user', 'the conversation opens with a user turn');
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(body.messages.at(-1).content, /TIC201/);
  assert.match(body.messages.at(-1).content, /Is E-301 a cooler or a heater/);
  assert.ok(!body.messages.some((m) => m.role === 'system'), 'no system role inside messages');

  // ---- the non-streaming advise shape, from the same streamed request
  const advise = await post('/api/coach/advise', request);
  assert.equal(advise.status, 200);
  const advised = await advise.json();
  assert.equal(advised.ok, true);
  assert.match(advised.text, /preheater/);
  assert.equal(advised.model, 'claude-test');

  // ---- honest failure reasons
  const refusal = await frames(await post('/api/coach/stream', { ...request, ask: 'REFUSAL_TEST' }));
  const refusalErr = refusal.find((f) => f.t === 'err');
  assert.ok(refusalErr, 'a policy decline must fail visibly');
  assert.equal(refusalErr.reason, 'refusal');
  assert.match(refusalErr.d, /declined/);
  assert.doesNotMatch(refusalErr.d, /cannot reach/, 'a decline is not an outage');
  assert.ok(!refusal.some((f) => f.t === 'done' && f.ok));

  const maxtok = await frames(await post('/api/coach/stream', { ...request, ask: 'MAXTOK_TEST' }));
  assert.ok(maxtok.some((f) => f.t === 'err' && /cut off/.test(f.d) && f.reason === 'model'), JSON.stringify(maxtok));
  assert.ok(!maxtok.some((f) => f.t === 'done' && f.ok), 'partial text cannot be success');

  // No spoken-word cap on the cloud: a long but COMPLETE answer is relayed in full (the local
  // cap exists for a small model that ignores length instructions; the cloud model follows the
  // LENGTH guidance, and a finished answer is never discarded). A cut-off stays a failure (MAXTOK).
  const long = await frames(await post('/api/coach/stream', { ...request, ask: 'CAPPED_TEST' }));
  assert.ok(long.some((f) => f.t === 'done' && f.ok), 'a complete answer over the local cap is still an answer on the cloud');
  assert.equal(long.filter((f) => f.t === 'text').map((f) => f.d).join('').split(' ').length, OVER_CAP_WORDS, 'and none of it is dropped');
  assert.ok(!long.some((f) => f.t === 'err'));

  const split = await frames(await post('/api/coach/stream', { ...request, ask: 'SPLIT_BANNED_TEST' }));
  const splitText = split.filter((f) => f.t === 'text').map((f) => f.d).join('');
  assert.doesNotMatch(splitText, /FROZEN_MEASUREMENT/, 'an instructor-only fault id split across deltas must not leak');
  assert.match(splitText, /\[hidden\]/);
  assert.ok(split.some((f) => f.t === 'done' && f.ok));

  const auth = await frames(await post('/api/coach/stream', { ...request, ask: 'AUTH_TEST' }));
  const authErr = auth.find((f) => f.t === 'err');
  assert.ok(authErr, 'bad credentials must fail visibly');
  assert.match(authErr.d, /credential/, 'and say so, instead of blaming the network');
  assert.match(authErr.d, /ANTHROPIC_API_KEY/, 'and name the credential that was actually in use (the environment, in this test)');
  assert.doesNotMatch(authErr.d, /ant auth login/, 'and not send the operator to a mechanism that was not in use');

  const advisedRefusal = await post('/api/coach/advise', { ...request, ask: 'REFUSAL_TEST' });
  assert.equal(advisedRefusal.status, 503);
  assert.match((await advisedRefusal.json()).text, /declined/);

  assert.equal(ollamaHits, 0, 'Ollama must never be contacted on the cloud provider');
  assert.equal(cloudCalls.length, 8);
  assert.match(cloudCalls[0].body.messages.at(-1).content, /LENGTH: aim for about \d+ words/, 'the cloud prompt carries guidance, not a hard LIMIT');
  assert.doesNotMatch(cloudCalls[0].body.messages.at(-1).content, /^LIMIT:/m);
});

test('the default provider is auto (cloud first, local fallback) and an unknown provider refuses to start', async () => {
  assert.match(SERVE_SRC, /COACH_PROVIDER["'], ["']auto["']/, 'the default is cloud-first with a local fallback');
  const child = spawn('python3', [SERVE], { cwd: ROOT, env: { ...process.env, COACH_PORT: String(await freePort()), COACH_PROVIDER: 'openai' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c.toString('utf8'); });
  const code = await new Promise((r) => child.once('exit', r));
  assert.notEqual(code, 0, 'an unknown provider must not start silently on the local path');
  assert.match(err, /COACH_PROVIDER must be/);
});

test('auto: the cloud answers when it can; when it refuses before answering, the local model answers that question', { timeout: 30000 }, async (t) => {
  let cloudCalls = 0;
  const fakeAnthropic = http.createServer(async (req, res) => {
    await readBody(req); cloudCalls++;
    if (cloudCalls === 1) {   // billing refusal, the exact shape seen live on 2026-09-03
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }));
      return;
    }
    sse(res, answer(['Cloud answer: the PV is bad, act on FI100 and the tank level.']));
  });
  const cloudPort = await listen(fakeAnthropic);
  t.after(() => new Promise((r) => fakeAnthropic.close(() => r())));
  const fakeOllama = http.createServer(async (req, res) => {
    await readBody(req);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ message: { content: 'Local answer instead.' }, done: false }) + '\n');
    res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
  });
  const ollamaPort = await listen(fakeOllama);
  t.after(() => new Promise((r) => fakeOllama.close(() => r())));

  const coachPort = await freePort();
  let childErr = '';
  const env = { ...process.env, COACH_PORT: String(coachPort), COACH_MODEL: 'test-coach:1b', COACH_WARM: '0', COACH_CLOUD_MODEL: 'claude-test',
    OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`, ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudPort}`, ANTHROPIC_API_KEY: 'test-key' };
  delete env.COACH_PROVIDER; delete env.ANTHROPIC_AUTH_TOKEN;
  const child = spawn('python3', [SERVE], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (c) => { childErr += c.toString('utf8'); });
  t.after(async () => { if (child.exitCode == null) child.kill('SIGTERM'); if (child.exitCode == null) await new Promise((r) => child.once('exit', r)); });

  const base = `http://127.0.0.1:${coachPort}`;
  const health = await waitForHealth(base + '/api/coach/health', child, () => childErr);
  assert.equal(health.provider, 'auto');
  assert.equal(health.active, 'anthropic', 'a credential exists, so the cloud is first');
  assert.equal(health.model, 'claude-test');
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' }, body: JSON.stringify(body) });
  const request = { kind: 'ask', ask: 'Is the feed really low?', projection: { screen: { unit: 'U1' }, alarms: [], points: [], catalog: [] } };

  const first = await frames(await post('/api/coach/stream', request));
  assert.equal(first.filter((f) => f.t === 'text').map((f) => f.d).join(''), 'Local answer instead.', 'the local model answered the question the cloud refused');
  const d1 = first.find((f) => f.t === 'done');
  assert.ok(d1 && d1.ok && d1.model === 'test-coach:1b', JSON.stringify(d1));
  assert.ok(!first.some((f) => f.t === 'err'), 'the operator sees an answer, not an error');
  assert.match(childErr, /cloud BadRequestError before answering .*local model answers this one/);

  const second = await frames(await post('/api/coach/stream', request));
  assert.equal(second.filter((f) => f.t === 'text').map((f) => f.d).join(''), 'Cloud answer: the PV is bad, act on FI100 and the tank level.');
  assert.ok(second.some((f) => f.t === 'done' && f.ok && f.model === 'claude-test'));
  assert.equal(cloudCalls, 2);

  // and the non-streaming advise shape falls back the same way (cloud call 3 answers; make it refuse by asking again after a refusal is not scriptable here, so check the happy path)
  const advised = await (await post('/api/coach/advise', request)).json();
  assert.equal(advised.ok, true);
  assert.equal(advised.model, 'claude-test');
});
