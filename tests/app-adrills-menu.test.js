// @artifact dev
// V3-PLAN S3/S4: A1-A12 reachable from the trainee Training Drills dialog via
// startADrillFromMenu. D-series remain a parallel lane. RANDOM DRILL stays D-only.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const DrillArch = require('../src/drill-arch.js');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  return c;
}

test('Training Drills dialog lists A1-A12 and START calls startADrillFromMenu', () => {
  const c = boot();
  c.setState({ dlg: { type: 'drills' } });
  const v = c.renderVals();
  assert.equal(v.dg.isDrills, true);
  const ids = (v.dg.archDrills || []).map((x) => x.id);
  assert.deepEqual(ids, DrillArch.drillIds(), 'dialog A-series must be the live DrillArch library, not a hard-coded list');
  assert.equal(ids.length, 12);
  const names = v.dg.archDrills.map((x) => x.name);
  assert.ok(names.every((n) => typeof n === 'string' && n.length > 0));
});

test('A6 START from the dialog loads U1_SS, arms the drill, and opens ARCH Diagnose', () => {
  const c = boot();
  c.setState({ dlg: { type: 'drills' } });
  const a6 = c.renderVals().dg.archDrills.find((x) => x.id === 'A6');
  assert.ok(a6, 'A6 must be listed');
  a6.cb();
  assert.equal(c.P.aDrill && c.P.aDrill.id, 'A6');
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archMode, 'diagnose');
  assert.equal(c.state.dlg, null, 'the dialog must close on START');
  const arch = c.renderVals().arch;
  assert.ok(arch.modeChips.some((m) => (m.id || m.label || '').toLowerCase().includes('diagnose')),
    'Diagnose chip must be present: ' + JSON.stringify((arch.modeChips || []).map((m) => m.label || m.id)));
  assert.ok(!arch.modeChips.some((m) => m.label === 'LEARN'), 'Learn is hidden while an A-drill is active');
});

test('the in-progress banner and End Active Drill both address the A-drill lane', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  const v = c.renderVals();
  assert.equal(v.db.on, true, 'A-drill must raise the in-progress banner');
  v.db.end();
  assert.equal(c.P.aDrill, null, 'banner END must call endADrill');
});

test('a running D-drill blocks the A-series START button, and the reverse still holds', () => {
  const c = boot();
  c.setState({ dlg: { type: 'drills' } });
  const v = c.renderVals();
  const d1 = v.dg.drills.find((x) => x.id === 'D1');
  d1.cb();
  assert.ok(c.state.drill, 'D1 must start');
  c.setState({ dlg: { type: 'drills' } });
  const a1 = c.renderVals().dg.archDrills.find((x) => x.id === 'A1');
  a1.cb();
  assert.equal(c.P.aDrill, null, 'startADrillFromMenu must refuse while a D-drill is running');
  assert.ok(c.state.drill, 'the running D-drill must be untouched');
});
