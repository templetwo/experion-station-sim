<!-- @artifact dev -->
# Convergence spec: binding verification against the checkpoint

**Status:** verification pass, 2026-09-13, MacBook seat (claude-opus-5).
**Resolved:** all five corrections accepted by Anthony the same day and landed in spec **rev 2**.
This memo is the receipt for that revision and is **not** superseded by it — the spec records what
to build, this records what was checked and found. §6 below is the resolution record.
**Subject:** `docs/dev/CONVERGENCE-SPEC.md`.
**Checkpoint verified against:** `516bef8f4a13bf5a6bfc7ff773863abd73887f28` ("release: v3.1.0",
2026-09-03). Working tree clean at the time of the pass; HEAD is the checkpoint exactly.

The spec's §0.1 and its Appendix A repo-file note say the same thing in two places: it was
authored against the public README, not a live working tree, and **every place it names a hook,
function or token, a builder must confirm that name in the file before binding to it.** This
document is that confirmation. Nothing here changes the spec's intent; it corrects the spec's
map of the code and flags one place where the spec contradicts its own additive rule.

Read this before W1. Five of the corrections below change which file a work item opens.

---

## 0. Baseline at the checkpoint

| Gate | Result |
|---|---|
| `node --test tests/*.test.js` | **879 tests, 878 pass, 1 skipped, 0 fail**, 4.5 s |
| Top-level subtests | 622 |
| Working tree | clean |

Note for `CLAUDE.md`: its Commands block still says "197 tests". The real count at this
checkpoint is 879. Stale, harmless, worth a one-line fix when something else touches that file.

---

## 1. Confirmed exactly as the spec states

These bind as written. No builder action needed.

| Spec claim | Verified at |
|---|---|
| `stepU1`..`stepU4`, hand-written per-unit lumped models | `src/models.js:447,536,605,707` |
| Their signature is `(P, L, V, dt, ctx)` | `src/models.js:447` etc. |
| `step()` composes the four units | `src/models.js:716-721` |
| Simulation advances at dt = 0.5 s | `Experion Station Simulator.dc.html:2721` (`this.step(0.5)`), driven by `setInterval(…,500)` at `:1832` |
| Safety-gate tokens `MODE.SET`, `POINT.SUPPRESS`, `INTERLOCK.DEFEAT` | `src/drill-arch.js:124-126`, used as `gate.actionType` at `:247-463` |
| 80 % pass mark on scored debriefs | `PASS_MARK = 80` at `src/training.js:34` **and** `src/drill-arch.js:108` |
| PID faceplate parameters are `K`, `T1`, `T2` (minutes) | `src/pid.js:6,14-15`; `isaForm(K,T1,T2)` at `:42` |
| Modes MAN / AUTO / CAS, bumpless `transferMode` | `src/pid.js:25-35,137-138` |
| Coach projection is read-only and operator-visible | `tools/coach/projection.js:32,105` — sole export `build(c)` → `{alarms, points, selected, help, drill}`, capped at 10 tags (`:43`) |
| PIP prompt already forbids the three moves | `tools/coach/prompt.txt:30` — *"Never advise defeating an interlock, forcing a tripped motor, or making a blind mode/SP/OP change."* Verbatim match to spec §5.2.3 |
| PIP never sees instructor truth | `tools/coach/prompt.txt:25`; app feeds `healthProjection`, never `truthProjection` (`…dc.html:5060,5084`) |
| Sidecar is local-only | `tools/coach/serve.py:34` — `HOST = "127.0.0.1"` |
| ISA-18.2 already registered, do not duplicate | `docs/RESOURCES.md` §2.5 (alerta ISA-18.2 state machine) |
| Per-unit build-contract pattern exists to generalise | `docs/dev/U4-SEPARATOR-CONTRACT.md`, §0 "Two rules that make this unit additive" |
| Artifact marker convention, first three lines | `docs/dev/ARTIFACT-CLASSES.md:18-31` |

---

## 2. Corrections required before a builder binds

### 2.1 Interlocks are **not** in `src/fault-engine.js`

The spec (§3.1.1) says *"Today interlocks are expressed in code inside `src/fault-engine.js` and
the unit models."* The first half is wrong. `src/fault-engine.js` contains **no interlock and no
trip logic whatsoever.** Its entire public surface is the architecture-fault graph:

```
FAULT_IDS, FAULT_DEFS, getFaultDef, createState, activate, deactivate,
isActive, listActive, measurementBias, computeHealth, healthProjection,
symptomProjection, truthProjection, snapshot, restore      (src/fault-engine.js:575-583)
```

Every process interlock and trip lives in `src/models.js`, inside the unit step functions.
There are **six** trip sites, all funnelled through one helper:

| Trip | Site |
|---|---|
| TK-101 `HIHI TRIP`, tank ≥ 98 % | `src/models.js:357` |
| R-201 `HI TEMP TRIP`, `c.tripT` (185 °C) | `src/models.js:385` |
| V-401 `PSV LIFT`, drum 950 kPa | `src/models.js:409` |
| R-202 `HI TEMP TRIP` (adiabatic-temperature interlock) | `src/models.js:519` |
| R-310 `HI TEMP TRIP`, bed `c.tripT` (480 °C) | `src/models.js:593` |
| V-502 `PSV LIFT`, separator 1100 kPa | `src/models.js:679` |

`CLAUDE.md` hard rule 4 names five trip thresholds; the sixth (V-502, 1100 kPa) arrived with
Unit 04 in v3.1.0. A C&E matrix must carry six rows, not five.

**Action:** in §3.1.1, §3.1.3 and §10.2, replace `src/fault-engine.js` with `src/models.js` as
the home of existing interlock logic. `src/fault-engine.js` stays relevant to item 2 only where
an architecture fault is a *cause* feeding the matrix, never as the place trips are declared.

### 2.2 Item 2 as written cannot be additive — but there is a seam that makes it additive

This is the one structural problem, and it follows directly from 2.1.

The spec's §3 general rule is that `stepU1`..`stepU4` *are not touched by v3.2*. Item 2 proposes
to lift interlock logic out of code into a matrix the engine reads each tick and whose fired
effects it applies. Because the interlocks are **inside** those step functions — and because
their *effects* are inline too (the `P.trips.*` flags gate feed isolation, valve closure and fuel
shutoff within the same functions) — replacing them with a matrix evaluator necessarily edits
`stepU1`..`stepU4`. Item 2 as literally specified is therefore **not additive** and would fall to
the spec's own §3.1.7 stop condition.

The seam that saves it is already in the code:

```js
function raiseTrip(ctx, src, cond, val, eu, desc) {
  ctx.raise(src, cond, 'Urgent', val, eu, desc);
  if (ctx.onTrip) ctx.onTrip(src, cond);        // src/models.js:294-297
}
```

`ctx.onTrip(src, cond)` is an **existing optional hook**, documented at `src/models.js:40`, fired
once per equipment trip. Every one of the six trips passes through it.

**Recommended re-scope of item 2, preserving the training value and the additive rule:** the C&E
matrix becomes a *declarative assertion layer*, not a replacement evaluator. The matrix declares
cause → effect for all six trips; a reader subscribes to `ctx.onTrip` and asserts that what the
code fired is what the matrix declared, flagging any divergence. The operator gets the real
artifact — a C&E chart display — and `INTERLOCK.DEFEAT` is scored against the declared matrix,
exactly as §3.1.4 and §3.1.6(c) intend. Dynamics do not move, so §3.1.7 holds and the goldens
stay byte-for-byte. Replacing the code with the matrix as the source of truth becomes a v4 item
alongside items 1 and 5, where the golden re-capture is already budgeted.

If Anthony prefers the spec's literal reading instead, item 2 moves behind gate 8.1 with items
1 and 5, and W2 leaves the v3.2 line.

### 2.3 Item 3 has no "effects hooks in `src/fault-engine.js`" to call

§3.2.3 binds the scenario scheduler to *"the existing effects hooks in `src/fault-engine.js`."*
No such hooks exist — see the export list in 2.1. `fault-engine.js` is a pure state machine:
`activate`/`deactivate` mutate a fault-state object, and the *effects* are pulled by the app
(`measurementBias` at `…dc.html:2751`, `healthProjection` at `:5084`, `truthProjection` at `:4274`; `computeHealth` is internal to the module and is never called from the app).

The actual injection path the scheduler should drive is the app method:

```
injectFault(k, on)                              Experion Station Simulator.dc.html:3111
```

The repo already treats this as the single physics path and says so in a comment at
`…dc.html:3344`: *"apply() calls the EXISTING injectFault(k,on) unchanged — physics is …"*, and
again at `:3363` *"the one, unchanged physics path"*. There is also an existing time-triggered
precedent for exactly what item 3 generalises, at `…dc.html:3122`:

```js
if(!d.injected && P.t>=d.ti && (!def.when || def.when(P))){ d.injected=true; d.tInj=P.t; this.injectFault(def.fault,true); }
```

That is already a time trigger plus an optional predicate trigger. Item 3 is the declarative
generalisation of this line, not new machinery.

**Action:** in §3.2.3 and §10.3, bind the scheduler to `injectFault(k,on)` and to the existing
`d.ti`/`def.when` trigger precedent, not to non-existent fault-engine effects hooks.

### 2.4 Drill start is in `src/drill-arch.js`, not `src/training.js`

§3.4.3 puts the DOF pre-drill validator in *"`src/training.js` at drill start."* `src/training.js`
has no drill-start path. Its export list is competency and record-keeping only:

```
GROUPS, PASS_MARK, PASS_LABEL, tasks, coverage, coverageSummary,
addRecord, recordFor, message, pending, SIGNED_ACTIONS, configChange    (src/training.js:149-150)
```

The A-series drills, their gates and their scoring live in `src/drill-arch.js`; the start path
itself is in the app.

**Action:** §3.4.3 and §10.1 bind to `src/drill-arch.js` plus the app's drill-start path.
§3.5.3 (item 7, curriculum graph read by "training-record and coverage machinery") is **correct
as written** — that genuinely is `src/training.js`.

### 2.5 The debrief timeline is `rows`, and `build()` is the entry point

§3.2.6(c) asserts against "the debrief timeline (`src/debrief.js`)". The concrete surface is:

```
build(input, opts) -> { rows, refusals, lanes, projection, t0, t1, score, summary }
                                                            (src/debrief.js:248-252)
```

`rows` is the timeline, sorted deterministically by `(t, lane, seq, text)` at `:232-239`. A
scenario-event assertion should look for its event in `build(...).rows`. Not an error in the
spec, just the name a builder needs.

### 2.6 `src/data/` does not exist

Items 2, 3 and 7 all propose paths under `src/data/`. There is no such directory at the
checkpoint; `src/` is flat, 19 `.js` files. Creating it is fine, but note two consequences the
spec does not mention:

- Every new file needs `// @artifact production` in its first three lines or
  `tests/artifact-classes.test.js` fails (`docs/dev/ARTIFACT-CLASSES.md:18-31`).
- `tools/build-dist.py` inlines `<script src="./…">` tags found in the page, so a new data module
  needs its `<script>` tag added to the app `<head>` **before** `support.js` — no build change,
  but the tag is not optional. Confirm the inliner's path handling copes with a subdirectory
  before committing to `src/data/` over flat `src/cause-effect.js`.

---

## 3. `docs/RESOURCES.md` is a different shape than the spec assumes

The spec treats RESOURCES.md as a citation registry and repeatedly says "registered in
docs/RESOURCES.md". It is not that. It is a **sourcing guide** — six sections about what may be
used and how (§1 "Does Honeywell have a GitHub / public code?", §2 "Use freely", §3 "Reference
only, never copy", §4 "Better process dynamics", §5 "Suggested next five changes", §6 "Dropped in
verification"). Entries carry a licence and a usage ruling, not a bibliography line.

Gate 8.5 is therefore real and larger than the spec implies. Of the sources the spec cites,
**present** in RESOURCES.md: ISA-18.2 (12 mentions), EEMUA 191 (5), ISA-101 (6), Seborg (5).
**Absent entirely** (zero occurrences): Luyben, Skogestad, Ziegler & Nichols, Cohen & Coon,
Åström & Hägglund, IEC 61511, ISA-75.01.01, CCPS *Safe Automation*, Mehta & Reddy, Law, Banks
et al., Bloom, Ascher & Petzold, Gear & Wells, Karassik.

That is **15 sources to register**, not the three named in gate 8.5. Items 2 and 4 both need
registrations before they can be built under the "cite or drop" rule, so this is not only a v4
precondition — it blocks W2 and W4 as well. §2.19 ("Standards — purchase required, cite clause
numbers only") is the right home for IEC 61511 and ISA-75.01.01; the textbooks and papers need a
new section, and adding one is itself a small decision for Anthony since it changes the document's
shape.

---

## 4. Golden state, for the additive claim

The goldens the spec must not move are:

```
tests/golden-drills.test.js      200 lines
tests/golden-upsets.test.js      315
tests/golden-u4.test.js           84
tests/v2-baseline-archive.test.js 41
tests/fixtures/                  8 drill-*.json, 13 upset-*.json, arch/, u4/, v2-baseline/
```

`tests/v2-baseline-archive.test.js` already enforces option A and passes at the checkpoint — its
final subtest reads *"the archive was a verbatim copy of the live goldens at the moment of
archiving (no live golden has moved yet)."* Anthony's option-A ruling is machine-enforced, not
merely documented. Any v3.2 work item that reddens that test has failed its additive claim, which
gives §9.2 a concrete gate rather than a manual diff.

---

## 5. Net effect on the work order

The spec's §10 sequence survives verification. Three amendments:

- **W1 (item 6)** — unchanged in scope; bind to `src/drill-arch.js` + app drill-start, not
  `src/training.js`. Still the right first item.
- **W2 (item 2)** — **blocked pending Anthony's call** between the assertion-layer re-scope (2.2,
  stays in v3.2) and the literal replacement reading (moves behind gate 8.1). Also blocked on
  registering IEC 61511 and CCPS in RESOURCES.md.
- **W3 (item 3)** — unchanged in scope; bind to `injectFault(k,on)` and the existing `d.ti`/
  `def.when` precedent.
- **W4 (item 4)** — unchanged; blocked on registering Seborg 4th ed. properly plus Skogestad,
  Ziegler & Nichols, Cohen & Coon, Åström & Hägglund.
- **W5–W8** — no binding errors found. §3.5.3 and §5.2.2 verify clean.

Streams B and C verify clean throughout. The PIP prompt, the projection boundary and the
127.0.0.1 sidecar are all exactly as the spec describes, which is the part of the document that
was least guessable from a README and is nonetheless correct.

---

## 6. Resolution — what Anthony ruled, 2026-09-13

All five corrections taken. Landed in spec rev 2 the same day. His rulings, verbatim in substance:

**Correction 1 (interlocks are in `src/models.js`)** — accepted as fact. `CLAUDE.md` rule 4
corrected from five trip thresholds to six, with a pointer to `raiseTrip` as the live list.
`UPGRADE-PLAN.md` rule 4 and `V3-PLAN.md` still say five and were **deliberately left alone**:
they are the canonical rules document and a historical stage contract respectively, both written
before Unit 04, and amending binding law is a larger call than correcting the onboarding
compression of it. Rev 2 §3.1.1 and `CLAUDE.md` both say so explicitly, so a reader who meets the
stale "five" knows why it is there. **This remains open for Anthony to rule on separately.**

**Correction 2 (item 2 cannot be additive as written)** — ruled: **assertion layer**. The code
stays the source of truth for v3.2. The matrix declares the six rows; a reader subscribes to
`ctx.onTrip`, renders the C&E chart and scores `INTERLOCK.DEFEAT`; a suite test asserts code
equals matrix across scripted upsets. **No runtime enforcement.** Matrix-as-source-of-truth moves
to v4 behind gate 8.1, which rev 2 amends to carry three items instead of two.

This is the stronger form of the item, not a concession. The rev-1 design would have been additive
only by luck — by the matrix happening to agree with the code — whereas the assertion layer is
additive by construction and *proves* the agreement it used to assume. Rev 2 §3.1.6(e) makes that
falsifiable: deleting the reader must leave every golden byte-identical.

**Correction 3 (no effects hooks in fault-engine)** — accepted; W3 binds to `injectFault(k, on)`.

**Correction 4 (drill start is not in `training.js`)** — accepted; W1 binds to `src/drill-arch.js`
plus the app.

**Correction 5 (RESOURCES.md is not a citation registry)** — ruled: **W0, before W1.** Register
every source first; nothing builds on an unregistered source.

### 6.1 Two things found while landing the rulings

Both were found after the memo above was written, while executing W0 and rev 2. Recording them
here rather than silently folding them in, because each changes a number Anthony had already been
given.

**The source count was 15 names but 22 works.** §3 of this memo counted absent *names*. Executing
W0 showed the real load: Luyben is two distinct books; the Seborg **textbook** (*Process Dynamics
and Control*, 4th ed., 2016) is a different work from the Henson/Seborg CSTR *parameters* already
registered at RESOURCES §4.4, and was absent; and all five operator-training-simulator papers
cited in spec §3.2.8 and §3.5.8 (Balaton 2013, the Rev. Chem. Eng. review, Processes 2015,
Petroleum Science 2017, Applied Sciences 2023) were absent, which §3 above did not check. Under
"nothing builds on an unregistered source" those five block W3 and W5. All 22 are registered at
`docs/RESOURCES.md` §7, ids 7.1–7.22, each its own subsection per the §4 lesson, each
**CITED-NOT-HELD**: identifier verified, no copy read by this project, citable for a concept and
not for a number until held.

**Item 3 substantially overlaps an existing feature.** `ESS.Instructor.compoundScripts`
(`src/instructor.js:365`) already runs **ordered fault timelines** — the CHANGELOG 3.0.0 entry
describes it as exactly the V3-PLAN §8 example, "net-path degradation, then a transmitter bias,
then history loss", with RUN scheduling each step through the same `ARCH_FAULT_ACTIVATE` dispatch
as a matrix injection. The spec proposes scenario schedules as though nothing of the kind exists
and never mentions it. Item 3 is therefore closer to a *format upgrade* of a shipped mechanism
than to new machinery — a good thing for its additive claim, and a trap if a builder ships a
second scheduler beside the first. Rev 2 §3.2.3, §3.2.6(d) and §10.3 now require W3 to extend or
subsume `compoundScripts` rather than duplicate it.

### 6.2 What W0 did not settle

The `CITED-NOT-HELD` status is honest but it is also a live constraint, and it will bite at W4
first. Item 4 grades a trainee's tuning against a public rule; SIMC (RESOURCES-7.4) is registered
and identified, but grading requires the *actual* rule — specific formulae for controller gain and
integral time from the fitted FOPDT parameters. That is a number, not a concept, so under the
status rule as written W4 cannot proceed on 7.4 alone: a copy has to be held, read, and the status
changed. Same pattern for the historical rules at 7.5 and 7.6. Flagging it now rather than at W4,
because acquiring a paper is a lead-time problem, not a coding one.

### 6.3 The verify pass on rev 2 itself, and what it caught

Rev 2 and the W0 registration were themselves put through an adversarial verification pass before
commit, on the repo's standing rule that the verifier caught a real bug at every v2 integration
step. Four finder agents on disjoint dimensions — code bindings, source registrations, repo gates
and receipt claims, cross-document consistency — each finding then handed to two independent
skeptics prompted to refute by default. Twenty agents, zero errors.

It found **eight real defects in this same day's work**, one of them blocking. Recorded here
because a verification memo that does not report the verification of itself is worth less.

| # | Dimension | Defect | Severity |
|---|---|---|---|
| 1 | bindings | `computeHealth` cited as an app call site at `…dc.html:5084`. It is internal to `src/fault-engine.js` and is never called from the app; only `healthProjection` is, at that line. | minor |
| 2 | sources | `RESOURCES-7.21`'s Used-by line claimed "item 1 background (v4)", a citation the spec never makes. | important |
| 3 | sources | W0's acceptance criterion cited `tests/provenance.test.js` as proof of the registration. It is not: that test reads only `sourceBasis` arrays in `src/topology.js` and `src/drill-arch.js`, never this spec, and no `src/` module cites a `7.x` id yet — it would pass identically if §7 were deleted. | important |
| 4 | consistency | **§9.5 still carried rev-1's "matrix-driven trips match legacy trips tick-for-tick"** — the exact runtime-enforcement design Anthony's ruling rejected, surviving in the one section rev 2 had not rewritten, contradicting §3.1.1, §3.1.3, §3.1.6 and §10.2. | **blocking** |
| 5 | consistency | Items 3, 6 and 7 still told a builder to "register the artifact class in `ARTIFACT-CLASSES.md`" — the instruction §3.1.2 withdraws for item 2, in the same document. | important |
| 6 | consistency | Items 3 and 7 still proposed `src/data/` paths without the caveat §3.1.2 applies to item 2, though §2.6 of this memo names all three together. | minor |
| 7 | consistency | §4.1.5 and §4.2.4 still read "Register all of these before item 1 is built" after W0 had registered them. | minor |
| 8 | consistency | `CLAUDE.md` still said "197 tests" — the staleness §0 of this memo flagged as "worth a one-line fix when something else touches that file", in a change that then touched that file. | minor |

All eight fixed before commit. Two lessons worth carrying, both of which generalise past this repo:

**A correction applied to one item does not propagate itself.** Five of the eight (#4, #5, #6, #7,
and arguably #8) are the same failure: a ruling or correction was applied where the discussion of
it lived and not to the other sections making the identical claim. §3.1 was rewritten carefully
and §9.5 — one line, in a different section, about the same item — kept the rejected design. When
a rev corrects a *class* of statement, grep the whole document for the class, not the section.

**"A test is green" is not evidence unless the test covers the claim.** Defect #3 is the sharper
one, because the green result was real and the inference from it was wrong. `provenance.test.js`
passes, and it would pass with §7 deleted. The honest acceptance had to say what the test does
not reach, and name the work item (W2) at which it starts to bite. This is the same failure shape
as the v3.0.0 release-gate note already in `CHANGELOG.md` — *pinning an exception's location is
not testing its condition*.
