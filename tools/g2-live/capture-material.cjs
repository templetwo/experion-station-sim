// @artifact dev
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const M=require('../../src/material-model');
const recipePath=path.join(__dirname,'recipe-v2.json'),recipeBytes=fs.readFileSync(recipePath);
assert.deepEqual(M.RECIPE,JSON.parse(recipeBytes));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const metadata={recipe_id:M.RECIPE.id,recipe_sha256:sha(recipeBytes),model_sha256:sha(fs.readFileSync(path.join(__dirname,'../../src/material-model.js'))),node_version:process.version};
const cases=JSON.parse(fs.readFileSync(0,'utf8')),output={};
for(const [name,segments] of Object.entries(cases)){
  let state=M.create();const times=[0],states=[state.vector],events=[];let closureMax=0;
  for(const segment of segments){
    const frames=Math.round(segment.duration_s/.5);
    if(Math.abs(frames*.5-segment.duration_s)>1e-12)throw Error('case duration must resolve frame grid');
    for(let i=0;i<frames;i++){
      state=M.advance(state,segment.input,.5);times.push(state.timeMs/1000);states.push(state.vector);
      events.push(...state.lastInterval.reliefEvents.map(e=>({time_s:e.timeMs/1000,open:e.open,pressure:e.pressure})));
      const c=M.truth(state).closure;if(!c.passed)throw Error('closure failed');closureMax=Math.max(closureMax,c.maximum_abs_inventory_residual_kg,Math.abs(c.total_residual_kg));
    }
  }
  output[name]={times,states,events,maximum_closure_kg:closureMax};
}
process.stdout.write(JSON.stringify({metadata,cases:output}));
