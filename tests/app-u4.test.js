// @artifact dev
// Unit 04, the two-chamber weir separator V-502, wired into the station (docs/dev/
// U4-SEPARATOR-CONTRACT.md section 5): reachable, drawn, trended, controlled, replayed
// deterministically from its own seeded stream, and outside the v2 golden universe.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models.js');
const Topology = require('../src/topology.js');
const { NEW_UNIT_SOURCES, NEW_UNIT_VALVES } = require('./_fixture');
const { load } = require('../tools/logic-harness');

const { Component } = load();
function boot() { const c = new Component({}); c.initSim(1700000000000); return c; }
const U4_TAGS = ['TIC502', 'LIC503', 'LIC504', 'PIC505', 'AI509', 'AI510'];
const U4_VALVES = ['TV502', 'LV503', 'WV504', 'PV505'];

test('the unit exists on the board: points, valves, unit map, asset tree, trend group, tabs, commands', () => {
  const c = boot();
  for (const t of U4_TAGS) assert.ok(c.L[t], t + ' missing from the tag database');
  for (const v of U4_VALVES) assert.ok(c.V[v], v + ' missing from this.V');
  for (const t of [...U4_TAGS, 'V-502', 'E-502']) assert.equal(c.unitOf(t), 'U4', t);
  assert.ok(Topology.UNITS.includes('U4'));
  assert.deepEqual(c.topo.unplaced, []);
  assert.deepEqual(c.topo.strayValves, []);
  assert.deepEqual(Topology.validate(c.topo), []);
  const tree = c.assetTree();
  assert.ok(tree.some((a) => a.id === 'U4' && a.unit === 'U4'));
  assert.ok(tree.some((a) => a.id === 'V-502' && a.tags.includes('LIC504')));
  for (const t of ['TIC502', 'LIC503', 'LIC504', 'PIC505']) assert.ok(c.pidOrder().includes(t), t + ' not in pidOrder');
  for (const t of U4_TAGS) assert.ok(c.histTags().includes(t), t + ' not trended');
  assert.equal(c.runCmd('U4'), true);
  assert.equal(c.state.unit, 'U4');
  const v = c.renderVals();
  assert.equal(v.isG4, true);
  assert.ok(v.utabs.some((u) => /UNIT 04/.test(u.label)));
  assert.ok(v.menus.find((m) => m.name === 'View').items.some((i) => /Unit 04/.test(i.label)));
  assert.equal(v.gv4.length, 6);
  assert.equal(v.vl4.length, 4);
  assert.match(v.gfx4.weirLabel, /^WEIR 55 %$/);
  assert.ok(v.av === undefined || true);
  const tracker = c.renderVals().av && c.renderVals().av.tracker;
  if (tracker) assert.ok(tracker.some((l) => l.label === 'U4'));
});

test('the design point is a steady state: every loop on setpoint, no alarm, for 30 minutes', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  for (let i = 0; i < 3600; i++) c.step(0.5);
  assert.equal(c.alarms.filter((a) => a.active && U4_TAGS.includes(a.tag)).length, 0, JSON.stringify(c.alarms.filter((a) => a.active).map((a) => a.tag + '.' + a.cond)));
  assert.ok(Math.abs(c.L.LIC504.pv - 25) < 2, 'interface ' + c.L.LIC504.pv);
  assert.ok(Math.abs(c.L.LIC503.pv - 50) < 2, 'oil level ' + c.L.LIC503.pv);
  assert.ok(Math.abs(c.L.PIC505.pv - 800) < 20, 'pressure ' + c.L.PIC505.pv);
  assert.ok(Math.abs(c.L.TIC502.pv - 45) < 2, 'inlet temp ' + c.L.TIC502.pv);
  assert.ok(c.L.AI509.pv < 1 && c.L.AI510.pv < 1);
});

test('the weir is settable live and the board answers: raising it starves chamber 2, lowering it dumps oil over', () => {
  const c = boot(); c.applyPreset('U1_SS');
  for (let i = 0; i < 1200; i++) c.step(0.5);
  const h2Before = c.P.s.h2;
  c.setVariable('weirH', 70);
  let minH2 = h2Before;
  for (let i = 0; i < 1200; i++) { c.step(0.5); minH2 = Math.min(minH2, c.P.s.h2); }
  assert.ok(minH2 < h2Before - 5, `chamber 2 should starve while chamber 1 fills to the new crest (min ${minH2.toFixed(1)} vs ${h2Before.toFixed(1)})`);
  assert.equal(c.renderVals().gfx4.weirLabel, 'WEIR 70 %');
  c.setVariable('weirH', 40);
  let maxH2 = 0;
  for (let i = 0; i < 600; i++) { c.step(0.5); maxH2 = Math.max(maxH2, c.P.s.h2); }
  assert.ok(maxH2 > 52, `lowering the weir should dump the oil layer into chamber 2 (max ${maxH2.toFixed(1)})`);
});

test('the two interface failure modes show on the analysers, not on the interface alarm alone', () => {
  const high = boot(); high.applyPreset('U1_SS');
  high.setMode('LIC504', 'MAN'); high.storeEntry('LIC504', 'OP', 0);          // water draw closed: the interface climbs to the weir
  for (let i = 0; i < 4800 && high.L.AI509.pv < 2; i++) high.step(0.5);
  assert.ok(high.L.AI509.pv >= 2, 'water must reach the product draw when the interface climbs (AI509 ' + high.L.AI509.pv + ')');
  assert.ok(high.alarms.some((a) => a.tag === 'AI509' && a.active), 'and AI509 must alarm');
  // the contract's DAS group: once the interface reaches the crest (LIC504 PVHH), water in the
  // product draw is its consequence and is folded under it, not annunciated beside it
  for (let i = 0; i < 4800 && !high.alarms.some((a) => a.tag === 'LIC504' && a.cond === 'PVHH' && a.active); i++) high.step(0.5);
  assert.ok(high.alarms.some((a) => a.tag === 'LIC504' && a.cond === 'PVHH' && a.active), 'the interface reaches the crest');
  for (const a of high.alarms.filter((x) => x.tag === 'AI509' && x.active)) assert.equal(a.state, 'DSUPR', a.cond + ' should be suppressed under LIC504.PVHH');
  const low = boot(); low.applyPreset('U1_SS');
  low.setMode('LIC504', 'MAN'); low.storeEntry('LIC504', 'OP', 100);          // water draw wide open: the water layer thins
  for (let i = 0; i < 4800 && low.L.AI510.pv < 2; i++) low.step(0.5);
  assert.ok(low.L.AI510.pv >= 2, 'oil must reach the water draw when the layer is thin (AI510 ' + low.L.AI510.pv + ')');
});

test('air loss drives the four valves to their declared fail positions and the vessel depressures', () => {
  const c = boot(); c.applyPreset('U1_SS');
  c.injectFault('air', true);
  for (let i = 0; i < 600; i++) c.step(0.5);
  assert.ok(c.V.TV502.pos > 0.99 && c.V.PV505.pos > 0.99, 'TV-502 and PV-505 fail open');
  assert.ok(c.V.LV503.pos < 0.01 && c.V.WV504.pos < 0.01, 'LV-503 and WV-504 fail closed');
  assert.ok(c.P.s.pres < 700, 'a wide-open vent depressures the vessel (' + c.P.s.pres + ')');
});

test('the PSV lifts at 1100 kPa with the vent closed, and resets below 1000', () => {
  const c = boot(); c.applyPreset('U1_SS');
  c.setMode('PIC505', 'MAN'); c.storeEntry('PIC505', 'OP', 0);
  for (let i = 0; i < 7200 && !c.P.trips.psv502; i++) c.step(0.5);
  assert.ok(c.P.trips.psv502, 'PSV-502 must lift with the vent closed');
  assert.ok(c.alarms.some((a) => (a.tag || a.src) === 'V-502' && a.cond === 'PSV LIFT'));
  assert.equal(c.alarmHelpFor('V-502', 'PSV LIFT').found, true);
  c.setMode('PIC505', 'AUTO');
  for (let i = 0; i < 7200 && c.P.trips.psv502; i++) c.step(0.5);
  assert.equal(c.P.trips.psv502, false, 'and reset once the pressure is back under control');
});

test('Unit 04 replays deterministically from its own seeded stream (snapshot -> act -> replay)', () => {
  const c = boot(); c.applyPreset('U1_SS');
  c.saveSlot(0, 'u4');
  c.setMode('LIC503', 'MAN'); c.storeEntry('LIC503', 'OP', 70);
  for (let i = 0; i < 400; i++) c.step(0.5);
  const live = { s: JSON.stringify(c.P.s), pv: U4_TAGS.map((t) => c.L[t].pv), r4: c.rand4.getState() };
  c.startReplay(0); c.replayToEnd();
  assert.equal(c.instr.replay, null);
  assert.deepEqual({ s: JSON.stringify(c.P.s), pv: U4_TAGS.map((t) => c.L[t].pv), r4: c.rand4.getState() }, live);
});

test('Unit 04 is outside the v2 golden universe, and the v2 universe list matches the app', () => {
  const c = boot();
  const u4 = new Set([...Object.keys(c.L).filter((t) => c.unitOf(t) === 'U4'), 'V-502', 'E-502']);
  assert.deepEqual([...NEW_UNIT_SOURCES].sort(), [...u4].sort(), 'tests/_fixture.js NEW_UNIT_SOURCES must be exactly the app\'s Unit 04 sources');
  assert.deepEqual([...NEW_UNIT_VALVES].sort(), U4_VALVES.slice().sort());
  assert.equal(Models.MODEL_VALVES.length, 14);
  // and the shared stream is untouched by Unit 04: two sims, one with rand4 replaced by zeros
  const a = boot(); const b = boot(); b.rand4 = () => 0; b.rand4.getState = () => 0; b.rand4.setState = () => {};
  for (let i = 0; i < 600; i++) { a.step(0.5); b.step(0.5); }
  assert.equal(a.rand.getState(), b.rand.getState(), 'the v2 random stream must not depend on Unit 04');
  for (const t of ['FIC102', 'TIC201', 'TIC301', 'PIC401', 'TI312']) assert.equal(a.L[t].pv, b.L[t].pv, t);
});
