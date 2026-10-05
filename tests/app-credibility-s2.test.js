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
  // CHARGE: PROGRAM, but the sequence does not own the jacket setpoint there, so it leaves the loop where it is
  const d = boot(4, 'OPER');
  d.seqCmd('START'); d.step(0.5);
  assert.equal(d.P.b.phase, 'CHARGE');
  assert.equal(d.L.TIC212.modeAttr, 'PROGRAM'); assert.equal(d.L.TIC212.mode, 'MAN');
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

// CR42: the alarm help for the three high alarms that told the operator to write a loop the sequence owns while it runs now says HOLD the
// sequence first: FIC211 and TIC212 are the sequence's while it runs and the operator's while it is held (spec 4.2).
test('CR42: the alarm help that directs a write to a loop the sequence owns says HOLD the sequence first: FIC211, TIC212, LI215 and PI214 PVHI, and FIC211 PVLO', () => {
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
// while the sequence runs in FEED and REACT. It now says HOLD first, as the TI216 alarm help does, and keeps its GO to the faceplate.
test('the adiabatic-temperature risk card says HOLD the sequence to stop the feed, and keeps its GO to the FIC211 faceplate', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' });
  c.injectFault('agit', true);
  assert.ok(run(c, 200, () => c.diagnose().some((x) => x.id === 'risk.tad')), 'the risk card appears as the agitator trip lets the monomer accumulate');
  const risk = c.diagnose().find((x) => x.id === 'risk.tad');
  assert.equal(risk.steps[0].t, 'HOLD the sequence to stop the monomer feed (the sequence owns the FIC211 setpoint while it runs).');
  assert.equal(typeof risk.steps[0].go, 'function');
  risk.steps[0].go();
  assert.equal(c.state.sel, 'FIC211', 'the GO opens the FIC211 faceplate');
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

// The shipped U1_HIFEED stops under the High limit (R-201 reads 164.3 against PVHI 165), so no alarm is raised during its settle. This variant takes the
// TIC201 setpoint to its 170 limit as well, which crosses PVHI at about 246 s into the 480 s run-forward: an alarm raised during a settle.
test('D5: the settle lands before the base time: an IC with alarms raised during its run-forward carries raise times inside [base − length, base], and the zero clock tolerates it (times before the session start)', () => {
  const c = boot(4, 'MNGR', 0);
  const base = c.P.t;                                   // the zero clock: the 480 s settle runs at negative times
  assert.equal(base, 0);
  const I = globalThis.ESS.Instructor, real = I.presets;
  I.presets = () => real().map((p) => p.id === 'U1_HIFEED' ? Object.assign({}, p, { set: { L: { LIC101: { sp: 40 }, TIC201: { sp: 170 } } } }) : p);
  try {
    assert.equal(c.applyPreset('U1_HIFEED', { baseTime: base }), true);
  } finally { I.presets = real; }
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

test('D5: the dry settle is the real settle: two loads of the same preset at the same base time are byte-identical, and a replay of a canonical drill rebuilds at the receipt\'s time', () => {
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

test('§12: a dry settle whose state is not finite refuses the load with SNAPSHOT REFUSED', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const I = globalThis.ESS.Instructor, real = I.presets;
  I.presets = () => real().map((p) => p.id === 'U1_SS' ? Object.assign({}, p, { set: { L: { LIC101: { sp: Infinity } } } }) : p);
  try {
    assert.equal(c.applyPreset('U1_SS', { baseTime: c.P.t }), undefined);
  } finally { I.presets = real; }
  assert.equal(c.state.msg, 'SNAPSHOT REFUSED: PROCESS STATE IS NOT FINITE');
  assert.ok(Number.isFinite(c.P.t));
});
