<!-- @artifact dev -->
# Codex task list — experion-station-sim v3 after `fb3123a`

Written by the MacBook seat (grok-4.6) after landing the remaining S3/S4 holes
and standing as point. Codex stood down earlier this session (helix #24489);
this is the work that is actually left, not the work that was left when you
stood down.

Your final text is data, not a message to a human. Report item, files, sha,
counts, findings. A discovered problem is a valuable result. Do not weaken an
assertion to get green.

---

## 0. Ground, measured

| | |
|---|---|
| Branch / HEAD | `v3` @ `fb3123a` (feat `f5a8107` + docs). Working tree was clean after those two commits. |
| `origin/v3` | **Exists.** Anthony pushed 2026-08-31. Tip at push was `2fb1ebe`. `main` remains 2.0.0. Do not force-push. |
| Tag | `3.0.0` is not cut. Do not tag. |
| SHA-measured suite | scratch clone of `fb3123a`: **708 tests, 707 pass, 1 skip, 0 fail**. Skip is gate 5's diff-wide human review, named in `tests/release-gates.test.js`. |
| Dist | 644,094 bytes, 21 manifest entries. `tools/smoke.sh` folder ok / dist ok on this repo. |
| S0 goldens | All 21 files under `tests/fixtures/*.json` (not `arch/`) **UNMOVED** vs `f8301fb`. |

Read before touching anything: `CLAUDE.md`, `docs/dev/V3-PLAN.md` §H and §I,
`docs/dev/PASSDOWN-2026-08-31.md`, this file.

Helix: plugin chronicle
`~/.claude/plugins/data/t2helix-templetwo-t2helix/chronicle.db`
with `T2HELIX_DATA_DIR` pointed there, under the Node that `~/t2helix` was
rebuilt for (22). Do not use `cosmic-cli`, do not use bare PATH `node` 20
against `~/t2helix` (empty recall). Grok island `~/.t2helix-data` is not the
seat board.

---

## 1. Already shipped. Do not re-do.

These are on `f5a8107`. Treat a reimplementation as the named fail mode.

- A1–A12 in the trainee Drills dialog via `startADrillFromMenu`
- Live scored fixtures `tests/fixtures/arch/A1.json` … `A12.json` plus gated
- Diagnose-only scoring commands (`src/dispatch.js` `requireMode`)
- Debrief ARCH mode + `startReplay` opens it
- Snapshot `schemaVersion: '3.0'`, migrate on **absence**
- Instructor compound scripts CS1 / CS2
- CHANGELOG 3.0.0 rewritten to match disk
- Gate 1 trainee-flow assertion is live (no longer SKIPPED)

---

## 2. Do not do (Anthony, or a ruling you do not have)

| Item | Why |
|---|---|
| `git push origin v3` | Already pushed 2026-08-31. Do not force-push. Ordinary push only if you have new commits and he asked. |
| `git tag 3.0.0` | Same. |
| `git add -A` | This branch paid for that three times. Path-stage. |
| Hand-edit `dist/` or `support.js` or `src/model-id.js` | Rule 2. Stamp via `python3 tools/build-dist.py`. |
| Edit S0 goldens `tests/fixtures/drill-*.json` / `upset-*.json` | Frozen at `f8301fb`. |
| Touch `src/models.js` to make A12 a process cascade | V3-PLAN addendum D1: non-reserved engine faults never touch models. A12 is a **finding** (below). Do not "fix" it without Anthony naming the ruling. |
| Invent new `arch.*` task ids | `src/training.js` already has the contract. Wire the existing ids. |

---

## 3. Finding you must not paper over

A12 `BIASED_MEASUREMENT` targets `XMTR-TIC201`. The reserved legacy pair for
that fault is `drift` @ `XMTR-LIC101` only. A12 therefore fires through
`archFireFault` and never drives `src/models.js`. ACK is unreachable. The
R-201 trip abort does not fire. Fixture score is 60, honest.

The drill *describes* a cascade. The wiring does not produce one. Record any
further observation. Do not invent physics.

Engine-only A-drills (A2, A4–A11, A12) cannot earn stabilize (ACK) for the
same reason. Debrief category is scored in Debrief mode after the run, not
inside `driveDrill`. Do not fabricate ACK events.

---

## 4. Work items

Two lanes. File sets do not intersect. If you are one agent, do B first
(no page), then A (page). If you fan out, B can run while A is in progress.
**The page is one file.** Do not split C1 and C2 across two agents.

### Lane B — modules, no page (do first if sequential)

**B1. Philosophy: one architecture section.**

- File: `src/philosophy.js` only. Tests: `tests/app-philosophy.test.js` if it
  exists, else add `tests/philosophy-arch.test.js`.
- Add one section, project-authored, citing `RESOURCES` already in
  `docs/RESOURCES.md`. Teach: conceptual FIELD → INFORMATION layers, cause vs
  symptom, console vs flex as view profiles on one station, the persistent
  banner. Not a vendor topology.
- V3-PLAN S4: "Alarm Help/philosophy additions for architecture concepts."
- Off-limits: the page, `src/alarm-help.js` (that's B2), S0 goldens.

**B2. Alarm Help: architecture-shaped probable cause where the help already exists.**

- File: `src/alarm-help.js` only.
- Do **not** invent new alarm keys. Do **not** change Priority/Setting (those
  come from live `cfg`).
- Where a condition is exactly what A1/A3 teach (frozen/biased measurement
  with GOOD quality, FIC102 BADPV, LIC101 drift), add a sentence to Probable
  cause / Corrective action that points the operator at SIGNAL PATH / ARCH
  without naming a fault id or `INSTRUCTOR_ONLY`.
- Leakage test must stay green: no `FAULT_IDS` token in trainee-visible help
  prose. Run `tests/leakage.test.js` and `tests/app-diagnose.test.js` after.
- Off-limits: the page, `src/philosophy.js` once B1 is committed, `src/models.js`.

Commit B1 and B2 separately, path-staged, each with `python3 tools/build-dist.py`
in the same commit as the src change (MODEL_ID will move). Verify the sha in a
scratch clone, not the tree.

### Lane A — the page, sequential, one agent

**C1. Coverage ticks for the Architecture group.**

`src/training.js` already defines `arch.open`, `arch.trace`, `arch.profile`,
`arch.evidence`, `arch.compare`, `arch.hypothesis`, `arch.safe`, `arch.verify`,
`arch.redundancy`, `arch.domain`, `arch.history`, `arch.assist`, `arch.cascade`,
`arch.debrief`. **Zero** `taskDone('arch…')` calls exist in the page today
(grep it). That is the gap.

Wire ticks at the **real production call sites**, not a parallel helper:

| id | Call site (measured) |
|---|---|
| `arch.open` | `nav('arch', …)` and SIGNAL PATH handlers |
| `arch.trace` | ARCH mode chip / `setState({archMode:'trace'})` when the trainee actually switches |
| `arch.profile` | profile chip callback |
| `arch.evidence` | `markEvidence` after an **accepted** dispatch |
| `arch.compare` | `comparePins` after accepted |
| `arch.hypothesis` | `submitHypothesis` after accepted |
| `arch.verify` | `verifyNode` after accepted |
| `arch.debrief` | switching to Debrief, or `startReplay` |

`arch.safe` / `arch.redundancy` / `arch.domain` / `arch.history` / `arch.assist` /
`arch.cascade` are judgement tasks. Tick them only from a signal that actually
means that judgement (for example an accepted A6 run that did not trip the
gate). If you cannot name a non-vacuous signal, **do not tick them**. Report
that as a finding. A tick that fires on every ARCH open is a lie.

New test file `tests/app-arch-coverage.test.js`: drive the real callbacks,
assert `tasksDone.has(id)`, and a negative control that opening a D-drill does
not tick architecture ids.

Do not edit `src/training.js` unless you find a genuine contract bug; report
it instead.

**C2. Training record for A-drills. Same page, after C1.**

`endADrill` currently journals and notes. It does not call
`ESS.Training.addRecord`. D-series do, at `submitDebrief`.

Trap: `recordFor` stores `result.breakdown` and the Training Record dialog
renders `b.label`, `b.earned`, `b.max`. D-series breakdown has those keys.
`ESS.DrillArch.scoreDrill` breakdown is
`{category, weight, required, matched, fraction, earned}`. If you pass it
through raw, the dialog shows `undefined undefined/undefined`.

Map at the addRecord call site to `{label, earned, max, note}` (label =
category, max = weight). Do not change `src/drill-arch.js` to please the
dialog. Do not change the D-series dialog to please A-series without a test
that both shapes still render.

Tick `abn.drill` / `abn.pass` for A-drills the same way D-series does, using
the A-series pass mark.

Test: start A6 from the dialog (or `startADrill` after preset), end it, assert
`trainingRecords[0].drill === 'A6'` and the rendered `recRows` line has a
readable breakdown. Positive control: D1 still writes a D-shaped record.

C1 and C2 are one page commit (or C1 commit then C2 commit, same agent, tree
clean between). Rebuild dist in that commit. Never commit the page while
another agent holds it. Grok is not holding it.

---

## 5. Optional, needs a word from Anthony before you start

- **Debrief category inside `driveDrill`.** A perfect S3 run scores 90 because
  DEBRIEF is unreachable in the live Diagnose script. Wiring
  `TRAINING.DEBRIEF` would move A1's golden from 90 to 100. That is a product
  decision, not a bug. Do not recapture A1–A12 to "complete" the rubric.
- **A12 process cascade.** Would require a new reserved pair or a D1 exception.
  Finding stays until he names it.

---

## 6. Verify, every commit

```text
node --test tests/*.test.js     # glob is load-bearing on node 22
python3 tools/build-dist.py     # stamps MODEL_ID; never hand-edit the generated file
tools/smoke.sh
```

Then, against the **sha**, not the tree:

```text
git clone -q --no-hardlinks <repo> <scratch>
git -C <scratch> checkout -q --detach <sha>
# suite + build + smoke inside <scratch>
```

Do not use `git archive`. MODEL_ID is provenance; assert digests, never the id.
S0 goldens must still match `f8301fb`.

---

## 7. Traps this build already paid for

- `node -e` flips the UMD branch. Test from real files only.
- `undefined < 3` is false. Snapshot migration keys on absence.
- Scorer reads retained ActionEvents (`P.aDrill.events`), never the journal.
- 8 D-drills, not 12. `air` is PROCESS, not ARCHITECTURE.
- `applyPreset` calls `initSim`, which nulls `P.aDrill`. Preset **before**
  `startADrill`.
- `BIASED_MEASUREMENT` without magnitude throws. Never hand it the live rand.
- Dist is a seed artifact. Deleting it is unrecoverable from this repo alone.

---

## 8. Report shape (return this, nothing else)

```text
HEAD_BEFORE: <sha>
ITEMS_DONE: [B1|B2|C1|C2|...]
ITEMS_SKIPPED: [{id, reason}]
FILES: [paths actually edited]
SUITE: <n> tests / <pass> pass / <fail> fail / <skip> skip
SHA_VERIFIED: <sha or NOT>
S0_UNMOVED: yes|no
FINDINGS: [...]
PUSHED: no
TAGGED: no
```
