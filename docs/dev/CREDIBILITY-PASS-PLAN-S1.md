<!-- @artifact dev -->
# Credibility Pass, Stage S1 (the two seams) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land spec sections 2 and 3 of the credibility pass: every operator-facing value is the observed transmitter value and the loops act on it (D7, D14), and one output-tracking facility makes a loop's output honest when its pump is stopped or an interlock holds its valve (D1, D8, D9, D10), with regression tests, re-captured goldens and a changelog entry.

**Architecture:** The measurement module's TIC202 special case becomes a declared range policy for every analog point; plant-core writes an observed value `pvObs` per point each tick, which the PID module, the alarm scan, the trends and the page read, while the model equations keep the raw `pv`. The PID module gains `setTracking` / `clearTracking`; plant-core derives the tracking set once per tick from the same trip flags `VALVE_TARGET` enforces, and the page shows one flag beside the mode line. No model equation changes; no threshold changes.

**Tech Stack:** Plain ES5-style UMD scripts under `src/`, the single `.dc.html` page, node 22's built-in test runner with `node:assert/strict`, `tools/logic-harness.js` for app-level tests, `python3 tools/build-dist.py` (which stamps `src/model-id.js`), `tools/smoke.sh`. Zero dependencies.

**Spec:** `docs/dev/CREDIBILITY-PASS-SPEC.md` (sections 2, 3, 9.1, 11, 12 and Appendix A for D1, D7, D8, D9, D10, D14).

## Global Constraints

- Hard rules 1 to 5 of `docs/dev/UPGRADE-PLAN.md` and rules 6 and 7 of `docs/dev/V3-PLAN.md`: no vendor material, no employer material, no bundler, no ES modules, no npm dependencies, no network calls, `support.js` never edited, `dist/` never hand-edited.
- The six trip thresholds (98 % TK-101, 185 °C R-201, 950 kPa V-401, 110 °C R-202, 480 °C R-310, 1100 kPa V-502) are untouched; S1 adds indication at a trip, never a threshold.
- `src/*.js` stay pure UMD scripts: no DOM, no timers, no globals, no `Math.random()`.
- Every file added carries `// @artifact production` (src) or `// @artifact dev` (tests, docs/dev) in its first three lines, or `tests/artifact-classes.test.js` fails.
- Before every commit: `node --test tests/*.test.js`, `python3 tools/build-dist.py`, `tools/smoke.sh`. A commit inside this stage may carry known-red golden tests only when its message names them and Task 9 is where they are re-captured (spec §1.4); every other test is green.
- Goldens move only under option A: never edit a fixture by hand; re-capture only the movers by test-name pattern with `UPDATE_GOLDENS=1`, after the final build of the stage, and list each in `tests/v2-baseline-archive.test.js` `KNOWN_RECAPTURED` with its reason. The allowed movers for S1 are in spec §11; any other mover is a finding that stops the stage.
- `python3 tools/build-dist.py` after any change to `src/` or the page; `dist/` is committed with the change that caused it.
- Commit messages: conventional subject, a body that says why and names the tests, and the two trailers `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_<id>`.
- Branch `fix/playtest-2026-10`; push after each task's commit; never to `main`.

## Review Focus

1. A point whose declared range is empty or inverted (`lo >= hi`): the policy must leave it alone and never produce NaN. Pinned in Task 1.
2. A flow reading a real negative beyond the cutoff (for example `-2 M3/H` on a 120 span): it reports at the low reporting limit with quality UNCERTAIN and limit LOW, never a bare negative number. Pinned in Task 1.
3. A loop in CAS while tracking: its setpoint must keep following the master so the faceplate's SP is honest even though OP is held. Pinned in Task 5.
4. A snapshot taken while a loop is tracking and restored later: `trk` and `obs` travel in `L`; the next tick must recompute them from the restored flags, never trust the stored ones. Pinned in Task 6.
5. The pump stopped while FIC102 is in MAN with an operator's OP, then the operator returns the loop to AUTO: tracking engages on the next scan, the OP goes to SAFEOP and the flag says why. Pinned in Task 6.

---

### Task 1: Range policy in the measurement module (D7 policy, D14 cutoff)

**Files:**
- Modify: `src/measurement.js`
- Modify: `tests/measurement.test.js` (the test at line 94, "other tags have no invented transmitter span")
- Modify: `docs/RESOURCES.md` (new `### 7.49`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ESS.Measurement.rangeOf(point) -> {lower, upper, reportingLower, reportingUpper, span} | null`, `ESS.Measurement.RANGE_POLICY`, and `observe(point)` now clamps every analog point (`kind` of `pid` or `ind` with finite `lo < hi`) and applies the flow cutoff. `TIC202` and `STATUS` exports unchanged.

- [ ] **Step 1: Register NE 43 in `docs/RESOURCES.md`**

Append after the last `### 7.48` subsection, matching the house format of the neighbouring entries:

```markdown
### 7.49 NAMUR NE 43, failure-information signal levels for 4..20 mA transmitters

Registered 2026-10-03 for the measurement policy (`src/measurement.js`), CITED-NOT-HELD: the
recommendation text is not held in this repository and is not needed; the two numbers the policy
uses are its public convention: live measurement between 3.8 mA and 20.5 mA, which on a 4..20 mA
span is -1.25 % to +103.125 % of the engineering range. Public overview:
https://www.namur.net/en/recommendations-and-worksheets/current-nena/ (NE 43 listing). The sim's
transmitter is a synthetic one that reports through that interval; this is a citation for the
convention, not a claim of conformance.
```

- [ ] **Step 2: Write the failing tests**

Replace the test at `tests/measurement.test.js:94-98` and add the policy tests below it:

```js
test('a point with no declared range or kind has no invented transmitter span', () => {
  const o = Measurement.observe({tag: 'TI312', pv: 480.5, lo: 0, hi: 100});
  assert.equal(o.pv, 480.5);
  assert.equal(o.quality, 'GOOD');
});

test('every analog point reports through the declared NE 43 window of its own range', () => {
  // kind:'ind', range 0..100: window is -1.25 .. 103.125 (spec §2.2, RESOURCES-7.49)
  const hi = Measurement.observe({tag: 'TI312', kind: 'ind', pv: 480.5, lo: 0, hi: 100});
  assert.deepEqual(hi, {pv: 103.125, badPv: false, quality: 'UNCERTAIN', statusCode: 0x40940600,
    statusName: 'Uncertain_EngineeringUnitsExceeded', limit: 'HIGH'});
  const lo = Measurement.observe({tag: 'TI312', kind: 'ind', pv: -40, lo: 0, hi: 100});
  assert.equal(lo.pv, -1.25); assert.equal(lo.limit, 'LOW'); assert.equal(lo.quality, 'UNCERTAIN');
  // a pid point on a 0..200 span: window -2.5 .. 206.25
  const r = Measurement.rangeOf({tag: 'TIC201', kind: 'pid', lo: 0, hi: 200});
  assert.deepEqual(r, {lower: 0, upper: 200, reportingLower: -2.5, reportingUpper: 206.25, span: 200});
  assert.equal(Measurement.observe({tag: 'TIC201', kind: 'pid', pv: 150, lo: 0, hi: 200}).quality, 'GOOD');
});

test('the generalised policy reproduces the shipped TIC202 precedent exactly', () => {
  const r = Measurement.rangeOf({tag: 'TIC202', kind: 'pid', lo: 0, hi: 100});
  assert.equal(r.reportingLower, Measurement.TIC202.reportingLower);
  assert.equal(r.reportingUpper, Measurement.TIC202.reportingUpper);
  // the precedent object still answers for a TIC202 point that declares no range
  assert.equal(Measurement.observe({tag: 'TIC202', pv: 170.6}).pv, 103.125);
});

test('flow points read 0 below the low-flow cutoff and clamp like any analog point beyond it', () => {
  const flow = (pv) => Measurement.observe({tag: 'FIC102', kind: 'pid', eu: 'M3/H', pv, lo: 0, hi: 120});
  assert.deepEqual(flow(-0.1), {pv: 0, badPv: false, quality: 'GOOD', statusCode: 0, statusName: 'Good', limit: 'NONE'});
  assert.equal(flow(0.9).pv, 0);        // 1 % of a 120 span is 1.2
  assert.equal(flow(1.3).pv, 1.3);
  const neg = flow(-2);                 // beyond the cutoff: low reporting limit, UNCERTAIN, LOW
  assert.equal(neg.pv, -1.5); assert.equal(neg.quality, 'UNCERTAIN'); assert.equal(neg.limit, 'LOW');
  assert.equal(Measurement.observe({tag: 'TIC201', kind: 'pid', eu: 'DEG C', pv: 0.5, lo: 0, hi: 200}).pv, 0.5, 'cutoff is for flows only');
});

test('an empty or inverted declared range is left alone and never yields NaN', () => {
  for (const [lo, hi] of [[0, 0], [100, 0]]) {
    const o = Measurement.observe({tag: 'TI999', kind: 'ind', pv: 480.5, lo, hi});
    assert.equal(o.pv, 480.5); assert.equal(o.quality, 'GOOD');
    assert.equal(Measurement.rangeOf({tag: 'TI999', kind: 'ind', lo, hi}), null);
  }
});

test('motor and discrete points are not clamped', () => {
  const o = Measurement.observe({tag: 'P101', kind: 'motor', pv: 1, lo: 0, hi: 1});
  assert.equal(o.pv, 1); assert.equal(o.quality, 'GOOD');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/measurement.test.js`
Expected: the new tests fail (`Measurement.rangeOf is not a function`; the `kind:'ind'` point reports 480.5 instead of 103.125; the flow cutoff case reports -0.1).

- [ ] **Step 4: Implement the policy**

In `src/measurement.js`, replace the header comment on line 2 and add the policy after the `TIC202` constant:

```js
// Transmitter reporting for every analog point. From 3.2.0 the observed value also feeds the
// controllers and the alarm scan (plant-core writes it to l.pvObs): a controller cannot see what
// the transmitter cannot send. Anthony's decision, docs/dev/CREDIBILITY-PASS-SPEC.md §2.4.
// observe() itself stays pure and never mutates the point.
```

```js
  // Declared reporting window for every analog point, the 4..20 mA loop convention: live
  // measurement between 3.8 mA and 20.5 mA, i.e. lo - 1.25 % to hi + 3.125 % of span
  // (NAMUR NE 43, RESOURCES-7.49, CITED-NOT-HELD; spec §2.2). Flows read 0 below 1 % of span.
  const RANGE_POLICY = Object.freeze({
    lowFrac: -0.0125, highFrac: 0.03125, flowCutoffFrac: 0.01,
    nominalLowMa: 4, nominalHighMa: 20, reportingLowMa: 3.8, reportingHighMa: 20.5
  });

  function isAnalog(p) {
    return (p.kind === 'pid' || p.kind === 'ind') && Number.isFinite(p.lo) && Number.isFinite(p.hi) && p.hi > p.lo;
  }
  function isFlow(p) { return String(p.eu || '').toUpperCase() === 'M3/H'; }

  // The window a point reports through, or null when the point declares no usable range.
  // TIC202 keeps answering from its shipped precedent when a caller passes no range at all.
  function rangeOf(point) {
    const p = point || {};
    if (isAnalog(p)) {
      const span = p.hi - p.lo;
      return Object.freeze({
        lower: p.lo, upper: p.hi, span,
        reportingLower: p.lo + RANGE_POLICY.lowFrac * span,
        reportingUpper: p.hi + RANGE_POLICY.highFrac * span
      });
    }
    if (p.tag === 'TIC202') {
      return Object.freeze({ lower: TIC202.lower, upper: TIC202.upper, span: TIC202.upper - TIC202.lower,
        reportingLower: TIC202.reportingLower, reportingUpper: TIC202.reportingUpper });
    }
    return null;
  }
```

Then replace the TIC202-only block inside `observe()` (lines 84-92) with:

```js
    let pv = p.pv;
    const r = rangeOf(p);
    if (r && isFlow(p) && Math.abs(pv) < RANGE_POLICY.flowCutoffFrac * r.span) pv = 0;
    if (r && (pv < r.lower || pv > r.upper)) {
      const limit = pv < r.lower ? 0x100 : 0x200;
      pv = Math.max(r.reportingLower, Math.min(r.reportingUpper, pv));
      if (family(code) === 'GOOD' || code === STATUS.Uncertain) {
        code = STATUS.Uncertain_EngineeringUnitsExceeded;
      }
      code = ((code & ~LIMIT_MASK) | DATA_VALUE | limit) >>> 0;
    }
    return result(pv, code, p.statusName);
```

And export the new names: `return { observe, rangeOf, RANGE_POLICY, TIC202, STATUS };`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/measurement.test.js`
Expected: all pass, including the untouched TIC202 precedent tests at the top of the file.

- [ ] **Step 6: Build, full suite, smoke, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^# (pass|fail)' && tools/smoke.sh`
Expected: `# fail 0` (no caller reads the new fields yet, so no golden moves), smoke ok on both builds.

```bash
git add src/measurement.js tests/measurement.test.js docs/RESOURCES.md src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(measurement): a declared NE 43 reporting window for every analog point, and a low-flow cutoff" -m "Generalises the TIC202 precedent (spec §2.2); observe() stays pure. Tests: tests/measurement.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 2: The PID module reads the observed value

**Files:**
- Modify: `src/pid.js`
- Test: `tests/pid.test.js`

**Interfaces:**
- Consumes: nothing new (a loop may carry `pvObs`, a number, written by Task 3).
- Produces: `ESS.Pid.pvOf(loop) -> number` (`loop.pvObs` when it is a number, else `loop.pv`). Every PV read inside the module goes through it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pid.test.js`:

```js
test('the controller acts on pvObs when the point carries one, and on pv otherwise', () => {
  const a = mkLoop({ sp: 50, pv: 80, K: 1, T1: 1 });
  const b = mkLoop({ sp: 50, pv: 80, pvObs: 60, K: 1, T1: 1 });
  assert.equal(Pid.pvOf(a), 80);
  assert.equal(Pid.pvOf(b), 60);
  Pid.stepPid(a, 0.5); Pid.stepPid(b, 0.5);
  assert.ok(a.op < b.op, 'the loop that sees the larger error moves its output further');
  assert.equal(b.lastPv, 60, 'lastPv follows the observed value');
  assert.equal(a.lastPv, 80);
});

test('PV tracking in MAN follows the observed value', () => {
  const l = mkLoop({ mode: 'MAN', pvtrack: true, pv: 140, pvObs: 103.125, sp: 40 });
  Pid.stepPid(l, 0.5);
  assert.equal(l.sp, 100, 'SP tracks the observed PV, clamped to SPHILM');
});
```

(`mkLoop` in that file sets `sphilm: 100` on its default loop; if it does not, add `sphilm: 100` to the second test's loop.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pid.test.js`
Expected: FAIL with `Pid.pvOf is not a function`.

- [ ] **Step 3: Implement `pvOf` and route every PV read through it**

In `src/pid.js`, after `function span(loop) {...}` add:

```js
  // The value the controller sees: the observed transmitter value when the plant wrote one
  // (plant-core measure(), spec §2.3), otherwise the raw point value. Never the model's truth
  // when a transmitter would have saturated.
  function pvOf(loop) { return typeof loop.pvObs === 'number' ? loop.pvObs : loop.pv; }
```

Then change exactly these reads:
- `loopError`: `var raw = loop.act === 'DIR' ? (pvOf(loop) - loop.sp) : (loop.sp - pvOf(loop));`
- `pvDerivative`: `var raw = ((pvOf(loop) - loop.lastPv) / span(loop)) * 100 / dt;`
- `trackIntegrator`: `loop.lastPv = pvOf(loop);`
- `applyPvTracking`: `if (loop.pvtrack && !loop.badPv) loop.sp = clampSp(loop, pvOf(loop));`
- `stepPid`, first lines: `if (typeof loop.lastPv !== 'number') loop.lastPv = pvOf(loop);`
- `stepPid`, last lines: `loop.lastPv = pvOf(loop);`

Add `pvOf: pvOf` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/pid.test.js`
Expected: PASS, including every existing test (no loop in the file carries `pvObs`, so behaviour is byte-identical).

- [ ] **Step 5: Build, full suite, smoke, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^# (pass|fail)' && tools/smoke.sh`
Expected: `# fail 0`, smoke ok.

```bash
git add src/pid.js tests/pid.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(pid): the controller reads the observed value when the point carries one" -m "pvOf() routes every PV read; no loop carries pvObs yet, so no behaviour moves. Spec §2.3. Tests: tests/pid.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 3: The observed value in the scan (`measure()`), alarms and trends

**Files:**
- Modify: `src/plant-core.js` (`advanceScan` at line 183 area, the alarm scan at lines 545-565, the trend push near line 215)
- Create: `tests/app-credibility-s1.test.js`

**Interfaces:**
- Consumes: `ESS.Measurement.observe`, `ESS.Pid.pvOf`.
- Produces: per tick, for every `pid` and `ind` point, `l.obs` (the frozen `observe()` result) and `l.pvObs` (its `pv`, or the raw `pv` when the observation is BAD). `Component.prototype.measure()` is public and idempotent.

- [ ] **Step 1: Write the failing tests**

Create `tests/app-credibility-s1.test.js`:

```js
// @artifact dev
// Credibility pass, stage S1: observed values and output tracking (docs/dev/CREDIBILITY-PASS-SPEC.md §2, §3).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Models = require('../src/models.js');
const CauseEffect = require('../src/cause-effect.js');
const AlarmHelp = require('../src/alarm-help.js');

// Point Detail rows come from the page's mRow(label,param,value,canEdit,note): read .value and .note.
const { Component } = load();
function boot(seed, sec) {
  const c = new Component({});
  c.initSim();
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
// Jacket cooling lost by the operator's own hand: TIC202 to MAN, OP 0, exactly the playtest's D7 repro.
function loseCooling(c) { c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 0); }

test('D7: the jacket transmitter saturates at its reporting limit and the cascade primary sees the saturated value', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110), 'the jacket model exceeded 110 C');
  const l = c.L.TIC202;
  assert.equal(l.pvObs, 103.125);
  assert.equal(l.obs.quality, 'UNCERTAIN');
  assert.equal(l.obs.limit, 'HIGH');
  assert.ok(l.pv > 103.125, 'the raw model value is untouched');
  c.step(0.5);
  assert.equal(l.lastPv, 103.125, 'the loop record tracks the observed value, not the model');
  const last = c.hist.TIC202[c.hist.TIC202.length - 1];
  assert.equal(last[1], 103.125, 'the trend pen carries the observed value');
});

test('D7: alarms evaluate the observed value and report it', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.alarms.some((a) => a.tag === 'TIC202' && a.cond === 'PVHH' && a.active)), 'PVHH raised');
  const a = c.alarms.find((x) => x.tag === 'TIC202' && x.cond === 'PVHH' && x.active);
  assert.ok(a.val <= 103.125, 'the alarm value is the reported value, never the model value: ' + a.val);
});

test('measure() is idempotent and writes obs for every pid and ind point', () => {
  const c = boot(4);
  c.step(0.5);
  for (const k in c.L) { const l = c.L[k]; if (l.kind === 'pid' || l.kind === 'ind') { assert.ok(l.obs, k); assert.equal(typeof l.pvObs, 'number', k); } }
  const before = JSON.stringify(c.L.TIC201.obs);
  c.measure();
  assert.equal(JSON.stringify(c.L.TIC201.obs), before);
});

test('a bad PV keeps the raw value as pvObs so the shed path is unchanged', () => {
  const c = boot(4, 'OPER');
  c.injectFault('xmtr', true);                 // FIC102 transmitter fault -> badPv after its hold time
  assert.ok(run(c, 600, () => c.L.FIC102.badPv), 'FIC102 went bad');
  assert.equal(c.L.FIC102.obs.quality, 'BAD');
  assert.equal(c.L.FIC102.pvObs, c.L.FIC102.pv);
});
```

(`injectFault('xmtr', true)` is the transmitter upset the golden `upset-xmtr` fixture drives; if `badPv` does not latch within 600 s on this seed, read `tests/golden-upsets.test.js` for the `xmtr` scenario's own wait and use that.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: FAIL, `l.pvObs` is `undefined` and `c.measure is not a function`.

- [ ] **Step 3: Implement `measure()` and wire it**

In `src/plant-core.js`, next to `pids(dt)` (line 526), add:

```js
  // The observed value of every analog point, once per tick, after the models write pv and before
  // the controllers and the alarm scan read it (spec §2.3). Raw pv stays the model's: several
  // equations read their own points (FIC102's transmitter fault, the U4 analyzers).
  measure(){
    const L=this.L;
    for(const k in L){ const l=L[k];
      if(l.kind!=='pid'&&l.kind!=='ind') continue;
      const m=ESS.Measurement.observe(l);
      l.obs=m; l.pvObs=(typeof m.pv==='number')?m.pv:l.pv;
    }
  }
```

In `advanceScan`, insert `this.measure();` on its own line immediately after `this.stepU4(dt);` and before `this.pids(dt);`.

In the alarm scan (lines 557-565), change the value read and the raised value:

```js
        const pv=observed?observed.pv:ESS.Pid.pvOf(l);
        const v=cond==='DEVHI'?(pv-l.sp):pv;
        const memo=l._am[cond]||(l._am[cond]={raw:false,active:false,onT:0,offT:0});
        const act=E.evaluateLimit({pv:v,trip:tp,kind:isLo?'LO':'HI',deadband:this.almDeadband(l),onDelaySec:this.almDelay(l),dt,memo}).active;
        if(act && !l._as[cond]) this.raiseA(l.tag,cond,prio,pv,l.eu,l.desc);
        if(!act && l._as[cond]) this.clearA(l.tag,cond,pv);
```

(the analyzer branch above it, `observed&&observed.quality!=='GOOD'`, is unchanged: an unavailable sample is retained, a saturated reading is evaluated).

In the trend push inside `advanceScan`, change `h.push([P.t, l.pv, l.sp??0, l.op??0])` to `h.push([P.t, ESS.Pid.pvOf(l), l.sp??0, l.op??0])`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s1.test.js tests/measurement.test.js tests/pid.test.js`
Expected: PASS.

- [ ] **Step 5: Build, full suite, smoke, record the movers, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok|^# (pass|fail)'`
Expected: the only failures are golden tests whose runs leave a transmitter's range (spec §11: the cooling-loss and stiction upsets, drill D4, drill D6 and any run where TIC202 passed 100 °C). Any other failure is a defect in this task: fix it before committing. Then `tools/smoke.sh`: ok on both builds.

```bash
git add src/plant-core.js tests/app-credibility-s1.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(core): every analog point carries its observed value; controllers, alarms and trends read it" -m "D7 at the seam: plant-core measure() writes l.obs and l.pvObs each tick (spec §2.3-2.4). Goldens that leave a transmitter range move and are re-captured in the S1 closing task: <list the not-ok golden names here>. Tests: tests/app-credibility-s1.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 4: The page shows the observed value, the crosshatch for UNCERTAIN, and no negative zero (D7 display, D14)

**Files:**
- Modify: `src/plant-core.js` (`fmt` at line 727; new helpers beside it)
- Modify: `Experion Station Simulator.dc.html` (graphic value box near line 3744-3748, faceplate near line 3984-3990, Point Detail lines 3868 and 3931)
- Test: `tests/app-credibility-s1.test.js`

**Interfaces:**
- Consumes: `l.obs`, `l.pvObs` from Task 3.
- Produces: `Component.prototype.pvShown(l) -> number`, `hatchOp(l) -> 0 | 0.45 | 0.85`, `fmt(v, dec)` without negative zero.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s1.test.js`:

```js
test('D14: fmt never prints a negative zero at any precision', () => {
  const c = boot(1);
  assert.equal(c.fmt(-0.04, 1), '0.0');
  assert.equal(c.fmt(-0.004, 2), '0.00');
  assert.equal(c.fmt(-0.4, 0), '0');
  assert.equal(c.fmt(-0.00004, 4), '0.0000');
  assert.equal(c.fmt(-0.6, 0), '-1');
  assert.equal(c.fmt(-1.26, 1), '-1.3');
  assert.equal(c.fmt(null, 1), '—');
});

test('D7: the page renders the observed value and hatches an uncertain reading', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  const l = c.L.TIC202;
  assert.equal(c.pvShown(l), 103.125);
  assert.equal(c.hatchOp(l), 0.45);
  assert.equal(c.hatchOp(c.L.TIC201), 0);
  c.nav('detail', 'TIC202');
  const v = c.renderVals();
  const pvRow = v.dpt.mainRows.find((r) => r.param === 'PV');
  assert.match(pvRow.value, /^103\.1 /);
  assert.match(pvRow.note, /UNCERTAIN/);
});

test('a bad PV still hatches at full strength', () => {
  const c = boot(4, 'OPER');
  c.injectFault('xmtr', true);
  assert.ok(run(c, 600, () => c.L.FIC102.badPv));
  assert.equal(c.hatchOp(c.L.FIC102), 0.85);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: FAIL, `c.pvShown is not a function`, and `fmt(-0.04,1)` returns `'-0.0'`.

- [ ] **Step 3: Implement the helpers and the formatter**

In `src/plant-core.js`, replace `fmt` (line 727) and add two helpers beside it:

```js
  fmt(v,dec){ if(v==null||isNaN(v)) return '—'; const s=Number(v).toFixed(dec); return (s[0]==='-'&&Number(s)===0)?s.slice(1):s; }
  // What the operator sees: the observed transmitter value (spec §2.5). Before the first tick, or
  // for a point measure() does not cover, observe on the fly; observe() is pure and cheap.
  pvShown(l){ if(l.obs&&typeof l.obs.pv==='number') return l.obs.pv; if(l.kind==='pid'||l.kind==='ind'){ const m=ESS.Measurement.observe(l); if(typeof m.pv==='number') return m.pv; } return l.pv; }
  hatchOp(l){ if(l.badPv) return 0.85; const q=l.obs?l.obs.quality:(l.kind==='pid'||l.kind==='ind'?ESS.Measurement.observe(l).quality:'GOOD'); return q==='UNCERTAIN'?0.45:0; }
```

- [ ] **Step 4: Route the page's value reads through the helpers**

In `Experion Station Simulator.dc.html`:
- Graphic value box (line 3744): `const pvT=l.kind==='motor'?(l.run?'RUN':'STOP'):this.fmt(this.pvShown(l),l.dec);`
- Graphic hatch (line 3748): replace `hatchOp:l.badPv?0.85:0` with `hatchOp:this.hatchOp(l)`.
- Faceplate (line 3990): `pvT:this.fmt(this.pvShown(l),l.dec)`. The bar height `pvH` is computed from `l.pv` a few lines above `pin:f.pin` (grep `const pvH` in the page); declare `const pvS=this.pvShown(l);` at the top of that faceplate block and use `pvS` in the `pvH` expression.
- Point Detail PV row (line 3868): `mRow('Process variable','PV',this.fmt(this.pvShown(dl),dl.dec)+' '+dl.eu,false,dl.badPv?'BAD PV — crosshatch shown on graphic':(dl.obs&&dl.obs.quality==='UNCERTAIN'?'UNCERTAIN — '+dl.obs.limit+' LIMIT, reported at the transmitter limit':'')),`
- Point Detail band note (line 3931): replace the three `dl.pv` reads in `bandNote` with `this.pvShown(dl)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: PASS.

- [ ] **Step 6: Build, full suite, smoke, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok|^# (pass|fail)' && tools/smoke.sh`
Expected: the same golden set as Task 3 and nothing else; smoke ok on both builds. Open the folder build in a browser once, lose cooling on TIC202, and look at the faceplate: the value stops at 103.1 with a light hatch.

```bash
git add src/plant-core.js "Experion Station Simulator.dc.html" tests/app-credibility-s1.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(hmi): operator-facing values are the observed ones; uncertain readings hatch; no negative zero" -m "D7 display half and D14 (spec §2.5). Tests: tests/app-credibility-s1.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 5: Output tracking in the PID module

**Files:**
- Modify: `src/pid.js`
- Test: `tests/pid.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ESS.Pid.setTracking(loop, target, reason, kind)`, `clearTracking(loop)`, `tracking(loop) -> boolean` (true when a tracking request is in force for this scan: kind `interlock` in any mode, kind `device` outside MAN). The loop field is `trk: {on, target, reason, kind}`. `runInitman` treats a tracking secondary like an open cascade.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pid.test.js`:

```js
test('output tracking holds OP at the target in AUTO with the integrator back-calculated, then resumes bumplessly', () => {
  const l = mkLoop({ sp: 50, pv: 50, op: 60, I: 60, K: 1, T1: 1 });
  Pid.setTracking(l, 0, 'P-101 STOPPED', 'device');
  assert.equal(Pid.tracking(l), true);
  for (let i = 0; i < 20; i++) Pid.stepPid(l, 0.5);
  assert.equal(l.op, 0);
  assert.equal(l.I, 0 - l.K * Pid.loopError(l), 'I = OP - P');
  Pid.clearTracking(l);
  assert.equal(Pid.tracking(l), false);
  Pid.stepPid(l, 0.5);
  assert.ok(Math.abs(l.op - 0) < 1, 'first scan after release starts from the tracked value: ' + l.op);
});

test('device tracking yields to the operator in MAN; interlock tracking does not', () => {
  const dev = mkLoop({ mode: 'MAN', op: 40, I: 40 });
  Pid.setTracking(dev, 0, 'P-101 STOPPED', 'device');
  assert.equal(Pid.tracking(dev), false);
  Pid.stepPid(dev, 0.5);
  assert.equal(dev.op, 40);
  const il = mkLoop({ mode: 'MAN', op: 40, I: 40 });
  Pid.setTracking(il, 0, 'R-201 HI TEMP TRIP', 'interlock');
  assert.equal(Pid.tracking(il), true);
  Pid.stepPid(il, 0.5);
  assert.equal(il.op, 0);
});

test('a tracking CAS secondary keeps following its master setpoint, and its primary runs INITMAN', () => {
  const master = mkLoop({ tag: 'M', slave: 'S', sp: 50, pv: 50, op: 70, I: 70 });
  const slave = mkLoop({ tag: 'S', master: 'M', mode: 'CAS', sp: 10, pv: 10, op: 30, I: 30, sphilm: 100, splolm: 0 });
  const ctx = { loops: { M: master, S: slave }, casMap: { S: (op) => op }, invMap: { S: (sp) => sp } };
  Pid.setTracking(slave, 0, 'P-101 STOPPED', 'device');
  Pid.stepPid(master, 0.5, ctx);
  Pid.stepPid(slave, 0.5, ctx);
  assert.equal(slave.sp, 70, 'SP still follows the master while OP is held');
  assert.equal(slave.op, 0);
  assert.equal(master.init, true, 'the primary back-calculates while its secondary tracks');
  Pid.clearTracking(slave);
  Pid.stepPid(master, 0.5, ctx);
  assert.equal(master.init, false);
});

test('clearTracking on a loop that never tracked is a no-op and stepPid ignores a cleared record', () => {
  const l = mkLoop({ sp: 50, pv: 40, op: 50, I: 50, K: 1, T1: 1 });
  Pid.clearTracking(l);
  assert.equal(Pid.tracking(l), false);
  Pid.stepPid(l, 0.5);
  assert.ok(l.op > 50, 'ordinary control action');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pid.test.js`
Expected: FAIL with `Pid.setTracking is not a function`.

- [ ] **Step 3: Implement tracking**

In `src/pid.js`, after `applyPvTracking` add:

```js
  // Output tracking (spec §3.1): the plant tells a loop to hold its output at a target with a
  // reason. An interlock holds in every mode; a device-feedback hold yields to the operator in MAN.
  // The module is told, it never decides who tracks.
  function setTracking(loop, target, reason, kind) {
    loop.trk = { on: true, target: target, reason: String(reason || ''), kind: kind === 'interlock' ? 'interlock' : 'device' };
  }
  function clearTracking(loop) {
    if (loop.trk && loop.trk.on) loop.trk = { on: false, target: null, reason: '', kind: loop.trk.kind };
  }
  function tracking(loop) {
    return !!(loop.trk && loop.trk.on) && (loop.trk.kind === 'interlock' || loop.mode !== 'MAN');
  }
```

In `runInitman`, change the init line to `loop.init = slave.mode !== 'CAS' || tracking(slave);`.

In `stepPid`, insert the tracking branch after the CAS line and before the MAN/badPv line:

```js
    if (loop.mode === 'CAS' && loop.master) followMaster(loop, ctx);
    if (tracking(loop)) { loop.op = clampOp(loop, loop.trk.target); applyPvTracking(loop); trackIntegrator(loop); return loop; }
    if (loop.mode === 'MAN' || loop.badPv) { applyPvTracking(loop); trackIntegrator(loop); return loop; }
```

Export: add `setTracking: setTracking, clearTracking: clearTracking, tracking: tracking` to the returned object, and document the three in the header comment's API list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/pid.test.js`
Expected: PASS.

- [ ] **Step 5: Build, full suite, smoke, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok|^# (pass|fail)' && tools/smoke.sh`
Expected: the Task 3 golden set only (nothing calls setTracking yet); smoke ok.

```bash
git add src/pid.js tests/pid.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(pid): output tracking, told by the plant, honoured by the loop" -m "setTracking/clearTracking/tracking and INITMAN for the primary of a tracking secondary (spec §3.1). Tests: tests/pid.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 6: The plant decides who tracks (`forcedOutputs`), and the OP refusal (D1, D10)

**Files:**
- Modify: `src/plant-core.js` (`advanceScan`, `operatorMayWrite` at line 1448 area, new `forcedOutputs()` beside `pids`)
- Test: `tests/app-credibility-s1.test.js`

**Interfaces:**
- Consumes: `ESS.Pid.setTracking/clearTracking/tracking`, `ESS.CauseEffect.causes()`, `ESS.CauseEffect.effects()`, `this.valveMap()`.
- Produces: `Component.prototype.forcedOutputs() -> Set<tag>` (the loops tracking this tick), run every tick after `measure()` and before `pids()`. An OP entry on a loop tracking by interlock is refused with `WRITE REJECTED — OUTPUT INTERLOCKED — <reason>` in the journal and `ENTRY REJECTED — OUTPUT INTERLOCKED (<reason>)` in the message zone.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s1.test.js`:

```js
const tripFlagOfCause = { R201_HITEMP: 'rx', R202_HITEMP: 'batch', R310_HITEMP: 'bed', H310_SKIN: 'skin' };

test('D1: a stopped pump makes FIC102 track SAFEOP, its primary runs INITMAN, and the restart does not surge', () => {
  const c = boot(4, 'OPER');
  run(c, 60);
  c.motorCmd('P101', false);
  c.step(0.5);
  assert.deepEqual({ on: c.L.FIC102.trk.on, kind: c.L.FIC102.trk.kind, reason: c.L.FIC102.trk.reason }, { on: true, kind: 'device', reason: 'P-101 STOPPED' });
  assert.equal(c.L.FIC102.op, 0);
  assert.equal(c.L.LIC101.init, true);
  run(c, 60);
  assert.equal(c.L.FIC102.op, 0, 'no wind-up while the pump is stopped');
  assert.ok(c.L.LIC101.op < 100, 'the primary did not wind up either: ' + c.L.LIC101.op);
  c.motorCmd('P101', true);
  assert.equal(c.L.P101.run, true, 'the lockout had expired');
  let maxFlow = 0;
  run(c, 300, () => { maxFlow = Math.max(maxFlow, c.L.FIC102.pv); return false; });
  assert.ok(maxFlow <= 80.5, 'flow after restart never exceeds SPHILM 80: ' + maxFlow);
  assert.equal(c.L.FIC102.trk.on, false, 'tracking released on restart');
  assert.equal(c.L.LIC101.init, false);
});

test('D1: in MAN the operator owns the output while the pump is stopped; returning to AUTO re-engages tracking', () => {
  const c = boot(4, 'OPER');
  c.motorCmd('P101', false);
  c.step(0.5);
  c.setMode('FIC102', 'MAN');
  assert.equal(c.storeEntry('FIC102', 'OP', 40), true);
  run(c, 5);
  assert.equal(c.L.FIC102.op, 40, 'device tracking yields in MAN');
  c.setMode('FIC102', 'AUTO');
  c.step(0.5);
  assert.equal(c.L.FIC102.op, 0, 'tracking engages again outside MAN');
});

test('D10: the R-201 trip holds FIC102 at zero in every mode, shows why, and refuses an OP entry', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 2400, () => c.P.trips.rx), 'R-201 tripped at 185 C');
  const l = c.L.FIC102;
  assert.deepEqual({ kind: l.trk.kind, reason: l.trk.reason }, { kind: 'interlock', reason: 'R-201 HI TEMP TRIP' });
  assert.equal(l.op, 0);
  c.setMode('FIC102', 'MAN');
  c.storeEntry('FIC102', 'OP', 80);
  assert.match(c.state.msg, /ENTRY REJECTED — OUTPUT INTERLOCKED \(R-201 HI TEMP TRIP\)/);
  assert.ok(c.events.some((e) => /^WRITE REJECTED — OUTPUT INTERLOCKED — R-201 HI TEMP TRIP/.test(e.desc)), 'the refusal is journaled');
  run(c, 30);
  assert.equal(l.op, 0, 'OP equals the forced valve');
  assert.ok(c.V.FV102.pos < 0.01, 'the valve is shut: ' + c.V.FV102.pos);
  assert.ok(!c.events.some((e) => e.desc === 'OP CHANGE' && e.src === 'FIC102' && e.newV === '80.00'), 'a refused write is never journaled as a change');
});

test('tracking is released when the trip resets, and a restored snapshot recomputes it from the flags', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 2400, () => c.P.trips.rx));
  const snap = c.snapshotData('mid-trip');
  assert.ok(run(c, 3600, () => !c.P.trips.rx), 'the trip reset below 160 C');
  assert.equal(c.L.FIC102.trk.on, false);
  c.restoreSnapshot(snap, 'test');
  assert.equal(c.P.trips.rx, true);
  c.L.FIC102.trk = { on: false, target: null, reason: '', kind: 'device' };   // corrupt the stored record on purpose
  c.step(0.5);
  assert.equal(c.L.FIC102.trk.on, true, 'the tick recomputed tracking from the restored trip flag');
  assert.equal(c.L.FIC102.trk.kind, 'interlock');
});

test('the tracking set equals the W2 matrix effect columns, cause by cause', () => {
  const c = boot(4);
  const loopOf = {}; for (const [loop, valve] of Object.entries(c.valveMap())) loopOf[valve] = loop;
  for (const col of CauseEffect.effects().filter((e) => e.kind === 'valve')) {
    const loop = c.L[loopOf[col.target]];
    assert.ok(loop, col.target + ' has a loop');
    for (const causeId of col.causedBy) {
      const flag = tripFlagOfCause[causeId];
      assert.ok(flag, causeId + ' has a trip flag');
      for (const k of Object.keys(tripFlagOfCause)) c.P.trips[tripFlagOfCause[k]] = false;
      c.L.P101.run = true;
      c.P.trips[flag] = true;
      c.forcedOutputs();
      assert.equal(loop.trk.on, true, col.target + ' tracks under ' + causeId);
      assert.equal(loop.trk.kind, 'interlock');
      const cause = CauseEffect.causes().find((x) => x.id === causeId);
      assert.equal(loop.trk.reason, cause.src + ' ' + cause.cond);
      c.P.trips[flag] = false;
      c.forcedOutputs();
      assert.equal(loop.trk.on, false);
    }
  }
  assert.equal(CauseEffect.effects().filter((e) => e.kind === 'valve').length, 4, 'four valve columns are declared');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: FAIL, `c.L.FIC102.trk` is `undefined` and `c.forcedOutputs is not a function`.

- [ ] **Step 3: Implement `forcedOutputs()` and the refusal**

In `src/plant-core.js`, next to `pids(dt)`:

```js
  // Who tracks, decided once per tick from the code's own trip flags and run states, the same
  // gating src/models.js VALVE_TARGET enforces (spec §3.2). The W2 matrix declares the same
  // columns and tests/app-credibility-s1.test.js holds the two equal; this reads the flags, never
  // the matrix. Interlock holds in every mode; a stopped pump holds only outside MAN.
  forcedOutputs(){
    const P=this.P, L=this.L, trips=P.trips||{};
    const name=(id)=>{ const c=(ESS.CauseEffect?ESS.CauseEffect.causes():[]).find(x=>x.id===id); return c?(c.src+' '+c.cond):id; };
    const rows=[
      ['FIC102', !!trips.rx, 'interlock', 0, ()=>name('R201_HITEMP')],
      ['FIC102', !trips.rx && !!L.P101 && !L.P101.run, 'device', (L.FIC102&&L.FIC102.safeop)||0, ()=>'P-101 STOPPED'],
      ['FIC211', !!trips.batch, 'interlock', 0, ()=>name('R202_HITEMP')],
      ['TIC213', !!trips.batch, 'interlock', 0, ()=>name('R202_HITEMP')],
      ['TIC311', !!(trips.bed||trips.skin), 'interlock', 0, ()=>trips.bed?name('R310_HITEMP'):name('H310_SKIN')],
    ];
    const set=new Set();
    for(const [tag,on,kind,target,reason] of rows){ const l=L[tag]; if(!l||!on||set.has(tag)) continue; ESS.Pid.setTracking(l,target,reason(),kind); set.add(tag); }
    for(const tag of ['FIC102','FIC211','TIC213','TIC311']) if(!set.has(tag)&&L[tag]) ESS.Pid.clearTracking(L[tag]);
    return set;
  }
```

In `advanceScan`, insert `this.forcedOutputs();` on its own line immediately after `this.measure();`.

In `operatorMayWrite` (line 1448 area), add the interlock refusal as the first check after the kind guard:

```js
  operatorMayWrite(tag,param){
    const l=this.L[tag]; if(!l||l.kind!=='pid') return true;
    if(param==='OP' && l.trk && l.trk.on && l.trk.kind==='interlock'){ this.rejectWrite(tag,'OUTPUT INTERLOCKED — '+l.trk.reason); this.msgZone('ENTRY REJECTED — OUTPUT INTERLOCKED ('+l.trk.reason+')'); return false; }
    if(this.interlockOwns(tag,param)){ this.rejectWrite(tag,'TI216 URGENT INTERLOCK — '+param+' HELD BY SHED (MAN, OP 0)'); return false; }
    if(ESS.Pid.canOperatorWrite(l,param)) return true;
    this.rejectWrite(tag,ESS.Pid.writeDenial(l,param));
    return false;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: PASS. If the D1 restart test reports a flow above 80.5, read the printed value: the harness measurement of 2026-10-03 gave 79.5 with tracking at 0; a higher value means tracking released early or `safeop` is not 0 for FIC102.

- [ ] **Step 5: Build, full suite, smoke, record the movers, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok|^# (pass|fail)' && tools/smoke.sh`
Expected: the Task 3 set plus `upset-pump`, `drill-D3`, and runs where the R-201 trip held FIC102 (spec §11); the M202-trip test in `tests/app-models.test.js` stays green (FIC211 tracks only under `trips.batch`, never on HOLD). Anything else is a defect in this task.

```bash
git add src/plant-core.js tests/app-credibility-s1.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(core): the plant decides who tracks: a stopped pump or a trip holds the loop's output honestly" -m "D1 and D10 (spec §3.2-3.3). forcedOutputs() each tick from the code's trip flags; OP entries under an interlock are refused and journaled as WRITE REJECTED. Goldens moving here, re-captured in the S1 closing task: <list the not-ok golden names here>. Tests: tests/app-credibility-s1.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 7: The flag beside the mode line, INITMAN at a limit, and the cascade-return clamp (D8, D10 indication)

**Files:**
- Modify: `src/plant-core.js` (`setMode` at line 1007; new `flagText`, `casRange` beside `pvShown`)
- Modify: `Experion Station Simulator.dc.html` (faceplate line 4000 `initT`, Point Detail cascade row line 3874)
- Test: `tests/app-credibility-s1.test.js`

**Interfaces:**
- Consumes: `l.trk`, `l.init`, `ESS.Pid.tracking`, `this.pidCtx().casMap`.
- Produces: `Component.prototype.flagText(l) -> string` (`''`, `INITMAN`, `INITMAN · OP AT HI LIMIT`, `INITMAN · OP AT LO LIMIT`, `INTERLOCK · <reason>`, `TRACK · <reason>`, or `NOTE · <reason>` for a device hold the operator has overridden in MAN), `casRange(slaveTag) -> string` such as `10.0–70.0 DEG C`; a CAS return that lands on a pinned primary journals `SP CLAMPED TO CASCADE RANGE` with the new setpoint.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s1.test.js`:

```js
test('the flag names the hold: TRACK while the pump is stopped, NOTE when the operator overrides it in MAN, INTERLOCK under a trip', () => {
  const c = boot(4, 'OPER');
  assert.equal(c.flagText(c.L.FIC102), '');
  c.motorCmd('P101', false); c.step(0.5);
  assert.equal(c.flagText(c.L.FIC102), 'TRACK · P-101 STOPPED');
  assert.equal(c.flagText(c.L.LIC101), 'INITMAN');
  c.setMode('FIC102', 'MAN'); c.step(0.5);
  assert.equal(c.flagText(c.L.FIC102), 'NOTE · P-101 STOPPED');
  const d = boot(4, 'OPER');
  loseCooling(d);
  assert.ok(run(d, 2400, () => d.P.trips.rx));
  assert.equal(d.flagText(d.L.FIC102), 'INTERLOCK · R-201 HI TEMP TRIP');
  d.setMode('FIC102', 'MAN'); d.step(0.5);
  assert.equal(d.flagText(d.L.FIC102), 'INTERLOCK · R-201 HI TEMP TRIP', 'an interlock holds in MAN too');
});

test('D8: a secondary setpoint beyond the cascade range pins the primary, the flag says so, and the CAS return journals the clamp', () => {
  const c = boot(4, 'OPER');
  run(c, 30);
  c.setMode('TIC202', 'AUTO');
  assert.equal(c.storeEntry('TIC202', 'SP', 75), true);
  run(c, 5);
  assert.equal(c.L.TIC201.init, true);
  assert.equal(c.L.TIC201.op, 100);
  assert.equal(c.flagText(c.L.TIC201), 'INITMAN · OP AT HI LIMIT');
  assert.equal(c.casRange('TIC202'), '10.0–70.0 DEG C');
  c.setMode('TIC202', 'CAS');
  assert.equal(c.L.TIC202.sp, 70);
  const ev = c.events.find((e) => e.src === 'TIC202' && e.desc === 'SP CLAMPED TO CASCADE RANGE');
  assert.ok(ev, 'the clamp is journaled');
  assert.equal(ev.newV, '70.0');
  assert.match(c.state.msg, /SP CLAMPED TO CASCADE RANGE 70\.0 DEG C/);
});

test('a CAS return inside the cascade range journals no clamp', () => {
  const c = boot(4, 'OPER');
  run(c, 30);
  c.setMode('TIC202', 'AUTO');
  c.storeEntry('TIC202', 'SP', 40);
  run(c, 5);
  c.setMode('TIC202', 'CAS');
  assert.ok(!c.events.some((e) => e.desc === 'SP CLAMPED TO CASCADE RANGE'));
});

test('the faceplate and the Point Detail carry the flag', () => {
  const c = boot(4, 'OPER');
  c.motorCmd('P101', false); c.step(0.5);
  c.nav('detail', 'FIC102');
  const v = c.renderVals();
  const casc = v.dpt.mainRows.find((r) => r.param === 'CASC');
  assert.equal(casc.note, 'TRACK · P-101 STOPPED');
  c.nav('detail', 'TIC201');
  const casc2 = c.renderVals().dpt.mainRows.find((r) => r.param === 'CASC');
  assert.match(casc2.value, /PRIMARY OF TIC202 · COMMANDS SP 10\.0–70\.0 DEG C/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: FAIL, `c.flagText is not a function`.

- [ ] **Step 3: Implement the helpers and the clamp journal**

In `src/plant-core.js`, beside `pvShown`:

```js
  // One flag beside the mode line (spec §3.4): what holds this loop and why.
  flagText(l){
    if(l.trk&&l.trk.on){
      if(ESS.Pid.tracking(l)) return (l.trk.kind==='interlock'?'INTERLOCK · ':'TRACK · ')+l.trk.reason;
      return 'NOTE · '+l.trk.reason;
    }
    if(l.init){
      if(l.op>=l.ophilm-0.2) return 'INITMAN · OP AT HI LIMIT';
      if(l.op<=l.oplolm+0.2) return 'INITMAN · OP AT LO LIMIT';
      return 'INITMAN';
    }
    return '';
  }
  // The setpoint span a primary can command on its secondary, from the cascade map, inside the
  // secondary's own SP limits (spec §3.5).
  casRange(slaveTag){
    const ctx=this.pidCtx(), f=ctx.casMap[slaveTag], s=this.L[slaveTag];
    if(!f||!s) return '';
    const a=f(0), b=f(100), lo=Math.max(Math.min(a,b), s.splolm!=null?s.splolm:s.lo), hi=Math.min(Math.max(a,b), s.sphilm!=null?s.sphilm:s.hi);
    return this.fmt(lo,s.dec)+'–'+this.fmt(hi,s.dec)+' '+s.eu;
  }
```

In `setMode` (line 1007), detect the pinned primary before the transfer and journal after it:

```js
  setMode(tag,m){
    const l=this.L[tag];
    if(!this.can('OPER')) return;
    if(!this.operatorMayWrite(tag,'MODE')) return;
    if(l.mode===m) return;
    const master=l.master?this.L[l.master]:null;
    const pinned=m==='CAS'&&master&&master.init&&(master.op>=master.ophilm-0.2||master.op<=master.oplolm+0.2);
    const spBefore=l.sp;
    const r=ESS.Pid.transferMode(l,m,this.pidCtx());   // bumpless: integrator re-initialised so the first output equals the current OP
    if(!r.ok){ this.msgZone(r.reason); return; }
    this.addEvent('OPERATOR',tag,'MODE CHANGE','',''); this.events[0].oldV=r.from; this.events[0].newV=m;
    if(pinned&&Math.abs(l.sp-spBefore)>1e-9){ this.addEvent('SYSTEM',tag,'SP CLAMPED TO CASCADE RANGE',this.fmt(spBefore,l.dec),this.fmt(l.sp,l.dec)); this.msgZone('SP CLAMPED TO CASCADE RANGE '+this.fmt(l.sp,l.dec)+' '+l.eu); }
```

(keep the rest of `setMode` exactly as it is after the MODE CHANGE event.)

- [ ] **Step 4: Route the page through the helpers**

In `Experion Station Simulator.dc.html`:
- Faceplate (line 4000): replace `initT:l.init?'INITMAN':''` with `initT:this.flagText(l)`.
- Point Detail cascade row (line 3874): replace with
  `mRow('Cascade','CASC',dl.master?('SECONDARY OF '+dl.master):(dl.slave?('PRIMARY OF '+dl.slave+' · COMMANDS SP '+this.casRange(dl.slave)):'NONE'),false,this.flagText(dl))`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s1.test.js`
Expected: PASS.

- [ ] **Step 6: Build, full suite, smoke, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok|^# (pass|fail)' && tools/smoke.sh`
Expected: the Task 6 golden set only; smoke ok. In a browser: stop P-101 and open the FIC102 faceplate: `TRACK · P-101 STOPPED` sits where INITMAN used to.

```bash
git add src/plant-core.js "Experion Station Simulator.dc.html" tests/app-credibility-s1.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(hmi): one flag names what holds a loop; INITMAN says when it is at a limit; a clamped CAS return is journaled" -m "D8 indication and D10 indication (spec §3.4-3.5). Tests: tests/app-credibility-s1.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 8: The ladder tells the truth about the trip, and the debrief states the margin (D9)

**Files:**
- Modify: `src/plant-core.js` (new `tripOfPoint`, `tripLimitOf` beside `tripPointOf` at line 1000 area)
- Modify: `src/kpi.js` (the `trip` row of `scoreDrill`, line 233)
- Modify: `Experion Station Simulator.dc.html` (Point Detail `limitRows` lines 3917-3926; `scoreDrill` wrapper line 2922)
- Test: `tests/app-credibility-s1.test.js`, `tests/kpi.test.js`

**Interfaces:**
- Consumes: `ESS.CauseEffect.causes()`, `ESS.AlarmHelp.EQUIPMENT_TRIPS`, the drill definition's `trips` list and `peak` key, `m.peak` captured in `drillWatch`.
- Produces: `Component.prototype.tripOfPoint(tag) -> {id, src, cond, value, eu} | null`, `tripLimitOf(def) -> {value, eu} | null`; `ESS.Kpi.scoreDrill` reads `m.peak` and `m.tripLimit` for the trip row's note.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s1.test.js`:

```js
test('D9: a point with a configured trip knows its trip from the W2 declaration, and the two declarations agree', () => {
  const c = boot(4);
  const t = c.tripOfPoint('TIC201');
  assert.deepEqual(t, { id: 'R201_HITEMP', src: 'R-201', cond: 'HI TEMP TRIP', value: 185, eu: 'DEG C' });
  for (const tag of ['TIC201', 'LIC101', 'PIC401', 'TIC212', 'PIC505']) {
    const x = c.tripOfPoint(tag);
    assert.ok(x, tag);
    assert.equal(x.value, AlarmHelp.EQUIPMENT_TRIPS[x.src + '.' + x.cond].value, tag + ': the C&E threshold and the alarm-help trip table agree');
  }
  assert.equal(c.tripOfPoint('FIC102'), null);
});

test('D9: the Point Detail ladder labels PVHH a pre-trip alarm and shows the declared trip row', () => {
  const c = boot(4);
  c.nav('detail', 'TIC201');
  const rows = c.renderVals().dpt.limitRows;
  const hh = rows.find((r) => r.param === 'PVHH');
  assert.match(hh.note, /^pre-trip alarm/);
  const trip = rows.find((r) => r.param === 'TRIP');
  assert.ok(trip, 'a trip row exists');
  assert.equal(trip.value, '185.0 DEG C');
  assert.match(trip.note, /R-201 HI TEMP TRIP/);
  assert.equal(rows.indexOf(trip), 1, 'the trip row sits just below the range');
  c.nav('detail', 'FIC102');
  assert.ok(!c.renderVals().dpt.limitRows.some((r) => r.param === 'TRIP'), 'no invented trip row');
});

test('D9: the drill scorer states the margin to the declared trip point', () => {
  const c = boot(4);
  assert.deepEqual(c.tripLimitOf(c.drillDefs().find((d) => d.id === 'D4')), { value: 185, eu: 'DEG C' });
  assert.equal(c.tripLimitOf(c.drillDefs().find((d) => d.id === 'D1')), null);
});
```

Append to `tests/kpi.test.js` (`scoreDrill(m, rubric)` merges the rubric over its defaults, so `{}` is a complete rubric):

```js
test('the trip row names the peak against the declared trip point when both are known', () => {
  const Kpi = require('../src/kpi.js');
  const base = { tAlarm: 0, tAck: 5000, tAct: 20000, tStable: 90000, trip: false, otherTrips: 0, actionCorrect: true, quizCorrect: true, alarmsPer10min: 1 };
  const plain = Kpi.scoreDrill(base, {}).rows.find((r) => r.id === 'trip');
  assert.equal(plain.note, 'no trip');
  const withMargin = Kpi.scoreDrill({ ...base, peak: 183.7, tripLimit: { value: 185, eu: 'DEG C' } }, {}).rows.find((r) => r.id === 'trip');
  assert.equal(withMargin.note, 'no trip · peak 183.7 DEG C vs trip 185 DEG C');
  const tripped = Kpi.scoreDrill({ ...base, trip: true, peak: 186, tripLimit: { value: 185, eu: 'DEG C' } }, {}).rows.find((r) => r.id === 'trip');
  assert.equal(tripped.note, 'unit tripped');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s1.test.js tests/kpi.test.js`
Expected: FAIL, `c.tripOfPoint is not a function`; the margin note equals `no trip`.

- [ ] **Step 3: Implement**

In `src/plant-core.js`, beside `tripPointOf`:

```js
  // The declared trip behind a point's pre-trip alarm (spec §3.6): read from the W2 declaration
  // so the ladder can never disagree with the code. Points without a declared trip get null.
  tripOfPoint(tag){
    const id=({TIC201:'R201_HITEMP',LIC101:'TK101_HIHI',PIC401:'V401_PSV',TIC212:'R202_HITEMP',PIC505:'V502_PSV'})[tag];
    if(!id||!ESS.CauseEffect) return null;
    const c=ESS.CauseEffect.causes().find(x=>x.id===id);
    return (c&&typeof c.threshold==='number')?{id,src:c.src,cond:c.cond,value:c.threshold,eu:c.eu}:null;
  }
  // The drill's own trip, for the debrief margin: the first key of def.trips that maps to a declared cause.
  tripLimitOf(def){
    const map={rx:'R201_HITEMP',ovf:'TK101_HIHI',psv:'V401_PSV',batch:'R202_HITEMP',bed:'R310_HITEMP',skin:'H310_SKIN'};
    for(const k of (def&&def.trips)||[]){ const c=ESS.CauseEffect&&ESS.CauseEffect.causes().find(x=>x.id===map[k]); if(c&&typeof c.threshold==='number') return {value:c.threshold,eu:c.eu}; }
    return null;
  }
```

In `src/kpi.js` line 233, replace the trip row:

```js
    var tripNote = m.trip ? 'unit tripped'
      : (m.tripLimit && typeof m.peak === 'number') ? 'no trip · peak ' + round(m.peak, 1) + ' ' + m.tripLimit.eu + ' vs trip ' + m.tripLimit.value + ' ' + m.tripLimit.eu
      : 'no trip';
    rows.push({ id: 'trip', label: 'Trip avoided', earned: m.trip ? 0 : W.trip, max: W.trip, note: tripNote });
```

In the page's `scoreDrill(d,ans)` (line 2922), add `peak:m.peak,tripLimit:this.tripLimitOf(d.def),` inside the object literal passed to `ESS.Kpi.scoreDrill`, right after `trip:!!m.trip,`.

In the page's `limitRows` (lines 3917-3926): change the two notes `'trip point · Alarms tab'` to `'pre-trip alarm · Alarms tab'`, and after the array is built add:

```js
      const tp=this.tripOfPoint(dl.tag);
      if(tp) limitRows.splice(1,0,mRow('Trip','TRIP',this.fmt(tp.value,dl.dec)+' '+tp.eu,false,tp.src+' '+tp.cond+' · declared in the C&E matrix, enforced by the plant'));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s1.test.js tests/kpi.test.js tests/app-cause-effect.test.js`
Expected: PASS.

- [ ] **Step 5: Build, full suite, smoke, commit**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok|^# (pass|fail)' && tools/smoke.sh`
Expected: the Task 6 golden set only (the debrief note is not digested); smoke ok.

```bash
git add src/plant-core.js src/kpi.js "Experion Station Simulator.dc.html" tests/app-credibility-s1.test.js tests/kpi.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(hmi): the ladder names the declared trip and calls PVHH a pre-trip alarm; the debrief states the margin" -m "D9 (spec §3.6). Tests: tests/app-credibility-s1.test.js, tests/kpi.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

---

### Task 9: Close the stage: re-capture the movers, guard the archive, changelog, gates

**Files:**
- Modify: `tests/fixtures/*.json`, `tests/fixtures/arch/*.json` (re-captured movers only)
- Modify: `tests/v2-baseline-archive.test.js` (`KNOWN_RECAPTURED`, line 37)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:**
- Consumes: everything above.
- Produces: a green suite at the stage's head, the mover list in the archive guard, the S1 changelog entry.

- [ ] **Step 1: Final build, then list exactly which goldens move**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok'`
Expected: every line is a golden test (`golden upset:`, `golden: drill`, an `arch/A*` fixture, or the archive guard). Write the fixture names down. Compare with spec §11: allowed for S1 are upset-pump, drill-D3, the runs that leave a transmitter range (upset-cool, drill-D4, upset-stick and any other where TIC202 passed 100 °C), and runs where the R-201 trip held FIC102. **A fixture outside that list means a behaviour this stage did not intend to change: stop, find the cause, fix it in the task that introduced it, and only then continue.**

- [ ] **Step 2: Confirm determinism, then re-capture only the movers by name**

Run the movers twice without `UPDATE_GOLDENS` and confirm each failure message says "moved from the committed golden", never "NONDETERMINISM". Then, with the pattern built from the mover names (example for the expected set):

```bash
UPDATE_GOLDENS=1 node --test --test-name-pattern "pump|drill D3|cool|drill D4|stick" tests/golden-upsets.test.js tests/golden-drills.test.js tests/golden-u4.test.js tests/drill-arch-fixtures.test.js
git status --porcelain tests/fixtures
```
Expected: only the mover fixtures changed. If a fixture changed that is not a mover, `git checkout -- <that fixture>` and narrow the pattern.

- [ ] **Step 3: Record each mover in the archive guard with its reason**

Edit `tests/v2-baseline-archive.test.js` line 37 area, keeping the existing three and their comment, and add:

```js
  // 2026-10-<day of the re-capture>, credibility pass S1 (docs/dev/CREDIBILITY-PASS-SPEC.md §11): FIC102 output
  // tracking while P-101 is stopped moved upset-pump and drill-D3 (spec §3.2, D1); transmitter
  // saturation on TIC202 moved <the cooling-loss and stiction runs you measured> (spec §2.4, D7).
  // Measured, not assumed: the list is what Task 9 step 1 printed.
  const KNOWN_RECAPTURED = ['drill-D12.json', 'upset-air.json', 'upset-bedact.json',
    'upset-pump.json', 'drill-D3.json', /* add every measured mover here, one per line */];
```

- [ ] **Step 4: Changelog**

Under `## [Unreleased]` in `CHANGELOG.md`, above the existing G2 entry, add an entry in the house voice. It must say: what the operator sees changed (observed values, saturation at the transmitter limit with a light hatch, flows read 0 below 1 % of span, no negative zero); what the loops do changed (output tracking under a stopped pump and under an interlock, INITMAN for the primary, the flag beside the mode line, OP refused under an interlock, the clamped CAS return journaled); the ladder's trip row and the debrief margin; the decision that the controller sees the saturated value and why (spec §2.4); and the list of goldens that moved with the reason for each. Cite `docs/dev/CREDIBILITY-PASS-SPEC.md` and the playtest report.

- [ ] **Step 5: All three gates, then commit and push**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^# (tests|pass|fail|skipped)' && python3 tools/build-dist.py && git status --porcelain dist/ && tools/smoke.sh`
Expected: `# fail 0`; `dist/` unchanged by the second build; smoke ok on both builds.

```bash
git add tests/fixtures tests/v2-baseline-archive.test.js CHANGELOG.md
git commit -m "test(goldens): re-capture the S1 movers and record each in the archive guard; changelog for the seams" -m "Closes stage S1 of the credibility pass (spec §10). Movers and reasons: <copy the KNOWN_RECAPTURED comment>." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
git push
```

- [ ] **Step 6: Stage receipt**

Record the stage's closing state in the chronicle as the house does (domain `experion-station-sim,credibility-pass,S1,...`): the head commit, the test counts, the mover list, and the browser check of Task 4 and Task 7. S2's plan is written only after this receipt exists.
