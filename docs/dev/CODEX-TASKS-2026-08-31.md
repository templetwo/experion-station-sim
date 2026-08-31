<!-- @artifact dev -->
# Codex task list — after tag audit (do not cut v3.0.0)

Supersedes `docs/dev/CODEX-TASKS-2026-08-30.md`. Coverage ticks and Alarm
Help/philosophy remain real leftover S4 items. They are not the tag blockers.
Read `docs/dev/TAG-AUDIT-2026-08-31.md` first.

Your final text is data. A discovered problem is a valuable result. Do not
weaken an assertion to get green. Do not tag. Do not force-push.

---

## Ground

| | |
|---|---|
| Branch | `v3`, tracks `origin/v3` |
| Do not tag | `v3.0.0` |
| Audit sha | `cf5693a` (then local docs commits may sit on top) |
| Suite | 708 / 707 pass / 1 skip / 0 fail. Green is not gate-3. |
| S0 goldens | UNMOVED vs `f8301fb`. Do not edit them. |

Independent probe (this seat): A1, four accepted TRAINING.* after a snapshot,
then replay: **4 events / score 60 → 0 events / score 0**. Journal contains
`TRAINING.MARK_EVIDENCE` etc. `applyJournalEntry` drops them.

---

## Do not do

- Tag. Force-push. `git add -A`. Hand-edit `dist/` / `support.js` / `src/model-id.js`.
- Edit S0 fixtures.
- Touch `src/models.js` without Anthony naming the ruling (D1 vs live symptoms vs S0).
- Re-do A-menu, compound scripts, schemaVersion marker, CHANGELOG existence.
- Encode a new gap as a passing test.

Anthony still owes a ruling on live fault effects (item 4). Do not guess.

---

## Order (uncontested first)

### 1. Replay TRAINING.*  — tag blocker, no D1 conflict

Page: `applyJournalEntry`. Also whatever inspect-state MARK_EVIDENCE/VERIFY
need on replay (`P.archInspected` must survive or be reconstructed, or replay
will fail-closed).

`dispatch()` already journals `TRAINING.MARK_EVIDENCE` / `PIN_COMPARE` /
`SUBMIT_HYPOTHESIS` / `VERIFY` (and should journal `DEBRIEF` once the page
calls it). Replay must call the same `dispatchTraining` / `archRetainEvent`
path, not invent a second scorer feed.

Test, committed, must fail until fixed: the probe in TAG-AUDIT-2026-08-31
(snapshot, four accepted actions, `startReplay` + `replayToEnd`, assert
event count and score unchanged). The existing mid-drill restore test is
not this probe. Do not "fix" the test by asserting 0.

Off-limits: `src/models.js`, S0 goldens, `src/drill-arch.js` scorer.

### 2. Debrief completable

Page: call `TRAINING.DEBRIEF` from a real control (ARCH Debrief, after the
drill, without requiring Learn). Do not null `P.aDrill.events` before a
training record is written (or snapshot the events onto the record first).
`archDebriefView`: pass `score`, a durable fault timeline (not only currently
active), keep process samples on rows.

Test: a clean A1 run can earn the debrief category from the UI path; Debrief
mode shows a SCORE row and process values; TRAINEE_SAFE still leaks no fault
id (`tests/app-debrief.test.js` stays the leakage pin).

Same page as item 1. One agent. Sequential with 1, not parallel.

### 3. INTERLOCK.DEFEAT is live or gone

Either synthesize it from a real accepted UI action (name the call site),
or remove those gates from A5/A12 until a real action exists. Module tests
that fabricate the event are not a live gate.

Do not silently drop the gates without a test that names the reversal.

### 4. Live fault effects / passable A-drills — WAIT FOR THE RULING

After Anthony names one of: physics hook, non-models bridge, or honest
objective rewrite. A1 frozen-GOOD vs `xmtr` BADPV/shed is a drill-definition
contradiction, not only a missing overlay.

### 5. Snapshot schema + `ESS.Sel`

Restore `snap.architecture`. Stop defaulting flex to `console`. New module
`src/sel.js` if you add selectors; do not grow a third projection API.

### 6. Offline A-drill in `tools/smoke.sh`

Standalone, DNS blocked, one representative A-drill to a scored end. A
screenshot is not that.

### 7. Previous leftover S4 (only after 1–3)

Coverage `taskDone('arch.*')` at real call sites. Alarm Help/philosophy
architecture copy. Training record for A-drills with breakdown mapped to
`{label, earned, max, note}`.

---

## Verify

```text
node --test tests/*.test.js
python3 tools/build-dist.py
tools/smoke.sh
```

Then the sha in a scratch clone, not the tree. S0 goldens vs `f8301fb`.

Report shape: HEAD_BEFORE, ITEMS_DONE, FILES, SUITE, SHA_VERIFIED, S0_UNMOVED,
FINDINGS, TAGGED: no.
