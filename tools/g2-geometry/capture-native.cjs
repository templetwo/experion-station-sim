#!/usr/bin/env node
// @artifact dev
'use strict';

// One-way offline native input capture. This isolated instance uses real native
// operator/instructor setters, with no composition state or feedback. The two
// frames expose the input-order choice for a separate geometry reference model.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { load } = require('../logic-harness.js');
const { provenance } = require('../g2/capture-native.cjs');

const STEP_S = 0.5;
const CHANGE_S = 600;
const RECOVERY_S = 1800;
const END_S = 3000;
const SCENARIOS = ['heater-loss', 'activity-step'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function frame(c) {
  const result = {
    flow_m3h: c.P.h.f,
    bed_temperature_c: c.P.h.bed,
    effective_activity: c.P.env.catAct * (c.P.faults.bedact ? c.P.mag.bedact : 1),
    water_valve_position: c.V.WV504.pos,
    product_valve_position: c.V.LV503.pos,
    weir_height_percent: c.P.env.weirH
  };
  if (!Object.values(result).every(Number.isFinite)) throw new Error('Non-finite native geometry input.');
  return result;
}

function applyEvent(c, event) {
  if (event.action === 'setMode') {
    c.setMode(event.tag, event.mode);
    if (c.L[event.tag].mode !== event.mode) throw new Error('Native mode command refused.');
  } else if (event.action === 'storeEntry') {
    const accepted = c.storeEntry(event.tag, event.parameter, event.value);
    if (!accepted || c.L[event.tag][event.parameter.toLowerCase()] !== event.value) throw new Error('Native entry command refused.');
  } else if (event.action === 'setMagnitude') {
    c.setMagnitude(event.key, event.value);
    if (c.P.mag[event.key] !== event.value) throw new Error('Native magnitude command refused.');
  } else if (event.action === 'setUpset') {
    c.setUpset(event.key, event.on);
    if (!!c.P.faults[event.key] !== event.on) throw new Error('Native upset command refused.');
  } else throw new Error('Unknown capture event.');
}

function captureNative({ scenario = 'heater-loss' } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error('Unknown scenario; use heater-loss or activity-step.');
  // The immutable v1 validator checks actual runtime bytes, full stamp and
  // harness against bfed001 without requiring Git history. Name both adapters:
  // the inherited capture hash belongs to the provenance dependency, not here.
  const source = provenance();
  source.provenance_dependency_sha256 = source.capture_script_sha256;
  source.capture_script_sha256 = hash(fs.readFileSync(__filename));
  delete source.sample_timing;
  source.evidence_phases = {
    pre: 'interval start after listed commands, before Core.step and valve stroke',
    post_u3: 'immediately after native Core.stepU3, after U1 valve stroke and U3 state update, before U4, PID, alarms and scheduled-fault activation'
  };
  const { Component } = load();
  const c = new Component({});
  c.initSim(0); // Do not mount the page, start timers or use its wall-clock default.
  source.seed = c.seed;
  if (globalThis.ESS.MODEL_ID !== source.model_id) throw new Error('Loaded native model differs from verified source.');

  const events = scenario === 'heater-loss' ? [
    { time_s: CHANGE_S, action: 'setMode', tag: 'TIC311', mode: 'MAN' },
    { time_s: CHANGE_S, action: 'storeEntry', tag: 'TIC311', parameter: 'OP', value: 0, unit: '%' },
    { time_s: RECOVERY_S, action: 'setMode', tag: 'TIC311', mode: 'AUTO', retained_sp_c: c.L.TIC311.sp }
  ] : [
    { time_s: CHANGE_S, action: 'setMagnitude', key: 'bedact', value: 1.35 },
    { time_s: CHANGE_S, action: 'setUpset', key: 'bedact', on: true },
    { time_s: RECOVERY_S, action: 'setUpset', key: 'bedact', on: false }
  ];
  // Wrap this instance only. Native Core.step still calls its inherited U3
  // method once; all state transitions, RNG draws and U4 behavior remain native.
  const nativeStepU3 = c.stepU3;
  let postU3 = null;
  c.stepU3 = function (dt) {
    if (postU3 !== null) throw new Error('Native U3 advanced twice in one interval.');
    const result = nativeStepU3.call(this, dt);
    postU3 = frame(this);
    return result;
  };
  const intervals = [];
  for (let tick = 0; tick < END_S / STEP_S; tick++) {
    const start_s = tick * STEP_S, end_s = start_s + STEP_S;
    if (c.P.t !== start_s * 1000) throw new Error('Native interval start clock mismatch.');
    for (const event of events) {
      if (event.time_s !== start_s) continue;
      if (event.retained_sp_c !== undefined && c.L.TIC311.sp !== event.retained_sp_c) throw new Error('Heater setpoint changed before recovery.');
      applyEvent(c, event);
    }
    const pre = frame(c);
    postU3 = null;
    c.step(STEP_S);
    if (postU3 === null || c.P.t !== end_s * 1000) throw new Error('Native U3 phase or interval end missing.');
    intervals.push({ start_s, end_s, pre, post_u3: postU3 });
  }
  return { schema: 'g2-geometry-native-v1', scenario, source, events, intervals };
}

function main(args) {
  const options = {};
  let outfile;
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error('Expected a value after ' + key);
    if (key === '--scenario' && options.scenario === undefined) options.scenario = value;
    else if (key === '--out' && outfile === undefined) outfile = value;
    else throw new Error('Usage: node tools/g2-geometry/capture-native.cjs [--scenario heater-loss|activity-step] [--out FILE]');
  }
  const json = JSON.stringify(captureNative(options), null, 2) + '\n';
  if (outfile !== undefined) fs.writeFileSync(outfile, json);
  else process.stdout.write(json);
}

module.exports = { captureNative };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
