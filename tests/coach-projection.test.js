// @artifact dev
// The AI coach sidecar may only see TRAINEE_SAFE board state.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const FaultEngine = require('../src/fault-engine.js');
const { build } = require('../tools/coach/projection.js');
const { run } = require('./_fixture');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  return c;
}

test('coach projection contains live alarms and no fault ids', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.setUpset('xmtr', true);
  run(c, 20);
  const p = build(c);
  assert.ok(p.alarms.length, 'expected alarms after xmtr: ' + JSON.stringify(p.alarms));
  assert.ok(p.alarms.some((a) => a.tag === 'FIC102' && a.cond === 'BADPV'),
    'FIC102 BADPV should be visible: ' + JSON.stringify(p.alarms));
  const blob = JSON.stringify(p);
  const leaked = FaultEngine.FAULT_IDS.filter((id) => blob.includes(id));
  assert.deepEqual(leaked, [], 'coach projection leaked fault ids: ' + leaked.join(','));
  assert.ok(!blob.includes('INSTRUCTOR_ONLY'));
  assert.ok(!blob.includes('archFaults'));
});

test('coach projection during A1 names the drill, not the engine fault', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  const p = build(c);
  assert.equal(p.drill && p.drill.id, 'A1');
  assert.match(p.drill.title, /frozen/i);
  const blob = JSON.stringify(p);
  assert.ok(!blob.includes('FROZEN_MEASUREMENT'), blob);
});
