// @artifact dev
// Streaming PIP coach: TRAINEE_SAFE still, Gate 4 still, think+stream named in sidecar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const FaultEngine = require('../src/fault-engine.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'Experion Station Simulator.dc.html');
const SERVE = path.join(ROOT, 'tools', 'coach', 'serve.py');
const PLAN = path.join(ROOT, 'docs', 'dev', 'V3-PLAN.md');

const { Component } = load();
const page = fs.readFileSync(APP, 'utf8');
const serve = fs.readFileSync(SERVE, 'utf8');
const plan = fs.readFileSync(PLAN, 'utf8');

test('sidecar streams NDJSON and enables think', () => {
  assert.match(serve, /\/api\/coach\/stream/);
  assert.match(serve, /application\/x-ndjson/);
  assert.match(serve, /["']think["']\s*:\s*THINK/);
  assert.match(serve, /"t": "think"/);
  assert.match(serve, /"t": "text"/);
});

test('page fetches only the stream and health/advise coach paths', () => {
  assert.match(page, /fetch\s*\(\s*'\/api\/coach\/stream'/);
  assert.match(page, /fetch\s*\(\s*'\/api\/coach\/health'/);
  assert.match(page, /fetch\s*\(\s*'\/api\/coach\/advise'/);
  assert.match(page, /ess-pip/);
  assert.match(page, /ess-pip-cloud/);
  assert.match(page, /coachMood/);
});

test('spec names the coach so gate 4 is not a silent weaker gate', () => {
  assert.match(plan, /\/api\/coach\//);
  assert.match(plan, /Launch Station\.command/);
});

test('offline harness still does not fetch, pal click is safe', () => {
  const c = new Component({});
  c.initSim();
  assert.equal(c.coachOnHttp(), false);
  c.coachAsk('explain', '');
  assert.match(c.state.coachStatus, /OFFLINE/);
  c.coachPalClick();
  assert.equal(c.state.assist, true);
  assert.match(c.state.coachStatus, /OFFLINE/);
});

test('coachScrub still strips think tags and fault ids', () => {
  const c = new Component({});
  c.initSim();
  const dirty = '<think>secret</think> FROZEN_MEASUREMENT on FIC102';
  const out = c.coachScrub(dirty);
  assert.equal(out.includes('secret'), false);
  const leaked = FaultEngine.FAULT_IDS.filter((id) => out.includes(id));
  assert.deepEqual(leaked, []);
});
