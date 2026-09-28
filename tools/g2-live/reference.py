#!/usr/bin/env python3
# @artifact dev
"""Independent SciPy gas extension of the unchanged geometry reference.

The legacy Python geometry derivative is imported by path, never modified.
Gas pressure is the declared synthetic compliance law, not a property model.
DOP853 locates continuous relief crossings; live RK4 changes latch only at its
substep boundaries. Comparison therefore includes pressure and event time.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import platform
import subprocess

import numpy as np
import scipy
from scipy.integrate import solve_ivp

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('frozen_geometry_model', HERE.parent/'g2-geometry/model.py')
legacy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
RECIPE=json.loads((HERE/'recipe.json').read_text())
B=RECIPE['geometry_basis']; G=RECIPE['gas']; CFG=RECIPE['integration']
INVENTORIES=legacy.INVENTORIES+('gas',)
TRANSFERS=[dict(t) for t in legacy.TRANSFERS]+[
    dict(name='normal_vent',source='gas',destination='external_gas'),
    dict(name='relief_vent',source='gas',destination='external_gas')]
TRANSFERS[3]['destination']='gas'
INCIDENCE=np.zeros((7,19))
for j,entry in enumerate(TRANSFERS):
    for key,sign in (('source',-1),('destination',1)):
        if entry[key] in INVENTORIES: INCIDENCE[INVENTORIES.index(entry[key]),j]=sign


def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def initial_state():
    y=np.zeros(108); old=legacy.initial_state(B); y[:24]=old[:24]; y[27]=G['initial_mass_kg']
    return y


def inputs(**changes):
    return dict(feed_kg_s=40*800/3600,temperature_k=650.,activity=1.,water_valve=.45,
                product_valve=.5,weir_height_percent=55.,divert_fraction=0.,gas_valve=.4)|changes


def segment(duration_s,**changes): return dict(duration_s=duration_s,input=inputs(**changes))


def cases():
    return {
        'nominal': [segment(60)],
        'closed-normal-vent-relief-cycles': [segment(300,gas_valve=0)],
        'zero-feed-vent-down': [segment(300,feed_kg_s=0,gas_valve=1)],
        'crest-carry-starvation': [segment(10,weir_height_percent=30,water_valve=0),segment(20,weir_height_percent=90,water_valve=1),segment(20,feed_kg_s=0,water_valve=1,product_valve=1)],
        'maximum-temperature-activity-feed': [segment(15,temperature_k=2200,activity=2.1,feed_kg_s=20)],
        'minimum-temperature-zero-activity': [segment(30,temperature_k=250,activity=0)],
        'heater-loss-restoration': [segment(30),segment(90,temperature_k=450),segment(60)],
        'blocked-and-diverted-product': [segment(30,product_valve=0),segment(30,divert_fraction=1)]
    }


def derivative(y,values,opened):
    old=np.empty(96);old[:24]=y[:24];old[24:28]=y[28:32];old[28:]=y[32:100]
    k=legacy.rate_constant(B,values['temperature_k'],values['activity'])
    d0=legacy._derivative(B,old,values,k)
    d=np.zeros(108);d[:24]=d0[:24];d[28:32]=d0[24:28];d[32:100]=d0[28:]
    pressure=y[27]/G['compliance_kg_per_kpa']
    shape=np.sqrt(max(0,pressure-G['header_pressure_kpa'])/G['reference_delta_pressure_kpa'])
    normal=G['normal_capacity_kg_s']*values['gas_valve']*shape
    relief=G['normal_capacity_kg_s']*G['relief_multiplier']*shape if opened else 0
    requested=normal+relief
    available=max(0,y[27]-G['compliance_kg_per_kpa']*G['header_pressure_kpa'])
    scale=min(1,available/(G['availability_time_s']*requested)) if requested else 1
    d[103]=normal*scale;d[107]=relief*scale
    d[27]=d[47]-d[103]-d[107]
    if not np.isfinite(d).all(): raise ValueError('nonfinite reference derivative')
    if y[27]<-CFG['negative_mass_tolerance_kg']: raise ValueError('negative reference gas mass')
    return d


def simulate(segments,refinement=1):
    y=initial_state(); times=[0.]; states=[y.copy()]; events=[]; now=0.; opened=False
    for segment in segments:
        values=segment['input'];end=now+segment['duration_s']
        if set(values)!=set(RECIPE['input_domain']): raise ValueError('input keys')
        for name,value in values.items():
            low,high=RECIPE['input_domain'][name]
            if isinstance(value,bool) or not np.isfinite(value) or not low<=value<=high: raise ValueError('input domain')
        grid=now+np.arange(1,round(segment['duration_s']/.5)+1)*.5
        cursor=0;t=now
        while t<end:
            threshold=G['reseat_kpa'] if opened else G['lift_kpa']
            def event(t,z): return z[27]/G['compliance_kg_per_kpa']-threshold
            event.terminal=True;event.direction=-1 if opened else 1
            sol=solve_ivp(lambda t,z:derivative(z,values,opened),(t,end),y,method='DOP853',dense_output=True,
                          events=event,rtol=CFG['reference_rtol']/refinement,
                          atol=CFG['reference_atol_kg']/refinement,max_step=CFG['reference_max_step_s'])
            if not sol.success: raise RuntimeError(sol.message)
            stop=float(sol.t[-1])
            while cursor<len(grid) and grid[cursor]<=stop:
                times.append(float(grid[cursor]));states.append(sol.sol(grid[cursor]));cursor+=1
            y=sol.y[:,-1];t=stop
            if len(sol.t_events[0]):
                opened=not opened;events.append(dict(time_s=t,open=opened,pressure=float(y[27]/G['compliance_kg_per_kpa'])))
            elif t<end: raise RuntimeError('reference stopped without event')
        now=end
    return dict(times=np.asarray(times),states=np.asarray(states),events=events)


def closure(states):
    states=np.asarray(states);initial=initial_state()[:28].reshape(7,4)
    transfers=states[:,32:].reshape(-1,19,4);generation=states[:,28:32]
    local=initial[None,:,:]+np.einsum('ij,tjk->tik',INCIDENCE,transfers)-states[:,:28].reshape(-1,7,4)
    local[:,0,:]+=generation
    component=local.sum(axis=1);total=component.sum(axis=1)
    external=[i for i,t in enumerate(TRANSFERS) if t['destination'] not in INVENTORIES]
    incoming=transfers[:,0,:];outgoing=transfers[:,external,:].sum(axis=1)
    scale=np.maximum(1,initial+np.einsum('ij,tjk->tik',np.abs(INCIDENCE),np.abs(transfers)))
    scale[:,0,:]+=np.abs(generation)
    component_limit=CFG['closure_abs_kg']+CFG['closure_rel']*np.maximum(1,initial.sum(axis=0)+incoming+np.abs(generation))
    total_limit=CFG['closure_abs_kg']+CFG['closure_rel']*np.maximum(1,initial.sum()+incoming.sum(axis=1))
    nonnegative=bool(np.min(states[:,:28])>=-CFG['negative_mass_tolerance_kg'] and np.min(states[:,32:])>=-CFG['negative_mass_tolerance_kg'])
    bounds=bool(np.all(outgoing<=initial.sum(axis=0)+incoming+generation+component_limit))
    passed=bool(np.all(np.abs(local)<=CFG['closure_abs_kg']+CFG['closure_rel']*scale) and np.all(np.abs(component)<=component_limit) and np.all(np.abs(total)<=total_limit) and bounds and nonnegative)
    return dict(passed=passed,maximum_local_residual_kg=float(np.abs(local).max()),maximum_component_residual_kg=float(np.abs(component).max()),maximum_total_residual_kg=float(np.abs(total).max()),nonnegative=nonnegative,external_bound_passed=bounds)


def compare(candidate,reference):
    if not np.array_equal(candidate['times'],reference['times']): raise ValueError('observation grid mismatch')
    a=np.asarray(candidate['states']);b=reference['states'];error=np.abs(a-b)
    limit=CFG['mass_abs_tolerance_kg']+CFG['mass_rel_tolerance']*np.maximum(np.abs(a),np.abs(b))
    pressure=float(np.max(error[:,27]/G['compliance_kg_per_kpa']))
    ce,re=candidate['events'],reference['events']
    same_events=len(ce)==len(re) and all(c['open']==r['open'] for c,r in zip(ce,re))
    event_error=max((abs(c['time_s']-r['time_s']) for c,r in zip(ce,re)),default=0) if same_events else None
    return dict(maximum_mass_error_kg=float(error.max()),maximum_mass_tolerance_fraction=float((error/limit).max()),
                maximum_pressure_error_kpa=pressure,event_sequence_matches=same_events,maximum_event_time_error_s=event_error,
                passed=bool(np.all(error<=limit) and pressure<=CFG['pressure_abs_tolerance_kpa'] and same_events and event_error<=CFG['relief_event_time_tolerance_s']))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path);args=parser.parse_args()
    if digest(HERE.parent/'g2-geometry/recipe.json')!=RECIPE['geometry_basis_sha256']: raise ValueError('frozen geometry recipe changed')
    if json.loads((HERE.parent/'g2-geometry/recipe.json').read_text())!=B: raise ValueError('embedded geometry basis differs')
    specs=cases(); capture=json.loads(subprocess.check_output(['node',str(HERE/'capture-material.cjs')],input=json.dumps(specs).encode(),cwd=ROOT))
    receipt=dict(_artifact='@artifact dev',schema='g2-live-reference-receipt-v1',recipe_id=RECIPE['id'],scope='new live material equations over declared probes; no chemical/property/energy validation',
                 versions=dict(python=platform.python_version(),numpy=np.__version__,scipy=scipy.__version__),integration=CFG,
                 source_sha256={str(path.relative_to(ROOT)):digest(path) for path in (HERE/'recipe.json',HERE/'reference.py',HERE/'capture-material.cjs',ROOT/'src/material-model.js',ROOT/'src/material-recipe.js',HERE.parent/'g2-geometry/model.py')},cases={})
    for name,segments in specs.items():
        print('Reference '+name,flush=True)
        ref=simulate(segments);tight=simulate(segments,100);js=capture[name]
        comparison=compare(js,ref);refinement=compare(ref,tight);ledgers=dict(candidate=closure(js['states']),reference=closure(ref['states']),refined_reference=closure(tight['states']))
        result=dict(segments=segments,observations=len(ref['times']),comparison=comparison,reference_refinement=refinement,closure=ledgers,candidate_events=js['events'],reference_events=ref['events'])
        result['passed']=comparison['passed'] and refinement['passed'] and all(x['passed'] for x in ledgers.values());receipt['cases'][name]=result
        print(name, result['passed'],comparison,flush=True)
    receipt['passed']=all(c['passed'] for c in receipt['cases'].values())
    output=json.dumps(receipt,indent=2,allow_nan=False)+'\n'
    if args.out: args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(output)
    else: print(output)
    return 0 if receipt['passed'] else 1

if __name__=='__main__': raise SystemExit(main())
