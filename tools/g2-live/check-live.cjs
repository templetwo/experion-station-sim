#!/usr/bin/env node
// @artifact dev
'use strict';
// New deterministic live campaign. Never relabels the frozen offline or MOA runs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),{load}=require('../logic-harness');
const M=require('../../src/material-model'),C=require('../../src/composition');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function provenance(){
 const recipePath='tools/g2-live/recipe-v2.json',recipeBytes=fs.readFileSync(path.join(ROOT,recipePath));
 if(JSON.stringify(JSON.parse(recipeBytes))!==JSON.stringify(M.RECIPE))throw Error('Generated recipe does not match the active declared recipe.');
 const files=['Experion Station Simulator.dc.html',...fs.readdirSync(path.join(ROOT,'src')).filter(x=>x.endsWith('.js')&&x!=='model-id.js').sort().map(x=>'src/'+x)];
 const hash=crypto.createHash('sha256');for(const file of files){hash.update(file);hash.update('\0');hash.update(fs.readFileSync(path.join(ROOT,file)));hash.update('\0');}
 const model=hash.digest('hex');if(model!==require('../../src/model-id'))throw Error('Run build-dist.py before collecting live evidence.');
 const dirty=cp.spawnSync('git',['diff','--quiet','HEAD','--',...files,recipePath,'tools/g2-live/check-live.cjs','tools/logic-harness.js'],{cwd:ROOT});if(dirty.status!==0)throw Error('Commit production and campaign sources before collecting the live receipt.');
 return {revision:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),model_id:model,
   recipe_path:recipePath,recipe_id:M.RECIPE.id,recipe_sha256:sha(recipeBytes),campaign_sha256:sha(fs.readFileSync(__filename)),harness_sha256:sha(fs.readFileSync(path.join(ROOT,'tools/logic-harness.js'))),node:process.version};
}
function boot(){const {Component}=load();const c=new Component({});c.historyLimit=600;c.initSim(0,{materialMode:'composition_mass_v1'});return c;}
function fact(c){const t=C.truthProjection(c.composition);return {time_s:c.P.t/1000,bed_temperature_c:c.P.h.bed,
  conversion_fraction:t.material.conversion_fraction,receiving_a_mass_fraction:t.quality.a,receiving_w_mass_fraction:t.quality.w,
  AI511:C.measurements(c.composition).AI511,AI512:C.measurements(c.composition).AI512};}
function heater(){
 const c=boot();let baseline,low,truth=null,observed=null,maxResidual=0;const trajectory=crypto.createHash('sha256');
 for(let tick=0;tick<6000;tick++){
  if(tick===1200){baseline=fact(c);c.setMode('TIC311','MAN');if(!c.storeEntry('TIC311','OP',0))throw Error('heater_write_refused');}
  if(tick===3600){low=fact(c);c.setMode('TIC311','AUTO');}
  c.step(.5);const t=C.truthProjection(c.composition),p=C.measurements(c.composition);
  if(!t.material.closure.passed)throw Error('live_closure_failure');
  maxResidual=Math.max(maxResidual,t.material.closure.maximum_abs_inventory_residual_kg);
  if(tick>=1200&&truth===null&&t.quality.a>.15)truth=c.P.t/1000;
  if(tick>=1200&&observed===null&&p.AI511.quality==='GOOD'&&p.AI511.pv>15)observed=c.P.t/1000;
  trajectory.update(JSON.stringify({P:c.P.h,material:c.composition,product:c.product}));trajectory.update('\n');
 }
 const passed=baseline.receiving_a_mass_fraction<=.15&&baseline.conversion_fraction-low.conversion_fraction>=M.RECIPE.geometry_basis.acceptance.minimum_heat_loss_conversion_drop&&truth>600&&observed>truth;
 return {passed,input_phase:M.RECIPE.interface.input_phase,frame_s:.5,duration_s:3000,events:[{time_s:600,operation:'TIC311 MAN OP0'},{time_s:1800,operation:'TIC311 AUTO retained SP'}],baseline,heater_off_end:low,
  first_truth_a_breach_s:truth,first_analyzer_a_breach_s:observed,final:fact(c),maximum_local_closure_residual_kg:maxResidual,
  trajectory_sha256:trajectory.digest('hex'),truth_accounting:C.truthProjection(c.composition),observed_accounting:C.publicProjection(c.composition,c.L),legacy_volume_proxy:c.product};
}
function vent(){
 const c=boot();c.setMode('PIC505','MAN');if(!c.storeEntry('PIC505','OP',0))throw Error('vent_write_refused');
 let lifts=0,reseats=0,peak=0,maxResidual=0;const events=[];
 for(let i=0;i<800;i++){
  c.step(.5);peak=Math.max(peak,c.P.s.pres);
  for(const e of c.composition.material.lastInterval.reliefEvents){events.push(e);if(e.open)lifts++;else reseats++;}
  const closure=M.truth(c.composition.material).closure;if(!closure.passed)throw Error('vent_closure_failure');maxResidual=Math.max(maxResidual,closure.maximum_abs_inventory_residual_kg);
 }
 const y=c.composition.material.vector,n=y[M.TRANSFER_OFFSETS.normal_vent+3],r=y[M.TRANSFER_OFFSETS.relief_vent+3];
 return {passed:lifts>0&&reseats>0&&n>0&&r>0,duration_s:400,command:'PIC505 MAN OP0 at0s; native actuator stroke retained',
  normal_vent_gas_kg:n,relief_gas_kg:r,gas_inventory_kg:y[27],maximum_sampled_pressure_kpa_absolute:peak,lifts,reseats,events,maximum_local_closure_residual_kg:maxResidual};
}
function run(){const source=provenance(),heat=heater(),gas=vent();return {_artifact:'@artifact dev',schema:'g2-live-acceptance-v1',source,
 scope:'Deterministic live synthetic composition mode, zero model calls. Native temperature is prescribed; no validated chemistry, reaction energy, hydraulics, shared cooling or MOA re-evaluation.',
 passed:heat.passed&&gas.passed,heater_loss:heat,normal_vent_restriction:gas};}
if(require.main===module){const report=run();const output=process.argv[2];if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');else process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.passed)process.exitCode=1;}
module.exports={run,heater,vent,provenance};
