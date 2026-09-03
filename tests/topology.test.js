// @artifact dev
// Adversarial test suite for src/topology.js (the lead's shared substrate for v3).
//
// This file does NOT edit src/topology.js. Where a defect is found, it is proven here
// with evidence and reported in the stage summary, never silently patched around.
//
// Per the SA advisory: after load() there is no global ESS.Topology (the harness only
// evaluates the app head's nine v2 modules), so Topology is required directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');

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

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

function unitPoints(c, u) {
  return Object.keys(c.L).filter((t) => (c.unitOf(t) || 'U1') === u).sort();
}

// A single shared component/graph for tests that only read; each broken-graph test
// clones this valid graph rather than mutating it, so no test can poison another
// (the "GRAPH CONTRACT" trap the advisory calls out explicitly).
const c = freshComponent();
const graph = buildGraph(c);

// =========================================================================== 1. GRAPH CONTRACT

test('graph contract: validate() is not vacuous', async (t) => {
  await t.test('validate() returns [] on the real built graph', () => {
    assert.deepEqual(Topology.validate(graph), []);
  });

  await t.test('catches an edge whose to-node does not exist', () => {
    const g = deepClone(graph);
    g.edges.push({ id: 'E-BOGUS-TO', from: 'XMTR-FIC102', to: 'NOPE-NODE', semantic: 'PV' });
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('does not exist')), problems.join('\n'));
  });

  await t.test('catches an edge whose from-node does not exist', () => {
    const g = deepClone(graph);
    g.edges.push({ id: 'E-BOGUS-FROM', from: 'NOPE-NODE', to: 'XMTR-FIC102', semantic: 'PV' });
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('does not exist')), problems.join('\n'));
  });

  await t.test('catches a node with an unknown layer', () => {
    const g = deepClone(graph);
    g.nodes['BOGUS-LAYER'] = {
      id: 'BOGUS-LAYER', layer: 'ORBIT', kind: 'TRANSMITTER', label: 'x',
      trainingDescription: 'x', pointRefs: [], diagnostics: [], sourceBasis: [],
    };
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('unknown layer')), problems.join('\n'));
  });

  await t.test('catches a node with an unknown kind', () => {
    const g = deepClone(graph);
    g.nodes['BOGUS-KIND'] = {
      id: 'BOGUS-KIND', layer: 'FIELD', kind: 'FLUX_CAPACITOR', label: 'x',
      trainingDescription: 'x', pointRefs: [], diagnostics: [], sourceBasis: [],
    };
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('unknown kind')), problems.join('\n'));
  });

  await t.test('catches a point path referencing a missing node', () => {
    const g = deepClone(graph);
    g.pointPaths.FIC102.measurement.push('NOPE-NODE');
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('references missing node')), problems.join('\n'));
  });

  await t.test('catches a node with no trainingDescription', () => {
    const g = deepClone(graph);
    g.nodes['XMTR-FIC102'].trainingDescription = '';
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('missing trainingDescription')), problems.join('\n'));
  });

  await t.test('catches an ALARM edge running down the layer stack', () => {
    const g = deepClone(graph);
    // SVC-ALARM is SERVICE; XMTR-FIC102 is FIELD. An ALARM edge from the service back
    // down to a field device is not a valid annunciation direction.
    g.edges.push({ id: 'E-BOGUS-ALARM-DOWN', from: 'SVC-ALARM', to: 'XMTR-FIC102', semantic: 'ALARM' });
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('must not run down the layer stack')), problems.join('\n'));
  });

  await t.test('bonus: catches a node keyed under the wrong id', () => {
    const g = deepClone(graph);
    const n = g.nodes['XMTR-FIC102'];
    delete g.nodes['XMTR-FIC102'];
    g.nodes['XMTR-WRONGKEY'] = n; // n.id still says XMTR-FIC102
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('does not match its id')), problems.join('\n'));
  });

  await t.test('bonus: catches VALVE_OF naming a point that resolved no command path', () => {
    // Simulate config drift: the tag database no longer has the valve VALVE_OF names.
    const Vcopy = deepClone(c.V);
    delete Vcopy.FV102;
    const g = Topology.build({ L: c.L, V: Vcopy, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
    const problems = Topology.validate(g);
    assert.ok(problems.some((p) => p.includes('FIC102') && p.includes('resolved no command path')), problems.join('\n'));
  });

  await t.test('none of the above poisoned the real graph', () => {
    assert.deepEqual(Topology.validate(graph), []);
  });
});

// ===================================================================== 2. DERIVATION FIDELITY

test('derivation fidelity: the graph cannot drift from the tag database', async (t) => {
  await t.test('every point in c.L appears with its control module from l.cm', () => {
    for (const tag of Object.keys(c.L)) {
      const l = c.L[tag];
      const cmId = 'CM-' + (l.cm || tag);
      assert.ok(graph.nodes[cmId], `${tag}: expected control-module node ${cmId}`);
      assert.equal(graph.nodes[cmId].layer, 'CONTROL');
      assert.equal(graph.nodes[cmId].kind, 'CM');
      assert.ok(graph.nodes[cmId].pointRefs.includes(tag), `${tag}: ${cmId}.pointRefs should include ${tag}`);
    }
  });

  await t.test('every valve VALVE_OF names appears as a FIELD/VALVE node carrying its fail-safe direction', () => {
    const tags = Object.keys(Topology.VALVE_OF);
    assert.equal(tags.length, 14);
    for (const tag of tags) {
      const valve = Topology.VALVE_OF[tag];
      const vId = 'VLV-' + valve;
      const n = graph.nodes[vId];
      assert.ok(n, `expected valve node ${vId} for ${tag}`);
      assert.equal(n.layer, 'FIELD');
      assert.equal(n.kind, 'VALVE');
      const failWord = c.V[valve].fail ? 'open' : 'closed';
      assert.ok(n.trainingDescription.includes(failWord),
        `${vId}: expected fail-safe direction "${failWord}" in trainingDescription, got: ${n.trainingDescription}`);
    }
  });

  await t.test('node count per layer is stable (measured baseline)', () => {
    const byLayer = {};
    Object.values(graph.nodes).forEach((n) => { byLayer[n.layer] = (byLayer[n.layer] || 0) + 1; });
    assert.deepEqual(byLayer, {
      FIELD: 44, IO: 46, CONTROL: 39, NETWORK: 8, SERVICE: 3, HMI: 2, INFORMATION: 2,   // +30 for Unit 04 (2026-09-03)
    });
    assert.equal(Object.keys(graph.nodes).length, 144);
    assert.equal(graph.edges.length, 315);  // 247 (246 + the HIST-STORE -> STN-FLEX trend read-back) + 68 for Unit 04
    assert.equal(Object.keys(graph.pointPaths).length, 30);
  });

  await t.test('all 30 points resolve a measurement path of the documented shape', () => {
    for (const tag of Object.keys(c.L)) {
      const l = c.L[tag];
      const u = c.unitOf(tag) || 'U1';
      const isMotor = l.kind === 'motor';
      const fieldId = (isMotor ? 'DRV-' : 'XMTR-') + tag;
      const expected = [fieldId, 'AI-' + tag, 'CTRL-' + u, 'CEE-' + u, 'CM-' + (l.cm || tag), 'NET-' + u + '-A'];
      assert.deepEqual(graph.pointPaths[tag].measurement, expected, `${tag}: unexpected measurement path shape`);
    }
  });

  await t.test('exactly 16 points resolve a command path (14 valves + 2 motors); the rest are null', () => {
    const withCommand = Object.keys(graph.pointPaths).filter((t) => graph.pointPaths[t].command);
    assert.equal(withCommand.length, 16);
    for (const valveTag of Object.keys(Topology.VALVE_OF)) assert.ok(withCommand.includes(valveTag));
    assert.ok(withCommand.includes('P101'));
    assert.ok(withCommand.includes('M202'));
    for (const tag of Object.keys(graph.pointPaths)) {
      if (!withCommand.includes(tag)) assert.equal(graph.pointPaths[tag].command, null, `${tag}: expected null command path`);
    }
  });

  await t.test('applicable path types per point sum to 106 across the graph (30 measurement + 30 alarm + 30 history + 16 command)', () => {
    let total = 0;
    for (const tag of Object.keys(graph.pointPaths)) {
      const p = graph.pointPaths[tag];
      ['measurement', 'command', 'alarm', 'history'].forEach((k) => { if (p[k] !== null && p[k] !== undefined) total += 1; });
    }
    assert.equal(total, 106);
  });

  await t.test('FINDING: a point with zero configured alarm conditions still resolves a 2-hop alarm path with no backing ALARM edge', () => {
    // AI205, FI100, M202, P101 have alm:{} (measured). build() unconditionally sets
    // pointPaths[tag].alarm = [cmId, 'SVC-ALARM'] for every point regardless of whether
    // any alarm condition exists (the ALARM edge itself is only added per-condition, so
    // these four get a declared path with nothing behind it). Unlike the command leg,
    // which is honestly null when the point strokes nothing, the alarm leg has no null
    // state for "no alarm configured" -- and validate() does not check that a declared
    // path's hops are actually connected by an edge (see the adjacency test below), so
    // this inconsistency passes silently today.
    const noAlarmTags = ['AI205', 'FI100', 'M202', 'P101'];
    for (const tag of noAlarmTags) {
      assert.deepEqual(c.L[tag].alm, {}, `${tag}: expected this fixture assumption (zero alm conditions) to still hold`);
      const path = graph.pointPaths[tag].alarm;
      assert.ok(path, `${tag}: alarm path is declared (this is the finding)`);
      const cmId = path[0];
      const backed = graph.edges.some((e) => e.semantic === 'ALARM' && e.from === cmId && e.to === 'SVC-ALARM' && e.pointRef === tag);
      assert.equal(backed, false, `${tag}: expected no ALARM edge to back the declared path (evidence for the finding)`);
    }
  });

  await t.test('FINDING: validate() does not check that a declared point-path is actually connected by edges', () => {
    // Positive control for the finding above: replace a real point's alarm path with two
    // nodes that both exist in the graph but are not linked by any ALARM edge at all, and
    // show validate() still reports zero problems. validate() only checks that every id
    // named in a path resolves to a real node -- it never walks the edge list to confirm
    // consecutive path entries are actually joined. (For measurement/command/history this
    // is a deliberate "reading order" per the module's own header comment, so it is not a
    // defect there; for the 2-hop alarm leg specifically it means a completely disconnected
    // "path" is indistinguishable from a real one to this contract check.)
    const g = deepClone(graph);
    g.pointPaths.FIC102.alarm = ['STN-CONSOLE', 'HIST-STORE']; // both real nodes, no edge between them, wrong semantic entirely
    assert.deepEqual(Topology.validate(g), []);
  });

  await t.test('two points sharing a control module BOTH stay in its pointRefs and blast radius', () => {
    // Originally reported by this suite as a finding: build()'s add() fully REPLACED an
    // existing node, so a second point resolving to the same control module silently
    // dropped the first from that node's pointRefs -- and blastRadius(), which is exactly
    // what a trainee uses to reason about "what does this failure affect", lost a point
    // with no indication anything was wrong. validate() raised nothing.
    //
    // The lead fixed add() to MERGE pointRefs at SA integration. None of the real 30 tags
    // share a `cm` today, so this was latent; SCM202 already shows a control module need
    // not map to exactly one point, and nothing in the contract forbids sharing. This test
    // now pins the fix instead of the defect.
    const L2 = deepClone(c.L);
    const tags = Object.keys(L2).sort();
    const first = tags[0], second = tags[1];
    L2[second].cm = L2[first].cm || first;          // force both onto one control module
    const g2 = Topology.build({ L: L2, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
    const cmId = 'CM-' + (L2[first].cm || first);

    assert.deepEqual(Topology.validate(g2), [], 'a shared control module is legal and must validate');
    assert.deepEqual(g2.nodes[cmId].pointRefs.slice().sort(), [first, second].sort(),
      'both points must survive in the shared control module\'s pointRefs');
    const br = Topology.blastRadius(g2, cmId);
    for (const tag of [first, second]) {
      assert.ok(br.points.includes(tag),
        `${tag} genuinely depends on ${cmId} and must appear in its blast radius`);
    }
  });
});

// ================================================================ 3. FAILURE DOMAIN SEMANTICS

test('failure domain semantics: blast radius teaches the right domains', async (t) => {
  await t.test('CTRL-U1 blast radius covers exactly U1\'s points, no others', () => {
    const expected = unitPoints(c, 'U1');
    assert.equal(expected.length, 10);
    const br = Topology.blastRadius(graph, 'CTRL-U1');
    assert.deepEqual(br.points, expected);
  });

  await t.test('CTRL-U2 blast radius covers exactly U2\'s points, no others', () => {
    const expected = unitPoints(c, 'U2');
    assert.equal(expected.length, 7);
    const br = Topology.blastRadius(graph, 'CTRL-U2');
    assert.deepEqual(br.points, expected);
  });

  await t.test('CTRL-U3 blast radius covers exactly U3\'s points, no others', () => {
    const expected = unitPoints(c, 'U3');
    assert.equal(expected.length, 7);
    const br = Topology.blastRadius(graph, 'CTRL-U3');
    assert.deepEqual(br.points, expected);
  });

  await t.test('a single transmitter\'s blast radius covers exactly its own point', () => {
    const br = Topology.blastRadius(graph, 'XMTR-FIC102');
    assert.deepEqual(br.points, ['FIC102']);
  });

  await t.test('SVC-SERVER reaches STN-FLEX and APP-ASSIST but NOT STN-CONSOLE (the console-vs-flex distinction)', () => {
    const br = Topology.blastRadius(graph, 'SVC-SERVER');
    assert.deepEqual(br.nodes, ['APP-ASSIST', 'STN-FLEX']);
    assert.ok(!br.nodes.includes('STN-CONSOLE'), 'SVC-SERVER must not reach the console profile');
    assert.deepEqual(br.points, [], 'a server fault must not directly claim any process point');
  });

  await t.test('SVC-HISTORY reaches the historian and BOTH station profiles, and no points', () => {
    // Updated at SA integration: the lead added the HIST-STORE -> STN-FLEX read-back this
    // suite originally reported as missing. A historian gap shows on a trend whichever
    // profile you are viewing, which is why drill A10 must be diagnosed from the gap
    // itself rather than from which station you happen to be sitting at.
    const br = Topology.blastRadius(graph, 'SVC-HISTORY');
    assert.deepEqual(br.nodes, ['HIST-STORE', 'STN-CONSOLE', 'STN-FLEX']);
    assert.deepEqual(br.points, [],
      'a history fault must affect NO live points -- live control is never in doubt');
  });

  await t.test('every valve and motor command point\'s blast radius includes only its own unit\'s points', () => {
    // Generalizes the teaching points above across all 24 points, deriving expectation
    // from c.unitOf() rather than hard-coding unit membership.
    for (const tag of Object.keys(c.L)) {
      const u = c.unitOf(tag) || 'U1';
      const fieldId = (c.L[tag].kind === 'motor' ? 'DRV-' : 'XMTR-') + tag;
      const br = Topology.blastRadius(graph, fieldId);
      assert.deepEqual(br.points, [tag], `${fieldId}: expected exactly its own point`);
      assert.ok(unitPoints(c, u).includes(tag));
    }
  });
});

// =================================================================================== 4. PURITY

test('purity: build() is a pure function over its inputs', async (t) => {
  await t.test('build() does not mutate c.L or c.V', () => {
    const lBefore = deepClone(c.L);
    const vBefore = deepClone(c.V);
    buildGraph(c);
    assert.deepEqual(c.L, lBefore);
    assert.deepEqual(c.V, vBefore);
  });

  await t.test('two builds from the same inputs are deep-equal', () => {
    const g1 = buildGraph(c);
    const g2 = buildGraph(c);
    assert.deepEqual(g1, g2);
  });

  await t.test('the graph carries no live values, health, or fault state', () => {
    for (const n of Object.values(graph.nodes)) {
      assert.ok(!('health' in n), `${n.id}: node must not carry health`);
      assert.ok(!('pv' in n), `${n.id}: node must not carry a live value`);
      assert.ok(!('active' in n), `${n.id}: node must not carry fault/active state`);
      assert.ok(!('fault' in n), `${n.id}: node must not carry fault state`);
    }
    for (const e of graph.edges) {
      assert.ok(!('health' in e), `edge ${e.id}: must not carry health`);
      assert.ok(!('enabled' in e) || e.enabled === undefined, `edge ${e.id}: must not carry live enabled state`);
    }
  });

  await t.test('bonus, since validate() does not check it: every edge id is unique', () => {
    const ids = graph.edges.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  await t.test('bonus, since validate() does not check it: no edge runs from a node to itself', () => {
    assert.equal(graph.edges.filter((e) => e.from === e.to).length, 0);
  });

  await t.test('FINDING: LAYERS/KINDS/VALVE_OF are documented as "frozen arrays" but are not actually frozen', () => {
    // The module header (topology.js:22) reads "the vocabularies (frozen arrays)", but
    // build() never calls Object.freeze. This is evidence only -- the arrays are NOT
    // mutated here (a mutation would poison every later test in this process, and any
    // other test file that requires the same module in the same run).
    assert.equal(Object.isFrozen(Topology.LAYERS), false);
    assert.equal(Object.isFrozen(Topology.KINDS), false);
    assert.equal(Object.isFrozen(Topology.VALVE_OF), false);
  });
});

// ============================================================================= 5. NO CYCLES

test('no cycles: blastRadius terminates and never includes its own start node', () => {
  const allIds = Object.keys(graph.nodes);
  assert.equal(allIds.length, 144);
  for (const nid of allIds) {
    const br = Topology.blastRadius(graph, nid);
    assert.ok(!br.nodes.includes(nid), `blastRadius(${nid}) must not include its own start node`);
    // Termination: a cyclic graph would grow `order` past the node count as the BFS
    // loop kept re-queuing an already-seen id under a false miss, or (worse) never
    // return at all. Bounding the result size is a real check precisely because the
    // `seen` map plus `queue.shift()` visited-once approach is what prevents that --
    // if a future edit to topology.js removed the `seen` guard, this is what would catch it.
    assert.ok(br.nodes.length <= allIds.length - 1, `blastRadius(${nid}) returned more nodes than exist`);
    assert.equal(new Set(br.nodes).size, br.nodes.length, `blastRadius(${nid}) must not repeat a node`);
  }
});
