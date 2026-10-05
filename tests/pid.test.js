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

// The tests above pin the hold and its bumpless release (a target of 35), the MAN rule and the CAS secondary (a target of 0).
// These pin the rest of the facility: a target against OPLOLM and OPHILM, PV tracking on the held scan, and the record the
// plant writes and the page reads.
test('a device hold keeps the target inside OPLOLM and OPHILM, and PV tracking still moves the SP', () => {
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

// CR34 (whole-branch review): the plant forces the valve to an interlock's position whatever the loop's output limits (src/models.js
// VALVE_TARGET: FV102 is 0 under the R-201 trip, not OPLOLM), so an interlock-kind hold holds the raw target, and OP equals the valve (spec
// §3.4, D10) even when OPLOLM sits above it. A device hold (a stopped pump) is the loop's own output and stays inside its limits.
test('an interlock holds the raw target, outside OPLOLM and OPHILM, with the integrator tracking it; a device hold of the same target stays clamped (CR34)', () => {
  const mk = () => mkLoop({ sp: 50, pv: 40, op: 50, I: 50, K: 1, T1: 1, oplolm: 20, ophilm: 80 });
  const il = mk();
  Pid.setTracking(il, 0, 'R-201 HI TEMP TRIP', 'interlock');
  Pid.stepPid(il, 0.5);
  assert.equal(il.op, 0, 'a target below OPLOLM is held as it is: the valve is forced to 0');
  assert.equal(il.I, 0 - il.K * Pid.loopError(il), 'the integrator tracks the held output, not the clamped one');
  Pid.setTracking(il, 90, 'R-201 HI TEMP TRIP', 'interlock');
  Pid.stepPid(il, 0.5);
  assert.equal(il.op, 90, 'and a target above OPHILM too: the raw target');
  const dev = mk();
  Pid.setTracking(dev, 0, 'P-101 STOPPED', 'device');
  Pid.stepPid(dev, 0.5);
  assert.equal(dev.op, 20, 'the same target as a device hold stays at OPLOLM');
  Pid.setTracking(dev, 90, 'P-101 STOPPED', 'device');
  Pid.stepPid(dev, 0.5);
  assert.equal(dev.op, 80, 'and at OPHILM');
  // an interlock in MAN holds too, and a non-finite target is still the safe 0, now with no limit to lift it
  const man = mkLoop({ mode: 'MAN', op: 40, I: 40, oplolm: 10 });
  Pid.setTracking(man, NaN, 'R-201 HI TEMP TRIP', 'interlock');
  Pid.stepPid(man, 0.5);
  assert.equal(man.trk.target, 0);
  assert.equal(man.op, 0, 'in MAN, with OPLOLM 10, the interlocked output is still 0');
  // the release is the ordinary scan, clamped into the limits, and its values are exact: PV 40 against SP 50 leaves P = 10, and the integrator tracked the
  // held output (I = OP - P). From the held 0 under OPLOLM 20 the scan gives P + I = 0 plus one integral increment of 0.083, up to OPLOLM 20, with the
  // integrator back-calculated to OP - P = 10. From the held 90 over OPHILM 80 it gives 90, down to OPHILM 80, with the integrator back-calculated to 70.
  // Either way the next scan starts from the output the loop really has
  const low = mk();
  Pid.setTracking(low, 0, 'R-201 HI TEMP TRIP', 'interlock');
  Pid.stepPid(low, 0.5);
  assert.equal(low.I, -10);
  Pid.clearTracking(low);
  Pid.stepPid(low, 0.5);
  assert.equal(low.op, 20, 'released from a held 0, the first output is OPLOLM');
  assert.equal(low.I, 10, 'with the integrator back-calculated to it');
  Pid.clearTracking(il);
  il.mode = 'AUTO';
  Pid.stepPid(il, 0.5);
  assert.equal(il.op, 80, 'released from the held 90, the first output is OPHILM');
  assert.equal(il.I, 70);
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

// CR40 (credibility pass S2): a flow loop whose setpoint is at or below its low-flow cutoff drives its output to the low limit. The
// transmitter reads 0 below the cutoff, so a loop at SP 0 with an observed 0 saw no error: it froze its output wherever the integral
// tail left it (0.803 % on FIC211) and the valve kept passing a flow the loop could not see. A zero setpoint means no flow, not no
// error. The plant sets spCutoff on the M3/H loops from the measurement policy; a loop without the field is untouched.
test('CR40: a setpoint at or below spCutoff drives OP to OPLOLM exactly, with the integrator tracked; the frozen 0.803 % output is released', () => {
  // the state the S2 measurement found: SP 0, observed PV 0 (under the 0.4 cutoff), OP stuck at 0.803
  const stuck = mkLoop({ tag: 'FIC211', hi: 40, sp: 0, pv: 0, op: 0.803, I: 0.803, K: 0.4, T1: 0.15, spCutoff: 0.4 });
  Pid.stepPid(stuck, 0.5);
  assert.equal(stuck.op, 0);
  assert.equal(stuck.I, 0, 'tracked: I = OP - K*e with e = 0');
  // the low limit is the loop's own OPLOLM, and a setpoint exactly at the cutoff is shut off too
  const edge = mkLoop({ hi: 40, sp: 0.4, pv: 0, op: 30, I: 30, K: 0.4, T1: 0.15, spCutoff: 0.4, oplolm: 2 });
  Pid.stepPid(edge, 0.5);
  assert.equal(edge.op, 2);
  assert.equal(edge.I, 2 - edge.K * Pid.loopError(edge), 'tracked at the clamped output');
  // flow still decaying through the PI tail (observed PV above the cutoff): the output goes to the limit at once, not along the tail
  const tail = mkLoop({ hi: 40, sp: 0, pv: 5, op: 10, I: 10, K: 0.4, T1: 0.15, spCutoff: 0.4 });
  Pid.stepPid(tail, 0.5);
  assert.equal(tail.op, 0);
  assert.equal(tail.I, 0 - tail.K * Pid.loopError(tail));
  assert.equal(tail.I, 5);
  assert.equal(tail.lastPv, 5, 'the derivative memory is re-seeded as the hold path does');
  // just above the cutoff the loop controls
  const above = mkLoop({ hi: 40, sp: 0.4000001, pv: 0, op: 30, I: 30, K: 0.4, T1: 0.15, spCutoff: 0.4 });
  Pid.stepPid(above, 0.5);
  assert.ok(above.op > 2, 'control resumed above the cutoff: ' + above.op);
});

test('CR40: above the cutoff the loop is the old loop, to the last bit; a loop with no spCutoff is untouched', () => {
  const mk = (extra) => mkLoop(Object.assign({ tag: 'FIC211', hi: 40, sp: 0.5, pv: 0.3, op: 4, I: 4, K: 0.4, T1: 0.15 }, extra));
  const withCutoff = mk({ spCutoff: 0.4 }), without = mk({});
  for (let i = 0; i < 200; i++) {
    for (const l of [withCutoff, without]) { Pid.stepPid(l, 0.5); l.pv += (l.op * 0.4 - l.pv) * 0.5 / 6; }
    assert.deepEqual([withCutoff.op, withCutoff.I, withCutoff.pv, withCutoff.lastPv], [without.op, without.I, without.pv, without.lastPv], 'scan ' + i);
  }
  // no field, SP 0, observed 0: the loop sees no error and keeps its output, as before
  const none = mk({ sp: 0, pv: 0, op: 0.803, I: 0.803 });
  Pid.stepPid(none, 0.5);
  assert.equal(none.op, 0.803);
});

test('CR40: the release is bumpless: the integrator was tracked, so the first controlled output is the proportional kick of the setpoint step plus one integration step, not the stale integral', () => {
  const l = mkLoop({ hi: 40, sp: 0, pv: 0.3, op: 6, I: 6, K: 0.4, T1: 0.15, spCutoff: 0.4 });
  for (let i = 0; i < 5; i++) { Pid.stepPid(l, 0.5); assert.equal(l.op, 0); assert.equal(l.I, l.op - l.K * Pid.loopError(l), 'tracked on scan ' + i); }
  const eShut = Pid.loopError(l);               // the error the integrator was tracked against
  l.sp = 0.5;                                   // the setpoint rises above the cutoff; the flow has not moved
  const eNow = Pid.loopError(l);
  Pid.stepPid(l, 0.5);
  const kick = l.K * (eNow - eShut), oneStep = l.K * eNow * 0.5 / (l.T1 * 60);
  assert.ok(Math.abs(l.op - (0 + kick + oneStep)) < 1e-12, 'first controlled output ' + l.op + ' vs the shutoff output 0 + kick ' + kick + ' + one step ' + oneStep);
  assert.ok(l.op < 1, 'an untracked integrator would have carried the stale 6 % into this output: ' + l.op);
});

test('CR40: not in MAN and not held by tracking: a MAN loop, a tracking loop and a bad-PV loop keep their own paths below the cutoff', () => {
  const man = mkLoop({ hi: 40, mode: 'MAN', sp: 0, pv: 0, op: 30, I: 30, K: 0.4, T1: 0.15, spCutoff: 0.4 });
  Pid.stepPid(man, 0.5);
  assert.equal(man.op, 30, 'MAN: no control action, so no shutoff');
  const trk = mkLoop({ hi: 40, sp: 0, pv: 0, op: 30, I: 30, K: 0.4, T1: 0.15, spCutoff: 0.4 });
  Pid.setTracking(trk, 50, 'TEST', 'interlock');
  Pid.stepPid(trk, 0.5);
  assert.equal(trk.op, 50, 'a tracking request wins over the shutoff');
  const bad = mkLoop({ hi: 40, sp: 0, pv: 0, op: 30, I: 30, K: 0.4, T1: 0.15, spCutoff: 0.4, badPv: true });
  Pid.stepPid(bad, 0.5);
  assert.equal(bad.op, 30, 'a bad PV holds the output, as before');
});

test('CR40: the shutoff does not apply PV tracking: a pvtrack loop in AUTO at SP 0 keeps SP 0 and stays closed while the flow dies away', () => {
  // FIC102 as the plant has it, in AUTO. PV tracking belongs to loops that are not controlling (MAN, hold); applied here it would
  // overwrite the demanded 0 with the flow still running and the loop would re-open on the next scan.
  const l = mkLoop({ tag: 'FIC102', hi: 120, pvtrack: true, sp: 0, pv: 60, op: 50, I: 50, K: 0.4, T1: 0.15, sphilm: 80, splolm: 0, spCutoff: 1.2 });
  for (let i = 0; i < 400; i++) {
    Pid.stepPid(l, 0.5);
    assert.equal(l.sp, 0, 'SP is the demand, scan ' + i);
    assert.equal(l.op, 0, 'closed, scan ' + i);
    l.pv += (l.op - l.pv) * 0.5 / 5;
  }
  assert.ok(l.pv < 1.2, 'the flow has fallen under the cutoff: ' + l.pv);
});

// CR40b: the shutoff is for a loop that owns its setpoint (AUTO). A cascade secondary in CAS takes its setpoint from its master every scan, and
// that demand passing through the band under the cutoff on a cascade return (FIC102 after an R-201 trip releases) is not an instruction to stop:
// the master's output limit and the plant's interlock and device holds close the valve where that is meant.
test('CR40b: a CAS loop under the cutoff keeps following its master with no shutoff; the same loop in AUTO is shut', () => {
  const master = mkLoop({ tag: 'LIC101', slave: 'FIC102', act: 'DIR', sp: 50, pv: 50, op: 0.5 / 1.2, I: 0.5 / 1.2, K: 1.5, T1: 3 });
  const secondary = (mode) => mkLoop({ tag: 'FIC102', master: 'LIC101', mode, hi: 120, pvtrack: true, sp: 0.5, pv: 0, op: 0, I: 0, K: 0.4, T1: 0.15, sphilm: 80, splolm: 0, spCutoff: 1.2 });
  const ctxFor = (slave) => ({ loops: { LIC101: master, FIC102: slave }, casMap: { FIC102: (op) => op * 1.2 }, invMap: { FIC102: (sp) => sp / 1.2 } });
  // CAS: the master demands 0.5 M3/H, under the 1.2 cutoff. The loop follows it and controls.
  const cas = secondary('CAS');
  let prev = cas.op;
  for (let i = 0; i < 10; i++) {
    Pid.stepPid(cas, 0.5, ctxFor(cas));
    assert.equal(cas.sp, master.op * 1.2, 'the setpoint is the master demand, scan ' + i);
    assert.ok(cas.op > prev, 'controlling, not shut: ' + cas.op + ' after ' + prev + ', scan ' + i);
    prev = cas.op;
  }
  // AUTO: the same 0.5 M3/H is now the loop's own setpoint, a stop instruction. The loop is shut and the setpoint stands.
  const auto = secondary('AUTO');
  for (let i = 0; i < 10; i++) {
    Pid.stepPid(auto, 0.5, ctxFor(auto));
    assert.equal(auto.op, 0, 'shut, scan ' + i);
    assert.equal(auto.sp, 0.5, 'the setpoint is not overwritten, scan ' + i);
  }
});

// The predicate stepPid and the plant's Live Diagnosis share (S2 round 2 review): true exactly when the CR40 shutoff holds this loop on this
// scan. The saturation card reads an output parked at OPLOLM as "the disturbance exceeds this loop"; under the shutoff that is the stop
// instruction, not a saturation, so the card asks the same question stepPid does.
test('shutoff(loop): true exactly when the loop owns its setpoint (AUTO), is not held by tracking, has a good PV and sits at or below spCutoff; stepPid forces OPLOLM exactly there', () => {
  const mk = (o) => mkLoop(Object.assign({ tag: 'FIC313', hi: 40, sp: 0, pv: 0, op: 3, I: 3, K: 0.4, T1: 0.15, spCutoff: 0.4 }, o));
  const held = (kind, target) => { const l = mk({}); Pid.setTracking(l, target, 'TEST', kind); return l; };
  const cases = [
    ['AUTO, sp 0, cutoff 0.4', mk({}), true],
    ['sp exactly at the cutoff', mk({ sp: 0.4 }), true],
    ['sp just above the cutoff', mk({ sp: 0.4000001 }), false],
    ['no spCutoff', mk({ spCutoff: undefined }), false],
    ['spCutoff not finite', mk({ spCutoff: NaN }), false],
    ['MAN', mk({ mode: 'MAN' }), false],
    ['CAS secondary', mk({ mode: 'CAS', master: 'LIC101' }), false],
    ['bad PV', mk({ badPv: true }), false],
    ['interlock hold', held('interlock', 50), false],
    ['device hold (outside MAN)', held('device', 50), false],
  ];
  for (const [name, loop, expected] of cases) {
    assert.equal(Pid.shutoff(loop), expected, name);
    Pid.stepPid(loop, 0.5);                      // no ctx: a CAS loop keeps its own SP here, so it is not shut either
    assert.equal(loop.op === 0, expected, name + ': OP is at OPLOLM exactly when the predicate says the loop is shut (' + loop.op + ')');
  }
  // a device hold the operator overrode in MAN is not a hold: MAN is its own path, and the predicate is false there too
  const manHeld = held('device', 50); manHeld.mode = 'MAN';
  assert.equal(Pid.shutoff(manHeld), false);
});
