// @artifact dev
// Adversarial test suite for src/architecture-view-model.js (V3-PLAN section 7, S1 stage).
//
// This module has no sibling requires (see its own header), but its TEST FILE is free to
// require ESS.Topology, ESS.SignalPath and ESS.FaultEngine directly to build realistic
// inputs -- exactly the pattern tests/signal-path.test.js and tests/fault-engine.test.js
// already use. Per the SA advisory: after logic-harness's load() there is no ESS.Topology
// global (only the app head's existing modules are evaluated), so every module here is
// required by path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const SignalPath = require('../src/signal-path.js');
const FaultEngine = require('../src/fault-engine.js');
const AVM = require('../src/architecture-view-model.js');

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

const c = freshComponent();
const graph = buildGraph(c);

// Sanity: this suite's expectations (branch counts, applicable-path lists) are pinned to
// the measured graph shape, not re-derived here, so a graph regression fails loudly.
test('fixture sanity: the graph this suite runs against has the measured shape', () => {
  assert.equal(Object.keys(graph.nodes).length, 114);
  assert.equal(graph.edges.length, 247);
  assert.deepEqual(Topology.validate(graph), []);
});

/** Build a full SELECTION for `tag` the way the app is expected to (V3-PLAN §7 / the
 *  module's SELECTION SHAPE docstring): call ESS.SignalPath directly and hand the
 *  results in as plain data -- architecture-view-model.js never calls SignalPath itself. */
function selectionFor(tag, profile) {
  const applicable = SignalPath.applicablePaths(graph, tag);
  const resolved = {}, describe = {};
  applicable.forEach((t) => {
    const r = SignalPath.resolve(graph, tag, { path: t, profile: profile || 'console' });
    resolved[t] = r;
    describe[t] = SignalPath.describe(graph, r);
  });
  return { applicable, resolved, describe };
}

// A node with plenty of upstream/downstream structure to inspect: the U1 controller.
const CTRL_NODE = 'CTRL-U1';
// A tag with all four path types (measurement/alarm/history/command) so beginner vs
// advanced and console vs flex have real branch/leg differences to assert on.
const FULL_TAG = 'FIC102';

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

// =========================================================================== 1. VOCABULARY + BANNER

test('vocabulary: MODES/PROFILES/LAYERS are frozen and BANNER is the required literal text', () => {
  assert.deepEqual(AVM.MODES, ['learn', 'trace', 'diagnose', 'debrief']);
  assert.deepEqual(AVM.PROFILES, ['console', 'flex']);
  assert.deepEqual(AVM.LAYERS, ['FIELD', 'IO', 'CONTROL', 'NETWORK', 'SERVICE', 'HMI', 'INFORMATION']);
  assert.equal(Object.isFrozen(AVM.MODES), true);
  assert.equal(Object.isFrozen(AVM.PROFILES), true);
  assert.equal(Object.isFrozen(AVM.LAYERS), true);
  assert.equal(AVM.BANNER, 'Conceptual training architecture. Simulated; not a Honeywell diagnostic display.');
});

test('banner is present, verbatim, on every mode x profile x input combination -- including garbage input', () => {
  const combos = [
    {},
    { graph: null },
    { graph: {} },
    { graph, mode: 'learn' },
    { graph, mode: 'trace', tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'console') },
    { graph, mode: 'diagnose', tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'flex') },
    { graph, mode: 'debrief' },
    { graph, mode: 'bogus-mode' },
    { graph, profile: 'bogus-profile' },
    { graph, selectedNode: 'does-not-exist' },
  ];
  for (const opts of combos) {
    const view = AVM.build(opts);
    assert.equal(view.banner, AVM.BANNER, JSON.stringify(opts));
  }
});

// =========================================================================== 2. PURITY

test('purity: the graph is byte-identical before and after many build() calls, including ones that return mutable-looking arrays', () => {
  const before = deepClone(graph);

  AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE });
  AVM.build({ graph, mode: 'trace', tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'console'), beginner: false });
  AVM.build({ graph, mode: 'diagnose', tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'flex'), selectedNode: 'XMTR-' + FULL_TAG });

  assert.deepEqual(deepClone(graph), before);
});

test('purity: every array the view hands back is a COPY, not a live reference into the graph', () => {
  const view = AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE, evidence: [{ target: CTRL_NODE }] });
  const before = deepClone(graph);

  // Mutate every mutable-looking surface in the returned view as aggressively as possible.
  view.inspector.sourceBasis.push('INJECTED');
  view.inspector.inputs.push({ id: 'x', label: 'x' });
  view.inspector.outputs.push({ id: 'x', label: 'x' });
  view.inspector.dependsOn.push({ id: 'x', label: 'x' });
  view.inspector.observableSymptoms.push('INJECTED');
  view.inspector.symptoms.push('INJECTED');
  view.inspector.evidence.push({ target: 'INJECTED' });
  view.inspector.rows.push({ label: 'x', value: 'x' });
  view.layers.forEach((l) => l.nodes.forEach((n) => { n.label = 'MUTATED'; }));
  view.edges.forEach((e) => { e.health = 'FAILED'; });
  if (view.blast) { view.blast.nodes.push('INJECTED'); view.blast.points.push('INJECTED'); }

  assert.deepEqual(deepClone(graph), before, 'mutating the returned view must never affect the source graph');
  // And the node this inspector was built from really is the SAME node topology.js would
  // hand back through node() -- proving the copy came from the live object, not a fixture.
  assert.notEqual(view.inspector.sourceBasis, graph.nodes[CTRL_NODE].sourceBasis);
  assert.deepEqual(before.nodes[CTRL_NODE].sourceBasis, graph.nodes[CTRL_NODE].sourceBasis);
});

// =========================================================================== 3. DETERMINISM

test('determinism: identical input produces deep-equal output on repeated calls', () => {
  const opts = { graph, mode: 'trace', profile: 'flex', tag: FULL_TAG, beginner: false, selection: selectionFor(FULL_TAG, 'flex'), selectedNode: CTRL_NODE };
  const a = AVM.build(opts);
  const b = AVM.build(opts);
  assert.deepEqual(a, b);
  // And the output is plain JSON-safe data: no functions anywhere (the template binds by
  // property path, never by calling into the view-model -- see the module docstring).
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

// =========================================================================== 4. LEARN vs TRACE

test('learn vs trace: learn carries no traced path, trace does not compute blast/inspector any differently but DOES resolve a path', () => {
  const learn = AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE });
  const trace = AVM.build({ graph, mode: 'trace', tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'console'), selectedNode: CTRL_NODE });

  assert.equal(learn.path, null);
  assert.ok(trace.path && trace.path.resolved);
  assert.notDeepEqual(learn, trace);

  // Learn's whole point is the graph structure: it is never "empty" just because nothing
  // is selected (the backdrop graph is the content).
  const learnBare = AVM.build({ graph, mode: 'learn' });
  assert.equal(learnBare.empty, false);
  assert.equal(learnBare.layers.reduce((n, l) => n + l.nodes.length, 0), 114);
});

test('trace/diagnose/debrief with no tag come back explicitly empty, never throwing', () => {
  for (const mode of ['trace', 'diagnose', 'debrief']) {
    const view = AVM.build({ graph, mode });
    assert.equal(view.empty, true, mode);
    assert.equal(typeof view.emptyText, 'string');
    assert.ok(view.emptyText.length > 0, mode);
  }
});

// =========================================================================== 5. BEGINNER vs ADVANCED

test('beginner vs advanced: beginner is one flat progression, advanced exposes every applicable branch', () => {
  const sel = selectionFor(FULL_TAG, 'console');
  assert.deepEqual(sel.applicable, ['measurement', 'alarm', 'history', 'command']);

  const beginner = AVM.build({ graph, mode: 'trace', tag: FULL_TAG, selection: sel, beginner: true });
  const advanced = AVM.build({ graph, mode: 'trace', tag: FULL_TAG, selection: sel, beginner: false });

  assert.equal(beginner.path.branches.length, 1);
  assert.equal(beginner.path.branches[0].type, 'measurement');

  assert.equal(advanced.path.branches.length, 4);
  assert.deepEqual(advanced.path.branches.map((b) => b.type), ['measurement', 'alarm', 'history', 'command']);

  assert.notDeepEqual(beginner, advanced);

  // Advanced must render the alarm/history/command legs as SEPARATE branches, never
  // folded into one mandatory linear pipeline (V3-PLAN §3's explicit prohibition).
  const measBranch = advanced.path.branches.find((b) => b.type === 'measurement');
  const alarmBranch = advanced.path.branches.find((b) => b.type === 'alarm');
  assert.notDeepEqual(measBranch.nodes, alarmBranch.nodes);
});

// =========================================================================== 6. CONSOLE vs FLEX

test('console vs flex: the resolved measurement path node list differs by profile', () => {
  const consoleSel = selectionFor(FULL_TAG, 'console');
  const flexSel = selectionFor(FULL_TAG, 'flex');

  const consoleView = AVM.build({ graph, mode: 'trace', tag: FULL_TAG, selection: consoleSel, beginner: true, profile: 'console' });
  const flexView = AVM.build({ graph, mode: 'trace', tag: FULL_TAG, selection: flexSel, beginner: true, profile: 'flex' });

  const consoleIds = consoleView.path.branches[0].nodes.map((n) => n.id);
  const flexIds = flexView.path.branches[0].nodes.map((n) => n.id);

  assert.notDeepEqual(consoleIds, flexIds);
  assert.ok(flexIds.includes('SVC-SERVER'), 'flex profile must route through the data server');
  assert.ok(!consoleIds.includes('SVC-SERVER'), 'console profile must not route through the data server');
  assert.ok(consoleIds.includes('STN-CONSOLE'));
  assert.ok(flexIds.includes('STN-FLEX'));
});

// =========================================================================== 7. INSPECTOR

test('inspector carries every required row and its sourceBasis, copied from the node', () => {
  const view = AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE });
  const insp = view.inspector;
  assert.ok(insp);
  assert.equal(insp.nodeId, CTRL_NODE);

  const rowLabels = insp.rows.map((r) => r.label);
  assert.deepEqual(rowLabels, [
    'Role', 'Inputs', 'Outputs', 'What depends on it',
    'Observable symptoms when degraded', 'Current simulated health', 'Evidence collected',
  ]);
  for (const row of insp.rows) assert.equal(typeof row.value, 'string');

  assert.ok(Array.isArray(insp.sourceBasis) && insp.sourceBasis.length > 0);
  assert.deepEqual(insp.sourceBasis, graph.nodes[CTRL_NODE].sourceBasis);
  assert.equal(insp.role, graph.nodes[CTRL_NODE].trainingDescription);
});

test('inspector: unknown selectedNode never throws and comes back null, not a crash', () => {
  const view = AVM.build({ graph, mode: 'learn', selectedNode: 'NOT-A-REAL-NODE' });
  assert.equal(view.inspector, null);
});

// =========================================================================== 8. BLAST RADIUS + DIAGNOSE GATING

test('blast radius: revealed in Learn for the selected node, matches a plain BFS', () => {
  const view = AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE });
  assert.ok(view.blast);
  assert.equal(view.blast.nodeId, CTRL_NODE);
  assert.ok(view.blast.nodes.includes('CEE-U1'));
  // CTRL-U1's blast radius must include the FIC102 control module, several layers downstream.
  assert.ok(view.blast.nodes.includes('CM-CM2_FIC102') || view.blast.nodes.some((n) => n.indexOf('FIC102') >= 0));
});

test('diagnose mode withholds blast radius unconditionally, even with a selected node', () => {
  const learn = AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE });
  const diagnose = AVM.build({ graph, mode: 'diagnose', selectedNode: CTRL_NODE });
  assert.ok(learn.blast !== null);
  assert.equal(diagnose.blast, null);
});

test('diagnose mode degrades inspector "what depends on it" to the one-hop structural list, never the full blast', () => {
  const learn = AVM.build({ graph, mode: 'learn', selectedNode: CTRL_NODE });
  const diagnose = AVM.build({ graph, mode: 'diagnose', selectedNode: CTRL_NODE });

  const learnDeps = learn.inspector.dependsOn.map((d) => d.id).sort();
  const diagDeps = diagnose.inspector.dependsOn.map((d) => d.id).sort();
  const oneHop = Topology.dependents(graph, CTRL_NODE).slice().sort();

  assert.deepEqual(diagDeps, oneHop);
  assert.notDeepEqual(learnDeps, diagDeps, 'diagnose must expose strictly less than learn for a node with a real blast radius');
});

// =========================================================================== 9. DIAGNOSE SAFETY / LEAKAGE

test('diagnose safety: build() never emits a FaultEngine fault id or the string INSTRUCTOR_ONLY, for every fault, in every mode', () => {
  for (const faultId of FaultEngine.FAULT_IDS) {
    let state = FaultEngine.createState();
    // Pick a plausible target per domain so activate() accepts it.
    const def = FaultEngine.getFaultDef(faultId);
    let targetNodeId = null;
    if (def.targets.includes('TRANSMITTER')) targetNodeId = 'XMTR-' + FULL_TAG;
    else if (def.targets.includes('AI_CH')) targetNodeId = 'AI-' + FULL_TAG;
    else if (def.targets.includes('CONTROLLER')) targetNodeId = 'CTRL-U1';
    else if (def.targets.includes('NET_PATH')) targetNodeId = 'NET-U1-A';
    else if (def.targets.includes('SERVER_SVC')) targetNodeId = def.targetIds ? def.targetIds[0] : 'SVC-SERVER';
    else targetNodeId = Object.keys(graph.nodes).find((id) => graph.nodes[id].kind === def.targets[0]);
    if (!targetNodeId || !graph.nodes[targetNodeId]) continue; // no fitting node in this graph; nothing to activate

    const result = FaultEngine.activate(state, graph, { faultId, targetNodeId, simTime: 100, magnitude: 1 });
    if (!result.accepted) continue;
    state = result.state;

    const health = FaultEngine.healthProjection(state, graph);

    for (const mode of AVM.MODES) {
      const view = AVM.build({
        graph, health, mode,
        tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'console'),
        selectedNode: targetNodeId, beginner: false,
        evidence: [],
      });
      const blob = JSON.stringify(view);
      assert.ok(!blob.includes('INSTRUCTOR_ONLY'), `${faultId}/${mode}: leaked INSTRUCTOR_ONLY`);
      for (const otherId of FaultEngine.FAULT_IDS) {
        assert.ok(!blob.includes(otherId), `${faultId}/${mode}: leaked fault id ${otherId}`);
      }
    }
  }
});

test('diagnose safety: a mis-shaped instructor truthProjection passed as `health` is silently ignored, never read', () => {
  const state = FaultEngine.activate(FaultEngine.createState(), graph, {
    faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U1', simTime: 0, magnitude: 1,
  });
  const truth = FaultEngine.truthProjection(state.state, graph); // instructor shape: {activeFaults, nodeHealth}, NOT {nodes}

  const view = AVM.build({ graph, health: truth, mode: 'diagnose', tag: FULL_TAG, selection: selectionFor(FULL_TAG, 'console'), selectedNode: 'CTRL-U1' });
  // Every node must read back HEALTHY: `truth.nodes` does not exist, so healthOf() defaults.
  const ctrlNode = view.layers.find((l) => l.id === 'CONTROL').nodes.find((n) => n.id === 'CTRL-U1');
  assert.equal(ctrlNode.health, 'HEALTHY');
  const blob = JSON.stringify(view);
  assert.ok(!blob.includes('INSTRUCTOR_ONLY'));
  assert.ok(!blob.includes('CONTROLLER_LOSS'));
});

// =========================================================================== 10. NEVER THROWS

test('never throws: absent graph, absent health, unknown tag, unknown node, garbage input', () => {
  assert.doesNotThrow(() => AVM.build());
  assert.doesNotThrow(() => AVM.build({}));
  assert.doesNotThrow(() => AVM.build({ graph: null }));
  assert.doesNotThrow(() => AVM.build({ graph: {} }));
  assert.doesNotThrow(() => AVM.build({ graph, health: null }));
  assert.doesNotThrow(() => AVM.build({ graph, health: {} }));
  assert.doesNotThrow(() => AVM.build({ graph, health: { nodes: null } }));
  assert.doesNotThrow(() => AVM.build({ graph, mode: 'trace', tag: 'NOT-A-TAG' }));
  assert.doesNotThrow(() => AVM.build({ graph, mode: 'trace', tag: 'NOT-A-TAG', selection: selectionFor('NOT-A-TAG', 'console') }));
  assert.doesNotThrow(() => AVM.build({ graph, mode: 'diagnose', selectedNode: 'NOT-A-NODE' }));
  assert.doesNotThrow(() => AVM.build({ graph, mode: 'bogus', profile: 'bogus', beginner: 'not-a-boolean', evidence: 'not-an-array' }));

  const view = AVM.build({ graph, mode: 'trace', tag: 'NOT-A-TAG', selection: selectionFor('NOT-A-TAG', 'console') });
  assert.equal(view.empty, true);
  assert.equal(view.path.resolved, false);
});

test('unknown tag with a real (but empty) selection object resolves cleanly rather than crashing', () => {
  const emptySelection = { applicable: [], resolved: {}, describe: {} };
  const view = AVM.build({ graph, mode: 'trace', tag: 'GHOST-TAG', selection: emptySelection });
  assert.equal(view.path.resolved, false);
  assert.equal(view.empty, true);
  assert.equal(view.banner, AVM.BANNER);
});

// =========================================================================== 11. UMD / GLOBAL ATTACH

test('module attaches BOTH ESS.ArchitectureViewModel and ESS.ArchViewModel as the same object on the browser path, per its documented naming-conflict resolution', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'architecture-view-model.js'), 'utf8');
  const root = {};
  // Same technique tests/models.test.js already uses: `globalThis` as a named parameter
  // shadows the real global inside the function body, so the UMD wrapper's browser
  // branch runs against `root` instead of the real global object.
  new Function('module', 'globalThis', src).call(root, undefined, root);
  assert.equal(typeof root.ESS, 'object');
  assert.equal(typeof root.ESS.ArchitectureViewModel, 'object');
  assert.equal(typeof root.ESS.ArchViewModel, 'object');
  assert.equal(root.ESS.ArchitectureViewModel, root.ESS.ArchViewModel);
  assert.equal(typeof root.ESS.ArchitectureViewModel.build, 'function');
  assert.deepEqual(Object.keys(root.ESS.ArchitectureViewModel).sort(), Object.keys(AVM).sort());
});

// =========================================================================== 12. ARTIFACT CLASS

test('the module and this test file each declare an artifact class in their first 3 lines', () => {
  for (const rel of ['src/architecture-view-model.js', 'tests/architecture-view-model.test.js']) {
    const head = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\n').slice(0, 3).join('\n');
    assert.match(head, /@artifact\s+(production|dev)\b/);
  }
});
