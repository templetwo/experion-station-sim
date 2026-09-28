// @artifact dev
// Prospective live-mode integration checks; historical campaigns stay pinned.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../tools/logic-harness');
const K=require('../src/plant-kernel'),B=require('../src/boundary-dof');
const copy=x=>JSON.parse(JSON.stringify(x));
function boot(mode='composition_mass_v1',at=0){const {Component}=load();const c=new Component({});c.initSim(at,{materialMode:mode});return c;}
function advance(c,n){for(let i=0;i<n;i++)c.step(.5);}
function physical(c){return {P:copy(c.P),L:copy(c.L),V:copy(c.V),composition:copy(c.composition),product:copy(c.product),plausibility:copy(c.plausibility),alarms:c.alarmEngine.snapshot(),rand:c.rand.getState(),rand4:c.rand4.getState()};}

test('live composition is explicit, default remains legacy, and map preserves three islands',()=>{
 const c=boot('legacy');assert.equal(c.composition,null);assert.equal(c.L.AI511,undefined);
 c.initSim(0,{materialMode:'composition_mass_v1'});
 assert.equal(c.materialMode,'composition_mass_v1');assert.ok(c.L.AI511&&c.L.AI512&&c.L.LI513);
 assert.deepEqual(B.plantMap(c.materialMode).islands.map(x=>x.unit),['U1','U2']);
 assert.deepEqual(B.plantMap(c.materialMode).boundaries.map(x=>[x.from,x.to]),[['U3','U4']]);
 advance(c,1);assert.equal(B.check(c.P,c.L,c.composition).ok,true);
 assert.equal(c.product.formula_version,'quality_proxy_v1');
 assert.throws(()=>c.initSim(0,{materialMode:'invented'}),/material_mode/);
});

test('browser and Kernel have identical composition, observations, meter and RNG after scans',()=>{
 const c=boot(),s0=K.create({materialMode:'composition_mass_v1'});let s=s0;
 for(let i=0;i<50;i++){c.step(.5);s=K.advance(s,.5,[]).state;}
 const k=K.restore(s);assert.deepEqual(physical(c),physical(k));
 assert.equal(c.product.eligible_ms,25000);assert.equal(c.product.end,25000);
 const snap=copy(c.snapshotData('live'));advance(c,31);const expected=physical(c);
 c.restoreSnapshot(snap);advance(c,31);assert.deepEqual(physical(c),expected);
});

test('late scan failure rolls back components, alarms, seeded noise, journal, histories and meters',()=>{
 const c=boot();advance(c,61);
 const before=physical(c),hist=copy(c.hist),events=copy(c.events),journal=copy(c.instr.journal),ring=copy(c.instr.ring);
 const saved=c.archFaultTick;c.archFaultTick=function(){this.instr.journal.push({poison:true});this.P.h.bed=999;this.addEvent('SYSTEM','FAIL','injected');throw Error('late_scan_failure');};
 assert.throws(()=>c.step(.5),/late_scan_failure/);c.archFaultTick=saved;
 assert.deepEqual(physical(c),before);assert.deepEqual(c.hist,hist);assert.deepEqual(c.events,events);assert.deepEqual(c.instr.journal,journal);assert.deepEqual(c.instr.ring,ring);
 const next=boot();next.restoreSnapshot(copy(c.snapshotData('retry')));next.step(.5);c.step(.5);assert.deepEqual(physical(c),physical(next));
});

test('invalid material input and corrupted restore leave the live process unchanged',()=>{
 const c=boot();advance(c,2);c.P.env.catAct=10;const before=physical(c);
 assert.throws(()=>c.step(.5));assert.deepEqual(physical(c),before);
 c.P.env.catAct=1;const stable=physical(c),snap=copy(c.snapshotData('bad'));
 snap.composition.material.vector[0]=-100;
 assert.throws(()=>c.restoreSnapshot(snap));assert.deepEqual(physical(c),stable);
 const malformed=copy(c.snapshotData('wrong-version'));malformed.schemaVersion='999';
 assert.throws(()=>c.restoreSnapshot(malformed));assert.deepEqual(physical(c),stable);
});

test('fresh activation, reset and preset never infer components from legacy levels',()=>{
 const c=boot('legacy');c.instr.auth=true;c.P.s.h2=90;c.startMaterialRun();
 assert.equal(c.materialMode,'composition_mass_v1');assert.ok(Math.abs(c.P.s.h2-50)<1e-12);assert.equal(c.state.speed,0);
 advance(c,4);const material=copy(c.composition.material);c.resetAccounting();
 assert.deepEqual(c.composition.material,material);assert.equal(c.product.start,c.P.t);assert.equal(c.product.gross,0);
 const old=boot('legacy').snapshotData('old');old.schemaVersion='3.0';delete old.product;delete old.composition;delete old.materialMode;
 c.restoreSnapshot(old);assert.equal(c.composition,null);assert.equal(c.materialMode,'legacy');assert.equal(c.product.start,c.P.t);assert.equal(c.L.AI511,undefined);
 c.initSim(0,{materialMode:'composition_mass_v1'});c.applyPreset(globalThis.ESS.Instructor.presets()[0].id,{baseTime:0});
 assert.equal(c.composition,null);
});

test('receiving tank UI and coach expose delayed readings, never instructor masses',()=>{
 const c=boot();advance(c,60);c.setState({unit:'U4'});
 const v=c.renderVals();assert.equal(v.compositionBoard.on,true);assert.equal(v.compositionBoard.points.length,3);
 assert.equal(c.instructorView().on,false);assert.ok(!JSON.stringify(v.compositionBoard).includes('vector'));
 const point=c.coachProjection().catalog.find(x=>x.tag==='AI511');assert.equal(point.pv,c.L.AI511.pv);assert.equal(point.ageMs,c.L.AI511.ageMs);
 c.instr.auth=true;assert.equal(c.instructorView().material.rows.length,7);
});

test('heat removal contaminates stored product before delayed analyzer indication',()=>{
 const c=boot();advance(c,1200);
 assert.ok(c.composition.material.vector[16]/c.composition.material.vector.slice(16,20).reduce((a,b)=>a+b,0)<.15);
 c.setMode('TIC311','MAN');assert.equal(c.storeEntry('TIC311','OP',0),true);
 let truthAt=null,observedAt=null;
 for(let i=0;i<3000;i++){
  c.step(.5);const m=c.composition.material.vector.slice(16,20),a=m[0]/m.reduce((x,y)=>x+y,0);
  if(truthAt===null&&a>.15)truthAt=c.P.t;
  if(observedAt===null&&c.L.AI511.quality==='GOOD'&&c.L.AI511.pv>15)observedAt=c.P.t;
 }
 assert.ok(truthAt>600000,'heat loss must change material');assert.ok(observedAt>truthAt,'analyzer must lag material');
 assert.ok(c.composition.material.vector.every(Number.isFinite));
});

test('normal vent restriction lifts independent relief and accounts both gas paths',()=>{
 const c=boot(),M=globalThis.ESS.MaterialModel;
 c.setMode('PIC505','MAN');assert.equal(c.storeEntry('PIC505','OP',0),true);
 let lifted=false,reseated=false,was=false;
 for(let i=0;i<800;i++){
  c.step(.5);if(c.P.trips.psv502)lifted=true;if(was&&!c.P.trips.psv502)reseated=true;was=c.P.trips.psv502;
  assert.equal(c.P.trips.psv502,c.composition.material.reliefOpen);
 }
 const y=c.composition.material.vector;
 assert.ok(lifted&&reseated);assert.ok(y[M.TRANSFER_OFFSETS.relief_vent+3]>0);
 assert.ok(y[M.TRANSFER_OFFSETS.normal_vent+3]>0,'normal valve strokes closed rather than disappearing');
 assert.equal(M.truth(c.composition.material).closure.passed,true);
 assert.ok(c.ceRec.seen().some(x=>x.src==='V-502'&&x.cond==='PSV LIFT'),'same protection path must announce');
});

test('composition diversion replays and backtrack includes meter and analyzer continuation',()=>{
 const c=boot();c.instr.auth=true;advance(c,61);
 const snap=copy(c.snapshotData('route'));
 c.setMaterialDiversion(1);advance(c,30);const expected=physical(c);
 const plan=globalThis.ESS.Instructor.replayPlan(c.instr,snap,c.P.t);
 c.restoreSnapshot(snap);c.instr.replay=plan;c.replayToEnd();assert.deepEqual(physical(c),expected);
 const ring=c.instr.ring.find(x=>x.composition);assert.ok(ring);assert.equal(ring.product.end,ring.P.t);
 assert.equal(ring.composition.material.timeMs,ring.P.t);assert.equal(ring.composition.observer.timeMs,ring.P.t);
 const fresh=boot();fresh.restoreSnapshot(copy(ring));c.restoreSnapshot(copy(ring));
 advance(fresh,12);advance(c,12);assert.deepEqual(physical(c),physical(fresh));
});

test('new indicators honor active input-channel faults until explicitly cleared',()=>{
 for(const tag of ['AI511','AI512','LI513']){
  const c=boot(),reference=boot();advance(c,160);advance(reference,160);
  assert.equal(c.L[tag].quality,'GOOD');
  assert.equal(c.archFireFault('OPEN_INPUT_BAD_QUALITY','AI-'+tag,'STEP',0,null,null,c.P.t),true);
  const unknown=c.composition.accounting.observed.unknown;
  advance(c,12);advance(reference,12);
  assert.equal(c.L[tag].quality,'BAD');assert.equal(globalThis.ESS.Measurement.observe(c.L[tag]).pv,null);
  assert.deepEqual(c.composition.material,reference.composition.material);
  if(tag!=='LI513')assert.ok(c.composition.accounting.observed.unknown>unknown);
  c.archClearNow('OPEN_INPUT_BAD_QUALITY','AI-'+tag);advance(c,1);
  assert.equal(c.L[tag].quality,'GOOD');
 }
});

test('remote composition instruments build topology from public mode without receiving truth',()=>{
 const {Component}=load(),c=new Component({}),P=require('../src/plant-projection');
 const previous={parent:window.parent,origin:window.location.origin,add:window.addEventListener};
 window.parent={postMessage(){}};window.location.origin='file://';window.addEventListener=()=>{};
 try{
  c.remoteBoot();const state=K.create({materialMode:'composition_mass_v1'}),board=P.project(state,'operator');
  c._remoteListener({origin:window.location.origin,source:window.parent,data:{type:'peb.state',board}});
  assert.equal(c.materialMode,'composition_mass_v1');assert.equal(c.composition,null);
  assert.ok(c.topo.nodes['AI-AI511']);assert.ok(c.assetTree().some(a=>a.id==='TK-503'));
  assert.ok(!JSON.stringify(c.compositionPublic).includes('inventories'));
  const t=c.P.t;c.advanceScan(.5);assert.equal(c.P.t,t,'remote cannot execute the new inner scan');
  const legacy=P.project(K.create(),'operator');c._remoteListener({origin:window.location.origin,source:window.parent,data:{type:'peb.state',board:legacy}});
  assert.equal(c.materialMode,'legacy');assert.ok(!c.topo.nodes['AI-AI511']);assert.ok(!c.assetTree().some(a=>a.id==='TK-503'));
 }finally{window.parent=previous.parent;window.location.origin=previous.origin;window.addEventListener=previous.add;}
});
