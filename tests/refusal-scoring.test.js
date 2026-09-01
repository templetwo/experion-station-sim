// @artifact dev
// PINS A RULING — the AMENDED ruling of record, seat 1/3 (Opus-5 lead), 2026-08-30.
// It supersedes that seat's first ruling of the same day, which contained a self-inverting
// phrase; the superseded wording is described below so nobody reintroduces it.
//
// THE AMENDED RULING OF RECORD, in full:
//   1. The drill safety gate is OUTCOME-BASED. A refused attempt does not trip it.
//   2. src/drill-arch.js matchAction is ALREADY CORRECT FOR BOTH FAMILIES and is NOT to be
//      modified. `if (e.accepted === false) return false;` is right for expectedActions (no
//      credit for an action that did not happen) AND right for safetyGate (no cap for an
//      action the system prevented). One guard serving both is correct here.
//   3. The debrief judgment note is NEW CODE on a SEPARATE collection path that reads the
//      journal directly. It is additive and does not touch the scorer's matcher.
//
// The reasoning, carried with the conclusion on purpose: the gate caps a score "regardless of
// other points", which is terminal, and terminal penalties attach to what HAPPENED, not to what
// was attempted and prevented. The plant was never endangered. Most refusals in this station are
// security-level gates, so failing a trainee for clicking an ENGR action at OPER level would
// punish the security model working correctly. The debrief is where intent belongs, because the
// debrief informs rather than punishes.
//
// WHAT THE SUPERSEDED WORDING SAID, AND WHY IT IS PINNED AGAINST. The first ruling paired
// "a refused attempt does not trip it" with "the guard must be split". Read literally against
// matchAction, splitting the guard so safetyGate stops discarding refusals makes refusals TRIP
// the gate — the exact inverse of the sentence it followed. An S3 builder implementing the
// phrase rather than the reasoning would have inverted the lead. That edit is what this file
// exists to catch.
//
// WHY IN CODE AT ALL. This build has produced four prose-versus-code divergences — fault
// vocabulary, the dispatch/drill-arch safety-gate contradiction, the RESOURCES id spelling,
// and the superseded wording above — each with green module suites and nothing spanning two
// modules. In the two caught late, the prose was fine and nothing enforced it. A ruling held
// only in prose is the next one.
//
// IF THE RULING IS OVERTURNED — only Anthony or the architect can do that — this is the file to
// invert, and `gateIsOutcomeBased` below is the single assertion that flips. Reversible on
// purpose, with the reversal point labelled.
//
// Built by MacBook seat 2/3 (claude-opus-5[1m]). New file only; edits no src/ module.
const test = require('node:test');
const assert = require('node:assert/strict');
const DrillArch = require('../src/drill-arch.js');

/** A journal entry in ActionEvent shape, matching drill rule `r`. */
function entryFor(r, overrides) {
  return Object.assign({
    seq: 1, simTime: 120, actor: 'TRAINEE',
    actionType: r.actionType,
    target: Array.isArray(r.target) ? r.target[0] : r.target,
    payload: r.payloadMatch ? Object.assign({}, r.payloadMatch) : null,
    accepted: true
  }, overrides || {});
}

function gateOf(drillId) {
  const g = (DrillArch.drillById(drillId).safetyGate || [])[0];
  assert.ok(g, `${drillId} has no safetyGate rule`);
  return g;
}

function faultReceipt(drillId) {
  return {seq:0,simTime:0,actor:'SYSTEM',actionType:DrillArch.ACTION.FAULT_PRESENT,target:drillId,accepted:true};
}

// ==================================================== 1. the gate works at all

test('refusal scoring: the safety gate is not vacuous', async (t) => {
  await t.test('POSITIVE CONTROL: an ACCEPTED unsafe action DOES trip the gate', () => {
    // If this ever fails, every "does not trip" assertion below is meaningless —
    // they would pass simply because the gate never fires for anything.
    const gate = gateOf('A1');
    const res = DrillArch.scoreDrill('A1', [entryFor(gate, { accepted: true })]);
    assert.equal(res.gated, true, 'an accepted unsafe action failed to trip the gate');
    assert.ok(res.gateHits.length > 0);
    assert.equal(res.pass, false, 'a gated run must not pass');
  });
});

// ==================================================== 2. THE RULING

test('refusal scoring: the gate is OUTCOME-BASED — a refused attempt does not trip it', async (t) => {
  await t.test('gateIsOutcomeBased: accepted:false on the gate action leaves the run ungated', () => {
    const gate = gateOf('A1');
    const res = DrillArch.scoreDrill('A1', [
      entryFor(gate, { accepted: false, reason: 'SECURITY_LEVEL: OPER cannot perform ENGR action' })
    ]);
    assert.equal(res.gated, false,
      'RULING INVERTED: a refused unsafe attempt tripped the safety gate. The gate is ' +
      'outcome-based — the plant was never endangered. If matchAction was changed to let ' +
      'safetyGate see rejections, that change contradicts the ruling this test pins.');
    assert.deepEqual(res.gateHits, []);
  });

  await t.test('holds for every drill that defines a safety gate', () => {
    const inverted = [];
    for (const id of DrillArch.drillIds()) {
      const gate = (DrillArch.drillById(id).safetyGate || [])[0];
      if (!gate) continue;
      const res = DrillArch.scoreDrill(id, [entryFor(gate, { accepted: false, reason: 'refused' })]);
      if (res.gated) inverted.push(id);
    }
    assert.deepEqual(inverted, [], `refused attempts tripped the gate in: ${inverted.join(', ')}`);
  });
});

// ==================================================== 3. the other half of the guard

test('refusal scoring: a refused action also earns no credit', async (t) => {
  // The SAME guard is correct here and nobody disputes it — you cannot earn credit for
  // an action that did not happen. Pinned so a future "split the guard" cannot loosen
  // this half while fixing the other.
  await t.test('a refused expectedAction contributes nothing to the breakdown', () => {
    const drill = DrillArch.drillById('A1');
    const act = (drill.expectedActions || [])[0];
    assert.ok(act, 'A1 has no expectedActions');
    const refused = DrillArch.scoreDrill('A1', [faultReceipt('A1'), entryFor(act, { accepted: false, reason: 'refused' })]);
    const accepted = DrillArch.scoreDrill('A1', [faultReceipt('A1'), entryFor(act, { accepted: true })]);
    assert.ok(accepted.score > refused.score,
      'an accepted expected action scored no higher than a refused one');
    const row = refused.breakdown.find((r) => r.category === act.category);
    if (row) assert.equal(row.matched, 0, 'a refused action was counted as matched');
  });
});

// ==================================================== 4. the refusal must survive

test('refusal scoring: the refusal is ignored by the scorer but NOT destroyed', async (t) => {
  // S3 obligation (a) on the record: a refused unsafe attempt is RECORDED and surfaced
  // in the debrief as a judgment note — that is the whole reason ActionEvent carries
  // accepted+reason. The scorer ignoring an entry must never be confused with the
  // journal dropping it; if the data were gone, the debrief note could not be built.
  await t.test('scoreDrill is read-only over the journal it is given', () => {
    const gate = gateOf('A1');
    const journal = [entryFor(gate, { accepted: false, reason: 'SECURITY_LEVEL' })];
    const before = JSON.stringify(journal);
    DrillArch.scoreDrill('A1', journal);
    assert.equal(JSON.stringify(journal), before,
      'scoreDrill mutated the journal — the debrief judgment note needs this data intact');
    assert.equal(journal.length, 1);
    assert.equal(journal[0].accepted, false);
    assert.equal(journal[0].reason, 'SECURITY_LEVEL');
  });

  await t.test('scoring is deterministic over a journal containing refusals', () => {
    const gate = gateOf('A1');
    const journal = [
      entryFor(gate, { seq: 1, accepted: false, reason: 'refused' }),
      entryFor((DrillArch.drillById('A1').expectedActions || [])[0], { seq: 2, accepted: true })
    ];
    const a = DrillArch.scoreDrill('A1', journal);
    const b = DrillArch.scoreDrill('A1', journal);
    assert.deepEqual(a, b, 'same drill + same journal produced different results');
  });
});
