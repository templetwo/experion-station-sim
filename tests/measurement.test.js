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
  // Beyond nominal but inside the window the transmitter still reports the value: Good with the
  // DataValue limit bit, so a tiny overshoot never reads as uncertain (ruling R8, spec §2.2).
  for (const [input, limit, code] of [
    [-0.001, 'LOW', 0x00000500],
    [-1.2499, 'LOW', 0x00000500],
    [100.001, 'HIGH', 0x00000600],
    [103.1249, 'HIGH', 0x00000600]
  ]) {
    assert.deepEqual(Measurement.observe({tag: 'TIC202', pv: input}), {
      pv: input, badPv: false, quality: 'GOOD', statusCode: code, statusName: 'Good', limit
    });
    assert.equal(code >>> 30, 0, 'good severity');
    assert.equal((code >>> 10) & 3, 1, 'DataValue InfoType makes LimitBits meaningful');
  }
  // At or beyond a window edge the value is clamped to the edge and reads uncertain.
  for (const [input, pv, limit, code] of [
    [-Number.MAX_VALUE, -1.25, 'LOW', 0x40940500],
    [-1.25, -1.25, 'LOW', 0x40940500],
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

test('a point that declares a range but no kind is left alone', () => {
  const o = Measurement.observe({tag: 'TI312', pv: 480.5, lo: 0, hi: 100});
  assert.equal(o.pv, 480.5);
  assert.equal(o.quality, 'GOOD');
});

test('every analog point reports through the declared NE 43 window of its own range', () => {
  // kind:'ind', range 0..100: window is -1.25 .. 103.125 (spec §2.2, RESOURCES-7.35)
  const hi = Measurement.observe({tag: 'TI312', kind: 'ind', pv: 480.5, lo: 0, hi: 100});
  assert.deepEqual(hi, {pv: 103.125, badPv: false, quality: 'UNCERTAIN', statusCode: 0x40940600,
    statusName: 'Uncertain_EngineeringUnitsExceeded', limit: 'HIGH'});
  const lo = Measurement.observe({tag: 'TI312', kind: 'ind', pv: -40, lo: 0, hi: 100});
  assert.equal(lo.pv, -1.25); assert.equal(lo.limit, 'LOW'); assert.equal(lo.quality, 'UNCERTAIN');
  // a pid point on a 0..200 span: window -2.5 .. 206.25
  const r = Measurement.rangeOf({tag: 'TIC201', kind: 'pid', lo: 0, hi: 200});
  assert.deepEqual(r, {lower: 0, upper: 200, reportingLower: -2.5, reportingUpper: 206.25, span: 200});
  assert.equal(Measurement.observe({tag: 'TIC201', kind: 'pid', pv: 150, lo: 0, hi: 200}).quality, 'GOOD');
});

test('the generalised policy reproduces the shipped TIC202 reporting window exactly', () => {
  const r = Measurement.rangeOf({tag: 'TIC202', kind: 'pid', lo: 0, hi: 100});
  assert.equal(r.reportingLower, Measurement.TIC202.reportingLower);
  assert.equal(r.reportingUpper, Measurement.TIC202.reportingUpper);
  // the precedent object still answers for a TIC202 point that declares no range
  assert.equal(Measurement.observe({tag: 'TIC202', pv: 170.6}).pv, 103.125);
});

test('flow points read 0 below the low-flow cutoff and clamp like any analog point beyond it', () => {
  const flow = (pv) => Measurement.observe({tag: 'FIC102', kind: 'pid', eu: 'M3/H', pv, lo: 0, hi: 120});
  assert.deepEqual(flow(-0.1), {pv: 0, badPv: false, quality: 'GOOD', statusCode: 0, statusName: 'Good', limit: 'NONE'});
  assert.equal(flow(0.9).pv, 0);        // 1 % of a 120 span is 1.2
  assert.equal(flow(1.3).pv, 1.3);
  const neg = flow(-2);                 // beyond the cutoff: low reporting limit, UNCERTAIN, LOW
  assert.equal(neg.pv, -1.5); assert.equal(neg.quality, 'UNCERTAIN'); assert.equal(neg.limit, 'LOW');
  assert.equal(Measurement.observe({tag: 'TIC201', kind: 'pid', eu: 'DEG C', pv: 0.5, lo: 0, hi: 200}).pv, 0.5, 'cutoff is for flows only');
});

test('an empty or inverted declared range is left alone and never yields NaN', () => {
  for (const [lo, hi] of [[0, 0], [100, 0]]) {
    const o = Measurement.observe({tag: 'TI999', kind: 'ind', pv: 480.5, lo, hi});
    assert.equal(o.pv, 480.5); assert.equal(o.quality, 'GOOD');
    assert.equal(Measurement.rangeOf({tag: 'TI999', kind: 'ind', lo, hi}), null);
  }
});

test('motor and discrete points are not clamped', () => {
  const o = Measurement.observe({tag: 'P101', kind: 'motor', pv: 1, lo: 0, hi: 1});
  assert.equal(o.pv, 1); assert.equal(o.quality, 'GOOD');
});

test('the policy fractions agree with the NE 43 current endpoints and the policy cannot be edited', () => {
  const c = Measurement.RANGE_POLICY, loop = c.nominalHighMa - c.nominalLowMa;
  assert.equal(c.nominalLowMa + c.lowFrac * loop, c.reportingLowMa);
  assert.equal(c.nominalLowMa + (1 + c.highFrac) * loop, c.reportingHighMa);
  assert.ok(Object.isFrozen(c));
});

test('a missing, non-finite or frozen point never throws, never yields NaN and is never mutated', () => {
  for (const point of [null, undefined, {}]) assert.equal(Measurement.rangeOf(point), null);
  for (const [lo, hi] of [[NaN, 100], [0, Infinity], [-Infinity, 100], [undefined, 100], ['0', '100']]) {
    const o = Measurement.observe({tag: 'TI999', kind: 'ind', pv: 480.5, lo, hi});
    assert.equal(o.pv, 480.5); assert.equal(o.quality, 'GOOD');
    assert.equal(Measurement.rangeOf({tag: 'TI999', kind: 'ind', lo, hi}), null);
  }
  // a flow with no declared range has no span to take 1 % of, so there is no cutoff to apply
  assert.equal(Measurement.observe({tag: 'FIC999', eu: 'M3/H', pv: 0.1}).pv, 0.1);
  const point = Object.freeze({tag: 'TIC201', kind: 'pid', pv: 250, lo: 0, hi: 200});
  const first = Measurement.observe(point);
  assert.equal(first.pv, 206.25);
  assert.deepEqual(Measurement.observe(point), first);
  assert.equal(point.pv, 250);
});

test('a reading inside the NE 43 band stays Good with its limit bit, and only a saturated reading is uncertain', () => {
  // beyond the nominal range 0..100 but inside the window -1.25 .. 103.125 (ruling R8, spec §2.2)
  assert.deepEqual(Measurement.observe({tag: 'TI312', kind: 'ind', lo: 0, hi: 100, pv: 100.001}),
    {pv: 100.001, badPv: false, quality: 'GOOD', statusCode: 0x600, statusName: 'Good', limit: 'HIGH'});
  assert.deepEqual(Measurement.observe({tag: 'TI312', kind: 'ind', lo: 0, hi: 100, pv: -0.001}),
    {pv: -0.001, badPv: false, quality: 'GOOD', statusCode: 0x500, statusName: 'Good', limit: 'LOW'});
  // the overshoot that motivated R8: a 100.011 % conversion on AI205 must not read uncertain
  const ai205 = Measurement.observe({tag: 'AI205', kind: 'ind', eu: '%', lo: 0, hi: 100, pv: 100.011});
  assert.equal(ai205.quality, 'GOOD'); assert.equal(ai205.pv, 100.011); assert.equal(ai205.limit, 'HIGH');
  // the window edge itself is saturated: clamped to the edge and uncertain
  const edge = Measurement.observe({tag: 'TI312', kind: 'ind', lo: 0, hi: 100, pv: 103.125});
  assert.equal(edge.quality, 'UNCERTAIN'); assert.equal(edge.statusCode, 0x40940600);
  // a source Uncertain status keeps precedence inside the band: its own code, with the limit attached
  assert.deepEqual(Measurement.observe({tag: 'TI312', kind: 'ind', lo: 0, hi: 100, pv: 100.5, quality: 'STALE'}),
    {pv: 100.5, badPv: false, quality: 'UNCERTAIN', statusCode: 0x40000600, statusName: 'Uncertain', limit: 'HIGH'});
});

test('the TIC202 precedent answers only for a point that declares no range at all', () => {
  const precedent = Measurement.rangeOf({tag: 'TIC202'});
  assert.equal(precedent.reportingLower, Measurement.TIC202.reportingLower);
  assert.equal(precedent.reportingUpper, Measurement.TIC202.reportingUpper);
  assert.ok(Measurement.rangeOf({tag: 'TIC202', kind: 'pid'}), 'a kind alone is not a range');
  // a declared but unusable range is left alone, as for any other tag, never replaced by the precedent
  for (const [lo, hi] of [[0, 0], [100, 0], [NaN, 100], [0, undefined]]) {
    assert.equal(Measurement.rangeOf({tag: 'TIC202', kind: 'pid', lo, hi}), null);
    const o = Measurement.observe({tag: 'TIC202', kind: 'pid', lo, hi, pv: 170.6});
    assert.equal(o.pv, 170.6); assert.equal(o.quality, 'GOOD');
  }
});

test('the live TIC202 point declares the range the policy generalises, and reports as the precedent did', () => {
  const { load } = require('../tools/logic-harness');
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  const live = c.L.TIC202;
  assert.equal(live.kind, 'pid'); assert.equal(live.lo, 0); assert.equal(live.hi, 100);
  const r = Measurement.rangeOf(live);
  assert.equal(r.reportingLower, Measurement.TIC202.reportingLower);
  assert.equal(r.reportingUpper, Measurement.TIC202.reportingUpper);
  assert.equal(Measurement.observe(Object.assign({}, live, {pv: 170.6})).pv, 103.125);
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
