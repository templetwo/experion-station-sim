// @artifact dev
// P2L-EXPANSION-SPEC section 8, Stage 1: the valve-target table in src/models.js.
//
// moveValves() used to build a closed literal of the ten shipped valves and then loop over
// EVERY key in V. A valve added to this.V with no target integrated `undefined` into NaN,
// clamp() does not guard NaN, and makeSnapshot then refused every snapshot, backtrack and
// replay (a probe measured that single omission at 98 failing tests). Every new unit adds
// valves, so the table is now data with an exported key list, an unknown valve holds its
// position, and the three places a valve is declared are pinned equal here.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models.js');
const Topology = require('../src/topology.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();

function boot() { const c = new Component({}); c.initSim(1700000000000); return c; }
const sorted = (xs) => xs.slice().sort();

test('MODEL_VALVES is the single list of valves the process equations know', async (t) => {
  await t.test('it is exported, frozen and non-trivial', () => {
    assert.ok(Array.isArray(Models.MODEL_VALVES));
    assert.ok(Object.isFrozen(Models.MODEL_VALVES));
    assert.equal(Models.MODEL_VALVES.length, 14);
  });

  await t.test('the app\'s this.V declares exactly those valves', () => {
    assert.deepEqual(sorted(Object.keys(boot().V)), sorted(Models.MODEL_VALVES),
      'a valve added to initSim\'s this.V needs a VALVE_TARGET entry in src/models.js, and vice versa');
  });

  await t.test('Topology.VALVE_OF strokes exactly those valves', () => {
    assert.deepEqual(sorted(Object.values(Topology.VALVE_OF)), sorted(Models.MODEL_VALVES),
      'src/topology.js VALVE_OF and src/models.js VALVE_TARGET must name the same valves');
  });
});

test('a valve the model does not know holds its position instead of becoming NaN', async (t) => {
  await t.test('holds, stays finite, and the snapshot path still works', () => {
    const c = boot();
    c.V.XV999 = { pos: 0.3, stuck: false, fail: 0 };
    for (let i = 0; i < 240; i++) c.step(0.5);
    assert.equal(c.V.XV999.pos, 0.3, 'an unknown valve must hold exactly where it was');
    for (const k of Models.MODEL_VALVES) assert.ok(Number.isFinite(c.V[k].pos), k + ' went non-finite');
    assert.ok(c.snapshotData('with a foreign valve'), 'makeSnapshot must not refuse the state');
  });

  await t.test('on instrument-air loss it still goes to its declared fail position', () => {
    // The original semantics for a known valve under F.air are v.fail regardless of the loop
    // output; an unknown valve gets the same treatment rather than a special case.
    const c = boot();
    c.V.XV999 = { pos: 0.3, stuck: false, fail: 1 };
    c.injectFault('air', true);
    for (let i = 0; i < 120; i++) c.step(0.5);
    assert.ok(c.V.XV999.pos > 0.99, 'expected the fail-open position, got ' + c.V.XV999.pos);
  });
});

// ---------------------------------------------------------------------------
// W2 contract section 0.4 (docs/dev/W2-CAUSE-EFFECT-CONTRACT.md): VALVE_TARGET
// (src/models.js:323-337) and the app's valveMap()/valveTarget() (dc.html:2792-2793)
// produce identical results for all fourteen valves today, but nothing pinned that
// correspondence -- unlike MODEL_VALVES above, which is pinned against this.V and
// Topology.VALVE_OF. VALVE_TARGET itself is not exported (only its key list,
// MODEL_VALVES, is), so the closures it reads are pinned the same way the rest of
// this file pins app behaviour: through tools/logic-harness.js, by driving the real
// app and its real ESS.Models path and comparing outputs -- never by comparing source
// text. A single call to c.step(3) is used throughout: moveValves advances each valve
// by (target - pos) * dt / 3, so dt=3 collapses that lag to the target exactly in one
// tick (src/models.js:346), which is a much sharper probe than iterating many ticks
// toward an approximate convergence.

test("valveMap()'s valve ids are exactly VALVE_TARGET's key set (MODEL_VALVES), both directions", () => {
  const map = boot().valveMap();
  const ids = Object.values(map);
  assert.equal(ids.length, 14, 'valveMap() must declare exactly 14 valves');
  assert.equal(new Set(ids).size, 14, 'valveMap() must not repeat a valve id');
  assert.deepEqual(sorted(ids), sorted(Models.MODEL_VALVES),
    "valveMap()'s valve ids and VALVE_TARGET's key set (MODEL_VALVES) must be the exact same set, in both directions");
});

test("valveMap()'s loop tags are exactly the tags VALVE_TARGET's closures read, pinned by driving each loop to a distinct OP and observing which valve moves there", () => {
  const c = boot();
  const map = c.valveMap();
  const tags = Object.keys(map);
  assert.equal(tags.length, 14, 'valveMap() must declare exactly 14 loop tags');
  assert.equal(new Set(tags).size, 14, 'valveMap() must not repeat a loop tag');

  // Fourteen distinct, non-colliding, mild OP values -- one per loop, held fixed in MAN
  // so no PID recomputes it (src/pid.js stepPid: 'MAN ... no control action').
  const assigned = {};
  tags.forEach((tag, i) => { assigned[tag] = 15 + i * 4; });
  for (const tag of tags) { c.L[tag].mode = 'MAN'; c.L[tag].op = assigned[tag]; }

  c.step(3);

  for (const [tag, id] of Object.entries(map)) {
    const expected = assigned[tag] / 100;
    assert.ok(Math.abs(c.V[id].pos - expected) < 1e-9,
      `${id} must be driven by ${tag}'s OP (expected ${expected}, got ${c.V[id].pos})`);
    // Pin the correspondence itself, not just that SOME 14-to-14 mapping holds: no
    // OTHER tag's assigned value explains this valve's position.
    for (const otherTag of tags) {
      if (otherTag === tag) continue;
      const otherExpected = assigned[otherTag] / 100;
      assert.ok(Math.abs(c.V[id].pos - otherExpected) > 1e-3,
        `${id} must not also match ${otherTag}'s OP -- the (tag,id) correspondence would be ambiguous`);
    }
  }
});

test('trip gating agrees between the real VALVE_TARGET path (ESS.Models, via c.step) and the app\'s valveTarget(tag,id), driven through both and compared', async (t) => {
  // FV102/rx and MV211+JV213/batch: single-cause gating, each checked set and clear.
  const singleCauseCases = [
    {
      id: 'FV102', tag: 'FIC102', op: 42,
      setTrip: (c) => { c.P.trips.rx = true; c.P.rT = 170; },   // >= resetT(160), < tripT(185): stays latched true across the step
      clearTrip: (c) => { c.P.trips.rx = false; c.P.rT = 150; },
    },
    {
      id: 'MV211', tag: 'FIC211', op: 37,
      setTrip: (c) => { c.P.trips.batch = true; c.P.b.T = 90; },  // >= resetT(70), < tripT(110)
      clearTrip: (c) => { c.P.trips.batch = false; c.P.b.T = 25; },
    },
    {
      id: 'JV213', tag: 'TIC213', op: 61,
      setTrip: (c) => { c.P.trips.batch = true; c.P.b.T = 90; },
      clearTrip: (c) => { c.P.trips.batch = false; c.P.b.T = 25; },
    },
  ];

  for (const { id, tag, op, setTrip, clearTrip } of singleCauseCases) {
    await t.test(`${id} on ${tag}: flag set drives both implementations to 0`, () => {
      const c = boot();
      c.L[tag].mode = 'MAN'; c.L[tag].op = op;
      setTrip(c);
      assert.equal(c.valveTarget(tag, id), 0, "app valveTarget() must read 0 while the trip flag is set");
      c.step(3);
      assert.ok(Math.abs(c.V[id].pos - 0) < 1e-9, `${id} must be driven to 0 by the real VALVE_TARGET path when the trip is set`);
    });

    await t.test(`${id} on ${tag}: flag clear drives both implementations to op/100`, () => {
      const c = boot();
      c.L[tag].mode = 'MAN'; c.L[tag].op = op;
      clearTrip(c);
      assert.equal(c.valveTarget(tag, id), op / 100, "app valveTarget() must read op/100 while the trip flag is clear");
      c.step(3);
      assert.ok(Math.abs(c.V[id].pos - op / 100) < 1e-9, `${id} must be driven to op/100 by the real VALVE_TARGET path when the trip is clear`);
    });
  }

  // FV311/TIC311: two-cause gating (contract section 0.3) -- trips.bed OR trips.skin,
  // both branches, plus the case where neither holds.
  const fv311Cases = [
    {
      name: 'trips.bed set, trips.skin clear',
      apply: (c) => { c.P.trips.bed = true; c.P.h.bed = 440; c.P.trips.skin = false; },
      expected: 0,
    },
    {
      name: 'trips.skin set, trips.bed clear',
      apply: (c) => { c.P.trips.skin = true; c.P.h.ts1 = 420; c.P.h.ts2 = 420; c.P.trips.bed = false; c.P.h.bed = 380; },
      expected: 0,
    },
    {
      name: 'both clear',
      apply: (c) => { c.P.trips.bed = false; c.P.trips.skin = false; c.P.h.bed = 380; c.P.h.ts1 = 318; c.P.h.ts2 = 322; },
      expected: 0.58,
    },
  ];

  for (const { name, apply, expected } of fv311Cases) {
    await t.test(`FV311 on TIC311 (${name})`, () => {
      const c = boot();
      c.L.TIC311.mode = 'MAN'; c.L.TIC311.op = 58;
      apply(c);
      assert.equal(c.valveTarget('TIC311', 'FV311'), expected, `app valveTarget() mismatch for ${name}`);
      c.step(3);
      assert.ok(Math.abs(c.V.FV311.pos - expected) < 1e-9, `FV311 model mismatch for ${name}: expected ${expected}, got ${c.V.FV311.pos}`);
    });
  }
});
