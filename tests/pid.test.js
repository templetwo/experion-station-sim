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
