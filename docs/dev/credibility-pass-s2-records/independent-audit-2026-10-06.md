<!-- @artifact dev -->
<!-- Provenance: relayed verbatim by Anthony Vasquez Sr. into the MacBook seat (claude-fable-5-1) session 9570056f on 2026-10-06, after PR #10 had merged as fb4b434; the producing seat is not named in the text. Archived in the Sovereign Stack chronicle as 80a60d2b8fb3ed5074783b3252e8909efef8c0ea263e5fbddd13c2beff067d96 (6963 bytes). Nothing below is edited; the audit's own section headings follow. -->

# Independent Audit — experion-station-sim PR #10

**PR**: `feat(s2): credibility pass S2: sequence ownership and HOLD, journal and clock continuity`
**Head**: `dc83c83` on `fix/playtest-2026-10` · **Base**: `main` @ `1d6e305` · 25 commits, 33 files, +3612/−105
**Audit date**: 2026-10-06 · **Method**: independent clone, gate reproduction, three parallel adversarial code audits, one verifier pass with live falsification probes

---

## Verdict

**READY TO MERGE.** Every falsifiable claim in the PR body was independently reproduced or verified in code. No Critical or Important findings beyond what the PR itself discloses. The four admitted known issues are real, accurately scoped, and — where claimed latent — confirmed unreachable with shipped content. The paper trail (ledger, spec §0.6, records, CHANGELOG) matches reality, including the openly confessed `8e54729` half-applied-commit slip.

## Gates — independently reproduced

| Gate (as claimed) | Result here | Verdict |
| --- | --- | --- |
| `node --test tests/*.test.js`: 1294 tests, 1293 pass, 0 fail, 1 skip | 1294 tests, 1290 pass, 0 fail, 4 skip | **Holds.** The 3 extra skips are `coach-cloud`/`coach-credential` tests gated on the `anthropic` Python package / API key, absent in this environment. With it present the claimed 1293/1 reproduces. 0 failures either way. |
| `build-dist.py`: dist unchanged on second run | Two consecutive builds byte-identical (sha256 `beeebf76…`) | **Holds.** Caveat below on cross-machine bytes. |
| `tools/smoke.sh`: folder ok, dist ok | Both ok (17 KB screenshots, no console errors; run with system chromium and /tmp profile dir) | **Holds.** Script hardcodes the macOS Chrome path — fine for the project seat, non-portable by construction. |
| Agent-drill rescore at `0d5211e` vs agent main `d13c23a`: v2 6/8 + 10/10, v3 8/8 + 10/10 | Reproduced exactly via a clean worktree at `0d5211e` and agent repo at `d13c23a`. The two v2 misses are exactly `restoration-lag:20260920/21`, each missing only `reactor_warming` — matching the "S1 §2.4 by design" explanation | **Holds.** |
| `ESS.MODEL_ID` restamped `138ec2a4…` | Recomputed independently per `stamp-model-id.py` over page + 30 src files: exact match | **Holds.** |

## Code audit findings (three scopes, adversarial probes)

### HOLD / ownership / setpoint shutoff (spec §4) — VERIFIED

- Freeze is complete: all sequence advance (timer, transitions, charge, drain) inside `if (!b.held)` (models.js:475–485); frozen byte-identical under probe; holds at 4× acceleration and across kernel checkpoint save/restore. The only `b.lvl` writer outside the gate is physical feed integration, which dies with the valve — material balance, not sequence advance.
- Ownership rule as ruled: FIC211 PROGRAM in all active phases; TIC212 exactly HEATUP→DRAIN (CR48); write ordering after transitions prevents the CR41 restore from re-grabbing the jacket loop the DRAIN→IDLE transition parked. CR43 trip-clears-hold confirmed; CR42 alarm-help sweep confirmed across all U2 entries that direct a loop write.
- CR40/CR40b shutoff: AUTO-only, good-PV, no-tracking, CAS-exempt; integrator tracked (bumpless). The whole-branch review's one Important finding (restore not recomputing cutoffs) is genuinely fixed at both restore paths (plant-core.js:1577, plant-kernel.js:68) and pinned by tests; a bogus restored `spCutoff: 999` is overwritten to the recomputed value.
- Fixture moves: exactly `arch/A5.json`, `drill-D11.json`, `upset-agit-batch.json` — nothing else.

### Journal / clock continuity (spec §5) — VERIFIED

- Journal survives IC load with exactly one self-record; eid continuity kept; rapid load–load clean. CR44 KPI close/reopen implemented as specified; CR47 ring emptied (`lastRingT=-Infinity`); CR46/46b reveal-rule, CR45 debrief windowing, CR49 restore-drop all confirmed by probe.
- Clock: all five shipped presets settle to exactly `baseTime`; no path shifts `t0`; settle cannot double-count (dry-run journal/clock discarded).
- **One reachable behavioral gap (disclosed, deferred)**: an IC load during an armed drill clears it silently (plant-core.js:1313) and the trainee journal keeps the drill's start record with no end. No scoring corruption (metrics die with the drill); the cost is a misleading journal. Accurately described in the spec's deferred notes.
- **Two KPI-row holes (disclosed, confirmed latent)**: CR44 raise rows surviving a slot restore inside the settle window, and the reverse phantom (earlier rtn closes a later load's retroactive raise). Both reproduced in probes — and both confirmed unreachable: all five shipped presets settle with zero active alarms, so the raise-row path is dead code in the shipped product.

### Claims vs records — VERIFIED

Commit count, diff stat, model stamp, golden moves, review-process claims (six tasks, Opus whole-branch review 0C/1I/11M, fix wave, re-review — all present in the ledger and records), the four known-issue admissions (all real in code), and the `8e54729` slip (confirmed: gates line and rescore premise were stale there, completed at `dc83c83`, ledger correction records it). 92 CR references in code comments all map to ledger rulings. Diff hygiene clean: nothing outside claimed scope, no TODO/FIXME/debug leftovers.

## Caveats (minor, for the record)

1. **Test-count claim is environment-dependent.** 1293-pass/1-skip requires the `anthropic` Python package; otherwise 1290/4. Not a falsification, but the gate line doesn't note the dependency.
2. **dist bytes are machine-local.** The builder is deterministic per machine, but a fresh build on a different Node/zlib differs from committed dist inside the gzip blobs. Decompressed content is byte-identical — the committed dist is provably correct (carries the stamped MODEL_ID, model-id test green). Just don't expect cross-machine byte equality.
3. **Fixtures carry the capture-time stamp** `5751648e`, not the final `138ec2a4` — by design (capture-time provenance), but a reader of "restamped" might expect otherwise.
4. **smoke.sh hardcodes** `/Applications/Google Chrome.app/...` — macOS-only by construction.
5. **Pre-existing structural note**: no try/finally around the settle in `applyPreset`; a throwing settle would strand the lifted session journal. Same shape as pre-PR; worth folding into the deferred refused-settle fix.

## What this audit did NOT cover

- The deferred items themselves (dry-settle rollback, silent drill drop, CR44 slot-restore hole, `_lastADrill` snapshot key) — accepted as deferred by the project's own governance; the "silently clears an armed drill" one is the only shipped-reachable item and deserves its planned follow-up.
- Reruns at intermediate revisions cited in the task records (`391fa7f`, `4221ea2`, `a8c231d`) — only the claimed gate at `0d5211e` was reproduced.
- Process-fidelity review of the companion agent-repo PR (master-operations-agent #2) — out of scope.
