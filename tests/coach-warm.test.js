// @artifact dev
// The local model is loaded once at sidecar startup and kept loaded between questions, and
// the page says LOADING while that happens. On the first live run (2026-09-03) the 8B model
// took over three minutes to answer its first question while PIP showed THINKING -- the
// impression the coach must never give an operator.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { load } = require('../tools/logic-harness');

const ROOT = path.join(__dirname, '..');
const SERVE = path.join(ROOT, 'tools', 'coach', 'serve.py');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}
async function freePort() {
  const holder = net.createServer(); const port = await listen(holder);
  await new Promise((resolve, reject) => holder.close((err) => err ? reject(err) : resolve())); return port;
}
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); }
async function waitFor(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } return null; }

async function spawnCoach(t, env, ollamaPort) {
  const coachPort = await freePort();
  let childErr = '';
  const child = spawn('python3', [SERVE], { cwd: ROOT, env: { ...process.env, COACH_PORT: String(coachPort), COACH_MODEL: 'test-coach:1b', OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (c) => { childErr += c.toString('utf8'); });
  t.after(async () => { if (child.exitCode == null) child.kill('SIGTERM'); if (child.exitCode == null) await new Promise((r) => child.once('exit', r)); });
  const base = `http://127.0.0.1:${coachPort}`;
  const health = await waitFor(async () => { try { const r = await fetch(base + '/api/coach/health'); return r.ok ? r.json() : null; } catch (_) { return null; } });
  assert.ok(health, 'health did not come up: ' + childErr);
  return { base, health: () => fetch(base + '/api/coach/health').then((r) => r.json()), err: () => childErr };
}

test('the sidecar warms the local model at startup and keeps it loaded', { timeout: 15000 }, async (t) => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const fakeOllama = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    calls.push(body);
    if (!body.stream) { await gate; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })); return; }
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ message: { content: 'Local answer.' }, done: false }) + '\n');
    res.end(JSON.stringify({ message: {}, done: true, done_reason: 'stop' }) + '\n');
  });
  const ollamaPort = await listen(fakeOllama);
  t.after(() => new Promise((r) => fakeOllama.close(() => r())));

  const coach = await spawnCoach(t, {}, ollamaPort);
  const warming = await waitFor(async () => calls.length ? true : null);
  assert.ok(warming, 'a warm-up request must reach Ollama at startup');
  assert.equal(calls[0].stream, false);
  assert.equal(calls[0].options.num_predict, 1, 'the warm-up generates one token, no more');
  assert.equal(calls[0].keep_alive, '30m', 'and asks Ollama to keep the model loaded');
  assert.equal((await coach.health()).warm, false, 'while the model loads, health says warm: false');
  release();
  const warm = await waitFor(async () => (await coach.health()).warm === true ? true : null);
  assert.ok(warm, 'health flips to warm: true when the load completes');
  assert.match(coach.err(), /coach: model test-coach:1b warm in/);

  const res = await fetch(coach.base + '/api/coach/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Coach-Station': '1' }, body: JSON.stringify({ kind: 'ask', ask: 'hello', projection: { screen: { unit: 'U1' }, alarms: [], points: [], catalog: [] } }) });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(calls.at(-1).keep_alive, '30m', 'every question keeps the model loaded');
});

test('COACH_WARM=0 disables the warm-up and health reports warm: null', { timeout: 10000 }, async (t) => {
  const calls = [];
  const fakeOllama = http.createServer(async (req, res) => { calls.push(JSON.parse(await readBody(req))); res.writeHead(500).end(); });
  const ollamaPort = await listen(fakeOllama);
  t.after(() => new Promise((r) => fakeOllama.close(() => r())));
  const coach = await spawnCoach(t, { COACH_WARM: '0' }, ollamaPort);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(calls.length, 0);
  assert.equal((await coach.health()).warm, null);
});

test('the page shows LOADING, not the model name, while the sidecar reports warm: false', async () => {
  const { Component } = load();
  const c = new Component({}); c.initSim(1700000000000);
  const loc = globalThis.location; const prev = loc.protocol; loc.protocol = 'http:';
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, model: 'granite4.2:8b', provider: 'ollama', warm: false }) });
    c.coachPing();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(c.state.coachStatus, 'LOADING granite4.2:8b…');
    assert.equal(c.state.coachLive, true);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, model: 'granite4.2:8b', provider: 'ollama', warm: true }) });
    c.coachPing();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(c.state.coachStatus, 'granite4.2:8b');
  } finally { globalThis.fetch = real; loc.protocol = prev; }
});
