// @artifact dev
// A REFUSED replay must be reported as refused, not as "nothing happened".
//
// Found by seat 2/3's cross-lens on ac7e5c6, in the APP PAGE rather than in the module it was
// asked to judge: startReplay read plan.entries.length and never plan.refused, so a plan that
// had PROVEN actions were dropped rendered as "NO ACTIONS RECORDED AFTER SNAPSHOT". False, and
// worse, reassuring -- the exact failure the refusal exists to prevent, moved up one layer into
// the UI. 3/3 built the refusal to be loud; the UI was quietly swallowing it.
//
// The module half is pinned by tests/replay-drop.test.js (3/3's). This file pins the UI half,
// because gate 3 says an INSTRUCTOR can restore and replay -- so a gate met in the model and
// unmet at the surface is not met.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newSim, run } = require('./_fixture');
const Instructor = require('../src/instructor.js');

function boot() {
  const c = newSim();
  run(c, 20);
  c.instr.auth = true;
  c.setState({ sec: 'MNGR' });
  return c;
}

// Overflow the journal past JOURNAL_CAP across a snapshot, so replayPlan can PROVE loss.
function withTruncatedJournal(c) {
  c.saveSlot(0, 'pre');
  run(c, 2);
  const cap = Instructor.JOURNAL_CAP;
  for (let i = 0; i < cap + 500; i++) {
    Instructor.journalAdd(c.instr, { t: c.P.t, op: 'COMMENT', tag: 'X', arg: 'filler ' + i, text: 'f' });
  }
  return c;
}

test('POSITIVE CONTROL: an untruncated journal is NOT refused, so the refusal is not always-on', () => {
  const c = boot();
  c.saveSlot(0, 'pre');
  run(c, 2);
  c.setUpset('xmtr', true);
  run(c, 2);
  const plan = Instructor.replayPlan(c.instr, c.instr.snapshots[0], c.P.t);
  assert.equal(!!plan.refused, false, 'a journal that covers the snapshot must replay normally');
  assert.ok(plan.entries.length > 0, 'and must actually plan the recorded actions');
});

test('the module refuses across a real truncation, and names what was lost', () => {
  const c = withTruncatedJournal(boot());
  const plan = Instructor.replayPlan(c.instr, c.instr.snapshots[0], c.P.t);
  assert.ok(plan.refused, 'replayPlan must refuse when it can prove actions were dropped');
  assert.equal(plan.entries.length, 0, 'a refusal returns no entries -- never a short plan');
  assert.ok(plan.reason && plan.reason.length > 10, 'the refusal must carry a human reason');
});

test('startReplay REPORTS the refusal instead of "no actions recorded"', () => {
  const c = withTruncatedJournal(boot());
  c.startReplay(0);

  const msg = String(c.state.msg || '');
  assert.ok(msg.length > 0, 'startReplay must say something to the instructor');
  assert.match(msg, /REFUSED/i,
    'a refused replay must be reported as REFUSED. Reporting it as "no actions recorded" is ' +
    'false AND reassuring: it tells the instructor the exercise was empty when the truth is ' +
    'that it cannot be reproduced faithfully.');
  assert.doesNotMatch(msg, /NO ACTIONS RECORDED/i,
    'this is the exact wrong message -- the defect this test exists to prevent');

  assert.equal(c.instr.replay, null, 'a refused replay must not start');
});

test('the refusal reaches the instructor log, not only the transient message zone', () => {
  const c = withTruncatedJournal(boot());
  const before = c.instr.log.length;
  c.startReplay(0);
  assert.ok(c.instr.log.length > before, 'the refusal must be recorded, not just flashed');
  const txt = c.instr.log.map(e => e.txt).join(' | ');
  assert.match(txt, /REFUSED/i, 'the instructor log must carry the refusal');
});

test('a refused replay leaves the simulation untouched -- it does not half-restore', () => {
  const c = withTruncatedJournal(boot());
  const tBefore = c.P.t;
  const faultsBefore = JSON.stringify(c.P.faults);
  c.startReplay(0);
  assert.equal(c.P.t, tBefore, 'a refused replay must not restore the snapshot');
  assert.equal(JSON.stringify(c.P.faults), faultsBefore, 'nor mutate process state');
});

test('a gap created by a RUN RESET is reported as a reset, never blamed on the journal cap', () => {
  // Every applyPreset() -- an instructor initial condition, or a canonical drill start
  // from the trainee menu -- clears the journal through resetRun() while the sequence
  // counter keeps counting. The refusal used to read "dropped by the 2000-entry cap" for
  // a gap nothing capped. Found by the verify pass on the Stage 1 gate-3 work.
  const Instructor = require('../src/instructor.js');
  const c = boot();
  c.setMode('TIC202', 'MAN');                       // seq 1, before the snapshot
  c.saveSlot(0, 'before the reset');
  c.setMode('TIC202', 'CAS');                       // seq 2, after the snapshot, lost by the reset below
  c.renderVals();                                   // keep the render path exercised
  c.setState({ dlg: { type: 'drills' } });
  c.renderVals().dg.drills.find((x) => x.id === 'D1').canonicalCb();   // applyPreset -> resetRun
  const plan = Instructor.replayPlan(c.instr, c.instr.snapshots[0], c.P.t);
  assert.equal(plan.refused, 'RUN_RESET_AFTER_SNAPSHOT');
  assert.match(plan.reason, /run was reset/);
  assert.doesNotMatch(plan.reason, /cap/, 'nothing was capped');
  c.startReplay(0);
  assert.equal(c.instr.replay, null, 'still refused: the lost action cannot be reproduced');
  assert.match(c.state.msg, /REPLAY REFUSED/);
});
