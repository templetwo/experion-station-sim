// @artifact dev
// Credibility pass, stage S2: sequence ownership and HOLD, journal and clock continuity (docs/dev/CREDIBILITY-PASS-SPEC.md §4, §5).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Models = require('../src/models.js');
const AlarmHelp = require('../src/alarm-help.js');
const Measurement = require('../src/measurement.js');

const { Component } = load();
// `at` is the start clock: left undefined the page seeds it from Date.now() (as before); 0 is the zero clock, independent of the wall clock.
function boot(seed, sec, at) {
  const c = new Component({});
  c.initSim(at);
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
const has = (c, src, desc) => c.events.some((e) => e.src === src && e.desc === desc);
// A U1_HIFEED whose settle raises an alarm: the shipped preset stops under the High limit (R-201 reads 164.3 against PVHI 165), so this variant
// takes the TIC201 setpoint to its 170 limit as well, which crosses PVHI at about 246 s into the 480 s run-forward. Patched for the call only.
function withHotHifeed(fn) {
  const I = globalThis.ESS.Instructor, real = I.presets;
  I.presets = () => real().map((p) => p.id === 'U1_HIFEED' ? Object.assign({}, p, { set: { L: { LIC101: { sp: 40 }, TIC201: { sp: 170 } } } }) : p);
  try { return fn(); } finally { I.presets = real; }
}

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

// Scans after the command (0.5 s each), measured on the U2_FEED preset: CR40 drives the loop output to 0 on the first scan once the setpoint is
// under the 0.4 M3/H cutoff, then the valve (3 s lag) and the flow (3 s lag) die away. The observed flow reads 0 for good from scan 33 (16.5 s);
// the level, which only rises in FEED while the true flow is above 0.1 M3/H, last moves on scan 41 (the true flow is 0.12 there and 0.10 on 42).
const READS_ZERO_FROM = 33;
const LEVEL_LAST_MOVES = 41;
test('D3: HOLD in FEED stops the monomer feed: the setpoint goes to 0 at the command, the output goes to 0, the observed flow reads 0 within the valve lag and the level is exactly constant after it; RESUME re-asserts 20 and the jacket setpoint', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED');
  c.setState({ sec: 'OPER' });
  assert.equal(c.P.b.phase, 'FEED');
  assert.equal(c.L.FIC211.sp, 20);
  c.L.TIC212.sp = 78;                    // an engineer-trimmed jacket setpoint: RESUME re-asserts the phase's 80
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0);
  const scans = 360;
  let lastReading = 0, lastMoved = 0, lvl = c.P.b.lvl;
  for (let i = 1; i <= scans; i++) {
    c.step(0.5);
    assert.equal(c.L.FIC211.op, 0, 'the output is at its low limit from the first scan, scan ' + i);
    if (c.pvShown(c.L.FIC211) !== 0) lastReading = i;
    if (c.P.b.lvl !== lvl) { lastMoved = i; lvl = c.P.b.lvl; }
  }
  assert.equal(lastReading + 1, READS_ZERO_FROM, 'the observed flow reads 0 from this scan on, and every scan after it');
  assert.equal(lastMoved, LEVEL_LAST_MOVES, 'the level last moves on this scan');
  assert.ok(scans - lastMoved >= 120, 'the level is exactly constant for at least the following 60 s');
  assert.ok(c.P.b.mf < 1e-6, 'the true flow is dead: ' + c.P.b.mf);
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 20);
  assert.equal(c.L.TIC212.sp, 80);
  run(c, 60);                            // the loop leaves the shutoff at once (OP 21.1 % on the first scan) and the feed climbs back
  assert.ok(c.pvShown(c.L.FIC211) > 15, 'the feed comes back after RESUME: ' + c.pvShown(c.L.FIC211));
});

// CR40: when FEED ends the sequence sets the feed setpoint to 0 every scan, and that closes the valve. The 0.32 M3/H that used to keep running
// under a display that read 0 kept feeding monomer into the batch through REACT (the level itself only moves in CHARGE, FEED and DRAIN, so the
// creep shows in the true flow and the monomer inventory, not the level). Measured on the U2_FEED preset: FEED ends 150 scans in, REACT lasts
// 289 scans from there, and the observed flow reads 0 for good from scan 32 of REACT.
test('CR40: after FEED ends (REACT) the feed reads 0 and the true flow dies away, and the level does not creep', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED');
  c.setState({ sec: 'OPER' });
  assert.ok(run(c, 600, () => c.P.b.phase === 'REACT'), 'FEED completes');
  assert.equal(c.L.FIC211.sp, 0);
  const scans = 240;                                 // 120 s, inside REACT
  let lastReading = 0;
  const lvl = c.P.b.lvl;
  for (let i = 1; i <= scans; i++) {
    c.step(0.5);
    assert.equal(c.P.b.phase, 'REACT', 'still in REACT, scan ' + i);
    assert.equal(c.L.FIC211.op, 0, 'the output is at its low limit from the first scan, scan ' + i);
    assert.equal(c.P.b.lvl, lvl, 'the level does not move, scan ' + i);
    if (c.pvShown(c.L.FIC211) !== 0) lastReading = i;
  }
  assert.equal(lastReading + 1, 32, 'the observed flow reads 0 from this scan on');
  assert.equal(c.pvShown(c.L.FIC211), 0);
  assert.ok(c.P.b.mf < 1e-6, 'no monomer keeps flowing through REACT: ' + c.P.b.mf);
});

// CR48 (whole-branch review, Minor 4): ownership is per loop. The sequence writes FIC211's setpoint on every running scan, so FIC211 is PROGRAM in every active
// phase; it writes TIC212's only where the phase table gives it the jacket setpoint (HEATUP to DRAIN), so in CHARGE TIC212 reads OPERATOR and takes an
// operator's store, and from HEATUP it is PROGRAM and refuses one.
test('D6: the sequence owns FIC211 in CHARGE and TIC212 from HEATUP (CR48): an operator SP on an owned loop is refused with the PROGRAM message and only the refusal is journaled; TIC212 takes an SP in CHARGE; on HOLD FIC211 is OPERATOR on the next scan and an SP entered during the hold is held until RESUME re-asserts the phase value', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START'); c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR', 'CHARGE gives the sequence no jacket setpoint');
  const before = c.events.length;
  assert.equal(c.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(c.L.FIC211.sp, 0);
  assert.equal(c.state.msg, 'FIC211: MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.equal(c.events.length, before + 1);
  assert.equal(c.events[0].desc, 'WRITE REJECTED — MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.ok(!c.events.some((e) => e.src === 'FIC211' && e.desc === 'SP CHANGE'), 'no change is journaled');
  // TIC212 in CHARGE is the operator's: the store is accepted, journaled, and stands through the scans (the sequence writes the jacket setpoint at
  // the transitions only)
  assert.equal(c.storeEntry('TIC212', 'SP', 60), true);
  assert.equal(c.L.TIC212.sp, 60);
  assert.ok(has(c, 'TIC212', 'SP CHANGE'));
  assert.ok(!c.events.some((e) => e.src === 'TIC212' && /WRITE REJECTED/.test(e.desc)), 'nothing refused on TIC212');
  run(c, 20);
  assert.equal(c.L.TIC212.sp, 60, 'the sequence leaves it alone in CHARGE');
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
  assert.equal(c.L.TIC212.sp, 60, 'and not the jacket setpoint, which CHARGE does not own');
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  // from HEATUP the table gives the sequence the jacket setpoint: the loop is PROGRAM, holds the phase's 80, and refuses the operator
  assert.ok(run(c, 400, () => c.P.b.phase === 'HEATUP'), 'the charge completes');
  c.step(0.5);
  assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.sp, 80);
  const n = c.events.length, changes = () => c.events.filter((e) => e.src === 'TIC212' && e.desc === 'SP CHANGE').length, was = changes();
  assert.equal(c.storeEntry('TIC212', 'SP', 70), true);
  assert.equal(c.L.TIC212.sp, 80);
  assert.equal(c.state.msg, 'TIC212: MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.equal(c.events.length, n + 1);
  assert.equal(c.events[0].desc, 'WRITE REJECTED — MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.equal(changes(), was, 'no change is journaled for the refused store');
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
test('other writers: ABORT during a hold cools and clears the hold; the TI216 shed during FEED holds and keeps writing the shed state', () => {
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

// CR41: the sequence restores every loop it owns to the mode its phase needs. TIC212 comes back to AUTO wherever the table gives the sequence the
// jacket setpoint (HEATUP to DRAIN). In CHARGE the sequence leaves the jacket loop in MAN by design and does not touch it. A loop with a bad PV
// is skipped, and FIC211 under the TI216 shed as before (covered by tests/app-models.test.js).
test('CR41: RESUME hands both loops back in AUTO: TIC212 put in MAN during a FEED hold returns to AUTO at 80 with its own record; in CHARGE it stays MAN', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' }); c.step(0.5);
  c.seqCmd('HOLD'); c.step(0.5);
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  c.setMode('TIC212', 'MAN');
  assert.equal(c.L.TIC212.mode, 'MAN');
  c.seqCmd('HOLD');                                  // RESUME
  c.step(0.5);                                       // one scan
  assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.mode, 'AUTO');
  assert.equal(c.L.TIC212.sp, 80);
  assert.ok(has(c, 'SCM202', 'TIC212 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
  assert.ok(!has(c, 'SCM202', 'FIC211 MODE RESTORED BY SEQUENCE (MAN → AUTO)'), 'FIC211 was left in AUTO, so it gets no record');
  // both taken during the hold: each comes back with its own record
  const b = boot(4, 'OPER');
  b.applyPreset('U2_FEED'); b.setState({ sec: 'OPER' }); b.step(0.5);
  b.seqCmd('HOLD'); b.step(0.5);
  b.setMode('FIC211', 'MAN'); b.setMode('TIC212', 'MAN');
  b.seqCmd('HOLD'); b.step(0.5);
  assert.equal(b.L.FIC211.mode, 'AUTO'); assert.equal(b.L.TIC212.mode, 'AUTO');
  assert.ok(has(b, 'SCM202', 'FIC211 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
  assert.ok(has(b, 'SCM202', 'TIC212 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
  // CHARGE: the sequence does not own the jacket setpoint there (CR48: the loop reads OPERATOR), so there is nothing to restore and it leaves the loop where it is
  const d = boot(4, 'OPER');
  d.seqCmd('START'); d.step(0.5);
  assert.equal(d.P.b.phase, 'CHARGE');
  assert.equal(d.L.TIC212.modeAttr, 'OPERATOR'); assert.equal(d.L.TIC212.mode, 'MAN');
  run(d, 20);
  assert.equal(d.L.TIC212.mode, 'MAN');
  assert.ok(!has(d, 'SCM202', 'TIC212 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
  // a loop with a bad PV is skipped: the shed path put it in MAN and the sequence does not fight it
  const e = boot(4, 'OPER');
  e.applyPreset('U2_FEED'); e.setState({ sec: 'OPER' }); e.step(0.5);
  e.L.TIC212.badPv = true; e.L.TIC212.mode = 'MAN'; e.L.FIC211.badPv = true; e.L.FIC211.mode = 'MAN';
  e.step(0.5);
  assert.equal(e.L.TIC212.mode, 'MAN'); assert.equal(e.L.FIC211.mode, 'MAN');
  assert.ok(!e.events.some((x) => /MODE RESTORED BY SEQUENCE/.test(x.desc)));
});

// CR48 (review Minor 4): TIC212 is PROGRAM only where the phase table gives the sequence its jacket setpoint, so a CHARGE hold followed by RESUME does not
// take the loop: it reads OPERATOR through CHARGE, the operator's mode and setpoint stand and can still be changed, and the sequence takes the loop with
// the phase's own writes on entering HEATUP (AUTO at 80), whatever the operator left it at. The transition's write is the sequence's own, so it is not a
// restore and carries no MODE RESTORED record: the PHASE → HEATUP record is the record of it.
test('CR48: an operator\'s AUTO and SP on TIC212 during a CHARGE hold are not locked in by RESUME (the loop is still the operator\'s in CHARGE), and the sequence takes the loop at HEATUP: AUTO at 80', () => {
  for (const leaveInMan of [false, true]) {
    const c = boot(4, 'OPER');
    c.seqCmd('START'); c.step(0.5);
    c.seqCmd('HOLD'); c.step(0.5);
    assert.equal(c.P.b.phase, 'CHARGE'); assert.equal(c.P.b.held, true);
    assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
    c.setMode('TIC212', 'AUTO');
    assert.equal(c.storeEntry('TIC212', 'SP', 60), true);
    assert.deepEqual([c.L.TIC212.mode, c.L.TIC212.sp], ['AUTO', 60], 'the hold honours the operator\'s mode and setpoint');
    c.seqCmd('HOLD');                                  // RESUME
    c.step(0.5);
    assert.equal(c.P.b.held, false); assert.equal(c.P.b.phase, 'CHARGE');
    assert.equal(c.L.TIC212.modeAttr, 'OPERATOR', 'CHARGE does not own the jacket loop: RESUME does not take it');
    assert.deepEqual([c.L.TIC212.mode, c.L.TIC212.sp], ['AUTO', 60], 'and does not re-assert a setpoint over the operator\'s');
    // not locked in: the operator's further stores are accepted after RESUME, with no refusal journaled
    assert.equal(c.storeEntry('TIC212', 'SP', 65), true);
    assert.equal(c.L.TIC212.sp, 65);
    if (leaveInMan) { c.setMode('TIC212', 'MAN'); assert.equal(c.L.TIC212.mode, 'MAN'); }
    assert.ok(!c.events.some((e) => e.src === 'TIC212' && /WRITE REJECTED/.test(e.desc)), 'no TIC212 write refused in CHARGE');
    // HEATUP: the sequence takes the loop, AUTO at the phase's 80, from the scan it enters the phase
    assert.ok(run(c, 400, () => c.P.b.phase === 'HEATUP'), 'the charge completes after RESUME');
    assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
    assert.deepEqual([c.L.TIC212.mode, c.L.TIC212.sp], ['AUTO', 80], (leaveInMan ? 'left in MAN' : 'left in AUTO at 65') + ': the phase takes it');
    assert.ok(has(c, 'SCM202', 'PHASE → HEATUP'));
    assert.ok(!c.events.some((e) => /MODE RESTORED BY SEQUENCE/.test(e.desc)), 'the transition is the sequence\'s own write, not a restore');
    c.step(0.5);
    assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
    assert.equal(c.storeEntry('TIC212', 'SP', 70), true);
    assert.equal(c.L.TIC212.sp, 80, 'and from here the operator is refused');
    assert.equal(c.state.msg, 'TIC212: MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  }
});

// CR42: the alarm help for the three high alarms that told the operator to write a loop the sequence owns while it runs now says HOLD the
// sequence first: FIC211 and TIC212 are the sequence's while it runs and the operator's while it is held (spec 4.2).
test('CR42: the alarm help that directs a write to a loop the sequence owns says HOLD the sequence first: FIC211, TIC212, LI215 and PI214 PVHI, TI216 PVHI, and FIC211 PVLO; the three entries that said only to cut the feed say how', () => {
  const f = AlarmHelp.resolve('FIC211', 'PVHI', {});
  assert.equal(f.found, true);
  assert.equal(f.correctiveAction, 'HOLD the sequence first: FIC211 belongs to the sequence while it runs and to you while it is held. Then reduce the FIC211 setpoint or place it in MAN at a lower output; check the monomer inventory bar.');
  for (const [tag, cond] of [['TIC212', 'PVHI'], ['LI215', 'PVHI'], ['PI214', 'PVHI']]) {
    const h = AlarmHelp.resolve(tag, cond, {});
    assert.equal(h.found, true, tag);
    assert.match(h.correctiveAction, /^HOLD the sequence first/, tag + ' ' + cond);
  }
  // S2 round 2: the low-flow alarm used to say "return FIC211 to AUTO", a mode store the attribute refuses while the sequence runs; the
  // sequence restores AUTO itself (CR41, once the PV is good), and the operator's way to the loop is HOLD.
  const low = AlarmHelp.resolve('FIC211', 'PVLO', {});
  assert.equal(low.found, true);
  assert.equal(low.correctiveAction, 'Check MV-211 position against output. The sequence returns FIC211 to AUTO itself once its PV is good. To work the loop, HOLD the sequence first (FIC211 is yours while it is held) and keep it held until the feed is available.');
  // Review Minor 10: TI216 PVHI's action is the entry of the list no assertion read.
  const tad = AlarmHelp.resolve('TI216', 'PVHI', {});
  assert.equal(tad.found, true);
  assert.equal(tad.correctiveAction, 'HOLD the sequence to stop the monomer feed (the sequence owns the FIC211 setpoint while it runs), confirm M-202 is running, and watch the monomer inventory bar fall before you RESUME.');
  // Review Minor 2: TIC212 PVHH, PI214 PVHH and M202 TRIP told the operator to cut the feed without saying how; while the sequence runs HOLD (or ABORT) is the way.
  for (const [tag, cond] of [['TIC212', 'PVHH'], ['PI214', 'PVHH'], ['M202', 'TRIP']]) {
    const h = AlarmHelp.resolve(tag, cond, {});
    assert.equal(h.found, true, tag + ' ' + cond);
    assert.match(h.correctiveAction, /^HOLD the sequence (first|at once) to cut the monomer feed/, tag + ' ' + cond);
    assert.match(h.correctiveAction, /FIC211 belongs to the sequence while it runs and to you while it is held/, tag + ' ' + cond);
  }
});

// Review Minor 9: FIC211 PVLO's consequence said the sequence "will move to REACT with an under-charged reactor". FEED ends on the batch level, and the level only rises
// with the monomer flow, so without flow the sequence waits in FEED. The help now says that, and the model does it.
test('FIC211 PVLO: the help says the sequence waits in FEED without monomer and does not move to REACT, and the model does exactly that', () => {
  const help = AlarmHelp.resolve('FIC211', 'PVLO', {});
  assert.equal(help.found, true);
  assert.match(help.consequence, /so the sequence waits in FEED \(it does not move to REACT under-charged\)/);
  assert.ok(!/will move to REACT/.test(help.consequence), 'the under-charged move to REACT is gone');
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' });
  assert.equal(c.P.b.phase, 'FEED');
  c.V.MV211.pos = 0; c.V.MV211.stuck = true;           // the feed valve shut for good: no monomer reaches the batch
  assert.ok(!run(c, 1200, () => c.P.b.phase !== 'FEED'), 'twenty minutes later the sequence is still in FEED');
  assert.equal(c.P.b.phase, 'FEED');
  assert.ok(c.P.b.lvl < 75, 'the level that ends FEED never got there: ' + c.P.b.lvl);
  assert.ok(c.alarms.some((a) => a.key === 'FIC211.PVLO' && a.active), 'and the low-flow alarm the help belongs to stands');
});

// CR40: the plant gives every M3/H PID loop the measurement policy's low-flow cutoff (1 % of its span) at init, and nothing else. The field is
// derived from the range, which nothing changes at runtime, so a restored snapshot has it recomputed: a snapshot that predates it gets it, and a
// value in the file is not kept (S2 round 2 review).
test('CR40: every M3/H PID loop carries spCutoff = 1 % of its span from init and nothing else does; a restored snapshot has it recomputed', () => {
  const c = boot(4);
  assert.deepEqual(Object.keys(c.L).filter((k) => 'spCutoff' in c.L[k]).sort(), ['FIC102', 'FIC211', 'FIC310', 'FIC313']);
  assert.equal(c.L.FIC102.spCutoff, 1.2); assert.equal(c.L.FIC211.spCutoff, 0.4);
  assert.equal(c.L.FIC310.spCutoff, 0.8); assert.equal(c.L.FIC313.spCutoff, 0.4);
  // the transmitter and the loop share the constant: the observed value is 0 just under the cutoff and reads through at it
  const probe = { kind: 'pid', tag: 'FIC211', eu: 'M3/H', lo: 0, hi: 40, pv: 0.3999 };
  assert.equal(c.L.FIC211.spCutoff, 0.4);
  assert.equal(Measurement.observe(probe).pv, 0);
  assert.equal(Measurement.observe(Object.assign({}, probe, { pv: 0.4 })).pv, 0.4);
  const snap = c.snapshotData('S2 cutoff');
  delete snap.L.FIC211.spCutoff; snap.L.FIC310.spCutoff = 5;
  c.restoreSnapshot(snap);
  assert.equal(c.L.FIC211.spCutoff, 0.4, 'an imported snapshot from before the field gets it back');
  assert.equal(c.L.FIC310.spCutoff, 0.8, 'a value in the file is recomputed from the range, not kept');
});

// ---- S2 fix round 2 (Opus task review) ----

// Important 1: the CR40 shutoff parks OP at OPLOLM on purpose. The Live Diagnosis saturation card read that as "the disturbance exceeds this
// loop" (FIC313 at an operator SP 0 in AUTO: the card on 80 of 120 scans once PVLO announced, 0 before CR40). The card now asks ESS.Pid.shutoff,
// the question stepPid asks. A loop saturated for a real reason still gets it.
test('the saturation card stays silent under the setpoint shutoff: FIC313 at SP 0 in AUTO raises none while PVLO and PVLL stand, and the same loop saturated for a real reason still does', () => {
  const card = (b) => b.diagnose().find((x) => x.id === 'sat.FIC313');
  const active = (b, cond) => b.alarms.some((a) => a.tag === 'FIC313' && a.cond === cond && a.active);
  const c = boot(4, 'OPER');
  run(c, 60);
  c.storeEntry('FIC313', 'SP', 0);
  let shown = 0;
  for (let i = 0; i < 120; i++) { c.step(0.5); if (card(c)) shown++; }        // every scan of 60 s
  const l = c.L.FIC313;
  assert.equal(l.mode, 'AUTO'); assert.equal(l.sp, 0); assert.equal(l.op, 0, 'the output is parked at OPLOLM');
  assert.equal(c.obsOf(l).quality, 'GOOD', 'GOOD quality, at a limit, in alarm: everything else the card needs');
  assert.ok(active(c, 'PVLO') && active(c, 'PVLL'), 'the low flow alarms stand');
  assert.equal(shown, 0, 'no saturation card on any scan');
  // the same record with only the cutoff taken away: the shutoff is the one thing that silences the card
  const cutoff = l.spCutoff;
  delete l.spCutoff;
  assert.equal(card(c).title, 'FIC313 output saturated at 0%');
  l.spCutoff = cutoff;
  assert.equal(card(c), undefined);
  // a real reason: the quench valve sticks nearly shut at an SP the loop owns and can no longer reach, so the output runs out of range
  const d = boot(4, 'OPER');
  run(d, 60);
  d.V.QV313.pos = 0.02; d.V.QV313.stuck = true;
  assert.ok(run(d, 360, () => card(d)), 'the saturation card fires for a stuck valve');
  assert.equal(d.L.FIC313.sp, 10); assert.equal(d.L.FIC313.op, 100);
  assert.equal(card(d).title, 'FIC313 output saturated at 100%');
  assert.ok(active(d, 'PVLO') && active(d, 'PVLL'));
});

// Minor 3: the risk.tad card sent the operator to the FIC211 faceplate to "reduce the monomer feed", a store the PROGRAM attribute refuses
// while the sequence runs in FEED and REACT. It says HOLD first, as the TI216 alarm help does (S2 round 2), and, since the HOLD button lives on the U2 graphic,
// its GO opens that graphic as the M-202 and agitator-stopped cards' HOLD steps do, not the FIC211 faceplate (whole-branch review, Minor 3).
test('the adiabatic-temperature risk card says HOLD the sequence to stop the feed, and its GO opens the U2 graphic where the HOLD button is', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' });
  c.injectFault('agit', true);
  assert.ok(run(c, 200, () => c.diagnose().some((x) => x.id === 'risk.tad')), 'the risk card appears as the agitator trip lets the monomer accumulate');
  const risk = c.diagnose().find((x) => x.id === 'risk.tad');
  assert.equal(risk.steps[0].t, 'HOLD the sequence to stop the monomer feed (the sequence owns the FIC211 setpoint while it runs).');
  assert.equal(typeof risk.steps[0].go, 'function');
  c.setState({ unit: 'U1', display: 'alarms', sel: null });
  risk.steps[0].go();
  assert.equal(c.state.unit, 'U2', 'the GO opens Unit 02');
  assert.equal(c.state.display, 'graphic', 'on the graphic, where SCM202 START / HOLD / ABORT live');
  assert.notEqual(c.state.sel, 'FIC211', 'and no FIC211 faceplate: its stores are refused while the sequence runs');
  // the same GO the other HOLD steps use (the M-202 trip card's first step)
  c.setState({ unit: 'U1', display: 'alarms' });
  const mt = c.diagnose().find((x) => x.id === 'mtrip.M202');
  assert.ok(mt && /HOLD the sequence/.test(mt.steps[0].t));
  mt.steps[0].go();
  assert.deepEqual([c.state.unit, c.state.display], ['U2', 'graphic']);
});

// Minor 4 (ruled correct): ABORT from CHARGE leaves TIC212 in MAN at 8 % with the sequence in COOL. The sequence owns the jacket in COOL, so
// CR41 restores AUTO at the COOL setpoint with its record: an aborted batch cools under control.
test('ABORT from CHARGE hands the jacket loop back under control: TIC212 goes from MAN 8 % to AUTO at SP 40 with its own record', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START'); c.step(0.5);
  assert.equal(c.P.b.phase, 'CHARGE');
  assert.equal(c.L.TIC212.mode, 'MAN'); assert.equal(c.L.TIC212.op, 8);
  c.seqCmd('ABORT');
  assert.equal(c.L.TIC212.sp, 40); assert.equal(c.L.FIC211.sp, 0);
  c.step(0.5);                                         // COOL, or DRAIN at once: the batch is cold, T is 25
  assert.ok(['COOL', 'DRAIN'].includes(c.P.b.phase), c.P.b.phase);
  assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.mode, 'AUTO');
  assert.equal(c.L.TIC212.sp, 40);
  assert.ok(has(c, 'SCM202', 'TIC212 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
  assert.notEqual(c.L.TIC212.op, 8, 'the loop is controlling from that scan, not parked at its manual 8 %');
});

// Minor 8, ruling CR43: the batch trip forces COOL; it now clears the hold as ABORT does. Held, the sequence stood frozen in COOL under the trip,
// the button read RESUME once the TI216 shed released, and after the trip reset the batch sat at HELD · COOL until someone pressed RESUME, while
// the trip card says the sequence resumes in COOL when the trip clears. (At the trip scan the TI216 shed latches too, since Tad is above 106,
// so the button reads HOLD then for that reason; the hold shows once the shed releases with the trip still standing.)
test('CR43: a batch trip during a hold clears the hold: COOL runs, the timer advances, the button reads HOLD, and the batch carries on to DRAIN after the trip resets', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' });
  c.seqCmd('HOLD');
  assert.equal(c.P.b.held, true);
  c.P.b.T = 112; c.step(0.5);
  assert.equal(c.P.trips.batch, true);
  assert.equal(c.P.b.phase, 'COOL');
  assert.equal(c.P.b.held, false, 'the trip clears the hold, beside the forced COOL');
  assert.equal(c.P.b.pt, 0);
  c.step(0.5);
  assert.equal(c.P.b.pt, 0.5, 'the timer advances on the next scan');
  assert.ok(run(c, 120, () => !c.tadShed), 'the TI216 shed released');
  assert.equal(c.P.trips.batch, true, 'the trip still stands');
  assert.equal(c.renderVals().batch.holdT, 'HOLD', 'the button does not offer RESUME on a hold that is gone');
  assert.ok(run(c, 600, () => !c.P.trips.batch), 'the trip resets');
  assert.equal(c.renderVals().batch.phase, 'COOL', 'running COOL, not HELD · COOL');
  assert.ok(run(c, 3600, () => c.P.b.phase === 'DRAIN'), 'COOL completes into DRAIN with nobody pressing RESUME');
});

// Review Minor 1: the TI216 shed card spoke of a held sequence whatever the state ("refuses RESUME", step 3 "RESUME the sequence"), and the TI216 PVHH help said to confirm
// the sequence is HELD. The shed holds the sequence in FEED only, and under CR43 a batch trip during a hold clears the hold on the scan the shed latches: trip and shed
// both up, held false, the batch running in COOL and the button reading HOLD. There is nothing to RESUME there, and the shed releases on its own.
test('the TI216 shed card and help are true held and not held: RESUME is named only for a held sequence, and in the CR43 overlap (trip and shed up, no hold) nothing is said to need resuming', () => {
  // held: the shed holds the batch in FEED, and RESUME is refused until the Urgent alarm clears
  const h = boot(4, 'OPER');
  h.applyPreset('U2_FEED'); h.setState({ sec: 'OPER' });
  h.injectFault('agit', true);
  assert.ok(run(h, 600, () => h.tadShed), 'the shed latches');
  assert.equal(h.P.b.held, true);
  let card = h.diagnose().find((x) => x.id === 'shed.tad');
  assert.equal(card.title, 'Monomer feed shed by TI216 — sequence HELD');
  assert.match(card.why, /closed and refuses RESUME until the Urgent alarm clears\.$/);
  assert.equal(card.steps[2].t, 'When the Urgent alarm clears, RESUME the sequence — the SCM returns FIC211 to AUTO itself.');
  assert.equal(typeof card.steps[2].go, 'function', 'the RESUME step takes the operator to the U2 graphic');
  // not held, the CR43 overlap: the trip clears the hold on the scan the shed latches
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' });
  c.seqCmd('HOLD');
  c.P.b.T = 112; c.step(0.5);
  assert.deepEqual([c.P.trips.batch, c.tadShed, c.P.b.held, c.P.b.phase], [true, true, false, 'COOL'], 'test setup: trip and shed up, no hold, COOL running');
  assert.equal(c.renderVals().batch.holdT, 'HOLD', 'the button offers no RESUME');
  card = c.diagnose().find((x) => x.id === 'shed.tad');
  assert.equal(card.title, 'Monomer feed shed by TI216', 'no HELD in the title');
  assert.ok(!/RESUME/.test(card.why), 'the card does not say the interlock refuses RESUME: ' + card.why);
  assert.match(card.why, /until the Urgent alarm clears; the sequence is not held \(the R-202 trip has it running in COOL\)\.$/);
  assert.ok(card.steps.every((st) => !/^When the Urgent alarm clears, RESUME/.test(st.t)), 'and no step sends the operator to RESUME');
  assert.equal(card.steps[2].t, 'No RESUME is needed: the shed releases on its own when the Urgent alarm clears, and the SCM returns FIC211 to AUTO itself.');
  // and what the card says is what happens: the shed releases with nobody pressing RESUME, and the SCM puts FIC211 back to AUTO
  assert.ok(run(c, 120, () => !c.tadShed), 'the shed releases on its own');
  assert.equal(c.P.trips.batch, true); assert.equal(c.P.b.held, false);
  assert.ok(!has(c, 'SCM202', 'SEQUENCE RESUMED'), 'nobody resumed anything');
  run(c, 2);
  assert.equal(c.L.FIC211.mode, 'AUTO');
  assert.ok(has(c, 'SCM202', 'FIC211 MODE RESTORED BY SEQUENCE (MAN → AUTO)'));
  // the shed in REACT, with no trip standing: not held again, and no R-202 trip to cite, so the card carries no COOL clause
  const d = boot(3, 'OPER');
  d.P.b.phase = 'REACT'; d.syncPhaseSet();
  d.L.TI216.pv = 150; d.L.TI216.almDelay = 0;
  d.scan(0.5); d.interlocks();
  assert.deepEqual([d.tadShed, d.P.b.held, !!d.P.trips.batch], [true, false, false]);
  card = d.diagnose().find((x) => x.id === 'shed.tad');
  assert.match(card.why, /until the Urgent alarm clears; the sequence is not held\.$/);
  assert.match(card.steps[2].t, /^No RESUME is needed/);
  // the help is true in both states: it names HELD and not held, and says what RESUME does in each
  const help = AlarmHelp.resolve('TI216', 'PVHH', {});
  assert.equal(help.found, true);
  assert.ok(!/and the sequence is HELD,/.test(help.correctiveAction), 'it no longer asks the operator to confirm a hold that is not there');
  assert.match(help.correctiveAction, /if the sequence is HELD \(the shed holds it itself in FEED\), RESUME is refused until the Urgent alarm clears/);
  assert.match(help.correctiveAction, /if it is running \(COOL under the R-202 trip, for one\), there is nothing to RESUME/);
  assert.match(help.consequence, /and, in FEED, HOLDS the sequence automatically\.$/);
});

test('D4: an initial-condition load keeps the session journal: one record is appended, ids stay unique, eid keeps counting, the KPI history and t0 survive, the settle\'s internal entries are discarded, trends hold only the settle', () => {
  const c = boot(4, 'MNGR');
  run(c, 60);
  c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 40); c.setMode('TIC202', 'AUTO');
  const before = c.events.length, eid = c.eid, t0 = c.t0, log = c.alarmLog.length, first = c.events[c.events.length - 1].id;
  const base = c.P.t;
  c.applyPreset('U1_SS', { baseTime: base });
  assert.equal(c.events.length, before + 1);
  assert.equal(c.events[0].desc, 'INITIAL CONDITION LOADED — U1 STEADY STATE (SETTLED 120 S)');
  assert.equal(c.events[0].type, 'SYSTEM');
  assert.equal(c.events[0].id, eid);
  assert.equal(c.eid, eid + 1);
  assert.equal(new Set(c.events.map((e) => e.id)).size, c.events.length, 'event ids unique');
  assert.equal(c.events[c.events.length - 1].id, first, 'the session\'s first record is still there');
  assert.equal(c.events.filter((e) => /OPERATOR STATION STARTED/.test(e.desc)).length, 1, 'no second station start');
  assert.ok(c.events.some((e) => e.src === 'TIC202' && e.desc === 'OP CHANGE'), 'the operator\'s own actions survive');
  assert.ok(!c.events.some((e) => /^INITIAL CONDITION LOADED: /.test(e.desc)), 'the restore\'s own log line is the instructor\'s, not an event');
  assert.equal(c.t0, t0);
  assert.equal(c.alarmLog.length, log);
  for (const tag of Object.keys(c.hist)) for (const [t] of c.hist[tag]) assert.ok(t >= base - 120000 && t <= base, tag + ': trends reset with the IC and hold only the settle');
});

test('D4: a batch preset load discards the settle\'s PHASE records and keeps the session\'s', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const before = c.events.length;
  c.applyPreset('U2_REACT', { baseTime: c.P.t });
  assert.equal(c.events.length, before + 1);
  assert.ok(!c.events.some((e) => /PHASE →/.test(e.desc)));
  assert.equal(c.P.b.phase, 'REACT');
  assert.match(c.events[0].desc, /^INITIAL CONDITION LOADED — U2 BATCH REACT \(SETTLED \d+ S\)$/);
});

test('D4: a canonical drill start appends a trainee-visible record after the load record and keeps everything before it', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const before = c.events.length;
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'canonical');
  assert.equal(c.events.length, before + 2);
  assert.equal(c.events[1].desc, 'INITIAL CONDITION LOADED — U1 STEADY STATE (SETTLED 120 S)');
  assert.equal(c.events[0].desc, 'DRILL D3 STARTED — FEED PUMP TRIP — CANONICAL');
  assert.equal(c.events[0].type, 'SYSTEM');
  assert.ok(c.state.drill && c.state.drill.startMode === 'CANONICAL');
});

test('a LIVE STATE drill start appends no load record and no canonical record', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const before = c.events.length;
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'live');
  assert.equal(c.events.length, before);
});

// Review Focus 3: the other readers of the session journal across a load.
test('other readers: a slot saved before an IC load restores to the slot\'s time (the load lies after it and is rewound away), eid keeps counting after the restore, and the debrief timeline builds', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.saveSlot(1, 'before');
  run(c, 30);
  const base = c.P.t;
  c.applyPreset('U1_SS', { baseTime: base });
  const eid = c.eid;
  c.restoreSlot(1);
  assert.ok(c.events.every((e) => e.t <= c.P.t));
  assert.ok(!c.events.some((e) => /INITIAL CONDITION LOADED/.test(e.desc)), 'the slot predates the load');
  c.setMode('TIC202', 'MAN');
  assert.equal(c.events[0].id, eid + 1, 'eid continues past the restore (the restore\'s own INSTR record took ' + eid + ')');
  assert.equal(new Set(c.events.map((e) => e.id)).size, c.events.length, 'event ids stay unique across the load and the restore');
  const d1 = c.drillDefs().find((d) => d.id === 'D1');
  c.startDrill(d1);
  assert.ok(run(c, 900, () => !c.state.drill), 'D1 runs to its debrief');
  assert.equal(c.state.dlg.type, 'debrief');
  assert.doesNotThrow(() => c.renderVals(), 'the debrief renders across the load boundary in the journal');
});

test('D5: a canonical drill start leaves the station clock where it was: the settle ends at the base time, and afterwards sim time equals base time plus the steps taken', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const base = c.P.t;
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D4'), 'canonical');
  assert.equal(c.P.t, base);
  run(c, 10);
  assert.equal(c.P.t, base + 10000);
  const ic = c.events.find((e) => /^INITIAL CONDITION LOADED/.test(e.desc));
  assert.equal(ic.t, base);
  assert.equal(c.state.drill.t0, base);
});

// Review Minor 8: the instructor's initial-condition menu is the one load that is not a drill start, and its callback is built in the page (instructorView).
// It passes the sim clock as the base time (spec 5.3), so the settle ends at the clock and the station clock does not jump; a callback that passed none
// would seed the settle from the wall clock. Reached as the instructor tests reach it, through renderVals().instr.presets.
test('D5: the instructor IC menu loads at the sim clock: every preset\'s callback leaves the station clock where it was', () => {
  const c = boot(4, 'MNGR', 0);
  run(c, 30);
  c.instr.auth = true;
  const presets = c.renderVals().instr.presets;
  assert.equal(presets.length, 5);
  for (const p of presets) {
    run(c, 7);
    const t = c.P.t;
    assert.ok(t > 0 && t < 1e6, 'the zero clock, not the wall clock: ' + t);
    const before = c.events.filter((e) => /^INITIAL CONDITION LOADED/.test(e.desc)).length;
    p.cb();
    assert.equal(c.P.t, t, p.label + ': the settle ends at the sim clock, so the station clock does not move');
    assert.equal(c.events.filter((e) => /^INITIAL CONDITION LOADED/.test(e.desc)).length, before + 1, p.label + ': the load happened');
  }
});

test('D5: the settle lands before the base time: an IC with alarms raised during its run-forward carries raise times inside [base − length, base], and the zero clock tolerates it (times before the session start)', () => {
  const c = boot(4, 'MNGR', 0);
  const base = c.P.t;                                   // the zero clock: the 480 s settle runs at negative times
  assert.equal(base, 0);
  assert.equal(withHotHifeed(() => c.applyPreset('U1_HIFEED', { baseTime: base })), true);
  assert.equal(c.P.t, base);
  const active = c.alarms.filter((a) => a.active);
  assert.ok(active.length > 0, 'the hot U1 high feed settles with R-201 in alarm');
  for (const a of active) {
    assert.ok(a.t >= base - 480000 && a.t <= base, a.key + ' raised during the settle: ' + a.t);
    assert.match(c.fT(a.t), /^\d\d:\d\d:\d\d$/, 'a time before the session start still formats as a clock time');
  }
  c.setState({ display: 'alarms' });
  let rows;
  assert.doesNotThrow(() => { rows = c.renderVals().av.rows; }, 'the Alarm Summary renders the settle\'s alarms');
  assert.ok(rows.length > 0, 'and lists them');
  for (const r of rows) {
    assert.match(r.t, /^\d\d:\d\d:\d\d$/, r.tag + ' ' + r.cond + ': the time column reads a clock time');
    assert.ok(!/NaN|undefined/.test([r.t, r.trip, r.live].join(' ')), r.tag + ' ' + r.cond + ': no NaN in the row');
  }
});

test('D5: without a base time the load is today\'s: the settle starts at the page clock and ends 120 s later (the arch fixtures\' physics is pinned by this)', () => {
  const T0 = 1_700_000_000_000, realNow = Date.now;     // the page seeds a load with no base time from Date.now()
  const c = boot(4, 'MNGR');
  try { Date.now = () => T0; c.applyPreset('U1_SS'); } finally { Date.now = realNow; }
  assert.equal(c.P.t, T0 + 120000);
  const d = boot(4, 'MNGR');
  d.applyPreset('U1_SS', { baseTime: T0 + 120000 });
  assert.equal(d.P.t, T0 + 120000);
  assert.deepEqual(d.P.tankL, c.P.tankL);
  assert.deepEqual(d.L.TIC201.pv, c.L.TIC201.pv);
  assert.deepEqual(JSON.stringify(d.P), JSON.stringify(c.P), 'the same base time gives the same plant either way');
});

test('D5: two loads of the same preset at the same base time are byte-identical, and a canonical start\'s DRILL receipt agrees with its own time (the check a replay makes)', () => {
  const a = boot(4, 'MNGR', 0); run(a, 30); a.applyPreset('U2_FEED', { baseTime: a.P.t });
  const b = boot(4, 'MNGR', 0); run(b, 30); b.applyPreset('U2_FEED', { baseTime: b.P.t });
  assert.equal(JSON.stringify(a.P), JSON.stringify(b.P));
  assert.equal(JSON.stringify(a.L), JSON.stringify(b.L));
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D4'), 'canonical');
  const drill = c.instr.journal.find((e) => e.op === 'DRILL');
  assert.equal(drill.presetBaseT, drill.t, 'the DRILL receipt and its own time agree, so replay\'s time check holds');
});

test('§12: a dry settle whose state is not finite refuses the load with SNAPSHOT REFUSED, and the session journal survives the refusal', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.setMode('TIC202', 'MAN');
  const ids = c.events.map((e) => e.id), eid = c.eid, t0 = c.t0, msgs = c.msgs.length, log = c.alarmLog.length;
  const I = globalThis.ESS.Instructor, real = I.presets;
  I.presets = () => real().map((p) => p.id === 'U1_SS' ? Object.assign({}, p, { set: { L: { LIC101: { sp: Infinity } } } }) : p);
  try {
    assert.equal(c.applyPreset('U1_SS', { baseTime: c.P.t }), undefined);
  } finally { I.presets = real; }
  assert.equal(c.state.msg, 'SNAPSHOT REFUSED: PROCESS STATE IS NOT FINITE');
  assert.ok(Number.isFinite(c.P.t));
  assert.deepEqual(c.events.map((e) => e.id), ids, 'the session\'s records, not the scratch settle\'s');
  assert.equal(c.eid, eid);
  assert.equal(c.t0, t0);
  assert.equal(c.msgs.length, msgs);
  assert.ok(c.alarmLog.length >= log);
});

// Review Focus 5: every path that changes the run speed flips the label.
test('§5.4: the status-bar clock reads SIM hh:mm:ss whenever the run control is frozen or off 1×, computed from state.speed alone', () => {
  const c = boot(4, 'OPER');
  run(c, 10);
  const t = c.fT(c.P.t);
  assert.equal(c.state.speed, 1);
  assert.equal(c.renderVals().timeT, t);
  c.freeze();
  assert.equal(c.renderVals().timeT, 'SIM ' + t);
  c.setSpeed(1);
  assert.equal(c.renderVals().timeT, t);
  c.setSpeed(5);
  assert.equal(c.renderVals().timeT, 'SIM ' + t);
  c.setSpeed(1);
  c.stepOnce();
  assert.equal(c.state.speed, 0);
  assert.equal(c.renderVals().timeT, 'SIM ' + c.fT(c.P.t));
  const v = c.renderVals();
  assert.equal(v.dateT, c.fD(c.P.t));
  c.instr.auth = true;                                  // opens the instructor's run line, the other teller of the clock: it keeps its own words
  const line = c.renderVals().instr.run;
  assert.match(line.simT, /^\d\d:\d\d:\d\d$/);
  assert.equal(line.simT, c.fT(c.P.t));
  assert.equal(line.stateT, 'FROZEN');
});

test('src/ still reads Date.now() once, in createState\'s start-clock fallback in models.js: nothing else in the core reads the wall clock, the SIM label included', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'));
  const hits = src.flatMap((f) => (fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').match(/Date\.now\(\)/g) || []).map(() => f));
  assert.deepEqual(hits.sort(), ['models.js'], 'only createState\'s start-clock fallback reads Date.now in src/');
});

// CR44: the session alarmLog survives a load but initSim rebuilds the alarm engine. An alarm that was active at the load never got its rtn row, so
// the KPI standing list kept it after 10 min. A load closes what was open at the load time and opens what the IC holds at its raise time.
test('CR44: an alarm active before an IC load is closed in the KPI history at the load time, so none stands afterwards', () => {
  const c = boot(4, 'MNGR', 0);
  c.storeEntry('TIC201', 'SP', 100);                    // the reactor cools through PVLO (140, at about 310 s) and PVLL (130, at about 515 s)
  assert.ok(run(c, 700, () => c.alarms.some((a) => a.key === 'TIC201.PVLL' && a.active)), 'test setup: TIC201 is in alarm');
  const open = c.alarms.filter((a) => a.active).map((a) => a.key);
  assert.ok(open.includes('TIC201.PVLO') && open.includes('TIC201.PVLL'), open.join(','));
  const base = c.P.t;
  c.applyPreset('U1_SS', { baseTime: base });
  assert.deepEqual(c.alarms.filter((a) => a.active), [], 'U1_SS holds no alarm');
  for (const key of open) assert.equal(c.alarmLog.filter((r) => r.type === 'rtn' && r.key === key && r.t === base).length, 1, key + ': one rtn row at the load time');
  run(c, 660);                                          // 11 minutes later, past the 10 min standing threshold
  assert.deepEqual(c.kpiMetrics(30).standing, []);
});

test('CR44: an alarm the IC holds is opened in the KPI history at its raise time, before the base time', () => {
  const c = boot(4, 'MNGR', 0);
  withHotHifeed(() => c.applyPreset('U1_HIFEED', { baseTime: 0 }));
  const a = c.alarms.find((x) => x.key === 'TIC201.PVHI' && x.active);
  assert.ok(a && a.t < 0, 'the settle raised it before the base time');
  assert.deepEqual(c.alarmLog.map((r) => [r.key, r.type, r.t]), [['TIC201.PVHI', 'raise', a.t]]);
  const K = globalThis.ESS.Kpi.computeMetrics(c.alarmLog, { t0: -1800000, t1: 0, staleAfterMs: 60000 });
  assert.deepEqual(K.standing.map((x) => [x.key, x.since]), [['TIC201.PVHI', a.t]], 'open since its raise time, not since the load');
});

test('CR44: an alarm active on both sides of a load stays open in the KPI history: no return row and no second raise, so the time-ordered log does not close it', () => {
  const c = boot(4, 'MNGR', 0);
  withHotHifeed(() => c.applyPreset('U1_HIFEED', { baseTime: 0 }));
  const first = c.alarms.find((x) => x.key === 'TIC201.PVHI').t;
  run(c, 60);
  withHotHifeed(() => c.applyPreset('U1_HIFEED', { baseTime: c.P.t }));
  assert.ok(c.alarms.some((x) => x.key === 'TIC201.PVHI' && x.active), 'in alarm after the second load as before it');
  assert.deepEqual(c.alarmLog.map((r) => [r.key, r.type, r.t]), [['TIC201.PVHI', 'raise', first]]);
  const K = globalThis.ESS.Kpi.computeMetrics(c.alarmLog, { t0: -1800000, t1: c.P.t, staleAfterMs: 60000 });
  assert.deepEqual(K.standing.map((x) => [x.key, x.since]), [['TIC201.PVHI', first]]);
});

// CR47: an IC load empties the backtrack ring. After a load the ring held the settle's snapshots, stamped in the minutes before the base time, so a
// backtrack right after a load restored the settle's plant and trimmed the session journal and the KPI rows the load had just written (the CR44 return
// rows sit at the load time), which brought the phantom standing alarms back. The settle is not operable history: the ring restarts at the load (its
// first entry is the first scan after it) and the instructor's slots are untouched.
test('CR47: a backtrack never crosses an IC load: the ring restarts empty, its first entry is the first scan after the load, the load\'s records survive a backtrack, and the slots are untouched', () => {
  const c = boot(4, 'MNGR', 0);
  c.storeEntry('TIC201', 'SP', 100);                    // as the CR44 test: the reactor cools through PVLO and PVLL
  assert.ok(run(c, 700, () => c.alarms.some((a) => a.key === 'TIC201.PVLL' && a.active)), 'test setup: TIC201 is in alarm');
  assert.ok(c.instr.ring.length > 10, 'test setup: the ring holds the session before the load');
  c.saveSlot(1, 'before the load');
  const slot = c.instr.snapshots[1];
  const open = c.alarms.filter((a) => a.active).map((a) => a.key);
  const base = c.P.t;
  c.applyPreset('U1_SS', { baseTime: base });
  assert.deepEqual(c.instr.ring.map((s) => s.t), [], 'the load empties the ring: the settle is not operable history');
  assert.equal(c.instr.lastRingT, -Infinity);
  const events = c.events.length, rows = c.alarmLog.length;
  c.backtrack(30000);                                   // the empty-ring path: the message, and nothing restored or trimmed
  assert.equal(c.state.msg, 'NO BACKTRACK POINT YET');
  assert.equal(c.P.t, base);
  assert.equal(c.events.length, events);
  assert.equal(c.alarmLog.length, rows);
  run(c, 10);
  assert.deepEqual(c.instr.ring.map((s) => s.t), [base + 500], 'the ring restarts with the first scan after the load');
  c.backtrack(30000);                                   // 30 s back is before the load: the nearest point is the first scan after it
  assert.equal(c.P.t, base + 500, 'restored to the first scan after the load, not into the settle');
  assert.ok(c.events.some((e) => e.src === 'STN01' && /^INITIAL CONDITION LOADED/.test(e.desc)), 'the load record is still in the journal');
  for (const key of open) assert.equal(c.alarmLog.filter((r) => r.type === 'rtn' && r.key === key && r.t === base).length, 1, key + ': its return row at the load time survives');
  run(c, 660);                                          // 11 minutes after the load
  assert.deepEqual(c.kpiMetrics(30).standing, []);
  assert.equal(c.instr.snapshots[1], slot, 'the slot is untouched by the load');
  c.restoreSlot(1);
  assert.equal(c.P.t, slot.t, 'and it still restores to its own time, across the load');
});

// CR45: the session journal survives an IC load (spec §5.2), so the architecture drill's debrief, which was handed every event and alarm row from the
// session start, opened on the whole session. It is the drill's: its rows and its relative times start at the drill, running or ended.
function debriefInput(c) {                              // what the ARCH debrief hands ESS.Debrief, and the rows it renders
  const D = globalThis.ESS.Debrief, real = D.build;
  let seen = null;
  D.build = (input, opts) => { seen = input; return real(input, opts); };
  try {
    c.setState({ display: 'arch', archMode: 'debrief' });
    const rows = c.renderVals().arch.debrief.rows;
    return { seen, rows };
  } finally { D.build = real; }
}
test('CR45: an architecture drill\'s debrief starts at the drill: 15 minutes of session before it are not in it, and its first relative time reads 00:00, running and ended', () => {
  const c = boot(4, 'MNGR');
  run(c, 900);
  c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 40); c.setMode('TIC202', 'AUTO');
  run(c, 30);
  assert.ok(c.events.length > 3, 'test setup: a session of records precedes the drill');
  c.startADrillFromMenu('A1');
  const from = c.P.aDrill.startedAt;
  for (const phase of ['running', 'ended']) {
    if (phase === 'ended') c.endADrill('ENDED BY INSTRUCTOR');
    const { seen, rows } = debriefInput(c);
    assert.equal(seen.t0, from, phase);
    for (const k of ['events', 'alarmLog', 'journal']) assert.ok(seen[k].every((r) => r.t >= from), phase + ': ' + k + ' start at the drill');
    assert.ok(seen.events.some((e) => /^INITIAL CONDITION LOADED/.test(e.desc)), phase + ': the load that opened the drill is its first record');
    assert.ok(!rows.some((r) => /STATION STARTED|TIC202/.test(r.text)), phase + ': no row from before the drill');
    assert.equal(rows[0].rel, '00:00', phase);
  }
});

test('CR45: the window covers the action journal too: an action taken between the load and a direct drill start is not in the drill\'s debrief', () => {
  const c = boot(4, 'MNGR');
  c.applyPreset('U1_SS', { baseTime: c.P.t });
  run(c, 60);
  c.setMode('TIC202', 'MAN');                           // journaled 30 s before the drill
  run(c, 30);
  c.startADrill('A1');
  const from = c.P.aDrill.startedAt;
  assert.ok(c.instr.journal.some((e) => e.t < from), 'test setup: a journal row precedes the drill');
  const { seen } = debriefInput(c);
  assert.ok(seen.journal.length > 0 && seen.journal.every((r) => r.t >= from));
});

// Review Minor 5: _lastADrill is not a snapshot key, so a slot or backtrack restore to before the drill leaves the ended drill's start in the plant's future, and the
// window opened at that instant: every row of the session is before it, so the debrief came up empty. A start later than the plant clock is not this timeline's drill.
// CR49 (the re-review's residual): the restore drops that drill, so the window cannot reopen once the clock passes its start and its score is not shown meanwhile.
test('CR45/CR49: a slot restore to before an architecture drill drops it: the debrief is the session again, the window does not reopen when the clock passes the start, and no score survives; a restore to after it keeps the window', () => {
  const c = boot(4, 'MNGR');
  run(c, 60);
  c.setMode('TIC202', 'MAN');
  c.saveSlot(1, 'before the drill');
  const slotT = c.P.t;
  run(c, 30);
  c.startADrillFromMenu('A1');
  const from = c.P.aDrill.startedAt;
  c.endADrill('ENDED BY INSTRUCTOR');
  assert.equal(c.archDebriefFrom(), from, 'test setup: an ended drill windows the debrief at its start');
  c.restoreSlot(1);
  assert.equal(c.P.t, slotT);
  assert.ok(from > c.P.t, 'test setup: the drill\'s start is after the restored clock');
  assert.equal(c.archDebriefFrom(), null, 'a start in the plant\'s future is not this timeline\'s drill');
  assert.equal(c._lastADrill, null, 'CR49: the restore drops the drill, so its score is not shown either');
  run(c, 60);
  assert.ok(c.P.t > from, 'test setup: the clock has passed the abandoned start');
  assert.equal(c.archDebriefFrom(), null, 'CR49: the window does not reopen once the clock passes the abandoned start');
  assert.equal(debriefInput(c).seen.score, null, 'and the debrief carries no score');
  const { seen, rows } = debriefInput(c);
  assert.equal(seen.t0, c.t0, 'the debrief is the session');
  assert.ok(seen.events.some((e) => /OPERATOR STATION STARTED/.test(e.desc)), 'the session before the slot is in it');
  assert.ok(rows.some((r) => /MODE/.test(r.text)), 'and so is the operator\'s own action');
  // control: a slot taken after the drill ended restores to a clock at or after its start, so the drill still windows the debrief
  const d = boot(4, 'MNGR');
  run(d, 30);
  d.startADrillFromMenu('A1');
  const from2 = d.P.aDrill.startedAt;
  run(d, 30);
  d.endADrill('ENDED BY INSTRUCTOR');
  d.saveSlot(2, 'after the drill');
  run(d, 30);
  d.restoreSlot(2);
  assert.ok(d.P.t >= from2);
  assert.equal(d.archDebriefFrom(), from2);
  assert.equal(debriefInput(d).seen.t0, from2);
});

test('with no architecture drill run the debrief shows the whole session, as before', () => {
  const c = boot(4, 'MNGR');
  run(c, 60);
  c.setMode('TIC202', 'MAN');
  const { seen, rows } = debriefInput(c);
  assert.equal(seen.t0, c.t0);
  assert.ok(seen.events.some((e) => /OPERATOR STATION STARTED/.test(e.desc)));
  assert.ok(rows.some((r) => /MODE/.test(r.text)));
});

// CR46: the start record names the drill only when the trainee chose it by name. A RANDOM start would name the fault before it injects, and so would a
// start made while the instructor hides upsets. The choice is journaled with the DRILL entry, so a replay writes the same record.
const startRecord = (c) => c.events.filter((e) => /^DRILL .*STARTED/.test(e.desc)).map((e) => e.desc);
// CR46b: the confirm message the trainee is sent when a drill is armed follows the record's rule (a canonical start names the drill only when revealed).
const armedMsg = (c) => c.msgs.filter((m) => /^INSTRUCTOR: drill/.test(m.txt)).map((m) => m.txt);
test('CR46: a named canonical start records the drill by id and name, and journals that choice', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'canonical');
  assert.deepEqual(startRecord(c), ['DRILL D3 STARTED — FEED PUMP TRIP — CANONICAL']);
  assert.equal(c.instr.journal.find((e) => e.op === 'DRILL').reveal, true);
  assert.deepEqual(armedMsg(c), ['INSTRUCTOR: drill D3 armed — confirm you are at the console'], 'CR46b: the trainee named it, so the message does too');
});

test('CR46: a RANDOM · CANONICAL start records DRILL STARTED — CANONICAL with no id or name', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.renderVals().dg.randomDrill();
  assert.ok(c.state.drill && c.state.drill.startMode === 'CANONICAL', 'test setup: a canonical drill is armed');
  assert.deepEqual(startRecord(c), ['DRILL STARTED — CANONICAL']);
  assert.ok(!c.events.some((e) => e.desc.includes(c.state.drill.def.name.toUpperCase())), 'the drill\'s name is nowhere in the journal');
  assert.equal(c.instr.journal.find((e) => e.op === 'DRILL').reveal, false);
  assert.deepEqual(armedMsg(c), ['INSTRUCTOR: drill armed — confirm you are at the console'], 'CR46b: the message withholds the id too');
  assert.ok(!c.msgs.some((m) => m.txt.includes(c.state.drill.def.id + ' ') || m.txt.includes(c.state.drill.def.name)), 'the drill\'s id and name are in no message');
});

test('CR46: a canonical start made while the instructor hides upsets records DRILL STARTED — CANONICAL, even when the trainee named the drill', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.setHidden(true);
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'canonical');
  assert.deepEqual(startRecord(c), ['DRILL STARTED — CANONICAL']);
  assert.equal(c.instr.journal.find((e) => e.op === 'DRILL').reveal, false);
  assert.deepEqual(armedMsg(c), [], 'hidden upsets: no instructor message reaches the trainee, as before');
});

// A LIVE STATE start has no start record and is always the trainee's own pick by name from the menu, so its message names the drill, as it did before
// CR46b (tests/app-instructor.test.js pins the same for a direct call). A direct canonical start that passes no reveal says it anonymously, like its record.
test('CR46b: a LIVE STATE start names the drill in its message as before; a direct canonical start without reveal does not', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'live');
  assert.deepEqual(startRecord(c), []);
  assert.deepEqual(armedMsg(c), ['INSTRUCTOR: drill D3 armed — confirm you are at the console']);
  const d = boot(4, 'MNGR');
  d.startDrill(d.drillDefs().find((x) => x.id === 'D3'), { startMode: 'CANONICAL' });
  assert.deepEqual(startRecord(d), ['DRILL STARTED — CANONICAL']);
  assert.deepEqual(armedMsg(d), ['INSTRUCTOR: drill armed — confirm you are at the console']);
});

test('CR46: a replayed DRILL entry writes the record its journal entry says, whatever the instructor switch reads at replay time', () => {
  for (const [reveal, want] of [[true, ['DRILL D3 STARTED — FEED PUMP TRIP — CANONICAL']], [false, ['DRILL STARTED — CANONICAL']]]) {
    const c = boot(4, 'MNGR');
    c.setHidden(reveal);                                // the opposite of the entry's own choice
    c.applyJournalEntry({ op: 'DRILL', tag: 'D3', t: c.P.t, startMode: 'CANONICAL', preset: 'U1_SS', presetBaseT: c.P.t, reveal });
    assert.deepEqual(startRecord(c), want, 'reveal ' + reveal);
  }
});
