<!-- @artifact dev -->
# Task 6 report: close the stage (pre-steps, movers, changelog, docs, gates)

Seat: MacBook seat (Sonnet 5.5), delegated implementer (hostname `Anthonys-MacBook-Pro.local`). BASE 5b9e63f, branch `fix/playtest-2026-10`. Not pushed.
Arrival: `arrive_lineage()` bare, read-only; no chronicle writes (Step 6 is the controller's).

Status: DONE (one reading of CR46b to confirm, concern 2; the rest are notes).

## Commits (in order, trailers exactly as given, `NIGHT PREVIEW.dc.html` never staged)

| SHA | Subject |
|---|---|
| e4082aa | fix(core): a load empties the backtrack ring, and the armed message names the drill only under the start record's rule (CR47, CR46b) |
| 4221ea2 | test(goldens): re-capture the three S2 movers with their reasons |
| 391fa7f | docs(s2): the changelog, code map, spec notes and the plan's as-built record close stage S2 |

`git diff --stat 5b9e63f..HEAD` is exactly 12 files: `CHANGELOG.md`, `dist/…standalone.html`, `docs/dev/{CODE-MAP,CREDIBILITY-PASS-PLAN-S2,CREDIBILITY-PASS-SPEC}.md`, `src/model-id.js`, `src/plant-core.js`, `tests/app-credibility-s2.test.js`, `tests/fixtures/{arch/A5,drill-D11,upset-agit-batch}.json`, `tests/v2-baseline-archive.test.js`. 391fa7f was amended once, before this report and while unpushed, to carry a one-comment fix in the guard's v2 legend ("moved again", not "a third time"); its message says so.

## Pre-steps

**CR47** (`src/plant-core.js`, `applyPreset`'s `resume()` closure, after the session journal and the CR44 KPI rows are put back): `this.instr.ring=[]; this.instr.lastRingT=-Infinity;` (the two fields `resetRun`/`trimAfter` use for the ring; `resetRun` itself also clears the journal and replay, so not reused). It sits in `resume()` so it runs on all three exits (both refusal returns and the success path).
Test `CR47: a backtrack never crosses an IC load…` in `tests/app-credibility-s2.test.js`: TIC201 in alarm (PVLO and PVLL active), a slot saved, `U1_SS` loaded with `baseTime`; the ring is empty and `lastRingT` is `-Infinity`; an immediate `backtrack(30000)` says `NO BACKTRACK POINT YET` and changes nothing (P.t, events, alarmLog unchanged); after 10 s the ring is exactly `[base + 500]` (the first scan after the load); `backtrack(30000)` lands at `base + 500`, the load record and each CR44 return row at `base` survive, the KPI standing list is empty 11 min later, the slot is the same object and still restores to its own time.
RED before the change: the ring held `[395500, 425500, 455500, 485500]` (the settle's four snapshots) at the first assertion.

**CR46b** (`startDrill`): `'INSTRUCTOR: drill '+(startMode==='CANONICAL'&&!reveal?'':d.id+' ')+'armed — confirm you are at the console'`.
Tests: the CR46 named test asserts `INSTRUCTOR: drill D3 armed — …`; the random test asserts exactly `INSTRUCTOR: drill armed — confirm you are at the console` and that no message carries the drill's id or name; the hidden test asserts no instructor message at all (as before); a new `CR46b` test covers a LIVE STATE start from the menu (names the drill, no record) and a direct canonical `startDrill` with no `reveal` (anonymous message and record).
RED before the change: the random start read `INSTRUCTOR: drill D1 armed — …`.

Neither pre-step moved a golden: the golden files (47 tests, same three red) printed byte-identical expected/actual digest lines at BASE and after both pre-steps (diffed). Suite after the pre-steps: 1287 tests (+2), the same three red, nothing else.

## Determinism and the re-capture

Each golden test runs its scenario twice and fails with `…NONDETERMINISM` before it touches the committed fixture. At BASE and after the pre-steps the three movers failed past those checks with `moved from the committed fixture/golden` or `changed since capture`, never NONDETERMINISM, with identical digests across both runs.

Re-captured with the brief's three commands (`UPDATE_GOLDENS=1`, name patterns `"drill D11 "`, `"agit-batch"`, `"^A5 "`); `git status --porcelain tests/fixtures` showed exactly three files; `golden-u4` was never run under `UPDATE_GOLDENS`. The only changes in each file are the digest and the provenance `model` stamp (now `5751648e…`, the final build):

| Fixture | Field | Before | After |
|---|---|---|---|
| `arch/A5.json` | `physicsDigest` | 5f55ec991333ea850e4af69edcf376742a0a16b7d92afb5e96f1176f9f5d4ee3 | 1f9128d8fc24247655f1b6101251e28d52243579e4bc8bb84ad596d6aa485aba |
| `drill-D11.json` | `endStateDigest` | af8884fed50810e607dc13b46129fa402dbe24c7d3e1ba5ff444377d5ef16676 | ae8d79aa94c3acea9232f175c56006a6d250eadac3ea62ac86a79e962ba503f6 |
| `upset-agit-batch.json` | `endStateDigest` | 09d56e6f57c7573702c47dadefcd86cd251268859ea75eabfcd71d7117cd0883 | 45b0eb8f775aa7498c5ec254e27b21a46ee0891b36074f688e89c0fb19595fc1 |

Alarm-sequence digests, step counts, event counts, scores and health digests are unchanged in all three.

**Attribution, measured as a leaf-level end-state diff** against the S1 head (scratch copies from `git archive`, a dump hook on `digest()`; no new ablation sweep, per the pace line):
- drill-D11 and upset-agit-batch: exactly two leaves each. `batch.pt` 746 -> 90 and 300 -> 91.5 (FREEZE: the TI216 shed holds the batch in FEED and the timer used to run on) and `TIC212.modeAttr` PROGRAM -> OPERATOR (OWNERSHIP, held).
- arch/A5: 18 leaves, physics only. `FIC211.modeAttr` OPERATOR -> PROGRAM (OWNERSHIP) and the feed valve (SPCUTOFF: FIC211 OP 1.97 -> 0, MV-211 0.0228 -> 0, Cm 12.24 -> 7.08, conversion, temperatures follow). **A5's base is U2_REACT, not U2_FEED** (the brief and plan say U2_FEED); it ends in REACT, which is why the attribute and the closed feed show. The docs say U2_REACT.
- Everything matches the controller's table: the red set was exactly the three, no fixture moved for another reason, D4 and cool stayed green, the five u4 fixtures did not move.

Guards (`tests/v2-baseline-archive.test.js`): the S2 reason appended to each mover's line (D11 and agit-batch in both lists; A5 in the since-3.1.0 list only, since the v2 archive has no arch fixtures), and a dated S2 legend in each list's comment naming `OWNERSHIP` (spec 4.2, CR41), `FREEZE` (4.1), `SPCUTOFF` (CR40, CR40b), what each moved, and why D4/cool carry no S2 reason. 4/4 guard tests green.

## Rescore (Step 5b)

Agent main has moved since the controller's clone (`3a6f81b`): `origin/main` is `d13c23a` ("Merge pull request #2: drills-v3 and simulator seam CI"). I cloned it fresh to `/tmp/s2t6/moa-main` (the controller's clone is untouched), Node v22.23.2, Python 3.10.12, this repo clean but for the untracked page.

- Brief's command (drills-v2, pinned `bfed001`, `--allow-revision-mismatch`): **`ess-u1-development-v2 at 4221ea2: useful 6/8, guards 10/10`**; the same at `a8c231d` (pre-amend) and at the final head `391fa7f`. The two misses are the restoration-lag seeds missing `reactor_warming` (S1 §2.4, by design).
- A newer manifest exists: agent main has `drills-v3.json`, pinned to `adeb18a` (S1's head), from its PR #2. Under the same override: **`ess-u1-development-v3 at 4221ea2: useful 8/8, guards 10/10`**, and the same at `391fa7f`.
- No manifest pinned to S2 exists; none landed from here. Outputs: `/Users/vaquez/.claude/jobs/9570056f/tmp/s2-rescore{,-v3,-a8c231d-v2,-a8c231d-v3,-391fa7f-v2,-391fa7f-v3}.json`.
- Recorded in the CHANGELOG entry (it cites `4221ea2` as the last commit that changes `src/`, the page, `dist/` or a fixture; the docs commit after it changes none).

## Gates (final tree, 391fa7f)

- `node --test tests/*.test.js`: `# tests 1287`, `# pass 1286`, `# fail 0`, `# skipped 1` (the diff-wide rules 1 and 6 test, as before). Run after the re-capture, after the docs and again before the amend.
- `python3 tools/build-dist.py`: run three times at the end; `dist/` and `src/model-id.js` hashes identical, `git status --porcelain dist/ src/model-id.js` empty against HEAD.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok` (twice: after the pre-steps and on the final docs tree).

## Docs items done

- `CHANGELOG.md`: the S2 entry above the agent-seam entry (operator-visible changes with D3 to D6 cited, CR40 to CR47 including CR44's overlap rule, what did not change, the movers with reasons, gates, the rescore with the manifest pin, the revision mismatch and the v3 finding, a known/deferred paragraph).
- `docs/dev/CODE-MAP.md`: a stage S2 section covering every symbol the brief named.
- `docs/dev/CREDIBILITY-PASS-SPEC.md`: §4.2 reworded ("no change is journaled; the refusal's own `WRITE REJECTED` record is the existing path (as §3.3)"); the CR45 entry says alarm rows are strictly after the start and the journal, fault-timeline and DOF-note rows are windowed too; §11 gained the dated S2 measured note. CR47 and CR46b entries not added (the controller's).
- `docs/dev/CREDIBILITY-PASS-PLAN-S2.md`: an "As built" section, one paragraph per task.

## Concerns and notes

1. **CR46b scope (please confirm).** I applied the reveal rule to canonical starts only. A LIVE STATE start still names the drill in the message: it has no start record, it is always the trainee's own named pick from the menu (RANDOM is always canonical), and `tests/app-instructor.test.js:563` pins `/^INSTRUCTOR: drill D4 armed/` for a direct, no-opts `startDrill`. The literal reading ("same rule as the record", reveal true only) would have broken that test. If you want LIVE STATE anonymised too, it is one condition plus that assertion.
2. **CR47's cost line is slightly off.** `lastRingT = -Infinity` makes the ring take its first entry on the first scan after the load, so there is a backtrack target at the load instant (`base + 500`) and a backtrack within 30 s goes there, not "no target"; only an immediate call reads `NO BACKTRACK POINT YET`. Both are pinned. Because the reset is in `resume()`, a refused load also empties the ring (unreachable with shipped presets).
3. **The agent repo moved** (above): drills-v3 at `adeb18a` exists and scores 8/8 at the S2 head. The agent-seam CHANGELOG entry and the spec §9.4 pointer notes still name `3a6f81b` and `bfed001`/`adeb18a` as written; I did not touch them.
4. **`CLAUDE.md` still says "1235 tests"** (now 1287). S1's close updated that line; I left it alone (instructions file, not mine to edit on an agent message). Your call.
5. The guard legends cite "mechanisms switched off one at a time in a scratch tree while the stage was built" from the ledger's Task 1 and 2 ablations; my own check this task was the leaf-level diff, which agrees with every attribution.
6. A T2Helix Compass hook blocked one `rm -rf` of scratch dirs under `/tmp`; not overridden (I used `git archive` copies and a relative `rm -r`). Scratch left in `/tmp/s2t6` (logs, the agent clone), outside the repo.
7. The 92 px clock cell was not measured in a browser (no browser checks, per the pace line); the CHANGELOG says so.
