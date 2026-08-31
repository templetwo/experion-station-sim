// @artifact dev
// ESS.Debrief -- the synchronised debrief timeline (V3-PLAN section 7 / stage S4).
// Module-level tests plus one app-level smoke on real shapes through the logic harness.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Debrief = require('../src/debrief.js');
const { canon } = require('./_fixture');

const T0 = 1_700_000_000_000;
const at = (s) => T0 + s * 1000;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); }
  return o;
}

function sampleInput() {
  return {
    journal: [
      { seq: 1, t: at(0), op: 'SEED', tag: '', arg: 20260829, instr: true },
      { seq: 2, t: at(10), op: 'MODE', tag: 'FIC102', arg: 'MAN' },                                     // trainee, applied (no actor field)
      { seq: 3, t: at(12), op: 'MODE', tag: 'TIC201', arg: 'MAN', actor: 'TRAINEE', accepted: false, reason: 'major-unsafe: reactor temperature loop to MAN during exotherm' },
      { seq: 4, t: at(20), op: 'ARCH_FAULT_ACTIVATE', tag: 'CTRL-U2', arg: 'CONTROLLER_LOSS', actor: 'INSTRUCTOR', accepted: true },
      { seq: 5, t: at(30), op: 'MARK_EVIDENCE', tag: 'CTRL-U2', arg: 'diag', actor: 'TRAINEE', accepted: true },
      { seq: 6, t: at(31), op: 'HINT', tag: '', arg: 'look at the controller', actor: 'ASSISTANT', accepted: true },
    ],
    alarmLog: [
      { t: at(21), key: 'TIC201.BADPV', tag: 'TIC201', cond: 'BADPV', prio: 'High', type: 'raise' },
      { t: at(25), key: 'TIC201.BADPV', tag: 'TIC201', cond: 'BADPV', prio: 'High', type: 'ack' },
      { t: at(60), key: 'TIC201.BADPV', tag: 'TIC201', cond: 'BADPV', prio: 'High', type: 'rtn' },
    ],
    events: [
      { id: 1, t: at(0), type: 'SYSTEM', src: 'STN01', desc: 'OPERATOR STATION STARTED — SIMULATION MODE' },
      { id: 2, t: at(20), type: 'SYSTEM', src: 'INSTR', desc: 'ARCH FAULT ACTIVATED: CONTROLLER_LOSS @ CTRL-U2' },
      { id: 3, t: at(5), type: 'SYSTEM', src: 'INSTR', desc: 'REPLAY FROM SNAPSHOT: pre' },
      { id: 4, t: at(5), type: 'SYSTEM', src: 'INSTR', desc: 'REPLAY STARTED — 1 ACTIONS' },
      { id: 5, t: at(90), type: 'SYSTEM', src: 'INSTR', desc: 'REPLAY COMPLETE' },
    ],
    faultTimeline: [
      { t: at(20), faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U2', phase: 'ACTIVE', health: 'FAILED' },
      { t: at(60), faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U2', phase: 'CLEARED', health: 'HEALTHY' },
    ],
    hist: {
      TIC201: [[at(0), 150, 150, 40], [at(10), 151, 150, 41], [at(20), 158, 150, 45], [at(30), 162, 150, 50], [at(60), 151, 150, 42]],
      FIC102: [[at(0), 60, 60, 50], [at(30), 61, 60, 51]],
    },
    score: { score: 84, pass: true, passMark: 80, breakdown: [{ label: 'Safe stabilization', earned: 30, max: 30, note: '' }, { label: 'Evidence', earned: 20, max: 25, note: 'one diagnostic not inspected' }] },
  };
}

test('module hygiene: pure UMD, no DOM, timers, globals, randomness, clock or sibling require', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'debrief.js'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // strip comment lines
  for (const bad of [/\bdocument\b/, /\bwindow\./, /setTimeout|setInterval|requestAnimationFrame/, /Math\.random/, /Date\.now|new Date/, /require\(/]) {
    assert.equal(bad.test(code), false, `src/debrief.js must not contain ${bad}`);
  }
  assert.match(src.split('\n').slice(0, 3).join('\n'), /@artifact production/);
  assert.equal(typeof Debrief.build, 'function');
  assert.deepEqual(Debrief.LANES, ['ARCH', 'INSTRUCTOR', 'OPERATOR', 'SYSTEM', 'ALARM', 'EVENT', 'SCORE']);
});

test('reads the journal and every other input without mutating any of them (deep-frozen inputs)', () => {
  const input = deepFreeze(sampleInput());
  const before = canon(input);
  const out = Debrief.build(input, { tags: ['TIC201'] });
  assert.equal(canon(input), before, 'inputs must be byte-identical after build()');
  assert.ok(out.rows.length > 0);
});

test('deterministic: two builds of the same input are byte-identical, and order is total', () => {
  const a = Debrief.build(sampleInput()), b = Debrief.build(sampleInput());
  assert.equal(canon(a), canon(b));
  for (let i = 1; i < a.rows.length; i++) assert.ok(a.rows[i - 1].t <= a.rows[i].t, 'rows ascend in t');
  // same-t tie-break follows lane precedence: at t=20 the ARCH row precedes the INSTRUCTOR journal row, which precedes the EVENT row
  const t20 = a.rows.filter(r => r.t === at(20)).map(r => r.lane);
  assert.deepEqual(t20, ['ARCH', 'INSTRUCTOR', 'EVENT']);
});

test('a refused action is rendered as a judgment note, listed in refusals, and not counted as an applied operator action', () => {
  const out = Debrief.build(sampleInput());
  const refused = out.rows.filter(r => r.kind === 'REFUSED');
  assert.equal(refused.length, 1);
  const r = refused[0];
  assert.equal(r.accepted, false);
  assert.equal(r.lane, 'OPERATOR');
  assert.equal(r.actor, 'TRAINEE');
  assert.deepEqual(r.judgment, { verdict: 'REFUSED', reason: 'major-unsafe: reactor temperature loop to MAN during exotherm' });
  assert.match(r.text, /^REFUSED — /);
  assert.equal(out.refusals.length, 1);
  assert.equal(out.refusals[0], r);
  assert.equal(out.summary.counts.refused, 1);
  // the applied operator actions: MODE FIC102 + MARK_EVIDENCE = 2; the refusal is not among them
  assert.equal(out.summary.counts.operator, 2);
  // an entry with no `accepted` field at all is applied (mirrors replayPlan: only explicit false is a refusal)
  assert.equal(out.rows.find(r => r.ref.seq === 2).accepted, true);
});

test('instructor rows and trainee rows are distinguishable by actor AND lane; legacy instr:true and instructor ops classify without an actor field', () => {
  const out = Debrief.build(sampleInput());
  const bySeq = (s) => out.rows.find(r => r.ref.seq === s);
  assert.equal(bySeq(1).actor, 'INSTRUCTOR'); assert.equal(bySeq(1).lane, 'INSTRUCTOR');   // instr:true legacy entry
  assert.equal(bySeq(2).actor, 'TRAINEE');    assert.equal(bySeq(2).lane, 'OPERATOR');     // bare legacy trainee entry
  assert.equal(bySeq(4).actor, 'INSTRUCTOR'); assert.equal(bySeq(4).lane, 'INSTRUCTOR');   // dispatch entry with actor
  assert.equal(bySeq(6).actor, 'ASSISTANT');  assert.equal(bySeq(6).lane, 'SYSTEM');       // assistant is neither
  const noActor = Debrief.build({ journal: [{ seq: 9, t: at(1), op: 'UPSET', tag: 'xmtr', arg: 'ON' }] });
  assert.equal(noActor.rows[0].actor, 'INSTRUCTOR', 'UPSET is an instructor op even without instr/actor');
  // instructor-sourced events are instructor rows too
  const ev = out.rows.find(r => r.lane === 'EVENT' && r.ref.id === 2);
  assert.equal(ev.actor, 'INSTRUCTOR');
  assert.equal(out.summary.counts.instructor, 2, 'SEED + ARCH_FAULT_ACTIVATE');
});

test('alarm log becomes RAISE / ACK / RTN rows; ACK is a trainee act; the alarm list is only a fallback', () => {
  const out = Debrief.build(sampleInput());
  const al = out.rows.filter(r => r.lane === 'ALARM');
  assert.deepEqual(al.map(r => r.kind), ['RAISE', 'ACK', 'RTN']);
  assert.equal(al[1].actor, 'TRAINEE');
  assert.equal(out.summary.counts.alarms, 1);
  assert.equal(out.summary.counts.acks, 1);
  const fb = Debrief.build({ alarms: [{ t: at(1), tag: 'FIC102', cond: 'PVHI', prio: 'Low', ackT: at(3), rtnT: at(9) }] });
  assert.deepEqual(fb.rows.map(r => r.kind), ['RAISE', 'ACK', 'RTN']);
});

test('REPLAY marker events are kept as flagged rows but excluded from the event count', () => {
  const out = Debrief.build(sampleInput());
  const markers = out.rows.filter(r => r.kind === 'REPLAY_MARKER');
  assert.equal(markers.length, 3);
  assert.equal(out.summary.counts.replayMarkers, 3);
  assert.equal(out.summary.counts.events, 2, 'STATION STARTED + ARCH FAULT ACTIVATED');
  assert.equal(Debrief.isReplayMarker('REPLAY COMPLETE'), true);
  assert.equal(Debrief.isReplayMarker('ARCH FAULT ACTIVATED: REPLAY?'), false);
});

test('architecture rows: DEBRIEF_REVEALED shows the fault; TRAINEE_SAFE carries no fault id anywhere in the output', () => {
  const revealed = Debrief.build(sampleInput());
  const arch = revealed.rows.filter(r => r.lane === 'ARCH');
  assert.equal(arch.length, 2);
  assert.equal(arch[0].kind, 'FAULT');
  assert.equal(arch[0].actor, 'INSTRUCTOR');
  assert.match(arch[0].text, /ARCH ACTIVE CONTROLLER_LOSS @ CTRL-U2/);
  assert.equal(revealed.projection, 'DEBRIEF_REVEALED');

  // positive control first: the fault id IS present in the revealed output, so the negative assertion below cannot pass vacuously
  assert.match(canon(revealed), /CONTROLLER_LOSS/);
  const safeIn = sampleInput();
  safeIn.journal = safeIn.journal.filter(e => e.op !== 'ARCH_FAULT_ACTIVATE');       // the instructor's own journal line names the fault; a trainee-safe caller filters it upstream
  safeIn.events = safeIn.events.filter(e => !/ARCH FAULT/.test(e.desc));
  const safe = Debrief.build(safeIn, { projection: 'TRAINEE_SAFE' });
  assert.equal(safe.projection, 'TRAINEE_SAFE');
  const safeArch = safe.rows.filter(r => r.lane === 'ARCH');
  assert.equal(safeArch.length, 2);
  assert.deepEqual(safeArch.map(r => r.kind), ['HEALTH', 'HEALTH']);
  assert.deepEqual(safeArch.map(r => r.ref.health), ['FAILED', 'HEALTHY']);
  assert.doesNotMatch(canon(safe), /CONTROLLER_LOSS|faultId/, 'no fault id and no faultId key may appear in a TRAINEE_SAFE debrief');
});

test('process values are sampled beside every row from the nearest earlier history row; tags default to hist keys, [] disables', () => {
  const out = Debrief.build(sampleInput(), { tags: ['TIC201'] });
  const r30 = out.rows.find(r => r.t === at(30));
  assert.deepEqual(r30.process, { TIC201: { pv: 162, sp: 150, op: 50 } });
  const r25 = out.rows.find(r => r.t === at(25));
  assert.deepEqual(r25.process.TIC201, { pv: 158, sp: 150, op: 45 }, 'nearest EARLIER sample, never a later one');
  assert.deepEqual(Debrief.build(sampleInput()).summary.tags, ['FIC102', 'TIC201']);
  assert.deepEqual(Debrief.build(sampleInput(), { tags: [] }).rows[0].process, {});
  assert.equal(Debrief.sampleAt([[10, 1, 2, 3]], 5), null, 'nothing at or before t -> null');
});

test('score is one SCORE row pinned to the end of the window; summary carries pass and the window', () => {
  const out = Debrief.build(sampleInput());
  const sc = out.rows.filter(r => r.lane === 'SCORE');
  assert.equal(sc.length, 1);
  assert.equal(sc[0].t, out.t1);
  assert.equal(out.rows[out.rows.length - 1].lane, 'SCORE', 'the score is the last row');
  assert.match(sc[0].text, /SCORE 84 \/ pass mark 80 — PASS/);
  assert.equal(out.score.breakdown.length, 2);
  assert.equal(out.summary.pass, true);
  assert.equal(out.t0, at(0)); assert.equal(out.t1, at(90)); assert.equal(out.summary.durationMs, 90000);
  assert.equal(out.rows[0].rel, 0);
});

test('empty and missing inputs produce an empty, well-formed debrief', () => {
  const e = Debrief.build({});
  assert.deepEqual(e.rows, []); assert.deepEqual(e.refusals, []); assert.equal(e.score, null); assert.equal(e.summary.pass, null);
  assert.equal(Debrief.build().rows.length, 0);
  // a custom journalText formatter is honoured
  const f = Debrief.build({ journal: [{ seq: 1, t: at(1), op: 'MODE', tag: 'FIC102', arg: 'AUTO' }] }, { journalText: e => `<${e.op}>` });
  assert.equal(f.rows[0].text, '<MODE>');
});

test('both ESS.Dispatch record shapes are accepted: a RETURNED ActionEvent {simTime, actionType, target, payload} renders like the JOURNALED {t, op, tag, arg}', () => {
  const journaled = { seq: 7, t: at(40), op: 'MARK_EVIDENCE', tag: 'CTRL-U2', arg: 'diag', actor: 'TRAINEE', accepted: true };
  const returned  = { seq: 7, simTime: at(40), actionType: 'MARK_EVIDENCE', target: 'CTRL-U2', payload: 'diag', actor: 'TRAINEE', accepted: true };
  const a = Debrief.build({ journal: [journaled] }), b = Debrief.build({ journal: [returned] });
  assert.equal(a.rows.length, 1, 'positive control: the journaled shape renders one row');
  assert.equal(b.rows.length, 1, 'the returned ActionEvent shape must not be silently dropped');
  assert.equal(canon(a.rows), canon(b.rows));
  // a refused ActionEvent is still a judgment note
  const r = Debrief.build({ journal: [{ seq: 8, simTime: at(41), actionType: 'MODE', target: 'TIC201', payload: { mode: 'MAN' }, actor: 'TRAINEE', accepted: false, reason: 'unsafe' }] });
  assert.equal(r.rows[0].kind, 'REFUSED'); assert.deepEqual(r.rows[0].judgment, { verdict: 'REFUSED', reason: 'unsafe' });
  assert.match(r.rows[0].text, /MODE TIC201/);
  assert.equal(Debrief.normalizeEntry({ op: 'X' }), null, 'no t and no simTime -> not a row');
});

test('app-level smoke: a real simulator run (journal, alarmLog, events, hist) builds a sorted debrief with instructor and trainee rows', () => {
  const { newSim, run } = require('./_fixture');
  const Instructor = require('../src/instructor.js');
  const c = newSim(); run(c, 30);
  c.instr.auth = true; c.setState({ sec: 'MNGR' });
  c.setUpset('xmtr', true);            // instructor act (journaled instr:true as op UPSET)
  run(c, 60);
  c.setMode('TIC201', 'MAN');          // trainee act
  run(c, 30);
  const out = Debrief.build({ journal: c.instr.journal, alarmLog: c.alarmLog, events: c.events, hist: c.hist, t0: c.t0 },
    { journalText: e => Instructor.journalText(e, t => ''), tags: ['FIC102'] });
  assert.ok(out.rows.length >= 4);
  for (let i = 1; i < out.rows.length; i++) assert.ok(out.rows[i - 1].t <= out.rows[i].t);
  assert.ok(out.rows.some(r => r.lane === 'INSTRUCTOR' && /UPSET/.test(r.text)), 'the upset is an instructor row');
  assert.ok(out.rows.some(r => r.lane === 'OPERATOR' && /MODE/.test(r.text)), 'the mode change is an operator row');
  assert.ok(out.rows.some(r => r.lane === 'ALARM' && r.kind === 'RAISE'), 'the BADPV alarm raised');
  // history starts one step after t0, so rows at t0 itself (SEED, STATION STARTED) have no earlier sample -- by design, never a later one
  const firstHist = c.hist.FIC102[0][0];
  assert.ok(out.rows.filter(r => r.t >= firstHist).every(r => r.process.FIC102 && typeof r.process.FIC102.pv === 'number'), 'FIC102 sampled beside every row from the first history sample on');
  assert.ok(out.rows.filter(r => r.t < firstHist).every(r => r.process.FIC102 === undefined), 'no future value is ever shown beside an earlier row');
  assert.equal(out.summary.counts.refused, 0);
});
