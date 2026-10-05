<!-- @artifact dev -->
# Tasks 3, 4 and 5 report (S2, spec section 5)

Branch `fix/playtest-2026-10`, BASE a3d69f2. Implementer: Claude Sonnet 5.5, seat on `Anthonys-MacBook-Pro.local`. Not pushed.

| Task | Commit | Subject |
|---|---|---|
| 3 | e78674d | feat(core): the journal belongs to the session: an initial-condition load keeps it and records itself once; a canonical start says so |
| 4 | 0809c94 | feat(core): the settle ends at the base time, so an initial condition never jumps the station clock |
| 5 | 2917a13 | feat(hmi): the status-bar clock says SIM whenever the run control is off real time |

Red set at BASE and after every task: exactly `A5` (arch; actual digest 1f9128d8), `golden: drill D11` (actual ae8d79aa), `golden upset: agit-batch` (actual 45b0eb8f). The digests are identical to the BASE run (compared line by line after each task). Nothing else red, no skip added.

**Which `events` the arch fixtures count:** `driveDrill` in `tests/drill-arch-fixtures.test.js` counts `c.P.aDrill.events` (the retained A-drill ActionEvent array on P), never the session journal `c.events`, and its physics digest passes `counts: undefined`. So Task 3 moved none of the 14 fixtures and Task 6 has nothing to re-capture for them on that account. The D-series goldens start LIVE STATE (no load, no canonical record), so their `counts.events` did not move either.

Process note: a T2Helix Compass PreToolUse hook paused two Bash invocations (a multi-file `node --test <six files>` run, request #1, and a grep/awk over a scratch log, request #2). I did not approve either (`confirm_pending` untouched). The named files are covered by the full-suite run (every file the Step 4 lines name is in `tests/*.test.js`), and I read the scratch log with the Read tool.

## Task 3: the journal belongs to the session (e78674d)

**Changed.** `src/plant-core.js`: new `settle(p, atTime)` above `applyPreset` (initSim at atTime, the preset's point and env set, the batch run to its phase, the run-forward; returns `{ms, seconds}`); `applyPreset` lifts `{events, msgs, alarmLog, eid, t0}` before the settle, restores them after `restoreSnapshot`, then appends `INITIAL CONDITION LOADED — <LABEL> (SETTLED <n> S)`; `startDrill` appends the SYSTEM record `DRILL <id> STARTED — <NAME> — CANONICAL` after `journal('DRILL', ...)` when `startMode === 'CANONICAL'`. `dist/` and `src/model-id.js` rebuilt. `tests/app-instructor.test.js` needed no change (nothing counted records after a load).

**RED.** `node --test tests/app-credibility-s2.test.js` before the implementation: 20 tests, 16 pass, 4 fail (D4 load keeps the journal: `events.length` expected 5, actual 3; batch preset load: expected 2, actual 11; canonical record: the second record read `INITIAL CONDITION LOADED: U1 steady state — SIM TIME ...`; other readers). The brief predicted two of these; the batch and other-readers tests also failed at RED.

**GREEN.** Same command after the implementation and the two test adaptations below: `# tests 20 / # pass 20 / # fail 0`. Gates: `node --test tests/*.test.js` 1268 tests, 1264 pass, 3 fail (the movers), 1 skipped; `python3 tools/build-dist.py` idempotent; `tools/smoke.sh` folder ok, dist ok.

**Deviations from the brief (all in tests, plus one guard line).**
1. D4 test, trends: the brief bounds the hist samples to `[base - 120000, base]`, which only holds once Task 4 ends the settle at `base` (here the settle still starts at `base`, so samples reach `base + 120000`). Task 3's commit bounds them to `[c.P.t - 120000, c.P.t]` (the settle window); Task 4 restored the brief's exact bound.
2. "Other readers" test: `assert.equal(c.events[0].id, eid)` is off by one in any world. `restoreSlot` writes its own `INSTR` record (`SNAPSHOT RESTORED: ... `, instructor not hidden), which takes id `eid`, so the next record (the MODE CHANGE) is `eid + 1`. The assertion now says `eid + 1` with that reason in its message, and an id-uniqueness check is added. The code is right (probe: ids 1, 2, 4, 5 after the restore, the load record 3 rewound away).
3. `settle()` opens with `if(!p) return null;` so the documented `| null` contract and the comment are true (applyPreset never passes an unknown preset).

**Concerns.** None specific to Task 3 beyond Task 4's refusal note (the session journal is not restored on a refused load, below).

## Task 4: the settle ends at the base time (0809c94)

**Changed.** `applyPreset`: with a numeric `baseTime`, a dry `settle(p, 0)` measures the length, a non-finite dry state refuses via `snapshotData` (today's `SNAPSHOT REFUSED`, returns undefined), then `settle(p, baseTime - dry.ms)`; with no base time the single settle is today's. The page's IC menu passes `{baseTime:this.P.t}` with the brief's comment. The canonical D start and the A start already passed `presetBaseT = this.P.t`. `dist/` and `model-id.js` rebuilt.

**RED.** `node --test tests/app-credibility-s2.test.js` before the implementation: 25 tests, 20 pass, 5 fail (D5 canonical clock `expected base, actual base + 120000`; the zero-clock alarm test `expected 0, actual 480000`; no-base-time test at its second half, `T0 + 240000`; the DRILL receipt vs its time, differing by 120000; and the Task 3 trend bound, now the brief's `base`). The refusal test passed already (it pins today's refusal).

**GREEN.** First run after the code: 24 pass, 1 fail (the alarm test; deviation 3). After the fix `# tests 25 / # pass 25 / # fail 0`. Probe (scratch, not committed): all five shipped presets land exactly on `baseTime` at clocks 0, 600000, 1790000000123 and -5000, with real length equal to the dry length. Gates: first full run 1273 tests, 3 extra failures (below); after the three assertion edits 1273 tests, 1269 pass, 3 fail (the movers), 1 skipped; build idempotent; smoke folder ok, dist ok.

**Deviations from the brief.**
1. The brief's tests assume the harness clock is 0, but the page's `initSim()` seeds the clock from `Date.now()` (so `boot()` gives about 1.79e12, two boots differ by a few ms, and a load with no base time starts at `Date.now()`). `boot(seed, sec, at)` gained an optional start clock (undefined keeps the old behaviour). The zero-clock alarm test and the byte-identical test boot with `at = 0`; the no-base-time test pins `Date.now` to `T0` around the call (restored in `finally`) and expects `T0 + 120000`, then loads with `baseTime: T0 + 120000` and compares the planes byte for byte.
2. The first brief D5 test body with `U1_HIFEED` cannot pass: the shipped preset raises no alarm (R-201 ends at 164.3 against PVHI 165; none of the five presets raises any alarm in its settle). The test patches `ESS.Instructor.presets` (restored in `finally`, the refusal test's technique) to a `U1_HIFEED` whose set adds `TIC201.sp = 170` beside `LIC101.sp = 40`; `TIC201.PVHI` is then raised at 246 s of the 480 s settle (raise time -234000 at the zero clock). It keeps the brief's checks and adds the Alarm Summary rows (`renderVals().av.rows`): every time cell reads a clock time and no row has NaN or undefined (Review Focus 4).
3. Three assertions in named gate files encoded the old jump and fail by construction under spec section 5.3 (`0 !== 120000`): `tests/release-gates.test.js` ("THE CONDITION the allowance rests on", `jump === preset.run * 1000`), `tests/app-drill-start-ui.test.js:221` (D lane) and `tests/app-adrills-menu.test.js:208` (A lane), each `live.t - 1700000000000 === 120000`. They now expect 0 with a section 5.3 note (the release gate's still checks zero `Date.now` calls and now requires a start to move the sim clock by nothing, which is stricter). Every replay assertion in those files (re-arm, `P.t`, trajectory equality to the live run) passes unchanged: replay gate 3 holds under the new settle. These edits touch the release-gate file the controller named as must-stay-green, so please look at them first.

**Refusal behaviour (reported as the brief asks).** The dry-settle refusal runs after the dry `initSim`, so the plant is left as the dry settle's state (the preset at time 0 plus its length, not finite) and, because the session journal is only put back after a successful restore, the journal is the scratch one (a fresh `OPERATOR STATION STARTED`), not the session's. In the page the station clock would read near the epoch after such a refusal. Today's refusal also leaves a settled plant and a wiped journal, so this is not a regression, and no rollback was done (I did not take a `captureScan()`). Unreachable with shipped presets (the test patches one). If a rollback is wanted: `captureScan()` before the lift, `rollbackScan()` on refusal, and re-post the message (the scan captures `state`, which would drop it).

**Concerns.**
1. After a load the instructor's ring holds the settle's snapshots, now timestamped in the last `length` seconds before `base` (it held them after `base` before). A backtrack from the IC load picks one of them and `restoreSnapshot` trims the session journal to that time. Probe: 200 s of session with two operator records at -10 s, load U1_SS at base, `backtrack(30000)` leaves only the station start (the two operator records go with the load record; when the settle started at `base` the ring entries were after it and only the load record, at `base + length`, would have been trimmed). Spec 5.2 keeps the ring and slots on today's rewind semantics, so I did not change it; no test pins it. A fix would clear the ring at the load or push post-base entries only; the controller can rule.
2. The load now runs two settles: node timings U1_SS 14 ms to 44 ms, batch presets about 100 ms to 200 ms. Negligible in the page.

## Task 5: the SIM label (2917a13)

**Changed.** Page: `timeT:(S.speed===1?'':'SIM ')+this.fT(P.t)` with the brief's comment; the clock cell `width:60px` to `width:92px`. `dist/` and `model-id.js` rebuilt. `dateT`, `spdT` and the instructor run line are untouched.

**RED.** `node --test tests/app-credibility-s2.test.js` before the page change: 27 tests, 26 pass, 1 fail (`'21:04:39' !== 'SIM 21:04:39'` right after `freeze()`); the Date.now count test passed already (`['models.js']`, measured with `grep -c "Date.now()" src/*.js` at BASE: only `src/models.js:281`).

**GREEN.** Same command after the page change: `# tests 27 / # pass 27 / # fail 0`. Gates: 1275 tests, 1271 pass, 3 fail (the movers), 1 skipped; build idempotent; smoke folder ok, dist ok.

**Deviations from the brief.**
1. The brief's last assertion, `v.instr.run ? v.instr.run.simT : c.fT(c.P.t)`, never reads the run line: with the instructor panel closed `renderVals().instr` is `{on:false}`, so it fell back to a tautology. The test now sets `c.instr.auth = true` and asserts `instr.run.simT` is a bare `hh:mm:ss` equal to `fT(P.t)` and `stateT === 'FROZEN'` (the run line unchanged).
2. Width: 92px as briefed, not browser-measured (browser lines skipped per the pace instruction). By my estimate (not measured) the 12-character bold string needs roughly 67 to 83 px depending on whether Tahoma or Verdana is resolved; the controller's browser pass can tighten it.

**Concerns.** `startDrill` appends the canonical record unconditionally, so it carries the drill's name even with instructor `hidden` set. The spec says trainee-visible and the only live caller is the trainee's own menu (the trainee picked that name), so I added no gate; the controller may want one for a future instructor-launched start.

---

# Fix round 1 (post-review): 8a54058

`fix(core): a load closes and reopens the KPI history, the A-drill debrief is the drill's, a random start keeps its name, and gate 3 keeps its control (CR44, CR45, CR46)`, one commit on top of 2917a13, not pushed. Red set after it: exactly `A5`, `golden: drill D11`, `golden upset: agit-batch`, digests identical to BASE (1f9128d8, ae8d79aa, 45b0eb8f). No Compass hook pause this round.

## What changed

- **Important 1, gate 3.** `tests/release-gates.test.js`, lane loop: after the `jump === 0` assertion, `c.events.some(e => e.desc === 'INITIAL CONDITION LOADED — ' + preset.label.toUpperCase() + ' (SETTLED ' + preset.run + ' S)')`. Both lanes are non-batch (the loop's guard asserts it), so the exact string with `preset.run` holds.
- **Important 2, CR44.** `applyPreset` takes `wasLive` (engine alarms with `active`) and `loadT = P.t` before the load and, in one `resume()` closure, puts the session journal back and then writes the KPI rows: a `rtn` row at `loadT` for each alarm that was active and is not in the new engine, a `raise` row at `a.t` (before base) for each alarm the new engine holds that was not active. `resume()` runs on all three exits: the two refusal returns and the success path (minor 1, the section 12 test now asserts events ids, `eid`, `t0` and `msgs` survive). Row writing moved to a new `logKpi(t, a, type)` (same row shape and 5000 cap), which `logAlarmEvents` now calls too.
- **Important 3, CR45.** Page `archDebriefView` windows to the drill through a new `archDebriefFrom()` (`P.aDrill.startedAt`, else the start kept on `_lastADrill`, else null = whole session): events, journal and fault timeline from the start, alarm rows after it, `t0` = the start. `endADrill` keeps `startedAt` on `_lastADrill` (copy, the training record's shape is untouched), so an ended drill's debrief is windowed too.
- **Important 4, CR46.** `startDrill` takes `opts.reveal` (strictly `=== true`); the record is `DRILL <id> STARTED — <NAME> — CANONICAL` only then, else `DRILL STARTED — CANONICAL`; `reveal` is journaled with the DRILL entry and replay passes `e.reveal`. `startDrillFromMenu` passes `reveal: mode !== 'random' && !this.instr.hidden`; `randomDrill` now calls it with mode `'random'` (canonical start, name withheld).
- **Minors.** Both test titles retitled to what they assert (the byte-identical test: the DRILL receipt agrees with its own time, "the check a replay makes"; the `Date.now` test: `src/` still reads it once, in `createState`'s fallback). `setSpeed(5)` in the label test. `white-space:nowrap` on the clock cell beside the 92 px. A comment at the ring push (`backtrackTick`) names the deferred backtrack-after-load trim, no behaviour change.

## RED and GREEN

- RED: `node --test tests/app-credibility-s2.test.js` before the source edits: 37 tests, 27 pass, 10 fail (the section 12 journal check, three CR44, two CR45, four CR46); the new no-drill debrief pin passed already. (My first RED run showed 11: a helper evaluated `seen` before the render; fixed.)
- GREEN: same command after the source edits: `# tests 37 / # pass 37 / # fail 0`.
- Gates: `node --test tests/*.test.js` 1285 tests, 1281 pass, 3 fail (the movers), 1 skipped; `python3 tools/build-dist.py` idempotent; `tools/smoke.sh` folder ok, dist ok. One intermediate full run had a fourth failure, `tests/app-boundary-dof.test.js` "specification-integrity notes are surfaced" (it pins `dofNoteRows.length === 0`: no way to render the notes for one audience); I had given `dofNoteRows` a window parameter, so it now reads the window from `archDebriefFrom()` and keeps arity 0.

## Refinements beyond the ruling text (please look at these)

1. **CR44, an alarm active on both sides of a load gets no return row and no second raise row.** The KPI sorts the log by time and the IC's raise rows lie before the load time, so the literal rule (return row at the load time, raise row at `a.t`) sorts the return row last and closes an alarm the engine still holds. Measured under the literal rule with the hot preset loaded twice: the engine holds `TIC201.PVHI` active after the second load, the log reads raise -234000, return 60000, raise -174000, and the KPI standing list is empty. The rows exist for every alarm that actually ends or begins; the literal return row for an alarm that continues is the one omission. Pinned by the overlap test (same hot preset twice: one raise row, standing since the first raise).
2. **CR45, wider than events and alarm rows.** The journal, the fault timeline and the DOF note rows are windowed too (the DOF rows are composed outside `Debrief.build`, carried `rel` from the session start, and put 15:30 at the top of the debrief; they now read from the drill start). Alarm rows use "after the start", not "from": CR44's return rows are stamped at the load time, which is the drill's own start on the menu path, and the drill's debrief would otherwise open with `ALARM RTN` of the previous plant (the test caught this).
3. **CR46, the default is no name.** A direct caller that does not pass `reveal` (tests, an old journal entry) gets the anonymous record, so a name is only ever written on an explicit yes. The journal entry always carries `reveal` (LIVE STATE starts journal `false`); no test pinned the entry's shape.
4. Test helpers: `withHotHifeed(fn)` (the hot U1_HIFEED patch, shared by the Task 4 test and the CR44 tests, restored in `finally`), `debriefInput(c)` (wraps `ESS.Debrief.build` for one render and returns what the view handed it plus the rows).

## Concerns

1. After a refused load the plant is the dry settle's state (clock about `0 + length`) while the restored journal carries the real clock, so the next records are older than the journal's newest. Unreachable with shipped presets; the earlier rollback note stands.
2. On a random start the `INITIAL CONDITION LOADED — <preset>` record still names the preset (it narrows the drill but does not name the fault); outside CR46's text, so left.
3. An ended drill's debrief stays windowed to that drill until the next load clears `_lastADrill`; a debrief opened later in the session shows the last drill, not the whole session.
4. Deferred as told: backtrack-after-load trim (comment added), a load during an armed drill, the section 12 test's scope.
