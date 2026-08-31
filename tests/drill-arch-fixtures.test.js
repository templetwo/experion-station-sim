// @artifact dev
// V3-PLAN S3/S4 exit condition: "each drill has a deterministic fixture with an
// endStateDigest and a score range." Covers A1-A12.
//
// Fixtures live under tests/fixtures/arch/ (NOT the locked top-level tests/fixtures/*.json
// -- this is the "new... lane" the architect addendum names). tests/_fixture.js (locked) is
// read-only here: endState()/digest() are reused as-is, never edited, and its endState()
// deliberately ignores P.archFaults (V3-PLAN addendum section C.3 / advisory Q4), so a
// second digest -- a canonical serialization of ESS.FaultEngine.healthProjection, computed
// entirely in THIS file -- covers the engine-only drills (A2, A4, A5, A6) that move no
// physics at all. Every script below drives the REAL production wiring this stage built
// (c.applyPreset, c.startADrill, c.aDrillWatch via c.step, c.archSelectNode, c.markEvidence,
// c.togglePin/comparePins, c.submitHypothesis, c.verifyNode, c.ackAlarm, c.setMode,
// c.setOos/c.signAction) and scores the RETAINED ActionEvent array
// (c.P.aDrill.events) through ESS.DrillArch.scoreDrill -- never the journal (the trap
// tests/dispatch-training.test.js pins).
//
// Regeneration: normal runs ONLY READ the committed fixtures under tests/fixtures/arch/ and
// hard-fail if one is missing. Set UPDATE_GOLDENS=1 to (re)capture -- never the default path.
// The write is gated behind agreement of TWO INDEPENDENTLY CONSTRUCTED runs (fresh boot(),
// same script, exactly the discipline tests/golden-drills.test.js loadOrSave uses): a
// disagreement fails the test before the fixture file is ever touched, so a nondeterministic
// scenario can never be captured as if it were a golden.
//
// A FINDING, RECORDED HERE RATHER THAN WORKED AROUND: drill-arch's "stabilize" category
// (30% or more of every drill's rubric) is the ACK action, targeting the drill's primary
// node. This app has no new dispatch type for "acknowledge" -- it reuses the existing
// alarm-ack call site (ackAlarm), synthesizing an ACK ActionEvent mapped to that alarm's
// point's FIELD-layer node id. That is only ever reachable for a drill whose fault is wired
// to real physics: A1's legacy 'xmtr' upset raises a real FIC102 BADPV alarm, so A1 (and,
// opportunistically, A3's 'drift' upset if the bias crosses an alarm limit inside the
// window) can earn full marks. A2/A4/A5/A6's faults are ENGINE-ONLY by design (V3-PLAN
// addendum decision D1: the nine non-reserved engine faults must not touch src/models.js),
// so they raise no alarm at all and "stabilize" is UNREACHABLE for them in S3 -- same shape
// as the already-documented TRAINING.DEBRIEF gap, one category early. The score ranges below
// are the honest ceiling given that, not a weakened assertion: nobody may fabricate an ACK
// event for a drill whose fault the physics core was never told to raise.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const DrillArch = require('../src/drill-arch.js');
const FaultEngine = require('../src/fault-engine.js');
const { run, endState, digest, modelId } = require('./_fixture');

const { Component } = load();
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'arch');

const UPDATE = process.env.UPDATE_GOLDENS === '1';

function fixtureFile(name) { return path.join(FIXTURE_DIR, name + '.json'); }

/**
 * Load the committed fixture, or -- ONLY under UPDATE_GOLDENS=1, and only ever called after
 * the caller has already proven two independent runs agree -- capture `record` as the new
 * committed fixture. Never writes on the default path, mirroring golden-drills.test.js.
 */
function loadOrSaveFixture(name, record) {
  const file = fixtureFile(name);
  if (UPDATE) {
    const stamped = { '//': '@artifact dev (A-drill fixture; see tests/drill-arch-fixtures.test.js)', ...record };
    fs.writeFileSync(file, JSON.stringify(stamped, null, 2) + '\n');
    return stamped;
  }
  assert.ok(fs.existsSync(file), `${file} is missing -- run with UPDATE_GOLDENS=1 to capture a golden (only after confirming the two independent constructions agree)`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function boot() { const c = new Component({}); c.initSim(); return c; }
function physicsDigest(c) { return digest({ ...endState(c), counts: undefined }); }
function healthDigest(c) { return digest(FaultEngine.healthProjection(c.archFaultState(), c.topo)); }

/**
 * Drive one A-drill through the real production wiring: load the base preset, arm the
 * drill (schedules its fault timeline, no rand draw), settle, optionally ack the alarm the
 * fault raised, mark evidence + pin-compare on the drill's own EV1/EV2 targets, submit the
 * correct hypothesis, verify, and hand back the RETAINED events (never the journal).
 */
function driveDrill(drillId, settleSeconds, opts) {
  opts = opts || {};
  const c = boot();
  const def = DrillArch.drillById(drillId);
  const act = {}; def.expectedActions.forEach((a) => { act[a.id] = a; });
  const primary = act.EV1.target;
  const compare = act.EV2.payloadMatch.targets.slice();
  const domain = act.LOC.payloadMatch.domain;

  c.applyPreset(def.basePreset);
  c.startADrill(drillId);
  if (opts.preFault) opts.preFault(c);
  run(c, settleSeconds);
  if (opts.ackFind) {
    const al = c.alarmEngine.unacked().find(opts.ackFind);
    if (al) c.ackAlarm(al);
  }
  // Every scoring command (MARK_EVIDENCE, PIN_COMPARE, SUBMIT_HYPOTHESIS, VERIFY) is
  // Diagnose-only at the dispatch layer (src/dispatch.js requireMode(), architect ruling
  // 2026-08-31) -- Learn reveals blast radius, so earning these anywhere else would be
  // reading the answer key. A real trainee switches into Diagnose before touching any of
  // these controls; this script does the same.
  c.setState({ archMode: 'diagnose' });
  c.archSelectNode(primary); c.markEvidence(primary);
  compare.forEach((id) => c.archSelectNode(id));
  compare.forEach((id) => c.togglePin(id));
  c.comparePins();
  c.submitHypothesis(domain);
  c.archSelectNode(primary); c.verifyNode(primary);
  if (opts.postAll) opts.postAll(c);

  const events = c.P.aDrill.events.slice();
  return { c, events, score: DrillArch.scoreDrill(drillId, events) };
}

/** The drill-intrinsic (not run-dependent) targets a fixture records, straight from drill-arch. */
function drillTargets(drillId) {
  const def = DrillArch.drillById(drillId);
  const act = {}; def.expectedActions.forEach((a) => { act[a.id] = a; });
  return { primary: act.EV1.target, compare: act.EV2.payloadMatch.targets.slice(), domain: act.LOC.payloadMatch.domain };
}

function buildRecord(drillId, seconds, result) {
  const { c, events, score } = result;
  const targets = drillTargets(drillId);
  return {
    fixture: 'ARCH_' + drillId,
    model: modelId(),
    seed: 20260829,
    seconds,
    drillId,
    primary: targets.primary,
    compare: targets.compare,
    domain: targets.domain,
    eventCount: events.length,
    physicsDigest: physicsDigest(c),
    healthDigest: healthDigest(c),
    score: score.score,
    pass: score.pass,
    gated: score.gated,
  };
}

/**
 * Drive `drillId` through `scriptFn` TWICE from independent fresh Components (scriptFn calls
 * driveDrill, which calls boot() internally, so runA and runB never share state). Assert the
 * two runs agree byte for byte -- nondeterminism detection BEFORE the fixture file is ever
 * touched, same discipline as tests/golden-drills.test.js loadOrSave -- then load (or, only
 * under UPDATE_GOLDENS=1, capture) the committed fixture and assert today's run has not moved
 * from it. Returns runA's { c, events, score } for drill-specific assertions.
 */
function driveAndCheck(name, drillId, seconds, scriptFn) {
  const runA = scriptFn();
  const runB = scriptFn();
  const recA = buildRecord(drillId, seconds, runA);
  const recB = buildRecord(drillId, seconds, runB);

  assert.equal(recA.physicsDigest, recB.physicsDigest, `${name}: physics endState digest differs between two independent runs -- NONDETERMINISM`);
  assert.equal(recA.healthDigest, recB.healthDigest, `${name}: health-projection digest differs between two independent runs -- NONDETERMINISM`);
  assert.equal(recA.eventCount, recB.eventCount, `${name}: retained event count differs between two independent runs -- NONDETERMINISM`);
  assert.deepEqual(runA.score, runB.score, `${name}: scored outcome differs between two independent runs -- NONDETERMINISM`);

  const golden = loadOrSaveFixture(name, recA);
  // model is provenance only (tests/_fixture.js header; the same rule golden-drills.test.js
  // follows) -- never asserted for equality, since ESS.MODEL_ID moves on any app/src edit.
  assert.equal(recA.physicsDigest, golden.physicsDigest, `${name}: physics endState digest moved from the committed fixture`);
  assert.equal(recA.healthDigest, golden.healthDigest, `${name}: health-projection digest moved from the committed fixture`);
  assert.equal(recA.eventCount, golden.eventCount, `${name}: retained event count moved from the committed fixture`);
  assert.equal(recA.score, golden.score, `${name}: score moved from the committed fixture`);
  assert.equal(recA.pass, golden.pass, `${name}: pass/fail moved from the committed fixture`);
  assert.equal(recA.gated, golden.gated, `${name}: gated flag moved from the committed fixture`);
  assert.equal(recA.primary, golden.primary, `${name}: primary target moved from the committed fixture`);
  assert.deepEqual(recA.compare, golden.compare, `${name}: compare targets moved from the committed fixture`);
  assert.equal(recA.domain, golden.domain, `${name}: domain moved from the committed fixture`);

  return runA;
}

// ==================================================== A1 - A6, clean runs

test('A1 Frozen flow measurement: a clean run earns full marks except the S4-only debrief category', () => {
  const ackFind = (al) => al.tag === 'FIC102' && al.cond === 'BADPV';
  const r = driveAndCheck('A1', 'A1', 75, () => driveDrill('A1', 75, { ackFind }));
  assert.equal(r.score.score, 90, 'A1 is the one S3 drill whose ACK is reachable (real FIC102 BADPV alarm) -- the ceiling matches the DO advisory\'s "a perfect S3 run scores 90"');
  assert.equal(r.score.pass, true);
  assert.equal(r.score.gated, false);
});

test('A2 Input channel failure: engine-only fault, ACK unreachable -- ceiling is evidence+localization+verification', () => {
  const r = driveAndCheck('A2', 'A2', 65, () => driveDrill('A2', 65));
  assert.equal(r.score.score, 60, 'OPEN_INPUT_BAD_QUALITY raises no alarm (D1: engine-only faults never touch src/models.js), so stabilize (ACK) scores 0 alongside debrief');
  assert.equal(r.score.pass, false);
});

test('A3 Bias with GOOD quality: the bias never crosses an alarm limit inside the drill window', () => {
  const ackFind = (al) => al.tag === 'LIC101';
  const r = driveAndCheck('A3', 'A3', 100, () => driveDrill('A3', 100, { ackFind }));
  assert.equal(r.score.score, 60);
});

test('A4 Redundancy switchover: engine-only, no alarm, same 60-point ceiling', () => {
  const r = driveAndCheck('A4', 'A4', 65, () => driveDrill('A4', 65));
  assert.equal(r.score.score, 60);
});

test('A5 Controller loss: weighted rubric, ceiling is evidence+localization+verification only', () => {
  const r = driveAndCheck('A5', 'A5', 65, () => driveDrill('A5', 65));
  assert.equal(r.score.score, 65, 'A5 weights: stabilize 25, evidence 25, localization 30, verification 10, debrief 10 -- 25+30+10=65 with stabilize/debrief unreachable');
});

test('A6 Single network path degradation: weighted rubric, same shape', () => {
  const r = driveAndCheck('A6', 'A6', 50, () => driveDrill('A6', 50));
  assert.equal(r.score.score, 70, 'A6 weights: evidence 30, localization 25, verification 15 = 70 with stabilize/debrief unreachable');
});

// ==================================================== A7 - A12 (S4 library)

test('A7 Communications partition: engine-only, ACK unreachable -- ceiling is evidence+localization+verification', () => {
  const r = driveAndCheck('A7', 'A7', 65, () => driveDrill('A7', 65));
  assert.equal(r.score.score, 60, 'COMMS_PARTITION raises no process alarm (D1: engine-only faults never touch src/models.js), so stabilize (ACK) scores 0 alongside debrief');
  assert.equal(r.score.pass, false);
});

test('A8 Server / flex service loss: engine-only, same 60-point ceiling', () => {
  const r = driveAndCheck('A8', 'A8', 65, () => driveDrill('A8', 65));
  assert.equal(r.score.score, 60);
});

test('A9 Local station failure: weighted rubric, ceiling is evidence+localization+verification', () => {
  const r = driveAndCheck('A9', 'A9', 65, () => driveDrill('A9', 65));
  assert.equal(r.score.score, 70, 'A9 weights: stabilize 20, evidence 25, localization 25, verification 20, debrief 10 -- 25+25+20=70 with stabilize/debrief unreachable');
});

test('A10 Historian gap: engine-only, same 60-point ceiling', () => {
  const r = driveAndCheck('A10', 'A10', 65, () => driveDrill('A10', 65));
  assert.equal(r.score.score, 60);
});

test('A11 Assistant loss: engine-only, same 60-point ceiling', () => {
  const r = driveAndCheck('A11', 'A11', 65, () => driveDrill('A11', 65));
  assert.equal(r.score.score, 60);
});

test('A12 Cascading symptoms: BIASED_MEASUREMENT on XMTR-TIC201 is not the reserved drift pair, so physics is not driven', () => {
  // FINDING, recorded rather than worked around: aDrillReservedUpsetKey only maps the
  // three legacy pairs (xmtr@XMTR-FIC102, drift@XMTR-LIC101, stick@VLV-TV202). A12's
  // BIASED_MEASUREMENT @ XMTR-TIC201 therefore fires through archFireFault and never
  // touches src/models.js (D1). The cascade the drill describes is engine-health only
  // in this wiring; ACK is unreachable and the R-201 trip abort does not fire. Same
  // 60-point S3/S4 ceiling as the other engine-only drills.
  const r = driveAndCheck('A12', 'A12', 135, () => driveDrill('A12', 135));
  assert.equal(r.score.score, 60);
  assert.equal(r.score.pass, false);
});

// ==================================================== the safety gate, live and outcome-based, at app scale

test('A1 gated: seizing MAN before diagnosing anything caps a would-be 90 down to 79 and flips pass to false', () => {
  const ackFind = (al) => al.tag === 'FIC102' && al.cond === 'BADPV';
  const preFault = (c) => c.setMode('FIC102', 'MAN'); // CAS -> MAN while the trainee has inspected nothing yet
  const r = driveAndCheck('A1_gated', 'A1', 75, () => driveDrill('A1', 75, { ackFind, preFault }));
  assert.equal(r.score.gated, true);
  assert.equal(r.score.gateHits.length, 1);
  assert.equal(r.score.score, 79, 'PASS_MARK-1 cap: every category still earns its points (the cap does not erase them), but 90 clamps to 79');
  assert.equal(r.score.pass, false, 'a gated run must not pass regardless of the raw category total');
});

test('A6 gated: an unrelated MODE.SET still trips the gate even though the raw score was already under the cap', () => {
  const postAll = (c) => c.setMode('LIC401', 'MAN');
  const r = driveAndCheck('A6_gated', 'A6', 50, () => driveDrill('A6', 50, { postAll }));
  assert.equal(r.score.gated, true);
  assert.equal(r.score.score, 70, 'the cap is min(clamped, 79); 70 was already below 79, so the NUMBER does not move -- only `gated` does. Both are asserted so a future change that stops setting `gated` cannot hide behind an unchanged score.');
});

test('outcome-based (V3-PLAN section 6, pinned separately in tests/refusal-scoring.test.js): a REFUSED unsafe attempt never gates, at real app call sites', () => {
  // setOos at OPER level: can('ENGR') fails before any state mutation, journal entry, or
  // archSynthEvent call -- nothing is retained to gate against.
  const refused = driveDrill('A2', 65, { postAll: (c) => c.setOos('FIC211', 'PVHI', true) });
  assert.equal(refused.score.gated, false, 'a security-level refusal must never trip the safety gate');
  assert.equal(refused.score.score, 60, 'refusing to gate must not change the earned score either');

  // The SAME action, actually accepted (ENGR level + a completed electronic signature),
  // DOES gate -- the positive control proving the refused case above is not vacuous.
  const c = boot();
  const def = DrillArch.drillById('A2');
  const act = {}; def.expectedActions.forEach((a) => { act[a.id] = a; });
  c.applyPreset(def.basePreset);
  c.startADrill('A2');
  run(c, 65);
  c.setState({ sec: 'ENGR' });
  c.setOos('FIC211', 'PVHI', true);
  assert.equal(c.state.dlg && c.state.dlg.type, 'esig', 'test setup: expected the signature dialog to open');
  c.setState({ dlgPw: 'engr', dlgReason: 'gate demonstration' });
  assert.equal(c.signAction(), true, 'test setup: the signature must be accepted');
  c.setState({ archMode: 'diagnose' });
  c.archSelectNode(act.EV1.target); c.markEvidence(act.EV1.target);
  act.EV2.payloadMatch.targets.forEach((id) => { c.archSelectNode(id); c.togglePin(id); });
  c.comparePins();
  c.submitHypothesis(act.LOC.payloadMatch.domain);
  c.archSelectNode(act.EV1.target); c.verifyNode(act.EV1.target);
  const accepted = DrillArch.scoreDrill('A2', c.P.aDrill.events.slice());
  assert.equal(accepted.gated, true, 'POSITIVE CONTROL: an accepted OOS-ON on the gate\'s own CM must trip it');
});

// ==================================================== mutual exclusion + lane hygiene

test('mutual exclusion holds both directions: an A-drill blocks the real D-drill dialog button, and a D-drill blocks startADrill', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  assert.equal(c.state.drill, null, 'starting an A-drill must never populate the legacy this.state.drill slot');

  // Exercise the REAL UI callback (renderVals().dg.drills[i].cb), not a hand-rolled
  // equivalent: this is exactly the closure the Training Drills dialog's button calls.
  c.setState({ dlg: { type: 'drills' } });
  const v = c.renderVals();
  const d1 = v.dg.drills.find((x) => x.id === 'D1');
  assert.ok(d1, 'test setup: D1 must be listed');
  d1.cb();
  assert.equal(c.state.drill, null, 'the dialog button must refuse to start a D-drill while an A-drill is active');
  assert.equal(c.P.aDrill.id, 'A1', 'the running A-drill must be untouched by the refused D-start attempt');

  // The other direction: end the A-drill, confirm the SAME button now works, then confirm
  // startADrill refuses while that D-drill is running.
  c.endADrill('ENDED FOR TEST');
  assert.equal(c.P.aDrill, null);
  const v2 = c.renderVals();
  v2.dg.drills.find((x) => x.id === 'D1').cb();
  assert.ok(c.state.drill, 'D1 must start once no A-drill is active');
  c.startADrill('A2');
  assert.equal(c.P.aDrill, null, 'startADrill must refuse while a legacy D-drill is running');
});

test('an A-drill survives snapshot/restore/replay exactly like every other v3 state', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  run(c, 65);
  c.setState({ archMode: 'diagnose' });
  c.archSelectNode('XMTR-FIC102');
  c.markEvidence('XMTR-FIC102');
  assert.equal(c.P.aDrill.events[c.P.aDrill.events.length - 1].accepted, true, 'test setup: the mark must have been accepted');
  const before = JSON.stringify(c.P.aDrill);

  const snap = c.snapshotData('mid-drill');
  assert.ok(snap, 'snapshot must succeed mid-drill');
  c.restoreSnapshot(snap, 'test restore');
  assert.equal(JSON.stringify(c.P.aDrill), before, 'A-drill state (including retained events) must round-trip a snapshot/restore unchanged');
  assert.equal(c.P.archInspected['XMTR-FIC102'], true, 'explicit-inspection state must survive restore too');
});

// ==================================================== Learn is hidden during an A-drill

// Lead architect ruling of record, 2026-08-31 (docs/dev/PASSDOWN-2026-08-31.md section 8,
// item 3): "Learn is unavailable during an active A-drill. V3-PLAN line 186: 'Learn shows
// the answer'. Hidden, not disabled." Hiding the mode CHIP alone is not enough --
// architecture-view-model.js's build() decides whether blast radius renders from its `mode`
// argument, not from `availableModes`, so a trainee already sitting in Learn when a drill
// starts must be defensively remapped, not just have the button taken away next render.
test('Learn is hidden (not merely disabled) while an A-drill is active, and does not leak blast radius to a trainee already in it', () => {
  const c = boot();
  c.applyPreset('U1_SS');

  // No A-drill yet: Learn is offered normally.
  c.setState({ display: 'arch', archMode: 'learn' });
  const before = c.renderVals().arch;
  assert.ok(before.modeChips.some((m) => m.label === 'LEARN'), 'Learn must be offered before any A-drill starts');

  c.startADrill('A1');
  run(c, 65); // FROZEN_MEASUREMENT active on XMTR-FIC102
  c.setState({ archSel: 'XMTR-FIC102' }); // still sitting in 'learn' from before the drill started

  const v = c.renderVals().arch;
  assert.ok(!v.modeChips.some((m) => m.label === 'LEARN'), 'the LEARN chip must be hidden while an A-drill is active');
  // The defensive remap: even though state.archMode is still literally 'learn' (untouched,
  // per the "never a silently changed trainee choice" design), blast radius must not render.
  assert.equal(v.inspector && v.inspector.rows.some((r) => /blast/i.test(r.label)), false,
    'no inspector row should even be labelled blast radius, but the real proof is the next assertion:');
  // Trace's own path/branches section must be showing instead (proof this is a real
  // remap to trace-shaped content, not just an accidental empty view).
  assert.equal(v.showPath, true, 'the remapped render must actually show trace-shaped content, not silently go blank');

  c.endADrill('ENDED FOR TEST');
  const after = c.renderVals().arch;
  assert.ok(after.modeChips.some((m) => m.label === 'LEARN'), 'Learn must return once no A-drill is active');
});
