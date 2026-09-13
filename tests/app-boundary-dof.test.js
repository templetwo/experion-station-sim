// @artifact dev
// App-level coverage for src/boundary-dof.js (docs/dev/W1-BOUNDARY-DOF-CONTRACT.md section 5,
// second file), discharging acceptance 3.4.6(c): every existing golden drill's initial
// condition still passes the pre-drill boundary/loop-spec check, and the app's own mode-change
// path is what the module is checked against for a constructed CASCADE_OPEN.
//
// Drills are started EXACTLY the way tests/golden-drills.test.js:80-90 starts them (setup,
// then needBatch, then startDrill / applyPreset+startADrill) -- not a different path invented
// here. See tests/app-drill-start-ui.test.js and tests/golden-drills.test.js, read first per
// the build task.
//
// The module is required directly by path (const BoundaryDof = require('../src/boundary-dof.js')),
// the way tests/architecture-view-model.test.js requires ESS.Topology/SignalPath/FaultEngine
// directly: logic-harness only evaluates the <script src> modules already wired into the app
// head, and per the contract (section 4) that wiring is the integrating seat's job, done after
// this file. Until src/boundary-dof.js lands, every test below fails at require() time -- that
// is the correct state for this stage of the build, not a bug in this file.
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const DrillArch = require('../src/drill-arch.js');
const BoundaryDof = require('../src/boundary-dof.js');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  return c;
}

/** Start a D-series drill exactly per tests/golden-drills.test.js:80-90. */
function startD(def) {
  const c = boot();
  if (def.setup) def.setup(c);
  if (def.needBatch && c.P.b.phase === 'IDLE') c.seqCmd('START', true);
  c.startDrill(def);
  return c;
}

/** Start an A-series drill exactly per tests/drill-arch-fixtures.test.js's driveDrill(). */
function startA(id) {
  const c = boot();
  const def = DrillArch.drillById(id);
  c.applyPreset(def.basePreset);
  c.startADrill(id);
  return c;
}

test('default post-initSim() state passes the check', () => {
  const c = boot();
  const r = BoundaryDof.check(c.P, c.L);
  assert.equal(r.ok, true, 'fresh initSim(): ' + JSON.stringify(r.findings));
});

test('every D-series drill initial condition passes the check', () => {
  const c0 = boot();
  const defs = c0.drillDefs();
  assert.ok(defs.length > 0, 'drillDefs() returned at least one drill');
  for (const def of defs) {
    const c = startD(def);
    assert.ok(c.state.drill, def.id + ': startDrill did not arm');
    const r = BoundaryDof.check(c.P, c.L);
    assert.equal(r.ok, true, def.id + ': ' + JSON.stringify(r.findings));
  }
});

test('every A-series drill initial condition (basePreset) passes the check', () => {
  const ids = DrillArch.drillIds();
  assert.equal(ids.length, 12, 'twelve architecture drills');
  for (const id of ids) {
    const c = startA(id);
    assert.ok(c.P.aDrill, id + ': startADrill did not arm');
    const r = BoundaryDof.check(c.P, c.L);
    assert.equal(r.ok, true, id + ': ' + JSON.stringify(r.findings));
  }
});

test('a constructed CASCADE_OPEN on the live tag database is detected by check()', () => {
  const c = boot();
  // Verified shipped defaults (app:1841 P() helper, app:1844-1860): LIC101 ships with no
  // `mode` key so it defaults to AUTO; FIC102 ships mode:'CAS', master:'LIC101'.
  assert.equal(c.L.LIC101.mode, 'AUTO', 'LIC101 default mode');
  assert.equal(c.L.FIC102.mode, 'CAS', 'FIC102 default mode');
  // The app's own mode-change path (setMode -> ESS.Pid.transferMode), not a direct
  // field write: transferMode has no guard against a slave leaving CAS, so this
  // reproduces the exact hole CASCADE_OPEN exists to catch.
  c.setMode('FIC102', 'MAN');
  assert.equal(c.L.FIC102.mode, 'MAN', 'setMode actually moved FIC102 to MAN');
  assert.equal(c.L.LIC101.mode, 'AUTO', 'master left in AUTO -- LIC101 is still "in control" of nothing');

  const r = BoundaryDof.check(c.P, c.L);
  const hit = r.findings.find((f) => f.code === 'CASCADE_OPEN');
  assert.ok(hit, 'no CASCADE_OPEN finding: ' + JSON.stringify(r.findings));
  // REPORTED, NOT REFUSED. An open cascade is ordinary operation: tests/app-instructor.test.js
  // takes TIC202 to MAN and then starts D1, and drill D6 is built on exactly this move.
  // Refusing here would block legitimate work, which is why the contract's first reading
  // (severity 'refuse') was wrong and was corrected.
  assert.equal(hit.severity, 'note');
  assert.equal(r.ok, true, 'an open cascade must not block a drill: ' + JSON.stringify(r.findings));
});

// --- app wiring (contract section 4). The refusal is constructed with a NON-FINITE BOUNDARY
// VARIABLE rather than an open cascade: that is the real refusing condition, and it is the
// NaN-leak class the 3.1.0 VALVE_TARGET fix documents -- an unknown valve integrated to
// undefined, clamp() passed it through, and makeSnapshot then refused every snapshot.
describe('app wiring for the pre-drill check (contract section 4)', () => {
  test('an open cascade does NOT block startDrill -- it is legitimate operation', () => {
    const c = boot();
    c.setMode('FIC102', 'MAN');
    const def = c.drillDefs().find((d) => d.id === 'D1');
    c.startDrill(def);
    assert.ok(c.state.drill, 'an open cascade must never block a drill start');
  });

  test('a refusing finding actually blocks startDrill from arming, and is journalled', () => {
    const c = boot();
    c.P.h.f = NaN;                      // non-finite boundary variable: lane A refuses
    const def = c.drillDefs().find((d) => d.id === 'D1');
    c.startDrill(def);
    assert.equal(c.state.drill, null, 'startDrill must refuse to arm over a refusing finding');
    const journaled = c.events.some((e) => /BOUNDARY_NOT_FINITE|REFUS/i.test(e.desc));
    assert.ok(journaled, 'the refusal must be journalled as a SYSTEM event');
  });

  test('a refusing finding blocks startADrill from arming too', () => {
    const c = boot();
    c.P.h.f = NaN;
    c.startADrill('A1');
    assert.equal(c.P.aDrill, null, 'startADrill must refuse to arm over a refusing finding');
  });

  test('the check is skipped under replay: arming proceeds despite a refusing finding', () => {
    const c = boot();
    c.instr.replay = { active: true }; // replaying() reads !!(this.instr && this.instr.replay)
    assert.equal(c.replaying(), true, 'test setup: replaying() must read true');
    c.P.h.f = NaN;
    const def = c.drillDefs().find((d) => d.id === 'D1');
    c.startDrill(def);
    assert.ok(c.state.drill, 'a refusal during replay would break deterministic replay (release gate 3)');
  });
});

// --- the specification-integrity NOTES ------------------------------------------------
// A second seat found the notes were computed and dropped: dofPreflight acted on refusals only.
// Anthony, 2026-09-13: "Wire notes to the instructor log and the debrief, nowhere else.
// Trainee sees the board." These tests pin all three halves of that -- reaches the log, reaches
// the revealed debrief, reaches NOTHING the trainee sees and nothing the goldens digest.

describe('specification-integrity notes are surfaced, and only where the ruling allows', () => {
  const armOpenCascade = (c) => {
    c.setMode('FIC102', 'MAN');              // master LIC101 stays AUTO -> CASCADE_OPEN (a note)
    const def = c.drillDefs().find((d) => d.id === 'D1');
    c.startDrill(def);
    return def;
  };

  test('a note reaches the instructor log', () => {
    const c = boot();
    const before = (c.instr.log || []).length;
    armOpenCascade(c);
    const log = c.instr.log || [];
    assert.ok(log.length > before, 'the instructor log must gain entries');
    const hit = log.some((e) => /CASCADE_OPEN/.test(e.txt || e.text || JSON.stringify(e)));
    assert.ok(hit, 'CASCADE_OPEN must appear in the instructor log: ' + JSON.stringify(log.slice(-4)));
  });

  test('a note reaches instr.dofNotes with its code, detail and tags', () => {
    const c = boot();
    armOpenCascade(c);
    const ring = c.instr.dofNotes || [];
    assert.ok(ring.length > 0, 'instr.dofNotes must be populated');
    const all = ring.flatMap((e) => e.notes);
    const open = all.find((n) => n.code === 'CASCADE_OPEN');
    assert.ok(open, 'CASCADE_OPEN must be recorded: ' + JSON.stringify(all.map((n) => n.code)));
    assert.ok(open.detail && open.detail.length > 0);
    assert.deepEqual([...open.tags].sort(), ['FIC102', 'LIC101']);
  });

  test('the note does NOT become an event, a journal entry, or process state', () => {
    // This is the golden-safety assertion, and it is the whole reason the notes take this route:
    // tests/_fixture.js endState() digests the v2 event COUNT, and BOUNDARY_SPEC_STRUCTURAL emits
    // on EVERY drill start -- one event here would move every golden in the set.
    const c = boot();
    const evBefore = (c.events || []).length;
    const jnBefore = (c.instr.journal || []).length;
    armOpenCascade(c);
    const newEvents = (c.events || []).slice(evBefore);
    const newJournal = (c.instr.journal || []).slice(jnBefore);
    for (const e of newEvents) {
      assert.equal(/CASCADE_OPEN|BOUNDARY_SPEC_STRUCTURAL|LOOP_SEQUENCE_OWNED|LOOP_SHED/.test(e.desc || ''), false,
        'a note must never become an event: ' + JSON.stringify(e));
      assert.notEqual(e.src, 'DOF', 'no DOF event may be raised for a note');
    }
    for (const j of newJournal) {
      assert.equal(/CASCADE_OPEN|BOUNDARY_SPEC/.test(JSON.stringify(j)), false,
        'a note must never become a journal entry: ' + JSON.stringify(j));
    }
    assert.equal('dofNotes' in c.P, false, 'notes must not be stored on the process state');
  });

  test('the revealed debrief carries the note; the TRAINEE_SAFE debrief does not', () => {
    const c = boot();
    armOpenCascade(c);
    const revealed = c.dofNoteRows(true);
    assert.ok(revealed.length > 0, 'the revealed debrief must carry note rows');
    assert.equal(revealed[0].lane, 'INSTRUCTOR');
    assert.ok(/CASCADE_OPEN/.test(revealed.map((r) => r.text).join(' ')));
    assert.deepEqual(c.dofNoteRows(false), [], 'the trainee-safe debrief must carry none');
  });

  test('a clean start records the structural note and nothing alarming', () => {
    const c = boot();
    const def = c.drillDefs().find((d) => d.id === 'D1');
    c.startDrill(def);
    const all = (c.instr.dofNotes || []).flatMap((e) => e.notes).map((n) => n.code);
    assert.ok(all.includes('BOUNDARY_SPEC_STRUCTURAL'),
      'lane A always states its own structural limit: ' + JSON.stringify(all));
    assert.equal(all.includes('CASCADE_OPEN'), false, 'a clean start has no open cascade');
  });

  test('under replay the check does not run at all: no refusal AND no note', () => {
    // The original name of this test claimed notes ARE recorded under replay. That was false and
    // the test never asserted it -- it only checked that the drill armed. dofPreflight's first
    // line is `if(this.replaying()) return true;`, which returns before check() and before
    // dofNotesRecord(), so replay records nothing. Caught by the verify pass; the BEHAVIOUR is
    // right and the name was wrong. Recording nothing is correct: a replay re-runs an already
    // recorded session, and re-recording its notes would double every instructor-log entry and
    // put phantom rows in the debrief.
    const c = boot();
    c.instr.replay = { active: true };
    assert.equal(c.replaying(), true);
    c.setMode('FIC102', 'MAN');               // would produce a CASCADE_OPEN note if the check ran
    c.P.h.f = NaN;                            // would REFUSE if the check ran
    const before = ((c.instr.dofNotes || []).length);
    const def = c.drillDefs().find((d) => d.id === 'D1');
    c.startDrill(def);
    assert.ok(c.state.drill, 'replay must still arm -- release gate 3');
    assert.equal((c.instr.dofNotes || []).length, before, 'replay must record no note');
  });
});
