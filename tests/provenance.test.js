// @artifact dev
// Release gate 5 (V3-PLAN section 11): "every vendor-specific concept traces to a
// registered public source; the automated provenance test passes".
//
// This IS that automated test. It does NOT edit any src/ module. Where a gate-5
// blocker is found it is proven here with evidence and reported, never silently
// normalised away -- a provenance test that quietly accepts both spellings of an
// id, or accepts an internal spec section as a "public source", is a false green
// on a release gate, which is worse than no test at all.
//
// Built by MacBook seat 2/3 (claude-opus-5[1m]) in the 3-seat mesh of 2026-08-30.
// New file only: touches no app page, no src module, no golden fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const DrillArch = require('../src/drill-arch.js');

const RESOURCES_PATH = path.join(__dirname, '..', 'docs', 'RESOURCES.md');

// ---------------------------------------------------------------- the registry

/** Section ids declared by docs/RESOURCES.md headings: "## 4" -> "4", "### 2.19" -> "2.19". */
function registrySections() {
  const md = fs.readFileSync(RESOURCES_PATH, 'utf8');
  const ids = new Set();
  for (const line of md.split('\n')) {
    const m = /^#{2,3}\s+(\d+(?:\.\d+)?)[.\s]/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** The CANONICAL sourceBasis id form. src/topology.js uses exactly this. */
const CANONICAL = /^RESOURCES-(\d+(?:\.\d+)?)$/;

const SECTIONS = registrySections();

function topologyGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}

const graph = topologyGraph();

// ============================================================ 0. the test's own teeth

test('provenance: the registry parse is not vacuous', async (t) => {
  await t.test('docs/RESOURCES.md parses to a non-trivial set of sections', () => {
    assert.ok(SECTIONS.size >= 20, `parsed only ${SECTIONS.size} sections from RESOURCES.md`);
  });

  await t.test('every section id topology.js actually cites is present', () => {
    for (const id of ['4', '2.19', '2.16', '2.13', '2.1', '2.3', '2.5', '2.2', '2.15', '2.14']) {
      assert.ok(SECTIONS.has(id), `RESOURCES.md has no section ${id}`);
    }
  });

  await t.test('POSITIVE CONTROL: a fabricated section id does NOT resolve', () => {
    // If this ever passes, every negative result in this file is meaningless.
    assert.equal(SECTIONS.has('99.99'), false);
    assert.equal(CANONICAL.test('RESOURCES-99.99') && SECTIONS.has('99.99'), false);
  });
});

// ============================================================ 1. topology provenance (gate 5)

test('provenance: every topology node traces to a registered public source', async (t) => {
  const nodes = Object.keys(graph.nodes).sort();

  await t.test('the graph is not empty (guards a vacuous sweep)', () => {
    assert.ok(nodes.length > 50, `graph has only ${nodes.length} nodes`);
  });

  await t.test('every node carries a non-empty sourceBasis', () => {
    const bare = nodes.filter((id) => {
      const b = graph.nodes[id].sourceBasis;
      return !Array.isArray(b) || b.length === 0;
    });
    assert.deepEqual(bare, [], `nodes with no sourceBasis: ${bare.join(', ')}`);
  });

  await t.test('every sourceBasis id is in the CANONICAL RESOURCES-<n> form', () => {
    const bad = [];
    for (const id of nodes) {
      for (const b of graph.nodes[id].sourceBasis) {
        if (!CANONICAL.test(b)) bad.push(`${id} -> ${JSON.stringify(b)}`);
      }
    }
    assert.deepEqual(bad, [], `non-canonical sourceBasis ids:\n${bad.join('\n')}`);
  });

  await t.test('every sourceBasis id resolves to a real section of docs/RESOURCES.md', () => {
    const dangling = [];
    for (const id of nodes) {
      for (const b of graph.nodes[id].sourceBasis) {
        const m = CANONICAL.exec(b);
        if (!m || !SECTIONS.has(m[1])) dangling.push(`${id} -> ${b}`);
      }
    }
    assert.deepEqual(dangling, [], `sourceBasis ids pointing at nothing:\n${dangling.join('\n')}`);
  });
});

// ============================================================ 2. drill provenance (gate 5)

test('GATE 5: every drill traces to a registered public source', async (t) => {
  const ids = DrillArch.drillIds();

  await t.test('all twelve A-drills are present', () => {
    assert.equal(ids.length, 12, `expected 12 A-drills, found ${ids.length}`);
  });

  await t.test('every drill carries a non-empty sourceBasis', () => {
    const bare = ids.filter((id) => {
      const b = DrillArch.drillById(id).sourceBasis;
      return !Array.isArray(b) || b.length === 0;
    });
    assert.deepEqual(bare, []);
  });

  // ---- GATE 5 BLOCKER 1: two modules, two spellings of the same registry id.
  await t.test('GATE 5 BLOCKER: drill sourceBasis ids use the CANONICAL RESOURCES-<n> form', () => {
    const bad = [];
    for (const id of ids) {
      for (const b of DrillArch.drillById(id).sourceBasis) {
        if (!CANONICAL.test(b)) bad.push(`${id} -> ${JSON.stringify(b)}`);
      }
    }
    assert.deepEqual(bad, [],
      'src/topology.js writes "RESOURCES-2.14" (hyphen); src/drill-arch.js writes ' +
      '"RESOURCES 2.14" (space) and "V3-PLAN section 5". Two modules, one registry, two ' +
      'vocabularies -- the same prose-agrees/code-diverges shape the SA integrator already ' +
      'caught once on fault ids. An automated gate cannot resolve both without becoming a ' +
      'rubber stamp.\n' + bad.join('\n'));
  });

  // ---- GATE 5 BLOCKER 2: an internal spec section is not a public source.
  await t.test('GATE 5 BLOCKER: every drill cites at least one PUBLIC source, not only V3-PLAN', () => {
    const specOnly = [];
    for (const id of ids) {
      const basis = DrillArch.drillById(id).sourceBasis;
      const publicRefs = basis.filter((b) => /RESOURCES/.test(b));
      if (publicRefs.length === 0) specOnly.push(`${id} -> ${JSON.stringify(basis)}`);
    }
    assert.deepEqual(specOnly, [],
      'Gate 5 requires a REGISTERED PUBLIC source. docs/dev/V3-PLAN.md is this repo\'s own ' +
      'internal spec, not a public source, so "V3-PLAN section 5" cannot discharge it.\n' +
      specOnly.join('\n'));
  });

  // ---- GATE 5 BLOCKER 3: identical provenance for twelve different concepts.
  await t.test('GATE 5 BLOCKER: drills do not all share one identical sourceBasis', () => {
    const seen = new Map();
    for (const id of ids) {
      const key = JSON.stringify(DrillArch.drillById(id).sourceBasis);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(id);
    }
    const collisions = [...seen.entries()].filter(([, group]) => group.length > 1);
    assert.deepEqual(collisions.map(([k, g]) => `${g.join(',')} all cite ${k}`), [],
      'src/drill-arch.js line ~206 defaults sourceBasis and NO drill overrides it, so a ' +
      'FIELD drill (A1, frozen transmitter) and an INFORMATION drill (A10, historian gap) ' +
      'claim byte-identical provenance. Gate 5 says "every vendor-specific CONCEPT traces to ' +
      'a registered public source"; twelve distinct concepts sharing one citation does not ' +
      'trace anything.');
  });
});
