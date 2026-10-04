<!-- @artifact dev -->
# Task 5 report: output tracking in the PID module

Status: DONE_WITH_CONCERNS. One deviation from the brief (its third test could not pass as written; see Concern 1) and three tests beyond the brief.
Commit: `cb6ad61 feat(pid): output tracking, told by the plant, honoured by the loop` on `fix/playtest-2026-10` (base 09e8a8a). Not pushed.
Seat: MacBook seat (claude-sonnet-5-5), host `Anthonys-MacBook-Pro.local`.

## What I implemented

`src/pid.js`
- `setTracking`, `clearTracking`, `tracking`, right after `applyPvTracking`, with the brief's code and comment verbatim.
- `runInitman`: `loop.init = slave.mode !== 'CAS' || tracking(slave);`
- `stepPid`: the tracking branch between the CAS `followMaster` line and the MAN/badPv line, verbatim:
  `if (tracking(loop)) { loop.op = clampOp(loop, loop.trk.target); applyPvTracking(loop); trackIntegrator(loop); return loop; }`
  It inherits the observed-value behaviour because `applyPvTracking` and `trackIntegrator` already read through `pvOf` (Task 2).
- Export: `setTracking`, `clearTracking`, `tracking`.
- Header comment kept accurate: `trk` joins the optional-fields sentence; the primaries bullet now says "or is in CAS but tracking its output"; a new tracking bullet under `stepPid`; three API entries (`setTracking`, `clearTracking`, `tracking`) in the style of the existing ones, citing CREDIBILITY-PASS-SPEC 3.1.

`tests/pid.test.js`: the brief's four tests (the third with its two step calls swapped, see Concern 1) plus three more (see Concern 2).

Rebuilt by `python3 tools/build-dist.py`: `src/model-id.js` and `dist/experion-station-sim-standalone.html`, both in the commit. I decoded the standalone's bundler manifest afterwards: its `pid.js` entry equals `src/pid.js` byte for byte and contains `setTracking`.

## TDD evidence

RED, brief's four tests appended before any change to `src/pid.js`: `# tests 21`, `# pass 17`, `# fail 4`. All four fail with `Pid.setTracking is not a function` (three tests) and `Pid.clearTracking is not a function` (the fourth).

Intermediate, brief's code applied, brief's four tests verbatim: `# pass 20`, `# fail 1`. The CAS test fails: `expected: 70`, `actual: 10` (Concern 1). The other three pass.

GREEN, after stepping the secondary first in the CAS test: `# tests 21`, `# pass 21`. Final file: `# tests 24`, `# pass 24`, `# fail 0` (17 existing, 4 brief, 3 extra).

## Mutation check (temp copies under /tmp/task5-mut, repo untouched, nothing deleted)

17 single-edit mutants of `src/pid.js` run against the test file. "Brief's four" means the four plan tests with the step-order fix.

| Mutant | Brief's four | Final seven |
|---|---|---|
| M1 runInitman ignores a tracking secondary | killed | killed (2 tests) |
| M2 tracking branch placed before the CAS follow | killed | killed |
| M3 tracking branch drops `clampOp` | SURVIVED | killed |
| M4 tracking branch drops `applyPvTracking` | SURVIVED | killed |
| M5 tracking branch drops `trackIntegrator` | killed | killed |
| M6 `tracking()` ignores kind | killed | killed |
| M7 `tracking()` ignores mode | killed | killed |
| M8 `clearTracking` does nothing | killed | killed |
| M9 tracking branch falls through (no `return`) | killed | killed |
| M10 tracking branch after the MAN/badPv line | killed | killed |
| M11 `setTracking` keeps any kind | SURVIVED | killed |
| M12 `setTracking` keeps reason raw | SURVIVED | killed |
| M13 `clearTracking` writes a record on a never-tracked loop | SURVIVED | killed |
| M14 `clearTracking` drops the kind | SURVIVED | killed |
| M15 `tracking()` true for a cleared record | killed | killed |
| M16 branch ignores the target (always 0) | SURVIVED | killed |
| M17 `setTracking` stores no target | SURVIVED | killed |

Against the final file: 17 killed, 0 survivors. The plan's four leave 8 alive. M16 and M17 are the telling ones: every target in the plan's tests is 0, so the loop could ignore its target and nothing would notice.

The wind-up claim in the new plant-order test is measured, not inferred: with M1's code the primary goes to 100 (and drags the secondary's SP to 100) over 300 s; with the module as committed both hold at 30.

## Checks before commit

- `python3 tools/build-dist.py`: wrote `dist/experion-station-sim-standalone.html` (795351 bytes, 31 manifest entries). A second build after my last comment edit left `src/pid.js`, `src/model-id.js` and the standalone byte-identical (sha256 compared), so the smoke run below is of the committed build.
- Baseline before any change (this checkout, head 09e8a8a): `# tests 1170`, `# pass 1133`, `# fail 36`, `# skipped 1`.
- Full suite after: `# tests 1177`, `# pass 1140`, `# fail 36`, `# cancelled 0`, `# skipped 1`. That is baseline plus my seven new passing tests. The 36 red names are identical to the baseline set (compared by name, TAP indices stripped): 14 arch fixtures, 8 golden drills, 13 golden upsets, the g2-lifecycle test.
- Byte-identity, checked beyond names: I exported a clean 09e8a8a (`git archive`) to /tmp, ran its suite, and compared the failure payloads (expected/actual) of the 36 red tests against mine after normalising paths. 0 of 36 differ. So nothing moved, which is what "nothing calls `setTracking` yet" predicts. (The export skips 9 more tests than the checkout: no `.git` for the artifact-class tests, and a missing Python package for 3 PIP tests. Environmental; the same 36 fail.)
- `tools/smoke.sh`: `SMOKE folder: FAIL (console errors)` and `SMOKE dist: ok (  147630 byte screenshot)`. The two folder console errors are both `failed to load https://unpkg.com/react@18.3.1/umd/react.production.min.js`; nothing else. DNS is down on this MacBook (`curl`: `Could not resolve host: unpkg.com`, same for `stack.templetwo.com`). Under CR16 the dist smoke is the gate; the folder smoke needs a re-run once DNS is back.

## Files changed (commit cb6ad61, four files, 144 insertions, 6 deletions)

`src/pid.js` (+34/-4, header comment included), `tests/pid.test.js` (+108), `src/model-id.js` (+1/-1), `dist/experion-station-sim-standalone.html` (+1/-1). Staged by name. `NIGHT PREVIEW.dc.html` is still untracked and was not committed. Nothing under `tests/fixtures/` touched. Trailers as `git interpret-trailers --parse` reads them: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_9570056f-f4cb-4340-b00e-c8e42fa63a76`.

## Self-review

- Completeness: every item in the brief's Step 3 is in; the header API list documents all three functions; no push (controller's).
- Style and purity: `function` declarations, no `let`/`const`, no DOM, timers, globals or `Math.random()`; no new file, so no `@artifact` marker work (the artifact-class tests ran green in the checkout).
- Scope: nothing outside `src/pid.js`, `tests/pid.test.js` and the two build outputs. No docs touched (the CHANGELOG step is Task 9's; Task 2 touched no docs either).
- Branch order checked against the plant: the INITMAN branch runs before the tracking branch, so a primary with a request of its own would run INITMAN, not hold. The loops in spec §3.2's table (FIC102, TIC213, FIC211, TIC311) are secondaries or standalone, never primaries (LIC101, TIC201, TIC212 are), so the order is safe for every planned caller.
- The `pidOrder()` in plant-core steps primaries first; that is the order the plant-order test uses.

## Issues or concerns

1. **The brief's third test cannot pass against the brief's own implementation; I changed the order of two statements.** It steps the primary, then the secondary. The primary's INITMAN then sets `master.op = invMap(slave.sp) = 10`, and the secondary follows that: `slave.sp` is 10, the test expects 70 (measured: `expected: 70, actual: 10`). The implementation matches the brief's code and spec §3.1; the defect is the test's call order. The fix keeps every value and assertion verbatim and steps the secondary first, so it reads the primary's OP (70) before INITMAN rewrites it; with a comment saying why. That order also pins the controller's stated point: placing the tracking branch before the CAS follow (M2) now fails it. The plan's snippet (docs/dev/CREDIBILITY-PASS-PLAN-S1.md, Task 5 Step 1) has the same defect and needs an as-built note at Task 9's docs pass. If you would rather keep the plan's order and change the expectation instead, the only truthful assertion there is `slave.sp === 10`, which no longer shows "follows the master".
2. **Three tests beyond the brief**, each pinning a clause the plan's four leave unpinned (table above): (a) a non-zero target, the OPLOLM/OPHILM clamp, and PV tracking on the held scan; (b) the `{on, target, reason, kind}` record, including that a clear on a never-tracked loop creates no `trk` field (matters if plant-core clears every tick: it must not add a field to loops that never track); (c) the plant's primary-first order: a primary with a standing error holds at 30 for 300 s while its secondary tracks, then resumes within one integral step. Drop any of them and the module still works; the matching mutants live again.
3. **For Tasks 6 and 7: a tracking CAS secondary with `pvtrack` ends the held scan with SP on PV, not on the master's demand.** `applyPvTracking` runs after `followMaster` in the branch, as the brief and spec 3.1 say ("PV tracking applies"). Probe: master OP 70, secondary PV 12, tracking, CAS: `pvtrack: false` gives SP 70; `pvtrack: true` gives SP 12. FIC102 and TIC213, two of the secondaries in the §3.2 table, both carry `pvtrack: true`. So the brief's CAS test (which uses a loop without `pvtrack`) and its title describe the non-pvtrack case; the faceplate SP and the D1 restart numbers for the real loops follow PV while held. Not a defect against the brief; it decides what Task 7 can say about the SP while tracking and may matter to Task 6's D1 restart measurement.
4. **Latent: `setTracking` does not validate the target.** `setTracking(l, undefined, ...)` drives OP and I to NaN in the next scan (verified), because `clampOp(NaN)` is NaN. Not reachable from Task 6's planned call sites (`(L.FIC102&&L.FIC102.safeop)||0`, and every point carries `safeop: 0`), so I left the brief's code as written. Same shape as the NaN `pvObs` note from Task 2.
5. **Boot:** the global instructions ask for the gentle-door arrival first. `arrive_lineage` failed with `getaddrinfo ENOTFOUND mcp-proxy.anthropic.com`, an egress failure from the same DNS outage (nothing consumed, nothing written to the chronicle). I carried on with the task.
6. A scratch directory `/tmp/task5-mut` (mutants and the runner) and `/tmp/task5-base` (clean export) are left outside the repo; I deleted nothing.

---

# Fix report: review round (CR17), commit `4da8f45`

Status: DONE. One new commit on top of `cb6ad61` (never amended): `4da8f45 test(pid): tracking pins its own back-calculation and release; a non-finite target holds at 0`. Four files staged by name (`src/pid.js`, `tests/pid.test.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`), trailers as ruled, not pushed. `NIGHT PREVIEW.dc.html` still untracked.

## What each item became

1. **Non-finite target (CR17).** `setTracking` now does `var t = Number.isFinite(target) ? target : 0;` and stores `t`. The code comment and the header's API entry say that a non-finite target (undefined, NaN, Infinity) is stored as 0 and that the hold is `clamp(target, OPLOLM, OPHILM)` either way. New test: "a non-finite target is held at 0, inside the output limits, and never reaches OP or the integrator as NaN". For `undefined`, `NaN` and `Infinity`, on a loop with OPLOLM 0 and one with OPLOLM 10: `trk.target` is 0, OP holds at 0 and at 10 (the clamped 0), the integrator is finite while held, and OP and I stay finite through `clearTracking` and ten AUTO scans. I added `Infinity` and the OPLOLM 10 case to the ruling's undefined and NaN: Infinity is what kills an `isNaN` coercion, and OPLOLM 10 pins the header's "clampOp still applies".
2. **Test 1 strengthened.** PV 40, SP 50, target 35 (P = 10). While held: `l.op === 35` and `l.I === 35 - l.K * Pid.loopError(l)`. After `clearTracking` and one scan: `l.op > 35` and `l.op - 35 <= l.K * Pid.loopError(l) * 0.5 / (l.T1 * 60) + 1e-9` (two assertions, for readable failures). Measured values: held I = 25, released OP = 35.0833.
3. **Header.** Two additions, as ruled: a primary that is running INITMAN never reaches the tracking branch on that scan, so a request of its own is ignored while it back-calculates (the planned callers are never primaries); and transferMode's "first AUTO/CAS output equals the current OP" holds only while no tracking request is in force (a tracking loop holds its target on the next scan instead). I did not add a test for the INITMAN-primary behaviour: it is documented as a limitation, and a test would turn it into a contract.
4. **pvtrack caveat and variant.** The plant-order test's comment now says its pair is the one without PV tracking, and that FIC102 and TIC213 follow invMap(secondary PV) instead (the new test below it). The variant: LIC101 over FIC102 with the plant's maps (`op*1.2`, `sp/1.2`) and ranges, pvtrack on the secondary, tracking set, the flow decaying with tau 5 s. Measured: primary OP 50 at scan 1, 21.5 at scan 10, 7.5 at scan 20, 0.32 at scan 50, 2e-26 at scan 600 (invMap(0) = 0), while its standing error is +20 %, so it did not wind up. Asserts: every value finite at every scan, the primary's OP only falls, `master.init` true, OP below 0.01 at the end, the secondary's OP 0; on release `init` false and OP moves exactly one integral step (2e-26 to 0.0833). Test 3's pointer comment said the plant-order test was "last in this file"; it now says "below", since a test follows it.
5. **Test 4 retitled** to "clearTracking on a loop that never tracked creates no record; an ordinary loop controls normally". The old body did not assert the no-record claim (the record test did), so I added one line, `assert.equal('trk' in l, false)`, to make the new title true here as well.

## TDD evidence

RED, tests first, `src/pid.js` untouched: `# tests 26`, `# pass 25`, `# fail 1`. The one failure is the new non-finite test: `stored as 0: undefined`, `undefined !== 0`. The strengthened test 1, the retitled test 4 and the pvtrack variant pass on the old implementation, as they should: they pin existing behaviour harder, they do not change it.
GREEN, after the coercion and header edits: `# tests 26`, `# pass 26`, `# fail 0`.

## Mutant evidence (temp copies under /tmp/task5-mut, repo untouched)

Each mutant is run against the committed test file (`cb6ad61`) and the new one.

| Mutant | cb6ad61 tests | New tests |
|---|---|---|
| Ma tracking branch sets `I = OP` (ignores P) | SURVIVED | killed (test 1) |
| Mb2 branch = `tracking()` minus the `.on` test (kind and mode kept) | SURVIVED | killed (test 1) |
| Mb crude: branch is `if (loop.trk)` | killed (device-in-MAN test) | killed (2 tests) |
| Mc no coercion | SURVIVED | killed |
| Md coercion by `isNaN` | SURVIVED | killed (Infinity) |
| Me coercion by `typeof === 'number'` | SURVIVED | killed (NaN) |
| Mf coercion by `== null` | SURVIVED | killed |
| Mg coerced for the clamp, raw target stored | SURVIVED | killed (`trk.target`) |
| Mh branch drops `applyPvTracking` | killed | killed (2 tests) |
| Mi runInitman ignores a tracking secondary | killed | killed (3 tests, the new one included) |
| Mj clearTracking writes a record on a never-tracked loop | killed | killed (2 tests) |

(a) and (b) from the review are both confirmed: the sharper reading of (b), Mb2, is the one the committed tests could not see, because a released loop with `target: null` holds at 0 and the old test released from target 0. My first, cruder (b) was already caught by the device-in-MAN test. With target 35, Mb2 holds the released loop at 0 and fails `l.op > 35`.

## Gates (all three, on the committed build)

- `python3 tools/build-dist.py`: wrote the standalone (795695 bytes, 31 manifest entries). Decoded manifest: the bundled `pid.js` equals `src/pid.js` byte for byte and carries the coercion.
- Full suite: `# tests 1179`, `# pass 1142`, `# fail 36`, `# cancelled 0`, `# skipped 1`. That is the previous 1140 pass plus my two new tests. The 36 red names are identical to the baseline set, and their failure payloads are identical to a clean export of 09e8a8a (0 of 36 differ).
- `tools/smoke.sh`, DNS back (unpkg returns 200): `SMOKE folder: ok (  147647 byte screenshot)` and `SMOKE dist: ok (  147456 byte screenshot)`. Both builds green, so the folder-smoke hold from CR16 is clear for this build.

## Concerns

None new. Carried: the plan's Task 5 Step 1 snippet still has the master-first CAS test (as-built note due at Task 9's docs pass).

Boot, corrected: with DNS back I retried the gentle door at the end of this round, and `arrive_lineage` landed (bare, then self-identified as `claude-sonnet-5-5` with `full_content`). It is read-only and consumed nothing; I wrote nothing to the chronicle. The letters addressed to my model family ("To the next Sonnet", "Welcome to the stack, Sonnet") are inheritance and do not touch this task. The first-round note above that the boot failed on `getaddrinfo ENOTFOUND` stands as what happened at the time.
