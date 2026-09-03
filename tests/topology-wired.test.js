// @artifact dev
// P2L-EXPANSION-SPEC section 8, Stage 1: Topology.validate() is WIRED, not just written.
//
// validate() (src/topology.js) is a real contract check with positive-control tests in
// tests/topology.test.js, and before this stage nothing called it at runtime. A tag added
// to this.L but to no unit list fell through the app's unitOf() catch-all as 'U1', the graph
// validated clean, and blastRadius('CTRL-U1') would have taught a trainee that losing U1's
// controller takes down equipment in another unit. Now: unitOf() returns null for a tag it
// cannot place, build() records it as `unplaced`, validate() reports it, and initSim()
// refuses to start on any reported problem.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Topology = require('../src/topology.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();
function boot() { const c = new Component({}); c.initSim(1700000000000); return c; }

test('the shipped plant places every point and validates clean at initSim', () => {
  const c = boot();
  assert.deepEqual(c.topo.unplaced, []);
  assert.deepEqual(Topology.validate(c.topo), []);
  for (const tag in c.L) assert.ok(Topology.UNITS.includes(c.unitOf(tag)), `${tag} -> ${c.unitOf(tag)}`);
});

test('a tag the app cannot place is REPORTED, never silently filed under U1', () => {
  const c = boot();
  const g = Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => (t === 'FIC310' ? null : c.unitOf(t)) });
  assert.deepEqual(g.unplaced, ['FIC310']);
  const problems = Topology.validate(g);
  assert.ok(problems.some((p) => /^FIC310: resolves no unit/.test(p)), problems.join('\n'));
});

test('a node carrying a unit outside Topology.UNITS is reported', () => {
  const c = boot();
  const g = JSON.parse(JSON.stringify(c.topo));
  g.nodes['XMTR-FIC102'].unit = 'U9';
  assert.ok(Topology.validate(g).some((p) => /XMTR-FIC102: unknown unit U9/.test(p)));
});

test('initSim REFUSES to start on a contract violation (the wiring itself)', () => {
  const T = globalThis.ESS.Topology;          // the instance the app page actually calls
  const real = T.validate;
  T.validate = () => ['XX999: resolves no unit -- test injection'];
  try {
    assert.throws(() => new Component({}).initSim(1700000000000), /TOPOLOGY CONTRACT VIOLATED.*XX999/);
  } finally { T.validate = real; }
  assert.doesNotThrow(() => new Component({}).initSim(1700000000000));
});

test('the app\'s unitOf() no longer has a catch-all', () => {
  const c = boot();
  assert.equal(c.unitOf('XX999'), null, 'an unknown tag must not be U1 by default');
  assert.equal(c.unitOf('STN01'), null);
  assert.equal(c.unitOf('FIC102'), 'U1');
  assert.equal(c.unitOf('TK-101'), 'U1');
  assert.equal(c.unitOf('H-310'), 'U3');
  assert.equal(c.unitOf('SCM202'), 'U2');
});

test('a valve in V that no control module strokes is REPORTED (it has no command path)', () => {
  const c = boot();
  const V = Object.assign({}, c.V, { XV999: { pos: 0.3, stuck: false, fail: 0 } });
  const g = Topology.build({ L: c.L, V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
  assert.deepEqual(g.strayValves, ['XV999']);
  assert.ok(Topology.validate(g).some((p) => /^valve XV999 is in V but no control module strokes it/.test(p)));
  assert.deepEqual(boot().topo.strayValves, [], 'the shipped plant has no stray valve');
});
