// @artifact dev
// Credibility pass, stage S1: observed values and output tracking (docs/dev/CREDIBILITY-PASS-SPEC.md §2, §3).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Models = require('../src/models.js');
const CauseEffect = require('../src/cause-effect.js');
const AlarmHelp = require('../src/alarm-help.js');

// Point Detail rows come from the page's mRow(label,param,value,canEdit,note): read .value and .note.
const { Component } = load();
function boot(seed, sec) {
  const c = new Component({});
  c.initSim();
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
// Jacket cooling lost by the operator's own hand: TIC202 to MAN, OP 0, exactly the playtest's D7 repro.
function loseCooling(c) { c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 0); }

test('D7: the jacket transmitter saturates at its reporting limit and the loop record tracks the observed value', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110), 'the jacket model exceeded 110 C');
  const l = c.L.TIC202;
  assert.equal(l.pvObs, 103.125);
  assert.equal(l.obs.quality, 'UNCERTAIN');
  assert.equal(l.obs.limit, 'HIGH');
  assert.ok(l.pv > 103.125, 'the raw model value is untouched');
  c.step(0.5);
  assert.equal(l.lastPv, 103.125, 'the loop record tracks the observed value, not the model');
  const last = c.hist.TIC202[c.hist.TIC202.length - 1];
  assert.equal(last[1], 103.125, 'the trend pen carries the observed value');
});

test('D7: alarms evaluate the observed value and report it', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.alarms.some((a) => a.tag === 'TIC202' && a.cond === 'PVHH' && a.active)), 'PVHH raised');
  const a = c.alarms.find((x) => x.tag === 'TIC202' && x.cond === 'PVHH' && x.active);
  assert.ok(a.val <= 103.125, 'the alarm value is the reported value, never the model value: ' + a.val);
});

test('measure() is idempotent and writes obs for every pid and ind point', () => {
  const c = boot(4);
  c.step(0.5);
  for (const k in c.L) { const l = c.L[k]; if (l.kind === 'pid' || l.kind === 'ind') { assert.ok(l.obs, k); assert.equal(typeof l.pvObs, 'number', k); } }
  const before = JSON.stringify(c.L.TIC201.obs);
  c.measure();
  assert.equal(JSON.stringify(c.L.TIC201.obs), before);
});

test('a bad PV keeps the raw value as pvObs so the shed path is unchanged', () => {
  const c = boot(4, 'OPER');
  c.injectFault('xmtr', true);                 // FIC102 transmitter fault -> badPv after its hold time
  assert.ok(run(c, 600, () => c.L.FIC102.badPv), 'FIC102 went bad');
  assert.equal(c.L.FIC102.obs.quality, 'BAD');
  assert.equal(c.L.FIC102.pvObs, c.L.FIC102.pv);
});

// Beyond the brief's four: the D7 alarm test above raises PVHH at 85, well inside the window, so
// the model value and the reported value agree when it fires and it cannot tell the two apart.
test('D7: the alarm scan evaluates and reports the observed value, not the model value', () => {
  const c = boot(4, 'OPER');
  const l = c.L.TIC202;
  l.pv = 120;                                   // the model is far past anything the transmitter can send
  l.alm.PVHH = [105, 'Urgent', 12];             // a limit above the reporting window: no report can ever reach it
  c.measure();
  c.scan(0.5);
  const hi = c.alarms.find((a) => a.tag === 'TIC202' && a.cond === 'PVHI');
  assert.ok(hi && hi.active, 'PVHI (70) raised from the reported value');
  assert.equal(hi.val, 103.125, 'the alarm carries the value the transmitter reports');
  assert.ok(!c.alarms.some((a) => a.tag === 'TIC202' && a.cond === 'PVHH' && a.active), 'a limit above the window is never reached by what the transmitter reports');
});

test('measure() runs after the models and before the controllers and the alarm scan (spec §2.3)', () => {
  const c = boot(4);
  const order = [];
  for (const name of ['stepU4', 'measure', 'pids', 'scan']) { const f = c[name].bind(c); c[name] = (...a) => { order.push(name); return f(...a); }; }
  c.step(0.5);
  assert.deepEqual(order, ['stepU4', 'measure', 'pids', 'scan']);
});

test('measure() falls back to the raw value when the observed value is not finite (CR9)', () => {
  const c = boot(4);
  const M = globalThis.ESS.Measurement, real = M.observe;
  M.observe = () => ({ pv: NaN, badPv: false, quality: 'GOOD', statusCode: 0, statusName: 'Good', limit: 'NONE' });
  try { c.measure(); } finally { M.observe = real; }
  assert.equal(c.L.TIC201.pvObs, c.L.TIC201.pv, 'a NaN never reaches the controller through pvObs');
});
