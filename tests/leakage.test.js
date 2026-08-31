// @artifact dev
// V3-PLAN section 10, the Leakage row: "With any hidden fault active, serialize every
// trainee-visible projection and rendered string; assert no INSTRUCTOR_ONLY identifier
// or root-cause text appears. Runs across all twelve drills."
// Section 6 line 117: "The trainee projection must be constructible without touching any
// truthVisibility: INSTRUCTOR_ONLY field; enforce with the leakage test (Section 10)."
//
// src/fault-engine.js line ~463 already points AT this file ("see the leakage test").
// This is that file. It edits no src/ module.
//
// WHY THE POSITIVE CONTROLS ARE NOT OPTIONAL. A leakage test is a NEGATIVE assertion:
// "this string is absent". A negative assertion over a broken detector passes
// vacuously and forever. So before asserting any absence, this file proves the
// detector finds the very things it is looking for -- in truthProjection (which must
// leak, by design) and in a deliberately poisoned copy of the trainee projection.
//
// Built by MacBook seat 2/3 (claude-opus-5[1m]) in the 3-seat mesh of 2026-08-30.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const FaultEngine = require('../src/fault-engine.js');
const DrillArch = require('../src/drill-arch.js');
const Models = require('../src/models.js');

// ---------------------------------------------------------------------- fixtures

function freshGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}

const graph = freshGraph();
// Seeded, never Math.random -- the determinism invariant applies to tests too.
const rand = () => Models.createRand(20260830);

/** Activate one fault and hand back both projections plus the instance. */
function withFault(faultId, targetNodeId, simTime) {
  const r = FaultEngine.activate(FaultEngine.createState(), graph, {
    faultId, targetNodeId, simTime: simTime == null ? 60 : simTime, rand: rand()
  });
  return r;
}

/** Every string a trainee must never be shown for this active fault instance. */
function forbiddenFor(instance, extra) {
  const def = FaultEngine.getFaultDef(instance.faultId);
  const out = ['INSTRUCTOR_ONLY', instance.faultId];
  if (instance.instanceId) out.push(String(instance.instanceId));
  if (def) {
    if (def.recovery) out.push(String(def.recovery));
    (def.observableSymptoms || []).forEach((s) => out.push(String(s)));
  }
  (extra || []).forEach((s) => { if (s) out.push(String(s)); });
  // Deduplicate and drop anything trivially short enough to false-positive.
  return [...new Set(out)].filter((s) => s && s.length >= 6);
}

function leaksIn(serialized, forbidden) {
  return forbidden.filter((s) => serialized.includes(s));
}

// ==================================================== 0. THE DETECTOR MUST WORK

test('leakage: the detector is proven before any absence is asserted', async (t) => {
  const r = withFault('FROZEN_MEASUREMENT', 'XMTR-FIC102');
  assert.equal(r.accepted, true, `fixture fault refused: ${r.reason}`);

  await t.test('POSITIVE CONTROL: truthProjection DOES leak, and the detector sees it', () => {
    const truth = JSON.stringify(FaultEngine.truthProjection(r.state, graph));
    const found = leaksIn(truth, forbiddenFor(r.instance));
    // The instructor view is SUPPOSED to carry all of this. If the detector cannot
    // find it here, every "no leak" result below is worthless.
    assert.ok(found.includes('INSTRUCTOR_ONLY'), 'detector missed INSTRUCTOR_ONLY in truthProjection');
    assert.ok(found.includes('FROZEN_MEASUREMENT'), 'detector missed the fault id in truthProjection');
    assert.ok(found.length >= 2, `detector found only ${found.length} of the instructor-only strings`);
  });

  await t.test('POSITIVE CONTROL: a deliberately poisoned trainee projection is caught', () => {
    const health = FaultEngine.healthProjection(r.state, graph);
    const poisoned = JSON.parse(JSON.stringify(health));
    poisoned.nodes['XMTR-FIC102'].symptoms.push('root cause: FROZEN_MEASUREMENT (INSTRUCTOR_ONLY)');
    const found = leaksIn(JSON.stringify(poisoned), forbiddenFor(r.instance));
    assert.ok(found.length > 0, 'detector failed to catch an injected leak — the test has no teeth');
  });
});

// ==================================================== 1. ALL TWELVE DRILLS

test('leakage: no trainee projection leaks root cause, across all twelve drills', async (t) => {
  const ids = DrillArch.drillIds();
  assert.equal(ids.length, 12, `expected 12 A-drills, found ${ids.length}`);

  let activated = 0;
  for (const drillId of ids) {
    const drill = DrillArch.drillById(drillId);
    await t.test(`${drillId} (${drill.domain}) hides its root cause from the trainee`, () => {
      for (const step of drill.faultTimeline || []) {
        for (const target of step.targets || []) {
          const r = withFault(step.faultId, target, step.tSec);
          assert.equal(r.accepted, true,
            `${drillId}: fault ${step.faultId} on ${target} refused: ${r.reason}`);
          activated++;

          const health = JSON.stringify(FaultEngine.healthProjection(r.state, graph));
          // The drill's own `note` is instructor/debrief prose naming the mechanism.
          const found = leaksIn(health, forbiddenFor(r.instance, [step.note]));
          assert.deepEqual(found, [],
            `${drillId}: trainee projection leaked ${JSON.stringify(found)} while ` +
            `${step.faultId} was active on ${target}`);
        }
      }
    });
  }

  await t.test('the sweep was not vacuous', () => {
    assert.ok(activated >= 12, `only ${activated} faults were actually activated across 12 drills`);
  });
});

// ==================================================== 2. EVERY FAULT, NOT JUST THE DRILLED ONES

test('leakage: every registered fault hides itself, not only the twelve drilled ones', async (t) => {
  // Known-good (fault, target) pairs harvested from the drills, extended by probing
  // for a target the engine accepts — so a fault no drill exercises is still covered.
  const pairs = new Map();
  for (const id of DrillArch.drillIds()) {
    for (const step of DrillArch.drillById(id).faultTimeline || []) {
      for (const target of step.targets || []) if (!pairs.has(step.faultId)) pairs.set(step.faultId, target);
    }
  }
  // activate() THROWS for a programmer error (unknown id, wrong node kind, missing
  // magnitude/rand) and only RETURNS accepted:false for a legitimate runtime rejection
  // (ALREADY_ACTIVE, CONFLICTS_WITH) -- see src/fault-engine.js line ~361. That split is
  // deliberate, so probing for a valid target must catch, not just read `accepted`.
  const nodeIds = Object.keys(graph.nodes).sort();
  for (const faultId of FaultEngine.FAULT_IDS) {
    if (pairs.has(faultId)) continue;
    for (const n of nodeIds) {
      try {
        if (withFault(faultId, n).accepted) { pairs.set(faultId, n); break; }
      } catch (e) { /* wrong kind for this fault; keep probing */ }
    }
  }

  await t.test('a target was found for every registered fault', () => {
    const orphans = FaultEngine.FAULT_IDS.filter((f) => !pairs.has(f));
    assert.deepEqual(orphans, [], `no node in the real graph accepts: ${orphans.join(', ')}`);
  });

  for (const [faultId, target] of pairs) {
    await t.test(`${faultId} on ${target} leaks nothing to the trainee`, () => {
      const r = withFault(faultId, target);
      assert.equal(r.accepted, true, `refused: ${r.reason}`);
      const health = JSON.stringify(FaultEngine.healthProjection(r.state, graph));
      assert.deepEqual(leaksIn(health, forbiddenFor(r.instance)), []);
    });
  }
});

// ==================================================== 3. THE STRUCTURAL INVARIANT

test('leakage: activating a fault changes health only, never the visible structure', async (t) => {
  // The subtle leak a string search cannot catch: a projection that betrays WHERE the
  // fault is by changing the shape of what it returns. Node identity, label, layer and
  // kind must be byte-identical with and without a fault; only health/symptoms move.
  const clean = FaultEngine.healthProjection(FaultEngine.createState(), graph);
  const skeleton = (p) => JSON.stringify(Object.keys(p.nodes).sort().map((id) => {
    const n = p.nodes[id];
    return { id: n.id, layer: n.layer, kind: n.kind, label: n.label };
  }));
  const cleanSkeleton = skeleton(clean);

  for (const id of DrillArch.drillIds()) {
    const step = (DrillArch.drillById(id).faultTimeline || [])[0];
    if (!step) continue;
    await t.test(`${id}: node identity, label, layer and kind are unchanged`, () => {
      const r = withFault(step.faultId, step.targets[0], step.tSec);
      const faulted = FaultEngine.healthProjection(r.state, graph);
      assert.equal(faulted.nodeCount, clean.nodeCount, 'node count changed under fault');
      assert.equal(skeleton(faulted), cleanSkeleton,
        `${id}: the trainee-visible structure changed under ${step.faultId} — that shape ` +
        'change alone tells a trainee where the fault is, without naming it');
    });
  }
});
