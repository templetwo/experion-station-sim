// @artifact dev
// The coach projection carries the rationalised alarm help of the alarm that matters, even
// when no alarm is selected. On the live run of 2026-09-03 the local model read FIC102's
// BADPV correctly off the board and still called it a process effect, while LIVE DIAGNOSIS
// beside it had the answer; the answer lives in src/alarm-help.js, so the coach gets it too.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'Experion Station Simulator.dc.html'), 'utf8');
const { Component } = load();
function boot() { const c = new Component({}); c.initSim(1700000000000); return c; }

test('with nothing selected, the projection carries the help of the highest-priority unacknowledged alarm', () => {
  const c = boot();
  c.injectFault('xmtr', true);                       // FIC102 transmitter failure -> BADPV, loop sheds to MAN
  for (let i = 0; i < 120 && !c.alarms.some((a) => a.tag === 'FIC102' && a.cond === 'BADPV'); i++) c.step(0.5);
  assert.ok(c.alarms.some((a) => a.tag === 'FIC102' && a.cond === 'BADPV'), 'precondition: BADPV raised');
  const p = c.coachProjection();
  assert.equal(p.selected, null);
  assert.ok(p.help, 'help must be present without a selection');
  assert.deepEqual({ tag: p.helpFor.tag, cond: p.helpFor.cond }, { tag: 'FIC102', cond: 'BADPV' });
  assert.match(p.helpFor.why, /highest-priority/);
  assert.match(p.help.probableCause, /transmitter|input/i, p.help.probableCause);
  assert.match(p.help.correctiveAction, /by hand|MAN\b|manual/i, p.help.correctiveAction);
});

test('a selected alarm still wins over the top alarm', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 171, 'DEG C', 'REACTOR R-201 TEMPERATURE');
  c.raiseA('LIC401', 'PVLO', 'Low', 18, '%', 'FLASH DRUM V-401 LEVEL');
  const low = c.alarms.find((a) => a.tag === 'LIC401');
  c.setState({ selAlm: low.id });
  const p = c.coachProjection();
  assert.equal(p.selected && p.selected.tag, 'LIC401');
  assert.deepEqual({ tag: p.helpFor.tag, cond: p.helpFor.cond, why: p.helpFor.why }, { tag: 'LIC401', cond: 'PVLO', why: 'selected alarm' });
});

test('unacknowledged beats acknowledged, then priority decides', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 171, 'DEG C', 'REACTOR R-201 TEMPERATURE');
  c.raiseA('LIC401', 'PVLO', 'Low', 18, '%', 'FLASH DRUM V-401 LEVEL');
  const high = c.alarms.find((a) => a.tag === 'TIC201');
  c.ackAlarm(high.id);
  const p = c.coachProjection();
  assert.equal(p.helpFor.tag, 'LIC401', 'the Low alarm is the unacknowledged one, so it is the one that matters now');
});

test('with no alarms at all there is no help and no helpFor', () => {
  const p = boot().coachProjection();
  assert.equal(p.help, null);
  assert.equal(p.helpFor, null);
});

test('the sidecar forwards helpFor and the explain task names the help as authoritative', () => {
  const serve = fs.readFileSync(path.join(__dirname, '..', 'tools', 'coach', 'serve.py'), 'utf8');
  assert.match(serve, /"helpFor": projection\.get\("helpFor"\)/);
  assert.match(serve, /BADPV or bad-quality condition means the measurement cannot be trusted/);
});

test('the U1 graphic tells the same story as the orientation document', () => {
  assert.match(PAGE, /UNIT 01 — RECEIPT AND CONVERSION/);
  assert.match(PAGE, /E-301 FLASH PREHEATER → V-401 FLASH DRUM/);
  assert.doesNotMatch(PAGE, /GENERIC PROCESS UNIT|E-301 EXCHANGER/);
  assert.match(PAGE, /UNIT 03 — HYDROFINISHING/);
});
