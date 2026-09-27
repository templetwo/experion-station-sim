#!/usr/bin/env node
// @artifact dev
'use strict';

// One-way, offline capture for G2. This supplies the existing native flow and
// thermal history to a separate reference model; it adds no composition state,
// plant boundary, analyzer, product qualification or runtime dependency.
// See docs/dev/G2-STAGE-ONE-CONTRACT.md. The native equations/sources are unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('../logic-harness.js');

const ROOT = path.resolve(__dirname, '../..');
const BASE_REVISION = 'bfed001fc89d9beaa640b30a7886d5f16f61a31b';
// Verified from that commit's bytes. Keep source checking usable in shallow
// clones and exported trees: capture must not need historical Git objects.
const BASE_MODEL_ID = '670f49e40c2b3395735e85b3bd09205f77f4a0598c955959f061f1d18810c832';
const BASE_STAMP_SHA256 = '5a1d16ec067c22dae4a4fd0f90e3e76ad95a49963e5309129f230297d79b969d';
const BASE_HARNESS_SHA256 = 'ccd88cd6b8f6fe05c0752b0f0d3152d10fad27c0d72f28cae8e149f6a5627917';
const APP = 'Experion Station Simulator.dc.html';
const STEP_S = 0.5;
const HEAT_LOSS_S = 600;
const RECOVERY_S = 1800;
const END_S = 3000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function provenance(root = ROOT) {
  // Same ordered bytes/path hash as tools/stamp-model-id.py. Checking the
  // recorded stamp alone would accept a local model edit with a stale stamp.
  const modules = fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== 'model-id.js').sort();
  const h = crypto.createHash('sha256');
  for (const file of [APP, ...modules.map(name => 'src/' + name)]) {
    h.update(file); h.update('\0');
    h.update(fs.readFileSync(path.join(root, file))); h.update('\0');
  }
  const modelId = h.digest('hex');
  const stamp = fs.readFileSync(path.join(root, 'src/model-id.js'));
  if (modelId !== BASE_MODEL_ID || hash(stamp) !== BASE_STAMP_SHA256) {
    throw new Error('Native runtime code does not match the declared bfed001 model; recapture needs an explicit new source pin.');
  }
  const harness = fs.readFileSync(path.join(root, 'tools/logic-harness.js'));
  if (hash(harness) !== BASE_HARNESS_SHA256) {
    throw new Error('Native harness differs from the declared source revision.');
  }
  return {
    revision: BASE_REVISION,
    revision_scope: 'application page, src/*.js and tools/logic-harness.js; other dev/documentation files may differ',
    model_id: modelId,
    model_stamp_sha256: hash(stamp),
    step_s: STEP_S,
    node_version: process.version,
    harness_sha256: hash(harness),
    capture_script_sha256: hash(fs.readFileSync(__filename)),
    sample_timing: 'state at time_s after any listed commands and before the next 0.5 s step'
  };
}

function sample(component, time_s) {
  const value = {
    time_s,
    flow_m3h: component.P.h.f,
    heater_temperature_c: component.P.h.pre,
    bed_temperature_c: component.P.h.bed,
    activity: component.P.env.catAct
  };
  for (const [name, number] of Object.entries(value)) {
    if (!Number.isFinite(number)) throw new Error('Non-finite native input: ' + name);
  }
  if (component.P.t !== time_s * 1000) throw new Error('Native simulation clock drifted from fixed-step capture.');
  return value;
}

function captureNative() {
  const source = provenance();
  const { Component } = load();
  const c = new Component({});
  // Explicit simulation origin avoids Component.initSim()'s wall-clock default.
  // Do not mount the browser component: mounting would start real timers/coach IO.
  c.initSim(0);
  source.seed = c.seed;
  if (globalThis.ESS.MODEL_ID !== source.model_id) throw new Error('Loaded model stamp does not match checked source.');
  const events = [];
  const samples = [];
  const originalSP = c.L.TIC311.sp;
  for (let tick = 0; tick <= END_S / STEP_S; tick++) {
    const time_s = tick * STEP_S;
    if (time_s === HEAT_LOSS_S) {
      // Actual operator entry points; valve stroke and thermal response remain
      // native. An OP=0 command is not an instantaneous measured fuel-flow zero.
      c.setMode('TIC311', 'MAN');
      if (c.L.TIC311.mode !== 'MAN') throw new Error('Native MAN command was refused.');
      events.push({ time_s, action: 'setMode', tag: 'TIC311', mode: 'MAN' });
      const accepted = c.storeEntry('TIC311', 'OP', 0);
      if (!accepted || c.L.TIC311.op !== 0) throw new Error('Native fuel-output command was refused.');
      events.push({ time_s, action: 'storeEntry', tag: 'TIC311', parameter: 'OP', value: 0, unit: '%' });
    }
    if (time_s === RECOVERY_S) {
      if (c.L.TIC311.sp !== originalSP) throw new Error('Native heater setpoint changed during capture.');
      c.setMode('TIC311', 'AUTO');
      if (c.L.TIC311.mode !== 'AUTO') throw new Error('Native AUTO recovery command was refused.');
      events.push({ time_s, action: 'setMode', tag: 'TIC311', mode: 'AUTO', retained_sp_c: originalSP });
    }
    samples.push(sample(c, time_s));
    if (time_s < END_S) c.step(STEP_S);
  }
  return { schema: 'g2-native-input-v1', source, events, samples };
}

function main(args) {
  if (args.length && !(args.length === 2 && args[0] === '--out' && args[1])) {
    throw new Error('Usage: node tools/g2/capture-native.cjs [--out FILE]');
  }
  const json = JSON.stringify(captureNative(), null, 2) + '\n';
  if (args.length) fs.writeFileSync(args[1], json);
  else process.stdout.write(json);
}

module.exports = { captureNative, provenance, BASE_REVISION };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
