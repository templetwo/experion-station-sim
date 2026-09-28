// @artifact production
// Conserved material state, sampled observations and separate dispatch ledgers.
// ageMs is source age; publicationAgeMs separately measures sample-and-hold age.
// No pre-run history: first valid publication can occur only after the transport delay.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./material-model'),require('./material-recipe'),require('./measurement'));
  else root.ESS.Composition=factory(root.ESS.MaterialModel,root.ESS.MaterialRecipe,root.ESS.Measurement);
})(typeof globalThis!=='undefined'?globalThis:this,function(Material,Recipe,Measurement){
  'use strict';
  const MODE=Recipe.interface.mode,SCHEMA=Recipe.interface.composition_schema;
  const CFG=Recipe.geometry_basis,FRAME_MS=Recipe.interface.frame_s*1000;
  const DELAY_MS=CFG.analyzer.transport_delay_s*1000,PERIOD_MS=CFG.analyzer.sample_period_s*1000;
  const TAGS=['AI511','AI512','LI513'];
  const clone=v=>JSON.parse(JSON.stringify(v));
  const sum=a=>a.reduce((x,y)=>x+y,0);
  function fail(why){throw Error('composition_'+why);}
  function number(v,label,min=0){if(typeof v!=='number'||!Number.isFinite(v)||v<min)fail(label);return v;}
  function keys(v,names,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==names.slice().sort().join('|'))fail(label);}
  function pair(v,label){
    if(v===null)return;
    keys(v,['a','w'],label);number(v.a,label);number(v.w,label);
    if(v.a+v.w>1+1e-12)fail(label);
  }
  function quality(material){
    const masses=material.vector.slice(16,20),total=sum(masses);
    if(masses.some(v=>!Number.isFinite(v)||v<0)||total<CFG.quality.minimum_inventory_kg)return {valid:false,qualified:null,a:null,w:null};
    const a=masses[0]/total,w=masses[2]/total;
    return {valid:true,qualified:a<=CFG.quality.max_a_mass_fraction&&w<=CFG.quality.max_w_mass_fraction,a,w};
  }
  function historyRow(material){const q=quality(material);return {timeMs:material.timeMs,valid:q.valid,a:q.a,w:q.w};}
  function asPair(row){return row&&row.valid?{a:row.a,w:row.w}:null;}
  function rounded(v,dec){const scale=10**dec;return Math.round(v*scale)/scale;}
  function sample(pairValue){return pairValue?{a:rounded(pairValue.a*100,3)/100,w:rounded(pairValue.w*100,3)/100}:null;}
  function counter(material){return material.vector.slice(Material.TRANSFER_OFFSETS.product_dispatch,Material.TRANSFER_OFFSETS.product_dispatch+4);}
  function buckets(){return {gross:0,qualified:0,offBand:0,unknown:0};}
  function accounting(material){return {startMs:material.timeMs,endMs:material.timeMs,initialDispatch:counter(material),truth:buckets(),observed:buckets(),eligibleMs:0,coveredMs:0};}
  function create(nowMs=0){
    number(nowMs,'clock');const material=Material.create(nowMs),first=historyRow(material);
    const state={schema:SCHEMA,mode:MODE,material,observer:{schema:'g2-analyzer-state-v1',startMs:nowMs,timeMs:nowMs,
      history:[first],filtered:null,held:null,sourceTimeMs:nowMs,publishedTimeMs:nowMs,nextSampleMs:nowMs+PERIOD_MS},
      accounting:accounting(material),divertFraction:0};
    validateState(state);return state;
  }
  function validateState(state){
    keys(state,['schema','mode','material','observer','accounting','divertFraction'],'state_shape');
    if(state.schema!==SCHEMA||state.mode!==MODE)fail('version');
    Material.validateState(state.material);
    number(state.divertFraction,'diversion');if(state.divertFraction>1)fail('diversion');
    const o=state.observer,t=state.material.timeMs;
    keys(o,['schema','startMs','timeMs','history','filtered','held','sourceTimeMs','publishedTimeMs','nextSampleMs'],'observer_shape');
    if(o.schema!=='g2-analyzer-state-v1'||o.timeMs!==t)fail('observer_version_or_clock');
    for(const k of ['startMs','timeMs','sourceTimeMs','publishedTimeMs','nextSampleMs'])number(o[k],'observer_clock');
    if(o.startMs>o.sourceTimeMs||o.sourceTimeMs>o.publishedTimeMs||o.publishedTimeMs>t||o.nextSampleMs!==o.publishedTimeMs+PERIOD_MS||o.nextSampleMs<=t)fail('observer_clock');
    if((t-o.startMs)%FRAME_MS!==0||(o.publishedTimeMs-o.startMs)%PERIOD_MS!==0)fail('observer_phase');
    pair(o.filtered,'filter');pair(o.held,'held');
    if(o.held!==null&&(o.filtered===null||o.publishedTimeMs<o.startMs+DELAY_MS))fail('sample_without_source');
    if(o.sourceTimeMs!==Math.max(o.startMs,o.publishedTimeMs-DELAY_MS))fail('sample_source_clock');
    if(!Array.isArray(o.history)||!o.history.length||o.history.length>DELAY_MS/FRAME_MS+2)fail('history_shape');
    o.history.forEach((row,i)=>{
      keys(row,['timeMs','valid','a','w'],'history_row');number(row.timeMs,'history_clock');
      if(typeof row.valid!=='boolean'||row.timeMs<o.startMs||row.timeMs>t||(i&&row.timeMs!==o.history[i-1].timeMs+FRAME_MS))fail('history_clock');
      if(row.valid)pair({a:row.a,w:row.w},'history_value');else if(row.a!==null||row.w!==null)fail('history_invalid_value');
    });
    if(o.history[o.history.length-1].timeMs!==t||o.history[0].timeMs>Math.max(o.startMs,t-DELAY_MS))fail('history_coverage');
    const latest=o.history[o.history.length-1],current=historyRow(state.material);
    if(latest.valid!==current.valid||latest.a!==current.a||latest.w!==current.w)fail('history_current_truth');
    const a=state.accounting;
    keys(a,['startMs','endMs','initialDispatch','truth','observed','eligibleMs','coveredMs'],'accounting_shape');
    for(const k of ['startMs','endMs','eligibleMs','coveredMs'])number(a[k],'accounting_clock');
    if(a.startMs>t||a.endMs!==t||a.eligibleMs!==t-a.startMs||a.coveredMs>a.eligibleMs)fail('accounting_clock');
    if(!Array.isArray(a.initialDispatch)||a.initialDispatch.length!==4)fail('accounting_origin');
    a.initialDispatch.forEach(v=>number(v,'accounting_origin'));
    for(const name of ['truth','observed']){
      const b=a[name];keys(b,['gross','qualified','offBand','unknown'],'accounting_buckets');
      Object.values(b).forEach(v=>number(v,'accounting_mass'));
      if(Math.abs(b.gross-b.qualified-b.offBand-b.unknown)>1e-7+1e-9*b.gross)fail('accounting_sum');
    }
    const dispatched=sum(counter(state.material))-sum(a.initialDispatch);
    if(Math.abs(a.truth.gross-dispatched)>1e-7+1e-9*a.truth.gross||a.truth.gross!==a.observed.gross)fail('accounting_dispatch');
    return state;
  }
  function delayed(o,timeMs){
    const target=timeMs-DELAY_MS;
    if(target<o.startMs)return null;
    for(let i=o.history.length-1;i>=0;i--)if(o.history[i].timeMs<=target)return o.history[i];
    fail('history_gap');
  }
  function advanceObserver(o,material){
    const previous=o.timeMs,target=asPair(delayed(o,previous));
    if(target){
      if(o.filtered===null)o.filtered=target;
      else {const decay=Math.exp(-(material.timeMs-previous)/(CFG.analyzer.lag_s*1000));
        o.filtered={a:target.a+(o.filtered.a-target.a)*decay,w:target.w+(o.filtered.w-target.w)*decay};}
    }
    o.timeMs=material.timeMs;o.history.push(historyRow(material));
    if(o.timeMs===o.nextSampleMs){
      const row=delayed(o,o.timeMs);
      if(row&&row.valid&&o.filtered===null)o.filtered=asPair(row);
      o.held=row&&row.valid?sample(o.filtered):null;o.sourceTimeMs=row?row.timeMs:o.startMs;
      o.publishedTimeMs=o.timeMs;o.nextSampleMs+=PERIOD_MS;
    }
    while(o.history.length>1&&o.history[1].timeMs<=Math.max(o.startMs,o.timeMs-DELAY_MS))o.history.shift();
  }
  function record(pv,valid,sourceTimeMs,publishedTimeMs,nowMs,limit='NONE'){
    const code=!valid?0x80000000:limit==='HIGH'?0x40940600:limit==='LOW'?0x40940500:0;
    return {pv:valid?pv:null,badPv:!valid,quality:!valid?'BAD':limit==='NONE'?'GOOD':'UNCERTAIN',
      reason:valid?(limit==='NONE'?null:'ENGINEERING_RANGE_EXCEEDED'):'NO_VALID_SAMPLE',statusCode:code,
      statusName:!valid?'Bad':limit==='NONE'?'Good':'Uncertain_EngineeringUnitsExceeded',limit,
      sourceTimeMs,publishedTimeMs,ageMs:nowMs-sourceTimeMs,publicationAgeMs:nowMs-publishedTimeMs};
  }
  function measurements(state){
    const o=state.observer,t=state.material.timeMs,v=Material.geometry(state.material).volumes_m3.product;
    const level=rounded(v/CFG.capacity_m3.product*100,2);
    return {AI511:record(o.held?rounded(o.held.a*100,3):null,o.held!==null,o.sourceTimeMs,o.publishedTimeMs,t),
      AI512:record(o.held?rounded(o.held.w*100,3):null,o.held!==null,o.sourceTimeMs,o.publishedTimeMs,t),
      LI513:record(level,true,t,t,t,level>100?'HIGH':level<0?'LOW':'NONE')};
  }
  function visibleRecord(tag,own,published,nowMs){
    const p=published===undefined?{...own,tag}:published&&published[tag];
    if(!p)return {...own,pv:null,badPv:true,quality:'BAD',reason:'NO_VALID_SAMPLE',statusCode:0x80000000,statusName:'Bad'};
    const m=Measurement.observe({...p,tag});
    const source=Number.isFinite(p.sourceTimeMs)?p.sourceTimeMs:own.sourceTimeMs;
    const publication=Number.isFinite(p.publishedTimeMs)?p.publishedTimeMs:own.publishedTimeMs;
    const age=nowMs-publication;
    const expired=age<0||age>PERIOD_MS||source>publication;
    return {pv:expired?null:m.pv,badPv:expired||m.badPv,quality:expired?'BAD':m.quality,
      reason:expired?'SAMPLE_UNAVAILABLE':m.quality==='GOOD'?null:(p.reason||m.statusName||'NO_VALID_SAMPLE'),
      statusCode:expired?0x80000000:m.statusCode,statusName:expired?'Bad':m.statusName,limit:expired?'NONE':m.limit,
      sourceTimeMs:source,publishedTimeMs:publication,ageMs:Math.max(0,nowMs-source),publicationAgeMs:Math.max(0,age)};
  }
  function observed(state,published){
    const own=measurements(state),result={};
    for(const tag of TAGS)result[tag]=visibleRecord(tag,own[tag],published,state.material.timeMs);
    return result;
  }
  function observedQuality(points){
    const a=points.AI511,w=points.AI512;
    if(!a||!w||a.quality!=='GOOD'||w.quality!=='GOOD'||!Number.isFinite(a.pv)||!Number.isFinite(w.pv))return null;
    return a.pv<=CFG.quality.max_a_mass_fraction*100&&w.pv<=CFG.quality.max_w_mass_fraction*100;
  }
  function add(bucket,mass,classification){bucket.gross+=mass;bucket[classification===null?'unknown':classification?'qualified':'offBand']+=mass;}
  function advance(state,input,dt,published){
    validateState(state);if(dt!==Recipe.interface.frame_s)fail('fixed_frame');
    const q=quality(state.material),observations=observed(state,published),oq=observedQuality(observations);
    const material=Material.advance(state.material,input,dt),next=clone(state);
    const interval=material.lastInterval;
    if(!interval||interval.startMs!==state.material.timeMs||interval.endMs!==material.timeMs)fail('interval');
    const amounts=interval.transfers.product_dispatch;
    if(!Array.isArray(amounts)||amounts.length!==4||amounts.some(v=>!Number.isFinite(v)||v<0))fail('dispatch_interval');
    const mass=sum(amounts);next.material=material;next.divertFraction=input.divert_fraction;
    add(next.accounting.truth,mass,q.qualified);add(next.accounting.observed,mass,oq);
    next.accounting.endMs=material.timeMs;next.accounting.eligibleMs+=dt*1000;
    if(oq!==null)next.accounting.coveredMs+=dt*1000;
    advanceObserver(next.observer,material);validateState(next);return next;
  }
  function resetAccounting(state){validateState(state);const next=clone(state);next.accounting=accounting(next.material);return next;}
  function dispatchProjection(b,a,proxy){
    return {gross_mass_kg:b.gross,[proxy?'qualified_mass_proxy_kg':'qualified_mass_kg']:b.qualified,
      [proxy?'off_band_mass_proxy_kg':'off_band_mass_kg']:b.offBand,
      [proxy?'unknown_quality_mass_kg':'unknown_mass_kg']:b.unknown,interval_start_sim_ms:a.startMs,interval_end_sim_ms:a.endMs};
  }
  function publicProjection(state,published){
    return {formula_version:'composition_observed_v1',mode:MODE,measurements:observed(state,published),
      dispatch:dispatchProjection(state.accounting.observed,state.accounting,true),
      quality_coverage:{eligible_sim_ms:state.accounting.eligibleMs,covered_sim_ms:state.accounting.coveredMs}};
  }
  function truthProjection(state){
    return {formula_version:MODE,material:Material.truth(state.material),quality:quality(state.material),
      dispatch:dispatchProjection(state.accounting.truth,state.accounting,false)};
  }
  return {create,advance,validateState,validate:validateState,measurements,publicProjection,truthProjection,resetAccounting};
});
