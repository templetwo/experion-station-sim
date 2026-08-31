// @artifact dev
// Deterministic fixture set for the twelve architecture drills A1-A12
// (V3-PLAN.md section 10: "one per A-drill, committed under tests/fixtures/" --
// here under the NEW tests/fixtures/arch/ subdirectory, never the frozen S0
// baseline that lives directly under tests/fixtures/, which this file never
// touches). See tests/_fixture.js for the canon()/digest() contract this file
// builds on; that file is shared and is not edited here.
//
// ============================================================ SCOPE
// The drills are not yet wired into the app -- that is stage S3 (V3-PLAN section
// 9). Stage SA's src/drill-arch.js and src/fault-engine.js are pure data + pure
// functions: no DOM, no topology graph, no dispatch journal, no instructor panel.
// This file therefore captures exactly what those two pure modules can determine
// on their own, per the assignment brief, and nothing more:
//   1. a DEFINITION DIGEST of the whole drill object -- a drift detector for any
//      change to a drill's title, objectives, preset, timeline, actions, gate or
//      weights, computed with tests/_fixture.js's own canon()/digest().
//   2. the drill's own FAULT TIMELINE, enriched with the matching FaultEngine
//      FaultDefinition's domain/healthEffect/propagate/magnitudeRange -- a real
//      cross-file consistency check, since both files keep independent,
//      hand-pinned copies of the fault vocabulary (see both files' headers).
//   3. the EXPECTED-ACTION SET (the six-item rubric shape buildDrill() produces).
//   4. the SAFETY GATE rule(s).
//   5. the RUBRIC WEIGHTS (scoringRules: effective, per-drill, already resolved
//      to sum to 100).
//   6. the SCORED OUTCOME of three synthetic journals built only from the
//      drill's own data: empty (floor, must be 0), ideal (one accepted action per
//      required expectedAction -> must be 100/pass/ungated), and ideal+gate-trip
//      (ceiling capped at PASS_MARK-1 regardless of category credit already
//      earned). Together these three fix the drill's scoring RANGE.
//
// NOT captured here -- S3 work, once the drills run live:
//   - resolving faultTimeline/expectedActions/safetyGate target ids against the
//     REAL topology graph (tests/drill-arch.test.js already does this against a
//     live Topology.build() graph over a real Component; duplicating it here
//     would tie this fixture's stability to src/topology.js's node census and to
//     src/instructor.js -- which stage S2 is mid-editing in this same tree right
//     now -- neither of which is this assignment's file to depend on).
//   - actually calling FaultEngine.activate()/computeHealth() against a graph,
//     or ESS.Dispatch journaling real trainee/instructor actions.
//   - processStable / an endStateDigest from a running simulation. V3-PLAN
//     section 10's illustrative fixture shows commands like
//     `t=120.0 instructor.inject(NET_U1_PATH_A_FAIL)` against a live sim; no such
//     sim exists yet for the A-series, so `commands` below is the ActionEvent-
//     shaped journal scoreDrill() actually consumes today, not that prose.
//   - `seed`'s only real future use is to seed ctx.rand for a magnitude-bearing
//     fault (BIASED_MEASUREMENT, NOISY_MEASUREMENT) once S3 calls
//     FaultEngine.activate for real. No magnitude is drawn here, so `seed` is
//     recorded now purely as the V3-PLAN section 10 fixture-shape field it is,
//     unexercised until then.
//
// ============================================================ TWO INDEPENDENT CONSTRUCTIONS
// src/drill-arch.js and src/fault-engine.js are pure UMD factories with no
// shared mutable module-level state and no cross-require between them (both
// files' own headers say so explicitly). "Independent construction" here means
// clearing node's require cache and re-running each factory from scratch --
// proving buildDrill(), deepFreeze() and the twelve-drill literal table produce
// byte-identical output on a second, wholly separate evaluation. This is the
// same discipline tests/golden-drills.test.js and tests/fault-engine.test.js
// apply via two fresh Component/graph builds, adapted to modules that carry no
// PRNG or Component state to vary in the first place: what could still differ
// between two constructions is a bug (module-level mutation left over from a
// previous call, iteration-order dependence, etc.), which is exactly what this
// guards against. Every fixture record below is built once from EACH
// construction and compared with assert.deepEqual BEFORE loadOrSave ever runs --
// a disagreement throws there, so UPDATE_GOLDENS can never write from two
// constructions that disagree; that would itself be a reportable finding, not
// something to paper over.
//
// Regeneration: normal runs only READ the committed fixtures under
// tests/fixtures/arch/ and hard-fail if one is missing. Set UPDATE_GOLDENS=1 to
// (re)capture -- never the default path -- and even then only after the
// two-construction agreement assertion above has already passed for that drill.
//
// ============================================================ A FINDING, not papered over
// The general cross-file test below ("drill-arch.js and fault-engine.js pin...")
// is LEFT STRICT (order-sensitive) on purpose and is expected to be RED right
// now: the two files' independently hand-pinned FAULT_IDS copies match as a SET
// (same 13 ids) but NOT in order. src/drill-arch.js's copy follows V3-PLAN
// section 5's table order faithfully (its own header says so and it does:
// ...OPEN_INPUT_BAD_QUALITY, VALVE_RESPONSE_FAILURE...). src/fault-engine.js's
// copy swaps those same two entries (...VALVE_RESPONSE_FAILURE,
// OPEN_INPUT_BAD_QUALITY...), contradicting both its own header's claim of an
// "identical literal list" and the plan's table order. Neither file's own test
// catches this, because each only asserts its OWN copy against its OWN
// hard-coded expectation -- never against the other file's copy. Reported here
// as a finding, not fixed: src/fault-engine.js and src/drill-arch.js are not
// this assignment's files to edit.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { digest, modelId } = require('./_fixture');

// This stage's capture date; distinct from the S0 D-series' 20260829
// (tests/golden-drills.test.js / tests/golden-upsets.test.js) so a reader can
// tell which stage's fixtures they are looking at. Not yet consumed by any
// seeded draw -- see the SCOPE note above.
const SEED = 20260830;

const ARCH_FIXTURE_DIR = path.join(__dirname, 'fixtures', 'arch');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

fs.mkdirSync(ARCH_FIXTURE_DIR, { recursive: true });

/** Clear node's require cache for one src module and require it fresh -- a
 *  genuine second construction of its UMD factory(), not the cached singleton a
 *  plain second require() would return. Safe here: node's test runner isolates
 *  each test FILE in its own process by default, so this cannot bleed into any
 *  other test file's view of these modules. */
function freshRequire(relPath) {
  const full = require.resolve(relPath);
  delete require.cache[full];
  return require(relPath);
}

function freshModules() {
  return {
    DrillArch: freshRequire('../src/drill-arch.js'),
    FaultEngine: freshRequire('../src/fault-engine.js'),
    Topology: freshRequire('../src/topology.js'),
  };
}

// ---------------------------------------------------------------- synthetic journals

/** One accepted ActionEvent per required expectedAction, in the drill's own
 *  expectedActions order, built ONLY from the drill's own data. Mirrors the
 *  "everything done right" shape scoreDrill() is designed to reward with 100. */
function idealCommands(d) {
  let seq = 0;
  return d.expectedActions.filter((a) => a.required !== false).map((a) => {
    seq += 1;
    const e = { seq, simTime: seq * 1000, actor: 'TRAINEE', actionType: a.actionType, accepted: true };
    if (a.target !== undefined) e.target = Array.isArray(a.target) ? a.target[0] : a.target;
    if (a.payloadMatch) e.payload = JSON.parse(JSON.stringify(a.payloadMatch));
    return e;
  });
}

/** The drill's own major-unsafe move (safetyGate[0]), as an accepted ActionEvent
 *  appended after an otherwise-clean journal. */
function gateCommand(gate, seq) {
  const e = {
    seq, simTime: seq * 1000, actor: 'TRAINEE', actionType: gate.actionType, accepted: true,
    target: Array.isArray(gate.target) ? gate.target[0] : gate.target,
  };
  if (gate.payloadMatch) e.payload = JSON.parse(JSON.stringify(gate.payloadMatch));
  return e;
}

function slug(title) {
  return title.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------- fixture record

/** Build the fixture-shaped record for one drill id from one already-constructed
 *  module set. Pure function of (mods, id): called twice with two independent
 *  module constructions, its two outputs are compared before anything is written. */
function recordFor(mods, id) {
  const { DrillArch, FaultEngine, Topology } = mods;
  const d = DrillArch.drillById(id);
  assert.ok(d, id + ': drill must resolve');
  const domain = DrillArch.domainsOf(d)[0];
  assert.ok(Topology.LAYERS.includes(domain), id + ': declared domain ' + domain + ' is not a real topology layer');

  const faultTimeline = d.faultTimeline.map((f) => {
    const def = FaultEngine.getFaultDef(f.faultId);
    assert.ok(def, id + ': faultId ' + f.faultId + ' is not registered in FaultEngine.FAULT_DEFS');
    return {
      tSec: f.tSec, faultId: f.faultId, targets: f.targets.slice(), note: f.note,
      faultEngineDomain: def.domain, healthEffect: def.healthEffect,
      propagate: def.propagate, magnitudeRange: def.magnitudeRange,
    };
  });

  const commands = idealCommands(d);
  const idealScore = DrillArch.scoreDrill(id, commands);
  assert.equal(idealScore.score, 100, id + ': the ideal journal built from the drill\'s own required actions must score 100');
  assert.equal(idealScore.pass, true, id);
  assert.equal(idealScore.gated, false, id);

  const emptyScore = DrillArch.scoreDrill(id, []);
  assert.equal(emptyScore.score, 0, id + ': an empty journal must score 0');
  assert.equal(emptyScore.pass, false, id);

  const gate = d.safetyGate[0];
  const gatedJournal = commands.concat([gateCommand(gate, commands.length + 1)]);
  const gatedScore = DrillArch.scoreDrill(id, gatedJournal);
  assert.equal(gatedScore.gated, true, id + ': the drill\'s own gate action must be detected as tripped');
  assert.equal(gatedScore.score, DrillArch.PASS_MARK - 1, id + ': a gate tripped from an otherwise-clean 100 journal must cap exactly at PASS_MARK-1');
  assert.equal(gatedScore.pass, false, id + ': a gated run must never pass');

  return {
    fixture: id + '_' + slug(d.title),
    model: modelId(),
    seed: SEED,
    scopeNote: 'SA pure-module capture (src/drill-arch.js + src/fault-engine.js data only); '
      + 'no topology graph, no live fault activation, no dispatch journal. See this file\'s '
      + 'header for exactly what stage S3 must add.',
    drill: { id: d.id, title: d.title, basePreset: d.basePreset, domain },
    definitionDigest: digest(d),
    faultTimeline,
    expectedActions: d.expectedActions,
    safetyGate: d.safetyGate,
    scoringRules: d.scoringRules,
    commands,
    expected: {
      domain,
      scoreRange: { min: emptyScore.score, gatedCap: gatedScore.score, max: idealScore.score },
      idealScore,
      gatedScore,
      emptyScore,
    },
  };
}

function fixtureFile(id) {
  return path.join(ARCH_FIXTURE_DIR, id + '.json');
}

function loadOrSave(id, record) {
  const file = fixtureFile(id);
  if (UPDATE) {
    // Exactly one "@artifact" occurrence: the classifier is a plain regex over
    // the file's first 3 lines (docs/dev/ARTIFACT-CLASSES.md) and matches inside
    // a JSON string value just as well as a JS comment.
    const stamped = { '//': '@artifact dev (architecture-drill fixture; see tests/drill-arch-fixtures.test.js)', ...record };
    fs.writeFileSync(file, JSON.stringify(stamped, null, 2) + '\n');
    return stamped;
  }
  assert.ok(fs.existsSync(file), file + ' is missing -- run with UPDATE_GOLDENS=1 to capture it '
    + '(only after the two-construction agreement check above has already passed)');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ============================================================ general, one-shot invariants

// One shared module set for the structural checks below (no two-construction
// discipline needed here -- these are plain vocabulary/shape assertions, the
// same style tests/drill-arch.test.js and tests/fault-engine.test.js already use
// with a single top-level require). Fixture capture further below builds its
// OWN independent pair per drill.
const M = freshModules();

test('twelve drills, exactly the ids A1..A12, no more and no fewer', () => {
  const ids = M.DrillArch.drillIds();
  assert.equal(ids.length, 12);
  const expected = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'];
  assert.deepEqual(ids.slice().sort(), expected.slice().sort());
});

test('every drill\'s declared domain is a real topology layer', () => {
  M.DrillArch.DRILLS.forEach((d) => {
    const domain = M.DrillArch.domainsOf(d)[0];
    assert.ok(M.Topology.LAYERS.includes(domain), d.id + ': domain ' + domain + ' is not one of ' + M.Topology.LAYERS.join(', '));
  });
});

test('FINDING: drill-arch.js and fault-engine.js pin the SAME 13 fault ids, but NOT in the same order', () => {
  // See this file's header, "A FINDING, not papered over". Each file's own test
  // (tests/drill-arch.test.js, tests/fault-engine.test.js) only checks its own
  // copy against its own hard-coded literal list -- never against the other
  // file's copy. This is that missing cross-check.
  //
  // Set equality holds (both genuinely list the same 13 ids)...
  assert.deepEqual(M.DrillArch.FAULT_IDS.slice().sort(), M.FaultEngine.FAULT_IDS.slice().sort(),
    'the two files do not even agree on the SET of fault ids -- this would be a more severe finding than the one this test documents');
  // ...but ORDER does not, contradicting both files' own header claims of an
  // "identical literal list" / "identical pinned copy". Left STRICT deliberately
  // (never weaken an assertion to go green) so this stays visibly red until an
  // owner of one of those two files reconciles them.
  assert.deepEqual(M.DrillArch.FAULT_IDS, M.FaultEngine.FAULT_IDS,
    'order mismatch: drill-arch.js follows V3-PLAN section 5\'s table order '
    + '(...OPEN_INPUT_BAD_QUALITY, VALVE_RESPONSE_FAILURE...); fault-engine.js swaps '
    + 'those two entries (...VALVE_RESPONSE_FAILURE, OPEN_INPUT_BAD_QUALITY...). '
    + 'Neither file is this assignment\'s to edit -- reported, not fixed.');
});

test('every drill\'s faultTimeline faultId resolves in FaultEngine, and that fault\'s registered domain equals the drill\'s own declared hypothesis domain', () => {
  M.DrillArch.DRILLS.forEach((d) => {
    const domain = M.DrillArch.domainsOf(d)[0];
    d.faultTimeline.forEach((f) => {
      const def = M.FaultEngine.getFaultDef(f.faultId);
      assert.ok(def, d.id + ': unknown fault ' + f.faultId);
      assert.equal(def.domain, domain, d.id + ': fault ' + f.faultId + ' is registered in FaultEngine as domain '
        + def.domain + ' but the drill declares hypothesis domain ' + domain);
    });
  });
});

// ============================================================ per-drill fixtures

const IDS = M.DrillArch.drillIds().slice().sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

for (const id of IDS) {
  test('fixture ' + id + ': two independently constructed modules agree, and match the committed fixture', () => {
    const modsA = freshModules();
    const modsB = freshModules();
    const recA = JSON.parse(JSON.stringify(recordFor(modsA, id)));
    const recB = JSON.parse(JSON.stringify(recordFor(modsB, id)));

    // The gate: a disagreement here throws BEFORE loadOrSave runs, so
    // UPDATE_GOLDENS can never commit a fixture the two constructions disagree on.
    assert.deepEqual(recA, recB, id + ': two independently constructed drill-arch.js/fault-engine.js '
      + 'instances produced different fixture records -- NONDETERMINISM in a supposedly pure module, '
      + 'a real finding, not something to paper over');

    const golden = loadOrSave(id, recA);

    // `model` (ESS.MODEL_ID) is PROVENANCE, never asserted for equality -- it
    // changes on any app/src edit, including ones with no bearing on these pure
    // modules' own data (tests/_fixture.js header; the MEASURED FACTS brief for
    // this assignment repeats the same rule). Likewise `scopeNote` and the `//`
    // stamp are documentation, not behaviour. Every substantive field is checked.
    assert.equal(recA.fixture, golden.fixture, id + ': fixture name moved');
    assert.equal(recA.seed, golden.seed, id + ': seed moved');
    assert.deepEqual(recA.drill, golden.drill, id + ': drill summary moved from the committed fixture');
    assert.equal(recA.definitionDigest, golden.definitionDigest, id + ': the drill\'s own definition digest moved -- something in title/objectives/preset/timeline/actions/gate/weights changed');
    assert.deepEqual(recA.faultTimeline, golden.faultTimeline, id + ': faultTimeline (incl. its FaultEngine cross-check) moved from the committed fixture');
    assert.deepEqual(recA.expectedActions, golden.expectedActions, id + ': expectedActions moved from the committed fixture');
    assert.deepEqual(recA.safetyGate, golden.safetyGate, id + ': safetyGate moved from the committed fixture');
    assert.deepEqual(recA.scoringRules, golden.scoringRules, id + ': scoringRules (rubric weights) moved from the committed fixture');
    assert.deepEqual(recA.commands, golden.commands, id + ': the ideal command list moved from the committed fixture');
    assert.deepEqual(recA.expected, golden.expected, id + ': the scored outcome (domain / scoreRange / idealScore / gatedScore / emptyScore) moved from the committed fixture');
  });
}
