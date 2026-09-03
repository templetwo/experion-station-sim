// @artifact dev
// The sidecar side of the station's CLOUD KEY dialog: POST /api/coach/credential. Pinned:
// only the station page may call it (a custom header, and the sidecar's own Origin when a
// browser sends one); the key's shape is validated; a stored key switches PIP to the cloud
// provider and is the key the cloud actually receives; a model override and the switch
// back to the local model work; the key is never readable, never echoed by health, and
// never appears in the sidecar's log output.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'tools', 'coach', 'serve.py');
const KEY = 'sk-test-0123456789abcdefghijklmnop';
const fs = require('node:fs');
const os = require('node:os');

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
function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [ev, data] of events) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}
const cloudAnswer = (model, txt) => [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: txt } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }],
  ['message_stop', { type: 'message_stop' }],
];

test('the station can hand the sidecar a cloud key for the session, and only the station can', { timeout: 30000 }, async (t) => {
  const cloudCalls = [];
  const fakeAnthropic = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    cloudCalls.push({ body, headers: req.headers });
    const askText = (body.messages || []).map((m) => String(m.content)).join('\n');
    if (askText.includes('AUTH_ECHO_TEST')) {
      // an upstream that echoes the credential back in its error body
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key: ' + req.headers['x-api-key'] } }));
      return;
    }
    sse(res, cloudAnswer(body.model, 'Cloud says: the FIC102 PV is bad; act on FI100 and the tank level.'));
  });
  const cloudPort = await listen(fakeAnthropic);
  t.after(() => new Promise((r) => fakeAnthropic.close(() => r())));

  const ollamaCalls = [];
  const fakeOllama = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    ollamaCalls.push(body);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ message: { content: 'Local says hello.' }, done: false }) + '\n');
    res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
  });
  const ollamaPort = await listen(fakeOllama);
  t.after(() => new Promise((r) => fakeOllama.close(() => r())));

  const coachPort = await freePort();
  let childErr = '';
  // an empty config dir: whatever `ant auth login` profile THIS machine holds must not
  // leak into the test, and the sidecar must report "none", not "unknown"
  const emptyConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-noprofile-'));
  const env = { ...process.env, COACH_PORT: String(coachPort), COACH_MODEL: 'test-coach:1b', COACH_WARM: '0',
    OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`, ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudPort}`,
    ANTHROPIC_CONFIG_DIR: emptyConfig };
  delete env.COACH_PROVIDER; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_PROFILE;
  const child = spawn('python3', [SERVE], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (c) => { childErr += c.toString('utf8'); });
  t.after(async () => { if (child.exitCode == null) child.kill('SIGTERM'); if (child.exitCode == null) await new Promise((r) => child.once('exit', r)); });

  const base = `http://127.0.0.1:${coachPort}`;
  const station = { 'Content-Type': 'application/json', 'X-Coach-Station': '1' };
  const post = (p, body, headers = station) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  const health = async () => (await fetch(base + '/api/coach/health')).json();
  const request = { kind: 'ask', ask: 'FIC102 reads 13.6 with BADPV, is the feed really low?',
    projection: { screen: { display: 'graphic', unit: 'U1' }, alarms: [{ tag: 'FIC102', cond: 'BADPV', priority: 'High', state: 'ACKED' }], points: [], catalog: [] } };

  const h0 = await waitForHealth(base + '/api/coach/health', child, () => childErr);
  assert.equal(h0.provider, 'auto');
  assert.equal(h0.active, 'ollama', 'auto with no credential is the local model');
  assert.equal(h0.model, 'test-coach:1b');
  assert.equal(h0.credential, 'none', 'no key, no env, no profile: say none, never unknown');

  // ---- never switch to a provider with nothing to authenticate with (before any key exists)
  const noCred = await post('/api/coach/credential', { provider: 'anthropic' });
  assert.equal(noCred.status, 409);
  assert.deepEqual(await noCred.json(), { ok: false, error: 'no credential' });
  assert.equal((await health()).active, 'ollama', 'the refused switch left the provider alone');

  // ---- who may call it
  assert.equal((await fetch(base + '/api/coach/credential')).status, 404, 'the credential is never readable');
  assert.equal((await post('/api/coach/credential', { key: KEY }, { 'Content-Type': 'application/json' })).status, 403, 'no station header, no service');
  assert.equal((await post('/api/coach/credential', { key: KEY }, { ...station, Origin: 'http://evil.example:9' })).status, 403, 'a foreign origin is refused');
  assert.equal((await post('/api/coach/credential', { key: KEY }, { ...station, Origin: `http://127.0.0.1:${coachPort}` })).status, 200, 'the sidecar\'s own origin is accepted');

  // ---- the endpoints that SPEND the credential get the same caller check
  assert.equal((await post('/api/coach/stream', request, { 'Content-Type': 'application/json' })).status, 403, 'a simple cross-origin POST cannot ask the coach a question');
  assert.equal((await post('/api/coach/advise', request, { 'Content-Type': 'text/plain' })).status, 403);
  assert.equal(await new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: coachPort, path: '/api/coach/health', method: 'GET', headers: { Host: 'rebound.example:80' } }, (r) => resolve(r.statusCode));
    rq.end();
  }), 403, 'a DNS-rebinding hostname is refused on every endpoint');

  // ---- shape validation
  assert.equal((await post('/api/coach/credential', { key: 'short' })).status, 400);
  assert.equal((await post('/api/coach/credential', { key: 'sk-test-0123456789\u200babcdefghij' })).status, 400, 'a zero-width space is not part of any key');
  assert.equal((await post('/api/coach/credential', { key: 'sk-test-0123456789abcdefghij\uFEFF' })).status, 400, 'nor is a BOM');
  assert.equal((await post('/api/coach/credential', { key: 'has a space in it but is otherwise long enough' })).status, 400);
  assert.equal((await post('/api/coach/credential', { provider: 'openai' })).status, 400);
  assert.equal((await post('/api/coach/credential', { model: 'not a model id' })).status, 400);
  assert.equal((await fetch(base + '/api/coach/credential', { method: 'POST', headers: station, body: '{bad' })).status, 400);

  // ---- a key switches PIP to the cloud, and the cloud receives THAT key
  const set = await (await post('/api/coach/credential', { key: KEY })).json();
  assert.deepEqual(set, { ok: true, provider: 'anthropic', active: 'anthropic', model: 'claude-opus-5', credential: 'session' });
  assert.ok(!JSON.stringify(set).includes(KEY), 'the response never echoes the key');
  const h1 = await health();
  assert.equal(h1.active, 'anthropic');
  assert.equal(h1.credential, 'session');
  assert.ok(!JSON.stringify(h1).includes(KEY));
  const s1 = (await (await post('/api/coach/stream', request)).text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(s1.some((f) => f.t === 'done' && f.ok && f.model === 'claude-opus-5'), JSON.stringify(s1));
  assert.equal(cloudCalls.length, 1);
  assert.equal(cloudCalls[0].headers['x-api-key'], KEY, 'the station key is the one the cloud receives');
  assert.equal(cloudCalls[0].body.model, 'claude-opus-5');
  assert.equal(ollamaCalls.length, 0);

  // ---- a model override
  assert.deepEqual(await (await post('/api/coach/credential', { model: 'claude-sonnet-5' })).json(), { ok: true, provider: 'anthropic', active: 'anthropic', model: 'claude-sonnet-5', credential: 'session' });
  const s2 = (await (await post('/api/coach/stream', request)).text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(s2.some((f) => f.t === 'done' && f.ok && f.model === 'claude-sonnet-5'));
  assert.equal(cloudCalls[1].body.model, 'claude-sonnet-5');
  assert.equal(cloudCalls[1].headers['x-api-key'], KEY);

  // ---- back to the local model: the key stays for the session, Ollama serves, its own model name
  assert.deepEqual(await (await post('/api/coach/credential', { provider: 'ollama' })).json(), { ok: true, provider: 'ollama', active: 'ollama', model: 'test-coach:1b', credential: 'session' });
  const s3 = (await (await post('/api/coach/stream', request)).text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(s3.some((f) => f.t === 'done' && f.ok && f.model === 'test-coach:1b'), JSON.stringify(s3));
  assert.equal(ollamaCalls.length, 1);
  assert.equal(ollamaCalls[0].model, 'test-coach:1b');
  assert.equal(cloudCalls.length, 2);

  // ---- the key is redacted from every outbound string, even when the upstream echoes it
  assert.equal((await post('/api/coach/credential', { provider: 'anthropic' })).status, 200, 'with the session key still held, the cloud can be re-selected');
  const echoed = (await (await post('/api/coach/stream', { ...request, ask: 'AUTH_ECHO_TEST' })).text()).trim().split('\n').map((l) => JSON.parse(l));
  const echoErr = echoed.find((f) => f.t === 'err');
  assert.ok(echoErr, 'a rejected key fails visibly');
  assert.match(echoErr.d, /key entered at this station was rejected/, 'and the message names the credential actually in use');
  assert.doesNotMatch(echoErr.d, /ant auth login/);
  assert.ok(!JSON.stringify(echoed).includes(KEY), 'the frames never carry the key, even when the upstream echoed it');
  const advisedEcho = await (await post('/api/coach/advise', { ...request, ask: 'AUTH_ECHO_TEST' })).json();
  assert.ok(!JSON.stringify(advisedEcho).includes(KEY));

  // ---- forget: the key goes, the model override goes, and with no other credential the cloud goes too
  assert.deepEqual(await (await post('/api/coach/credential', { clear: true })).json(), { ok: true, provider: 'ollama', active: 'ollama', model: 'test-coach:1b', credential: 'none' });
  assert.equal((await health()).credential, 'none');
  assert.equal((await post('/api/coach/credential', { provider: 'anthropic' })).status, 409, 'and the cloud cannot be re-selected without one');

  assert.ok(!childErr.includes(KEY), 'the key must never reach the sidecar log, even after an upstream echoed it');
  assert.ok(/coach: cloud error AuthenticationError/.test(childErr), 'the rejection itself is logged');
});
