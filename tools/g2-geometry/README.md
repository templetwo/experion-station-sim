<!-- @artifact dev -->
# G2 offline geometry reference

This is the second, separately versioned offline experiment. The design and
candidate recipe were committed at `0b62c3407436873818f29fed964bb58fc7322a89`
before its equations were implemented. The earlier `tools/g2/` experiment and
receipt remain unchanged. Both use synthetic mass lumps, not a chemical
mechanism, fixed-bed model or real-site process basis.

The new reference assigns material to a reactor, chamber-1 water-rich and
oil-rich layers, chamber 2, a receiving-product tank and an off-spec tank.
Each component inventory owns its material. Volumes and levels are derived
readings. SciPy checks the candidate integrator; it is an optional offline
dependency and never enters the standalone application.

## Reproduce

From the repository root, using an isolated environment:

```sh
python3 -m venv /tmp/ess-g2-geometry-venv
/tmp/ess-g2-geometry-venv/bin/python -m pip install -r tools/g2-geometry/requirements.txt
/tmp/ess-g2-geometry-venv/bin/python -B -m unittest discover -s tools/g2-geometry -p 'test_*.py' -v
node --test tests/g2-geometry-capture.test.js
/tmp/ess-g2-geometry-venv/bin/python -B tools/g2-geometry/run.py --out /tmp/geometry-v1.json
/tmp/ess-g2-geometry-venv/bin/python -B tools/g2-geometry/refine.py --out /tmp/refinement-v1.json
```

Package installation needs a package source or cached wheels. Tests, native
capture and the numerical campaign subsequently run offline. The ordinary
Node test suite does not require Python packages. The checked environment is
recorded in the receipt; requirements pin NumPy and SciPy exactly.

`run.py` captures native inputs afresh and verifies runtime, harness and adapter
hashes. The receipt binds its recipe, equations, observer, runner and capture
adapter, names every assessed case, and reports closure and numerical errors.
Its exit status fails when an assessed case fails. An out-of-envelope native
capture is listed separately as **not assessed**, never counted as a successful
composition experiment. Native heater-loss replay is required for acceptance.

## Material and geometry contract

The numerical authority is [recipe.json](recipe.json), schema `g2-geometry-v1`.
A, P, W and G are mass lumps. Consuming 1 kg A generates 0.78 kg P, 0.20 kg W
and 0.02 kg G. These yields conserve total mass but establish neither an
elemental balance nor HDO chemistry. Temperature is prescribed; reaction heat,
cooling duty, pressure, thermodynamics and energy closure are absent.

For reactor masses `r`, feed mass rate `F`, and reference mass `M=1000 kg`:

```text
k(T,a) = a * k_ref * exp[-(E/R)*(1/T - 1/T_ref)]
generation = [-1, 0.78, 0.20, 0.02] * k * r_A
reactor_out_i = F * r_i / M
dr_i/dt = F * feed_fraction_i - reactor_out_i + generation_i
```

The initial reactor mass equals M and remains M under this law. Residence time
is M/F; the steady converted fraction for all-A feed is `k/(k+F/M)`.
Zero feed isolates reactor material while reaction can continue. This is a
well-mixed surrogate, not plug flow and not the earlier draining reactor.

Reactor effluent W enters the water-rich layer; A/P enter the oil-rich layer.
G goes directly to a declared external sink. G can exist in the reactor but is
forbidden in liquid geometry compartments. The zero liquid-specific-volume
entry for G is a routing sentinel, not a gas density. There is no downstream
gas inventory, pressure response, vent valve or PSV consequence.

The live separator does have pressure-dependent outlets: PIC505 controls
PV505, and PSV-502 adds parallel relief capacity at 1100 kPa until pressure
falls below 1000 kPa (`src/models.js:675`–`:684`). This offline sink does not
replace or validate either path. Their distinct control/protection behavior
and discharged gas accounting must be retained in a later live integration.

Constant liquid densities are synthetic: A/P 800 kg/m3 and W 1000 kg/m3.
Volumes add by component specific volume. Chamber levels use native areas
0.12 and 0.07 m3 per percentage point. Initial masses imply hw=25%, ho=30%,
h2=50% and receiving-product volume 6 m3. This is a declared initial state,
not a claim of steady equilibrium.

The native water-head draw, thin-layer oil underflow, water carry-over and
Francis-form weir requests are retained using the existing Temple-set
coefficients. Each liquid source's competing withdrawals, including overflow,
share its available volume over the declared 2 s availability time. Actual
transfers use source composition and are counted once. The limiter is a
declared constitutive approximation, not negative-mass clipping.

Capacity excess requests flow to an external reject sink with a 5 s relaxation
time. Shared source availability can reduce that flow; sustained inflow can
sustain excess inventory. Capacity is not a hard clamp. The model
reports the excursion and accounts for the rejected mass. It does not claim
liquid-full pressure, gas blow-through, bund geometry or hydraulic realism.

Every transfer has a source, destination and integrated four-component counter.
An interval packet takes the difference between two counter states, labels
the interval and reports both kg transferred and the derived mean kg/s.
LV503-equivalent transfer to the receiving tank is internal. Only subsequent
tank dispatch crosses the product accounting boundary. Signed reaction
generation belongs in component closure; total-mass generation is zero.

## Truth, observations and lifecycle limits

Product qualifies at A <= 15% and W <= 0.2% by mass. An empty tank has unknown
quality. The analyzer observes receiving-tank truth through 15 s transport
delay, 30 s lag and 5 s sample hold. Its prehistory is the initial composition.
Invalid delayed material withholds publication; numeric filter state is held
until reacquisition. Truth-qualified dispatch and analyzer coverage are
reported separately. Dispatch classification uses interval-left truth and
therefore has the candidate observation grid's time resolution.

The native adapter emits two frames per 0.5 s interval: before the process
scan and immediately after U3, before U4. Effective activity includes the
native `bedact` fault multiplier. These are different one-way input timings,
not two integrations of a shared material transfer. Their difference is
reported without changing the native scan or selecting a live interface.
Native valve positions still come from the legacy station's controllers;
offline component inventories do not feed those controllers. This replay is
not a test of closed-loop control of the new material state.

The Python mass state can resume with its integrated ledgers intact. The
offline analyzer is a resampling calculation with explicit prehistory; it is
not a native checkpoint field. Browser/Kernel lifecycle parity, native
checkpoint migration, role visibility and new export quantities remain work
for a separately reviewed live implementation.

## Numerical evidence and limits

The candidate is RK4 at 0.5 s, checked at 0.25 s against SciPy DOP853. Input
events split integration intervals exactly. The reference has maximum step
0.5 s, rtol 1e-9 and atol 1e-10 kg, and is repeated with tolerances divided
by 100. Candidate comparisons cover every inventory, signed-generation and
transfer-counter state using the recipe's precommitted absolute/relative
limits. Closure is checked at every recorded state in each integration, not
just at the end; this is not a check of every internal adaptive solver stage.

Prescribed cases cover heat loss/recovery, reduced feed, zero feed, closed
product draw, crest/carry-over/starvation, diversion and activity loss. Native
heater-fuel loss supplies a separate replay using actual native controls and
thermal history. The native activity-step capture raises effective activity
to 1.35, but its temperature exceeds the committed 800 K envelope. It is
rejected without widening that envelope or claiming composition results.

The checked [geometry-v1 receipt](receipts/geometry-v1.json) has `passed: false`:
eight of nine assessed cases pass all checks, while the abrupt crest/carry/
starvation case fails numerical comparison. The 0.5 s candidate differs by
up to 1.142 kg; the 0.25 s candidate by 0.353 kg. Their maximum normalized
errors are 7.649 and 2.367 times the unchanged limits. Matching removal and
addition still close the ledger; conservation alone cannot establish
accurate transfer timing. Reproducing this receipt therefore exits **1**.

All nine assessed cases pass their component/total closure and consequence
checks. Native post-U3 heater-loss replay first goes off-spec at **1006.5 s**;
its analyzer indicates at **1050 s**, both sustained for 30 s. It remains
off-spec at 3000 s. The prescribed longer heat-loss case requalifies at
**5094.5 s** without erasing off-band dispatch. These are new geometry results;
the earlier prototype's 725/765 s receipt retains its original meaning.

The separately declared [refinement plan](refinement-plan.json) tests the next
two binary step sizes, 0.125 s and 0.0625 s, over the same nine assessed cases.
It retains the failed receipt and every original error margin. No finer-step
result selects or authorizes the live simulator's integration method.

The [refinement receipt](receipts/refinement-v1.json) records both steps passing
all nine cases. It pins the failed base receipt, recipe, computational sources,
refinement plan and exact fresh native capture before simulation. It checks
closure on every finer computed state and compares all 96 fields on the same
0.5 s observation grid, leaving analyzer and dispatch classification unchanged.

| RK4 step | Maximum inventory error against refined DOP853 | Maximum fraction of original comparison limit | Cases passing |
| --- | --- | --- | --- |
| 0.125 s | 0.022993 kg | 0.154020 | 9/9 |
| 0.0625 s | 0.012600 kg | 0.084417 | 9/9 |

The largest component closure residual across both finer campaigns is below
5.7e-8 kg. Heat-loss quality timings on the common observation grid match the
base campaign. Both native activity-step phases remain excluded. These are
bounded numerical results, not a convergence-order proof, validation of the
whole envelope or permission to change the live step. `refine.py` reproduces
this separate receipt and exits zero when both candidates pass every case.

The registered sources supply the balance/rate-law forms (RESOURCES-7.37),
delay/lag (RESOURCES-7.32), numerical API (RESOURCES-7.48), and the separator
arrangement/weir basis (RESOURCES-4.12). They do not supply the synthetic
densities, kinetic calibration, specification thresholds or limiter times.
Numerical agreement validates the implemented equations over the named cases;
it does not validate all points in the envelope or the physical adequacy of
the surrogate.

Live promotion still requires the interface/ownership decision in
[G2-INTEGRATION-DESIGN.md](../../docs/dev/G2-INTEGRATION-DESIGN.md). The application,
PLANT_MAP, legacy `quality_proxy_v1`, MOA pins and historical receipts retain
their existing contracts. Hydraulics, G3 and G4 remain unopened here.
