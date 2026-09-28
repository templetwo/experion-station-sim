// @artifact production
// Conserved synthetic mass compartments. RESOURCES-7.37 supplies balance/rate forms;
// all constants and domain choices are declared in the separately versioned recipe.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./material-recipe'));else(root.ESS=root.ESS||{}).MaterialModel=factory(root.ESS.MaterialRecipe);})(typeof globalThis!=='undefined'?globalThis:this,function(RECIPE){
  'use strict';
  const B=RECIPE.geometry_basis, G=RECIPE.gas, N=RECIPE.integration;
  const SIZE=108, GENERATION_OFFSET=28;
  const INVENTORIES=Object.freeze(['reactor','water','oil','chamber2','product','offspec','gas']);
  const INVENTORY_OFFSETS=Object.freeze(Object.fromEntries(INVENTORIES.map((n,i)=>[n,4*i])));
  const TRANSFERS=Object.freeze([
    ['feed','external_feed','reactor'],['reactor_water','reactor','water'],['reactor_oil','reactor','oil'],['reactor_gas','reactor','gas'],
    ['water_draw','water','external_water'],['oil_underflow','oil','external_water'],['water_carry','water','chamber2'],['oil_weir','oil','chamber2'],
    ['product_transfer','chamber2','product'],['diversion','chamber2','offspec'],['product_dispatch','product','external_product'],['offspec_dispatch','offspec','external_offspec'],
    ['water_overflow','water','external_reject'],['oil_overflow','oil','external_reject'],['chamber2_overflow','chamber2','external_reject'],
    ['product_overflow','product','external_reject'],['offspec_overflow','offspec','external_reject'],['normal_vent','gas','external_gas'],['relief_vent','gas','external_gas']
  ].map(([name,source,destination],i)=>Object.freeze({name,source,destination,offset:32+4*i})));
  const TRANSFER_OFFSETS=Object.freeze(Object.fromEntries(TRANSFERS.map(t=>[t.name,t.offset])));
  const INPUT_KEYS=Object.freeze(Object.keys(RECIPE.input_domain));
  const INITIAL=INVENTORIES.flatMap(name=>name==='gas'?[0,0,0,G.initial_mass_kg]:B.initial_mass_kg[name]);
  const sum=a=>a.reduce((s,v)=>s+v,0), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const finite=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error('NONFINITE_'+label);return v;};
  function exactKeys(o,keys,label){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).sort().join('|')!==keys.slice().sort().join('|'))throw Error('invalid '+label+' keys');}
  function checkVector(y,counters=true){
    if(!Array.isArray(y)||y.length!==SIZE)throw Error('invalid material vector');
    y.forEach(v=>finite(v,'STATE'));
    for(let i=0;i<28;i++)if(y[i]<-N.negative_mass_tolerance_kg)throw Error('NEGATIVE_MASS');
    for(let i=7;i<24;i+=4)if(y[i]!==0)throw Error('G_IN_LIQUID');
    if(y[24]!==0||y[25]!==0||y[26]!==0||y[27]<0)throw Error('invalid gas inventory');
    if(counters){
      for(let i=32;i<SIZE;i++)if(y[i]<-N.negative_mass_tolerance_kg)throw Error('NEGATIVE_TRANSFER');
      if(y[28]>N.negative_mass_tolerance_kg||y.slice(29,32).some(v=>v<-N.negative_mass_tolerance_kg))throw Error('invalid generation signs');
      if(Math.abs(sum(y.slice(28,32)))>N.closure_abs_kg+N.closure_rel*Math.max(1,sum(y.slice(28,32).map(Math.abs))))throw Error('unbalanced generation');
      for(let c=1;c<4;c++)if(Math.abs(y[28+c]+y[28]*B.kinetics.mass_yields[c])>N.closure_abs_kg+N.closure_rel*Math.max(1,Math.abs(y[28])))throw Error('generation yield mismatch');
    }
    return y;
  }
  function validateInput(input){exactKeys(input,INPUT_KEYS,'material input');for(const key of INPUT_KEYS){const v=finite(input[key],'INPUT'),[lo,hi]=RECIPE.input_domain[key];if(v<lo||v>hi)throw Error('MODEL_OUT_OF_ENVELOPE: '+key);}return input;}
  function rateConstant(input){const p=B.kinetics;return input.activity*p.k_ref_s_inv*Math.exp(-p.activation_over_r_k*(1/input.temperature_k-1/p.temperature_ref_k));}
  function geometryVector(y){
    const volumes={};for(const name of INVENTORIES.slice(1,6))volumes[name]=dot(y.slice(INVENTORY_OFFSETS[name],INVENTORY_OFFSETS[name]+4),B.liquid_specific_volume_m3_kg);
    volumes.chamber1=volumes.water+volumes.oil;
    const hw=volumes.water/B.geometry.area1_m3_per_percent,ho=volumes.oil/B.geometry.area1_m3_per_percent,h2=volumes.chamber2/B.geometry.area2_m3_per_percent;
    return {volumes_m3:volumes,levels_percent:{hw,ho,h1:hw+ho,h2}};
  }
  function rates(y,input,reliefOpen){
    checkVector(y,false);
    const r=Array.from({length:19},()=>[0,0,0,0]),{volumes_m3:v,levels_percent:l}=geometryVector(y),p=B.geometry;
    for(let c=0;c<4;c++){
      r[0][c]=input.feed_kg_s*B.feed_mass_fractions[c];
      const out=input.feed_kg_s*y[c]/B.reactor.reference_holdup_kg;
      ['water','oil','gas'].forEach((phase,i)=>{r[i+1][c]=out*B.phase_assignment[phase][c];});
    }
    const ramp=x=>Math.max(0,Math.min(1,x));
    const qw=p.water_draw_m3h*input.water_valve*Math.sqrt(Math.max(0,l.hw)/50)/3600;
    const wc=dot(r[1],B.liquid_specific_volume_m3_kg)*ramp((l.hw-(input.weir_height_percent-p.carry_band_percent))/p.carry_band_percent);
    const ou=qw*ramp((p.thin_band_percent-l.hw)/p.thin_band_percent);
    const ow=p.weir_m3h_per_percent_1_5*Math.pow(Math.max(0,l.h1-input.weir_height_percent),1.5)/3600;
    const qp=p.product_draw_m3h*input.product_valve*Math.sqrt(Math.max(0,l.h2)/50)/3600;
    const excess=name=>Math.max(0,v[name]-B.capacity_m3[name])/B.overflow_time_s;
    const over1=excess('chamber1');
    function withdraw(name,requests){
      const volume=v[name],total=sum(requests.map(x=>x[1]));
      if(volume<=0||total===0)return;
      finite(total,'FLOW');if(total<0)throw Error('negative requested flow');
      const factor=Math.min(1,volume/(B.availability_time_s*total)),offset=INVENTORY_OFFSETS[name];
      for(const [index,q] of requests)for(let c=0;c<4;c++)r[index][c]=y[offset+c]/volume*(q*factor);
    }
    withdraw('water',[[4,qw],[6,wc],[12,v.chamber1>0?over1*v.water/v.chamber1:0]]);
    withdraw('oil',[[5,ou],[7,ow],[13,v.chamber1>0?over1*v.oil/v.chamber1:0]]);
    withdraw('chamber2',[[8,qp*(1-input.divert_fraction)],[9,qp*input.divert_fraction],[14,excess('chamber2')]]);
    withdraw('product',[[10,v.product/B.tank_dispatch_time_s.product],[15,excess('product')]]);
    withdraw('offspec',[[11,v.offspec/B.tank_dispatch_time_s.offspec],[16,excess('offspec')]]);
    const pressure=y[27]/G.compliance_kg_per_kpa,shape=Math.sqrt(Math.max(0,pressure-G.header_pressure_kpa)/G.reference_delta_pressure_kpa);
    const normal=G.normal_capacity_kg_s*input.gas_valve*shape,relief=reliefOpen?G.normal_capacity_kg_s*G.relief_multiplier*shape:0;
    const request=normal+relief,available=Math.max(0,y[27]-G.compliance_kg_per_kpa*G.header_pressure_kpa);
    const scale=request>0?Math.min(1,available/(G.availability_time_s*request)):1;
    r[17][3]=normal*scale;r[18][3]=relief*scale;
    return r;
  }
  function derivative(y,input,reliefOpen,k){
    const r=rates(y,input,reliefOpen),d=Array(SIZE).fill(0);
    TRANSFERS.forEach((t,i)=>{const source=INVENTORY_OFFSETS[t.source],dest=INVENTORY_OFFSETS[t.destination];for(let c=0;c<4;c++){const q=r[i][c];d[t.offset+c]=q;if(source!==undefined)d[source+c]-=q;if(dest!==undefined)d[dest+c]+=q;}});
    for(let c=0;c<4;c++){const g=(c===0?-1:B.kinetics.mass_yields[c])*k*y[0];d[c]+=g;d[28+c]=g;}
    return d;
  }
  function closureVector(y){
    const local=INITIAL.map((v,i)=>v-y[i]),component=[0,0,0,0],incoming=[0,0,0,0],outgoing=[0,0,0,0],localScale=INITIAL.map(Math.abs);
    TRANSFERS.forEach(t=>{const src=INVENTORY_OFFSETS[t.source],dst=INVENTORY_OFFSETS[t.destination];for(let c=0;c<4;c++){const q=y[t.offset+c];if(src!==undefined){local[src+c]-=q;localScale[src+c]+=Math.abs(q);}else incoming[c]+=q;if(dst!==undefined){local[dst+c]+=q;localScale[dst+c]+=Math.abs(q);}else outgoing[c]+=q;}});
    for(let c=0;c<4;c++){local[c]+=y[28+c];localScale[c]+=Math.abs(y[28+c]);for(let i=c;i<28;i+=4)component[c]+=local[i];}
    const total=sum(component),initialTotal=sum(INITIAL),totalLimit=N.closure_abs_kg+N.closure_rel*Math.max(1,initialTotal+sum(incoming));
    const componentLimit=component.map((_,c)=>N.closure_abs_kg+N.closure_rel*Math.max(1,INITIAL.filter((_,i)=>i%4===c).reduce((a,b)=>a+b,0)+incoming[c]+Math.abs(y[28+c])));
    const bound=outgoing.every((q,c)=>q<=incoming[c]+y[28+c]+INITIAL.filter((_,i)=>i%4===c).reduce((a,b)=>a+b,0)+componentLimit[c]);
    return {total_residual_kg:total,component_residual_kg:component,inventory_component_residual_kg:Object.fromEntries(INVENTORIES.map((name,i)=>[name,local.slice(4*i,4*i+4)])),maximum_abs_inventory_residual_kg:Math.max(...local.map(Math.abs)),external_mass_bound_passed:bound,passed:Math.abs(total)<=totalLimit&&component.every((v,c)=>Math.abs(v)<=componentLimit[c])&&local.every((v,i)=>Math.abs(v)<=N.closure_abs_kg+N.closure_rel*Math.max(1,localScale[i]))&&bound};
  }
  function validateInterval(interval,timeMs){
    if(interval===null)return;
    exactKeys(interval,['startMs','endMs','transfers','generation','stream','reliefEvents'],'interval');
    finite(interval.startMs,'INTERVAL');if(interval.startMs<0||interval.endMs!==timeMs||interval.startMs>=interval.endMs)throw Error('invalid interval time');
    exactKeys(interval.transfers,TRANSFERS.map(t=>t.name),'interval transfers');
    const vector4=(a,signed=false)=>{if(!Array.isArray(a)||a.length!==4||a.some(v=>typeof v!=='number'||!Number.isFinite(v)||(!signed&&v<-N.negative_mass_tolerance_kg)))throw Error('invalid interval component amounts');};
    Object.values(interval.transfers).forEach(v=>vector4(v));vector4(interval.generation,true);
    const s=interval.stream;exactKeys(s,['schema','startMs','endMs','water','oil','gas'],'stream');
    if(s.schema!==RECIPE.interface.stream_schema||s.startMs!==interval.startMs||s.endMs!==interval.endMs)throw Error('invalid stream interval');
    for(const phase of ['water','oil','gas']){vector4(s[phase]);if(s[phase].some((v,i)=>v!==interval.transfers['reactor_'+phase][i]))throw Error('stream transfer mismatch');}
    if(!Array.isArray(interval.reliefEvents))throw Error('invalid relief events');
    let prev=interval.startMs,previousOpen=null;
    for(const event of interval.reliefEvents){exactKeys(event,['timeMs','open','pressure'],'relief event');finite(event.timeMs,'EVENT');finite(event.pressure,'PRESSURE');if(event.timeMs<prev||event.timeMs>timeMs||event.pressure<0||typeof event.open!=='boolean')throw Error('invalid relief event');if(previousOpen===event.open||(event.open?event.pressure<G.lift_kpa:event.pressure>=G.reseat_kpa))throw Error('inconsistent relief event');prev=event.timeMs;previousOpen=event.open;}
  }
  function validateState(state){
    exactKeys(state,['schema','recipeId','timeMs','vector','reliefOpen','lastInterval'],'material state');
    if(state.schema!==RECIPE.interface.material_schema||state.recipeId!==RECIPE.id)throw Error('material schema or recipe mismatch');
    finite(state.timeMs,'TIME');if(state.timeMs<0||typeof state.reliefOpen!=='boolean')throw Error('invalid material time or latch');
    checkVector(state.vector);validateInterval(state.lastInterval,state.timeMs);
    if(state.lastInterval){for(const t of TRANSFERS)for(let c=0;c<4;c++)if(state.lastInterval.transfers[t.name][c]>state.vector[t.offset+c]+N.negative_mass_tolerance_kg)throw Error('interval exceeds cumulative transfer');
      const g=state.lastInterval.generation;if(g.some((v,c)=>Math.abs(v)>Math.abs(state.vector[28+c])+N.negative_mass_tolerance_kg))throw Error('interval exceeds cumulative generation');
      const tail=state.lastInterval.reliefEvents.at(-1);if(tail&&tail.open!==state.reliefOpen)throw Error('relief event tail does not match latch');
      if(g[0]>N.negative_mass_tolerance_kg||g.slice(1).some(v=>v<-N.negative_mass_tolerance_kg)||g.slice(1).some((v,i)=>Math.abs(v+B.kinetics.mass_yields[i+1]*g[0])>N.closure_abs_kg+N.closure_rel*Math.max(1,Math.abs(g[0]))))throw Error('invalid interval generation');
    }else if(state.vector.some((v,i)=>v!==(i<28?INITIAL[i]:0)))throw Error('missing material interval');
    if(!closureVector(state.vector).passed)throw Error('MATERIAL_CLOSURE_FAILED');
    return state;
  }
  function create(nowMs=0){finite(nowMs,'TIME');if(nowMs<0)throw Error('negative material time');return {schema:RECIPE.interface.material_schema,recipeId:RECIPE.id,timeMs:nowMs,vector:INITIAL.concat(Array(80).fill(0)),reliefOpen:false,lastInterval:null};}
  function advance(state,input,dtSeconds){
    validateState(state);validateInput(input);finite(dtSeconds,'DT');if(dtSeconds<=0)throw Error('material dt must be positive');
    const endMs=finite(state.timeMs+dtSeconds*1000,'TIME'),k=finite(rateConstant(input),'RATE');
    const count=Math.max(Math.ceil(dtSeconds/N.maximum_step_s),Math.ceil(dtSeconds*(k+input.feed_kg_s/B.reactor.reference_holdup_kg)/N.maximum_reaction_number));
    if(!Number.isSafeInteger(count)||count<1)throw Error('invalid subdivision count');
    const h=dtSeconds/count;let y=state.vector.slice(),open=state.reliefOpen;const events=[];
    function crossed(vector){const pressure=vector[27]/G.compliance_kg_per_kpa;return open?pressure<G.reseat_kpa:pressure>=G.lift_kpa;}
    function latch(timeMs){
      if(!crossed(y))return;
      if(events.length>=N.maximum_events_per_frame)throw Error('MATERIAL_EVENT_LIMIT');
      open=!open;events.push({timeMs,open,pressure:y[27]/G.compliance_kg_per_kpa});
    }
    function rk4(start,step){
      const a=derivative(start,input,open,k),b=derivative(start.map((v,i)=>v+step*a[i]/2),input,open,k),c=derivative(start.map((v,i)=>v+step*b[i]/2),input,open,k),d=derivative(start.map((v,i)=>v+step*c[i]),input,open,k);
      return checkVector(start.map((v,i)=>v+step/6*(a[i]+2*b[i]+2*c[i]+d[i])));
    }
    latch(state.timeMs);
    for(let j=0;j<count;j++){
      let elapsed=0;
      while(elapsed<h){
        const remaining=h-elapsed,trial=rk4(y,remaining);
        if(!crossed(trial)){y=trial;elapsed=h;continue;}
        // Each trial advances every field from the same pre-event vector. The
        // high endpoint always satisfies the strict reseat/non-strict lift.
        let low=0,high=remaining;
        for(let iteration=0;iteration<N.event_bisections;iteration++){
          const middle=(low+high)/2;
          if(crossed(rk4(y,middle)))high=middle;else low=middle;
        }
        if(!(high>0)||elapsed+high===elapsed)throw Error('MATERIAL_EVENT_NO_PROGRESS');
        y=rk4(y,high);elapsed+=high;
        const timeMs=elapsed===h?(j===count-1?endMs:state.timeMs+(j+1)*h*1000):state.timeMs+(j*h+elapsed)*1000;
        latch(timeMs);
      }
    }
    const transfers=Object.fromEntries(TRANSFERS.map(t=>[t.name,y.slice(t.offset,t.offset+4).map((v,i)=>v-state.vector[t.offset+i])])),generation=y.slice(28,32).map((v,i)=>v-state.vector[28+i]);
    const lastInterval={startMs:state.timeMs,endMs,transfers,generation,stream:{schema:RECIPE.interface.stream_schema,startMs:state.timeMs,endMs,water:transfers.reactor_water.slice(),oil:transfers.reactor_oil.slice(),gas:transfers.reactor_gas.slice()},reliefEvents:events};
    return validateState({schema:state.schema,recipeId:state.recipeId,timeMs:endMs,vector:y,reliefOpen:open,lastInterval});
  }
  function geometry(state){validateState(state);return geometryVector(state.vector);}
  function truth(state){validateState(state);const total=sum(state.vector.slice(0,4));return {inventories:Object.fromEntries(INVENTORIES.map((n,i)=>[n,state.vector.slice(4*i,4*i+4)])),external:Object.fromEntries(TRANSFERS.filter(t=>INVENTORY_OFFSETS[t.destination]===undefined).map(t=>[t.name,state.vector.slice(t.offset,t.offset+4)])),conversion_fraction:total>0?1-state.vector[0]/total:null,closure:closureVector(state.vector)};}
  function adapter(state){const g=geometry(state);return {hWater:g.levels_percent.hw,hOil:g.levels_percent.ho,h2:g.levels_percent.h2,pressure:state.vector[27]/G.compliance_kg_per_kpa,reliefOpen:state.reliefOpen,lastInterval:state.lastInterval,transfers:state.lastInterval?state.lastInterval.transfers:null,reliefEvents:state.lastInterval?state.lastInterval.reliefEvents:[]};}
  return {RECIPE,SIZE,GENERATION_OFFSET,INVENTORIES,INVENTORY_OFFSETS,TRANSFERS,TRANSFER_OFFSETS,INPUT_KEYS,create,advance,validateState,validateInput,geometry,truth,adapter,rateConstant};
});
