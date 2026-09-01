// @artifact dev
// Tag-audit finding 1: A-drill replay must reproduce retained events and score.
// Snapshot, four accepted TRAINING.* actions, startReplay + replayToEnd.
// The mid-drill restore test in drill-arch-fixtures.test.js is NOT this probe.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const DrillArch = require('../src/drill-arch.js');
const { run } = require('./_fixture');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  c.instr.auth = true;
  c.setState({ sec: 'MNGR' });
  return c;
}

function fourTraining(c) {
  c.setState({ archMode: 'diagnose' });
  c.archSelectNode('XMTR-FIC102');
  c.markEvidence('XMTR-FIC102');
  c.archSelectNode('VLV-FV102');
  c.togglePin('XMTR-FIC102');
  c.togglePin('VLV-FV102');
  c.comparePins();
  c.submitHypothesis('FIELD');
  c.archSelectNode('XMTR-FIC102');
  c.verifyNode('XMTR-FIC102');
}

test('replay refuses unknown operations and drill ids instead of consuming them', () => {
  for (const entry of [
    { op: 'FUTURE_OP', tag: 'X' },
    { op: 'DRILL', tag: 'D99', startMode: 'LIVE STATE' },
    { op: 'ADRILL', tag: 'A99' }
  ]) {
    const c = boot();
    c.instr.replay={entries:[entry],i:1,toT:c.P.t};
    c.applyJournalEntry(Object.assign({t:c.P.t},entry));
    assert.equal(c.instr.replay,null,entry.op+' must stop replay');
    assert.match(c.state.msg,/REPLAY REFUSED/);
    assert.equal(c.state.drill,null);
    assert.equal(c.P.aDrill,null);
  }
});

test('A1 TRAINING replay reproduces retained events and score (gate 3)', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.saveSlot(0, 'pre-a1');
  c.startADrill('A1');
  run(c, 75);
  fourTraining(c);

  const beforeEvents = (c.P.aDrill.events || []).filter((e) => e.accepted !== false);
  const before = DrillArch.scoreDrill('A1', c.P.aDrill.events.slice());
  assert.equal(beforeEvents.length, 5, 'test setup: expected one fault receipt plus four accepted TRAINING actions, got ' + beforeEvents.length);
  assert.equal(before.score, 60);

  c.startReplay(0);
  c.replayToEnd();

  assert.equal(c.P.aDrill && c.P.aDrill.id, 'A1', 'ADRILL must re-arm');
  const afterEvents = (c.P.aDrill.events || []).filter((e) => e.accepted !== false);
  const after = DrillArch.scoreDrill('A1', (c.P.aDrill.events || []).slice());
  assert.equal(afterEvents.length, beforeEvents.length,
    'replay dropped TRAINING actions: before ' + beforeEvents.length + ' after ' + afterEvents.length +
    ' last reasons ' + JSON.stringify((c.P.aDrill.events || []).map((e) => e.reason || e.actionType)));
  assert.equal(after.score, before.score, 'replay score moved: before ' + before.score + ' after ' + after.score);
});

test('A-drill Debrief submit earns the debrief category from the UI path', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  run(c, 75);
  fourTraining(c);
  const before = DrillArch.scoreDrill('A1', c.P.aDrill.events.slice());
  assert.equal(before.score, 60);

  c.setState({ display: 'arch', archMode: 'debrief' });
  const v = c.renderVals();
  assert.equal(v.arch.debriefOn, true);
  assert.equal(v.arch.debrief.ask, true, 'finalization must be offered while an A-drill is active');
  v.arch.debrief.submit();
  const after = DrillArch.scoreDrill('A1', c.P.aDrill.events.slice());
  assert.equal(after.score, 70, 'correct debrief should add the 10-point debrief category to a 60-point run');
  const debriefEvent = c.P.aDrill.events.find((event) => event.actionType === DrillArch.ACTION.DEBRIEF);
  assert.equal(debriefEvent.payload.correct, true, 'correctness must be derived from the binding hypothesis');
  assert.doesNotMatch(c.state.msg, /correct|incorrect/i, 'live finalization must not reveal correctness');
  assert.ok(v.arch.debrief.summary, 'debrief view must have a summary');
});

test('A-drill debrief refuses an out-of-order self-adjudication attempt', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A6');
  run(c, 50);
  c.submitADrillDebrief(true);
  assert.equal(c.P.aDrill.events.some((event) => event.actionType === DrillArch.ACTION.DEBRIEF), false);
  assert.match(c.state.msg, /DEBRIEF NOT READY/);
});

test('endADrill writes a training record with D-shaped breakdown keys', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A6');
  run(c, 50);
  c.endADrill('ENDED FOR TEST');
  assert.equal(c.trainingRecords.length, 1);
  assert.equal(c.trainingRecords[0].drill, 'A6');
  assert.equal(c.trainingRecords[0].name, 'Hidden architecture diagnosis');
  assert.doesNotMatch(JSON.stringify(c.trainingRecords[0]), /single network path degradation/i);
  const b = c.trainingRecords[0].breakdown[0];
  assert.ok(b.label, 'breakdown.label missing: ' + JSON.stringify(b));
  assert.equal(typeof b.earned, 'number');
  assert.equal(typeof b.max, 'number');
});

test('START on a tripped motor synthesizes INTERLOCK.DEFEAT (A5 gate, live)', () => {
  const c = boot();
  c.applyPreset('U2_REACT');
  c.startADrill('A5');
  const m = c.L.M202;
  m.trip = true;
  m.run = false;
  m.lock = 0;
  c.motorCmd('M202', true);
  const ev = (c.P.aDrill.events || []).filter((e) => e.actionType === 'INTERLOCK.DEFEAT');
  assert.equal(ev.length, 1, 'accepted restart of a tripped M202 must retain INTERLOCK.DEFEAT');
  assert.equal(ev[0].target, 'DRV-M202');
  const score = DrillArch.scoreDrill('A5', c.P.aDrill.events.slice());
  assert.equal(score.gated, true);
});
