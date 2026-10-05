<!-- @artifact dev -->
# Task 2 report: the hold state written once, RESUME re-asserts, and the D3/D6 app tests

Seat: MacBook seat (Sonnet 5.5), delegated implementer (hostname checked: Anthonys-MacBook-Pro.local). BASE 8d5de29. Branch fix/playtest-2026-10.
Arrival: arrive_lineage() bare, read-only; no chronicle writes from this delegated seat (Concerns 1 and 2 are for the controller to record or rule on).
Commit: 672315e `feat(seq): HOLD writes the hold state once and RESUME re-asserts the phase setpoints; the operator owns the loops while held`
(one commit, not pushed; trailers exactly as given; `NIGHT PREVIEW.dc.html` never staged).

Status: DONE_WITH_CONCERNS. Everything in the brief and the three carry-forwards is in. Two of the brief's tests could not
pass as written (a plant behaviour and a test-setup error, both explained under Deviations), and I found two behaviours the
controller should rule on (Concerns 1 and 2). Neither is caused by this task.

## What was implemented

`src/plant-core.js`, `seqCmd`:
- HOLD (toggle to held): writes `L.FIC211.sp = 0` once and records `SEQUENCE HELD — FEED STOPPED` (the brief's block, verbatim,
  with its two comments). The jacket keeps its current setpoint; `sequence()` writes nothing while held.
- RESUME (toggle to running): `ESS.Models.phaseSetpoints(b, this.P)`; writes `L.FIC211.sp`, writes `L.TIC212.sp` only when the
  table owns it (`!= null`), records `SEQUENCE RESUMED`. `dAct('HOLD', ...)` still runs for both.
- The IDLE guard, the security check and the TI216 branch (`b.held && this.tadShed` -> `confirmInterlockHold()`, return) are
  untouched and still run before the toggle, so the RESUME write is never reached under a standing shed. The governed
  `sequence.command` path still maps RESUME to `seqCmd('HOLD')` (tests/rt-kernel.test.js green).
- Carry-forward 3: `seqCmd('ABORT')` writes `FIC211.sp` and `TIC212.sp` from `phaseSetpoints(b, this.P)` after `b.phase = 'COOL'`
  (same values, 0 and 40), kept as the existing one-liner with a one-line comment above it.

`src/models.js`, `batchReactor()` trip branch (carry-forward 3): `L.TIC212.sp = phaseSetpoints(b, P).TIC212` after
`b.phase = 'COOL'` (was the literal 40; same value). Digests did not move (see Gates), so the sub-change stays.

Carry-forward 1, `tests/models.test.js` ownership test: `c.P.b.Cm = 10` before the REACT tick and `c.P.b.T = 60` before the COOL
tick; the original assertions stay, plus one new line asserting the scan ends in the phase under test.

Carry-forward 2: `scmRestoreModes()` needed no code change (it gates on `modeAttr === 'PROGRAM'`, which Task 1 made true in every
active phase). Pinned by the last test in `tests/app-credibility-s2.test.js` (see Tests).

Rebuilt: `python3 tools/build-dist.py` (restamps `src/model-id.js`). A second run changes nothing (diff of `dist/` and
`src/model-id.js` hashed before and after).

## Strings changed (file, before, after)

1. `Experion Station Simulator.dc.html:402`, the U2 graphic caption.
   Before: `START BATCH runs CHARGE → HEATUP → FEED → REACT → COOL → DRAIN. TIC212 (whole batch) and FIC211 (FEED) are program-driven (MODEATTR = PROGRAM). Alarm limits follow the phase. TI216 Urgent sheds the feed and HOLDs.`
   After:  `START BATCH runs CHARGE → HEATUP → FEED → REACT → COOL → DRAIN. TIC212 and FIC211 are program-driven (MODEATTR = PROGRAM) while it runs; HOLD freezes it and hands both to the operator. Alarm limits follow the phase. TI216 Urgent sheds the feed and HOLDs.`
   Fit: measured in Tahoma 10 px (PIL): old 1069 units, new 1244, against 1396 available (viewBox 1420, x = 24). Nothing else sits at y >= 660. Seen rendered in the browser.
2. `Experion Station Simulator.dc.html:2731`, Live Diagnosis `mtrip.M202`, step 1.
   Before: `Cut monomer feed first — HOLD the sequence (FIC211 is program-owned during FEED; its faceplate refuses MAN / OP stores).`
   After:  `Cut monomer feed first — HOLD the sequence (FIC211 is program-owned while the sequence runs, so its faceplate refuses MAN / OP stores; HOLD sets the feed to zero and hands the loop back to you).`
   Still matches `/HOLD the sequence/` and not `/FIC211 to MAN/` (tests/app-models.test.js:330-331, tests/app-credibility-s2.test.js).
3. `Experion Station Simulator.dc.html:2738`, Live Diagnosis `risk.acc`, step 1.
   Before: `HOLD the sequence to stop the FIC211 feed (program-owned during FEED).`
   After:  `HOLD the sequence to stop the FIC211 feed (program-owned while the sequence runs).`
4. `Experion Station Simulator.dc.html:2815`, help answer "Batch sequence control".
   Before: `... START begins a batch; HOLD stops the monomer feed without losing the phase; ABORT forces COOL. During FEED the FIC211 SP is program-driven (MODEATTR = PROGRAM).`
   After:  `... START begins a batch; HOLD freezes it where it stands (the phase timer stops, no phase change fires and the monomer feed setpoint goes to zero) and hands FIC211 and TIC212 to the operator; RESUME re-asserts the phase setpoints and carries on from the same point; ABORT forces COOL. While the sequence runs, FIC211 and TIC212 are program-driven (MODEATTR = PROGRAM).`
   (The leading `SCM202 on Unit 02 runs CHARGE → HEATUP → FEED → REACT → COOL → DRAIN.` is unchanged.)
5. `Experion Station Simulator.dc.html:2819`, help answer "Write rejected — MODEATTR PROGRAM".
   Before: `... TIC212 is PROGRAM for the whole batch, FIC211 during FEED. HOLD the sequence to take the monomer feed back (the attribute returns to OPERATOR), or wait for the sequence to end.`
   After:  `... TIC212 and FIC211 are both PROGRAM in every phase while the sequence runs. HOLD the sequence to take them back (the attribute returns to OPERATOR on the next scan, and a setpoint you enter stands until RESUME re-asserts the phase value), or wait for the sequence to end.`
6. `Experion Station Simulator.dc.html:2662`, a code comment (not displayed) on the SCM mode restore.
   Before: `// The SCM restores the mode of a loop it takes ownership of: when FIC211 becomes PROGRAM (FEED entered or resumed)`
   After:  `// The SCM restores the mode of a loop it takes ownership of: when FIC211 becomes PROGRAM (a phase entered or the sequence resumed)`
7. `src/alarm-help.js`, `TI216.PVHI` corrective action.
   Before: `Reduce the FIC211 setpoint or HOLD the sequence, confirm M-202 is running, and watch the monomer inventory bar fall before resuming.`
   After:  `HOLD the sequence to stop the monomer feed (the sequence owns the FIC211 setpoint while it runs), confirm M-202 is running, and watch the monomer inventory bar fall before you RESUME.`
   (Reason: "Reduce the FIC211 setpoint" offered a store the PROGRAM attribute refuses in every active phase while running.)

Read and deliberately left unchanged (already true under the new rule, or already say HOLD): `shed.tad` card (RESUME ... the SCM
returns FIC211 to AUTO itself), `risk.tad` card, `TI216.PVHH` (both fields), `M202.TRIP` (names no mechanism), `FIC211.PVLO`,
`LI215.PVLO`. The page's Point Detail MODEATTR note and the HELD · <phase> banner and `holdT` already agree (pinned by the
"tellers agree" test). No page logic changed.

## Tests and results

`tests/app-credibility-s2.test.js` (new, `// @artifact dev` on line 1), seven tests:
1. D3 CHARGE: banner `HELD · CHARGE`, button RESUME, FIC211.sp 0 beside the HELD record, phase/level/timer unchanged over 120 s,
   no PHASE event, graphic timer still, RESUME records `SEQUENCE RESUMED`, `holdT` back to HOLD, charge then completes to HEATUP;
   plus (mine) TIC212.sp untouched by RESUME in CHARGE.
2. D3 FEED: sp 0 at the command, observed flow 0, true flow under the cutoff, level gain bounded; RESUME re-asserts 20 and 80
   over an engineer-trimmed 78.
3. D6: PROGRAM refusal text, exactly one journaled event (the refusal), OPERATOR on the next scan after HOLD, an SP of 5 stored
   and held for 30 s, RESUME re-asserts 0, PROGRAM on the next scan.
4. 4.3: the trip during a hold forces COOL, both loops read `INTERLOCK · R-202 HI TEMP TRIP`, feed setpoint 0.
5. Other writers: ABORT during a hold (cool, held cleared, 0 and 40, PROGRAM next scan); the TI216 shed during FEED (real chain).
6. Tellers: banner, button and attribute running / held / shed-held, Point Detail MODEATTR row and note, M202 card says HOLD.
7. Carry-forward 2 pin: in CHARGE the operator `setMode('FIC211','MAN')` is refused (`WRITE REJECTED — MODE ATTRIBUTE PROGRAM —
   MODE OWNED BY SEQUENCE`, one event); with `c.L.FIC211.mode = 'MAN'` forced, one step returns it to AUTO and journals
   `FIC211 MODE RESTORED BY SEQUENCE (MAN → AUTO)`. This test passes at the base commit by design (it pins Task 1's
   consequence); it is not a RED test. Mutation check M1 below proves it bites.

Mutation checks (each applied to `src/plant-core.js`, run, restored from a /tmp backup, restoration verified with `cmp`):
(M3, removing the HOLD write of FIC211.sp, is the RED run below, not repeated.)
- M1 `scmRestoreModes` only in FEED -> test 7 fails.
- M2 RESUME writes TIC212 unconditionally (null in CHARGE) -> test 1 fails.
- M4 RESUME does not write TIC212 -> test 2 fails.
- M5 no TI216 guard before the toggle -> test 5 fails.
- M6 RESUME does not write FIC211 -> tests 2 and 3 fail.

Full suite, `node --test tests/*.test.js`: `# tests 1248 / # pass 1244 / # fail 3 / # skipped 1` (base 1241 / 1237 / 3 / 1; +7 new).
The red set is exactly the three named movers, none re-captured, no fixture touched:
```
not ok 557 - A5 Controller loss: weighted diagnose-phase fixture is 65 before SAFE_RESTRAINT/debrief completion
not ok 649 - golden: drill D11 unattended run is deterministic and matches the committed fixture
not ok 670 - golden upset: agit-batch (setUpset instructor path, +300s post-inject)
```
All three are digest mismatches against committed fixtures (no errors, no crashes). Their actual digests are identical at the base
commit and at 672315e (A5 831f3315...14fd, D11 ae8d79aa...03f6, agit-batch 45b0eb8f...5fc1; compared by running the three golden
test files in a `git archive HEAD` copy), so this task moved no digest and Task 6's re-capture is unaffected by it.
Mid-task, before the build, `model-id` (and the idempotence test, as a SKIP) went red because `src/` had changed; the build
restamped it and it is green in the final run.

`python3 tools/build-dist.py`: wrote `dist/experion-station-sim-standalone.html` (808030 bytes, 31 manifest entries); idempotent.
`tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.

Browser check (folder build served from a throwaway localhost port, stopped afterwards; the page loads with only the usual
raw-template attribute noise at load): U2 tab, START BATCH, HOLD within about a second. Banner `HELD · CHARGE`, button `RESUME`,
timer `00:00` for over a minute, LI215 12.2 to 12.3 (display noise; the unit tests pin `b.lvl` exactly). RESUME: banner `CHARGE`,
button `HOLD`, timer and level move again. The new caption renders. JV-213 went 12 % to 8 % while held: that is the TIC213
cascade settling to the unchanged TIC212 MAN output (checked in the model: TIC212 MAN op 8.00 constant, JV213 settles 0.45 to 0 over
300 s, nothing opens toward the 44 % of the playtest repro); the sequence writes nothing.

## TDD evidence

RED, `node --test tests/app-credibility-s2.test.js` with the brief's tests (plus the pin) and no `src/` change: `# tests 7 / # pass 4 / # fail 3`.
```
ok 1 - D3: HOLD during CHARGE ...
not ok 2 - D3: HOLD in FEED stops the monomer feed ...   :52  20 !== 0   (assert.equal(c.L.FIC211.sp, 0) right after seqCmd('HOLD'))
not ok 3 - D6: the sequence owns FIC211 and TIC212 in CHARGE ...   :86  'RESUME in CHARGE re-asserts the phase feed setpoint'  5 !== 0
ok 4 - §4.3 ...
not ok 5 - other writers: ...   :124  'RESUME is not offered while the interlock holds the sequence'  'RESUME' !== 'HOLD'
ok 6 - tellers agree ...
ok 7 - scmRestoreModes ...
```
Differences from the brief's Step 2 prediction: the FEED test fails at the first assertion after the HOLD command (Task 1 left HOLD
in FEED at sp 20, as its commit message says), not at the TIC212 re-assert; the D3 CHARGE test passes before the change (CHARGE's feed
setpoint is 0 and the HELD/RESUMED records already existed), so its new TIC212 line is the only RESUME assertion in it; the D6
failure is as predicted; the "other writers" failure is the setup error described under Deviations, not an implementation gap.

GREEN, after the implementation and the two test adaptations, on the committed tree:
- the brief's Step 4 command, `node --test tests/app-credibility-s2.test.js tests/app-models.test.js tests/rt-kernel.test.js`:
  `# tests 41 / # pass 41 / # fail 0` (the TI216 tests of tests/app-models.test.js and the governed RESUME of
  tests/rt-kernel.test.js:61 pass unchanged);
- `node --test tests/app-credibility-s2.test.js tests/models.test.js`: `# tests 30 / # pass 30 / # fail 0`.

## Files changed (the commit)
- src/plant-core.js (seqCmd HOLD/RESUME and ABORT)
- src/models.js (trip branch reads the table)
- src/alarm-help.js (TI216.PVHI action)
- Experion Station Simulator.dc.html (captions, two cards, two help answers, one comment)
- tests/app-credibility-s2.test.js (new)
- tests/models.test.js (carry-forward 1)
- src/model-id.js (restamp), dist/experion-station-sim-standalone.html (rebuild)

## Self-review

Completeness: HOLD writes FIC211.sp = 0 once (mutation M6 and test 2/3 pin the RESUME side; the HOLD write is the RED of test 2);
RESUME re-asserts both loops (2 for FEED, 3 for CHARGE where TIC212 is not owned and not written); every brief test is present;
the three carry-forwards are done; the string sweep is listed above. Discipline: nothing beyond the brief and the carry-forwards
except the items under Deviations. Testing: exact values throughout except the one bound in test 2 (below). The output is pristine
apart from the three named red tests. The shed path, `latchTadShed`, `enforceTadShed`, `releaseTadShed` and `applyPreset` are untouched.

## Deviations from the brief

1. FEED test (brief test 2). `run(c, 30)` then `pvShown(FIC211) === 0`, and `assert.equal(c.P.b.lvl, lvl)` over the next 60 s, cannot
   hold in this plant. The loop is PI (K 0.4, Ti 9 s) on the observed flow, and a flow reads 0 below 1 % of span (0.4 M3/H of 0..40).
   The flow decays along the PI tail (observed 5.1 M3/H at 30 s, 0.83 at 80 s), reads 0 from about 98 s (flickering until 181 s),
   and then the loop sees no error: the output freezes at 0.803 %, MV-211 stays 0.803 % open and a true 0.3212 M3/H keeps flowing
   forever. The test now runs 240 s, asserts the observed flow is 0 and the true flow is under 0.4, and asserts the level gains less
   than 0.5 % in the next minute (measured 0.2312, against 14.25 % a minute while feeding). The RESUME assertions (20 and 80) are
   as briefed. See Concern 1: this is a finding, not a pass.
2. "Other writers" test (brief test 5). It latched the shed with `d.latchTadShed()` and then stepped; the first `interlocks()` call
   finds no TI216 PVHH alarm and releases the shed (`TI216 ... SHED RELEASED, RESUME PERMITTED`), so `holdT` reads RESUME and the SP
   store succeeds. This fails at any commit. The shed is now latched through the real chain (U2_FEED preset, `injectFault('agit')`,
   run until `tadShed`, 45 scans, about 22 s of simulated time). Assertions are the brief's. I added three, on the new HOLD branch:
   with the shed standing, `seqCmd('HOLD')` leaves `held` true, records no `SEQUENCE RESUMED`, and leaves FIC211.sp at 0 (mutation M5).
3. Test 1 (D3 CHARGE): one added assertion (TIC212.sp unchanged by RESUME in CHARGE), to pin the brief's "(when owned)".
4. `tests/models.test.js`: one added assertion that each scan ends in the phase under test (carry-forward 1's stated purpose).
5. A one-line comment above the ABORT line, and the stale comment at page line 2662 (string 6), which the brief did not list.

## Concerns

1. HOLD in FEED does not fully stop the feed (needs a ruling). After the PI tail the observed flow reads 0 while 0.3212 M3/H keeps
   flowing; the level creeps up 0.23 % a minute (14.25 while feeding), under a display that reads 0. Cause: S1's measurement policy
   feeds the controller the observed value (`Pid.pvOf` returns `pvObs`, 0 below the 0.4 cutoff), so SP 0 against an observed 0 is a
   zero error. It exists at the S1 head already (the old hold also only set sp 0), and spec 4.1's `FIC211.sp = 0` cannot remove it.
   Options: accept it (it is under the cutoff and visually flat), have HOLD also close the feed (FIC211 MAN OP 0, or a held-state
   MV211 target of 0 in `valveTarget`, which RESUME and `scmRestoreModes` would then undo), or give the loop a zero-flow shutoff.
   Each is a design change beyond Task 2.
2. A loop left in MAN during a hold is stranded under PROGRAM after RESUME for TIC212. Measured: HOLD, operator `setMode('TIC212',
   'MAN')`, RESUME: TIC212 mode MAN, MODEATTR PROGRAM, sp re-asserted to 80, and an operator `setMode('TIC212','AUTO')` is refused
   (`MODE ATTRIBUTE PROGRAM — MODE OWNED BY SEQUENCE`). The jacket loop then stays in MAN at its last output until the batch ends,
   or until another HOLD. `scmRestoreModes()` restores FIC211 only (FIC211 does come back to AUTO with its journal event). Before
   Task 1, TIC212 was PROGRAM for the whole batch and could never be put in MAN, so this path is new with the ownership rule.
   Suggested: restore TIC212 to AUTO at RESUME (or in `scmRestoreModes`) in the phases where `phaseSetpoints(...).TIC212 != null`.
   Not done: the brief says RESUME re-asserts setpoints.
3. Three alarm-help actions still tell the operator to write FIC211 while the sequence runs, which the attribute refuses:
   `FIC211.PVHI` ("Reduce the FIC211 setpoint or place it in MAN at a lower output"), `TIC212.PVHI` ("Cut monomer feed with
   FIC211"), `LI215.PVHI` ("Stop the monomer feed with FIC211 and HOLD the sequence"). Already refused in FEED before this stage,
   wider under the new rule. Outside the brief's "TI216 and M202" scope, so unchanged.
4. Side effects handled: the browser tool wrote `.playwright-mcp/` into the repo (removed; nothing of it staged); a throwaway
   localhost server on a free port was stopped. An unrelated pre-existing listener on port 8765 was left alone.

---

# Fix round 1 (CR40, CR41, CR42): NEEDS_CONTEXT, nothing committed

Seat: MacBook seat (Sonnet 5.5). Status: NEEDS_CONTEXT. The coordinator's golden rule fired: two fixtures beyond the three known movers
went red (drill D4, upset cool). I stopped, re-captured nothing, and did not commit. HEAD is still 672315e.

State of the tree: the round's work is complete but UNCOMMITTED in the working tree: `src/pid.js`, `src/plant-core.js`,
`src/alarm-help.js`, `tests/pid.test.js`, `tests/app-credibility-s2.test.js`. `dist/` and `src/model-id.js` are NOT rebuilt (still the
672315e build), so the model-id stamp test is red until a build. `docs/dev/CREDIBILITY-PASS-PLAN-S2.md` also shows modified in the working
tree: not mine, untouched, never to be staged by me. `NIGHT PREVIEW.dc.html` untracked as before.

## The golden check (the reason for the stop)

Command (`UPDATE_GOLDENS` confirmed unset):
`node --test tests/golden-upsets.test.js tests/golden-drills.test.js tests/golden-u4.test.js tests/drill-arch-fixtures.test.js`
Result: `# tests 47 / # pass 42 / # fail 5`.
```
not ok  A5 Controller loss: weighted diagnose-phase fixture is 65 before SAFE_RESTRAINT/debrief completion   (known mover)
        "A5: physics endState digest moved from the committed fixture"
        expected 5f55ec991333ea850e4af69edcf376742a0a16b7d92afb5e96f1176f9f5d4ee3
        actual   1f9128d8fc24247655f1b6101251e28d52243579e4bc8bb84ad596d6aa485aba   (was 831f3315...14fd before this round)
not ok  golden: drill D11 unattended run is deterministic and matches the committed fixture                  (known mover)
        "D11: end-state digest moved from the committed golden"
        expected af8884fed50810e607dc13b46129fa402dbe24c7d3e1ba5ff444377d5ef16676
        actual   ae8d79aa94c3acea9232f175c56006a6d250eadac3ea62ac86a79e962ba503f6   (identical to before this round)
not ok  golden upset: agit-batch (setUpset instructor path, +300s post-inject)                               (known mover)
        expected 09d56e6f57c7573702c47dadefcd86cd251268859ea75eabfcd71d7117cd0883
        actual   45b0eb8f775aa7498c5ec254e27b21a46ee0891b36074f688e89c0fb19595fc1   (identical to before this round)
not ok  golden: drill D4 unattended run is deterministic and matches the committed fixture                   (NEW)
        "D4: end-state digest moved from the committed golden"
        expected fca6796d60e5ffb37b88f5f89cba53b7d1771f7cbcbe8ee9d2195a489372d061
        actual   ca1d3ca442cd00db2dcb2faaa1584ffda3d7892440593faf937ece1f743974dc
not ok  golden upset: cool (setUpset instructor path, +400s post-inject)                                     (NEW)
        "cool: v2 end-state behaviour changed since capture"
        expected c9caf8a649d2e3c83a4b9886e9769fdc876d356601e5ea160a0483343adaf813
        actual   9d27bd2d26924e43c4c8652d4162f03c0abb7790479fd0afc378d16463fc7213
```
Every Unit 3 and Unit 4 fixture is green (FIC310 and FIC313 do not move), as are drills D1, D2, D3, D6, D9, D12 and the other ten upsets,
including pump (FIC102 after a pump restart does not move).

Cause, traced without editing source (a script wrapped `ESS.Pid.stepPid` and logged every scan on which the shutoff condition is true for a
controlling loop):
- FIC211 is in the shutoff set on every scan of both runs but it is a no-op there: U2 idle, AUTO, SP 0, OP 0, I 0 before and after.
- FIC102 (CAS under LIC101, cutoff 1.2 M3/H) is held shut for 4 scans in cool and 5 in D4, right after the R-201 trip releases. First shut
  scan: cool at sim 460.5 s, FIC102 CAS, SP 0.227, observed PV 0, OP 0, I -0.076; D4 at sim 355.5 s, SP 0.301, observed PV 0, OP 0,
  I -0.100. That is the scan on which FIC102 returns from interlock tracking to CAS; the master's demand is climbing from 0 and passes through
  the 0 to 1.2 M3/H band in 2.0 s (cool) and 2.5 s (D4), during which OP is held at 0 instead of following the PI law. The post-trip
  restart is about two seconds later, and the digest (every loop's SP, OP and mode, every valve, to 6 decimals) moves.

Experiments (each a temporary mutation, golden files only, file restored and verified byte-identical after):

| variant | red among the four golden files |
|---|---|
| E0 the implementation as ruled (FIC102, FIC211, FIC310, FIC313 all carry the cutoff) | A5, D4, D11, cool, agit-batch |
| E1 FIC102 excluded from the cutoff | A5, D11, agit-batch |
| E2 the literal CR40 wording, PV tracking applied in the shutoff branch | A5, D4, D11, cool, agit-batch |
| E3 shutoff only for a loop that is not in CAS (`loop.mode !== 'CAS'`) | A5, D11, agit-batch (and tests/pid.test.js + tests/app-credibility-s2.test.js 43 of 43) |

So the movement comes from FIC102's cascade band only; FIC211, FIC310 and FIC313 add nothing; and my PV-tracking deviation (below) is not
the cause (E2 is identical to E0).

Options needing a ruling:
- A. Accept D4 and cool as two more movers. The stage's movers become A5, D4, D11, cool, agit-batch; spec §11 and Task 6 re-capture all five.
- B'. (my recommendation) the shutoff applies to a loop that is not in CAS. A cascade secondary takes its demand from its master and the
  master owns "no flow"; the defect found is a written setpoint (the batch feed SP 0 under HOLD and in REACT; an operator SP 0 in AUTO).
  One condition in `stepPid`, one header sentence, one more pid test ("a CAS loop under the cutoff is not shut off"); FIC102 in AUTO at SP 0
  is still shut. Measured as E3: exactly the three known movers.
- B. Exclude FIC102 by name in `setFlowCutoffs()` (E1). Same goldens, but it special-cases a tag and leaves FIC102 AUTO SP 0 with the old dribble.
Whichever is chosen, the finishing steps are mechanical: edit, `python3 tools/build-dist.py`, full suite, `tools/smoke.sh`, one commit.

## What changed per ruling (uncommitted)

CR40, `src/pid.js` and `src/plant-core.js`:
- `stepPid`: after the tracking and MAN / bad-PV hold paths, `if (Number.isFinite(loop.spCutoff) && loop.sp <= loop.spCutoff)` sets
  `loop.op` to OPLOLM, runs `trackIntegrator(loop)` and returns. Documented in the module header beside tracking (the optional field and an
  API bullet, including why there is no PV tracking).
- `setFlowCutoffs()` (new, beside `measure()`): for every PID loop with `eu` M3/H, `spCutoff = ESS.Measurement.RANGE_POLICY.flowCutoffFrac * rangeOf(l).span`
  (the constant the transmitter's own `observe()` uses): FIC102 1.2, FIC211 0.4, FIC310 0.8, FIC313 0.4. Called once at the end of `initSim`'s
  loop-record pass, and on `applySnapshot` for a snapshot that predates the field (never overwrites a present value).
- Tests: `tests/pid.test.js` +5 (sp at or below the cutoff drives OP to OPLOLM exactly with the integrator tracked, incl. OPLOLM 2 and a
  setpoint exactly at the cutoff; above the cutoff the loop is the old loop to the last bit over 200 scans, and a loop without the field is
  untouched; the release is bumpless; MAN, interlock tracking and bad PV keep their paths; a pvtrack loop in AUTO at SP 0 keeps SP 0).
  `tests/app-credibility-s2.test.js`: the FEED hold test back to exact values, a REACT test, an init and restore test for `spCutoff`.

CR41, `src/plant-core.js` `scmRestoreModes()`: FIC211 to AUTO in every active phase (unchanged, skipped under the TI216 shed and a bad PV) and
TIC212 to AUTO wherever `ESS.Models.phaseSetpoints(b, P).TIC212 != null` (skipped on a bad PV), each with its own
`<tag> MODE RESTORED BY SEQUENCE (<from> → AUTO)` SYSTEM event from SCM202. Test: TIC212 in MAN during a FEED hold, RESUME, one scan:
AUTO at 80 with `TIC212 MODE RESTORED BY SEQUENCE (MAN → AUTO)` and no FIC211 record; both loops taken, both restored with their own record;
in CHARGE TIC212 stays MAN with no record over 20 s; a bad PV on either loop is skipped.

CR42, `src/alarm-help.js` PVHI corrective actions (all three now start `HOLD the sequence first`):
- FIC211: `HOLD the sequence first: FIC211 belongs to the sequence while it runs and to you while it is held. Then reduce the FIC211 setpoint or place it in MAN at a lower output; check the monomer inventory bar.` (pinned exactly, through `AlarmHelp.resolve('FIC211','PVHI',{})`, the way the S1 tests read alarm help)
- TIC212: `HOLD the sequence first to cut the monomer feed (FIC211 and TIC212 belong to the sequence while it runs and to you while it is held), confirm M-202 running, and reduce the TIC213 cascade setpoint.`
- LI215: `HOLD the sequence first to stop the monomer feed (FIC211 belongs to the sequence while it runs and to you while it is held).`
  (the TIC212 and LI215 ones are pinned by `/^HOLD the sequence first/`.)

## Measured scan counts (U2_FEED preset, seed 4, 0.5 s scans)

HOLD in FEED: the output is exactly 0 from scan 1. The observed flow reads 0 from scan 33 (16.5 s: the valve lag plus the flow lag, 3 s each)
and every scan after; the true flow is under 0.4 M3/H on scan 33 (0.362). The level last moves on scan 41 (true flow 0.12 M3/H there, 0.10
on scan 42, and the model only adds level in FEED while the true flow is above 0.1), then is exactly constant: pinned as
`READS_ZERO_FROM = 33` and `LEVEL_LAST_MOVES = 41`, with 360 scans observed (at least 120 scans, 60 s, of exact constancy after scan 41).
True flow 4.5e-3 at scan 60, 1.5e-7 at 120, 4.5e-26 at 360. Base behaviour, for contrast: OP 27.85 on scan 1, the flow settles at 0.3212 M3/H.
After FEED ends (REACT): FEED completes 150 scans into the preset run; in REACT the output is 0 from the first scan, the observed flow reads
0 from scan 32, and REACT lasts 289 scans from there (so the 240-scan window stays inside it). Base: reads 0 from scan 286.

## Covering tests, commands and output

- `node --test tests/pid.test.js` before the change: `# tests 32 / # pass 29 / # fail 3`, the three shutoff tests red (`0.803 !== 0`;
  `actual 5.6833` on the release; `actual 28.8889` on the pvtrack loop); the two "as before" tests pass by design. After: `# pass 32`.
  (One bound in my own release test was wrong arithmetic, 0.5111 against `< 0.5`; replaced by the explicit identity kick + one step.)
- `node --test tests/app-credibility-s2.test.js` after writing the tests and before the change: `# tests 10 / # pass 6 / # fail 4`:
  FEED hold (`FIC211.op` 27.8496 !== 0), REACT (`286 !== 0`, the provisional pin), CR41 (`'MAN' !== 'AUTO'`), CR42 (old text). After the
  implementation and the pins: `# tests 11 / # pass 11`.
- Mutations (each restored and verified with `cmp`): PV tracking added to the shutoff branch -> pid test "does not apply PV tracking" fails
  with `60 !== 0` (the demanded SP 0 overwritten with the running flow); `spCutoff` never set -> the FEED and REACT tests fail at
  `FIC211.op` (27.8496 and 27.9925).
- `node --test tests/pid.test.js tests/app-credibility-s2.test.js`: `# tests 43 / # pass 43 / # fail 0`.
- `node --test tests/*.test.js` on the working tree without a rebuild: `# tests 1256 / # pass 1248 / # fail 6 / # skipped 2`. Red: A5, D4, D11,
  cool, agit-batch, and the model-id stamp (stale, resolved by the build). Nothing else is red, so CR41 and CR42 and the alarm-help text broke
  no other test.
- Not run this round, because the rule says stop: `python3 tools/build-dist.py`, `tools/smoke.sh`, the commit.

## Deviations from the ruling

1. No PV tracking in the shutoff branch (the ruling says to apply it as the hold path does). The shutoff is for a controlling loop, and
   applied there PV tracking overwrites the demanded SP with the PV: a pvtrack loop (FIC102, the only M3/H one) in AUTO at SP 0 with the flow
   still running gets SP := 60 on the first scan and re-opens on the next (mutation above, `60 !== 0`); on the hold paths it is right because
   the loop is not controlling. In CAS the SP is re-derived each scan, so the only effect would be the integrator seed. It is not the cause of
   the extra goldens (E2). Pinned by the pvtrack pid test.
2. `typeof loop.oplolm === 'number' ? loop.oplolm : 0` instead of a bare `clampOp(loop, loop.oplolm)`: with no OPLOLM the bare form is NaN.
3. `setFlowCutoffs()` also runs on snapshot restore, as a default for an imported 3.0 snapshot (the ruling says "once at init"); a present
   value is never overwritten and a test pins both. Easy to drop.
4. REACT test: by the model the level only moves in CHARGE, FEED and DRAIN, so "the level does not creep" in REACT holds with or without the
   dribble; the assertions that discriminate are the true flow (`mf < 1e-6`, 0.32 at base) and the observed reading from scan 32 (286 at base).
   The level assertion stays as the brief's.
5. The FEED test pins the level constancy from scan 41, not from scan 33 when the flow first reads 0: between them the true flow is still
   0.36 to 0.12 M3/H and the model still adds level.

## Questions for the coordinator

1. A, B' or B above (my recommendation is B'). I have not applied any of them.
2. If B' or B: spec §11's mover list stays at three; if A: two rows are added.

---

# Fix round 1, resolution: CR40b applied and committed

Seat: MacBook seat (Sonnet 5.5). Status: DONE. The NEEDS_CONTEXT above is answered by ruling CR40b (my option B', "shutoff only when the loop
owns its setpoint"); the earlier section stays as the record of the stop. Commit: 910ec7f
`fix(pid): a flow setpoint at or below the cutoff closes the valve for a loop that owns its setpoint; the sequence restores both loops it owns; alarm help says HOLD first (CR40, CR40b, CR41, CR42)`
on top of 672315e, trailers exactly as given, not pushed. Staged by name: `src/pid.js`, `src/plant-core.js`, `src/alarm-help.js`,
`tests/pid.test.js`, `tests/app-credibility-s2.test.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`.
`docs/dev/CREDIBILITY-PASS-PLAN-S2.md` (the controller's working edit) is still modified and unstaged; `NIGHT PREVIEW.dc.html` untracked.

## CR40b: what changed

- `src/pid.js` `stepPid`: the shutoff condition is now `loop.mode === 'AUTO' && Number.isFinite(loop.spCutoff) && loop.sp <= loop.spCutoff`. It
  sits after the tracking and MAN / bad-PV hold paths, so it runs only for a loop in AUTO that is not held by tracking. A CAS secondary
  is exempt. The `stepPid` comment and the module header now say: a CAS secondary's setpoint is the master's demand passing through the
  band on a cascade return, not an instruction to stop, and the master's output limit and the plant's interlock and device holds close the
  valve where that is meant; and, inside the shutoff, the setpoint is the stop instruction and must not be overwritten by the running flow,
  so there is no PV tracking (a pvtrack loop in AUTO at SP 0 would take SP := PV and re-open on the next scan).
- `src/plant-core.js`: the `setFlowCutoffs()` comment says the loop is closed when it is in AUTO and a CAS secondary is exempt. Behaviour
  unchanged: the plant still sets the field once at init on every M3/H PID loop, FIC102 included (the exemption is in `stepPid`).
- `tests/pid.test.js`, one new test, `CR40b: a CAS loop under the cutoff keeps following its master with no shutoff; the same loop in AUTO is
  shut`: FIC102 as the plant has it (pvtrack, cutoff 1.2) with the master demanding 0.5 M3/H. In CAS, over 10 scans, SP equals the master's
  demand and OP rises every scan (controlling). The same loop in AUTO at SP 0.5: OP is 0 and SP stays 0.5 on every scan. The test that pins
  the PV-tracking point (a pvtrack loop in AUTO at SP 0 keeps SP 0 and stays closed while the flow dies away, so `60 !== 0` cannot happen) is
  kept unchanged.
  RED by mutation (the AUTO condition removed, i.e. CR40 as first ruled): `not ok 33 ... 'controlling, not shut: 0 after 0, scan 0'`,
  `# pass 32 / # fail 1`; restored byte-identical (`cmp`); GREEN `# tests 33 / # pass 33`.
- One added assertion in the FEED hold test, because CR40 changes the release path: after RESUME and 60 s the observed feed is above 15 M3/H
  (measured: OP 21.11 % on the first scan, the proportional kick 20 % plus one integration step 1.11 %; feed 4.8 M3/H at scan 10, 12.5 at 40,
  18.2 at 120; the batch reaches REACT by scan 240 and the loop closes the feed again, OP 0).

## Golden check, rerun after CR40b

`node --test tests/golden-upsets.test.js tests/golden-drills.test.js tests/golden-u4.test.js tests/drill-arch-fixtures.test.js`
(`UPDATE_GOLDENS` confirmed unset): `# tests 47 / # pass 44 / # fail 3`. Red set exactly the three named movers:
```
not ok 5  - A5 Controller loss: ...     "A5: physics endState digest moved from the committed fixture"
            expected 5f55ec991333ea850e4af69edcf376742a0a16b7d92afb5e96f1176f9f5d4ee3
            actual   1f9128d8fc24247655f1b6101251e28d52243579e4bc8bb84ad596d6aa485aba   (was 831f3315...14fd after Task 1)
not ok 26 - golden: drill D11 ...        "D11: end-state digest moved from the committed golden"
            expected af8884fed50810e607dc13b46129fa402dbe24c7d3e1ba5ff444377d5ef16676
            actual   ae8d79aa94c3acea9232f175c56006a6d250eadac3ea62ac86a79e962ba503f6   (unchanged since Task 1)
not ok 47 - golden upset: agit-batch ... "agit-batch: v2 end-state behaviour changed since capture"
            expected 09d56e6f57c7573702c47dadefcd86cd251268859ea75eabfcd71d7117cd0883
            actual   45b0eb8f775aa7498c5ec254e27b21a46ee0891b36074f688e89c0fb19595fc1   (unchanged since Task 1)
```
Drill D4 and upset cool are green again, as are the Unit 3 and Unit 4 fixtures and every other drill and upset. Nothing re-captured.

## Gates (final, on the committed tree)

- `python3 tools/build-dist.py`: `wrote dist/experion-station-sim-standalone.html (809906 bytes, 31 manifest entries)`; a second run leaves
  `dist/` and `src/model-id.js` unchanged (diff hashed before and after). The model-id stamp tests are green.
- `node --test tests/*.test.js`: `# tests 1258 / # pass 1254 / # fail 3 / # skipped 1` (the skip is the diff-wide rules 1 and 6 test).
  Red: A5, drill D11, upset agit-batch, nothing else.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.
- `node --test tests/pid.test.js tests/app-credibility-s2.test.js`: `# tests 44 / # pass 44` (pid 33, S2 11).

## Scan counts (unchanged by CR40b, FIC211 is in AUTO; U2_FEED preset, seed 4, 0.5 s scans)

After HOLD in FEED: output 0 from scan 1; the observed flow reads 0 from scan 33 (16.5 s); the level last moves on scan 41, exactly
constant after (pinned `READS_ZERO_FROM = 33`, `LEVEL_LAST_MOVES = 41`, 360 scans observed). After FEED ends: the observed flow reads 0 from
scan 32 of REACT, REACT lasts 289 scans, true flow under 1e-6 by scan 120.

## Notes

1. The two tests in `tests/app-credibility-s2.test.js` that pin FIC211 (FEED hold, REACT) and the pid tests are unaffected by CR40b: all FIC211
   cases are AUTO. FIC102 in CAS keeps its pre-CR40 PI behaviour through the cascade return; FIC102 in AUTO at an SP of 1.2 M3/H or less is shut
   (the pump-restart card's "FIC102 sits at SP 0 with OP already 0" is the same state it was, OP 0 either way).
2. Deviations carried from the first pass, now ruled or unobjected: no PV tracking in the shutoff (accepted in CR40b); the `typeof
   loop.oplolm === 'number'` guard; `setFlowCutoffs()` also defaulting an absent `spCutoff` on snapshot restore (pinned by the init and restore test).
3. Spec §11's mover list stays at three: A5, D11, agit-batch (A5's digest is the one that differs from the Task 1 measurement).
4. Scratch under /tmp removed; nothing else touched.

---

# Fix round 2 (Opus task review): DONE

Seat: MacBook seat (Sonnet 5.5). Status: DONE. Commit: cd184c2
`fix(seq): no saturation card under the setpoint shutoff; a trip clears the hold; alarm help says HOLD first everywhere it applies (CR42, CR43)`
on top of 0604280, trailers exactly as given, not pushed. Staged by name: `Experion Station Simulator.dc.html`, `src/pid.js`, `src/models.js`,
`src/alarm-help.js`, `src/plant-core.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`, `tests/pid.test.js`,
`tests/app-credibility-s2.test.js`. `NIGHT PREVIEW.dc.html` untracked, as before. The plan file was clean (the controller's docs commit is HEAD).
Taken: Important 1 and 2, Minor 3, 4, 5, 7, 8 (CR43), 9. Not taken, as ruled: Minor 6.

## What changed per item

Important 1, the saturation card. `src/pid.js` exports `shutoff(loop)`: `loop.mode === 'AUTO' && !loop.badPv && !tracking(loop) &&
Number.isFinite(loop.spCutoff) && loop.sp <= loop.spCutoff`. `stepPid` now asks it (`if (shutoff(loop))`, where it still comes after the tracking and
MAN / bad-PV paths, so the first three terms only matter to a caller outside `stepPid`; the predicate carries `!badPv` and `!tracking` so it is exactly
the condition `stepPid` can reach, which the ruling's description left implicit). The page's `diagnose()` condition gains `&&!ESS.Pid.shutoff(l)`
beside `tracking` and `init`, and its comment names the third exemption. Measured at the previous HEAD: FIC313 at an operator SP 0 in AUTO
shows `sat.FIC313` on 80 of 120 scans (first at scan 41, when PVLO announced; the reviewer's 56 of 60 sampled per second); now 0 of 120.
Tests: `tests/pid.test.js` (truth table of ten cases, with `stepPid` forcing OPLOLM exactly where the predicate is true, plus a device hold overridden
in MAN); `tests/app-credibility-s2.test.js` (FIC313 SP 0 in AUTO, 120 scans, no card on any scan, with PVLO and PVLL standing, quality GOOD, OP 0;
the same record with `spCutoff` removed raises `FIC313 output saturated at 0%` and restoring it silences it again, so the shutoff is the one thing that
silences the card; a stuck quench valve, `QV313` at 2 % with SP 10, raises `FIC313 output saturated at 100%` at scan 138 with PVLO and PVLL standing).

Important 2, CR42 scope held (`src/alarm-help.js`):
- `PI214.PVHI` action. Before: `Act on TIC212 first: reduce temperature and cut monomer feed.` After: `HOLD the sequence first (it cuts the monomer feed; TIC212 and FIC211 belong to the sequence while it runs and to you while it is held), then act on TIC212 to reduce temperature.`
- `FIC211.PVLO` action. Before: `Check MV-211 position against output, return FIC211 to AUTO, or HOLD the sequence until the feed is available.` After: `Check MV-211 position against output. The sequence returns FIC211 to AUTO itself once its PV is good. To work the loop, HOLD the sequence first (FIC211 is yours while it is held) and keep it held until the feed is available.` ("once its PV is good" because `scmRestoreModes()` skips a loop with a bad PV, and the cause list for this alarm includes a shed.)
- Pin: `FIC211.PVLO` exactly, `PI214.PVHI` by `/^HOLD the sequence first/`, added to the CR42 test with the three earlier PVHI entries.

Minor 3, the `risk.tad` card, step 1. Before: `Reduce the monomer feed or HOLD the sequence.` After: `HOLD the sequence to stop the monomer feed (the sequence owns the FIC211 setpoint while it runs).` The `go:gFp('FIC211')` closure is kept. Test: agitator trip from the U2_FEED preset, the card appears, step 1 pinned exactly, `go` is a function and opens the FIC211 faceplate (`state.sel === 'FIC211'`).

Minor 4, ABORT from CHARGE (ruled correct, pinned). START, one scan: TIC212 MAN at 8 %. ABORT writes SP 40; after one scan TIC212 is AUTO at 40, PROGRAM, with `TIC212 MODE RESTORED BY SEQUENCE (MAN → AUTO)`, and its output has left the manual 8 % (5.27 on that scan). The batch is cold, so the phase is already DRAIN on that scan and drains to IDLE within seconds, where the sequence resets TIC212 to MAN 8 % by design; the test therefore asserts on the first scan, not later. It passes at the previous HEAD by design (it pins CR41's consequence); mutation (TIC212 never restored) fails it and the CR41 test.

Minor 5, `setFlowCutoffs()` always recomputes `spCutoff`. Checked that nothing writes a point's `hi` or `lo` at runtime (no store, no handler). The init-and-restore test now pins `FIC310.spCutoff` 0.8 after restoring a file that said 5, and the title and comment say so.

Minor 7, comments. The page comment at the SCM mode restore now says FIC211, and TIC212 wherever the phase table gives the sequence the jacket setpoint, one record per loop (CR41). The 208-character `setFlowCutoffs()` comment line in `src/plant-core.js` is wrapped (no line in that block is over 130 characters).

Minor 8, ruling CR43. `src/models.js` trip branch: `b.held = false` beside the forced COOL, with a comment. Test: HOLD in FEED, `T = 112` and one scan: trip on, phase COOL, `held` false, `pt` 0; next scan `pt` 0.5; then run until the TI216 shed releases with the trip still standing: `holdT` reads `HOLD`; after the trip resets: banner `COOL` (not `HELD · COOL`); and COOL completes into DRAIN with nobody pressing RESUME. A fact the test comment records: any trip also latches the TI216 shed in the same scan (Tad is above 106 whenever T is 110), so `holdT` reads HOLD at the trip scan for that reason, and the old behaviour only showed after the shed released: measured at the previous HEAD, shed released 26 scans after the trip, with the banner still `TRIP` and the button `RESUME`, and at the reset (scan 70) the banner `HELD · COOL`, `RESUME`, held. The same in a REACT and a HEATUP hold. The §4.3 test's expectations are unchanged and green.

Minor 9. The test is retitled `other writers: ABORT during a hold cools and clears the hold; the TI216 shed during FEED holds and keeps writing the shed state`.

## RED evidence (before the source edits, on the new tests)

`node --test tests/pid.test.js`: `# tests 34 / # pass 33 / # fail 1`: `Pid.shutoff is not a function`.
`node --test tests/app-credibility-s2.test.js`: `# tests 15 / # pass 10 / # fail 5`, after fixing one assertion of mine in the ABORT test (a cold batch drains to IDLE and IDLE resets TIC212 to MAN 8 %, so I assert on the first scan):
- init and restore: `5 !== 0.8` (the file's value was kept);
- saturation card: `80 !== 0` (card on 80 of 120 scans);
- risk.tad: actual `Reduce the monomer feed or HOLD the sequence.`;
- CR43: `true !== false` on `held`;
- CR42 pin: the old PVLO / PI214 text.
The ABORT test passes by design. After the edits: pid `# pass 34`, S2 `# pass 15`.

## Gates

- Golden files rerun without `UPDATE_GOLDENS` (confirmed unset): `# tests 47 / # pass 44 / # fail 3`. Red exactly A5 (actual `1f9128d8...485aba`), drill D11 (`ae8d79aa...503f6`), upset agit-batch (`45b0eb8f...5fc1`). All three digests are identical to the previous round's, so CR43 and the rest moved nothing. D4, cool, Unit 3, Unit 4 green. Nothing re-captured.
- `python3 tools/build-dist.py`: `wrote dist/experion-station-sim-standalone.html (810786 bytes, 31 manifest entries)`; a second run leaves `dist/` and `src/model-id.js` unchanged.
- `node --test tests/*.test.js`: `# tests 1263 / # pass 1259 / # fail 3 / # skipped 1`. Red: A5, drill D11, upset agit-batch only.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.
- Focused: `node --test tests/pid.test.js tests/app-credibility-s2.test.js tests/models.test.js tests/app-models.test.js tests/rt-kernel.test.js tests/alarm-help-coverage.test.js tests/app-credibility-s1.test.js`: `# tests 184 / # pass 184`.
- Mutation (restored, verified with `cmp`): TIC212 never restored in `scmRestoreModes()` -> the CR41 test and the ABORT test fail.

## Notes and concerns

1. CR43 as ruled clears the hold where the trip forces COOL (from FEED, REACT or HEATUP). A trip while the operator had already held the batch in COOL or DRAIN forces nothing, so the hold stands: measured, hold in COOL, `T = 112`: phase COOL, `held` true, shed released at scan 23, trip reset at scan 68, banner `HELD · COOL`, button `RESUME`. That is the operator's own hold and I left it; if the trip card's "the sequence resumes in COOL when the trip clears" should hold there too, it is a one-line widening of the same branch.
2. The `risk.tad` GO still opens the FIC211 faceplate (kept as ruled); after the HOLD it is a faceplate the operator may use, but the sequence panel (`gSeq`) is where the HOLD is, so that may be the better target.
3. The predicate carries `!badPv` and `!tracking`; inside `stepPid` that is redundant by construction, and the predicate test pins both.
4. Scratch under /tmp removed.
