// @artifact dev
// Golden baseline for Unit 04, the two-chamber weir separator, captured the day it was built
// (2026-09-03) under the same two-independent-constructions protocol as the S0 goldens
// (tests/golden-upsets.test.js). Unit 04 is OUTSIDE the v2 golden universe (tests/_fixture.js
// NEW_UNIT_SOURCES), so this file is where its behaviour is frozen: the end state of its own
// process variables, points, valves and alarms for five scenarios. UPDATE_GOLDENS=1 re-captures,
// never the default path, and only after the two runs above have agreed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newSim, run, digest, round, canon, modelId } = require('./_fixture');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'u4');
const UPDATE = process.env.UPDATE_GOLDENS === '1';
const SEED = 20260829;
const U4_TAGS = ['TIC502', 'LIC503', 'LIC504', 'PIC505', 'AI509', 'AI510'];
const U4_VALVES = ['TV502', 'LV503', 'WV504', 'PV505'];
const U4_SOURCES = new Set([...U4_TAGS, 'V-502', 'E-502']);

function u4State(c) {
  const points = {};
  for (const t of U4_TAGS) { const l = c.L[t]; points[t] = { pv: round(l.pv), sp: round(l.sp), op: round(l.op), mode: l.mode, badPv: !!l.badPv }; }
  const valves = {};
  for (const v of U4_VALVES) valves[v] = { pos: round(c.V[v].pos), stuck: !!c.V[v].stuck, fail: c.V[v].fail };
  const s = {}; for (const k of Object.keys(c.P.s).sort()) s[k] = round(c.P.s[k]);
  const alarms = (c.alarms || []).filter((a) => U4_SOURCES.has(a.tag || a.src))
    .map((a) => ({ tag: a.tag || a.src, cond: a.cond, prio: a.prio, state: a.state, active: !!a.active }))
    .sort((x, y) => (canon(x) < canon(y) ? -1 : canon(x) > canon(y) ? 1 : 0));
  return { s, points, valves, alarms, weirH: c.P.env.weirH, psv: !!c.P.trips.psv502, rand4: c.rand4.getState() };
}
function u4AlarmSeq(c) { return (c.alarms || []).filter((a) => U4_SOURCES.has(a.tag || a.src)).map((a) => `${a.tag || a.src}:${a.cond}:${a.prio}`); }

// Each scenario starts from the settled U1_SS initial condition (all four units at design).
const SCENARIOS = [
  { key: 'design', seconds: 1800, act: () => {} },
  { key: 'weir-raised', seconds: 1500, act: (c) => c.setVariable('weirH', 70) },
  { key: 'interface-high', seconds: 2400, act: (c) => { c.setMode('LIC504', 'MAN'); c.storeEntry('LIC504', 'OP', 0); } },
  { key: 'air-loss', seconds: 600, act: (c) => c.setUpset('air', true) },
  { key: 'vent-closed-psv', seconds: 3600, act: (c) => { c.setMode('PIC505', 'MAN'); c.storeEntry('PIC505', 'OP', 0); } },
];

function build(sc) {
  const c = newSim({ seed: SEED });
  c.applyPreset('U1_SS');
  sc.act(c);
  run(c, sc.seconds);
  return c;
}
function record(sc, c) {
  return { fixture: `u4-${sc.key}`, model: modelId(), seed: SEED, seconds: sc.seconds,
    endStateDigest: digest(u4State(c)), alarmSequenceDigest: digest(u4AlarmSeq(c)),
    alarmSeq: u4AlarmSeq(c), state: u4State(c) };
}
function fixturePath(key) { return path.join(FIXTURE_DIR, `u4-${key}.json`); }

for (const sc of SCENARIOS) {
  test(`golden U4: ${sc.key} (+${sc.seconds}s)`, () => {
    const r1 = record(sc, build(sc));
    const r2 = record(sc, build(sc));
    assert.equal(r1.endStateDigest, r2.endStateDigest, `${sc.key}: two independently constructed sims disagree -- nondeterminism, report don't loosen`);
    assert.deepEqual(r1.alarmSeq, r2.alarmSeq);
    if (UPDATE) {
      fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      fs.writeFileSync(fixturePath(sc.key), JSON.stringify({ '//': '@artifact dev (Unit 04 golden fixture; see tests/golden-u4.test.js)', ...r1 }, null, 2) + '\n');
    }
    assert.ok(fs.existsSync(fixturePath(sc.key)), `missing committed fixture ${fixturePath(sc.key)} -- capture with UPDATE_GOLDENS=1 after the two runs agree`);
    const golden = JSON.parse(fs.readFileSync(fixturePath(sc.key), 'utf8'));
    assert.equal(r1.endStateDigest, golden.endStateDigest, `${sc.key}: Unit 04 end-state behaviour changed since capture`);
    assert.deepEqual(r1.alarmSeq, golden.alarmSeq, `${sc.key}: Unit 04 alarm sequence`);
    assert.deepEqual(r1.state.s, golden.state.s, `${sc.key}: Unit 04 process state (readable)`);
  });
}

test('the scenarios mean what they say', () => {
  const design = build(SCENARIOS[0]);
  assert.equal(u4AlarmSeq(design).length, 0, 'design point raises no Unit 04 alarm');
  const psv = build(SCENARIOS[4]);
  assert.ok(u4AlarmSeq(psv).some((a) => a.startsWith('V-502:PSV LIFT')), 'the vent-closed scenario reaches the PSV');
  const air = build(SCENARIOS[3]);
  assert.ok(air.V.PV505.pos > 0.99 && air.V.LV503.pos < 0.01, 'air loss reached the fail positions');
});
