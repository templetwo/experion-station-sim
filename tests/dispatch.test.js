// @artifact dev
// Tests for src/dispatch.js -- the v3 command/event boundary (V3-PLAN section 4).
//
// Two tiers, per the stage brief: a minimal fake ctx for the pure contract (registry,
// validation, sequencing, the ctx duck-type), and a real Component/instructor for the
// two things that only mean anything against the actual journal -- the replay hazard
// (thread #28) and determinism under a seed.
const test = require('node:test');
const assert = require('node:assert/strict');
const Dispatch = require('../src/dispatch.js');
const Instr = require('../src/instructor.js');
const { newSim, run, endState, digest } = require('./_fixture');

// A minimal fake ctx: just enough to satisfy the one thing dispatch requires of it.
// Mirrors ESS.Instructor.journalAdd's own contract (mutate entry.seq, push, done).
function makeFakeCtx() {
  var seq = 0;
  var journal = [];
  return {
    journal: journal,
    journalAdd: function (entry) { entry.seq = ++seq; journal.push(entry); }
  };
}

// ---------------------------------------------------------------- pure contract

test('rejects a command with no registered handler, and still journals the attempt', () => {
  const d = Dispatch.create();
  const ctx = makeFakeCtx();
  const ev = d.dispatch(ctx, { type: 'NOPE', actor: 'TRAINEE', target: 'FIC102', payload: { v: 1 }, simTime: 10 });

  assert.equal(ev.accepted, false);
  assert.match(ev.reason, /no handler registered/);
  assert.equal(ev.actionType, 'NOPE');
  assert.equal(ev.target, 'FIC102');
  assert.deepEqual(ev.payload, { v: 1 });
  assert.equal(typeof ev.seq, 'number');

  assert.equal(ctx.journal.length, 1, 'a refused command is still journaled (REJECTIONS ARE FIRST CLASS)');
  assert.equal(ctx.journal[0].op, 'NOPE');
  assert.equal(ctx.journal[0].tag, 'FIC102');
  assert.equal(ctx.journal[0].accepted, false);
});

test('rejects a command from an actor outside TRAINEE|INSTRUCTOR|SYSTEM|ASSISTANT', () => {
  const d = Dispatch.create();
  d.register('PING', { apply: () => 'ok' });
  const ctx = makeFakeCtx();
  const ev = d.dispatch(ctx, { type: 'PING', actor: 'HACKER', simTime: 1 });
  assert.equal(ev.accepted, false);
  assert.match(ev.reason, /unknown actor/);
  assert.equal(ctx.journal.length, 1);
});

test('reserved TYPES are documented names, not pre-registered handlers', () => {
  const d = Dispatch.create();
  const ctx = makeFakeCtx();
  Object.keys(Dispatch.TYPES).forEach((k) => {
    const t = Dispatch.TYPES[k];
    const ev = d.dispatch(ctx, { type: t, actor: 'INSTRUCTOR', simTime: 0 });
    assert.equal(ev.accepted, false, t + ' must not be pre-registered in this stage');
  });
});

test('accepted and rejected commands both produce well-formed, frozen ActionEvents', () => {
  const d = Dispatch.create();
  let calls = 0;
  d.register('TOGGLE', {
    validate: (ctx, cmd) => (cmd.payload && cmd.payload.allow === false ? 'not allowed' : true),
    apply: (ctx) => { calls++; ctx.state.on = !ctx.state.on; return ctx.state.on; }
  });
  const ctx = makeFakeCtx();
  ctx.state = { on: false };

  const ok = d.dispatch(ctx, { type: 'TOGGLE', actor: 'TRAINEE', target: 'X', payload: { allow: true }, simTime: 5 });
  assert.equal(ok.accepted, true);
  assert.equal(ok.reason, undefined, 'reason is absent, not null, on an accepted event');
  assert.equal(typeof ok.seq, 'number');
  assert.equal(ok.simTime, 5);
  assert.equal(ok.actor, 'TRAINEE');
  assert.equal(ok.actionType, 'TOGGLE');
  assert.equal(ok.target, 'X');
  assert.deepEqual(ok.payload, { allow: true });
  assert.ok(Object.isFrozen(ok), 'ActionEvent is immutable');
  assert.equal(calls, 1);
  assert.equal(ctx.state.on, true, 'apply actually mutated state');

  const bad = d.dispatch(ctx, { type: 'TOGGLE', actor: 'TRAINEE', target: 'X', payload: { allow: false }, simTime: 6 });
  assert.equal(bad.accepted, false);
  assert.equal(bad.reason, 'not allowed');
  assert.ok(Object.isFrozen(bad));
  assert.equal(calls, 1, 'apply must not run when validate rejects');
  assert.equal(ctx.state.on, true, 'state is unchanged by a rejected command');
});

test('seq is monotonic across accepted, business-rejected and unknown-type dispatches alike', () => {
  const d = Dispatch.create();
  d.register('OK', { apply: () => {} });
  d.register('SOMETIMES', { validate: (ctx, cmd) => cmd.payload !== 'no', apply: () => {} });
  const ctx = makeFakeCtx();

  const seqs = [
    d.dispatch(ctx, { type: 'OK', actor: 'SYSTEM', simTime: 1 }).seq,
    d.dispatch(ctx, { type: 'NOPE', actor: 'SYSTEM', simTime: 2 }).seq,                          // unknown type
    d.dispatch(ctx, { type: 'SOMETIMES', actor: 'TRAINEE', payload: 'no', simTime: 3 }).seq,      // business rejection
    d.dispatch(ctx, { type: 'OK', actor: 'GHOST', simTime: 4 }).seq,                              // unknown actor
    d.dispatch(ctx, { type: 'OK', actor: 'SYSTEM', simTime: 5 }).seq
  ];
  assert.deepEqual(seqs, [1, 2, 3, 4, 5], 'every dispatch call -- accepted or not -- consumes exactly one, increasing sequence slot');
});

test('a handler registered after earlier dispatches becomes reachable without editing dispatch', () => {
  const d = Dispatch.create();
  const ctx = makeFakeCtx();
  const before = d.dispatch(ctx, { type: 'LATE', actor: 'TRAINEE', simTime: 1 });
  assert.equal(before.accepted, false);

  let applied = 0;
  d.register('LATE', { apply: () => { applied++; } });
  const after = d.dispatch(ctx, { type: 'LATE', actor: 'TRAINEE', simTime: 2 });
  assert.equal(after.accepted, true);
  assert.equal(applied, 1);
  assert.deepEqual(d.types(), ['LATE']);
});

test('two dispatcher instances never share a handler registry (no hidden module-level global)', () => {
  const d1 = Dispatch.create();
  const d2 = Dispatch.create();
  d1.register('ONLY_IN_D1', { apply: () => {} });
  const ctx = makeFakeCtx();
  assert.equal(d1.dispatch(ctx, { type: 'ONLY_IN_D1', actor: 'SYSTEM', simTime: 0 }).accepted, true);
  assert.equal(d2.dispatch(ctx, { type: 'ONLY_IN_D1', actor: 'SYSTEM', simTime: 0 }).accepted, false);
});

test('a throwing validate() or apply() becomes a rejected ActionEvent, never a propagated exception', () => {
  const d = Dispatch.create();
  d.register('BOOM_APPLY', { apply: () => { throw new Error('kaboom'); } });
  d.register('BOOM_VALIDATE', { validate: () => { throw new Error('kapow'); }, apply: () => { throw new Error('must not run'); } });
  const ctx = makeFakeCtx();

  const a = d.dispatch(ctx, { type: 'BOOM_APPLY', actor: 'SYSTEM', simTime: 1 });
  assert.equal(a.accepted, false);
  assert.match(a.reason, /kaboom/);

  const b = d.dispatch(ctx, { type: 'BOOM_VALIDATE', actor: 'SYSTEM', simTime: 2 });
  assert.equal(b.accepted, false);
  assert.match(b.reason, /kapow/);
});

test('dispatch throws if ctx.journalAdd is missing -- a caller bug, not a trainee action', () => {
  const d = Dispatch.create();
  assert.throws(() => d.dispatch({}, { type: 'X', actor: 'SYSTEM', simTime: 0 }), /journalAdd/);
  assert.throws(() => d.dispatch(null, { type: 'X', actor: 'SYSTEM', simTime: 0 }), /journalAdd/);
});

test('a handler journal() may reshape op/tag/arg and add extra fields, but cannot stomp actor/accepted/reason/seq/t', () => {
  const d = Dispatch.create();
  d.register('CUSTOM', {
    apply: () => 'the-result',
    journal: (ctx, cmd, result) => ({
      op: 'CUSTOM_OP', tag: 'OVERRIDE_TAG', arg: result,
      actor: 'HACKED', accepted: 'HACKED', reason: 'HACKED', seq: 999999, t: -1,
      extraNote: 'kept'
    })
  });
  const ctx = makeFakeCtx();
  const ev = d.dispatch(ctx, { type: 'CUSTOM', actor: 'SYSTEM', target: 'T', payload: 'P', simTime: 3 });

  assert.equal(ev.accepted, true);
  assert.equal(ev.actor, 'SYSTEM');

  const raw = ctx.journal[0];
  assert.equal(raw.op, 'CUSTOM_OP');
  assert.equal(raw.tag, 'OVERRIDE_TAG');
  assert.equal(raw.arg, 'the-result');
  assert.equal(raw.extraNote, 'kept', 'non-reserved custom fields pass through, matching the {cond}/{mins} extras convention');
  assert.equal(raw.actor, 'SYSTEM', 'actor cannot be stomped by a handler');
  assert.equal(raw.accepted, true, 'accepted cannot be stomped by a handler');
  assert.equal(raw.reason, undefined, 'reason cannot be forged onto an accepted entry');
  assert.equal(raw.t, 3, 't cannot be stomped by a handler');
  assert.notEqual(raw.seq, 999999, 'seq is assigned only by ctx.journalAdd, never by a handler');
});

test('CONTRACT GAP (adversarial review): apply() has no rollback -- a mutation made before a throw stands even though the event reports accepted:false', () => {
  const d = Dispatch.create();
  d.register('PARTIAL', {
    apply: (ctx) => {
      ctx.state.x = 'mutated'; // side effect happens first...
      throw new Error('boom mid-apply'); // ...then apply fails
    }
  });
  const ctx = makeFakeCtx();
  ctx.state = { x: 'original' };

  const ev = d.dispatch(ctx, { type: 'PARTIAL', actor: 'SYSTEM', simTime: 1 });
  assert.equal(ev.accepted, false, 'the event reports the command as refused');
  assert.match(ev.reason, /boom mid-apply/);
  // The invariant every other rejection in this file upholds -- "a rejected command leaves
  // state unchanged" -- does NOT hold here: dispatch cannot roll back a handler's partial
  // work. This is a real, documented gap (see the CONTRACT note on apply() in src/dispatch.js),
  // not a fixable bug in dispatch itself -- dispatch does not know the shape of ctx.state to
  // snapshot/restore it. The obligation is on every handler: do everything that can fail in
  // validate(), and make apply() a mutation that, once started, cannot itself fail.
  assert.equal(ctx.state.x, 'mutated',
    'CONFIRMED: partial mutation from a throwing apply() survives a "rejected" event -- ' +
    'handlers must not mutate before a possible throw');
});

// ---------------------------------------------------------------- real Component / instructor

test('KNOWN HAZARD (thread #28): a rejected command is journaled, and ESS.Instructor.replayPlan schedules it for replay anyway', () => {
  const c = newSim();
  run(c, 60); // move off t=0 so this isn't a degenerate boundary case

  const d = Dispatch.create();
  // The concrete hazard is a REFUSAL that reuses a real, existing op replayPlan already
  // knows how to re-apply (MODE -> applyJournalEntry -> setMode) -- not a made-up type
  // applyJournalEntry's switch would silently ignore anyway.
  d.register('MODE', {
    validate: () => 'refused: unsafe MODE change while an interlock is active',
    apply: () => { throw new Error('must not be called: validate rejected this command'); }
  });
  const ctx = { journalAdd: (entry) => Instr.journalAdd(c.instr, entry) };

  // The cut a real instructor snapshot would record: journalSeq and t at save time.
  const snap = { t: c.P.t, journalSeq: c.instr.seq };

  const attemptT = c.P.t + 1000;
  const ev = d.dispatch(ctx, { type: 'MODE', actor: 'TRAINEE', target: 'FIC102', payload: 'MAN', simTime: attemptT });
  assert.equal(ev.accepted, false, 'the unsafe MODE change was refused');
  assert.match(ev.reason, /refused/);

  const plan = Instr.replayPlan(c.instr, snap, attemptT + 1);
  const replayed = plan.entries.find((e) => e.seq === ev.seq);

  assert.ok(replayed,
    'HAZARD CONFIRMED: replayPlan filters only on seq/t and schedules the refused MODE entry ' +
    'for replay -- applyReplayDue would call applyJournalEntry -> setMode(FIC102, MAN) even ' +
    'though it was refused. src/instructor.js replayPlan needs an `e.accepted !== false` guard ' +
    '(thread #28) before dispatch is wired into the app in S2.');
  assert.equal(replayed.op, 'MODE');
  assert.equal(replayed.tag, 'FIC102');
  assert.equal(replayed.accepted, false, 'the marking IS present on the entry -- replayPlan simply never looks at it');
});

test('determinism: identical dispatched commands under the same seed produce identical end-state digests', () => {
  function buildRun(seed) {
    const c = newSim({ seed });
    const d = Dispatch.create();
    d.register('ADJUST_SP', {
      validate: (ctx, cmd) => (cmd.payload < 0 ? 'setpoint must be non-negative' : true),
      apply: (ctx, cmd) => { ctx.c.L[cmd.target].sp = cmd.payload; }
    });
    const ctx = { c, journalAdd: (entry) => Instr.journalAdd(c.instr, entry) };

    run(c, 60);
    d.dispatch(ctx, { type: 'ADJUST_SP', actor: 'TRAINEE', target: 'LIC101', payload: 42, simTime: c.P.t });
    run(c, 120);
    // Refused identically on both runs -- must not perturb the trajectory (it is a rejection).
    const rej = d.dispatch(ctx, { type: 'ADJUST_SP', actor: 'TRAINEE', target: 'LIC101', payload: -999, simTime: c.P.t });
    assert.equal(rej.accepted, false);
    run(c, 60);
    return c;
  }

  const c1 = buildRun(20260829);
  const c2 = buildRun(20260829);
  assert.equal(digest(endState(c1)), digest(endState(c2)), 'same seed + same dispatched commands => identical end-state digest');

  const c3 = buildRun(1);
  assert.notEqual(digest(endState(c1)), digest(endState(c3)), 'a different seed must diverge, or this test would pass for a vacuous reason');
});
