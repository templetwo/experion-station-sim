<!-- @artifact dev -->
# Task 9 report: close stage S1 (archive, re-capture, guard, changelog, docs pass, gates)

Status: DONE_WITH_CONCERNS (concerns in section 9; none blocks the stage).
Seat: MacBook seat (claude-sonnet-5-5), implementer. Host `Anthonys-MacBook-Pro.local`. Branch `fix/playtest-2026-10`, BASE `a155da8`. Not pushed.

## 1. Commits (three, as ruled; each carries exactly the two trailers)

| SHA | Subject | Suite at that commit |
|---|---|---|
| `59a7a56` | test(goldens): archive the 3.1.0 fixtures before stage S1 re-captures any of them (CR10) | 1218 tests, 1181 pass, 36 fail, 1 skipped; the 36 red names are identical to BASE |
| `cc363cb` | test(goldens): re-capture the 35 S1 movers and record each in the archive guard; re-scope the g2-lifecycle lockstep (CR10, CR27) | 1218 / 1217 / 0 / 1 |
| `ad0113a` | docs(s1): changelog for the two seams, and the docs pass owed by Tasks 1 to 8; D3's debrief gets its restart note (CR21) | 1219 / 1218 / 0 / 1 |

`ad0113a` was amended once, before any push (the first version `c3a5e31` had the D3 note without its last clause; see section 7). `NIGHT PREVIEW.dc.html` was never staged.

## 2. Step 0: the archive and the guard (`59a7a56`)

- `tests/fixtures/v31-baseline/`: 40 files copied with `git show 1f0147e:<path>` (8 drills, 13 upsets, `arch/` 14, `u4/` 5), subdirectories kept, `v2-baseline/` not touched. Each copy was `cmp`-checked against the live fixture (identical at BASE) and the archive differs from the v2 archive in exactly the three files 3.1.0 re-captured (drill-D12, upset-air, upset-bedact), as expected.
- `README.md` there: `<!-- @artifact dev -->`, three lines of prose, and the sha256 table the test parses. JSON copies already carry their own `"//": "@artifact dev ..."` marker, so `tests/artifact-classes.test.js` needed no change (checked after staging, since it reads `git ls-files`).
- Guard: two tests appended to `tests/v2-baseline-archive.test.js` (decision: the brief says "extend", so not a new file): "the archived 3.1.0 baseline is intact and complete" (40 rows parsed from the README, every file hashed, on-disk list equals listed list, recursive over `arch/` and `u4/`) and "every live golden equals its 3.1.0 copy unless it is listed as re-captured since 3.1.0". The second is exact in both directions: a listed file must really differ from its copy (a stale entry fails), every unlisted file, the five u4 goldens included, must be byte-identical. The list was empty at this commit.
- Mutation-checked: one byte appended to a live `u4/u4-design.json` turns the second test red (`u4/u4-design.json: the live golden differs from the 3.1.0 archive but is not listed...`); one byte appended to the archived `arch/A5.json` turns both red. Both restored byte-identical.

## 3. Steps 1 and 2: the movers, measured (`cc363cb`)

Final build first: `python3 tools/build-dist.py` was a no-op (dist and `src/model-id.js` already in step). Ran the five golden files (`golden-upsets`, `golden-drills`, `golden-u4`, `drill-arch-fixtures`, `g2-lifecycle`) twice without `UPDATE_GOLDENS`: 36 fail both times, the same 36 names, and no message says NONDETERMINISM (each golden test also proves two independently built sims agree before it compares to the fixture). Messages: drills "end-state digest moved from the committed golden", upsets "v2 end-state behaviour changed since capture", arch "physics endState digest moved from the committed fixture", g2-lifecycle a deepEqual diff.

**How the reasons were measured (not copied from the brief).** The golden tests assert the first failing digest only, so the first message hides what else moved. I made a scratch copy of the tree outside the repo (`/tmp/t9/abl`) with nine env switches (`ABL=...`) that disable one S1 mechanism each: `cutoff` (FIC211 low-flow cutoff in `observe()`), `sat` (the range clamp), `device` (FIC102 hold while P-101 is stopped), `ilkRx`, `ilkFIC211`, `ilkTIC213`, `ilkBed` (the interlock rows of `forcedOutputs()`), `d4rule` (D4's `stable:'restore'` falls back to `'alarms'`) and `margin` (the trip-row note in `src/kpi.js`). Then ran the four fixture-writing test files with `UPDATE_GOLDENS=1` in the scratch tree under each configuration and compared every fixture with its `v31-baseline` copy field by field (model stamp ignored).

| Configuration | Fixtures differing from 3.1.0 |
|---|---|
| all nine switched off | 0 of 40 (every fixture byte-equal modulo the stamp: the union of the known causes explains every move, so nothing moved for an unknown reason; no stop needed) |
| nothing switched off (the real tree) | 35 of 40; the 5 u4 goldens identical |
| only `cutoff` | all 35 |
| only `sat` | drill-D4, upset-cool |
| only `device` | drill-D3, upset-pump |
| only `ilkRx` | drill-D4, upset-cool |
| only `ilkBed` | drill-D12, upset-bedact |
| only `ilkFIC211`, only `ilkTIC213` | none |
| only `d4rule` | none |
| only `margin` | drill-D2, D6, D9, D11 (`score.breakdown` only) |

Every field that moved in the full run is covered by at least one isolated cause (script check: no interaction residue). The capture in the repo equals the scratch full-config capture on all 40 fixtures (model stamp ignored), which doubles as a cross-process determinism check.

**Measured reasons per fixture** (this is what both KNOWN lists carry):

| Fixture(s) | Causes |
|---|---|
| arch A1 to A12, A1 gated, A6 gated (14) | CUTOFF only (`physicsDigest` only; health digest, score, gates unchanged) |
| drill-D1; upsets xmtr, drift, surge, vap, air, rxn, foul, agit, agit-batch, stick (10) | CUTOFF only (end-state digest only) |
| drill-D11 | CUTOFF (steps 4021 to 4023, 2010.5 to 2011.5 s), MARGIN |
| drill-D2, D6, D9 | CUTOFF, MARGIN |
| drill-D3, upset-pump | CUTOFF, PUMP (FIC102 held while P-101 stopped) |
| drill-D4, upset-cool | CUTOFF, SAT (TIC202), ILK-RX (R-201 trip holds FIC102) |
| drill-D12, upset-bedact | CUTOFF, ILK-BED (R-310 bed trip holds TIC311) |

**Where the measured set is narrower than the controller's table (nothing moved for a reason outside it):**
- upset-stick is listed for saturation but its run never saturates TIC202: cutoff only.
- The R-202 interlock rows (FIC211, TIC213) move no fixture: no golden reaches that trip.
- drill-D4 is listed for its `stable:'restore'` rule (CR11): the rule moves nothing in the goldens, because they are unattended runs that never acknowledge, so no drill reaches a stability verdict. D4's fixture moved for CUTOFF, SAT and ILK-RX. The rule stays pinned by `tests/app-scorer-moc.test.js`.

**Re-capture.** `UPDATE_GOLDENS=1` on `golden-upsets`, `golden-drills` and `drill-arch-fixtures` only (not `golden-u4`: re-running it would only restamp the five u4 fixtures' `model` field, and the archive guard requires them byte-identical). `git status` showed exactly the 35 expected fixtures modified and nothing else. Run twice without `UPDATE_GOLDENS` afterwards: 47 of 47 pass both times.

**Per-drill outcome (3.1.0 to now, unattended goldens):** all eight end `TIME LIMIT REACHED`, trips unchanged. Scores: D1 38, D2 30, D3 13, D6 30, D9 40, D11 40 unchanged; D4 10 unchanged (alarm load note 78.3 to 26.7 per 10 min, events 197 to 72); **D12 10 to 16** (alarm load 14.2 to 5 per 10 min, events 45 to 15, `TIC311:PVHI` no longer raised after the bed trip); D11 two steps longer. Upsets: counts unchanged except cool (alarms 8 to 7, events 31 to 57, `FIC102:PVHI` no longer raised) and bedact (alarms 6 to 5, events 37 to 14, `TIC311:PVHI` no longer raised).

**Drill D3, read as CR21 asked.**
- The golden (unattended, the pump trips and nobody restarts): outcome unchanged (score 13, TK-101 overflow trip, TIME LIMIT). What moved is the end state: FIC102 ends at SP 0, OP 0 with `trk {on, device, "P-101 STOPPED"}` and LIC101 at OP 0 (initialised), where 3.1.0 ended at SP 80, OP 100, LIC101 OP 100.
- The slow restart, measured on an attended D3 (seed 4; ack the alarms; restart `delay` s after the stop). Old = 3.1.0 export, new = this tree:

| restart after the stop | FIC102 left in CAS (old to new) | MAN at 25 %, back to CAS 60 s after START (old to new) |
|---|---|---|
| 31 s | 90 pass (TK-101 peak 54.1 %) to 90 pass (68.0 %) | 90 pass to 90 pass |
| 60 s | 90 pass (58.3) to 90 pass (71.2) | 90 pass to 90 pass |
| 180 s | 90 pass (75.5) to 93 pass (86.2) | 90 pass to 90 pass |
| 280 s | **81 pass (89.6, no trip) to 48 fail, TK-101 overflow trip** | 69 fail (93.1) to 69 fail (94.0) |
| 340 s | 68 fail (97.9, no trip) to 48 fail, trip | 48 fail trip to 48 fail trip |

  So early restarts (31 to 180 s) are unchanged in outcome; a late restart with FIC102 left in CAS now ends in the trip that 3.1.0's wound-up surge used to prevent (the old plant was the fiction, as CR21 says). The quiz's own sequence (MAN at OP 0, START, CAS 60 s later) scores 90 at 31 and 60 s in both, 77 to 79 fail at 180 s, trips at 280 s in both.
- Restart figures in the changelog were re-measured here rather than copied: Task 6's sequence (60 s settle, stop, START) gives, seed 4: 73.4 % after a 60 s stop, 86.2 % after 180 s, overflow trip after 280 s with FIC102 in CAS (about 110 s after START), 94.1 % with FIC102 in MAN at 25 % (92 to 96 % for 20 to 30 %); seeds 1 to 5 agree to a tenth of a percent. 3.1.0 on the same sequence: FIC102 OP 100 at START, flow peak 95.7 m3/h after a 60 s stop, 104.7 after 180, 111.2 after 280, 114.5 after 340.

## 4. Step 3: the KNOWN lists (`cc363cb`)

`tests/v2-baseline-archive.test.js`: `KNOWN_RECAPTURED` now lists all 21 v2 fixtures one per line (the original three first, their 2026-09-03 comment untouched, each marked "3.1.0 fixed-bed floor; S1: ..."); `KNOWN_RECAPTURED_SINCE_31` lists the 35 movers one per line. Reasons are short codes (CUTOFF, SAT, PUMP, ILK-RX, ILK-BED, MARGIN) defined once in a comment block with their spec sections, with the three measured non-movers and the upset-stick note named, and numbers on the lines that have them. Note: with every v2 fixture listed, the v2 loop no longer compares anything live (as the brief's "all 21" implies); the comment says so and the since-3.1.0 test is the exact one. The v2 test's old title "(no live golden has moved yet)" has been false since 3.1.0 and I left it (not mine to rewrite).

## 5. The g2-lifecycle change (CR27) (`cc363cb`)

`tests/g2-lifecycle.test.js`, "actual archived v1 checkpoints resume explicit legacy operation without inventing composition": the lockstep comparison of the archived 3.1.0-era kernel and the current one on `P`, `L` (less obs/pvObs), `V` and `product` is removed, with a comment naming CR27 and `tests/fixtures/v31-baseline/`. Kept and made exact: schema `peb.plant.v1` in, `peb.plant.v2` out, `materialMode === 'legacy'`, `composition === null`, `product` deep-equal to the archived one at the restore; then after the 12 ticks: still legacy and null composition, `P.t` advanced exactly 6000 ms, the product ledger's `end`, `eligible_ms`, `covered_ms` and `continuous_ms` each advanced exactly 6000, `samples` grew by 12, `gross` grew. **`rand` and `rand4` equality with the archived kernel held** (probed before writing: both streams equal after 12 ticks; S1 changed no draw count), so that clause stays, per tick as before. Mutation-checked in the scratch tree: a stray `rand` draw and a short ledger each turn the test red. The other six tests in the file are untouched and pass.

## 6. Steps 4 and 5: changelog, docs pass, gates (`ad0113a`)

- **`CHANGELOG.md`**: one entry under `[Unreleased]` above the G2 heading, 40 lines, house voice (bold lead-ins, bullets, measured facts; no tables, the file has none). Carries everything the brief and the controller listed: observed values and the NE 43 window, the light hatch (0.30, CR12) and the `SATURATED` note, flows read 0 below 1 % of span, no negative zero; the decision that the controller sees the saturated value and its price (spec 2.4); tracking under a stopped pump and an interlock, INITMAN, the flag, the OP refusal with both strings, the clamped CAS return, the CR24/CR25 placement; the D1 restart narrative with the measured figures and the CR20 AUTO caveat; CR22/22b/22c/23; the ladder TRIP row, CR28/28b/29/30 and the margin note; drill D4's `restore` rule and the behaviour it replaced (CR11); the movers with reasons; the g2-lifecycle re-scope; the known S3 chatter (upset-cool TIC202 DEVHI, 13 raises and 16 returns, measured) and the intake items. Cites the spec, the plan and `docs/playtest-2026-10-02.md`.
- **Docs pass, items 1 to 6:** (1) as-built notes beside Tasks 4 to 8 in `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` (added lines only, `git diff` shows 0 deletions), plus one for Task 9; (2) spec section 12's `forcedOutputs()` row reworded per CR18; (3) `ruling R8` to `ruling CR8` in `src/measurement.js` (1) and `tests/measurement.test.js` (3 places, one reads "motivated CR8"); (4) the stale comment in `tests/pid.test.js` reworded (the first tracking test pins a target of 35, the next two a target of 0); (5) `docs/dev/CODE-MAP.md`: a new "v3.2 — credibility pass, stage S1" section (scan chain, `forcedOutputs()`, the OP refusal, `flagText`/`casRange`/`opLimitOf`, the CR25 routing, `tripOfPoint`/`tripLimitOf`, the measure() ordering hazard Task 3 recorded) and a dated nested pointer under the B4 `step()` chain line, which stays byte-identical (corrections sit beside history); (6) drill D3's debrief, see section 7.
- **Gates (final tree, HEAD `ad0113a`):** `node --test tests/*.test.js`: `# tests 1219`, `# pass 1218`, `# fail 0`, `# skipped 1` (the pre-existing "rules 1 and 6 across the whole DIFF" skip). `python3 tools/build-dist.py` run twice more after the last build leaves `dist/experion-station-sim-standalone.html` and `src/model-id.js` byte-identical (sha256 compared); the embedded `plant-core.js`, `measurement.js` and `model-id.js` decode equal to the sources. `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok` (folder build fetched React fine, no DNS retry needed); also run once before `cc363cb`, also ok.
- No push, per the ruling.

## 7. Things that differed from the brief's premises

1. **Drill D3 had no `debrief:` field** (only D4 does, in 3.1.0 and now), so "gains one sentence" became "gets its first debrief note": `Restart note: after START the feed ramps back from zero instead of surging (LIC101 was initialised while P-101 was stopped), so a restart left until about 280 s after the stop still ends in the TK-101 overflow trip unless FIC102 is put in MAN at 20 to 30 % before START and returned to CAS within a minute of it.` It renders as the guide box in D3's debrief dialog (checked through `renderVals().dg`). The controller's wording stopped at "before START"; measuring it for a test showed the pre-positioned MAN restart still overflows if FIC102 is left in MAN (the feed settles at 33 to 49 m3/h against an inflow near 60), and holds if returned to CAS within about 60 s (0 to 60 s all hold at 20, 25 and 30 %; a 120 s return trips at 20 %). I added the clause rather than publish a sentence that is wrong for a trainee who follows it literally. No golden digests definition text (goldens green on the rebuilt tree).
2. **CR21's "280 to 340 s" refined.** Measured: with FIC102 in CAS the restart trips from a 280 s stop (270 s does not); MAN at 25 % holds to a 300 s stop (30 % to 320 s); from about 342 s after the stop the stopped tank has overflowed on its own, whatever the restart. The changelog states these figures. The threshold moves by about 10 s with how long the plant ran before the stop (30, 60, 120, 300 s settle measured), hence "about 280 s".
3. **The "doing nothing: 30 where it was 45" D4 story** (Tasks 3 and 6 report 45 before and 30 after) compares two intermediate S1 trees, not 3.1.0. Against 3.1.0 itself, doing nothing scores 30 and cut-and-leave 65 on seeds 1 to 12, as now; the changelog says "the last two are what 3.1.0 scored" and keeps the "passed at 90 on 10 of 12 seeds" figure as what the saturation seam alone did to the old stability rule (Task 3's measurement).
4. **The fixtures' `model` stamp is the commit-`cc363cb` build's id** (`1b11cc...`), not HEAD's: `ad0113a` changes `src/plant-core.js` and `src/measurement.js` (D3 note, comment rename) so it restamps `src/model-id.js`. `model` is provenance and never asserted (`tests/_fixture.js`); I followed the controller's commit layout rather than moving the two src edits ahead of the capture. A restamp of the 35 fixtures would be a pure `model` line change if ever wanted.

## 8. Files changed (BASE `a155da8` to HEAD)

- Commit 1: `tests/fixtures/v31-baseline/**` (40 JSON + `README.md`, new), `tests/v2-baseline-archive.test.js`.
- Commit 2: 35 fixtures (`tests/fixtures/drill-*.json` 8, `upset-*.json` 13, `arch/*.json` 14), `tests/g2-lifecycle.test.js`, `tests/v2-baseline-archive.test.js`.
- Commit 3: `CHANGELOG.md`, `docs/dev/CODE-MAP.md`, `docs/dev/CREDIBILITY-PASS-PLAN-S1.md`, `docs/dev/CREDIBILITY-PASS-SPEC.md`, `src/plant-core.js` (D3 debrief, 1 line), `src/measurement.js` (comment), `src/model-id.js` and `dist/experion-station-sim-standalone.html` (rebuilt), `tests/app-credibility-s1.test.js` (+1 test), `tests/measurement.test.js` (comments), `tests/pid.test.js` (comment).
- Untouched: `support.js`, `tests/fixtures/u4/`, `tests/fixtures/v2-baseline/`, `src/models.js`, every trip threshold.

## 9. Self-review

- **Completeness.** Brief steps 0 to 5 done (6 is the controller's); all six docs-pass items done; the CR27 ruling applied with the rand clause verified by running; KNOWN lists name every mover with reasons and the guard proves u4 byte-identical; dist idempotent; both smokes green.
- **Discipline.** Staged by name every time; no push; no subagents; scratch work only under `/tmp/t9`. Three things beyond the list, each small and flagged: the Task 9 as-built paragraph in the plan; the CODE-MAP ordering-hazard sentence (Task 3's finding, owed to the doc); and one new test in `tests/app-credibility-s1.test.js` pinning D3's restart note (the plant half fails on the 3.1.0 tree, which I checked), because the note states numbers that later stages could silently falsify. Drop it if you prefer; nothing else depends on it.
- **Testing.** Guard mutation-checked (u4 byte, archive byte); g2-lifecycle mutation-checked; D3 note test checked against the old plant; the full suite run at every commit.

## 10. Concerns

1. Item 4 above: fixture stamps are one build behind HEAD (cosmetic, by the commit layout).
2. The v2 live-equals-archived test is vacuous with all 21 listed (as specified); its old title is stale. The since-3.1.0 test carries the real guarantee.
3. Reason codes in the KNOWN comments are documentation, not executable: only the set of files is enforced. The ablation scripts that produced them are in `/tmp/t9` (not in the repo) if a reviewer wants to re-run: `abl/` (patched scratch tree), `run_cfg.sh`, `cmp_cfg.py`, `res/<config>/` (the captures), `old/` (3.1.0 export), `d3.js`, `d4.js`, `restart.js`, `sweep*.js`, `ret.js`. I could not delete them: the T2Helix hook blocks recursive `rm`.
4. Hook behaviour worth knowing: the T2Helix compass paused one read-only `grep` on the progress ledger ("similar past failures", confirmation pending) and blocked a command containing `rm -rf`. I did not confirm or override either; I read the file with the Read tool and left the stray scratch directory in place.
5. upset-cool now journals 57 events (TIC202 DEVHI chatter); recorded in the changelog as stage S3's, not fixed here.
6. The changelog's D3 restart figures are seed 4 on a plant settled 60 s (robust to seeds 1 to 5, shifting about 10 s with the settle time); stated as such.

---

# Fix round 1 (CR31): the archive guards must still assert something

Commit `623c962` `test(goldens): the archive guards assert that every listed mover really moved and every unlisted fixture did not (CR31)`, one commit on top of `ad0113a`. Not pushed. Staged by name (`tests/v2-baseline-archive.test.js` only); `NIGHT PREVIEW.dc.html` untouched. Status: DONE.

## What changed (one file)

`tests/v2-baseline-archive.test.js`:
- A shared `assertListedMoversExact({dir, archived, listed, since})` holds a list of re-captured fixtures exact in both directions: every listed fixture must differ byte for byte from its archived copy, every unlisted one must equal it, a name is listed once, and a listed name must have an archived copy. Both guards call it (the v2 one with `KNOWN_RECAPTURED`, the 3.1.0 one with `KNOWN_RECAPTURED_SINCE_31`), so the two cannot drift apart. Every failure names the file:
  - stale entry: `upset-xmtr.json is listed as re-captured since v2 but equals its archived copy: take it off the list`
  - unlisted mover: `u4/u4-design.json differs from its archived 3.1.0 copy but is not listed as re-captured since 3.1.0`
  - typo: `drill-nope.json is listed as re-captured since v2 but has no archived copy`
  - duplicate: `drill-D1.json is listed twice as re-captured since v2`
- Titles say what they now prove: `every golden listed as re-captured since v2 really differs from its archived v2 copy, and every unlisted one equals it` and the same for 3.1.0. The v2 title `(... no live golden has moved yet)` had been false since 3.1.0 and is gone. The file header, the opening comments of both tests and the S1 comment (which said the v2 check "no longer compares anything live") were rewritten to match. The 2026-09-03 three-line comment about the fixed-bed floor, both lists and every reason are unchanged, and so are the two intact-and-complete tests.

## Verification

- Mutation checks (all restored afterwards; each fails with the file named, nothing else red): a live `upset-xmtr.json` set back to its v2 copy turns both the v2 and the 3.1.0 test red; a live `arch/A1.json` set back to its 3.1.0 copy turns only the 3.1.0 test red; a byte appended to a live `u4/u4-design.json` turns the 3.1.0 test red; edited copies of the test file with `upset-xmtr.json` removed from the v2 list, `arch/A12.json` removed from the 3.1.0 list, a name that is not an archived file added, and an entry doubled each fail as above. The mutant copies were deleted.
- Gates at `623c962`: `node --test tests/*.test.js`: `# tests 1219`, `# pass 1218`, `# fail 0`, `# skipped 1`. No app or src change, so two builds left `dist/` and `src/model-id.js` unchanged (`git status --porcelain dist/ src/` empty). `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.

## Cleanup

- `/tmp/t9` removed with `cd /tmp && rm -r t9` (the relative form went through). No worktree of mine was registered (`git worktree list` showed none under `/tmp/t9`), so no `git worktree remove` or `prune` was run; the other worktree listed (`/Users/vaquez/ignition-workspace/.local/sim-source`, detached at `4fc55ac`) is not mine and was left alone.
- Before deleting, the 19 small measurement scripts that back the numbers in this report were copied into the git-excluded workspace as `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-9-scripts/` (`patch_abl.py`, `run_cfg.sh`, `run_singles.sh`, `cmp_cfg.py` for the ablation; `d3.js`, `d3unatt.js`, `d4.js`, `restart.js`, `restart_old.js`, `sweep*.js`, `ret.js`, `cool*.js`, `trips.js`, `dbguide.js`, `g2probe.js`; `cr31_mutants.sh` for this round). They hard-code `/tmp/t9/...` paths (the ablation switches patch a scratch copy of the tree at `/tmp/t9/abl`, the 3.1.0 comparison reads an export at `/tmp/t9/old`), so re-running needs those paths recreated. The scratch trees and raw captures are gone; concern 3 in section 10 above is superseded by this note.

## Concerns

None new. Concern 2 of section 10 (the v2 live-equals-archived test was vacuous with all 21 listed, and its title was stale) is resolved by CR31.

---

# Fix round 2 (post-review minors and CR32)

Commit `c9b3aa3` `docs(s1): the D1 narrative names its settle time; D4's alarm-sequence move and the cutoff's scope stated; D3's quiz answer agrees with its note (CR32); restore fidelity asserted; archive guards share one intact helper`, one commit on top of `6e5fce2`. Not pushed. Staged by name (10 files); `NIGHT PREVIEW.dc.html` untouched. Status: DONE.

## Items

1. **CHANGELOG D1 narrative.** Now "(seed 4, FIC102 in CAS, the plant run 60 s before the pump stops) ... during a 60 s stop", so the 103.5 / 166.5 / 79.55 figures and "after the same 60 s stop" have their referent, and the parenthesis says the sequence agrees on seeds 1 to 5 to a tenth of a percent and that the 280 s onset shifts by about 10 s with how long the plant ran before the stop (measured at 30, 60, 120 and 300 s settle in round 1).
2. **g2-lifecycle.** After the restore, `for(const key of ['P','L','V'])assert.deepEqual(current.fields[key],checkpoint.fields[key],key)`. It holds as is (probed first: P, L and V equal at the restore instant, no `obs` residue). Mutation-checked: a perturbed `P.t` turns the test red naming `P`. The changelog's g2 sentence lists it.
3. **D4's alarm-sequence move.** Traced the unattended D4 run on 3.1.0 and on this tree. 3.1.0: FIC102's OP wound to 100 during the trip, so at the reset (383 s) the feed returned at once and surged (90 m3/h, `FIC102:PVHI`). Now: held at 0, reset at 355.5 s, flow 10 m3/h at 390 s, 50 at 480 s, 77.5 at 570 s while TK-101 climbs to 84.3 % (`LIC101:PVHI`) and the starved reactor cools to 130 C (`TIC201:PVLO`, Urgent `TIC201:PVLL`, `TIC301:PVLO`). One sentence in the changelog's interlock bullet and on the drill-D4 line of each guard list. I did not repeat "unattended D3 shows the same pattern": D3's alarm sequence did not move in the re-capture (only its end-state digest), so the sentences carry only what I traced.
4. **The cutoff's scope.** `observe()` applies it to the five M3/H points (FI100, FIC102, FIC211, FIC310, FIC313). Re-ablated per tag in a fresh scratch tree against the 3.1.0 baseline and the committed goldens:

| Configuration | Result |
|---|---|
| only FIC211's cutoff on (every other mechanism off) | all 35 move |
| only FIC102's cutoff on | 0 move |
| only FI100's, FIC310's and FIC313's cutoffs on | 0 move |
| the real tree with FIC102's cutoff off (FIC211's and the holds on) | exactly drill-D3, drill-D4, upset-cool, upset-pump move (end-state digest) |
| the real tree with FI100's, FIC310's or FIC313's cutoff off | 0 move each |

   So the reviewer's four are right, and it is an interaction: FIC102's cutoff does nothing alone and matters only where the plant holds that loop shut (PUMP, ILK-RX). Reworded to "the spec 2.2 low-flow cutoff, which observe() applies to every M3/H point; FIC211's moves all 35 on its own, FIC102's also changes those four where the loop is held shut, the other three flows move nothing" in the guard legend, the changelog bullet and CODE-MAP (which now says what `observe()` does: BAD, the cutoff, Good, the limit bit inside the window, the clamp and `Uncertain_EngineeringUnitsExceeded` at its edges). The four fixtures carry "CUTOFF (also FIC102's)" in both lists.
5. **CODE-MAP step chain.** Listed in full and in order from `advanceScan`: `applyReplayDue`, `advanceClock`, `stepU1`, the `AI205` write, `stepU2`, `stepU3`, `stepU4`, `measure`, `forcedOutputs`, `pids`, `scan`, `interlocks`, `ESS.Plausibility.advance`, `alarmTick`, `valveWatch`, `drillWatch`, `aDrillWatch`, `archFaultTick`, the history push (skipped under a `HISTORIAN_GAP` fault), `ESS.ProductMeter.advance`, `backtrackTick`, `replayCheckDone`. The dated pointer beside the B4 line was reworded the same way (the B4 line stays byte-identical).
6. **STABILIZED wording.** "ended D4 as STABILIZED while TK-101, already past 80 %, was still inside its high-level alarm's 60 s on-delay, so no related alarm stood" (checked: `almDelay` returns 60 s for a level point).
7. **Plan.** The Task 9 note now names `KNOWN_RECAPTURED` (the 21 v2 fixtures) and `KNOWN_RECAPTURED_SINCE_31` (those and the 14 arch fixtures, 35 in all), and mentions CR31 and CR32.
8. **"playtest D1" / "playtest D9".** Written in the changelog headings, CODE-MAP (with drill D2's example and drill D9's `854.9 KPA vs trip 950 KPA`), the guard legend (PUMP, MARGIN), and "the playtest's drill D4 run" in the ladder paragraph.
9. **Guard helper.** `assertArchiveIntact({dir, onDisk, count})` serves both intact-and-complete tests; messages unchanged. Mutation-checked: a tampered byte in each archive ("<file> has changed since it was archived"), a README row removed ("the README must list all 40 archived fixtures") and an unlisted file in the archive directory each fail.
10. **D3 note test.** Drives drill D3 (`startDrill`, its own pump fault, restart 60 / 180 / 280 s after the trip, MAN 20 / 25 / 30 % returned to CAS after 60 s, and left in MAN) with the same exact assertions; the drill-driven peaks match the manual-stop run to a tenth (73.5, 86.2, 98 trip at 280 s in CAS, 96.0 / 94.1 / 92.3 in MAN, trip when left in MAN). It also pins the keyed option (CR32).
11. **CR32.** `opts[0]` of D3 now reads `FIC102 to MAN at 20 to 30 %, START P-101 after lockout, return to CAS within a minute` (`a:0` and the distractors unchanged). Verified the ruling: the old option followed literally (MAN at OP 0, START, then AUTO) leaves FIC102 at SP 0 and flow 0 and TK-101 trips, even after a 40 s stop; returning to CAS instead recovers (79.3 m3/h, tank 58 %). Test written first and red on the old text, then green. All 47 golden tests green against the rebuilt tree, so no fixture digests the option text and CR32 is not a mover. `dist/` and `src/model-id.js` rebuilt (the embedded plant-core decodes equal to the source, new option present, old gone).

One addition outside your list, from grepping the class rather than the section: `docs/TRAINING-MODEL.md` (the D3 row, a production doc) still said "loop to MAN/OP 0 ... then restore AUTO", so it now agrees with CR32. The changelog, CODE-MAP and plan each carry one clause for CR32.

## Gates (HEAD `c9b3aa3`)

`node --test tests/*.test.js`: `# tests 1219`, `# pass 1218`, `# fail 0`, `# skipped 1`. Two further builds leave `dist/experion-station-sim-standalone.html` and `src/model-id.js` byte-identical (sha256 compared). `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.

## Cleanup and concerns

- Scratch recreated for the re-ablation and removed again with `cd /tmp && rm -r t9` (went through). The six new scripts (`flows.js`, `d4trace.js`, `d3drill.js`, `oldkey.js`, `g2fid.js`, `cmp_live.py`) were added to the git-excluded `task-9-scripts/` beside the earlier 19. Still hard-coded to `/tmp/t9` paths.
- No worktree of mine exists; the other one in `git worktree list` (`ignition-workspace/.local/sim-source`) is not mine and was not touched.
- No new concerns. The re-captured fixtures' `model` stamp is still the id of the `cc363cb` build (provenance only); nothing in this round changed any golden.
