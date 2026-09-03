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
