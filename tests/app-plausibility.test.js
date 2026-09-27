// @artifact dev
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Component} = require('../tools/logic-harness').load();
const K = require('../src/plant-kernel');
const Projection = require('../src/plant-projection');
const Plausibility = require('../src/plausibility');

function boot(){const c=new Component({});c.initSim(0);return c;}
function run(c,seconds){for(let i=0;i<seconds*2;i++)c.step(.5);}

test('cooling loss produces a saturated exported reading and a separate instructor finding',()=>{
  const normal=boot();run(normal,240);
  assert.ok(!normal.plausibility.findings.some(f=>f.code==='COOLANT_ABOVE_SATURATION'));
  const c=boot();c.injectFault('cool',true);run(c,120);
  assert.ok(c.L.TIC202.pv>103.125,'native controller continues to see the original model PV');
  const before=JSON.stringify({P:c.P,L:c.L,V:c.V,rand:c.rand.getState(),rand4:c.rand4.getState()});
  const row=c.coachProjection().catalog.find(x=>x.tag==='TIC202');
  assert.equal(row.pv,103.125);assert.equal(row.quality,'UNCERTAIN');
  assert.equal(row.statusCode,0x40940600);assert.equal(row.limit,'HIGH');
  assert.ok(c.plausibility.findings.some(f=>f.code==='COOLANT_ABOVE_SATURATION'));
  assert.equal(JSON.stringify({P:c.P,L:c.L,V:c.V,rand:c.rand.getState(),rand4:c.rand4.getState()}),before);
  assert.ok(!JSON.stringify(c.coachProjection()).includes('COOLANT_ABOVE_SATURATION'));
});

test('kernel projections preserve controls, withhold bad readings and hide plausibility from the subject',()=>{
  const s=K.create({plausibility:{feed_inventory_m3:0.001}});
  s.fields.L.TIC202.pv=170;
  const original=K.stable(s);
  const board=Projection.project(s,'subject'),row=board.points.find(x=>x.tag==='TIC202');
  assert.equal(row.value_milli,103125);assert.equal(row.quality,'UNCERTAIN');
  assert.equal(row.sp_milli,40000);assert.equal(row.op_milli,74000);assert.equal(row.mode,'CAS');
  assert.equal(K.stable(s),original);
  s.fields.L.TIC202.badPv=true;
  assert.equal(Projection.project(s,'subject').points.find(x=>x.tag==='TIC202').value_milli,null);
  const next=K.advance(s,.5,[]).state;
  assert.ok(next.plausibility.findings.some(f=>f.code==='FEED_INVENTORY_UNACCOUNTED'));
  assert.ok(!JSON.stringify(Projection.project(next,'subject')).includes('FEED_INVENTORY_UNACCOUNTED'));
  assert.ok(Projection.project(next,'evaluator').instructor.plausibility);
});

test('kernel checkpoint and instructor snapshot resume the assertion ledger deterministically',()=>{
  let a=K.create({plausibility:{feed_inventory_m3:1}});
  for(let i=0;i<4;i++)a=K.advance(a,.5,[]).state;
  let b=K.capture(K.restore(JSON.parse(K.stable(a))));
  for(let i=0;i<4;i++){a=K.advance(a,.5,[]).state;b=K.advance(b,.5,[]).state;assert.equal(K.stable(a),K.stable(b));}
  const c=boot();run(c,3);const snap=c.snapshotData('ledger',0);
  run(c,3);const expected=JSON.stringify(c.plausibility);
  c.restoreSnapshot(snap,'test');run(c,3);assert.equal(JSON.stringify(c.plausibility),expected);
  delete snap.plausibility;c.restoreSnapshot(snap,'legacy');assert.ok(c.plausibility);
  const old=K.create();delete old.plausibility;assert.ok(K.capture(K.restore(old)).plausibility);
});

test('turning off the assertion reader leaves process, control, alarms and both RNG streams identical',()=>{
  const c=K.restore(K.create());c.injectFault('cool',true);const initial=K.capture(c);
  const enabled=K.restore(initial);for(let i=0;i<240;i++)enabled.step(.5);
  const advance=Plausibility.advance;const disabled=K.restore(initial);
  try{Plausibility.advance=()=>{};for(let i=0;i<240;i++)disabled.step(.5);}finally{Plausibility.advance=advance;}
  for(const key of ['P','L','V','hist'])assert.deepEqual(enabled[key],disabled[key],key);
  assert.deepEqual(enabled.alarmEngine.snapshot(),disabled.alarmEngine.snapshot());
  assert.equal(enabled.rand.getState(),disabled.rand.getState());assert.equal(enabled.rand4.getState(),disabled.rand4.getState());
});


test('a long operating interval closes its U4 liquid ledger and a blocked product outlet exposes the discarded volume',()=>{
  const c=K.restore(K.create());
  run(c,1800);
  const normal=c.plausibility.u4_liquid;
  assert.equal(normal.status,'within_tolerance');
  assert.equal(normal.covered_ms,1800000);
  assert.ok(Math.abs(normal.residual_m3)<normal.tolerance_m3);
  c.L.LIC503.mode='MAN';c.L.LIC503.op=0;
  run(c,1800);
  assert.equal(c.P.s.h2,100);
  assert.equal(c.plausibility.u4_liquid.status,'outside_tolerance');
  assert.ok(c.plausibility.u4_liquid.residual_m3>0);
  assert.ok(c.plausibility.findings.some(f=>f.code==='LEVEL_AT_BOUND'));
  assert.ok(c.plausibility.findings.some(f=>f.code==='U4_LIQUID_CLOSURE_EXCEEDED'));
  const ui=boot();ui.plausibility=JSON.parse(JSON.stringify(c.plausibility));
  ui.setState({sec:'MNGR'});
  assert.ok(ui.instructorView().plausibility.rows.length);
  ui.setState({sec:'OPER'});
  assert.deepEqual(ui.instructorView(),{on:false});
});
