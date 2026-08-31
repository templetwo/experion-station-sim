// @artifact dev
// S2 GATE, WRITTEN BEFORE S2, held by seat 2/3 who is not building S2 — the arrangement
// seat 1/3 asked to keep from S2 onward: "a gate its own author can soften is not a gate;
// a gate someone else holds red is worth having."
//
// THE CLASSIFYING PRINCIPLE (seat 1/3, 2026-08-30, recorded instead of a bare list because
// a list invites the next reader to re-litigate an entry):
//     Is a COMPONENT OF THE MODELLED ARCHITECTURE itself faulty?
//       yes -> ARCHITECTURE.  Architecture intact and something else went wrong — the
//       plant, a utility, a process condition -> PROCESS, however dramatic the symptom.
// It is decided by src/models.js:252, one line, which distinguishes the two upsets it
// separates in the same expression:
//     const v = V[k]; let g = F.air ? v.fail : tgt[k]; if (v.stuck) g = v.pos;
// On `air` the valve goes to v.fail — its DESIGNED fail-safe position, the component
// working correctly. On `stick` it holds v.pos and ignores demand — the component IS
// faulty. Verified against the file, not taken from the message.
//
// WHY THIS GATE EXISTS. If a PROCESS disturbance carries a topology node, the ARCH view
// marks that node faulted and the trainee learns a FALSE LESSON about where failure lives.
// A pump trip is a plant event where the architecture works perfectly: the transmitter
// reads true, the drive reports honestly, the network is fine.
//
// WHY NO OTHER SUITE CATCHES IT. The parity goldens prove behaviour is UNCHANGED from v2,
// and v2 had no topology at all, so a spurious node association is invisible to them BY
// CONSTRUCTION rather than by oversight. The leakage test proves the trainee is not told
// the fault's IDENTITY, not that the fault is attached to an honest LOCATION. The defect
// lives in the gap between two green suites, which is the argument for a third lens
// rather than a stronger version of either.
//
// CLASSIFICATION AUTHORITY IS THE ARCHITECT'S. The 3/9 split below is seat 1/3's final
// ruling, which REVERSED their own earlier 4/8 call after seat 2/3 escalated `air` rather
// than encoding it silently. This file is not where it changes; if it is revised, the
// architect revises it and this constant follows.
//
// Built by MacBook seat 2/3 (claude-opus-5[1m]). New file only; edits no src/ module.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const Instructor = require('../src/instructor.js');
const FaultEngine = require('../src/fault-engine.js');

const ARCHITECTURE_CLASS = ['xmtr', 'drift', 'stick'];
const PROCESS_CLASS = ['surge', 'pump', 'cool', 'vap', 'air', 'rxn', 'foul', 'agit', 'bedact'];

// The architect's declared ARCHITECTURE mappings. Pinned so S2 cannot quietly re-target one.
const DECLARED = {
  xmtr: { faultId: 'FROZEN_MEASUREMENT', node: 'XMTR-FIC102' },
  drift: { faultId: 'BIASED_MEASUREMENT', node: 'XMTR-LIC101' },
  stick: { faultId: 'VALVE_RESPONSE_FAILURE', node: 'VLV-TV202' }
};

// PROCESS upsets that are BAITED — the ones an S2 builder is most likely to wire wrongly,
// for two different reasons. Both must resolve to no node at all.
const BAITED = {
  pump: { bait: 'DRV-P101', why: 'a real MOTOR node named for exactly this equipment' },
  agit: { bait: 'DRV-M202', why: 'a real MOTOR node named for exactly this equipment' },
  air: { bait: '(every VALVE node)', why: 'its symptom presents at FIELD-layer valve nodes, so it LOOKS architectural — and that is the point: a trainee inspects I/O, controller and network, finds them healthy, and correctly concludes the answer is not in the architecture. That lesson only works if air has NO fault node' }
};

function builtGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}

const graph = builtGraph();
const upsetKeys = Instructor.upsetDefs().map((u) => u.k);

/** ESS.UpsetBridge — the surface seat 1/3 specified for S2 to create. Deliberately its own
 *  module and not part of fault-engine: the fault engine is pure and knows nothing about
 *  legacy upsets, whereas this IS the strangler seam, and naming it keeps the seam visible. */
function findBridge() {
  try { return require('../src/upset-bridge.js'); } catch (e) { return null; }
}

// ==================================================== 1. THE TRAP IS REAL

test('upset-class honesty: the preconditions this gate depends on', async (t) => {
  await t.test('twelve legacy upsets, and the architect split covers them exactly', () => {
    assert.equal(upsetKeys.length, 12);
    assert.deepEqual([...upsetKeys].sort(), [...ARCHITECTURE_CLASS, ...PROCESS_CLASS].sort(),
      'the architect classification no longer covers the upset list exactly — reclassify before trusting this gate');
    assert.equal(ARCHITECTURE_CLASS.length, 3);
    assert.equal(PROCESS_CLASS.length, 9);
  });

  await t.test('THE TRAP: pump and agit have real, same-named MOTOR nodes', () => {
    for (const key of ['pump', 'agit']) {
      assert.ok(PROCESS_CLASS.includes(key));
      const node = graph.nodes[BAITED[key].bait];
      assert.ok(node, `${BAITED[key].bait} is missing — the trap this gate guards no longer exists, re-derive it`);
      assert.equal(node.kind, 'MOTOR');
    }
  });

  await t.test('THE TRAP IS SILENT: MOTOR is a legal target for measurement faults', () => {
    // Were MOTOR illegal, the engine would refuse a bad wiring and this gate would be
    // redundant. It does not: pump -> DRV-P101 typechecks and activates cleanly.
    const motorFaults = FaultEngine.FAULT_IDS.filter((id) =>
      (FaultEngine.FAULT_DEFS[id].targets || []).includes('MOTOR'));
    assert.ok(motorFaults.length > 0,
      'no fault targets MOTOR any more — the silent-wiring hazard may be gone; re-verify before deleting this gate');
  });

  await t.test('THE OTHER TRAP: air presents at valve nodes it must not own', () => {
    const valves = Object.keys(graph.nodes).filter((id) => graph.nodes[id].kind === 'VALVE');
    assert.ok(valves.length > 0, 'no VALVE nodes — air can no longer be mis-attributed to them');
    assert.ok(PROCESS_CLASS.includes('air'),
      'air moved back to ARCHITECTURE — that reverses the architect ruling of 2026-08-30 and must go through them');
  });

  await t.test('every declared ARCHITECTURE mapping names a real fault and a real node', () => {
    for (const [key, d] of Object.entries(DECLARED)) {
      assert.ok(ARCHITECTURE_CLASS.includes(key));
      assert.ok(FaultEngine.FAULT_IDS.includes(d.faultId), `${key}: unknown fault ${d.faultId}`);
      assert.ok(graph.nodes[d.node], `${key}: node ${d.node} does not exist in the built graph`);
    }
  });
});

// ==================================================== 2. THE INVARIANT

test('upset-class honesty: PROCESS disturbances carry no architectural location', async (t) => {
  const bridge = findBridge();

  if (!bridge) {
    // The 93b4568 convention: skip with a stated reason rather than fail, because a false
    // negative teaches people to ignore the suite.
    await t.test('SKIPPED until S2 creates src/upset-bridge.js', { skip:
      'S2 has not created src/upset-bridge.js (ESS.UpsetBridge) yet. Surface specified by ' +
      'seat 1/3: CLASSES, UPSET_CLASS (all twelve keys), classOf(k), faultIdFor(k) -> fault ' +
      'id or null for PROCESS, topologyTargets(k, graph) -> [] always for PROCESS, a SET for ' +
      'ARCHITECTURE. When it lands these run: every UPSET_CLASS key is one of the twelve and ' +
      'all twelve are present; ARCHITECTURE resolves to >=1 real node and its declared fault; ' +
      'PROCESS resolves to none; pump, agit and air stay unattached despite their bait.'
    }, () => {});
    return;
  }

  const targetsOf = (k) => {
    const t = bridge.topologyTargets ? bridge.topologyTargets(k, graph) : [];
    return (Array.isArray(t) ? t : [t]).filter((n) => typeof n === 'string' && graph.nodes[n]);
  };

  await t.test('UPSET_CLASS covers exactly the twelve legacy upsets', () => {
    const keys = Object.keys(bridge.UPSET_CLASS || {}).sort();
    assert.deepEqual(keys, [...upsetKeys].sort(),
      'UPSET_CLASS must contain every key from ESS.Instructor.upsetDefs() and nothing else');
    for (const k of keys) {
      assert.ok((bridge.CLASSES || []).includes(bridge.UPSET_CLASS[k]),
        `${k} is classified ${bridge.UPSET_CLASS[k]}, which is not in CLASSES`);
    }
  });

  await t.test('the bridge classification matches the architect ruling', () => {
    const wrong = upsetKeys
      .map((k) => ({ k, got: bridge.classOf(k), want: ARCHITECTURE_CLASS.includes(k) ? 'ARCHITECTURE' : 'PROCESS' }))
      .filter((x) => x.got !== x.want);
    assert.deepEqual(wrong, [],
      'bridge disagrees with the architect 3/9 split: ' +
      wrong.map((x) => `${x.k} got ${x.got} want ${x.want}`).join(', '));
  });

  await t.test('every ARCHITECTURE upset resolves to its declared fault and >=1 real node', () => {
    for (const k of ARCHITECTURE_CLASS) {
      assert.equal(bridge.faultIdFor(k), DECLARED[k].faultId, `${k}: wrong fault id`);
      const nodes = targetsOf(k);
      assert.ok(nodes.length > 0, `${k}: an architectural fault the ARCH view cannot place teaches nothing`);
      assert.ok(nodes.includes(DECLARED[k].node),
        `${k}: declared node ${DECLARED[k].node} not among ${nodes.join('/')}`);
    }
  });

  await t.test('no PROCESS upset has a fault id OR any topology node', () => {
    const attached = PROCESS_CLASS
      .map((k) => ({ k, fault: bridge.faultIdFor(k), nodes: targetsOf(k) }))
      .filter((x) => x.fault != null || x.nodes.length > 0);
    assert.deepEqual(attached, [],
      'PROCESS disturbances carrying an architectural location: ' +
      attached.map((x) => `${x.k} -> ${x.fault || ''}${x.nodes.join('/')}`).join(', ') +
      '. A plant disturbance is not an architecture failure. Marking a node faulted here ' +
      'teaches the trainee that the control system broke when it reported the plant correctly.');
  });

  await t.test('specifically: pump, agit and air stay unattached despite their bait', () => {
    for (const [key, b] of Object.entries(BAITED)) {
      const nodes = targetsOf(key);
      assert.deepEqual(nodes, [],
        `${key} was wired to ${nodes.join('/')}. Bait was ${b.bait} — ${b.why}.`);
      assert.equal(bridge.faultIdFor(key), null, `${key} was given a fault id`);
    }
  });
});
