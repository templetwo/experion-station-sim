<!-- @artifact dev -->
# Optional live material integration

This increment makes the synthetic U3 → U4 material lane available in a fresh
`composition_mass_v1` run. U1 and U2 remain independent. It adds no MOA consumer,
hydraulic network, shared cooling, coupled reaction energy or property package.
The independent numerical reference uses SciPy offline. The browser and
standalone use plain JavaScript with no new runtime dependency.

Open `INSTR`, authenticate, and select **START FRESH COMPOSITION RUN**. This
replaces the current run and leaves it frozen. Use RUN to advance, then view U4.
The instructor can route the separator draw to product or off-spec inventory.
The operator sees delayed receiving-product A and water measurements and level;
the raw component inventories remain instructor/evaluator evidence.

## Authority and progression

The [integration contract](../../docs/dev/G2-LIVE-INTEGRATION-CONTRACT.md) and
original [v1 recipe](recipe.json) were committed at `ddde5bf` before live code.
The candidate implementation was committed at `fea4916`, together with its
failed numerical evidence and the prospective [event amendment](../../docs/dev/G2-LIVE-EVENT-AMENDMENT.md).
The [active v2 recipe](recipe-v2.json) changes only event localization: exactly
32 bisections locate each relief crossing before advancing the remainder of
the material substep. Physical parameters, input domains and comparison limits
remain unchanged. No pressure clipping or mass correction is permitted.

Seven inventories own reactor, separator water/oil/chamber 2, receiving product,
off-spec and gas mass. Integrated transfers carry A/P/W/G through the lane.
Normal PV505 vent and independent PSV-502 relief have separate external gas
counters. Gas pressure follows declared synthetic constant compliance, with
1100 kPa lift and below-1000 kPa reseat. This is not relief-sizing validation or
a thermophysical model of gas heating and changing headspace.

## Preserved failure

[discrete-latch-v1.json](receipts/discrete-latch-v1.json) retains the original
7/8 numerical result. The closed-normal-vent probe fails: approximately
28.30 kPa maximum pressure discrepancy and 1.95 s accumulated relief timing
error. Mass closure and live relief operation passed, which did not establish
accuracy. `receipts/live-v1.json` is the original filename for the same failed
receipt; it is not a separate campaign or an accepted baseline.

[The source archive](archives/discrete-latch-v1.json) records the exact compared
source bytes and hashes. Reproduce to a new path:

```sh
python tools/g2-live/reproduce-discrete-latch.py --out /tmp/discrete-latch-v1.json
```

Exit 1 is expected because that candidate fails. Reproduction of the archived
source produced a byte-identical receipt. Historical stage-one and liquid-only
geometry receipts remain attached to their old runtime and recipes. Their
positive capture tests materialize a hash-verified historical runtime with
`tools/g2-history/archive.cjs`; their original capture tools still refuse a
changed production model.

## Meaning of the new checks

The independent Python reference uses the frozen liquid geometry equations and
a separately implemented gas balance with SciPy DOP853 terminal events. Eight
new probes compare all 108 inventory, generation and transfer fields, pressure,
relief event order and event times. They include high-rate domain limits,
starvation, weir changes, diversion, heater loss/restoration and vent operation.
Closure, nonnegative mass and a tighter reference solve are separate checks.
Agreement on those probes does not establish global validity of synthetic
kinetics or a physical calibration.

The [v2 numerical receipt](receipts/live-v2.json) passes **8/8 probes** with
source hashes checked before and after evaluation. Maximum mass discrepancy is
0.0126002 kg (0.084418 of the applicable original tolerance); maximum pressure
discrepancy is 0.000002569 kPa; maximum relief-event time discrepancy is
5.70 × 10⁻¹⁰ s. These maxima span different probes. The eight cases are not a
complete Cartesian validation of the allowed input ranges. Reproduce with the
Python, NumPy, SciPy and Node versions recorded in that receipt:

```sh
python -B tools/g2-live/reference.py --out /tmp/live-v2-reference.json
python -B -m unittest discover -s tools/g2-live -p 'test_*.py'
```

`check-live.cjs` runs a separate deterministic native-plant campaign: heater
removal/restoration and closure of the normal vent. It requires committed
production and campaign sources, an up-to-date model ID and the exact active
generated recipe. Its receipt names the revision and model hash actually run.
It makes zero model calls and does not re-evaluate or relabel any MOA baseline.

Live lifecycle tests cover browser/Kernel parity, exact checkpoint continuation,
reset/backtrack/replay, invalid-state rejection, whole-scan rollback, channel
fault quality and remote/public truth exclusion. Default-mode drill, U4 and
upset golden files are preserved unchanged.

## Accounting and observation limits

`quality_proxy_v1` remains the historical analyzer-qualified LV503 volume
contract. `composition_mass_v1` separately counts external product dispatch;
internal separator-to-tank transfers are not counted again as production.
Truth-qualified dispatch and analyzer-qualified mass proxies are separate.

AI511/AI512 have 15 s transport delay, 30 s lag and a 5 s sampling cycle. Fresh
startup has no invented prehistory; the analyzers are unavailable for the first
15 s. A valid off-spec sample remains GOOD. A bad/unavailable observation cannot
qualify dispatch. Source time, publication time and both ages remain explicit.
There is no automatic diversion tied to a delayed reading.

Browser snapshots use schema 3.1; Kernel plant checkpoints use `peb.plant.v2`.
Legacy restores remain legacy and infer no purity. Missing historical meter
state starts a new declared accounting interval. The new material recipe
identity is validated; initial v1 candidate composition states are not silently
upgraded to v2.
