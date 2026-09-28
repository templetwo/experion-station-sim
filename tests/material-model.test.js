// @artifact dev
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../src/material-model'),R=require('../src/material-recipe');
const input=(changes={})=>({feed_kg_s:40*800/3600,temperature_k:650,activity:1,water_valve:.45,product_valve:.5,weir_height_percent:55,divert_fraction:0,gas_valve:.4,...changes});
const copy=x=>JSON.parse(JSON.stringify(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function run(seconds,values=input()){let s=M.create();const events=[];for(let t=0;t<seconds;t+=.5){s=M.advance(s,values,.5);events.push(...s.lastInterval.reliefEvents);assert.equal(M.truth(s).closure.passed,true);}return {s,events};}

test('generated immutable recipe equals committed JSON authority exactly',()=>{assert.deepEqual(R,JSON.parse(fs.readFileSync('tools/g2-live/recipe-v2.json','utf8')));assert.equal(Object.isFrozen(R.gas),true);assert.equal(Object.isFrozen(R.geometry_basis.initial_mass_kg.reactor),true);});
test('initial startup gas owns mass and geometry derives solely from component inventories',()=>{const s=M.create(1234);assert.equal(s.vector.length,108);assert.equal(s.vector[27],800/27);assert.equal(M.adapter(s).pressure,800);for(const [key,value] of Object.entries({hw:25,ho:30,h1:55,h2:50}))assert.ok(Math.abs(M.geometry(s).levels_percent[key]-value)<1e-12);assert.equal(M.geometry(s).volumes_m3.product,6);assert.equal(M.truth(s).closure.passed,true);});
test('advance is pure, nominal reactor and pressure remain steady with separate vent ledger',()=>{const initial=freeze(M.create()),before=JSON.stringify(initial);const s=M.advance(initial,freeze(input()),.5);assert.equal(JSON.stringify(initial),before);assert.deepEqual(s.vector.slice(0,4),initial.vector.slice(0,4));assert.equal(M.adapter(s).pressure,800);assert.ok(Math.abs(s.lastInterval.transfers.normal_vent[3]-.08)<1e-14);assert.deepEqual(s.lastInterval.transfers.relief_vent,[0,0,0,0]);assert.ok(Math.abs(s.lastInterval.transfers.reactor_gas[3]-s.lastInterval.transfers.normal_vent[3])<1e-14);assert.equal(s.lastInterval.startMs,0);assert.equal(s.lastInterval.endMs,500);assert.deepEqual(s.lastInterval.stream.gas,s.lastInterval.transfers.reactor_gas);});
test('zero feed isolates reactor outlet but reaction continues with analytic A decay',()=>{const {s}=run(10,input({feed_kg_s:0}));assert.ok(Math.abs(s.vector[0]-100*Math.exp(-.8))<1e-7);assert.deepEqual(s.vector.slice(M.TRANSFER_OFFSETS.reactor_gas,M.TRANSFER_OFFSETS.reactor_gas+4),[0,0,0,0]);assert.ok(s.vector[3]>18);assert.ok(s.vector[M.TRANSFER_OFFSETS.product_dispatch]>0);});
test('normal vent restriction causes independent relief lift and hysteretic reseat',()=>{const {s,events}=run(150,input({gas_valve:0}));assert.ok(events.length>=3);assert.equal(events[0].open,true);assert.ok(Math.abs(events[0].timeMs/1000-300/(.16*27))<=R.integration.relief_event_time_tolerance_s);assert.ok(events[0].pressure>=1100);assert.equal(events[1].open,false);assert.ok(events[1].pressure<1000);assert.equal(s.vector[M.TRANSFER_OFFSETS.normal_vent+3],0);assert.ok(s.vector[M.TRANSFER_OFFSETS.relief_vent+3]>0);});
test('vent down retains the header heel and preserves nonnegative inventories without clamps',()=>{const {s}=run(300,input({feed_kg_s:0,gas_valve:1}));assert.ok(M.adapter(s).pressure>=100-1e-10);assert.ok(M.adapter(s).pressure<101);assert.ok(s.vector.slice(0,28).every(x=>x>=0));assert.ok(s.vector[M.TRANSFER_OFFSETS.normal_vent+3]<=R.gas.initial_mass_kg-R.gas.header_pressure_kpa*R.gas.compliance_kg_per_kpa+1e-10);});
test('new domain upper corner uses reaction-limited subdivisions and positive state',()=>{const {s}=run(2,input({temperature_k:2200,activity:2.1,feed_kg_s:20}));assert.ok(s.vector.slice(0,28).every(x=>x>=0));assert.ok(s.vector[0]<1);assert.ok(M.truth(s).closure.passed);});
test('input refusal never mutates source state, including nonfinite and extra fields',()=>{const s=freeze(M.create());for(const changes of [{temperature_k:2201},{temperature_k:249},{feed_kg_s:-1},{gas_valve:NaN},{extra:1},{activity:true}])assert.throws(()=>M.advance(s,input(changes),.5));assert.throws(()=>M.advance(s,input(),0));assert.equal(s.timeMs,0);});
test('full state continuation after JSON checkpoint is identical including ledger and events',()=>{let a=run(69,input({gas_valve:0})).s,b=copy(a);for(let i=0;i<6;i++){a=M.advance(a,input({gas_valve:0}),.5);b=M.advance(b,input({gas_valve:0}),.5);}assert.deepEqual(a,b);});
test('state validation rejects local transfer tamper, gas contamination and malformed receipt',()=>{let s=run(1).s;for(const mutate of [x=>x.vector[M.TRANSFER_OFFSETS.oil_weir+1]+=.1,x=>x.vector[7]=.1,x=>x.vector[24]=.1,x=>x.vector[0]=NaN,x=>x.recipeId='wrong',x=>x.lastInterval.stream.oil[0]+=1,x=>x.lastInterval.transfers.product_dispatch[0]=1e10,x=>x.vector[29]+=.1,x=>x.lastInterval=null]){const bad=copy(s);mutate(bad);assert.throws(()=>M.validateState(bad));}});
test('browser UMD and CommonJS advance identically',()=>{const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('src/material-recipe.js','utf8'),sandbox);vm.runInContext(fs.readFileSync('src/material-model.js','utf8'),sandbox);const browser=sandbox.ESS.MaterialModel;assert.deepEqual(JSON.parse(JSON.stringify(browser.advance(browser.create(),input(),.5))),M.advance(M.create(),input(),.5));});
test('v2 preserves every physical assumption and comparison limit from archived v1',()=>{
  const old=JSON.parse(fs.readFileSync('tools/g2-live/recipe.json','utf8'));
  const allowed=new Set(['id','schema','integration']);
  for(const key of Object.keys(old))if(!allowed.has(key))assert.deepEqual(R[key],old[key]);
  for(const key of Object.keys(old.integration))if(key!=='step_rule')assert.equal(R.integration[key],old.integration[key]);
  assert.equal(old.schema,'g2-live-recipe-v1');assert.equal(R.schema,'g2-live-recipe-v2');assert.equal(R.integration.event_bisections,32);assert.equal(R.integration.maximum_events_per_frame,64);
  const bad=M.create();bad.recipeId=old.id;assert.throws(()=>M.validateState(bad),/recipe/);
});
test('localized events retain all interval transfers and survive both transitions in one call',()=>{
  const initial=run(69,input({gas_valve:0})).s;
  const single=M.advance(freeze(copy(initial)),input({gas_valve:0}),10);
  let split=copy(initial);for(let i=0;i<20;i++)split=M.advance(split,input({gas_valve:0}),.5);
  assert.equal(single.lastInterval.reliefEvents.length,2);
  assert.deepEqual(single.lastInterval.reliefEvents.map(e=>e.open),[true,false]);
  assert.ok(Math.abs(single.lastInterval.reliefEvents[0].timeMs/1000-300/4.32)<1e-8);
  assert.ok(single.lastInterval.reliefEvents[0].pressure-1100<1e-8);
  assert.ok(1000-single.lastInterval.reliefEvents[1].pressure<1e-8);
  assert.ok(single.vector.every((v,i)=>Math.abs(v-split.vector[i])<1e-9));
  assert.ok(M.truth(single).closure.passed);
  for(const t of M.TRANSFERS)for(let c=0;c<4;c++)assert.equal(single.lastInterval.transfers[t.name][c],single.vector[t.offset+c]-initial.vector[t.offset+c]);
});
test('restore rejects impossible interval generation, contradictory latch and duplicate events',()=>{
  const base=run(70,input({gas_valve:0})).s;
  const eventState=M.advance(run(69,input({gas_valve:0})).s,input({gas_valve:0}),.5);
  const generation=copy(base);generation.lastInterval.generation=[-1e6,780000,200000,20000];assert.throws(()=>M.validateState(generation),/generation/);
  const tail=copy(eventState);tail.reliefOpen=false;assert.throws(()=>M.validateState(tail),/latch/);
  const duplicate=copy(eventState);duplicate.lastInterval.reliefEvents.push(copy(duplicate.lastInterval.reliefEvents[0]));assert.throws(()=>M.validateState(duplicate),/event/);
});
test('event limit fails without mutating the caller state',()=>{
  const s=freeze(M.create()),before=JSON.stringify(s);
  assert.throws(()=>M.advance(s,input({gas_valve:0}),2500),/MATERIAL_EVENT_LIMIT/);
  assert.equal(JSON.stringify(s),before);
});
