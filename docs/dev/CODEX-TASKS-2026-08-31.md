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
| Branch | `v3`, tracks `origin/v3` (local may be ahead) |
| Do not tag | `v3.0.0` |
| Audit sha | `cf5693a` |
| Items 1-3 sha | `df003bf` (see `docs/dev/CODEX-REPORT-2026-08-31.md`) |
| Suite at df003bf | 714 / 713 pass / 1 skip / 0 fail. Green is not a tag. |
| S0 goldens | UNMOVED vs `f8301fb`. Do not edit them. |

Audit-time probe (falsified gate 3): A1, four accepted TRAINING.* after a
snapshot, then replay: **4 events / score 60 → 0 / 0**. That probe now holds
at `df003bf` (**4 / 60 → 4 / 60**). Report: `docs/dev/CODEX-REPORT-2026-08-31.md`.

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

### 1. Replay TRAINING.*  — DONE at `df003bf`

Probe holds. Live wrong-mode still refuses. Test: `tests/app-adrill-replay.test.js`.

### 2. Debrief completable  — DONE at `df003bf`

YES/NO → `TRAINING.DEBRIEF`. Score + pvT + `P.archFaultLog`. Record before destroy.

### 3. INTERLOCK.DEFEAT is live or gone  — A5 DONE at `df003bf`; A12 still open

Call site: `motorCmd` START → `archSynthEvent('INTERLOCK.DEFEAT','DRV-'+tag)`.
A12 target `XMTR-TIC201` is not that path. Do not drop the A12 gate.

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

Coverage `taskDone('arch.*')` at remaining real call sites. Alarm Help/philosophy
architecture copy. A-drill training-record shape `{label, earned, max, note}`
already landed with item 2.

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
