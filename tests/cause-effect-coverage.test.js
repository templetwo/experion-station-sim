// @artifact dev
// tests/cause-effect-coverage.test.js -- the W2 PROMOTION GATE
// (docs/dev/W2-CAUSE-EFFECT-CONTRACT.md §5, third file, and §0.1).
//
// THIS TEST PASSING, CLEAN, IS THE PRECONDITION FOR FLIPPING
// `ESS.CauseEffect.CHART_VISIBILITY` FROM 'instructor' TO 'operator'. In as many words: the
// cause-and-effect chart must not be shown to a trainee as something verified against the code
// until every row on it has actually been checked against the code, at least once, by a real run.
// Until that flip, nothing here changes what an operator sees; this file only earns the right to
// make that one-word change later.
//
// Six causes reach the `ctx.onTrip` seam (src/models.js:294-297 and its six call sites); the
// seventh (H310_SKIN) is raised by the app's own interlocks() and never reaches that seam
// (contract §0.3) -- it is out of scope for this file by design, not by oversight.
//
// FOUR of the six are reachable through the golden fixtures already committed under
// tests/fixtures/ (contract §0.1's own table): TK101_HIHI (drill-D3 / upset-pump), R201_HITEMP
// (drill-D4 / upset-cool), R310_HITEMP (drill-D12 / upset-bedact), V502_PSV (tests/golden-u4.test.js's
// own vent-closed-psv scenario). This file drives the upset-flavoured trio directly (settle, inject,
// run -- the exact shape tests/golden-upsets.test.js uses) and the U4 scenario via the exact
// instructor actions tests/golden-u4.test.js uses (PIC505 to MAN, OP 0), rather than requiring
// those dev-only test files as modules.
//
// TWO of the six -- V401_PSV and R202_HITEMP -- are fired by NO fixture anywhere in this repo.
// Independently verified against every fixture under tests/fixtures/ (contract §0.1): drill-D9
// (flash-drum pressure) and drill-D11 (agitator trip during semi-batch feed) are the two drills
// that plausibly should reach these rows, and both complete with `"trips": {}` -- "trip avoided",
// by design, within their own 12-minute drill window. A chart promoted on the golden set alone
// would carry these two rows never once checked against the code -- exactly the failure this gate
// exists to prevent. So this file adds TWO AUTHORED, ASSERTION-COVERAGE SCRIPTS below (clearly
// marked `source: 'AUTHORED SCRIPT'` in SCENARIOS) that drive the plant past each threshold using
// only instructor-level actions (mode transfers, OP stores, the existing 'vap' upset, seqCmd)
// exactly as an instructor legitimately could -- never by reaching into P and hand-setting a
// value. These are explicitly NOT goldens: no fixture is added under tests/fixtures/, nothing is
// captured, and UPDATE_GOLDENS has no effect on this file. Their only job is to prove the code and
// MATRIX agree at these two rows at least once; a future stage is free to promote either into a
// real drill or upset without touching this file.
//
// THE MECHANICAL QUESTION: how does a test OBSERVE `ctx.onTrip` without touching
// "Experion Station Simulator.dc.html" (forbidden to this file -- single writer, active now) or
// either harness file (tools/logic-harness.js, tests/_fixture.js -- also not to be edited here)?
//
// As of this checkpoint (0bbfd13 plus the untracked src/cause-effect.js this file depends on),
// dc.html's onTrip callback is still the pre-W2 line:
//   onTrip:(src,cond)=>this.dTrip(src,cond),
// It is NOT YET chained to a `this.ceRecorder` the way the contract's §3 proposes -- that edit is
// a different file's mandate, not this one's, and had not landed in this working tree as this file
// was written. So this file does not depend on that edit ever landing: it reaches the exact same
// seam a different way, without editing anything.
//
// `modelCtx()` (dc.html:2741-2755) is memoised on `this._ctx` and returned by reference on every
// call after the first; `onTrip` is a plain, reassignable property of that same object. So
// `c.modelCtx().onTrip` IS the live seam -- reassigning it here observes every trip exactly where
// the contract's own proposed chain would, in the same order (dTrip fires first, unconditionally;
// the observation is additive), without a single byte of dc.html changing. This is the "most
// faithful alternative" the contract's §5/mechanical-question framing invites when the app-side
// chaining edit is not (yet) in the tree.
//
// ONE SHARP EDGE, found by running this and reported here rather than papering over: `_ctx` is
// nulled by `restoreSnapshot()` (dc.html:3353), which `applyPreset()` calls internally. A wrapper
// attached BEFORE an `applyPreset()` call is silently discarded -- the next `modelCtx()` call (the
// very next `step()`) lazily builds a fresh ctx object with the original, unwrapped `onTrip`, and
// every trip after that point goes unobserved with no error raised anywhere. Verified directly:
// attaching before `applyPreset('U1_SS')` in the V-401 and V-502 scenarios below produced zero
// observed events even though the fixtures/models plainly do trip. The rule this file follows,
// and every scenario below is written to respect: attach AFTER the last `applyPreset()` /
// `restoreSnapshot()` in a scenario's setup, never before.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CauseEffect = require('../src/cause-effect.js');
const { newSim, run } = require('./_fixture');

const SEED = 20260829;

// ---------------------------------------------------------------- variable-path / comparator

/** Resolve a matrix row's `variable` ('tankL', 'b.T', 'h.bed', 's.pres', ...) against a live P. */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Did `value` actually satisfy the row's own declared comparator/threshold? */
function crosses(row, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (row.comparator === '>=') return value >= row.threshold;
  if (row.comparator === '>') return value > row.threshold;
  throw new Error(`cause-effect-coverage: unhandled comparator "${row.comparator}" on row ${row.id}`);
}

const ONTRIP_ROWS = CauseEffect.causes().filter((r) => r.seam === 'onTrip');
const ROW_BY_KEY = new Map(ONTRIP_ROWS.map((r) => [`${r.src}|${r.cond}`, r]));

test('sanity: MATRIX declares exactly six onTrip-seam rows (contract §0.3)', () => {
  assert.equal(ONTRIP_ROWS.length, 6);
  assert.equal(CauseEffect.causes().length, 7, 'seven causes total -- the six onTrip rows plus H310_SKIN (seam:\'app\')');
});

// ---------------------------------------------------------------- the seam observer
//
// See the file header for what this does and why it is the honest alternative to editing
// dc.html. `recorder` is a real `ESS.CauseEffect.createRecorder()` -- the same object `verify()`
// is built to consume -- fed exactly what the contract's proposed onTrip chain would feed it.
// `events` additionally carries, per observation, the live value of the matrix row's own declared
// `variable` at the instant of the trip, so a caller can check the threshold was actually crossed,
// not merely that some (src, cond) pair arrived.
function attachSeamObserver(c) {
  const recorder = CauseEffect.createRecorder();
  const events = [];
  const ctx = c.modelCtx(); // MUST run after this scenario's last applyPreset()/restoreSnapshot()
  const originalOnTrip = ctx.onTrip;
  ctx.onTrip = (src, cond) => {
    // dTrip first, unconditionally -- the contract's own ordering (§3); today that call is the
    // ENTIRE original callback, so this is a strict addition, not a behavior change.
    const result = originalOnTrip(src, cond);
    const t = c.P.t;
    recorder.observe(src, cond, t);
    const row = ROW_BY_KEY.get(`${src}|${cond}`);
    events.push({ src, cond, t, rowId: row ? row.id : null, value: row ? getPath(c.P, row.variable) : undefined });
    return result;
  };
  return { recorder, events };
}

// ---------------------------------------------------------------- the six scenarios
//
// Each `build()` returns { recorder, events, ...meta }. None of the six mutates P/L directly --
// every action below is a real instructor/operator-level call (setUpset, setMode, storeEntry,
// seqCmd) exactly as tests/golden-upsets.test.js, tests/golden-u4.test.js and the app's own
// instructor surface use them.

const SCENARIOS = [
  {
    rowId: 'TK101_HIHI',
    label: 'TK-101 HIHI TRIP',
    source: 'golden (upset-pump)',
    build() {
      const c = newSim({ seed: SEED });
      const obs = attachSeamObserver(c);
      run(c, 120); // settle, matching tests/golden-upsets.test.js's SETTLE
      c.setUpset('pump', true); // one-shot pump trip -> unpumped, overflowing feed tank
      run(c, 600); // matches the 'pump' golden scenario's own window
      return obs;
    },
  },
  {
    rowId: 'R201_HITEMP',
    label: 'R-201 HI TEMP TRIP',
    source: 'golden (upset-cool)',
    build() {
      const c = newSim({ seed: SEED });
      const obs = attachSeamObserver(c);
      run(c, 120);
      c.setUpset('cool', true); // cooling loss -> exotherm runs away toward the trip
      run(c, 400); // matches the 'cool' golden scenario's own window
      return obs;
    },
  },
  {
    rowId: 'R310_HITEMP',
    label: 'R-310 HI TEMP TRIP',
    source: 'golden (upset-bedact)',
    build() {
      const c = newSim({ seed: SEED });
      const obs = attachSeamObserver(c);
      run(c, 120);
      c.setUpset('bedact', true); // catalyst activity surge -> bed overtemp
      run(c, 600); // matches the 'bedact' golden scenario's own window
      return obs;
    },
  },
  {
    rowId: 'V502_PSV',
    label: 'V-502 PSV LIFT',
    source: 'golden (tests/golden-u4.test.js vent-closed-psv)',
    build() {
      const c = newSim({ seed: SEED });
      c.applyPreset('U1_SS'); // matches tests/golden-u4.test.js's own starting condition
      const obs = attachSeamObserver(c); // AFTER applyPreset -- see header comment
      c.setMode('PIC505', 'MAN');
      c.storeEntry('PIC505', 'OP', 0); // vent held shut, exactly as the u4 golden scenario does
      run(c, 900);
      return obs;
    },
  },
  {
    rowId: 'V401_PSV',
    label: 'V-401 PSV LIFT',
    source: "AUTHORED SCRIPT (contract §0.1) -- no fixture anywhere fires this row",
    build() {
      const c = newSim({ seed: SEED });
      c.applyPreset('U1_SS');
      const obs = attachSeamObserver(c); // AFTER applyPreset -- see header comment
      // Close the flash drum's own outlet (PIC401's vent, src/models.js exchangerAndDrum) the
      // same way drill-D9's setup leaves it in MAN -- but here BY THIS SCRIPT, at OP 0 (fully
      // shut, not "wherever it happened to be"), and combined with the same 'vap' vapour-surge
      // upset drill-D9 injects, so the drum reaches its 950 kPa PSV set inside a bounded window
      // instead of the drill's own 12-minute cap running out first (contract §0.1: D9 itself
      // records "trips": {}).
      c.setMode('PIC401', 'MAN');
      c.storeEntry('PIC401', 'OP', 0);
      c.setUpset('vap', true);
      run(c, 400);
      return obs;
    },
  },
  {
    rowId: 'R202_HITEMP',
    label: 'R-202 HI TEMP TRIP',
    source: "AUTHORED SCRIPT (contract §0.1) -- no fixture anywhere fires this row",
    build() {
      const c = newSim({ seed: SEED });
      const obs = attachSeamObserver(c);
      c.seqCmd('START', true); // push the batch through its own sequence: CHARGE -> HEATUP -> FEED -> REACT -> ...
      let coolingKilled = false;
      const CAP = 6000; // 3000 simulated seconds -- generous; the actual run trips in ~90 s of REACT
      let i = 0;
      for (; i < CAP; i++) {
        c.step(0.5);
        if (!coolingKilled && c.P.b.phase === 'REACT') {
          // Once the batch is genuinely reacting, take BOTH cooling paths away with one
          // instructor action: TIC213 to MAN at OP 100 drives the tempered-water jacket supply
          // to its warmest mix (medMin + medSpan*pos, src/models.js:504) AND collapses the
          // external heat exchanger's own demand to zero at that same valve position
          // (eheDemand = clamp((eheOpen-pos)/eheOpen,0,1), src/models.js:508 -- eheOpen=0.35,
          // pos=1 clamps negative to 0). This is a real MAN/OP-store action, not a hand-set P
          // field -- the same kind of move an instructor makes on any other loop in this repo.
          c.setMode('TIC213', 'MAN');
          c.storeEntry('TIC213', 'OP', 100);
          coolingKilled = true;
        }
        if (obs.events.some((e) => e.rowId === 'R202_HITEMP')) break;
      }
      return { ...obs, steps: i, coolingKilled, reachedCap: i >= CAP };
    },
  },
];

assert.equal(SCENARIOS.length, 6, 'one scenario per onTrip-seam row');
assert.deepEqual(
  SCENARIOS.map((s) => s.rowId).sort(),
  ONTRIP_ROWS.map((r) => r.id).sort(),
  'SCENARIOS must cover exactly the six onTrip-seam rows MATRIX declares -- no more, no fewer'
);

// Built once, at module scope, so the per-row tests below and the final gate see the SAME run --
// not six-then-six-again. Each `build()` is a fresh newSim(); nothing here shares simulator state
// across scenarios.
const RESULTS = SCENARIOS.map((sc) => ({ ...sc, ...sc.build() }));

// ---------------------------------------------------------------- per-row tests

for (const r of RESULTS) {
  test(`onTrip seam fires ${r.label} (${r.source}), matching MATRIX row ${r.rowId}`, () => {
    const row = ONTRIP_ROWS.find((x) => x.id === r.rowId);
    assert.ok(row, `no onTrip-seam row ${r.rowId} declared in MATRIX.causes`);

    if (r.rowId === 'R202_HITEMP') {
      assert.ok(r.coolingKilled, 'R-202 authored script: never reached REACT phase to remove cooling');
      assert.ok(!r.reachedCap, `R-202 authored script: never reached its trip inside ${r.steps} steps`);
    }

    const hits = r.events.filter((e) => e.rowId === r.rowId);
    assert.ok(hits.length > 0, `${r.label}: the onTrip seam never fired for this row -- unreached`);

    for (const hit of hits) {
      assert.equal(hit.src, row.src, `${r.label}: fired src did not match the matrix row`);
      assert.equal(hit.cond, row.cond, `${r.label}: fired cond did not match the matrix row`);
      assert.ok(
        crosses(row, hit.value),
        `${r.label}: fired with ${row.variable}=${hit.value}, which does not satisfy ` +
          `${row.comparator} ${row.threshold} ${row.eu} at t=${hit.t} -- code and matrix disagree`
      );
    }

    // Nothing else fired at the seam in this scenario that the matrix cannot account for.
    const undeclared = r.events.filter((e) => e.rowId === null);
    assert.deepEqual(undeclared, [], `${r.label}: an onTrip-seam event fired with no matching MATRIX row`);
  });
}

// ---------------------------------------------------------------- the promotion gate itself

test('PROMOTION GATE: all six onTrip-seam rows verify() clean, tick-for-tick, across four golden scenarios plus two authored scripts', () => {
  const combinedSeen = [];
  const reachedRowIds = new Set();
  for (const r of RESULTS) {
    combinedSeen.push(...r.recorder.seen());
    for (const e of r.events) if (e.rowId) reachedRowIds.add(e.rowId);
  }

  const result = CauseEffect.verify(combinedSeen);
  assert.deepEqual(
    result.findings, [],
    `verify() reported findings -- code and MATRIX disagree: ${JSON.stringify(result.findings, null, 2)}`
  );
  assert.equal(result.ok, true);

  const expectedIds = ONTRIP_ROWS.map((r) => r.id).sort();
  assert.deepEqual(
    [...reachedRowIds].sort(), expectedIds,
    'every declared onTrip-seam row must be reached by this file -- an unreached row is exactly ' +
      'the gap this promotion gate exists to close (contract §0.1)'
  );

  // Every threshold crossing, once more, over the combined log -- the tick-for-tick half of the
  // gate: not just "the six rows all appeared somewhere", but that at the SAME tick each row's
  // own declared variable actually satisfied its own declared comparator/threshold.
  for (const r of RESULTS) {
    const row = ONTRIP_ROWS.find((x) => x.id === r.rowId);
    for (const hit of r.events.filter((e) => e.rowId === r.rowId)) {
      assert.ok(crosses(row, hit.value), `${r.label}: threshold not actually crossed at t=${hit.t}`);
    }
  }
});

// ---------------------------------------------------------------- flag posture (contract §4)
//
// This file does not flip CHART_VISIBILITY -- that is a human decision the contract reserves for
// once this file is seen to pass clean. It only asserts the flag's starting posture, so a change
// to that one line is a deliberate, visible diff and not a silent side effect of this file.
test('CHART_VISIBILITY starts \'instructor\' -- this file passing is what earns the flip, not this file itself', () => {
  assert.equal(CauseEffect.CHART_VISIBILITY, 'instructor');
});
