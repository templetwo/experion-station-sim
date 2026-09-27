<!-- @artifact dev -->
# G2 stage one: composition reference model before live integration

2026-09-27. Offline implementation contract, based on simulator
`bfed001fc89d9beaa640b30a7886d5f16f61a31b`. **Stage 1a and a one-way native capture
are implemented in `tools/g2/`.** The prototype uses prescribed temperatures;
it adds no energy model or live composition state. SciPy comparisons are executed;
the other library candidates remain documentation assessments.

## Approved scope and measured starting point

Anthony selected **G2 option B, in small stages**: conserved composition through
U3 → U4 and product inventory first, then shared cooling and recovery. The
decisive operating consequence is that removing heat reduces conversion and
eventually produces off-spec material. Hydraulics remains unopened. G3 and G4
remain open. The first stage does **not** authorize replacing the live U3
three-scalar boundary with a component vector.

Receipts: [review and merge discussion](https://thetempleoftwo.slack.com/archives/C0C4G9PMXQE/p1790485531563219),
[ruling in its thread](https://thetempleoftwo.slack.com/archives/C0C4G9PMXQE/p1790485891507479),
and Anthony's direct statement in the implementation session. The Stack thread
`thread_20260927_010603_1369c3d7` remains open; that is a recording task, not an
unmade scope decision. Proposals `82c77582` and `029bb832` were reported pending;
this seat did not approve or close them and did not submit duplicates.

Both reviewed branches merged: simulator PR #2 at `bfed001`, MOA PR #1 at
`ac25243`. The [fresh deterministic evaluation](https://github.com/templetwo/master-operations-agent/blob/68aae66752885e98986ecdc2a78ecdc962fa5386/receipts/source-map-v2/README.md)
records **8/10 useful, 8/8 guards**, with zero model calls. Both cooling-loss
seeds abstain on uncertain TIC202. Historical results remain bound to their
original revisions. This receipt is evidence of current agent behavior, not a
composition or thermodynamics validation.

The live implementation has three important limits at this checkpoint:

- `src/boundary-dof.js:66` declares only flow, heater temperature and bed
  temperature across U3 → U4: `h.f`, `h.pre`, `h.bed`.
- `src/models.js:648` still derives the U4 liquid split from feed, waterFrac and
  activity. Its gas term is separate. These terms are not a conserved reaction.
- `src/product-meter.js:2` declares `quality_proxy_v1`. Its inventory is U4
  liquid holdup, not a receiving-product tank assay; AI509 observes carry-over.

## Builder sequence within the ruling

**Stage 1a: an offline whole-lane reference model.** Build it outside production
imports, driven by prescribed flow and temperature histories and an explicit
synthetic material recipe. It owns its own reactor, separator and receiving-tank
inventories. Its results are prototype-model results, not live plant truth.
U1 and U2 remain unrelated islands. Prescribed feed is sufficient for this
increment; a pressure-driven feed path or an NPSH trip is not required to start.

**Stage 1b: offline replay implemented; no live shadow state.** The capture reads values
of the existing three-scalar boundary plus declared instructor/configuration
inputs and compares the prototype with a native trajectory. Its isolated native
instance receives the declared heater-cut/recovery commands; the Python replay
feeds no levels, analyzers, controls or product qualification back into the live
application. Any future checkpointed
shadow state includes delay queues, counters and configuration identity; its
interface and visibility need explicit tests.

**Live promotion is a separate integration decision.** If reactor component flow
starts driving U4 partitioning, analyzers, product accounting or level dynamics,
the material contract has expanded. Placing it in a shared ledger, closure or
callback does not avoid that change. The integration contract must identify
which model owns each inventory, declare the interface, and resolve the deferred
plant-map change. Approval of G2 is settled; promotion into live dynamics is the
specific remaining design boundary.

## Library decision

| Registered candidate | Role in this sequence | Adoption condition |
| --- | --- | --- |
| RESOURCES-7.48, SciPy 1.18.1 | First offline numerical reference, alongside analytical limiting cases | Supply the equations and declared synthetic parameters; check tolerance/step convergence |
| RESOURCES-7.45, Cantera 3.2.0 | Conditional second reactor/energy reference | Declare species, elemental composition, phase thermodynamics and mechanism; execute a compatible liquid-phase/reactor test |
| RESOURCES-7.46, CoolProp 8.0.0 | Offline properties for identified fluids | Pin backend, property data, units and validity limits; no runtime WASM |
| RESOURCES-7.47, thermo 0.6.1 | Later offline flash/specification checks | Select phase models and individually identified constants/correlations; no database import |

The builder recommendation is **analytical cases plus SciPy first**. Undefined
A/P/W/G labels do not yet supply the inputs Cantera needs. A generic combustion
mechanism cannot substitute for missing liquid chemistry. Cantera is a candidate
for checking a declared model, not an automatic validation of the proposed plant.
Assimulo adds no identified requirement in this slice and is not selected.

The simulator keeps its current fixed 0.5 s step. The offline comparison tests
an explicit RK4 candidate at 0.5 s and 0.25 s against DOP853; it does not certify
the live scan's different equations or stepping method. SciPy and NumPy are
installed in an isolated development environment, with exact version pins.
The runtime dependency policy and deterministic plant scan are unchanged.

## Material recipe required before the prototype is coded

Use a versioned, reviewable input manifest. The default direction is explicitly
synthetic mass lumps, not a claim of real hydroprocessing. The builder may choose
and label synthetic constants without reopening G2, but must write the manifest
and its bounds before using them. `tools/g2/recipe.json` now supplies that recipe;
it was written before the kernel. Every model parameter and acceptance threshold
is declared synthetic, not taken from a source example.

| Manifest field | Required meaning |
| --- | --- |
| Components and basis | A/P/W/G identities or abstract mass lumps; mass units throughout, or molecular weights and component moles |
| Inlet | Declared mass fractions, density used to convert volumetric feed, temperature units and imposed flow history |
| Reaction | Source for rate-law form, units, reaction order, catalyst dependence, temperature dependence, parameter provenance and valid envelope |
| Yields | Nonnegative mass yields summing to consumed mass, or mass/element-balanced stoichiometry for named species |
| Inventories | Initial reactor, separator and product-tank contents; initial contamination and receiving-tank capacity |
| Partition | Per-component fractions across product/water/gas draws, summing to one; explicit destinations for every outlet |
| Product handling | Withdrawal and diversion rules; component-based acceptance limits; capacity/empty behavior without silent clipping |
| Measurement | Truth separate from analyzer lag, transport delay, sample clock and validity |
| Accounting | Absolute and relative tolerances valid at zero inflow; reaction generation recorded per component |

RESOURCES-7.37 now holds the public chapter 3 summary's first-order
rate-law row, `-r_A = k*C_A`, with `k` in inverse seconds, and visually read
Arrhenius and chapter 1 general balance images. These supply the balance and
rate-law forms. They do **not** supply a selected liquid mechanism, activation
energy, rate constant, yield, or heat release for this lane. Fixed-bed/energy
chapters remain unheld.
No existing U1 kinetic number or U4 `waterFrac` value is silently transplanted.

If the prototype adopts actual molecular chemistry, include every material
reactant, including hydrogen where required, in its balance. If it uses abstract
mass lumps, label them as such and do not claim elemental or HDO fidelity. Start
with prescribed thermal histories; coupled energy validation needs a separately
declared caloric model and held energy-balance source.

## Acceptance evidence for stage 1a

1. **Conservation:** every component satisfies input minus output plus reaction
   generation minus accumulation within its declared tolerance. Total mass
   generation is zero. Every separator partition closes; gas is counted on the
   same mass basis. No sum of unlike phase volumes is advertised as mass closure.
2. **Inventories:** no negative state or unreported clipping/disposal. With zero
   feed, later discharge is bounded by initial holdup plus any residual prescribed
   inflow. Do not require a mixed inventory to wash out in one residence time.
3. **Reaction limits:** zero activity/rate produces no reaction. Analytical
   constant-condition cases agree with the numerical reference. Temperature
   dependence follows the declared law only within its validity envelope.
4. **Heat-loss consequence, staged honestly:** first demonstrate that a declared
   falling-temperature history lowers conversion and eventually contaminates
   receiving inventory. Then use a captured native heater-loss trajectory for
   one-way shadow validation. Neither result proves a new coupled energy model
   or a live product-qualification repair. Define breach thresholds and hold
   times; do not replace a dynamic response with a scenario-triggered off-spec flag.
5. **Recovery and measurement:** restoring temperature does not erase existing
   off-spec material or lost-production accounting. Analyzer delay changes the
   reported time, not the underlying composition or past qualification.
6. **Numerics:** pin library, algorithm, tolerances, event handling and input/data
   hashes. Compare analytical cases and refined reference runs. Record errors
   for a candidate 0.5 s method; agreement among solvers establishes consistency
   of the equations, not physical calibration.
7. **Isolation:** production import graph, native `P`/`L`, `PLANT_MAP`,
   `quality_proxy_v1`, RNG streams and existing goldens remain unchanged for the
   offline milestone. Any later shadow adapter must prove the same invariance
   and checkpoint continuation before exposing instructor comparisons.

Do not relabel the source-map evaluation as a physics benchmark or change its
case expectations to restore 10/10. A later agent evaluation needs a new explicit
source/observation binding and separate reporting of valid quality abstention
versus useful advisory coverage. The six full-plant consequence tests remain
future acceptance criteria where they require unopened hydraulics or live state.

## Implementation receipt

See [tool instructions](../../tools/g2/README.md) and the
[numerical receipt](../../tools/g2/receipts/stage-one.json). The kernel owns four
synthetic inventories plus cumulative feed, water, gas, product, off-spec and
component-generation ledgers. Capacity excursions and negative masses are
findings, never clipping. Product truth uses both unconverted-A and water mass
fractions; its delayed analyzer does not define the truth or rewrite prior
dispatch qualification.

The native capture commands TIC311 MAN/OP=0 at 600 s and AUTO at 1800 s through
existing operator entry points. It records the original three scalar boundary
values and instructor activity. The Python replay reads those values and changes
only its own offline inventories. No live checkpoint, PLANT_MAP, U4 partition,
AI509, product meter, controller, random stream or golden is changed. Live
promotion, coupled energy, hydraulics, shared utilities and protective recovery
remain subsequent work under the boundaries above.
