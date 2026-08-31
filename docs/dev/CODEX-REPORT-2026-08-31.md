<!-- @artifact dev -->
# Codex report — audit items 1-3 landed. Do not tag.

From: MacBook seat (grok-4.6), 2026-08-31.
To: Codex. Anthony: "after done please report back to codex."
Order: `docs/dev/CODEX-TASKS-2026-08-31.md` (supersedes the 08-30 list).
Audit: `docs/dev/TAG-AUDIT-2026-08-31.md`.

```
HEAD_BEFORE:  5ba3973  (docs: do not tag; counter-sign audit; gate 3 is falsified)
SHA:          df003bf15434cfcd5148bc2c36d41691c4fae7a9
ITEMS_DONE:   1, 2, 3
ITEMS_WAIT:   4 (Anthony D1 ruling). 5, 6, 7 not started.
SUITE:        714 tests, 713 pass, 1 skip, 0 fail
              (scratch clone at SHA: same 714 / 713 / 1 skip / 0 fail)
S0_UNMOVED:   yes vs f8301fb (top-level tests/fixtures/*.json, not arch/)
MODEL_ID:     705aec1ef0241f773e6d56add6f1b43da9308af86cb926fcd23d50ba4e383f5f
DIST:         648444 bytes, 21 manifest entries; stamp+dist idempotent at SHA
SMOKE:        tree, immediately before commit: folder ok 117504 B, dist ok 117721 B.
              Scratch-clone smoke produced no screenshot (Chrome crashpad
              permission denied under /tmp). Dist bytes at SHA match the tree
              that smoked. Offline A-drill still absent (item 6).
SHA_VERIFIED: suite + stamp + dist at df003bf in a no-hardlinks scratch clone.
TAGGED:       no
PUSH:         not from this seat. origin/v3 is still 5ba3973 until Anthony pushes.
```

Your final text is data. A discovered problem is a valuable result.

---

## ITEMS_DONE

### 1. Replay TRAINING.*  (gate 3 probe now holds)

Independent probe at audit time: A1, four accepted TRAINING.* after a snapshot,
`startReplay` + `replayToEnd`: **4 events / score 60 → 0 / 0**.

Same probe now, committed as `tests/app-adrill-replay.test.js`:
**4 events / score 60 → 4 / 60**. `aDrill.id` is still A1.

How:
- `applyJournalEntry` cases for `TRAINING.MARK_EVIDENCE|PIN_COMPARE|SUBMIT_HYPOTHESIS|VERIFY|DEBRIEF` call `dispatchTraining` (same retain path as live, never a second scorer feed).
- `archTrainingCtx.replaying` is `!!this._replayApplying`.
- `requireMode` returns true when `ctx.replaying === true` (spectator `archMode` is debrief; MARK_EVIDENCE was earned in Diagnose).
- MARK_EVIDENCE / VERIFY skip `wasInspected` only when replaying. Live still fails closed.
- Dispatch unit test pins both sides: live MARK_EVIDENCE in debrief refuses; the same command with `replaying:true` accepts.

Off-limits held: `src/models.js`, S0 goldens, `src/drill-arch.js` scorer.

### 2. Debrief completable

- ARCH Debrief chip stays available during an A-drill (Learn stays hidden).
- YES/NO in the Debrief timeline calls `submitADrillDebrief(correct)` → `TRAINING.DEBRIEF` with `{correct}`.
- Measured: A1 Diagnose-only 60, then YES → 70 (debrief category 10).
- `archDebriefView` passes `score` (live `P.aDrill` or `_lastADrill`), keeps process samples on rows as `pvT`, uses durable `P.archFaultLog` instead of currently-active-only.
- `endADrill` maps breakdown to `{label, earned, max, note}` and `addRecord`s **before** `P.aDrill=null`. Replay of `ADRILLEND` does not double-write the record.
- `tests/app-debrief.test.js` TRAINEE_SAFE leakage pins still pass (fault ids stay out of the trainee blob, including after `archFaultLog`).

### 3. INTERLOCK.DEFEAT live for A5, not for A12

Call site: `motorCmd` START. If the motor was tripped, after the accepted START, `archSynthEvent('INTERLOCK.DEFEAT','DRV-'+tag,null)`. Not journaled as its own op (START already journals; a second entry would double-apply). Outcome-based: a refused start never reaches the line.

Test: A5, tripped M202, START → one retained `INTERLOCK.DEFEAT` at `DRV-M202`, `score.gated === true`.

**A12 not done.** Gate target is `XMTR-TIC201`. Motor START only synthesizes `DRV-<tag>`. The A12 gate was not dropped. Do not treat A12 as live.

---

## FILES (df003bf)

```
CHANGELOG.md
Experion Station Simulator.dc.html
dist/experion-station-sim-standalone.html   (generated; do not hand-edit)
src/dispatch.js
src/model-id.js                             (generated stamp; do not hand-edit)
tests/app-adrill-replay.test.js             (new: gate 3 probe + debrief + record + A5)
tests/app-debrief.test.js
tests/dispatch-training.test.js
tests/models.test.js                        (P.archFaultLog is APP_ONLY, D1 exception)
```

`git add -A` was not used.

---

## FINDINGS (do not round these up)

1. **Do not tag.** Items 1-3 were the uncontested blockers. They are not S4 closed.
2. **Item 4 waits on Anthony.** Live fault effects / passable A-drills. A1 reserved `xmtr` still raises BADPV + shed vs drill "frozen GOOD". Engine-only A2/A4-A12 still cannot earn stabilize (ACK). Do not touch `src/models.js` without the ruling.
3. **A12 INTERLOCK.DEFEAT is still a fabricated-only gate** unless a real UI action targeting `XMTR-TIC201` is named. Do not silently drop it.
4. **Item 5 still open.** Snapshot is version-marked (`schemaVersion: '3.0'`), not the §4 field set. `snap.architecture` is not restored. Flex profile still defaults to `console`. No `ESS.Sel`. A-drill lifecycle still bypasses dispatch (`startADrill` / `aDrillFire` / `restoreSnapshot`).
5. **Item 6 still open.** `tools/smoke.sh` screenshots both builds with DNS blocked. No A-drill interaction.
6. **Item 7 leftover S4.** `taskDone('arch.debrief')` now fires from the YES/NO path. Remaining `arch.*` coverage ticks and Alarm Help/philosophy architecture copy are not this landing.
7. **Clean-run A-fixtures were not rewritten.** Diagnose-only scripts still score 90 (A1) / 60-70 (rest). Debrief YES is opt-in from the UI. Do not UPDATE_GOLDENS to bake debrief into fixtures unless Anthony asks.
8. **`P.archFaultLog` is app-only.** Same D1 exception as `archFaults` / `training` / `aDrill`. Never add it to `ESS.Models.createState`.

---

## Next order (unchanged from the task list, minus 1-3)

4. Live fault effects / passable A-drills — WAIT FOR THE RULING.
5. Snapshot schema + `ESS.Sel`.
6. Offline A-drill in `tools/smoke.sh`.
7. Remaining coverage ticks / Alarm Help / philosophy.

Do not tag. Do not force-push. Do not edit S0 fixtures. Do not touch `src/models.js` without the word.
