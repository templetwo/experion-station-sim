// @artifact dev
// Shared fixture helpers for the S0 golden baseline (docs/dev/V3-PLAN.md sections 9, 10).
//
// The deterministic invariant these support, verbatim from the plan: given the same
// ESS.MODEL_ID, initial snapshot, PRNG state, fixed step sequence and ordered command
// journal, the simulator produces the same scored outcome and materially identical
// state trajectory.
//
// A golden asserts a DIGEST, never the MODEL_ID. The MODEL_ID is recorded alongside it
// as provenance, so that when a digest does change a reader can tell "the model build
// changed" from "behaviour changed under the same build" -- the second is a regression,
// the first is a decision someone made.
//
// Not a test file: `node --test tests/*.test.js` does not pick up a name without .test.
const crypto = require('node:crypto');
const path = require('node:path');
const { load } = require('../tools/logic-harness');

const DP = 6; // decimal places every float is rounded to before hashing

/** Round floats so a digest is not hostage to the last bit of a double. */
function round(v) {
  if (typeof v !== 'number' || !isFinite(v)) return v;
  const f = Math.pow(10, DP);
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Canonical JSON: keys sorted at every level, floats rounded, undefined dropped. */
function canon(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(round(value)) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
  const keys = Object.keys(value).filter(k => value[k] !== undefined && typeof value[k] !== 'function').sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(value[k])).join(',') + '}';
}

function digest(value) {
  return crypto.createHash('sha256').update(canon(value)).digest('hex');
}

function modelId() {
  return require('../src/model-id.js');
}

/**
 * A fresh simulator at a known seed.
 * `now` is the wall-clock origin P.t is seeded from; it must not affect any trajectory
 * (V3-PLAN addendum section B), which is exactly what the clock-origin test asserts.
 */
function newSim({ seed = 20260829, now = 1_700_000_000_000 } = {}) {
  const { Component } = load();
  const c = new Component({});
  if (c.instr) c.instr.seed = seed;
  const realNow = Date.now;
  try {
    Date.now = () => now;          // pin the origin so a fixture is reproducible
    c.initSim();
  } finally {
    Date.now = realNow;
  }
  if (c.setSeed) { try { c.setSeed(String(seed)); } catch { /* pre-auth gate; seed already set */ } }
  return c;
}

/** Step `seconds` of simulated time at a fixed dt. Never uses a timer. */
function run(c, seconds, dt = 0.5) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) c.step(dt);
  return c;
}

/**
 * The observable trajectory endpoint: what a regression would move.
 * Deliberately excludes wall-clock fields (P.t origin, event timestamps) so a golden
 * survives being captured on a different day -- it is a behaviour digest, not a clock digest.
 */
function endState(c) {
  const points = {};
  for (const tag of Object.keys(c.L).sort()) {
    const l = c.L[tag];
    points[tag] = {
      pv: round(l.pv), sp: round(l.sp), op: round(l.op),
      mode: l.mode, modeAttr: l.modeAttr, badPv: !!l.badPv,
      run: l.run === undefined ? null : !!l.run, trip: !!l.trip,
    };
  }
  const valves = {};
  for (const v of Object.keys(c.V).sort()) {
    valves[v] = { pos: round(c.V[v].pos), stuck: !!c.V[v].stuck };
  }
  const alarms = (c.alarms || [])
    .map(a => ({ tag: a.tag || a.src, cond: a.cond, prio: a.prio, state: a.state, active: !!a.active }))
    .sort((x, y) => canon(x).localeCompare(canon(y)));
  return {
    points, valves, alarms,
    up: round(c.P.up),
    counts: { alarms: (c.alarms || []).length, events: (c.events || []).length },
  };
}

/** The alarm arrival ORDER, which endState's sorted set deliberately throws away. */
function alarmSequence(c) {
  return (c.alarms || []).map(a => `${a.tag || a.src}:${a.cond}:${a.prio}`);
}

/**
 * Record a fixture in the plan's shape (V3-PLAN section 10). `model` is provenance;
 * `endStateDigest` is the assertion.
 */
function fixture(name, { seed, seconds, c, extra = {} }) {
  return {
    fixture: name,
    model: modelId(),
    seed,
    seconds,
    endStateDigest: digest(endState(c)),
    alarmSequenceDigest: digest(alarmSequence(c)),
    ...extra,
  };
}

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

module.exports = {
  canon, digest, round, modelId,
  newSim, run, endState, alarmSequence, fixture,
  FIXTURE_DIR, DP,
};
