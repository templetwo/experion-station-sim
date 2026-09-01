// @artifact dev
// Adversarial test suite for src/fault-engine.js (V3-PLAN section 5, SA stage).
//
// Builds the real 114-node graph via the harness + src/topology.js (per the SA
// advisory: there is no ESS.Topology global after load(), so both modules are
// required directly), then exercises the fault engine against it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const FaultEngine = require('../src/fault-engine.js');

// ---------------------------------------------------------------------------- fixtures

function freshComponent() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return c;
}

function buildGraph(c) {
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}

// A single shared component/graph: the fault engine never mutates the graph (it is
// stateless data, per topology.js's own contract), so every test may safely share it.
const c = freshComponent();
const graph = buildGraph(c);

// Tiny local seeded generator for the determinism tests. Deliberately NOT shared with
// src/models.js's createRand (that would be a cross-module require); it only needs to
// be a deterministic fn() -> [0,1) so two independently-constructed instances with the
// same seed produce the same sequence -- the actual property under test.
function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =========================================================================== 1. VOCABULARY

test('fault vocabulary: the 13 fault ids are pinned, frozen and fully defined', async (t) => {
  const EXPECTED_IDS = [
    // Order is V3-PLAN section 5's TABLE order, which lists the IO row (open input /
    // bad quality) BEFORE the FIELD/IO row (valve response failure). The lead's SA brief
    // had reordered these two and src/fault-engine.js followed the brief while
    // src/drill-arch.js followed the spec -- the eighth cross-module divergence in this
    // build, and the only one whose origin was the brief rather than an agent.
    'FROZEN_MEASUREMENT', 'BIASED_MEASUREMENT', 'NOISY_MEASUREMENT',
    'OPEN_INPUT_BAD_QUALITY', 'VALVE_RESPONSE_FAILURE',
    'CONTROLLER_LOSS', 'REDUNDANCY_SWITCHOVER',
    'NET_PATH_DEGRADED', 'COMMS_PARTITION',
    'SERVER_SERVICE_DEGRADED',
    'STATION_LOSS_PEER',
    'HISTORIAN_GAP', 'ASSISTANT_LOSS'
  ];
  const EXPECTED_DOMAINS = {
    FROZEN_MEASUREMENT: 'FIELD', BIASED_MEASUREMENT: 'FIELD', NOISY_MEASUREMENT: 'FIELD', VALVE_RESPONSE_FAILURE: 'FIELD',
    OPEN_INPUT_BAD_QUALITY: 'IO',
    CONTROLLER_LOSS: 'CONTROL', REDUNDANCY_SWITCHOVER: 'CONTROL',
    NET_PATH_DEGRADED: 'NETWORK', COMMS_PARTITION: 'NETWORK',
    SERVER_SERVICE_DEGRADED: 'SERVICE',
    STATION_LOSS_PEER: 'HMI',
    HISTORIAN_GAP: 'INFORMATION', ASSISTANT_LOSS: 'INFORMATION'
  };

  await t.test('FAULT_IDS matches the pinned vocabulary exactly, in order', () => {
    assert.deepEqual(FaultEngine.FAULT_IDS, EXPECTED_IDS);
  });

  await t.test('FAULT_IDS and FAULT_DEFS are frozen (top-level and per-entry)', () => {
    assert.equal(Object.isFrozen(FaultEngine.FAULT_IDS), true);
    assert.equal(Object.isFrozen(FaultEngine.FAULT_DEFS), true);
    for (const id of FaultEngine.FAULT_IDS) assert.equal(Object.isFrozen(FaultEngine.FAULT_DEFS[id]), true, id);
  });

  await t.test('every fault id has a definition with the full DATA shape and the right domain', () => {
    for (const id of EXPECTED_IDS) {
      const d = FaultEngine.getFaultDef(id);
      assert.ok(d, `missing definition for ${id}`);
      assert.equal(d.id, id);
      assert.equal(d.domain, EXPECTED_DOMAINS[id]);
      assert.ok(Array.isArray(d.targets) && d.targets.length > 0, `${id}: targets[]`);
      assert.ok(d.activation && typeof d.activation === 'object', `${id}: activation`);
      assert.ok(Array.isArray(d.effects) && d.effects.length > 0, `${id}: effects[]`);
      assert.ok(Array.isArray(d.observableSymptoms) && d.observableSymptoms.length > 0, `${id}: observableSymptoms[]`);
      assert.ok(typeof d.recovery === 'string' && d.recovery.length > 0, `${id}: recovery`);
      assert.ok(Array.isArray(d.conflicts), `${id}: conflicts[]`);
      assert.ok(Number.isInteger(d.difficulty) && d.difficulty >= 1, `${id}: difficulty`);
      assert.equal(d.truthVisibility, 'INSTRUCTOR_ONLY');
    }
    assert.equal(Object.keys(FaultEngine.FAULT_DEFS).length, EXPECTED_IDS.length, 'no extra, undocumented fault ids');
  });

  await t.test('declared conflicts are symmetric', () => {
    for (const id of EXPECTED_IDS) {
      const d = FaultEngine.getFaultDef(id);
      for (const other of d.conflicts) {
        const od = FaultEngine.getFaultDef(other);
        assert.ok(od, `${id} conflicts with unknown fault ${other}`);
        assert.ok(od.conflicts.includes(id), `${other} should list ${id} back (asymmetric conflict)`);
      }
    }
  });

  await t.test('every declared target kind is one topology.js actually uses', () => {
    for (const id of EXPECTED_IDS) {
      const d = FaultEngine.getFaultDef(id);
      for (const kind of d.targets) assert.ok(Topology.KINDS.includes(kind), `${id}: unknown kind ${kind}`);
    }
  });

  await t.test('static check: this module never calls Math.random', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'fault-engine.js'), 'utf8');
    // Checks for the CALL syntax specifically -- the module's own header comments
    // mention "Math.random" several times in prose (documenting that it is never
    // used), which would false-positive a bare substring search.
    assert.ok(!src.includes('Math.random('), 'fault-engine.js must never call Math.random()');
  });
});

// =========================================================================== 2. ACTIVATION

function firstNodeOfKind(kind) {
  return Object.keys(graph.nodes).sort().find((id) => graph.nodes[id].kind === kind);
}

test('activation: validation, idempotence and conflicts', async (t) => {
  await t.test('rejects an unknown fault id', () => {
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NOT_A_FAULT', targetNodeId: 'CTRL-U1' }),
      /unknown fault id/);
  });

  await t.test('rejects an unknown target node', () => {
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'NOPE' }),
      /unknown target node/);
  });

  await t.test('rejects a target whose kind the fault does not apply to', () => {
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'XMTR-FIC102' }),
      /cannot target kind/);
  });

  await t.test('VERIFIER REGRESSION: rejects a same-kind but wrong-specific-node target for the SERVER_SVC singletons', () => {
    // SVC-SERVER, SVC-ALARM and SVC-HISTORY all share kind SERVER_SVC, but they are
    // NOT interchangeable: each fault's own observableSymptoms name one specific
    // service by its documented fan-out. A kind-only check would let HISTORIAN_GAP
    // land on SVC-SERVER (degrading STN-FLEX/APP-ASSIST -- contradicting its own
    // "live values stay correct" claim) or SERVER_SERVICE_DEGRADED land on
    // SVC-ALARM (degrading STN-CONSOLE -- contradicting "console profile
    // unaffected"). Both must be rejected before computeHealth ever sees them.
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'HISTORIAN_GAP', targetNodeId: 'SVC-SERVER' }),
      /cannot target SVC-SERVER/);
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'HISTORIAN_GAP', targetNodeId: 'SVC-ALARM' }),
      /cannot target SVC-ALARM/);
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'SERVER_SERVICE_DEGRADED', targetNodeId: 'SVC-ALARM' }),
      /cannot target SVC-ALARM/);
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'SERVER_SERVICE_DEGRADED', targetNodeId: 'SVC-HISTORY' }),
      /cannot target SVC-HISTORY/);
    // The correct, specific pairing still works.
    assert.equal(FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'HISTORIAN_GAP', targetNodeId: 'SVC-HISTORY' }).accepted, true);
    assert.equal(FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'SERVER_SERVICE_DEGRADED', targetNodeId: 'SVC-SERVER' }).accepted, true);
  });

  await t.test('accepts a valid activation and returns a fresh instance', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U1', simTime: 1000 });
    assert.equal(r.accepted, true);
    assert.equal(r.reason, null);
    assert.equal(r.instance.faultId, 'CONTROLLER_LOSS');
    assert.equal(r.instance.targetNodeId, 'CTRL-U1');
    assert.equal(r.instance.activatedAt, 1000);
    assert.equal(r.instance.magnitude, null);
    assert.equal(FaultEngine.isActive(r.state, 'CONTROLLER_LOSS', 'CTRL-U1'), true);
  });

  await t.test('does not mutate the state object passed in (functional style)', () => {
    const s0 = FaultEngine.createState();
    const r = FaultEngine.activate(s0, graph, { faultId: 'ASSISTANT_LOSS', targetNodeId: 'APP-ASSIST' });
    assert.deepEqual(s0, FaultEngine.createState(), 'input state must be left untouched');
    assert.notEqual(r.state, s0);
  });

  await t.test('rejects activating the same fault on the same target twice', () => {
    let r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'ASSISTANT_LOSS', targetNodeId: 'APP-ASSIST' });
    r = FaultEngine.activate(r.state, graph, { faultId: 'ASSISTANT_LOSS', targetNodeId: 'APP-ASSIST' });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, 'ALREADY_ACTIVE');
  });

  await t.test('rejects a conflicting fault on the same target', () => {
    let r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'FROZEN_MEASUREMENT', targetNodeId: 'XMTR-LIC101' });
    assert.equal(r.accepted, true);
    r = FaultEngine.activate(r.state, graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-LIC101' });
    assert.equal(r.accepted, false);
    assert.ok(r.reason.startsWith('CONFLICTS_WITH:'));
  });

  await t.test('the same two faults on DIFFERENT targets do not conflict', () => {
    let r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'FROZEN_MEASUREMENT', targetNodeId: 'XMTR-LIC101' });
    r = FaultEngine.activate(r.state, graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-TIC201', magnitude: 1 });
    assert.equal(r.accepted, true);
  });

  await t.test('deactivate clears an active fault; deactivating an inactive one is reported, not thrown', () => {
    let r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'STATION_LOSS_PEER', targetNodeId: 'STN-FLEX' });
    const d1 = FaultEngine.deactivate(r.state, { faultId: 'STATION_LOSS_PEER', targetNodeId: 'STN-FLEX' });
    assert.equal(d1.accepted, true);
    assert.equal(FaultEngine.isActive(d1.state, 'STATION_LOSS_PEER', 'STN-FLEX'), false);
    const d2 = FaultEngine.deactivate(d1.state, { faultId: 'STATION_LOSS_PEER', targetNodeId: 'STN-FLEX' });
    assert.equal(d2.accepted, false);
    assert.equal(d2.reason, 'NOT_ACTIVE');
  });
});

// =========================================================================== 3. REDUNDANCY

test('redundancy semantics: degraded is not an outage; only a full-group failure propagates', async (t) => {
  const DOWNSTREAM = ['SVC-SERVER', 'SVC-ALARM', 'SVC-HISTORY', 'STN-CONSOLE', 'STN-FLEX', 'HIST-STORE', 'APP-ASSIST'];

  await t.test('one path down: NET-U1-A fails, NET-U1-B stays healthy, nothing downstream is touched', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NET_PATH_DEGRADED', targetNodeId: 'NET-U1-A' });
    assert.equal(r.accepted, true);
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['NET-U1-A'], 'FAILED');
    assert.equal(health['NET-U1-B'], 'HEALTHY');
    for (const nid of DOWNSTREAM) assert.equal(health[nid], 'HEALTHY', `${nid} must stay healthy on a single degraded path`);
  });

  await t.test('the OTHER path down (symmetry): NET-U1-B fails, NET-U1-A stays healthy', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NET_PATH_DEGRADED', targetNodeId: 'NET-U1-B' });
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['NET-U1-B'], 'FAILED');
    assert.equal(health['NET-U1-A'], 'HEALTHY');
    for (const nid of DOWNSTREAM) assert.equal(health[nid], 'HEALTHY');
  });

  await t.test('two independent single-path degradations on different units do not interact', () => {
    let r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NET_PATH_DEGRADED', targetNodeId: 'NET-U1-A' });
    r = FaultEngine.activate(r.state, graph, { faultId: 'NET_PATH_DEGRADED', targetNodeId: 'NET-U2-A' });
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['NET-U1-A'], 'FAILED');
    assert.equal(health['NET-U2-A'], 'FAILED');
    assert.equal(health['NET-U1-B'], 'HEALTHY');
    assert.equal(health['NET-U2-B'], 'HEALTHY');
    for (const nid of DOWNSTREAM) assert.equal(health[nid], 'HEALTHY');
  });

  await t.test('all paths down (communications partition): both members fail and the common-cause pattern propagates', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'COMMS_PARTITION', targetNodeId: 'NET-U1-A' });
    assert.equal(r.accepted, true);
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['NET-U1-A'], 'FAILED');
    assert.equal(health['NET-U1-B'], 'FAILED', 'groupWide activation must fail BOTH members from one call');
    for (const nid of DOWNSTREAM) assert.equal(health[nid], 'DEGRADED', `${nid} must be reached once the whole group is down`);
    // U2/U3 network groups are untouched -- this is a U1 partition, not a plant-wide one.
    assert.equal(health['NET-U2-A'], 'HEALTHY');
    assert.equal(health['NET-U3-A'], 'HEALTHY');
  });

  await t.test('manually failing BOTH members via two single-path faults does NOT itself constitute a partition', () => {
    // NET_PATH_DEGRADED's own healthEffect is FAILED, so this is the adversarial case:
    // two "single path" activations technically leave every group member FAILED. The
    // engine still treats this as a full-group failure (it checks health, not fault
    // identity) -- proving propagation keys on ACTUAL health, not on which fault ran.
    let r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NET_PATH_DEGRADED', targetNodeId: 'NET-U3-A' });
    // NET_PATH_DEGRADED conflicts with COMMS_PARTITION but not with itself on a
    // different target, so a second NET_PATH_DEGRADED on the sibling path is legal.
    r = FaultEngine.activate(r.state, graph, { faultId: 'NET_PATH_DEGRADED', targetNodeId: 'NET-U3-B' });
    assert.equal(r.accepted, true);
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['NET-U3-A'], 'FAILED');
    assert.equal(health['NET-U3-B'], 'FAILED');
    assert.equal(health['SVC-SERVER'], 'DEGRADED', 'both U3 paths down must propagate exactly like COMMS_PARTITION would');
  });
});

// =========================================================================== 4. PROPAGATION FACTS

test('propagation matches the measured topology facts (BLAST faults)', async (t) => {
  await t.test('CONTROLLER_LOSS on CTRL-U1/U2/U3 stales exactly that unit\'s points (10/7/7)', () => {
    const expectedCount = { U1: 10, U2: 7, U3: 7 };
    for (const u of ['U1', 'U2', 'U3']) {
      const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-' + u });
      const health = FaultEngine.computeHealth(r.state, graph);
      const touchedPoints = new Set();
      Object.keys(graph.nodes).forEach((id) => {
        if (health[id] !== 'HEALTHY') graph.nodes[id].pointRefs.forEach((t) => touchedPoints.add(t));
      });
      assert.equal(touchedPoints.size, expectedCount[u], `CTRL-${u}`);
      // Cross-check against the lead's own blastRadius(), which this fault's BLAST
      // propagation is deliberately built to match.
      const br = Topology.blastRadius(graph, 'CTRL-' + u);
      assert.deepEqual([...touchedPoints].sort(), br.points);
    }
  });

  await t.test('SERVER_SERVICE_DEGRADED reaches only STN-FLEX and APP-ASSIST; console and alarm/history stay healthy', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'SERVER_SERVICE_DEGRADED', targetNodeId: 'SVC-SERVER' });
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['SVC-SERVER'], 'DEGRADED');
    assert.equal(health['STN-FLEX'], 'DEGRADED');
    assert.equal(health['APP-ASSIST'], 'DEGRADED');
    assert.equal(health['STN-CONSOLE'], 'HEALTHY');
    assert.equal(health['SVC-ALARM'], 'HEALTHY');
    assert.equal(health['SVC-HISTORY'], 'HEALTHY');
    assert.equal(health['HIST-STORE'], 'HEALTHY');
  });

  await t.test('HISTORIAN_GAP reaches the historian and both station profiles; live control stays healthy', () => {
    // Updated at SA integration: the lead added the HIST-STORE -> STN-FLEX read-back, so a
    // historian gap now shows on a trend at EITHER profile. That is the point of drill A10 --
    // the gap is diagnosed from the missing history, not from which station you are at.
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'HISTORIAN_GAP', targetNodeId: 'SVC-HISTORY' });
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['SVC-HISTORY'], 'DEGRADED');
    assert.equal(health['HIST-STORE'], 'DEGRADED');
    assert.equal(health['STN-CONSOLE'], 'DEGRADED');
    assert.equal(health['STN-FLEX'], 'DEGRADED', 'trend read-back reaches the flex profile too');
    // The load-bearing half: live data and alarms are untouched. A history fault must never
    // look like a process problem.
    assert.equal(health['SVC-SERVER'], 'HEALTHY');
    assert.equal(health['SVC-ALARM'], 'HEALTHY');
    assert.equal(health['CTRL-U1'], 'HEALTHY');
  });

  await t.test('a single transmitter fault (FIELD domain) never propagates beyond its own node', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-FIC102', magnitude: 1 });
    const health = FaultEngine.computeHealth(r.state, graph);
    assert.equal(health['XMTR-FIC102'], 'DEGRADED');
    const touched = Object.keys(health).filter((id) => health[id] !== 'HEALTHY');
    assert.deepEqual(touched, ['XMTR-FIC102'], 'FIELD faults must not cascade -- the spine of the cause/symptom split');
  });

  await t.test('an open input (IO domain) never propagates beyond its own channel', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'OPEN_INPUT_BAD_QUALITY', targetNodeId: 'AI-FIC102' });
    const health = FaultEngine.computeHealth(r.state, graph);
    const touched = Object.keys(health).filter((id) => health[id] !== 'HEALTHY');
    assert.deepEqual(touched, ['AI-FIC102']);
  });
});

// =========================================================================== 5. DETERMINISM

test('determinism: seeded, never Math.random, survives snapshot/restore', async (t) => {
  await t.test('a magnitude-bearing fault throws without a magnitude or a rand()', () => {
    assert.throws(() => FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-LIC101' }),
      /needs an explicit magnitude or a seeded rand/);
  });

  await t.test('two independently-seeded generators with the same seed resolve the same magnitude', () => {
    const r1 = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-LIC101', rand: mulberry32(20260829) });
    const r2 = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-LIC101', rand: mulberry32(20260829) });
    assert.equal(typeof r1.instance.magnitude, 'number');
    assert.equal(r1.instance.magnitude, r2.instance.magnitude);
  });

  await t.test('a different seed resolves a different magnitude (sanity: the seed is actually consulted)', () => {
    const r1 = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NOISY_MEASUREMENT', targetNodeId: 'XMTR-LIC101', rand: mulberry32(1) });
    const r2 = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'NOISY_MEASUREMENT', targetNodeId: 'XMTR-LIC101', rand: mulberry32(2) });
    assert.notEqual(r1.instance.magnitude, r2.instance.magnitude);
  });

  await t.test('an identical activation SEQUENCE from two fresh engines produces identical state and projections', () => {
    function runSequence(seed) {
      const rand = mulberry32(seed);
      let s = FaultEngine.createState();
      s = FaultEngine.activate(s, graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-LIC101', simTime: 500, rand }).state;
      s = FaultEngine.activate(s, graph, { faultId: 'NOISY_MEASUREMENT', targetNodeId: 'XMTR-TIC201', simTime: 700, rand }).state;
      s = FaultEngine.activate(s, graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U2', simTime: 900 }).state;
      return s;
    }
    const sA = runSequence(42);
    const sB = runSequence(42);
    assert.deepEqual(sA, sB);
    assert.deepEqual(FaultEngine.healthProjection(sA, graph), FaultEngine.healthProjection(sB, graph));
    assert.deepEqual(FaultEngine.truthProjection(sA, graph), FaultEngine.truthProjection(sB, graph));
  });

  await t.test('state survives a plain JSON snapshot/restore round-trip and keeps computing identical health', () => {
    let s = FaultEngine.createState();
    s = FaultEngine.activate(s, graph, { faultId: 'COMMS_PARTITION', targetNodeId: 'NET-U2-A' }).state;
    s = FaultEngine.activate(s, graph, { faultId: 'ASSISTANT_LOSS', targetNodeId: 'APP-ASSIST' }).state;
    const before = FaultEngine.computeHealth(s, graph);

    const json = JSON.parse(JSON.stringify(FaultEngine.snapshot(s))); // simulate a real serialize/deserialize
    assert.doesNotThrow(() => JSON.stringify(json)); // plain JSON: no functions, no Maps, no class instances
    const restored = FaultEngine.restore(json);
    assert.deepEqual(restored, s);
    assert.deepEqual(FaultEngine.computeHealth(restored, graph), before);

    // and restored state keeps behaving correctly under further activity
    const after = FaultEngine.deactivate(restored, { faultId: 'ASSISTANT_LOSS', targetNodeId: 'APP-ASSIST' });
    assert.equal(after.accepted, true);
    assert.equal(FaultEngine.isActive(after.state, 'ASSISTANT_LOSS', 'APP-ASSIST'), false);
    assert.equal(FaultEngine.isActive(after.state, 'COMMS_PARTITION', 'NET-U2-A'), true);
  });
});

// =========================================================================== 6. LEAKAGE (highest-value test)

function leaks(text) {
  if (text.includes('INSTRUCTOR_ONLY')) return true;
  return FaultEngine.FAULT_IDS.some((id) => text.includes(id));
}

test('leakage: the trainee projection never carries fault identity or instructor-only truth', async (t) => {
  await t.test('non-triviality: the trainee projection covers every node (114) and shows at least one non-healthy symptom while a fault is active', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U2' });
    const proj = FaultEngine.healthProjection(r.state, graph);
    assert.equal(proj.nodeCount, 114);
    assert.equal(Object.keys(proj.nodes).length, Object.keys(graph.nodes).length);
    const nonHealthy = Object.values(proj.nodes).filter((n) => n.health !== 'HEALTHY');
    assert.ok(nonHealthy.length > 0, 'expected at least one degraded/failed node while CONTROLLER_LOSS is active');
    assert.ok(nonHealthy.some((n) => n.symptoms.length > 0), 'a non-healthy node must carry at least one symptom string');
  });

  await t.test('positive control: the INSTRUCTOR projection legitimately contains the fault id and INSTRUCTOR_ONLY', () => {
    const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U2' });
    const truthText = JSON.stringify(FaultEngine.truthProjection(r.state, graph));
    assert.ok(truthText.includes('CONTROLLER_LOSS'), 'sanity: the instructor view SHOULD name the fault');
    assert.ok(truthText.includes('INSTRUCTOR_ONLY'), 'sanity: the instructor view SHOULD carry the visibility marker');
  });

  await t.test('the leaks() checker is not vacuous: a deliberately planted leak is caught (proof, then the plant is discarded)', () => {
    const cleanText = JSON.stringify(FaultEngine.healthProjection(FaultEngine.createState(), graph));
    assert.equal(leaks(cleanText), false, 'baseline must be clean before we can trust a planted-leak proof');
    const planted = cleanText + ' CONTROLLER_LOSS INSTRUCTOR_ONLY'; // <-- the plant lives ONLY in this test
    assert.equal(leaks(planted), true, 'the checker must catch a deliberately planted leak');
  });

  await t.test('exact-token match only: ordinary prose containing the word "measurement" must not false-positive', () => {
    // BIASED_MEASUREMENT / FROZEN_MEASUREMENT / NOISY_MEASUREMENT are real fault ids;
    // plain English "measurement" (no leading domain word, no underscore) must not trip
    // the checker, or the checker would be too blunt to trust.
    assert.equal(leaks('a routine measurement check found nothing unusual'), false);
    assert.equal(leaks('FROZEN_MEASUREMENT'), true); // the exact token still must trip it
  });

  await t.test('negative control: with EVERY fault id active somewhere, the serialized trainee projection leaks nothing', () => {
    // Activate all 13 faults simultaneously (on distinct, valid targets, skipping the
    // pairs the conflicts table forbids) and serialize the WHOLE trainee projection.
    let s = FaultEngine.createState();
    const activations = [
      ['FROZEN_MEASUREMENT', 'XMTR-LIC101'],
      ['VALVE_RESPONSE_FAILURE', firstNodeOfKind('VALVE')],
      ['OPEN_INPUT_BAD_QUALITY', 'AI-FIC102'],
      ['CONTROLLER_LOSS', 'CTRL-U3'],
      ['NET_PATH_DEGRADED', 'NET-U2-A'],
      ['SERVER_SERVICE_DEGRADED', 'SVC-SERVER'],
      ['STATION_LOSS_PEER', 'STN-CONSOLE'],
      ['HISTORIAN_GAP', 'SVC-HISTORY'],
      ['ASSISTANT_LOSS', 'APP-ASSIST']
    ];
    for (const [faultId, targetNodeId] of activations) {
      const r = FaultEngine.activate(s, graph, { faultId, targetNodeId });
      assert.equal(r.accepted, true, `${faultId}@${targetNodeId}: ${r.reason}`);
      s = r.state;
    }
    // BIASED_MEASUREMENT/NOISY_MEASUREMENT conflict with FROZEN_MEASUREMENT on the same
    // target and need a magnitude; exercise them on two other transmitters.
    s = FaultEngine.activate(s, graph, { faultId: 'BIASED_MEASUREMENT', targetNodeId: 'XMTR-TIC201', magnitude: 2 }).state;
    s = FaultEngine.activate(s, graph, { faultId: 'NOISY_MEASUREMENT', targetNodeId: 'XMTR-TIC202', magnitude: 1.5 }).state;
    // COMMS_PARTITION conflicts with NET_PATH_DEGRADED on the same group; use U1's.
    s = FaultEngine.activate(s, graph, { faultId: 'COMMS_PARTITION', targetNodeId: 'NET-U1-A' }).state;
    // REDUNDANCY_SWITCHOVER conflicts with CONTROLLER_LOSS on the same target; use U1's controller.
    s = FaultEngine.activate(s, graph, { faultId: 'REDUNDANCY_SWITCHOVER', targetNodeId: 'CTRL-U1' }).state;

    assert.equal(s.activeFaults.length, 13, 'all 13 fault ids should be represented in this run');
    const activeIds = new Set(s.activeFaults.map((f) => f.faultId));
    assert.deepEqual([...activeIds].sort(), [...FaultEngine.FAULT_IDS].sort());

    const proj = FaultEngine.healthProjection(s, graph);
    const projText = JSON.stringify(proj);
    assert.equal(leaks(projText), false, 'trainee projection leaked with every fault id active: ' + projText.slice(0, 500));
    assert.equal(proj.nodeCount, 114);
    assert.ok(Object.values(proj.nodes).some((n) => n.health === 'FAILED'));
    assert.ok(Object.values(proj.nodes).some((n) => n.health === 'DEGRADED'));

    // Prove the checker would have caught it, on this exact real payload.
    assert.equal(leaks(projText + 'NOISY_MEASUREMENT'), true);
  });

  await t.test('per-fault sweep: activating each of the 13 faults alone never leaks its own id', () => {
    const targets = {
      FROZEN_MEASUREMENT: 'XMTR-LIC101', BIASED_MEASUREMENT: 'XMTR-LIC101', NOISY_MEASUREMENT: 'XMTR-LIC101',
      VALVE_RESPONSE_FAILURE: firstNodeOfKind('VALVE'), OPEN_INPUT_BAD_QUALITY: 'AI-FIC102',
      CONTROLLER_LOSS: 'CTRL-U1', REDUNDANCY_SWITCHOVER: 'CTRL-U1',
      NET_PATH_DEGRADED: 'NET-U1-A', COMMS_PARTITION: 'NET-U1-A',
      SERVER_SERVICE_DEGRADED: 'SVC-SERVER', STATION_LOSS_PEER: 'STN-CONSOLE',
      HISTORIAN_GAP: 'SVC-HISTORY', ASSISTANT_LOSS: 'APP-ASSIST'
    };
    for (const faultId of FaultEngine.FAULT_IDS) {
      const targetNodeId = targets[faultId];
      assert.ok(targetNodeId, `no target chosen for ${faultId}`);
      const r = FaultEngine.activate(FaultEngine.createState(), graph, { faultId, targetNodeId, magnitude: 1 });
      assert.equal(r.accepted, true, `${faultId}: ${r.reason}`);
      const text = JSON.stringify(FaultEngine.healthProjection(r.state, graph));
      assert.equal(leaks(text), false, `${faultId} leaked into the trainee projection`);
      const projection = FaultEngine.symptomProjection(r.state, graph);
      const symptomText = JSON.stringify(projection);
      assert.equal(projection.grade, 'SIMULATED_ARCHITECTURE_INDICATION');
      assert.ok(projection.observations.length > 0,
        `${faultId}: symptom projection was empty`);
      assert.ok(!symptomText.includes(faultId), `${faultId}: symptom projection leaked its fault id`);
      assert.ok(!symptomText.includes(targetNodeId), `${faultId}: symptom projection leaked its target node id`);
      assert.ok(!symptomText.includes('INSTRUCTOR_ONLY'), `${faultId}: symptom projection leaked truth visibility`);
    }
  });
});
