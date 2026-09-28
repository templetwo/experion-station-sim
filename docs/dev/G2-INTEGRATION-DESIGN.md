<!-- @artifact dev -->
# G2 next increment: inventory ownership and integration design

2026-09-28. **Design and candidate recipe; no geometry kernel or runtime implementation yet.**
The offline prototype was reviewed at `368c159597104ebdfb6cd18700587a47d529da67`
and merged through [PR #3](https://github.com/templetwo/experion-station-sim/pull/3)
as `0d308ace8799e34f14284ae6d688bb6b89b14df5`. This draft starts from that merge.
Runtime file/line receipts below apply to both commits: their application, `src/`
and standalone bytes are unchanged from `bfed001`.

## Recommendation and decision boundary

**Build a geometry-aware offline reference next, then review its explicit live
interface.** The merged prototype establishes a useful heat-loss consequence,
but its single mixed separator is not the native weir separator. Porting that
kernel directly would replace the native arrangement without validating it.

For eventual live promotion, choose **component inventories as the sole owners
of material**, with levels derived from those inventories. A separate shadow
model may be useful for comparison, but it must remain visibly separate and
cannot establish native product truth. Passive tracers on the existing volumes
would also remain a proxy while the old independent gas generation persists.

G2 option B is already approved in small stages. This design does not ask to
reopen that scope decision. It prepares the deferred decision about the live
U3 material interface and ownership. The current first-stage ruling does not
authorize that replacement; see [the recorded scope](G2-STAGE-ONE-CONTRACT.md).
Hydraulics, multi-rate stepping, authoritative C&E enforcement, G3 and G4 remain
outside this increment. Shared cooling and protective recovery follow composition.

Two decisions remain distinct:

1. **Offline geometry reference:** proceed within the approved G2 development
   scope with a separately versioned recipe, code, tests and receipt. Select and
   declare the missing synthetic assumptions before writing its equations.
2. **Live promotion:** after that evidence exists, approve a concrete interface,
   inventory owners, measurement/accounting versions, snapshot migration policy
   and new baseline. This document is preparation for that decision, not permission
   inferred from merging the offline prototype.

## Preserved evidence

The merged [stage-one receipt](../../tools/g2/receipts/stage-one.json), SHA-256
`562c42c6f06e7925ec3b9934c23f777d9fe445bd57ad7bf99c86b3d38451d175`, remains bound to
its five source hashes, recipe, native input and runtime model ID
`670f49e40c2b3395735e85b3bd09205f77f4a0598c955959f061f1d18810c832`.

It demonstrates numerical consistency and component closure for its own
synthetic equations. Native heater loss at 600 s leads to offline product
off-spec at 725 s and analyzer indication at 765 s; both breaches persist for
30 s. Native replay is still off-spec at 3000 s. The prescribed longer case
requalifies at 3666 s without erasing earlier off-band dispatch.

Retained validation: 25 offline tests passed; Node suite 1036 passed, four skipped;
25 documentation/artifact checks passed; standalone build and both browser smoke
checks passed. Independent AI review found no material defects. The merge is
verified on GitHub; the reviews are not represented as a controls-engineer signoff.

That receipt does not validate native U4 geometry, fixed-bed chemistry, product
densities, gas properties, reaction heat, finite feed, catalyst-fault binding,
the live integration method or all conditions inside the recipe envelope. In
particular, fixed `tau=120 s` with discharge `mass/tau` makes steady conversion
independent of feed rate at fixed temperature and activity. A reduced-rate
conversion benefit has not been demonstrated.

Preserve `tools/g2/` and its receipt as the v1 record. The new development
location is **`tools/g2-geometry/`**, with candidate recipe schema
**`g2-geometry-v1`**. Only the recipe and offline dependency pins are present at
this checkpoint; equations, capture adapter, tests and a new receipt remain to
be built. A new result must name its own recipe and source hashes. Do not
overwrite the old receipt, its expected timings or native pin.

## Candidate recipe recorded before implementation

[recipe.json](../../tools/g2-geometry/recipe.json) records the builder's synthetic
choices under the approved offline scope. These are model inputs to test, not
validated physical properties or a live-promotion approval:

- Native chamber areas, draw coefficients, weir coefficient and carry-over bands
  are copied from `src/models.js:208` through `:230`, retaining their Temple-set
  provenance.
- A/P use 800 kg/m3 and W uses 1000 kg/m3, with additive liquid volumes. G is
  routed entirely to an explicit external overhead sink; its zero liquid-specific
  volume is a routing sentinel, not a gas density or permission to hide G in a
  liquid inventory. No pressure or vent-control behavior is claimed.
- Reactor reference holdup is 1000 kg. The proposed component outlet is feed
  mass rate times component inventory divided by reference holdup. At steady
  holdup, residence therefore varies with feed; zero feed isolates reactor
  material while reaction may continue. This is a new well-mixed surrogate law,
  not a fixed-bed model or the v1 draining-reactor equation.
- Initial masses reproduce hw=25%, ho=30%, h2=50%; receiving product starts at
  6 m3. The declared inventory is not assumed to be exact equilibrium.
- Overflow goes to an external reject ledger through a 5 s relaxation; concurrent
  source withdrawals share a 2 s availability limiter. Those proposed laws must
  pass conservation, positivity, threshold and refinement tests before acceptance.
- Kinetics, mass yields and analyzer settings retain the explicitly synthetic
  v1 choices. New scenario thresholds and numerical tolerances are recorded
  before any geometry-model result exists. They are not physical calibration.

The isolated SciPy/NumPy pins are recorded in
[requirements.txt](../../tools/g2-geometry/requirements.txt). There is no new
package in the standalone. The user requested this groundwork be committed
before further implementation; the next change must build on this checkpoint.

## MOA review: separate bindings and separate experiments

The MOA-seat reflection supplied on 2026-09-28 was checked read-only against
MOA commit `68aae66752885e98986ecdc2a78ecdc962fa5386`. It supports the separation
already required by this design. These are documentary references, not a new
runtime connection, evaluation run or authorization to retarget a pin.

| MOA artifact | ESS binding | Scope of its result |
| --- | --- | --- |
| [drills-v1.json](https://github.com/templetwo/master-operations-agent/blob/68aae66752885e98986ecdc2a78ecdc962fa5386/moa/data/drills-v1.json#L5) | `3aad7695b8720b291999ef0903fcab7b7e008f1e` | Standing 10/10 useful, 8/8 guards under public development expectations; controls review remains pending. |
| [stream-v1.json](https://github.com/templetwo/master-operations-agent/blob/68aae66752885e98986ecdc2a78ecdc962fa5386/moa/data/stream-v1.json#L2) | `edd9dbcbb2b175fbf57121f3265794f8a082c146`, model `cc0b2a837f7573e40f650c5a637e59c5275522b2ec767aec61efdce1c9ed0e17` | The v0.8 slice binding; unchanged. |
| [source-map-v2 receipt](https://github.com/templetwo/master-operations-agent/blob/68aae66752885e98986ecdc2a78ecdc962fa5386/receipts/source-map-v2/README.md#L7) | `bfed001fc89d9beaa640b30a7886d5f16f61a31b`, model `670f49e40c2b3395735e85b3bd09205f77f4a0598c955959f061f1d18810c832` | Separate deterministic-baseline run: 8/10 useful, 8/8 guards; zero model calls. |

The score provenance and unchanged historical bindings are recorded in that
receipt's README, lines 12–20. Both `cooling-loss` seeds in the newer run abstain
with reason `quality`; TIC202 remains visible at 103.125 degrees C with uncertain
quality. This is evidence about the source observation and deterministic
assessment/guard behavior. It is not an observation of G2 product composition.

There are **two different faults**, not one experiment observed at two layers:

- **MOA: U1 cooling-water loss.** `scripts/export_trajectory.cjs:12` selects the
  `cool` fault, line 29 loads `U1_SS`, and line 37 applies the upset. Native
  `src/models.js:365` and `:376` reduce jacket cooling effectiveness; jacket
  temperature rises toward reactor temperature. The source-quality issue is
  the limited TIC202 observation of that temperature.
- **G2: U3 heater-fuel loss.** `tools/g2/capture-native.cjs:90` and `:93` command
  TIC311 MAN/OP=0. Heater and bed temperatures fall; a separate offline reactor
  surrogate converts less A, then contaminates its receiving inventory. MOA's
  current station observations contain neither that inventory nor its analyzer.

The shared lesson concerns the distinction between material state and what a
measurement supports. The 725/765 s thresholds are from the G2 trace alone.
Their 40 s separation is a measured threshold-crossing gap produced by transport,
lag and sampling; it is not a newly specified 40 s transport-delay constant.
It does not replace the U1 over-range test or establish a shared-cooling model.

ESS `0d308ac` retains the runtime bytes and model ID of `bfed001`; it does **not**
match the stream pin's `cc0b2a83…` model. MOA's `scripts/run_slice.cjs:43` checks
the exact revision and clean checkout before its model check at line 55.
`moa/drills.py:30` separately requires the manifest's exact revision. An identical
runtime/model hash is therefore insufficient to satisfy the older revision pins.
These statements are based on code inspection; no refused run was launched for
this documentation update.

Do not relabel the `bfed001` evaluation as an executed run against `0d308ac`.
Before a future composition consumer, establish one lifecycle, explicit snapshot
versions and a reviewed measurement/export contract. Any later MOA baseline
needs its own declared source revision, inputs, expectations and receipt. Keep
`quality_proxy_v1` historical and `composition_mass_v1` a distinct proposed
quantity. The next work here remains the offline geometry reference.

## Current ownership, verified in source

| Quantity or lifecycle | Current owner and receipt | Consequence for integration |
| --- | --- | --- |
| U3 feed flow | `src/models.js:549`, `h.f` from FV310 | Heater/feed flow is not a delayed reactor-effluent stream. |
| Heater and bed temperature | `src/models.js:565`, `:591` | Preserve the native thermal correlation until a separate energy model is justified. |
| Material interface | `src/boundary-dof.js:66`, `:111` | Only `h.f`, `h.pre`, `h.bed`; U1 and U2 remain islands. |
| U4 liquid generation | `src/models.js:648` | Water plus oil already allocate all incoming liquid volume. |
| U4 compartments and transfers | `src/models.js:657` | Water-rich and oil-rich inventories in chamber 1, mixed liquid in chamber 2; head draws and weir transfer. |
| U4 gas and pressure | `src/models.js:674` | Gas is generated separately; pressure is not a conserved G inventory. |
| Product draw sample | `src/models.js:668`; `src/plant-core.js:434` | Exact interval draw is emitted before the level update; preserve the callback chain. |
| AI509/AI510 | `src/models.js:696` | Lagged carry-over ratios with floors; their state, location and percentage basis differ from a receiving-tank mass assay. |
| Product meter | `src/product-meter.js:5` | U4 liquid holdup in m3 and LV503 output volume, under `quality_proxy_v1`; no downstream tank assay. |
| Shared process scan | `src/plant-core.js:142` | Browser and Kernel use Core; page `initSim` delegates at `Experion Station Simulator.dc.html:1950`. |
| Kernel product accounting | `src/plant-kernel.js:56`, `:89` | Meter is created and advanced outside Core. |
| Prepared initial conditions | `tools/rt/prepare-initial.js:8` | Another meter advancement path and an explicit post-preparation interval reset. |
| Kernel checkpoint | `src/plant-kernel.js:44` | Explicit fields, including product/plausibility; restore occurs every 0.5 s tick. |
| Browser snapshot/backtrack | `src/instructor.js:102`; `src/plant-core.js:1228` | Snapshots include P/L/V and plausibility, but no product accounting. |
| Projection | `src/plant-projection.js:9` | Subject is allowlisted; operator receives complete station P/L/V. New P truth is not automatically instructor-only. |

The page does not duplicate the process equations. The real integration hazard
is the split lifecycle for accounting and snapshots. Adding advancement to Core
while leaving Kernel and initial-condition preparation calls active would count
the same interval twice. Adding state only in Kernel would omit local browser use.

## Proposed material ownership

| Inventory | Proposed sole authority | Derived/read-only values |
| --- | --- | --- |
| U3 reacting holdup | Four component masses in a declared reactor surrogate | Total mass, composition, emitted effluent and residence indicator |
| U4 chamber 1 water-rich layer | Component masses assigned to that phase | Water-layer volume and `hw` |
| U4 chamber 1 oil-rich layer | Component masses assigned to that phase | Oil-layer volume and `ho` |
| U4 chamber 2 liquid | Four component masses, with an explicit mixing assumption | Liquid volume and `h2` |
| Receiving product tank | Component masses after the LV503 transfer | Product composition, qualified inventory and dispatch |
| Off-spec tank | Component masses from explicit diversion | Off-spec inventory and declared disposal/withdrawal |
| Gas | One declared external sink or one explicit inventory with venting | Gas accounting; pressure only after a separate declared constitutive relation |

The candidate recipe selects constant liquid densities of 800 kg/m3 for A and P
and 1,000 kg/m3 for W, with additive component volumes. These are synthetic
assumptions; the earlier prototype's 800 kg/m3 value covered feed density only.
With these declared specific volumes, each liquid volume is the sum of its component
mass times specific volume; levels are derived using native A1/A2, whose units
are m3 per level-percentage point (`src/models.js:208`). Do not integrate both
the old levels and new masses independently as owners of the same material.

Each internal transfer removes source composition once and adds it to its
destination once. When a receiving tank is in the accounting boundary, LV503
is an internal transfer; final tank dispatch is external output. A report may
show both rates, but it must never sum them as two products. No sum of liquid
volume and unlike component masses is a closure metric.

Retain the registered weir/head forms where useful, with their existing
Temple-set provenance (RESOURCES-4.12); they are not made physically calibrated
by moving them into a conserved model. Carry-over moves actual source material.
Competing withdrawals must share an available-material limit or a resolved
substep. Capacity exceedance must lead to a declared overflow/reject destination
or a failed reference run. Neither negative-mass clipping nor silent level clamps
can absorb the residual.

The reference must decide gas disposition explicitly. It must not combine native
`qwIn+qoIn=qfeed` and independent `gasFrac` generation with the prototype's 2% G
mass yield as three authoritative sources. A declared external gas sink is a
valid limited offline case; it does not validate PIC505 or a blocked vent. Live
promotion must resolve the gas/pressure/control relationship before claiming
that native gas consequences follow from component conservation. That question
is distinct from opening a pressure-flow network.

## Proposed interface and interval accounting

The eventual material boundary must identify **reactor effluent**, not rename
the current incoming heater flow. A proposed contract is `g2-material-stream-v1`:

- Ordered components A/P/W/G with authoritative integrated transferred masses
  in kg, finite and nonnegative. Interval-average kg/s is derived from those
  masses and duration. An instantaneous sampled rate is separately labelled and
  cannot stand for the integrated transfer when flow varies within the interval.
- Explicit source/destination inventory IDs and interval start/end in simulation
  milliseconds; one transfer ID per source, destination and interval.
- Temperature in K, with an explicit flag that it is supplied by the native
  thermal model and carries no coupled energy/enthalpy claim.
- Recipe/schema identity, validity, and reason when a stream is not assessable.
- Any derived volumetric quantity names its phase and density model. A flow
  total without that basis is not an alternative owner.

One interval flux packet supplies all balance updates, receiving-tank routing,
outlet sampling and accounting. Consumers do not recompute draw from post-update
levels. The component packet changes the declared material interface even if
stored in a shared ledger; `PLANT_MAP` must describe it before live use.

The reference input adapter must declare scan timing. The merged v1 capture
holds pre-step `h.f` and bed temperature over the next 0.5 s. Native U4 runs after
U3 during the scan, so using current post-U3 values is a different numerical
coupling. Compare those choices explicitly and bind one in the new receipt;
do not reuse v1's error claim for a different order.

Effective activity must include the active bed-activity fault multiplier
(`src/models.js:586`, `:649`), sampled at the phase actually used by the reactor.
The v1 heater-loss case had no such fault and correctly captured `env.catAct`.
Scheduled fault activation later in Core (`src/plant-core.js:168`) must not be
applied one scan early in a new adapter.

## Measurement and product-contract boundaries

Keep `quality_proxy_v1` intact as the historical analyzer-qualified volume
contract. Proposed composition accounting uses a new name, **`composition_mass_v1`**,
and reports component masses plus truth-qualified/off-band/unknown dispatch and
gross dispatch in kg. Analyzer-qualified coverage is a separately named observed
metric; it must not reclassify the truth-based mass ledger.
Those are different quantities, not replacement fields under the same version.

Declare each analyzer's sample location, component, mass/volume basis, range,
delay, lag, sample period and validity. A receiving-tank A/W analyzer is not
AI509's current separator carry-over ratio. Native AI509's 0.3 percent floor
cannot be compared silently with a proposed 0.2 mass-percent water limit.
Any tag additions require an explicit projection/tag-catalog review: every L
point currently enters the subject points list and page coach catalog.

Composition truth and delayed observations remain separate. Empty inventory is
unknown. Sensor faults or unavailable samples can change observed qualification
coverage without changing actual material or truth-qualified dispatch. Restoring temperature
or a sensor cannot clean a tank or erase earlier off-band dispatch. Automatic
diversion is a separate declared policy, not an implicit effect of the analyzer.

## Shared lifecycle, versions and visibility

Any later native component state must have one shared Core lifecycle covering
fresh initialization, every scan, initial-condition preparation, browser
snapshots/backtrack and Kernel capture/restore. A new pure UMD module can own
the state transitions; Core invokes it once. Wrapper-specific accounting calls
must be removed or made observers when ownership moves, with parity tests.
Presets must explicitly distinguish preparation inventory from the new accounting
interval; resetting counters must never reset contaminated inventory.

Snapshot requirements include component inventories, cumulative ledgers, input
phase, recipe identity, delay history, filter numeric state and validity, held
sample, sample phase and accounting classification state. Legacy snapshots lack
that history. Restore them only into explicit legacy/disabled mode, or refuse
composition continuation; do not invent historical purity or backfill an analyzer
queue while claiming exact replay. Declare new checkpoint/snapshot versions and
migration tests before enabling the new mode.

For any intermediate instructor comparison, keep shadow state outside P/L and
expose it only through an allowlisted instructor/evaluator field. Operator station
projections include all P today; the page also has a fixed remote-field hydration
list (`Experion Station Simulator.dc.html:1966`). Audit page coach, sidecar coach
and Kernel projections separately. A label alone is not a visibility boundary.

Live component promotion changes the model ID even if some legacy trajectories
remain equal. Preserve archived goldens and existing MOA pins; publish a new
explicit baseline and receipt for the new mode. Do not retarget the merged
prototype's native capture hash or amend historical advisory expectations to
make the new model appear compatible. No MOA update is part of this draft.

## Implementation order and acceptance

1. **New offline recipe and geometry reference.** Declare initial compartment
   masses, specific volumes, mixing/partition assumptions, gas disposition,
   overflow destinations, reactor residence law, quality basis and envelope.
   Retain synthetic provenance. If residence stays fixed, report that reduced
   rate does not improve steady conversion; if fixed holdup/residence varying
   with flow is selected, add its analytical and zero-flow tests.
2. **Conservation and consequences.** Demonstrate correct initial levels; internal
   transfer cancellation; component and total closure with signed reaction
   generation; nonnegative inventories; zero-feed, competing draws, closed
   product outlet, carry-over, diversion and capacity cases. Bound all external
   total mass discharge by total input plus initial total inventory. Per-component
   bounds also include signed reaction generation. Heat loss must contaminate receiving
   inventory; restoration must preserve contamination and previous losses.
3. **Numerical evidence.** Compare the actual proposed update order and candidate
   step with a refined SciPy reference around weir thresholds, starvation and
   overflow events. Name each case, input and recipe in a new receipt; the v1
   two-scenario result cannot cover new equations or event handling.
4. **Live-interface review.** Present the selected material packet, sole owners,
   gas/pressure semantics, measurement/tag contract, snapshot versions and
   proposed new baseline together. This is the concrete deferred decision.
5. **Implementation after that decision.** Port the tested equations into the
   dependency-free runtime, with browser/Kernel accounting parity; checkpoint
   continuation across heater commands and analyzer events; presets, freeze,
   single-step, accelerated run and backtrack; role-leakage sentinels; and
   unchanged unrelated islands/RNG streams. Archive old baselines before any
   new golden capture. Run the native suite, build and both browser smoke checks.

Held source scope: RESOURCES-7.37 supplies the general balance and rate-law forms;
RESOURCES-7.32 supplies delay/lag; RESOURCES-7.48 supplies the numerical reference
API. RESOURCES-4.12 registers the separator arrangement/weir basis. These sources
do not supply the new calibration or missing gas constitutive model. New source
claims must be registered and read before use, under the existing discipline.

This checkpoint contains the design, a candidate numerical recipe and offline
dependency pins. It adds no geometry equations, runtime component state, live
boundary, analyzer, meter, checkpoint, golden or external evaluator. Numerical
acceptance of the new recipe remains pending execution of the planned tests.
