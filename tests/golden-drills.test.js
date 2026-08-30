// @artifact dev
// S0 golden baseline: freeze v2 drill behaviour (docs/dev/V3-PLAN.md sections 9, 10, addendum G.2).
// See tests/_fixture.js for the digest contract this file assembles fixtures against.
//
// THERE ARE 8 DRILLS, NOT 12: "D1-D12" in the docs and drill titles is an id RANGE, not a
// count (D5, D7, D8, D10 do not exist). The id set is asserted below straight from
// c.drillDefs() -- never hard-coded from the docs -- so a later stage that adds or drops a
// drill is caught rather than silently absorbed.
//
// Every run here is UNATTENDED: nothing acks an alarm, so per drillWatch (app ~:2153-2169) a
// drill can never reach STABILIZED (that branch requires m.tAck) -- it always ends at
// TIME LIMIT REACHED, 720000 ms (12 simulated minutes) after arming for ungated drills, or
// after injection for a drill with a `when` gate (currently only D11). Injection time `ti` is
// NOT part of a drill definition -- it is computed at arm time inside startDrill as
// `t0 + 8000 + rand()*7000` ms (one seeded PRNG draw), so it is measured per run, never read
// from data or hard-coded.
//
// Duration: each drill is driven with c.step(0.5) in a loop with a generous hard cap of 12000
// steps (6000 simulated seconds) until c.state.drill becomes null, and the observed step count
// is asserted plus recorded as a fixture extra. Measured once against v2 (2026-08-30, seed
// 20260829, two independently constructed sims, byte-identical both times): D1, D2, D3, D4, D6,
// D9 and D12 end at 1441 steps (~720.5 s, consistent with the 720000 ms limit measured from
// t0). D11 is the one gated drill -- its `when` requires P.b.phase==='FEED' && P.b.Cm>8, and
// startDrill's own needBatch branch calls seqCmd('START',true) to arm the batch, so no manual
// batch start is needed here -- and it ends at 4021 steps (~2010.5 s: batch ramp time to the
// injection condition, plus the 720 s limit counted from injection rather than arming).
//
// Scoring: endDrill() nulls c.state.drill, so a reference to the drill object is captured
// immediately after startDrill() and used after the loop -- endDrill mutates that SAME object
// (reason, tEnd) rather than replacing it. c.scoreDrill(d, def.a) is called after the run ends,
// passing the drill's own correct quiz answer (def.a) as the submitted answer so scoring is a
// pure function of the (deterministic) run trajectory and not of an operator input this
// unattended harness never supplies. Verified deterministic across two independent runs for
// every drill (e.g. D1 scores 38 both times).
//
// Nondeterminism posture: this file does not trust determinism, it detects it. Every digest
// asserted below is computed from TWO independently constructed sims (fresh newSim() each) and
// the test fails if they disagree, before ever comparing to the committed fixture. None
// observed for any of the 8 drills.
//
// endState gaps -- NOT fixed here, reported per the S0 brief: endState (tests/_fixture.js)
// omits P.trips/P.faults latches, batch internals beyond phase (accM, conv, held), driftOff,
// env/mag, event CONTENT (only counts.events, a count, is captured), history buffers, the
// instructor journal, and alarm subprio/count/shelved/tadShed/phaseSet. A v3 stage could break
// replay or the SCM sequence without moving endStateDigest at all. This file additionally
// records P.trips, P.faults, P.b.phase and P.driftOff as extras specifically so a human
// reviewing a future diff can see which of those moved, even though they are not part of the
// hashed endState. Also: endState's alarm sort uses bare `localeCompare` (host-locale
// dependent -- a portability concern, not something observed to flake locally here), and
// alarmSequence() is "currently-abnormal records in first-raise order" (the engine's list(),
// which excludes NORM), not the underlying alarm journal -- fine for these fixtures because an
// unattended run never acks and so nothing here ever returns to NORM and drops out, but that is
// a property of these specific runs, not a general guarantee.
//
// Regeneration: normal runs ONLY READ the committed fixtures under tests/fixtures/ and hard-fail
// if one is missing. Set UPDATE_GOLDENS=1 to (re)capture -- never the default path, so an
// accidental fixture deletion cannot silently start passing again.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  newSim, endState, alarmSequence, fixture, digest, FIXTURE_DIR,
} = require('./_fixture');

fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const SEED = 20260829;
const STEP_CAP = 12000; // steps of 0.5s = 6000 simulated seconds; generous over the ~2011s D11 needs
const UPDATE = process.env.UPDATE_GOLDENS === '1';

const EXPECTED_IDS = ['D1', 'D2', 'D3', 'D4', 'D6', 'D9', 'D11', 'D12'];

/** Arm `defId` on a fresh sim and step, unattended, until it ends or the cap is hit. */
function driveDrill(defId) {
  const c = newSim({ seed: SEED });
  const ids = c.drillDefs().map(d => d.id);
  assert.deepEqual(ids, EXPECTED_IDS, 'drill id set drifted from the runtime Component');
  const def = c.drillDefs().find(d => d.id === defId);
  assert.ok(def, `no drill definition for ${defId}`);

  c.startDrill(def);
  const d = c.state.drill; // captured now: endDrill() mutates this SAME object, then nulls state.drill
  assert.ok(d, `${defId}: startDrill did not arm (already-active guard fired unexpectedly)`);

  let steps = 0;
  while (c.state.drill && steps < STEP_CAP) {
    c.step(0.5);
    steps++;
  }
  assert.ok(!c.state.drill, `${defId}: did not end within ${STEP_CAP} steps (cap too low, or v2 behaviour changed)`);
  assert.ok(d.injected, `${defId}: ended without ever injecting its fault`);
  assert.ok(d.reason, `${defId}: ended with no reason recorded`);

  const sc = c.scoreDrill(d, def.a);
  return { c, d, def, steps, sc };
}

/** Build the fixture-shaped record for one drill from an already-driven run. */
function recordFor(defId, run) {
  const { c, d, steps, sc } = run;
  assert.ok(c.events.length < 600, `${defId}: events already at the 600-entry cap -- counts.events would be saturated`);
  return fixture(`drill-${defId}`, {
    seed: SEED,
    seconds: steps * 0.5,
    c,
    extra: {
      drillId: defId,
      stepCap: STEP_CAP,
      steps,
      endReason: d.reason,
      injected: d.injected,
      alarmSequenceRaw: alarmSequence(c),
      trips: { ...c.P.trips },
      faults: { ...c.P.faults },
      batchPhase: c.P.b ? c.P.b.phase : null,
      driftOff: c.P.driftOff,
      eventsCount: c.events.length,
      score: { score: sc.score, pass: sc.pass, passMark: sc.passMark, breakdown: sc.breakdown },
    },
  });
}

function fixtureFile(defId) {
  return path.join(FIXTURE_DIR, `drill-${defId}.json`);
}

function loadOrSave(defId, record) {
  const file = fixtureFile(defId);
  if (UPDATE) {
    // Exactly one "@artifact" occurrence: the classifier is a plain regex over the file's
    // first 3 lines and matches inside a JSON string value just as well as a JS comment.
    const stamped = { '//': '@artifact dev (golden fixture; see tests/golden-drills.test.js)', ...record };
    fs.writeFileSync(file, JSON.stringify(stamped, null, 2) + '\n');
    return stamped;
  }
  assert.ok(fs.existsSync(file), `${file} is missing -- run with UPDATE_GOLDENS=1 to capture a golden (only after confirming determinism)`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('the drill id set is exactly the 8 that exist', () => {
  const c = newSim({ seed: SEED });
  assert.deepEqual(c.drillDefs().map(d => d.id), EXPECTED_IDS);
});

for (const defId of EXPECTED_IDS) {
  test(`golden: drill ${defId} unattended run is deterministic and matches the committed fixture`, () => {
    const runA = driveDrill(defId);
    const runB = driveDrill(defId);

    // Round-trip through JSON immediately: ESS.Kpi.scoreDrill's "othertrips" row computes
    // `earned: -pen`, which is -0 (not 0) whenever a drill has zero other-equipment trips
    // (Math.min(cap, 0 * penalty) negated). JSON.stringify normalizes -0 to 0, so the committed
    // fixture (written and re-read as JSON) always holds 0 there, while a live in-memory record
    // still holds -0 -- and assert.deepEqual from node:assert/strict is deepStrictEqual, which
    // uses Object.is and treats -0 !== 0. Comparing a freshly computed record straight against
    // the reloaded golden fails on that alone, on every drill with no other-equipment trips, for
    // a reason that has nothing to do with drift. Round-tripping both sides through JSON here
    // normalizes -0 the same way storage does, so the comparison matches what a human diffing
    // the two JSON files would actually see. Reported as a finding rather than patched in
    // src/kpi.js: S0 changes no application behaviour.
    const recA = JSON.parse(JSON.stringify(recordFor(defId, runA)));
    const recB = JSON.parse(JSON.stringify(recordFor(defId, runB)));

    // Detect nondeterminism before ever touching the committed fixture: two independently
    // constructed sims must agree byte-for-byte on everything that matters.
    assert.equal(recA.endStateDigest, recB.endStateDigest, `${defId}: endState digest differs between two independent runs -- NONDETERMINISM`);
    assert.equal(recA.alarmSequenceDigest, recB.alarmSequenceDigest, `${defId}: alarm sequence digest differs between two independent runs -- NONDETERMINISM`);
    assert.equal(runA.steps, runB.steps, `${defId}: step count to end differs between two independent runs -- NONDETERMINISM`);
    assert.equal(recA.score.score, recB.score.score, `${defId}: score differs between two independent runs -- NONDETERMINISM`);
    assert.deepEqual(recA.trips, recB.trips, `${defId}: P.trips differs between two independent runs -- NONDETERMINISM`);
    assert.deepEqual(recA.faults, recB.faults, `${defId}: P.faults differs between two independent runs -- NONDETERMINISM`);
    assert.equal(recA.driftOff, recB.driftOff, `${defId}: P.driftOff differs between two independent runs -- NONDETERMINISM`);
    assert.deepEqual(recA.alarmSequenceRaw, recB.alarmSequenceRaw, `${defId}: raw alarm sequence differs between two independent runs -- NONDETERMINISM`);

    const golden = loadOrSave(defId, recA);

    // `model` is provenance (tests/_fixture.js header comment), never asserted for equality --
    // ESS.MODEL_ID changes on any app/src edit, including a UI-only later stage, and a whole-
    // record deepEqual would break every golden for the wrong reason.
    assert.equal(recA.endStateDigest, golden.endStateDigest, `${defId}: end-state digest moved from the committed golden`);
    assert.equal(recA.alarmSequenceDigest, golden.alarmSequenceDigest, `${defId}: alarm-sequence digest moved from the committed golden`);
    assert.equal(recA.steps, golden.steps, `${defId}: step count to end moved from the committed golden`);
    assert.equal(recA.endReason, golden.endReason, `${defId}: end reason moved from the committed golden`);
    assert.equal(recA.injected, golden.injected, `${defId}: injected flag moved from the committed golden`);
    assert.deepEqual(recA.alarmSequenceRaw, golden.alarmSequenceRaw, `${defId}: raw alarm sequence moved from the committed golden`);
    assert.deepEqual(recA.trips, golden.trips, `${defId}: P.trips moved from the committed golden`);
    assert.deepEqual(recA.faults, golden.faults, `${defId}: P.faults moved from the committed golden`);
    assert.equal(recA.batchPhase, golden.batchPhase, `${defId}: batch phase moved from the committed golden`);
    assert.equal(recA.driftOff, golden.driftOff, `${defId}: driftOff moved from the committed golden`);
    assert.equal(recA.eventsCount, golden.eventsCount, `${defId}: event count moved from the committed golden`);
    assert.equal(recA.eventsCount < 600, true, `${defId}: event count at/over the 600 cap -- counts.events would be saturated`);
    assert.deepEqual(recA.score, golden.score, `${defId}: scored outcome moved from the committed golden`);
  });
}
