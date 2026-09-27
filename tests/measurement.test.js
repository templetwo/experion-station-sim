// @artifact dev
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Measurement = require('../src/measurement');

test('TIC202 keeps both nominal endpoints Good and reports excursions through the declared current range', () => {
  for (const pv of [0, 42.5, 100]) {
    assert.deepEqual(Measurement.observe({tag: 'TIC202', pv}), {
      pv, badPv: false, quality: 'GOOD', statusCode: 0, statusName: 'Good', limit: 'NONE'
    });
  }
  for (const [input, pv, limit, code] of [
    [-Number.MAX_VALUE, -1.25, 'LOW', 0x40940500],
    [-1.25, -1.25, 'LOW', 0x40940500],
    [-0.001, -0.001, 'LOW', 0x40940500],
    [100.001, 100.001, 'HIGH', 0x40940600],
    [103.125, 103.125, 'HIGH', 0x40940600],
    [170.6, 103.125, 'HIGH', 0x40940600],
    [Number.MAX_VALUE, 103.125, 'HIGH', 0x40940600]
  ]) {
    assert.deepEqual(Measurement.observe({tag: 'TIC202', pv: input}), {
      pv, badPv: false, quality: 'UNCERTAIN', statusCode: code,
      statusName: 'Uncertain_EngineeringUnitsExceeded', limit
    });
    assert.equal(code >>> 30, 1, 'uncertain severity');
    assert.equal((code >>> 10) & 3, 1, 'DataValue InfoType makes LimitBits meaningful');
  }
});

test('the current range is declared locally and agrees with the reporting endpoints', () => {
  const c = Measurement.TIC202;
  const ma = pv => c.nominalLowMa + (pv - c.lower) / (c.upper - c.lower) * (c.nominalHighMa - c.nominalLowMa);
  assert.equal(ma(c.reportingLower), c.reportingLowMa);
  assert.equal(ma(c.reportingUpper), c.reportingHighMa);
  assert.ok(Object.isFrozen(c));
});

test('an explicit bad PV dominates range reporting without publishing the raw value', () => {
  for (const pv of [-10, 50, 170.6, null]) {
    assert.deepEqual(Measurement.observe({tag: 'TIC202', pv, badPv: true, quality: 'GOOD'}), {
      pv: null, badPv: true, quality: 'BAD', statusCode: 0x808C0000,
      statusName: 'Bad_SensorFailure', limit: 'NONE'
    });
  }
});

test('missing, nonnumeric and nonfinite values are Null and Bad without inventing a sensor diagnosis', () => {
  for (const pv of [null, undefined, NaN, Infinity, -Infinity, '22', false]) {
    const o = Measurement.observe({tag: 'TIC202', pv});
    assert.equal(o.pv, null);
    assert.equal(o.quality, 'BAD');
    assert.equal(o.statusName, 'Bad');
    assert.equal(o.statusCode, 0x80000000);
  }
  assert.equal(Measurement.observe(null).pv, null);
});

test('declared non-good source qualities cannot become Good, and stale alone does not invent a failure', () => {
  for (const quality of ['BAD', 'ERROR', 'bad']) {
    const o = Measurement.observe({tag: 'TIC202', pv: 170.6, quality});
    assert.equal(o.quality, 'BAD');
    assert.equal(o.pv, null);
  }
  for (const quality of ['STALE', 'UNCERTAIN', 'UNKNOWN', 'not-a-quality']) {
    const o = Measurement.observe({tag: 'AI509', pv: 0.4, quality});
    assert.equal(o.quality, 'UNCERTAIN');
    assert.equal(o.badPv, false);
    assert.equal(o.statusName, 'Uncertain');
    assert.equal(o.pv, 0.4);
  }
});

test('numeric source status takes precedence and retains its reason and flags', () => {
  const bad = Measurement.observe({tag: 'TIC202', pv: 170.6, quality: 'GOOD', statusCode: 0x808C0000});
  assert.equal(bad.statusCode, 0x808C0000);
  assert.equal(bad.quality, 'BAD');
  assert.equal(bad.pv, null);
  const stale = Measurement.observe({tag: 'TIC202', pv: 170.6, quality: 'GOOD', statusCode: 0x408F0000});
  assert.equal(stale.statusCode, 0x408F0600);
  assert.equal(stale.statusName, 'Uncertain_NoCommunicationLastUsable');
  assert.equal(stale.quality, 'UNCERTAIN');
  assert.equal(stale.limit, 'HIGH');
  assert.equal(stale.pv, 103.125);
  const source = {tag: 'OTHER', pv: 7, quality: 'GOOD', statusCode: 0x40930400, statusName: 'Uncertain_SensorNotAccurate'};
  assert.equal(Measurement.observe(source).statusCode, source.statusCode);
  assert.equal(Measurement.observe(source).statusName, source.statusName);
  for (const statusCode of [-1, NaN, Infinity, 0x100000000, 0.5, '0x80000000']) {
    assert.equal(Measurement.observe({tag: 'OTHER', pv: 7, quality: 'BAD', statusCode}).quality, 'BAD');
  }
});

test('other tags have no invented transmitter span', () => {
  const o = Measurement.observe({tag: 'TI312', pv: 480.5, lo: 0, hi: 100});
  assert.equal(o.pv, 480.5);
  assert.equal(o.quality, 'GOOD');
});

test('observation is repeatable, does not mutate point/controller state and returns only its allowlist', () => {
  const point = Object.freeze({tag: 'TIC202', pv: 170.6, sp: 35, op: 100, quality: 'GOOD',
    hiddenFault: {cause: 'do not export'}, trueTemperature: 170.6});
  const expected = Measurement.observe(point);
  for (let i = 0; i < 20; i++) assert.deepEqual(Measurement.observe(point), expected);
  assert.equal(point.pv, 170.6);
  assert.equal(point.sp, 35);
  assert.equal(point.op, 100);
  assert.deepEqual(Object.keys(expected).sort(), ['pv', 'badPv', 'quality', 'statusCode', 'statusName', 'limit'].sort());
  assert.ok(!JSON.stringify(expected).includes('170.6'));
  expected.pv = 0;
  assert.equal(Measurement.observe(point).pv, 103.125);
});

test('browser UMD build exposes the same pure observer', () => {
  const c = vm.createContext({ESS: {}});
  vm.runInContext(fs.readFileSync(require.resolve('../src/measurement'), 'utf8'), c);
  assert.equal(c.ESS.Measurement.observe({tag: 'TIC202', pv: 170.6}).pv, 103.125);
});

// Part 4 reserves InfoType 1X: consumers must ignore those info bits.
test('reserved information types do not expose an apparent limit', () => {
  for (const statusCode of [0x40000A00,0x40000E00]) {
    const result=Measurement.observe({tag:'OTHER',pv:7,statusCode});
    assert.equal(result.limit,'NONE');
    assert.equal(result.quality,'UNCERTAIN');
  }
});
