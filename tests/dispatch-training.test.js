// @artifact dev
// S3 lane: the evidence/hypothesis command surface. V3-PLAN section 6, "Evidence and
// hypothesis are first-class commands, journaled and scored."
//
// THE TEST THIS FILE EXISTS FOR IS SECTION 1. Every other assertion here would have passed
// against a version of these commands that scored ZERO. src/drill-arch.js is the scorer and
// matches actionType as an exact string; src/dispatch.js is where the command is born. Two
// modules, two suites, both green, nothing spanning them -- the signature of every prose-
// versus-code divergence this build has produced. Section 1 spans them, on the real DRILLS
// and the real graph, so the vocabulary cannot drift again without this going red.
//
// Built by seat mbp-v3-gates (claude-opus-5), lane s3-evidence. Owns src/dispatch.js and
// this file; touches nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Dispatch = require('../src/dispatch.js');
const Topology = require('../src/topology.js');
const DrillArch = require('../src/drill-arch.js');
const Instructor = require('../src/instructor.js');
const fs = require('node:fs');
const path = require('node:path');

function builtGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}
const graph = builtGraph();

/** A ctx wired the way the app will wire it: a real graph, an inspection record, and a
 *  journal that stamps seq exactly as ESS.Instructor.journalAdd does. */
function makeCtx(opts) {
  opts = opts || {};
  const inspected = new Set(opts.inspected || []);
  const I = Instructor.create({});
  return {
    graph,
    // Every scoring command is mode-gated and FAILS CLOSED, so a ctx with no archMode
    // refuses everything. Default to the mode the four evidence commands live in.
    archMode: opts.archMode === undefined ? 'diagnose' : opts.archMode,
    training: Dispatch.createTrainingState(),
    instr: I,
    journal: I.journal,
    inspect: (id) => inspected.add(id),
    wasInspected: opts.omitInspection ? undefined : ((id) => inspected.has(id)),
    journalAdd: (entry) => Instructor.journalAdd(I, entry)
  };
}

function wired(ctx) { return Dispatch.registerTraining(Dispatch.create()); }

// ==================================================== 1. THE CROSS-MODULE VOCABULARY

test('the command vocabulary is the one the scorer actually matches', async (t) => {
  await t.test('dispatch TYPES equal drill-arch ACTION, string for string', () => {
    // drill-arch does not export ACTION, so read the drills themselves -- the values that
    // actually reach matchAction.
    const a1 = DrillArch.drillById('A1');
    const byId = {};
    a1.expectedActions.forEach((x) => { byId[x.id] = x.actionType; });
    assert.equal(byId.EV1, Dispatch.TYPES.MARK_EVIDENCE);
    assert.equal(byId.EV2, Dispatch.TYPES.PIN_COMPARE);
    assert.equal(byId.LOC, Dispatch.TYPES.SUBMIT_HYPOTHESIS);
    assert.equal(byId.VER, Dispatch.TYPES.VERIFY);
  });

  await t.test('LAYERS is identical to src/topology.js LAYERS', () => {
    // dispatch pins its own copy (no sibling require, for browser purity). This is the
    // assertion that keeps the copy from drifting.
    assert.deepEqual(Dispatch.LAYERS.slice(), Topology.LAYERS.slice());
  });

  await t.test('END TO END: dispatched commands actually SCORE on a real drill', () => {
    // The proof the other tests cannot give. If the vocabulary were bare instead of
    // dotted, every command below would journal perfectly and earn nothing.
    // primary/compare/domain are SPEC fields, absent from the built drill -- derive the
    // expectations from the drill's own expectedActions, which is what the scorer reads.
    const drill = DrillArch.drillById('A1');
    const act = {};
    drill.expectedActions.forEach((x) => { act[x.id] = x; });
    const primary = act.EV1.target;
    const compare = act.EV2.payloadMatch.targets.slice();
    const domain = act.LOC.payloadMatch.domain;
    const ctx = makeCtx();
    const d = wired(ctx);
    [primary].concat(compare, [act.VER.target]).forEach((n) => ctx.inspect(n));

    // TWO RECORDS, TWO SHAPES, TWO CONSUMERS -- and this is the part that will bite the
    // app wiring. dispatch() JOURNALS a legacy entry {t, op, tag, arg} (what journalText
    // and replayPlan consume) and RETURNS an ActionEvent {seq, simTime, actor, actionType,
    // target, payload, accepted} (what drill-arch's matchAction consumes: it reads
    // e.actionType, e.target, e.payload, and a legacy entry has none of those field
    // names). Feeding the journal to scoreDrill scores ZERO with no error. So S3's app
    // wiring must retain the RETURNED events for scoring, not re-read the journal.
    const events = [{seq:0,simTime:0,actor:'SYSTEM',actionType:DrillArch.ACTION.FAULT_PRESENT,target:'A1',accepted:true}];
    events.push(d.dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: primary, simTime: 10 }));
    events.push(d.dispatch(ctx, { type: Dispatch.TYPES.PIN_COMPARE, actor: 'TRAINEE', payload: { targets: compare }, simTime: 20 }));
    events.push(d.dispatch(ctx, { type: Dispatch.TYPES.SUBMIT_HYPOTHESIS, actor: 'TRAINEE', payload: { domain }, simTime: 30 }));
    events.push(d.dispatch(ctx, { type: Dispatch.TYPES.VERIFY, actor: 'TRAINEE', target: act.VER.target, simTime: 40 }));
    events.forEach((e) => assert.equal(e.accepted, true, e.actionType + ': ' + e.reason));

    const res = DrillArch.scoreDrill('A1', events);
    const row = (c) => res.breakdown.find((r) => r.category === c);
    assert.equal(row('evidence').matched, row('evidence').required, 'the scorer did not see the dispatched marks');
    assert.equal(row('localization').matched, row('localization').required, 'the scorer did not see the dispatched hypothesis');
    assert.equal(row('verification').matched, row('verification').required, 'the scorer did not see the dispatched VERIFY');
    assert.ok(res.score > 0);
    assert.equal(res.gated, false, 'no unsafe action was taken');
  });

  await t.test('THE TRAP: the legacy JOURNAL scores zero -- it is not an ActionEvent log', () => {
    // Pinned so nobody "simplifies" the app wiring by handing scoreDrill the journal.
    const drill = DrillArch.drillById('A1');
    const act = {}; drill.expectedActions.forEach((x) => { act[x.id] = x; });
    const ctx = makeCtx(); const d = wired(ctx);
    ctx.inspect(act.EV1.target);
    d.dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: act.EV1.target, simTime: 10 });
    const viaJournal = DrillArch.scoreDrill('A1', ctx.journal);
    assert.equal(viaJournal.breakdown.find((r) => r.category === 'evidence').matched, 0,
      'if this ever passes, the two record shapes have converged and this trap is gone');
  });
});

// ==================================================== 2. VALIDATION

test('evidence must be gathered, not clicked', async (t) => {
  await t.test('an inspected node is accepted', () => {
    const ctx = makeCtx({ inspected: ['XMTR-FIC102'] });
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 5 });
    assert.equal(ev.accepted, true, ev.reason);
    assert.equal(ctx.training.evidence.length, 1);
  });

  await t.test('a node never opened is REFUSED', () => {
    const ctx = makeCtx({ inspected: [] });
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 5 });
    assert.equal(ev.accepted, false);
    assert.match(ev.reason, /not inspected/);
    assert.equal(ctx.training.evidence.length, 0, 'a refused command must not mutate state');
  });

  await t.test('FAILS CLOSED: no inspection record at all is a refusal, not a pass', () => {
    const ctx = makeCtx({ omitInspection: true });
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 5 });
    assert.equal(ev.accepted, false, 'missing inspection state must refuse, never wave through');
    assert.match(ev.reason, /inspection state unavailable/);
  });

  await t.test('an unknown node is refused', () => {
    const ctx = makeCtx({ inspected: ['NOPE'] });
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'NOPE', simTime: 5 });
    assert.equal(ev.accepted, false);
    assert.match(ev.reason, /unknown target node/);
  });
});

test('a pin compares two or three real, distinct points', async (t) => {
  const ok = ['XMTR-FIC102', 'VLV-FV102'];
  await t.test('two accepted, three accepted', () => {
    const ctx = makeCtx();
    const d = wired(ctx);
    assert.equal(d.dispatch(ctx, { type: Dispatch.TYPES.PIN_COMPARE, actor: 'TRAINEE', payload: { targets: ok }, simTime: 1 }).accepted, true);
    assert.equal(d.dispatch(ctx, { type: Dispatch.TYPES.PIN_COMPARE, actor: 'TRAINEE', payload: { targets: ok.concat('XMTR-LIC101') }, simTime: 2 }).accepted, true);
  });
  await t.test('one is not a comparison; four is not the affordance', () => {
    const ctx = makeCtx();
    const d = wired(ctx);
    for (const targets of [['XMTR-FIC102'], ok.concat(['XMTR-LIC101', 'VLV-TV202'])]) {
      const ev = d.dispatch(ctx, { type: Dispatch.TYPES.PIN_COMPARE, actor: 'TRAINEE', payload: { targets }, simTime: 3 });
      assert.equal(ev.accepted, false);
      assert.match(ev.reason, /two or three/);
    }
  });
  await t.test('a point compared against itself is refused', () => {
    const ctx = makeCtx();
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.PIN_COMPARE, actor: 'TRAINEE', payload: { targets: ['XMTR-FIC102', 'XMTR-FIC102'] }, simTime: 4 });
    assert.equal(ev.accepted, false);
    assert.match(ev.reason, /duplicate target/);
  });
});

test('a hypothesis names a failure DOMAIN, never a fault id', async (t) => {
  await t.test('every real layer is accepted', () => {
    const ctx = makeCtx();
    const d = wired(ctx);
    Topology.LAYERS.forEach((domain, i) => {
      const ev = d.dispatch(ctx, { type: Dispatch.TYPES.SUBMIT_HYPOTHESIS, actor: 'TRAINEE', payload: { domain }, simTime: i });
      assert.equal(ev.accepted, true, `${domain}: ${ev.reason}`);
    });
    assert.equal(ctx.training.hypotheses.length, Topology.LAYERS.length);
  });

  await t.test('a non-layer is REJECTED', () => {
    const ctx = makeCtx();
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.SUBMIT_HYPOTHESIS, actor: 'TRAINEE', payload: { domain: 'PLUMBING' }, simTime: 1 });
    assert.equal(ev.accepted, false);
    assert.match(ev.reason, /not a failure domain/);
  });

  await t.test('a FAULT ID is rejected -- it does not exist in the trainee world', () => {
    const ctx = makeCtx();
    const ev = wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.SUBMIT_HYPOTHESIS, actor: 'TRAINEE', payload: { domain: 'FROZEN_MEASUREMENT' }, simTime: 1 });
    assert.equal(ev.accepted, false);
    assert.match(ev.reason, /never a fault id/);
    assert.equal(ctx.training.hypotheses.length, 0);
  });
});

// ==================================================== 3. THE JOURNAL SEAM

test('the strangler seam holds: entries keep the legacy shape', async (t) => {
  await t.test('{t, op, tag, arg} intact, plus actor/accepted/reason', () => {
    const ctx = makeCtx({ inspected: ['XMTR-FIC102'] });
    wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 42 });
    const e = ctx.journal[0];
    assert.equal(e.op, Dispatch.TYPES.MARK_EVIDENCE);
    assert.equal(e.tag, 'XMTR-FIC102');
    assert.equal(e.t, 42);
    assert.equal(e.actor, 'TRAINEE');
    assert.equal(e.accepted, true);
    assert.ok(typeof e.seq === 'number', 'journalAdd must have stamped seq');
  });

  await t.test('journalText renders them without knowing the op', () => {
    const ctx = makeCtx({ inspected: ['XMTR-FIC102'] });
    wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 42 });
    const txt = Instructor.journalText(ctx.journal[0], (t) => String(t));
    assert.ok(typeof txt === 'string' && txt.length > 0);
  });

  await t.test('a REFUSED command is journaled with accepted:false and a reason', () => {
    const ctx = makeCtx({ inspected: [] });
    wired(ctx).dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 7 });
    assert.equal(ctx.journal.length, 1, 'the refusal must be recorded, not dropped');
    assert.equal(ctx.journal[0].accepted, false);
    assert.ok(ctx.journal[0].reason);
  });

  await t.test('replayPlan SKIPS the refusal and keeps the accepted ones', () => {
    const ctx = makeCtx({ inspected: ['XMTR-FIC102'] });
    const d = wired(ctx);
    const snap = { t: 0, journalSeq: 0 };
    d.dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 10 });
    d.dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'VLV-FV102', simTime: 20 }); // never inspected
    const plan = Instructor.replayPlan(ctx.instr, snap, 100);
    assert.equal(plan.entries.length, 1, 'a refused action must never be re-applied on replay');
    assert.equal(plan.entries[0].tag, 'XMTR-FIC102');
  });
});

// ==================================================== 4. DETERMINISM AND ROUND-TRIP

test('deterministic, and survives snapshot/restore', async (t) => {
  function runScript(ctx, d) {
    ['XMTR-FIC102', 'VLV-FV102'].forEach((n) => ctx.inspect(n));
    d.dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 10 });
    d.dispatch(ctx, { type: Dispatch.TYPES.PIN_COMPARE, actor: 'TRAINEE', payload: { targets: ['XMTR-FIC102', 'VLV-FV102'] }, simTime: 20 });
    d.dispatch(ctx, { type: Dispatch.TYPES.SUBMIT_HYPOTHESIS, actor: 'TRAINEE', payload: { domain: 'FIELD' }, simTime: 30 });
    d.dispatch(ctx, { type: Dispatch.TYPES.VERIFY, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 35 });
    d.dispatch(ctx, { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'CTRL-U1', simTime: 40 }); // refused
  }

  await t.test('the same script twice produces byte-identical state and journal', () => {
    const a = makeCtx(); runScript(a, wired(a));
    const b = makeCtx(); runScript(b, wired(b));
    assert.equal(JSON.stringify(a.training), JSON.stringify(b.training));
    assert.equal(JSON.stringify(a.journal), JSON.stringify(b.journal));
  });

  await t.test('evidence marks survive a snapshot/restore round-trip', () => {
    const ctx = makeCtx(); runScript(ctx, wired(ctx));
    const before = JSON.stringify(ctx.training);
    const snap = JSON.parse(JSON.stringify(Dispatch.trainingSnapshot(ctx.training)));
    const restored = Dispatch.trainingRestore(snap);
    assert.equal(JSON.stringify(restored), before, 'training state must round-trip through plain JSON');
    assert.equal(restored.evidence.length, 1);
    assert.equal(restored.pins.length, 1);
    assert.equal(restored.hypotheses.length, 1);
    assert.equal(restored.verifications.length, 1);
  });

  await t.test('restore returns a detached copy, not a shared reference', () => {
    const ctx = makeCtx(); runScript(ctx, wired(ctx));
    const restored = Dispatch.trainingRestore(ctx.training);
    restored.evidence.push({ target: 'X', t: 0 });
    restored.pins[0].targets.push('X');
    assert.equal(ctx.training.evidence.length, 1, 'mutating a restored copy must not reach the original');
    assert.equal(ctx.training.pins[0].targets.length, 2);
  });

  await t.test('two dispatchers never share handlers', () => {
    const bare = Dispatch.create();
    const ev = bare.dispatch(makeCtx(), { type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 1 });
    assert.equal(ev.accepted, false);
    assert.match(ev.reason, /no handler registered/);
  });
});


// ==================================================== 5. MODE GATING (architect's final ruling)

test('every scoring command is gated to the mode where earning it means something', async (t) => {
  // ARCHITECT'S FINAL RULING, 2026-08-31, superseding two earlier versions. V3-PLAN line 186:
  // "Learn shows the answer; Diagnose asks the learner to infer it". A trainee mid-A-drill
  // could switch to Learn, read which nodes the blast radius lights up, mark or pin exactly
  // those, and bank evidence points for reading the answer key.
  //
  // THE LIST IS DERIVED, NOT TYPED. Two rulings each missed a command by enumerating from
  // memory — PIN_COMPARE first, then DEBRIEF. So the authoritative list is re-derived here
  // from drill-arch's expectedActions, where the scoring truth actually lives. A sixth
  // scoring command added later fails this file rather than slipping through ungated.
  const scoring = new Set();
  DrillArch.drillIds().forEach((id) => {
    DrillArch.drillById(id).expectedActions.forEach((a) => scoring.add(a.actionType));
  });
  const trainingCmds = [...scoring].filter((t2) => /^TRAINING\./.test(t2)).sort();

  await t.test('THE GENERALISATION: every TRAINING.* scoring command has a mode gate', () => {
    const ungated = trainingCmds.filter((t2) => !Dispatch.COMMAND_MODE[t2]);
    assert.deepEqual(ungated, [],
      'scoring commands with no mode gate: ' + ungated.join(', ') +
      '. Every command that can earn rubric points must be gated to the mode in which ' +
      'earning it means something. Add it to COMMAND_MODE in src/dispatch.js.');
    assert.ok(trainingCmds.length >= 5, `only ${trainingCmds.length} TRAINING commands derived — the derivation is not working`);
  });

  await t.test('ACK is correctly NOT gated: it is a legacy v2 journal op, not a dispatch command', () => {
    // Guards against someone "completing" the list by gating a command that does not exist
    // in dispatch. The app has journaled op:'ACK' since v2 and the scorer matches it as-is.
    assert.ok(scoring.has('ACK'), 'ACK is no longer a scored action — re-derive this expectation');
    assert.equal(Dispatch.COMMAND_MODE['ACK'], undefined);
  });

  // A minimal valid command per type, so each can be ACCEPTED in its own mode.
  function cmdFor(type, ctx) {
    const base = { type, actor: 'TRAINEE', simTime: 10 };
    if (type === Dispatch.TYPES.MARK_EVIDENCE || type === Dispatch.TYPES.VERIFY) {
      ctx.inspect('XMTR-FIC102');
      return Object.assign(base, { target: 'XMTR-FIC102' });
    }
    if (type === Dispatch.TYPES.PIN_COMPARE) {
      return Object.assign(base, { payload: { targets: ['XMTR-FIC102', 'VLV-FV102'] } });
    }
    if (type === Dispatch.TYPES.SUBMIT_HYPOTHESIS) return Object.assign(base, { payload: { domain: 'FIELD' } });
    if (type === Dispatch.TYPES.DEBRIEF) return Object.assign(base, { payload: { correct: true } });
    throw new Error('no fixture for ' + type);
  }

  for (const type of trainingCmds) {
    const want = Dispatch.COMMAND_MODE[type];
    const wrong = want === 'diagnose' ? 'learn' : 'diagnose';

    await t.test(`${type}: ACCEPTED in ${want}`, () => {
      // THE POSITIVE CONTROL. Without it the whole section passes against a validate()
      // that refuses everything, which is the failure mode of a gate nobody can satisfy.
      const ctx = makeCtx({ archMode: want });
      const ev = wired(ctx).dispatch(ctx, cmdFor(type, ctx));
      assert.equal(ev.accepted, true, `${type} refused in its own mode: ${ev.reason}`);
    });

    await t.test(`${type}: REFUSED in ${wrong}, with a reason naming the mode`, () => {
      const ctx = makeCtx({ archMode: wrong });
      const ev = wired(ctx).dispatch(ctx, cmdFor(type, ctx));
      assert.equal(ev.accepted, false, `${type} was allowed in ${wrong} — scoring credit for the wrong mode`);
      assert.match(ev.reason, /wrong mode/);
      assert.match(ev.reason, new RegExp(want), 'the refusal does not name the mode it requires');
      assert.equal(ctx.journal[0].accepted, false, 'the refusal must still be journaled');
    });

    await t.test(`${type}: FAILS CLOSED when ctx.archMode is absent`, () => {
      const ctx = makeCtx({ archMode: null });
      const ev = wired(ctx).dispatch(ctx, cmdFor(type, ctx));
      assert.equal(ev.accepted, false, `${type} passed with no mode at all — a scoring gate must not default open`);
      assert.match(ev.reason, /mode unavailable/);
    });
  }

  await t.test('replay re-applies a Diagnose command while the spectator view is Debrief', () => {
    // startReplay sets archMode to debrief. Live MARK_EVIDENCE in debrief must still refuse.
    // Replay of an already-accepted command must not.
    const live = makeCtx({ archMode: 'debrief' });
    live.inspect('XMTR-FIC102');
    const refused = wired(live).dispatch(live, {
      type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 10
    });
    assert.equal(refused.accepted, false, 'live marking in debrief must still refuse');

    const replay = makeCtx({ archMode: 'debrief' });
    replay.replaying = true;
    const ev = wired(replay).dispatch(replay, {
      type: Dispatch.TYPES.MARK_EVIDENCE, actor: 'TRAINEE', target: 'XMTR-FIC102', simTime: 10
    });
    assert.equal(ev.accepted, true, 'replay of an accepted mark refused: ' + ev.reason);
  });
});


// ==================================================== 6. THE CTX CONTRACT

test('the app builds a ctx carrying every field these handlers read', async (t) => {
  // WRITTEN AFTER THIS SEAT SHIPPED THE BUG IT CATCHES. The mode gate fails closed on a
  // missing ctx.archMode — correct in isolation. But the app's archTrainingCtx() supplied
  // {graph, training, wasInspected, journalAdd} and NOT archMode, so in the real app EVERY
  // scoring command was refused, in every mode, including the legitimate one. The leak was
  // closed and so was the path it was supposed to leave open.
  //
  // These unit tests were green throughout, because makeCtx() above supplies archMode. Two
  // green suites with nothing spanning them — the same failure this build has produced
  // eight times, committed here by the seat that has been cataloguing it. A behavioural
  // sweep (seat 3/3's) caught what a contract test structurally could not see.
  //
  // The list is DERIVED from what src/dispatch.js actually reads off ctx, never typed, so a
  // handler that starts depending on a new ctx field fails here until the app supplies it.
  const dispatchSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'dispatch.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'Experion Station Simulator.dc.html'), 'utf8');

  const needed = new Set();
  const re = /\bctx\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(dispatchSrc))) needed.add(m[1]);

  await t.test('the derivation is not vacuous', () => {
    assert.ok(needed.size >= 4, `only ${needed.size} ctx fields derived from dispatch.js`);
    for (const k of ['graph', 'wasInspected', 'journalAdd', 'archMode']) {
      assert.ok(needed.has(k), `dispatch.js no longer reads ctx.${k} — re-derive this expectation`);
    }
  });

  await t.test('archTrainingCtx() supplies all of them', () => {
    const at = appSrc.indexOf('archTrainingCtx(){');
    assert.ok(at > 0, 'archTrainingCtx is gone from the app page');
    const body = appSrc.slice(at, appSrc.indexOf('\n  }', at));
    const missing = [...needed].filter((k) => !new RegExp('\\b' + k + '\\s*:').test(body)).sort();
    assert.deepEqual(missing, [],
      'the app builds a training ctx missing fields dispatch reads: ' + missing.join(', ') +
      '. Every handler that reads one of these FAILS CLOSED, so the commands are refused in ' +
      'every mode and the feature is silently dead. Fix in archTrainingCtx().');
  });
});
