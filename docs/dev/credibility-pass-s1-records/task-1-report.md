<!-- @artifact dev -->
# Task 1 report: range policy in the measurement module (D7 policy, D14 cutoff)

Status: DONE_WITH_CONCERNS (all gates green; the concerns are findings for the controller, none blocks this task).
Commit: 0dcf16d feat(measurement): a declared NE 43 reporting window for every analog point, and a low-flow cutoff
Branch: fix/playtest-2026-10, committed, NOT pushed (controller pushes after review).
Seat: MacBook (hostname Anthonys-MacBook-Pro.local), Sonnet 5.5, implementer sub-agent; no sub-agents dispatched.

## What I implemented

1. `docs/RESOURCES.md`: new `### 7.49 NAMUR NE 43, failure-information signal levels for 4..20 mA transmitters`,
   in the house three-bullet format of 7.45 to 7.48 (Resource / Status / Proposed use), with the brief's text and
   numbers verbatim (3.8 mA to 20.5 mA, -1.25 % to +103.125 %, CITED-NOT-HELD, the NAMUR URL, "citation for the
   convention, not a claim of conformance"). One addition: the Resource bullet points at section 7.35, which already
   holds the issuer's edition metadata for the same recommendation.
2. `src/measurement.js`, exactly the brief's code: new header comment; `RANGE_POLICY` (frozen); `isAnalog`, `isFlow`;
   `rangeOf(point)` (null when no usable range; TIC202 keeps answering from its shipped constants when no range is
   declared); `observe()` now uses `rangeOf` for the clamp and applies the flow cutoff; exports
   `{ observe, rangeOf, RANGE_POLICY, TIC202, STATUS }`. I also updated the `observe()` doc comment ("Reads only the
   visible point's tag, kind, declared range, unit, PV, quality and optional OPC status") because it would otherwise
   have become untrue.
3. `tests/measurement.test.js`: the brief's replacement test plus its five new tests, verbatim, plus two small tests of mine
   (see below).
4. Rebuilt `dist/` and `src/model-id.js` with `python3 tools/build-dist.py`.

### Files changed that the brief did not list (needed to keep `# fail 0`)
- `docs/dev/CONVERGENCE-SPEC.md` (2 lines): "48 sources ... RESOURCES-7.1 through RESOURCES-7.48 (2026-09-27)" became
  "49 ... 7.49 (2026-10-03)" at both places. `tests/doc-consistency.test.js` derives the section 7 count from the
  `### 7.n` headings and fails on a stale range claim in this file. Commit 368c159 made the identical in-place update
  when it added 7.48. RED/GREEN evidence below.
- `docs/RESOURCES.md` section 7 preamble (same file the brief lists): "contains 48 sources" became 49, with 7.49
  named in the composition sentence.

## Tests

### Extra tests beyond the brief (2, both after the brief's block)
- `the policy fractions agree with the NE 43 current endpoints and the policy cannot be edited`: pins `RANGE_POLICY`
  lowFrac/highFrac to 3.8 mA / 20.5 mA (the analogue of the existing TIC202 constants test) and that it is frozen.
- `a missing, non-finite or frozen point never throws, never yields NaN and is never mutated`: covers the
  `Number.isFinite` branch of `isAnalog` (NaN, Infinity, undefined, string bounds), `rangeOf(null/undefined/{})`, a flow
  with no declared range (no cutoff, there is no span), and purity on a frozen analog point. Spec section 12 says the
  policy "never throws"; the brief's tests did not reach these branches.

### RED (measurement)
Command: `node --test tests/measurement.test.js`
Result: `# tests 17 / # pass 11 / # fail 6`. Failing: "every analog point reports through the declared NE 43
window" (actual `pv: 480.5, GOOD, NONE`, expected `103.125, UNCERTAIN, 0x40940600, HIGH`); "the generalised policy
reproduces the shipped TIC202 precedent" and "an empty or inverted declared range" and the two extra tests
(`TypeError: Measurement.rangeOf is not a function`); "flow points read 0 below the low-flow cutoff" (actual `pv: -0.1`,
expected `0`). Exactly the three failures the brief predicted. Expected because none of the policy existed.

### GREEN (measurement)
Command: `node --test tests/measurement.test.js`
Result: `# tests 17 / # pass 17 / # fail 0`. The untouched TIC202 precedent tests (1 to 6, 15 to 17) all pass.

### RED/GREEN (doc consistency; not in the brief, found by running the tests the controller named)
After adding 7.49 only: `node --test tests/doc-consistency.test.js tests/provenance.test.js` gave
`# tests 39 / # pass 38 / # fail 1`: `docs/dev/CONVERGENCE-SPEC.md ... claims 48 via id range "RESOURCES-7.1 ... RESOURCES-7.N"
(derived truth: 49)`, match "RESOURCES-7.1 through RESOURCES-7.48" (twice). After the three count edits:
`# tests 39 / # pass 39 / # fail 0`. `tests/provenance.test.js` was green throughout.

### Full gates (run on the tree that was committed)
- Baseline before any change: `node --test tests/*.test.js` gave 1132 tests, 1131 pass, 0 fail, 1 skipped.
- After: `python3 tools/build-dist.py` then `node --test tests/*.test.js`: 1139 tests, 1138 pass, 0 fail, 1 skipped
  (the +7 is exactly the new tests; the one skip is the pre-existing documented "SKIPPED: rules 1 and 6 across the
  whole DIFF"). Output pristine (no warnings or stderr).
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.
- Checked that `dist/` embeds the current `src/measurement.js` and `src/model-id.js` byte-for-byte, and that a second
  `build-dist.py` run changes nothing (idempotent).

## Self-review
- Completeness: every brief step done; Review Focus 1 (empty or inverted range, no NaN) and 2 (flow -2 on a 120 span
  gives -1.5 / UNCERTAIN / LOW) are pinned by tests.
- Float exactness checked by reasoning and by the tests: `-0.0125 * 100`, `* 120`, `* 200` round to exactly
  -1.25, -1.5, -2.5; `0.03125` is a power of two so the upper edges (103.125, 206.25) are exact; the real TIC202
  declares `lo:0, hi:100`, so the generalised path reproduces its precedent on the live point.
- Rules: no `Math.random`, DOM or timers; `src/` stays pure UMD; no vendor or employer material; `support.js` and
  `dist/` not hand-edited; staged by name, `NIGHT PREVIEW.dc.html` not committed.
- URL check (read-only, 2026-10-03): the brief's NAMUR URL returns HTTP 200 and the page lists
  "NE 043 Standardization of the Signal Level for the Failure Information of Digital Transmitters", WG 3.1, 2021-07-26.
  The 7.49 Status still says only CITED-NOT-HELD, as briefed; add a VERIFIED clause if you want it recorded.

## Concerns and findings for the controller (none blocks Task 1)

1. **Spec vs repo on NE 43 registration.** Spec section 2.2 says NE 43 "is not yet in docs/RESOURCES.md", but
   section 7.35 (registered 2026-09-26) already registers NAMUR NE 43 as CITED-NOT-HELD. I added 7.49 as briefed
   (later tasks cite RESOURCES-7.49) and cross-referenced 7.35. The registry now holds the same recommendation twice;
   consolidate later or leave as is.
2. **CHANGELOG.md line 102** (in `[Unreleased]`, the G2 paragraph) still reads "the registry now contains 48 sources."
   No test matches it (digits, not a spelled number), I did not touch it (Task 9 owns the changelog). It will read
   stale once 3.2.0 ships; Task 9 may annotate it beside the history.
3. **Early signal for Tasks 3 and 9 (evidence, not inference).** Throwaway probe in /tmp (nothing in the repo): after
   every step of the 12 golden upset keys (600 s) and the 3 U4 scenarios, I compared HEAD's `observe()` with the new
   one on every real point. In legacy mode `step()` itself never calls `observe()` (counted: 0 calls across all 15 runs), which
   is why no golden moved. Probe scripts: /tmp/task1-probe/compare2.js and count-calls.js. The outputs that now differ for UI/projection callers: (a) flows near zero read 0 (FIC211 at 0.017 in every
   run; FIC102, FI100, FIC310, FIC313 as they decay in pump/air/cool/rxn), which is the intended D14 cutoff; (b)
   analyzer points where the model slightly overshoots its declared range now read UNCERTAIN with limit HIGH/LOW, value
   unchanged: AI205 at 100.003 to 100.011 % (upset cool and rxn) and AI316 at -0.018 (upset bedact). (b) is the faithful
   generalisation of TIC202's semantics (flag beyond lo/hi, clamp to the reporting window), but spec section 11's mover
   table lists neither upset-rxn nor upset-bedact. If Task 3 writes the quality fields from `observe()` for every analog
   point, tiny numerical overshoots could surface as UNCERTAIN diagnosis rows or unlisted movers. Worth deciding before
   Task 3 whether analyzers should be flagged for overshoots of 0.01 on a 100 span.
4. **Spec prose rounding.** Section 2.2 says `hi + 0.031 * span`; the exact value is 0.03125 (20.5 mA), which the brief
   uses and which TIC202's 103.125 requires. Its sentence "Beyond the window the value is clamped" is loose: the shipped
   (and implemented) semantics flag Uncertain beyond the declared range and clamp the value to the reporting window.
5. **Forward-looking header comment.** The module header (the brief's text, verbatim) says plant-core writes `l.pvObs`;
   that is not true until Task 3 lands.
6. **Downstream cosmetic note for Tasks 3 and 4.** `pointRow` in the page (line ~2070) and
   `tools/coach/projection.js:48` special-case TIC202 only to skip rounding; once other points clamp to non-round limits
   those callers will round the observed value. The page's "reading uncertain" diagnosis text is generic, so there is no
   TIC202-specific wording to mislead.

---

# Fix report 1: controller ruling on concern 2 (the duplicate NE 43 registration)

Status: DONE. The text above is left as written (history); everything it says about `### 7.49`, the 48 to 49 count
bumps and `RESOURCES-7.49` is superseded by this fix.
Commit: 07453f7 fix(measurement): cite the NE 43 registration that already exists (RESOURCES-7.35), drop the duplicate
Applied as a new commit on top of 0dcf16d (no amend, no rewrite). Not pushed. Branch is 2 ahead of origin.

## What changed (6 files, 12 insertions, 16 deletions)
1. `docs/RESOURCES.md`: the `### 7.49` subsection is removed entirely, and the section 7 preamble is back to its
   original "contains 48 sources" wording. Restored byte-for-byte from `0dcf16d^`.
2. `docs/dev/CONVERGENCE-SPEC.md`: both claims read "48 sources ... RESOURCES-7.1 through RESOURCES-7.48
   (updated 2026-09-27)" and "(2026-09-27)" again (same restore). `tests/doc-consistency.test.js` is green at 48.
3. `src/measurement.js`: the one `RESOURCES-7.49` citation is now `RESOURCES-7.35`, and the comment reads: "This
   generalises the Temple-set reporting interval through the NE 43 convention registered at RESOURCES-7.35
   (CITED-NOT-HELD); it is not a claim of conformance (spec §2.2)." That is 7.35's own wording ("The implemented current
   endpoints are Temple-set; neither this registration ... establishes NE 43 conformity"). No code change.
4. `tests/measurement.test.js`: the one comment that named 7.49 now names 7.35. My two extra tests are kept as they were.
5. `src/model-id.js` and `dist/experion-station-sim-standalone.html`: rebuilt, because the model hash covers source
   bytes, comments included (stamp 90ffff55... became 857ddef8...). Rebuild is idempotent.
6. `CHANGELOG.md` untouched, as ruled; its "48 sources" line is correct again.

Net effect of 0dcf16d plus 07453f7 on `docs/` against 6e33ef8: zero lines (`git diff 6e33ef8 HEAD -- docs/` is empty).
What 3.2.0 keeps from Task 1 is the policy, the two extra tests and the 7.35 citation.

## Covering tests and gates
- `node --test tests/measurement.test.js tests/provenance.test.js tests/doc-consistency.test.js`
  Output: `# tests 56 / # pass 56 / # fail 0`.
- `python3 tools/build-dist.py`: wrote the standalone (791326 bytes, 31 manifest entries). Checked that `dist/`
  embeds the current `src/measurement.js` and `src/model-id.js` byte-for-byte; no `7.49` in the embedded module.
- `node --test tests/*.test.js`: `# tests 1139 / # pass 1138 / # fail 0 / # skipped 1` (the same documented
  "SKIPPED: rules 1 and 6 across the whole DIFF"), no warnings on stderr.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.
- `git grep -n -F '7.49' -- . ':!dist'` now hits only `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` lines 41, 52, 75, 138.

## Findings for the controller
1. **No RED exists for this correction.** I ran the three covering test files in the intermediate state (heading
   removed, counts back at 48, code still citing 7.49): 56 of 56 passed. Nothing in the suite checks that a citation in
   a `src/` comment resolves to a registry heading (`provenance.test.js` checks only topology and drill `sourceBasis`
   ids; `release-gates.test.js` only checks the file exists). Today there is no dangling canonical citation in `src/`
   (checked: none). I did not add a guard, as it is outside the ruling. If you want one, note that `src/` uses both
   the canonical form (`RESOURCES-7.35`, 30 distinct ids) and the CLAUDE.md rule-1 space form (`RESOURCES 2.5`, 19
   distinct), so a guard must parse both.
2. **Your plan still names 7.49.** `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` lines 41 and 52 (the Task 1 file list and
   the 7.49 entry text), line 75 (test comment) and line 138 (code comment) still say `7.49`. I left them, as they are
   your document and the ruling did not list them. The sentence in spec section 2.2 that the ruling calls wrong ("NE 43
   is not yet in docs/RESOURCES.md") is also untouched. If a later task's code block copies the plan's citation it will
   reintroduce a dangling id, and no test would catch it (finding 1).
3. Concern 3 (AI205/AI316 overshoots reading UNCERTAIN) is noted as ruled for Task 4; no action taken.

---

# Fix report 2: ruling R8 (the band rule) and review findings 1 to 4

Status: DONE.
Commit: b40f3f1 fix(measurement): a reading inside the NE 43 band stays Good with its limit bit; only a saturated reading is uncertain
Chain: 0dcf16d, 07453f7, 02fd4d4 (your spec/plan commit, which landed on top of mine while I worked), b40f3f1.
Built on the current HEAD, no amend. Not pushed; the branch is 4 ahead of origin.

## What changed (5 files, 76 insertions, 17 deletions)
1. `src/measurement.js`
   - R8, in the shape ruled: `observe()` computes `saturated = pv <= r.reportingLower || pv >= r.reportingUpper` and
     upgrades to `Uncertain_EngineeringUnitsExceeded` only when saturated. A reading beyond nominal but inside the window
     keeps its value and stays Good with the DataValue limit bit (0x00000500 LOW, 0x00000600 HIGH, statusName Good). The
     rule is written into the `observe()` doc comment where it is implemented.
   - Finding 1: the header now says the observed value "is intended to feed" the controllers and the alarm scan, and that
     plant-core "will write" `l.pvObs` (stage S1, Task 3).
   - Finding 2: the fallback is `if (p.tag === 'TIC202' && p.lo == null && p.hi == null)`, with its comment.
2. `tests/measurement.test.js`
   - The TIC202 table is split. Band rows: -0.001 and 100.001 as ruled, plus -1.2499 and 103.1249 (my addition, to pin
     that just inside each edge is still band); each asserts quality GOOD, statusCode 0x500/0x600, statusName 'Good',
     `code >>> 30 === 0` and `(code >>> 10) & 3 === 1`. Saturated rows (-MAX, -1.25, 103.125, 170.6, MAX) are unchanged
     UNCERTAIN, with the `code >>> 30 === 1` assertion now applied only to them.
   - Finding 3: renamed to "a point that declares a range but no kind is left alone". I also renamed "the generalised
     policy reproduces the shipped TIC202 precedent exactly" to "... reporting window exactly": its body only ever pinned the
     window and the saturated value, and after R8 the band rows are deliberately not the precedent.
   - New tests: (a) the reviewer's generic band case (`TI312`, 100.001 gives GOOD/HIGH/0x600), its low side, AI205 at
     100.011, the edge itself being saturated, and a source Uncertain status keeping its own code inside the band
     (0x40000600); (b) the narrowed fallback (TIC202 with lo 0/hi 0, 100/0, NaN/100, 0/undefined is left alone, while
     TIC202 with no range or only a kind still gets the precedent); (c) the reviewer's app-level check through
     `tools/logic-harness` (real `c.L.TIC202`: the two window edges equal the precedent's, and pv 170.6 observes as
     103.125), with three extra assertions that the live point declares kind 'pid', lo 0, hi 100, so the check cannot pass
     vacuously through the fallback.
3. `docs/dev/CREDIBILITY-PASS-SPEC.md` section 2.2: the first bullet is replaced with your text, verbatim, as one line (the
   spec already has lines up to 169 columns). Verified by an exact string comparison; the old "0.031" is gone.
4. `src/model-id.js` and `dist/`: rebuilt (stamp 857ddef8... became 9c5af443...).

## TDD evidence
RED, before touching `src/`: `node --test tests/measurement.test.js` gave `# tests 20 / # pass 17 / # fail 3`.
- "TIC202 keeps both nominal endpoints Good ...": expected quality GOOD, statusCode 1280 (0x500), 'Good'; actual UNCERTAIN,
  1083442432 (0x40940500), Uncertain_EngineeringUnitsExceeded.
- "a reading inside the NE 43 band stays Good ...": expected GOOD / 0x600 for pv 100.001; actual UNCERTAIN / 0x40940600.
- "the TIC202 precedent answers only for a point that declares no range at all": expected null for TIC202 with lo 0, hi 0;
  actual the precedent window object.
The live-TIC202 app-level test already passed (it is a coverage test, not a driver of change), and the two renames cannot
fail. GREEN, after the change: `# tests 20 / # pass 20 / # fail 0`.

## Covering tests and gates
- `node --test tests/measurement.test.js tests/provenance.test.js tests/doc-consistency.test.js tests/app-diagnose.test.js`
  gave `# tests 76 / # pass 76 / # fail 0`.
- `python3 tools/build-dist.py` ran clean. `dist/` embeds the current `src/measurement.js` and `src/model-id.js`
  byte-for-byte, and a second build changes nothing.
- `node --test tests/*.test.js` gave `# tests 1142 / # pass 1141 / # fail 0 / # skipped 1` (the same documented skip,
  +3 tests over before), no warnings on stderr. No golden moved.
- `tools/smoke.sh` gave `SMOKE folder: ok` and `SMOKE dist: ok`.

## Evidence that R8 does what it was ruled to do
Throwaway probe, not in the repo (`/tmp/task1-probe/compare3.js`): the original pre-task `observe()` (6e33ef8) against the new
one on every real point after every step of the 12 golden upset keys (600 s) and the 3 U4 scenarios.
- Quality differs on exactly one tag: TIC202 (14 steps in the `cool` run, raw about 101.4: old UNCERTAIN, new GOOD with limit
  HIGH). That is the ruled change to the inherited rows.
- AI205 (raw 100.0106), AI316 (-0.018) and FIC313 (40.0012) now differ from the original only in the limit bit and status code
  (0x600 or 0x500), with quality GOOD and the value unchanged. So the overshoot that motivated R8 no longer reads uncertain.
- Values differ only through the D14 flow cutoff (FI100, FIC102, FIC211, FIC310 read 0 near zero).
- No JS consumer (src, tools, page) compares a status code to a literal (0 hits), and the coach Python does not interpret
  these fields, so a Good reading with a non-zero code cannot be misread; consumers key off `quality`.

## Findings for the controller (no action taken)
1. **Spec sentences R8 now contradicts, left as they are** (the ruling named only the first bullet): section 2.2's lead-in
   (line 107) says `observe()` "must reproduce TIC202's current values exactly (a test pins that)". The window edges and the
   saturated values still do; the two band rows deliberately do not. Section 9's D7 row (line 376) says "TIC202 precedent
   values reproduced", same point. Section 11's row "any run where TIC202 leaves range" now means reaching a window edge
   (103.125 or -1.25) rather than leaving 0..100. Measured: of the 12 upset keys, only `cool` does (peak 183.7; 14 steps in
   the band, then 386 of 1200 half-second steps at or over the edge), so `upset-cool` stays a legitimate mover under R8.
2. **Possible unlisted mover for Task 3 (a measured premise, not a run).** FIC211 is an AUTO loop with SP 0 whose raw pv sits at
   0.017 to 0.05 in every run (kind pid, lo 0, hi 40, OP about 0.011 at design). The flow cutoff reads that as exactly 0. Once
   Task 3 feeds `pvObs` to `stepPid`, its error and OP will differ from today's in every run, and so may anything downstream
   of it. Section 11 lists no such mover ("a mover outside this table is a finding, not a re-capture"). I did not simulate it;
   that is Task 3's verify pass.
3. Byproduct of R8: any real point whose raw pv overshoots its range slightly (AI205, AI316, FIC313) now carries GOOD with
   limit HIGH or LOW and status 0x600 or 0x500 in the plant projection and the coach feed; before it was 0 and NONE. Those
   are informational fields.
