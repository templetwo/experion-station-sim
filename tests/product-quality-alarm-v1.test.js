// @artifact dev
// Prospective receiving-product warning policy v1; no historical receipt is rescored.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Component}=require('../tools/logic-harness').load();
const K=require('../src/plant-kernel');
const copy=x=>JSON.parse(JSON.stringify(x));
function boot(materialMode='composition_mass_v1'){const c=new Component({});c.initSim(0,{materialMode});return c;}
function advance(c,n){for(let i=0;i<n;i++)c.step(.5);}
const record=(c,tag='AI511')=>c.alarmEngine.list().find(a=>a.tag===tag&&a.cond==='PVHI');
const issue=(c,id='quality.product')=>c.diagnose().find(x=>x.id===id);
function sample(c,tag,pv,overrides={}){
  Object.assign(c.L[tag],{pv,quality:'GOOD',badPv:false,statusCode:0,sourceTimeMs:c.P.t-15000,publishedTimeMs:c.P.t,ageMs:15000,...overrides});
}
function board(){const c=boot();c.P.t=30000;sample(c,'AI511',12.5);sample(c,'AI512',0);return c;}
function physical(c){return copy({P:c.P,V:c.V,composition:c.composition,product:c.product,rand:c.rand.getState(),rand4:c.rand4.getState()});}
function observedState(c){return {...physical(c),L:copy(c.L),alarms:copy(c.alarmEngine.snapshot())};}

test('quality warning v1 is composition-only and startup never alarms on unavailable samples',()=>{
  const old=boot('legacy');assert.equal(old.L.AI511,undefined);assert.equal(old.L.AI512,undefined);
  const c=boot();
  for(const [tag,limit] of [['AI511',15],['AI512',.2]]){
    assert.equal(c.L[tag].alm.PVHI[0],limit);assert.equal(c.L[tag].alm.PVHI[1],'High');
    assert.equal(c.L[tag].almDelay,0);assert.equal(c.L[tag].almDb,0);
    assert.deepEqual(Object.keys(c.L[tag].alm),['PVHI']);
  }
  for(let i=0;i<30;i++){
    assert.equal(record(c),undefined);assert.equal(record(c,'AI512'),undefined);assert.equal(issue(c),undefined);
    assert.equal(c.productAnalyzerObservation('AI511').quality,'BAD');c.step(.5);
  }
  assert.equal(c.P.t,15000);assert.equal(c.productAnalyzerObservation('AI511').quality,'GOOD');
  assert.equal(record(c),undefined);assert.equal(issue(c),undefined);
});

test('both published limits warn at equality and clear strictly below without changing routing',()=>{
  for(const [tag,limit] of [['AI511',15],['AI512',.2]]){
    const c=board(),before=physical(c);sample(c,tag,limit);c.scan(.5);
    const r=record(c,tag);assert.equal(r.state,'UNACK');assert.equal(r.prio,'High');
    assert.equal(issue(c).sev,'WARN');assert.match(issue(c).why,/at or above/);
    assert.equal(c.L[tag].quality,'GOOD','off-spec remains a valid measured value');
    assert.equal(c.composition.divertFraction,0);assert.deepEqual(physical(c),before);
    sample(c,tag,limit-1e-6);c.scan(.5);
    assert.equal(r.state,'RTNUN');assert.equal(r.live,false);assert.equal(issue(c),undefined);
  }
});

test('shared public observer verifies timestamp bounds and recomputes age rather than trusting ageMs',()=>{
  const c=board();sample(c,'AI511',16,{sourceTimeMs:10000,publishedTimeMs:25000,ageMs:0});
  const m=c.productAnalyzerObservation('AI511');assert.equal(m.quality,'GOOD');assert.equal(m.ageMs,20000);assert.equal(m.publicationAgeMs,5000);
  sample(c,'AI511',16,{sourceTimeMs:9999,publishedTimeMs:25000,ageMs:0});assert.equal(c.productAnalyzerObservation('AI511').quality,'BAD');
  sample(c,'AI511',16,{sourceTimeMs:15000,publishedTimeMs:24999,ageMs:0});assert.equal(c.productAnalyzerObservation('AI511').quality,'BAD');
});

const invalidSamples=[
  ['BAD',l=>{l.quality='BAD';}],['UNCERTAIN',l=>{l.quality='UNCERTAIN';}],['STALE',l=>{l.quality='STALE';}],
  ['badPv',l=>{l.badPv=true;}],['status Bad',l=>{l.statusCode=0x80000000;}],['status Uncertain',l=>{l.statusCode=0x40000000;}],
  ['null',l=>{l.pv=null;}],['NaN',l=>{l.pv=NaN;}],['missing quality',l=>{delete l.quality;}],
  ['missing badPv',l=>{delete l.badPv;}],['missing status',l=>{delete l.statusCode;}],['invalid status',l=>{l.statusCode=-1;}],
  ['missing source time',l=>{delete l.sourceTimeMs;}],['missing publication time',l=>{delete l.publishedTimeMs;}],
  ['future source',l=>{l.sourceTimeMs=30001;}],['future publication',l=>{l.publishedTimeMs=30001;}],
  ['source after publication',l=>{l.sourceTimeMs=29000;l.publishedTimeMs=28000;}],['negative source',l=>{l.sourceTimeMs=-1;}],
  ['stale source',l=>{l.sourceTimeMs=9999;}],['stale publication',l=>{l.publishedTimeMs=24999;}]
];
test('unknown samples neither raise nor clear warnings, and cannot accumulate limit-delay time',()=>{
  for(const [name,invalidate] of invalidSamples){
    const c=board(),l=c.L.AI511;l.almDelay=2;
    sample(c,'AI511',16);c.scan(.5);assert.equal(l._am.PVHI.onT,.5,name);
    invalidate(l);c.scan(10);assert.equal(record(c),undefined,name);assert.equal(l._am.PVHI.onT,0,name);assert.equal(l._am.PVHI.offT,0,name);
    sample(c,'AI511',16);c.scan(1.5);assert.equal(record(c),undefined,name+' fresh delay starts over');c.scan(.5);
    const r=record(c);assert.equal(r.live,true,name);
    sample(c,'AI511',0);invalidate(l);c.scan(10);
    assert.equal(r.live,true,name+' retained condition');assert.equal(l._as.PVHI,true,name);
    assert.equal(l._am.PVHI.onT,0,name);assert.equal(l._am.PVHI.offT,0,name);
    assert.equal(issue(c),undefined,name+' invalid evidence cannot support quality diagnosis');
    assert.ok(issue(c,'alarms.active'),name+' retained alarm remains covered');
    assert.ok(c.diagnose().some(x=>/AI511 reading (unavailable|uncertain)/.test(x.title)),name);
    sample(c,'AI511',0);c.scan(.5);assert.equal(r.live,false,name+' valid recovery returns condition');
  }
});

test('quality guidance follows ACK, shelf, suppression and OOS lifecycle without re-annunciation',()=>{
  const c=board();sample(c,'AI511',16);c.scan(.5);const r=record(c);
  c.ackAlarm(r);assert.equal(r.state,'ACKED');assert.equal(issue(c).sev,'WARN');
  assert.equal(c.alarmEngine.counts().unack,0);
  const transitions=[
    ['SHLVD',()=>c.alarmEngine.shelve(r,{t:c.P.t,durationMs:60000,reason:'test'}),()=>c.alarmEngine.unshelve(r,c.P.t)],
    ['DSUPR',()=>c.alarmEngine.suppress(r,'TEST.CAUSE',c.P.t),()=>c.alarmEngine.unsuppress(r,c.P.t)],
    ['OOSRV',()=>c.alarmEngine.oos(r,c.P.t),()=>c.alarmEngine.rts(r,c.P.t)]
  ];
  for(const [state,hide,show] of transitions){
    hide();assert.equal(r.state,state);assert.equal(issue(c),undefined);assert.equal(issue(c,'alarms.context').sev,'INFO');
    assert.match(issue(c,'alarms.context').why,new RegExp('AI511 PVHI \\('+state));show();assert.ok(issue(c));
  }
  sample(c,'AI511',14);c.scan(.5);assert.equal(issue(c),undefined);
});

test('quality guidance distinguishes analyzer identities and routes only by an explicit later operator action',()=>{
  const c=board();sample(c,'AI511',16);sample(c,'AI512',.3);c.scan(.5);
  const card=issue(c);assert.match(card.title,/AI511 \/ AI512/);assert.match(card.why,/delayed receiving-tank samples/);
  assert.ok(card.steps.some(s=>/TIC311, TI312/.test(s.t)));assert.ok(card.steps.some(s=>/LIC504, LIC503 and AI509/.test(s.t)));
  const go=card.steps.find(s=>/Consider manual TO OFF-SPEC/.test(s.t)).go;
  const before=physical(c);go();assert.deepEqual(physical(c),before);assert.equal(c.state.dlg.type,'logon');
  c.instr.auth=true;go();assert.equal(c.state.display,'instr');assert.deepEqual(physical(c),before);
  assert.equal(c.setMaterialDiversion(1),true);assert.equal(c.composition.divertFraction,1);
  assert.deepEqual(c.composition.material,before.composition.material,'routing does not clean current inventory');
});

test('diagnosis reads public samples without consulting composition or fault truth, and is read-only',()=>{
  const c=board();sample(c,'AI511',16);c.scan(.5);
  const before=observedState(c),events=copy(c.events),journal=copy(c.instr.journal);
  const forbid=()=>{throw Error('hidden product truth was read');};
  Object.defineProperty(c,'composition',{get:forbid});Object.defineProperty(c.P,'faults',{get:forbid});
  assert.ok(issue(c));assert.equal(c.productAnalyzerObservation('AI511').pv,16);
  assert.deepEqual(copy(c.L),before.L);assert.deepEqual(copy(c.V),before.V);assert.deepEqual(copy(c.alarmEngine.snapshot()),before.alarms);
  assert.deepEqual(c.events,events);assert.deepEqual(c.instr.journal,journal);
  assert.equal(c.rand.getState(),before.rand);assert.equal(c.rand4.getState(),before.rand4);
});

test('custom warning priorities are honored and active analyzer records remain covered at the eight-card limit',()=>{
  for(const [priority,severity] of [['High','WARN'],['Urgent','URGENT'],['Low','WARN']]){
    const c=board();c.L.AI511.alm.PVHI[1]=priority;sample(c,'AI511',16);c.scan(.5);assert.equal(issue(c).sev,severity);
  }
  const journal=board();journal.L.AI511.alm.PVHI[1]='Journal';sample(journal,'AI511',16);journal.scan(.5);
  assert.equal(record(journal),undefined,'default Journal policy is event-only');assert.equal(issue(journal),undefined);
  assert.ok(journal.events.some(e=>e.src==='AI511'&&/JOURNAL/.test(e.desc)),'custom Journal warning still emits its event');
  const c=board();c.L.AI511.alm.PVHI[1]='Urgent';sample(c,'AI511',16);c.scan(.5);
  // Fill the screen with independent equipment conditions and an otherwise uncovered alarm.
  for(const key of ['rx','batch','bed','ovf','skin','psv'])c.P.trips[key]=true;
  c.L.P101.trip=true;c.L.M202.trip=true;
  c.raiseA('LIC503','PVHH','Urgent',99,'%','independent urgent alarm');
  const cards=c.diagnose();assert.ok(cards.length<=8);assert.ok(cards.some(x=>x.sev==='URGENT'&&x.id==='alarms.active'));
  assert.ok(cards.some(x=>x.sev==='URGENT'&&(x.id==='quality.product'||(x.id==='alarms.active'&&/AI511 PVHI/.test(x.why)))));
});

test('native heater loss warns only on the delayed 1055 s sample and never changes material or routing',()=>{
  const c=boot(),control=boot();control.L.AI511.alm={};control.L.AI512.alm={};
  let truthAt=null,warningAt=null,warningPv=null;
  for(let tick=0;tick<2400;tick++){
    if(tick===1200)for(const p of [c,control]){p.setMode('TIC311','MAN');assert.equal(p.storeEntry('TIC311','OP',0),true);}
    c.step(.5);control.step(.5);
    const receiving=c.composition.material.vector.slice(16,20),fraction=receiving[0]/receiving.reduce((a,b)=>a+b,0);
    if(truthAt===null&&fraction>.15)truthAt=c.P.t;
    if(warningAt===null&&record(c)?.live){warningAt=c.P.t;warningPv=c.L.AI511.pv;assert.ok(issue(c));}
    if(c.P.t<1055000)assert.equal(record(c),undefined,'truth alone must not alarm');
    assert.equal(c.composition.divertFraction,0);
    if(tick%100===0)assert.deepEqual(physical(c),physical(control),'alarm configuration cannot change plant at '+c.P.t);
  }
  assert.equal(truthAt,1007500);assert.equal(warningAt,1055000);assert.equal(warningPv.toFixed(3),'15.096');
  assert.deepEqual(physical(c),physical(control));
});

test('custom maps and active warnings survive browser snapshot and Kernel continuation exactly',()=>{
  const c=boot();c.L.AI511.alm.PVHI=[12,'High',2];c.L.AI511.almDelay=2;c.L.AI511.almDb=.1;
  advance(c,40);assert.equal(record(c).live,true);const stored=copy(c.snapshotData('quality v1'));
  assert.equal(stored.schemaVersion,'3.1');const restored=boot();restored.restoreSnapshot(stored);
  let kernel=K.capture(K.restore(K.create({materialMode:'composition_mass_v1'})));
  const k=K.restore(kernel);k.restoreSnapshot(stored);kernel=K.capture(k);
  for(let i=0;i<24;i++){
    c.step(.5);restored.step(.5);kernel=K.advance(kernel,.5,[]).state;
    assert.deepEqual(observedState(c),observedState(restored));assert.deepEqual(observedState(c),observedState(K.restore(kernel)));
  }
  assert.deepEqual(copy(restored.L.AI511.alm.PVHI),[12,'High',2]);assert.equal(restored.L.AI511.almDelay,2);assert.equal(restored.L.AI511.almDb,.1);
});

test('old stored empty maps are not migrated and visibly identify missing quality warnings',()=>{
  const c=boot();advance(c,32);const snap=copy(c.snapshotData('old empty maps'));
  for(const tag of ['AI511','AI512']){snap.L[tag].alm={};snap.L[tag]._am={};snap.L[tag]._as={};delete snap.L[tag].almDb;delete snap.L[tag].almDelay;}
  c.restoreSnapshot(snap);assert.equal(c.compositionBoardView().warningsMissing,true);
  for(const tag of ['AI511','AI512'])assert.deepEqual(copy(c.L[tag].alm),{});
  sample(c,'AI511',73);c.scan(.5);assert.equal(record(c),undefined);assert.equal(issue(c),undefined);
  c.instr.auth=true;c.startMaterialRun();assert.equal(c.compositionBoardView().warningsMissing,false);
  assert.equal(c.L.AI511.alm.PVHI[0],15);assert.equal(c.L.AI512.alm.PVHI[0],.2);
});
