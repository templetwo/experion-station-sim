// @artifact dev
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const K=require('../src/plant-kernel'),I=require('../src/instructor');
const {Component}=require('../tools/logic-harness').load();
const archive=require('../tools/g2-history/archive.cjs').materialize();
test.after(()=>archive.cleanup());
const OldK=require(path.join(archive.root,'src/plant-kernel.js'));
const step=(c,count)=>{for(let i=0;i<count;i++)c.step(.5);};

test('Core owns accounting once per scan in browser and Kernel, including opted-in material state',()=>{
  for(const materialMode of ['legacy','composition_mass_v1']){
    const c=new Component({});c.initSim(0,{materialMode});let state=K.create({materialMode});
    assert.equal(state.schema_version,'peb.plant.v2');assert.equal(state.materialMode,materialMode);
    for(let tick=0;tick<24;tick++){c.step(.5);state=K.advance(state,.5,[]).state;}
    for(const key of ['P','L','V'])assert.deepEqual(state.fields[key],JSON.parse(JSON.stringify(c[key])),key+' '+materialMode);
    assert.deepEqual(state.product,JSON.parse(JSON.stringify(c.product)));
    assert.deepEqual(state.composition,JSON.parse(JSON.stringify(c.composition)));
    assert.equal(state.product.eligible_ms,12000);
    assert.equal(state.product.end,state.fields.P.t);
  }
});

test('actual archived v1 checkpoints resume explicit legacy operation without inventing composition',()=>{
  let old=OldK.create();for(let tick=0;tick<12;tick++)old=OldK.advance(old,.5,[]).state;
  assert.equal(old.schema_version,'peb.plant.v1');
  const checkpoint=JSON.parse(JSON.stringify(old));
  let current=K.capture(K.restore(old));
  assert.equal(current.schema_version,'peb.plant.v2');
  assert.equal(current.materialMode,'legacy');assert.equal(current.composition,null);
  assert.deepEqual(current.product,old.product);
  // the restore itself is exact: at the restore instant, before any tick has run, the plant fields are the archived checkpoint's
  for(const key of ['P','L','V'])assert.deepEqual(current.fields[key],checkpoint.fields[key],key);
  // CR27 (docs/dev/CREDIBILITY-PASS-SPEC.md section 0.6): this test used to run the archived 3.1.0-era kernel and the current
  // kernel in lockstep for 12 ticks and compare P, L (less the derived obs and pvObs) and V field for field. That proved G2
  // left the legacy dynamics untouched, a property stage S1 of the credibility pass breaks on purpose: the FIC211 low-flow
  // cutoff (CR10), the observed value feeding the controllers and the alarm scan, and plant-held outputs all change the legacy
  // trajectory. The frozen 3.1.0 behaviour is tests/fixtures/v31-baseline/ (tests/v2-baseline-archive.test.js names what has
  // moved since), so a legacy-dynamics regression is caught by the goldens. What stays here is the restore itself: the
  // checkpoint resumes as legacy with no composition invented, the product ledger is carried over and keeps accounting, and the
  // random streams are the archived kernel's (S1 changed no draw count; had it, this clause would be dropped, not loosened).
  for(let tick=0;tick<12;tick++){
    old=OldK.advance(old,.5,[]).state;current=K.advance(current,.5,[]).state;
    assert.equal(current.rand,old.rand);assert.equal(current.rand4,old.rand4);
  }
  assert.equal(current.materialMode,'legacy');assert.equal(current.composition,null);
  assert.equal(current.fields.P.t,checkpoint.fields.P.t+6000);
  const p0=checkpoint.product,p1=current.product;
  assert.equal(p1.end,p0.end+6000);
  for(const key of ['eligible_ms','covered_ms','continuous_ms'])assert.equal(p1[key],p0[key]+6000,key);
  assert.equal(p1.samples.length,p0.samples.length+12);
  assert.ok(p1.gross>p0.gross,'the ledger kept accounting after the restore');
});

test('new checkpoints retain material observer history and exactly resume both accounting ledgers',()=>{
  let state=K.create({materialMode:'composition_mass_v1'});
  for(let tick=0;tick<72;tick++)state=K.advance(state,.5,[]).state;
  assert.ok(state.composition.observer.history.length>1);
  let restored=K.capture(K.restore(JSON.parse(K.stable(state))));
  assert.equal(K.stable(restored),K.stable(state));
  for(let tick=0;tick<20;tick++){
    state=K.advance(state,.5,[]).state;restored=K.advance(restored,.5,[]).state;
    assert.equal(K.stable(restored),K.stable(state));
  }
});

test('new snapshot validation is detached and rejects unknown modes, versions and inconsistent clocks',()=>{
  const c=new Component({});c.initSim(0,{materialMode:'composition_mass_v1'});step(c,4);
  const snap=c.snapshotData('material');assert.equal(snap.schemaVersion,'3.1');
  const normalized=I.validateSnapshot(snap);normalized.composition.divertFraction=1;
  assert.equal(snap.composition.divertFraction,0);
  const mutate=[s=>{s.schemaVersion='3.2';},s=>{s.materialMode='invented';},s=>{s.composition=null;},
    s=>{s.P.t+=500;},s=>{s.product.end-=500;},s=>{s.product.gross+=1;},
    s=>{s.composition.observer.history.pop();},s=>{s.product.inventory_current=Infinity;},
    s=>{s.P.s.hw+=1;},s=>{s.P.s.pres+=1;},s=>{s.P.trips.psv502=!s.P.trips.psv502;},
    s=>{delete s.L.AI511;}];
  for(const change of mutate){
    const broken=JSON.parse(JSON.stringify(snap));change(broken);
    const before=JSON.stringify({P:c.P,product:c.product,composition:c.composition,rand:c.rand.getState()});
    assert.throws(()=>c.restoreSnapshot(broken));
    assert.equal(JSON.stringify({P:c.P,product:c.product,composition:c.composition,rand:c.rand.getState()}),before);
  }
});

test('archived 3.0 browser snapshots restore legacy mode with a fresh declared meter interval',()=>{
  const Historical=require(path.join(archive.root,'tools/logic-harness.js')).load().Component;
  const old=new Historical({});old.initSim(0);step(old,8);const snap=old.snapshotData('old');
  assert.equal(snap.schemaVersion,'3.0');assert.equal(snap.product,undefined);
  const normalized=I.validateSnapshot(snap);
  assert.equal(normalized.materialMode,'legacy');assert.equal(normalized.composition,null);
  assert.equal(normalized.product.start,snap.P.t);assert.equal(normalized.product.end,snap.P.t);
  assert.equal(normalized.product.gross,0);assert.equal(normalized.product.eligible_ms,0);
  delete snap.schemaVersion;
  assert.equal(I.validateSnapshot(snap).materialMode,'legacy');
  // Restore the shared browser module globals after loading the historical page.
  require('../tools/logic-harness').load();
});

test('resetAccounting preserves physical inventories, observer history and cumulative transfer truth',()=>{
  const c=K.restore(K.create({materialMode:'composition_mass_v1'}));step(c,80);
  const process=JSON.stringify(c.P),material=JSON.stringify(c.composition.material),observer=JSON.stringify(c.composition.observer);
  assert.ok(c.product.gross>0);assert.ok(c.composition.accounting.truth.gross>0);
  c.resetAccounting();
  assert.equal(JSON.stringify(c.P),process);assert.equal(JSON.stringify(c.composition.material),material);
  assert.equal(JSON.stringify(c.composition.observer),observer);
  assert.equal(c.product.gross,0);assert.equal(c.product.start,c.P.t);
  assert.equal(c.composition.accounting.truth.gross,0);assert.equal(c.composition.accounting.startMs,c.P.t);
  const restored=K.restore(K.capture(c));restored.step(.5);
  assert.equal(restored.product.eligible_ms,500);assert.equal(restored.composition.accounting.eligibleMs,500);
});

test('checkpoint mode and accounting validation reject malformed candidates without changing the input',()=>{
  const original=K.create({materialMode:'composition_mass_v1'}),before=K.stable(original);
  const mutate=[s=>{delete s.materialMode;},s=>{s.schema_version='peb.plant.v3';},s=>{s.composition.schema='future';},
    s=>{s.product.formula_version='composition_mass_v1';},s=>{s.product.samples=[[1000,2,3]];},
    s=>{s.composition=null;},s=>{s.fields.P.s.h2+=1;},s=>{delete s.fields.L.LI513;},
    s=>{s.schema_version='peb.plant.v1';}];
  for(const change of mutate){const broken=K.clone(original);change(broken);assert.throws(()=>K.restore(broken));}
  assert.equal(K.stable(original),before);
  assert.match(I.journalText({t:0,op:'MATERIAL_DIVERT',tag:'TK-503',arg:1}),/INSTR ROUTE TK-503 OFF-SPEC/);
});
