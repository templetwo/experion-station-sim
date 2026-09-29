// @artifact dev
// Operator-visible diagnosis coverage; no process or controller changes.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../tools/logic-harness');
function boot(materialMode='legacy'){const {Component}=load();const c=new Component({});c.initSim(0,{materialMode});return c;}
const issue=(c,id)=>c.diagnose().find(x=>x.id===id);
const live=(c,tag,cond)=>c.alarmEngine.list().find(a=>a.tag===tag&&a.cond===cond&&a.live);
function closeVent(c){c.setMode('PIC505','MAN');assert.equal(c.storeEntry('PIC505','OP',0),true);}

test('fresh composition vent closure diagnoses every lift and pressure alarm between repeated reseats',()=>{
 const c=boot('composition_mass_v1');closeVent(c);
 let lifts=0,returns=0,previous=false,renderChecked=false;
 for(let i=0;i<800;i++){
  c.step(.5);const relief=live(c,'V-502','PSV LIFT'),high=live(c,'PIC505','PVHH')||live(c,'PIC505','PVHI');
  const messages=c.diagnose();
  if(relief){
   assert.ok(messages.some(x=>x.id==='trip.psv502'&&x.sev==='URGENT'));
   if(!previous){lifts++;c.ackAlarm(relief);assert.ok(issue(c,'trip.psv502'),'ACKED relief remains active');}
   if(!renderChecked){assert.ok(c.renderVals().asst.issues.some(x=>/PSV-502 lifted/.test(x.title)));renderChecked=true;}
  }else if(previous){returns++;assert.equal(issue(c,'trip.psv502'),undefined,'a returned alarm must not claim the relief remains lifted');}
  if(high){
   const pressure=messages.find(x=>x.id==='pressure.505');assert.ok(pressure);
   assert.match(pressure.why,/MAN|held at 0\.0%/);assert.match(pressure.why,/not adjust automatically/);
  }
  if(relief||high)assert.ok(!messages.some(x=>x.id==='ok'));
  previous=!!relief;
 }
 assert.ok(lifts>=2&&returns>=2,'exercise actual repeated native lift/reseat cycles');
});

test('legacy separator relief uses the same visible alarm diagnosis',()=>{
 const c=boot();closeVent(c);
 for(let i=0;i<1600&&!live(c,'V-502','PSV LIFT');i++)c.step(.5);
 assert.ok(live(c,'V-502','PSV LIFT'));assert.ok(issue(c,'trip.psv502'));
 assert.ok(issue(c,'pressure.505'));assert.equal(issue(c,'ok'),undefined);
});

test('otherwise unhandled active alarms retain summary coverage when acknowledged or shelved',()=>{
 const c=boot();c.raiseA('LIC503','PVHI','High',90,'%', 'CHAMBER LEVEL HIGH');
 let row=live(c,'LIC503','PVHI');assert.ok(row);
 const assertCovered=()=>{const x=issue(c,'alarms.active');assert.ok(x);assert.match(x.why,/LIC503 PVHI/);assert.equal(issue(c,'ok'),undefined);};
 assertCovered();c.ackAlarm(row);assert.equal(row.state,'ACKED');assertCovered();
 c.alarmEngine.shelve(row,60000,'test visible shelf',c.P.t);assert.equal(row.state,'SHLVD');assertCovered();
});

test('returned alarms get review guidance without being called active process conditions',()=>{
 const c=boot();c.raiseA('V-502','PSV LIFT','Urgent',1100,'KPA','RELIEF');c.clearA('V-502','PSV LIFT',999);
 assert.equal(c.alarmEngine.list()[0].state,'RTNUN');
 assert.equal(issue(c,'trip.psv502'),undefined);assert.equal(issue(c,'alarms.active'),undefined);
 assert.match(issue(c,'alarms.review').why,/Returned alarms may still await acknowledgement/);
 assert.equal(issue(c,'ok'),undefined);
});

test('bad or uncertain pressure readings do not establish high pressure even when a retained alarm exists',()=>{
 for(const quality of ['BAD','UNCERTAIN']){
  const c=boot();c.L.PIC505.pv=1120;c.L.PIC505.quality=quality;c.L.PIC505.badPv=false;
  c.raiseA('PIC505','PVHH','Urgent',1120,'KPA','PRESSURE HIGH');
  assert.equal(issue(c,'pressure.505'),undefined);
  const bad=issue(c,(quality==='BAD'?'badpv.':'uncertain.')+'PIC505');assert.ok(bad);
  assert.match(bad.why,/does not establish the current process condition/);
  assert.doesNotMatch(JSON.stringify(bad),/transmitter signal failed|loop shed to MAN/);
  assert.ok(issue(c,'alarms.active'));assert.equal(issue(c,'ok'),undefined);
  c.raiseA('V-502','PSV LIFT','Urgent',1100,'KPA','RELIEF');
  assert.ok(issue(c,'trip.psv502'),'an independent active relief alarm remains board evidence');
 }
});

test('separator diagnosis reads public observations rather than hidden material, pressure or fault truth',()=>{
 const c=boot();c.L.PIC505.pv=1080;c.setMode('PIC505','MAN');
 c.raiseA('PIC505','PVHH','Urgent',1080,'KPA','PRESSURE HIGH');
 const before=JSON.stringify({L:c.L,V:c.V,alarms:c.alarmEngine.snapshot(),rand:c.rand.getState(),rand4:c.rand4.getState()});
 const forbidden=()=>{throw Error('hidden truth read');};
 Object.defineProperty(c,'composition',{get:forbidden});Object.defineProperty(c.P,'s',{get:forbidden});Object.defineProperty(c.P,'faults',{get:forbidden});
 assert.ok(issue(c,'pressure.505'));assert.equal(issue(c,'trip.psv502'),undefined);
 assert.equal(JSON.stringify({L:c.L,V:c.V,alarms:c.alarmEngine.snapshot(),rand:c.rand.getState(),rand4:c.rand4.getState()}),before);
});

test('no-rule message is scoped rather than declaring the plant healthy',()=>{
 const c=boot(),x=issue(c,'ok');assert.ok(x);
 assert.equal(x.title,'No configured diagnosis matched');
 assert.match(x.why,/does not establish that every loop or process condition is normal/);
 assert.doesNotMatch(x.why,/All loops near setpoint/);
});
