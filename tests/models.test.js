// @artifact dev
// Tests for src/models.js driven through the app's Component (tools/logic-harness).
const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();

// Build a Component whose process state is the module's state and whose step
// goes through ESS.Models exactly the way the integration will wire it.
function rig(seed = 1) {
  const c = new Component({});
  c.initSim();
  c.P = Models.createState(c.P.t);
  const ctx = {
    raise: (...a) => c.raiseA(...a),
    clear: (...a) => c.clearA(...a),
    tripMotor: (...a) => c.tripMotor(...a),
    addEvent: (...a) => c.addEvent(...a),
    rand: Models.createRand(seed),
    shed: (l) => c.applyShed(l),
    message: (t) => c.msgZone(t),
    onTrip: () => c.dTrip(),
  };
  const tick = (dt = 0.5) => {
    Models.advanceClock(c.P, dt);
    Models.stepU1(c.P, c.L, c.V, dt, ctx);
    Models.stepU2(c.P, c.L, c.V, dt, ctx);
    Models.stepU3(c.P, c.L, c.V, dt, ctx);
    c.pids(dt); c.scan(); c.shelfScan(); c.drillWatch(dt);
  };
  const run = (sec, until) => { for (let i = 0; i < sec * 2; i++) { tick(); if (until && until()) return true; } return false; };
  const active = () => c.alarms.filter((a) => a.active).map((a) => a.key);
  return { c, ctx, tick, run, active };
}

function inBand(l) {
  const a = l.alm;
  if (a.PVHI && l.pv >= a.PVHI[0]) return false;
  if (a.PVLO && l.pv <= a.PVLO[0]) return false;
  return true;
}

test('createState is a superset of the app P shape with the new fields', () => {
  const c = new Component({}); c.initSim();
  const P = Models.createState(c.P.t);
  // P.archFaults (V3-PLAN S2, src/upset-bridge.js + src/fault-engine.js) is a documented
  // exception. It is a fault-engine-layer field the app attaches in initSim()
  // AFTER calling ESS.Models.createState(now) -- never inside it -- because decision D1
  // keeps src/models.js's physics untouched by the v3 fault engine: models.js must not
  // know the fault engine exists. c.P legitimately carries a top-level key createState()
  // does not and, by that same decision, never should.
  // P.archPending / P.archMeta (V3-PLAN S2, the instructor Architecture panel, DO item 1)
  // are the same exception for the same reason: the panel's own onset/duration/ramp
  // schedule ledger, attached alongside P.archFaults, never read by src/models.js.
  const APP_ONLY_FIELDS = ['archFaults', 'archPending', 'archMeta'];
  for (const k of Object.keys(c.P)) { if (APP_ONLY_FIELDS.includes(k)) continue; assert.ok(k in P, 'missing ' + k); }
  for (const k of Object.keys(c.P.b)) assert.ok(k in P.b, 'missing b.' + k);
  for (const k of Object.keys(c.P.h)) assert.ok(k in P.h, 'missing h.' + k);
  for (const k of ['Ca', 'x', 'Tjo', 'Qr']) assert.equal(typeof P[k], 'number', k);
  for (const k of ['Tad', 'accM', 'mP', 'Ts', 'Tehe', 'conv']) assert.equal(typeof P.b[k], 'number', 'b.' + k);
  for (const k of ['fb', 't1', 't2', 'ts1', 'ts2', 'air', 'o2', 'dT']) assert.equal(typeof P.h[k], 'number', 'h.' + k);
  assert.equal(P.b.phase, 'IDLE');
});

test('baseline: 30 sim-minutes, no alarms, no trips, PVs in their normal band', () => {
  const { c, run, active } = rig(3);
  let worst = { rT: [999, -999] };
  run(1800, () => { worst.rT[0] = Math.min(worst.rT[0], c.P.rT); worst.rT[1] = Math.max(worst.rT[1], c.P.rT); return false; });
  assert.deepEqual(active(), []);
  assert.deepEqual(c.P.trips, {});
  for (const k of ['LIC101', 'FIC102', 'TIC201', 'TIC202', 'TIC301', 'LIC401', 'PIC401', 'FIC310', 'TIC311', 'TI312', 'FIC313']) assert.ok(inBand(c.L[k]), k + ' out of band: ' + c.L[k].pv);
  assert.ok(worst.rT[0] > 142 && worst.rT[1] < 160, 'R-201 stayed near 150 C: ' + worst.rT);
  assert.ok(Math.abs(c.P.rT - 150) < 6, 'rT ' + c.P.rT);
  assert.ok(Math.abs(c.P.x - 0.85) < 0.05, 'conversion ' + c.P.x);
  assert.ok(c.P.Tjo > c.P.Tj && c.P.Tjo < c.P.rT, 'jacket outlet between supply and reactor');
  assert.ok(Math.abs(c.P.Qr - 100) < 15, 'duty % ' + c.P.Qr);
  assert.ok(Math.abs(c.P.h.pre - 320) < 8 && Math.abs(c.P.h.bed - 380) < 8, 'U3 at design');
  assert.ok(c.P.h.o2 > 2 && c.P.h.o2 < 4.5, 'excess O2 ' + c.P.h.o2);
  assert.ok(c.P.h.ts2 > c.P.h.ts1 && c.P.h.ts1 > c.P.h.pre, 'pass 2 skin hottest, skins above outlet');
});

test('rxn fault drives R-201 to the 185 C trip with no operator action', () => {
  const { c, run } = rig(5);
  run(120);
  c.injectFault('rxn', true);
  assert.ok(run(900, () => c.P.trips.rx), 'no R-201 trip');
  assert.ok(c.alarms.some((a) => a.key === 'R-201.HI TEMP TRIP'));
  assert.ok(c.P.rT >= 185);
});

test('cool fault (jacket loss) drives R-201 to trip', () => {
  const { c, run } = rig(5);
  run(120);
  c.injectFault('cool', true);
  assert.ok(run(900, () => c.P.trips.rx), 'no R-201 trip');
  assert.ok(c.alarms.some((a) => a.key === 'TIC201.PVHH'), 'PVHH alarm precedes trip');
});

test('stick fault (TV-202 stuck) shows a TIC202 deviation and runs the reactor into its High alarm without tripping it', () => {
  const { c, run } = rig(5);
  run(120);
  c.injectFault('stick', true);
  assert.equal(c.P.faults.rxn, undefined, 'stiction no longer injects the full rxn fault');
  let peak = 0;
  run(900, () => { peak = Math.max(peak, c.P.rT); return c.alarms.some((a) => a.key === 'TIC201.PVHI'); });
  assert.ok(c.alarms.some((a) => a.key === 'TIC202.DEVHI'), 'TIC202 deviation');
  assert.ok(c.alarms.some((a) => a.key === 'TIC201.PVHI'), 'reactor High alarm');
  run(600, () => c.P.trips.rx);
  assert.ok(!c.P.trips.rx, 'the stiction load alone stays inside the trip: ' + Math.max(peak, c.P.rT));
});

test('surge fault: the tank absorbs the surge into its High alarm, the reactor feed is capped at the FIC102 SP limit, nothing trips', () => {
  const { c, run } = rig(2);
  run(60);
  c.injectFault('surge', true);
  let peakL = 0, peakF = 0, peakT = 0;
  run(1200, () => { peakL = Math.max(peakL, c.P.tankL); peakF = Math.max(peakF, c.L.FIC102.sp); peakT = Math.max(peakT, c.P.rT); return !c.P.faults.surge && c.P.tankL < 75; });
  assert.ok(c.alarms.some((a) => a.key === 'LIC101.PVHI'), 'level High alarm');
  assert.ok(peakL > 80 && peakL < 98, 'level peak ' + peakL);
  assert.ok(peakF <= 80.001, 'cascade SP capped at the reactor feed limit: ' + peakF);
  assert.ok(peakT < 185 && !c.P.trips.rx && !c.P.trips.ovf, 'no trip, reactor peak ' + peakT);
  assert.equal(c.P.faults.surge, false, 'surge ends after 8 min');
});

test('xmtr fault: BADPV raised after 5 s and FIC102 shed to MAN through ctx.shed', () => {
  const { c, run } = rig(2);
  run(30);
  c.injectFault('xmtr', true);
  run(10);
  assert.equal(c.L.FIC102.badPv, true);
  assert.equal(c.L.FIC102.mode, 'MAN');
  assert.ok(c.alarms.some((a) => a.key === 'FIC102.BADPV' && a.active));
  c.injectFault('xmtr', false);
  run(2);
  assert.equal(c.L.FIC102.badPv, false);
  assert.ok(!c.alarms.some((a) => a.key === 'FIC102.BADPV' && a.active));
});

test('air fault drives every valve to its fail position; pump fault trips P-101 through ctx', () => {
  const { c, run } = rig(2);
  c.injectFault('air', true);
  run(60);
  for (const k in c.V) assert.ok(Math.abs(c.V[k].pos - c.V[k].fail) < 0.02, k);
  c.injectFault('air', false);
  c.injectFault('pump', true);
  run(1);
  assert.equal(c.L.P101.run, false);
  assert.equal(c.L.P101.trip, true);
});

test('batch: SCM202 runs CHARGE..DRAIN..IDLE in order with PROGRAM mode attributes', () => {
  const { c, run, tick } = rig(4);
  c.seqCmd('START', true);
  const seen = [];
  let feedAttr = null;
  const done = run(2400, () => {
    const ph = c.P.b.phase;
    if (seen[seen.length - 1] !== ph) seen.push(ph);
    if (ph === 'FEED' && feedAttr === null) feedAttr = [c.L.FIC211.modeAttr, c.L.TIC212.modeAttr];
    return ph === 'IDLE' && seen.length > 1;
  });
  assert.ok(done, 'batch did not complete in 40 sim-minutes: ' + seen.join('>'));
  assert.deepEqual(seen, ['CHARGE', 'HEATUP', 'FEED', 'REACT', 'COOL', 'DRAIN', 'IDLE']);
  assert.deepEqual(feedAttr, ['PROGRAM', 'PROGRAM']);
  tick();
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  assert.equal(c.L.TIC212.mode, 'MAN');
  assert.ok(!c.P.trips.batch, 'clean batch must not trip');
  assert.ok(c.P.b.accM > 20, 'monomer fed ' + c.P.b.accM);
  assert.ok(c.P.b.conv > 0.9, 'conversion ' + c.P.b.conv);
  assert.ok(c.P.b.lvl <= 10.5 && c.P.b.T < 50, 'drained and cooled');
});

test('batch: reactor temperature stays inside the display band while running', () => {
  const { c, run } = rig(4);
  c.seqCmd('START', true);
  let hi = 0;
  run(2400, () => { hi = Math.max(hi, c.P.b.T); return c.P.b.phase === 'IDLE' && c.P.b.pt > 1; });
  assert.ok(hi < 95, 'peak batch temperature ' + hi);
  assert.ok(!c.alarms.some((a) => a.tag === 'TIC212'), 'no TIC212 alarm on a clean batch');
});

test('agitator trip mid-FEED: monomer accumulates, Tad leads T, R-202 trips at 110 C', () => {
  const { c, run } = rig(6);
  c.seqCmd('START', true);
  assert.ok(run(2400, () => c.P.b.phase === 'FEED' && c.P.b.Cm > 8), 'never reached FEED with Cm > 8');
  const t0 = c.P.t, cm0 = c.P.b.Cm;
  c.injectFault('agit', true);
  assert.equal(c.L.M202.run, false);
  let tadLead = false, peakCm = 0;
  const tripped = run(900, () => {
    peakCm = Math.max(peakCm, c.P.b.Cm);
    if (c.P.b.Tad > 105 && c.P.b.T < 105) tadLead = true;
    return c.P.trips.batch;
  });
  assert.ok(tripped, 'R-202 did not trip');
  assert.ok(peakCm > cm0 + 5, 'monomer accumulated: ' + peakCm);
  assert.ok(tadLead, 'adiabatic temperature crossed 105 C before the reactor did');
  const dtTrip = (c.P.t - t0) / 1000;
  assert.ok(dtTrip > 45 && dtTrip < 600, 'trip after ' + dtTrip + ' s');
  assert.equal(c.P.b.phase, 'COOL');
  assert.ok(c.alarms.some((a) => a.key === 'R-202.HI TEMP TRIP'));
  assert.ok(run(1200, () => !c.P.trips.batch), 'trip did not reset below 70 C');
});

test('bedact fault drives the bed hotspot to the 480 C trip and fuel is cut', () => {
  const { c, run } = rig(2);
  run(60);
  c.injectFault('bedact', true);
  assert.ok(run(900, () => c.P.trips.bed), 'no bed trip');
  run(2);   // the trip fires on the model state; the Urgent alarm follows on the next noisy TI312 samples
  assert.ok(c.alarms.some((a) => a.key === 'TI312.PVHH'));
  run(30);
  assert.ok(c.V.FV311.pos < 0.05, 'fuel valve driven closed');
  assert.ok(c.P.h.fb < 400, 'firebox cooling with fuel off');
});

test('fired heater: tube-skin temperatures rise with fuel and O2 dips on a fuel step', () => {
  const { c, run } = rig(2);
  c.L.TIC311.mode = 'MAN';
  run(60);
  const ts1 = c.P.h.ts1, ts2 = c.P.h.ts2, o2 = c.P.h.o2;
  c.L.TIC311.op = 70;
  let o2min = 99;
  run(45, () => { o2min = Math.min(o2min, c.P.h.o2); return false; });   // before the bed trip cuts fuel
  assert.ok(o2min < o2 - 0.8, 'O2 dipped while the air register caught up: ' + o2min);
  assert.ok(c.P.h.ts1 > ts1 + 60 && c.P.h.ts2 > ts2 + 60, 'skins rose');
  assert.ok(c.P.h.ts2 > c.P.h.ts1, 'pass 2 hotter');
  assert.ok(c.P.h.pre > 380, 'outlet responded to fuel');
  assert.ok(c.P.h.fb > c.P.h.ts2 && c.P.h.ts2 > c.P.h.t2, 'firebox > skin > pass outlet');
});

test('fired heater: cutting fuel to zero returns the outlet toward the inlet temperature', () => {
  const { c, run } = rig(2);
  c.L.TIC311.mode = 'MAN'; c.L.TIC311.op = 0;
  run(300);
  assert.ok(c.P.h.pre < 200, 'outlet ' + c.P.h.pre);
  assert.ok(c.P.h.o2 > 15, 'purge air, no fuel: ' + c.P.h.o2);
});

test('numerical stability: speed x5 (five steps per tick) for 30 sim-minutes stays finite and bounded', () => {
  const { c, tick } = rig(9);
  c.seqCmd('START', true);
  for (let t = 0; t < 3600; t++) for (let s = 0; s < 5; s++) tick(0.5);
  const walk = (o, path) => { for (const k in o) { const v = o[k]; if (typeof v === 'number') assert.ok(Number.isFinite(v), path + k + ' = ' + v); else if (v && typeof v === 'object') walk(v, path + k + '.'); } };
  walk(c.P, 'P.');
  for (const k in c.L) assert.ok(Number.isFinite(c.L[k].pv), k);
  assert.ok(c.P.tankL >= 0 && c.P.tankL <= 100);
  assert.ok(c.P.drumP >= 0 && c.P.drumP <= 1100);
  assert.ok(c.P.rT > 0 && c.P.rT < 400);
  assert.ok(c.P.b.T >= 12 && c.P.b.T < 150);
  assert.ok(c.P.h.bed > 100 && c.P.h.bed < 600);
});

test('seeded rand makes two runs identical; Models.step matches the unit calls', () => {
  const a = rig(11), b = rig(11);
  a.run(300); b.run(300);
  assert.equal(a.c.P.rT, b.c.P.rT);
  assert.equal(a.c.L.PIC401.pv, b.c.L.PIC401.pv);
  const d = rig(11);
  for (let i = 0; i < 600; i++) { Models.step(d.c.P, d.c.L, d.c.V, 0.5, d.ctx); d.c.pids(0.5); d.c.scan(); d.c.shelfScan(); d.c.drillWatch(0.5); }
  assert.equal(d.c.P.rT, a.c.P.rT);
  assert.equal(d.c.P.up, a.c.P.up);
});

test('module works without the optional ctx callbacks and attaches ESS.Models as a browser global', () => {
  const { c } = rig(1);
  const calls = [];
  const ctx = { raise: (...x) => calls.push(x), clear: () => {}, tripMotor: () => {}, addEvent: () => {} };
  for (let i = 0; i < 100; i++) Models.step(c.P, c.L, c.V, 0.5, ctx);
  assert.ok(Number.isFinite(c.P.rT));
  // browser path of the UMD wrapper: no `module`, attaches to root.ESS
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'models.js'), 'utf8');
  const root = {};
  new Function('module', 'globalThis', src).call(root, undefined, root);
  assert.equal(typeof root.ESS.Models.stepU1, 'function');
  assert.deepEqual(Object.keys(root.ESS.Models).sort(), Object.keys(Models).sort());
});
