// @artifact dev
// Coach projection is TRAINEE_SAFE. The page method is the source of truth.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const FaultEngine = require('../src/fault-engine.js');
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
  const p = c.coachProjection();
  assert.ok(p.alarms.length, 'expected alarms after xmtr: ' + JSON.stringify(p.alarms));
  assert.ok(p.alarms.some((a) => a.tag === 'FIC102' && a.cond === 'BADPV'),
    'FIC102 BADPV should be visible: ' + JSON.stringify(p.alarms));
  const blob = JSON.stringify(p);
  const leaked = FaultEngine.FAULT_IDS.filter((id) => blob.includes(id));
  assert.deepEqual(leaked, [], 'coach projection leaked fault ids: ' + leaked.join(','));
  assert.ok(!blob.includes('INSTRUCTOR_ONLY'));
  assert.ok(!blob.includes('archFaults'));
  assert.ok(p.screen && p.screen.displayName);
  assert.ok(Array.isArray(p.catalog) && p.catalog.length >= 20);
  assert.ok(p.catalog.some((r) => r.tag === 'FIC102' && /feed/i.test(r.desc || '')));
});

test('coach projection during A1 names the drill, not the engine fault', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  const p = c.coachProjection();
  assert.equal(p.drill && p.drill.id, 'A1');
  assert.match(p.drill.title, /frozen/i);
  const blob = JSON.stringify(p);
  assert.ok(!blob.includes('FROZEN_MEASUREMENT'), blob);
});

test('harness is file protocol so the coach does not fetch', () => {
  const c = boot();
  assert.equal(c.coachOnHttp(), false);
  c.coachAsk('explain', '');
  assert.match(c.state.coachStatus, /OFFLINE/);
});
