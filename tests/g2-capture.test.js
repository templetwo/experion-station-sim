// @artifact dev
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const archive = require('../tools/g2-history/archive.cjs').materialize();
test.after(() => archive.cleanup());
const historical = name => path.join(archive.root, name);
const { captureNative, provenance, BASE_REVISION } = require(historical('tools/g2/capture-native.cjs'));
const baselineModelId = require(historical('src/model-id.js'));

test('native heat-loss capture uses repeatable operator controls and only the declared input fields', () => {
  const originalNow = Date.now;
  let first, second;
  try {
    Date.now = () => { throw new Error('capture must not read the host clock'); };
    first = captureNative();
    second = captureNative();
  } finally { Date.now = originalNow; }
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first).sort(), ['events', 'samples', 'schema', 'source']);
  assert.equal(first.schema, 'g2-native-input-v1');
  assert.equal(first.source.revision, BASE_REVISION);
  assert.match(first.source.revision_scope, /other dev\/documentation files may differ/);
  assert.equal(first.source.model_id, baselineModelId);
  assert.equal(first.source.step_s, 0.5);
  assert.equal(first.samples.length, 6001);
  for (const [tick, row] of first.samples.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['activity', 'bed_temperature_c', 'flow_m3h', 'heater_temperature_c', 'time_s']);
    assert.equal(row.time_s, tick * 0.5);
    assert.equal(row.activity, 1);
    assert.ok(Object.values(row).every(Number.isFinite));
    assert.ok(row.flow_m3h > 39 && row.flow_m3h < 41, 'heat loss keeps the independent feed loop running');
  }
  assert.deepEqual(first.events, [
    { time_s: 600, action: 'setMode', tag: 'TIC311', mode: 'MAN' },
    { time_s: 600, action: 'storeEntry', tag: 'TIC311', parameter: 'OP', value: 0, unit: '%' },
    { time_s: 1800, action: 'setMode', tag: 'TIC311', mode: 'AUTO', retained_sp_c: 320 }
  ]);
  const at = seconds => first.samples[seconds * 2];
  assert.ok(Math.abs(at(600).bed_temperature_c - at(300).bed_temperature_c) < 2, 'baseline settles before the cut');
  assert.ok(at(1800).heater_temperature_c < at(600).heater_temperature_c - 200, 'native heater cools after fuel cut');
  assert.ok(at(1800).bed_temperature_c < at(600).bed_temperature_c - 250, 'native bed cools without a forced temperature write');
  assert.ok(at(3000).bed_temperature_c > at(1800).bed_temperature_c + 250, 'native AUTO recovery reheats the bed');
  assert.ok(at(600.5).bed_temperature_c > at(1800).bed_temperature_c + 200, 'temperature does not jump to its final cold value at the command');
});

test('capture CLI supports an output file and rejects ambiguous arguments', () => {
  const script = historical('tools/g2/capture-native.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-capture-test-'));
  try {
    const outfile = path.join(directory, 'trace.json');
    // No Git executable is available through PATH; an absolute Node executable
    // can still run the history-independent capture.
    const stdout = execFileSync(process.execPath, [script, '--out', outfile], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(stdout, '');
    const trace = JSON.parse(fs.readFileSync(outfile, 'utf8'));
    assert.equal(trace.samples.at(-1).time_s, 3000);
    assert.equal(trace.source.revision, BASE_REVISION);
    assert.throws(() => execFileSync(process.execPath, [script, '--unknown'], { stdio: 'pipe' }), /Command failed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('provenance accepts a Git-free export and rejects changed runtime, stamp and harness bytes', () => {
  const root = archive.root;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-provenance-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'src'));
    fs.mkdirSync(path.join(directory, 'tools'));
    const files = [
      'Experion Station Simulator.dc.html', 'tools/logic-harness.js',
      ...fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js')).map(name => 'src/' + name)
    ];
    for (const file of files) fs.copyFileSync(path.join(root, file), path.join(directory, file));
    assert.equal(fs.existsSync(path.join(directory, '.git')), false);
    assert.equal(provenance(directory).model_id, baselineModelId);
    for (const [file, message] of [
      ['src/models.js', /Native runtime code/],
      ['src/model-id.js', /Native runtime code/],
      ['tools/logic-harness.js', /Native harness/]
    ]) {
      const target = path.join(directory, file);
      const original = fs.readFileSync(target);
      fs.appendFileSync(target, '\n// changed source bytes\n');
      assert.throws(() => provenance(directory), message, file + ' must not retain the baseline source claim');
      fs.writeFileSync(target, original);
    }
    assert.equal(provenance(directory).revision, BASE_REVISION);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('historical source pin refuses the changed live runtime', () => {
  const live = require('../tools/g2/capture-native.cjs');
  assert.throws(() => live.provenance(), /Native runtime code/);
  assert.throws(() => live.captureNative(), /Native runtime code/);
});
