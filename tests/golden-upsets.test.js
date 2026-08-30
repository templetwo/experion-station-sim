// @artifact dev
// S0 golden baseline for the twelve legacy instructor upsets (V3-PLAN.md section 5 and 9,
// addendum G.3): "The existing twelve instructor upsets ... are re-registered through this
// engine unchanged in behavior; golden tests prove parity." This file freezes what v2 does
// TODAY so a later stage (S2) can prove its fault-engine re-registration changed nothing.
//
// Path used: c.setUpset(k, true) -- the INSTRUCTOR path (app "Experion Station Simulator.dc.html",
// Component.setUpset), not c.injectFault(k, true) directly. setUpset is what the instructor
// Architecture panel will call; it journals ('UPSET', k, 'ON'/'OFF', {instr:true}), writes the
// instructor log (instrLog), and on clearing 'drift' resets P.driftOff -- all behaviour S2's
// fault-engine wrapper must reproduce. injectFault is the raw layer underneath (mutates
// P.faults/P.faultT and, for pump/agit, trips the motor) that S2 wraps directly; it skips the
// journal entry, the instructor log line and the drift recalibration on clear. Neither path is
// auth-gated: instructorAllowed() (Component:2236) only gates navigation into the 'instr'
// display (openInstructor -> nav('instr')), never setUpset/injectFault themselves, so newSim()'s
// un-authed instructor state (instr.auth === false) is not a concern here.
//
// Each scenario: fresh sim at the shared default seed (tests/_fixture.js newSim), settle 120 s
// (SETTLE, chosen for this file alone -- golden-drills.test.js does not settle before injection,
// it starts each drill immediately from newSim() and lets the drill's own arm-to-injection delay
// play that role, so "shared footing" does not hold across the two files; verified by reading
// golden-drills.test.js's driveDrill()),
// inject via setUpset, run a further fixed duration chosen to cross that upset's own timer or
// one-shot behaviour (see the per-scenario comment below), then digest the end state and the
// alarm-arrival order. state.sec is left at its default 'OPER' throughout -- no scenario needs a
// higher security level, and instructorAllowed() does not gate setUpset/injectFault regardless.
//
// Per the addendum's Q2 finding, every fixture below was captured from TWO independently
// constructed sims and only committed because the two runs were byte-identical (endStateDigest
// AND alarmSequenceDigest). Nondeterminism would be a reportable S0 finding, not something to
// paper over -- none was observed for any of the thirteen scenarios in this file.
//
// endState (tests/_fixture.js) is a *behaviour* digest: it deliberately excludes P.trips,
// P.faults, P.b.phase, driftOff and raw event/alarm content (only counts), so a human reading a
// diff of THIS file's fixtures cannot see what moved from the digest alone. Those fields are
// therefore committed and asserted separately, in `extras()` below, as the fixture's `extra`
// payload (V3-PLAN addendum: "Commit readable extras ... so a human can see WHAT moved").
//
// Known gaps NOT covered by this golden (report, don't fix, per the S0 charter):
//   - P.b internals beyond `phase` (accM, conv, held, Cm, T, ...), env/mag, history buffers,
//     the instructor journal/log, alarm subprio/count/shelved state, tadShed/phaseSet -- a later
//     stage could change any of these without moving a digest here.
//   - counts.events is a rendered count only; the app's addEvent caps the ring at 600
//     (Component.addEvent, `if(this.events.length>600) this.events.length=600`) so a scenario
//     that generated 600+ events would silently under-report. Asserted below to guard against it.
//   - endState's alarm array is sorted with a bare `.localeCompare` (tests/_fixture.js) --
//     host-locale-dependent in principle; not exercised as a portability risk here because every
//     tag/cond pair in these fixtures sorts ASCII-identically under any locale this suite has run
//     on. alarmSequence (asserted separately, in raise order, unsorted) is immune to this by
//     construction.
//   - alarmSequence is ESS.AlarmEngine's list() of currently-abnormal records in first-raise
//     order (it excludes NORM/cleared alarms), not the alarm journal -- surge/pump/vap/agit
//     self-clear or trip-and-reset within the window, and *none* of these unattended runs ever
//     calls ackAlarm(), so nothing here exercises ack-driven removal from that list.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Instructor = require('../src/instructor.js');
const { newSim, run, endState, alarmSequence, fixture, digest, round, FIXTURE_DIR } = require('./_fixture');

const SEED = 20260829;
const SETTLE = 120; // seconds settled before any injection -- a choice local to this file; golden-drills.test.js does not settle at all before startDrill()

fs.mkdirSync(FIXTURE_DIR, { recursive: true });

// The 12 legacy upset keys, in ESS.Instructor.upsetDefs()'s own defined order -- the order a
// human reads the fixtures in below, and the order S2 must not quietly reorder or drop from.
const UPSET_KEYS = ['xmtr', 'drift', 'surge', 'pump', 'cool', 'stick', 'vap', 'air', 'rxn', 'foul', 'agit', 'bedact'];

function extras(c) {
  return {
    alarmSeq: alarmSequence(c),
    trips: JSON.parse(JSON.stringify(c.P.trips)),
    faults: JSON.parse(JSON.stringify(c.P.faults)),
    phase: c.P.b.phase,
    driftOff: round(c.P.driftOff),
    countsAlarms: (c.alarms || []).length,
    countsEvents: (c.events || []).length,
  };
}

// One scenario per legacy upset, plus a 13th (agit-batch) that exercises agit's second,
// unmixed-kinetics code path. `seconds` is the run AFTER injection; see the inline comment on
// each entry for which timer or one-shot behaviour that duration is chosen to cross.
const SCENARIOS = [
  {
    key: 'xmtr', seconds: 300,
    // BADPV fires 5 s after injection (measureU1, src/models.js: `ft>5000`), which raises
    // FIC102 BADPV/High, sheds the loop, and starts FIC102.pv decaying to 0 on a 10 s lag
    // (`lag(pv,0,10,dt)`) -- decay crosses the PVLO then PVLL limits on the way down. 300 s
    // covers onset through the quiescent post-shed state (pv essentially at 0, no further
    // alarms). xmtr never self-clears (no faultT check for it in models.js); setUpset(xmtr,
    // true) is left on for the whole window.
    inject: c => c.setUpset('xmtr', true),
  },
  {
    key: 'drift', seconds: 600,
    // 'drift' never self-clears and has no alarm threshold of its own -- it walks LIC101's
    // *indicated* level up at mag.drift (default 1) % of span per minute (measureU1:
    // `P.driftOff += magOf(P).drift/60*dt`) while the *true* tank level is left to whatever
    // LIC101's own control response does with the now-wrong reading. 600 s (default magnitude)
    // produces exactly +10 % of indicated span (driftOff, asserted below) while the true P.tankL
    // has already drifted about 10 points below what LIC101 reports -- "PV inconsistent with
    // correlated evidence; quality GOOD" (V3-PLAN section 5's own description of this fault
    // class), captured here BEFORE it is large enough to cross any alarm limit. A longer run
    // does eventually alarm, but only well past the point where P.tankL is heading toward the
    // low-level pump-cavitation trip -- out of scope for a upset-behaviour golden.
    inject: c => c.setUpset('drift', true),
  },
  {
    key: 'surge', seconds: 600,
    // Self-clearing: feedDisturbance clears F.surge once `P.t - P.faultT.surge > 480000` (8 min,
    // matching the upsetDefs label "Feed inflow surge (8 min)"). 600 s runs 2 full minutes past
    // that clear point, so the fixture captures both the transient alarm cascade AND the
    // auto-clear (asserted via extras().faults.surge === false).
    inject: c => c.setUpset('surge', true),
  },
  {
    key: 'pump', seconds: 600,
    // One-shot: injectFault('pump', true) trips P101 (tripMotor) and clears P.faults.pump
    // synchronously within the same call (app Component.injectFault) -- there is no "surge is
    // still active" state to observe after t=0. 600 s lets the un-pumped, then-overflowing feed
    // tank cascade run out to TK-101's HIHI trip, which LATCHES (P.trips.ovf stays true at 98 %
    // until tankL falls back under 90 %, and with the pump tripped it never does inside this
    // window) -- asserted via extras().trips.ovf === true.
    inject: c => c.setUpset('pump', true),
  },
  {
    key: 'cool', seconds: 400,
    // Backup cooling switches in at PARAMS.U1.coolBackupMs = 180000 (3 min, matching the
    // upsetDefs label). 400 s (>=360 s, two full backup-timer widths) crosses that switch with
    // margin and lets the R-201 HI TEMP TRIP that fires on the way up reset again once backup
    // cooling (coolBackup = 1.0, i.e. full jacket effectiveness restored) brings it back down --
    // asserted via extras().trips.rx === false (tripped-then-reset, not never-tripped: the raw
    // alarmSeq below still shows R-201:HI TEMP TRIP:Urgent). 'cool' itself never self-clears
    // (only its effectiveness changes at the backup timer); faults.cool stays true.
    inject: c => c.setUpset('cool', true),
  },
  {
    key: 'stick', seconds: 600,
    // Never self-clears. setUpset->injectFault sets V.TV202.stuck=true directly (app
    // Component.injectFault: `if(k==='stick') V.TV202.stuck=on`), which freezes the valve
    // position where it was AND swaps in PARAMS.U1.stickHeat as the reaction's heat multiplier
    // (models.js cstr(): `F.stick ? c.stickHeat : 1`) -- a lower load than the full 'rxn' fault,
    // by design (V3-PLAN addendum note in models.js), so TIC202 in MAN can hold R-201 under trip
    // while the trainee deals with the stuck valve (drill D6). 600 s settles the resulting
    // TIC201/202 alarm cascade without a trip.
    inject: c => c.setUpset('stick', true),
  },
  {
    key: 'vap', seconds: 420,
    // TRAP, measured: this scenario produces ZERO alarms. PIC401 starts in AUTO (only drill D9's
    // setup forces it to MAN) and vents the drum as vapf jumps, so the pressure excursion never
    // reaches an alarm limit -- the golden's endStateDigest is what pins the excursion (P.drumP)
    // and the PSV margin, not the (empty) alarm sequence. Self-clears at
    // `P.t-P.faultT.vap>300000` (5 min, matching the upsetDefs label); 420 s runs past that
    // point, asserted via extras().faults.vap === false. D9's own drill golden (if present in
    // golden-drills.test.js) additionally covers the MAN variant that DOES alarm.
    inject: c => c.setUpset('vap', true),
  },
  {
    key: 'air', seconds: 300,
    // Unit-scoped "ALL": moveValves drives every valve in V (all 10, across all three units)
    // toward its fail-safe position while F.air is set (`g = F.air ? v.fail : tgt[k]`), so this
    // is the one upset with simultaneous cross-unit impact -- the wide alarm cascade below (11
    // alarms across U1 and U3 tags) is that, not a bug in the scenario. Never self-clears.
    inject: c => c.setUpset('air', true),
  },
  {
    key: 'rxn', seconds: 300,
    // Never self-clears. Steps three U1 CSTR terms at once (models.js cstr(): the rate constant
    // via c.rxnRate, feed concentration via c.rxnConc, and the reaction's heat multiplier via
    // c.rxnHeat) -- a heavier load than 'stick', which only touches the heat multiplier. 300 s
    // settles the resulting TIC201/202 cascade without a trip at this magnitude.
    inject: c => c.setUpset('rxn', true),
  },
  {
    key: 'foul', seconds: 700,
    // Progressive, never self-clears: exchangerAndDrum() drops foulF at
    // `dt/600*0.4*fr` while F.foul is set (fr = env.foulRate, default 1), floored at 0.6 -- a
    // fall of exactly 0.4 over 600 s of continuous fault time at default settings. 700 s (past
    // the 600 s it takes to hit the floor) pins the SATURATED floor value deterministically
    // rather than a still-moving mid-point, which would make this golden sensitive to the exact
    // step count. Zero alarms at this magnitude (TIC301 tracks the fouled exchanger without
    // crossing a limit) -- freezing that is the point; a later stage must not add one silently.
    inject: c => c.setUpset('foul', true),
  },
  {
    key: 'agit', seconds: 300,
    // One-shot, same shape as 'pump': injectFault('agit', true) trips M202 and clears
    // P.faults.agit synchronously. TRAP, measured: at IDLE (P.b.phase, no batch running) this
    // produces exactly ONE alarm, M202:TRIP:Urgent -- there is no monomer feed to react
    // unmixed, so none of D11's adiabatic-endpoint behaviour fires. That thinness is the
    // measured truth for the idle case, not a broken scenario; the 'agit-batch' scenario below
    // exercises the branch this one cannot.
    inject: c => c.setUpset('agit', true),
  },
  {
    key: 'bedact', seconds: 600,
    // Never self-clears. Multiplies R-310's hot-spot growth term (models.js fixedBed():
    // `act = envOf(P).catAct * (P.faults.bedact ? magOf(P).bedact : 1)`) by the default
    // magnitude (P.mag.bedact = 1.35, from magDefaults() -- no setMagnitude call in this
    // scenario). At that magnitude the bed temperature crosses R-310's HI TEMP TRIP and then
    // recovers back under the reset point within the 600 s window (extras().trips.bed ===
    // false: tripped-then-reset, matching the same shape as 'cool').
    inject: c => c.setUpset('bedact', true),
  },
  {
    key: 'agit-batch', seconds: 300,
    // Second agit fixture: freezes the branch the idle case above cannot reach. Starts the
    // SCM202 batch (seqCmd('START', true) -- silent, so it bypasses the OPER `can()` check the
    // same way an instructor-driven precondition would) and steps until P.b.phase==='FEED',
    // capped at 7200 steps of 0.5 s (3600 sim-s), mirroring the app's own applyPreset budget
    // for exactly this wait (`const max=(p.maxRun||3600)*2`). With the agitator running,
    // batchReactor() uses `cap=b.lvl/40` and the mixed `gel`/`agitRate=1`; once M202 trips,
    // `M.run` is false and it swaps to `cap=1`, `gel=c.gelUnmixed`, `agit=c.agitRate` -- heat
    // capacity relative to the charged water no longer applies because, unmixed, the reaction is
    // confined to the monomer-rich layer (the model's own comment). That is what drives TI216
    // (adiabatic end temperature) into alarm here, which the idle scenario never reaches, and is
    // exactly the D11 drill's "why is restarting dangerous" mechanism. Batch phase is asserted
    // still 'FEED' at the end (300 s is short next to FEED's own multi-thousand-second span).
    pre(c) {
      c.seqCmd('START', true);
      let steps = 0;
      const cap = 7200;
      while (c.P.b.phase !== 'FEED' && steps < cap) { c.step(0.5); steps++; }
      assert.equal(c.P.b.phase, 'FEED', 'agit-batch precondition: batch must reach FEED before injecting');
    },
    inject: c => c.setUpset('agit', true),
  },
];

function build(sc) {
  const c = newSim({ seed: SEED });
  run(c, SETTLE);
  if (sc.pre) sc.pre(c);
  sc.inject(c);
  run(c, sc.seconds);
  return c;
}

// Regeneration is behind an explicit flag and is NEVER the default path: a suite that
// silently rewrites a missing golden can never fail again. UPDATE_GOLDENS=1 re-captures.
const UPDATE = process.env.UPDATE_GOLDENS === '1';

function fixturePath(key) { return path.join(FIXTURE_DIR, `upset-${key}.json`); }

function writeFixture(key, rec) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  // The "//" key carries the artifact-class marker: tests/artifact-classes.test.js scans
  // the first 3 lines with a plain regex, and JSON cannot carry a comment. Exactly one
  // occurrence of the marker string per file.
  const stamped = { '//': '@artifact dev (golden fixture; see tests/golden-upsets.test.js)', ...rec };
  fs.writeFileSync(fixturePath(key), JSON.stringify(stamped, null, 2) + '\n');
}

function loadFixture(key) {
  const file = fixturePath(key);
  assert.ok(fs.existsSync(file), `missing committed fixture ${file} -- re-capture with UPDATE_GOLDENS=1 (only after confirming determinism)`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('upsetDefs() still returns exactly the 12 legacy keys, in their defined order', () => {
  const keys = Instructor.upsetDefs().map(d => d.k);
  assert.deepEqual(keys, UPSET_KEYS, 'a dropped, added or reordered key here is exactly what S2 must not do silently');
  assert.equal(keys.length, 12);
});

for (const sc of SCENARIOS) {
  test(`golden upset: ${sc.key} (setUpset instructor path, +${sc.seconds}s post-inject)`, () => {
    // Q2 (addendum): detect nondeterminism rather than trust it -- two independently
    // constructed sims must land on identical digests before comparing either to the
    // committed fixture. A mismatch here is a reportable finding, not something to loosen.
    const c1 = build(sc);
    const c2 = build(sc);
    const rec1 = fixture(`upset-${sc.key}`, { seed: SEED, seconds: sc.seconds, c: c1, extra: extras(c1) });
    const rec2 = fixture(`upset-${sc.key}`, { seed: SEED, seconds: sc.seconds, c: c2, extra: extras(c2) });

    assert.equal(rec1.endStateDigest, rec2.endStateDigest, `${sc.key}: two independently constructed sims disagree on end state -- nondeterminism, report don't loosen`);
    assert.equal(rec1.alarmSequenceDigest, rec2.alarmSequenceDigest, `${sc.key}: two independently constructed sims disagree on alarm order -- nondeterminism, report don't loosen`);
    assert.deepEqual(rec1.alarmSeq, rec2.alarmSeq, `${sc.key}: alarm sequence itself differed between runs`);
    assert.deepEqual(rec1.trips, rec2.trips);
    assert.deepEqual(rec1.faults, rec2.faults);
    assert.equal(rec1.phase, rec2.phase);
    assert.equal(rec1.driftOff, rec2.driftOff);

    // Only re-capture once the two independent runs above have AGREED -- never write a
    // golden from a scenario that has not just demonstrated its own determinism.
    if (UPDATE) writeFixture(sc.key, rec1);

    const golden = loadFixture(sc.key);
    assert.equal(rec1.endStateDigest, golden.endStateDigest, `${sc.key}: v2 end-state behaviour changed since capture`);
    assert.equal(rec1.alarmSequenceDigest, golden.alarmSequenceDigest, `${sc.key}: v2 alarm-order behaviour changed since capture`);
    // Readable extras, so a failing digest above tells a human WHAT moved, not just THAT it did.
    assert.deepEqual(rec1.alarmSeq, golden.alarmSeq, `${sc.key}: alarm sequence`);
    assert.deepEqual(rec1.trips, golden.trips, `${sc.key}: P.trips`);
    assert.deepEqual(rec1.faults, golden.faults, `${sc.key}: P.faults`);
    assert.equal(rec1.phase, golden.phase, `${sc.key}: P.b.phase`);
    assert.equal(rec1.driftOff, golden.driftOff, `${sc.key}: P.driftOff`);
    assert.equal(rec1.countsAlarms, golden.countsAlarms, `${sc.key}: active alarm count`);
    assert.equal(rec1.countsEvents, golden.countsEvents, `${sc.key}: event count`);
    assert.ok(rec1.countsEvents < 600, `${sc.key}: event count at or above the 600-entry ring cap (Component.addEvent) -- this scenario's event count would silently under-report`);
    // `model` is PROVENANCE, never an assertion. ESS.MODEL_ID changes whenever the app page
    // or any src module changes -- including a UI-only edit that cannot move behaviour -- so
    // asserting it here would fail all thirteen goldens the moment stage SA adds a module,
    // for a reason unrelated to behaviour, and teach the next reader to re-capture digests.
    // Re-capturing on a MODEL_ID change destroys the baseline this stage exists to create.
    // (Removed by the lead during S0 integration; proven by faking the id -- 13 failures.)
  });
}
