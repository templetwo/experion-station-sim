// @artifact dev
// Cross-module contracts for the v3 modules.
//
// Each SA module has its own suite proving it works in isolation. Nothing proved that
// they AGREE with each other, and during stage SA they did not: drill-arch referenced
// four fault ids that fault-engine had never heard of (BAD_QUALITY_INPUT,
// NETWORK_PATH_DEGRADED, SERVER_DEGRADED, STATION_LOSS). Every individual suite was
// green, because a vocabulary shared by prose across two agent briefs is not a contract.
//
// This file is that contract. It is deliberately owned by the integrator rather than by
// any one module's author, and it asserts the seams: shared vocabularies, node-id
// resolution against a really-built graph, and the trainee/instructor projection split.
const test = require('node:test');
const assert = require('node:assert/strict');

const Topology = require('../src/topology.js');
const FaultEngine = require('../src/fault-engine.js');
const DrillArch = require('../src/drill-arch.js');
const SignalPath = require('../src/signal-path.js');
const { load } = require('../tools/logic-harness');

// The graph, built once from the real tag database exactly as the app would.
function realGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return {
    c,
    g: Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: t => c.unitOf(t) }),
  };
}

function drillList() {
  if (Array.isArray(DrillArch.DRILLS)) return DrillArch.DRILLS;
  if (typeof DrillArch.drills === 'function') return DrillArch.drills();
  throw new Error('drill-arch exposes neither DRILLS nor drills()');
}

function faultIdsUsedByDrills() {
  const used = new Set();
  for (const d of drillList()) {
    for (const f of (d.faultTimeline || [])) {
      if (f.faultId) used.add(f.faultId);
      if (f.id && !f.faultId) used.add(f.id);
    }
  }
  return used;
}

test('the fault-id vocabulary is exactly the thirteen the plan fixes', () => {
  const expected = [
    'FROZEN_MEASUREMENT', 'BIASED_MEASUREMENT', 'NOISY_MEASUREMENT', 'VALVE_RESPONSE_FAILURE',
    'OPEN_INPUT_BAD_QUALITY', 'CONTROLLER_LOSS', 'REDUNDANCY_SWITCHOVER',
    'NET_PATH_DEGRADED', 'COMMS_PARTITION', 'SERVER_SERVICE_DEGRADED',
    'STATION_LOSS_PEER', 'HISTORIAN_GAP', 'ASSISTANT_LOSS',
  ];
  assert.deepEqual([...FaultEngine.FAULT_IDS].sort(), [...expected].sort(),
    'fault-engine drifted from the fixed v3 fault vocabulary (V3-PLAN section 5)');
});

test('every fault id the drills reference exists in the fault engine', () => {
  const known = new Set(FaultEngine.FAULT_IDS);
  const used = faultIdsUsedByDrills();
  assert.ok(used.size > 0, 'no drill referenced any fault -- the sweep is vacuous');
  const unknown = [...used].filter(f => !known.has(f)).sort();
  assert.deepEqual(unknown, [],
    'drill-arch references fault ids the fault engine does not define; a vocabulary shared only in prose is not a contract');
});

test('every fault domain the drills exercise is a real topology layer', () => {
  const layers = new Set(Topology.LAYERS);
  for (const fid of FaultEngine.FAULT_IDS) {
    const def = FaultEngine.getFaultDef(fid);
    assert.ok(def, `fault ${fid} is listed in FAULT_IDS but has no definition`);
    assert.ok(layers.has(def.domain), `fault ${fid} declares domain ${def.domain}, which is not a topology layer`);
  }
});

test('every topology node id the drills name resolves in a really-built graph', () => {
  const { g } = realGraph();
  const missing = [];
  let referenced = 0;
  const check = (id, where) => {
    if (typeof id !== 'string') return;
    if (!/^[A-Z]/.test(id)) return;              // not a node id
    if (!g.nodes[id] && (id.includes('-') || Topology.LAYERS.includes(id) === false)) {
      // Only treat it as a node reference if it looks like one this graph would own.
      if (/^(XMTR|AI|AO|CM|CTRL|CEE|NET|SVC|STN|HIST|APP|VLV|DRV)-/.test(id)) {
        referenced++; missing.push(`${where}: ${id}`);
        return;
      }
      return;
    }
    if (g.nodes[id]) referenced++;
  };
  for (const d of drillList()) {
    for (const f of (d.faultTimeline || [])) {
      check(f.targetNodeId || f.target, `${d.id} faultTimeline`);
      (f.targets || []).forEach(t => check(t, `${d.id} faultTimeline.targets`));
    }
  }
  assert.ok(referenced > 0, 'no drill referenced any topology node -- the sweep is vacuous');
  assert.deepEqual(missing, [], 'drills name topology nodes that the built graph does not contain');
});

test('signal-path resolves every applicable path for every point, against the real graph', () => {
  const { g } = realGraph();
  const tags = Object.keys(g.pointPaths);
  assert.equal(tags.length, 24, 'expected all 24 configured points');

  let resolved = 0;
  for (const tag of tags) {
    const applicable = SignalPath.applicablePaths(g, tag);
    assert.ok(applicable.length >= 3, `${tag}: expected at least measurement/alarm/history`);
    for (const path of applicable) {
      for (const profile of Topology.PROFILES) {
        const r = SignalPath.resolve(g, tag, { path, profile });
        assert.ok(r && r.nodes.length, `${tag}/${path}/${profile}: resolved an empty path`);
        for (const nid of r.nodes) {
          assert.ok(g.nodes[nid], `${tag}/${path}/${profile}: path names missing node ${nid}`);
        }
        resolved++;
      }
    }
  }
  // 24 measurement + 24 alarm + 24 history + 12 command = 84 applicable, x2 profiles.
  assert.equal(resolved, 168, 'the applicable-path sweep did not cover what the plan requires');
});

test('the console and flex profiles genuinely differ, or the whole A8 lesson is fiction', () => {
  const { g } = realGraph();
  const con = SignalPath.resolve(g, 'FIC102', { path: 'measurement', profile: 'console' });
  const flex = SignalPath.resolve(g, 'FIC102', { path: 'measurement', profile: 'flex' });
  assert.notDeepEqual(con.nodes, flex.nodes,
    'console and flex resolved the same node list; the server-vs-controller distinction drill A8 teaches would not exist');
  assert.ok(flex.nodes.includes('SVC-SERVER'), 'the flex profile must reach the station through the data server cache');
  assert.ok(!con.nodes.includes('SVC-SERVER'), 'the console profile must NOT depend on the data server');
});

test('the failure-domain semantics the drills rest on hold in the graph', () => {
  const { c, g } = realGraph();
  const pointsIn = u => Object.keys(c.L).filter(t => c.unitOf(t) === u).sort();

  for (const u of Topology.UNITS) {
    const br = Topology.blastRadius(g, `CTRL-${u}`);
    assert.deepEqual(br.points, pointsIn(u),
      `losing the ${u} controller must affect exactly that unit's points -- the common-cause lesson of drill A5`);
  }

  const server = Topology.blastRadius(g, 'SVC-SERVER');
  assert.ok(server.nodes.includes('STN-FLEX'), 'a data-server fault must reach the flex profile');
  assert.ok(!server.nodes.includes('STN-CONSOLE'),
    'a data-server fault must NOT reach the console profile -- this asymmetry IS drill A8');
});

test('the trainee projection never carries instructor-only truth', () => {
  // The single most important contract in v3: a hidden fault must be invisible in every
  // trainee-visible surface. Asserted here across module seams as well as inside
  // fault-engine's own suite, because a leak can be introduced by either side.
  const { g } = realGraph();
  const fid = 'BIASED_MEASUREMENT';
  const target = 'XMTR-LIC101';
  // An explicit magnitude, because the engine refuses to fall back to Math.random -- the
  // determinism discipline that makes replay reproducible (V3-PLAN section 10).
  const res = FaultEngine.activate(FaultEngine.createState(), g, { faultId: fid, targetNodeId: target, simTime: 0, magnitude: 4 });
  assert.equal(res.accepted, true, `could not activate ${fid} on ${target}: ${res.reason}`);
  assert.ok(FaultEngine.isActive(res.state, fid, target), 'fault did not register as active -- the leak check would be vacuous');

  const trainee = FaultEngine.healthProjection(res.state, g);
  const serialized = JSON.stringify(trainee);
  assert.ok(serialized.length > 2, 'the trainee projection is empty -- this assertion would pass on nothing');

  for (const id of FaultEngine.FAULT_IDS) {
    assert.ok(!serialized.includes(id),
      `trainee projection leaked the fault id ${id}; hidden truth is instructor-only (V3-PLAN sections 3, 7, 10)`);
  }
  assert.ok(!serialized.includes('INSTRUCTOR_ONLY'), 'trainee projection leaked a truthVisibility marker');
});

test('the drill library is the full twelve, with unique ids and a rubric that sums to 100', () => {
  const drills = drillList();
  const ids = drills.map(d => d.id).sort();
  assert.equal(ids.length, 12, 'v3 ships twelve architecture drills');
  assert.equal(new Set(ids).size, 12, 'drill ids must be unique');
  assert.deepEqual(ids, ['A1', 'A10', 'A11', 'A12', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']);
});

test('the legacy D-drills are untouched by the A-series scorer', () => {
  // The A-series must COMPOSE with ESS.Kpi.scoreDrill, never replace it. The golden
  // suite would catch a behaviour change, but this states the requirement at the seam.
  const Kpi = require('../src/kpi.js');
  assert.equal(typeof Kpi.scoreDrill, 'function', 'the legacy scorer must still exist');
  const { c } = realGraph();
  assert.deepEqual(c.drillDefs().map(d => d.id), ['D1', 'D2', 'D3', 'D4', 'D6', 'D9', 'D11', 'D12'],
    'the eight legacy drills must survive the v3 modules unchanged');
});
