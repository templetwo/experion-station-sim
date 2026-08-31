// @artifact dev
// V3-PLAN section 7 / this stage's PROVE requirement: "With a hidden fault active and the
// view in Diagnose, serialize EVERY trainee-visible surface reachable from the ARCH view,
// the alarm summary, the event journal and System Status, and assert no fault id from
// ESS.FaultEngine.FAULT_IDS, no INSTRUCTOR_ONLY marker and no root-cause text appears."
//
// tests/leakage.test.js (locked, untouched by this stage) already proves the MODULE
// projections never leak (ESS.FaultEngine.healthProjection called directly). It explicitly
// does NOT cover the app: "tests/leakage.test.js serializes MODULE projections only... it
// does NOT cover the app mirrors" (architect addendum advisory Q2). This file is that
// coverage -- it drives the real Component through renderVals() and scans exactly the four
// surfaces the assignment names: renderVals().arch (the ARCH view, in Diagnose mode, with
// the faulted node selected so the inspector's "Current simulated health" row is exercised
// too), renderVals().av (Alarm Summary), renderVals().evR (Event Summary) and
// renderVals().sysPanels (System Status). instructorView()/archPanel/I.journal are NOT
// scanned here -- those are SUPPOSED to carry the truth (V3-PLAN section 8) and are gated
// behind instructorAllowed(), which this file keeps false throughout (state.sec stays
// 'OPER', instr.auth stays false) so the instructor branch of renderVals() is provably
// inert for the whole run.
//
// WHY THE POSITIVE CONTROL IS NOT OPTIONAL (this file's own restatement of the same point
// leakage.test.js makes): a leak scan is a negative assertion -- "this string is absent" --
// and a negative assertion over a broken detector passes vacuously forever. Section 0 below
// proves the detector actually finds a planted leak, on a poisoned CLONE of a real captured
// surface, before section 1 trusts any "found nothing" result against the real one.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const FaultEngine = require('../src/fault-engine.js');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  // A real trainee session: never the instructor password, never MNGR level. Every
  // assertion below must hold with the instructor branch of renderVals() provably closed.
  assert.equal(c.instructorAllowed(), false, 'test setup: this must be a non-instructor session');
  return c;
}

/** Every string a trainee must never see while `faultId` is active anywhere in the sim. */
function forbiddenStrings(faultId) {
  const def = FaultEngine.getFaultDef(faultId);
  const out = ['INSTRUCTOR_ONLY', faultId];
  if (def) {
    if (def.recovery) out.push(def.recovery);
    (def.observableSymptoms || []).forEach((s) => out.push(s));
  }
  // Every OTHER fault id too: a leak that named the wrong id would still be a leak, and a
  // detector that only watches the one id currently active is a narrower, weaker gate than
  // "no fault id from ESS.FaultEngine.FAULT_IDS appears" as literally specified.
  FaultEngine.FAULT_IDS.forEach((f) => { if (out.indexOf(f) < 0) out.push(f); });
  return [...new Set(out)].filter((s) => s && s.length >= 4);
}

function leaksIn(serialized, forbidden) {
  return forbidden.filter((s) => serialized.includes(s));
}

/** The four named surfaces, and only those, as one object ready to JSON.stringify. */
function traineeSurfaces(v) {
  return { archView: v.arch, alarmSummary: v.av, eventSummary: v.evR, systemStatus: v.sysPanels };
}

// ==================================================== 0. THE DETECTOR MUST WORK

test('app-diagnose leakage: the detector is proven on a planted leak before any absence is trusted', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.setHidden(true);
  c.setUpset('xmtr', true); // reserved legacy path -> FROZEN_MEASUREMENT @ XMTR-FIC102
  for (let i = 0; i < 20; i++) c.step(0.5);
  c.setState({ display: 'arch', archMode: 'diagnose', archSel: 'XMTR-FIC102' });
  const v = c.renderVals();
  const real = traineeSurfaces(v);
  const forbidden = forbiddenStrings('FROZEN_MEASUREMENT');

  // Sanity: the real, unpoisoned capture must already be clean (proven properly in section
  // 1; asserted again here so the planted copy below is a controlled ADDITION, not the
  // reason the next assertion passes).
  assert.deepEqual(leaksIn(JSON.stringify(real), forbidden), []);

  // PLANT a leak: a poisoned clone with exactly the shape the S2 verify pass actually found
  // once (architect addendum section H, finding 2 -- a raw fault id mirrored into a
  // trainee-reachable event stream) and the shape V3-PLAN section 3 forbids most directly
  // -- the root-cause string sitting inside the ARCH view's own health/symptom text.
  const poisoned = JSON.parse(JSON.stringify(real));
  poisoned.archView.inspector.rows.push({ label: 'Root cause', value: 'root cause: FROZEN_MEASUREMENT (INSTRUCTOR_ONLY)' });
  const found = leaksIn(JSON.stringify(poisoned), forbidden);
  assert.ok(found.length >= 2, 'detector failed to catch a planted leak — this leak test has no teeth');
  assert.ok(found.includes('FROZEN_MEASUREMENT'));
  assert.ok(found.includes('INSTRUCTOR_ONLY'));

  // REMOVE it: the poisoned clone is discarded here, never merged back. The real capture,
  // scanned again for good measure, is still clean -- planting the leak touched nothing but
  // the clone.
  assert.deepEqual(leaksIn(JSON.stringify(traineeSurfaces(c.renderVals())), forbidden), []);
});

// ==================================================== 1. THE REAL SWEEP

// One representative (fault, node) pair per registered fault id: the three legacy-upset-
// reserved pairs go through the real instructor path (setUpset), matching how A1/A3 fire in
// production; the other ten go through setArchFault, the panel's own dispatch entry point --
// never a bare FaultEngine.activate() call, so this exercises the exact app call path a
// trainee session actually runs under.
const RESERVED = { xmtr: ['FROZEN_MEASUREMENT', 'XMTR-FIC102'], drift: ['BIASED_MEASUREMENT', 'XMTR-LIC101'], stick: ['VALVE_RESPONSE_FAILURE', 'VLV-TV202'] };
const MAGNITUDE_OF = { BIASED_MEASUREMENT: 2, NOISY_MEASUREMENT: 2 };

function engineTargetFor(c, faultId) {
  const def = FaultEngine.getFaultDef(faultId);
  const ids = def.targetIds && def.targetIds.length ? def.targetIds : Object.keys(c.topo.nodes).sort();
  for (const id of ids) {
    const node = c.topo.nodes[id];
    if (node && def.targets.indexOf(node.kind) >= 0) return id;
  }
  return null;
}

test('app-diagnose leakage: no fault, id, or root-cause text reaches the trainee surfaces, across every registered fault', async (t) => {
  for (const faultId of FaultEngine.FAULT_IDS) {
    await t.test(`${faultId}: ARCH view (Diagnose), Alarm Summary, Event Summary, System Status are all clean`, () => {
      const c = boot();
      c.applyPreset('U1_SS');
      c.setHidden(true);

      const reservedKey = Object.keys(RESERVED).find((k) => RESERVED[k][0] === faultId);
      let targetNodeId;
      if (reservedKey) {
        targetNodeId = RESERVED[reservedKey][1];
        c.setUpset(reservedKey, true);
      } else {
        targetNodeId = engineTargetFor(c, faultId);
        assert.ok(targetNodeId, `${faultId}: no legal target node found in the real graph`);
        const opts = {};
        if (MAGNITUDE_OF[faultId] != null) opts.magnitude = MAGNITUDE_OF[faultId];
        c.setArchFault(faultId, targetNodeId, opts);
        assert.equal(FaultEngine.isActive(c.P.archFaults, faultId, targetNodeId), true, `${faultId}: activation was refused`);
      }
      for (let i = 0; i < 20; i++) c.step(0.5);

      // Diagnose mode, the faulted node selected -- the inspector pane and its "Current
      // simulated health" / "Observable symptoms when degraded" rows are the surfaces
      // architecture-view-model.js's own header calls out as the ones a leak could hide in.
      c.setState({ display: 'arch', archMode: 'diagnose', archSel: targetNodeId, archTag: null });
      const v = c.renderVals();
      assert.equal(v.instr.on, false, 'instructor branch must stay closed for the whole scan');
      const serialized = JSON.stringify(traineeSurfaces(v));
      const found = leaksIn(serialized, forbiddenStrings(faultId));
      assert.deepEqual(found, [], `${faultId} @ ${targetNodeId}: trainee surfaces leaked ${JSON.stringify(found)}`);

      // Also sweep Learn and Trace (the two modes S1 already shipped) and every other
      // node in the graph selected in turn is out of scope for a per-fault loop this size,
      // but Learn mode specifically is worth a direct check: it is the one mode that DOES
      // reveal blast radius, so it is the most likely place a health-shape leak would hide.
      c.setState({ archMode: 'learn' });
      const vLearn = c.renderVals();
      const foundLearn = leaksIn(JSON.stringify(traineeSurfaces(vLearn)), forbiddenStrings(faultId));
      assert.deepEqual(foundLearn, [], `${faultId} @ ${targetNodeId}: Learn-mode surfaces leaked ${JSON.stringify(foundLearn)}`);
    });
  }
});

// ==================================================== 2. NOT HIDDEN: the accepted, pre-existing mirror is exactly what it claims to be, no more

// V3-PLAN addendum Q2(a)/(b): with HIDDEN off, the app deliberately mirrors a project-
// authored LABEL (e.g. "Cooling water loss") and, for the panel, a spaced-out fault id
// display string (e.g. "NOISY MEASUREMENT") -- accepted, pre-existing behaviour, not a new
// S3 leak. What must NEVER appear even with HIDDEN off is the literal underscored fault id,
// the INSTRUCTOR_ONLY marker, or the fault's recovery/observableSymptoms prose.
test('app-diagnose leakage: with HIDDEN off, the accepted label mirror never widens into the literal fault id or truth prose', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.setHidden(false);
  c.setArchFault('SERVER_SERVICE_DEGRADED', 'SVC-SERVER', {});
  for (let i = 0; i < 5; i++) c.step(0.5);
  c.setState({ display: 'arch', archMode: 'diagnose', archSel: 'SVC-SERVER' });
  const v = c.renderVals();
  const serialized = JSON.stringify(traineeSurfaces(v));
  // The literal underscored id and the truth-only strings must never appear...
  assert.ok(!serialized.includes('SERVER_SERVICE_DEGRADED'), 'literal fault id leaked into a trainee surface even with HIDDEN off');
  assert.ok(!serialized.includes('INSTRUCTOR_ONLY'));
  const def = FaultEngine.getFaultDef('SERVER_SERVICE_DEGRADED');
  def.observableSymptoms.forEach((s) => assert.ok(!serialized.includes(s), `truth-only symptom text "${s}" leaked`));
  // ...but the Event Summary DOES carry the accepted, spaced-out display form and the
  // node's own public label -- proving this test is not vacuously passing because nothing
  // was mirrored at all.
  const evTxt = JSON.stringify(v.evR);
  assert.ok(evTxt.includes('SERVER SERVICE DEGRADED') || evTxt.includes('DATA SERVER'),
    'positive control: expected the accepted non-hidden mirror to appear somewhere in the Event Summary');
});

// ==================================================== 3. A1-style: physics-linked fault, alarm raised, still clean

// The one drill whose fault actually moves physics and raises a real alarm (A1's legacy
// 'xmtr' upset -> FIC102 BADPV): the richest real-world case, since it exercises the
// existing alarm/event machinery on top of the fault engine at the same time.
test('app-diagnose leakage: a physics-linked fault that raises a real alarm stays clean too', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.setHidden(true);
  c.setUpset('xmtr', true);
  for (let i = 0; i < 20; i++) c.step(0.5); // clears the 5 s badPv delay
  const badpv = c.alarmEngine.unacked().find((a) => a.tag === 'FIC102' && a.cond === 'BADPV');
  assert.ok(badpv, 'test setup: expected FIC102 BADPV to have raised');
  c.ackAlarm(badpv);
  c.setState({ display: 'arch', archMode: 'diagnose', archSel: 'XMTR-FIC102' });
  const v = c.renderVals();
  const found = leaksIn(JSON.stringify(traineeSurfaces(v)), forbiddenStrings('FROZEN_MEASUREMENT'));
  assert.deepEqual(found, []);
});
