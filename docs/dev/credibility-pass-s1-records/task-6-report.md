<!-- @artifact dev -->
# Task 6 report: the plant decides who tracks (`forcedOutputs`) and the OP refusal (D1, D10)

Status: DONE_WITH_CONCERNS. One deviation from the brief's snippet (spec §12), six moved fixtures of which two (drill-D12, upset-bedact) are in no expected list, and one D4 scorer scenario whose end changed. Each wants a controller ruling; none blocks the stage (see Concerns).
Commit: `8e53e13 feat(core): the plant decides who tracks: a stopped pump or a trip holds the loop's output honestly` on `fix/playtest-2026-10` (base 4da8f45). Not pushed.
Seat: MacBook seat (claude-sonnet-5-5), host `Anthonys-MacBook-Pro.local`.

Update after the controller's rulings: the spec §12 deviation described below was reverted by CR18 in `cea3f67`; the movers, the D4 idle change and the AUTO-mode behaviour were accepted (CR19, noted, CR20). The fix report at the end is current; the sections between are kept as the record of the first pass (superseded where they describe the §12 branch: the deviation paragraph, mutant M15, extra test 2, concern 1).

## What I implemented

`src/plant-core.js` (+23 lines)
- `advanceScan`: `this.forcedOutputs();` on its own line between `this.measure();` and `this.pids(dt);`.
- `forcedOutputs()` beside `pids(dt)`, the brief's five rows verbatim: FIC102 under `trips.rx` (interlock, 0), FIC102 with `!trips.rx` and P-101 stopped (device, `safeop||0`, `P-101 STOPPED`), FIC211 and TIC213 under `trips.batch`, TIC311 under `trips.bed||trips.skin`; interlock reasons are the matrix's `src + ' ' + cond`. It returns the Set and clears the four loops that are not in it.
- `operatorMayWrite`: the brief's refusal as the first check after the kind guard (`param==='OP' && l.trk && l.trk.on && l.trk.kind==='interlock'`): `rejectWrite` (journal `WRITE REJECTED — OUTPUT INTERLOCKED — <reason>`, callout) then the message zone `ENTRY REJECTED — OUTPUT INTERLOCKED (<reason>)`.

One deviation from the brief's snippet. The brief's `name(id)` falls back to the cause id when the matrix cannot name a cause, so the loop still tracks with a raw id as its reason. Spec §12 says the opposite ("`forcedOutputs()`: a missing reason source means no tracking; a test pins it"), the plan's header lists §12 among the sections it implements, and no other task covers that row. I followed the spec: `name()` returns `''` for a cause the matrix cannot name, and a row with an empty reason does not track (about 2 lines), pinned by a test. Nothing observable changes while the matrix is present. Reversal is one token (`:''` back to `:id`) plus deleting that test.

Rebuilt by `python3 tools/build-dist.py`: `src/model-id.js` and the standalone are in the commit. I decoded the standalone's bundler manifest: its `plant-core.js` entry equals `src/plant-core.js` byte for byte. A second build left the tree unchanged.

## TDD evidence

RED, the brief's five tests appended before any source change: `# tests 27 / pass 22 / fail 5`. D1 restart and the snapshot test: `Cannot read properties of undefined (reading 'on')`; D10: `(reading 'kind')`; the matrix test: `c.forcedOutputs is not a function`; the D1 MAN test fails its last assertion (no tracking, so OP is not 0 after the return to AUTO).
GREEN, the brief's code applied: `# tests 27 / pass 27`. Final file with the four extras: `# tests 31 / pass 31 / fail 0`.
RED re-check on the committed file: run against a clean 4da8f45 export, the 9 new tests (23 to 31) fail and the 22 older ones pass.

## Mutation check (scratch copies under /tmp, repo untouched)

24 single-edit mutants of `forcedOutputs()` and the refusal. The brief's five alone: 16 killed, 8 survived. The nine tests: 23 killed, 1 survived.

| Survivor of the brief's five | Killed by |
|---|---|
| M04 device row drops `!trips.rx` | equivalent: the first-row-wins guard makes it redundant; not killable |
| M07 refusal ignores `param` (MODE and SP refused too) | extra 3 (setMode still works under a trip) |
| M08 refusal ignores `trk.on` (a released loop keeps `kind:'interlock'`, so it would refuse for ever) | extra 3 (an OP entry is accepted after the trip resets) |
| M13 device target is a fixed 0, ignoring SAFEOP | extra 4 (SAFEOP 15) |
| M14 `forcedOutputs()` returns an empty Set | extra 1 |
| M15 a missing reason falls back to the id (the brief's snippet) | extra 2 |
| M22 FIC211 also forced on a sequence HOLD | extra 1 |
| M23 FIC211 also forced when M-202 is stopped | extra 1 |

The other 16 (call dropped, call after `pids`, device row as interlock, refusal kind swapped, no message, no clear loop, TIC311 reason swapped, rows dropped or re-keyed, TIC311 clear dropped, target 100, refusal not journaled, device reason changed, TIC213 kind, tracking on the overflow trip) die on the brief's own tests.

## Tests added beyond the brief (4, each for a survivor above)

1. `forcedOutputs()` returns exactly the loops of the valve columns the matrix declares for each of the seven process-trip causes (the flag read from the cause's own `latch.field`), is empty for the three trips with no valve column, empty for a HOLD plus an agitator stop, and `['FIC102']` for a stopped pump.
2. A matrix that cannot name R-201 tracks nothing; a stopped pump (the code's own reason) still tracks; restoring the matrix restores the tracking (spec §12).
3. The OP refusal at the shared gate: `openEntry` in CAS (refused as interlocked, not as INVALID MODE) and in MAN, `raiseLower`, `setMode` still allowed, three `WRITE REJECTED` events, nothing for FIC102 in the replay journal except the MODE, and after the trip resets the same entry is accepted and journaled as `OP CHANGE`.
4. Review focus 5 with a non-zero SAFEOP (15): stop the pump, MAN with OP 40, back to AUTO, the next scan holds at 15 and `trk` reads `{on, device, 15, 'P-101 STOPPED'}`.

## Checks before commit

- Focused: `app-credibility-s1` (31), `app-models`, `app-scorer-moc`, `pid`: 100 / 100 pass. The M202-trip test and the three D4 scorer tests are green by name.
- Full suite at the commit's tree: `# tests 1188 / pass 1151 / fail 36 / skipped 1` (baseline 1179 / 1142 / 36 / 1; +9 tests, all green). The 36 red names are identical to the baseline set (14 arch fixtures, 8 golden drills, 13 golden upsets, g2-lifecycle); `comm` of the sorted name lists shows no new red and nothing turned green.
- `tools/smoke.sh`: folder ok, dist ok.
- Nothing under `tests/fixtures/` touched; `NIGHT PREVIEW.dc.html` not staged (four files staged by name).

## The restart trajectory (the brief's sequence, seed 4)

60 s settle, stop P-101, 60 s stopped, START. During the stop: FIC102 `trk {on, device, 'P-101 STOPPED'}`, OP 0, FV102 closed, LIC101 `init` true with its OP back-calculated to 0, TK-101 at 58.2 %.

| sim s after START | 10 | 30 | 60 | 120 | 180 | 300 | 450 | 600 |
|---|---|---|---|---|---|---|---|---|
| FIC102 flow m3/h | 0.8 | 5.5 | 14.9 | 35.8 | 54.0 | 78.3 | 79.5 | 79.4 |
| LIC101 OP % | 2.9 | 8.7 | 17.7 | 34.7 | 49.3 | 68.8 | 79.8 | 81.8 |

Max flow **79.55 m3/h** (at 404 s, SPHILM 80); first at 30 m3/h at **103.5 s**; first at 50 m3/h at **166.5 s**; no tick above 80.5; tracking released on the first tick after START; TK-101 peaks at about 73 % near 180 s. Feed reaches 30 m3/h well inside 600 s, so the DONE_WITH_CONCERNS trigger you set is not met.
Robustness: seeds 1 to 5 (60 s stop) give t30 103.5 s, t50 165.5 to 166.5 s, max 79.55; a 30 s stop gives 114.5 s / 183 s / 79.52; a 180 s stop (tank 75.4 % at restart) gives 75.5 s / 119.5 s / 79.67.
Before this change (clean 4da8f45, same sequence): FIC102 OP wound to 100 and FV102 fully open at the restart, flow at 30 after 1 s, at 50 after 2 s, peak 95.7 at 8.5 s, 75 ticks (37.5 s) above 80.5.

## The D4 scorer scenarios, seeds 1 to 20 (the three scenarios of `tests/app-scorer-moc.test.js`)

Scores and end reasons were uniform across the 20 seeds in every cell.

| Scenario | Before (4da8f45) | After |
|---|---|---|
| literal guidance | 20/20 STABILIZED, score 90, 20/20 pass, no trip, peaks 176.5 C / 77.2 % | identical |
| doing nothing | 20/20 **STABILIZED**, score **45**, 0 pass, R-201 trip 20/20, peaks 187.6 C / 73.8 to 74.0 % | 20/20 **TIME LIMIT REACHED**, score **30**, 0 pass, R-201 trip 20/20, peaks 187.6 C / 84.0 to 84.2 % |
| cut and leave | 20/20 TIME LIMIT REACHED, score 65, 0 pass, TK-101 trip 20/20, no R-201 trip | identical |

Why the idle run moved: before, FIC102's OP and LIC101's OP wound up during the trip (100 and 99 by the reset), so the reset surged the feed to 97.5 m3/h and the drill read STABILIZED while the plant was still cycling. Now FIC102 holds 0, LIC101 back-calculates, and after the reset the feed climbs on the integral ramp while TK-101 keeps filling to about 84 %, above its 80 % PVHI, so the 'restore' stability never holds inside the window. "Doing nothing still fails" holds (30 < 80, trip row earns 0). This also removes the pre-existing "idle run that trips R-201 ends STABILIZED" oddity that Task 3's re-review noted.

## Golden movers, measured

I re-captured the goldens (UPDATE_GOLDENS=1) in two scratch copies, a clean 4da8f45 export and this tree, and compared the fixtures with the model-id stamp excluded (every re-captured fixture embeds it, so a raw diff flags all 40 of them). Then I removed one `forcedOutputs()` row at a time and re-captured again to attribute each move.

| Fixture | Moves because of | Row that alone accounts for it |
|---|---|---|
| `drill-D3`, `upset-pump` | the stopped pump (D1) | FIC102 device row |
| `drill-D4`, `upset-cool` | the R-201 trip held (D10) | FIC102 interlock row |
| `drill-D12`, `upset-bedact` | the R-310 bed trip held TIC311 (D10) | TIC311 interlock row |

The other 55 fixtures (all 14 arch fixtures, the other five drills and ten upsets, the five u4 fixtures, the 21 v2-baseline fixtures) are identical to the base capture, stamp aside. The FIC211 and TIC213 R-202 rows move no fixture. All six movers are already in the red set from Task 3's FIC211 cutoff, so there is no new red name. `drill-D12` and `upset-bedact` are not named in the brief's expected list or in spec §11's table row text (which says R-201 and FIC102), though they are the same §3 mechanism; the commit message says so.

## Files changed (commit 8e53e13, four files, 200 insertions, 2 deletions)

`src/plant-core.js`, `tests/app-credibility-s1.test.js` (+175), `src/model-id.js` and `dist/experion-station-sim-standalone.html` (build output).

## Self-review

- Completeness: every item in the brief is in; the three checks ran on the committed tree; the restart trajectory, the D4 table and the mover set are measured, not inferred.
- Quality: the brief's code is verbatim except the §12 line. Two small hazards I left as the brief wrote them: the clear loop's tag list duplicates the rows' tags, so a future row for a new loop would need both edits (deriving it from the rows is a one-line change); and `forcedOutputs()` reads `L.FIC102.safeop` eagerly even when its row is off (harmless).
- Discipline: only the brief's files; the four extra tests are each tied to a mutant, and `forcedOutputs` is not touched by the page (Task 7's flag text will read `l.trk`).
- Testing: the new tests assert exact values and journal text, not ranges; the D1 restart bound is the brief's `<= 80.5`, with the measured 79.55 beside it.

## Issues or concerns (for rulings)

1. **Spec §12 versus the brief's snippet.** Described above. If you want the brief's fallback to the id, revert `:''` to `:id` and drop extra test 2.
2. **Two movers beyond spec §11's table text.** `drill-D12` and `upset-bedact` move through TIC311's tracking under the R-310 bed trip (spec §3.2 row 5). Suggest adding them to the §11 row for §3 interlock tracking (and to Task 9's `KNOWN_RECAPTURED` reasons) rather than treating them as a finding.
3. **D4 "doing nothing" now ends TIME LIMIT REACHED at 30 instead of STABILIZED at 45.** Still a fail, tests green; the cause is the ramp described above.
4. **The restart is a ramp, not an instant.** About 104 s to 30 m3/h and 167 s to 50 m3/h, because LIC101 INITMANs toward `invMap(0)` while the loop is held (the designed PV tracking during initialisation, Task 5's carry-forward). The operator can shorten it: in MAN the device hold yields, so OP can be pre-positioned (D3's teaching). The D1 narrative and the fidelity-intake doc should say the ramp is intended.
5. **A loop left in AUTO (not CAS) does not recover on its own.** I measured FIC102 in AUTO across a 60 s pump stop: during the stop SP tracks PV to 0 (`pvtrack`), OP 0; 120 s after the restart SP 0, OP 0, flow 0.1 m3/h, `trk` off. Before: SP stayed 60.06, OP wound to 100 during the stop, and the flow was back at 60.6 m3/h 120 s after the restart. It follows from the spec's "PV tracking applies" during a hold; in CAS (the default) the master drives the SP back. A trainee who parked FIC102 in AUTO must re-enter its SP. Worth a line in D1's debrief or the intake doc.
6. **Carry-forwards for Task 9's docs pass:** the plan's Task 6 snippet needs the §12 line; `docs/dev/CODE-MAP.md` (the `operatorMayWrite` paragraph and the PID paragraph) does not yet mention `forcedOutputs()` or the interlock refusal.

## Scratch tooling (outside the repo, not committed)

`/tmp/t6/` holds the measurement scripts (`restart.js`, `d4.js`, `d4idle.js`, `d3.js`, `auto.js`, `mutate.py`, `ablate.py`) and the raw outputs. Two scratch trees remain, `/tmp/t6-base` (a `git archive 4da8f45` plus a copy of the new tests and re-captured fixtures) and `/tmp/t6-work` (a copy of this tree with re-captured fixtures); the sandbox hook blocked `rm -r` on them, so they are left for Anthony or the OS to clear. The scripts run the "before" side with `node d4.js /tmp/t6-base` after `git archive 4da8f45 | tar -x -C /tmp/t6-base`.

---

# Fix report: CR18, an interlock the matrix cannot name still holds its loop, commit `cea3f67`

Status: DONE. One new commit on top of 8e53e13 (no amend): `cea3f67 fix(core): an interlock the matrix cannot name still holds its loop; the raw cause id names it`. Not pushed. `docs/dev/CREDIBILITY-PASS-SPEC.md` (the controller's uncommitted edit) was not touched and not staged; four files staged by name.
Seat: MacBook seat (claude-sonnet-5-5), host `Anthonys-MacBook-Pro.local`.

## What each ruling became

- **CR18 (concern 1), reverted.** The hold is the code's truth and the matrix only names it.
  - `name(id)` is the brief's again: `return c?(c.src+' '+c.cond):id;` (my `''` branch is gone).
  - The tracking loop is the brief's line again: `ESS.Pid.setTracking(l,target,reason(),kind); set.add(tag);` (my `const why=reason(); if(!why) continue;` gate is gone).
  - My §12 comment sentence said the opposite of the ruling, so it now reads: the hold is the code's truth and the matrix only names it; a trip flag whose cause the matrix cannot name still holds its loop with the raw cause id as the reason text; a missing flag or run state (no trips record, no P-101 record) holds nothing and never throws (spec §12). No ruling label in the source comment, so it cannot dangle.
  - Checked programmatically against the brief: the `forcedOutputs()` body, the refusal line and the `advanceScan` call order are character-identical to the brief's code; only the comment lines differ.
- **The test that pinned the old reading is flipped**, now `an interlock the matrix cannot name still holds its loop, and the raw cause id names it (CR18)`. With `CauseEffect.causes` stubbed to `[]`, and again with `ESS.CauseEffect` removed, each of the four interlock flags still holds its loops by interlock at target 0 with its raw id: `rx` gives `FIC102: R201_HITEMP`, `batch` gives `FIC211` and `TIC213: R202_HITEMP`, `bed` gives `TIC311: R310_HITEMP`, `skin` gives `TIC311: H310_SKIN`. With the matrix restored the reasons are its own names (`R-201 HI TEMP TRIP`, `H-310 TUBE SKIN TRIP`). The stub and the module are restored in a `finally`.
- **"No L.P101 record means no tracking": I did not have that case, so I added it**, with its sibling, as `a missing run state or flag record means no tracking and never throws (spec §12)`: with no `L.P101` there is no device hold on FIC102, while `trips.rx` still holds FIC102 (an interlock needs the flag, not the pump); with `P.trips` undefined (a snapshot that predates the flags) nothing is held, nothing throws, and a held loop is released.
- **CR19 (concern 2), concern 3, CR20 (concern 4):** accepted or noted as ruled; no change.

Net test file: 32 tests in `tests/app-credibility-s1.test.js` (22 earlier, the plan's 5, and 5 beyond them: the Set equality, the raw-id test, the missing-record test, the shared-gate refusal, the SAFEOP return).

## TDD evidence

RED, the flipped test and the missing-record test written before any source change: `# tests 32 / pass 31 / fail 1`. The flipped test fails: expected `{ FIC102: 'R201_HITEMP' }`, actual `{}` (nothing held under the old branch). The missing-record test passes on both sides, because the guards it pins (`!!L.P101 &&`, `P.trips||{}`) were already in the brief's code; it is a pin, not a RED to GREEN, and mutants N5 and N6 below show it can fail.
GREEN, after the revert: `node --test tests/app-credibility-s1.test.js tests/app-models.test.js`: `# tests 51 / pass 51 / fail 0`.

## Mutant evidence (scratch copies under /tmp, repo untouched)

30 mutants against the reverted code with the full test file: 29 killed, 1 survives (M04, the equivalent redundant `!trips.rx` on the device row, as before). The seven new ones, all killed by the two new tests:

| Mutant | Killed by |
|---|---|
| N1 the fallback returns an empty reason | the raw-id test |
| N2 the fallback is a constant wrong id | the raw-id test |
| N3 no guard for a missing matrix module | the raw-id test (the no-module half) |
| N4 the superseded rule: an unnamed cause holds nothing | the raw-id test |
| N5 no P-101 record guard (`!trips.rx && !L.P101.run`) | the missing-record test |
| N6 no trips record guard (`trips=P.trips`) | the missing-record test |
| N7 raw ids swapped between bed and skin | the raw-id test and the matrix-column test |

The other 23 (the first round's mutants M01 to M26 minus the retired M15) are all still killed except M04.

## Gates (on the committed tree)

- Covering tests: 51 / 51.
- Full suite: `# tests 1189 / pass 1152 / fail 36 / skipped 1` (the earlier commit's 1188 plus one: one test replaced by two). The 36 red names are the baseline set; `comm` of the sorted name lists shows no new red and nothing turned green.
- Build: `python3 tools/build-dist.py` rewrote `src/model-id.js` and the standalone, both in the commit; a second build changes nothing; the standalone's `plant-core.js` manifest entry equals `src/plant-core.js` byte for byte.
- Smoke: folder ok, dist ok.
- Staged by name: `src/plant-core.js`, `tests/app-credibility-s1.test.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html` (4 files, 38 insertions, 17 deletions). The controller's spec edit and `NIGHT PREVIEW.dc.html` stay unstaged.

## Concerns

None new. For Task 9's docs pass: the plan's Task 6 snippet and the code now agree (the §12 line I had flagged is moot), and `docs/dev/CODE-MAP.md` still does not mention `forcedOutputs()` or the interlock refusal. The scratch trees `/tmp/t6-base` and `/tmp/t6-work` from the first pass are still there (the sandbox hook blocks `rm -r`); `/tmp/t6/mutate2.py` and `/tmp/t6/mut-fix-round.txt` hold this round's mutation runner and output.

---

# Fix report: five review minors, commit `605253e`

Status: DONE. One new commit on top of 9d7cc50 (the controller's docs commit; no amend): `605253e test(core): the restart test pins the recovery it claims; the release list derives from the rows`. Not pushed (the branch is 4 commits ahead of origin: 8e53e13, cea3f67, 9d7cc50, 605253e). Four files staged by name; `NIGHT PREVIEW.dc.html` untouched.
Seat: MacBook seat (claude-sonnet-5-5), host `Anthonys-MacBook-Pro.local`.

## What each item became

1. **Exact primary output.** Measured first (seed 4, the test's own sequence): after the 60 s stop `LIC101.op` is exactly `0` (`Object.is(op, 0)` true, so a plain `assert.equal(..., 0)` holds). `assert.ok(c.L.LIC101.op < 100)` became `assert.equal(c.L.LIC101.op, 0, ...)`, with a message naming the 64.25 the plant before tracking leaves there (my own first-pass run of 4da8f45 measured 64.2475, matching the review's figure).
2. **The whole recovery.** The window is 900 s. Measured over it: max flow 79.5535 m3/h at 404 s, first at 30 m3/h at 103.5 s, first at 50 m3/h at 166.5 s, tracking released, no trip. (The old 300 s window ended at 78.33 m3/h at 300 s and never saw the peak.) The test keeps `maxFlow <= 80.5` and now asserts `Math.abs(t30 - 103.5) <= 0.5` and `Math.abs(t50 - 166.5) <= 0.5` (one scan), with `t0` taken from `c.P.t` right after the START.
3. **One source of truth for the release list.** `const tags=[...new Set(rows.map(r=>r[0]))]; for(const tag of tags) if(!set.has(tag)&&L[tag]) ESS.Pid.clearTracking(L[tag]);` replaces the hard-coded four-tag list, with a one-line comment. Same four tags today, so no behaviour moves and no golden moves.
4. **Coverage.**
   - (a) The shared-gate test (title kept, now true) stores an SP write on the held FIC102: it returns true, the SP is stored, an `SP CHANGE` event with `newV '50.00'` is journaled, and the count of `WRITE REJECTED — OUTPUT INTERLOCKED` events stays at 3. The check sits after the replay-journal assertion so that assertion is unaffected.
   - (b) New test `a trip and a stopped pump together: the interlock outranks the device hold, and the device hold takes over when the trip resets`: R-201 tripped, then P-101 stopped: `trk` is `{on, interlock, 'R-201 HI TEMP TRIP'}`; run to the trip reset with the pump still stopped: `{on, device, 'P-101 STOPPED'}` on the same scan.
5. **Comment.** The missing-trips-record line now reads: no flag record at all, the model always creates `P.trips`, so the guard is defensive only. (My earlier fix report repeated the old claim, "a snapshot that predates the flags"; this corrects it.)

Net: 33 tests in `tests/app-credibility-s1.test.js`.

## Evidence

These are strengthenings and a refactor on correct code, so the new assertions pass on first run (33 / 33); there is no RED against the implementation to show. What shows they discriminate is a mutant run against both the previous test file (HEAD before this commit) and the new one:

| Scratch mutant | Previous tests | New tests |
|---|---|---|
| the primary parks at 50 during INITMAN (`Math.max(target, 50)` in `runInitman`) | survives | killed (the exact LIC101 value and both trajectory numbers) |
| FIC102 SPHILM raised to 85, to 90, to 100 (a peak after 300 s) | all three survive | all three killed (the 900 s bound) |
| the refusal applies to SP writes too | survives | killed (the SP case) |
| the device row ahead of the interlock row and unconditional | survives | killed (trip plus stopped pump) |
| the release list derived from a truncated rows list (`rows.slice(0,2)`) | killed | killed (the matrix-column test) |

Regression: the earlier mutants (M01 to M26 without the retired M15 and M16, N1 to N7; M09 re-pointed at the derived loop) are all still killed except M04, the equivalent redundant `!trips.rx`. In all, 36 distinct mutants against the final code and tests: 35 killed, 1 equivalent.

## Gates (on the committed tree)

- Covering tests: `app-credibility-s1` (33) and `app-models` (19): 52 / 52.
- Full suite: `# tests 1190 / pass 1153 / fail 36 / skipped 1` (the previous 1189 plus the new test). The 36 red names equal the baseline set; `comm` shows no new red and nothing turned green.
- Build: `python3 tools/build-dist.py` rewrote `src/model-id.js` and the standalone, both in the commit; a second build changes nothing; the standalone's `plant-core.js` entry equals `src/plant-core.js` byte for byte.
- Smoke: folder ok, dist ok.
- Commit: 4 files, 34 insertions, 7 deletions; nothing under `tests/fixtures/`.

## Concerns and corrections

None new. Two small notes: six lines of the commit body run 101 to 102 columns (cosmetic; not amended, per the no-amend rule), and my earlier fix report said the scratch trees `/tmp/t6-base` and `/tmp/t6-work` were still there; they are not any more (gone between rounds), while the scripts and outputs remain in `/tmp/t6` (`pin.js` is this round's measurement, `mutate3.py` and `mut-minors-round.txt` its mutation runner and output). The three review minors the controller did not take are not in this commit.
