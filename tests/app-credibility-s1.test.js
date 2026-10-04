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

test('D14: fmt never prints a negative zero at any precision', () => {
  const c = boot(1);
  assert.equal(c.fmt(-0.04, 1), '0.0');
  assert.equal(c.fmt(-0.004, 2), '0.00');
  assert.equal(c.fmt(-0.4, 0), '0');
  assert.equal(c.fmt(-0.00004, 4), '0.0000');
  assert.equal(c.fmt(-0.6, 0), '-1');
  assert.equal(c.fmt(-1.26, 1), '-1.3');
  assert.equal(c.fmt(null, 1), '—');
});

test('D7: the page renders the observed value and hatches an uncertain reading', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  const l = c.L.TIC202;
  assert.equal(c.pvShown(l), 103.125);
  assert.equal(c.hatchOp(l), 0.45);
  assert.equal(c.hatchOp(c.L.TIC201), 0);
  c.nav('detail', 'TIC202');
  const v = c.renderVals();
  const pvRow = v.dpt.mainRows.find((r) => r.param === 'PV');
  assert.match(pvRow.value, /^103\.1 /);
  assert.match(pvRow.note, /UNCERTAIN/);
});

test('a bad PV still hatches at full strength', () => {
  const c = boot(4, 'OPER');
  c.injectFault('xmtr', true);
  assert.ok(run(c, 600, () => c.L.FIC102.badPv));
  assert.equal(c.hatchOp(c.L.FIC102), 0.85);
});

// Beyond the brief's three: its D7 test reaches the helpers and the Point Detail row. These pin the
// other consumers of the observed value (the graphic value box, the faceplate, the band note, the
// data-acquisition row) and the helpers' on-the-fly fallback, so a regression in the page's wiring
// cannot pass unseen. Only the graphic value box hatches; the faceplate has no hatch to show.
test('D7: the graphic value box, the faceplate and the band note show the observed value; only the box hatches', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  assert.ok(c.L.TIC202.pv > 110, 'the model value is past 110, so a raw read would print it');
  c.openFp('TIC202');
  c.nav('detail', 'TIC202');
  const v = c.renderVals();
  const box = v.gvList.find((g) => g.tag === 'TIC202');
  assert.equal(box.pvT, '103.1');
  assert.equal(box.hatchOp, 0.45);
  assert.equal(v.gvList.find((g) => g.tag === 'TIC201').hatchOp, 0);
  assert.equal(v.fps.find((f) => f.tag === 'TIC202').pvT, '103.1');
  assert.match(v.dpt.bandNote, /^PV 103\.1 DEG C is /);
});

test('D14: a small flow reads 0.0 on the graphic, the faceplate and the band note; a reading that rounds to -0.0 prints 0.0', () => {
  const c = boot(4, 'OPER');
  c.L.FIC211.pv = -0.3;                         // inside the low-flow cutoff: 1 % of the 40 M3/H span is 0.4
  c.L.TIC202.pv = -0.04;                        // not a flow: inside the window, reported as read, rounds to -0.0
  c.measure();
  c.openFp('FIC211');                           // an unpinned faceplate closes when another opens, so one at a time
  c.nav('detail', 'FIC211');
  let v = c.renderVals();
  assert.equal(v.gv2.find((g) => g.tag === 'FIC211').pvT, '0.0');
  assert.equal(v.gvList.find((g) => g.tag === 'TIC202').pvT, '0.0');
  assert.equal(v.fps.find((f) => f.tag === 'FIC211').pvT, '0.0');
  assert.match(v.dpt.bandNote, /^PV 0\.0 M3\/H is inside the target band\./, 'judged on the observed 0.0; the raw -0.3 sits below the range');
  c.L.FIC211.pv = 0.3;                          // a positive flow inside the cutoff, so the bar can tell raw from observed
  c.measure();
  const fic = c.renderVals().fps.find((f) => f.tag === 'FIC211');
  assert.equal(fic.pvT, '0.0');
  assert.equal(fic.pvH, 0, 'the faceplate bar follows the observed value, which the cutoff reports as zero');
  c.openFp('TIC202');
  v = c.renderVals();
  assert.equal(v.fps.find((f) => f.tag === 'TIC202').pvT, '0.0');
});

test('D7: a data-acquisition point reports through the same window on the graphic and in Point Detail', () => {
  const c = boot(4, 'OPER');
  c.L.TI312.pv = 700;                           // 0-600 DEG C: the transmitter reports at most 618.75
  c.measure();
  c.nav('detail', 'TI312');
  const v = c.renderVals();
  const box = v.gv3.find((g) => g.tag === 'TI312');
  assert.equal(box.pvT, '619');
  assert.equal(box.hatchOp, 0.45);
  assert.equal(v.dpt.mainRows.find((r) => r.param === 'PV').value, '619 DEG C');
});

test('pvShown and hatchOp observe on the fly when a point has no observation yet', () => {
  const c = boot(1);
  const l = c.L.TIC202;
  delete l.obs;
  l.pv = 120;
  assert.equal(c.pvShown(l), 103.125);
  assert.equal(c.hatchOp(l), 0.45);
  assert.equal(c.pvShown(c.L.P101), c.L.P101.pv, 'a motor has no transmitter window');
  assert.equal(c.hatchOp(c.L.P101), 0);
});

test('D14: a data-acquisition flow below the cutoff reads zero in its faceplate number and indicator bar', () => {
  const c = boot(4, 'OPER');
  c.L.FI100.pv = 1;                             // FI100 is an indicator: 1 M3/H is inside the cutoff (1 % of 150 is 1.5)
  c.measure();
  c.openFp('FI100');
  const fp = c.renderVals().fps.find((f) => f.tag === 'FI100');
  assert.equal(fp.pvT, '0.0');
  assert.equal(fp.indH, 0, 'the indicator bar follows the observed value, not the raw 1 M3/H');
});
