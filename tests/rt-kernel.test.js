// @artifact dev
const test=require('node:test'),assert=require('node:assert/strict');
const K=require('../src/plant-kernel'),C=require('../src/control-contract'),M=require('../src/product-meter'),P=require('../src/plant-projection');
const {Component}=require('../tools/logic-harness').load();
const command=(call,revision=0)=>({command_id:'test.command',call,principal:{id:'PIP',role:'subject'},expected_control_revision:revision});
const loop=(target,mode,value,unit,expected='AUTO')=>({operation:'loop.set',arguments:{target,expected_mode:expected,mode,demand:{field:mode==='AUTO'?'SP':'OP',value_milli:value,unit}}});

test('RT01 complete shared semantic step matches the browser across all four units and disturbances',()=>{
 for(const upset of [null,'surge','cool','air','bedact','agit']){
  const browser=new Component({});browser.initSim(0);let s=K.create();
  if(upset){browser.injectFault(upset,true);let c=K.restore(s);c.injectFault(upset,true);s=K.capture(c);}
  // Drive full scans, including PID/alarm/interlocks/phase prompts/fault schedules.
  for(let i=0;i<120;i++){browser.step(.5);s=K.advance(s,.5,[]).state;}
  for(const k of ['P','L','V','vLag','tadShed','phaseSet','_lastPhase'])assert.deepEqual(s.fields[k],JSON.parse(JSON.stringify(browser[k])),upset+' '+k);
  assert.deepEqual(s.alarms,browser.alarmEngine.snapshot());assert.equal(s.rand,browser.rand.getState());assert.equal(s.rand4,browser.rand4.getState());
 }
});

test('RT02 full checkpoint restores a running batch, delayed alarms, histories and scheduled fault',()=>{
 let c=K.restore(K.create());c.seqCmd('START');c.L.LIC101._am={PVHI:{raw:true,active:false,onT:23,offT:0}};c.scheduleArchFault({faultId:'HISTORIAN_GAP',targetNodeId:'SVC-HISTORY',delaySec:5,durationSec:5,mode:'STEP',rampSec:0});
 let s=K.capture(c);for(let i=0;i<8;i++)s=K.advance(s,.5,[]).state;
 let restored=K.capture(K.restore(JSON.parse(K.stable(s))));
 for(let i=0;i<24;i++){s=K.advance(s,.5,[]).state;restored=K.advance(restored,.5,[]).state;assert.equal(K.stable(s),K.stable(restored));}
});

test('RT07 native modes, unit checks, PROGRAM ownership and interlock fencing',()=>{
 const c=K.restore(K.create());
 assert.equal(C.validate(c,loop('FIC102','CAS',45000,'M3/H','CAS'),{role:'subject'}),'cascade_demand_forbidden');
 assert.equal(C.validate(c,loop('TIC502','MAN',40000,'DEG C'),{role:'subject'}),'wrong_unit');
 c.L.TIC502.modeAttr='PROGRAM';assert.equal(C.validate(c,loop('TIC502','AUTO',45000,'DEG C'),{role:'operator'}),'program_owned');
 c.tadShed=true;assert.equal(C.validate(c,loop('FIC211','MAN',0,'%'),{role:'operator'}),'native_interlock');
});

test('RT12 exceptions discard all candidate mutations and nonfinite state is rejected',()=>{
 const s=K.create(),before=K.stable(s),reduce=C.reduce;
 C.reduce=(c)=>{c.L.TIC502.sp=999;throw Error('injected_reducer_failure');};
 try{assert.throws(()=>K.advance(s,.5,[command(loop('TIC502','AUTO',46000,'DEG C'))]),/injected/);}finally{C.reduce=reduce;}
 assert.equal(K.stable(s),before);assert.throws(()=>K.stable({a:NaN}),/nonfinite/);assert.equal(K.stable({a:-0}),'{"a":0}');
});

test('RT17 meter uses the exact pre-update flow and adds no PRNG draws',()=>{
 const s=K.create(),c=K.restore(s),model=require('../src/models');let sample;
 const ctx=c.modelCtx();ctx.productSample=x=>sample=x;
 // Initial valve is 0.5 and chamber 50%; first interval draw is exactly 34 m3/h.
 model.stepU4(c.P,c.L,c.V,.5,ctx);assert.equal(sample.draw_rate_m3h,34);
 const next=K.advance(s,.5,[]).state;assert.equal(next.product.draw,34);assert.equal(next.product.gross,34*.5/3600);
});

test('RT18 missing and BAD quality count as unknown, never qualified',()=>{
 let c=K.restore(K.create());const m=M.create(c.P);c.L.AI509.badPv=true;M.advance(m,c.P,c.L,{draw_rate_m3h:34,dt_s:.5},.5);assert.equal(m.qualified,0);assert.equal(m.covered_ms,0);assert.equal(m.unknown,m.gross);
 delete c.L.AI509;M.advance(m,c.P,c.L,{draw_rate_m3h:34,dt_s:.5},.5);assert.equal(m.qualified,0);
});

test('RT15 subject projection contains no instructor truth, internal state or free fault labels',()=>{
 const s=K.create();s.fields.P.faults.secret='HIDDEN_SENTINEL';s.fields.P.archPending.push({secret:'HIDDEN_SENTINEL'});
 const publicText=JSON.stringify(P.project(s,'subject'));assert.ok(!publicText.includes('HIDDEN_SENTINEL'));assert.ok(!publicText.includes('archPending'));assert.throws(()=>P.project(s,'unknown'));
});

test('RT25 HOLD/RESUME are explicit idempotent intents and preserve the native shed',()=>{
 let c=K.restore(K.create());c.seqCmd('START');let s=K.capture(c);
 const call={operation:'sequence.command',arguments:{target:'SCM202',command:'HOLD',expected_phase:'CHARGE'}};
 let a=K.advance(s,.5,[command(call)]);assert.equal(a.outcomes[0].status,'applied');assert.equal(a.state.fields.P.b.held,true);
 a=K.advance(a.state,.5,[command(call,1)]);assert.equal(a.outcomes[0].status,'no_effect');assert.equal(a.state.fields.P.b.held,true);
 c=K.restore(a.state);c.tadShed=true;call.arguments.command='RESUME';assert.equal(C.validate(c,call,{role:'subject'}),'native_interlock');
});

test('RT19 inventory depletion cannot masquerade as sustained new production',()=>{
 const c=K.restore(K.create()),m=M.create(c.P);c.P.s.h2-=.02;
 M.advance(m,c.P,c.L,{draw_rate_m3h:100,dt_s:.5},.5);
 const p=M.project(m);assert.ok(p.gross_volume_um3>0);assert.ok(p.inventory_current_um3<p.inventory_start_um3);
 assert.equal(m.gross,100*.5/3600);assert.ok(Math.abs((m.inventory_current-m.inventory_start)+.02*require('../src/models').PARAMS.U4.A2)<1e-12);
});

test('RT20 air loss preserves native limitations and cannot be bypassed by subject controls',()=>{
 let c=K.restore(K.create());c.injectFault('air',true);let s=K.capture(c);
 for(let i=0;i<80;i++)s=K.advance(s,.5,[]).state;
 c=K.restore(s);assert.ok(c.P.faults.air);assert.equal(C.validate(c,{operation:'instructor.upset',arguments:{target:'air',on:false}},{role:'subject'}),'unauthorized');
 assert.equal(C.validate(c,{operation:'interlock.bypass',arguments:{}},{role:'subject'}),'invalid_call');
 assert.ok(Number.isFinite(s.product.gross));
});

test('RT24 acknowledgment retains an active alarm cause and recorded actor',()=>{
 let c=K.restore(K.create());c.raiseA('TIC201','PVHI','High',170,'DEG C','TEST ACTIVE CAUSE');let s=K.capture(c);
 const alarm=P.project(s,'subject').alarms.find(x=>x.target.startsWith('TIC201'));
 assert.ok(alarm&&alarm.active);
 const a=K.advance(s,.5,[command({operation:'alarm.ack',arguments:{target:alarm.target,alarm_episode_id:alarm.episode_id}})]);
 assert.equal(a.outcomes[0].status,'applied');assert.equal(a.outcomes[0].after.acknowledged,true);assert.equal(a.outcomes[0].after.active,true);
});

test('RT28 instructor role claims and untyped execution have no kernel authority',()=>{
 const s=K.create();const call={operation:'loop.set',arguments:{...loop('TIC502','AUTO',46000,'DEG C').arguments,role:'instructor'}};
 const result=K.advance(s,.5,[command(call)]);assert.equal(result.outcomes[0].status,'rejected');assert.equal(result.state.fields.L.TIC502.sp,45);
 assert.equal(C.validate(K.restore(s),{operation:'kernel.eval',arguments:{code:'process.exit()'}},{role:'subject'}),'invalid_call');
});


test('RT12 optimized checkpoint copy is detached and preserves canonical bytes',()=>{
 const input={z:[-0,{n:1}],missing:undefined,__proto__:null};Object.defineProperty(input,'__proto__',{value:{safe:true},enumerable:true});
 const copied=K.clone(input);assert.equal(K.stable(copied),K.stable(input));copied.z[1].n=2;assert.equal(input.z[1].n,1);
 assert.equal(Object.getPrototypeOf(copied),Object.prototype);assert.deepEqual(copied.__proto__,{safe:true});
 for(const v of [NaN,Infinity,()=>{},[undefined],Array(1)])assert.throws(()=>K.clone(v));
});

// I2 (whole-branch review): the plant refuses an OP write to a loop an interlock holds (operatorMayWrite), but the governed contract never
// looked at the hold: under a real R-201 trip {mode MAN, demand OP 50} passed validation, the mode landed, storeEntry refused the OP, and the
// kernel reported applied/committed (or no_effect/already_in_requested_state with OP at 0 when the loop was already in MAN). The contract now
// refuses an OP demand on an interlock-held loop first, as native_interlock, so a command that cannot land changes nothing. A device hold (a
// stopped pump) refuses nothing: in MAN the operator owns the output, which is how a restart is pre-positioned (drill D3).
test('RT29 an OP demand on a loop the plant holds under an interlock is refused as native_interlock, and mode and OP stay as they were',()=>{
 let c=K.restore(K.create());c.P.rT=190;c.P.trips.rx=true;     // R-201 above its 185 trip, so the trip stays latched
 let s=K.advance(K.capture(c),.5,[]).state;                    // one scan: the plant derives the hold from the trip flag
 c=K.restore(s);
 assert.equal(c.P.trips.rx,true);assert.deepEqual([c.L.FIC102.trk.on,c.L.FIC102.trk.kind,c.L.FIC102.trk.reason],[true,'interlock','R-201 HI TEMP TRIP']);
 assert.equal(c.L.FIC102.mode,'CAS');assert.equal(c.L.FIC102.op,0);
 const set=(expected,mode,demand)=>({operation:'loop.set',arguments:Object.assign({target:'FIC102',expected_mode:expected,mode},demand?{demand}:{})});
 const op50={field:'OP',value_milli:50000,unit:'%'};
 // from CAS: the mode change alone lands, but the command that also asks for OP 50 is refused whole
 const call=set('CAS','MAN',op50);
 assert.equal(C.validate(c,call,{role:'subject'}),'native_interlock');
 let a=K.advance(s,.5,[command(call,s.revisions.FIC102||0)]);
 assert.deepEqual([a.outcomes[0].status,a.outcomes[0].reason],['rejected','native_interlock']);
 assert.deepEqual(a.outcomes[0].after,a.outcomes[0].before,'a rejected command changes nothing it reports');
 assert.equal(a.state.fields.L.FIC102.mode,'CAS','the mode did not half-land');assert.equal(a.state.fields.L.FIC102.op,0);
 assert.equal(a.outcomes[0].revision_after,a.outcomes[0].revision_before);
 // the mode change on its own is the operator's and is still allowed under the trip
 a=K.advance(s,.5,[command(set('CAS','MAN'),s.revisions.FIC102||0)]);
 assert.deepEqual([a.outcomes[0].status,a.outcomes[0].reason],['applied','committed']);
 assert.equal(a.state.fields.L.FIC102.mode,'MAN');assert.equal(a.state.fields.L.FIC102.op,0,'the interlock holds the output in MAN');
 // already in MAN: the OP demand is refused too, not reported as already in the requested state
 s=a.state;c=K.restore(s);
 assert.equal(C.validate(c,set('MAN','MAN',op50),{role:'subject'}),'native_interlock');
 a=K.advance(s,.5,[command(set('MAN','MAN',op50),s.revisions.FIC102||0)]);
 assert.deepEqual([a.outcomes[0].status,a.outcomes[0].reason],['rejected','native_interlock']);
 assert.equal(a.state.fields.L.FIC102.op,0);
 // an SP demand is not an output write: FIC102 in AUTO under the trip still takes a setpoint
 a=K.advance(s,.5,[command(set('MAN','AUTO'),s.revisions.FIC102||0)]);assert.equal(a.outcomes[0].status,'applied');
 s=a.state;c=K.restore(s);
 assert.equal(C.validate(c,set('AUTO','AUTO',{field:'SP',value_milli:40000,unit:'M3/H'}),{role:'subject'}),null);
});

test('RT30 a stopped pump is a device hold: the governed OP demand in MAN still lands, so a restart can be pre-positioned',()=>{
 let c=K.restore(K.create());
 let s=K.advance(K.capture(c),.5,[{command_id:'stop',call:{operation:'motor.command',arguments:{target:'P101',command:'STOP'}},principal:{id:'PIP',role:'subject'}}]).state;
 s=K.advance(s,.5,[]).state;c=K.restore(s);
 assert.deepEqual([c.L.P101.run,c.L.FIC102.trk.on,c.L.FIC102.trk.kind,c.L.FIC102.trk.reason],[false,true,'device','P-101 STOPPED']);
 const set=(expected,mode,demand)=>({operation:'loop.set',arguments:Object.assign({target:'FIC102',expected_mode:expected,mode},demand?{demand}:{})});
 const op25={field:'OP',value_milli:25000,unit:'%'};
 let a=K.advance(s,.5,[command(set('CAS','MAN'),s.revisions.FIC102||0)]);assert.equal(a.outcomes[0].status,'applied');
 s=a.state;c=K.restore(s);
 assert.equal(C.validate(c,set('MAN','MAN',op25),{role:'subject'}),null,'a device hold refuses nothing');
 a=K.advance(s,.5,[command(set('MAN','MAN',op25),s.revisions.FIC102||0)]);
 assert.deepEqual([a.outcomes[0].status,a.outcomes[0].reason],['applied','committed']);
 assert.equal(a.outcomes[0].after.op_milli,25000);assert.equal(a.state.fields.L.FIC102.op,25,'the operator owns the output in MAN while the pump is stopped');
});

// Review Important 1 (CR40): spCutoff is derived from the range, and applySnapshot recomputes it, but the kernel's restore() assigned the
// checkpoint's L as it stood. A checkpoint from before S2 (no loop carries the field) therefore resumed with the shutoff silently off: FIC211 in
// AUTO at SP 0 holds its output where it was, because SP 0 against an observed 0 is no error. restore() now recomputes the field after the assign.
test('RT31 a checkpoint from before the setpoint shutoff restores with spCutoff recomputed, and FIC211 in AUTO at SP 0 drives its output to 0',()=>{
 let s=K.create();
 for(const tag of ['FIC102','FIC211','FIC310','FIC313'])assert.equal(typeof s.fields.L[tag].spCutoff,'number',tag+': a fresh checkpoint carries the field');
 for(const l of Object.values(s.fields.L))delete l.spCutoff;      // the shape of a checkpoint written before S2: no loop has the field
 const f=s.fields.L.FIC211;f.mode='AUTO';f.sp=0;f.op=30;f.I=30;   // a feed loop whose setpoint is 0 with its output left at 30 %
 const c=K.restore(s);
 assert.deepEqual(['FIC102','FIC211','FIC310','FIC313'].map(t=>c.L[t].spCutoff),[1.2,0.4,0.8,0.4],'recomputed from each range, on every M3/H loop');
 assert.deepEqual(Object.keys(c.L).filter(k=>'spCutoff' in c.L[k]).sort(),['FIC102','FIC211','FIC310','FIC313'],'and on nothing else');
 assert.equal('spCutoff' in s.fields.L.FIC211,false,'the caller\'s checkpoint is not touched');
 const a=K.advance(s,.5,[]).state;
 assert.equal(a.fields.L.FIC211.spCutoff,0.4);
 assert.equal(a.fields.L.FIC211.op,0,'the shutoff is on after the restore: one scan takes the output to the low limit');
 // control: the same loop on a live plant with the field deleted holds its 30 %, so the 0 above is the shutoff and not the loop's own action
 const held=K.restore(K.create());held.L.FIC211.mode='AUTO';held.L.FIC211.sp=0;held.L.FIC211.op=30;held.L.FIC211.I=30;delete held.L.FIC211.spCutoff;
 held.step(.5);
 assert.equal(held.L.FIC211.op,30,'without the field the loop does not shut');
});

// Review Minor 7: the governed contract reads the mode attribute (program_owned), and S2 made FIC211 PROGRAM in every running phase (3.1.0: an unheld
// FEED only), so an agent's loop.set on FIC211 is refused through CHARGE, HEATUP, FEED, REACT, COOL and DRAIN and accepted while the sequence is held.
test('RT32 an agent\'s loop.set on FIC211 is refused program_owned in CHARGE and accepted once the sequence is held',()=>{
 let c=K.restore(K.create());c.seqCmd('START');
 let s=K.advance(K.capture(c),.5,[]).state;                     // one scan: the sequence writes the attribute
 c=K.restore(s);assert.equal(c.P.b.phase,'CHARGE');assert.equal(c.L.FIC211.modeAttr,'PROGRAM');
 const sp5=loop('FIC211','AUTO',5000,'M3/H');
 assert.equal(C.validate(c,sp5,{role:'subject'}),'program_owned');
 let a=K.advance(s,.5,[command(sp5,s.revisions.FIC211||0)]);
 assert.deepEqual([a.outcomes[0].status,a.outcomes[0].reason],['rejected','program_owned']);
 assert.equal(a.state.fields.L.FIC211.sp,0,'nothing landed');
 const hold={operation:'sequence.command',arguments:{target:'SCM202',command:'HOLD',expected_phase:'CHARGE'}};
 a=K.advance(s,.5,[command(hold,s.revisions.SCM202||0)]);assert.equal(a.outcomes[0].status,'applied');
 s=K.advance(a.state,.5,[]).state;                              // the attribute follows HOLD by one scan
 c=K.restore(s);assert.equal(c.P.b.held,true);assert.equal(c.L.FIC211.modeAttr,'OPERATOR');
 assert.equal(C.validate(c,sp5,{role:'subject'}),null,'held: the loop is the operator\'s');
 a=K.advance(s,.5,[command(sp5,s.revisions.FIC211||0)]);
 assert.deepEqual([a.outcomes[0].status,a.outcomes[0].reason],['applied','committed']);
 assert.equal(a.state.fields.L.FIC211.sp,5);
});
