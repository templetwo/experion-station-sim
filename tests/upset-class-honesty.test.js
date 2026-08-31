// @artifact dev
// S2 GATE, WRITTEN BEFORE S2. Held by seat 2/3, who is not building S2 — per the
// arrangement seat 1/3 asked to keep from S2 onward: "a gate its own author can soften
// is not a gate; a gate someone else holds red is worth having."
//
// THE QUESTION, as seat 1/3 posed it: S2 re-registers the twelve legacy instructor
// upsets through the fault engine. Four of them (xmtr, drift, stick, air) are
// ARCHITECTURE-class — they have a real failure domain inside the control system. The
// other eight are PROCESS-class — genuine plant disturbances with no architectural
// cause. Is that split honest IN THE DATA, or merely labelled?
//
// WHY IT MATTERS, and why no existing test catches it. If a PROCESS disturbance ends up
// carrying a topology node, the ARCH view marks that node faulted and the trainee learns
// a FALSE LESSON about where failure lives. A pump trip is a plant event where the
// architecture is working perfectly: the transmitter reads true, the drive reports
// honestly, the network is fine. The correct lesson is "the plant lost a pump and the
// instrumentation told you so accurately" — the opposite of "the architecture failed".
// Parity goldens cannot see this: they prove behaviour is UNCHANGED from v2, and v2 had
// no topology at all, so a spurious node association is invisible to them. The leakage
// test cannot see it either: it proves the trainee is not told the fault's IDENTITY, not
// that the fault is attached to an honest LOCATION. This is the gap between them.
//
// THE TRAP IS NOT HYPOTHETICAL, and section 1 below proves it rather than asserting it:
// DRV-P101 and DRV-M202 exist as real MOTOR nodes in the built graph, named for exactly
// the equipment in the `pump` and `agit` upsets — and MOTOR is a LEGAL target for
// FROZEN_MEASUREMENT, BIASED_MEASUREMENT and NOISY_MEASUREMENT. So wiring `pump` to a
// fault on DRV-P101 would be legal, silent, and green across the whole existing suite.
// Those two are where an S2 builder is most likely to reach for the obvious node.
//
// CLASSIFICATION AUTHORITY. The 4/8 split below is seat 1/3's, as architect. This file
// does not invent it and must not be the place it is changed — if the classification is
// revised, it is revised by the architect and this constant follows.
//
// Built by MacBook seat 2/3 (claude-opus-5[1m]). New file only; edits no src/ module.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const Instructor = require('../src/instructor.js');
const FaultEngine = require('../src/fault-engine.js');

// Seat 1/3's classification, 2026-08-30. Architect's, not this file's.
const ARCHITECTURE_CLASS = ['xmtr', 'drift', 'stick', 'air'];
const PROCESS_CLASS = ['surge', 'pump', 'cool', 'vap', 'rxn', 'foul', 'agit', 'bedact'];

// The two PROCESS upsets that have a same-named topology node — the honesty test's
// sharpest cases, because attaching the obvious node is legal and silent.
const BAITED = { pump: 'DRV-P101', agit: 'DRV-M202' };

function builtGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}

const graph = builtGraph();
const upsets = Instructor.upsetDefs();

/** Locate whatever surface S2 registers the legacy-upset -> fault mapping on.
 *  Deliberately does NOT dictate the shape: the architect owns the contract
 *  (freeze/shared-contract rule), so this probes and reports absence rather than
 *  inventing an API S2 must then conform to. */
function findUpsetMapping() {
  const candidates = [
    () => FaultEngine.UPSET_MAP,
    () => FaultEngine.legacyUpsetMap && FaultEngine.legacyUpsetMap(),
    () => FaultEngine.upsetMapping && FaultEngine.upsetMapping(),
    () => require('../src/upset-bridge.js')
  ];
  for (const get of candidates) {
    try { const m = get(); if (m && typeof m === 'object') return m; } catch (e) { /* not this one */ }
  }
  return null;
}

// ==================================================== 1. THE TRAP IS REAL

test('upset-class honesty: the preconditions this gate depends on', async (t) => {
  await t.test('there are exactly twelve legacy upsets, and the split covers all of them', () => {
    assert.equal(upsets.length, 12);
    const keys = upsets.map((u) => u.k).sort();
    const classified = [...ARCHITECTURE_CLASS, ...PROCESS_CLASS].sort();
    assert.deepEqual(keys, classified,
      'the architect classification no longer covers the upset list exactly — reclassify before trusting this gate');
    assert.equal(ARCHITECTURE_CLASS.length, 4);
    assert.equal(PROCESS_CLASS.length, 8);
  });

  await t.test('THE TRAP: the baited PROCESS upsets have real, same-named MOTOR nodes', () => {
    for (const [key, nodeId] of Object.entries(BAITED)) {
      assert.ok(PROCESS_CLASS.includes(key), `${key} is meant to be PROCESS-class`);
      const node = graph.nodes[nodeId];
      assert.ok(node, `${nodeId} is missing — the trap this gate guards no longer exists, re-derive it`);
      assert.equal(node.kind, 'MOTOR');
    }
  });

  await t.test('THE TRAP IS SILENT: MOTOR is a legal target for field faults', () => {
    // If MOTOR were an illegal target, the engine itself would refuse a bad wiring and
    // this gate would be redundant. It does not: attaching pump -> DRV-P101 typechecks.
    const motorFaults = FaultEngine.FAULT_IDS.filter((id) => {
      const d = FaultEngine.FAULT_DEFS[id];
      return (d.targets || []).includes('MOTOR');
    });
    assert.ok(motorFaults.length > 0,
      'no fault targets MOTOR any more — the silent-wiring hazard may be gone; re-verify before deleting this gate');
  });
});

// ==================================================== 2. THE INVARIANT

test('upset-class honesty: PROCESS disturbances carry no architectural location', async (t) => {
  const mapping = findUpsetMapping();

  if (!mapping) {
    // Matches the convention landed at 93b4568: skip with a stated reason rather than
    // fail, because a false negative teaches people to ignore the suite.
    await t.test('SKIPPED until S2 lands the legacy-upset mapping', { skip:
      'S2 has not registered a legacy-upset -> fault mapping yet, and this gate refuses to ' +
      'invent the surface it reads (the architect owns the shared contract). When S2 lands ' +
      'it, either expose it as ESS.FaultEngine.UPSET_MAP / legacyUpsetMap() / upsetMapping(), ' +
      'or tell seat 2/3 the surface and this probe is updated. The assertions below then run: ' +
      'ARCHITECTURE-class upsets must resolve to a topology node, PROCESS-class upsets must ' +
      'resolve to none — pump and agit especially, despite DRV-P101 and DRV-M202 existing.'
    }, () => {});
    return;
  }

  /** Every topology node an upset resolves to, as a list.
   *  A LIST, not a single id, on purpose: `air` (instrument air loss, valves plant-wide
   *  to fail state) is ARCHITECTURE-class but has no single location — it is a blast
   *  radius across every VALVE. A gate that demanded one node would fail correct S2 code
   *  for `air`, and a gate that cries wolf gets switched off. So the invariant is
   *  "at least one" for architecture and "none at all" for process, which is the real
   *  distinction and survives either representation. */
  const nodesOf = (entry) => {
    if (entry == null) return [];
    const raw = Array.isArray(entry) ? entry
      : typeof entry === 'string' ? [entry]
        : [].concat(entry.targetNodeIds || entry.nodes || entry.targets ||
                    entry.targetNodeId || entry.node || entry.target || []);
    return raw.filter((n) => typeof n === 'string' && graph.nodes[n]);
  };

  await t.test('every ARCHITECTURE-class upset resolves to at least one real topology node', () => {
    const missing = ARCHITECTURE_CLASS.filter((k) => nodesOf(mapping[k]).length === 0);
    assert.deepEqual(missing, [],
      `architecture-class upsets with no architectural location: ${missing.join(', ')} — ` +
      'an architectural fault the ARCH view cannot place teaches nothing. Note `air` is ' +
      'legitimately many nodes rather than one; this assertion accepts a set.');
  });

  await t.test('no PROCESS-class upset carries ANY topology node', () => {
    const attached = PROCESS_CLASS
      .map((k) => ({ k, n: nodesOf(mapping[k]) }))
      .filter((x) => x.n.length > 0);
    assert.deepEqual(attached, [],
      'PROCESS disturbances carrying an architectural location: ' +
      attached.map((x) => `${x.k} -> ${x.n.join('/')}`).join(', ') +
      '. A plant disturbance is not an architecture failure. Marking a node faulted here ' +
      'teaches the trainee that the control system broke when it reported the plant correctly.');
  });

  await t.test('specifically: pump and agit stay unattached despite the obvious node', () => {
    for (const [key, bait] of Object.entries(BAITED)) {
      const n = nodesOf(mapping[key]);
      assert.deepEqual(n, [],
        `${key} was wired to ${n.join('/')} (the bait was ${bait}). The drive reported the ` +
        'trip honestly; nothing in the architecture failed. This is the exact false lesson ' +
        'this gate exists to prevent.');
    }
  });
});
