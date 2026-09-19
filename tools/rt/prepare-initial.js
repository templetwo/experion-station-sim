// @artifact dev
// One whole-plant IC, prepared through native steps and the actual START sequence.
'use strict';
const fs=require('node:fs'),K=require('../../src/plant-kernel'),M=require('../../src/product-meter'),C=require('../../src/control-contract');
const c=K.restore(K.create()),call={operation:'sequence.command',arguments:{target:'SCM202',command:'START',expected_phase:'IDLE'}};
if(C.validate(c,call,{role:'operator'}))throw Error('preparation_start_refused');
c.state.oper='PREPARATION';C.reduce(c,call);c.state.oper='NATIVE';
let sample; c.modelCtx().productSample=x=>sample=x;const window=[];let feedAt=null;
for(let i=0;i<12000;i++){
 c.step(.5);c.rtTick++;M.advance(c.product,c.P,c.L,sample,.5);
 window.push({t:c.P.t,draw:sample.draw_rate_m3h,inventory:M.inventory(c.P),quality:c.L.AI509.pv});if(window.length>600)window.shift();
 if(c.P.b.phase==='FEED'&&feedAt===null)feedAt=c.P.t;
 if(feedAt!==null&&c.P.t-feedAt>=60000)break;
}
if(c.P.b.phase!=='FEED'||Object.values(c.P.trips).some(Boolean))throw Error('preparation_not_ready');
const report={profile:'accelerated_initial_condition_preparation_not_subject_evidence',preparation_commands:[call],readiness_end_tick:c.rtTick,readiness_end_sim_ms:c.P.t,batch_phase:c.P.b.phase,window_s:window.length*.5,mean_draw_m3h:window.reduce((s,x)=>s+x.draw,0)/window.length,inventory_drift_m3:window.at(-1).inventory-window[0].inventory,max_AI509_percent:Math.max(...window.map(x=>x.quality)),native_trip_count:Object.values(c.P.trips).filter(Boolean).length};
// Explicit boundary: subsequent totals describe the measured shift, not preparation.
c.product=M.create(c.P);const out=process.argv[2];fs.writeFileSync(out,K.stable(K.capture(c)));fs.writeFileSync(out.replace('.json','.readiness.json'),JSON.stringify(report,null,2)+'\n');
