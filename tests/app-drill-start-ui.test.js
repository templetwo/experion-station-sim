// @artifact dev
// Focused regressions for witnessed D-series initial-condition provenance and banner geometry.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Instructor = require('../src/instructor.js');
const { load } = require('../tools/logic-harness');

const APP = path.join(__dirname, '..', 'Experion Station Simulator.dc.html');
const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  c.setState({ dlg: { type: 'drills' } });
  return c;
}

test('every D drill offers separate canonical and live-state starts backed by a real preset', () => {
  const c = boot();
  const presetIds = new Set(Instructor.presets().map((p) => p.id));
  const defs = c.drillDefs();
  const rows = c.renderVals().dg.drills;

  assert.equal(rows.length, defs.length);
  for (const d of defs) {
    const row = rows.find((x) => x.id === d.id);
    assert.ok(row, d.id + ' is listed');
    assert.ok(presetIds.has(d.basePreset), d.id + ' canonical preset exists: ' + d.basePreset);
    assert.equal(row.presetT, d.basePreset);
    assert.equal(typeof row.canonicalCb, 'function');
    assert.equal(typeof row.liveCb, 'function');
  }
  assert.equal(defs.find((d) => d.id === 'D11').basePreset, 'U2_FEED');
  assert.equal(defs.find((d) => d.id === 'D12').basePreset, 'U3_HILOAD');
});

test('canonical D start replaces carried plant state and labels the active drill', () => {
  const c = boot();
  c.L.LIC101.sp = 33;
  c.renderVals().dg.drills.find((x) => x.id === 'D1').canonicalCb();

  assert.equal(c.L.LIC101.sp, 50, 'U1_SS replaced the carried setpoint');
  assert.equal(c.state.drill.startMode, 'CANONICAL');
  assert.equal(c.state.drill.preset, 'U1_SS');
  assert.equal(c.renderVals().db.sourceT, 'CANONICAL · U1_SS');
  const armed = c.instr.journal.find((e) => e.op === 'DRILL');
  assert.equal(armed.startMode, 'CANONICAL');
  assert.equal(armed.preset, 'U1_SS');
});

test('live-state D start preserves intentional instructor state and labels it plainly', () => {
  const c = boot();
  c.L.LIC101.sp = 33;
  c.renderVals().dg.drills.find((x) => x.id === 'D1').liveCb();

  assert.equal(c.L.LIC101.sp, 33, 'live-state start must not load a preset');
  assert.equal(c.state.drill.startMode, 'LIVE STATE');
  assert.equal(c.state.drill.preset, null);
  assert.equal(c.renderVals().db.sourceT, 'LIVE STATE');
});

test('D9 LIVE STATE does not secretly manufacture the previous-shift MAN condition', () => {
  const c = boot();
  assert.equal(c.L.PIC401.mode, 'AUTO');
  c.renderVals().dg.drills.find((x) => x.id === 'D9').liveCb();
  assert.equal(c.L.PIC401.mode, 'AUTO', 'LIVE STATE must preserve the actual loop mode');
  assert.equal(c.state.drill.startMode, 'LIVE STATE');

  c.endDrill('ENDED BY INSTRUCTOR');
  c.setState({ dlg: { type: 'drills' } });
  c.renderVals().dg.drills.find((x) => x.id === 'D9').canonicalCb();
  assert.equal(c.L.PIC401.mode, 'MAN', 'the defined previous-shift condition belongs to CANONICAL');
});

test('D drill start provenance survives the drill snapshot shape', () => {
  const c = boot();
  c.renderVals().dg.drills.find((x) => x.id === 'D2').canonicalCb();
  const restored = c.drillFromData(c.drillData());
  assert.equal(restored.startMode, 'CANONICAL');
  assert.equal(restored.preset, 'U1_SS');
});

test('canonical D replay rebuilds the preset before restoring the CANONICAL label', () => {
  const c = boot();
  c.P.env.feedConc = 1.4;
  c.saveSlot(0, 'before canonical D1');
  c.renderVals().dg.drills.find((x) => x.id === 'D1').canonicalCb();
  const live = { feedConc: c.P.env.feedConc, t: c.P.t, mode: c.state.drill.startMode, preset: c.state.drill.preset };
  assert.equal(live.feedConc, 1);

  c.startReplay(0);
  c.replayToEnd();
  assert.ok(c.state.drill, 'the replay must re-arm D1');
  assert.deepEqual({ feedConc: c.P.env.feedConc, t: c.P.t, mode: c.state.drill.startMode, preset: c.state.drill.preset }, live,
    'the canonical provenance label and actual rebuilt plant state must agree');
});

test('canonical D replay refuses an unknown preset instead of arming on stale state', () => {
  const c = boot();
  c.instr.replay = { entries: [], i: 0, toT: c.P.t };
  c.applyJournalEntry({ op: 'DRILL', tag: 'D1', t: c.P.t, startMode: 'CANONICAL',
    preset: 'NOT_A_PRESET', presetBaseT: c.P.t });
  assert.equal(c.instr.replay, null);
  assert.equal(c.state.drill, null);
  assert.match(c.state.msg, /UNKNOWN/);
});

test('a declared proactive D9 response can pass only after its full safe observation horizon', () => {
  const c = boot();
  c.renderVals().dg.drills.find((x) => x.id === 'D9').canonicalCb();
  let guard = 0;
  while (c.state.drill && !c.state.drill.injected && guard++ < 100) c.step(0.5);
  assert.ok(c.state.drill && c.state.drill.injected, 'D9 fault did not inject');
  c.setMode('PIC401', 'AUTO');
  const actedAt = c.state.drill.m.tAct;
  for (let i = 0; i < 358; i++) c.step(0.5);
  assert.ok(c.state.drill, 'D9 ended before its 180-second proactive observation horizon');
  while (c.state.drill && guard++ < 2000) c.step(0.5);
  const ended = c.state.dlg && c.state.dlg.drill;
  assert.ok(ended, 'D9 did not reach a debrief');
  assert.equal(ended.reason, 'STABILIZED');
  assert.equal(ended.m.tAlarm, undefined, 'the response should have prevented annunciation');
  assert.ok(ended.m.tStable - actedAt >= 180000, 'stability was granted before the declared horizon');
  const score = c.scoreDrill(ended, ended.def.a);
  assert.equal(score.score, 80);
  assert.equal(score.pass, true);
});

test('D12 quench response uses the real bed state and passes only after its 300-second horizon', () => {
  const c = boot();
  c.renderVals().dg.drills.find((x) => x.id === 'D12').canonicalCb();
  let guard = 0;
  while (c.state.drill && !c.state.drill.injected && guard++ < 100) c.step(0.5);
  assert.ok(c.state.drill && c.state.drill.injected, 'D12 fault did not inject');
  assert.equal(c.storeEntry('FIC313', 'SP', 38), true);
  const actedAt = c.state.drill.m.tAct;
  for (let i = 0; i < 598; i++) c.step(0.5);
  assert.ok(c.state.drill, 'D12 ended before its 300-second proactive observation horizon');
  while (c.state.drill && guard++ < 2400) c.step(0.5);
  const ended = c.state.dlg && c.state.dlg.drill;
  assert.ok(ended, 'D12 did not reach a debrief');
  assert.equal(ended.reason, 'STABILIZED');
  assert.equal(ended.m.tAlarm, undefined, 'the response should have prevented annunciation');
  assert.ok(ended.m.tStable - actedAt >= 300000, 'stability was granted before the declared horizon');
  const score = c.scoreDrill(ended, ended.def.a);
  assert.equal(score.score, 80);
  assert.equal(score.pass, true);
});

test('undeclared drills cannot turn 60 quiet seconds into proactive stabilization', () => {
  const c = boot();
  c.renderVals().dg.drills.find((x) => x.id === 'D6').canonicalCb();
  let guard = 0;
  while (c.state.drill && !c.state.drill.injected && guard++ < 100) c.step(0.5);
  c.setMode('TIC202', 'MAN');
  for (let i = 0; i < 140; i++) c.step(0.5);
  assert.ok(c.state.drill, 'D6 falsely ended as stable from alarm absence alone');
  assert.equal(c.state.drill.m.tStable, undefined);
});

test('only drills that declare a proactive policy receive pre-alarm action credit', () => {
  const action = (c) => c.scoreDrill(c.state.drill, c.state.drill.def.a).breakdown.find((row) => row.id === 'action');

  const d6 = boot();
  d6.renderVals().dg.drills.find((x) => x.id === 'D6').liveCb();
  d6.state.drill.m.tAct=d6.P.t+1000;
  d6.state.drill.m.tAlarm=null;
  assert.equal(action(d6).earned,0,'D6 has no proactive scoring contract');

  const d9 = boot();
  d9.renderVals().dg.drills.find((x) => x.id === 'D9').liveCb();
  d9.state.drill.m.tAct=d9.P.t+1000;
  d9.state.drill.m.tAlarm=null;
  assert.ok(action(d9).earned>0,'D9 explicitly opts into proactive credit');
});

test('D11 canonical start reaches its declared Unit 02 feed condition before arming', () => {
  const c = boot();
  c.renderVals().dg.drills.find((x) => x.id === 'D11').canonicalCb();
  assert.equal(c.state.unit, 'U2');
  assert.equal(c.P.b.phase, 'FEED');
  assert.ok(c.P.b.Cm > 8, 'the D11 injection gate is already reachable: Cm=' + c.P.b.Cm);
  assert.equal(c.state.drill.preset, 'U2_FEED');
});

test('D11 live-state start does not silently start an idle batch', () => {
  const c = boot();
  assert.equal(c.P.b.phase, 'IDLE');
  c.renderVals().dg.drills.find((x) => x.id === 'D11').liveCb();
  assert.equal(c.P.b.phase, 'IDLE', 'LIVE STATE must preserve the idle sequence condition');
  assert.equal(c.state.drill.startMode, 'LIVE STATE');
  for (let i = 0; i < 40; i++) c.step(0.5);
  assert.equal(c.state.drill.injected, false, 'D11 waits for its real FEED gate instead of manufacturing it');
});

test('the active-drill banner is anchored away from Unit 02 top-right sequence controls', () => {
  const html = fs.readFileSync(APP, 'utf8');
  const banner = html.match(/<div data-drill-banner="true" style="([^"]+)"/);
  assert.ok(banner, 'active-drill banner has a named geometry contract');
  assert.match(banner[1], /bottom:8px/);
  assert.match(banner[1], /left:10px/);
  assert.doesNotMatch(banner[1], /(?:^|;)top:/, 'must not cover the Unit 02 top control strip');
  assert.doesNotMatch(banner[1], /(?:^|;)right:/, 'must not return to the witnessed top-right collision');
  assert.match(html, /DRILL IN PROGRESS · \{\{ db\.tm \}\} · \{\{ db\.sourceT \}\}/,
    'the banner says whether this is canonical or live-state');
});
