// @artifact dev
// Deterministic analyzer timing and independent truth/observed dispatch ledgers.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/composition'),M=require('../src/material-model'),R=require('../src/material-recipe');
const Measurement=require('../src/measurement');
const copy=x=>JSON.parse(JSON.stringify(x));
const INPUT={feed_kg_s:8.88888888888889,temperature_k:650,activity:1,water_valve:.45,product_valve:.5,weir_height_percent:55,divert_fraction:0,gas_valve:.4};
function run(api,s,count,input=INPUT){for(let i=0;i<count;i++)s=api.advance(s,input,.5);return s;}
// Controlled tank history isolates analyzer time from the independently tested material ODE.
// Only product_dispatch is external; the larger product_transfer must never enter its ledger.
function controlled(massesAt){
 const material={...M,create(now=0){const s=M.create(now);s.vector.splice(16,4,...massesAt(0));return s;},validateState:s=>s,
  advance(s,input,dt){const n=copy(s);n.timeMs+=dt*1000;n.vector.splice(16,4,...massesAt(n.timeMs));
   n.vector[M.TRANSFER_OFFSETS.product_dispatch+1]+=.7;n.vector[M.TRANSFER_OFFSETS.product_transfer+1]+=7;
   n.lastInterval={startMs:s.timeMs,endMs:n.timeMs,transfers:{product_dispatch:[0,.7,0,0],product_transfer:[0,7,0,0]}};return n;},
  geometry:()=>({volumes_m3:{product:12}}),truth:s=>({inventories:{product:s.vector.slice(16,20)}})};
 const context={module:{exports:{}},require:name=>({'./material-model':material,'./material-recipe':R,'./measurement':Measurement})[name]};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/composition'),'utf8'),context);return context.module.exports;
}

test('fresh run has no invented analyzer prehistory and publishes the first source only after transport',()=>{
 const A=controlled(()=>[100,900,0,0]);let s=A.create();
 for(let i=0;i<30;i++){
  const p=A.measurements(s).AI511;assert.equal(p.pv,null);assert.equal(p.quality,'BAD');assert.equal(p.statusCode,0x80000000);assert.equal(p.reason,'NO_VALID_SAMPLE');s=A.advance(s,INPUT,.5);
 }
 const p=A.measurements(s).AI511;assert.equal(p.pv,10);assert.equal(p.quality,'GOOD');assert.equal(p.statusCode,0);
 assert.equal(p.sourceTimeMs,0);assert.equal(p.publishedTimeMs,15000);assert.equal(p.ageMs,15000);assert.equal(p.publicationAgeMs,0);
 assert.ok(Math.abs(s.accounting.observed.unknown-30*.7)<1e-12);assert.equal(s.accounting.coveredMs,0);
 s=A.advance(s,INPUT,.5);assert.equal(s.accounting.coveredMs,500);assert.equal(s.accounting.observed.qualified,.7);
});

test('transport, exact first-order lag, quantization and sample holding are distinct',()=>{
 const A=controlled(t=>t<5000?[100,900,0,0]:[300,700,0,0]);let s=run(A,A.create(),40);
 assert.equal(A.measurements(s).AI511.pv,10); // At t20 the t5 change just arrives.
 s=run(A,s,9);assert.equal(A.measurements(s).AI511.pv,10);assert.equal(A.measurements(s).AI511.publicationAgeMs,4500);
 s=A.advance(s,INPUT,.5);const p=A.measurements(s).AI511;
 assert.equal(p.pv,Math.round((.3+(.1-.3)*Math.exp(-5/30))*100000)/1000);
 assert.equal(p.sourceTimeMs,10000);assert.equal(p.publishedTimeMs,25000);assert.equal(p.ageMs,15000);
 assert.equal(p.quality,'GOOD'); // Off-spec is process quality, not measurement validity.
});

test('empty delayed truth invalidates on its exact sample and reacquisition retains lag memory',()=>{
 const A=controlled(t=>t<5000?[100,900,0,0]:t<10000?[0,0,0,0]:[300,700,0,0]);let s=run(A,A.create(),39);
 assert.equal(A.measurements(s).AI511.quality,'GOOD');s=A.advance(s,INPUT,.5);
 assert.equal(A.measurements(s).AI511.quality,'BAD');assert.equal(A.measurements(s).AI511.pv,null);assert.equal(A.measurements(s).AI511.sourceTimeMs,5000);
 s=run(A,s,10);assert.equal(A.measurements(s).AI511.quality,'GOOD');assert.equal(A.measurements(s).AI511.pv,10);
 s=run(A,s,10);assert.equal(A.measurements(s).AI511.pv,Math.round((.3+(.1-.3)*Math.exp(-5/30))*100000)/1000);
});

test('empty tank stays unavailable; first ever valid delayed sample initializes explicitly',()=>{
 const A=controlled(t=>t<5000?[0,0,0,0]:[200,800,0,0]);let s=run(A,A.create(),39);
 assert.equal(A.measurements(s).AI511.pv,null);s=A.advance(s,INPUT,.5);
 assert.equal(A.measurements(s).AI511.pv,20);assert.equal(A.measurements(s).AI511.quality,'GOOD');
 assert.equal(A.truthProjection(s).quality.qualified,false);
});

test('truth accounting uses left-end receiving inventory and counts only external dispatch',()=>{
 const A=controlled(t=>t<5000?[100,900,0,0]:[300,700,0,0]);const s=run(A,A.create(),40);
 assert.ok(Math.abs(s.accounting.truth.gross-28)<1e-12);assert.ok(Math.abs(s.accounting.truth.qualified-7)<1e-12);
 assert.ok(Math.abs(s.accounting.truth.offBand-21)<1e-12);assert.equal(s.accounting.truth.unknown,0);
 assert.ok(Math.abs(s.accounting.observed.unknown-21)<1e-12);assert.ok(Math.abs(s.accounting.observed.qualified-7)<1e-12);
 assert.equal(s.accounting.observed.offBand,0);assert.equal(s.accounting.coveredMs,5000);
});

test('native BAD and UNCERTAIN published readings exclude observed coverage without changing truth',()=>{
 const A=controlled(()=>[100,900,0,0]);const base=run(A,A.create(),30),own=A.measurements(base);
 for(const quality of ['BAD','UNCERTAIN']){
  const points={...own,AI511:{...own.AI511,quality,badPv:quality==='BAD',statusCode:quality==='BAD'?0x808f0000:0x40000000}};
  const next=A.advance(base,INPUT,.5,points);
  assert.equal(next.accounting.coveredMs,0);assert.equal(next.accounting.observed.unknown,next.accounting.observed.gross);
  assert.equal(next.accounting.truth.qualified,next.accounting.truth.gross);
  assert.equal(A.publicProjection(base,points).measurements.AI511.quality,quality);
 }
});

test('expired publication is unavailable even if its retained value and source quality say GOOD',()=>{
 const A=controlled(()=>[100,900,0,0]);const s=run(A,A.create(),50),p=A.measurements(s);
 p.AI511.publishedTimeMs=19000;p.AI511.sourceTimeMs=4000;
 const pub=A.publicProjection(s,p);assert.equal(pub.measurements.AI511.pv,null);assert.equal(pub.measurements.AI511.quality,'BAD');
 assert.equal(pub.measurements.AI511.ageMs,21000);assert.equal(pub.measurements.AI511.publicationAgeMs,6000);
 const next=A.advance(s,INPUT,.5,p);assert.equal(next.accounting.coveredMs,s.accounting.coveredMs);
});

test('observed classification follows the actual published three-decimal mass percent',()=>{
 const A=controlled(()=>[150.004,849.996,0,0]);let s=run(A,A.create(),30);assert.equal(A.measurements(s).AI511.pv,15);
 s=A.advance(s,INPUT,.5);assert.equal(s.accounting.truth.qualified,0);assert.equal(s.accounting.observed.qualified,.7);
});

test('pure material advance and exact checkpoint continuation retain queue, filter, sample and ledgers',()=>{
 const start=C.create(1234),saved=copy(start);let s=run(C,start,67);assert.deepEqual(start,saved);
 const resumed=copy(s),before=copy(s);C.validate(resumed);
 const a=run(C,s,29,{...INPUT,temperature_k:590}),b=run(C,resumed,29,{...INPUT,temperature_k:590});
 assert.deepEqual(a,b);assert.deepEqual(s,before);assert.equal(M.truth(a.material).closure.passed,true);
 assert.equal(a.observer.history.at(-1).timeMs,a.material.timeMs);
});

test('accounting reset retains all physical and analyzer state and only resets the reporting window',()=>{
 const s=run(C,C.create(),45),saved=copy(s),reset=C.resetAccounting(s);
 assert.deepEqual(s,saved);assert.deepEqual(reset.material,s.material);assert.deepEqual(reset.observer,s.observer);
 assert.equal(reset.accounting.truth.gross,0);assert.equal(reset.accounting.observed.gross,0);assert.equal(reset.accounting.eligibleMs,0);
 const next=C.advance(reset,INPUT,.5);assert.equal(next.accounting.eligibleMs,500);assert.ok(next.accounting.truth.gross>0);C.validate(next);
});

test('public allowlist excludes current material, filter, queue, reaction and truth classification',()=>{
 const s=run(C,C.create(),40),pub=C.publicProjection(s),text=JSON.stringify(pub);
 for(const key of ['vector','inventories','history','filtered','generation','closure','qualified_mass_kg','initialDispatch'])assert.equal(text.includes('"'+key+'"'),false,key);
 assert.equal(pub.formula_version,'composition_observed_v1');assert.ok(Object.hasOwn(pub.dispatch,'qualified_mass_proxy_kg'));
 assert.equal(C.truthProjection(s).formula_version,'composition_mass_v1');assert.ok(C.truthProjection(s).material.inventories.product);
});

test('checkpoint rejects corrupted analyzer phase, history, values, mass ledgers and nonfinite truth',()=>{
 const s=run(C,C.create(),40);
 const cases=[x=>x.schema='old',x=>x.observer.nextSampleMs++,x=>x.observer.history[1].timeMs++,x=>x.observer.filtered.a=NaN,
  x=>x.observer.held={a:1,w:1},x=>x.accounting.truth.gross++,x=>x.accounting.coveredMs=1e9,x=>x.material.vector[0]=NaN,
  x=>x.observer.hiddenTruth=true];
 for(const mutate of cases){const candidate=copy(s);mutate(candidate);assert.throws(()=>C.validate(candidate));}
 assert.throws(()=>C.advance(s,INPUT,.25),/fixed_frame/);assert.throws(()=>C.advance(s,{...INPUT,activity:Infinity},.5));
});

test('subject and coach preserve analyzer precision, mass units and both ages without material truth',()=>{
 const K=require('../src/plant-kernel'),Projection=require('../src/plant-projection'),Coach=require('../tools/coach/projection');
 let s=K.create({materialMode:'composition_mass_v1'});for(let i=0;i<37;i++)s=K.advance(s,.5,[]).state;
 const subject=Projection.project(s,'subject'),p=subject.points.find(x=>x.tag==='AI511'),l=s.fields.L.AI511;
 assert.equal(p.value_milli,Math.round(l.pv*1000));assert.equal(p.unit,'MASS %');assert.equal(p.sample_sim_time_ms,15000);
 assert.equal(p.sample_source_time_ms,0);assert.equal(p.age_sim_ms,18500);assert.equal(p.publication_age_sim_ms,3500);
 assert.equal(subject.composition.measurements.AI511.ageMs,18500);assert.equal(subject.instructor,undefined);
 const operator=Projection.project(s,'operator');assert.equal(operator.instructor,undefined);
 const instructor=Projection.project(s,'instructor');assert.ok(instructor.instructor.composition.material.inventories);
 const c=Coach.build({state:{sel:'AI511'},L:s.fields.L,P:s.fields.P}),cp=c.points[0];
 assert.equal(cp.pv,l.pv);assert.equal(cp.unit,'MASS %');assert.equal(cp.age_sim_ms,18500);assert.equal(cp.publication_age_sim_ms,3500);
 assert.equal(JSON.stringify(c).includes('inventories'),false);
});

test('missing publication metadata cannot borrow observer timestamps or source quality',()=>{
 const A=controlled(()=>[100,900,0,0]),s=run(A,A.create(),30);
 for(const key of ['sourceTimeMs','publishedTimeMs','quality','badPv','statusCode']){
  const points=copy(A.measurements(s));delete points.AI511[key];
  const pub=A.publicProjection(s,points).measurements.AI511;
  assert.equal(pub.pv,null,key);assert.equal(pub.quality,'BAD',key);
  const next=A.advance(s,INPUT,.5,points);assert.equal(next.accounting.coveredMs,0,key);
  assert.equal(next.accounting.observed.unknown,next.accounting.observed.gross,key);
 }
 const initial=A.create(),points=copy(A.measurements(initial));
 for(const tag of ['AI511','AI512'])Object.assign(points[tag],{pv:0,badPv:false,quality:'GOOD',statusCode:0});
 assert.equal(A.publicProjection(initial,points).measurements.AI511.quality,'BAD');
 assert.equal(A.advance(initial,INPUT,.5,points).accounting.observed.qualified,0);
});

test('restore rejects invented startup samples, altered held values and clocks in both entrypoints',()=>{
 const K=require('../src/plant-kernel'),I=require('../src/instructor');
 const initial=K.create({materialMode:'composition_mass_v1'});
 for(const mutate of [p=>{delete p.sourceTimeMs;},p=>{delete p.publishedTimeMs;},p=>{delete p.quality;},
  p=>Object.assign(p,{pv:0,badPv:false,quality:'GOOD',statusCode:0})]){
  const forged=copy(initial);mutate(forged.fields.L.AI511);const before=copy(forged);
  assert.throws(()=>K.restore(forged),/published_sample/);assert.deepEqual(forged,before);
 }
 const c=K.restore(initial);for(let i=0;i<37;i++)c.step(.5);
 for(const mutate of [p=>{p.pv=0;},p=>{p.sourceTimeMs++;},p=>{p.ageMs=0;},p=>{delete p.publicationAgeMs;}]){
  const snapshot=copy(c.snapshotData('corrupt-publication'));mutate(snapshot.L.AI511);
  assert.throws(()=>I.validateSnapshot(snapshot),/published_sample/);
 }
});

test('truthful manual quality downgrades and badPv-only injection survive restore and exclude coverage',()=>{
 const K=require('../src/plant-kernel'),I=require('../src/instructor');
 let s=K.create({materialMode:'composition_mass_v1'});for(let i=0;i<37;i++)s=K.advance(s,.5,[]).state;
 for(const mutate of [p=>{p.badPv=true;},p=>{p.quality='UNCERTAIN';},p=>{p.quality='BAD';p.pv=null;},
  p=>{p.statusCode=Measurement.STATUS.Bad_SensorFailure;p.quality='BAD';p.badPv=true;}]){
  const candidate=copy(s);mutate(candidate.fields.L.AI511);const c=K.restore(candidate);
  I.validateSnapshot(copy(c.snapshotData('quality-downgrade')));
  const next=K.advance(candidate,.5,[]).state;
  assert.equal(next.composition.accounting.coveredMs,s.composition.accounting.coveredMs);
  assert.ok(next.composition.accounting.observed.unknown>s.composition.accounting.observed.unknown);
  assert.ok(next.composition.accounting.truth.qualified>s.composition.accounting.truth.qualified);
 }
});
