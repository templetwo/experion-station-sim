// @artifact dev
// V3-PLAN S2 exit condition: "parity goldens for the twelve legacy upsets" -- proving the
// strangler seam (decision D1) did not move behaviour. c.setUpset(k, on) is no longer a
// leaf: as of S2 it is a thin wrapper that dispatches a FAULT_INJECT command through
// ESS.Dispatch (Component.registerDispatchHandlers, "Experion Station Simulator.dc.html").
// This file proves the two public entry points into that command --
//   (a) the LEGACY entry point:  c.setUpset(k, on)
//   (b) the NEW v3 entry point:  c.dispatcher.dispatch(ctx, {type:'FAULT_INJECT', ...})
//     -- exactly what an instructor Architecture panel or a future API caller would use,
//     bypassing the setUpset() convenience wrapper entirely --
// produce an IDENTICAL trajectory: same end-state digest, same alarm arrival order, and
// the same PRNG cursor, both immediately after injection and after further stepping.
// tests/golden-upsets.test.js already freezes v2 behaviour on the setUpset() side alone;
// it could not by itself tell you whether a divergent second entry point had appeared.
//
// Does not edit src/models.js, src/instructor.js's public shape, or any of the three
// verification-gate test files.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Instructor = require('../src/instructor.js');
const UpsetBridge = require('../src/upset-bridge.js');
const FaultEngine = require('../src/fault-engine.js');
const Topology = require('../src/topology.js');
const { load } = require('../tools/logic-harness');
const { newSim, run, endState, alarmSequence, digest } = require('./_fixture');

const SEED = 20260829;
const UPSET_KEYS = Instructor.upsetDefs().map((d) => d.k);

// The NEW v3 entry point, constructed exactly the way a caller outside setUpset() would
// have to: a ctx satisfying ESS.Dispatch's one required duck-typed method, and the exact
// FAULT_INJECT command shape Component.registerDispatchHandlers() expects.
function viaDispatch(c, k, on) {
  c.dispatcher.dispatch(
    { journalAdd: (entry) => Instructor.journalAdd(c.instr, entry) },
    { type: 'FAULT_INJECT', actor: 'INSTRUCTOR', target: k, payload: !!on, simTime: c.P.t }
  );
}

function viaSetUpset(c, k, on) { c.setUpset(k, on); }

// The generator's own cursor (mulberry32 state), not merely its next draw -- two sims
// that happen to land on the same next value could still have consumed a different number
// of draws to get there; comparing state directly rules that out.
function rngCursor(c) { return c.rand && typeof c.rand.getState === 'function' ? c.rand.getState() : null; }

for (const k of UPSET_KEYS) {
  test(`fault-engine parity: ${k} -- setUpset() and a direct ESS.Dispatch call produce identical trajectories`, () => {
    const a = newSim({ seed: SEED });
    const b = newSim({ seed: SEED });
    run(a, 60);
    run(b, 60);

    viaSetUpset(a, k, true);
    viaDispatch(b, k, true);

    assert.equal(digest(endState(a)), digest(endState(b)), `${k}: end-state digest diverged immediately after injection`);
    assert.deepEqual(alarmSequence(a), alarmSequence(b), `${k}: alarm sequence diverged immediately after injection`);
    assert.deepEqual(rngCursor(a), rngCursor(b), `${k}: PRNG cursor diverged immediately after injection`);

    run(a, 300);
    run(b, 300);

    assert.equal(digest(endState(a)), digest(endState(b)), `${k}: end-state digest diverged after further stepping`);
    assert.deepEqual(alarmSequence(a), alarmSequence(b), `${k}: alarm sequence diverged after further stepping`);
    assert.deepEqual(rngCursor(a), rngCursor(b), `${k}: PRNG cursor diverged after further stepping`);

    // Clear symmetrically too, so a scenario left ON cannot masquerade as parity by both
    // sides simply staying in the same (wrong) place forever.
    viaSetUpset(a, k, false);
    viaDispatch(b, k, false);
    run(a, 60);
    run(b, 60);

    assert.equal(digest(endState(a)), digest(endState(b)), `${k}: end-state digest diverged after clearing`);
    assert.deepEqual(alarmSequence(a), alarmSequence(b), `${k}: alarm sequence diverged after clearing`);
    assert.deepEqual(rngCursor(a), rngCursor(b), `${k}: PRNG cursor diverged after clearing`);
  });
}

test('D2 class split: exactly the three ARCHITECTURE upsets resolve to a topology fault node; the other nine resolve to none', () => {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  const graph = Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });

  const architecture = [];
  const process = [];
  for (const k of UPSET_KEYS) {
    const faultId = UpsetBridge.faultIdFor(k);
    const targets = UpsetBridge.topologyTargets(k, graph);
    if (faultId != null || targets.length > 0) architecture.push({ k, faultId, targets });
    else process.push(k);
  }

  assert.deepEqual(architecture.map((x) => x.k).sort(), ['drift', 'stick', 'xmtr'],
    'exactly the three ARCHITECTURE-class legacy upsets must resolve to a topology fault node');
  assert.equal(process.length, 9, 'the remaining nine legacy upsets must resolve to none');

  for (const { k, faultId, targets } of architecture) {
    assert.ok(FaultEngine.FAULT_IDS.includes(faultId), `${k}: ${faultId} is not a real fault id`);
    assert.ok(targets.length > 0 && targets.every((id) => !!graph.nodes[id]),
      `${k}: topologyTargets returned a dangling node id among ${targets.join('/')}`);
  }

  // The two baited PROCESS upsets stay unattached despite owning real, same-named MOTOR
  // nodes (DRV-P101, DRV-M202) -- tests/upset-class-honesty.test.js pins this in full;
  // restated narrowly here because it is exactly the failure mode this parity file exists
  // to catch a regression in.
  for (const k of ['pump', 'agit', 'air']) {
    assert.equal(UpsetBridge.faultIdFor(k), null, `${k} must not resolve to a fault id`);
    assert.deepEqual(UpsetBridge.topologyTargets(k, graph), [], `${k} must not resolve to any topology node`);
  }
});
