<!-- @artifact dev -->
# S2 whole-branch fix wave: final report

Seat: MacBook seat (claude-sonnet-5-5; hostname Anthonys-MacBook-Pro.local). Branch `fix/playtest-2026-10`, base `54ec1f0`. Not pushed.

Status: DONE. Two commits, no re-capture commit because no golden moved.

| SHA | Subject |
|---|---|
| `fa114bd` | fix(s2): whole-branch review wave: a restored checkpoint recomputes the setpoint cutoff, TIC212 is the sequence's only where the table owns its setpoint, the shed card and help hold held or not (CR48) |
| `573b8ba` | docs(changelog): the review wave's behaviour is in the S2 entry: per-loop ownership (CR48), the ring restart, the contract's FIC211 refusals |

## Per item

**Important 1.** `src/plant-kernel.js` `restore()` calls `c.setFlowCutoffs()` right after `Object.assign(c, s.fields)`.
- `tests/rt-kernel.test.js` RT31: a checkpoint with `spCutoff` deleted from every loop restores 1.2 / 0.4 / 0.8 / 0.4 on exactly FIC102, FIC211, FIC310, FIC313; FIC211 in AUTO at SP 0 with OP 30 goes to OP 0 in one scan; the caller's checkpoint is untouched; control clause: a live plant with the field deleted holds its 30. Red before the fix (undefined x4), green after.
- `tests/g2-lifecycle.test.js` (archived v1 exact restore): strips `spCutoff` from the restored `L` before the exact comparisons, comment names CR40, and asserts the strip hides nothing (the restore added the field to exactly those four loops, the archived checkpoint carries it on none). Red after the fix without the strip, green with it.
- Note: the current exact-restore assertion did not strip `obs`/`pvObs` (only its comment mentions them, from the retired lockstep); I added the strip for `spCutoff` and referenced the CR27 note.

**CR48.** `src/models.js` `sequence()`: `running = phase !== 'IDLE' && !held`; FIC211 `PROGRAM` iff running; TIC212 `PROGRAM` iff running and `phaseSetpoints(b,P).TIC212 !== null` (HEATUP to DRAIN). CHARGE and IDLE read OPERATOR. `phaseSetpoints` comment says the attributes follow the table.
- `tests/models.test.js` ownership test rewritten: TIC212 OPERATOR through every CHARGE scan, PROGRAM on the scan that enters HEATUP, PROGRAM exactly where the table is non-null, a CHARGE hold then RESUME leaves TIC212 OPERATOR and FIC211 PROGRAM. Red first, green after.
- `tests/app-credibility-s2.test.js` D6 test: FIC211 refused in CHARGE; TIC212 OPERATOR, SP 60 accepted, journaled and stands; RESUME re-asserts FIC211's SP but not TIC212's; after HEATUP TIC212 is PROGRAM at SP 80 and an SP store is refused with the PROGRAM message and no `SP CHANGE`. Green.
- New CR48 test (`CR48: an operator's AUTO and SP on TIC212 during a CHARGE hold are not locked in by RESUME ...`), run for "left in AUTO at 65" and "left in MAN": the loop reads OPERATOR after RESUME, the value stands, further stores are accepted with no refusal, and at HEATUP the sequence takes it, AUTO at 80, PROGRAM, refusing from then on. Green.
- Other tests that encoded TIC212 PROGRAM in CHARGE, updated: CR41's CHARGE block (now OPERATOR), `tests/app-models.test.js` "PROGRAM mode attribute..." (now runs to HEATUP) and "PROGRAM write-rejection callouts..." (now FIC211, which is PROGRAM in CHARGE).
- Page text that said both loops are PROGRAM while the sequence runs, now per loop: the U2 caption, and the "Batch sequence control" and "Write rejected — MODEATTR PROGRAM" help answers. No test pins them.

**Minor 1.** Page `diagnose()` `shed.tad`: RESUME clause and step 3 follow `P.b.held`. Held: unchanged text. Not held: "...until the Urgent alarm clears; the sequence is not held" (plus "(the R-202 trip has it running in COOL)" when `P.trips.batch`), and step 3 "No RESUME is needed: the shed releases on its own when the Urgent alarm clears, and the SCM returns FIC211 to AUTO itself." (no GO). `TI216.PVHH` help: action names HELD and running ("the shed holds it itself in FEED"; "COOL under the R-202 trip, for one"), and the consequence says "in FEED, HOLDS the sequence" (the latch holds only in FEED). Test `the TI216 shed card and help are true held and not held ...`: held card unchanged; the CR43 overlap built from the existing state (trip, shed, held false, COOL, button HOLD) reads the new card; the overlap is run to the release and FIC211 returns to AUTO with no RESUME; a REACT shed (no trip) reads the card without the COOL clause; help pinned. Red against the old page, green now.

**Minor 2.** `TIC212.PVHH`, `PI214.PVHH`, `M202.TRIP` start "HOLD the sequence first/at once to cut the monomer feed (FIC211 belongs to the sequence while it runs and to you while it is held)...". The CR42 test pins all three (regexes). Red against the old help (checked), green now.

**Minor 3.** `risk.tad` step 1 GO is `gSeq`. Test (renamed) sets unit U1 / display alarms, runs the GO: unit U2, display graphic, `sel` not FIC211; same destination as the M-202 card's HOLD step. Red against the old page, green now.

**Minor 5.** Page `archDebriefFrom()` ignores a `_lastADrill.startedAt` later than `P.t`. Test `CR45: after a slot restore to before an architecture drill ...`: `saveSlot` before the drill, run the drill, end it, `restoreSlot`: `archDebriefFrom()` is null, `t0` is the session's, the session's events and the operator's MODE row are in the debrief; control: a slot taken after the drill keeps the window. Red first (returned the future start), green after.

**Minor 7.** `tests/rt-kernel.test.js` RT32: an agent `loop.set` on FIC211 (SP 5) in CHARGE is `rejected / program_owned` and nothing lands; after a governed HOLD (and one scan) it validates and applies (`applied / committed`, SP 5). Passes (regression pin; the contract already read the attribute). Changelog sentence added to the agent-seam paragraph (and a TIC212 clause: refused from HEATUP, writable in CHARGE).

**Minor 8.** `D5: the instructor IC menu loads at the sim clock ...`: `c.instr.auth = true`, `renderVals().instr.presets`, each of the five callbacks leaves `P.t` unchanged and logs one load record, on the zero clock. Red when the callback is temporarily changed to drop `{baseTime}` (checked, page restored byte-identical), green now.

**Minor 9.** `FIC211.PVLO` consequence: "the level that ends FEED stops rising, so the sequence waits in FEED (it does not move to REACT under-charged) while the batch clock keeps counting and conversion stalls". Test `FIC211 PVLO: the help says ... and the model does exactly that`: help regex, plus MV-211 stuck shut on U2_FEED for 20 minutes: still FEED, level under 75, FIC211.PVLO alarm active. Green.

**Minor 10.** TI216 PVHI's action pinned (exact string) in the CR42 test; changelog "What did not change" says the backtrack ring restarts at a load (CR47, above).

## Goldens

None moved under CR48. `tests/golden-drills`, `golden-upsets`, `drill-arch-fixtures`, `golden-u4`, `v2-baseline-archive`: 51 tests green, run twice with no `UPDATE_GOLDENS`; `git diff 54ec1f0 HEAD -- tests/fixtures` is empty. Drill D11 and upset-agit-batch end held in FEED and A5 ends in REACT, where TIC212 reads exactly as before, so no end state carries TIC212's attribute in CHARGE. No fixture outside the three S2 movers went red. No guard-list edit was needed, so "CR48" is appended to no reason. Live digests (sha256 of the fixture files, unchanged): drill-D11 `18acfe2b5dbebc63`, upset-agit-batch `a72dbc3c4ca0b28b`, arch/A5 `b380890d1ffceb14`.

## Gates (on HEAD `573b8ba`)

- `node --test tests/*.test.js`: `# tests 1294`, `# pass 1293`, `# fail 0`, `# skipped 1` (the diff-wide rules 1 and 6 test, as before). 1287 before, plus 7 new tests (RT31, RT32, CR48 hold test, shed card test, FIC211 PVLO test, slot restore test, IC menu test).
- `python3 tools/build-dist.py` twice: `git status` unchanged after each (dist and `src/model-id.js` stable). dist sha256 `bf5951fe1ed65f4e...`, model-id.js `02e9fcd54054f20a...`, `ESS.MODEL_ID` `79cc4cc2...`.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.

## Files changed (`54ec1f0..HEAD`)

Code: `src/plant-kernel.js`, `src/models.js`, `src/alarm-help.js`, `Experion Station Simulator.dc.html`, `dist/experion-station-sim-standalone.html`, `src/model-id.js`.
Tests: `tests/rt-kernel.test.js`, `tests/g2-lifecycle.test.js`, `tests/models.test.js`, `tests/app-models.test.js`, `tests/app-credibility-s2.test.js`.
Docs: `CHANGELOG.md` (D6 bullet in place for CR48; CR42 list; CR43 shed sentence; "What did not change" ring restart; "Did not move" clause; agent-seam sentence; "Known, and left" keeps the deferral and records the fix beside it, in line with the corrections-beside-history rule). `NIGHT PREVIEW.dc.html` stayed untracked and unstaged.

## Concerns

1. The brief expects "AUTO at 80 with the CR41 event if it was in MAN" at HEATUP. Measured: AUTO at 80 yes, but no `MODE RESTORED BY SEQUENCE` record, because the CHARGE to HEATUP transition in `sequence()` writes `mode = 'AUTO'` and the setpoint itself (pre-existing, unchanged); `PHASE → HEATUP` is its record. The CR48 test pins that (`!/MODE RESTORED BY SEQUENCE/`). If a restore record is wanted there, that is a separate change.
2. Stale after this wave, yours: spec §4.2 (and its S2 §11 note) still says both loops are PROGRAM in every active phase; CODE-MAP's S2 `sequence()` bullet ("`modeAttr` is `PROGRAM` on FIC211 and TIC212 when the phase is not IDLE and not held") and its scmRestoreModes line; the OWNERSHIP legend in `tests/v2-baseline-archive.test.js` (names leaves CR48 does not touch, but says "FIC211 and TIC212 read PROGRAM in every active phase"); the changelog Gates line (stage-close record, 1287 tests, `5751648e...`; I left it as the record) and CLAUDE.md's count (now 1294).
3. Beyond the item list, consequences of CR48 that I made so nothing contradicts the code: the three page texts and two app-models tests above, and the CHANGELOG corrections. Revert any you would rather write yourself.
4. Minor 5 does not touch the score: after a restore to before the drill, `archDebriefView()` still takes `this._lastADrill` as the score source, so the whole-session debrief carries that drill's score rows. Not in the item; flagging only.
5. TI216 PVHH's consequence text was also changed ("in FEED, HOLDS"); it is in the same entry and was untrue outside FEED.
