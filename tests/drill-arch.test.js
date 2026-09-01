// @artifact dev
// Unit tests for src/drill-arch.js (V3-PLAN sections 4, 6, 9). Stage SA: pure data +
// pure scorer, no app wiring. Every module-level test requires drill-arch.js directly
// -- there is no global ESS.DrillArch after tools/logic-harness's load(), since SA
// forbids adding script tags (see the stage advisory).
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DrillArch = require('../src/drill-arch.js');
const Topology = require('../src/topology.js');
const Instructor = require('../src/instructor.js');
const { newSim } = require('./_fixture');

const PRESET_IDS = Instructor.presets().map(p => p.id);

// One real graph, built once, shared read-only by every test below (the graph is
// stateless data -- V3-PLAN addendum section D / the stage advisory).
const c = newSim();
const GRAPH = Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: t => c.unitOf(t) });
assert.deepEqual(Topology.validate(GRAPH), [], 'precondition: the shared graph must itself be valid');

// ---------------------------------------------------------------- structural shape

test('twelve drills, unique ids A1-A12, no more and no fewer', () => {
  const ids = DrillArch.drillIds();
  assert.equal(DrillArch.DRILLS.length, 12);
  assert.equal(new Set(ids).size, 12, 'drill ids must be unique');
  const expected = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12'];
  assert.deepEqual(ids.slice().sort(), expected.slice().sort());
});

test('drillById resolves every id and returns null for an unknown one', () => {
  DrillArch.drillIds().forEach(id => {
    const d = DrillArch.drillById(id);
    assert.ok(d, id + ' must resolve');
    assert.equal(d.id, id);
  });
  assert.equal(DrillArch.drillById('A13'), null);
  assert.equal(DrillArch.drillById('D1'), null, 'legacy D-series ids are not A-series drills');
});

test('every drill and the DRILLS array are frozen, all the way down (not just the top level)', () => {
  // FINDING (fixed in place): Object.freeze is shallow. A drill's nested
  // expectedActions/scoringRules/faultTimeline/safetyGate entries -- and any
  // array-valued rule target, e.g. A4's three-CM gate -- were still mutable even
  // though the drill object itself was frozen, which let any caller holding a
  // reference silently corrupt the shared DRILLS singleton for every later call in
  // the same process. Proven here by attempting a real mutation and confirming both
  // that it is rejected AND that it would not have altered scoreDrill's output.
  assert.ok(Object.isFrozen(DrillArch.DRILLS));
  DrillArch.DRILLS.forEach(d => {
    assert.ok(Object.isFrozen(d), d.id + ' should be frozen');
    assert.ok(Object.isFrozen(d.expectedActions), d.id + '.expectedActions should be frozen');
    d.expectedActions.forEach((a, i) => assert.ok(Object.isFrozen(a), d.id + '.expectedActions[' + i + '] should be frozen'));
    assert.ok(Object.isFrozen(d.scoringRules), d.id + '.scoringRules should be frozen');
    d.scoringRules.forEach((r, i) => assert.ok(Object.isFrozen(r), d.id + '.scoringRules[' + i + '] should be frozen'));
    assert.ok(Object.isFrozen(d.faultTimeline), d.id + '.faultTimeline should be frozen');
    d.faultTimeline.forEach((f, i) => assert.ok(Object.isFrozen(f), d.id + '.faultTimeline[' + i + '] should be frozen'));
    assert.ok(Object.isFrozen(d.safetyGate), d.id + '.safetyGate should be frozen');
    d.safetyGate.forEach((g, i) => {
      assert.ok(Object.isFrozen(g), d.id + '.safetyGate[' + i + '] should be frozen');
      if (Array.isArray(g.target)) assert.ok(Object.isFrozen(g.target), d.id + '.safetyGate[' + i + '].target array should be frozen');
    });
  });

  // Positive control: prove a mutation attempt on a nested entry is actually
  // rejected (silently, since this test file is not itself 'use strict'), and that
  // scoreDrill's output for an untouched call is unaffected by the attempt.
  const a1 = DrillArch.drillById('A1');
  const journal = [{ seq: 1, simTime: 1000, actor: 'TRAINEE', actionType: a1.expectedActions[0].actionType, target: a1.expectedActions[0].target, accepted: true }];
  const before = DrillArch.scoreDrill('A1', journal);
  a1.expectedActions[0].actionType = 'HACKED.ACTION';
  assert.notEqual(a1.expectedActions[0].actionType, 'HACKED.ACTION', 'mutation of a frozen nested entry must not take effect');
  const after = DrillArch.scoreDrill('A1', journal);
  assert.deepEqual(after, before, 'a rejected mutation attempt must leave scoreDrill\'s output unchanged');
});

test('FAULT_IDS: thirteen unique ids, matching V3-PLAN section 5\'s catalogue order', () => {
  assert.equal(DrillArch.FAULT_IDS.length, 13);
  assert.equal(new Set(DrillArch.FAULT_IDS).size, 13);
  assert.equal(DrillArch.FAULT_IDS[0], 'FROZEN_MEASUREMENT');
  assert.equal(DrillArch.FAULT_IDS[DrillArch.FAULT_IDS.length - 1], 'ASSISTANT_LOSS');
  assert.ok(Object.isFrozen(DrillArch.FAULT_IDS));
});

test('CATEGORIES has exactly the five named rubric categories', () => {
  assert.deepEqual(DrillArch.CATEGORIES.slice().sort(),
    ['debrief', 'evidence', 'localization', 'stabilize', 'verification']);
});

test('DEFAULT_WEIGHTS sums to 100', () => {
  const sum = DrillArch.CATEGORIES.reduce((a, c) => a + DrillArch.DEFAULT_WEIGHTS[c], 0);
  assert.equal(sum, 100);
});

test('module source is dependency-free: no require of topology, fault-engine, dispatch or signal-path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'drill-arch.js'), 'utf8');
  assert.doesNotMatch(src, /require\(\s*['"]\.\/(topology|fault-engine|dispatch|signal-path)/);
  assert.equal(src.split('\n')[0], '// @artifact production');
});

// ---------------------------------------------------------------- data cross-checks

test('every fault id a drill references exists in FAULT_IDS', () => {
  DrillArch.DRILLS.forEach(d => {
    DrillArch.faultIdsOf(d).forEach(fid => {
      assert.ok(DrillArch.FAULT_IDS.includes(fid), d.id + ' references unknown fault id ' + fid);
    });
  });
});

test('every fault id in the catalogue is actually used by at least one drill, or is a deliberate future-use entry (documented)', () => {
  // Not all 13 catalogue entries need a drill in THIS release (A1-A12 do not exhaust
  // the fault catalogue -- NOISY_MEASUREMENT and VALVE_RESPONSE_FAILURE are reserved
  // for future/compound drills). This test documents that gap rather than hiding it.
  const used = new Set();
  DrillArch.DRILLS.forEach(d => DrillArch.faultIdsOf(d).forEach(f => used.add(f)));
  const unused = DrillArch.FAULT_IDS.filter(f => !used.has(f));
  assert.deepEqual(unused.slice().sort(), ['NOISY_MEASUREMENT', 'VALVE_RESPONSE_FAILURE']);
});

test('every topology node id a drill references resolves in the real built graph', () => {
  DrillArch.DRILLS.forEach(d => {
    const refs = DrillArch.nodeRefsOf(d);
    assert.ok(refs.length > 0, d.id + ' must reference at least one topology node');
    refs.forEach(nid => {
      assert.ok(Topology.node(GRAPH, nid), d.id + ' references node ' + nid + ', which does not exist in the built graph');
    });
  });
});

test('every localization hypothesis domain is a real topology layer', () => {
  DrillArch.DRILLS.forEach(d => {
    const domains = DrillArch.domainsOf(d);
    assert.equal(domains.length, 1, d.id + ' must declare exactly one hypothesis domain');
    assert.ok(Topology.LAYERS.includes(domains[0]), d.id + ' domain ' + domains[0] + ' is not a real layer');
  });
});

test('every basePreset is a real instructor preset id', () => {
  DrillArch.DRILLS.forEach(d => {
    assert.ok(PRESET_IDS.includes(d.basePreset), d.id + ' basePreset ' + d.basePreset + ' is not in ESS.Instructor.presets()');
  });
});

test('A12 keeps the biased transmitter in FIELD while controller and process responses remain consequences', () => {
  // The controller is healthy: its warmer cascade demand is the deterministic
  // consequence of trusting the biased field input, not a second failure domain.
  const a12 = DrillArch.drillById('A12');
  assert.equal(DrillArch.domainsOf(a12)[0], 'FIELD');
  assert.equal(Topology.node(GRAPH, 'XMTR-TIC201').layer, 'FIELD');
});

// ---------------------------------------------------------------- rubric weights

test('per-drill EFFECTIVE scoring weights sum to exactly 100, across all twelve', () => {
  DrillArch.DRILLS.forEach(d => {
    assert.equal(d.scoringRules.length, DrillArch.CATEGORIES.length, d.id + ' must carry all five categories');
    const cats = d.scoringRules.map(r => r.category).sort();
    assert.deepEqual(cats, DrillArch.CATEGORIES.slice().sort(), d.id + ' scoringRules must cover exactly the five categories');
    const sum = d.scoringRules.reduce((a, r) => a + r.weight, 0);
    assert.equal(sum, 100, d.id + ' effective weights must sum to 100, got ' + sum);
  });
});

test('at least one drill overrides the default weights (per-drill overrides are real, not vacuous)', () => {
  const overridden = DrillArch.DRILLS.filter(d => {
    const w = {};
    d.scoringRules.forEach(r => { w[r.category] = r.weight; });
    return DrillArch.CATEGORIES.some(c => w[c] !== DrillArch.DEFAULT_WEIGHTS[c]);
  });
  assert.ok(overridden.length >= 2, 'expected at least two drills with non-default weights');
});

// ---------------------------------------------------------------- expectedActions / safetyGate shape

test('every drill has a reachable stabilization policy, required actions for the other categories, and a safetyGate rule', () => {
  DrillArch.DRILLS.forEach(d => {
    DrillArch.CATEGORIES.forEach(cat => {
      const req = d.expectedActions.filter(a => a.category === cat && a.required !== false);
      if (cat === 'stabilize' && d.stabilizationPolicy === 'SAFE_RESTRAINT') {
        assert.equal(req.length, 0, d.id + ' safe-restraint policy must not hide an alarm ACK inside expectedActions');
      } else {
        assert.ok(req.length >= 1, d.id + ' has no required expectedAction for category ' + cat);
      }
    });
    assert.ok(d.stabilizationPolicy === 'ACK' || d.stabilizationPolicy === 'SAFE_RESTRAINT', d.id + ' unknown stabilization policy');
    assert.ok(d.safetyGate.length >= 1, d.id + ' has no safetyGate rule');
    d.safetyGate.forEach(g => {
      assert.ok(g.actionType, d.id + ' safetyGate rule missing actionType');
      assert.ok(g.description, d.id + ' safetyGate rule missing description');
    });
  });
});

test('every drill carries non-empty objectives, hints and sourceBasis', () => {
  DrillArch.DRILLS.forEach(d => {
    assert.ok(d.objectives.length >= 1, d.id + ' objectives');
    assert.ok(d.hints.length >= 1, d.id + ' hints');
    assert.ok(d.sourceBasis.length >= 1, d.id + ' sourceBasis');
    assert.ok(d.completionRules.length >= 1, d.id + ' completionRules');
    assert.ok(d.abortRules.length >= 1, d.id + ' abortRules');
  });
});

// ---------------------------------------------------------------- matchAction

test('matchAction: rejected actions (accepted === false) never match, even with an otherwise-perfect shape', () => {
  const rule = { actionType: 'ACK', target: 'XMTR-FIC102' };
  assert.equal(DrillArch.matchAction({ actionType: 'ACK', target: 'XMTR-FIC102', accepted: true }, rule), true);
  assert.equal(DrillArch.matchAction({ actionType: 'ACK', target: 'XMTR-FIC102', accepted: false }, rule), false);
  // accepted omitted entirely defaults to "happened" (matches existing journal entries, which predate the accepted field)
  assert.equal(DrillArch.matchAction({ actionType: 'ACK', target: 'XMTR-FIC102' }, rule), true);
});

test('matchAction: PIN_COMPARE targets match as a set, order-independent, and reject a wrong pairing', () => {
  const rule = { actionType: 'TRAINING.PIN_COMPARE', payloadMatch: { targets: ['XMTR-FIC102', 'VLV-FV102'] } };
  assert.equal(DrillArch.matchAction({ actionType: 'TRAINING.PIN_COMPARE', payload: { targets: ['VLV-FV102', 'XMTR-FIC102'] } }, rule), true, 'order must not matter');
  assert.equal(DrillArch.matchAction({ actionType: 'TRAINING.PIN_COMPARE', payload: { targets: ['XMTR-FIC102', 'CM-CM2_FIC102'] } }, rule), false, 'wrong second target must not match');
  assert.equal(DrillArch.matchAction({ actionType: 'TRAINING.PIN_COMPARE', payload: { targets: ['XMTR-FIC102'] } }, rule), false, 'a subset must not match');
});

test('matchAction: an array rule target matches ANY listed value (the A4 multi-loop gate shape)', () => {
  const a4 = DrillArch.drillById('A4');
  const gate = a4.safetyGate[0];
  assert.ok(Array.isArray(gate.target) && gate.target.length > 1);
  gate.target.forEach(t => {
    assert.equal(DrillArch.matchAction({ actionType: gate.actionType, target: t, payload: { mode: 'MAN' } }, gate), true);
  });
  assert.equal(DrillArch.matchAction({ actionType: gate.actionType, target: 'CM-CM12_TIC213', payload: { mode: 'MAN' } }, gate), false, 'an unrelated CM must not trip A4\'s gate');
});

// ---------------------------------------------------------------- scoreDrill: generic, per-drill

function idealJournal(d) {
  // One accepted ActionEvent per required expectedAction, built directly from the
  // drill's own data -- this is the "everything done right" journal for any drill.
  let seq = 0;
  const receipt = {seq:++seq,simTime:0,actor:'SYSTEM',actionType:DrillArch.ACTION.FAULT_PRESENT,target:d.id,accepted:true};
  return [receipt].concat(d.expectedActions.filter(a => a.required !== false).map(a => {
    seq += 1;
    const e = { seq, simTime: seq * 1000, actor: 'TRAINEE', actionType: a.actionType, accepted: true };
    if (a.target !== undefined) e.target = Array.isArray(a.target) ? a.target[0] : a.target;
    if (a.payloadMatch) e.payload = JSON.parse(JSON.stringify(a.payloadMatch));
    return e;
  }));
}

test('scoreDrill throws on an unknown drill id', () => {
  assert.throws(() => DrillArch.scoreDrill('A99', []), /unknown drill id/);
});

test('scoreDrill: empty journal scores 0 and fails, for every drill (positive control against a vacuous default)', () => {
  DrillArch.DRILLS.forEach(d => {
    const r = DrillArch.scoreDrill(d.id, []);
    assert.equal(r.score, 0, d.id);
    assert.equal(r.pass, false, d.id);
    assert.equal(r.gated, false, d.id);
    assert.ok(r.breakdown.every(row => row.earned === 0), d.id + ' every category should earn 0 on an empty journal');
  });
});

test('scoreDrill: on ACK-policy drills, a matching accepted ACK earns exactly the stabilize category', () => {
  DrillArch.DRILLS.filter(d => d.stabilizationPolicy === 'ACK').forEach(d => {
    const ack = d.expectedActions.find(a => a.category === 'stabilize');
    const journal = [
      {seq:0,simTime:0,actor:'SYSTEM',actionType:DrillArch.ACTION.FAULT_PRESENT,target:d.id,accepted:true},
      { seq: 1, simTime: 1000, actor: 'TRAINEE', actionType: ack.actionType, target: ack.target, accepted: true }
    ];
    const r = DrillArch.scoreDrill(d.id, journal);
    const stabilizeWeight = d.scoringRules.find(row => row.category === 'stabilize').weight;
    assert.equal(r.score, stabilizeWeight, d.id);
    assert.equal(r.pass, stabilizeWeight >= 80, d.id);
    r.breakdown.forEach(row => {
      if (row.category === 'stabilize') assert.equal(row.earned, stabilizeWeight);
      else assert.equal(row.earned, 0, d.id + ' category ' + row.category + ' should earn nothing');
    });
  });
});

test('scoreDrill: the ideal journal for every drill scores 100 and passes, ungated', () => {
  DrillArch.DRILLS.forEach(d => {
    const r = DrillArch.scoreDrill(d.id, idealJournal(d));
    assert.equal(r.score, 100, d.id + ' ideal journal should score 100, got ' + r.score + ' (' + JSON.stringify(r.breakdown) + ')');
    assert.equal(r.pass, true, d.id);
    assert.equal(r.gated, false, d.id);
  });
});

test('SAFETY GATE: adding the drill\'s own major-unsafe action to an otherwise-ideal journal caps the score below pass, for every drill', () => {
  DrillArch.DRILLS.forEach(d => {
    const clean = idealJournal(d);
    const cleanResult = DrillArch.scoreDrill(d.id, clean);
    assert.equal(cleanResult.score, 100, d.id + ' precondition: clean journal must score 100');
    assert.equal(cleanResult.pass, true, d.id + ' precondition: clean journal must pass');

    const gate = d.safetyGate[0];
    const gatedEntry = {
      seq: 999, simTime: 999000, actor: 'TRAINEE', actionType: gate.actionType,
      accepted: true,
      target: Array.isArray(gate.target) ? gate.target[0] : gate.target,
      payload: gate.payloadMatch ? JSON.parse(JSON.stringify(gate.payloadMatch)) : undefined
    };
    const gatedJournal = clean.concat([gatedEntry]);
    const gatedResult = DrillArch.scoreDrill(d.id, gatedJournal);

    assert.equal(gatedResult.gated, true, d.id + ' the gate rule must be detected as tripped');
    assert.ok(gatedResult.score < 80, d.id + ' a gated score must fall below the pass mark, got ' + gatedResult.score);
    assert.equal(gatedResult.pass, false, d.id + ' a gated drill must never pass, regardless of every other point earned');
    assert.ok(gatedResult.gateHits.includes('GATE'), d.id);
  });
});

test('SAFETY GATE: a rejected (accepted: false) gate action does not cap the score', () => {
  const d = DrillArch.drillById('A1');
  const clean = idealJournal(d);
  const gate = d.safetyGate[0];
  const rejected = {
    seq: 999, simTime: 999000, actor: 'TRAINEE', actionType: gate.actionType, target: gate.target,
    accepted: false, payload: gate.payloadMatch
  };
  const r = DrillArch.scoreDrill(d.id, clean.concat([rejected]));
  assert.equal(r.gated, false);
  assert.equal(r.score, 100);
  assert.equal(r.pass, true);
});

test('scoreDrill ignores unrelated journal noise interleaved with the real actions', () => {
  const d = DrillArch.drillById('A3');
  const clean = idealJournal(d);
  const noise = [
    { seq: 500, simTime: 500, actor: 'TRAINEE', actionType: 'ACK', target: 'SOMETHING-ELSE', accepted: true },
    { seq: 501, simTime: 501, actor: 'INSTRUCTOR', actionType: 'TRAINING.MARK_EVIDENCE', target: 'NOT-A-REAL-NODE', accepted: true }
  ];
  const withNoise = noise.concat(clean);
  const r1 = DrillArch.scoreDrill(d.id, clean);
  const r2 = DrillArch.scoreDrill(d.id, withNoise);
  assert.deepEqual(r1, r2);
});

test('scoreDrill is deterministic: identical inputs produce byte-identical output, repeatedly', () => {
  const d = DrillArch.drillById('A7');
  const journal = idealJournal(d).concat([{
    seq: 999, simTime: 999000, actor: 'TRAINEE', actionType: d.safetyGate[0].actionType,
    target: Array.isArray(d.safetyGate[0].target) ? d.safetyGate[0].target[0] : d.safetyGate[0].target,
    accepted: true, payload: d.safetyGate[0].payloadMatch
  }]);
  const results = [1, 2, 3].map(() => DrillArch.scoreDrill(d.id, journal));
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});

test('scoreDrill never exceeds 100 or drops below 0 (score is clamped)', () => {
  const d = DrillArch.drillById('A2');
  const r = DrillArch.scoreDrill(d.id, idealJournal(d));
  assert.ok(r.score <= 100 && r.score >= 0);
});
