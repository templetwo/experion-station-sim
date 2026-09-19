// @artifact dev
'use strict';

// W2 app-level: the C&E recorder chained onto the ctx.onTrip seam, and the chart's visibility gate.
// Contract: docs/dev/W2-CAUSE-EFFECT-CONTRACT.md §3 and §4.
//
// The load-bearing test here is the last one: deleting the recorder must leave every golden digest
// byte-identical. That is acceptance §3.1.6(e), and it is done as a real stub-and-diff over a
// scenario that actually trips -- not asserted in prose.

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const { load } = require('../tools/logic-harness');

const { Component } = load();
const CE = require('../src/cause-effect.js');

function boot() { const c = new Component({}); c.initSim(); return c; }

// Drive the feed tank over its 98 % HIHI trip: the cheapest real trip to reach.
function tripTank(c) {
  c.L.LIC101.mode = 'MAN'; c.L.LIC101.op = 100;
  c.L.FIC102.mode = 'MAN'; c.L.FIC102.op = 0;
  for (let i = 0; i < 4000 && !c.P.trips.ovf; i++) c.step(0.5);
  return c.P.trips.ovf;
}

describe('the C&E recorder on the ctx.onTrip seam', () => {
  test('initSim creates a recorder, and it lives on the Component, never on P', () => {
    const c = boot();
    assert.ok(c.ceRec, 'initSim must create the recorder');
    assert.equal('ceRec' in c.P, false, 'the recorder must not be on the process state');
    assert.deepEqual(c.ceRec.seen(), [], 'it starts clean');
  });

  test('a trip the CODE fires is observed by the recorder, with its (src, cond)', () => {
    const c = boot();
    assert.ok(tripTank(c), 'test setup: the tank must actually trip');
    const seen = c.ceRec.seen();
    assert.ok(seen.length > 0, 'the recorder must have observed the trip');
    const hit = seen.find((e) => e.src === 'TK-101' && e.cond === 'HIHI TRIP');
    assert.ok(hit, 'TK-101 HIHI TRIP must be observed: ' + JSON.stringify(seen));
    assert.equal(typeof hit.t, 'number', 'the recorder stores the sim time as `t`');
  });

  test('what the recorder saw matches what the matrix declares', () => {
    const c = boot();
    tripTank(c);
    const row = CE.causes().find((r) => r.src === 'TK-101' && r.cond === 'HIHI TRIP');
    assert.ok(row, 'the matrix must declare the row the code fired');
    assert.equal(row.seam, 'onTrip');
    const undeclared = CE.verify(c.ceRec.seen()).findings.filter((f) => f.code === 'SEAM_TRIP_UNDECLARED');
    assert.deepEqual(undeclared, [], 'nothing the code fired may be undeclared');
  });

  test('dTrip still receives every trip -- D-series scoring is unchanged', () => {
    // dTrip runs FIRST and unconditionally in the chained handler; the recorder can never
    // be the reason a trip is not scored.
    const c = boot();
    const got = [];
    const real = c.dTrip.bind(c);
    c.dTrip = (src, cond) => { got.push(src + '|' + cond); return real(src, cond); };
    tripTank(c);
    assert.ok(got.some((g) => g === 'TK-101|HIHI TRIP'), 'dTrip must still see the trip: ' + JSON.stringify(got));
    assert.equal(got.length, c.ceRec.seen().length, 'dTrip and the recorder see the same trips');
  });

  test('a missing recorder is a no-op, not a crash', () => {
    const c = boot();
    c.ceRec = null;
    assert.doesNotThrow(() => tripTank(c));
    assert.ok(c.P.trips.ovf, 'the plant still trips with no recorder attached');
  });
});

describe('the chart visibility gate fails closed', () => {
  test('the module ships instructor-only', () => {
    assert.equal(CE.CHART_VISIBILITY, 'instructor');
  });

  test('an operator cannot open the chart while the flag is instructor', () => {
    const c = boot();
    assert.equal(c.ceVisibleToOperator(), false);
    assert.equal(c.ceAllowed(), false, 'no instructor auth, flag not promoted -- closed');
    const v = c.ceView(true);
    assert.deepEqual(v.rows, [], 'no rows are rendered to an operator');
    assert.ok(/INSTRUCTOR ONLY/.test(v.note), 'and the reason is stated: ' + v.note);
  });

  test('the instructor sees the whole chart, still marked not-yet-released', () => {
    const c = boot();
    c.instr.auth = true;
    const v = c.ceView(true);
    assert.equal(v.rows.length, CE.causes().length);
    assert.equal(v.cols.length, CE.effects().length);
    assert.equal(v.locked, true, 'locked stays true until the flag is promoted');
    assert.ok(/INSTRUCTOR VIEW/.test(v.note));
  });

  test('the chart names BOTH causes that close FV311', () => {
    // The plant closes FV311 on trips.bed OR trips.skin. A chart naming one would be wrong
    // about the plant -- see contract §0.3.
    const c = boot();
    c.instr.auth = true;
    const v = c.ceView(true);
    const i = v.cols.findIndex((col) => col.id === 'FV311');
    assert.ok(i >= 0, 'FV311 must be a declared effect column');
    const marked = v.rows.filter((r) => r.cells[i].mark === 'X').map((r) => r.id);
    assert.deepEqual(marked.sort(), ['H310_SKIN', 'R310_HITEMP']);
  });

  test('the app reads the flag rather than hardcoding the gate', () => {
    // Promotion must be the one line in src/cause-effect.js and nothing else. Prove the app
    // actually follows it by flipping the module value under the running Component.
    const c = boot();
    const saved = CE.CHART_VISIBILITY;
    try {
      globalThis.ESS.CauseEffect.CHART_VISIBILITY = 'operator';
      assert.equal(c.ceVisibleToOperator(), true, 'the app must follow the module flag');
      assert.equal(c.ceAllowed(), true, 'an operator may open it once promoted');
      assert.equal(c.ceView(true).locked, false);
    } finally {
      globalThis.ESS.CauseEffect.CHART_VISIBILITY = saved;
    }
    assert.equal(c.ceVisibleToOperator(), false, 'and it is closed again afterwards');
  });
});

describe('acceptance §3.1.6(e): deleting the reader leaves the goldens byte-identical', () => {
  test('a tripping run is bit-for-bit identical with the recorder attached and detached', () => {
    const digest = (c) => JSON.stringify({
      points: Object.keys(c.L).sort().map((t) => {
        const l = c.L[t];
        return [t, l.pv, l.sp, l.op, l.mode, !!l.badPv];
      }),
      valves: Object.keys(c.V).sort().map((v) => [v, c.V[v].pos]),
      trips: c.P.trips,
      events: (c.events || []).length,
      alarms: (c.alarms || []).length,
      rand: c.rand.getState(),   // the seeded generator itself; ctx.rand is a wrapper closure
    });

    const withRec = boot();
    tripTank(withRec);

    const without = boot();
    without.ceRec = null;            // the reader deleted entirely
    tripTank(without);

    assert.equal(digest(without), digest(withRec),
      'the recorder must not perturb a single value, valve, event, alarm or the generator cursor');
  });
});
