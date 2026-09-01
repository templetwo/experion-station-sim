// @artifact dev
// V3-PLAN S3/S4: A1-A12 reachable from the trainee Training Drills dialog via
// startADrillFromMenu. D-series remain a parallel lane. RANDOM DRILL stays D-only.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const DrillArch = require('../src/drill-arch.js');
const FaultEngine = require('../src/fault-engine.js');

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
  assert.deepEqual(names, DrillArch.DRILLS.map((d) => d.traineeTitle));
  for (const d of DrillArch.DRILLS) assert.ok(!names.includes(d.title), `${d.id}: trainee menu exposed answer-key title ${d.title}`);
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

test('live trainee A-drills withhold root-node health and exact-node debrief rows', () => {
  const symptomSignatures = {};
  for (const drill of DrillArch.DRILLS) {
    const c = boot();
    c.applyPreset(drill.basePreset);
    c.startADrill(drill.id);
    const onset = Math.max(...drill.faultTimeline.map((step) => step.tSec));
    // A1/A2 bridge into the normal BADPV/alarm path, whose annunciation has an
    // intentional on-delay. Observe that settled state, not the first onset tick.
    const settle = drill.id === 'A2' ? 40 : drill.id === 'A1' ? 20 : 1;
    for (let i = 0; i < (onset + settle) * 2; i++) c.step(0.5);
    assert.ok(c.P.aDrill && c.P.aDrill.events.some((event) =>
      event.actionType === DrillArch.ACTION.FAULT_PRESENT), `${drill.id}: fault did not become present`);

    c.setState({ display: 'arch', archMode: 'diagnose' });
    const diagnose = c.renderVals().arch;
    const nodes = diagnose.layers.flatMap((layer) => layer.nodes);
    assert.ok(nodes.every((node) => /\(Unknown\)$/.test(node.title)),
      `${drill.id}: live topology exposed a truth-backed health marker`);
    assert.ok(diagnose.observations.length > 0, `${drill.id}: no trainee-observable symptom survived root masking`);
    assert.ok(diagnose.observations.every((observation) => observation.source === 'DRILL_CUE'),
      `${drill.id}: architecture indications must retain their simulated-cue grade`);
    symptomSignatures[drill.id] = JSON.stringify(diagnose.observations);
    for (const step of drill.faultTimeline) {
      assert.ok(!symptomSignatures[drill.id].includes(step.faultId),
        `${drill.id}: symptom projection exposed fault id ${step.faultId}`);
      assert.ok(!symptomSignatures[drill.id].includes(step.targets[0]),
        `${drill.id}: symptom projection exposed root target ${step.targets[0]}`);
    }
    if (drill.id === 'A1') {
      assert.equal(c.L.FIC102.badPv, true);
      assert.ok(c.alarmEngine.active().some((alarm) => alarm.tag === 'FIC102' && alarm.cond === 'BADPV'));
      assert.match(symptomSignatures.A1, /BADPV/);
      assert.doesNotMatch(symptomSignatures.A1, /quality flag stays GOOD/i,
        'authored observations must agree with the bridged live board state');
    }
    if (drill.id === 'A2') {
      assert.equal(c.L.FIC211.badPv, true);
      assert.equal(c.L.FIC211.mode, 'MAN', 'the failed input must apply the configured quality shed');
      assert.match(symptomSignatures.A2, /BADPV/,
        'the architecture cue and the live input-quality state must agree');
    }
    if (drill.id === 'A4') {
      assert.equal(FaultEngine.isActive(c.P.archFaults, 'REDUNDANCY_SWITCHOVER', 'CTRL-U3'), true);
      assert.ok(c.events.some((event) => /REDUNDANCY SWITCHOVER/.test(event.desc)),
        'the brief switchover must produce a trainee-visible system event');
      for (let i = 0; i < 30; i++) c.step(0.5);
      assert.equal(FaultEngine.isActive(c.P.archFaults, 'REDUNDANCY_SWITCHOVER', 'CTRL-U3'), false,
        'the declared 15-second transient must self-clear');
      assert.deepEqual(Object.keys(c.P.trips).filter((key) => c.P.trips[key]), [],
        'the switchover must leave process control available');
      assert.ok(c.archTraineeSymptoms().observations.length > 0,
        'the injected cue must persist long enough to diagnose after the transient clears');
      assert.ok(c.events.some((event) => /SWITCHOVER COMPLETE/.test(event.desc)));
      const phases = c.archFaultTimeline().filter((row) => row.targetNodeId === 'CTRL-U3');
      assert.deepEqual(phases.map((row) => row.phase), ['ACTIVE', 'CLEAR']);
      assert.equal(phases[1].t - phases[0].t, 15000);
    }
    if (drill.id === 'A10') {
      const beforeGap = c.hist.FIC102.length;
      for (let i = 0; i < 20; i++) c.step(0.5);
      assert.equal(c.hist.FIC102.length, beforeGap,
        'HISTORIAN_GAP must produce a real sample gap while live control continues');
    }

    c.setState({ archMode: 'debrief' });
    const debrief = c.renderVals().arch.debrief;
    assert.ok(debrief.rows.every((row) => row.lane !== 'ARCH'),
      `${drill.id}: trainee debrief exposed an exact architecture health row`);
    for (const step of drill.faultTimeline) {
      assert.ok(!JSON.stringify(debrief).includes(step.targets[0]),
        `${drill.id}: trainee debrief exposed root target ${step.targets[0]}`);
    }
  }
  const engineOnlySamePreset = ['A6', 'A8', 'A9', 'A10', 'A11'].map((id) => symptomSignatures[id]);
  assert.equal(new Set(engineOnlySamePreset).size, engineOnlySamePreset.length,
    'same-preset architecture-only drills must remain distinguishable by observable symptoms');
  assert.match(symptomSignatures.A6, /U1 NETWORK PATH B/,
    'A6 must identify the observable degraded path so required evidence is not a guess');
  assert.match(symptomSignatures.A7, /U3 NETWORK PATH A/);
  assert.match(symptomSignatures.A7, /U3 NETWORK PATH B/,
    'A7 must identify both observable failed members of the redundant pair');
});

test('a new A-drill clears stale architecture selection that the fresh preset did not inspect', () => {
  const c = boot();
  c.setState({ display: 'arch', archMode: 'diagnose', archTag: 'FIC102', archPinTray: ['XMTR-FIC102'] });
  c.archSelectNode('XMTR-FIC102');
  assert.equal(c.state.archSel, 'XMTR-FIC102');
  assert.equal(c.P.archInspected['XMTR-FIC102'], true);

  c.setState({ dlg: { type: 'drills' } });
  c.renderVals().dg.archDrills.find((x) => x.id === 'A6').cb();

  assert.equal(c.state.archSel, null, 'the old highlighted node must not survive a fresh drill');
  assert.equal(c.state.archTag, null, 'the old trace path must not make the new drill look pre-inspected');
  assert.deepEqual(c.state.archPinTray, [], 'comparison staging is per exercise');
  assert.deepEqual(c.P.archInspected, {}, 'the canonical preset starts with no inspected nodes');
  assert.equal(c.renderVals().arch.hasInspector, false, 'no stale inspector may be visible');
});

test('A-drill replay rebuilds its canonical preset instead of replaying a truthful label onto stale state', () => {
  const c = boot();
  c.P.env.feedConc = 1.4;
  c.saveSlot(0, 'before canonical A6');
  c.setState({ dlg: { type: 'drills' } });
  c.renderVals().dg.archDrills.find((x) => x.id === 'A6').cb();
  const live = { feedConc: c.P.env.feedConc, t: c.P.t, id: c.P.aDrill.id };
  assert.equal(live.feedConc, 1);

  c.startReplay(0);
  c.replayToEnd();
  assert.deepEqual({ feedConc: c.P.env.feedConc, t: c.P.t, id: c.P.aDrill && c.P.aDrill.id }, live);
});

test('A-drill replay refuses an unknown canonical preset instead of arming on stale state', () => {
  const c = boot();
  c.instr.replay = { entries: [], i: 0, toT: c.P.t };
  c.applyJournalEntry({ op: 'ADRILL', tag: 'A1', t: c.P.t,
    preset: 'NOT_A_PRESET', presetBaseT: c.P.t });
  assert.equal(c.instr.replay, null);
  assert.equal(c.P.aDrill, null);
  assert.match(c.state.msg, /UNKNOWN/);
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
  d1.canonicalCb();
  assert.ok(c.state.drill, 'D1 must start');
  c.setState({ dlg: { type: 'drills' } });
  const a1 = c.renderVals().dg.archDrills.find((x) => x.id === 'A1');
  a1.cb();
  assert.equal(c.P.aDrill, null, 'startADrillFromMenu must refuse while a D-drill is running');
  assert.ok(c.state.drill, 'the running D-drill must be untouched');
});
