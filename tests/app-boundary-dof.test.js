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
