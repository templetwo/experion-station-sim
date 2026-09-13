<!-- @artifact dev -->
# W1 — the declared plant map and specification integrity at drill start: the build contract

> Item 6 was renamed after this contract was written (Anthony, 2026-09-13), from "explicit boundary
> streams and a degrees-of-freedom check" to **"specification integrity at drill start"**, for the
> reason §0.2 and §0.3 below establish: the DOF check as specified cannot fail on this plant. The
> **filename** is left as `W1-BOUNDARY-DOF-CONTRACT.md` because it is cited by that name from
> `CONVERGENCE-SPEC.md`, `CHANGELOG.md` and `src/boundary-dof.js`, and a path is an address, not a
> claim. Where this document says "DOF check" below, read "the specification-integrity check"; the
> original wording is left standing where it records what was believed at the time.

**Status:** architect's contract, 2026-09-13, MacBook seat (claude-opus-5).
**Implements:** `docs/dev/CONVERGENCE-SPEC.md` item 6 / work item W1, acceptance §3.4.6.
**Checkpoint:** `dfee660` on branch `v3`.

Every builder reads this whole file before writing a line. The names below are the contract;
nobody renames anything. Hard rules 1–5 of `UPGRADE-PLAN.md` and rules 6–7 of `V3-PLAN.md` hold.
`stepU1`..`stepU4` are not touched. No golden moves.

---

## 0. What the mapping pass found, and why this contract is shaped the way it is

W1 was specified before anyone had read the plant. Six read-only agents plus a completeness critic
mapped it at `dfee660`. Two findings reshape the work, and both are recorded here rather than
quietly designed around.

### 0.1 The plant is three islands, not a train

Exactly **three** fields of `P` cross a unit boundary, all in one direction, U3 → U4:

| Variable | Field | Kind | Written | Read |
|---|---|---|---|---|
| `qfeed` | `P.h.f` | flow, M3/H | `firedHeater`, `src/models.js:549` | `separator`, `src/models.js:648` |
| `Tpre` | `P.h.pre` | temperature, DEG C | `firedHeater`, `src/models.js:565` | `separator`, `src/models.js:654` |
| `Tbed` | `P.h.bed` | temperature, DEG C | `fixedBed`, `src/models.js:591` | `separator`, `src/models.js:654` |

Unit 01 (TK-101 / R-201 / E-301 / V-401) has **zero** `P`-field coupling to Unit 03: U3's process
feed comes from `V.FV310.pos` on an independent `FIC310` loop, not from any U1 output. Unit 02 is
fully standalone — every `P.b.*` field is written and read only inside its own banner. So the
simulator models **one** material boundary and **two** islands. `docs/dev/U4-SEPARATOR-CONTRACT.md`
already documented `qfeed` and `Thot` as U3's read-only outputs into U4; this contract generalises
that into a declared structure rather than discovering it.

Three fields are read by two units but written by neither unit's step code — `P.Tcw`, `env.Tamb`,
and `env.catAct` / `P.faults.bedact`. These are instructor and fault inputs, **not** boundary
streams, and the contract must not count them as such.

### 0.2 The literal DOF check is structurally vacuous — confirmed twice, independently

Spec §3.4.2 asks the check to count specified versus free variables at every boundary and refuse an
over- or under-specified start. Against this plant that check can never fail:

- **Over-specification is unconstructible.** U4 owns no actuator upstream of its own reads —
  `TV502`, `WV504`, `LV503` and `PV505` all act strictly downstream of where `qfeed` and `Thot` are
  read. Nothing can contend with U3 for a boundary variable.
- **Under-specification is unconstructible.** The simulator is an explicit time-stepped model in
  which every `P` and `V` field has exactly one owning write per tick. A variable cannot float the
  way classical DOF analysis means. A loop in MAN still yields a definite valve position.
- No preset and no drill `basePreset` ever overrides a controller **mode**; presets set `sp` only.

So acceptance §3.4.6(b) — "an over-specified and an under-specified boundary each fail with a named
reason" — is **not demonstrable on the material boundary**. Building only that check would ship a
gate that passes everything and teaches nothing.

### 0.3 The resolution: two lanes, one of which has teeth today

This contract keeps the literal check and adds the one that bites, clearly separated so either can
be removed without disturbing the other.

- **Lane A — boundary-stream specification.** The declared contract over the one real boundary.
  Structurally always passes today, and the module **says so in its own output** rather than
  implying it found something. It is not decoration: it is the declaration item 1 needs, and it goes
  live the moment item 1 replaces flow-driven assignment with a network solve, at which point
  contention becomes constructible. Lane A is the groundwork §3.4.1 and §4.1.4 promise.
- **Lane B — control-loop specification integrity.** `RESOURCES-7.3` (Seborg et al. 4th ed.) is
  registered for exactly this — its §3.4.8 citation reads "DOF analysis of **control loops**", not
  of streams — so lane B is cited, not invented.

**Amended after the build, and this is the honest bottom line.** Lane B was expected to be the lane
with teeth. It largely is not, and §3 records why: the one condition it was built to refuse —
an open cascade — turns out to be ordinary operation, not an ill-posed state, and
`tests/app-instructor.test.js` proved it by failing. `src/pid.js` is well enough designed that
**every** cascade mode combination is well-posed: INITMAN back-calculation handles a slave leaving
CAS, and `transferMode` refuses CAS without a master outright.

So the finding of W1 is not the check. **The finding is that this plant is well-posed by
construction** — one boundary with no possible contention, and a PID layer that makes every mode
combination well-defined. What ships refuses only the two states that are genuinely ill-posed and
genuinely reachable by *corruption* rather than by operation: a non-finite boundary variable
(`BOUNDARY_NOT_FINITE` — the NaN-leak class the 3.1.0 `VALVE_TARGET` fix documents, where an
unknown valve integrated to `undefined` and `makeSnapshot` then refused every snapshot) and a CAS
loop with no master (`CASCADE_NO_MASTER` — unreachable through `transferMode`, reachable through
`restoreSnapshot`, which populates `L` wholesale). Everything else is reported, not refused.

That is a smaller gate than §3.4.2 imagined, and it is the true one. A gate that fired on normal
operation would have been worse than no gate.

**Scope note for Anthony.** Lane B widens item 6 from inter-unit material streams to control-loop
specification. That is a scope decision. It is recorded here, in `CHANGELOG.md`, and in the spec, and
lane B is a single exported function plus its tests — deleting it leaves lane A and the declared
contract intact. If Anthony prefers item 6 to stay literal, lane B comes out and §3.4.6(b) is
struck as undemonstrable rather than faked.

---

## 1. The module

**Path:** `src/boundary-dof.js`. Flat in `src/`, like every other module — `src/data/` does not
exist and `build-dist.py`'s inliner is untested against a subdirectory (spec §3.1.2).

**Marker:** `// @artifact production` in the first three lines.

**Wrapper:** the repo's UMD form — `module.exports` under node, `root.ESS.BoundaryDof` in the
browser. Pure logic: no DOM, no timers, no globals, no randomness, no clock read.

**Exports:**

```
BOUNDARY_STREAMS   the declared data (§2)
ISLANDS            ['U1','U2'] with the reason each is an island
checkBoundaries(P)      -> {ok, lane:'A', findings:[...], note}
checkLoopSpec(L)        -> {ok, lane:'B', findings:[...]}
check(P, L)             -> {ok, findings:[...]}   both lanes, findings concatenated
formatRefusal(result)   -> string    one operator-readable line naming the first finding
```

Every finding is `{code, severity, detail, tags}` where `code` is one of the named reasons in §3.
`severity` is `'refuse'` or `'note'`. **Only `'refuse'` findings set `ok:false`.**

---

## 2. Lane A data contract

```js
BOUNDARY_STREAMS = [{
  id: 'U3-U4',
  from: 'U3', to: 'U4',
  note: 'the only inter-unit material boundary in the simulator',
  vars: [
    { name:'qfeed', field:'h.f',   kind:'flow',        eu:'M3/H',  spec:'flow', nominal:40,
      producer:'firedHeater (src/models.js:549)', consumer:'separator (src/models.js:648)' },
    { name:'Tpre',  field:'h.pre', kind:'temperature', eu:'DEG C', spec:'flow', nominal:320,
      producer:'firedHeater (src/models.js:565)', consumer:'separator (src/models.js:654)' },
    { name:'Tbed',  field:'h.bed', kind:'temperature', eu:'DEG C', spec:'flow', nominal:413,
      producer:'fixedBed (src/models.js:591)',    consumer:'separator (src/models.js:654)' },
    // nominal provenance, so no reader mistakes these for cited values:
    //   qfeed 40  -- the U4 design point, src/models.js PARAMS.U4 header comment ("U3 feed 40 m3/h")
    //   Tpre 320 / Tbed 413 -- the measured U3_HILOAD steady state (CHANGELOG 3.1.0: "44 / 320 holds
    //   the bed flat at 413 C for an hour"). Temple-set reference points for display only; NOTHING
    //   in either check compares against them.
  ],
}]
```

`spec:'flow'` on all three is the honest present state: the models are flow-driven, so the producer
fixes the value and the consumer accepts it. When item 1 lands, a variable whose spec becomes
`'pressure'` is one whose value comes from the network solve instead — that is the field this
declaration exists to carry.

`ISLANDS = [{unit:'U1', reason:'...'}, {unit:'U2', reason:'...'}]`, each reason stating the verified
fact from §0.1. Declaring the islands is as load-bearing as declaring the boundary: it is what stops
item 1 from inventing couplings that do not exist.

**Lane A check.** For each declared var: the field resolves on `P`, is finite, and is not NaN. A
missing or non-finite boundary variable is `code:'BOUNDARY_NOT_FINITE'`, `severity:'refuse'` — this
is a real guard, because `makeSnapshot` has historically refused snapshots over exactly this class
of NaN leak (CHANGELOG 3.1.0, the `VALVE_TARGET` fix). Lane A then emits one `severity:'note'`
finding, `code:'BOUNDARY_SPEC_STRUCTURAL'`, stating that contention is unconstructible while every
`spec` is `'flow'`, so a reader is never misled into thinking the lane proved something stronger.

---

## 3. Lane B: the named failures

Cascade pairs in the tag database, verified at `dfee660`:

| Master | Slave | Ships as |
|---|---|---|
| `LIC101` | `FIC102` | master default AUTO, slave `mode:'CAS'` |
| `TIC201` | `TIC202` | master default AUTO, slave `mode:'CAS'` |
| `TIC212` | `TIC213` | master `mode:'MAN'`, slave `mode:'CAS'` |

"Default AUTO" is verified, not assumed: the tag-database helper at `app:1841` is
`Object.assign({kind:'pid',mode:'AUTO',modeAttr:'OPERATOR',…}, o)`, so a point declaring no `mode`
ships AUTO and a point declaring no `modeAttr` ships OPERATOR. `PROGRAM` is therefore always
explicit, which is what makes exclusion 1 below safe to key on.

**`CASCADE_OPEN`** — `severity:'note'`. **Corrected during the build; it was specified as
`'refuse'` and that was wrong.** For a loop `m` with `m.slave`, where `s = L[m.slave]`: fires when
`(m.mode === 'AUTO' || m.mode === 'CAS')` and `s.mode !== 'CAS'`.

The first reading was that a master in AUTO with its slave out of CAS is two specifications for one
final element. `tests/app-instructor.test.js` falsified it within minutes of the wiring landing:
that test does `setMode('TIC202','MAN')` — taking the jacket slave to MAN while master TIC201 stays
AUTO — and then starts D1. The refusal blocked it.

And the test is right. **Taking a slave to MAN while its master tracks is ordinary operating
practice**, and it is drill D6's entire premise (`src/models.js:52`: *"its trip while the stuck
valve is dealt with (drill D6)"*). In DOF terms the state is not over-specified at all: the jacket
has exactly **one** specification — the operator's OP — and the master is simply idle,
back-calculating through INITMAN (`src/pid.js:106-128`) so the transfer back to CAS is bumpless.
Nothing is ill-posed. Refusing it would block legitimate work.

It is still worth **saying**. "You are starting this drill with the reactor cascade open, the
master is not in control" is exactly what an instructor wants surfaced at drill start, and no other
board surface shows it. So: reported as a note, never refused, and the drill arms.

**`CASCADE_NO_MASTER`** — `severity:'refuse'`. For a loop `s` with `s.mode === 'CAS'`: fires when
`s.master` is absent or `L[s.master]` does not exist. The slave waits for a setpoint from nothing.
`ESS.Pid.transferMode` refuses CAS without a master, so this state cannot be reached through the
transfer path — but `restoreSnapshot` populates `L` wholesale and does not go through it, which is
exactly what a pre-flight guard is for. The contract states this openly rather than implying the
condition is common.

**Three exclusions, each for a verified reason. All are `severity:'note'`, never `'refuse'`:**

1. **`modeAttr === 'PROGRAM'`** — sequence-owned. `Component.scmRestoreModes()`
   (`app:2878`, called every tick from the app's `stepU2` wrapper at `app:2801`) forces `FIC211`
   from MAN back to AUTO whenever the SCM owns it. Its mode is not an operator specification and
   must not be scored as one. Emit `LOOP_SEQUENCE_OWNED`.
2. **`badPv`** — a shed is a fault response, not a specification choice. `defaultShed`
   (`src/models.js:299-304`) drives a loop to MAN on bad PV by design. Emit `LOOP_SHED`.
3. **`master.mode === 'MAN'` with the slave in CAS** — well-posed, and it is how `TIC212`/`TIC213`
   ship. The master's OP is held by the operator; that is exactly one specification. Not a finding.

---

## 4. Wiring — single writer, and not where the spec said

The app page has **one** writer. The integrating seat does this section; no build agent touches it.

**Insertion point: `startDrill(d, opts)` at `app:3076` and `startADrill(id, opts)` at `app:3833`.**

Spec §3.4.3 named `startDrillFromMenu` / `startADrillFromMenu`. That is **wrong for the acceptance
criteria** and the contract overrides it: `tests/golden-drills.test.js:87` calls `c.startDrill(def)`
directly, bypassing the menu layer, so a validator at the menu wrapper would never run against the
golden suite and §3.4.6(c) could not be demonstrated. `startDrill` / `startADrill` are the common
layer for the menu (`app:3096`, `:3106`, `:3856`), the golden tests, and replay (`app:4175`, `:4200`).

**Exact line, and this is not negotiable.** The check goes **immediately before**:

```js
const delay=8000+this.modelCtx().rand()*7000;        // app:3084
```

**Because that line draws from the seeded random stream.** A check placed after it would consume a
draw and then refuse, advancing the generator cursor without arming anything and shifting every
subsequent trajectory in the run — the precise failure class that moves goldens, and the same one
`rand4` was introduced for in 3.1.0. Placed before it, a refusal draws nothing and a pass draws
exactly what it drew before. Verify this by digest, not by reading: the goldens must be
byte-identical, and they are the proof.

By that point the initial condition is fully established under both entry paths: a CANONICAL start
has applied `o.applySetup && d.setup(this)` two lines above (`app:3082`), and a LIVE STATE start —
which is `startDrill`'s fail-honest default, and what `tests/golden-drills.test.js:87` uses — has
had `def.setup(c)` applied by its caller beforehand. Either way the check sees the condition the
trainee will actually meet, which is the point of §3.4.4.

**Three hard constraints on the wiring:**

- **Skip while replaying.** The app exposes `replaying()` at `app:3225`
  (`return !!(this.instr&&this.instr.replay)`) — call that, do not reach into `this.instr` directly.
  Under replay the check records a note and does not refuse. A refusal during replay would break
  deterministic replay, which release gate 3 exists to protect. Precedent: `src/dispatch.js` already
  skips gates when `ctx.replaying`.
- **Read `P.t`, never the wall clock.** The validator takes no timestamp of its own. The 3.1.0
  release fixed drill starts re-basing the clock from `Date.now()`; nothing added here may read it.
- **Draw no randomness, ever.** The module is pure. It must not call `ctx.rand`, `ctx.rand4` or
  `Math.random`, for the reason above.

On refusal: do not arm, `ctx.message(...)` with `formatRefusal(result)`, and `addEvent('SYSTEM', ...)`
so the refusal is journalled. Return without mutating `this.state.drill`.

**Script tag:** `<script src="./src/boundary-dof.js"></script>` in the app `<head>`, with the other
`src/` modules, **before** `support.js`. `tools/build-dist.py` inlines it; no build change needed.

---

## 5. Tests — two files, disjoint, one owner each

**`tests/boundary-dof.test.js`** — module-level, `require('../src/boundary-dof.js')`, no harness.
Covers: the declared data (one boundary, three vars, two islands, every `field` resolving on a real
`P` from `ESS.Models.createState()`); lane A pass; lane A `BOUNDARY_NOT_FINITE` on a NaN boundary
var; lane B pass on the shipped three cascades; **`CASCADE_OPEN` constructed and named**;
**`CASCADE_NO_MASTER` constructed and named**; the PROGRAM, `badPv` and master-MAN exclusions each
asserted not to refuse; and `formatRefusal` returning a non-empty operator-readable line.
This file alone discharges §3.4.6(a) and (b).

**`tests/app-boundary-dof.test.js`** — app-level, via `tools/logic-harness.js`. Covers §3.4.6(c):
**every D-series drill and every A-series drill initial condition passes the check**, built the same
way `tests/golden-drills.test.js` builds them (`setup`, `needBatch`, then start), asserting `ok`
is true for each; that a drill still arms normally when the check passes; that a
constructed `CASCADE_OPEN` **does NOT** block a start (it is a note — see §3); that a refusing
finding, constructed with a non-finite boundary variable, does block both `startDrill` and
`startADrill` and is journalled; and that the check is skipped under replay.

Assert exact values and named codes, never ranges. Drive time only with `step(0.5)`.

---

## 6. Acceptance, mapped to §3.4.6

| Spec | Discharged by |
|---|---|
| (a) well-posed initial condition passes | `tests/boundary-dof.test.js` lane A + lane B pass cases |
| (b) over- and under-specified each fail with a named reason | **Partially, and the shortfall is recorded rather than papered over.** Two named refusals ship and are constructed in tests: `BOUNDARY_NOT_FINITE` (a boundary variable carrying no valid value) and `CASCADE_NO_MASTER` (a loop specified to follow a master that does not exist). Neither is a *material-boundary* over- or under-specification in the classical sense, because §0.2 and §0.3 establish that those are unconstructible on this plant — over-specification needs a second actuator that does not exist, and under-specification needs a variable that can float, which an explicit one-write-per-tick integration scheme does not permit. §3.4.6(b) as written cannot be discharged here, and claiming otherwise would be the kind of green-test-that-proves-nothing the W0 acceptance was corrected for |
| (c) existing golden drills all pass unchanged | `tests/app-boundary-dof.test.js` over all D- and A-drills, plus the whole golden suite staying byte-identical |
| (d) suite stays 0 fail | full run |

**Golden impact: none.** The check only refuses conditions no shipped preset produces, and it is
inert under replay. If any golden moves, the wiring is wrong — stop, do not re-capture.

**Sources.** `RESOURCES-7.1` (Luyben 1990) for DOF analysis and the steady-state-then-dynamics
discipline; `RESOURCES-7.3` (Seborg 4th ed.) for DOF analysis of control loops. Both are
CITED-NOT-HELD: cited here for method and framing only, and no equation, default or numeric value
in this module is taken from either. Every number in §2 comes from this repository's own calibrated
`PARAMS`, and each is labelled Temple-set where it is a choice rather than a measurement.
