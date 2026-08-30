// @artifact dev
// S0 golden baseline: the deterministic invariant the whole v3 replay feature rests on
// (docs/dev/V3-PLAN.md section 10, addendum sections B and C.4):
//
//   given the same ESS.MODEL_ID, initial snapshot, PRNG state, fixed step sequence and
//   ordered command journal, the simulator produces the same scored outcome and materially
//   identical state trajectory.
//
// Unlike the drill/upset golden suites, these tests do not freeze a specific behaviour
// into a hardcoded constant -- they prove the INVARIANTS the goldens depend on: that two
// independently-constructed runs of the same commands agree, that a different seed
// disagrees, and that nothing in the core ever falls through to unseeded Math.random.
//
// VERIFIER NOTE (S0 adversarial pass): "fixed step sequence" above is load-bearing in a
// way worth spelling out for whoever builds S4 replay. Each c.step(dt) call draws a FIXED
// number of rand() samples regardless of dt's size (measured: step(0.5) and step(0.25)
// both consume exactly 23 draws) -- noise is metered per STEP, not per simulated second.
// Consequence, verified directly: two runs reaching the identical simulated time (300s)
// via dt=0.5 vs dt=0.25 produce DIFFERENT digests and a different alarm sequence, even
// same seed, same commands, same total time. This is not a bug -- it is exactly what
// "fixed step sequence" already promises, and every test below holds dt fixed and equal
// between the two sides of each comparison -- but a future replay engine that reconstructs
// step(dt) calls from recorded command timestamps (rather than replaying the exact
// recorded dt sequence) will NOT reproduce these digests. Flag for S4.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newSim, run, endState, alarmSequence, digest } = require('./_fixture');

// A scenario that both settles the process and consumes randomness on every step (every PV
// in endState carries per-step seeded measurement noise -- see _fixture.js endState comment
// and models.js noiseFn), then exercises the instructor upset path so drift/trip logic (which
// reads P.t - P.faultT.*) is on the trajectory too. 600 simulated seconds comfortably clears
// the 'surge' upset's own 480 s auto-clear window (models.js stepU1/feedDisturbance), so the
// manual setUpset(false) below -- not the model's internal timeout -- is what ends it.
function scenario(c) {
  run(c, 300);
  c.setUpset('surge', true);
  run(c, 200);
  c.setUpset('surge', false);
  run(c, 100);
}

test('1. repeatability: same seed and step sequence on two independent Components yields identical digests', () => {
  const c1 = newSim({ seed: 20260829 });
  const c2 = newSim({ seed: 20260829 });
  assert.notEqual(c1, c2, 'two independently constructed Components');
  scenario(c1);
  scenario(c2);
  assert.equal(digest(endState(c1)), digest(endState(c2)), 'identical end-state digests for identical seed + commands');
  assert.deepEqual(alarmSequence(c1), alarmSequence(c2), 'identical alarm arrival order too');
});

test('2. clock-origin invariance: two very different wall-clock origins for P.t give identical trajectories', () => {
  // newSim({now}) pins the value Date.now() returns during initSim, which seeds P.t (app
  // "const now = Date.now()"). Addendum section B: every dynamical use of P.t in
  // src/models.js is a DIFFERENCE against a fault timestamp itself taken from P.t (lines
  // 236/281/309/327), so the origin should cancel. This test makes that an assertion, not
  // an assumption -- one origin is epoch-adjacent, the other is a realistic 2023 timestamp.
  const c1 = newSim({ seed: 20260829, now: 1 });
  const c2 = newSim({ seed: 20260829, now: 1_700_000_000_000 });
  scenario(c1);
  scenario(c2);
  assert.notEqual(c1.P.t, c2.P.t, 'sanity check: the origins really do differ (' + c1.P.t + ' vs ' + c2.P.t + ')');
  assert.equal(digest(endState(c1)), digest(endState(c2)), 'end-state digest does not depend on the wall-clock origin');
  assert.deepEqual(alarmSequence(c1), alarmSequence(c2));
});

test('3. seed sensitivity: a different seed changes the digest for a scenario that consumes randomness', () => {
  // Guards tests 1 and 2 against a sim that silently ignores the seed. measureU1/U2/U3 draw
  // measurement noise from ctx.rand() every step (models.js noiseFn), so even the plain
  // baseline -- no upsets at all -- consumes the generator; 60 s is enough to diverge
  // (measured). TRAP avoided: seed 0 coerces to DEFAULT_SEED in setSeed
  // ("(Number(n)>>>0)||DEFAULT_SEED"), so it would silently equal the default seed below and
  // make this test pass for the wrong reason. Both seeds here are nonzero and distinct.
  const c1 = newSim({ seed: 20260829 });
  const c2 = newSim({ seed: 12345 });
  run(c1, 60);
  run(c2, 60);
  assert.notEqual(digest(endState(c1)), digest(endState(c2)), 'a different seed must move the digest');
  // Both runs are quiet at 60 s (0 alarms either way), so alarmSequence alone would not show
  // the divergence -- the noise draws still land on a point value, which the digest above
  // captures. Made concrete here so a reader can see WHAT moved without decoding a hash.
  assert.notEqual(c1.L.LIC101.pv, c2.L.LIC101.pv, 'the seeded measurement noise on LIC101 differs between seeds');
});

test('4. unseeded-random guard: a fully seeded run never falls through to Math.random', () => {
  // src/models.js:202 and the app's modelCtx().rand() both fall back to Math.random when
  // ctx.rand/this.rand is absent (addendum section C.4, "the loaded gun"). The app always
  // seeds in practice, so this must be provably unreached. A COUNTING stub, not a throwing
  // one (advisory trap): node internals or the test runner may call Math.random for reasons
  // unrelated to this run, and a throw mid-step would leave a half-stepped Component: the
  // assertion below on the exact count is the real check, not the presence of a throw.
  const orig = Math.random;
  let count = 0;
  Math.random = (...args) => { count += 1; return orig.apply(Math, args); };
  let c;
  try {
    c = newSim({ seed: 20260829 });
    run(c, 300);                        // plain seeded run: per-step measurement noise only
    c.startDrill(c.drillDefs()[0]);      // the injection-delay draw (startDrill: this.modelCtx().rand())
    run(c, 20);
    c.setUpset('surge', true);           // the instructor upset path
    run(c, 20);
  } finally {
    Math.random = orig;                 // restored unconditionally so no later test/tooling sees the stub
  }
  assert.equal(count, 0, 'Math.random must not be called during a fully seeded run + drill start + upset injection');
});

test('4b. the guard above is not vacuous: forcing the unseeded fallback path is actually detected', () => {
  // Proves the previous test would fail on a real regression rather than passing by
  // construction. Forcing this.rand away leaves the app's own fallback
  // ("rand:()=>this.rand?this.rand():Math.random()") as the only path.
  const orig = Math.random;
  let count = 0;
  Math.random = (...args) => { count += 1; return orig.apply(Math, args); };
  try {
    const c = newSim({ seed: 20260829 });
    c.rand = null;
    run(c, 2);
  } finally {
    Math.random = orig;
  }
  assert.ok(count > 0, 'forcing the fallback path must be observable through the same guard mechanism');
});

test('5. snapshot round-trip: restoring the same snapshot and replaying identical commands reproduces identical state', () => {
  // 120 s settle before the snapshot -- long enough that the baseline noise has run through
  // every point at least once, short enough to keep the test fast; no fault timer is crossed
  // here (nothing is injected yet), so the exact duration is not load-bearing.
  const c = newSim({ seed: 20260829 });
  run(c, 120);
  const snap = c.snapshotData('determinism-s0-base');
  assert.ok(snap, 'a finite process state produces an acceptable snapshot');

  const commands = (sim) => {
    run(sim, 30);
    sim.setUpset('surge', true);   // no auth gate: setUpset is not security-checked (only display nav is)
    run(sim, 90);
    sim.setUpset('surge', false);
    run(sim, 60);
  };

  // Two independent restore-and-replay passes from the SAME base snapshot and the SAME
  // command list, on the same Component instance (state.sec is therefore identical across
  // both halves by construction, per the advisory).
  c.restoreSnapshot(snap, 'determinism S0 restore A');
  commands(c);
  const stateA = endState(c);
  const alarmsA = alarmSequence(c);
  const eventsA = c.events.length;

  c.restoreSnapshot(snap, 'determinism S0 restore B');
  commands(c);
  const stateB = endState(c);
  const alarmsB = alarmSequence(c);
  const eventsB = c.events.length;

  // The behavioural trajectory -- points, valves, alarm records, uptime -- must be bit-
  // identical. Compared as a sub-digest deliberately excluding counts.events; see the FINDING
  // below for why a raw digest(endState(...)) over the whole object is the wrong tool here.
  const behaviour = (s) => ({ points: s.points, valves: s.valves, alarms: s.alarms, up: s.up });
  assert.equal(digest(behaviour(stateA)), digest(behaviour(stateB)),
    'process/valve/alarm state after restore+replay must not depend on how many times the base snapshot was restored');
  assert.deepEqual(alarmsA, alarmsB, 'alarm arrival order reproduced identically');

  // FINDING, pinned down rather than papered over: restoreSnapshot's event-log truncation
  // ("this.events = this.events.filter(e => e.t <= t)", app ~L2283) is boundary-INCLUSIVE.
  // The restore's own "SNAPSHOT RESTORED" bookkeeping line is appended via instrLog()
  // immediately afterward at exactly P.t === t, so a second restore to that same instant
  // filters with "e.t <= t" again and the earlier restore's bookkeeping line survives (it is
  // not later than t, it is exactly t) while a new one is appended. Each restore to the same
  // point therefore leaves one MORE bookkeeping event than the last, purely from logging --
  // no process, alarm or replay-relevant state is affected (proven above). Left as a passing,
  // explicit assertion so it reads as documented behaviour, not a flake:
  assert.equal(eventsB, eventsA + 1,
    'known artifact: each additional restore to the same snapshot leaves one more "SNAPSHOT RESTORED" bookkeeping event than the last (see report)');
});
