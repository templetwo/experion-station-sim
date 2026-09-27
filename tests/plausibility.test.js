// @artifact dev
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models');
const Plausibility = require('../src/plausibility');

const copy = x => JSON.parse(JSON.stringify(x));
function freeze(x) { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
function fixture(options) {
  const P = Models.createState(0);
  const V = { WV504: { pos: .45 }, LV503: { pos: .5 } };
  return { P, V, observer: Plausibility.create(P, options) };
}
function tick(f, change, sample) {
  const before = Plausibility.snapshot(f.P, f.V);
  f.P.t += 500;
  if (change) change(f.P, f.V);
  const after = Plausibility.snapshot(f.P, f.V);
  Plausibility.advance(f.observer, before, after, .5, sample);
  return f.observer;
}
const codes = o => o.active.map(f => f.code);

test('saturation lookup uses the registered NIST rows, bounded interpolation, and absolute pressure', () => {
  assert.ok(Math.abs(Plausibility.saturationTemperature(.101325) - 99.9743) < 1e-10);
  assert.ok(Math.abs(Plausibility.saturationTemperature(.7) - 164.9462) < 1e-10);
  assert.ok(Math.abs(Plausibility.saturationTemperature(.75) - 167.67635) < 1e-10);
  assert.equal(Plausibility.saturationTemperature(.099), null);
  assert.equal(Plausibility.saturationTemperature(1.01), null);
});

test('coolant assertion responds to temperature and declared pressure, not the fault label', () => {
  const f = fixture({ coolant_pressure_mpa_abs: .7 });
  tick(f, P => { P.Tj = 170; });
  assert.ok(codes(f.observer).includes('COOLANT_ABOVE_SATURATION'));
  assert.equal(f.P.faults.cool, undefined);
  const warning = f.observer.active.find(x => x.code === 'COOLANT_ABOVE_SATURATION');
  assert.equal(warning.assumed_pressure_mpa_abs, .7);
  tick(f, P => { P.Tj = 160; });
  assert.ok(!codes(f.observer).includes('COOLANT_ABOVE_SATURATION'));
  assert.equal(f.observer.findings.filter(x => x.code === 'COOLANT_ABOVE_SATURATION').length, 1);
  const pressurised = fixture({ coolant_pressure_mpa_abs: .8 });
  tick(pressurised, P => { P.Tj = 170; });
  assert.ok(!codes(pressurised.observer).includes('COOLANT_ABOVE_SATURATION'));
});

test('an assumed pressure outside the held table is reported, never extrapolated', () => {
  const f = fixture({ coolant_pressure_mpa_abs: .05 });
  tick(f, P => { P.Tj = 120; });
  assert.ok(codes(f.observer).includes('SATURATION_LOOKUP_OUT_OF_ENVELOPE'));
  assert.ok(codes(f.observer).includes('MODEL_OUT_OF_ENVELOPE'));
  assert.ok(!codes(f.observer).includes('COOLANT_ABOVE_SATURATION'));
});

test('declared model envelopes observe excursions, missing inputs and recovery without constraining the process', () => {
  const options = { model_envelopes: [{ field: 'P.h.f', min: 30, max: 50, correlation: 'U4 inlet mission assumption' }] };
  const f = fixture(options);
  options.model_envelopes[0].max = 100; // caller changes cannot rewrite a checkpoint's declaration
  tick(f, P => { P.h.f = 50; });
  assert.ok(!codes(f.observer).includes('MODEL_OUT_OF_ENVELOPE'));
  tick(f, P => { P.h.f = 55; });
  const finding = f.observer.active.find(x => x.code === 'MODEL_OUT_OF_ENVELOPE');
  assert.equal(finding.value, 55);
  assert.equal(finding.max, 50);
  assert.equal(f.P.h.f, 55);
  assert.match(finding.basis, /not a measured calibration range/);
  const resumed = copy(f.observer);
  const before = Plausibility.snapshot(f.P, f.V);
  f.P.h.f = NaN; f.P.t += 500;
  const after = Plausibility.snapshot(f.P, f.V);
  Plausibility.advance(f.observer, before, after, .5);
  Plausibility.advance(resumed, before, after, .5);
  assert.deepEqual(resumed, f.observer);
  assert.equal(f.observer.active.find(x => x.code === 'MODEL_OUT_OF_ENVELOPE').value, null);
  tick(f, P => { P.h.f = 40; });
  assert.ok(!codes(f.observer).includes('MODEL_OUT_OF_ENVELOPE'));
  assert.equal(f.observer.findings.filter(x => x.code === 'MODEL_OUT_OF_ENVELOPE').length, 1);
});

test('a large weir step reports its mathematical envelope when a live weir drop over-drains the legacy model', () => {
  const f = fixture();
  f.P.env.weirH = 0;
  const before = Plausibility.snapshot(f.P, f.V);
  let product;
  f.P.t += 1000;
  Models.stepU4(f.P, {}, f.V, 1, { productSample: x => { product = x; }, raise() {}, clear() {} });
  const after = Plausibility.snapshot(f.P, f.V);
  const native = copy(f.P);
  Plausibility.advance(f.observer, before, after, 1, Plausibility.u4FlowSample(before, after, product));
  const finding = f.observer.active.find(x => x.code === 'MODEL_OUT_OF_ENVELOPE');
  assert.equal(finding.field, 'U4.weir.dt_s');
  assert.ok(finding.max < 1);
  assert.equal(f.P.s.ho, 0);
  assert.ok(codes(f.observer).includes('U4_LIQUID_CLOSURE_EXCEEDED'));
  assert.deepEqual(f.P, native);
});

test('mission envelope declarations reject unknown paths, duplicate limits and invalid bounds', () => {
  for (const envelopes of [
    Array(1),
    [{field: 'P.secret', min: 0, max: 1, correlation: 'test'}],
    [{field: 'P.h.f', min: 50, max: 30, correlation: 'test'}],
    [{field: 'P.h.f', min: 0, max: Infinity, correlation: 'test'}],
    [{field: 'P.h.f', min: 0, max: 1, correlation: 'a'}, {field: 'P.h.f', min: 0, max: 2, correlation: 'b'}]
  ]) assert.throws(() => fixture({model_envelopes: envelopes}), /invalid_plausibility_option:model_envelopes/);
});

test('level bounds report unknown missing volume, coalesce ongoing excursions, and recover', () => {
  const f = fixture();
  tick(f, P => { P.s.h2 = 100; P.tankL = 0; });
  const bounds = f.observer.active.filter(x => x.code === 'LEVEL_AT_BOUND');
  assert.deepEqual(bounds.map(x => x.field).sort(), ['P.s.h2', 'P.tankL']);
  assert.ok(bounds.every(x => x.missing_volume_m3 === null));
  for (let i = 0; i < 50; i++) tick(f);
  assert.equal(f.observer.findings.filter(x => x.code === 'LEVEL_AT_BOUND').length, 2);
  tick(f, P => { P.s.h2 = 50; P.tankL = 50; });
  assert.ok(!codes(f.observer).includes('LEVEL_AT_BOUND'));
});

test('trip clearing audits all shutdown latches but excludes relief reseating', () => {
  const f = fixture();
  for (const trip of ['ovf', 'rx', 'batch', 'bed', 'skin', 'psv', 'psv502']) f.P.trips[trip] = true;
  tick(f, P => { for (const k of Object.keys(P.trips)) P.trips[k] = false; });
  const clear = f.observer.active.filter(x => x.code === 'TRIP_AUTO_CLEARED');
  assert.deepEqual(clear.map(x => x.field).sort(), ['P.trips.batch', 'P.trips.bed', 'P.trips.ovf', 'P.trips.rx', 'P.trips.skin']);
  tick(f);
  assert.ok(!codes(f.observer).includes('TRIP_AUTO_CLEARED'));
  assert.equal(f.observer.findings.filter(x => x.code === 'TRIP_AUTO_CLEARED').length, 5);
});

test('finite feed budget is optional, accumulates the consumed U3 boundary flow, and is not a tank', () => {
  const unlimited = fixture();
  tick(unlimited, P => { P.h.f = 36; });
  assert.ok(!codes(unlimited.observer).includes('FEED_INVENTORY_UNACCOUNTED'));
  const finite = fixture({ feed_inventory_m3: .0075 });
  tick(finite, P => { P.h.f = 36; });
  assert.equal(finite.observer.feed_volume_m3, .005);
  assert.ok(!codes(finite.observer).includes('FEED_INVENTORY_UNACCOUNTED'));
  tick(finite);
  assert.equal(finite.observer.feed_volume_m3, .01);
  assert.ok(codes(finite.observer).includes('FEED_INVENTORY_UNACCOUNTED'));
  assert.equal(finite.P.h.f, 36);
});

test('U4 liquid accounting uses the exact model interval, including oil underflow', () => {
  const f = fixture();
  f.P.s.hw = 3; // thin interface, so oil leaves through the water draw as well
  f.observer = Plausibility.create(f.P);
  const before = Plausibility.snapshot(f.P, f.V);
  let product;
  f.P.t += 500;
  Models.stepU4(f.P, {}, f.V, .5, { productSample: x => { product = x; }, raise() {}, clear() {} });
  const after = Plausibility.snapshot(f.P, f.V);
  const flow = Plausibility.u4FlowSample(before, after, product);
  assert.ok(flow.oil_underflow_rate_m3h > 0);
  assert.equal(flow.product_draw_rate_m3h, product.draw_rate_m3h);
  Plausibility.advance(f.observer, before, after, .5, flow);
  assert.equal(f.observer.u4_liquid.status, 'within_tolerance');
  assert.ok(Math.abs(f.observer.u4_liquid.residual_m3) < 1e-12);
  assert.equal(f.observer.u4_liquid.scope, 'U4 liquid volume only');
});

test('blocked product draw reveals volume discarded at the chamber clamp', () => {
  const f = fixture();
  f.P.s.h2 = 100;
  f.P.s.hw = 25;
  f.P.s.ho = 35;
  f.V.LV503.pos = 0;
  f.observer = Plausibility.create(f.P);
  const before = Plausibility.snapshot(f.P, f.V);
  let product;
  f.P.t += 500;
  Models.stepU4(f.P, {}, f.V, .5, { productSample: x => { product = x; }, raise() {}, clear() {} });
  const after = Plausibility.snapshot(f.P, f.V);
  Plausibility.advance(f.observer, before, after, .5, Plausibility.u4FlowSample(before, after, product));
  assert.ok(codes(f.observer).includes('LEVEL_AT_BOUND'));
  assert.ok(codes(f.observer).includes('U4_LIQUID_CLOSURE_EXCEEDED'));
  assert.ok(f.observer.u4_liquid.residual_m3 > .01);
  assert.equal(f.P.s.h2, 100);
});

test('a missing or mismatched flow sample makes coverage incomplete instead of claiming closure', () => {
  const f = fixture();
  tick(f);
  assert.equal(f.observer.u4_liquid.status, 'incomplete');
  assert.equal(f.observer.u4_liquid.residual_m3, null);
  assert.equal(Plausibility.u4FlowSample(Plausibility.snapshot(f.P, f.V), Plausibility.snapshot(f.P, f.V), null), null);
  tick(f, null, { dt_s: 1, feed_rate_m3h: 0, water_draw_rate_m3h: 0, oil_underflow_rate_m3h: 0, product_draw_rate_m3h: 0 });
  assert.equal(f.observer.u4_liquid.covered_ms, 0);
});

test('unobserved inventory edits prevent a claim of complete liquid closure', () => {
  const f = fixture();
  f.P.s.h2 += 5;
  const before = Plausibility.snapshot(f.P, f.V);
  let product;
  f.P.t += 500;
  Models.stepU4(f.P, {}, f.V, .5, { productSample: x => { product = x; }, raise() {}, clear() {} });
  const after = Plausibility.snapshot(f.P, f.V);
  Plausibility.advance(f.observer, before, after, .5, Plausibility.u4FlowSample(before, after, product));
  assert.ok(codes(f.observer).includes('U4_INVENTORY_DISCONTINUITY'));
  assert.equal(f.observer.u4_liquid.status, 'incomplete');
  assert.equal(f.observer.u4_liquid.residual_m3, null);
});

test('observer accepts frozen inputs, projection is detached, and JSON checkpoint resumes identically', () => {
  const f = fixture();
  const before = freeze(Plausibility.snapshot(f.P, f.V));
  f.P.t += 500; f.P.Tj = 170;
  const after = freeze(Plausibility.snapshot(f.P, f.V));
  Plausibility.advance(f.observer, before, after, .5);
  const restored = copy(f.observer);
  const view = Plausibility.project(f.observer);
  view.findings[0].detail = 'changed';
  assert.notEqual(f.observer.findings[0].detail, 'changed');
  const next = copy(after); next.t += 500;
  Plausibility.advance(f.observer, after, freeze(next), .5);
  Plausibility.advance(restored, after, next, .5);
  assert.deepEqual(restored, f.observer);
});
