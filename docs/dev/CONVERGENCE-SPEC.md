<!-- @artifact dev -->
# V3.2 / V4 CONVERGENCE SPEC

Path at commit: docs/dev/CONVERGENCE-SPEC.md
Working title: V3.2 / V4 CONVERGENCE SPEC
Owner: Anthony Vasquez Sr. (github.com/templetwo, "The Temple of Two")
Builder seats: Claude Code (HQ, lead/integrator), Codex, Grok
Status: **rev 4**, 2026-09-13. Verified against the checkpoint; item 6 renamed after it was built; §3.1.6(d) reworded after W2 found it had no join key.

**Revision history**
- rev 1, 2026-09-03 — authored against the repository's public README. Proposal only.
- rev 2, 2026-09-13 — every hook, function and token binding confirmed against checkpoint
  `516bef8` by the MacBook seat (claude-opus-5); five binding errors corrected in place, item 2
  re-scoped on Anthony's ruling, and work item **W0** inserted ahead of W1. The evidence for each
  correction, with file:line, is `docs/dev/CONVERGENCE-SPEC-VERIFICATION.md`; that memo is the
  receipt for this revision and is not superseded by it.
- rev 3, 2026-09-13 — W1 built, and building it changed the item. Item 6 renamed from "explicit
  boundary streams and a degrees-of-freedom check" to **"specification integrity at drill start"**,
  because the DOF check as specified cannot fail on this plant and the old title promised what the
  plant does not cash. §3.4 reframed as a declared plant map plus two lanes; §3.4.6(b) moved to a
  lane B test; §4.1.4 now binds item 1 to *reading* the plant map rather than inferring couplings;
  §10.1 marked done with the two binding corrections the build found. Anthony's rulings of
  2026-09-13 throughout. Build contract: `docs/dev/W1-BOUNDARY-DOF-CONTRACT.md`.

---

## 0. Provenance and separation

0.1 Checkpoint. This spec is authored from checkpoint commit 516bef8f4a13bf5a6bfc7ff773863abd73887f28, the "release: v3.1.0" commit dated 2026-09-03. main has not moved since. Every file path in this document is a path that exists at that checkpoint unless it is marked "proposed". 
**rev 2 status of the confirm-before-binding instruction.** Rev 1 told builders to confirm every function and hook name against the checkpoint before writing code, because rev 1 was authored against the repository's public README, CHANGELOG and dev-doc conventions and not against a live working tree. That pass has now been done in full at the checkpoint — `docs/dev/CONVERGENCE-SPEC-VERIFICATION.md`, file:line for every claim. It found five binding errors, all corrected in this revision. A builder no longer has to re-derive them. The standing rule does not lapse, though: **anything this spec names that the memo does not cover is still unconfirmed and is verified in the file before it is bound to.** The memo's §1 is what verified clean; its §2 is what moved.

0.2 The two-lane rule. There are two lanes and they never cross. Lane one is this public repository: an independent training aid built by Anthony under MIT. Lane two is AIRCO (Air Company, New Britain, PA) work. Anything plant-specific, and anything made on company time, is AIRCO work in AIRCO systems and never enters this repository. MIT already permits AIRCO to use the public repository. Improvements made on company time stay in the company's copy. This spec adds nothing to lane two and takes nothing from it.

0.3 Manual points, literature cites. This spec was motivated by professional education Anthony received as an AIRCO employee. Concepts may come from professional education; every implementable statement in this document cites an open source registered in docs/RESOURCES.md, or a named file in this repository. Where a statement cannot cite an open source or a repo file, it is not implementable and is written as an open question in section 8.

0.4 Provenance and separation note (one line, as required). The reading that motivated this spec was a vendor dynamics training course sent to Anthony by a senior AIRCO colleague; nothing from that course, no equation, default, workshop case or product vocabulary, is transcribed or paraphrased here, and that course, its vendor and its product are named nowhere in this document as a source, because the only citable sources are the open standards and published literature in docs/RESOURCES.md.

0.5 No vendor content. Rule 1 stands (section 2). This document contains no vendor or Honeywell software, artwork, manual text, equations, defaults or product vocabulary. All process content derives from published literature models and open standards registered in docs/RESOURCES.md. Ownership of the simulator does not change with the label on the reference database.

---

## 1. Purpose and what converges

1.1 Purpose. To specify, for the builder seats, one additive season of work (v3.2) plus one gated future line (v4), and to hold both to the repository's standing rules and to Anthony's prior rulings on additive discipline and golden baselines.

1.2 Three streams converge here:

- Stream A: seven structural items that make the process engine teach more without pretending to be a plant. Items 2, 3, 4, 6 and 7 are additive and ship as the v3.2 line. Items 1 and 5 change the dynamics of existing units and are therefore the gated v4 line.
- Stream B: the advisory-only PIP coach grows an "observe arm" that is also a clean fixture for Anthony's other public repo, project-epistemic-bound (peb). This is a shadow-mode log plus a data contract, not a merge.
- Stream C: a disciplined intake protocol for fidelity feedback from an expert colleague, governed by the repository's existing site-blind rules.

1.3 What does not converge. The simulator core stays network-free (Rule 7). The coach stays advisory-only. The peb fixture is a decision for Anthony, not a done deal (section 5, section 8).

---

## 2. Standing rules restated

These are the repository's standing rules and Anthony's prior rulings. They are restated here so the builder seats obey them without leaving this document. The canonical wording lives in the repository's rules documents (docs/dev/UPGRADE-PLAN.md and the dev plan set); where this spec paraphrases, the canonical text governs on conflict. Builders confirm the numbered rule text against those files at the checkpoint.

2.1 Rule 1: no vendor content of any kind. No vendor or Honeywell software, artwork, or manual text; representative defaults only. The public README already states the product "Contains no Honeywell software, artwork, or manual text" and is an "Independent training aid, not a Honeywell product"; the numbered Rule 1 in the dev docs is the internal form of that public disclaimer.

2.2 Rule 6: no employer or real-site material, ever. All process content derives from published literature models and open standards registered in docs/RESOURCES.md. Ownership does not change with the database label. Site-specific data never enters the repository (see Stream C).

2.3 Rule 7: the simulator core is network-free; the coach is an optional sidecar. The raw simulator page never fetches. The README states plainly that the raw .html cannot talk to a model because browsers block it, and that "the page still only talks to the local sidecar, and the raw .html stays offline." The AI coach runs as a local sidecar (tools/coach/). Any feature in this spec that would make the sim page reach the network is out of scope by Rule 7.

2.4 Additive discipline. v2 and v3 golden baselines must not move. Anthony ruled (option A): goldens are archived byte-for-byte before any re-capture. Any change that alters the dynamics of existing units is not additive and belongs to a separately gated line. v3.2 (Stream A items 2, 3, 4, 6, 7) is additive. v4 (items 1, 5) is gated.

2.5 Decision-gate discipline. Anthony's decision gates are listed in one place (section 8), each with the prior rulings of the same shape surfaced beside it, and it says plainly when no prior ruling exists.

---

## 3. Stream A additive line (v3.2): items 2, 3, 4, 6, 7

General rule for this section: every new artifact is data, read by the engine, not new dynamics inside the per-unit models. The per-unit lumped models (the stepU1 through stepU4 functions in src/models.js, hand-written, flow-driven, stepped at dt = 0.5 s) are not touched by v3.2.

**Verified (rev 2).** `stepU1`, `stepU2`, `stepU3`, `stepU4` exist under exactly those names at `src/models.js:447, 536, 605, 707`, each with the signature `(P, L, V, dt, ctx)`, composed by `step()` at `:716-721`. There is **no dt constant in src/models.js** — `dt` is a caller-supplied parameter. The 0.5 s figure is set at the call sites in the app: `this.step(0.5)` at `Experion Station Simulator.dc.html:2721`, pumped by `setInterval(() => this.tick(), 500)` at `:1832`. A builder needing to change the rate changes the call sites, not the models.

### 3.1 Item 2: interlocks as a cause-and-effect matrix (data)

3.1.1 What it is, in the engine's terms. **Corrected and re-scoped in rev 2 — read this whole clause before building.**

Rev 1 said interlocks are expressed in code inside `src/fault-engine.js` and the unit models, and proposed to *lift* that logic into a matrix the engine reads each tick and whose fired effects it applies. Both halves were wrong, and the second was wrong in a way that broke this spec's own additive rule.

**Where the interlocks actually are.** `src/fault-engine.js` contains no interlock and no trip logic at all; it is the architecture-fault state machine (`FAULT_IDS`, `activate`, `deactivate`, `measurementBias`, `computeHealth`, `healthProjection`, `symptomProjection`, `truthProjection`, `snapshot`, `restore` — `src/fault-engine.js:575-583`). Every process interlock and trip lives in `src/models.js`, **inside** the unit step functions, and there are **six**, not five:

| # | Trip | Site |
|---|---|---|
| 1 | TK-101 `HIHI TRIP`, tank ≥ 98 % | `src/models.js:357` |
| 2 | R-201 `HI TEMP TRIP`, `c.tripT` (185 °C) | `src/models.js:385` |
| 3 | V-401 `PSV LIFT`, drum 950 kPa | `src/models.js:409` |
| 4 | R-202 `HI TEMP TRIP` (the U2 adiabatic-temperature interlock) | `src/models.js:519` |
| 5 | R-310 `HI TEMP TRIP`, bed `c.tripT` (480 °C) | `src/models.js:593` |
| 6 | V-502 `PSV LIFT`, separator 1100 kPa | `src/models.js:679` |

The sixth shipped with Unit 04 in 3.1.0. `UPGRADE-PLAN.md` rule 4 and `V3-PLAN.md` still say "five"; they predate Unit 04. `CLAUDE.md` rule 4 was corrected to six alongside this revision. The matrix carries six rows.

**Why the rev-1 design could not be additive.** The interlocks are inside `stepU1`..`stepU4`, and so are their *effects* — the `P.trips.*` flags gate feed isolation, valve closure and fuel shutoff within those same functions. An engine that read a matrix and applied fired effects would therefore have to edit `stepU1`..`stepU4`, which §3's general rule forbids for all of v3.2 and which would move the goldens, tripping this item's own §3.1.7 stop condition.

**Anthony's ruling, 2026-09-13 — the re-scope this item now carries.** *The code stays the source of truth for v3.2.* Item 2 becomes a **declarative assertion layer**, not a replacement evaluator:

- The matrix **declares** the six cause→effect rows as data.
- A reader **subscribes** to the existing trip seam and asserts that what the code fired matches what the matrix declares. The seam already exists and every one of the six trips passes through it:
  ```js
  function raiseTrip(ctx, src, cond, val, eu, desc) {
    ctx.raise(src, cond, 'Urgent', val, eu, desc);
    if (ctx.onTrip) ctx.onTrip(src, cond);        // src/models.js:294-297
  }
  ```
  `ctx.onTrip(src, cond)` is an existing optional hook, documented at `src/models.js:40` as *"called once per equipment trip with the alarm source and condition."* Subscribing to it adds no dynamics.
- The reader **renders** the operator-facing C&E chart and **annotates** `INTERLOCK.DEFEAT` against the declared matrix. *Annotates*, not scores — see §3.1.6(d): the defeat resolves to its effect column and the reader reports the cause and the cause-state at reset. The gate's own logic is untouched.
- **No runtime enforcement.** The matrix never fires an effect, never closes a valve, never trips anything. It observes and declares. If matrix and code disagree, a test goes red; the plant does not change behaviour.

Matrix-as-source-of-truth — the matrix actually driving the effects — moves to **v4, behind gate 8.1**, where golden re-capture is already budgeted.

3.1.2 Data contract (proposed path: `src/cause-effect.js`). Each cause row: id, tag, condition (variable, comparator, threshold, on-delay), latched flag. Each effect column: id, target tag, action, reset rule. Each cell: present/absent plus optional voting (for example 2oo3). Each row also carries the `(src, cond)` pair the code's own `raiseTrip` emits, because that pair is the join key the assertion reader matches on. The matrix is instructor-visible and, for the operator, rendered as a C&E chart display.

Three checkpoint facts a builder needs here, none of which rev 1 knew:
- **`src/data/` does not exist.** `src/` is flat, 19 `.js` files. Rev 2 proposes `src/cause-effect.js` at the flat level, matching every existing module, rather than inventing a subdirectory. If a builder still wants `src/data/`, confirm first that `tools/build-dist.py`'s `<script src="./…">` inliner handles a subdirectory path — it is untested against one.
- **The file needs `// @artifact production` in its first three lines** or `tests/artifact-classes.test.js` fails (`docs/dev/ARTIFACT-CLASSES.md:18-31`). No new artifact *class* is created: the existing `production` marker is correct for a `src/` module, and rev 1's instruction to register a new class "C&E matrix" in `ARTIFACT-CLASSES.md` is withdrawn — that document defines exactly two classes on purpose.
- **The `<script>` tag goes in the app `<head>` before `support.js`.** `build-dist.py` inlines what it finds there, so no build change is needed, but the tag is not optional.

3.1.3 Engine binding. **Corrected in rev 2.** There is no matrix evaluator and no new read step in `src/alarm-engine.js`. The binding is one subscription plus two readers:

- **Subscription:** the app supplies `ctx.onTrip(src, cond)` (the seam at `src/models.js:294-297`). The C&E reader receives every trip the code fires, with its source and condition, and records it. `src/models.js` itself is **not edited** — the hook is already there and already optional.
- **Chart reader:** renders the declared matrix as the operator-facing C&E chart display.
- **Annotating reader:** an `INTERLOCK.DEFEAT` resolves to its declared effect column (`DRV-M202`, built as `motorCmd` builds it) and is explained from the declared C&E rather than left unexplained. The **gate itself is unchanged** — it caps exactly what it capped before, and `src/drill-arch.js` is not touched. Rev 1 said the gate "scores against the declared C&E"; that overstated what is possible, and §3.1.6(d) records why.

Verified at the checkpoint: the three safety-gate action types are declared in **`src/drill-arch.js:124-126`** as `MODE_SET: 'MODE.SET'`, `POINT_SUPPRESS: 'POINT.SUPPRESS'`, `INTERLOCK_DEFEAT: 'INTERLOCK.DEFEAT'`, and are used as `gate.actionType` across `:247-463`. The live `INTERLOCK.DEFEAT` gate is drill A5, target `DRV-M202` (`src/drill-arch.js:326`). That file, not "the drill rubric", is where a builder binds.

3.1.4 Training rationale. Operators must read a C&E chart, know which cause trips which final element, and understand why defeating one interlock changes the blast radius. A data-driven C&E chart is the artifact they will meet on a real console.

3.1.5 Additive or gated. Additive **as re-scoped in 3.1.1**, and additive for a stronger reason than rev 1 claimed. Rev 1 argued the matrix was additive because it would reproduce existing behaviour; that argument fails, because a matrix that *applies* effects has to be wired into the step functions to do so, and the wiring moves dynamics whether or not the declared behaviour matches. The assertion layer is additive by construction: it subscribes to an existing optional hook, writes nothing back, and can be deleted without changing a single trajectory. Nothing in the v3.2 cut of item 2 can move a golden, because nothing in it can change what the plant does.

Matrix-as-source-of-truth is **gated** — v4, gate 8.1.

3.1.6 Acceptance tests. Restated for the assertion layer.

(a) **Code equals matrix across scripted upsets.** For each of the six trips in the 3.1.1 table there is exactly one matrix row, and a suite test drives the scripted upsets that reach each trip, collects what `ctx.onTrip` actually emitted, and asserts the emitted `(src, cond)` sequence equals what the matrix declares — same trips, same order, same tick. This is the test Anthony named. Note the assertion runs against the *code's* firing, not against a parallel evaluation: there is no second implementation to drift.
(b) Every matrix row is reachable — no row declares a trip no scripted upset can fire — and no trip fires that has no row. Both directions, so the matrix cannot go stale in either.
(c) The C&E chart renders every row and column with no orphan cells.
(d) **`INTERLOCK.DEFEAT` is scored from the matrix, by annotation.** Reworded in rev 4 (Anthony, 2026-09-13) after the build found the original had no join key: `DRV-M202` is not a `raiseTrip` source and no M202 interlock existed as declarable logic, so "scored from the matrix" had nothing to look up.

**The join key is the effect column, named `DRV-M202` exactly as `motorCmd` builds it** — `archSynthEvent('INTERLOCK.DEFEAT','DRV-'+tag,null)`. A string equality, and nothing else connects the drill gate to the matrix, so the id is pinned against the app's own template.

**Scored from the matrix means: the defeat resolves to that column, and the reader annotates the cause and the cause-state at reset. Annotation only.** `ESS.CauseEffect.annotateDefeat(target, causeState)` returns text — no score, no cap, no severity — and `src/cause-effect.js` does not reference the drill scorer in code at all. **Gate logic is unchanged and no A-drill score moves.** A test pins the return shape and the absence of the scorer reference, so the boundary cannot erode.

The matrix earns the join by declaring the motor interlocks **as they actually are**: latched, manual-reset by START after a 30 s lockout, recorded — and **advisory, not enforced**, because `motorCmd` clears the latch and starts rather than refusing. The one motor guard that genuinely refuses, P-101's level permissive, is declared as an enforced row beside them. Every row true of the code, or no row.
(e) **No runtime enforcement, proven, not asserted in prose:** a test confirms that deleting the C&E reader entirely leaves every golden digest byte-identical.
(f) `node --test tests/*.test.js` stays 0 fail.

3.1.7 Golden impact. None, structurally — see 3.1.5. A read-only subscriber to an existing hook cannot move a golden. If a golden nonetheless differs, the builder has wired the reader into the step path instead of onto the hook; stop and undo, do not re-capture. `tests/v2-baseline-archive.test.js` enforces this mechanically (§9.2).

3.1.8 Sources, with their registered ids (all registered by W0, 2026-09-13): **RESOURCES-7.8** IEC 61511-1:2016+AMD1:2017 Ed 2.1, for the interlock/SIF framing and voting; **RESOURCES-7.10** CCPS *Guidelines for Safe Automation of Chemical Processes* 2nd ed., for safe-automation layers and cause-and-effect practice; **RESOURCES-2.5 / 2.19** ISA-18.2-2016, already registered, where interlock-driven alarms intersect the alarm lifecycle. Cite the subsection id, never a bare `RESOURCES-7`.

### 3.2 Item 3: scenarios as declarative event schedules (data)

3.2.1 What it is. A per-drill event schedule, instructor-visible only: a list of triggers that fire actions. Triggers: elapsed time, a variable crossing a threshold, or an operator action. Actions: inject a fault, drift a setpoint, stick a valve, trip equipment. This lets one drill compose several faults and escalate.

3.2.2 Data contract (proposed path: `src/scenarios.js`, or `src/data/scenarios/*.js` only if the subdirectory caveat in §3.1.2 is cleared first). **The same two corrections §3.1.2 makes for item 2 apply here and were missed in the first pass of rev 2: (a) no artifact *class* is registered — `docs/dev/ARTIFACT-CLASSES.md` defines exactly two classes on purpose, and a new `src/` module simply carries `// @artifact production` in its first three lines; (b) `src/data/` does not exist, `src/` is flat, and `tools/build-dist.py`'s `<script src="./…">` inliner is untested against a subdirectory.** Each scenario: id, drill id, list of events. Each event: trigger (type, parameters), action (type, target tag, magnitude), one-shot or repeating, and a visibility flag fixed to instructor-only. The hidden truth (which fault is active) stays out of any operator-visible projection.

3.2.3 Engine binding. **Corrected in rev 2.** There are no "effects hooks" in `src/fault-engine.js` to call — that module is a pure state machine whose effects are *pulled* by the app (`measurementBias` at `…dc.html:2751`, `healthProjection` at `:5084`, `truthProjection` at `:4274`), not pushed by hooks. `computeHealth` is internal to `src/fault-engine.js` and is never called from the app at all. See 3.1.1 for its actual export list.

The scheduler binds to the app's own fault-injection method:

```
injectFault(k, on)                              Experion Station Simulator.dc.html:3111
```

The repo already treats this as the single physics path and says so twice in comments: *"apply() calls the EXISTING injectFault(k,on) unchanged — physics is …"* (`:3344`) and *"the one, unchanged physics path"* (`:3363`). Routing the scheduler anywhere else would create a second physics path, which is exactly what those comments exist to prevent.

There is also an existing precedent for what item 3 generalises, at `…dc.html:3122`:

```js
if(!d.injected && P.t>=d.ti && (!def.when || def.when(P))){ d.injected=true; d.tInj=P.t; this.injectFault(def.fault,true); }
```

That is already a time trigger (`P.t >= d.ti`) plus an optional predicate trigger (`def.when(P)`), one-shot via `d.injected`. **Item 3 is the declarative generalisation of that line, not new machinery** — which is the strongest available argument that it adds no dynamics. A builder should read it before designing the trigger schema, and should preserve its one-shot semantics.

The scheduler fires on the same 0.5 s tick as the models (set at the call sites, not in `src/models.js` — see §3's general rule). Instructor visibility is routed through `src/instructor.js`, whose surface includes `compoundScripts` (`src/instructor.js:365`) — an **existing ordered fault-timeline mechanism** that item 3 should extend or subsume rather than duplicate. Builders confirm the fault symptom declarations in `src/fault-engine.js` before binding.

3.2.4 Training rationale. Real upsets are compound and they escalate. A declarative schedule lets an instructor build "small leak, then high level, then a spurious trip" without editing code, and lets the debrief show exactly what fired and when.

3.2.5 Additive or gated. Additive. No new dynamics; only sequencing of existing faults and setpoint moves.

3.2.6 Acceptance tests. (a) A scenario with a time trigger and a threshold trigger fires both actions on the expected ticks in a deterministic run. (b) Operator-visible projections never contain the scenario's hidden truth — `tests/leakage.test.js` is the existing gate for this class and the new scenarios belong in it. (c) The debrief timeline lists every fired event: concretely, every fired event appears in `ESS.Debrief.build(input, opts).rows` — `rows` is the timeline, sorted deterministically by `(t, lane, seq, text)` at `src/debrief.js:232-239`; the full return is `{rows, refusals, lanes, projection, t0, t1, score, summary}` at `:248-252`. (d) **A scenario expressed as a `compoundScripts` timeline and the same scenario expressed in the new format produce identical runs**, or the new format replaces `compoundScripts` outright — one mechanism, not two. (e) Suite stays 0 fail.

3.2.7 Golden impact. None. Existing goldens use existing drills; new scenarios are new data behind new drill ids and do not touch the recorded runs. If a scenario is attached to an existing golden drill, that is a golden change and is forbidden under option A without archive-then-recapture (gate 8.2).

3.2.8 Sources, with their registered ids (all registered by W0, 2026-09-13): **RESOURCES-7.12** Law and **RESOURCES-7.13** Banks, Carson, Nelson & Nicol, for the discrete-event trigger/action model; and the peer-reviewed OTS literature for scenario authoring — **RESOURCES-7.18** Balaton, Nagy & Szeifert (2013), **RESOURCES-7.19** the Reviews in Chemical Engineering field review, **RESOURCES-7.20** the bio-ethanol OTS conceptual-design paper in Processes, **RESOURCES-7.21** Lee et al. in Petroleum Science (2017), and **RESOURCES-7.22** the chemical-accident OTS paper in Applied Sciences (2023). Rev 1 cited these five as though they were registered; none were. Cite the subsection id, never a bare `RESOURCES-7`.

### 3.3 Item 4: step-test / loop-tuning drill family (data + grader)

3.3.1 What it is. A drill family: put a loop in MAN, step the OP, read the PV response, estimate process gain, time constant and dead time, then tune with a public rule. The sim grades the trainee's estimates and tuning against the loop's known parameters.

3.3.2 Data contract. Each step-test drill: loop tag, allowed step size, the loop's known first-order-plus-dead-time (FOPDT) parameters (gain, tau, theta) held as hidden truth, the tuning rule to grade against, and pass tolerances. The grader compares trainee-entered K/T1/T2 and the estimated model against the known values. Faceplate parameter names already in the sim (K, T1/T2 in minutes, per the README) are reused.

3.3.3 Engine binding. Uses the existing PID faceplate and MAN/AUTO/CAS modes (src/pid.js) and the existing drill and debrief machinery (src/training.js, src/debrief.js). No model change: the loop's response is whatever the existing unit model already produces; the drill only reads it and grades.

3.3.4 Training rationale. Bump test, read the curve, identify the model, tune: this is the core competency the loop faceplate exists to teach. Grading against known parameters closes the loop for the trainee.

3.3.5 Additive or gated. Additive. Reads existing dynamics; adds a grader and drill data.

3.3.6 Acceptance tests. (a) For a loop with known gain, tau and theta, a scripted open-loop step reproduces a response whose fitted parameters match the known values within tolerance. (b) The grader passes a correct tuning and fails a poor one at the 80% pass mark used by the rest of the drill set (the README confirms the 80% pass mark on scored debriefs). (c) Suite stays 0 fail.

3.3.7 Golden impact. None; new drills, new data.

3.3.8 Sources, with their registered ids (all registered by W0, 2026-09-13): **RESOURCES-7.3** Seborg, Edgar, Mellichamp & Doyle 4th ed., for step-test identification and FOPDT; **RESOURCES-7.4** Skogestad (SIMC) as the primary public tuning rule; **RESOURCES-7.5** Ziegler & Nichols and **RESOURCES-7.6** Cohen & Coon as the historical rules; **RESOURCES-7.7** Åström & Hägglund as the tuning reference. Note that **RESOURCES-7.3 is not RESOURCES-4.4**: §4.4 registers the Henson/Seborg CSTR *parameters* as served by APMonitor, a different work. Cite the subsection id, never a bare `RESOURCES-7`.

### 3.4 Item 6: specification integrity at drill start (declared plant map + two-lane check)

**Renamed in rev 3** (Anthony, 2026-09-13), from "explicit boundary streams and a degrees-of-freedom check". The old title promised a DOF check over boundary streams. The build found that check cannot fail on this plant, and the name was writing a cheque the plant does not cash. The item is now named for what it actually does: **check that a drill starts from a well-specified configuration**, across two lanes, and **declare the plant's topology as data**. Built as W1; see `docs/dev/W1-BOUNDARY-DOF-CONTRACT.md` for the contract and `src/boundary-dof.js` for the module.

3.4.1 What it is, in three parts.

**(i) The declared plant map — the durable artifact.** `ESS.BoundaryDof.PLANT_MAP` records which units are coupled and which are not, derived by reading `src/models.js` field by field rather than inferred from the process prose or the graphic. The finding it encodes: **U3 → U4 is the only inter-unit material coupling in the simulator, carrying exactly three variables (`P.h.f`, `P.h.pre`, `P.h.bed`); U1 and U2 are islands.** U1 has zero `P`-field coupling to U3 — U3's feed comes from `V.FV310.pos` on its own `FIC310` loop. It also declares what is deliberately *not* a boundary (`P.Tcw`, `env.Tamb`, `env.catAct`, the global clock): fields read by two units but written by neither unit's step code, which are instructor and fault inputs rather than material streams.

This map is the item's most load-bearing output, and it is the part item 1 consumes. **Item 1 reads the map; it does not invent couplings.** A pressure-flow network must place a node and a resistance for every real coupling and for no imagined one, and its sharpest exposure is a builder assuming a U1 → U3 feed train the code does not have. The map is falsifiable and tested: every declared field path must resolve on a real `ESS.Models.createState()`, so it cannot drift from the model without a test going red.

**(ii) Lane A — the material-boundary declaration.** Each declared boundary variable carries its spec type (`flow` today; `pressure` once item 1 lands), its producer and consumer sites, and a nominal value with stated provenance. **Lane A says plainly that it cannot fail on this plant**, and emits that statement as a finding (`BOUNDARY_SPEC_STRUCTURAL`) rather than leaving a reader to infer a pass means more than it does: while every variable ships `spec:'flow'`, the producer fixes the value and the consumer accepts it, so contention is not constructible. Its one real refusal is `BOUNDARY_NOT_FINITE` — a boundary variable carrying no valid value, the NaN-leak class the 3.1.0 `VALVE_TARGET` fix documents. Lane A becomes load-bearing the moment a variable's spec becomes `pressure`.

**(iii) Lane B — control-loop configuration, the lane with teeth.** `CASCADE_OPEN` first: a cascade master in AUTO or CAS whose slave has left CAS, so the master is not in control while the board looks normal. Reported, never refused — taking a slave to MAN while its master tracks is ordinary practice and is drill D6's premise, and `pid.js` back-calculates through INITMAN so the state is well-posed. Then `CASCADE_NO_MASTER` (refuses: a CAS loop with no resolvable master — unreachable through `transferMode`, reachable through `restoreSnapshot`), and the two exclusions that must never be scored as misconfiguration: `LOOP_SEQUENCE_OWNED` (a `modeAttr:'PROGRAM'` loop is owned by the SCM, not the operator) and `LOOP_SHED` (a bad-PV shed is a fault response).

This is still the discipline of "verified steady state first, then dynamics", and it is still what makes item 1 composable later. What changed is the honest scope of the gate.

3.4.2 Data contract. **Shipped** as `src/boundary-dof.js` (`ESS.BoundaryDof`), generalising the per-unit contract pattern of `docs/dev/U4-SEPARATOR-CONTRACT.md`. **No artifact class is registered — see §3.1.2: `ARTIFACT-CLASSES.md` defines exactly two classes on purpose. A new `src/` module carries `// @artifact production`; a new `docs/dev/` document carries `<!-- @artifact dev -->`.**

`PLANT_MAP` = `{version, asOf, derivedFrom, units, boundaries, islands, assertion, notBoundaries}`. Each boundary stream: id, upstream unit, downstream unit, and its variables; each variable: name, field path, kind, engineering units, declared spec type (`flow` or `pressure`), nominal value with provenance, and its producer and consumer sites in `src/models.js`. Each island: unit and the verified reason it has no cross-unit coupling.

The check does **not** count specified versus free variables at a boundary and refuse on the count. That was rev 1's design and it is unbuildable here for the reason §3.4.1(ii) gives — on a flow-driven, one-write-per-tick model there is nothing to count. It refuses on the two states that are genuinely ill-posed and reachable by corruption, and reports the rest.

3.4.3 Engine binding. **Corrected in rev 2.** `src/training.js` has no drill-start path. Its entire export list is competency and record-keeping: `GROUPS, PASS_MARK, PASS_LABEL, tasks, coverage, coverageSummary, addRecord, recordFor, message, pending, SIGNED_ACTIONS, configChange` (`src/training.js:149-150`).

The A-series drills, their gates and their scoring live in **`src/drill-arch.js`**; the start path itself is in the app (`startDrillFromMenu` / `startADrillFromMenu`, which call `applyPreset` → `initSim` → `restoreSnapshot`). The pre-drill DOF validator is invoked there, on the preset's initial condition, before the drill arms — early enough that a refusal costs the trainee nothing. It reads the contract and the initial condition and returns pass or a named failure. It does not change `stepU1`..`stepU4`.

One caution from the 3.1.0 history, which a validator at this exact point must not repeat: both canonical drill starts once re-based the simulation clock from `Date.now()` mid-exercise, and the fix was to seed the preset from `P.t`. A validator inserted into this path must read `P.t`, never the wall clock, or it will re-introduce the failure that release gate 3 exists to catch.

3.4.4 Training rationale. Operators and builders both benefit from the rule that a drill must start from a verified steady state. The check catches an ill-posed initial condition before it teaches a wrong lesson — and lane B's `CASCADE_OPEN` earns its place here even though it never refuses: "you are starting with the reactor cascade open, the master is not in control" is a wrong lesson waiting to happen, and no other board surface says it.

3.4.5 Additive or gated. Additive, as a data contract. It is a gate on starting a drill, not a change to dynamics.

3.4.6 Acceptance tests. **(b) restated in rev 3** (Anthony, 2026-09-13: "§3.4.6(b) becomes a lane B test").

(a) A well-posed initial condition passes both lanes — the default post-`initSim()` state and every shipped preset.
(b) **A lane B test.** Rev 1 asked for an over-specified and an under-specified *boundary* each to fail with a named reason. Those are unconstructible on this plant (§3.4.1(ii)), so the criterion moves to lane B, where specification integrity is real: **`CASCADE_NO_MASTER` is constructed and refuses with a named reason** — a loop specified to follow a master that does not exist — and **`CASCADE_OPEN` is constructed and is reported with a named reason without refusing**, because an open cascade is legitimate operation. Lane A contributes its own named refusal, `BOUNDARY_NOT_FINITE`, on a boundary variable carrying no valid value. Three named outcomes, each constructed in a test, none invented.
(c) Existing golden drills all pass unchanged — **every** D-series and all twelve A-series initial conditions, not a sample.
(d) Suite stays 0 fail, and **every golden digest stays byte-identical**, which is the real proof the check is inert on the paths that do not refuse.

3.4.7 Golden impact. None; the check validates existing steady states and must pass them as they stand.

3.4.8 Sources, with their registered ids (registered by W0, 2026-09-13): **RESOURCES-7.1** Luyben 2nd ed. 1990, for degrees-of-freedom analysis and the steady-state-then-dynamics discipline; **RESOURCES-7.3** Seborg et al. 4th ed., for DOF analysis of control loops. Cite the subsection id, never a bare `RESOURCES-7`.

### 3.5 Item 7: curriculum as a graph (data)

3.5.1 What it is. The drill set expressed as a graph: drills with prerequisites, competency tags, mastery gates, and checkpoint questions with answers. It binds to the debrief questions and rubric weights that already exist.

3.5.2 Data contract (proposed path: `src/curriculum.js`, or `src/data/curriculum.js` only if the subdirectory caveat in §3.1.2 is cleared first). **Both §3.1.2 corrections apply here too: no artifact class is registered (the module carries `// @artifact production`), and `src/data/` does not exist.** Nodes: drill id, competency tags, prerequisite drill ids, mastery threshold. Checkpoint questions: prompt, answer, rubric weight, bound to the existing debrief question set.

3.5.3 Engine binding. Read by the training-record and coverage machinery (src/training.js) and the debrief (src/debrief.js). A mastery gate is enforced by the record layer, not by the process models.

3.5.4 Training rationale. Competency is a sequence, not a pile of drills. A prerequisite graph and mastery gates route a trainee, and checkpoint questions with graded answers make mastery measurable.

3.5.5 Additive or gated. Additive. It reorganizes and annotates existing drills; it does not change any drill's dynamics.

3.5.6 Acceptance tests. (a) The graph is acyclic and every prerequisite points to a real drill id. (b) A mastery gate blocks a locked drill until its prerequisite is passed at threshold. (c) Every checkpoint question has an answer and a rubric weight, and the debrief scores them. (d) Suite stays 0 fail.

3.5.7 Golden impact. None; the graph references existing drills and adds no recorded dynamics.

3.5.8 Sources, with their registered ids (registered by W0, 2026-09-13): **RESOURCES-7.14** Bloom, for mastery learning and mastery gates; **RESOURCES-7.19** the Reviews in Chemical Engineering OTS review, for competency framing; **RESOURCES-2.5 / 2.19** ISA-18.2-2016, already registered, where checkpoint questions cover alarm response. Cite the subsection id, never a bare `RESOURCES-7`.

---

## 4. Stream A gated line (v4): items 1 and 5

This line changes the dynamics of existing units and therefore is not additive. It may only proceed when Anthony opens a v4 line (section 8). Under option A, v2 and v3 goldens are archived byte-for-byte before any re-capture, and v4 gets its own new golden set.

### 4.1 Item 1: pressure-driven flow network

4.1.1 What changes. Today flow is flow-driven (the models set flows directly). Item 1 makes flow pressure-driven: vessels become pressure nodes with holdup; valves become sized resistances with a flow characteristic (linear, equal-percentage, quick-opening); pumps and compressors are represented by characteristic curves and affinity laws; boundary streams carry pressure specs; and a small network solve runs each tick to find flows from pressure differences.

4.1.2 Why it cannot be additive. Every existing unit's flows would now come from a network solve rather than from the hand-written flow assignments in stepU1..stepU4. That moves the recorded dynamics of U1 through U4. By rule 2.4 this is not additive and must be gated.

4.1.3 Migration and golden re-capture (option A). (a) Open a v4 branch/line. (b) Archive the full v2 and v3 golden set byte-for-byte, with checksums recorded in the receipts (section 9). (c) Implement the pressure-node/resistance network behind a build flag so v3.2 behavior stays reproducible. (d) Re-capture v4 goldens fresh; never overwrite the archived v2/v3 goldens. (e) Document in CHANGELOG.md that v4 dynamics are a new baseline, not a continuation.

4.1.4 Sequencing note. Item 6 is the additive groundwork that makes item 1 composable. Item 6 ships in v3.2; item 1 waits for the v4 gate.

**Item 1 reads the plant map. It does not invent couplings.** (Anthony, 2026-09-13.) `ESS.BoundaryDof.PLANT_MAP` is the declared topology W1 produced by reading `src/models.js` field by field: **U3 → U4 is the only inter-unit material coupling, carrying three variables; U1 and U2 are islands.** A pressure-flow network must place a node and a resistance for every real coupling and for no imagined one, and the map exists because the most likely way to get item 1 wrong is to assume a U1 → U3 feed train the code does not have. `PLANT_MAP.notBoundaries` is equally binding: `P.Tcw`, `env.Tamb`, `env.catAct` and the global clock are read by two units but written by neither unit's step code, and a network that counted them would carry phantom edges. When item 1 changes a variable's `spec` from `'flow'` to `'pressure'`, lane A stops being structural and starts being a real gate — that transition is the map's whole purpose.

4.1.5 Sources. Luyben, Process Modeling, Simulation and Control for Chemical Engineers, 2nd ed., 1990 (McGraw-Hill), and Luyben, Plantwide Dynamic Simulators in Chemical Processing and Control, Marcel Dekker, 2002 (ISBN 0824708016 / 978-0824708016; DOI 10.1201/9781482275803), for pressure-flow network modeling and holdup; ISA-75.01.01-2012 (IEC 60534-2-1 MOD) and IEC 60534-2-1:2011 for control-valve sizing and flow characteristics; pump affinity laws and pump curves from Karassik, Messina, Cooper & Heald, Pump Handbook, 4th ed., McGraw-Hill, 2008 (ISBN 978-0-07-146044-6). **Registered 2026-09-13 by W0**, before item 1 is built, as required: Luyben 1990 = `RESOURCES-7.1`, Luyben 2002 = `RESOURCES-7.2`, ISA-75.01.01-2012 / IEC 60534-2-1:2011 = `RESOURCES-7.9`, Karassik = `RESOURCES-7.17`. All four are CITED-NOT-HELD — citable for the concept, not for a number, until a copy is held (see §8.5).

### 4.2 Item 5: multi-rate stepping

4.2.1 What changes. A fine inner step for the pressure-flow network and a coarser outer step for energy and composition. This changes the integration scheme of the existing units and only makes sense if item 1 proceeds.

4.2.2 Why it cannot be additive. It alters how every unit advances in time, which moves recorded dynamics. Gated, and dependent on item 1.

4.2.3 Migration. Same option-A discipline as item 1: archive first, re-capture as v4.

4.2.4 Sources. Ascher & Petzold, Computer Methods for Ordinary Differential Equations and Differential-Algebraic Equations, SIAM, 1998 (ISBN 978-0-89871-412-8) for stiff/DAE integration; Gear & Wells, "Multirate linear multistep methods," BIT Numerical Mathematics 24(4) (1984) 484-502 (DOI 10.1007/BF01934907) for the multirate scheme. **Registered 2026-09-13 by W0**, before item 5 is built, as required: Ascher & Petzold = `RESOURCES-7.15`, Gear & Wells = `RESOURCES-7.16`. Both are CITED-NOT-HELD — citable for the concept, not for a number, until a copy is held (see §8.5).

---

## 5. Stream B: the PIP observe arm and the peb fixture

5.1 Constraint first. The coach stays advisory-only and Rule 7 holds: the sim page never fetches; the sidecar (tools/coach/) owns any log. Nothing in Stream B gives the coach a write path to the process.

### 5.2 PIP shadow mode

5.2.1 What it is. The coach writes what it would have done, a proposed and bounded mode/SP/OP move, to an append-only shadow log. It never writes to the process. The operator's actual moves are logged beside the coach's proposals. After a drill the two are compared in the debrief.

5.2.2 Shadow-log schema (proposed path: tools/coach/shadow-log.jsonl, owned by the sidecar). One append-only record per proposal:
- ts: sim time and wall time
- drill_id, run_id
- source: "pip" or "operator"
- proposed_action: { kind: "MODE.SET" | "SP" | "OP", tag, from, to } with `to` bounded to the faceplate's legal range
- rationale_ref: an opaque id into the coach transcript, not free text on the process
- applied: false for pip records always (advisory-only); true or false for operator records
The projection the coach reads is the existing read-only, operator-visible projection produced by tools/coach/projection.js; the coach has no other view and no write path. Builders confirm the projection shape in tools/coach/projection.js and the serving boundary in tools/coach/serve.py at the checkpoint.

5.2.3 Rules the prompt keeps. The PIP prompt already forbids advising blind mode/SP/OP changes, interlock defeat, and forcing a tripped motor. Shadow mode does not relax these: a proposal that would violate them is logged as refused, not as a move. The comparison in the debrief is advisory and never becomes an action. Builders confirm the exact forbidding lines in the PIP prompt (tools/coach/, the pip_guide or system prompt) at the checkpoint and keep them unchanged.

5.2.4 Acceptance tests. (a) A shadow-mode drill produces a log with pip and operator records and never mutates a process variable from the coach. (b) A proposal outside a faceplate's legal range is rejected before it is logged as a move. (c) The sim page issues no network request during the drill (Rule 7 check). (d) Suite stays 0 fail.

5.2.5 Sources. Repository files only: tools/coach/ (README, projection.js, serve.py, the PIP prompt) and the drill/debrief machinery. No external source is needed because this is a logging and comparison feature, not new process content.

### 5.3 The peb fixture "operator-assistant under upset"

5.3.1 What it is. A peb task family that treats a synthetic plant workspace, derived from this sim's scenario data (Stream A item 3), not from the sim's JS runtime, as a peb subject. Grants allow changing a mode or setpoint; frames are upsets; the subject is evaluated under peb's observe arm.

5.3.2 This is a fixture, not a merge. It is a fixture for peb and not a merge into the sim. Building it does not change the sim. The sim exports data; peb consumes it in peb.

5.3.3 Data contract the sim would export (proposed path: tools/coach/peb-export/*.json, sidecar-owned; the sim runtime is not involved). For each fixture case:
- scenario: the declarative event schedule (from item 3), with triggers and actions
- frame: the upset framing text given to the subject
- allowed_actions: the bounded grants (which tags, which of MODE.SET / SP / OP, legal ranges)
- hidden_truth_kept_out: an explicit assertion that the active fault and the loop's known parameters are excluded from anything the subject sees
The export is static data. It never includes the sim's JS, never opens a socket, and carries no site material (Rule 6).

5.3.4 peb interface this maps onto (described, not designed here). peb mediates every subject effect through a reference monitor and a transactional executor; approvals are HMAC-signed and bound to run, session, digest and nonce; a review queue holds with a bounded, expiring hold that never approves; and the evaluation oracle is never on the authorization path. ADR-005 pins a pre-action protocol of observe for study arms versus require for a workroom candidate, with the ruling that a hold in require mode is scaffolding, not voluntary integrity; ADR-003 separates integrity violations from authorization violations; ADR-009 makes the review queue a real bounded hold that expires and never approves; ADR-014 scopes task grants to a run. This fixture is evaluated under the observe arm. The exact ADR wording lives in peb at docs/decisions/ADR-003-integrity-versus-authorization.md, ADR-005-observable-preaction-versus-enforced.md, ADR-009-real-queue-bounded-hold.md and ADR-014-task-grants-are-run-scoped.md, and in docs/ARCHITECTURE.md and docs/HANDOFF.md; builders read those in peb, not here, and quote them from the source. This spec designs no peb internals; it specifies only the export contract and the shadow-log schema.

5.3.5 Decision status. Making the sim a peb subject is a decision for Anthony. No prior ruling exists on making the sim a peb subject. The nearest rulings are Rule 7 (network-free core), the advisory-only PIP coach, and the peb ADRs themselves (ADR-003, ADR-005, ADR-009, ADR-014). Until Anthony rules, the export contract may be specified and stubbed but the fixture is not wired.

5.3.6 Sources. peb repository docs only (the four ADRs above, docs/ARCHITECTURE.md, docs/HANDOFF.md). No process-literature source applies; this is an authorization-and-evidence contract, not process content.

---

## 6. Stream C: fidelity-feedback intake protocol

6.1 Who and what. Fidelity feedback may come from an expert colleague (an AIRCO OT/ICS architect). Only general operator-behavior and alarm-logic feedback is admitted. Nothing site-specific is admitted, ever (Rule 6).

6.2 Governing discipline. This follows Anthony's existing pattern from another project (the "Tristan/vfa-removal" discipline): freeze the feedback verbatim, timestamp it to the chronicle (his Sovereign Stack), keep the sim blind to anything site-specific, and label any Temple-set parameters as Temple-set.

6.3 Intake procedure (short).
1. Receive. Capture the feedback verbatim into a frozen record; do not edit it.
2. Timestamp. Log it to the chronicle (Sovereign Stack) with date and source role, not employer identity or site.
3. Screen. Admit only general operator-behavior and alarm-logic content. Reject anything plant-specific, any real tag, any real setpoint, any site event. A rejected item is recorded as rejected with a one-line reason and never enters the repo.
4. Attribute. Any parameter the Temple sets as a result is labeled "Temple-set" in the code or data comment, so no reader mistakes a Temple choice for a cited value.
5. Cite or drop. If the feedback points to something implementable, it must trace to an open source in docs/RESOURCES.md. Professional judgment alone is not a citable source.

6.4 Template (proposed path: docs/dev/FIDELITY-INTAKE.md).
```
Intake id:
Date (chronicle):
Source role (not employer, not site):
Verbatim feedback (frozen, unedited):
Class: [operator-behavior | alarm-logic | REJECTED]
If REJECTED, reason (site-specific / real tag / real SP / other):
Temple-set parameters created (label each "Temple-set"):
Open-source citation in RESOURCES.md (or "not implementable"):
```

6.5 Published literature. The colleague's published chapters may enter docs/RESOURCES.md as cited literature only if they add something the ISA-18.2 and EEMUA 191 sources already registered do not: Mehta & Reddy, Industrial Process Automation Systems: Design and Implementation, Butterworth-Heinemann/Elsevier, 2014 (ISBN 978-0-12-800939-0), specifically its functional-safety/SIS chapter and its alarm-management material. Register it only for the increment it adds over ISA-18.2-2016 and EEMUA 191 (3rd ed., 2013).

6.6 Standing prohibition. Site material never enters the repository. This prohibition overrides any feedback, however expert. It is the same rule as Rule 6 and it is repeated here because Stream C is the most likely place to break it.

---

## 7. Absent by design

These are deliberately not in this spec. Their absence is a decision, not an oversight.

7.1 No vendor content, no course content. Nothing from the vendor course that motivated this spec, and no vendor product vocabulary, appears anywhere. Absent by design (section 0, Rule 1).

7.2 No new dynamics in v3.2. v3.2 adds data and readers, never new physics in stepU1..stepU4. Dynamics changes are the v4 line. Absent by design (rule 2.4).

7.3 No network in the core. The sim page still never fetches. No cloud call, no telemetry, no remote scenario fetch. Absent by design (Rule 7).

7.4 No peb merge. peb internals are not designed here and the sim is not made a peb subject in this spec. Only an export contract and a shadow-log schema are specified. Absent by design (section 5.3.5).

7.5 No site data, no real tags. Nothing from any employer or real site. Absent by design (Rule 6, Stream C).

7.6 No coach write path. The coach never writes to the process, in shadow mode or otherwise. Absent by design (section 5.1).

---

## 8. Anthony's gates

Each gate is listed with the prior ruling of the same shape, or a plain statement that none exists.

8.1 Gate: open the v4 line (items 1 and 5, **and item 2's matrix-as-source-of-truth**). Prior ruling of the same shape: option A (goldens archived byte-for-byte before any re-capture; dynamics changes are gated, not additive). This gate is the direct application of that ruling. Anthony decides when v4 opens.

**Rev 2 amendment.** This gate gained a third item. Anthony ruled on 2026-09-13 that item 2 ships in v3.2 as an assertion layer with no runtime enforcement (§3.1.1), and that the matrix **becoming** the source of truth — actually driving the effects, replacing the interlock code in `stepU1`..`stepU4` — moves here, behind this gate, because it moves dynamics like items 1 and 5 do. Sequencing note: the v3.2 assertion layer is the groundwork for it, exactly as item 6 is the groundwork for item 1. By the time this gate opens, the matrix will have been asserted equal to the code across every scripted upset for a full season, which is the strongest possible starting position for making it authoritative.

8.2 Gate: attach any new scenario to an existing golden drill. Prior ruling of the same shape: additive discipline, v2/v3 goldens must not move. Default is no; if yes, archive-then-recapture under option A.

8.3 Gate: make the sim a peb subject (the fixture in section 5.3). Prior ruling of the same shape: none exists. No prior ruling exists on making the sim a peb subject. The nearest rulings are Rule 7, the advisory-only PIP coach, and the peb ADRs (ADR-003, ADR-005). Anthony must rule before the fixture is wired.

8.4 Gate: register the colleague's published chapters in RESOURCES.md. Prior ruling of the same shape: Rule 6 (only published literature and open standards enter; ownership does not change with the database label) and the RESOURCES.md registration practice. Register only for the increment over ISA-18.2 and EEMUA 191.

8.5 Gate: pin the newly identified sources. **Discharged 2026-09-13 by W0.** Prior ruling of the same shape: manual points, literature cites (every implementable statement cites an open source), plus Anthony's ruling of 2026-09-13: *nothing builds on an unregistered source.*

Rev 1 scoped this gate to three works (Karassik, Luyben 2002, Gear & Wells) and to items 1 and 5 only. Verification found that scope badly short on both axes. **Twenty-two works** were unregistered, not three; and they block **W2, W3, W4 and W5 as well**, not just the v4 line — item 2 needs IEC 61511 and CCPS, item 3 needs Law, Banks and five OTS papers, item 4 needs Seborg/Skogestad/Ziegler-Nichols/Cohen-Coon/Åström, item 7 needs Bloom. The count grew past rev 1's own Appendix A because Luyben is two distinct books, the Seborg **textbook** is a different work from the Henson/Seborg CSTR parameters already at RESOURCES §4.4, and the five OTS papers cited in §3.2.8 and §3.5.8 were never registered at all.

All twenty-two are now registered as `docs/RESOURCES.md` **§7, ids RESOURCES-7.1 through RESOURCES-7.22**, each with its own subsection so each carries its own citable id, and each marked CITED-NOT-HELD: registered and identified, citable for the concept it is the standard reference for, **not** usable to justify a specific equation, default or numeric value until a copy is held and read. A builder who needs a number out of one of these sources must hold it first and change its status here.

---

## 9. Verification and receipts

9.1 Suite. `node --test tests/*.test.js` must stay 0 fail on node 22 with no dependencies, on a clean checkout, for every change in this spec.

**"No dependencies" means the suite, and it is enforced against a genuinely clean machine.** A second seat ran `ff25cb9` on a machine with no Python packages and got **907 pass, 3 fail** — three coach tests failing on a missing `anthropic` module — while the same commit was green here, because this machine happens to have `anthropic` installed. That divergence is the failure: a test that fails on a clean machine is a gate firing on normal practice, which is the same error as a drill check that refuses ordinary operation. Fixed by making those tests **skip with a stated reason** when the package is absent.

**The sidecar's requirements, stated here because this is where the no-dependencies rule lives.** The deterministic core and the whole test suite need **nothing but node 22** — no npm package, no Python package, no network. `tools/coach/` is an **optional sidecar** and is the only thing in the repo with further requirements:

- **Python 3** for `serve.py`, always. It otherwise uses only the standard library.
- **`COACH_PROVIDER` defaults to `auto`** (`tools/coach/serve.py:47`), and `auto` means **cloud first, local as the fallback** — `_provider()` resolves it to `anthropic` whenever *any* credential is discoverable (a station key, `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile) and only falls back to Ollama when none is. The file says so itself at `:46`: *"we swapped to api — the cloud is the default, local is the fallback."*
- So the practical requirement depends on the machine: **a credential present ⇒ the `anthropic` Python package is needed under the default**, no explicit `COACH_PROVIDER=anthropic` required; **no credential ⇒ a local Ollama at `127.0.0.1:11434`** (override with `OLLAMA_HOST`).

An earlier draft of this paragraph called Ollama "the default provider". That was **wrong**, and wrong in the direction that understates the requirement — it implied the `anthropic` package was only needed when explicitly opted into, when in fact the default path reaches for it on any machine carrying a credential. Caught by the verify pass against `serve.py`, the README and a passing test that all say otherwise. Recorded rather than quietly amended, because the error is instructive: the paragraph was written from memory of how the sidecar *used* to work.

**None of the above is required to run the simulator, to run the suite, or to ship.** A contributor with a bare node 22 install must see a green suite; any test needing more than that skips with a reason saying so. Rule 7 is unchanged — the raw page still never fetches.

**The standing rule this establishes:** a test may require something beyond node 22 only if it skips, with a reason, when that thing is absent. Never fail.

9.2 Goldens. v2 and v3 goldens stay byte-for-byte identical for all of v3.2. A reviewer reproduces this by running the golden comparison and confirming zero diff. Any diff is a stop condition (the change was not additive).

9.3 Builds. Rebuild the offline single-file build with python3 tools/build-dist.py after any change; never hand-edit dist/. Run the headless smoke check (tools/smoke.sh) on both builds.

9.4 Rule 7 check. For any Stream B work, a reviewer confirms the sim page issues no network request during a drill, and that only the local sidecar (tools/coach/) reads or writes the shadow log.

9.5 What a reviewer must reproduce.
- 0-fail suite on a clean checkout.
- Byte-for-byte goldens for v3.2 (archived checksums match).
- For item 2: the trips the **code** fires, collected at `ctx.onTrip`, match what the matrix **declares**, tick-for-tick, on the golden upsets — and deleting the C&E reader entirely leaves every golden digest byte-identical. (Rev 1 said "matrix-driven trips match legacy trips". That wording described the matrix firing the trips, which is the runtime enforcement Anthony's 2026-09-13 ruling rejected; see §3.1.1. The matrix drives nothing.)
- For item 4: fitted step-test parameters match known values within tolerance; grader passes and fails at the 80% mark.
- For item 6: every D-series and all twelve A-series drill initial conditions pass the specification-integrity check unchanged, **and every golden digest is byte-identical** — the digests are the proof the check is inert on the paths that do not refuse, not the fact that the suite is green. (Rev 1 said "pass the DOF check". There is no DOF check in the built item and there could not be; see §3.4.1. The check refuses only a non-finite boundary variable and a CAS loop with no master.)
- For Stream B: no network from the sim page; shadow log append-only.

9.6 Receipt format (matching the repo's habits). Each merged item records a receipt: the commit hash, the date, the suite result (0 fail), the golden result (byte-for-byte or, for v4 only, the archived-then-recaptured note with checksums), the build result, and one line naming what was added and which rule keeps it additive or gated. Receipts live with the change and are referenced in CHANGELOG.md.

---

## 10. Sequencing and bounded work items for a builder seat

Each item is sized so one builder seat can finish and verify it in one focused pass. Do them in order; each ends 0-fail with goldens intact.

**Rev 2 amended this order.** W0 is new and comes first. W1, W2 and W3 changed where they bind. W4 through W10 are unchanged in scope; W4 gained a source precondition that W0 has now discharged.

10.0 **W0 (new in rev 2, and it comes before everything): register the sources.** Add a Registered sources section to `docs/RESOURCES.md`, seeded from Appendix A, every work with its own `### 7.n` subsection and a verification status. Anthony's ruling, 2026-09-13: *nothing builds on an unregistered source.* Twenty-two works, not the three gate 8.5 named — see that gate for why the count grew. Acceptance — stated precisely, because the obvious criterion is hollow. **`tests/provenance.test.js` passing proves nothing about W0.** That test resolves the `sourceBasis` arrays hard-coded in `src/topology.js` and `src/drill-arch.js` against `docs/RESOURCES.md` headings; it never reads this spec, and no `src/` module cites a `RESOURCES-7.x` id yet, so it would pass identically if §7 were mis-numbered or deleted outright. It is a real gate that this work does not yet reach. The criteria that do bite: (a) every `RESOURCES-7.x` id cited in this spec resolves to a real `### 7.n` heading, and every `### 7.n` heading is either cited or knowingly recorded as an orphan — checked by reading both files against each other, since no test does it; (b) each source has its own `### 7.n` subsection, so none is reachable as a bare `RESOURCES-7`; (c) each entry carries a held/not-held status, so a builder can tell a concept citation from a number citation. `provenance.test.js` becomes a genuine gate on §7 at **W2**, the first work item that puts a `RESOURCES-7.x` citation inside a `src/` module (`RESOURCES-7.8`, `RESOURCES-7.10`). It must be green then, and that is when this registration is machine-checked for the first time. **Status: done, 2026-09-13** (`docs/RESOURCES.md` §7, ids 7.1–7.22, all CITED-NOT-HELD). Gate 8.5 is discharged.

10.1 W1 (item 6, the first build item, and it unblocks the rest): the declared plant map and the pre-drill specification-integrity check. **Status: done, 2026-09-13** — `src/boundary-dof.js`, `tests/boundary-dof.test.js`, `tests/app-boundary-dof.test.js`, wired into `startDrill` and `startADrill`; contract at `docs/dev/W1-BOUNDARY-DOF-CONTRACT.md`.

Binding, corrected twice during the build and worth reading before W2 repeats either mistake: **not `src/training.js`** (it has no drill-start path, §3.4.3), and **not the menu wrappers** that §3.4.3 originally named — `tests/golden-drills.test.js:87` calls `c.startDrill(def)` directly, so a validator at the menu layer would never run against the golden suite and (c) could not be demonstrated. It sits in `startDrill` / `startADrill`, **immediately before `startDrill`'s `rand()` draw for the injection delay**, because refusing after that draw would advance the seeded cursor without arming and shift every downstream trajectory. It is inert under `replaying()`, reads `P.t` only, and fails open if the module is absent. Goldens proved byte-identical by digest. Acceptance: 3.4.6. No golden moved.

10.2 W2 (item 2, **re-scoped by Anthony 2026-09-13**): build the C&E matrix as a **declarative assertion layer**. Declare the six trip rows as data; subscribe a reader to the existing `ctx.onTrip` seam (`src/models.js:294-297`); render the operator-facing C&E chart; score `INTERLOCK.DEFEAT` from the declared matrix (A5 / `DRV-M202`, `src/drill-arch.js:326`). **The code stays the source of truth. No runtime enforcement — the matrix never fires an effect.** Do not edit `src/models.js`; the hook is already there. Acceptance: 3.1.6, including the test that deleting the reader leaves every golden byte-identical. Matrix-as-source-of-truth is out of scope here and sits behind gate 8.1.

**Visibility is staged (Anthony, 2026-09-13).** The C&E chart ships **instructor-only** and stays instructor-only **until the assertion test has passed clean across the full golden set** — every golden drill and every golden upset, matrix equalling code tick-for-tick, not a sample. Only then does it become operator-visible, **and by a one-line config change**, so the promotion is one reviewable line rather than a refactor and the demotion is equally cheap if the chart proves wrong in front of a trainee.

The reasoning is W1's, learned the hard way: a surface that tells an operator "this cause drives that effect" is making a claim about the plant, and a C&E chart that disagrees with the code teaches a wrong lesson with the authority of a console display. The assertion test passing across the whole golden set is what earns the chart the right to be believed. Build the config flag in from the start — retrofitting a visibility gate after the chart is wired is how it ends up shipped on by accident.

10.3 W3 (item 3): the scenario scheduler and data format, instructor-only. **Binds to the app's `injectFault(k, on)` (`…dc.html:3111`), not to fault-engine effects hooks, which do not exist** (corrected in 3.2.3). Read the existing one-shot time+predicate trigger at `…dc.html:3122` before designing the trigger schema, and reconcile with `ESS.Instructor.compoundScripts`, which already runs ordered fault timelines — extend or subsume it, do not ship a second mechanism. Acceptance: 3.2.6.

10.4 W4 (item 4): the step-test/loop-tuning drill family and grader. Acceptance: 3.3.6.

10.5 W5 (item 7): the curriculum graph, mastery gates, checkpoint questions. Acceptance: 3.5.6.

10.6 W6 (Stream B, shadow mode): the append-only shadow log and the debrief comparison. Acceptance: 5.2.4. Rule 7 check mandatory.

10.7 W7 (Stream B, peb export contract): specify and stub the export only; do not wire the fixture. Blocked on gate 8.3.

10.8 W8 (Stream C): add docs/dev/FIDELITY-INTAKE.md and the template; wire nothing to the process.

10.9 Deferred behind gate 8.1: W9 (item 1, pressure-driven flow network) and W10 (item 5, multi-rate stepping), each under option-A archive-then-recapture, on a v4 line.

---

## Appendix A: Sources verified

**Rev 2: all of these are now registered in `docs/RESOURCES.md` §7 (ids RESOURCES-7.1 … RESOURCES-7.22), by work item W0 on 2026-09-13.** Cite the id, not this appendix — this list is the authoring record, §7 is the registry. Two corrections W0 made to this list: Luyben is two distinct books (7.1 and 7.2), and the Seborg **textbook** (7.3) is a different work from the Henson/Seborg CSTR parameters already registered at RESOURCES §4.4. Every §7 entry also carries a CITED-NOT-HELD status this appendix does not: verified identifier, no copy read by this project, so citable for a concept but not for a number.

Status key: VERIFIED (DOI/ISBN confirmed), VERIFIED (publisher/standards page), NOT VERIFIED.

- Luyben, Process Modeling, Simulation and Control for Chemical Engineers, 2nd ed., McGraw-Hill, 1990. ISBN 0071007938 / 978-0071007931 (2nd ed. paperback; the 1989 hardcover is 0070391599 / 978-0070391598). VERIFIED (ISBN, multiple booksellers and a library catalog).
- Luyben, Plantwide Dynamic Simulators in Chemical Processing and Control, Marcel Dekker, 2002. ISBN 0824708016 / 978-0824708016; LCCN 2002067800; DOI 10.1201/9781482275803; 448 pp. VERIFIED (Internet Archive record and Google Books).
- Seborg, Edgar, Mellichamp & Doyle, Process Dynamics and Control, 4th ed., Wiley, 2016. ISBN 978-1-119-28591-5 (eBook 978-1-119-28595-3). VERIFIED (publisher page and ISBN).
- Skogestad, "Simple analytic rules for model reduction and PID controller tuning," Journal of Process Control 13(4) (2003) 291-309. DOI 10.1016/S0959-1524(02)00062-8. VERIFIED (DOI).
- Ziegler & Nichols, "Optimum settings for automatic controllers," Trans. ASME 64 (1942) 759-768. VERIFIED (citation, historical).
- Cohen & Coon, "Theoretical consideration of retarded control," Trans. ASME 75 (1953) 827-834. VERIFIED (citation, historical).
- Åström & Hägglund, Advanced PID Control, ISA, 2006. ISBN 978-1-55617-942-6. VERIFIED (ISBN, publisher and university records).
- IEC 61511-1:2016+AMD1:2017 (Ed 2.1), Functional safety, safety instrumented systems for the process industry sector, Part 1. VERIFIED (IEC webstore).
- ISA-75.01.01-2012 (ANSI/ISA, 60534-2-1 MOD), Flow equations for sizing control valves; IEC 60534-2-1:2011. VERIFIED (ISA/IEC references).
- CCPS, Guidelines for Safe Automation of Chemical Processes, 2nd ed., Wiley-AIChE, 2016 (hardcover) / 2017 (online). ISBN 978-1-118-94949-8; online ISBN 978-1-119-35204-4; DOI 10.1002/9781119352044. VERIFIED (publisher page, DOI).
- ISA-18.2-2016 (ANSI/ISA-18.2, Management of Alarm Systems for the Process Industries). VERIFIED (edition year via multiple standards references); already registered in docs/RESOURCES.md per the README (do not duplicate).
- EEMUA Publication 191, 3rd ed., 2013, Alarm Systems: A Guide to Design, Management and Procurement. ISBN 978-0-85931-192-2. VERIFIED (title page and standards resellers); already used by the repo's alarm work; note a 4th ed. (2024) exists but the repo cites the 3rd.
- Mehta & Reddy, Industrial Process Automation Systems: Design and Implementation, Butterworth-Heinemann/Elsevier, 2014. ISBN 978-0-12-800939-0. VERIFIED (publisher and booksellers; includes a functional-safety/SIS chapter and alarm-management material).
- Law, Simulation Modeling and Analysis, McGraw-Hill; 5th ed., 2015, ISBN 978-0-07-340132-4 (earlier eds. 2000/2007 exist). VERIFIED (publisher and ISBN).
- Banks, Carson, Nelson & Nicol, Discrete-Event System Simulation, Pearson; 5th ed. (current), ISBN 978-0-13-606212-7 (Pearson New International Edition 978-1-292-02437-0). VERIFIED (publisher and booksellers).
- Reviews in Chemical Engineering, "Operator training simulators in the chemical industry: review, issues, and future directions." DOI 10.1515/revce-2013-0027. VERIFIED (DOI).
- Balaton, Nagy & Szeifert, "Operator training simulator process model implementation of a batch processing unit in a packaged simulation software," Computers & Chemical Engineering 48 (2013) 335-344. DOI 10.1016/j.compchemeng.2012.09.005. VERIFIED (DOI).
- "Conceptual Design of an Operator Training Simulator for a Bio-Ethanol Plant," Processes 3(3) (2015) 664. DOI 10.3390/pr3030664. VERIFIED (DOI).
- Lee, Ko, Lee, Jeon, Shin & Han, "Interactive plant simulation modeling for developing an operator training system in a natural gas pressure-regulating station," Petroleum Science 14(3) (2017) 529-538. DOI 10.1007/s12182-017-0170-5. VERIFIED (DOI). (Correction: this paper is in Petroleum Science, 2017, not Computers & Chemical Engineering, 2022, as sometimes cited.)
- "An Operator Training Simulator to Enable Responses to Chemical Accidents," Applied Sciences 13(3) (2023) 1382. VERIFIED (publisher/issue).
- Bloom, "Learning for Mastery," Evaluation Comment (UCLA-CSEIP) 1(2) (1968) 1-12. VERIFIED (occasional paper; no ISBN/DOI; also ERIC ED053419).
- Ascher & Petzold, Computer Methods for Ordinary Differential Equations and Differential-Algebraic Equations, SIAM, 1998. ISBN 978-0-89871-412-8 (ISBN-10 0-89871-412-5). VERIFIED (SIAM/ISBN).
- Gear & Wells, "Multirate linear multistep methods," BIT Numerical Mathematics 24(4) (1984) 484-502. DOI 10.1007/BF01934907. VERIFIED (SpringerLink).
- Karassik, Messina, Cooper & Heald, Pump Handbook, 4th ed., McGraw-Hill, 2008. ISBN 978-0-07-146044-6 (ISBN-10 0071460446); 1824 pp. VERIFIED (publisher AccessEngineering and booksellers).

Duplication note: ISA-18.2-2016, EEMUA 191 (3rd ed., 2013) and ISA-101 are already registered in docs/RESOURCES.md per the README; confirm against RESOURCES.md before adding and do not create duplicate entries.

Repo-file note (**superseded by rev 2 — kept because it records why rev 1's errors happened**): the internal dev files named throughout (V3-PLAN.md, RESOURCES.md, CODE-MAP.md, ARTIFACT-CLASSES.md, U4-SEPARATOR-CONTRACT.md, P2L-EXPANSION-SPEC.md, fault-engine.js, alarm-engine.js, models.js, the drill safety-gate file, and the tools/coach files) are not web-indexed and could not be read verbatim in authoring. **They have since been read directly, at the checkpoint, and every binding below was confirmed or corrected — see `docs/dev/CONVERGENCE-SPEC-VERIFICATION.md`. The five errors this note predicted were real, and they clustered exactly where it warned they would: in the hook and token names.** The original text follows.

Original note: Their names, roles and the facts cited here (v3.1.0 dated 2026-09-03; the 80% pass mark; the ISA-18.2 lifecycle and ISA-101 preset; the network-free core and local sidecar; the src module load order including fault-engine.js) are confirmed from the repository README. Every place this spec binds to a hook, function or token (stepU1..stepU4, dt = 0.5 s, MODE.SET, POINT.SUPPRESS, INTERLOCK.DEFEAT, the fault-engine effects hooks, projection.js output) instructs the builder to confirm the exact name against the file at the checkpoint before writing code.

## Appendix B: Glossary

- Additive: a change that adds data or readers and does not move recorded dynamics of existing units; keeps v2/v3 goldens byte-for-byte.
- Gated: a change that moves dynamics and needs Anthony to open a separate line (here, v4) under option A.
- Option A: Anthony's ruling that goldens are archived byte-for-byte before any re-capture.
- Golden / golden baseline: the recorded reference run used to detect any change in dynamics.
- C&E matrix: cause-and-effect matrix, causes down, effects across, read by the engine and shown as a chart.
- DOF check: degrees-of-freedom check that a specification is well-posed. Named in rev 1 as item 6's mechanism; **the built item does not contain one**, because on a flow-driven model with one owning write per variable per tick there is nothing to count (§3.4.1). Retained in this glossary only so a reader of rev 1 or rev 2 can find out what happened to it. What shipped is the specification-integrity check.
- Plant map: the declared topology artifact (`ESS.BoundaryDof.PLANT_MAP`) recording which units are coupled and which are islands, derived by reading `src/models.js` field by field. Item 1 reads it rather than inferring couplings.
- Lane A / lane B: item 6's two checks — the material-boundary declaration (which cannot fail on this plant, and says so) and control-loop configuration (which can).
- FOPDT: first-order-plus-dead-time model estimated from a step test (gain, time constant, dead time).
- PIP: the advisory-only hover coach in the station; receives a read-only, operator-visible projection; has no write path.
- Shadow mode: the coach logs what it would have done to an append-only log; never acts on the process.
- peb: project-epistemic-bound, Anthony's authorization-and-evidence workbench; here a consumer of a sim-exported fixture, not a merge.
- Observe arm: the peb pre-action mode that records what a subject would do without enforcing a block (ADR-005), versus require mode.
- Two-lane rule: public repo (lane one) and AIRCO work (lane two) never cross; company-time improvements stay in the company copy.
- Temple-set: a parameter chosen by the Temple of Two, labeled as such so it is not mistaken for a cited value.
- Rule 1 / Rule 6 / Rule 7: no vendor content; no employer/site material; network-free core with an optional coach sidecar.