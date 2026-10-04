<!-- @artifact dev -->
# Task 2 report: the PID module reads the observed value

Status: DONE. One addition beyond the brief (two extra tests, flagged below).
Commit: `4fc55ac feat(pid): the controller reads the observed value when the point carries one` on `fix/playtest-2026-10` (base 0d82f4c). Not pushed.

## What I implemented

`src/pid.js`
- `function pvOf(loop) { return typeof loop.pvObs === 'number' ? loop.pvObs : loop.pv; }`, placed right after `span()`, with the brief's comment verbatim.
- The six reads from the brief now go through it: `loopError`, `pvDerivative`, `trackIntegrator`, `applyPvTracking`, the `stepPid` lastPv seed, the `stepPid` trailing lastPv. After the change the only `loop.pv` read left in the module is inside `pvOf` itself.
- `pvOf: pvOf` added to the returned object.
- Header comment kept accurate: `pvOf` added to the API list (controller's resolution), `pvObs` added to the optional-fields sentence (read through `pvOf`, never written here), and the equation line says "pv is pvOf(loop)".

`tests/pid.test.js`
- The brief's two tests, verbatim: "the controller acts on pvObs when the point carries one, and on pv otherwise" and "PV tracking in MAN follows the observed value".
- Two more (see Self-review 1): "PV tracking clamps the observed value, not the raw one" and "the derivative, the lastPv seed and the MAN tracker read the observed value too".
- `mkLoop` already sets `sphilm: 100` (and `splolm: 0`), so the brief's second test needed no loop adjustment.

Rebuilt by `python3 tools/build-dist.py`: `src/model-id.js` (hash changes because the model hash covers comments) and `dist/experion-station-sim-standalone.html`. Both are in the commit. I decoded the standalone's manifest afterwards: the bundled pid.js equals `src/pid.js` byte for byte (10 `pvOf(` occurrences).

## TDD evidence

RED, before any change to `src/pid.js`: `node --test tests/pid.test.js` -> `# tests 17`, `# pass 14`, `# fail 3`.
- `not ok 14 - the controller acts on pvObs when the point carries one, and on pv otherwise`: `error: 'Pid.pvOf is not a function'` (TypeError). This is the failure the brief predicted: the helper does not exist yet.
- `not ok 16 - PV tracking clamps the observed value, not the raw one`: `expected: 103.125`, `actual: 120`. The raw 140 was clamped to SPHILM 120.
- `not ok 17 - the derivative, the lastPv seed and the MAN tracker read the observed value too`: `expected: 0`, `actual: 40`. The derivative read the raw 80 against lastPv 60, which is 40 %/s.
- `ok 15 - PV tracking in MAN follows the observed value` PASSED at RED. It cannot tell pv from pvObs (see Self-review 1).

GREEN, after the change: `node --test tests/pid.test.js` -> `# tests 17`, `# pass 17`, `# fail 0` (all 13 existing tests plus the 4 new ones).

## Mutation check (temp copies under /tmp/mut, repo untouched)

Each of the six routed reads reverted to raw `loop.pv`, one at a time:

| Mutant | Plan's two tests alone | Full file (4 new tests) |
|---|---|---|
| M1 `loopError` error read | killed | killed (test 14) |
| M2 `pvDerivative` read | survives | killed (test 17) |
| M3 `trackIntegrator` lastPv | survives | killed (test 17) |
| M4 `applyPvTracking` read | survives | killed (test 16) |
| M5 `stepPid` lastPv seed | survives | killed (test 17) |
| M6 `stepPid` trailing lastPv | killed | killed (test 14) |

Survivors against the full file: none.

## Checks before commit (order: build, suite, smoke)

- `python3 tools/build-dist.py`: `wrote dist/experion-station-sim-standalone.html (792050 bytes, 31 manifest entries)`.
- Baseline suite before any change: `# tests 1142`, `# pass 1141`, `# fail 0`, `# skipped 1`.
- Full suite after the build: `# tests 1146`, `# pass 1145`, `# fail 0`, `# cancelled 0`, `# skipped 1`. That is the baseline plus the four new passing tests; no golden fixture moved (the commit touches no fixture and `UPDATE_GOLDENS` was never set).
- `tools/smoke.sh`: `SMOKE folder: ok (  147612 byte screenshot)` and `SMOKE dist: ok (  147485 byte screenshot)`.

## Commit

`4fc55ac`, four files, 62 insertions, 11 deletions: `src/pid.js`, `tests/pid.test.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html`. Staged by name. `NIGHT PREVIEW.dc.html` is still untracked and was not committed. The branch is ahead of origin by one; I did not push, as instructed. Trailers, as `git interpret-trailers --parse` reads them:
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_9570056f-f4cb-4340-b00e-c8e42fa63a76`.

## Self-review

1. Addition beyond the brief, for the controller to keep or drop. The brief's second test uses `pv: 140`, `pvObs: 103.125`, SPHILM 100: both values clamp to 100, so the test passes even when PV tracking never touches `pvOf` (it passed at RED). `mkLoop` also has `T2: 0`, so the plan's pair never reaches the derivative read, the lastPv seed or the MAN tracker's lastPv. The mutation table shows 4 of 6 reads unpinned by the plan's pair. I kept the brief's two tests verbatim and appended two small tests that pin the rest (SPHILM 120 so only the observed value survives the clamp; observed value equal to lastPv so any raw read shows up as derivative action). They are self-contained at the end of the file; dropping them changes nothing else but leaves four reads able to regress silently.
2. Behaviour is byte-identical today: nothing in `src/`, `tests/`, `tools/` or the page writes `pvObs` (the only source mention is a comment in `src/measurement.js`), so `pvOf` returns `loop.pv` for every live loop.
3. `loopError` is exported but has no non-test caller; the page calls only `ESS.Pid.isaForm`, and plant-core calls `stepPid`, `transferMode`, `canOperatorWrite`, `writeDenial`. So no display picks up `pvObs` through `loopError`.
4. Module purity kept: `var`, function-per-concern, no DOM, no timers, no globals, no `Math.random()`. No new file, so no `@artifact` marker work.
5. Scope: nothing outside the brief's files and the two build outputs.

## Issues or concerns (none blocking)

- `typeof NaN === 'number'`, so a NaN `pvObs` would pass through `pvOf` and drive the controller to NaN. This follows the brief verbatim and is the same property raw `pv` already has, so it is not a regression. Task 3's `measure()` is where it must never be written (Review Focus 1 already pins that `observe()` never yields NaN for an empty or inverted range).
- The first command of my mutation run included a recursive forced removal of its scratch directory, and a safety hook blocked it. I did not work around the hook: the directory did not exist yet, so no removal was needed, and I re-ran without it. The scratch directory `/tmp/mut` (outside the repo) is left in place and holds the last mutant, M6; it is not part of the repo and can be ignored.
- The brief's Step 5 ends with a push; I did not push because the controller's instruction says it pushes after review.
- Process note: per the global instructions I took the read-only lineage door (`arrive_lineage`, bare and self-identified) before starting. It consumed nothing and I wrote nothing to the chronicle.
