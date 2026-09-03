// @artifact dev
// P2L-EXPANSION-SPEC section 2.7: E-301 is a flash PREHEATER on hot oil, not a product
// cooler. The model has always said so (hxT rises as TV-301 opens; TIC301 is REV, heating
// action; diagnose() says "reduce heat input at TIC301"), but the prose said the opposite:
// the point description called it a PRODUCT OUTLET, the TIC301 help told the operator to
// OPEN TV-301 further to cure a HIGH temperature, and two other entries blamed E-301
// fouling for HIGH alarms it cannot cause (fouling under-heats, and at the modelled floor
// reaches no alarm at all). Every prose surface is pinned to the model's sign here.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AlarmHelp = require('../src/alarm-help.js');
const Process = require('../src/process.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();
function boot() { const c = new Component({}); c.initSim(1700000000000); return c; }

function settledOutletAt(op) {
  const c = boot();
  c.setMode('TIC301', 'MAN'); c.L.TIC301.op = op;
  for (let i = 0; i < 1200; i++) c.step(0.5);    // 10 min, well past the 90 s exchanger lag
  return c.P.hxT;
}

// A pin, not a regression: the model was always right. Kept so the prose tests below
// cannot drift into agreeing with each other while disagreeing with the physics.
test('the MODEL: opening TV-301 makes the E-301 outlet hotter (it is a preheater)', () => {
  const cold = settledOutletAt(20), hot = settledOutletAt(80);
  assert.ok(hot > cold + 20, `expected a clear rise with TV-301 open, got ${cold} -> ${hot}`);
});

test('the POINT DESCRIPTION says what the exchanger is', () => {
  const desc = boot().L.TIC301.desc;
  assert.match(desc, /PREHEAT/, 'TIC301.desc must name E-301 as the flash preheater');
  assert.doesNotMatch(desc, /PRODUCT OUTLET|COOLER/);
});

test('no alarm-help entry that names E-301 / TV-301 / TIC301 calls it a cooler or acts against the model', () => {
  const c = boot();
  const offenders = [];
  for (const k of AlarmHelp.keys()) {
    const [tag, cond] = k.split('.');
    const h = c.alarmHelpFor(tag, cond);
    const txt = [h.consequence, h.probableCause, h.correctiveAction].join(' | ');
    if (!/E-301|TV-301|TIC301/.test(txt)) continue;
    if (/cooler|product outlet|cools|reduces cooling|open TV-301 further|open too far/i.test(txt)) offenders.push(`${k}: ${txt}`);
  }
  assert.deepEqual(offenders, [], 'prose acting against the E-301 sign');
});

test('TIC301 entries: HIGH cuts heat, LOW names a closed valve, fouling is a LOW-side tell only', async (t) => {
  const c = boot();
  const help = (cond) => c.alarmHelpFor('TIC301', cond);
  for (const cond of ['PVLL', 'PVLO', 'PVHI', 'PVHH']) assert.equal(help(cond).found, true, cond);
  const lowTxt = (cond) => help(cond).probableCause + ' ' + help(cond).correctiveAction;

  await t.test('PVHI and PVHH each, independently, close the hot-oil valve or cut heat', () => {
    assert.match(help('PVHI').correctiveAction, /close TV-301|cut heat/i, help('PVHI').correctiveAction);
    assert.match(help('PVHH').correctiveAction, /close TV-301|cut heat/i, help('PVHH').correctiveAction);
  });

  await t.test('PVLL names the valve CLOSED, not open', () => {
    assert.match(help('PVLL').probableCause, /TV-301 closed/i, help('PVLL').probableCause);
  });

  await t.test('PVHH is honest that TV-301 alone cannot reach 215 DEG C', () => {
    assert.match(help('PVHH').probableCause, /excursion/i);
    assert.match(help('PVHH').probableCause, /alone cannot reach/i, help('PVHH').probableCause);
  });

  await t.test('fouling is mentioned on the LOW side as the output-climbing tell, and nowhere on the HIGH side', () => {
    for (const cond of ['PVLL', 'PVLO']) assert.match(lowTxt(cond), /foul/i, `${cond} should teach the fouling tell`);
    for (const cond of ['PVLL', 'PVLO']) assert.doesNotMatch(lowTxt(cond), /saturated|wide open|fully open/i, `${cond}: the modelled fouling floor never saturates TIC301`);
    for (const cond of ['PVHI', 'PVHH']) assert.doesNotMatch(lowTxt(cond), /foul/i, `${cond}: fouling under-heats and cannot cause a HIGH`);
  });
});

test('no OTHER Unit 01 entry blames E-301 fouling for a HIGH it cannot cause', () => {
  const c = boot();
  assert.doesNotMatch(c.alarmHelpFor('TIC201', 'PVHI').probableCause, /foul/i, 'E-301 is downstream of R-201; it cannot raise the feed temperature');
  assert.doesNotMatch(c.alarmHelpFor('PIC401', 'PVHI').probableCause, /foul/i, 'fouling lowers flash duty; it cannot raise drum pressure');
});

// A pin: the orientation document was written after the model and has always agreed with it.
test('the ORIENTATION DOCUMENT tells the same story', () => {
  const txt = Process.text();
  assert.match(txt, /E-301 is a PREHEATER/);
  assert.match(txt, /Open TV-301 further and the drum gets hotter/);
});
