// @artifact dev
// Relief event evidence is distinct from end-of-scan truth and noisy measurement.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../tools/logic-harness');
const clone=x=>JSON.parse(JSON.stringify(x));
function boot(mode='composition_mass_v1'){
  const {Component}=load(),c=new Component({});c.initSim(0,{materialMode:mode});
  c.setMode('PIC505','MAN');assert.equal(c.storeEntry('PIC505','OP',0),true);return c;
}
function physical(c){return clone({P:c.P,L:c.L,V:c.V,composition:c.composition,product:c.product,rand:c.rand.getState(),rand4:c.rand4.getState()});}

test('localized lift and reseat journal values differ correctly from end-frame pressure',()=>{
  const c=boot(),records=[],clearCalls=[];
  const clear=c.clearA;c.clearA=function(...args){if(args[0]==='V-502')clearCalls.push(args.slice());return clear.apply(this,args);};
  for(let i=0;i<220&&records.length<4;i++){
    c.step(.5);
    for(const exact of c.composition.material.lastInterval.reliefEvents){
      const entry=c.events.find(e=>e.src==='V-502'&&e.t===c.P.t&&e.desc.includes(exact.open?' ALARM ':' RETURN TO NORMAL'));
      assert.ok(entry,'transition must be journaled');
      records.push({exact:clone(exact),frameMs:c.P.t,pressure:c.P.s.pres,pv:c.L.PIC505.pv,entry:clone(entry)});
    }
  }
  assert.equal(records.length,4);
  for(const row of records){
    assert.ok(row.exact.timeMs>row.frameMs-500&&row.exact.timeMs<=row.frameMs);
    assert.equal(row.entry.t,row.frameMs,'journal clock intentionally remains the processing scan');
    assert.ok(Math.abs(row.pv-row.pressure)<=1,'PIC505 retains existing measurement noise');
    if(row.exact.open){
      assert.ok(row.exact.pressure>=1100&&row.exact.pressure<1100+1e-8);
      assert.ok(row.pressure<1100,'gas has vented during the remaining scan');
      assert.equal(row.entry.newV,'1100.0');
    }else{
      assert.ok(row.exact.pressure<1000&&row.exact.pressure>1000-1e-8);
      assert.ok(row.pressure>1000,'gas has accumulated after reseat within the same scan');
      assert.equal(row.entry.newV,'1000.0','RTN must format the exact reseat pressure, not the earlier lift');
    }
  }
  const reseats=records.filter(r=>!r.exact.open);
  assert.equal(clearCalls.length,2);
  reseats.forEach((r,i)=>assert.equal(clearCalls[i][2],r.exact.pressure));
});

test('forwarding localized pressure changes journal evidence only, with identical physical trajectories',()=>{
  const corrected=boot(),previous=boot();
  // Reproduce the former Core seam, which discarded optional reset pressure.
  previous.modelCtx().clear=(src,cond)=>previous.clearA(src,cond);
  let sawDifference=false;
  for(let i=0;i<220;i++){
    corrected.step(.5);previous.step(.5);
    assert.deepEqual(physical(corrected),physical(previous));
    if(corrected.composition.material.lastInterval.reliefEvents.some(e=>!e.open)){
      const a=corrected.events.find(e=>e.src==='V-502'&&e.desc.includes('RETURN TO NORMAL'));
      const b=previous.events.find(e=>e.src==='V-502'&&e.desc.includes('RETURN TO NORMAL'));
      assert.equal(a.newV,'1000.0');assert.equal(b.newV,'1100.0');sawDifference=true;
    }
  }
  assert.ok(sawDifference);
});

test('legacy relief keeps its historical callback and alarm journal behavior',()=>{
  const corrected=boot('legacy'),previous=boot('legacy');
  previous.modelCtx().clear=(src,cond)=>previous.clearA(src,cond);
  const clearCalls=[],clear=corrected.clearA;
  corrected.clearA=function(...args){if(args[0]==='V-502')clearCalls.push(args.slice());return clear.apply(this,args);};
  for(let i=0;i<500;i++){corrected.step(.5);previous.step(.5);}
  assert.deepEqual(physical(corrected),physical(previous));
  assert.deepEqual(corrected.events,previous.events);
  assert.deepEqual(corrected.alarmEngine.snapshot(),previous.alarmEngine.snapshot());
  assert.ok(clearCalls.length>0);assert.ok(clearCalls.every(args=>args.length===2));
});
