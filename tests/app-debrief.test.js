// @artifact dev
// S4: ESS.Debrief is loaded by the page and reachable as an ARCH mode. Replay
// switches the view into debrief. Trainee-safe projection still hides fault ids.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const FaultEngine = require('../src/fault-engine.js');

const APP = path.join(__dirname, '..', 'Experion Station Simulator.dc.html');
const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  return c;
}

test('page sources src/debrief.js before support.js', () => {
  const html = fs.readFileSync(APP, 'utf8');
  const iDeb = html.indexOf('src="./src/debrief.js"');
  const iSup = html.indexOf('src="./support.js"');
  assert.ok(iDeb > 0, 'debrief.js script tag missing');
  assert.ok(iSup > iDeb, 'debrief.js must load before support.js');
});

test('ESS.Debrief is on the harness global after page load', () => {
  assert.equal(typeof globalThis.ESS.Debrief.build, 'function');
});

test('ARCH Debrief chip is available when no A-drill is running', () => {
  const c = boot();
  c.setState({ display: 'arch', archMode: 'learn' });
  const v = c.renderVals();
  const ids = (v.arch.modeChips || []).map((m) => m.id);
  assert.ok(ids.includes('debrief'), 'debrief mode chip missing: ' + ids.join(','));
  assert.equal(v.arch.debriefOn, false);
  c.setState({ archMode: 'debrief' });
  const d = c.renderVals();
  assert.equal(d.arch.debriefOn, true);
  assert.ok(d.arch.debrief);
});

test('Debrief timeline contains journaled operator actions', () => {
  const c = boot();
  c.setMode('FIC102', 'MAN');
  c.setState({ display: 'arch', archMode: 'debrief' });
  const v = c.renderVals();
  assert.equal(v.arch.debrief.empty, false);
  assert.ok(v.arch.debrief.rows.some((r) => /MODE/.test(r.text)),
    'expected a MODE row, got ' + JSON.stringify(v.arch.debrief.rows.map((r) => r.text)));
});

test('startReplay opens ARCH in debrief mode', () => {
  const c = boot();
  c.instr.auth = true;
  c.setState({ sec: 'MNGR' });
  c.saveSlot(0, 'pre');
  c.setMode('FIC102', 'MAN');
  c.startReplay(0);
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archMode, 'debrief');
  assert.ok(c.instr.replay, 'replay plan was not armed');
  const v = c.renderVals();
  assert.equal(v.arch.debriefOn, true);
});

test('trainee debrief (no replay, not instructor), no fault ever injected: stays clean', () => {
  const c = boot();
  assert.equal(c.instructorAllowed(), false);
  c.setState({ display: 'arch', archMode: 'debrief' });
  const v = c.renderVals();
  assert.equal(v.arch.debrief.projection, 'TRAINEE_SAFE');
  const blob = JSON.stringify(v.arch.debrief);
  const leaked = FaultEngine.FAULT_IDS.filter((id) => blob.includes(id));
  assert.deepEqual(leaked, [], 'trainee debrief leaked fault ids: ' + leaked.join(','));
});

// POSITIVE CONTROL (adversarial verify, S3 round): the test above is a negative
// assertion over a session where no fault was ever injected -- it would pass
// identically whether or not the timeline is actually being filtered. Proven live:
// before the fix in archDebriefJournalSafe(), this exact test failed with
// 'INSTR UPSET xmtr ON' / 'ARCHFAULT SVC-SERVER SERVER_SERVICE_DEGRADED' present
// verbatim in v.arch.debrief.rows, reachable by a plain trainee (the DEBRIEF mode
// chip is available with no A-drill running, per the test above) with no replay and
// no instructor auth -- the debrief timeline unconditionally journals every
// instructor row's text (src/debrief.js's own header: "the module cannot know which
// prose does" name a fault; filtering PROSE is the caller's job), and two of those
// ops carry a fault identity directly: legacy 'UPSET' (tag IS the reserved upset
// key) and 'ARCHFAULT'/'ARCHCLEAR' (arg IS the literal FaultEngine faultId).
test('trainee debrief: a real fault injected through EITHER path leaks nothing, hidden or not', () => {
  // Path 1: the legacy reserved-upset path (A1/A3's real physics fault).
  {
    const c = boot();
    c.applyPreset('U1_SS');
    c.setHidden(true);
    c.setUpset('xmtr', true);
    for (let i = 0; i < 20; i++) c.step(0.5);
    c.setState({ display: 'arch', archMode: 'debrief' });
    const v = c.renderVals();
    assert.equal(v.arch.debrief.projection, 'TRAINEE_SAFE');
    // Sanity the detector has teeth: an instructor row for this injection DID reach the
    // journal (so a real filter, not an empty journal, is what keeps the blob clean).
    assert.ok(c.instr.journal.some((e) => e.instr && e.op === 'UPSET' && e.tag === 'xmtr'),
      'test setup: expected an instr:true UPSET row in the journal');
    const blob = JSON.stringify(v.arch.debrief);
    assert.ok(!blob.includes('xmtr'), 'trainee debrief leaked the legacy upset key "xmtr"');
    const leaked = FaultEngine.FAULT_IDS.filter((id) => blob.includes(id));
    assert.deepEqual(leaked, [], 'trainee debrief leaked fault ids: ' + leaked.join(','));
  }
  // Path 2: the engine-only ARCHFAULT path (A2/A4-A11's faults), HIDDEN off too --
  // the literal fault id must never leak into this surface regardless of the switch
  // that governs the (separate, already-tested) journal/System Status mirror.
  for (const hidden of [true, false]) {
    const c = boot();
    c.applyPreset('U1_SS');
    c.setHidden(hidden);
    c.setArchFault('SERVER_SERVICE_DEGRADED', 'SVC-SERVER', {});
    for (let i = 0; i < 5; i++) c.step(0.5);
    c.setState({ display: 'arch', archMode: 'debrief' });
    const v = c.renderVals();
    assert.equal(v.arch.debrief.projection, 'TRAINEE_SAFE');
    assert.ok(c.instr.journal.some((e) => e.instr && e.op === 'ARCHFAULT' && e.arg === 'SERVER_SERVICE_DEGRADED'),
      'test setup: expected an instr:true ARCHFAULT row in the journal');
    const blob = JSON.stringify(v.arch.debrief);
    assert.ok(!blob.includes('SERVER_SERVICE_DEGRADED'),
      `trainee debrief (hidden=${hidden}) leaked the literal fault id`);
  }
});
