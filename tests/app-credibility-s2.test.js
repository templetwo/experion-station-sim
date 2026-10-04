// @artifact dev
// Credibility pass, stage S2: sequence ownership and HOLD, journal and clock continuity (docs/dev/CREDIBILITY-PASS-SPEC.md §4, §5).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Models = require('../src/models.js');

const { Component } = load();
function boot(seed, sec) {
  const c = new Component({});
  c.initSim();
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
const has = (c, src, desc) => c.events.some((e) => e.src === src && e.desc === desc);

test('D3: HOLD during CHARGE freezes the batch: the banner reads HELD · CHARGE, the button reads RESUME, the feed setpoint is written to 0 beside the HELD record, and phase, level and timer are unchanged over 120 s; RESUME continues to HEATUP', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START');
  run(c, 10);
  assert.equal(c.P.b.phase, 'CHARGE');
  const jacketSp = c.L.TIC212.sp;
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0);
  assert.ok(has(c, 'SCM202', 'SEQUENCE HELD — FEED STOPPED'));
  let v = c.renderVals().batch;
  assert.equal(v.phase, 'HELD · CHARGE');
  assert.equal(v.holdT, 'RESUME');
  const pt = c.P.b.pt, lvl = c.P.b.lvl, phaseEvents = c.events.filter((e) => /PHASE →/.test(e.desc)).length;
  run(c, 120);
  assert.equal(c.P.b.phase, 'CHARGE');
  assert.equal(c.P.b.pt, pt);
  assert.equal(c.P.b.lvl, lvl);
  assert.equal(c.renderVals().batch.pt, c.mmss(pt * 1000), 'the timer on the graphic stands still');
  assert.equal(c.events.filter((e) => /PHASE →/.test(e.desc)).length, phaseEvents, 'no PHASE → HEATUP while held');
  c.seqCmd('HOLD');
  assert.ok(has(c, 'SCM202', 'SEQUENCE RESUMED'));
  assert.equal(c.L.TIC212.sp, jacketSp, 'CHARGE does not own the jacket loop: RESUME leaves its setpoint alone');
  assert.equal(c.renderVals().batch.holdT, 'HOLD');
  assert.ok(run(c, 400, () => c.P.b.phase === 'HEATUP'), 'the charge continues and completes after RESUME');
});

test('D3: HOLD in FEED stops the monomer feed: the setpoint goes to 0 at the command, the observed flow reaches 0, the level stops rising; RESUME re-asserts 20 and the jacket setpoint', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED');
  c.setState({ sec: 'OPER' });
  assert.equal(c.P.b.phase, 'FEED');
  assert.equal(c.L.FIC211.sp, 20);
  c.L.TIC212.sp = 78;                    // an engineer-trimmed jacket setpoint: RESUME re-asserts the phase's 80
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0);
  // The loop runs on the observed flow, and a flow reads 0 below 1 % of span (0.4 M3/H on FIC211's 0 to 40). The flow therefore falls
  // along the PI tail (5.1 M3/H at 30 s, 0.8 at 80 s) and the output settles at 0.8 % when the observed value reaches 0: the loop sees no
  // error and a true 0.32 M3/H keeps flowing under a display that reads 0. It is below the cutoff and about 2 % of the running rate.
  run(c, 240);
  assert.equal(c.pvShown(c.L.FIC211), 0, 'the feed flow reads zero through the low-flow cutoff');
  assert.ok(c.P.b.mf < 0.4, 'the true flow is below that cutoff too: ' + c.P.b.mf);
  const lvl = c.P.b.lvl;
  run(c, 60);
  assert.ok(c.P.b.lvl - lvl < 0.5, 'held, the level gains under 0.5 % in a minute where a running FEED adds 14: ' + (c.P.b.lvl - lvl));
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 20);
  assert.equal(c.L.TIC212.sp, 80);
});

test('D6: the sequence owns FIC211 and TIC212 in CHARGE: an operator SP is refused with the PROGRAM message and only the refusal is journaled; on HOLD both are OPERATOR on the next scan and an SP entered during the hold is held until RESUME re-asserts the phase value', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START'); c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  const before = c.events.length;
  assert.equal(c.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(c.L.FIC211.sp, 0);
  assert.equal(c.state.msg, 'FIC211: MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.equal(c.events.length, before + 1);
  assert.equal(c.events[0].desc, 'WRITE REJECTED — MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.ok(!c.events.some((e) => e.src === 'FIC211' && e.desc === 'SP CHANGE'), 'no change is journaled');
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'the attribute follows on the next scan');
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  assert.equal(c.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(c.L.FIC211.sp, 5);
  assert.ok(has(c, 'FIC211', 'SP CHANGE'));
  run(c, 30);
  assert.equal(c.L.FIC211.sp, 5, 'held: the sequence does not overwrite the operator setpoint');
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0, 'RESUME in CHARGE re-asserts the phase feed setpoint');
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
});

test('§4.3: under the R-202 trip both batch loops carry INTERLOCK · R-202 HI TEMP TRIP and the feed setpoint is 0, held or not', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_REACT');
  c.setState({ sec: 'OPER' });
  c.seqCmd('HOLD');
  c.P.b.T = 112; c.step(0.5);
  assert.equal(c.P.trips.batch, true);
  assert.equal(c.P.b.phase, 'COOL', 'the trip forces COOL even from a hold');
  assert.equal(c.flagText(c.L.FIC211), 'INTERLOCK · R-202 HI TEMP TRIP');
  assert.equal(c.flagText(c.L.TIC213), 'INTERLOCK · R-202 HI TEMP TRIP');
  assert.equal(c.L.FIC211.sp, 0);
});

// Review Focus 1: every other writer of the two loops keeps working under the new rule.
test('other writers: ABORT during a hold cools and clears the hold; the TI216 shed during FEED holds and keeps writing the shed state; the governed RESUME is the HOLD toggle', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED');
  c.setState({ sec: 'OPER' });
  c.seqCmd('HOLD');
  c.seqCmd('ABORT');
  assert.equal(c.P.b.phase, 'COOL'); assert.equal(c.P.b.held, false);
  assert.equal(c.L.FIC211.sp, 0); assert.equal(c.L.TIC212.sp, 40);
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'COOL is an active phase');

  // The shed is latched through the real chain, not by calling latchTadShed(): interlocks() releases a shed whose Urgent alarm is not
  // active on the first scan, so a hand-latched shed is gone before anything can be asserted about it. An agitator trip in FEED lets the
  // monomer accumulate until TI216 reaches PVHH (about 22 s of simulated time from the U2_FEED preset).
  const d = boot(4, 'OPER');
  d.applyPreset('U2_FEED');
  d.setState({ sec: 'OPER' });
  d.injectFault('agit', true);
  assert.ok(run(d, 600, () => d.tadShed), 'the TI216 interlock latches');
  assert.equal(d.P.b.held, true);
  d.step(0.5);
  assert.equal(d.tadShed, true, 'the Urgent alarm still stands');
  assert.equal(d.L.FIC211.modeAttr, 'OPERATOR');
  assert.equal(d.L.FIC211.mode, 'MAN'); assert.equal(d.L.FIC211.sp, 0); assert.equal(d.L.FIC211.op, 0);
  assert.equal(d.renderVals().batch.holdT, 'HOLD', 'RESUME is not offered while the interlock holds the sequence');
  assert.equal(d.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(d.L.FIC211.sp, 0, 'the shed owns the setpoint');
  d.seqCmd('HOLD');                      // the button reads HOLD: it confirms the hold, it never resumes
  assert.equal(d.P.b.held, true);
  assert.ok(!has(d, 'SCM202', 'SEQUENCE RESUMED'), 'the RESUME branch is not reached while the shed stands');
  assert.equal(d.L.FIC211.sp, 0, 'RESUME did not re-assert the feed setpoint over the shed');
});

// Review Focus 2: the tellers agree with the attribute and the button in each state.
test('tellers agree: banner, button and attribute in the running, held and shed-held states; the M202 card still says HOLD the sequence', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' }); c.step(0.5);
  let v = c.renderVals().batch;
  assert.equal(v.phase, 'FEED'); assert.equal(v.holdT, 'HOLD'); assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  c.seqCmd('HOLD'); c.step(0.5);
  v = c.renderVals().batch;
  assert.equal(v.phase, 'HELD · FEED'); assert.equal(v.holdT, 'RESUME'); assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
  c.nav('detail', 'FIC211');
  const attr = c.renderVals().dpt.mainRows.find((r) => r.param === 'MODEATTR');
  assert.equal(attr.value, 'OPERATOR');
  assert.equal(attr.note, 'operator may store SP/OP/MODE');
  c.seqCmd('HOLD'); c.step(0.5);
  c.nav('detail', 'FIC211');
  assert.equal(c.renderVals().dpt.mainRows.find((r) => r.param === 'MODEATTR').note, 'sequence owns SP/OP/MODE — operator stores are rejected');
  c.injectFault('agit', true); c.step(0.5);
  const card = c.diagnose().find((i) => i.id === 'mtrip.M202');
  assert.ok(card); assert.match(card.steps[0].t, /HOLD the sequence/);
});

// Carry-forward from the Task 1 review: ownership is now one rule, so the SCM's mode restore (scmRestoreModes) covers every
// active phase, not only FEED (spec §4.2). Pinned in CHARGE: the operator's MODE store is refused under PROGRAM, and a loop
// that is nevertheless found in MAN (a shed or a fault left it there) is returned to AUTO and journaled by the sequence.
test('scmRestoreModes: a PROGRAM-owned FIC211 is returned to AUTO in CHARGE, not only in FEED; the operator MODE store is refused first', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START'); c.step(0.5);
  assert.equal(c.P.b.phase, 'CHARGE');
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  assert.equal(c.L.FIC211.mode, 'AUTO');
  const before = c.events.length;
  c.setMode('FIC211', 'MAN');
  assert.equal(c.L.FIC211.mode, 'AUTO', 'the PROGRAM attribute refuses the operator MODE store');
  assert.equal(c.events.length, before + 1);
  assert.equal(c.events[0].desc, 'WRITE REJECTED — MODE ATTRIBUTE PROGRAM — MODE OWNED BY SEQUENCE');
  assert.ok(!has(c, 'SCM202', 'FIC211 MODE RESTORED BY SEQUENCE (MAN → AUTO)'), 'nothing to restore yet');
  c.L.FIC211.mode = 'MAN';               // left in MAN by something other than an operator store
  c.step(0.5);
  assert.equal(c.L.FIC211.mode, 'AUTO');
  assert.ok(has(c, 'SCM202', 'FIC211 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
});
