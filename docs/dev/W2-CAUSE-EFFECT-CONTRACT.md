<!-- @artifact dev -->
# W2 — the cause-and-effect matrix as an assertion layer: the build contract

**Status:** architect's contract, 2026-09-13, MacBook seat (claude-opus-5).
**Implements:** `docs/dev/CONVERGENCE-SPEC.md` item 2 / work item W2, acceptance §3.1.6.
**Checkpoint:** `0bbfd13` on branch `v3`.

Every builder reads this whole file before writing a line. The names below are the contract.
Hard rules 1–5 of `UPGRADE-PLAN.md` and rules 6–7 of `V3-PLAN.md` hold. **`src/models.js` is not
touched. No golden moves. The matrix never fires an effect.**

---

## 0. What the mapping pass found, and what it changes

Five read-only agents plus a completeness critic mapped W2 at `0bbfd13`. The critic earned its keep
twice: one mapper returned a placeholder (`summary: "test"`), and the critic noticed, answered that
mapper's question from scratch, and said so. Four findings reshape the work.

### 0.1 The golden set reaches only four of the six rows — the gate needs more, not less

Anthony's gate on making the chart operator-visible is that the assertion test *"has passed clean
across the full golden set"*. Verified against every fixture under `tests/fixtures/`:

| Row | Fired by a golden fixture? |
|---|---|
| TK-101 `HIHI TRIP` | yes — `drill-D3`, `upset-pump` |
| R-201 `HI TEMP TRIP` | yes — `drill-D4`, `upset-cool` |
| R-310 `HI TEMP TRIP` | yes — `drill-D12`, `upset-bedact` |
| V-502 `PSV LIFT` | yes — `u4-vent-closed-psv` |
| **V-401 `PSV LIFT`** | **no fixture anywhere fires it** |
| **R-202 `HI TEMP TRIP`** | **no fixture anywhere fires it** |

`drill-D9` and `drill-D11` — the two that plausibly should — both record `"trips": {}` and a
breakdown entry reading *"trip avoided"*, 20/20, *"no trip"*. They complete without tripping.

So the gate as worded is **satisfiable while leaving two of six rows unverified**, and those two
rows would reach an operator-visible chart having never once been checked against the code. That is
the exact failure the gate exists to prevent.

**The fix is to author coverage, not to weaken the gate.** W2 adds two scripted scenarios —
V-401 driven to its 950 kPa PSV set, R-202 driven to its trip — and the promotion gate becomes
**"all six rows verified against the code"**, which is strictly stronger than the original wording
and actually achievable. The two new scenarios are **not** goldens: they are assertion-coverage
scripts, so no fixture is added to the frozen set and nothing recaptured.

### 0.2 "Score INTERLOCK.DEFEAT from the declared matrix" does not map onto what exists

Acceptance §3.1.6(d) asks for this. Verified: **`DRV-M202` never appears as a `raiseTrip` source**
anywhere in `src/models.js`. There is no coded M202 agitator interlock — no permissive, no latched
SIF — comparable to the six process trips. A5's gate is a *generic* synthesis: an accepted START
while `m.trip` was true, on **any** motor, keyed on `actionType` + `target`. The matrix is keyed on
`raiseTrip`'s `(src, cond)`. **The two mechanisms have no natural join key.**

This is the third time an item in this spec has asked for something the plant does not have, and the
honest response is the same each time: say so rather than build a join that fabricates one.

**Scoped out of this cut, pending Anthony's ruling.** W2 builds the matrix, the reader, the
assertion and the chart. §3.1.6(d) is deferred with three readings for him to choose between:
(a) the matrix grows motor-interlock rows, making the join real; (b) the scorer consults the matrix
only for *blast radius* — which effects a defeated interlock governs — and severity stays where it
is; (c) §3.1.6(d) is struck as unmappable, as §3.4.6(b) was in W1. **Nothing in this cut changes
`src/drill-arch.js` scoring**, so `tests/refusal-scoring.test.js`'s outcome-based guarantee is
untouched whichever way he rules.

### 0.3 A seventh trip bypasses the seam, and shares an effect column

`P.trips.skin` (H-310 tube-skin) is raised in the **app's** `interlocks()`, calls `this.dTrip()`
directly, and never passes through `ctx.onTrip`. A reader on the seam will never see it.

It is not merely absent — it **shares an effect column** with row 5: `VALVE_TARGET`'s entry is
`FV311: (P, L) => (P.trips.bed || P.trips.skin) ? 0 : …` (`src/models.js:332`). A matrix declaring
FV311 as governed by R-310 alone would be **wrong about the plant**, and would teach a trainee that
one cause closes that valve when two do.

So the matrix declares **seven causes**, each carrying an explicit `seam` field — `'onTrip'` for
the six, `'app'` for the tube-skin trip — and the reachability test expects exactly six at the
seam. The seventh is declared, charted, and marked as not-assertable-here, which is honest about
both the plant and the instrument.

### 0.4 The two effect implementations agree — and nothing pins them

`VALVE_TARGET` (`src/models.js:323-337`) and the app's `valveTarget(tag, id)` (`…dc.html:2793`)
produce identical results for all fourteen valves today. **Independently verified; there is no live
bug.** The equivalence holds only because `valveMap()` (`…dc.html:2792`) is the exact inverse of
`VALVE_TARGET`'s key set, and **no test pins that correspondence** the way
`tests/models-valves.test.js` pins `MODEL_VALVES` against `V` and `Topology.VALVE_OF`.

W2 closes that gap for free, and the closure is a real result independent of the chart.

---

## 1. The module

**Path:** `src/cause-effect.js`. Flat in `src/`. **Marker:** `// @artifact production` in the first
three lines. UMD wrapper, `root.ESS.CauseEffect`. Pure: no DOM, no timers, no clock, **no
randomness**, and it never writes to anything it is passed.

**Exports:**

```
MATRIX            the declared causes and effects (§2)
CHART_VISIBILITY  'instructor' | 'operator'   -- the one-line flag (§4)
causes()          the declared cause rows
effects()         the declared effect columns
cells()           {causeId, effectId, action} triples -- the chart body
createRecorder()  -> {observe(src, cond, simTime), seen(), reset()}
verify(seen)      -> {ok, findings:[...]}   code-vs-matrix comparison (§3)
chart()           -> {rows, cols, cells, orphans}  render model for the display
```

Findings are `{code, severity, detail, tags}`, severity `'refuse' | 'note'`, as in W1.

---

## 2. The matrix data

**Seven cause rows.** Each: `id`, `src`, `cond`, `seam` (`'onTrip'` or `'app'`), `variable`,
`comparator`, `threshold`, `eu`, `latched: true`, `reset` (the real reset expression), `desc` (the
`raiseTrip` description string, verbatim), and `site` (`file:line`). All from the verified table:

| id | src | cond | threshold | reset | seam |
|---|---|---|---|---|---|
| `TK101_HIHI` | TK-101 | HIHI TRIP | `tankL >= 98` | `< 90` | onTrip |
| `R201_HITEMP` | R-201 | HI TEMP TRIP | `rT >= c.tripT` (185) | `< c.resetT` | onTrip |
| `V401_PSV` | V-401 | PSV LIFT | `drumP > 950` | `< 900` | onTrip |
| `R202_HITEMP` | R-202 | HI TEMP TRIP | `b.T >= c.tripT` (110) | `< c.resetT` | onTrip |
| `R310_HITEMP` | R-310 | HI TEMP TRIP | `h.bed >= c.tripT` (480) | `< c.resetT` | onTrip |
| `V502_PSV` | V-502 | PSV LIFT | `s.pres >= c.psvSet` (1100) | `< c.psvReset` | onTrip |
| `H310_SKIN` | H-310 | TUBE SKIN TRIP | app `interlocks()` | app | **app** |

**Effect columns**, declared **from `VALVE_TARGET`'s own gating, not re-derived**: an effect is
`{id, target, action, causedBy: [causeId…]}`. `FV311` carries `causedBy: ['R310_HITEMP','H310_SKIN']`
— two causes, one column, as §0.3 requires. Non-valve effects (feed cut, jacket full cold, fuel gas
shut off) are declared as `action` text on the cell, sourced verbatim from each `raiseTrip` `desc`.

**Provenance.** Every threshold and reset in this table comes from this repository's own
`src/models.js`. `RESOURCES-7.8` (IEC 61511) and `RESOURCES-7.10` (CCPS) are cited **for the C&E
framing and the voting vocabulary only** — both are CITED-NOT-HELD, so no number, default or
equation is taken from either, and the module header must say so.

---

## 3. The reader, and where it attaches

**Attach by chaining, at `…dc.html:2751`:**

```js
onTrip:(src,cond)=>{ this.dTrip(src,cond); if(this.ceRecorder) this.ceRecorder.observe(src,cond,this.P.t); },
```

`dTrip` runs **first and unconditionally**, so today's drill scoring is byte-identical. Verified
safe: `dTrip` touches only `this.state.drill.m`, and the guard means a missing recorder is a no-op.

Three facts the mapping pass established, which the builder must not re-litigate:
- `this._ctx` is memoised, nulled only in `restoreSnapshot()` (`:3353`), and every closure reads
  `this.P` / `this.L` fresh at call time — a stale ctx is never actually stale.
- `onTrip` fires **exactly once per latch transition** (each site is guarded by `!P.trips.<flag>`
  and sets the flag in the same block). **The recorder needs no de-duplication.** A second firing
  after a reset is a genuinely new trip event and must be recorded as one.
- `onTrip` fires identically in live stepping, replay, and the node harness.

**`verify(seen)`** compares what the code fired against what the matrix declares:
`SEAM_TRIP_UNDECLARED` (a trip fired with no matrix row) and `SEAM_ROW_UNREACHED` (a row no
scenario fired) are both `'refuse'`. Order and tick are compared, not just membership.

---

## 4. The chart, and the one-line flag

**There is no existing feature-flag idiom in this repo** — the mapping pass grepped for one and
found only the never-implemented prose in the spec. So this establishes it, minimally:

```js
var CHART_VISIBILITY = 'instructor';   // -> 'operator' when all six seam rows verify. ONE LINE.
```

A module-level const in `src/cause-effect.js`. Promotion is that one word; demotion is the same word
back. The app reads `ESS.CauseEffect.CHART_VISIBILITY` and gates the display entry on it, falling
back to instructor-only if the module or the field is absent — **fail closed**, the opposite of
`dofPreflight`'s fail-open, because the risk here is a surface shown too early rather than a drill
blocked.

A test asserts the flag is `'instructor'` **and** that flipping it to `'operator'` is what changes
the gate — so the promotion path is exercised before it is taken.

---

## 5. Tests

**`tests/cause-effect.test.js`** — module-level. The seven declared rows against `src/models.js`
(every `src`, `cond`, threshold and reset); exactly six carry `seam:'onTrip'`; `FV311` is declared
`causedBy` both R-310 and H-310; `verify()` reports both named failures, constructed; `chart()`
returns no orphan cells; the flag is `'instructor'`; the module contains no `Math.random`,
`Date.now` or `new Date`.

**`tests/app-cause-effect.test.js`** — app-level, via `tools/logic-harness.js`. The recorder
observes a trip the code fires; `dTrip` still receives every trip (drill scoring unchanged);
**deleting the recorder leaves every golden digest byte-identical** (§3.1.6(e), done as a real
stub-and-diff over representative goldens, not asserted in prose); the chart is not reachable while
`CHART_VISIBILITY` is `'instructor'`.

**`tests/cause-effect-coverage.test.js`** — the promotion gate. Drives **all four** golden scenarios
that reach a trip **plus the two new scripted scenarios** from §0.1, and asserts all six seam rows
fire and match the matrix tick-for-tick. **This test passing is the precondition for flipping the
flag**, and it says so in a comment at the top.

**Extend `tests/models-valves.test.js`** — pin `valveMap()` against `VALVE_TARGET`'s key set, the
gap §0.4 found. Independent of the chart and worth having regardless.

---

## 6. Acceptance, mapped to §3.1.6

| Spec | Discharged by |
|---|---|
| (a) code equals matrix across scripted upsets | `cause-effect-coverage.test.js`, **all six rows**, goldens plus two authored scenarios |
| (b) every row reachable, no trip without a row, both directions | `verify()`'s two named failures, plus the seam-count assertion (six of seven) |
| (c) chart renders every row and column, no orphan cells | `chart()` test |
| (d) INTERLOCK.DEFEAT scored from the matrix | **deferred — §0.2. No join key exists. Awaiting Anthony's ruling; `drill-arch.js` untouched.** |
| (e) deleting the reader leaves goldens byte-identical | stub-and-diff test, not prose |
| (f) suite 0 fail | full run, under both the `anthropic`-present and `-absent` conditions |

**Golden impact: none**, structurally — a chained read-only subscriber that writes only to its own
recorder. If any golden moves, the reader has been wired into the step path; stop, do not recapture.
