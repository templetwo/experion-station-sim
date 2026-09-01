<!-- @artifact production -->
# Source Provenance Registry

This is the registry release gate 5 (`V3-PLAN.md` §11) requires: *"every
vendor-specific concept traces to a registered public source, the automated
provenance test passes, and rules 1 and 6 hold across the diff."* It ships with
the code — `docs/RESOURCES.md` is `production` for the same reason
(`docs/dev/ARTIFACT-CLASSES.md`) — because `src/topology.js` and
`src/drill-arch.js` cite it by id at every node and every drill, and the IP
boundary this repository draws does not travel without it.

**This document is built from the code, not transcribed from a plan.** Every id
below was collected by requiring `src/topology.js` and `src/drill-arch.js`
directly under node, building the real 114-node / 247-edge topology graph
(`Topology.build({L, V, assetTree, unitOf})` against a freshly initialized
`Component`), and reading the `sourceBasis` arrays the running code actually
emits — the same thing `tests/provenance.test.js` does on every run. If a
future stage adds a node or a drill, re-run that collection; do not hand-add a
row here from memory.

## 1. The id form

A `sourceBasis` entry is a string `RESOURCES-<section>`, where `<section>` is a
heading number in `docs/RESOURCES.md` — either a top-level section (`RESOURCES-4`
→ `## 4. Better process dynamics`) or a numbered subsection (`RESOURCES-2.5` →
`### 2.5 alerta ISA-18.2 alarm state machine`). This is the *canonical* form; it
is the only form either module writes today, and the automated test rejects any
other spelling (see §7). An id resolving means exactly one thing: that section
exists in `docs/RESOURCES.md` and is where a human can go read what the code is
citing.

## 2. Registry: every sourceBasis id the code emits today

Collected from the live topology graph (`Topology.build`) and all twelve
`DrillArch.DRILLS` entries. Ten distinct ids are emitted; every one resolves to
a real `docs/RESOURCES.md` section — none are dangling.

| id | RESOURCES.md section | what it licenses (concept, not text) | emitted by |
|---|---|---|---|
| `RESOURCES-2.1` | 2.1 Experion LX HMI Specification LX03-200-530 | Station/HMI concepts: console-vs-flex-style station framing | `topology.js` STATION nodes; drills A8, A9 |
| `RESOURCES-2.2` | 2.2 Experion Alarming Product Information Note | Alarm/event servicing as a distinct architectural concern (ISA-18.2-aligned) | `topology.js` alarm-and-event service node |
| `RESOURCES-2.3` | 2.3 Experion HMI Product Information Note | Console-station vs flex-station (direct vs server-cached) as a named architectural distinction | `topology.js` STATION nodes; drills A9, A10 |
| `RESOURCES-2.5` | 2.5 alerta ISA-18.2 alarm state machine (Apache-2.0) | The ISA-18.2 alarm state model as a general concept (states/transitions), not the alerta code itself | `topology.js` alarm-and-event service node; drills A3, A12 |
| `RESOURCES-2.7` | 2.7 exida "Alarm Management and ISA-18: A Journey, Not a Destination" | ISA-derived alarm-performance concepts (used here for cascading-symptom reasoning) | drill A12 |
| `RESOURCES-2.13` | 2.13 Experion HS PIN, Experion SCADA PIN, Experion HS brochure | Server/SCADA service architecture as a concept (a service layer distinct from control) | `topology.js` server and history-service nodes; drills A5, A7, A8, A10 |
| `RESOURCES-2.15` | 2.15 Experion Operations Assistant brochure and press release | An advisory ops-assistant surface as a concept, independent of any decision it makes | `topology.js` Ops Assistant node; drill A11 |
| `RESOURCES-2.16` | 2.16 Orion Console PIN/white paper, C300 PIN, System HINTS | Controller/CEE/CM naming convention and redundant network-path framing | `topology.js` controller, CEE, SCM, CM and network-path nodes; drills A2, A4, A5, A6, A7 |
| `RESOURCES-2.19` | 2.19 Standards (cite clause numbers only) | Standards-level I/O and redundancy concepts, cited by clause, never by vendor implementation | `topology.js` I/O-channel nodes; drills A1, A2, A6, A7 |
| `RESOURCES-4` | 4. Better process dynamics | Published/open process-model literature as the source of measured process behaviour | `topology.js` field-measurement (transmitter/drive/valve) nodes; drills A1, A3, A12 |

`RESOURCES-2.14` (2.14 Honeywell Forge Process Training Simulator PIN and
Workforce Competency white paper) is declared as a fallback default inside
`src/drill-arch.js` (`spec.sourceBasis || ['RESOURCES-2.14']`) for the
training-assessment concept a drill would fall back to if it declared no
`sourceBasis` of its own. It resolves to a real section but is **not currently
emitted** — all twelve A-drills declare an explicit `sourceBasis`, so the
fallback path is unreached in the present code. It is recorded here so the next
person to add a drill knows what happens if they forget the field, not because
it appears in a live drill today. `src/topology.js` separately declares the same
id under `BASIS.TRAINING`, also currently unused by any node.

**No id found on either module resolves to nothing.** `tests/provenance.test.js`
enforces this on every run (§7); this registry independently confirms it by the
same method the test uses.

## 3. Topology domains in detail (`src/topology.js`)

`src/topology.js` groups its citations under a small internal `BASIS` map, one
entry per architectural domain, with its own one-line note on what the citation
is *for*. Reproduced here because it is the clearest statement in the codebase
of concept-vs-text discipline — each note names a concept, never a document to
copy from:

| domain (`BASIS` key) | ids | applied to | the module's own note |
|---|---|---|---|
| `FIELD_MEAS` | `RESOURCES-4` | TRANSMITTER / DRIVE nodes, VALVE nodes | "open process models the measurements come from" |
| `IO` | `RESOURCES-2.19` | INPUT CHANNEL, OUTPUT CHANNEL nodes | "standards, cited by clause only" |
| `CONTROL` | `RESOURCES-2.16` | CONTROLLER, CONTROL EXECUTION (CEE), CM, SCM SEQUENCE nodes | "controller / control-execution concepts" |
| `NETWORK` | `RESOURCES-2.16` | NETWORK PATH nodes | "redundant path concepts" |
| `SERVICE` | `RESOURCES-2.13` | DATA SERVER node | "server / SCADA architecture concepts" |
| `STATION` | `RESOURCES-2.1`, `RESOURCES-2.3` | STATION (console profile), STATION (flex profile) nodes | "station / HMI concepts" |
| `ALARM` | `RESOURCES-2.5`, `RESOURCES-2.2` | ALARM AND EVENT SERVICE node | "ISA-18.2 state model" |
| `HISTORY` | `RESOURCES-2.13` | HISTORY COLLECTION node, PROCESS HISTORY node | (server/SCADA architecture, same as `SERVICE`) |
| `APP` | `RESOURCES-2.15` | OPS ASSISTANT node | "operations-assistant concept" |
| `TRAINING` | `RESOURCES-2.14` | declared, not currently applied to any node | "training-simulator concepts" |

The FIELD and CONTROL layers themselves are not hand-authored against these
sources at all — the module's header comment is explicit that they are
*derived* from the simulator's own tag database (`this.L`'s `cm:`/`kind:`
fields, `this.V`'s valves): "A derived graph cannot drift from the tag
database. A hand-authored one silently will." The `sourceBasis` citations above
license the *architectural concepts* the derived graph is organized around
(what a control module is, what a redundant network path is), not the
derivation itself, which needs no outside source because it is this
simulator's own data.

## 4. Drill provenance (`src/drill-arch.js`)

All twelve A-series drills, with the `sourceBasis` the running code actually
carries for each (not the summary table in `V3-PLAN.md` §6 — that table records
intent; this one records what shipped):

| drill | title (from code) | sourceBasis |
|---|---|---|
| A1 | Frozen flow measurement | `RESOURCES-4`, `RESOURCES-2.19` |
| A2 | Input channel failure | `RESOURCES-2.19`, `RESOURCES-2.16` |
| A3 | Bias with GOOD quality | `RESOURCES-2.5`, `RESOURCES-4` |
| A4 | Redundancy switchover | `RESOURCES-2.16` |
| A5 | Controller loss | `RESOURCES-2.16`, `RESOURCES-2.13` |
| A6 | Single network path degradation | `RESOURCES-2.16`, `RESOURCES-2.19` |
| A7 | Communications partition | `RESOURCES-2.16`, `RESOURCES-2.13`, `RESOURCES-2.19` |
| A8 | Server / flex service loss | `RESOURCES-2.13`, `RESOURCES-2.1` |
| A9 | Local station failure | `RESOURCES-2.1`, `RESOURCES-2.3` |
| A10 | Historian gap | `RESOURCES-2.13`, `RESOURCES-2.3` |
| A11 | Assistant loss | `RESOURCES-2.15` |
| A12 | Causal measurement bias | `RESOURCES-2.7`, `RESOURCES-4` |

**Correction, checked against the running code, not assumed:** no two drills
share a byte-identical `sourceBasis` array — the property `tests/provenance.test.js`
actually asserts (§7, "GATE 5 BLOCKER: drills do not all share one identical
sourceBasis", which compares `JSON.stringify` of each drill's array). But array
order is not the same claim as citation *set*, and at the set level two drills
are **not** distinguishable: A2 (`Input channel failure`) declares
`['RESOURCES-2.19', 'RESOURCES-2.16']` and A6 (`Single network path
degradation`) declares `['RESOURCES-2.16', 'RESOURCES-2.19']` (`src/drill-arch.js`
lines ~237 and ~310) — the identical two-element set in reversed order. The
test's collision check is order-sensitive and does not catch this, so it stays
green while two of the twelve drills cite the same public sources. That is not
necessarily wrong — an input-channel fault and a network-path fault are both
legitimately IO/CONTROL-layer concepts under `RESOURCES-2.16` and
`RESOURCES-2.19` — but it does mean the stronger claim this section originally
made here ("twelve distinguishable citation sets") does not hold, and is
removed rather than repeated. What *is* true and machine-checked: every drill's
`sourceBasis` is non-empty, canonically formed, resolvable, and not
`V3-PLAN`-only (§7).

## 5. The boundary rule 1 draws

Rule 1 (`docs/dev/UPGRADE-PLAN.md`, carried forward unchanged by `V3-PLAN.md`
§1) is a line between a **concept** and a **document**. Stated in our own words,
for this registry:

**May be taken from a public source, and cited by `sourceBasis` id:**
- A naming or organizing **convention** — that a "CM" is a control module, that
  a station can be console-direct or server-cached, that alarm handling follows
  a small set of named states.
- A **parameter or display name** that is industry-conventional, not
  Honeywell-invented prose — `docs/dev/UPGRADE-PLAN.md`'s rule 1 says this
  outright: "Names of parameters, priorities, displays and behaviours are fine
  (they are conventions); prose must be our own." (The earlier draft of this
  line quoted a paraphrase of that sentence rather than the rule itself; fixed
  to the verbatim text, checked against `docs/dev/UPGRADE-PLAN.md` line 9.)
- A **standards concept**, cited by clause number, never by reproducing the
  standard's text (`docs/RESOURCES.md` §2.19 is deliberately "cite clause
  numbers only").
- A **published, open process model** — the do-mpc, APMonitor, LearnChemE,
  Kantor and similar academic/open-source models in `docs/RESOURCES.md` §4 —
  re-derived into this simulator's own equations and prose, with attribution.

**May never enter this repository, under any citation:**
- Honeywell **text, tables, screenshots, artwork, icons, or file names**.
- A **link to a mirrored manual** — `docs/RESOURCES.md` §3 keeps an entire
  "reference only, never copy" tier specifically *unlinked* from this
  repository; those URLs exist in the maintainer's private copy of the
  resource guide, not here, and citing a `sourceBasis` id never means "go get
  the text from §3."
- Anything from `docs/RESOURCES.md` §3 at all, full stop — that section exists
  to let a maintainer privately cross-check a name or a behavior against real
  vendor documentation, then implement it from scratch in the simulator's own
  words and artwork. Its own rule: "No text, tables, screenshots, frames or
  file names go into the repo, and no links to these locations appear in the
  repo, README, docs or issues."

A `sourceBasis` id therefore licenses a **concept**, never a **quotation**. This
is why every entry in §2 and §3 above is phrased as "what it licenses" rather
than "what it contains" — the citation says *this idea has a public precedent*,
not *this text came from here*.

## 6. Rule 6 — no employer or real-site material, ever

Rule 6 (`V3-PLAN.md` §1, added for v3) is a second, independent boundary from
rule 1, and this registry cannot discharge it — no `sourceBasis` id, however
correctly it resolves, licenses real-site content, because rule 6 has nothing
to do with public-vs-vendor and everything to do with **whose site it is**:

> Nothing photographed, copied, transcribed, or paraphrased from any real
> operating facility or its control system enters this repo or shapes its
> content: no site tag names or tag-numbering schemes, no display layouts, no
> setpoints or operating values, no interlock logic, no flowsheet topology
> copied from a workplace.

The rule is explicit that a **demo or training database at a real site** is
covered exactly like a live one — **ownership does not change with the
database label.** A tag list pulled from a vendor demo environment, a training
sandbox, or a "just for practice" export is still real-site material if it
traces back to an actual facility's naming, layout, or configuration; labeling
it "demo" does not launder it into a public source. Nothing in this repository
— the topology graph, the fault catalogue, the drill library, or the tag
database it derives from — originates from any employer's or any real
facility's system. All of it derives from published literature models and open
standards registered in `docs/RESOURCES.md` and this file, per `V3-PLAN.md`
§1: "If a proposed feature cannot cite a public source, it does not ship."

## 7. An internal spec section is not a public source

This distinction already caused one real defect and is recorded here so it is
not re-learned. `tests/provenance.test.js` — the automated provenance test gate
5 requires — carries a subtest named exactly for it: *"every drill cites at
least one PUBLIC source, not only V3-PLAN,"* with this reasoning inline in the
test file:

> Gate 5 requires a REGISTERED PUBLIC source. `docs/dev/V3-PLAN.md` is this
> repo's own internal spec, not a public source, so "V3-PLAN section 5" cannot
> discharge it.

`docs/dev/V3-PLAN.md` is where this feature was *specified*; it is not where
any concept in it was *sourced from*. Citing it as a `sourceBasis` would prove
only that the code matches its own plan, which release gate 5 does not ask —
gate 5 asks whether the *concept* the code teaches has a public precedent
outside this repository. The same test file records a second, related historical
divergence worth carrying forward: `src/topology.js` and `src/drill-arch.js`
once risked drifting to two different spellings of the same registry id
("`RESOURCES-2.14`" with a hyphen versus "`RESOURCES 2.14`" with a space) —
"two modules, one registry, two vocabularies," in the test's own words. Both
issues are why §1 above states the canonical id form explicitly and why the
automated test (not just this document) checks every id's form and origin on
every run, rather than trusting a one-time human read.

As of this writing (§2, collected directly from the running code), every
`sourceBasis` id on both modules is in canonical form, resolves to a real
`docs/RESOURCES.md` section, and every drill carries at least one `RESOURCES-*`
citation alongside anything else it declares. `node --test
tests/provenance.test.js` passes all fifteen of its assertions against the
current code.

## 8. Verification

```
node --test tests/provenance.test.js
```

runs the automated check this registry mirrors: it parses `docs/RESOURCES.md`'s
own headings into a section-id set (guarded by a positive control — a
fabricated section id must NOT resolve, or every negative result in the file
would be meaningless), builds the real topology graph, and asserts that every
topology node and every drill carries a non-empty, canonically formed,
resolvable `sourceBasis`, that no drill relies on `V3-PLAN.md` alone, and that
no two drills share byte-identical provenance.

To regenerate this registry's data rather than trust this document, require the
two modules directly and read what they emit — the same pattern the test uses:

```js
const { load } = require('./tools/logic-harness');
const Topology = require('./src/topology.js');
const DrillArch = require('./src/drill-arch.js');
const { Component } = load();
const c = new Component({});
c.initSim();
const g = Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
// g.nodes[id].sourceBasis for every node; DrillArch.drillById(id).sourceBasis for every drill.
```

A registry built any other way — by transcribing `V3-PLAN.md`'s tables, or by
memory — can drift from what the code actually cites without either the tests
or a reader noticing. This one cannot, because it was built the same way the
gate is checked.
