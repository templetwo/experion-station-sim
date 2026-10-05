<!-- @artifact dev -->
# Task 1 report: HOLD freezes the sequence and ownership is one rule (model)

Seat: MacBook seat (Sonnet 5.5), delegated implementer. BASE 2d78a3b. Branch fix/playtest-2026-10.
Commit: 8d5de29 `feat(models): HOLD freezes the batch sequence; ownership is one rule; the phase setpoints live in one table`
(one commit, not pushed; trailers exactly as given; `NIGHT PREVIEW.dc.html` never staged).

Status: DONE_WITH_CONCERNS (one structural deviation from the brief's verbatim `sequence()` body, forced by an existing
test; see Deviations. Everything else as briefed.)

## What was implemented

`src/models.js`:
- `phaseSetpoints(b, P) -> { FIC211, TIC212 }`: FIC211 20 in FEED (0 under `P.trips.batch`, 0 in every other phase);
  TIC212 80 in HEATUP/FEED/REACT, 40 in COOL/DRAIN, `null` in CHARGE and IDLE. Exported (between `step` and `PARAMS`) and
  listed in the API comment block.
- `sequence()`: while `b.held` the timer, the transitions, the CHARGE charge, the DRAIN drain and every setpoint write are
  skipped. Both loops' `modeAttr` is written every scan from one rule: `PROGRAM` when the phase is not IDLE and not held,
  else `OPERATOR`. The CHARGE -> HEATUP and REACT -> COOL jacket writes now read the table (written after `setPh(...)`, as
  the brief says). The FEED setpoint write reads the table on every running scan of an active phase.

`tests/models.test.js`: the brief's six tests appended verbatim under the brief's comment (models.test.js 17 -> 23 tests;
suite 1235 -> 1241).

Rebuilt: `python3 tools/build-dist.py` (restamps `src/model-id.js`; the dist manifest's models.js blob decoded and compared
byte-identical to `src/models.js`).

## Files changed (the commit)
- src/models.js
- tests/models.test.js
- src/model-id.js (restamp only)
- dist/experion-station-sim-standalone.html (rebuild only)

`tests/app-models.test.js` is NOT in the commit: no assertion needed to change. Lines 123 (PROGRAM after START + one step,
not held) and 153 (OPERATOR after forcing IDLE) never asserted PROGRAM while held; the test at 339 ("attribute follows on
the next scan") passes unchanged. `src/plant-core.js` and the page untouched.

## TDD evidence

RED, `node --test tests/models.test.js` before any `src/` change: `# tests 23 / # pass 18 / # fail 5`.
```
not ok 18 - phaseSetpoints: ...                    models.test.js:295  error: 'Models.phaseSetpoints is not a function'
not ok 19 - HOLD during CHARGE freezes ...         models.test.js:316  expected: 'CHARGE'  actual: 'HEATUP'   (the phase check after the held window)
not ok 20 - HOLD during DRAIN freezes the drain... models.test.js:331  expected: 'DRAIN'   actual: 'IDLE'     (the phase check after the held window)
not ok 21 - ownership is one rule: ...             models.test.js:342  expected: 'PROGRAM' actual: 'OPERATOR' ('CHARGE is an active phase')
not ok 22 - while held the sequence writes no setpoint ... models.test.js:366  expected: 5 actual: 0   ('an operator setpoint during the hold is honoured')
ok 23 - the transitions still set the jacket from the table ...
```
Differences from the brief's prediction (test text unchanged, only the first failing assertion differs): in the CHARGE and
DRAIN hold tests the old sequence ran the charge to HEATUP / the drain to IDLE during the 120 s / 50 s hold, so the phase
assertion (which precedes the pt and level assertions) fails first, with 'HEATUP' / 'IDLE', not pt 130 / the level. The sixth
test (transitions set the jacket from the table) passes before the change by design: it pins behaviour that must not move
through the reordering of the two writes after `setPh(...)`.

GREEN, `node --test tests/models.test.js tests/app-models.test.js` after the change: `# tests 42 / # pass 42 / # fail 0`
(the six new tests `ok 1..6` under `--test-name-pattern`).

## Gates (final, on the committed tree)

`node --test tests/*.test.js`: `# tests 1241 / # pass 1237 / # fail 3 / # skipped 1` (baseline before the task: 1235 tests,
1234 pass, 0 fail, 1 skipped). The three red tests are exactly the named movers, none re-captured, no fixture touched:
```
not ok 550 - A5 Controller loss: weighted diagnose-phase fixture is 65 before SAFE_RESTRAINT/debrief completion
  A5: physics endState digest moved from the committed fixture
  expected 5f55ec991333ea850e4af69edcf376742a0a16b7d92afb5e96f1176f9f5d4ee3
  actual   831f33156785b461c570737bc01263d069025cc7223caae15e7f42be5ce914fd
not ok 642 - golden: drill D11 unattended run is deterministic and matches the committed fixture
  D11: end-state digest moved from the committed golden
  expected af8884fed50810e607dc13b46129fa402dbe24c7d3e1ba5ff444377d5ef16676
  actual   ae8d79aa94c3acea9232f175c56006a6d250eadac3ea62ac86a79e962ba503f6
not ok 663 - golden upset: agit-batch (setUpset instructor path, +300s post-inject)
  agit-batch: v2 end-state behaviour changed since capture
  expected 09d56e6f57c7573702c47dadefcd86cd251268859ea75eabfcd71d7117cd0883
  actual   45b0eb8f775aa7498c5ec254e27b21a46ee0891b36074f688e89c0fb19595fc1
```
Every archive guard (`tests/v2-baseline-archive.test.js` and the rest) is green. `python3 tools/build-dist.py` ran (see
above). `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok` (first try, no DNS retry needed).

Cause of the three moves, measured by ablation in place (variants of `src/models.js`, file restored and verified
byte-identical afterwards): the ownership rule alone (base sequencing + the new attribute rule) moves D11, agit-batch and A5;
the HOLD freeze alone (base setpoint and attribute tail) moves D11 and agit-batch but not A5; forcing the feed setpoint to 0
while held (the effect Task 2's HOLD write will have) brings none of the three back. So the movers are §4 (both halves), as
the spec's §11 table expects, and Task 2 will not rescue them: Task 6 re-captures them.

## Deviations from the brief

1. `sequence()` structure (needed; not a value change). The brief's verbatim body computes ownership at the top from the
   phase at the START of the scan and then `return`s while held. With that body the attribute lags one scan at the end of
   a batch: on the scan in which DRAIN sets the phase to IDLE the loops still read PROGRAM (and the sequence has just put
   TIC212 in MAN), contradicting the brief's own rule ("PROGRAM while the phase is not IDLE"). It also breaks an existing,
   unmentioned assertion: `tests/app-models.test.js` test "after a TI216 shed clears, RESUME lets the SCM restore FIC211 to
   AUTO and the batch completes without ABORT" ends with `run(c, 7200, () => c.P.b.phase === 'IDLE')` and then
   `assert.equal(c.L.FIC211.modeAttr, 'OPERATOR')` (expected 'OPERATOR', actual 'PROGRAM' with the verbatim body; the old
   code wrote the attribute after the transitions). The brief forbids changing other assertions, so I changed the code:
   the timer, transitions, charge, drain and setpoint writes sit in an `if (!b.held) { ... }` block, and the single
   ownership rule is written after it, every scan, from the resulting phase. Behaviour is identical to the verbatim body in
   every scan except the DRAIN -> IDLE one, where the attribute is OPERATOR at once, as in the old code. Checked: the three
   movers' actual digests are identical under both bodies (so no golden depends on the difference); with the verbatim body
   the full suite had this one extra red (plus the model-id stamp test, which is only the unbuilt-tree artefact).
   To revert to the brief's form is a ten-line change; the existing app-models test at the end of that test is what pins it.
2. API comment line: text exactly the brief's, whitespace adjusted so the description starts at column 48 like its
   neighbours (the brief's line starts it at column 46); placed after the `step(...)` line, mirroring the export order.
3. `tests/app-models.test.js` not edited and not staged (the brief's `git add` listed it conditionally).

## Self-review

Completeness: the frozen branch covers the timer, all six transitions (including the setpoint/mode writes on the two that
make them), the charge, the drain, the FIC211 setpoint write. The attribute rule covers IDLE (OPERATOR), CHARGE and every
other active phase (PROGRAM), held in any phase (OPERATOR) and the scan after HOLD / RESUME. The table matches the
transitions: CHARGE -> HEATUP writes 80 (table, HEATUP), REACT -> COOL writes 40 (table, COOL), DRAIN 40 is the value COOL
already set; FIC211 is 20 only in FEED without the batch trip. The old `L.FIC211.sp` rule (`held || trip ? 0 : 20` in FEED,
0 in other active phases, nothing in IDLE) is reproduced except for held scans, which write nothing by design.
Discipline: nothing beyond the brief (no seqCmd, no page, no docs, no CHANGELOG, no extra tests). The 80/40 literals now
live once. No `Math.random`, no DOM, UMD intact (the browser-global key-parity test passes with the new export).
Testing: exact values throughout (pt 10 / 10.5, lvl 17 / 17.25, 30 / 29.6, sp 5 / 20 / 77); output pristine apart from the
three named reds.

## Concerns

- Interim behaviour until Task 2: `seqCmd('HOLD')` still only toggles the flag, and `sequence()` now writes nothing while
  held, so a HOLD in FEED leaves FIC211.sp at 20 and the monomer keeps flowing. Measured (seed 4, FEED, level 50): after
  HOLD and 60 s, sp 20, mf 12.4 -> 19.1, level 51.9 -> 64.1, phase timer frozen at 20 s, FIC211.modeAttr OPERATOR. No
  existing test covers it (the full suite is green apart from the movers). This commit should not ship without Task 2.
- The three movers' digests in this report were taken at this interim state; Task 6 must re-capture after the final build,
  not from these.
- The model-id stamp test (and the stamp-idempotence test, which skips) is red/skipped on any tree where `src/` changed
  and `build-dist.py` has not run; it is green again after the build, so it is not one of the movers.
- Did not boot the Sovereign Stack and wrote nothing to the chronicle: delegated implementer seat, the controller holds the
  boot. Scratch (suite logs, the verbatim-body copy, the ablation script) lived under /tmp and has been removed.
