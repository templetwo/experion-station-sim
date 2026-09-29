// @artifact dev
// Prospective presentation-v1 policy after fd8b6f4; historical receipts stay unchanged.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('../tools/logic-harness');
function boot(materialMode='legacy'){const {Component}=load();const c=new Component({});c.initSim(0,{materialMode});return c;}
const issue=(c,id)=>c.diagnose().find(x=>x.id===id);
const live=(c,tag,cond)=>c.alarmEngine.list().find(a=>a.tag===tag&&a.cond===cond&&a.live);
const announced=a=>a&&a.live&&['UNACK','ACKED'].includes(a.state);
const urgent=c=>c.diagnose().filter(x=>x.sev==='URGENT');
const copy=x=>JSON.parse(JSON.stringify(x));
function closeVent(c){c.setMode('PIC505','MAN');assert.equal(c.storeEntry('PIC505','OP',0),true);}

// These assertions intentionally replace the old assistant policy that treated
// every live alarm record as urgent, including dynamically suppressed records.
test('first native lift at72s has one urgent relief card with PIC505 suppression context and unchanged banner counts',()=>{
 const c=boot('composition_mass_v1');closeVent(c);for(let i=0;i<144;i++)c.step(.5);
 const relief=live(c,'V-502','PSV LIFT');assert.equal(c.P.t,72000);assert.equal(relief.state,'UNACK');
 const children=c.alarmEngine.list().filter(a=>a.tag==='PIC505');assert.ok(children.length>=2);
 assert.ok(children.every(a=>a.state==='DSUPR'&&a.suppressedBy==='V-502.PSV LIFT'));
 assert.deepEqual(urgent(c).map(x=>x.id),['trip.psv502']);assert.equal(issue(c,'pressure.505'),undefined);assert.equal(issue(c,'alarms.active'),undefined);
 const counts=copy(c.alarmEngine.counts()),message=issue(c,'trip.psv502');
 assert.equal(counts.Urgent,1);assert.match(message.why,/Informational suppressed context/);
 for(const child of children){assert.ok(message.why.includes(child.tag+' '+child.cond));assert.ok(message.why.includes('suppressed by '+child.suppressedBy));}
 assert.ok(message.why.includes('Alarm banner: '+counts.total+' active'));
 const before=JSON.stringify({P:c.P,L:c.L,V:c.V,composition:c.composition,product:c.product,alarms:c.alarmEngine.snapshot(),events:c.events,rand:c.rand.getState(),rand4:c.rand4.getState()});
 c.setState({assist:true,assistSel:'trip.psv502'});const view=c.renderVals(),rendered=view.asst.issues.find(x=>/PSV-502 lifted/.test(x.title));
 assert.equal(rendered.open,true);assert.equal(rendered.sev,'URGENT');assert.match(rendered.why,/PIC505 PVHH.*DSUPR.*suppressed by V-502\.PSV LIFT/);
 assert.equal(view.cU,counts.Urgent);assert.equal(view.cH,counts.High);assert.equal(view.cL,counts.Low);
 assert.equal(view.asst.alarmCounts,'Alarm banner: 1 active · 1 unacknowledged (includes returned)');
 assert.equal(view.asst.alarmContextCounts,'Context: 2 suppressed · 0 shelved · 0 out of service');
 assert.equal(JSON.stringify({P:c.P,L:c.L,V:c.V,composition:c.composition,product:c.product,alarms:c.alarmEngine.snapshot(),events:c.events,rand:c.rand.getState(),rand4:c.rand4.getState()}),before,'presentation must not mutate plant, alarm records, ledgers or random streams');
 c.ackAlarm(relief);assert.equal(relief.state,'ACKED');assert.deepEqual(urgent(c).map(x=>x.id),['trip.psv502']);
 assert.equal(c.alarmEngine.counts().Urgent,1);assert.equal(c.alarmEngine.counts().unack,0);
 assert.equal(c.renderVals().asst.alarmCounts,'Alarm banner: 1 active · 0 unacknowledged (includes returned)');
});

test('native reseat releases suppression and makes eligible high-pressure guidance visible again',()=>{
 const c=boot('composition_mass_v1');closeVent(c);for(let i=0;i<144;i++)c.step(.5);
 assert.equal(issue(c,'pressure.505'),undefined);
 for(let i=0;i<14;i++)c.step(.5);
 assert.equal(c.P.t,79000);assert.equal(issue(c,'trip.psv502'),undefined);
 const pressure=issue(c,'pressure.505');assert.ok(pressure);
 const alarms=c.alarmEngine.list().filter(a=>a.tag==='PIC505'&&['PVHI','PVHH'].includes(a.cond));
 assert.ok(alarms.some(announced));assert.ok(alarms.filter(announced).every(a=>a.suppressedBy===''));
 assert.equal(issue(c,'alarms.active'),undefined,'already-covered pressure alarms must not be counted again');
 assert.equal(issue(c,'alarms.review').sev,'INFO');assert.match(issue(c,'alarms.review').why,/V-502 PSV LIFT.*RTNUN/);
});

test('independent uncovered urgent alarm remains prominent beside relief without repeating covered symptoms',()=>{
 const c=boot('composition_mass_v1');closeVent(c);for(let i=0;i<144;i++)c.step(.5);
 c.raiseA('LIC503','PVHH','Urgent',95,'%', 'INDEPENDENT CHAMBER LEVEL HIGH');
 const row=live(c,'LIC503','PVHH');assert.equal(row.state,'UNACK');
 assert.deepEqual(urgent(c).map(x=>x.id).sort(),['alarms.active','trip.psv502']);
 const summary=issue(c,'alarms.active');assert.match(summary.title,/1 condition$/);assert.match(summary.why,/LIC503 PVHH \(UNACK\)/);
 assert.doesNotMatch(summary.why,/PIC505 PVH|V-502 PSV LIFT/);assert.equal(c.alarmEngine.counts().Urgent,2);
 c.ackAlarm(row);assert.equal(row.state,'ACKED');assert.equal(issue(c,'alarms.active').sev,'URGENT');assert.match(issue(c,'alarms.active').why,/LIC503 PVHH \(ACKED\)/);
});

test('suppressed, shelved and out-of-service pressure or relief records are INFO context, never urgent diagnoses',()=>{
 for(const target of [{tag:'PIC505',cond:'PVHH',card:'pressure.505'},{tag:'V-502',cond:'PSV LIFT',card:'trip.psv502'}]){
  for(const state of ['DSUPR','SHLVD','OOSRV']){
   const c=boot();c.L.PIC505.pv=1120;c.raiseA(target.tag,target.cond,'Urgent',1120,'KPA','TEST');
   const row=live(c,target.tag,target.cond);assert.equal(issue(c,target.card).sev,'URGENT');
   if(state==='DSUPR')c.alarmEngine.suppress(row,'TEST.PARENT',c.P.t);
   if(state==='SHLVD')c.alarmEngine.shelve(row,{durationMs:60000,reason:'test',t:c.P.t});
   if(state==='OOSRV')c.alarmEngine.oos(row,c.P.t);
   assert.equal(row.state,state);assert.equal(issue(c,target.card),undefined);assert.equal(issue(c,'alarms.active'),undefined);
   assert.deepEqual(urgent(c),[]);const context=issue(c,'alarms.context');assert.equal(context.sev,'INFO');
   assert.ok(context.why.includes(target.tag+' '+target.cond+' ('+state));assert.match(context.why,/suppression does not establish recovery/);
   if(state==='DSUPR')assert.match(context.why,/suppressed by TEST\.PARENT/);
   assert.equal(c.alarmEngine.counts().Urgent,0);
  }
 }
});

test('alarm-backed legacy trip flags cannot re-annunciate shelved or suppressed trip records',()=>{
 for(const state of ['DSUPR','SHLVD','OOSRV']){
  const c=boot();c.P.trips.rx=true;c.raiseA('R-201','HI TEMP TRIP','Urgent',185,'DEG C','REACTOR TRIP');
  assert.equal(issue(c,'trip.rx').sev,'URGENT');const row=live(c,'R-201','HI TEMP TRIP');
  if(state==='DSUPR')c.alarmEngine.suppress(row,'TEST.PARENT',c.P.t);
  if(state==='SHLVD')c.alarmEngine.shelve(row,{durationMs:60000,reason:'test',t:c.P.t});
  if(state==='OOSRV')c.alarmEngine.oos(row,c.P.t);
  assert.equal(c.P.trips.rx,true);assert.equal(issue(c,'trip.rx'),undefined);assert.equal(issue(c,'alarms.context').sev,'INFO');assert.deepEqual(urgent(c),[]);
 }
});

test('returned urgent backlog is review information and never a new urgent process assertion',()=>{
 const c=boot();
 for(const tag of ['LI215','LIC503','LIC504','PI214','TI314','TI315']){c.raiseA(tag,'PVHH','Urgent',999,'','TEST');c.clearA(tag,'PVHH',0);}
 assert.equal(c.alarmEngine.counts().unack,6);assert.equal(c.alarmEngine.counts().Urgent,0);
 assert.deepEqual(urgent(c),[]);assert.equal(issue(c,'alarms.active'),undefined);assert.equal(issue(c,'alarms.review').sev,'INFO');
 const backlog=issue(c,'flood');if(backlog)assert.equal(backlog.sev,'INFO');
});

test('eight-card limit keeps independent urgent coverage and names any displaced specific alarm',()=>{
 const c=boot();
 const entries=[
  ['trip.rx','R-201','HI TEMP TRIP',()=>{c.P.trips.rx=true;}],
  ['trip.b','R-202','HI TEMP TRIP',()=>{c.P.trips.batch=true;}],
  ['trip.bed','R-310','HI TEMP TRIP',()=>{c.P.trips.bed=true;}],
  ['trip.ovf','TK-101','HIHI TRIP',()=>{c.P.trips.ovf=true;}],
  ['trip.skin','H-310','TUBE SKIN TRIP',()=>{c.P.trips.skin=true;}],
  ['trip.psv','V-401','PSV LIFT',()=>{c.P.trips.psv=true;}],
  ['mtrip.P101','P101','TRIP',()=>{c.L.P101.trip=true;c.L.P101.run=false;}],
  ['mtrip.M202','M202','TRIP',()=>{c.L.M202.trip=true;c.L.M202.run=false;}]
 ];
 for(const [id,tag,condition,activate] of entries){activate();c.raiseA(tag,condition,'Urgent',999,'','TEST');}
 c.raiseA('LIC503','PVHH','Urgent',95,'%','INDEPENDENT LEVEL');
 const cards=c.diagnose(),summary=cards.find(x=>x.id==='alarms.active');
 assert.equal(c.alarmEngine.counts().Urgent,9);assert.ok(cards.length<=8);assert.ok(summary,'card limit cannot hide the only coverage for an independent urgent alarm');
 assert.equal(summary.sev,'URGENT');assert.match(summary.why,/LIC503 PVHH/);
 const displaced=entries.filter(([id])=>!cards.some(x=>x.id===id));assert.ok(displaced.length>=1);
 for(const [,tag,condition] of displaced)assert.ok(summary.why.includes(tag+' '+condition),'omitted specific diagnosis must be named in the surviving summary');
 assert.ok(summary.why.includes('9 Urgent'),'alarm counts describe engine records, not eight displayed cards');
});

test('retained Journal records preserve engine counts without acquiring urgent diagnosis priority',()=>{
 const c=boot();c.alarmEngine=globalThis.ESS.AlarmEngine.createEngine({recordJournal:true});
 c.raiseA('TIC202','PVLO','Journal',10,'DEG C','JOURNAL TEST');
 const counts=c.alarmEngine.counts();assert.equal(counts.Journal,1);assert.equal(counts.total,1);assert.equal(counts.Urgent,0);
 const summary=issue(c,'alarms.active');assert.ok(summary);assert.equal(summary.sev,'INFO');assert.match(summary.why,/TIC202 PVLO/);
 assert.deepEqual(urgent(c),[]);assert.ok(summary.why.includes('Alarm banner: 1 active'));
});

test('always-visible count lines bind engine totals and context separately from collapsed diagnosis cards',()=>{
 const c=boot();let view=c.renderVals();assert.equal(view.asst.issues.length,1);
 assert.equal(view.asst.alarmCounts,'Alarm banner: 0 active · 0 unacknowledged (includes returned)');
 const E=c.alarmEngine;
 for(const tag of ['LIC503','LIC504','LI215','PI214'])c.raiseA(tag,'PVHI','High',90,'','TEST');
 E.suppress('LIC503.PVHI','TEST.PARENT',0);E.shelve('LIC504.PVHI',{durationMs:60000,reason:'test',t:0});E.oos('LI215.PVHI',0);c.clearA('PI214','PVHI',0);
 c.setState({assist:true,assistSel:null});view=c.renderVals();
 assert.ok(view.asst.issues.every(x=>!x.open));assert.equal(view.asst.alarmCounts,'Alarm banner: 0 active · 1 unacknowledged (includes returned)');
 assert.equal(view.asst.alarmContextCounts,'Context: 1 suppressed · 1 shelved · 1 out of service');
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../Experion Station Simulator.dc.html'),'utf8');
 const start=html.indexOf('>LIVE DIAGNOSIS</div>'),end=html.indexOf('<sc-for list="{{ asst.issues }}"',start);
 assert.ok(start>=0&&end>start);const header=html.slice(start,end);
 assert.ok(header.includes('{{ asst.alarmCounts }}'));assert.ok(header.includes('{{ asst.alarmContextCounts }}'));
 assert.doesNotMatch(header,/<sc-if\b/,'counts must not depend on opening a diagnosis card');
});
