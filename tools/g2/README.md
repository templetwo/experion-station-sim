<!-- @artifact dev -->
# G2 offline composition prototype

This implements the first offline milestone of
[the G2 contract](../../docs/dev/G2-STAGE-ONE-CONTRACT.md). It uses SciPy to check
a synthetic composition model and replays a native heater-loss trajectory into
that model. Nothing imports this directory from the application or changes live
U3/U4 inventories, product quality, controls, checkpoint state or plant boundaries.

## Reproduce

Run from the repository root. Python 3.14.6 and Node v22.23.2 were used for the
checked receipt. Create the environment outside the production tree:

```sh
python3 -m venv /tmp/ess-g2-venv
/tmp/ess-g2-venv/bin/python -m pip install -r tools/g2/requirements.txt
/tmp/ess-g2-venv/bin/python -B -m unittest discover -s tools/g2 -p 'test_*.py' -v
node --test tests/g2-capture.test.js
/tmp/ess-g2-venv/bin/python -B tools/g2/run.py --out tools/g2/receipts/stage-one.json
```

Package installation needs a package source or cached wheels. All subsequent
calculation and capture commands run offline. The normal Node suite requires
neither SciPy nor Python packages. No Cantera, CoolProp or thermo package is
installed by these requirements; their registry entries describe later candidates.

`run.py` captures native inputs afresh, verifies pinned runtime and harness
hashes, runs both scenarios, and exits nonzero if the consequence, closure,
capacity or numerical checks fail. It records source/input hashes, versions,
solver settings, inputs, component errors, quality timings and output accounting.
For a saved capture:

```sh
node tools/g2/capture-native.cjs --out /tmp/g2-native-input.json
/tmp/ess-g2-venv/bin/python -B tools/g2/run.py --native-input /tmp/g2-native-input.json --out /tmp/g2-replay.json
```

A supplied file's source metadata is explicitly unverified by the Python replay;
its schema, timeline and model input bounds are checked. Fresh capture verifies
the source bytes. The capture intentionally refuses a changed native model;
changing that pin requires a new baseline decision and receipt. Reproduction on
another architecture may differ in the last numerical bits; assess the recorded
tolerances. Identical source/input hashes are required before comparing results.

## Declared model

`recipe.json` is the numerical authority. A/P/W/G are **mass lumps**, not named
chemical species; every parameter and specification threshold is synthetic.
There is no claim of elemental balance, HDO chemistry, VLE, calibrated kinetics
or energy conservation. Fogler's public rate-law and balance forms are held in
RESOURCES-7.37; delay/lag is RESOURCES-7.32; the solver is RESOURCES-7.48.

For reactor component mass `r_i`, separator mass `s_i`, product inventory `p_i`
and off-spec inventory `o_i`, with feed mass rate vector `f_i`:

```text
k(T,a) = a * k_ref * exp[-(E/R)*(1/T - 1/T_ref)]
g_i = [-1, 0.78, 0.20, 0.02]_i * k * r_A
dr_i/dt = f_i - r_i/120 + g_i
ds_i/dt = r_i/120 - s_i/60
oil_i = product_partition_i * s_i/60
dp_i/dt = (1 - diversion) * oil_i - p_i/600
do_i/dt = diversion * oil_i - o_i/900
```

Water and vent draws use their declared partition fractions. Every component's
three fractions sum to one. All external draws, feed and signed reaction
generation are integrated into cumulative ledgers. Closure is checked at every
recorded time, with an absolute tolerance floor for zero-feed periods. Gross
product dispatch is numerically integrated; each 0.5 s interval is assigned to
qualified, off-band or unknown using its left-end **truth**, never its analyzer.
The classification has 0.5 s time resolution; its categories sum to gross output.

This is a **well-mixed surrogate with draining inventories**, not a fixed-bed
reactor or a constant-volume tank. Steady reactor conversion is `k*tau/(1+k*tau)`.
At 650 K/activity 1 it is 0.905660377; at 450 K it is 0.239205490. The initial
reactor/separator inventories use 90% conversion and therefore have a small
initial transient. Native replay uses the same declared initial inventory;
the larger native feed creates an additional filling transient.

The product specification is A ≤ 15% and W ≤ 0.2% by mass. Empty inventory has
unknown quality. The analyzer applies 15 s transport delay, a 30 s first-order
lag, and 5 s sample hold to both fractions. Its prehistory is the initial truth.
The first valid measurement initializes the filter; later invalid periods
withhold readings and retain the numeric state so recovery resumes the lag.
The uniform observation grid must resolve delay and sample events exactly.

Capacity exceedance and negative mass are findings that fail acceptance; they
never silently truncate inventory. This prototype does not model overflow,
pressure, NPSH, feed depletion, liquid-full behavior, or protective recovery.
Diversion is an explicit input, not an automatic analyzer-controlled action.

## Numerical and operating evidence

The candidate is fixed-step RK4 at 0.5 s. SciPy `solve_ivp(method='DOP853')` is the
independent integration reference, with separate solves at every input change,
rtol `1e-10`, atol `1e-12` kg and maximum internal step 2 s. The receipt repeats
at rtol `1e-12`, atol `1e-14` kg and compares RK4 at 0.25 s. This validates these
equations over the two recorded scenarios, not the live simulator's integrator
or every point in the declared envelope. Unit tests include analytical CSTR
transients, conservation, zero activity/feed, diversion, restart windows,
off-grid input changes, invalid inputs and analyzer boundary cases.

The prescribed case is 650 K for 600 s, 450 K until 1800 s, then 650 K until
5400 s. The native case commands TIC311 MAN/OP=0 at 600 s, then AUTO at 1800 s,
capturing flow, heater temperature, bed temperature and instructor activity
every 0.5 s. The replay holds each sampled bed temperature over the next interval;
heater temperature remains in the trace for evidence, not as a second thermal
input. The existing native heater/bed produces the temperature fall; the Python
model calculates the separate composition response. It does not calculate heat.

In the checked receipt, native replay product becomes off-spec at **725 s**;
the analyzer reports it at **765 s**, both sustained for at least 30 s. At
3000 s the native bed has reheated but the offline product is still off-spec.
This passes the persistence test, not a completed-recovery criterion. The longer
prescribed case requalifies at **3666 s**, with earlier off-band output retained
in the ledger. Water alone improves during conversion loss, demonstrating why
the separate unconverted-A criterion matters.

Maximum inventory error against the refined reference is about **1.18e-6 kg**
across the two scenarios; halving RK4's step reduces it by about sixteenfold.
Maximum component closure residual is below **6e-10 kg**. Exact results and
hashes are in [receipts/stage-one.json](receipts/stage-one.json).

Live promotion still needs an explicit inventory/interface design and resolution
of the deferred plant-map change. Shared cooling and recovery follow that work;
hydraulics, G3 and G4 retain their existing gates.
