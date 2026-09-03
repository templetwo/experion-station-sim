// @artifact dev
// Tests for src/signal-path.js against the lead's src/topology.js graph.
//
// TRAP avoided: after tools/logic-harness.js's load(), there is no ESS.Topology global
// (only the nine v2 modules are evaluated from the app head) -- both modules are
// require()'d directly here.
const test = require('node:test');
const assert = require('node:assert/strict');

const Topology = require('../src/topology.js');
const SignalPath = require('../src/signal-path.js');
const { newSim, canon, digest } = require('./_fixture');

// One graph, built once, reused read-only across every test in this file -- exactly the
// use pattern signal-path.js promises to support (pure, never mutated by resolve()).
function buildGraph() {
  const c = newSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}
const graph = buildGraph();

// The point set signal-path resolves against, read from the graph itself (not hard-coded),
// so this test file tracks the lead's topology rather than a copy of its tag list.
const TAGS = Object.keys(graph.pointPaths).sort();

const EXPECTED_COMMAND_TAGS = [
  'FIC102', 'FIC211', 'FIC310', 'FIC313', 'LIC401', 'LIC503', 'LIC504', 'M202', 'P101',
  'PIC401', 'PIC505', 'TIC202', 'TIC213', 'TIC301', 'TIC311', 'TIC502'
];

test('the graph has the 30 configured points this suite assumes (24 v2 + 6 Unit 04)', () => {
  assert.equal(TAGS.length, 30);
});

test('applicability sweep: every point resolves a valid path for every applicable type, totalling 106', () => {
  let total = 0;
  const perType = { measurement: 0, command: 0, alarm: 0, history: 0 };
  const commandTags = [];

  for (const tag of TAGS) {
    const types = SignalPath.applicablePaths(graph, tag);
    assert.ok(types.length > 0, `${tag}: resolved zero applicable path types`);
    // measurement is universal; command is the only type that may legitimately be absent
    assert.ok(types.includes('measurement'), `${tag}: missing measurement`);
    assert.ok(types.includes('alarm'), `${tag}: missing alarm`);
    assert.ok(types.includes('history'), `${tag}: missing history`);

    for (const path of types) {
      total++;
      perType[path]++;
      if (path === 'command') commandTags.push(tag);

      const resolved = SignalPath.resolve(graph, tag, { path, profile: 'console' });
      assert.deepEqual(resolved.missing, [], `${tag}/${path}: unexpected missing entries ${JSON.stringify(resolved.missing)}`);
      assert.ok(resolved.nodes.length > 0, `${tag}/${path}: resolved zero nodes`);
      for (const nid of resolved.nodes) {
        assert.ok(graph.nodes[nid], `${tag}/${path}: node ${nid} does not exist in the graph`);
      }
      // legs must account for exactly the same nodes as the flat list, in the same order
      const fromLegs = resolved.legs.reduce((acc, leg) => acc.concat(leg.nodes), []);
      assert.deepEqual(fromLegs, resolved.nodes, `${tag}/${path}: legs do not reconstruct nodes`);
    }
  }

  // The stage contract, asserted as an exact count -- never a vacuous loop-and-pass.
  assert.equal(total, 106);
  assert.deepEqual(perType, { measurement: 30, alarm: 30, history: 30, command: 16 });
  assert.deepEqual(commandTags.slice().sort(), EXPECTED_COMMAND_TAGS);
});

test('command applicability is exactly the fourteen valve points plus the two motors', () => {
  const commandTags = TAGS.filter((t) => SignalPath.applicablePaths(graph, t).includes('command'));
  assert.deepEqual(commandTags.sort(), EXPECTED_COMMAND_TAGS);
  for (const tag of TAGS) {
    if (EXPECTED_COMMAND_TAGS.includes(tag)) continue;
    assert.ok(!SignalPath.applicablePaths(graph, tag).includes('command'), `${tag}: unexpectedly has a command path`);
  }
});

test('resolve() is pure: the graph digests byte-identical before and after a full sweep', () => {
  const before = digest(graph);
  for (const tag of TAGS) {
    for (const path of SignalPath.applicablePaths(graph, tag)) {
      for (const profile of SignalPath.PROFILES) {
        SignalPath.resolve(graph, tag, { path, profile });
      }
    }
  }
  const after = digest(graph);
  assert.equal(after, before);
});

test('resolve() never hands back a live reference into the graph', () => {
  const before = canon(graph);
  const resolved = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'console' });
  resolved.nodes.push('INJECTED-NODE');
  resolved.nodes[0] = 'CLOBBERED';
  resolved.legs.push({ label: 'fake', nodes: ['x'] });
  resolved.legs[0].nodes.push('INJECTED-LEG-NODE');
  resolved.missing.push('fake-missing');
  assert.equal(canon(graph), before, 'mutating the result mutated the graph');
  // and a second, independent resolve is unaffected by the first result's mutation
  const again = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'console' });
  assert.equal(again.nodes[0], 'XMTR-FIC102');
  assert.equal(again.nodes.length, resolved.nodes.length - 1); // resolved grew by one INJECTED-NODE push above
});

test('drill A8: console and flex reach the station through different, mutually exclusive nodes', () => {
  const console_ = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'console' });
  const flex = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'flex' });

  assert.ok(console_.nodes.includes('STN-CONSOLE'));
  assert.ok(!console_.nodes.includes('SVC-SERVER'));
  assert.ok(!console_.nodes.includes('STN-FLEX'));

  assert.ok(flex.nodes.includes('SVC-SERVER'));
  assert.ok(flex.nodes.includes('STN-FLEX'));
  assert.ok(!flex.nodes.includes('STN-CONSOLE'));

  // same trunk up to (not including) the station leg -- profile changes only the tail
  const trunkLen = graph.pointPaths.FIC102.measurement.length;
  assert.deepEqual(console_.nodes.slice(0, trunkLen), flex.nodes.slice(0, trunkLen));
  assert.notDeepEqual(console_.nodes.slice(trunkLen), flex.nodes.slice(trunkLen));

  // advanced rendering: the last leg is the profile branch, named for its profile
  assert.equal(console_.legs[console_.legs.length - 1].label, 'Station (CONSOLE profile)');
  assert.equal(flex.legs[flex.legs.length - 1].label, 'Station (FLEX profile)');
});

test('alarm annunciation reaches both profiles directly -- no server hop, unlike measurement', () => {
  const flexAlarm = SignalPath.resolve(graph, 'FIC102', { path: 'alarm', profile: 'flex' });
  assert.ok(flexAlarm.nodes.includes('STN-FLEX'));
  assert.ok(!flexAlarm.nodes.includes('SVC-SERVER'), 'alarm must not route through the data server cache');
});

test('command has no profile-dependent station leg: console and flex resolve identically', () => {
  const console_ = SignalPath.resolve(graph, 'FIC102', { path: 'command', profile: 'console' });
  const flex = SignalPath.resolve(graph, 'FIC102', { path: 'command', profile: 'flex' });
  assert.deepEqual(console_.nodes, flex.nodes);
  assert.deepEqual(console_.nodes, graph.pointPaths.FIC102.command);
});

test('measurement legs group by layer: Field, I/O, Control, Network, then the Station branch', () => {
  const resolved = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'console' });
  const labels = resolved.legs.map((l) => l.label);
  assert.deepEqual(labels, ['Field', 'I/O', 'Control', 'Network', 'Station (CONSOLE profile)']);
  // Control leg absorbs CTRL-U1, CEE-U1 and the CM together (all layer CONTROL)
  const controlLeg = resolved.legs[2];
  assert.deepEqual(controlLeg.nodes, ['CTRL-U1', 'CEE-U1', 'CM-CM2_FIC102']);
});

test('history resolves and is edge-backed for BOTH station profiles', () => {
  // This test was originally written to document a gap -- topology.js drew exactly one
  // HISTORY read-back edge, HIST-STORE -> STN-CONSOLE, and none to STN-FLEX -- and its
  // author left the note "it should start failing the day the lead adds the edge".
  // The lead added it at SA integration, so this now pins the corrected graph: a historian
  // gap shows on a trend whichever profile you are viewing, which is why drill A10 must be
  // diagnosed from the gap itself rather than from where you happen to be sitting.
  for (const profile of ['console', 'flex']) {
    const resolved = SignalPath.resolve(graph, 'FIC102', { path: 'history', profile });
    assert.deepEqual(resolved.missing, [], `${profile}: history path had unresolved nodes`);
    const station = profile === 'flex' ? 'STN-FLEX' : 'STN-CONSOLE';
    assert.ok(resolved.nodes.includes(station), `${profile}: history must reach ${station}`);
    assert.ok(graph.edges.some((e) => e.from === 'HIST-STORE' && e.to === station),
      `${profile}: the resolved history path must be backed by a real read-back edge`);
  }
});

test('the four alarm-declared-but-unconfigured points still resolve an alarm path by node existence', () => {
  // Measured asymmetry: AI205, FI100, M202, P101 have empty alm maps and so no ALARM edge,
  // yet graph.pointPaths declares an alarm path for all 24 points. Node existence is the
  // module's contract, so this must resolve without complaint.
  for (const tag of ['AI205', 'FI100', 'M202', 'P101']) {
    const resolved = SignalPath.resolve(graph, tag, { path: 'alarm', profile: 'console' });
    assert.deepEqual(resolved.missing, []);
    assert.ok(resolved.nodes.length > 0, `${tag}: alarm path resolved no nodes`);
    assert.ok(resolved.nodes.includes('SVC-ALARM'));
  }
});

test('inapplicable and unknown requests degrade gracefully instead of throwing', () => {
  const noCommand = SignalPath.resolve(graph, 'AI205', { path: 'command', profile: 'console' });
  assert.deepEqual(noCommand.nodes, []);
  assert.deepEqual(noCommand.legs, []);
  assert.ok(noCommand.missing.length > 0);
  assert.ok(!SignalPath.applicablePaths(graph, 'AI205').includes('command'));

  const unknownTag = SignalPath.resolve(graph, 'NOT-A-TAG', { path: 'measurement', profile: 'console' });
  assert.deepEqual(unknownTag.nodes, []);
  assert.ok(unknownTag.missing.length > 0);
  assert.deepEqual(SignalPath.applicablePaths(graph, 'NOT-A-TAG'), []);

  const unknownPath = SignalPath.resolve(graph, 'FIC102', { path: 'teleport', profile: 'console' });
  assert.deepEqual(unknownPath.nodes, []);
  assert.ok(unknownPath.missing.length > 0);

  const unknownProfile = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'vendor-cloud' });
  assert.deepEqual(unknownProfile.nodes, []);
  assert.ok(unknownProfile.missing.length > 0);
});

test('describe() renders project-authored prose naming the profile difference', () => {
  const console_ = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'console' });
  const flex = SignalPath.resolve(graph, 'FIC102', { path: 'measurement', profile: 'flex' });
  const consoleText = SignalPath.describe(graph, console_);
  const flexText = SignalPath.describe(graph, flex);

  assert.ok(consoleText.includes('FIC102'));
  assert.ok(consoleText.toLowerCase().includes('console'));
  assert.ok(flexText.toLowerCase().includes('flex'));
  assert.notEqual(consoleText, flexText);

  const na = SignalPath.describe(graph, SignalPath.resolve(graph, 'AI205', { path: 'command', profile: 'console' }));
  assert.ok(na.toLowerCase().includes('not available'));
});

test('beginner rendering (flat nodes) and advanced rendering (legs) always agree on the node set', () => {
  for (const tag of TAGS) {
    for (const path of SignalPath.applicablePaths(graph, tag)) {
      const resolved = SignalPath.resolve(graph, tag, { path, profile: 'flex' });
      const fromLegs = resolved.legs.reduce((acc, leg) => acc.concat(leg.nodes), []);
      assert.deepEqual(fromLegs, resolved.nodes, `${tag}/${path}: beginner/advanced views disagree on node set`);
    }
  }
});
