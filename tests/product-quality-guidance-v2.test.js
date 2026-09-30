// @artifact dev
// Prospective guidance supplement after 3c29b29; warning-v1 receipts remain historical.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Component}=require('../tools/logic-harness').load();
const Help=require('../src/alarm-help');
const copy=x=>JSON.parse(JSON.stringify(x));
function boot(){const c=new Component({});c.initSim(0,{materialMode:'composition_mass_v1'});for(let i=0;i<60;i++)c.step(.5);return c;}
function sample(c,tag,pv){Object.assign(c.L[tag],{pv,quality:'GOOD',badPv:false,statusCode:0,sourceTimeMs:c.P.t-15000,publishedTimeMs:c.P.t,ageMs:15000});}
function warning(tags=['AI511','AI512']){const c=boot();sample(c,'AI511',tags.includes('AI511')?18:12.5);sample(c,'AI512',tags.includes('AI512')?.3:0);c.scan(.5);return c;}
const card=c=>c.diagnose().find(x=>x.id==='quality.product');
const prose=x=>[x.why,...x.steps.map(s=>s.t)].join(' ');
const process=c=>copy({P:c.P,L:c.L,V:c.V,composition:c.composition,product:c.product,alarms:c.alarmEngine.snapshot(),rand:c.rand.getState(),rand4:c.rand4.getState()});

test('guidance v2 gives trainees available review actions and asks an instructor to review routing',()=>{
  for(const role of ['OPER','SUPV','ENGR']){
    const c=warning();c.setState({sec:role});assert.equal(c.instructorAllowed(),false);
    const x=card(c),route=x.steps.find(s=>/TO OFF-SPEC/.test(s.t));assert.ok(route);
    assert.match(route.t,/ask.*instructor/i);assert.equal(route.go,undefined,'trainee must not receive an inaccessible instructor GO');
    const before=process(c),tags=Object.keys(c.L);
    for(const step of x.steps)if(step.go){step.go();assert.notEqual(c.state.display,'instr');assert.notEqual(c.state.dlg?.type,'logon');}
    assert.deepEqual(process(c),before);assert.deepEqual(Object.keys(c.L),tags);
    assert.equal(c.setMaterialDiversion(1),false);assert.deepEqual(process(c),before);
  }
});

test('authorized routing review remains navigation only until the existing manual action is invoked',()=>{
  for(const access of ['manager','instructor']){
    const c=warning();if(access==='manager')c.setState({sec:'MNGR'});else c.instr.auth=true;
    assert.equal(c.instructorAllowed(),true);const before=process(c),x=card(c);
    for(const step of x.steps)if(step.go)step.go();assert.deepEqual(process(c),before,'guidance GO must never operate routing');
    assert.equal(c.composition.divertFraction,0);assert.equal(c.setMaterialDiversion(1),true);assert.equal(c.composition.divertFraction,1);
    assert.deepEqual(c.composition.material,before.composition.material,'manual route changes do not clean stored product');
  }
});

test('A guidance and Alarm Help disclose the missing inlet assay and cannot promise recovery from temperature or time',()=>{
  const c=warning(['AI511']),help=Help.resolve('AI511','PVHI');assert.equal(help.found,true);
  for(const text of [prose(card(c)),help.correctiveAction]){
    assert.match(text,/retained|isolated/i);assert.match(text,/tank/i);assert.match(text,/incoming/i);
    assert.match(text,/no incoming.*A (analy[sz]er|reading)/i);
    assert.match(text,/temperatures?.*(do not|does not|cannot|not proof|not establish)/i);
    assert.match(text,/(elapsed|flushing) time/i);assert.match(text,/flush/i);
    assert.match(text,/instructor.*review|review.*instructor/i);
    assert.doesNotMatch(text,/(?:wait|flush for) \d+ (?:minutes?|seconds?)/i,'there is no new fixed release timer');
  }
});

test('water guidance distinguishes AI509 draw volume proxy from AI512 receiving-tank mass percentage',()=>{
  const c=warning(['AI512']),help=Help.resolve('AI512','PVHI');assert.equal(help.found,true);
  for(const text of [prose(card(c)),help.correctiveAction]){
    assert.match(text,/AI509/);assert.match(text,/volume/i);assert.match(text,/0\.30\s*%/);assert.match(text,/proxy/i);
    assert.match(text,/AI512/);assert.match(text,/mass/i);assert.match(text,/not compare|cannot compare|not directly comparable/i);
    assert.match(text,/retained/);assert.match(text,/incoming/i);assert.match(text,/instructor.*review|review.*instructor/i);
  }
  // The existing instruments can legitimately disagree: AI509's declared
  // display floor is above the numeric AI512 limit, but the bases differ.
  const quiet=boot();assert.equal(quiet.L.AI509.pv,.3);assert.equal(quiet.L.AI512.pv,0);assert.equal(quiet.L.AI512.alm.PVHI[0],.2);
  assert.equal(card(quiet),undefined);sample(quiet,'AI512',.21);quiet.scan(.5);
  assert.ok(card(quiet));assert.equal(quiet.L.AI509.pv,.3);
  assert.equal(quiet.alarmEngine.list().some(a=>a.tag==='AI509'&&a.live),false);
});

test('guidance uses published warning evidence and does not read routing or hidden material to infer recovery',()=>{
  const c=warning(),before=process(c),initial=JSON.stringify(card(c));
  c.composition.divertFraction=1;assert.equal(JSON.stringify(card(c)),initial,'instruction must state the limitation rather than infer quality from route');
  const deny=()=>{throw Error('hidden material read by guidance');};
  Object.defineProperty(c,'composition',{get:deny});Object.defineProperty(c.P,'faults',{get:deny});
  assert.equal(JSON.stringify(card(c)),initial);
  assert.deepEqual(copy(c.L),before.L);assert.deepEqual(copy(c.V),before.V);assert.deepEqual(copy(c.alarmEngine.snapshot()),before.alarms);
  assert.equal(c.rand.getState(),before.rand);assert.equal(c.rand4.getState(),before.rand4);
});

test('full render selects the U4 dock by effective display in both modes, including protected-display fallback',()=>{
  for(const materialMode of ['legacy','composition_mass_v1']){
    const c=new Component({});c.initSim(0,{materialMode});
    for(const unit of ['U1','U2','U3','U4']){
      c.setState({unit,display:'graphic'});const view=c.renderVals();
      assert.equal(view.pal.floating,unit!=='U4',materialMode+' '+unit);
      assert.equal(view.isG4,unit==='U4');
    }
    c.setState({unit:'U4'});
    for(const display of ['alarms','events','msgs','trend','detail','sys','kpi','arch']){
      c.setState({display});const view=c.renderVals();assert.equal(view.pal.floating,true,display);assert.equal(view.isG4,false);
    }
    c.setState({display:'instr',sec:'OPER'});c.instr.auth=false;
    let view=c.renderVals();assert.equal(c.effDisplay(),'graphic');assert.equal(view.isG4,true);assert.equal(view.pal.floating,false);
    c.instr.auth=true;view=c.renderVals();assert.equal(view.isInstr,true);assert.equal(view.isG4,false);assert.equal(view.pal.floating,true);
  }
});

test('rendered U4 dock opens the offline assistant without a model call or plant mutation',()=>{
  const c=boot();c.setState({unit:'U4',display:'graphic',assist:false,coachLive:false});
  const savedFetch=globalThis.fetch,before=process(c);
  globalThis.fetch=()=>{throw Error('dock attempted network access');};
  c.coachAsk=()=>{throw Error('offline dock attempted model call');};
  try{
    const view=c.renderVals();assert.equal(view.pal.floating,false);assert.equal(typeof view.pal.click,'function');
    view.pal.click();assert.equal(c.state.assist,true);assert.equal(c.state.coachStatus,'OFFLINE');
    assert.deepEqual(process(c),before);assert.equal(c.renderVals().asst.on,true);
    c.setState({coachMood:'think',coachThink:'Local display-state fixture'});
    assert.equal(c.renderVals().pal.dockText,'Local display-state fixture');
  }finally{globalThis.fetch=savedFetch;}
});
