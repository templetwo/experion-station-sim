<!-- @artifact dev -->
# G2 live integration increment

2026-09-28, based on `cf521323adbe8e26f2060e7201f6ce41bfb86039` (draft PR #4).
Anthony authorized continuation and simulator adjustments needed for integration:
“you can make adjustments to the simulator if you need to help integration”.
This increment implements the selected U3 → U4 interface in a fresh, explicit
`composition_mass_v1` mode. Default/legacy drills retain their existing dynamics.
This is the next integration authorization within G2 option B; it does not add
U1/U2 material connections, a hydraulic network, shared cooling, coupled reaction
heat, G3/G4 changes, MOA retargeting or a licensing decision.

## Declared before implementation

The new [recipe](../../tools/g2-live/recipe.json) inherits the frozen geometry
constants and records the additional gas assumptions, numerical domain, step
rule and comparison limits before equations. Old recipes and receipts remain
unchanged, including the 800 K rejection and coarse-step numerical failures.

Material masses own seven inventories: reactor, water layer, oil layer, chamber
2, receiving product, off-spec and separator gas. Reactor G transfer is now
internal; normal vent and relief are separate external transfers. There is no
independent `gasFrac` source in this mode. Startup gas is included in closure.
Liquid levels derive from masses and the declared synthetic specific volumes.

Gas pressure uses explicit constant compliance: absolute pressure is gas mass
divided by 1/27 kg/kPa, with initial mass 800/27 kg. PV505's full normal capacity
is 0.4 kg/s at 700 kPa differential to a 100 kPa absolute header. PSV-502 adds
1.5 times that capacity, lifting at 1100 kPa and reseating below 1000 kPa. The
paths share a donor availability limit above the header-pressure heel. These
are synthetic continuity choices; they do not model gas heating, liquid
displacement, gas properties or relief sizing. Preserve both control/protection
paths; no separately operated manual bypass is invented.

The native Core frame stays 0.5 s. The material solver uses deterministic RK4
substeps no larger than 0.0625 s, with additional rate-based subdivisions at
high synthetic reaction rates. Compare the new gas/events and declared domain
against a separately versioned SciPy reference before claiming numerical
acceptance. Passing the earlier liquid-only study cannot validate this extension.

## Ownership, measurement and persistence

Core owns initialization, exactly one material advancement and exactly one
legacy ProductMeter advancement. Kernel and preparation code cease advancing
the meter independently. The material module runs after native U3 and before
U4 measurements/PID. Native U4 liquid and gas source equations are bypassed in
composition mode; native cooling-temperature response and measurement noise
remain explicit adapters. U1/U2 and their RNG streams remain independent.

`this.composition` lives outside P/L, carrying masses, integrated ledgers, gas
latch, analyzer history/filter/sample clock, and accounting classification.
The new boundary carries integrated component transfers, not a renamed heater
feed rate. PLANT_MAP declares separate legacy and composition contracts for the
same U3 → U4 connection. Old volume accounting retains `quality_proxy_v1`;
new mass accounting never sums internal LV503 transfer and external dispatch.

AI511 and AI512 observe receiving-product A and W in mass percent, using 15 s
transport delay, 30 s lag and a 5 s sample cycle, with three decimal places.
LI513 observes receiving-tank volume level. These do not change AI509/AI510's
draw-carryover meanings. Valid off-spec readings are GOOD; unavailable readings
publish no numeric value. Preserve source/publication times and sample age in
every observation path. No new automatic trip/diversion follows these indicators.
Product truth and truth-qualified dispatch are instructor/evaluator-only;
operators receive explicitly selected measurements and observed coverage.

Mode activation starts a new declared inventory; it cannot infer purity from
legacy levels. New versioned snapshots/checkpoints include both accounting
systems and the complete material/observer state. Legacy snapshots restore
legacy mode with no composition. Missing historical meter data starts an
explicit new accounting interval. Validate restore before modifying the live
object. An invalid material transition must roll back the whole Core scan;
browser and Kernel cannot disagree about partially advanced state.

## Acceptance and preserved evidence

Verify JS/SciPy agreement; local/global mass closure and nonnegative inventories;
heater-loss contamination and delayed indication; normal vent restriction,
independent relief, hysteresis, vent-down and startup gas; browser/Kernel parity;
full checkpoint and analyzer continuation; resets/presets/backtrack; atomic
failure/restore; and subject/remote truth exclusion. Preserve legacy golden
files byte-for-byte. A changed production model receives a new model ID and
new receipts. Historical native capture tests run against a declared archived
baseline; their old tools continue to reject changed source bytes.

The work remains on a separate integration branch while PR #4 preserves the
offline geometry evidence. Review and merging are separate from building this
authorized increment.
