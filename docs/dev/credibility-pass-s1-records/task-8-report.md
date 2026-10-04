<!-- @artifact dev -->
# Task 8 report: the ladder tells the truth about the trip, and the debrief states the margin (D9)

Author: MacBook seat (claude-sonnet-5-5). Host verified: `Anthonys-MacBook-Pro.local`.
Branch `fix/playtest-2026-10`, BASE `6c7a460`, commit `247dc08` (not pushed, per instruction).
Status: DONE_WITH_CONCERNS (all three gates met; the concerns are design observations for the controller, section 7).

## 1. What I implemented

- `src/plant-core.js`, beside `tripPointOf`: `tripOfPoint(tag)` and `tripLimitOf(def)`, as the brief wrote them.
  `tripOfPoint` maps TIC201, LIC101, PIC401, TIC212, PIC505 to their W2 cause ids and reads `src`, `cond`,
  `threshold`, `eu` from `ESS.CauseEffect.causes()`; every other tag, or a cause whose threshold is not a
  number, gives `null`. `tripLimitOf(def)` walks `def.trips` and returns `{value, eu}` for the first key whose
  cause has a numeric threshold; `null` for no def, no `trips` key (D1, D3), an unknown key, or the tube skin
  trip (its threshold is prose).
- `src/kpi.js`: the `trip` row of `scoreDrill` now reads `no trip · peak <round(peak,1)> <eu> vs trip <value> <eu>`
  when the unit did not trip and both `m.tripLimit` and a numeric `m.peak` are present; `unit tripped` and plain
  `no trip` are unchanged. `round` is the module-local helper (in scope; `scoreDrill` already used it). I also
  added `peak` and `tripLimit` to the module's API header comment so the documented metrics shape stays true.
- `Experion Station Simulator.dc.html`: the page's `scoreDrill` passes `peak:m.peak,tripLimit:this.tripLimitOf(d.def)`
  right after `trip:!!m.trip,`; the two notes `trip point · Alarms tab` became `pre-trip alarm · Alarms tab`; after the
  `limitRows` array, `limitRows.splice(1,0,mRow('Trip','TRIP',...))` adds the read-only declared-trip row just below the
  range, inside the `if(hasBand)` block. `mainRows` (Task 7) untouched.
- Rebuilt with `python3 tools/build-dist.py` (restamped `src/model-id.js`, rebuilt the standalone); both are in the commit.
  The build is idempotent (second run produced identical sha256 for dist and model-id).

## 2. What I tested and results

Commands and results at the final tree (identical to commit `247dc08`):

| Command | Result |
|---|---|
| `node --test tests/app-credibility-s1.test.js tests/kpi.test.js tests/app-cause-effect.test.js tests/app-palette-limits.test.js` | 86 pass, 0 fail (s1 53, kpi 14, cause-effect 11, palette-limits 8) |
| `python3 tools/build-dist.py` | exit 0, `wrote dist/experion-station-sim-standalone.html (800637 bytes, 31 manifest entries)` |
| `node --test tests/*.test.js` | 1211 tests, 1174 pass, 36 fail, 1 skipped |
| `tools/smoke.sh` | exit 0: `SMOKE folder: ok`, `SMOKE dist: ok` |

Red-set comparison (the gate: the same 36 named red and nothing else):

- BASE: `git worktree add /tmp/t8-base 6c7a460`, `node --test tests/*.test.js` there: 1205 tests, 1165 pass, 36 fail, 4 skipped.
  (The three extra BASE skips are the optional `anthropic` Python package being invisible from the scratch worktree, so
  three PIP cloud sidecar tests skip there and pass in the main tree. None is red on either side.)
- HEAD: 1211 tests (my 6 new), 36 fail. The sorted, number-stripped `not ok` name lists are identical
  (`diff` empty). I also compared the failure message of each of the 36 (ANSI stripped): byte-identical at BASE and HEAD,
  so no red test newly fails for a different reason.
- One intermediate state worth recording: my first full run had a 37th red, `the limit ladder is ordered for every point
  and the band renders everywhere` (`tests/app-palette-limits.test.js`), which pinned LIC101's ladder as exactly the
  eight rungs. LIC101 is one of the five points that now carries the TRIP row, so I moved that one assertion
  (`['PVEUHI','TRIP','PVHH',...]`, comment cites spec 3.6). Back to 36.

The 36 (14 architecture goldens, 1 g2-lifecycle, 8 drill goldens, 13 upset goldens):
- A1 Frozen flow measurement: diagnose phase earns 90 but cannot pass before the debrief answer
- A1 gated: seizing MAN before diagnosing anything caps a would-be 90 down to 79 and flips pass to false
- A10 Historian gap: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A11 Assistant loss: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A12 Causal measurement bias: low TIC201 bias moves the real measurement/controller physics digest
- A2 Input channel failure: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A3 Bias with GOOD quality: diagnose phase is 60 before SAFE_RESTRAINT/debrief; no alarm is synthesized
- A4 Redundancy switchover: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A5 Controller loss: weighted diagnose-phase fixture is 65 before SAFE_RESTRAINT/debrief completion
- A6 gated: an unrelated MODE.SET still trips the gate even though the raw score was already under the cap
- A6 Single network path degradation: weighted diagnose-phase fixture is 70
- A7 Communications partition: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A8 Server / flex service loss: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A9 Local station failure: weighted diagnose-phase fixture is 70
- actual archived v1 checkpoints resume explicit legacy operation without inventing composition
- golden upset: agit (setUpset instructor path, +300s post-inject)
- golden upset: agit-batch (setUpset instructor path, +300s post-inject)
- golden upset: air (setUpset instructor path, +300s post-inject)
- golden upset: bedact (setUpset instructor path, +600s post-inject)
- golden upset: cool (setUpset instructor path, +400s post-inject)
- golden upset: drift (setUpset instructor path, +600s post-inject)
- golden upset: foul (setUpset instructor path, +700s post-inject)
- golden upset: pump (setUpset instructor path, +600s post-inject)
- golden upset: rxn (setUpset instructor path, +300s post-inject)
- golden upset: stick (setUpset instructor path, +600s post-inject)
- golden upset: surge (setUpset instructor path, +600s post-inject)
- golden upset: vap (setUpset instructor path, +420s post-inject)
- golden upset: xmtr (setUpset instructor path, +300s post-inject)
- golden: drill D1 unattended run is deterministic and matches the committed fixture
- golden: drill D11 unattended run is deterministic and matches the committed fixture
- golden: drill D12 unattended run is deterministic and matches the committed fixture
- golden: drill D2 unattended run is deterministic and matches the committed fixture
- golden: drill D3 unattended run is deterministic and matches the committed fixture
- golden: drill D4 unattended run is deterministic and matches the committed fixture
- golden: drill D6 unattended run is deterministic and matches the committed fixture
- golden: drill D9 unattended run is deterministic and matches the committed fixture

Mutation check (scripted, files restored byte-identically, sha256 compared): 13 one-line mutations of the change, each
detected by at least one test: wrapper drops `peak`; wrapper drops `tripLimit`; ladder row not added; ladder row at the
end; PVHH keeps old label; PVLL keeps old label; `tripLimitOf` without the numeric guard; `tripLimitOf` with `rx` mapped
to the wrong cause; `tripOfPoint` with LIC101 mapped to the wrong cause (caught only by my table test, not by the
brief's agreement test); kpi peak guard as truthiness (caught by the `peak: 0` case); kpi without the peak guard; kpi
margin shown after a trip; kpi rounding to 0 places.

## 3. TDD evidence

RED, `node --test tests/app-credibility-s1.test.js tests/kpi.test.js` before any implementation (66 tests, 61 pass, 5 fail):

```
not ok 49 - D9: a point with a configured trip knows its trip from the W2 declaration, and the two declarations agree
  error: 'c.tripOfPoint is not a function'
not ok 50 - D9: the Point Detail ladder labels PVHH a pre-trip alarm and shows the declared trip row
  actual: 'trip point · Alarms tab'            (test expects /^pre-trip alarm/)
not ok 51 - D9: the trip row of each point with a declared trip carries that trip, its unit and its source, read-only
  error: 'TIC201: trip row'                    (no TRIP row yet)
not ok 52 - D9: the drill scorer states the margin to the declared trip point
  error: 'c.tripLimitOf is not a function'
not ok 66 - the trip row names the peak against the declared trip point when both are known
  expected: 'no trip · peak 183.7 DEG C vs trip 185 DEG C'
  actual: 'no trip'
```

GREEN, `node --test tests/app-credibility-s1.test.js tests/kpi.test.js tests/app-cause-effect.test.js tests/app-palette-limits.test.js`:

```
ok 52 - D9: a point with a configured trip knows its trip from the W2 declaration, and the two declarations agree
ok 53 - D9: the Point Detail ladder labels PVHH a pre-trip alarm and shows the declared trip row
ok 54 - D9: the trip row of each point with a declared trip carries that trip, its unit and its source, read-only
ok 55 - D9: the drill scorer states the margin to the declared trip point
ok 56 - D9: a live D4 run reaches the debrief stating the peak the plant recorded against the declared 185 DEG C, and says only "unit tripped" after a trip
ok 78 - the trip row names the peak against the declared trip point when both are known
# tests 86
# pass 86
# fail 0
```

Honesty note: the live D4 run test (#56) was written after the implementation, from a scratch prototype, not RED-first;
the mutation check above shows it fails when the page wrapper stops passing `peak` or `tripLimit`.

## 4. Files changed (8, commit `247dc08`)

- `src/plant-core.js` (+14): `tripOfPoint`, `tripLimitOf`.
- `src/kpi.js` (+12/-6): trip note; API header comment.
- `Experion Station Simulator.dc.html` (+5/-3): scorer wrapper, two labels, TRIP row.
- `src/model-id.js`, `dist/experion-station-sim-standalone.html`: build output of `tools/build-dist.py`.
- `tests/app-credibility-s1.test.js` (+97): five D9 tests (below).
- `tests/kpi.test.js` (+17): one test.
- `tests/app-palette-limits.test.js` (+2/-1): LIC101 ladder expectation (not in the brief's file list; see 6).

Tests added to `tests/app-credibility-s1.test.js`: the brief's three, kept by name and body (the first gains an unknown-tag
`null` line, the second a PVLL label assertion, the third the checks below), plus a table test of all five trip rows
(value, source note, read-only, one row, nine rows total, TIC301 keeps eight), and the live D4 run test. The third
test now also pins `tripLimitOf` for D2/D6/D9/D11/D12/D3, the null cases (`undefined`, `null`, `{}`, `{trips:[]}`,
unknown key, `{trips:['skin']}`), and drives the page's `scoreDrill` with hand-built drill records (margin, tripped,
`91.25 -> 91.3 %`, no peak, no declared trip).

## 5. Self-review findings

Completeness against the brief and the edge cases you listed:
- A tag with no declared trip: `tripOfPoint` null (FIC102, TIC301, unknown tag); no TRIP row; ladder keeps eight rungs.
- A drill def with no `trips` (D1, D3), no def at all, an unknown key: `tripLimitOf` null, no throw.
- A cause whose threshold is a string (H310_SKIN): skipped by the numeric guard; `{trips:['skin']}` gives null.
- `m.peak` undefined: plain `no trip`. `tripLimit` null: plain `no trip`. `peak: 0` with a limit: `peak 0 DEG C vs ...`.
- Both halves present but the unit tripped: `unit tripped`, no margin invented.
- `m.peak` NaN would print `peak NaN`; I kept the brief's `typeof m.peak === 'number'` (the file's own idiom, no other
  guard in `scoreDrill` is finite-checked) rather than add a guard the brief did not ask for. `peakOf` reads model values
  that the snapshot code already refuses when non-finite.
- No `Math.random()`, no DOM or timers in `src/`; `kpi.js` stays ES5 (`var`, `function`).
- Quality: names match what they do; the one-line helper style of `plant-core.js` is kept; comments cite spec 3.6 only.
- Discipline: nothing beyond the brief other than the kpi.js header comment and the one pinned-assertion update.
- Pairing check done for every drill that records a peak: D2 `ovf`/`tankL` (98 %), D4 and D6 `rx`/`rT` (185), D9 `psv`/`drumP`
  (950 KPA), D11 `batch`/`T212` (110), D12 `bed`/`bed` (480). D2 lists `['ovf','rx']`, so "first mapped key" is what keeps its
  margin on the level; the test pins it, so a reorder would be caught.
- Layout not eyeballed in a browser (smoke checks console errors only). The TRIP note is about 70 characters and wraps in
  the ladder's note column the way the existing long notes do; the ladder rows are natural-height flex, nothing is clipped.

## 6. Deviations from the brief's literals

1. `tests/kpi.test.js`: the brief's test reads `Kpi.scoreDrill(...).rows.find(...)`. The real return shape is
   `{score, pass, passMark, passLabel, breakdown}` (documented in the kpi.js header, used by every existing kpi test), so
   `.rows` is undefined and would throw. I used `.breakdown`. The in-test `require` is dropped, as you asked.
   All strings (`no trip · peak 183.7 DEG C vs trip 185 DEG C`, `unit tripped`, `no trip`) are the brief's.
2. `tests/app-palette-limits.test.js` is outside the brief's file list but one assertion had to move: it pinned LIC101's
   `limitRows` params as the eight rungs; with the TRIP row it is nine, TRIP at index 1. The brief's Step 5 expected only the
   golden set to be red; this test was the one thing it did not foresee.
3. The brief's Step 5 `git push` was not run (controller pushes).
4. The brief says the debrief note is not digested by any golden. Strictly it is: `tests/golden-drills.test.js` compares
   `score.breakdown` including `note` against `tests/fixtures/drill-D*.json`. Those eight tests were already red at BASE and fail
   earlier in the chain (end-state digest, step count), so the red set is unchanged and the messages are byte-identical; but
   see the Task 9 heads-up below.
5. Extra tests and the kpi.js header comment, as listed above.

Measured values vs literals: none differed. `185.0 DEG C` (TIC201), `98.0 %`, `950 KPA`, `110.0 DEG C`, `1100 KPA` are what
`fmt(value, dl.dec)` gives for the five points; they are pinned in the table test.

## 7. Issues and concerns

Heads-up for Task 9 (re-capture): the drill goldens will pick up the margin note. Measured now with the golden driver
(seed 20260829, unattended): D1 `no trip`; D2 `no trip · peak 86.3 % vs trip 98 %`; D3 `unit tripped`; D4 `unit tripped`;
D6 `no trip · peak 179.8 DEG C vs trip 185 DEG C`; D9 `no trip · peak 854.9 KPA vs trip 950 KPA`;
D11 `no trip · peak 98.8 DEG C vs trip 110 DEG C`; D12 `unit tripped`. The peak is at 0.1 resolution inside the fixture, so
any later dynamics change moves those fixtures; they re-capture with the others.

Design observations for the controller to rule on (I implemented the brief and spec 3.6 literally and changed nothing):
- "pre-trip alarm" is now the label on every configured PVHH/PVLL. Where the PVHH rung IS the trip, that under-claims:
  TI314 and TI315 (the app latches the H-310 skin trip directly from either channel's PVHH, 490 and 500), TI312 (PVHH 480 sits at
  the R-310 trip, 480; `h.bed >= 480` trips on the model value, TI312 reads `h.bed` plus noise), and TI216 (its PVHH latches the
  TAD shed). The old `trip point` label was right for those and wrong for the five. None of them gets a TRIP row because the
  brief's map holds five tags. Options if wanted: make the label conditional on `tripOfPoint(tag)`, or add TI312 to the map.
- Conversely a point with no declared trip at all (FIC102, TIC301, TIC202, ...) also reads "pre-trip alarm" for its critical
  rungs, which implies a trip behind them.
- `src/philosophy.js` (lines 30, 35, 59) still says "the critical limits are the trip points", and the Philosophy help dialog
  renders it. Out of this task's scope; now sits beside a ladder that says "pre-trip alarm".
- `docs/dev/CODE-MAP.md` and `CHANGELOG.md` not touched (Task 9).

---

# Fix round 1: ruling CR28 (the critical-alarm note is true per point)

Author: MacBook seat (claude-sonnet-5-5). Commit `47c5b2b` on top of `247dc08`:
`fix(hmi): the critical-alarm note is true per point: pre-trip, trip point, or critical alarm (CR28)`. Not pushed.
Status: DONE_WITH_CONCERNS (one interpretation call and a few observations, section E).

## A. What changed (5 files: page, `src/philosophy.js`, `tests/app-credibility-s1.test.js`, `src/model-id.js`, dist)

`Experion Station Simulator.dc.html`, Point Detail limit ladder, beside `limitRows`:
- `tp=this.tripOfPoint(dl.tag)` now sits above the array (the TRIP-row splice below it is unchanged).
- A `critNote(c)` gives the note for a configured critical rung: `pre-trip alarm` when `tp` names a declared trip and the
  rung is PVHH; else `trip point` when the rung is in the explicit list below; else `critical alarm`; each followed by
  ` · Alarms tab`. The two critical rows call it; the `'none configured · follows range'` branch is untouched.
- The explicit trip-point list (`tripPt`, four predicates) with the evidence for every entry in a comment.

`src/philosophy.js`: the ladder paragraph no longer says the critical limits are the trip points. It now reads "the critical
limits are the most severe alarms on the point" and adds "The note beside a critical limit says what sits behind it: a
pre-trip alarm where a trip is declared further out (Point Detail shows that trip on its own row), the trip point itself where
the alarm is the trip condition, or a critical alarm and nothing more." The two Critical rows of the ladder table in the same
dialog (`LADDER`, rendered under the paragraph) said "trip or safety limit"; they now say "trip or safety limit, or the alarm that
warns of one" (a small extension of the ruling so the dialog does not contradict itself).

`grep -rn "trip points" tests/` finds two hits, neither pinning the philosophy text: my own new CR28 test title, and a comment
in `tests/process-text.test.js:14` about process help text. No test needed updating for the wording; I added one that pins it.

## B. The verified trip-point list, with evidence

A point is on the list only when its PVHH or PVLL is literally the condition the code trips or latches on. I read the code, then
made each claim executable (all in `tests/app-credibility-s1.test.js`, test "CR28: each trip-point entry is the condition the
code acts on, and no other critical alarm drives the plant"). Output of each check was also run in a scratch script first.

| Point, rung | Value | Code | Evidence run |
|---|---|---|---|
| TI314 PVHH | 490 | `interlocks()` (`src/plant-core.js` ~616): `if(!P.trips.skin && (L.TI314._as.PVHH \|\| L.TI315._as.PVHH))` latches `trips.skin`. The latch reads the alarm's active state, so it holds at any configured value. | `H310_SKIN.threshold` is the string `TI314 >= 490 DEG C or TI315 >= 500 DEG C`; parsed, it gives `[490, 500]`, equal to `[TI314.alm.PVHH[0], TI315.alm.PVHH[0]]`. Setting TI314 PVHH to 300 and stepping once latches `P.trips.skin`; setting its PVHI to 300 does not. |
| TI315 PVHH | 500 | the same latch, other channel | same, for TI315 |
| TI216 PVHH | 106 | `interlocks()` (~612): `if(L.TI216._as.PVHH){ latchTadShed(); enforceTadShed(); }` | PVHH set to 10 and one step: `tadShed === true`, `FIC211` MAN at OP 0; PVHI set to 10: nothing sheds. The phase sets re-apply 105 or 106 here, the entry holds at either. |
| TI312 PVHH | 480 | R-310 bed trip is `h.bed >= c.tripT` (`src/models.js` 593, `fixedBed`, `c = PARAMS.U3`); `PARAMS.U3.tripT` is 480 (line 192); `measureU3` sets `L.TI312.pv = h.bed + n(0.5)` (line 601). The trip does not read the alarm. | `Models.PARAMS.U3.tripT === 480 === TI312.alm.PVHH[0]`; `tripLimitOf({trips:['bed']}).value === 480` (the W2 declaration, which `tests/cause-effect.test.js` already ties to `tripT`); after one step `|TI312.pv - P.h.bed| = 0.118 <= 0.25` (the 0.5 noise window). |

None of the four candidates was dropped. Two corrections to how the ruling described them, neither changing the outcome:
- The skin trip is not in `stepU3`: `stepU3`/`firedHeater` only compute `h.ts1`/`h.ts2` (there is no skin threshold in
  `src/models.js`); the trip is the app-level latch in `interlocks()` above. Each point's PVHH equals its own declared
  threshold (490, 500), so neither is dropped.
- TI216's interlock is the TAD shed: `latchTadShed()` puts FIC211 in MAN at 0 (MV-211 closed) and holds SCM202 when the batch
  is in FEED. It is not a level hold.

TI312 needs a value guard, and has one. The bed trip does not read the alarm, and an ENGR can move any alarm limit (trip-point
entries are signed ENGR stores with no ordering check). So TI312 reads `trip point` only while its configured PVHH still equals the
declared R-310 trip (`a[0] === tripLimitOf({trips:['bed']}).value`); moved to 470 it reads `critical alarm` (tested). TI314,
TI315 and TI216 need no guard: the code reads the alarm itself, so they hold at any value (tested at a moved value).

Completeness (the claim behind "critical alarm for every other point"): I scanned for any code that acts on a critical alarm.
The only reads of a PVHH or PVLL active state are those three in `interlocks()` (the page's `AI316._as.PVLO` is an advisory
card on a standard rung). `src/models.js` never reads `alm`. The test scans `plant-core.js`, `models.js` and the page for
`\b(\w+)\._as\.(PVHH|PVLL)\b` and requires exactly `TI216.PVHH, TI314.PVHH, TI315.PVHH`, so a new alarm-driven interlock fails
it and prompts an entry on the page list. I also checked every other trip site in `models.js` (`raiseTrip` for TK-101, R-201,
V-401, R-202, R-310, V-502): each is on a model variable with its own threshold, none reads an alarm.

## C. How the notes read now (every non-motor point, from a scratch render)

- `pre-trip alarm · Alarms tab`, PVHH only, and each with its TRIP row: LIC101 (90, trip 98 %), TIC201 (175, trip 185), PIC401
  (900, trip 950), TIC212 (105, trip 110), PIC505 (1050, trip 1100).
- `trip point · Alarms tab`, PVHH: TI216 (106), TI312 (480), TI314 (490), TI315 (500). No TRIP row on these four.
- `critical alarm · Alarms tab`: every other configured PVHH/PVLL: FIC102, TIC202, TIC301, LIC401, PI214, TIC311, TIC502,
  LIC503, LIC504, AI509 (PVHH), FIC313 (PVLL), and PVLL on LIC101, TIC201, PIC401, PIC505 and the rest.
- `none configured · follows range`: unchanged for every unconfigured critical rung.

## D. Tests, commands, output

New and changed, `tests/app-credibility-s1.test.js` (53 -> 56 tests; 3 new, 1 extended):
- D9 ladder test, extended: exact strings `pre-trip alarm · Alarms tab` (TIC201 PVHH, TRIP row `185.0 DEG C` at index 1),
  `critical alarm · Alarms tab` (TIC201 PVLL), `trip point · Alarms tab` (TI312 PVHH), `critical alarm · Alarms tab`
  (TIC301 PVHH and PVLL, FIC102 PVHH); TI312, TIC301 and FIC102 carry no TRIP row. The round-1 line that asserted PVLL
  reads pre-trip on TIC201 is replaced (see E.1).
- New "CR28: every configured critical alarm on the ladder says what it is...": a sweep over every non-motor point and both critical
  rungs: configured rungs are exactly the five pre-trip PVHH rungs, the four trip-point PVHH rungs, and `critical alarm`
  for the rest; unconfigured rungs say `none configured · follows range`; the TRIP row appears on exactly the five pre-trip points;
  for each of the five, the declared cause's comparator is `>` or `>=` and PVHH sits below the trip value.
- New "CR28: each trip-point entry is the condition the code acts on...": the evidence in section B.
- New "CR28: the philosophy page says what the three ladder notes mean...": the old sentence is gone, the page names the three
  notes, the two ladder table cells read as above.

Commands (final tree, identical to commit `47c5b2b`):
```
node --test tests/app-credibility-s1.test.js   -> pass 56, fail 0
node --test tests/kpi.test.js                  -> pass 14, fail 0
node --test tests/app-cause-effect.test.js     -> pass 11, fail 0
node --test tests/app-palette-limits.test.js   -> pass 8,  fail 0
python3 tools/build-dist.py                    -> exit 0, wrote dist/experion-station-sim-standalone.html (802443 bytes, 31 manifest entries); second run byte-identical (sha256 of dist and model-id)
node --test tests/*.test.js                    -> tests 1214, pass 1177, fail 36, skipped 1
tools/smoke.sh                                 -> exit 0: SMOKE folder: ok, SMOKE dist: ok
```
Red-set gate: the sorted, number-stripped `not ok` names at HEAD equal the 36 names captured at BASE `6c7a460` (`diff` empty), and
the failure message of each of the 36 is byte-identical to BASE (ANSI stripped). `/tmp/t8-base-red-names.txt` was kept from the
round-1 BASE run; the scratch worktree was already removed.

Dist check: the standalone's manifest entries are gzip+base64, so plain `grep` does not see module text. I decoded all 31 entries:
the new philosophy sentence, `tripOfPoint(tag){` and the kpi `tripNote` are bundled; the old "the critical limits are the trip points" is not.

Mutation check (13 one-line mutations, scripted, files restored byte-identically, sha256 compared): pre-trip on both rungs;
pre-trip without the declared-trip gate; TI312 dropped; TIC311 added; TI312 without its value guard; TI314 given a value guard;
TI216 dropped; TI315 moved to PVLL; default note changed to `trip point`; the none-configured text changed; the philosophy
sentence reverted; the philosophy table reverted; a new `_as.PVHH` read added to `plant-core.js`. Each is caught by at least one test.

TDD: the new tests were written first and run against the round-1 code: the D9 ladder test failed with expected
`critical alarm · Alarms tab`, actual `pre-trip alarm · Alarms tab`; the sweep failed; the evidence test passed its constant checks
and failed at expected `trip point · Alarms tab`, actual `pre-trip alarm · Alarms tab`. Before implementing, I ran the latch
and constant assertions in a scratch script against the unchanged code to confirm they hold on their own. Then implemented, then green.

## E. Interpretation call and observations

1. **PVLL on the five declared-trip points reads `critical alarm`, not `pre-trip alarm`** (the one place I went beyond the literal
   text). CR28 says pre-trip "only where `tripOfPoint` names a declared trip". I applied that as a necessary condition and
   added rung geometry: all six declared trips are high-side (comparators `>=` and `>` in the declaration), so a low rung cannot
   precede them, and `pre-trip alarm` on TIC201 PVLL (130) beside a TRIP row of 185 would be the same kind of false claim CR28
   removes elsewhere (likewise PIC401 PVLL 350, PIC505 PVLL 400, LIC101 PVLL 10). If you want both rungs pre-trip at those points,
   it is one clause: drop `&&c==='PVHH'` from `critNote` and flip the one assertion in the D9 ladder test and the sweep's rule; the
   round-1 test had asserted the literal both-rungs reading. The test also fails if a low-side trip is ever declared for these points.
2. LIC101 PVLL (10 %) does precede a real trip: P-101 cavitation trips at `tankL < 2` (declared in the matrix as `P101_TRIP`,
   but its threshold is prose, and it is a motor trip with no TRIP row). It reads `critical alarm`: true, though less informative.
   Naming it would need a numeric declaration first.
3. Vocabulary: the app already uses "trip point" for the configured-limit column on every Alarms tab row and in the MOC entries
   (`TRIP POINT TIC201 PVHH ...`). The ladder note `trip point · Alarms tab` now means "this alarm is the trip condition".
   Low severity, no change made.
4. The TI312 predicate reads the declared R-310 trip through the existing `tripLimitOf({trips:['bed']})`, the same lookup D12 uses,
   so there is no second copy of 480 on the page.
5. Task 9 heads-up from round 1 still stands (drill goldens pick up the margin note on re-capture); CR28 changes no golden: the
   36 red messages are byte-identical to BASE.

---

# Fix round 2: post-review (CR28b, CR29, CR30 and the minors)

Author: MacBook seat (claude-sonnet-5-5). Commit `c7b9fd3` on top of `5682068` (the controller's spec commit):
`fix(hmi): the pre-trip label follows the stored limit; TI312 gets its R-310 trip row; the trip note fits in two lines (CR28b, CR29, CR30)`.
Not pushed. Status: DONE_WITH_CONCERNS (two observations in section E; nothing blocking).

## A. What changed, per finding (6 files: page, `src/plant-core.js`, `src/philosophy.js`, `tests/app-credibility-s1.test.js`, `src/model-id.js`, dist)

**CR28b (Important).** `critNote` returns `pre-trip alarm` only when `tp && c==='PVHH' && dl.alm.PVHH[0] < tp.value`; otherwise it
falls through to the trip-point list and then to `critical alarm`. The comparison is strict: PVHH stored at exactly the trip value
is not "before" it. Verified three ways: in node through the real signed `TP:` store (below), in the real page through the same
store, and by mutation (`<=`, `>` and "no guard" are all caught). The reviewer's probe, TIC201 PVHH stored at 190, now reads
`TRIP 185.0 DEG C` then `PVHH 190.0 DEG C | critical alarm · Alarms tab` (screenshot 3).

**CR29.** `tripOfPoint` gains `TI312: 'R310_HITEMP'` (`src/plant-core.js`). I checked each mapped point against `models.js` that it
indicates its trip variable: `TIC201.pv = P.rT`, `LIC101.pv = clamp(P.tankL + P.driftOff)`, `PIC401.pv = P.drumP`, `TIC212.pv = b.T`,
`PIC505.pv = s.pres`, `TI312.pv = h.bed` (the declared variables: `rT`, `tankL`, `drumP`, `b.T`, `s.pres`, `h.bed`). Behaviour, pinned:
- shipped PVHH 480: `trip point · Alarms tab` beside `TRIP 480 DEG C`, with `R-310 HI TEMP TRIP · C&E matrix, plant-enforced`;
- stored 470: `pre-trip alarm · Alarms tab`, TRIP row still 480; stored 490: `critical alarm · Alarms tab`, TRIP row still 480;
  stored back to 480: `trip point` again.
The explicit trip-point list still names TI312, and its predicate now reads the declared value from `tp`
(`a[0] === tp.value`), so the page no longer calls `tripLimitOf({trips:['bed']})` (see E.1). Ladder order for TI312: range `600 DEG C`,
`TRIP 480` at index 1, `PVHH 480` next, then 440, 420, 360, 0, 0, 0, non-increasing (screenshot 2-after-TI312). The table test now
asserts the whole ladder stays non-increasing with the trip row in, for all six points.
Agreement test: loop extended with `'TI312'`; `tripOfPoint('TI312')` deep-equals
`{ id: 'R310_HITEMP', src: 'R-310', cond: 'HI TEMP TRIP', value: 480, eu: 'DEG C' }` and agrees with
`EQUIPMENT_TRIPS['R-310.HI TEMP TRIP']`; `tripOfPoint('FIC102') === null` and the unknown-tag case are kept.

**CR30 (layout), measured.** See section B. The TRIP note measured 3 lines, so it is now
`tp.src+' '+tp.cond+' · C&E matrix, plant-enforced'` (same facts, fewer words); it measures 2 lines on all six trip rows.

**Minor 1, page comment.** Now says "every declared process trip is high-side (comparator >= or >)"; the motor trip P101_TRIP
(cavitation, `P.tankL < 2`) is low-side and is not a process trip. The comment also states the CR28b rule and the CR29 TI312 behaviour.

**Minor 2, `src/philosophy.js`.**
- The ladder paragraph: "the critical limits are the outermost alarm limits;" (by position; it was "the most severe alarms on the
  point", false for the Journal-priority PVLL on TIC202 at 10 and TIC301 at 150, which sit below their Low-priority PVLO).
- Ladder table, Critical high: `outermost high alarm limit; it warns of a trip where one is declared, or is the trip condition itself; an Urgent alarm`
  (every configured PVHH is Urgent as shipped). "normally an interlock" is gone: only three configured critical alarms latch one
  (TI314, TI315, TI216).
- Ladder table, Critical low: `outermost low alarm limit; it warns of a trip where one is declared` (no PVLL is a trip condition in this
  plant, so it has no second clause).
`grep -rn "trip points" tests/` still finds only my own test title and an unrelated comment in `tests/process-text.test.js`; the
philosophy test now pins the new sentence, the exact table text, the absence of "most severe", and the absence of "interlock" in the PVHH row.

**Minor 3, exact peaks.** The live D4 test pins `170.49863188284542` (feed cut at once; note `no trip · peak 170.5 DEG C vs trip 185 DEG C`)
and `187.75740252617464` (unattended, `unit tripped`). I measured both from the test's own flow and ran each twice: bit-identical.

## B. CR30 layout measurement (headless Chrome, offline dist, DNS blocked, 1400x900)

Method: `task-8-fix2-layout-probe.js` (beside this report) copies the dist to `/tmp`, adds a one-line `window.__c = this` hook to the copy's
`componentDidMount`, drives headless Chrome over the DevTools protocol (Node 22's built-in WebSocket, no dependencies), calls
`nav('detail', tag)` on the live component, and measures the ladder rows from the real DOM: note-column width and height, line count
(distinct line-box tops of a Range over the note), row height, and horizontal overflow. Nothing in the repo is touched.
Usage: `node task-8-fix2-layout-probe.js <dist> <screenshot prefix> [tags]`; `PROBE_PRE='TAG:COND:VALUE'` makes the page perform the
signed trip-point store first (the page's own `storeEntry` and `signAction`).

Panel 460 px, note column 132 px, 10.5 px Tahoma, line-height normal (13 px per line); no note overflows horizontally in any case.

| Point | TRIP note | chars | lines | note height | row height |
|---|---|---|---|---|---|
| TIC201, before (round 1 text) | `R-201 HI TEMP TRIP · declared in the C&E matrix, enforced by the plant` | 70 | **3** | 39 px | 44 px |
| TIC201, after | `R-201 HI TEMP TRIP · C&E matrix, plant-enforced` | 47 | **2** | 26 px | 31 px |
| TI312, after (new row, CR29) | `R-310 HI TEMP TRIP · C&E matrix, plant-enforced` | 47 | 2 | 26 px | 31 px |
| LIC101 / PIC401 / TIC212 / PIC505, after | `TK-101 HIHI TRIP` / `V-401 PSV LIFT` / `R-202 HI TEMP TRIP` / `V-502 PSV LIFT` + the same tail | 45 / 43 / 47 / 43 | 2 each | 26 px | 31 px |

For scale, existing notes already wrap to 2 lines in this column (`operator must act · Alarms tab`, 30 chars; `none configured · follows critical`, 34).
The TIC201 ladder panel went from 312.1 px to 299.1 px tall. 3 lines is past the ruling's two-line limit, so the shorter text was applied.

Screenshots, in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-8-screens/` (git-excluded), panel crops at 2x plus a full-page view for the first tag:
- `1-before-TIC201-ladder.png`, `1-before-TIC201-page.png`: the 3-line wrap. `1-before-TI312-ladder.png`, `1-before-TIC301-ladder.png`: before CR29 (no TI312 trip row).
- `2-after-TIC201-ladder.png`, `2-after-TIC201-page.png`, `2-after-TI312-ladder.png` (range 600, TRIP 480, PVHH 480 `trip point`), and
  `2-after-LIC101-`, `PIC401-`, `TIC212-`, `PIC505-ladder.png`: the 2-line rows.
- `3-stored-190-TIC201-*`: PVHH stored at 190 through the signed store: `critical alarm · Alarms tab` beside the 185 TRIP row.
  `4-stored-470-TI312-*`: `pre-trip alarm`. `5-stored-490-TI312-*`: `critical alarm`. (TRIP stays 480 in both.)

## C. Covering tests, commands, output

`tests/app-credibility-s1.test.js` (56 -> 58 tests; 2 new, 7 changed):
- new `CR28b: the pre-trip label follows the stored limit...`: TIC201 PVHH stored through the real signed `TP:` store (`storeEntry`, the
  signature dialog, `signAction`, with security level ENGR) at 184 (`pre-trip alarm`), 185 and 190 (`critical alarm`), 170 (`pre-trip alarm`
  again); the displayed PVHH value and the TRIP row (`185.0 DEG C`, unmoved) are asserted each time.
- new `CR29: TI312 shows the R-310 trip row...`: the three states above plus the return to 480, rows `[PVEUHI 600, TRIP 480, PVHH 480]`
  and the new TRIP note.
- changed: the agreement test (TI312), the D9 ladder test (TI312 has a TRIP row; TIC301 and FIC102 do not), the trip-row table
  (TI312, the CR30 note text, and the descending-ladder assertion), the CR28 sweep (the TRIP-row set is the five pre-trip points plus
  TI312; the high-side comparator check covers all six; PVHH is below the trip for the five and at it for TI312), the CR28 evidence test
  (TI312's declared trip read through `tripOfPoint`; the moved-limit cases live in the CR29 test), the philosophy test, the live D4 test (exact peaks).

```
node --test tests/app-credibility-s1.test.js   -> pass 58, fail 0
node --test tests/kpi.test.js                  -> pass 14, fail 0
node --test tests/app-cause-effect.test.js     -> pass 11, fail 0
node --test tests/app-palette-limits.test.js   -> pass 8,  fail 0
python3 tools/build-dist.py                    -> exit 0, wrote dist/experion-station-sim-standalone.html (802937 bytes, 31 manifest entries); a second run byte-identical (sha256 of dist and model-id)
node --test tests/*.test.js                    -> tests 1216, pass 1179, fail 36, skipped 1   (the controller's run at 5682068: 1214 / 1177 / 36 / 1; +2 tests are mine)
tools/smoke.sh                                 -> exit 0: SMOKE folder: ok, SMOKE dist: ok
```
Red-set gate: the sorted, number-stripped `not ok` names equal the 36 captured at BASE `6c7a460` (`diff` empty), and each failure message
is byte-identical to BASE. The last edit after smoke was a one-line comment in the test file; I checksummed the page, `src/*.js` and the
dist before and after it: identical, so the smoke result applies to the committed bytes.

Mutation check (12 one-line mutations, scripted, files restored byte-identically, sha256 compared), each caught by at least one test:
no stored-limit guard; guard `<=`; guard reversed; TI312 entry with `>=`; TI312 entry dropped; TI312 out of `tripOfPoint`; TI312 mapped to
the wrong cause; TRIP note back to the long wording; TRIP row at index 2; philosophy "most severe" restored; "normally an interlock" restored;
PVLL table row loosened.

TDD: the new and changed tests were written first and run against the round-2-start code: 8 failed (the agreement test at `TI312`, the D9
ladder test, the trip-row table, the CR28 sweep, the evidence test, the philosophy test, CR28b, CR29), for the intended reasons; the
exact-peak pins already passed (they tighten, not change, behaviour). Then implemented, then green.

## D. The deferred items, untouched

Not changed, per the ruling: the "trip point" term collision (Alarms tab, MOC records, curriculum), `tripLimitOf`'s hand map versus
`latch.field`, the rounded zero margin at 184.95, the spec wording. (E.1 is about the one place CR29 touches the page lookup.)

## E. Observations

1. The page's `tripLimitOf({trips:['bed']})` lookup is gone as a consequence of CR29, not as a separate cleanup: TI312 now has `tp`, so its
   list predicate reads `tp.value`. `tripLimitOf` itself (the hand map, the drill-def helper) is untouched and still pinned by the D9 scorer
   test for D12. If the controller's deferral was meant to keep that lookup on the page, say so and it is a one-line restore.
2. After CR28b a point whose PVHH is stored exactly at its declared trip reads `critical alarm` (the five declared-trip points), not
   `trip point`: the explicit trip-point list names only the four points verified against code, so a stored limit that happens to equal a
   trip is not promoted. True, if a little less informative; and the TRIP row beside it states the trip. The ladder still lists the TRIP
   row at index 1 even when a stored PVHH sits above it (190 under 185), so the order is visibly non-descending there, as the reviewer's
   probe showed; the label is now true, and I did not re-sort rows (not asked).
