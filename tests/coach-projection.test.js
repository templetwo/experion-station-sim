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
  assert.ok(p.alarms.every((a) => Object.prototype.hasOwnProperty.call(a, 'alarmValue')));
  assert.ok(p.alarms.every((a) => a.valueMeaning === 'point PV at alarm evaluation'));
  assert.ok(p.alarms.every((a) => Object.prototype.hasOwnProperty.call(a, 'pv')));
  assert.equal(typeof p.capturedAtSim, 'number');
});

test('coach projection during A1 names only the neutral exercise, not the cause', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A1');
  const p = c.coachProjection();
  assert.equal(p.drill && p.drill.id, 'A1');
  assert.equal(p.drill.title, 'Hidden architecture diagnosis');
  const blob = JSON.stringify(p);
  assert.ok(!blob.includes('FROZEN_MEASUREMENT'), blob);
  assert.doesNotMatch(blob, /frozen flow measurement/i);
});

test('coach receives root-detached simulated drill indications after an architecture fault is present', () => {
  const c = boot();
  c.applyPreset('U1_SS');
  c.startADrill('A6');
  run(c, 46);
  const p = c.coachProjection();
  assert.equal(p.drill.observationGrade, 'SIMULATED_ARCHITECTURE_INDICATION');
  assert.ok(p.drill.observations.some((text) => /redundancy-degraded/i.test(text)));
  const blob = JSON.stringify(p.drill);
  assert.ok(!blob.includes('NET_PATH_DEGRADED'));
  assert.ok(!blob.includes('NET-U1-B'));
});

test('A11 makes PIP unavailable immediately, resists a late health response, and recovers after clear', async () => {
  const c = boot();
  const oldFetch=global.fetch;
  let releaseHealth;
  let calls=0;
  global.fetch=()=>{
    calls++;
    if(calls===1) return new Promise((resolve)=>{ releaseHealth=resolve; });
    return Promise.resolve({json:async()=>({model:'test-model'})});
  };
  try {
  c.applyPreset('U1_SS');
  c.setState({coachLive:true,coachStatus:'test-model',coachMood:'idle'});
  c._coachBusy=true;
  let aborted=false;
  c._coachAc={abort:()=>{ aborted=true; }};
  c.coachOnHttp=()=>true;
  c.coachPing();
  c.startADrill('A11');
  run(c, 61);
  assert.equal(c.coachUnavailable(), true);
  assert.equal(c.state.coachLive, false, 'an already-live PIP must go unavailable at fault onset');
  assert.equal(aborted, true, 'assistant loss must abort an in-flight model request');
  assert.equal(c._coachBusy, false);
  assert.match(c.state.coachStatus, /UNAVAILABLE/);
  releaseHealth({json:async()=>({model:'late-model'})});
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(c.state.coachLive,false,'a late pre-fault health response must not revive PIP');
  c.coachAsk('ask', 'Can you help?');
  assert.match(c.state.coachStatus, /UNAVAILABLE/);
  assert.equal(c._coachBusy, false);
  assert.equal(c.L.FIC102.mode, 'CAS', 'assistant loss must not block or rewrite control state');
  c.endADrill('ENDED FOR TEST');
  assert.equal(c.coachUnavailable(), false);
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(c.state.coachLive,true,'clearing A11 must re-establish the available local coach');
  assert.equal(c.state.coachStatus,'test-model');
  } finally {
    global.fetch=oldFetch;
  }
});

test('harness is file protocol so the coach does not fetch', () => {
  const c = boot();
  assert.equal(c.coachOnHttp(), false);
  c.coachAsk('explain', '');
  assert.match(c.state.coachStatus, /OFFLINE/);
});

test('first HTTP health receipt wakes PIP before any request generation exists', async () => {
  const c=boot();
  assert.equal(c._coachGen,undefined,'positive control: first boot has no generation counter');
  const oldFetch=global.fetch;
  global.fetch=async()=>({json:async()=>({model:'first-boot-model'})});
  try {
    c.coachOnHttp=()=>true;
    c.coachPing();
    await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(c.state.coachLive,true);
    assert.equal(c.state.coachStatus,'first-boot-model');
    assert.match(c.state.coachText,/Watching this board on first-boot-model/);
    assert.doesNotMatch(c.state.coachText,/Launch Station\.command/);
  } finally {
    global.fetch=oldFetch;
  }
});

test('health receipt preserves an existing PIP conversation', async () => {
  const c=boot();
  c.setState({coachFeed:[{id:7,who:'YOU',text:'Keep this turn.',kind:'ask'}]});
  const oldFetch=global.fetch;
  global.fetch=async()=>({json:async()=>({model:'conversation-model'})});
  try {
    c.coachOnHttp=()=>true;
    c.coachPing();
    await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(c.state.coachLive,true);
    assert.equal(c.state.coachFeed[0].text,'Keep this turn.');
  } finally {
    global.fetch=oldFetch;
  }
});

test('A11 clear restores ordinary OFFLINE state on the standalone file surface', () => {
  const c=boot();
  c.applyPreset('U1_SS');
  c.startADrill('A11');
  run(c,61);
  assert.match(c.state.coachStatus,/UNAVAILABLE/);
  c.endADrill('ENDED FOR TEST');
  assert.equal(c.coachUnavailable(),false);
  assert.equal(c.state.coachStatus,'OFFLINE');
  assert.doesNotMatch(c.state.coachText,/unavailable in this exercise/i);
});
