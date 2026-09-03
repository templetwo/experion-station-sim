// @artifact dev
// Unit 04 physics: the V-502 two-chamber weir separator in src/models.js
// (docs/dev/U4-SEPARATOR-CONTRACT.md section 3, sources RESOURCES 4.12).
//
// Two rigs, because "the design point is steady" and "this upset does what the contract
// says" are different questions:
//
//   plantRig()  the real thing -- the app's Component driven through its own step()
//               (U1-U3 physics, PIDs, alarm scan) with the Unit 04 points and valves of
//               the contract's section 2 table added to this.L / this.V, and Models.stepU4
//               called after each Component step. This is the only honest way to ask
//               whether the design point is a steady state, because Unit 04's inlet
//               temperature is a function of the settled H-310 / R-310 outlet.
//   u4Rig()     Unit 04 alone: createState() with P.h pinned to the plant's settled design
//               (measured once, below), no Component, no PIDs. The upset tests use it so a
//               75-minute interface excursion costs milliseconds and nothing from U1-U3 can
//               explain a result away.
//
// The Unit 04 points and valves are built here from the contract table because the page
// does not carry them yet: the integrating seat adds them (contract section 5). Until then
// stepU4 must tolerate their absence, which is its own test at the bottom of this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();

// ---------------------------------------------------------------- fixtures
// The contract's section 2 tag table, in the page's point shapes.
function pid(o) {
  return Object.assign({ kind: 'pid', mode: 'AUTO', modeAttr: 'OPERATOR', shed: 'SHEDSAFE',
    safeop: 0, opexlo: 0, opexhi: 100, dec: 1, _as: {} }, o);
}
function u4Points() {
  return {
    TIC502: pid({ tag: 'TIC502', desc: 'E-502 SEPARATOR INLET TEMP', eu: 'DEG C', lo: 0, hi: 200,
      pv: 45, sp: 45, op: 60, act: 'DIR', K: 1.2, T1: 2.0, T2: 0.2, sphilm: 90, splolm: 25,
      cm: 'CM20_TIC502', alm: { PVLO: [30, 'Low'], PVHI: [60, 'High'], PVHH: [80, 'Urgent'] } }),
    LIC503: pid({ tag: 'LIC503', desc: 'V-502 OIL CHAMBER LEVEL', eu: '%', lo: 0, hi: 100,
      pv: 50, sp: 50, op: 50, act: 'DIR', K: 1.2, T1: 2.5, sphilm: 85, splolm: 15,
      cm: 'CM21_LIC503', alm: { PVLL: [10, 'Urgent'], PVLO: [25, 'Low'], PVHI: [75, 'High'], PVHH: [90, 'Urgent'] } }),
    LIC504: pid({ tag: 'LIC504', desc: 'V-502 WATER INTERFACE LEVEL', eu: '%', lo: 0, hi: 100,
      pv: 25, sp: 25, op: 45, act: 'DIR', K: 1.5, T1: 3.0, sphilm: 45, splolm: 8,
      cm: 'CM22_LIC504', alm: { PVLL: [5, 'Urgent'], PVLO: [12, 'Low'], PVHI: [40, 'High'], PVHH: [48, 'Urgent'] } }),
    PIC505: pid({ tag: 'PIC505', desc: 'V-502 SEPARATOR PRESSURE', eu: 'KPA', lo: 0, hi: 1500,
      pv: 800, sp: 800, op: 40, act: 'DIR', K: 0.8, T1: 0.8, dec: 0, sphilm: 1000, splolm: 500,
      cm: 'CM23_PIC505', alm: { PVLL: [400, 'Urgent'], PVLO: [600, 'Low'], PVHI: [950, 'High'], PVHH: [1050, 'Urgent'] } }),
    AI509: { tag: 'AI509', kind: 'ind', desc: 'V-502 WATER IN OIL DRAW', eu: '%', lo: 0, hi: 20,
      pv: 0.3, dec: 2, tgtLo: 0, tgtHi: 1, cm: 'CM24_AI509', alm: { PVHI: [2, 'High'], PVHH: [5, 'Urgent'] }, _as: {} },
    AI510: { tag: 'AI510', kind: 'ind', desc: 'V-502 OIL IN WATER DRAW', eu: '%', lo: 0, hi: 20,
      pv: 0.2, dec: 2, tgtLo: 0, tgtHi: 1, cm: 'CM25_AI510', alm: { PVHI: [2, 'High'] }, _as: {} },
  };
}
function u4Valves() {
  return { TV502: { pos: 0.6, fail: 1 }, LV503: { pos: 0.5, fail: 0 }, WV504: { pos: 0.45, fail: 0 }, PV505: { pos: 0.4, fail: 1 } };
}

function stubCtx(extra) {
  const raised = [];
  return Object.assign({
    raised,
    raise: (...a) => raised.push(['RAISE', ...a]),
    clear: (...a) => raised.push(['CLEAR', ...a]),
    tripMotor: () => {},
    addEvent: () => {},
  }, extra || {});
}

// The whole plant, with Unit 04 bolted on the way the integration will wire it.
// The page carries Unit 04 since integration, and Component.step() runs stepU4 itself, so the
// rig drives the app alone and reads Unit 04's alarms back from the app's own alarm list.
function plantRig() {
  const c = new Component({});
  c.initSim(1700000000000);
  const tick = (sec) => { for (let i = 0; i < sec * 2; i++) c.step(0.5); };
  const raised = () => c.alarms.filter((a) => U4_SOURCES.has(a.tag || a.src)).map((a) => (a.tag || a.src) + '.' + a.cond);
  return { c, tick, raised };
}
const U4_SOURCES = new Set(['TIC502', 'LIC503', 'LIC504', 'PIC505', 'AI509', 'AI510', 'V-502', 'E-502']);
function dropU4(c) {
  for (const t of ['TIC502', 'LIC503', 'LIC504', 'PIC505', 'AI509', 'AI510']) delete c.L[t];
  for (const v of ['TV502', 'LV503', 'WV504', 'PV505']) delete c.V[v];
  return c;
}

// The plant's settled design outlet, measured once: Unit 04 reads only h.f, h.pre and h.bed.
const DESIGN_H = (() => {
  const c = new Component({});
  c.initSim(1700000000000);
  for (let i = 0; i < 3600; i++) c.step(0.5);
  return { f: c.P.h.f, pre: c.P.h.pre, bed: c.P.h.bed };
})();

// Unit 04 alone, standing at the plant's design inlet.
function u4Rig(ctxExtra) {
  const P = Models.createState(1700000000000);
  Object.assign(P.h, DESIGN_H);
  const L = u4Points(), V = u4Valves(), ctx = stubCtx(ctxExtra);
  const tick = (sec) => {
    for (let i = 0; i < sec * 2; i++) {
      Models.advanceClock(P, 0.5);
      Object.assign(P.h, DESIGN_H);          // hold the U3 outlet at design; U4 never writes it
      Models.stepU4(P, L, V, 0.5, ctx);
    }
  };
  return { P, L, V, ctx, tick, s: () => P.s };
}

const near = (got, want, pct, what) =>
  assert.ok(Math.abs(got - want) <= Math.abs(want) * pct / 100,
    `${what}: ${got} is more than ${pct} % from the design ${want}`);

// ---------------------------------------------------------------- design point
test('design point is a steady state: 30 min on the real plant moves nothing', () => {
  const { c, tick, raised } = plantRig();
  tick(1500);
  const mid = { ...c.P.s };
  tick(300);
  const s = c.P.s;

  near(s.hw, 25, 1, 'hw');
  near(s.h2, 50, 1, 'h2');
  near(s.pres, 800, 1, 'pres');
  near(s.Tin, 45, 1, 'Tin');
  near(s.qover, 34, 1, 'weir overflow = the oil the feed makes');
  assert.equal(s.wcarry, 0, 'no water over the weir at design');
  assert.equal(s.ocarry, 0, 'no oil under the interface at design');
  near(c.L.AI509.pv, 0.3, 1, 'AI509 sits on its floor');
  near(c.L.AI510.pv, 0.2, 1, 'AI510 sits on its floor');
  near(c.L.LIC504.pv, 25, 1, 'LIC504 reads the interface');
  near(c.L.PIC505.pv, 800, 1, 'PIC505 reads the pressure');

  // stationary, not merely near: nothing moved measurably over the last five minutes
  for (const k of ['hw', 'ho', 'h2', 'pres', 'Tin']) near(s[k], mid[k], 0.5, k + ' between 25 and 30 min');
  assert.deepEqual(raised(), [], 'no U4 alarm or trip at the design point');
  assert.deepEqual(c.P.trips, {}, 'no plant trip');
  for (const k of ['hw', 'ho', 'h2', 'pres', 'Tin', 'qover', 'wcarry', 'ocarry']) assert.ok(Number.isFinite(s[k]), k + ' went non-finite');
});

test('the design point is steady on the unit alone too (the upset rigs start from rest)', () => {
  const r = u4Rig();
  r.tick(1800);
  near(r.s().hw, 25, 1, 'hw');
  near(r.s().h2, 50, 1, 'h2');
  near(r.s().pres, 800, 1, 'pres');
  near(r.s().Tin, 45, 1, 'Tin');
});

// ---------------------------------------------------------------- the weir
test('weir raised 55 -> 70: chamber 1 fills to the new crest and chamber 2 starves', () => {
  const r = u4Rig();
  r.tick(1800);
  const before = r.s().h2;
  r.P.env.weirH = 70;

  r.tick(120);                                    // two minutes into the fill
  assert.equal(r.s().qover, 0, 'nothing goes over the weir while chamber 1 is below the new crest');
  assert.ok(r.s().hw + r.s().ho > 60, 'chamber 1 is filling: h1 ' + (r.s().hw + r.s().ho));
  assert.ok(r.s().h2 < before - 10, 'chamber 2 starved: h2 ' + r.s().h2);
  assert.ok(r.L.LIC503.pv < 40, 'the operator sees it on LIC503: ' + r.L.LIC503.pv);

  let worst = r.s().h2;                           // chamber 2 keeps falling until the oil comes over
  for (let i = 0; i < 20; i++) { r.tick(30); worst = Math.min(worst, r.s().h2); }
  assert.ok(r.s().qover > 30, 'overflow resumed: ' + r.s().qover);
  near(r.s().hw + r.s().ho, 70.57, 1, 'chamber 1 settles just over the new crest');
  assert.ok(worst < 30, 'chamber 2 was starved well into its Low alarm band: ' + worst);
  assert.ok(r.s().h2 > worst + 1, 'and refills once the oil comes over again: ' + r.s().h2);
  assert.equal(r.s().wcarry, 0, 'raising the weir does not by itself carry water over');
});

test('weir lowered 55 -> 40: the oil layer dumps into chamber 2 and LIC503 swings', () => {
  const r = u4Rig();
  r.tick(1800);
  const before = r.s().h2;
  r.P.env.weirH = 40;

  r.tick(30);
  assert.ok(r.s().h2 > before + 20, 'chamber 2 took the dump: h2 ' + r.s().h2 + ' from ' + before);
  assert.ok(r.s().h2 <= 100, 'level stays in range');
  near(r.s().hw + r.s().ho, 40.57, 1, 'chamber 1 sits on the new crest');
  assert.ok(r.s().ho > 0, 'the oil layer is not emptied past the weir by one explicit step');

  r.tick(1800);                                   // the product draw works it back down
  assert.ok(r.s().h2 < before + 20, 'chamber 2 comes back down: ' + r.s().h2);
});

// ---------------------------------------------------------------- the interface
test('interface driven up (WV-504 shut in MAN): water goes over the weir, AI509 exceeds 2 %', () => {
  const r = u4Rig();
  r.tick(1800);
  r.L.LIC504.mode = 'MAN'; r.L.LIC504.op = 0; r.V.WV504.pos = 0;

  r.tick(1500);                                   // 25 min: into the carry band, analyser still lagging
  assert.ok(r.s().hw > 40, 'interface climbing: ' + r.s().hw);
  assert.ok(r.L.AI509.pv < 2, 'clean product while the interface is below W - carryBand');

  r.tick(600);                                    // driven on past 50 %
  assert.ok(r.s().hw >= 48, 'interface reached the top of its band: ' + r.s().hw);
  assert.ok(r.s().wcarry > 0, 'water is going over the weir: ' + r.s().wcarry);
  assert.ok(r.L.AI509.pv > 2, 'AI509 (water in the oil draw) ' + r.L.AI509.pv);
  assert.ok(r.L.AI510.pv <= 0.2 + 1e-9, 'the water draw stays clean: AI510 ' + r.L.AI510.pv);
});

test('interface driven down (WV-504 wide open): oil goes out the water draw, AI510 exceeds 2 %', () => {
  const r = u4Rig();
  r.tick(1800);
  r.L.LIC504.mode = 'MAN'; r.L.LIC504.op = 100; r.V.WV504.pos = 1;

  r.tick(1500);
  assert.ok(r.s().hw < 12, 'interface thinning: ' + r.s().hw);
  assert.equal(r.s().ocarry, 0, 'nothing yet while the water layer is above thinBand');

  r.tick(900);
  assert.ok(r.s().hw < 8, 'water layer is thin: ' + r.s().hw);
  assert.ok(r.s().ocarry > 0, 'oil is being pulled under: ' + r.s().ocarry);
  assert.ok(r.L.AI510.pv > 2, 'AI510 (oil in the water draw) ' + r.L.AI510.pv);
  assert.ok(r.L.AI509.pv <= 0.3 + 1e-9, 'the product draw stays clean: AI509 ' + r.L.AI509.pv);
});

// ---------------------------------------------------------------- temperature and pressure
test('inlet run warm (TIC502 to 80 C in MAN): more vapour, and the pressure rises', () => {
  const r = u4Rig();
  r.tick(1800);
  const p0 = r.s().pres;
  r.L.TIC502.mode = 'MAN'; r.L.TIC502.op = 53; r.V.TV502.pos = 0.53;   // less cooling water

  r.tick(300);
  assert.ok(r.s().Tin > 75, 'inlet is hot: ' + r.s().Tin);
  assert.ok(r.s().pres > p0 + 50, 'separator pressure rose from ' + p0 + ' to ' + r.s().pres);
  assert.ok(r.L.PIC505.pv > 900, 'PIC505 shows it: ' + r.L.PIC505.pv);
});

test('PV-505 shut: PSV-502 lifts at 1100 kPa and reseats below 1000', () => {
  const r = u4Rig();
  r.tick(1800);
  r.L.PIC505.mode = 'MAN'; r.L.PIC505.op = 0; r.V.PV505.pos = 0;
  assert.ok(!r.P.trips.psv502, 'not lifted at the design point');

  let lift = null;
  for (let i = 0; i < 400 && !lift; i++) { r.tick(0.5); if (r.P.trips.psv502) lift = r.s().pres; }
  assert.ok(lift, 'PSV-502 lifted');
  assert.ok(lift >= 1100 && lift < 1110, 'lifted at the set pressure: ' + lift);
  const raise = r.ctx.raised.find((e) => e[0] === 'RAISE');
  assert.deepEqual(raise.slice(1, 3), ['V-502', 'PSV LIFT']);
  assert.equal(raise[3], 'Urgent');
  assert.equal(raise[5], 'KPA');

  // the relief is bigger than the gas make, so the vessel blows down to the reseat point
  let reset = false;
  for (let i = 0; i < 400 && !reset; i++) { r.tick(0.5); if (!r.P.trips.psv502) reset = true; }
  assert.ok(reset, 'PSV-502 reseated');
  assert.ok(r.s().pres < 1000, 'reseat is below psvReset: ' + r.s().pres);
  assert.ok(r.ctx.raised.some((e) => e[0] === 'CLEAR' && e[1] === 'V-502' && e[2] === 'PSV LIFT'), 'the alarm was cleared');
});

// ---------------------------------------------------------------- valves
test('MODEL_VALVES carries the four new valves', () => {
  assert.equal(Models.MODEL_VALVES.length, 14);
  for (const k of ['TV502', 'LV503', 'WV504', 'PV505']) assert.ok(Models.MODEL_VALVES.includes(k), k + ' missing');
});

test('the four valves follow their loop outputs, and go to their fail positions on air loss', () => {
  const c = new Component({});
  c.initSim(1700000000000);
  Object.assign(c.L, u4Points());
  Object.assign(c.V, u4Valves());
  const ctx = stubCtx({ rand: Models.createRand(7) });
  const run = (sec) => { for (let i = 0; i < sec * 2; i++) Models.step(c.P, c.L, c.V, 0.5, ctx); };

  c.L.TIC502.op = 20; c.L.LIC503.op = 90; c.L.LIC504.op = 10; c.L.PIC505.op = 75;
  run(60);
  near(c.V.TV502.pos, 0.20, 2, 'TV502 follows TIC502.op');
  near(c.V.LV503.pos, 0.90, 2, 'LV503 follows LIC503.op');
  near(c.V.WV504.pos, 0.10, 2, 'WV504 follows LIC504.op');
  near(c.V.PV505.pos, 0.75, 2, 'PV505 follows PIC505.op');

  c.P.faults.air = true;
  run(60);
  near(c.V.TV502.pos, 1, 2, 'TV-502 fails open');
  near(c.V.PV505.pos, 1, 2, 'PV-505 fails open');
  assert.ok(c.V.LV503.pos < 0.02, 'LV-503 fails closed: ' + c.V.LV503.pos);
  assert.ok(c.V.WV504.pos < 0.02, 'WV-504 fails closed: ' + c.V.WV504.pos);
});

// ---------------------------------------------------------------- rule 0.2: the second stream
test('with no ctx.rand4 the unit is noiseless, reproducible, and never touches ctx.rand', () => {
  let randCalls = 0;
  const spy = () => { randCalls++; return 0.5; };
  const a = u4Rig({ rand: spy }), b = u4Rig({ rand: spy });
  a.tick(900); b.tick(900);
  assert.equal(randCalls, 0, 'stepU4 called ctx.rand ' + randCalls + ' times; it must never touch the shared stream');
  assert.deepEqual(a.P.s, b.P.s, 'two runs are bit-identical without rand4');
  for (const tag of ['TIC502', 'LIC503', 'LIC504', 'PIC505', 'AI509', 'AI510'])
    assert.equal(a.L[tag].pv, b.L[tag].pv, tag + ' diverged');
  assert.equal(a.L.TIC502.pv, a.P.s.Tin, 'no noise on the measurement without rand4');
  assert.equal(a.L.PIC505.pv, a.P.s.pres, 'no noise on the measurement without rand4');
});

test('with ctx.rand4 present the measurements move and U1-U3 stay bit-identical', () => {
  const bare = dropU4((() => { const b = new Component({}); b.initSim(1700000000000); return b; })());
  const v2Tags = Object.keys(bare.L);
  const v2Valves = Object.keys(bare.V);
  assert.equal(v2Tags.length, 24, 'the v2 universe is 24 points');

  const mk = (withU4) => {
    const c = new Component({});
    c.initSim(1700000000000);
    if (!withU4) dropU4(c);
    const ctx = stubCtx({ rand: Models.createRand(4242), rand4: Models.createRand(4242 ^ 0x5eed4) });
    return { c, ctx };
  };
  const withU4 = mk(true), without = mk(false);
  for (let i = 0; i < 600; i++) Models.step(withU4.c.P, withU4.c.L, withU4.c.V, 0.5, withU4.ctx);
  for (let i = 0; i < 600; i++) {
    Models.advanceClock(without.c.P, 0.5);
    Models.stepU1(without.c.P, without.c.L, without.c.V, 0.5, without.ctx);
    Models.stepU2(without.c.P, without.c.L, without.c.V, 0.5, without.ctx);
    Models.stepU3(without.c.P, without.c.L, without.c.V, 0.5, without.ctx);
  }

  const strip = (P) => { const o = { ...P, s: undefined, trips: { ...P.trips, psv502: undefined } }; delete o.s; delete o.trips.psv502; return o; };
  assert.deepEqual(strip(withU4.c.P), strip(without.c.P), 'Unit 04 moved a U1-U3 state');
  for (const tag of v2Tags) {
    const x = withU4.c.L[tag], y = without.c.L[tag];
    assert.deepEqual([x.pv, x.sp, x.op, x.mode], [y.pv, y.sp, y.op, y.mode], tag + ' moved');
  }
  for (const v of v2Valves) assert.equal(withU4.c.V[v].pos, without.c.V[v].pos, v + ' moved');

  // and rand4 really is being consumed: the measurements are not the bare states
  assert.notEqual(withU4.c.L.TIC502.pv, withU4.c.P.s.Tin, 'no noise on TIC502 with rand4 present');
  assert.notEqual(withU4.c.L.PIC505.pv, withU4.c.P.s.pres, 'no noise on PIC505 with rand4 present');
  assert.ok(Math.abs(withU4.c.L.LIC504.pv - withU4.c.P.s.hw) <= 0.1, 'LIC504 noise stays inside its 0.2 band');
});

// ---------------------------------------------------------------- tolerating a pre-U4 plant
test('stepU4 runs against a tag database and valve set that predate Unit 04', () => {
  const c = dropU4((() => { const b = new Component({}); b.initSim(1700000000000); return b; })());
  const ctx = stubCtx({ rand: Models.createRand(9) });
  for (let i = 0; i < 1200; i++) Models.step(c.P, c.L, c.V, 0.5, ctx);   // no U4 points, no U4 valves
  assert.ok(Number.isFinite(c.P.s.hw) && Number.isFinite(c.P.s.pres), 'U4 still integrates');
  assert.ok(!('TIC502' in c.L), 'no point was invented');
  assert.ok(!('TV502' in c.V), 'no valve was invented');
  assert.deepEqual(ctx.raised, [], 'and it runs at the design point, quietly');
});

test('a pre-U4 snapshot restores: absent P.s and env.weirH default instead of poisoning the state', () => {
  const P = Models.createState(1700000000000);
  delete P.s;
  delete P.env.weirH;
  const L = u4Points(), V = u4Valves(), ctx = stubCtx();
  for (let i = 0; i < 200; i++) { Models.advanceClock(P, 0.5); Models.stepU4(P, L, V, 0.5, ctx); }
  near(P.s.hw, 25, 1, 'hw defaulted to the design interface');
  near(P.s.pres, 800, 5, 'pressure defaulted to the design');
  assert.ok(Number.isFinite(P.s.qover), 'the weir defaulted to 55 rather than integrating NaN');
});
