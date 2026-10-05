<!-- @artifact dev -->
# Credibility Pass S2 (Sequence and Journal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the batch sequence's HOLD really hold and its ownership honest, and make an initial-condition load keep the session's journal and the station's clock, so the four playtest items D3 to D6 are closed with tests that pin the behaviour.

**Architecture:** Two small seams. In the model, `sequence()` gains a frozen branch (nothing advances while `b.held`) and writes both loops' mode attribute every scan from one rule (PROGRAM while running, OPERATOR while held or idle); the hold state is written once, at the HOLD command, and RESUME re-asserts the phase's setpoints from one table. In the plant core, `applyPreset()` treats the journal as session state (lifted out around the settle, put back, one record appended) and runs the settle so that it *ends* at the requested base time (a dry run measures its length first); the status-bar clock says `SIM` whenever the run control is not at 1×. Nothing else moves: trips, the TI216 shed, replay and the instructor's own snapshots keep today's semantics.

**Tech Stack:** Plain UMD scripts in `src/` (no DOM, timers, network or `Math.random`), the one `.dc.html` page, node 22's built-in test runner with `node:assert/strict`, `tools/logic-harness.js` for app-level tests, `python3 tools/build-dist.py`, `tools/smoke.sh`.

**Spec:** `docs/dev/CREDIBILITY-PASS-SPEC.md`, sections 4 and 5 (stage S2 of §10). Read §0.6 first: rulings CR6 to CR38b from S1 are binding (CR20 and CR34 on tracking, CR35 and CR38/CR38b on stores and replay touch this stage). The playtest items are in `docs/playtest-2026-10-02.md` (D3 at line 92, D4 at 107, D5 at 121, D6 at 135). S1's execution record is `docs/dev/CREDIBILITY-PASS-S1-LEDGER.md`; its lessons are folded into Review Focus below.

**Branch:** `fix/playtest-2026-10` from `adeb18a` (S1 merged into `main` at that commit). `main` moves only on Anthony's word.

## Global Constraints

- No Honeywell, employer or real-site material: parameter and display names are conventions; prose is ours; public sources cited in comments by short name and RESOURCES section (`CLAUDE.md` rule 1, spec §1.2).
- No bundler, no ES modules, no npm dependencies, no network calls; `src/*.js` stay UMD plain scripts with no DOM, timers or globals (`CLAUDE.md` rule 3). The deterministic core never waits on a network or a model.
- Never edit `support.js`; never hand-edit `dist/`. After any change to the app or `src/`, run `python3 tools/build-dist.py` (it restamps `src/model-id.js`); both files travel in the same commit (`CLAUDE.md` rule 2).
- The six trip thresholds stay: 98 % TK-101, 185 °C R-201, 950 kPa V-401, 110 °C R-202, 480 °C R-310 bed, 1100 kPa V-502 (`CLAUDE.md` rule 4).
- Every new file carries `@artifact production` or `@artifact dev` in its first three lines; new tests and `docs/dev/*` are `dev` (`tests/artifact-classes.test.js`).
- Randomness is seeded: `this.rand = ESS.Models.createRand(this.seed)` is the only source; `initSim` re-seeds from `this.instr.seed`, so a dry settle and a real settle of the same preset are identical; never add a `Math.random()` path.
- Tests use exact values wherever the model is deterministic; time advances by `step(0.5)` in a loop, never by timers.
- Gates before every commit (spec §9.4): `node --test tests/*.test.js` (the glob is load-bearing), `python3 tools/build-dist.py`, `tools/smoke.sh` on both builds. Goldens: `tests/fixtures/v31-baseline/` already archives 3.1.0 (CR10, CR31); S2 adds no archive. A golden may be red inside the stage only when it is a named S2 mover (expected: `drill-D11`, `upset-agit-batch`, `arch/A5` for §4 ownership; the 14 arch fixtures for §5.2 if their retained event count reads the session journal), and Task 6 re-captures exactly the measured set with a reason per fixture in both guards. **Never run `tests/golden-u4.test.js` under `UPDATE_GOLDENS=1`** (it writes unconditionally and restamps fixtures the guard proves unchanged).
- Replay is a record, not a gate (CR38): any store that gains a check must still replay what the live run accepted; `tests/release-gates.test.js` gate 3 and the replay test files stay green at every commit.
- Spec §4.2 says an operator write under PROGRAM is "refused with the existing mode-attribute message and nothing is journaled". Ruling carried from S1 (§3.3, CR-style): the refusal path is `rejectWrite`, which records one `WRITE REJECTED — MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE` event; "nothing is journaled" means no `SP CHANGE` record. Tests pin exactly that; Task 6 words §4.2 the same way.
- Commit messages: conventional subject, a body that says why and names the covering tests, the repo's two trailers (`Co-Authored-By: Claude <model name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_<id>`). Stage files by name; the untracked `NIGHT PREVIEW.dc.html` is never staged. Implementers do not push.

## Review Focus

S1's late Critical and Important findings all sat in surfaces no task listed: a Live Diagnosis card, ALARM HELP strings, the governed control contract and a store with no gate. For S2 every other *writer* of a value a task changes, and every other *teller* of a behaviour a task changes, is named here and pinned by a test in the owning task.

1. **Other writers of FIC211 and TIC212 setpoints and attributes.** `seqCmd('ABORT')` writes `FIC211.sp = 0` and `TIC212.sp = 40`; the R-202 trip in `batchReactor()` forces COOL and `TIC212.sp = 40`; `latchTadShed`/`enforceTadShed` force FIC211 to MAN, OP 0, SP 0 and set `b.held` directly; `scmRestoreModes()` returns a PROGRAM-owned FIC211 to AUTO; the governed `sequence.command` path (`src/control-contract.js:90-92`) maps RESUME to `seqCmd('HOLD')` while held; S1's `forcedOutputs()` holds both loops under the batch trip. A reasonable operator expects every one of these to keep working under the new HOLD and ownership rule. Pinned in Task 2 (ABORT during a hold, the trip during a hold, the shed during a hold, the governed RESUME).
2. **Other tellers of HOLD and ownership.** The U2 banner (`HELD · <phase>`), the HOLD button (`holdT`), the Point Detail MODEATTR row note, the Live Diagnosis cards that say "HOLD the sequence" (`mtrip.M202`, `risk.acc`, `shed.tad`), ALARM HELP for TI216 and M202, and the help answers. They must agree with the attribute and the button in each state (running, held, shed-held). Pinned in Task 2 (banner, button and attribute in the three states; the cards and help strings grepped for "HOLD" and re-read, with the test asserting the M202 card still says HOLD the sequence).
3. **Other readers of the session journal across an IC load.** The Event Summary's relative times (`rel: e.t - t0`), the KPI window (`alarmLog`, `t0`), the debrief timeline (`src/debrief.js` reads `events`), the instructor's ring and slot snapshots (`restoreSnapshot` trims `events` by time and the journal by sequence), the snapshot's `eventsCount` receipt, and System Status uptime (`P.up`, process uptime, which resets with the IC by design). Pinned in Task 3 (ids unique and `eid` continuing; `t0` and `alarmLog` surviving; a slot saved before a load still rewinds to the slot's time after it; the debrief timeline building after a load).
4. **Times before the session start.** With the settle ending at the base time, the settle's alarms carry raise times before `t0` (and, in the harness where `P.t` starts at 0, negative times). `fT()` formats a negative millisecond value as a clock time; the Alarm Summary's time column, the ring's 10-minute floor, the trend trimming in `restoreSnapshot` and replay's `P.t !== e.t` check must all tolerate it. Pinned in Task 4 (a canonical start at `P.t = 0`; every active alarm's raise time inside `[base − length, base]`; no NaN in the Alarm Summary rows; the replay gate files green).
5. **Every path that changes the run speed.** `setSpeed`, `freeze`, `stepOnce` (sets speed 0), the instructor's RUN/FREEZE chips, the CLI and governed speed commands, and `tick()` itself. The status-bar clock must read `SIM hh:mm:ss` on every one of them when the speed is not 1, and never on a wall-clock read. Pinned in Task 5 (speeds 0, 1, 2 and 4 through `setSpeed`, `freeze` and `stepOnce`; the instructor run line unchanged; `grep -c "Date.now" src/*.js` stays at its S1 count).

---

## File structure

| File | Responsibility in S2 |
|---|---|
| `src/models.js` | `sequence()`: frozen branch while held, one ownership rule for both loops; `phaseSetpoints(b, P)`: the setpoints the sequence owns per phase (exported) |
| `src/plant-core.js` | `seqCmd`: hold state written once at HOLD, RESUME re-asserts the phase setpoints; `settle(p, atTime)`: a preset's settle from a clock; `applyPreset`: journal scope rule, dry settle, `(SETTLED n S)` record, refusal; `startDrill`: the canonical `DRILL … STARTED` record |
| `Experion Station Simulator.dc.html` | the IC menu passes the sim clock as base time; `timeT` reads `SIM hh:mm:ss` off 1×; the width of the clock cell |
| `tests/models.test.js` | module tests for the frozen hold, the ownership rule and the setpoint table |
| `tests/app-credibility-s2.test.js` | new: D3, D4, D5, D6 app tests and the Review Focus pins |
| `tests/app-instructor.test.js`, `tests/app-models.test.js` | existing assertions updated only where they encoded the old behaviour (noted in the task) |
| `tests/v2-baseline-archive.test.js`, `tests/fixtures/*.json`, `tests/fixtures/arch/*.json` | Task 6: the measured S2 movers re-captured, each with its reason in both guards |
| `CHANGELOG.md`, `docs/dev/CODE-MAP.md`, `docs/dev/CREDIBILITY-PASS-SPEC.md` §4.2 and §11, this plan's as-built notes | Task 6 docs pass |

---

### Task 1: HOLD freezes the sequence and ownership is one rule (model)

**Files:**
- Modify: `src/models.js:458-472` (`sequence`), `src/models.js:759` (exports)
- Test: `tests/models.test.js` (append)

**Interfaces:**
- Consumes: `P.b` (`phase`, `pt`, `lvl`, `held`, `T`, `Cm`), `P.trips.batch`, `L.FIC211`, `L.TIC212`, `ctx.addEvent`.
- Produces: `Models.phaseSetpoints(b, P) -> { FIC211: number, TIC212: number|null }` (FIC211: 20 in FEED, 0 under the batch trip or in any other phase; TIC212: 80 in HEATUP, FEED, REACT; 40 in COOL, DRAIN; null in CHARGE and IDLE, where the sequence leaves the jacket loop in MAN). `sequence()` writes `L.FIC211.modeAttr` and `L.TIC212.modeAttr` every scan: `'PROGRAM'` while the phase is not IDLE and `b.held` is false, else `'OPERATOR'`. While `b.held` it returns before the timer, the transitions, the charge and drain level changes and the setpoint writes. Task 2's `seqCmd` reads `phaseSetpoints` on RESUME.

- [ ] **Step 1: Write the failing tests**

Append to `tests/models.test.js` (it already defines `rig(seed)` returning `{ c, tick }`; `c.seqCmd('START', true)` starts a batch silently on the rig's own `P`):

```js
// ---- credibility pass S2: HOLD freezes, ownership is one rule (spec §4.1, §4.2; playtest D3, D6) ----

test('phaseSetpoints: the sequence owns FIC211 20 in FEED (0 under the batch trip) and 0 elsewhere; TIC212 80 in HEATUP/FEED/REACT, 40 in COOL/DRAIN, none in CHARGE/IDLE', () => {
  const P = Models.createState(0);
  const at = (phase, trip) => { P.b.phase = phase; P.trips.batch = !!trip; return Models.phaseSetpoints(P.b, P); };
  assert.deepEqual(at('IDLE'), { FIC211: 0, TIC212: null });
  assert.deepEqual(at('CHARGE'), { FIC211: 0, TIC212: null });
  assert.deepEqual(at('HEATUP'), { FIC211: 0, TIC212: 80 });
  assert.deepEqual(at('FEED'), { FIC211: 20, TIC212: 80 });
  assert.deepEqual(at('FEED', true), { FIC211: 0, TIC212: 80 });
  assert.deepEqual(at('REACT'), { FIC211: 0, TIC212: 80 });
  assert.deepEqual(at('COOL'), { FIC211: 0, TIC212: 40 });
  assert.deepEqual(at('DRAIN'), { FIC211: 0, TIC212: 40 });
});

test('HOLD during CHARGE freezes the sequence: timer, level and phase unchanged over 120 s, no PHASE event; the first scan after RESUME continues from where it stopped (D3, spec 4.1)', () => {
  const { c, tick } = rig(4);
  c.seqCmd('START', true);
  for (let i = 0; i < 20; i++) tick();                 // 10 s into CHARGE: level 12 + 5
  assert.equal(c.P.b.phase, 'CHARGE');
  assert.equal(c.P.b.pt, 10);
  assert.equal(c.P.b.lvl, 17);
  const phaseEvents = () => c.events.filter((e) => /PHASE →/.test(e.desc)).length;
  const n = phaseEvents();
  c.P.b.held = true;
  for (let i = 0; i < 240; i++) tick();                // 120 s held
  assert.equal(c.P.b.phase, 'CHARGE');
  assert.equal(c.P.b.pt, 10, 'the phase timer does not advance while held');
  assert.equal(c.P.b.lvl, 17, 'CHARGE does not raise the level while held');
  assert.equal(phaseEvents(), n, 'no transition fires while held');
  c.P.b.held = false;
  tick();
  assert.equal(c.P.b.pt, 10.5);
  assert.equal(c.P.b.lvl, 17.25);
});

test('HOLD during DRAIN freezes the drain: the level does not fall and IDLE is not reached while held', () => {
  const { c, tick } = rig(4);
  c.seqCmd('START', true);
  c.P.b.phase = 'DRAIN'; c.P.b.pt = 0; c.P.b.lvl = 30; c.P.b.held = true;
  for (let i = 0; i < 100; i++) tick();                // 50 s: a running drain would have reached 10 and gone IDLE
  assert.equal(c.P.b.phase, 'DRAIN');
  assert.equal(c.P.b.lvl, 30);
  c.P.b.held = false;
  tick();
  assert.equal(c.P.b.lvl, 29.6);
});

test('ownership is one rule: PROGRAM on both loops in every active phase while running, OPERATOR one scan after HOLD, PROGRAM one scan after RESUME, OPERATOR when IDLE (D6, spec 4.2)', () => {
  const { c, tick } = rig(4);
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR'); assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  c.seqCmd('START', true); tick();
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'CHARGE is an active phase'); assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  for (const phase of ['HEATUP', 'FEED', 'REACT', 'COOL', 'DRAIN']) {
    c.P.b.phase = phase; c.P.b.pt = 0; c.P.b.lvl = 50; tick();
    assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', phase); assert.equal(c.L.TIC212.modeAttr, 'PROGRAM', phase);
  }
  c.P.b.phase = 'FEED'; c.P.b.lvl = 50;
  c.P.b.held = true;
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'the attribute follows on the next scan');
  tick();
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR'); assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  c.P.b.held = false; tick();
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM'); assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  c.P.b.phase = 'IDLE'; tick();
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR'); assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
});

test('while held the sequence writes no setpoint: FIC211.sp and TIC212.sp survive the scan; running again it writes the phase feed setpoint', () => {
  const { c, tick } = rig(4);
  c.seqCmd('START', true);
  c.P.b.phase = 'FEED'; c.P.b.pt = 0; c.P.b.lvl = 50; tick();
  assert.equal(c.L.FIC211.sp, 20);
  c.P.b.held = true; tick();
  c.L.FIC211.sp = 5; c.L.TIC212.sp = 77;
  for (let i = 0; i < 20; i++) tick();
  assert.equal(c.L.FIC211.sp, 5, 'an operator setpoint during the hold is honoured');
  assert.equal(c.L.TIC212.sp, 77);
  c.P.b.held = false; tick();
  assert.equal(c.L.FIC211.sp, 20, 'the sequence owns the feed setpoint again');
  assert.equal(c.L.TIC212.sp, 77, 'the model re-asserts the jacket setpoint only at a transition; RESUME (Task 2) re-asserts it from the table');
});

test('the transitions still set the jacket from the table: CHARGE → HEATUP puts TIC212 in AUTO at 80, REACT → COOL at 40', () => {
  const { c, tick } = rig(4);
  c.seqCmd('START', true);
  c.P.b.lvl = 39.9; tick();
  assert.equal(c.P.b.phase, 'HEATUP'); assert.equal(c.L.TIC212.mode, 'AUTO'); assert.equal(c.L.TIC212.sp, 80);
  c.P.b.phase = 'REACT'; c.P.b.Cm = 1; tick();
  assert.equal(c.P.b.phase, 'COOL'); assert.equal(c.L.TIC212.sp, 40);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/models.test.js`
Expected: FAIL. `Models.phaseSetpoints is not a function`; the CHARGE hold test fails at `assert.equal(c.P.b.pt, 10)` after the held window (it reads 130); the ownership test fails at `'CHARGE is an active phase'` (FIC211 reads OPERATOR in CHARGE today); the DRAIN test fails on the level.

- [ ] **Step 3: Implement**

In `src/models.js`, replace `sequence()` (lines 458-472) with:

```js
  // The setpoints the sequence owns per phase (spec §4.1, §4.2): the feed setpoint on every running scan, the
  // jacket setpoint at the transitions that change it; RESUME re-asserts both from here. null means the sequence
  // does not own the value in that phase (CHARGE and IDLE leave TIC212 in MAN).
  function phaseSetpoints(b, P) {
    const feed = b.phase === 'FEED' ? (P.trips.batch ? 0 : 20) : 0;
    const jacket = (b.phase === 'HEATUP' || b.phase === 'FEED' || b.phase === 'REACT') ? 80
      : (b.phase === 'COOL' || b.phase === 'DRAIN') ? 40 : null;
    return { FIC211: feed, TIC212: jacket };
  }

  function sequence(P, L, dt, ctx) {
    const b = P.b;
    const seqOn = b.phase !== 'IDLE';
    // Ownership is honest (spec §4.2): PROGRAM on both loops in every active phase while not held, OPERATOR while
    // held or idle, written every scan so the attribute follows on the scan after HOLD and after RESUME.
    const own = (seqOn && !b.held) ? 'PROGRAM' : 'OPERATOR';
    L.FIC211.modeAttr = own;
    L.TIC212.modeAttr = own;
    // HOLD freezes (spec §4.1): no timer, no transition, no charge or drain, no setpoint write, so a setpoint the
    // operator enters during the hold stands until RESUME re-asserts the phase's values (seqCmd). The hold state
    // itself (feed setpoint 0) is written once, at the HOLD command, not here.
    if (b.held) return;
    b.pt += dt;
    const setPh = (ph) => { b.phase = ph; b.pt = 0; ctx.addEvent('SYSTEM', 'SCM202', 'PHASE → ' + ph, '', ''); };
    if (b.phase === 'CHARGE') { b.lvl += 0.5 * dt; if (b.lvl >= 40) { setPh('HEATUP'); L.TIC212.mode = 'AUTO'; L.TIC212.sp = phaseSetpoints(b, P).TIC212; } }
    else if (b.phase === 'HEATUP') { if (b.T >= 76) setPh('FEED'); }
    else if (b.phase === 'FEED') { if (b.lvl >= 75) setPh('REACT'); }
    else if (b.phase === 'REACT') { if (b.Cm <= 2) { setPh('COOL'); L.TIC212.sp = phaseSetpoints(b, P).TIC212; } }
    else if (b.phase === 'COOL') { if (b.T <= 45) setPh('DRAIN'); }
    else if (b.phase === 'DRAIN') { b.lvl = Math.max(10, b.lvl - 0.8 * dt); if (b.lvl <= 10) { L.TIC212.mode = 'MAN'; L.TIC212.op = 8; setPh('IDLE'); } }
    if (b.phase !== 'IDLE') L.FIC211.sp = phaseSetpoints(b, P).FIC211;
  }
```

Add `phaseSetpoints` to the module's export object on line 759 (`return { createState, …, phaseSetpoints, PARAMS, MODEL_VALVES };`) and to the API comment block near line 14 with one line: `//   phaseSetpoints(b, P)                     the feed and jacket setpoints the sequence owns in b.phase (null: not owned)`.

Note the two moved writes: in the old code `L.TIC212.mode='AUTO'; L.TIC212.sp=80` ran before `setPh('HEATUP')` and `L.TIC212.sp=40` before `setPh('COOL')`; now they run after, because the table reads `b.phase`. No other code runs between the two statements, so the scan's result is identical; the drill goldens that pass through those transitions (D11, agit-batch) are expected movers anyway (§4 ownership), and Task 6 measures the rest.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/models.test.js tests/app-models.test.js`
Expected: the six new tests PASS. In `tests/app-models.test.js` the test at line 339 ("attribute follows on the next scan") still passes. If an existing assertion in that file expects `TIC212.modeAttr === 'PROGRAM'` while the sequence is held (grep `TIC212.modeAttr` and read lines 123 and 153), it encoded the old behaviour: change the expected value to `'OPERATOR'` with a one-line comment naming spec §4.2, and say so in the report.

- [ ] **Step 5: Full suite, build, smoke, commit**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^not ok|^# (tests|pass|fail|skipped)'; python3 tools/build-dist.py; tools/smoke.sh`
Expected: the only red tests are the named S2 movers (`golden: drill D11`, `golden upset: agit-batch`, and the `A5` arch fixture); if anything else is red, stop and report it with the test name and its diff of digests. Smoke ok on both builds.

```bash
git add src/models.js tests/models.test.js tests/app-models.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(models): HOLD freezes the batch sequence; ownership is one rule; the phase setpoints live in one table" -m "Spec 4.1 and 4.2 (playtest D3, D6). Tests: tests/models.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
```

---

### Task 2: The hold state written once, RESUME re-asserts, and the D3/D6 app tests

**Files:**
- Modify: `src/plant-core.js:230` (`seqCmd` HOLD branch)
- Create: `tests/app-credibility-s2.test.js`
- Modify (read, maybe not touched): `Experion Station Simulator.dc.html:4046-4048` (banner and `holdT` already read `HELD · <phase>` and `RESUME`), the help answers and Live Diagnosis cards that mention HOLD (grep `HOLD` in the page's `diagnose()` and help entries)

**Interfaces:**
- Consumes: `Models.phaseSetpoints(b, P)` (Task 1), `this.L.FIC211`, `this.L.TIC212`, `this.addEvent`, `this.dAct`, `this.tadShed`, `this.confirmInterlockHold()`.
- Produces: `seqCmd('HOLD')` toggles `b.held`; on HOLD it writes `L.FIC211.sp = 0` once and records `SEQUENCE HELD — FEED STOPPED`; on RESUME it writes `L.FIC211.sp` and (when owned) `L.TIC212.sp` from `phaseSetpoints` and records `SEQUENCE RESUMED`. The TAD-shed path (`latchTadShed` sets `b.held` directly and `enforceTadShed` writes the shed state every scan) is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/app-credibility-s2.test.js`:

```js
// @artifact dev
// Credibility pass, stage S2: sequence ownership and HOLD, journal and clock continuity (docs/dev/CREDIBILITY-PASS-SPEC.md §4, §5).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Models = require('../src/models.js');

const { Component } = load();
function boot(seed, sec) {
  const c = new Component({});
  c.initSim();
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
const has = (c, src, desc) => c.events.some((e) => e.src === src && e.desc === desc);

test('D3: HOLD during CHARGE freezes the batch: the banner reads HELD · CHARGE, the button reads RESUME, the feed setpoint is written to 0 beside the HELD record, and phase, level and timer are unchanged over 120 s; RESUME continues to HEATUP', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START');
  run(c, 10);
  assert.equal(c.P.b.phase, 'CHARGE');
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0);
  assert.ok(has(c, 'SCM202', 'SEQUENCE HELD — FEED STOPPED'));
  let v = c.renderVals().batch;
  assert.equal(v.phase, 'HELD · CHARGE');
  assert.equal(v.holdT, 'RESUME');
  const pt = c.P.b.pt, lvl = c.P.b.lvl, phaseEvents = c.events.filter((e) => /PHASE →/.test(e.desc)).length;
  run(c, 120);
  assert.equal(c.P.b.phase, 'CHARGE');
  assert.equal(c.P.b.pt, pt);
  assert.equal(c.P.b.lvl, lvl);
  assert.equal(c.renderVals().batch.pt, c.mmss(pt * 1000), 'the timer on the graphic stands still');
  assert.equal(c.events.filter((e) => /PHASE →/.test(e.desc)).length, phaseEvents, 'no PHASE → HEATUP while held');
  c.seqCmd('HOLD');
  assert.ok(has(c, 'SCM202', 'SEQUENCE RESUMED'));
  assert.equal(c.renderVals().batch.holdT, 'HOLD');
  assert.ok(run(c, 400, () => c.P.b.phase === 'HEATUP'), 'the charge continues and completes after RESUME');
});

test('D3: HOLD in FEED stops the monomer feed: the setpoint goes to 0 at the command, the observed flow reaches 0, the level stops rising; RESUME re-asserts 20 and the jacket setpoint', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED');
  c.setState({ sec: 'OPER' });
  assert.equal(c.P.b.phase, 'FEED');
  assert.equal(c.L.FIC211.sp, 20);
  c.L.TIC212.sp = 78;                    // an engineer-trimmed jacket setpoint: RESUME re-asserts the phase's 80
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0);
  run(c, 30);
  assert.equal(c.pvShown(c.L.FIC211), 0, 'the feed flow reads zero through the low-flow cutoff');
  const lvl = c.P.b.lvl;
  run(c, 60);
  assert.equal(c.P.b.lvl, lvl, 'no monomer accumulates while held');
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 20);
  assert.equal(c.L.TIC212.sp, 80);
});

test('D6: the sequence owns FIC211 and TIC212 in CHARGE: an operator SP is refused with the PROGRAM message and only the refusal is journaled; on HOLD both are OPERATOR on the next scan and an SP entered during the hold is held until RESUME re-asserts the phase value', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START'); c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  const before = c.events.length;
  assert.equal(c.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(c.L.FIC211.sp, 0);
  assert.equal(c.state.msg, 'FIC211: MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.equal(c.events.length, before + 1);
  assert.equal(c.events[0].desc, 'WRITE REJECTED — MODE ATTRIBUTE PROGRAM — SP OWNED BY SEQUENCE');
  assert.ok(!c.events.some((e) => e.src === 'FIC211' && e.desc === 'SP CHANGE'), 'no change is journaled');
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'the attribute follows on the next scan');
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  assert.equal(c.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(c.L.FIC211.sp, 5);
  assert.ok(has(c, 'FIC211', 'SP CHANGE'));
  run(c, 30);
  assert.equal(c.L.FIC211.sp, 5, 'held: the sequence does not overwrite the operator setpoint');
  c.seqCmd('HOLD');
  assert.equal(c.L.FIC211.sp, 0, 'RESUME in CHARGE re-asserts the phase feed setpoint');
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
});

test('§4.3: under the R-202 trip both batch loops carry INTERLOCK · R-202 HI TEMP TRIP and the feed setpoint is 0, held or not', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_REACT');
  c.setState({ sec: 'OPER' });
  c.seqCmd('HOLD');
  c.P.b.T = 112; c.step(0.5);
  assert.equal(c.P.trips.batch, true);
  assert.equal(c.P.b.phase, 'COOL', 'the trip forces COOL even from a hold');
  assert.equal(c.flagText(c.L.FIC211), 'INTERLOCK · R-202 HI TEMP TRIP');
  assert.equal(c.flagText(c.L.TIC213), 'INTERLOCK · R-202 HI TEMP TRIP');
  assert.equal(c.L.FIC211.sp, 0);
});

// Review Focus 1: every other writer of the two loops keeps working under the new rule.
test('other writers: ABORT during a hold cools and clears the hold; the TI216 shed during FEED holds and keeps writing the shed state; the governed RESUME is the HOLD toggle', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED');
  c.setState({ sec: 'OPER' });
  c.seqCmd('HOLD');
  c.seqCmd('ABORT');
  assert.equal(c.P.b.phase, 'COOL'); assert.equal(c.P.b.held, false);
  assert.equal(c.L.FIC211.sp, 0); assert.equal(c.L.TIC212.sp, 40);
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'COOL is an active phase');

  const d = boot(4, 'OPER');
  d.applyPreset('U2_FEED');
  d.setState({ sec: 'OPER' });
  d.latchTadShed();
  assert.equal(d.P.b.held, true); assert.equal(d.tadShed, true);
  d.step(0.5);
  assert.equal(d.L.FIC211.modeAttr, 'OPERATOR');
  assert.equal(d.L.FIC211.mode, 'MAN'); assert.equal(d.L.FIC211.sp, 0); assert.equal(d.L.FIC211.op, 0);
  assert.equal(d.renderVals().batch.holdT, 'HOLD', 'RESUME is not offered while the interlock holds the sequence');
  assert.equal(d.storeEntry('FIC211', 'SP', 5), true);
  assert.equal(d.L.FIC211.sp, 0, 'the shed owns the setpoint');
});

// Review Focus 2: the tellers agree with the attribute and the button in each state.
test('tellers agree: banner, button and attribute in the running, held and shed-held states; the M202 card still says HOLD the sequence', () => {
  const c = boot(4, 'OPER');
  c.applyPreset('U2_FEED'); c.setState({ sec: 'OPER' }); c.step(0.5);
  let v = c.renderVals().batch;
  assert.equal(v.phase, 'FEED'); assert.equal(v.holdT, 'HOLD'); assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  c.seqCmd('HOLD'); c.step(0.5);
  v = c.renderVals().batch;
  assert.equal(v.phase, 'HELD · FEED'); assert.equal(v.holdT, 'RESUME'); assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
  c.nav('detail', 'FIC211');
  const attr = c.renderVals().dpt.mainRows.find((r) => r.param === 'MODEATTR');
  assert.equal(attr.value, 'OPERATOR');
  assert.equal(attr.note, 'operator may store SP/OP/MODE');
  c.seqCmd('HOLD'); c.step(0.5);
  c.nav('detail', 'FIC211');
  assert.equal(c.renderVals().dpt.mainRows.find((r) => r.param === 'MODEATTR').note, 'sequence owns SP/OP/MODE — operator stores are rejected');
  c.injectFault('agit', true); c.step(0.5);
  const card = c.diagnose().find((i) => i.id === 'mtrip.M202');
  assert.ok(card); assert.match(card.steps[0].t, /HOLD the sequence/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s2.test.js`
Expected: the D3 CHARGE test fails at `assert.equal(c.L.FIC211.sp, 0)` only if CHARGE's feed setpoint was not 0 already (it is 0 in CHARGE, so the first failing assertion is the `SEQUENCE RESUMED` jacket re-assert in the FEED test, `assert.equal(c.L.TIC212.sp, 80)`); the D6 test fails at `assert.equal(c.L.FIC211.sp, 0, 'RESUME in CHARGE re-asserts…')` only after Task 1 made the hold honour the operator's 5 (before Task 2, RESUME does not write). Record which assertions failed in the report.

- [ ] **Step 3: Implement the HOLD branch**

In `src/plant-core.js`, replace the `if(cmd==='HOLD'){ … }` line (line 230) with:

```js
    if(cmd==='HOLD'){
      if(b.phase==='IDLE'){ this.msgZone('SEQUENCE IS IDLE'); return; }
      if(!this.can('OPER')) return;
      if(b.held && this.tadShed){ this.confirmInterlockHold(); return; }
      b.held=!b.held;
      if(b.held){
        // Equipment goes to its hold state once, here (spec §4.1): the feed setpoint to 0 beside the record that says
        // so. The jacket keeps holding temperature at its current setpoint; sequence() writes nothing while held.
        this.L.FIC211.sp=0;
        this.addEvent('OPERATOR','SCM202','SEQUENCE HELD — FEED STOPPED','','');
      } else {
        // RESUME re-asserts the phase's setpoints (spec §4.1): a setpoint the operator entered during the hold was
        // the operator's until here and is the sequence's again from here.
        const sp=ESS.Models.phaseSetpoints(b,this.P);
        this.L.FIC211.sp=sp.FIC211;
        if(sp.TIC212!=null) this.L.TIC212.sp=sp.TIC212;
        this.addEvent('OPERATOR','SCM202','SEQUENCE RESUMED','','');
      }
      this.dAct('HOLD','SCM202','',0);
    }
```

`ESS.Models` is in scope in `plant-core.js` the same way `ESS.Models.createRand` is at line 131.

Then grep the page for the help answers and Live Diagnosis text about HOLD (`grep -n "HOLD" "Experion Station Simulator.dc.html" | grep -v "holdCb\|holdT\|HOLD CONFIRMED"`) and `src/alarm-help.js` for TI216 and M202. Where a sentence describes the old behaviour (a hold that lets the phase run on, or FIC211 as OPERATOR-owned during a running batch), reword it to the new one in the house voice; where it already says "HOLD the sequence" it stays. List every string you changed in the report.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s2.test.js tests/app-models.test.js tests/rt-kernel.test.js`
Expected: PASS. The TI216 tests in `tests/app-models.test.js` (lines 231-260) and the governed `sequence.command` tests in `tests/rt-kernel.test.js` (line 61) still pass: the shed path and the RESUME → `seqCmd('HOLD')` mapping are untouched.

- [ ] **Step 5: Full suite, build, smoke, commit**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^not ok|^# (tests|pass|fail|skipped)'; python3 tools/build-dist.py; tools/smoke.sh`
Expected: the same named movers as Task 1 and nothing else; smoke ok on both builds. In a browser: U2, START BATCH, HOLD within ten seconds; LI215, the phase timer and JV-213 stand still; the button reads RESUME.

```bash
git add src/plant-core.js "Experion Station Simulator.dc.html" src/alarm-help.js tests/app-credibility-s2.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(seq): HOLD writes the hold state once and RESUME re-asserts the phase setpoints; the operator owns the loops while held" -m "Spec 4.1 to 4.3 (playtest D3, D6). Tests: tests/app-credibility-s2.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
```

(Omit `src/alarm-help.js` and the page from the `git add` if Step 3's grep changed nothing in them.)

---

### Task 3: The journal belongs to the session

**Files:**
- Modify: `src/plant-core.js:1247-1263` (`applyPreset`), `src/plant-core.js:1264-1278` (`startDrill`)
- Test: `tests/app-credibility-s2.test.js` (append), `tests/app-instructor.test.js:234-250` (one assertion may need its count adjusted; see Step 4)

**Interfaces:**
- Consumes: `this.events`, `this.msgs`, `this.alarmLog`, `this.eid`, `this.t0`, `this.initSim`, `this.snapshotData`, `this.restoreSnapshot`, `this.addEvent`, `ESS.Instructor.presets()` entries (`id`, `label`, `set`, `batch`, `waitPhase`, `waitLvl`, `maxRun`, `run`).
- Produces: `Component.prototype.settle(p, atTime) -> { ms: number, seconds: number } | null` (runs a preset's settle from a clock; Task 4 adds the dry run on top); `applyPreset(id, opts)` keeps `{ events, msgs, alarmLog, eid, t0 }` across the load and appends `INITIAL CONDITION LOADED — <LABEL> (SETTLED <n> S)`; `startDrill` with `startMode === 'CANONICAL'` appends a SYSTEM event `DRILL <id> STARTED — <NAME> — CANONICAL` after arming.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s2.test.js`:

```js
test('D4: an initial-condition load keeps the session journal: one record is appended, ids stay unique, eid keeps counting, the KPI history and t0 survive, the settle\'s internal entries are discarded, trends hold only the settle', () => {
  const c = boot(4, 'MNGR');
  run(c, 60);
  c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 40); c.setMode('TIC202', 'AUTO');
  const before = c.events.length, eid = c.eid, t0 = c.t0, log = c.alarmLog.length, first = c.events[c.events.length - 1].id;
  const base = c.P.t;
  c.applyPreset('U1_SS', { baseTime: base });
  assert.equal(c.events.length, before + 1);
  assert.equal(c.events[0].desc, 'INITIAL CONDITION LOADED — U1 STEADY STATE (SETTLED 120 S)');
  assert.equal(c.events[0].type, 'SYSTEM');
  assert.equal(c.events[0].id, eid);
  assert.equal(c.eid, eid + 1);
  assert.equal(new Set(c.events.map((e) => e.id)).size, c.events.length, 'event ids unique');
  assert.equal(c.events[c.events.length - 1].id, first, 'the session\'s first record is still there');
  assert.equal(c.events.filter((e) => /OPERATOR STATION STARTED/.test(e.desc)).length, 1, 'no second station start');
  assert.ok(c.events.some((e) => e.src === 'TIC202' && e.desc === 'OP CHANGE'), 'the operator\'s own actions survive');
  assert.ok(!c.events.some((e) => /^INITIAL CONDITION LOADED: /.test(e.desc)), 'the restore\'s own log line is the instructor\'s, not an event');
  assert.equal(c.t0, t0);
  assert.equal(c.alarmLog.length, log);
  for (const tag of Object.keys(c.hist)) for (const [t] of c.hist[tag]) assert.ok(t >= base - 120000 && t <= base, tag + ': trends reset with the IC and hold only the settle');
});

test('D4: a batch preset load discards the settle\'s PHASE records and keeps the session\'s', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const before = c.events.length;
  c.applyPreset('U2_REACT', { baseTime: c.P.t });
  assert.equal(c.events.length, before + 1);
  assert.ok(!c.events.some((e) => /PHASE →/.test(e.desc)));
  assert.equal(c.P.b.phase, 'REACT');
  assert.match(c.events[0].desc, /^INITIAL CONDITION LOADED — U2 BATCH REACT \(SETTLED \d+ S\)$/);
});

test('D4: a canonical drill start appends a trainee-visible record after the load record and keeps everything before it', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const before = c.events.length;
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'canonical');
  assert.equal(c.events.length, before + 2);
  assert.equal(c.events[1].desc, 'INITIAL CONDITION LOADED — U1 STEADY STATE (SETTLED 120 S)');
  assert.equal(c.events[0].desc, 'DRILL D3 STARTED — FEED PUMP TRIP — CANONICAL');
  assert.equal(c.events[0].type, 'SYSTEM');
  assert.ok(c.state.drill && c.state.drill.startMode === 'CANONICAL');
});

test('a LIVE STATE drill start appends no load record and no canonical record', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const before = c.events.length;
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D3'), 'live');
  assert.equal(c.events.length, before);
});

// Review Focus 3: the other readers of the session journal across a load.
test('other readers: a slot saved before an IC load restores to the slot\'s time (the load lies after it and is rewound away), eid keeps counting after the restore, and the debrief timeline builds', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.saveSlot(1, 'before');
  run(c, 30);
  const base = c.P.t;
  c.applyPreset('U1_SS', { baseTime: base });
  const eid = c.eid;
  c.restoreSlot(1);
  assert.ok(c.events.every((e) => e.t <= c.P.t));
  assert.ok(!c.events.some((e) => /INITIAL CONDITION LOADED/.test(e.desc)), 'the slot predates the load');
  c.setMode('TIC202', 'MAN');
  assert.equal(c.events[0].id, eid, 'eid continues past the restore');
  const d1 = c.drillDefs().find((d) => d.id === 'D1');
  c.startDrill(d1);
  assert.ok(run(c, 900, () => !c.state.drill), 'D1 runs to its debrief');
  assert.equal(c.state.dlg.type, 'debrief');
  assert.doesNotThrow(() => c.renderVals(), 'the debrief renders across the load boundary in the journal');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s2.test.js`
Expected: the first D4 test fails at `assert.equal(c.events.length, before + 1)` (today the load leaves 3 or more records: a second station start, the settle's entries and the load record); the canonical-start test fails on the missing `DRILL D3 STARTED` record.

- [ ] **Step 3: Implement**

In `src/plant-core.js` add `settle()` directly above `applyPreset` and rewrite `applyPreset`:

```js
  // A preset's settle from a clock: initSim at atTime (today's clock when undefined), the preset's point and
  // environment set, the batch run to its phase, then its run-forward. Returns the settle's length; null when the
  // preset is unknown.
  settle(p,atTime){
    this.initSim(typeof atTime==='number'?atTime:undefined);
    const start=this.P.t;
    if(p.set&&p.set.L) for(const tag in p.set.L) Object.assign(this.L[tag],p.set.L[tag]);
    if(p.set&&p.set.env) Object.assign(this.P.env,p.set.env);
    if(p.batch){ this.seqCmd('START',true); const max=(p.maxRun||3600)*2; for(let i=0;i<max;i++){ this.step(0.5); if(this.P.b.phase===p.waitPhase&&(p.waitLvl==null||this.P.b.lvl>=p.waitLvl)) break; } }
    for(let i=0;i<(p.run||0)*2;i++) this.step(0.5);
    const ms=this.P.t-start;
    return {ms,seconds:Math.round(ms/1000)};
  }
  applyPreset(id,opts){
    const p=ESS.Instructor.presets().find(x=>x.id===id); if(!p) return;
    const o=opts||{}, replay=o.preserveReplay?this.instr.replay:null;
    this.instr.replay=null;
    if(this.state.drill) this.setState({drill:null});   // an armed drill must not inject during the run-forward below
    // The journal belongs to the session, not to the process state (spec §5.2): lift it out, let the settle run on
    // a scratch journal, put the session's back after the restore, and record the load as one entry. KPI history
    // (alarmLog, t0) is session state too; trends (hist) are process data and reset with the IC.
    const session={events:this.events,msgs:this.msgs,alarmLog:this.alarmLog,eid:this.eid,t0:this.t0};
    const settled=this.settle(p,o.baseTime);
    const snap=this.snapshotData('IC '+p.label); if(!snap) return;
    this.restoreSnapshot(snap,'INITIAL CONDITION LOADED: '+p.label);
    this.events=session.events; this.msgs=session.msgs; this.alarmLog=session.alarmLog; this.eid=session.eid; this.t0=session.t0;
    this.addEvent('SYSTEM','STN01','INITIAL CONDITION LOADED — '+p.label.toUpperCase()+' (SETTLED '+settled.seconds+' S)','','');
    this.setState({fps:[],unit:p.id.slice(0,2)});
    if(o.preserveReplay) this.instr.replay=replay;
    return true;
  }
```

`restoreSnapshot` still filters the scratch journal by time and trims the instructor journal by sequence (today's semantics for the ring and the slots stay, as §5.2 requires); the session journal replaces the scratch one afterwards, unfiltered, because it predates the load by construction.

In `startDrill`, after `this.journal('DRILL', …)` (line 1275) add:

```js
    if(startMode==='CANONICAL') this.addEvent('SYSTEM','STN01','DRILL '+d.id+' STARTED — '+d.name.toUpperCase()+' — CANONICAL','','');
```

(`d.name` for D3 is `'Feed pump trip'`, so the record reads `DRILL D3 STARTED — FEED PUMP TRIP — CANONICAL`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s2.test.js tests/app-instructor.test.js tests/app-debrief.test.js tests/app-adrill-replay.test.js tests/app-drill-start-ui.test.js tests/release-gates.test.js`
Expected: PASS. `tests/app-instructor.test.js:241` (`/INITIAL CONDITION LOADED/`) still matches the new text. If any test counted the records after a load (grep `events.length` in the replay and drill-start files), it encoded the wipe: adjust the count to the session semantics with a one-line comment naming spec §5.2 and say so in the report.

- [ ] **Step 5: Full suite, build, smoke, commit**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^not ok|^# (tests|pass|fail|skipped)'; python3 tools/build-dist.py; tools/smoke.sh`
Expected: the Task 1 movers plus, if `tests/drill-arch-fixtures.test.js`'s `eventCount` reads the session journal, all 14 arch fixtures (`retained event count moved from the committed fixture`): read `driveDrill` in that file and say in the report which `events` it counts; a physics or health digest moving is NOT expected and stops the task. Smoke ok on both builds. In a browser: operate for a minute, Drills ▸ Start Drill ▸ D4 CANONICAL, open EVENT: the earlier records are still there, with one `INITIAL CONDITION LOADED — U1 STEADY STATE (SETTLED 120 S)` and one `DRILL D4 STARTED — …` above them.

```bash
git add src/plant-core.js tests/app-credibility-s2.test.js tests/app-instructor.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(core): the journal belongs to the session: an initial-condition load keeps it and records itself once; a canonical start says so" -m "Spec 5.1 and 5.2 (playtest D4). Tests: tests/app-credibility-s2.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
```

(Omit `tests/app-instructor.test.js` if Step 4 changed nothing there.)

---

### Task 4: The settle ends at the base time

**Files:**
- Modify: `src/plant-core.js` (`applyPreset`, Task 3's shape), `Experion Station Simulator.dc.html:3481` (the IC menu passes the sim clock)
- Test: `tests/app-credibility-s2.test.js` (append)

**Interfaces:**
- Consumes: `settle(p, atTime)` (Task 3), `this.snapshotData` (its `SNAPSHOT REFUSED` path), `ESS.Instructor.presets()`.
- Produces: `applyPreset(id, { baseTime })` ends the settle exactly at `baseTime` (`this.P.t === baseTime` on return) by running a dry settle from 0 to measure its length and the real one from `baseTime − length`; with no `baseTime` the load is today's (settle from the harness clock 0, or from the page's start clock, ending `length` later), so every existing fixture's physics is unchanged. A dry settle whose state is not finite refuses the load with today's `SNAPSHOT REFUSED` and returns `undefined`. The page's IC menu, canonical drill starts and A-drill starts all pass `baseTime: this.P.t`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s2.test.js`:

```js
test('D5: a canonical drill start leaves the station clock where it was: the settle ends at the base time, and afterwards sim time equals base time plus the steps taken', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const base = c.P.t;
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D4'), 'canonical');
  assert.equal(c.P.t, base);
  run(c, 10);
  assert.equal(c.P.t, base + 10000);
  const ic = c.events.find((e) => /^INITIAL CONDITION LOADED/.test(e.desc));
  assert.equal(ic.t, base);
  assert.equal(c.state.drill.t0, base);
});

test('D5: the settle lands before the base time: an IC with alarms raised during its run-forward carries raise times inside [base − length, base], and the harness\'s zero clock tolerates it (times before the session start)', () => {
  const c = boot(4, 'MNGR');
  const base = c.P.t;                                   // 0 in the harness: the settle runs at negative times
  assert.equal(c.applyPreset('U1_HIFEED', { baseTime: base }), true);
  assert.equal(c.P.t, base);
  const active = c.alarms.filter((a) => a.active);
  assert.ok(active.length > 0, 'U1 high feed settles with R-201 in alarm');
  for (const a of active) {
    assert.ok(a.t >= base - 480000 && a.t <= base, a.key + ' raised during the settle: ' + a.t);
    assert.match(c.fT(a.t), /^\d\d:\d\d:\d\d$/, 'a time before the session start still formats as a clock time');
  }
  assert.doesNotThrow(() => { c.setState({ display: 'alarms' }); c.renderVals(); }, 'the Alarm Summary renders the settle\'s alarms');
});

test('D5: without a base time the load is today\'s: the settle starts at the clock and ends 120 s later (the arch fixtures\' physics is pinned by this)', () => {
  const c = boot(4, 'MNGR');
  c.applyPreset('U1_SS');
  assert.equal(c.P.t, 120000);
  const d = boot(4, 'MNGR');
  d.applyPreset('U1_SS', { baseTime: 120000 });
  assert.equal(d.P.t, 120000);
  assert.deepEqual(d.P.tankL, c.P.tankL);
  assert.deepEqual(d.L.TIC201.pv, c.L.TIC201.pv);
  assert.deepEqual(JSON.stringify(d.P), JSON.stringify(c.P), 'the same base time gives the same plant either way');
});

test('D5: the dry settle is the real settle: two loads of the same preset at the same base time are byte-identical, and a replay of a canonical drill rebuilds at the receipt\'s time', () => {
  const a = boot(4, 'MNGR'); run(a, 30); a.applyPreset('U2_FEED', { baseTime: a.P.t });
  const b = boot(4, 'MNGR'); run(b, 30); b.applyPreset('U2_FEED', { baseTime: b.P.t });
  assert.equal(JSON.stringify(a.P), JSON.stringify(b.P));
  assert.equal(JSON.stringify(a.L), JSON.stringify(b.L));
  const c = boot(4, 'MNGR');
  run(c, 30);
  c.startDrillFromMenu(c.drillDefs().find((d) => d.id === 'D4'), 'canonical');
  const drill = c.instr.journal.find((e) => e.op === 'DRILL');
  assert.equal(drill.presetBaseT, drill.t, 'the DRILL receipt and its own time agree, so replay\'s time check holds');
});

test('§12: a dry settle whose state is not finite refuses the load with SNAPSHOT REFUSED', () => {
  const c = boot(4, 'MNGR');
  run(c, 30);
  const I = globalThis.ESS.Instructor, real = I.presets;
  I.presets = () => real().map((p) => p.id === 'U1_SS' ? Object.assign({}, p, { set: { L: { LIC101: { sp: Infinity } } } }) : p);
  try {
    assert.equal(c.applyPreset('U1_SS', { baseTime: c.P.t }), undefined);
  } finally { I.presets = real; }
  assert.equal(c.state.msg, 'SNAPSHOT REFUSED: PROCESS STATE IS NOT FINITE');
  assert.ok(Number.isFinite(c.P.t));
});
```

`globalThis.ESS` is the module registry the harness builds (`tests/app-credibility-s1.test.js` patches `ESSg.CauseEffect` the same way and restores it in `finally`). The refusal lands after the dry settle has already run `initSim`, so the plant is reset to the preset at time 0, not restored to the pre-load state; that matches today's refusal (a refused snapshot after the settle leaves the plant settled). Say in the report that this is the behaviour, so the controller can rule if a rollback is wanted.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s2.test.js`
Expected: the first D5 test fails at `assert.equal(c.P.t, base)` (today `base + 120000`); the no-base-time test passes already (it pins today's path); the dry-settle equality test fails on `presetBaseT !== drill.t` only if the receipt and the time diverge (they do today by 120 s).

- [ ] **Step 3: Implement**

In `src/plant-core.js` `applyPreset`, replace the single `const settled=this.settle(p,o.baseTime);` line with:

```js
    // The settle ends at the base time instead of starting there (spec §5.3): a dry settle from 0 measures its
    // length for this preset and seed (initSim re-seeds from the instructor seed, so the two runs are the same run),
    // then the real settle runs from baseTime - length and ends exactly at baseTime. Alarms raised during the settle
    // land in the preceding minutes, like a plant that was already running. With no base time the load is today's.
    let settled;
    if(typeof o.baseTime==='number'){
      const dry=this.settle(p,0);
      if(!this.snapshotData('IC '+p.label)) return;   // a non-finite settle refuses the load with today's SNAPSHOT REFUSED
      settled=this.settle(p,o.baseTime-dry.ms);
    } else settled=this.settle(p,undefined);
```

`snapshotData` already prints `SNAPSHOT REFUSED: PROCESS STATE IS NOT FINITE` and returns null for a non-finite state; the `return` before the real settle leaves the plant in the dry settle's state (reset to the preset at time 0). If the refusal test needs the pre-load plant back, take a `captureScan()` before the dry settle and `rollbackScan` it on refusal, the way `restoreSnapshot` does (lines 1476-1479), and say which you did.

In the page, line 3481, the IC menu: `cb:()=>this.applyPreset(p.id)` becomes `cb:()=>this.applyPreset(p.id,{baseTime:this.P.t})` with the comment `// the settle ends at the sim clock (spec 5.3), so a load never jumps the station clock`. The canonical drill start (line 2912) and the A-drill start (line 3228) already pass `baseTime: presetBaseT` with `presetBaseT = this.P.t`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s2.test.js tests/release-gates.test.js tests/app-adrill-replay.test.js tests/app-drill-start-ui.test.js tests/app-adrills-menu.test.js tests/app-instructor.test.js tests/drill-arch-fixtures.test.js`
Expected: PASS, with the arch fixtures in exactly the state Task 3 left them (their physics and health digests must not move here: the no-base-time path is byte-for-byte today's).

- [ ] **Step 5: Full suite, build, smoke, commit**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^not ok|^# (tests|pass|fail|skipped)'; python3 tools/build-dist.py; tools/smoke.sh`
Expected: the same red set as after Task 3 and nothing else; smoke ok. In a browser: note the status-bar clock, start a CANONICAL drill, the clock continues from where it was.

```bash
git add src/plant-core.js "Experion Station Simulator.dc.html" tests/app-credibility-s2.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(core): the settle ends at the base time, so an initial condition never jumps the station clock" -m "Spec 5.3 (playtest D5). Tests: tests/app-credibility-s2.test.js; replay gate 3 unchanged." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
```

---

### Task 5: The SIM label

**Files:**
- Modify: `Experion Station Simulator.dc.html:1969` (the clock cell), `:4190` (`timeT`)
- Test: `tests/app-credibility-s2.test.js` (append)

**Interfaces:**
- Consumes: `this.state.speed` (0 frozen, 1 real time, 2/4/… fast), `this.fT(ms)`.
- Produces: `renderVals().timeT` reads `hh:mm:ss` at speed 1 and `SIM hh:mm:ss` at any other speed; `dateT` unchanged; the instructor run line (`instr.run.simT`, `stateT`) unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/app-credibility-s2.test.js`:

```js
// Review Focus 5: every path that changes the run speed flips the label.
test('§5.4: the status-bar clock reads SIM hh:mm:ss whenever the run control is frozen or off 1×, computed from state.speed alone', () => {
  const c = boot(4, 'OPER');
  run(c, 10);
  const t = c.fT(c.P.t);
  assert.equal(c.state.speed, 1);
  assert.equal(c.renderVals().timeT, t);
  c.freeze();
  assert.equal(c.renderVals().timeT, 'SIM ' + t);
  c.setSpeed(1);
  assert.equal(c.renderVals().timeT, t);
  c.setSpeed(4);
  assert.equal(c.renderVals().timeT, 'SIM ' + t);
  c.setSpeed(1);
  c.stepOnce();
  assert.equal(c.state.speed, 0);
  assert.equal(c.renderVals().timeT, 'SIM ' + c.fT(c.P.t));
  const v = c.renderVals();
  assert.equal(v.dateT, c.fD(c.P.t));
  assert.match(v.instr.run ? v.instr.run.simT : c.fT(c.P.t), /^\d\d:\d\d:\d\d$/);
});

test('no core code reads the wall clock for the label: src/ has the same Date.now count as S1 left it, and the page seeds the start clock once', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'));
  const hits = src.flatMap((f) => (fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').match(/Date\.now\(\)/g) || []).map(() => f));
  assert.deepEqual(hits.sort(), ['models.js'], 'only createState\'s start-clock fallback reads Date.now in src/');
});
```

Before writing the second test, run `grep -c "Date.now()" src/*.js` and set the expected list to what it prints at BASE (the assertion pins the S1 state, not a guess); `src/models.js:280` is the known one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-credibility-s2.test.js`
Expected: FAIL at `assert.equal(c.renderVals().timeT, 'SIM ' + t)` after `freeze()`.

- [ ] **Step 3: Implement**

In the page, line 4190: `dateT:this.fD(P.t), timeT:this.fT(P.t)` becomes `dateT:this.fD(P.t), timeT:(S.speed===1?'':'SIM ')+this.fT(P.t)` with the comment `// SIM label (spec 5.4): the clock says so whenever the run control is frozen or off 1x; from state.speed alone`. Line 1969: widen the clock cell from `width:60px` to `width:92px` so `SIM hh:mm:ss` fits without wrapping (12 characters at the status bar's font; measure in the browser and set the smallest width that holds it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-credibility-s2.test.js tests/app-instructor.test.js`
Expected: PASS; the instructor tests that read `state.speed` (line 92) unchanged.

- [ ] **Step 5: Full suite, build, smoke, commit**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^not ok|^# (tests|pass|fail|skipped)'; python3 tools/build-dist.py; tools/smoke.sh`
Expected: the same red set as after Task 4; smoke ok. In a browser: FREEZE from the SIM link, the clock reads `SIM hh:mm:ss`; RUN 1× clears it; 4× shows it again; nothing wraps.

```bash
git add "Experion Station Simulator.dc.html" tests/app-credibility-s2.test.js src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "feat(hmi): the status-bar clock says SIM whenever the run control is off real time" -m "Spec 5.4 (playtest D5). Tests: tests/app-credibility-s2.test.js." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
```

---

### Task 6: Close the stage: movers, changelog, docs, gates

**Files:**
- Modify: `tests/fixtures/*.json`, `tests/fixtures/arch/*.json` (the measured movers only), `tests/v2-baseline-archive.test.js` (reasons appended to the existing entries), `CHANGELOG.md` (`[Unreleased]`, above the S1 entry), `docs/dev/CODE-MAP.md`, `docs/dev/CREDIBILITY-PASS-SPEC.md` (§4.2 wording, §11 measured note), this plan (as-built notes)

**Interfaces:**
- Consumes: everything above.
- Produces: a green suite at the stage's head, every S2 mover named with its reason in both guards, the S2 changelog entry, CODE-MAP current.

- [ ] **Step 1: Final build, then list exactly which goldens move and why**

Run: `python3 tools/build-dist.py && node --test tests/*.test.js 2>&1 | grep -E '^\s*not ok'`
Expected: every line is a golden test. The expected set and reasons: `drill-D11` and `upset-agit-batch` (§4: FIC211 and TIC212 PROGRAM in every running phase, so `scmRestoreModes` and the attribute writes change the event stream; the HOLD/RESUME writes), `arch/A5` (§4 ownership on its U2_FEED base, physics digest), and, only if Task 3's report said `eventCount` reads the session journal, the 14 arch fixtures (§5.2: the boot's station-start record survives the load and the settle's records are discarded; event count only, never the physics or health digest). Measure, do not assume: in a scratch copy of the tree (`git worktree add /tmp/s2-abl HEAD`; remove it with `git worktree remove --force /tmp/s2-abl`), switch each mechanism off in turn (the `if (b.held) return;` and the ownership rule in `sequence()`; the session journal lift in `applyPreset`) and run the golden files to attribute each mover to its mechanism. **A fixture that moves for a reason outside this table means a behaviour the stage did not intend to change: stop, find the cause, fix it in the task that introduced it, and only then continue.**

- [ ] **Step 2: Confirm determinism, then re-capture only the movers**

Run the movers twice without `UPDATE_GOLDENS` and confirm each message says "moved from the committed golden", never "NONDETERMINISM". Then:

```bash
UPDATE_GOLDENS=1 node --test --test-name-pattern "drill D11 " tests/golden-drills.test.js
UPDATE_GOLDENS=1 node --test --test-name-pattern "agit-batch" tests/golden-upsets.test.js
UPDATE_GOLDENS=1 node --test --test-name-pattern "^A5 " tests/drill-arch-fixtures.test.js     # A5 alone when only A5 moved
UPDATE_GOLDENS=1 node --test tests/drill-arch-fixtures.test.js                                 # the whole file only when all 14 moved (§5.2 event count)
git status --porcelain tests/fixtures
```
Expected: exactly the Step 1 list changed and nothing else; never `tests/golden-u4.test.js`. If a fixture changed that the list did not name, `git checkout -- <that fixture>` and find out why before continuing.

- [ ] **Step 3: Record each mover's S2 reason in both guards**

In `tests/v2-baseline-archive.test.js` every S2 mover is already listed (S1 moved all 35), so append the S2 reason to its existing line in `KNOWN_RECAPTURED` (the 21 v2 fixtures) and `KNOWN_RECAPTURED_SINCE_31` (all 35), and add a dated paragraph to each list's comment naming the S2 mechanisms (`OWNERSHIP`: §4.2; `JOURNAL`: §5.2) the way S1's legend names `CUTOFF`, `PUMP`, `SATURATION`, `INTERLOCK`, `RESTORE`, `MARGIN`. Run `node --test tests/v2-baseline-archive.test.js`: both guards green (CR31 proves every listed file differs and every unlisted one equals its archive).

- [ ] **Step 4: Changelog, CODE-MAP, spec, as-built notes**

`CHANGELOG.md`, under `## [Unreleased]` above `### Credibility pass S1 — …`, an entry in the house voice that says: what the operator sees changed (HOLD freezes the batch: no phase advance, no charge or drain, the feed setpoint written to 0 at the command and the jacket left holding; the button reads RESUME; both batch loops read PROGRAM while the sequence runs and OPERATOR while it is held, so a setpoint during a hold is honoured and RESUME re-asserts the phase's values; an operator setpoint under PROGRAM is refused with the mode-attribute message and only the refusal is journaled; a drill or initial-condition load no longer erases the Event Summary, the MOC trail, the KPI window or the bad-actor history: one `INITIAL CONDITION LOADED — <preset> (SETTLED n S)` record and, for a canonical drill, one `DRILL <id> STARTED — … — CANONICAL` record are appended; the station clock no longer jumps ahead at a load because the settle ends at the sim clock, so alarms raised during the settle carry times in the preceding minutes; the status-bar clock reads `SIM hh:mm:ss` whenever the run control is frozen or off 1×); what did not change (the TI216 shed and the R-202 trip keep their holds and flags; the instructor's own snapshots still rewind the journal; replay and the `presetBaseT` receipt are unchanged; trends reset with the IC); and the movers with their reasons. Cite `docs/dev/CREDIBILITY-PASS-SPEC.md` §4-§5 and `docs/playtest-2026-10-02.md` D3 to D6.

`docs/dev/CODE-MAP.md`: `sequence()` (the frozen branch, the ownership rule, `phaseSetpoints`), `seqCmd` HOLD/RESUME writes, `settle()` and `applyPreset`'s journal scope and dry settle, the canonical `DRILL … STARTED` record, the `SIM` label in `renderVals`.

`docs/dev/CREDIBILITY-PASS-SPEC.md`: §4.2's "nothing is journaled" reads "no change is journaled; the refusal's own `WRITE REJECTED` record is the existing path (as §3.3)"; §11 gains a measured note for S2 under the S1 note (which fixtures moved for `OWNERSHIP`, which for `JOURNAL`, which did not move and why), in the same shape as S1's.

This plan: an "As built" section at the end, one short paragraph per task where the shipped code differs from the snippet above (expected at least: the Task 2 strings you changed in the page or alarm help; Task 3's `events.length` adjustments in existing tests; Task 4's refusal shape; Task 5's measured cell width).

- [ ] **Step 5: All three gates, then commit**

Run: `node --test tests/*.test.js 2>&1 | grep -E '^# (tests|pass|fail|skipped)' && python3 tools/build-dist.py && git status --porcelain dist/ && tools/smoke.sh`
Expected: `# fail 0`; `dist/` unchanged by the second build; smoke ok on both builds.

- [ ] **Step 5b: The agent-seam check before the stage merges (spec §9.4 as amended by PR #9, 2026-10-04)**

The master-operations-agent development drills are rescored at the new simulator tip and the result recorded in the S2 CHANGELOG entry. From a clone of `https://github.com/templetwo/master-operations-agent.git` at its main tip (the controller keeps one under the job scratch; `git clone --depth 50` is enough), with this repo checked out clean at the stage head:

```bash
cd <moa-clone> && git log -1 --format='%h %s'
python3 scripts/rescore_drills.py /Users/vaquez/experion-station-sim --manifest moa/data/drills-v2.json --allow-revision-mismatch --out /Users/vaquez/.claude/jobs/9570056f/tmp/s2-rescore.json
```

Expected: a line like `ess-u1-development-v2 at <head>: useful N/8, guards M/10` (at S1's head `adeb18a` it read 6/8 and 10/10, the two misses being the `restoration-lag` seeds whose `reactor_warming` finding S1 §2.4 removed by design: with the jacket controller acting on the saturated value, TIC201 rises 0.7 °C across the agent's window instead of 4.2). Record the score, the manifest pin and the revision mismatch in the CHANGELOG entry (one sentence under the S2 entry's gates line), and whether a newer manifest pinned to this stage exists on agent main. Do not land a manifest or receipt in the agent repo from this task; that is the agent repo's PR. If the script refuses for a reason other than the revision pin, record the refusal verbatim instead and report it.

```bash
git add tests/fixtures tests/v2-baseline-archive.test.js CHANGELOG.md docs/dev/CODE-MAP.md docs/dev/CREDIBILITY-PASS-SPEC.md docs/dev/CREDIBILITY-PASS-PLAN-S2.md src/model-id.js dist/experion-station-sim-standalone.html
git commit -m "test(goldens): re-capture the S2 movers with their reasons; changelog and docs for sequence ownership and the session journal" -m "Closes stage S2 of the credibility pass (spec §10). Movers and reasons: <copy the guard's S2 legend>." -m "Co-Authored-By: Claude <model name> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_<id>"
```

- [ ] **Step 6: Stage receipt**

The controller's, not the implementer's: the chronicle receipt (domain `experion-station-sim,credibility-pass,S2,…`, source instance named as the MacBook seat, `cmd` and `url` receipts) with the head commit, the test counts, the mover list and the browser checks of Tasks 2, 3, 4 and 5. S3's plan is written only after this receipt exists.

---

## Self-review notes (written with the spec open)

- **Spec coverage.** §4.1 HOLD freezes: Task 1 (model), Task 2 (hold state once, RESUME re-asserts, button). §4.2 ownership: Task 1 (rule), Task 2 (refusal and journal, OPERATOR on hold, SP held). §4.3 trips: Task 2's §4.3 test (the holds come from S1). §5.1-5.2 scope rule and the two records: Task 3. §5.3 the clock, dry settle, refusal: Task 4. §5.4 SIM label: Task 5. §9.1 rows D3 to D6: each named test above quotes the row. §11 movers: Task 6. §12 "settle dry run": Task 4's refusal test.
- **Placeholders.** None: every test asserts concrete values. Task 5's `Date.now` list (`['models.js']`) was measured at BASE (`grep -c "Date.now()" src/*.js`: only `src/models.js`, the start-clock fallback in `createState`).
- **Type consistency.** `phaseSetpoints(b, P)` returns `{ FIC211, TIC212 }` in Tasks 1, 2 and 6; `settle(p, atTime)` returns `{ ms, seconds }` in Tasks 3 and 4; `applyPreset(id, { baseTime, preserveReplay })` keeps its signature; the record texts `INITIAL CONDITION LOADED — <LABEL> (SETTLED <n> S)` and `DRILL <id> STARTED — <NAME> — CANONICAL` are spelled the same in Tasks 3, 4 and 6.
- **Review Focus.** Each of the five lines names its test and its task (1 and 2 in Task 2, 3 in Task 3, 4 in Task 4, 5 in Task 5).

---

## As built

Written at the close of S2 (2026-10-04) from the implementers' reports and the diffs, on `fix/playtest-2026-10`. It records where the shipped code or test differs from the snippets above, and why. Everything not mentioned shipped as planned.

**Task 1 (8d5de29).** `sequence()` ships with the timer, the transitions, the charge, the drain and the setpoint writes inside `if (!b.held) { … }`, and the ownership rule written after that block from the resulting phase, not at the top before an early `return`. The plan's order leaves the attribute one scan behind at the end of a batch (the scan in which DRAIN sets IDLE still reads PROGRAM) and fails an existing assertion in `tests/app-models.test.js` (after a TI216 shed clears, RESUME completes the batch and FIC211 reads OPERATOR once IDLE); the digests are the same either way. The six model tests are the plan's, verbatim; Task 2 then set `Cm 10` and `T 60` in the ownership test so its REACT and COOL iterations really end in the phase under test.

**Task 2 (672315e, 910ec7f, cd184c2).** `seqCmd` is the plan's block. Two tests could not pass as written. The FEED hold test asked for an observed flow of 0 within 30 s and a constant level: the loop sat at SP 0 against an observed 0 and kept 0.32 M3/H flowing for ever, so with CR40 the test pins scan counts instead (output 0 from scan 1; the observed flow reads 0 from scan 33; the level last moves on scan 41 and is constant to scan 360; RESUME brings the feed back above 15 M3/H within 60 s), and a REACT test pins the trickle after FEED. The 'other writers' test latched the shed with `latchTadShed()`, which `interlocks()` releases on the first scan; it now latches through the real chain (U2_FEED, `injectFault('agit')`, run until `tadShed`) and gained three assertions on the HOLD branch under a standing shed. Four rulings shipped beyond the plan: CR40 and CR40b (`ESS.Pid.shutoff`, `spCutoff` set by `setFlowCutoffs()` on every M3/H loop, the shutoff only in AUTO and with no PV tracking inside it; the Live Diagnosis saturation card asks `shutoff` too), CR41 (`scmRestoreModes` restores TIC212 as well as FIC211), CR42 (alarm help: TI216 PVHI, FIC211 PVHI and PVLO, TIC212 PVHI, LI215 PVHI and PI214 PVHI; the `mtrip.M202`, `risk.acc` and `risk.tad` cards; the U2 graphic caption; two help answers) and CR43 (a trip clears the hold). A5's digest moved a second time under CR40, and drill D4 and upset-cool went red under CR40 as first ruled and were exempted by CR40b.

**Task 3 (e78674d, 8a54058).** `settle()` and the journal lift are the plan's, with `if(!p) return null;` added so the documented `null` is true. Test corrections: the D4 test's trend bound is `[P.t − 120000, P.t]` here and the plan's `[base − 120000, base]` from Task 4, and the 'other readers' `eid` check reads `eid + 1` (the restore writes its own INSTR record) beside an id-uniqueness check. No existing test counted records after a load, so no `events.length` assertion needed adjusting. The re-review added CR44 (the KPI history closed and reopened at a load, through a `resume()` closure that also puts the session journal back on both refusal returns, with an overlap rule: an alarm active on both sides gets no row), CR45 (the A-drill debrief windowed through `archDebriefFrom()`: events, journal, fault timeline and DOF rows from the drill's start, alarm rows strictly after it), CR46 (the canonical record names the drill only with `reveal === true`; the choice is journaled and replayed; `randomDrill` starts through `startDrillFromMenu(d, 'random')`) and gate 3's non-vacuity control (its lane loop asserts the IC record).

**Task 4 (0809c94).** The harness page seeds the start clock from `Date.now()`, not 0, so the tests take a start clock (`boot(seed, sec, at)`) and the no-base-time test pins `Date.now`. The plan's `U1_HIFEED` raises no alarm in its shipped settle (R-201 ends at 164.3 against a PVHI of 165), so the alarm test patches the preset for the call (`withHotHifeed`: TIC201 SP 170, PVHI raised at 246 s of the 480 s run). Three existing assertions that encoded the +120 s jump now expect none (`tests/release-gates.test.js`, `tests/app-drill-start-ui.test.js:221`, `tests/app-adrills-menu.test.js:208`); every replay assertion beside them is unchanged. The refusal leaves the plant in the dry settle's state with no rollback, and the session journal is put back (both refusal returns go through `resume()`), so after one the clock sits near the epoch while the journal carries the real one. No shipped preset reaches it.

**Task 5 (2917a13, 8a54058).** The plan's last assertion (`v.instr.run ? … : c.fT(P.t)`) never read the run line, because a closed instructor panel renders `{on:false}`; the test sets `c.instr.auth = true` and asserts `instr.run.simT` is a bare `hh:mm:ss` and `stateT` reads `FROZEN`. `setSpeed(5)` replaces `setSpeed(4)` (the UI speeds are 0, 1, 2 and 5). The clock cell is 92 px wide with `white-space:nowrap`, set by estimate and not measured in a browser.

**Task 6 (e4082aa, 4221ea2, and the documentation commit carrying this note).** Two pre-steps ahead of the movers, both small: CR47 (`applyPreset`'s `resume()` empties the backtrack ring, `instr.ring = []` and `instr.lastRingT = -Infinity`, so a backtrack never crosses a load) and CR46b (the `INSTRUCTOR: drill … armed` message follows the record's reveal rule for a canonical start; a LIVE STATE start keeps naming the drill, which `tests/app-instructor.test.js` pins). Neither moved a golden. The plan expected the 14 arch fixtures might move for §5.2's event count; they count `P.aDrill.events`, so none did. The movers are drill D11, upset-agit-batch and arch A5 (whose base is U2_REACT, not U2_FEED), and only those three. §4.2 was reworded as planned, CR45's entry now says what the window covers, and §11 carries a measured S2 note. Step 5b ran against agent main `d13c23a`, which now carries drills-v3 (pinned to `adeb18a`): v2 reads 6/8 and 10/10, v3 reads 8/8 and 10/10, both under `--allow-revision-mismatch`; no manifest pinned to S2 exists.
