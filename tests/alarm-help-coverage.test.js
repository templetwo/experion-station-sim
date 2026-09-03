// @artifact dev
// P2L-EXPANSION-SPEC section 2.8: THE ALARM-HELP COVERAGE GATE.
//
// src/alarm-help.js resolve() returns a polite generic paragraph for any key it has no
// authored entry for, so the product can quietly ship fifty new alarms with twelve help
// entries and nothing goes red -- the exact way an expansion gets wider and shallower.
// Coverage is 100 % today (65 entries against every configured, discrete and equipment
// condition). This file makes that an explicit, derived assertion in both directions:
// every condition the runtime can raise has authored prose, and every authored key is a
// condition the runtime can raise (prose for a deleted alarm is drift, not coverage).
//
// The condition inventory is DERIVED from the code, never listed by hand here:
//   configured  every tag x condition in this.L[tag].alm, plus every non-null condition in
//               the U2 phase-based limit sets (phaseSets(): FIC211.PVLO exists only in FEED)
//   equipment   every raiseTrip(ctx, 'SRC', 'COND') literal in src/models.js
//   discrete    every raiseA('SRC', 'COND', ...) literal in the app page, plus TAG.TRIP for
//               every motor (the page raises those through a variable), and BADPV for every
//               point the xmtr upset can target
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AlarmHelp = require('../src/alarm-help.js');
const { load } = require('../tools/logic-harness');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'Experion Station Simulator.dc.html'), 'utf8');
const MODELS = fs.readFileSync(path.join(ROOT, 'src', 'models.js'), 'utf8');
const { Component } = load();

function inventory() {
  const c = new Component({}); c.initSim(1700000000000);
  const keys = new Set();
  const why = {};
  const put = (tag, cond, src) => { const k = tag + '.' + cond; keys.add(k); why[k] = src; };
  for (const tag in c.L) for (const cond in c.L[tag].alm) put(tag, cond, 'configured in this.L');
  // U2 state-based limits: a phase set can ADD a condition the IDLE database does not carry
  // (FIC211.PVLO is live only in FEED, LI215.PVLO from HEATUP on), so every non-null
  // condition of every phase set is raisable too.
  const sets = c.phaseSets();
  for (const ph in sets) for (const tag in sets[ph]) for (const cond in sets[ph][tag]) if (sets[ph][tag][cond]) put(tag, cond, 'phase set ' + ph);
  for (const m of MODELS.matchAll(/raiseTrip\(ctx,\s*'([^']+)',\s*'([^']+)'/g)) put(m[1], m[2], 'src/models.js raiseTrip');
  for (const m of PAGE.matchAll(/raiseA\('([^']+)',\s*'([^']+)'/g)) put(m[1], m[2], 'app page raiseA literal');
  for (const tag in c.L) if (c.L[tag].kind === 'motor') put(tag, 'TRIP', 'motor trip (page raiseA(mt,\'TRIP\'))');
  // The xmtr upset freezes/fails the FIC102 transmitter (src/models.js) and the PID sheds on BADPV.
  // The app page ALSO sets badPv on arbitrary points (the architecture fault engine's
  // OPEN_INPUT_BAD_QUALITY over a node's pointRefs) but that path deliberately raises no
  // alarm today; if it ever calls raiseA, derive its targets here too or this gate under-counts.
  for (const m of MODELS.matchAll(/L\.(\w+)\.badPv\s*=\s*true/g)) put(m[1], 'BADPV', 'src/models.js badPv');
  return { c, keys, why };
}

test('ALARM-HELP COVERAGE GATE', async (t) => {
  const { c, keys, why } = inventory();
  const authored = new Set(AlarmHelp.keys());

  await t.test('the derived inventory is not vacuous', () => {
    assert.ok(keys.size >= 60, `derived only ${keys.size} conditions`);
    assert.ok([...keys].some((k) => why[k].startsWith('src/models.js raiseTrip')), 'no equipment trips parsed from models.js');
    assert.ok([...keys].some((k) => why[k].startsWith('app page raiseA')), 'no discrete alarms parsed from the page');
    assert.ok(keys.has('FIC102.BADPV'), 'the xmtr upset target was not derived');
    assert.ok(keys.has('FIC211.PVLO') && why['FIC211.PVLO'].startsWith('phase set'), 'the FEED-only monomer flow low alarm was not derived from the phase sets');
  });

  await t.test('EVERY condition the runtime can raise has authored alarm help', () => {
    const missing = [...keys].filter((k) => !authored.has(k)).sort();
    assert.deepEqual(missing, [],
      'unauthored conditions (resolve() would return the generic fallback):\n' +
      missing.map((k) => `  ${k}  <- ${why[k]}`).join('\n'));
    // and resolved through the app, none of them is the fallback
    for (const k of keys) {
      const [tag, cond] = k.split('.');
      assert.equal(c.alarmHelpFor(tag, cond).found, true, k);
    }
  });

  await t.test('EVERY authored key is a condition the runtime can raise (no orphaned prose)', () => {
    const orphans = [...authored].filter((k) => !keys.has(k)).sort();
    assert.deepEqual(orphans, [],
      'alarm-help entries for conditions nothing raises (stale prose, or a tag that was ' +
      'removed or renamed):\n  ' + orphans.join('\n  '));
  });

  await t.test('every EQUIPMENT_TRIPS entry is raised by the model at that value', () => {
    const raised = new Map();
    for (const m of MODELS.matchAll(/raiseTrip\(ctx,\s*'([^']+)',\s*'([^']+)'/g)) raised.set(m[1] + '.' + m[2], true);
    for (const m of PAGE.matchAll(/raiseA\('(H-310)',\s*'(TUBE SKIN TRIP)'/g)) raised.set(m[1] + '.' + m[2], true);
    for (const k of Object.keys(AlarmHelp.EQUIPMENT_TRIPS)) assert.ok(raised.has(k), `${k} is declared as an equipment trip but nothing raises it`);
    for (const k of raised.keys()) assert.ok(AlarmHelp.EQUIPMENT_TRIPS[k], `${k} is raised but has no EQUIPMENT_TRIPS setting`);
  });

  await t.test('coverage is reported as a ratio so a reviewer sees the surface, not just green', () => {
    const covered = [...keys].filter((k) => authored.has(k)).length;
    assert.equal(covered, keys.size);
    assert.equal(authored.size, keys.size, `${authored.size} authored vs ${keys.size} raisable`);
  });
});
