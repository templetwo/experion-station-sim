// @artifact dev
// GATE 3 (determinism) boundary: an action journaled at the very instant a replay is started must
// still be replayed. Seat 1/3 found (#360, carried to S4) that startReplay invoked with ZERO elapsed
// sim time after the most recent journaled action silently DROPS that action; seat 3/3 reproduced
// it on a7e7bd0 and narrowed it: the entry is in replayPlan (1 entry) and in the app's replay
// (1 planned) but is never APPLIED, because its t equals plan.toT and the replay is declared
// complete at P.t >= toT. Held RED by seat 3/3 until the fix lands in the app page (lead's lock);
// stage this file together with that fix. Pre-existing v2 behaviour, any op type.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newSim, run, endState, digest } = require('./_fixture');
const FaultEngine = require('../src/fault-engine.js');

function boot() { const c = newSim(); run(c, 20); c.instr.auth = true; c.setState({ sec: 'MNGR' }); return c; }
function physics(c) { const e = endState(c); delete e.counts; return digest(e); }

function liveVsReplay(act, secondsAfterAct) {
  const c = boot();
  c.saveSlot(0, 'pre');
  run(c, 5);
  act(c);
  run(c, secondsAfterAct);
  const live = { faults: JSON.stringify(c.P.faults), arch: JSON.stringify(FaultEngine.listActive(c.P.archFaults)), physics: physics(c) };
  c.startReplay(0);
  const planned = c.instr.replay ? c.instr.replay.entries.length : 0;
  c.replayToEnd();
  const replay = { faults: JSON.stringify(c.P.faults), arch: JSON.stringify(FaultEngine.listActive(c.P.archFaults)), physics: physics(c) };
  return { planned, live, replay };
}

test('POSITIVE CONTROL: an action journaled 0.5 s BEFORE the replay start instant is replayed (faults and physics match live)', () => {
  const r = liveVsReplay(c => c.setUpset('xmtr', true), 0.5);
  assert.equal(r.planned, 1);
  assert.equal(r.replay.faults, r.live.faults);
  assert.equal(r.replay.physics, r.live.physics);
});

test('BOUNDARY: a legacy UPSET journaled at the exact instant startReplay is invoked is planned AND applied', () => {
  const r = liveVsReplay(c => c.setUpset('xmtr', true), 0);
  assert.equal(r.planned, 1, 'replayPlan includes the entry (t == toT)');
  assert.equal(r.replay.faults, r.live.faults, 'the entry at t == toT must be APPLIED, not only planned: P.faults after replay must equal live');
  assert.equal(r.replay.physics, r.live.physics, 'physics after replay must equal live');
});

test('BOUNDARY: an ARCH fault journaled at the exact instant startReplay is invoked is planned AND applied', () => {
  const r = liveVsReplay(c => c.setArchFault('CONTROLLER_LOSS', 'CTRL-U2', { mode: 'STEP' }), 0);
  assert.equal(r.planned, 1);
  assert.equal(r.replay.arch, r.live.arch, 'engine active-fault list after replay must equal live');
});

test('BOUNDARY: a trainee MODE change journaled at the exact instant startReplay is invoked is applied', () => {
  const r = liveVsReplay(c => c.setMode('TIC201', 'MAN'), 0);
  assert.equal(r.planned, 1);
  assert.equal(r.replay.physics, r.live.physics, 'the mode change at t == toT must be re-applied');
});

// ---------------------------------------------------------------- thread #28: truncation must be LOUD
const Instructor = require('../src/instructor.js');
const T0 = 1_700_000_000_000;
function filled(n, startT) { const I = Instructor.create(); for (let i = 0; i < n; i++) Instructor.journalAdd(I, { t: (startT || T0) + i * 1000, op: 'MODE', tag: 'FIC102', arg: i % 2 ? 'MAN' : 'AUTO' }); return I; }

test('no truncation: replayPlan returns the entries after a sequence-carrying snapshot, unrefused', () => {
  const I = filled(5);
  const plan = Instructor.replayPlan(I, { t: T0 + 2500, journalSeq: 3 }, T0 + 10_000);
  assert.equal(plan.refused, undefined);
  assert.deepEqual(plan.entries.map(e => e.seq), [4, 5]);
  assert.equal(plan.legacy, false);
  assert.equal(Instructor.replayRefusal(I, { t: T0 + 2500, journalSeq: 3 }), null);
});

test('JOURNAL_CAP splice is REMEMBERED on the instructor state, lazily (create() shape unchanged)', () => {
  const fresh = Instructor.create();
  assert.equal('journalDroppedSeq' in fresh, false, 'no new fields until an overflow actually happens');
  const I = filled(Instructor.JOURNAL_CAP + 7);
  assert.equal(I.journal.length, Instructor.JOURNAL_CAP);
  assert.equal(I.journalDroppedCount, 7);
  assert.equal(I.journalDroppedSeq, 7);
  assert.equal(I.journal[0].seq, 8);
});

test('a replay that would cross a truncation is REFUSED with the lost sequence range, never returned short', () => {
  const I = Instructor.create();
  Instructor.journalAdd(I, { t: T0, op: 'MODE', tag: 'FIC102', arg: 'MAN' });          // seq 1
  const snap = { t: T0 + 500, journalSeq: I.seq };                                        // snapshot after seq 1
  for (let i = 0; i < Instructor.JOURNAL_CAP + 100; i++) Instructor.journalAdd(I, { t: T0 + 1000 + i * 1000, op: 'RAISE', tag: 'FIC102', arg: '' });
  // seq 2..101 were spliced away; a naive plan would replay 102..2101 and report success
  const plan = Instructor.replayPlan(I, snap, T0 + 10_000_000);
  assert.equal(plan.refused, 'JOURNAL_TRUNCATED');
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.lostFromSeq, 2);
  assert.equal(plan.lostToSeq, 101);
  assert.match(plan.reason, /seq 2-101/);
  assert.deepEqual(Instructor.replayRefusal(I, snap).code, 'JOURNAL_TRUNCATED');
  // POSITIVE CONTROL: a snapshot taken AFTER the truncation replays normally
  const later = { t: T0 + 1000 + 150 * 1000 + 500, journalSeq: 152 };
  const ok = Instructor.replayPlan(I, later, T0 + 10_000_000);
  assert.equal(ok.refused, undefined);
  assert.ok(ok.entries.length > 0);
  assert.equal(ok.entries[0].seq, 153);
});

test('an empty journal with actions recorded after the snapshot (cleared or truncated) is refused, not replayed as "nothing happened"', () => {
  const I = filled(3);
  const snap = { t: T0 + 500, journalSeq: 1 };
  Instructor.resetRun(I);                       // clears the journal; I.seq stays 3
  const plan = Instructor.replayPlan(I, snap, T0 + 10_000);
  assert.equal(plan.refused, 'JOURNAL_EMPTY_AFTER_SNAPSHOT');
  assert.equal(plan.lostFromSeq, 2); assert.equal(plan.lostToSeq, 3);
  // but a snapshot at the current sequence (nothing recorded after it) is simply an empty, unrefused plan
  assert.equal(Instructor.replayPlan(I, { t: T0 + 500, journalSeq: 3 }, T0 + 10_000).refused, undefined);
});

test('LEGACY snapshot (journalSeq == null) is decided EXPLICITLY: refused only when a remembered drop postdates it', () => {
  const I = filled(Instructor.JOURNAL_CAP + 10);              // drops seq 1..10, last dropped at t = T0 + 9000
  const before = { t: T0 + 5000, journalSeq: null };            // snapshot before the last dropped entry -> actions after it were lost
  const p1 = Instructor.replayPlan(I, before, T0 + 5_000_000);
  assert.equal(p1.refused, 'JOURNAL_TRUNCATED_LEGACY');
  assert.equal(p1.lostToSeq, 10);
  assert.deepEqual(p1.entries, []);
  const after = { t: T0 + 9500, journalSeq: null };             // snapshot after the last drop -> replayable on the time path
  const p2 = Instructor.replayPlan(I, after, T0 + 5_000_000);
  assert.equal(p2.refused, undefined);
  assert.equal(p2.legacy, true);
  assert.ok(p2.entries.length > 0 && p2.entries.every(e => e.t > after.t));
  // and with no drop ever recorded, legacy replays as before (the pre-S0 path is unchanged)
  const J = filled(5);
  assert.equal(Instructor.replayPlan(J, { t: T0 + 1500, journalSeq: null }, T0 + 10_000).refused, undefined);
});
