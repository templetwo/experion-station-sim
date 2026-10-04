<!-- @artifact dev -->
# Task 3 report: the observed value in the scan (`measure()`), alarms and trends

Status: DONE_WITH_CONCERNS. Commit `373ba66` on `fix/playtest-2026-10` (BASE 4fc55ac), not pushed.
Seat: MacBook seat (claude-sonnet-5-5), implementer.

## 1. What I implemented

`src/plant-core.js`
- `measure()` (new, directly before `pids(dt)`): for every `pid` and `ind` point writes `l.obs = ESS.Measurement.observe(l)` and `l.pvObs = Number.isFinite(m.pv) ? m.pv : l.pv` (controller ruling CR9, not the brief's `typeof`). Public and idempotent.
- `advanceScan`: `this.measure();` on its own line between `this.stepU4(dt);` and `this.pids(dt);`.
- Alarm scan: `const pv=observed?observed.pv:ESS.Pid.pvOf(l);`, and `raiseA` / `clearA` now carry `pv` instead of `l.pv`. The analyzer branch above it is untouched.
- Trend push: `h.push([P.t, ESS.Pid.pvOf(l), l.sp??0, l.op??0])`.

`src/measurement.js`: header lines 2-5 reworded to the present tense (carry-forward from Task 1's review). Comment only.

`src/model-id.js`, `dist/experion-station-sim-standalone.html`: restamped and rebuilt by `tools/build-dist.py` (a second build is a no-op).

The `l.lastPv = l.pv` seed at init (plant-core:63) is unchanged: every initial pv is inside its nominal range, no first-tick derivative kick appeared in any test or probe.

## 2. Tests and TDD evidence

New file `tests/app-credibility-s1.test.js` (`// @artifact dev` in line 1). The brief's four tests verbatim (header with `CauseEffect` and `AlarmHelp` kept as written, because Tasks 6 and 8 use them), plus three of mine.

RED (before any source edit): 3 of the brief's 4 failed for the right reason (`l.pvObs` undefined at line 29; `l.obs` undefined for FI100; `Cannot read properties of undefined (reading 'quality')`). The brief's test 2 ("alarms evaluate the observed value and report it") PASSED on the old code. TIC202's PVHH trip is 85 and fires at about 86.4, well inside the window where raw and observed agree, so it cannot tell the two apart. I kept it verbatim and added discriminating tests rather than editing the brief's.

My three additions:
1. `D7: the alarm scan evaluates and reports the observed value, not the model value`: writes raw pv 120, sets PVHH to 105 (above the window), `measure()`, `scan(0.5)`. PVHI must carry `val === 103.125` and PVHH must never raise. Deterministic, no trajectory dependence.
2. `measure() runs after the models and before the controllers and the alarm scan (spec §2.3)`: spies on `stepU4, measure, pids, scan` and asserts the call order in one step.
3. `measure() falls back to the raw value when the observed value is not finite (CR9)`: stubs `ESS.Measurement.observe` to return `pv: NaN`.

GREEN: new file 7/7; focused run `node --test tests/app-credibility-s1.test.js tests/measurement.test.js tests/pid.test.js` 41/41.

Mutation check (each edit reverted in turn in plant-core.js, restored byte-identical afterwards, `cmp` verified): all eight killed by the new file.

| Mutation | Killed by |
|---|---|
| M1 drop `this.measure()` from advanceScan | 4 tests |
| M2 `measure()` after `pids()` | tick-order test only (the brief's four cannot catch it) |
| M3 alarm evaluates raw `l.pv` | alarm-scan test only |
| M4 alarm raise/clear value raw `l.pv` | alarm-scan test only |
| M5 trend pen raw `l.pv` | brief test 1 |
| M6 `typeof` instead of `Number.isFinite` | CR9 test only |
| M7 `pvObs = m.pv` with no raw fallback | brief test 4 and CR9 test |
| M8 `measure()` skips `ind` points | brief test 3 |

Full suite:
- Baseline at 4fc55ac: 1146 tests, 1145 pass, 0 fail, 1 skipped.
- Final: 1153 tests, 1114 pass, 38 fail, 1 skipped. Smoke ok on both builds (folder and dist).
- 38 red = 35 golden fixture tests (8 drills, 13 upsets, 14 arch) + `g2-lifecycle` archive test + 2 D4 scorer tests. Nothing else.
- No failure says NONDETERMINISM. Each golden failure is "moved from the committed golden/fixture" on the end-state (or physics) digest.

## 3. Files changed (8)

`src/plant-core.js`, `src/measurement.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`, `tests/app-credibility-s1.test.js` (new), and three existing tests edited to keep them honest:
- `tests/app-alarms.test.js` (TIC201 DEVHI test) and `tests/app-scorer-moc.test.js` (deadband/on-delay test) wrote `l.pv` by hand and called `scan()`. With a stale `pvObs` from earlier steps the scan no longer saw the write. They now call `c.measure()` between the write and the scan, the order a real tick follows. Fixed, green.
- `tests/g2-lifecycle.test.js` ("actual archived v1 checkpoints..."): compares the live kernel's `L` with the archived cf52132 kernel tick for tick. It now strips the derived `obs` and `pvObs` fields (the archived kernel cannot carry them). It is still red, but now purely for the FIC211 physics reason (see below).
No fixture under `tests/fixtures/` was touched or staged. `NIGHT PREVIEW.dc.html` is untracked and unstaged.

## 4. The moved list and the cause of each

How I attributed causes: a scratch copy of the tree (`/tmp/ess-exp`, outside the repo) with an env toggle in `measure()` that excludes tags from observation, then ran the golden, arch, lifecycle, alarm and scorer files under each variant, plus the real code and the pre-change tree (`/tmp/ess-old`, `git archive` of 4fc55ac) for A/B traces.

| Variant | Result |
|---|---|
| Control, nothing observed | everything green (golden-drills 9/9, upsets 14/14, arch 18/18, lifecycle 7/7, app-alarms 14/14, scorer 22/22, u4 6/6) |
| Only FIC211 observed | red: all 8 drills, all 13 upsets, all 14 arch, lifecycle. Green: scorer, alarms |
| Everything except FIC211 | red only: drill D4, upset cool, 2 D4 scorer tests, plus the structural/stale-pvObs tests that I have since fixed |
| Only TIC202 observed | red only: drill D4, upset cool, 2 D4 scorer tests, lifecycle (structural only) |

Cause 1, TIC202 saturating at 103.125 (expected by spec §11):
- golden drill D4: end-state digest, event count 197 to 113, alarm-load note of the score breakdown 78.3 to 43.3 per 10 min (score total unchanged at 10). Alarm-sequence digest, trips, faults hold.
- golden upset cool: end-state digest, event count 31 to 91. The faster jacket recovery now crosses TIC202's DEVHI band (12 C, 1 C deadband) while the cascade SP wobbles about 3 C: 29 raise / 32 return events in the last minute. A trajectory consequence, not a defect in `measure()`; a latent DEVHI chatter risk for S3's alarm work.
- the two D4 scorer tests in `tests/app-scorer-moc.test.js` (not fixtures, see section 5).

Cause 2, the FIC211 low-flow cutoff (spec §2.2, outside §11):
FIC211 is AUTO at SP 0 and its raw pv is flow noise straddling 0 (for example -0.04, +0.07). The old loop chattered on that noise and leaked MV211 open by up to about 1e-3; the observed value is exactly 0, so the loop stays quiet and MV211 stays shut. R-202 and its neighbours shift numerically (A/B trace: first divergence is `FIC211.I` and `lastPv` at tick 0; TI216 differs by up to 0.43 C, TIC212 0.06 C, PI214 0.14 kPa within 420 s on the xmtr path). I measured every assertion behind each digest with soft copies of the golden tests: only the end-state/physics digest moves, with two exceptions (D11 step count 4021 to 4023, and the D4/cool items above). Alarm sequences, trips, faults, phases, scores, pass flags and health digests do not move.

| Fixture | Cause | What moves |
|---|---|---|
| drills D1, D2, D3, D6, D9, D12 | FIC211 | end-state digest only |
| drill D11 | FIC211 | end-state digest, step count to end 4021 to 4023 |
| drill D4 | saturation, and FIC211 | see cause 1 |
| upsets xmtr, drift, surge, pump, stick, vap, air, rxn, foul, agit, bedact, agit-batch | FIC211 | end-state digest only |
| upset cool | saturation, and FIC211 | see cause 1 |
| arch A1 to A12, A1 gated, A6 gated | FIC211 | physics endState digest only (health digest, event count, score, pass, gated unchanged) |
| `g2-lifecycle` archived v1 checkpoint test | FIC211 | FIC211 `I`, `lastPv`, `op` differ from the archived kernel (the structural obs/pvObs part is fixed) |

Against spec §11:
- Listed in §11 and moved: drill D4, upset cool (saturation, as expected); pump, D3, D11, agit-batch (listed for later tasks' mechanisms, here moved by FIC211); stick (listed for saturation, but its run never saturates, so it moves through FIC211 alone).
- NOT in §11: drills D1, D2, D6, D9, D12; upsets xmtr, drift, surge, vap, air, rxn, foul, agit, bedact; arch A1 to A4, A6 to A12 and both gated; the g2-lifecycle archive test; the two D4 scorer tests.
- Listed in §11 but not moved here: arch A5 score (unchanged), A5 physics moved by FIC211.
I did not widen or narrow the cutoff.

## 5. Concerns that need a ruling

1. The FIC211 cutoff moves 27 golden fixture tests outside §11 (drills D1, D2, D6, D9, D12; upsets xmtr, drift, surge, vap, air, rxn, foul, agit, bedact; arch A1 to A4, A6 to A12, A1 gated, A6 gated) plus the g2-lifecycle archive test. Numerically tiny, qualitatively nothing, except D11's step count. Options for the controller, not taken by me:
   (a) Accept: it is the spec's D14 model-side half, and it makes a flow loop at SP 0 quiet, as a DCS PV cutoff does. Amend §11 to say the cutoff moves every fixture that includes the idle batch unit, re-capture all, record each reason in the archive guard.
   (b) Narrow it (for example display-only, or exempting AUTO loops at SP 0), which keeps those fixtures green but leaves the loop reading a number the operator is told is zero, the class of fiction spec §2.4 rejects.
2. D4's scored outcomes (a pedagogy change, not a numeric one). Same operator actions, old tree against new, seeds 1 to 12:
   - guidance followed literally: 90 pass on every seed both before and after, but the "restore feed" step now fires on only 6 of 12 seeds (it fired on all 12 before), because the drill stabilises first.
   - idle: 30 fail before, 45 fail after (R-201 trips on every seed in both).
   - cut the feed to 20 % and leave it cut: 65 fail on every seed before (TK-101 trips at 98 %); 90 PASS on 10 of 12 seeds after (drill ends STABILIZED at about 450 s with TK-101 at about 83 %, feed still cut); 65 fail only on seeds 7 and 10.
   Mechanism (measured on seed 5): TIC202 now reads the clamped 103.1, so its error is capped and the anti-windup keeps its integrator between about -12 and +16. Against the raw error (up to 175 against a SP of 10 to 35) the old loop drove the integrator to about -105. When the cooling returns, the old output collapses to about 28 % and unwinds slowly (I -83 to -50 over 30 s); the new one stays at 60 to 100 %, so the jacket is at 82 C at +210 s instead of 110 C. Related alarms then clear for 60 s and `drillWatch` ends the drill 'STABILIZED' a few seconds before TK-101 passes 80 % and raises LIC101's alarm. The old guard ("LIC101 is a related point") worked by timing, not by design. The two scorer tests ("D4: following the recommended sequence literally passes ..." and "D4: doing nothing still fails, and cutting feed without restoring it does not pass either") encode the old outcome. I did NOT re-calibrate them: the second one's claim is now false for most seeds and changing it would hide a pedagogy decision (for example tightening D4's stable criterion so a feed left in MAN at 20 % cannot stabilise). They are red in this commit and named in its message.
3. `g2-lifecycle` archive-equivalence test needs redefining after the ruling in (1): the live kernel can no longer track the archived one tick for tick. If the ruling narrows the cutoff, my obs/pvObs strip is all it needs; otherwise the comparison must stop at the invariants (legacy mode, no composition, product, rand states).
4. Plan constraint "every other test is green" is not met by this commit because of items 2 and 3 (they are not re-capturable fixtures). Nothing is pushed, so the controller can fix or rule first.

## 6. Self-review

- Completeness: every item of the brief and the four carry-forwards (CR9, header tense, lastPv seed note, FIC211 mover investigation) is done. The brief's "frozen `observe()` result" is read as "as of this tick": the brief's own code is `l.obs=m;` and Task 4 only reads `l.obs.pv` and `l.obs.quality`, so I did not `Object.freeze` it.
- Discipline: only named files staged; no fixture touched; no subagents; no push; `dist/` rebuilt, not hand-edited. Three extra tests in the new file, two one-line test fixes, one structural strip; each justified above.
- A hazard worth recording: any code that writes raw `pv` by hand and then calls `scan()` or a controller outside `advanceScan` sees the previous tick's observation until `measure()` runs. `measure()` is public for exactly that. Callers that still pass (for example `app-alarms.test.js:74`, `models.test.js`) do so because `pvObs` is unset in them and `pvOf` falls back to raw.
- Commit message first said "36 golden fixture tests" (an arithmetic slip, the count is 35); caught before any push and amended. The message now matches this report.

## 7. Scratch artifacts (outside the repo, safe to delete)

`/tmp/ess-old` (git archive of 4fc55ac), `/tmp/ess-exp` (scratch tree with the MEAS_SKIP toggle and soft golden copies), `/tmp/trace.js`, `/tmp/cmp.js`, `/tmp/magn.js`, `/tmp/d4.js`, `/tmp/d4sweep.js`, `/tmp/runv.sh`. I could not `rm -rf` them (the T2Helix compass hook blocks recursive deletes), so they stay on disk.

---

# Fix report: CR11, D4 stabilises only once the feed is restored

Commit `7a314d1` `fix(drills): D4 stabilises only once the feed is restored, as its debrief has always said`, a new commit on top of `373ba66` (not amended, not pushed). Staged by name: `src/plant-core.js`, `tests/app-scorer-moc.test.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`. Left unstaged and untouched: the controller's pending edits to `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` and `docs/dev/CREDIBILITY-PASS-SPEC.md`, and `NIGHT PREVIEW.dc.html`.

## What changed

`src/plant-core.js`
- `drillWatch`, directly after the `'contain'` branch and before the default `'alarms'` branch, with the one-line comment you specified:
  `else if(def.stable==='restore'){ ok = m.tAck && !this.alarmEngine.active().some(x=>def.rel.includes(x.tag)&&!x.shelved) && ESS.Pid.pvOf(L.FIC102)>=30 && L.LIC101.pv<80; }`
- The D4 definition only: `stable:'alarms'` to `stable:'restore'`. No other drill touched.

`tests/app-scorer-moc.test.js`
- Test "D4: following the recommended sequence literally passes ...": same assertions, scripted restore moved from "TK-101 at or above 80 %" to "TIC201 falling and TK-101 at or above 77 %", which is before the 80 % high alarm as the debrief says. Comment updated.
- Test "D4: doing nothing still fails, and cutting feed without restoring it ...": same assertions; comment updated; the `notEqual(reason, 'STABILIZED')` message now names the reason it saw; and the one assertion you asked for: `assert.ok(!cut.d.m.tStable, ...)`.
- One new test beyond the ruling (see deviation 2): "D4 stabilises only once the feed is restored: acknowledged, quiet alarms alone do not end it".

## Two deviations and one finding you should look at

1. Alarm part of the branch. Your snippet used `!this.alarmEngine.unacked().some(...)`; you also said to read the 'alarms' branch and keep its shape for the alarm part. The two differ, so I followed the instruction to match the 'alarms' branch (`m.tAck && !active() && !shelved`). I built the literal snippet in a scratch tree to see what it does (seed 5): D4 ends STABILIZED 82 s into the run with no cut and no restore, on the first acknowledgement alone (score 90 pass), and the idle policy scores 65 instead of 45. The reason is that "FIC102 at or above 30" is already true when the feed was never cut (it reads 60). A one-line switch if you really wanted the snippet, but I do not recommend it.
2. One extra test. Mutating out the feed clause (`FIC102 >= 30`) survived every end-to-end test: with the output cut to 20 % the FIC102 flow creeps from about 26 to about 30 m3/h as TK-101 fills (gravity head), so cut-and-leave is held back by the level clause alone, and dropping the level clause instead lets the drill end STABILIZED at TK-101 82.8 % (feed 30 or more while still cut). Each clause only works because of the other. The new unit test pins both on hand-set state (feed 20 stays running, tank 85 stays running, feed 60 with the tank at 50 ends STABILIZED), and with it all five mutants die.
3. Finding, your call: `>= 30` sits right at the top of the cut-flow range (about 26 to 30). A threshold like 40, or testing FIC102's mode or output instead of its flow, would separate "cut" from "restored" without leaning on the level clause. Not changed because the ruling fixed the number. Related: `docs/dev/CODE-MAP.md:116` still documents `stable:'contain'|'alarms'` and now needs `|'restore'`; I did not edit it because the ruling names four files.

## Covering tests, commands and output

| Command | Result |
|---|---|
| `node --test --test-name-pattern "D4:" tests/app-scorer-moc.test.js` against a scratch tree at `373ba66` with the re-calibrated test file (RED) | test 1 ok, test 2 not ok `TK-101 tripped: 82.5 / undefined` (drill ended early as STABILIZED) |
| the same file against the working tree (GREEN) | 2 of 2 pass; with the new unit test 3 of 3 |
| `node --test tests/app-scorer-moc.test.js tests/app-credibility-s1.test.js tests/golden-drills.test.js` | 39 tests, 31 pass, 8 fail: golden drills D1, D2, D3, D4, D6, D9, D11, D12, all already-named movers; scorer and new-seam files fully green |
| `python3 tools/build-dist.py` | ok; a second build is a no-op |
| `node --test tests/*.test.js` | 1154 tests, 1117 pass, 36 fail, 1 skipped (previous commit: 1153 / 1114 / 38) |
| `tools/smoke.sh` | `SMOKE folder: ok`, `SMOKE dist: ok` |

The 36 red are exactly the named set and nothing else: 14 arch fixtures (A1 to A12, A1 gated, A6 gated), the g2-lifecycle archived-run test, 8 golden drills, 13 golden upsets. The two D4 scorer tests are green again.

Unattended D4 golden run, before and after CR11 (scratch tree at 373ba66 against the working tree): identical end-state digest `9a7ba61b9f16b8c5`, alarm sequence `4353db612233e800`, 113 events, 1441 steps, TIME LIMIT. Nobody acknowledges in that run, so `m.tAck` never sets and it never stabilised either way; no fixture moves because of CR11.

Mutation run (each edit applied to `src/plant-core.js`, then restored; `cmp` confirms byte-identical): all five killed.

| Mutation | Killed by |
|---|---|
| drop the feed clause | the new unit test only |
| drop the level clause | cut-and-leave test and the new unit test |
| unacknowledged-only alarm part (your literal snippet) | guidance test and cut-and-leave test |
| D4 back to `stable:'alarms'` | cut-and-leave test and the new unit test |
| feed threshold 30 to 100 | guidance test and the new unit test |

## Outcomes, 20 seeds (policies as the tests script them)

| Policy | After the seam, before CR11 (12 seeds) | After CR11 (20 seeds) |
|---|---|---|
| literal guidance (cut, restore at TIC201 falling and TK-101 at 77 %) | 90 pass; the restore step fired on only 6 of 12 with the old 80 % trigger | 90 pass on 20 of 20, STABILIZED 480 to 487 s into the 720 s window, no trip |
| doing nothing | 45 fail, R-201 trips | 45 fail, R-201 trips (unchanged) |
| cut the feed and leave it cut | 90 PASS on 10 of 12 | 65 fail on 20 of 20, TIME LIMIT, TK-101 trips at 98 %, `tStable` never set |

Restore timing, measured because the script had to pick one: on the new dynamics a restore at TK-101 74 % or later stabilises (stable at about 470 to 540 s), 72 % or earlier does not within the window (75, fail); the cliff is between 73 and 74 %. On the pre-seam tree even 75 % did not stabilise and only 80 % did, which is why the old script restored at 80 %. The test uses 77 %, three points under the high alarm and three above the cliff.

Precision on the pre-CR11 failure: the cut-and-leave drill ended STABILIZED at 447 s with TK-101 already at 82.6 %, because LIC101's PVHI (80 %) carries a default 60 s on-delay (level tags 60 s, flows 15 s), so no related alarm was standing yet. The new `LIC101.pv < 80` clause reads the level directly and so does not wait for that delay. The commit body's "before TK-101 reached its high alarm" is shorthand for this.

## Scratch artifacts added (outside the repo)

`/tmp/ess-pre` (git archive of 373ba66 with the new test file), `/tmp/ess-lit` (your literal snippet variant), `/tmp/d4sweep2.js`, `/tmp/d4sweep5.js`, `/tmp/d4gold.js`, `/tmp/d4lic.js`, `/tmp/mutate2.py`. Not deletable from here (the T2Helix hook blocks recursive deletes).

---

# Fix report 2: the feed clause stands on its own

Commit `d7903c0` `fix(drills): D4's restored-feed test stands on its own: CAS, or output and flow at 40 or more`, a new commit on top of `7a314d1` (not amended, not pushed). Staged by name: `src/plant-core.js`, `tests/app-scorer-moc.test.js`, `docs/dev/CODE-MAP.md`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`. Not touched, still modified and unstaged in the working tree: `docs/dev/CREDIBILITY-PASS-PLAN-S1.md`, `docs/dev/CREDIBILITY-PASS-SPEC.md` (yours), and the untracked `NIGHT PREVIEW.dc.html`.

## What changed

`src/plant-core.js`, the `'restore'` branch of `drillWatch`: the alarm part I kept is unchanged and the feed clause is now
`(L.FIC102.mode==='CAS' || (L.FIC102.op>=40 && ESS.Pid.pvOf(L.FIC102)>=40))`, with the LIC101 clause `L.LIC101.pv<80` after it. The one-line comment now says what "restored" means. Nothing else in the file.

`tests/app-scorer-moc.test.js`: the two scorer tests are untouched. The unit test was rewritten to pin each clause on its own, on hand-set state, with a fresh plant per case (helper `d4Verdict(mode, op, flow, tank)` returns the drill's end reason or RUNNING after 120 s of `drillWatch`). Eleven cases:

| FIC102 mode, output, flow; TK-101 | Expected | Clause it pins |
|---|---|---|
| MAN, 20, 28; 79 | RUNNING | cut-and-leave with the tank under 80 %: the feed clause alone holds it (your case) |
| MAN, 20, 45; 50 | RUNNING | output conjunct (flow alone no longer counts) |
| MAN, 60, 20; 50 | RUNNING | flow conjunct (output alone no longer counts) |
| CAS, 20, 20; 50 | STABILIZED | the CAS alternative, whatever the numbers read |
| MAN, 60, 60; 50 | STABILIZED | restored by OP 60 % (your case) |
| MAN, 40, 40; 50 | STABILIZED | both thresholds inclusive |
| MAN, 39.9, 60; 50 | RUNNING | output threshold, just under |
| MAN, 60, 39.9; 50 | RUNNING | flow threshold, just under |
| MAN, 60, 60; 79.9 | STABILIZED | level clause, just under 80 |
| CAS, 50, 60; 80 | RUNNING | level clause at exactly 80 (your case) |
| MAN, 60, 60; 85 | RUNNING | level clause above 80 |

`docs/dev/CODE-MAP.md` (line 116): `stable:'contain'|'alarms'|'restore'` plus one sentence saying `'restore'` is D4 only, spec CR11, and is `'alarms'` plus the feed back (FIC102 in CAS, or output and flow both at 40 or more) and LIC101 under 80 %.

## RED, GREEN, mutation

- RED: the rewritten unit test against the previous commit's code fails at the second case, `flow 45 but the output still cut to 20 %: not restored`, expected RUNNING, actual STABILIZED (the first case passes there, since a flow of 28 is under the old 30).
- GREEN: the unit test and both scorer tests pass on the new code (3 of 3).
- Mutation run over `src/plant-core.js`, fourteen edits, restored byte-identical (`cmp`): thirteen killed, one survivor.

| Mutation | Result |
|---|---|
| drop the CAS alternative | killed (unit) |
| drop the output conjunct | killed (unit) |
| drop the flow conjunct | killed (unit) |
| drop the whole feed clause | killed (unit) |
| drop the level clause | killed (unit) |
| `CAS && (output and flow)` instead of `||` | killed (unit and the guidance scorer test) |
| level boundary `<= 80` | killed (unit) |
| output threshold 40 to 41, and to 39 | both killed (unit) |
| flow threshold 40 to 41, and to 39 | both killed (unit) |
| alarm part unacknowledged-only (the literal snippet from round 1) | killed (cut-and-leave scorer test) |
| D4 back to `stable:'alarms'` | killed (cut-and-leave scorer test and unit) |
| flow read from raw `pv` instead of `pvOf(L.FIC102)` | SURVIVED |

The survivor is an equivalent mutant in practice: observed and raw flow differ only below the 1.2 m3/h low-flow cutoff or past the window edges, never near 40. I did not contrive a test for it.

## Covering tests and the three gates

| Command | Result |
|---|---|
| `node --test tests/app-scorer-moc.test.js tests/app-credibility-s1.test.js tests/golden-drills.test.js` | 39 tests, 31 pass, 8 fail: golden drills D1, D2, D3, D4, D6, D9, D11, D12, all already-named movers; nothing else |
| `python3 tools/build-dist.py` | ok; a second build is a no-op |
| `node --test tests/*.test.js` | 1154 tests, 1117 pass, 36 fail, 1 skipped; the same 36 named red: 14 arch (A1 to A12, A1 gated, A6 gated), the g2-lifecycle archive test, 8 golden drills, 13 golden upsets; nothing else |
| `tools/smoke.sh` | `SMOKE folder: ok`, `SMOKE dist: ok` |

## Seeds re-run, as asked

Seeds 1 to 20, the three policies as the scorer tests script them (literal guidance restoring at TIC201 falling and TK-101 at 77 %, idle, cut-and-leave), under the refined rule:

| Policy | Result on 20 of 20 |
|---|---|
| literal guidance | 90 pass, no trip, STABILIZED 482 to 489 s into the 720 s window (round 1: 480 to 487) |
| doing nothing | 45 fail, R-201 trips |
| cut the feed and leave it cut | 65 fail, TIME LIMIT, TK-101 trips at 98 %, `tStable` never set |

The unattended D4 golden run is unchanged by the refinement: end-state digest `9a7ba61b9f16b8c5`, alarm sequence `4353db612233e800`, 113 events, TIME LIMIT, the same as before CR11.

## Extra check: the return-to-CAS route end to end

The refined rule accepts CAS on its own, and nothing in the scorer tests drives that route, so I ran it (cut 60 s after the first alarm, then FIC102 back to CAS when TIC201 is falling and TK-101 reaches a given level), seeds 1 to 4:
- CAS at TK-101 70 %: 90 pass on all four, STABILIZED at 479 to 496 s, tank peak 74.5 % (LIC101 draws it down), no trip.
- CAS at 77 %: only seed 3 stabilised (90, at 481 s). Seeds 1, 2 and 4 end at the time limit with 75. Seed 1's timeline shows the rule working as designed: the hold counted up to 54 s and reset when the tank crossed 80 %; the cascade then ramped the feed to 80 m3/h, TK-101 peaked at 80.4 %, LIC101 PVHI stood for a while, and the cooled reactor (138 C) sat in a TIC201 low alarm to the limit.
So the CAS route is timing-sensitive in the same way the output route is (a late restore overshoots); it is plant behaviour, not the rule, and an earlier return is safer. Reported for the controller; no code or test depends on it.

## Scratch artifacts added (outside the repo)

`/tmp/mutate3.py`, `/tmp/d4cas.js`, `/tmp/d4cas2.js`, `/tmp/plant-core.cr11b.js`, plus the earlier ones. Not deletable from here (the T2Helix hook blocks recursive deletes).

---

# Fix report 3: every clause of the restore rule pinned, CAS counts only with LIC101 in control (review Important 1, CR11b)

Commit `ba3120e` `test(drills): pin every clause of D4's restored-feed rule; CAS counts only with LIC101 in control`, a new commit on top of `e628334` (your docs commit, above `d7903c0`); not amended, not pushed. Staged by name: `src/plant-core.js`, `tests/app-scorer-moc.test.js`, `tests/app-credibility-s1.test.js`, `docs/dev/CODE-MAP.md`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`. Not touched, still modified and unstaged: `docs/dev/CREDIBILITY-PASS-SPEC.md`, `docs/dev/CREDIBILITY-PASS-PLAN-S1.md`; and the untracked `NIGHT PREVIEW.dc.html`.

## What changed

`src/plant-core.js` (`drillWatch`)
- CR11b (1): shelving keeps the inherited meaning, a shelved related alarm counts as quiet. Unchanged in code, now pinned.
- CR11b (2): the feed clause is `((L.FIC102.mode==='CAS'&&L.LIC101.mode!=='MAN') || (L.FIC102.op>=40 && ESS.Pid.pvOf(L.FIC102)>=40))`.
- CR11b (3): the level clause is `ESS.Pid.pvOf(L.LIC101)<80`; the comment says the flow and the level are read as observed values.
- Minor taken: the alarm part shared by `'alarms'` and `'restore'` is one local, `const quiet=()=>m.tAck&&!this.alarmEngine.active().some(x=>def.rel.includes(x.tag)&&!x.shelved)`, used by both branches. It is a lazy arrow, so drills on the other branches evaluate nothing new.

`tests/app-scorer-moc.test.js`
- The helper is now `stableVerdict(id, {mode, op, flow, tank, lic, ack, alarm, seen})` with `d4Verdict` as its D4 alias: `alarm` is `'standing'` (raised, acknowledged, left active), `'shelved'` (then shelved) or `'unrelated'` (a standing alarm on TIC301); `ack:false` drops the acknowledgement credit; `lic` sets LIC101's mode; `seen` sets pvObs apart from pv.
- The D4 test has 21 cases (fresh plant each): feed clause, including your new case (FIC102 in CAS with LIC101 in MAN at a low output and the tank at 79 gives RUNNING) and its counterpart (output 60 and flow 60 with LIC101 in MAN still ends it, so the LIC101 condition only qualifies the CAS route); level clause (79.9, 80, 85); alarm clause as the review asked (no acknowledgement gives RUNNING; an acknowledged alarm still standing gives RUNNING; the same alarm shelved gives STABILIZED) plus an unrelated standing alarm gives STABILIZED; and four cases with `seen` showing the rule follows the transmitter, not the model.
- One small second test runs the same alarm cases through D2's default `'alarms'` mode (5 cases), which is what ties the two modes to the one `quiet()` rule.
- The acknowledged-and-standing case is deliberate: an unacknowledged standing alarm is blocked by both the `active()` and the `unacked()` forms, so only an acknowledged one separates them.

`tests/app-credibility-s1.test.js`: the D7 test is retitled "D7: the jacket transmitter saturates at its reporting limit and the loop record tracks the observed value". Title only.

`docs/dev/CODE-MAP.md` line 116: the CAS condition now reads "FIC102 in CAS with LIC101 not in MAN".

## RED, GREEN, mutation

- RED: the only behaviour change in this round is CR11b (2). The rewritten D4 test against the previous code (`d7903c0`) fails at exactly that case: `FIC102 in CAS but LIC101 parked in MAN at a low output is not drawing the tank down`, expected RUNNING, actual STABILIZED. Every other new case (the alarm clause, the observed reads, the D2 cases) passes on the previous code, because it pins behaviour that already existed; their value is the mutation table below.
- GREEN: all four D4 and alarms tests pass on the new code (the two scorer tests, the clause test, the D2 test).
- Mutation run, 26 edits over `src/plant-core.js`, file restored byte-identical (`cmp`), all 26 killed:

| Group | Edits | Result |
|---|---|---|
| alarm part | drop `m.tAck`; drop the shelved exemption; drop the active-alarm part; unacknowledged-only without `tAck`; `tAck` with unacknowledged-only; drop the `def.rel` scoping | all killed (the first three are the review's three) |
| feed clause | drop the CAS route; drop the output conjunct; drop the flow conjunct; drop the whole clause; `CAS && (output and flow)`; drop the LIC101-in-control condition; require LIC101 of the output route too; both thresholds up and down by one | all killed |
| level clause | drop it; `<= 80`; 80 to 85; 80 to 75 | all killed |
| raw reads | flow read from raw `pv`; level read from raw `pv` | killed once the four `seen` cases were added (they survived before: observed and raw are equal at these values) |
| dispatch | D4 back to `'alarms'`; default mode ignores the alarms; default mode no longer shares `quiet()` | all killed |

## Covering tests and the three gates

| Command | Result |
|---|---|
| `node --test tests/app-scorer-moc.test.js tests/app-credibility-s1.test.js tests/golden-drills.test.js tests/app-instructor.test.js` | 68 tests, 60 pass, 8 fail: golden drills D1, D2, D3, D4, D6, D9, D11, D12, all already-named movers; `app-instructor` and the rest fully green |
| `python3 tools/build-dist.py` | ok; a second build is a no-op |
| `node --test tests/*.test.js` | 1155 tests, 1118 pass, 36 fail, 1 skipped; the same 36 named red (14 arch, the g2-lifecycle archive test, 8 golden drills, 13 golden upsets), nothing else |
| `tools/smoke.sh` | `SMOKE folder: ok`, `SMOKE dist: ok` |

## Seeds re-run, as asked

Seeds 1 to 20, the three policies as the scorer tests script them, final rule:

| Policy | Result on 20 of 20 |
|---|---|
| literal guidance (restore at TIC201 falling and TK-101 at 77 %) | 90 pass, no trip, STABILIZED 482 to 489 s into the 720 s window |
| doing nothing | 45 fail, R-201 trips |
| cut the feed and leave it cut | 65 fail, TIME LIMIT, TK-101 trips at 98 %, never reports stable |

Because the shared `quiet()` local touches the default branch, I also compared all eight drills' unattended runs between `e628334` (a `git archive` scratch tree) and the working tree: end-state digest, alarm sequence, step count, end reason and event count are identical for every drill, so the refactor moves nothing and no fixture is affected by this commit. The unattended D4 run is unchanged (`9a7ba61b9f16`, `4353db612233`, 113 events).

## Notes

- Process: while counting cases I re-ran the 26-edit mutation battery once by accident (output discarded). The script restores the file byte-identically; I then verified `git status` showed no partially staged files and no unstaged difference in any staged file before committing.
- `quiet()` returns `m.tAck`'s value when it is unset (undefined), exactly as the old inline expression did; `d.stableFor` treats it as false, so behaviour is unchanged.
- Scratch artifacts added outside the repo: `/tmp/ess-prev` (git archive of `e628334`), `/tmp/mutate4.py`, `/tmp/alldrills.js`, `/tmp/plant-core.cr11c.js`, plus the earlier ones. Not deletable from here (the T2Helix hook blocks recursive deletes).
