// @artifact dev
const test = require('node:test');
const assert = require('node:assert/strict');
const Pid = require('../src/pid.js');

function mkLoop(o) {
  return Object.assign({ tag: 'TIC', lo: 0, hi: 100, pv: 50, sp: 50, op: 50, I: 50, lastPv: 50, K: 1, T1: 1, T2: 0, act: 'REV', mode: 'AUTO', modeAttr: 'OPERATOR', master: null, slave: null, init: false, sphilm: 100, splolm: 0, ophilm: 100, oplolm: 0, badPv: false, kind: 'pid' }, o);
}

// first-order plant: gain 1 on OP (%), time constant tau seconds, steady state pv = op
function runPlant(loop, seconds, dt, tau, opts) {
  opts = opts || {};
  for (let t = 0; t < seconds; t += dt) {
    Pid.stepPid(loop, dt, opts.ctx);
    loop.pv += (loop.op * (opts.gain || 1) - loop.pv) * dt / tau;
    if (opts.each) opts.each(t);
  }
}

test('step response of a first-order plant converges to setpoint', () => {
  const l = mkLoop({ sp: 70, K: 2, T1: 0.5 });
  runPlant(l, 600, 0.5, 20);
  assert.ok(Math.abs(l.pv - 70) < 0.5, 'pv ' + l.pv);
  assert.ok(Math.abs(l.op - 70) < 1, 'op ' + l.op);
});

test('DIR action converges on a plant with negative gain', () => {
  const l = mkLoop({ sp: 30, act: 'DIR', K: 1.5, T1: 0.5, pv: 50 });
  // plant: pv -> 100 - op
  for (let t = 0; t < 600; t += 0.5) { Pid.stepPid(l, 0.5); l.pv += ((100 - l.op) - l.pv) * 0.5 / 15; }
  assert.ok(Math.abs(l.pv - 30) < 0.5, 'pv ' + l.pv);
});

test('derivative on PV with filter contributes and stays bounded', () => {
  const l = mkLoop({ sp: 60, K: 1, T1: 1, T2: 0.2, dFilter: 2 });
  let maxOp = 0;
  runPlant(l, 400, 0.5, 20, { each: () => { maxOp = Math.max(maxOp, l.op); } });
  assert.ok(Math.abs(l.pv - 60) < 1, 'pv ' + l.pv);
  assert.ok(maxOp <= 100 && Number.isFinite(l.dState));
});

test('no windup when clamped at OPHILM: recovery is prompt', () => {
  const l = mkLoop({ sp: 95, K: 3, T1: 0.2, ophilm: 60 });
  runPlant(l, 300, 0.5, 10, { gain: 0.5 });   // can never reach 95 with gain 0.5 and op<=60
  assert.equal(l.op, 60);
  assert.ok(l.I <= 60 + 1e-9, 'integrator held at limit, I=' + l.I);
  // drop setpoint below what is reachable: output must leave the limit within a few seconds
  l.sp = 20;
  let leftLimit = null;
  runPlant(l, 60, 0.5, 10, { gain: 0.5, each: (t) => { if (leftLimit == null && l.op < 60) leftLimit = t; } });
  assert.ok(leftLimit != null && leftLimit <= 2, 'left limit after ' + leftLimit + ' s');
});

test('output never leaves OPLOLM/OPHILM band', () => {
  const l = mkLoop({ sp: 100, K: 10, T1: 0.1, ophilm: 80, oplolm: 20 });
  for (let i = 0; i < 200; i++) { Pid.stepPid(l, 0.5); assert.ok(l.op <= 80 && l.op >= 20); }
  l.sp = 0;
  for (let i = 0; i < 200; i++) { Pid.stepPid(l, 0.5); assert.ok(l.op <= 80 && l.op >= 20); }
});

test('bumpless MAN -> AUTO: first AUTO output equals the manual output', () => {
  const l = mkLoop({ mode: 'MAN', op: 37, pv: 44, sp: 60, K: 4, T1: 2 });
  for (let i = 0; i < 10; i++) Pid.stepPid(l, 0.5);
  const r = Pid.transferMode(l, 'AUTO');
  assert.equal(r.ok, true);
  Pid.stepPid(l, 0.5);
  // only the single-interval integral increment K*e*dt/(T1*60) may move OP: no proportional kick
  const maxMove = 4 * Math.abs(Pid.loopError(l)) * 0.5 / (2 * 60);
  assert.ok(Math.abs(l.op - 37) <= maxMove + 1e-9, 'op after transfer ' + l.op);
});

test('bumpless AUTO -> CAS: op continuous although SP jumps to the master demand', () => {
  const master = mkLoop({ tag: 'LIC101', op: 75, slave: 'FIC102' });
  const slave = mkLoop({ tag: 'FIC102', master: 'LIC101', pv: 40, sp: 40, op: 52, I: 52, K: 1.5, T1: 1 });
  const ctx = { loops: { LIC101: master, FIC102: slave }, casMap: { FIC102: (op) => op * 1.2 }, invMap: { FIC102: (sp) => sp / 1.2 } };
  Pid.stepPid(slave, 0.5, ctx);
  const opBefore = slave.op;
  const r = Pid.transferMode(slave, 'CAS', ctx);
  assert.equal(r.ok, true);
  assert.equal(slave.sp, 90);
  Pid.stepPid(slave, 0.5, ctx);
  const maxMove = 1.5 * Math.abs(Pid.loopError(slave)) * 0.5 / 60;
  assert.ok(Math.abs(slave.op - opBefore) <= maxMove + 1e-9, 'op ' + slave.op + ' vs ' + opBefore);
});

test('transferMode refuses CAS without a master and non-MAN with bad PV', () => {
  const l = mkLoop({ mode: 'MAN' });
  assert.equal(Pid.transferMode(l, 'CAS').ok, false);
  l.badPv = true;
  assert.equal(Pid.transferMode(l, 'AUTO').ok, false);
  assert.equal(l.mode, 'MAN');
});

test('PV tracking: SP follows PV in MAN so AUTO starts with zero error', () => {
  const l = mkLoop({ mode: 'MAN', pvtrack: true, pv: 63.2, sp: 40, op: 30, sphilm: 90, splolm: 10 });
  Pid.stepPid(l, 0.5);
  assert.equal(l.sp, 63.2);
  l.pv = 95; Pid.stepPid(l, 0.5);
  assert.equal(l.sp, 90, 'SP clamped to SPHILM');
  l.pv = 70; Pid.stepPid(l, 0.5);
  Pid.transferMode(l, 'AUTO');
  assert.equal(Pid.loopError(l), 0);
  Pid.stepPid(l, 0.5);
  assert.equal(l.op, 30);
  const noTrack = mkLoop({ mode: 'MAN', pv: 63.2, sp: 40 });
  Pid.stepPid(noTrack, 0.5);
  assert.equal(noTrack.sp, 40);
});

test('PROGRAM mode attribute gates operator SP/OP/MODE writes only', () => {
  const l = mkLoop({ modeAttr: 'PROGRAM' });
  assert.equal(Pid.canOperatorWrite(l, 'SP'), false);
  assert.equal(Pid.canOperatorWrite(l, 'OP'), false);
  assert.equal(Pid.canOperatorWrite(l, 'MODE'), false);
  assert.equal(Pid.canOperatorWrite(l, 'K'), true);
  assert.equal(Pid.canOperatorWrite(l, 'TP:PVHI'), true);
  assert.match(Pid.writeDenial(l, 'SP'), /PROGRAM/);
  l.modeAttr = 'OPERATOR';
  assert.equal(Pid.canOperatorWrite(l, 'SP'), true);
  assert.equal(Pid.writeDenial(l, 'SP'), '');
});

test('cascade initialisation: primary back-calculates from slave SP while slave is not in CAS', () => {
  const master = mkLoop({ tag: 'LIC101', op: 20, sp: 50, pv: 50, slave: 'FIC102' });
  const slave = mkLoop({ tag: 'FIC102', master: 'LIC101', mode: 'AUTO', sp: 66 });
  const ctx = { loops: { LIC101: master, FIC102: slave }, casMap: { FIC102: (op) => op * 1.2 }, invMap: { FIC102: (sp) => sp / 1.2 } };
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(master.init, true);
  assert.ok(Math.abs(master.op - 55) < 1e-9);
  // slave goes CAS: its SP equals what the primary now demands -> no bump
  Pid.transferMode(slave, 'CAS', ctx);
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(master.init, false);
  Pid.stepPid(slave, 0.5, ctx);
  assert.equal(slave.sp, 66);
});

test('bad PV holds the output and tracks the integrator', () => {
  const l = mkLoop({ badPv: true, op: 41, pv: 10, sp: 90 });
  for (let i = 0; i < 20; i++) Pid.stepPid(l, 0.5);
  assert.equal(l.op, 41);
  l.badPv = false;
  Pid.stepPid(l, 0.5);
  assert.ok(Math.abs(l.op - 41) < 1, 'resumes near held output: ' + l.op);
});

test('isaForm reports standard-form and parallel gains', () => {
  const f = Pid.isaForm(2, 0.5, 0.1);
  assert.equal(f.Kc, 2); assert.equal(f.Ti, 0.5); assert.equal(f.Td, 0.1);
  assert.equal(f.TiSec, 30); assert.equal(f.TdSec, 6);
  assert.ok(Math.abs(f.Ki - 2 / 30) < 1e-12); assert.equal(f.Kd, 12);
  const p = Pid.isaForm(1, 0, 0);
  assert.equal(p.Ti, Infinity); assert.equal(p.Ki, 0); assert.equal(p.Kd, 0);
});

test('the controller acts on pvObs when the point carries one, and on pv otherwise', () => {
  const a = mkLoop({ sp: 50, pv: 80, K: 1, T1: 1 });
  const b = mkLoop({ sp: 50, pv: 80, pvObs: 60, K: 1, T1: 1 });
  assert.equal(Pid.pvOf(a), 80);
  assert.equal(Pid.pvOf(b), 60);
  Pid.stepPid(a, 0.5); Pid.stepPid(b, 0.5);
  assert.ok(a.op < b.op, 'the loop that sees the larger error moves its output further');
  assert.equal(b.lastPv, 60, 'lastPv follows the observed value');
  assert.equal(a.lastPv, 80);
});

test('PV tracking in MAN follows the observed value', () => {
  const l = mkLoop({ mode: 'MAN', pvtrack: true, pv: 140, pvObs: 103.125, sp: 40 });
  Pid.stepPid(l, 0.5);
  assert.equal(l.sp, 100, 'SP tracks the observed PV, clamped to SPHILM');
});

// SPHILM 120 sits above the observed 103.125 and below the raw 140, so only a read of the
// observed value leaves the tracked SP unclamped: this pins the PV-tracking read itself.
test('PV tracking clamps the observed value, not the raw one', () => {
  const l = mkLoop({ mode: 'MAN', pvtrack: true, pv: 140, pvObs: 103.125, sp: 40, sphilm: 120 });
  Pid.stepPid(l, 0.5);
  assert.equal(l.sp, 103.125);
});

// The reads the tests above cannot reach (mkLoop has no derivative term): each loop's observed
// value equals what the scan remembers, so a read of the raw 80 anywhere shows up as derivative action.
test('the derivative, the lastPv seed and the MAN tracker read the observed value too', () => {
  const d = mkLoop({ sp: 50, pv: 80, pvObs: 60, lastPv: 60, T2: 1 });
  Pid.stepPid(d, 0.5);
  assert.equal(d.dState, 0, 'derivative action sees a flat observed PV');

  const s = mkLoop({ sp: 50, pv: 80, pvObs: 60, lastPv: undefined, T2: 1 });
  Pid.stepPid(s, 0.5);
  assert.equal(s.dState, 0, 'a loop with no lastPv yet is seeded from the observed value');

  const m = mkLoop({ mode: 'MAN', op: 50, sp: 50, pv: 80, pvObs: 60, K: 2 });
  Pid.stepPid(m, 0.5);
  assert.equal(m.lastPv, 60, 'MAN tracking remembers the observed value');
});

test('output tracking holds OP at the target in AUTO with the integrator back-calculated, then resumes bumplessly', () => {
  // PV 40 against SP 50 leaves a real proportional term (P = 10), so I = OP - P cannot pass for I = OP,
  // and a target of 35 leaves a released loop nowhere to hide: it must continue from 35, not from 0.
  const l = mkLoop({ sp: 50, pv: 40, op: 60, I: 60, K: 1, T1: 1 });
  Pid.setTracking(l, 35, 'P-101 STOPPED', 'device');
  assert.equal(Pid.tracking(l), true);
  for (let i = 0; i < 20; i++) Pid.stepPid(l, 0.5);
  assert.equal(l.op, 35);
  assert.equal(l.I, 35 - l.K * Pid.loopError(l), 'I = OP - P');
  Pid.clearTracking(l);
  assert.equal(Pid.tracking(l), false);
  Pid.stepPid(l, 0.5);
  assert.ok(l.op > 35, 'the released loop controls again, from the tracked value up: ' + l.op);
  assert.ok(l.op - 35 <= l.K * Pid.loopError(l) * 0.5 / (l.T1 * 60) + 1e-9, 'one integral step on, no bump: ' + l.op);
});

test('device tracking yields to the operator in MAN; interlock tracking does not', () => {
  const dev = mkLoop({ mode: 'MAN', op: 40, I: 40 });
  Pid.setTracking(dev, 0, 'P-101 STOPPED', 'device');
  assert.equal(Pid.tracking(dev), false);
  Pid.stepPid(dev, 0.5);
  assert.equal(dev.op, 40);
  const il = mkLoop({ mode: 'MAN', op: 40, I: 40 });
  Pid.setTracking(il, 0, 'R-201 HI TEMP TRIP', 'interlock');
  assert.equal(Pid.tracking(il), true);
  Pid.stepPid(il, 0.5);
  assert.equal(il.op, 0);
});

test('a tracking CAS secondary keeps following its master setpoint, and its primary runs INITMAN', () => {
  const master = mkLoop({ tag: 'M', slave: 'S', sp: 50, pv: 50, op: 70, I: 70 });
  const slave = mkLoop({ tag: 'S', master: 'M', mode: 'CAS', sp: 10, pv: 10, op: 30, I: 30, sphilm: 100, splolm: 0 });
  const ctx = { loops: { M: master, S: slave }, casMap: { S: (op) => op }, invMap: { S: (sp) => sp } };
  Pid.setTracking(slave, 0, 'P-101 STOPPED', 'device');
  // The secondary steps first so it reads the primary's OP before INITMAN back-calculates it from the
  // secondary's SP: stepped master-first the pair holds still at SP 10 and following cannot show
  // (the plant's primary-first order has its own test below).
  Pid.stepPid(slave, 0.5, ctx);
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(slave.sp, 70, 'SP still follows the master while OP is held');
  assert.equal(slave.op, 0);
  assert.equal(master.init, true, 'the primary back-calculates while its secondary tracks');
  Pid.clearTracking(slave);
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(master.init, false);
});

test('clearTracking on a loop that never tracked creates no record; an ordinary loop controls normally', () => {
  const l = mkLoop({ sp: 50, pv: 40, op: 50, I: 50, K: 1, T1: 1 });
  Pid.clearTracking(l);
  assert.equal('trk' in l, false);
  assert.equal(Pid.tracking(l), false);
  Pid.stepPid(l, 0.5);
  assert.ok(l.op > 50, 'ordinary control action');
});

// The tests above hold the output at 0 only. These pin the rest of the facility: the target itself,
// the output limits, PV tracking on the held scan, and the record the plant writes and the page reads.
test('tracking holds the target itself, inside OPLOLM and OPHILM, and PV tracking still moves the SP', () => {
  const l = mkLoop({ sp: 50, pv: 50, op: 50, I: 50, oplolm: 20, ophilm: 80 });
  Pid.setTracking(l, 35, 'P-101 STOPPED', 'device');
  Pid.stepPid(l, 0.5);
  assert.equal(l.op, 35, 'a target inside the limits is held exactly');
  Pid.setTracking(l, 0, 'P-101 STOPPED', 'device');
  Pid.stepPid(l, 0.5);
  assert.equal(l.op, 20, 'a target below OPLOLM is held at OPLOLM');
  Pid.setTracking(l, 150, 'P-101 STOPPED', 'device');
  Pid.stepPid(l, 0.5);
  assert.equal(l.op, 80, 'a target above OPHILM is held at OPHILM');
  const p = mkLoop({ pvtrack: true, sp: 40, pv: 63.2, op: 50, I: 50, sphilm: 90, splolm: 10 });
  Pid.setTracking(p, 0, 'P-101 STOPPED', 'device');
  Pid.stepPid(p, 0.5);
  assert.equal(p.sp, 63.2, 'with pvtrack the SP follows the PV while OP is held');
});

test('the tracking record is {on, target, reason, kind}; clearing empties it, keeps the kind, and never creates one', () => {
  const l = mkLoop({});
  Pid.setTracking(l, 12, 'R-310 BED TRIP', 'interlock');
  assert.deepEqual(l.trk, { on: true, target: 12, reason: 'R-310 BED TRIP', kind: 'interlock' });
  Pid.clearTracking(l);
  assert.deepEqual(l.trk, { on: false, target: null, reason: '', kind: 'interlock' });
  Pid.clearTracking(l);
  assert.deepEqual(l.trk, { on: false, target: null, reason: '', kind: 'interlock' }, 'a second clear changes nothing');
  Pid.setTracking(l, 0);
  assert.deepEqual(l.trk, { on: true, target: 0, reason: '', kind: 'device' }, 'no reason is an empty one; an unnamed kind is a device hold');
  Pid.setTracking(l, 0, 'X', 'bogus');
  assert.equal(l.trk.kind, 'device');
  const never = mkLoop({});
  Pid.clearTracking(never);
  assert.equal('trk' in never, false, 'clearing a loop that never tracked leaves it without a record');
});

test('a non-finite target is held at 0, inside the output limits, and never reaches OP or the integrator as NaN', () => {
  for (const bad of [undefined, NaN, Infinity]) {
    for (const oplolm of [0, 10]) {
      const l = mkLoop({ sp: 50, pv: 40, op: 60, I: 60, K: 1, T1: 1, oplolm });
      Pid.setTracking(l, bad, 'x', 'device');
      assert.equal(l.trk.target, 0, 'stored as 0: ' + bad);
      for (let i = 0; i < 3; i++) Pid.stepPid(l, 0.5);
      assert.equal(l.op, oplolm, 'held at the clamped 0 (OPLOLM ' + oplolm + '): ' + bad);
      assert.ok(Number.isFinite(l.I), 'integrator finite while held: ' + bad);
      Pid.clearTracking(l);
      for (let i = 0; i < 10; i++) {
        Pid.stepPid(l, 0.5);
        assert.ok(Number.isFinite(l.op) && Number.isFinite(l.I), 'no NaN after the release, scan ' + i + ': ' + bad);
      }
    }
  }
});

// The plant steps a primary before its secondary. Then the pair holds still while the secondary tracks:
// the primary's OP is back-calculated from the secondary's SP, which the secondary takes straight back.
// The primary has a standing error here, so one that is not back-calculated would wind up to its limit.
// This is the pair without PV tracking. FIC102 and TIC213 carry pvtrack: their SP follows their PV while held, so
// their primary does not hold still but follows invMap(secondary PV) (the pvtrack test below).
test('in the plant scan order the primary of a tracking secondary holds still instead of winding up, then takes over bumplessly', () => {
  const master = mkLoop({ tag: 'M', slave: 'S', act: 'DIR', sp: 50, pv: 70, op: 30, I: 30, K: 1.5, T1: 3 });
  const slave = mkLoop({ tag: 'S', master: 'M', mode: 'CAS', sp: 30, pv: 30, op: 30, I: 30 });
  const ctx = { loops: { M: master, S: slave }, casMap: { S: (op) => op }, invMap: { S: (sp) => sp } };
  Pid.setTracking(slave, 0, 'P-101 STOPPED', 'device');
  for (let i = 0; i < 600; i++) { Pid.stepPid(master, 0.5, ctx); Pid.stepPid(slave, 0.5, ctx); }
  assert.equal(master.init, true);
  assert.equal(master.op, 30, 'the primary did not wind up');
  assert.equal(slave.sp, 30, 'the secondary kept its setpoint');
  assert.equal(slave.op, 0);
  Pid.clearTracking(slave);
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(master.init, false);
  const maxMove = 1.5 * Math.abs(Pid.loopError(master)) * 0.5 / (3 * 60);
  assert.ok(Math.abs(master.op - 30) <= maxMove + 1e-9, 'the primary resumes from where it held: ' + master.op);
});

// LIC101 over FIC102 as the plant has them (the maps, the ranges, pvtrack on the secondary). The pump stops: the
// flow decays toward 0, the secondary's SP follows it down, and the primary's OP follows invMap of that SP down,
// instead of holding still. Sound all the same: the primary has a standing error and does not wind up, nothing
// goes NaN, and the release is bumpless.
test('with a pvtrack secondary the primary follows the secondary PV down while it tracks, with no wind-up and no NaN', () => {
  const master = mkLoop({ tag: 'LIC101', slave: 'FIC102', act: 'DIR', sp: 50, pv: 70, op: 50, I: 50, K: 1.5, T1: 3, sphilm: 95, splolm: 5 });
  const slave = mkLoop({ tag: 'FIC102', master: 'LIC101', mode: 'CAS', pvtrack: true, hi: 120, sp: 60, pv: 60, op: 50, I: 50, K: 0.4, T1: 0.15, sphilm: 80, splolm: 0 });
  const ctx = { loops: { LIC101: master, FIC102: slave }, casMap: { FIC102: (op) => op * 1.2 }, invMap: { FIC102: (sp) => sp / 1.2 } };
  Pid.setTracking(slave, 0, 'P-101 STOPPED', 'device');
  let prev = master.op;
  for (let i = 0; i < 600; i++) {
    Pid.stepPid(master, 0.5, ctx); Pid.stepPid(slave, 0.5, ctx);
    slave.pv += (0 - slave.pv) * 0.5 / 5;
    for (const v of [master.op, master.I, slave.sp, slave.op, slave.I]) assert.ok(Number.isFinite(v), 'finite at scan ' + i);
    assert.ok(master.op <= prev + 1e-9, 'the primary only falls: ' + master.op + ' after ' + prev);
    prev = master.op;
  }
  assert.equal(master.init, true);
  assert.ok(master.op < 0.01, 'the primary is at invMap(0), not wound up: ' + master.op);
  assert.equal(slave.op, 0);
  const held = master.op;
  Pid.clearTracking(slave);
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(master.init, false);
  const maxMove = 1.5 * Math.abs(Pid.loopError(master)) * 0.5 / (3 * 60);
  assert.ok(Math.abs(master.op - held) <= maxMove + 1e-9, 'the primary resumes from where it held: ' + master.op);
});
