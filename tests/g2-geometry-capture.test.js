// @artifact dev
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const archive = require('../tools/g2-history/archive.cjs').materialize();
test.after(() => archive.cleanup());
const historical = name => path.join(archive.root, name);
const { captureNative } = require(historical('tools/g2-geometry/capture-native.cjs'));
const { provenance } = require(historical('tools/g2/capture-native.cjs'));
const { load } = require(historical('tools/logic-harness.js'));
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const FRAME_KEYS = ['bed_temperature_c', 'effective_activity', 'flow_m3h', 'product_valve_position', 'water_valve_position', 'weir_height_percent'];

function checkShape(trace) {
  assert.deepEqual(Object.keys(trace).sort(), ['events', 'intervals', 'scenario', 'schema', 'source']);
  assert.equal(trace.schema, 'g2-geometry-native-v1');
  assert.equal(trace.source.step_s, 0.5);
  assert.equal(trace.source.model_id, require(historical('src/model-id.js')));
  assert.equal(trace.source.revision, provenance().revision);
  assert.equal(trace.source.provenance_dependency_sha256, hashFile(historical('tools/g2/capture-native.cjs')));
  assert.equal(trace.source.capture_script_sha256, hashFile(historical('tools/g2-geometry/capture-native.cjs')));
  assert.deepEqual(Object.keys(trace.source.evidence_phases).sort(), ['post_u3', 'pre']);
  assert.equal(trace.intervals.length, 6000);
  for (const [tick, row] of trace.intervals.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['end_s', 'post_u3', 'pre', 'start_s']);
    assert.equal(row.start_s, tick * 0.5);
    assert.equal(row.end_s, (tick + 1) * 0.5);
    for (const phase of ['pre', 'post_u3']) {
      assert.deepEqual(Object.keys(row[phase]).sort(), FRAME_KEYS);
      assert.ok(Object.values(row[phase]).every(Number.isFinite));
      assert.ok(row[phase].flow_m3h > 39 && row[phase].flow_m3h < 41);
      for (const name of ['water_valve_position', 'product_valve_position']) assert.ok(row[phase][name] >= 0 && row[phase][name] <= 1);
      assert.equal(row[phase].weir_height_percent, 55);
    }
  }
}

test('geometry capture is deterministic without host-clock reads and records real heater response', () => {
  const now = Date.now;
  let trace;
  try {
    Date.now = () => { throw new Error('host clock read'); };
    trace = captureNative();
    assert.deepEqual(captureNative(), trace);
  } finally { Date.now = now; }
  checkShape(trace);
  assert.equal(trace.scenario, 'heater-loss');
  assert.deepEqual(trace.events, [
    { time_s: 600, action: 'setMode', tag: 'TIC311', mode: 'MAN' },
    { time_s: 600, action: 'storeEntry', tag: 'TIC311', parameter: 'OP', value: 0, unit: '%' },
    { time_s: 1800, action: 'setMode', tag: 'TIC311', mode: 'AUTO', retained_sp_c: 320 }
  ]);
  const at = s => trace.intervals[s * 2];
  assert.ok(at(1800).pre.bed_temperature_c < at(600).pre.bed_temperature_c - 250);
  assert.ok(trace.intervals.at(-1).post_u3.bed_temperature_c > at(1800).pre.bed_temperature_c + 250);
  assert.ok(at(600).post_u3.bed_temperature_c > at(1800).pre.bed_temperature_c + 200, 'fuel command cannot instantaneously cool the bed');
  assert.ok(trace.intervals.every(row => row.pre.effective_activity === 1 && row.post_u3.effective_activity === 1));
});

test('activity-step capture uses the declared native multiplier on the exact command intervals', () => {
  const now = Date.now;
  let trace;
  try {
    Date.now = () => { throw new Error('host clock read'); };
    trace = captureNative({ scenario: 'activity-step' });
    assert.deepEqual(captureNative({ scenario: 'activity-step' }), trace);
  } finally { Date.now = now; }
  checkShape(trace);
  assert.deepEqual(trace.events, [
    { time_s: 600, action: 'setMagnitude', key: 'bedact', value: 1.35 },
    { time_s: 600, action: 'setUpset', key: 'bedact', on: true },
    { time_s: 1800, action: 'setUpset', key: 'bedact', on: false }
  ]);
  const limits = globalThis.ESS.Instructor.upsetDefs().find(x => x.k === 'bedact').mag;
  assert.ok(1.35 >= limits.min && 1.35 <= limits.max);
  for (const row of trace.intervals) {
    const expected = row.start_s >= 600 && row.start_s < 1800 ? 1.35 : 1;
    assert.equal(row.pre.effective_activity, expected);
    assert.equal(row.post_u3.effective_activity, expected);
  }
  const changed = trace.intervals[1200];
  assert.ok(changed.post_u3.bed_temperature_c > changed.pre.bed_temperature_c, 'native activity step changes bed evolution in its first active interval');
  assert.notEqual(trace.intervals[3599].post_u3.bed_temperature_c, trace.intervals[1200].pre.bed_temperature_c);
});

test('post-U3 valve frames match the actual preceding native stroke, not the next PID demand', () => {
  const trace = captureNative();
  const { Component } = load();
  const c = new Component({}); c.initSim(0);
  for (let tick = 0; tick < 8; tick++) {
    const before = { water: c.V.WV504.pos, product: c.V.LV503.pos };
    const target = { water: c.L.LIC504.op / 100, product: c.L.LIC503.op / 100 };
    c.step(0.5);
    const row = trace.intervals[tick];
    assert.equal(row.pre.water_valve_position, before.water);
    assert.equal(row.pre.product_valve_position, before.product);
    assert.equal(row.post_u3.water_valve_position, before.water + (target.water - before.water) * 0.5 / 3);
    assert.equal(row.post_u3.product_valve_position, before.product + (target.product - before.product) * 0.5 / 3);
    assert.equal(row.post_u3.flow_m3h, c.P.h.f);
    assert.equal(row.post_u3.bed_temperature_c, c.P.h.bed);
    assert.equal(row.post_u3.water_valve_position, c.V.WV504.pos);
    assert.equal(row.post_u3.product_valve_position, c.V.LV503.pos);
  }
});

test('geometry capture CLI works without Git and rejects invalid scenarios/options', () => {
  const script = historical('tools/g2-geometry/capture-native.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-geometry-capture-'));
  try {
    const outfile = path.join(directory, 'trace.json');
    const stdout = execFileSync(process.execPath, [script, '--scenario', 'activity-step', '--out', outfile], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(stdout, '');
    const trace = JSON.parse(fs.readFileSync(outfile, 'utf8'));
    assert.equal(trace.scenario, 'activity-step');
    assert.equal(trace.intervals.at(-1).end_s, 3000);
    for (const args of [['--scenario', 'other'], ['--scenario'], ['--unknown', 'x'], ['--scenario', 'heater-loss', '--scenario', 'activity-step']]) {
      assert.throws(() => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' }), /Command failed/);
    }
    assert.throws(() => captureNative({ scenario: 'activity-loss' }), /Unknown scenario/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('historical geometry adapter refuses the changed live runtime', () => {
  assert.throws(() => require('../tools/g2-geometry/capture-native.cjs').captureNative(), /Native runtime code/);
});
