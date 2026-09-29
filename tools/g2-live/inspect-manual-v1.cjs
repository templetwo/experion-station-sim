#!/usr/bin/env node
// @artifact dev
// Read-only forensic reproduction against an extracted, hash-verified runtime.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(!process.argv[2]||!process.argv[3])throw Error('Usage: node inspect-manual-v1.cjs ARCHIVED_RUNTIME NEW_OUTPUT_JSON');
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
if(fs.existsSync(out))throw Error('Refusing to overwrite existing evidence');
const revision='5e8f97cb1f21533a4f4bf976e40c60549fcee8de';
const expectedModel='de95d858805150a438b3d4dcacf7f6926da2cc51aecda639daba26bd84b10853';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=['Experion Station Simulator.dc.html',...fs.readdirSync(path.join(root,'src')).filter(x=>x.endsWith('.js')&&x!=='model-id.js').sort().map(x=>'src/'+x)];
function modelHash(){const h=crypto.createHash('sha256');for(const p of files){h.update(p);h.update('\0');h.update(fs.readFileSync(path.join(root,p)));h.update('\0');}return h.digest('hex');}
function checkSources(){
 if(modelHash()!==expectedModel||require(path.join(root,'src/model-id'))!==expectedModel)throw Error('Archived runtime model mismatch');
 if(sha(fs.readFileSync(path.join(root,'tools/logic-harness.js')))!=='ccd88cd6b8f6fe05c0752b0f0d3152d10fad27c0d72f28cae8e149f6a5627917')throw Error('Archived harness mismatch');
 if(sha(fs.readFileSync(path.join(root,'tools/g2-live/recipe-v2.json')))!=='4c49731f1051d2525ba0580fd6145cd2ea1fc26e59078da59cf7fa7784d3a163')throw Error('Archived recipe mismatch');
}
checkSources();
const {load}=require(path.join(root,'tools/logic-harness')),M=require(path.join(root,'src/material-model')),C=require(path.join(root,'src/composition'));
const {Component}=load({file:path.join(root,'Experion Station Simulator.dc.html')});
function boot(mode){const c=new Component({});c.historyLimit=20;c.initSim(0,{materialMode:mode});return c;}
const sum=a=>a.reduce((x,y)=>x+y,0),sv=M.RECIPE.geometry_basis.liquid_specific_volume_m3_kg,volume=a=>a.reduce((x,y,i)=>x+y*sv[i],0);
const names=['product_transfer','product_dispatch','diversion','offspec_dispatch'];
function point(c){const m=c.composition.material,v=M.geometry(m).volumes_m3,q=C.truthProjection(c.composition).quality;return {time_s:c.P.t/1000,TIC311_c:c.L.TIC311.pv,pre_c:c.P.h.pre,bed_c:c.P.h.bed,OP_percent:c.L.TIC311.op,integral:c.L.TIC311.I,conversion:M.truth(m).conversion_fraction,AI511_mass_percent:c.L.AI511.pv,truth_a_mass_percent:q.a*100,LI513_percent:c.L.LI513.pv,product_m3:v.product,oil_m3:v.oil,chamber2_m3:v.chamber2,product_component_kg:m.vector.slice(16,20),instant_flow_m3h:Object.fromEntries(names.map(n=>[n,m.lastInterval?volume(m.lastInterval.transfers[n])/.5*3600:null])),counters:Object.fromEntries(names.map(n=>[n,m.vector.slice(M.TRANSFER_OFFSETS[n],M.TRANSFER_OFFSETS[n]+4)]))};}
function u3record(c){return {t:c.P.t,h:c.P.h,loops:Object.fromEntries(['FIC310','TIC311','FIC313','TI312','TI314','TI315','AI316'].map(k=>[k,{pv:c.L[k].pv,sp:c.L[k].sp,op:c.L[k].op,mode:c.L[k].mode,I:c.L[k].I}])),valves:Object.fromEntries(['FV310','FV311','QV313'].map(k=>[k,c.V[k]]))};}
const legacy=boot('legacy'),live=boot('composition_mass_v1'),hashes=[crypto.createHash('sha256'),crypto.createHash('sha256')];
const marks=new Set([60,300,600,900,1200,1500,1800,1860,2100,2400,2580,2700,2820,2856,2880,3000]);
const points=[point(live)];let firstMismatch=null,firstWithin5=null,lastOutside=1800,peak={value_mass_percent:-Infinity,time_s:null},maxResidual=0;
for(let i=0;i<6000;i++){
 const records=[];
 for(const [j,c] of [legacy,live].entries()){
  const t=c.P.t/1000;
  if(t===600){c.setMode('TIC311','MAN');if(!c.storeEntry('TIC311','OP',0))throw Error('Heater OP write refused');}
  if(t===1800)c.setMode('TIC311','AUTO');
  c.step(.5);records.push(JSON.stringify(u3record(c)));hashes[j].update(records[j]);hashes[j].update('\n');
 }
 const now=live.P.t/1000;
 if(records[0]!==records[1]&&firstMismatch===null)firstMismatch=now;
 if(now>1800){const outside=Math.abs(live.L.TIC311.pv-320)>5;if(!outside&&firstWithin5===null)firstWithin5=now;if(outside)lastOutside=now;}
 if(live.L.AI511.pv!==null&&live.L.AI511.pv>peak.value_mass_percent)peak={value_mass_percent:live.L.AI511.pv,time_s:now};
 const closure=M.truth(live.composition.material).closure;if(!closure.passed)throw Error('Material closure failed');maxResidual=Math.max(maxResidual,closure.maximum_abs_inventory_residual_kg);
 if(marks.has(now))points.push(point(live));
}
const intervals=[];
for(const [start,end]of[[0,600],[600,1800],[1800,2580],[2580,2856],[2856,3000]]){
 const a=points.find(p=>p.time_s===start),b=points.find(p=>p.time_s===end);
 const flows=Object.fromEntries(names.map(n=>{const amount=b.counters[n].map((v,i)=>v-a.counters[n][i]);return[n,{mass_kg:sum(amount),volume_m3:volume(amount),mean_volume_rate_m3h:volume(amount)*3600/(end-start)}];}));
 intervals.push({start_s:start,end_s:end,product_inventory_delta_m3:b.product_m3-a.product_m3,flows});
}
// Independent fresh diversion check: 300s filling offspec, then 300s after routing to product.
const diverted=boot('composition_mass_v1');diverted.instr.auth=true;diverted.setMaterialDiversion(1);
for(let i=0;i<600;i++)diverted.step(.5);
const before=diverted.composition.material.vector.slice(20,24),beforeCounter=diverted.composition.material.vector.slice(M.TRANSFER_OFFSETS.offspec_dispatch,M.TRANSFER_OFFSETS.offspec_dispatch+4);
diverted.setMaterialDiversion(0);for(let i=0;i<600;i++)diverted.step(.5);
const after=diverted.composition.material.vector.slice(20,24),afterCounter=diverted.composition.material.vector.slice(M.TRANSFER_OFFSETS.offspec_dispatch,M.TRANSFER_OFFSETS.offspec_dispatch+4);
checkSources();
const report={_artifact:'@artifact dev',schema:'g2-manual-forensic-v1',scope:'Read-only synthetic UI observation reproduction; not a new accepted numerical campaign or retuning.',source_hashes_verified_before_and_after:true,source:{revision,model_id:expectedModel,production_file_count:files.length,probe_sha256:sha(fs.readFileSync(__filename)),harness_sha256:sha(fs.readFileSync(path.join(root,'tools/logic-harness.js'))),recipe_id:M.RECIPE.id,recipe_sha256:sha(fs.readFileSync(path.join(root,'tools/g2-live/recipe-v2.json'))),node:process.version},heater:{commands:[{time_s:600,mode:'MAN',op:0},{time_s:1800,mode:'AUTO',retained_sp_c:320}],duration_s:3000,frame_s:.5,points:points.map(({counters,...p})=>p),intervals,AI511_peak:peak,first_TIC311_within_5C_s:firstWithin5,last_TIC311_outside_5C_s:lastOutside,maximum_local_closure_residual_kg:maxResidual},u3_parity:{frames:6000,fields:'P.h; FIC310,TIC311,FIC313,TI312,TI314,TI315,AI316 PV/SP/OP/MODE/I; FV310,FV311,QV313 valve objects; clock',first_mismatch_s:firstMismatch,legacy_sha256:hashes[0].digest('hex'),composition_sha256:hashes[1].digest('hex')},offspec_decay:{setup:'Separate fresh composition run; TO OFF-SPEC at0s; TO PRODUCT at300s; sample at600s',decay_interval_s:300,dispatch_time_constant_s:900,before_component_kg:before,after_component_kg:after,external_dispatch_component_kg:afterCounter.map((v,i)=>v-beforeCounter[i]),remaining_mass_fraction:sum(after)/sum(before),expected_exp_minus_t_over_tau:Math.exp(-300/900),closure:M.truth(diverted.composition.material).closure.passed}};
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:out,source:report.source,u3_parity:report.u3_parity,peak,firstWithin5,lastOutside,offspec_decay:report.offspec_decay}));
