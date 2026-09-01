// @artifact dev
// Regression contracts from the first Witness Relay A-drill campaign.
//
// Two failures had the same shape: the drill copy promised an observable path that
// the scoring/model wiring did not actually provide. These tests pin the repaired
// contracts at the pure-module seams, before any browser UI is involved.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const DrillArch = require('../src/drill-arch.js');
const FaultEngine = require('../src/fault-engine.js');
const Models = require('../src/models.js');
const Topology = require('../src/topology.js');

const ENGINE_ONLY = ['A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11'];

function entryFor(action, seq) {
  const entry = {
    seq,
    simTime: seq * 1000,
    actor: 'TRAINEE',
    actionType: action.actionType,
    accepted: true,
  };
  if (action.target !== undefined) entry.target = Array.isArray(action.target) ? action.target[0] : action.target;
  if (action.payloadMatch) entry.payload = JSON.parse(JSON.stringify(action.payloadMatch));
  return entry;
}

function faultReceipt(id, simTime = 0) {
  return { seq: 0, simTime, actor: 'SYSTEM', actionType: DrillArch.ACTION.FAULT_PRESENT,
    target: id, payload: { timelineIndex: 0 }, accepted: true };
}

test('engine-only drills require safe completion, not an ACK for an alarm they never raise', () => {
  for (const id of ENGINE_ONLY) {
    const drill = DrillArch.drillById(id);
    assert.equal(drill.stabilizationPolicy, 'SAFE_RESTRAINT', id);
    assert.equal(drill.expectedActions.some((action) => action.actionType === DrillArch.ACTION.ACK), false,
      `${id}: an engine-only architecture indication must not ask for a fabricated process-alarm ACK`);

    const journal = [faultReceipt(id)].concat(drill.expectedActions.map((action, index) => entryFor(action, index + 1)));
    const score = DrillArch.scoreDrill(id, journal);
    assert.equal(score.score, 100, `${id}: a complete, ungated diagnostic workflow must be able to earn full credit`);
    assert.equal(score.pass, true, `${id}: the published ${DrillArch.PASS_MARK} pass mark must be reachable`);
    assert.equal(score.breakdown.find((row) => row.category === 'stabilize').earned,
      drill.scoringRules.find((row) => row.category === 'stabilize').weight,
      `${id}: completing the workflow without an unsafe move demonstrates safe restraint`);
  }
});

test('safe-restraint credit is neither automatic nor available after a major unsafe action', () => {
  const drill = DrillArch.drillById('A2');
  assert.equal(DrillArch.scoreDrill('A2', []).score, 0, 'an empty run demonstrates nothing');

  const incomplete = [faultReceipt('A2')].concat(drill.expectedActions
    .filter((action) => action.category !== 'debrief')
    .map((action, index) => entryFor(action, index + 1)));
  const beforeCompletion = DrillArch.scoreDrill('A2', incomplete);
  assert.equal(beforeCompletion.breakdown.find((row) => row.category === 'stabilize').earned, 0,
    'restraint is demonstrated only by completing the diagnostic workflow');

  const complete = [faultReceipt('A2')].concat(drill.expectedActions.map((action, index) => entryFor(action, index + 1)));
  const gate = drill.safetyGate[0];
  complete.push(entryFor(gate, 999));
  const unsafe = DrillArch.scoreDrill('A2', complete);
  assert.equal(unsafe.gated, true);
  assert.equal(unsafe.breakdown.find((row) => row.category === 'stabilize').earned, 0,
    'a major unsafe move is evidence against safe restraint, even if the diagnosis was later completed');
  assert.equal(unsafe.pass, false);
});

test('ACK-policy drills retain accepted ACK scoring', () => {
  for (const id of ['A1', 'A12']) {
    const drill = DrillArch.drillById(id);
    assert.equal(drill.stabilizationPolicy, 'ACK', id);
    const ack = drill.expectedActions.find((action) => action.category === 'stabilize');
    assert.ok(ack, `${id}: missing stabilize action`);
    assert.equal(ack.actionType, DrillArch.ACTION.ACK, id);
    const score = DrillArch.scoreDrill(id, [faultReceipt(id), entryFor(ack, 1)]);
    assert.equal(score.breakdown.find((row) => row.category === 'stabilize').earned,
      drill.scoringRules.find((row) => row.category === 'stabilize').weight, id);
  }
});

test('an architecture drill cannot pass before its fault is present or without every required action', () => {
  for (const id of DrillArch.drillIds()) {
    const drill = DrillArch.drillById(id);
    const allActions = drill.expectedActions.map((action, index) => entryFor(action, index + 1));
    const premature = DrillArch.scoreDrill(id, allActions);
    assert.equal(premature.score, 0, `${id}: pre-fault checklist earned credit`);
    assert.equal(premature.pass, false, `${id}: passed without a fault-present receipt`);
    assert.equal(premature.causalReady, false);

    const withoutLocalization = [faultReceipt(id)].concat(allActions.filter((entry) =>
      entry.actionType !== DrillArch.ACTION.SUBMIT_HYPOTHESIS));
    const incomplete = DrillArch.scoreDrill(id, withoutLocalization);
    assert.equal(incomplete.pass, false, `${id}: passed without the required localization`);
    assert.ok(incomplete.missingRequired.includes('LOC'), `${id}: missing LOC was not named`);
  }
});

test('architecture credit follows evidence, binding hypothesis, verification, then debrief', () => {
  const id = 'A6';
  const drill = DrillArch.drillById(id);
  const byId = Object.fromEntries(drill.expectedActions.map((action) => [action.id, action]));
  const reverse = ['DEB', 'VER', 'LOC', 'EV2', 'EV1'].map((actionId, index) => entryFor(byId[actionId], index + 1));
  const bad = DrillArch.scoreDrill(id, [faultReceipt(id)].concat(reverse));
  assert.equal(bad.pass, false, 'a reverse checklist is not a causal diagnostic workflow');
  assert.ok(bad.missingRequired.includes('LOC'));
  assert.ok(bad.missingRequired.includes('VER'));
  assert.ok(bad.missingRequired.includes('DEB'));
  assert.equal(bad.workflowReady, false);

  const ordered = ['EV1', 'EV2', 'LOC', 'VER', 'DEB'].map((actionId, index) => entryFor(byId[actionId], index + 1));
  const good = DrillArch.scoreDrill(id, [faultReceipt(id)].concat(ordered));
  assert.equal(good.score, 100);
  assert.equal(good.pass, true);
  assert.equal(good.workflowReady, true);
});

test('localization is one binding hypothesis, not credit for spraying every layer', () => {
  const id = 'A2';
  const drill = DrillArch.drillById(id);
  const nonLoc = drill.expectedActions.filter((action) => action.id !== 'LOC')
    .map((action, index) => entryFor(action, index + 10));
  const guesses = ['FIELD', 'IO', 'CONTROL', 'NETWORK', 'SERVICE', 'HMI', 'INFORMATION'].map((domain, index) => ({
    seq: index + 1, simTime: index + 1, actor: 'TRAINEE', actionType: DrillArch.ACTION.SUBMIT_HYPOTHESIS,
    target: null, payload: { domain }, accepted: true,
  }));
  const score = DrillArch.scoreDrill(id, [faultReceipt(id)].concat(guesses, nonLoc));
  assert.equal(score.breakdown.find((row) => row.category === 'localization').earned, 0,
    'the later correct IO guess must not erase the first binding FIELD hypothesis');
  assert.equal(score.pass, false);

  const { Component } = load();
  const c = new Component({});
  c.initSim();
  c.applyPreset(drill.basePreset);
  c.startADrill(id);
  c.setState({ archMode: 'diagnose' });
  c.submitHypothesis('SERVICE');
  for (let i = 0; i < 130; i++) c.step(0.5);
  c.submitHypothesis('FIELD');
  c.submitHypothesis('IO');
  const accepted = c.P.aDrill.events.filter((event) => event.accepted !== false &&
    event.actionType === DrillArch.ACTION.SUBMIT_HYPOTHESIS);
  const onset = c.P.aDrill.events.find((event) => event.actionType === DrillArch.ACTION.FAULT_PRESENT);
  const eligible = accepted.filter((event) => event.simTime >= onset.simTime);
  assert.equal(accepted.length, 2, 'the early record and one adjudicable post-onset hypothesis must be retained');
  assert.equal(accepted[0].payload.domain, 'SERVICE');
  assert.equal(eligible.length, 1, 'the app must retain one adjudicable post-onset hypothesis per run');
  assert.equal(eligible[0].payload.domain, 'FIELD');
  assert.match(c.state.msg, /already recorded/i);
});

test('a biased-measurement instance carries direction and resolves a deterministic engineering-unit offset', () => {
  const { Component } = load();
  const component = new Component({});
  component.initSim();
  const graph = Topology.build({
    L: component.L,
    V: component.V,
    assetTree: component.assetTree(),
    unitOf: (tag) => component.unitOf(tag),
  });

  const low = FaultEngine.activate(FaultEngine.createState(), graph, {
    faultId: 'BIASED_MEASUREMENT',
    targetNodeId: 'XMTR-TIC201',
    simTime: 1000,
    magnitude: 2,
    direction: 'LOW',
  });
  assert.equal(low.instance.direction, 'LOW');
  assert.equal(FaultEngine.measurementBias(low.state, 'XMTR-TIC201', 1000, 200), 0);
  assert.equal(FaultEngine.measurementBias(low.state, 'XMTR-TIC201', 61000, 200), -4,
    '2 % span/min on a 200-degree span is a 4-degree low bias after one minute');
  assert.equal(FaultEngine.measurementBias(low.state, 'XMTR-TIC201', 121000, 200), -8);

  const high = FaultEngine.activate(FaultEngine.createState(), graph, {
    faultId: 'BIASED_MEASUREMENT',
    targetNodeId: 'XMTR-TIC201',
    simTime: 1000,
    magnitude: 2,
    direction: 'HIGH',
  });
  assert.equal(FaultEngine.measurementBias(high.state, 'XMTR-TIC201', 61000, 200), 4);
  assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, {
    faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-TIC201', magnitude: 2, direction: 'SIDEWAYS',
  }), /direction/);
});

function modelRig(seed, measurementBias) {
  const { Component } = load();
  const component = new Component({});
  component.initSim();
  component.P = Models.createState(1700000000000);
  const calls = [];
  const context = {
    raise: (...args) => component.raiseA(...args),
    clear: (...args) => component.clearA(...args),
    tripMotor: (...args) => component.tripMotor(...args),
    addEvent: (...args) => component.addEvent(...args),
    rand: Models.createRand(seed),
    shed: (point) => component.applyShed(point),
    message: (message) => component.msgZone(message),
    onTrip: () => {},
    measurementBias: (tag, simTime, span) => {
      calls.push({ tag, simTime, span });
      return measurementBias ? measurementBias(tag, simTime, span) : 0;
    },
  };
  const tick = () => {
    Models.advanceClock(component.P, 0.5);
    Models.stepU1(component.P, component.L, component.V, 0.5, context);
    component.pids(0.5);
    component.scan(0.5);
  };
  return { component, calls, tick };
}

test('the model applies TIC201 bias before controller action, so the rendered error changes the process', () => {
  const control = modelRig(77, () => 0);
  let onset = null;
  const biased = modelRig(77, (tag, simTime, span) => tag === 'TIC201'
    ? -2 * span / 100 * Math.max(0, simTime - (onset == null ? simTime : onset)) / 60000
    : 0);

  // A12 starts from the same high-feed condition: LIC101 draws the tank toward a
  // lower level by raising the cascaded FIC102 feed demand. Settle both independent,
  // seed-matched rigs before the bias onset so the fault is the only divergence.
  control.component.L.LIC101.sp = 40;
  biased.component.L.LIC101.sp = 40;
  for (let i = 0; i < 960; i++) { control.tick(); biased.tick(); }
  onset = biased.component.P.t;
  biased.calls.length = 0;
  const firstBiasedStepTime = onset + 500;

  control.tick();
  biased.tick();
  const c = control.component;
  const b = biased.component;
  const relativeShift = (b.L.TIC201.pv - b.P.rT) - (c.L.TIC201.pv - c.P.rT);
  assert.ok(Math.abs(relativeShift + (2 / 60)) < 1e-9, `TIC201 measurement shift was ${relativeShift}, expected a 2 % span/min low ramp`);
  assert.deepEqual(biased.calls[0], { tag: 'TIC201', simTime: firstBiasedStepTime, span: 200 });

  for (let i = 0; i < 360; i++) { control.tick(); biased.tick(); }
  assert.ok(b.L.TIC201.op > c.L.TIC201.op + 5,
    `the low reading must make TIC201 demand a warmer jacket: biased OP ${b.L.TIC201.op}, control ${c.L.TIC201.op}`);
  assert.ok(b.L.TIC202.sp > c.L.TIC202.sp + 3,
    `the cascade slave SP must carry that response: biased ${b.L.TIC202.sp}, control ${c.L.TIC202.sp}`);
  assert.ok(b.P.rT > c.P.rT + 0.5,
    `the controller response must heat the real reactor, not merely redraw the PV: biased ${b.P.rT}, control ${c.P.rT}`);

});

test('A12 copy claims only the deterministic measurement/controller/process chain', () => {
  const drill = DrillArch.drillById('A12');
  const step = drill.faultTimeline[0];
  assert.equal(drill.title, 'Causal measurement bias');
  assert.equal(step.faultId, 'BIASED_MEASUREMENT');
  assert.equal(step.targets[0], 'XMTR-TIC201');
  assert.equal(step.direction, 'LOW');
  assert.match(step.note, /master controller responds to the bad reading by raising the cascade demand/i);
  assert.match(drill.objectives.join(' '), /FIELD layer/i);
  assert.doesNotMatch(JSON.stringify(drill), /downstream alarms|alarms and safeguards|protective response|R201_TRIP/i,
    'A12 must not promise an alarm or safeguard cascade the deterministic model does not produce');
});
