<!-- @artifact dev -->
# Public-source map rev 2: implementation contract

2026-09-26. This records the implemented observation and assertion slice of the
public-source map supplied for main at `edd9dbc`. The convergence specification
remains rev 4. The map's proposed production chemistry and wider fidelity work
remain proposals; this document records no new G1, G2, or G4 ruling.

## Scope and source receipts

The slice uses the observation/projection option recommended by map gate G3.
Physical state, PID inputs, trip actions, local faceplate PVs, seeded randomness,
and legacy golden replay behavior remain as before. Consumer-facing exported
measurements gain the synthetic transmitter policy below. A read-only core
observer records plausibility findings separately from `P` and `L`; checkpoints
and instructor snapshots carry that observer state.

Four primary references were independently read before implementation and added
to [RESOURCES.md](../RESOURCES.md):

| Id | Read scope | Supplies |
| --- | --- | --- |
| RESOURCES-7.23 | OPC Part 8 §7.3.2 Tables 61–63, §7.3.3 | Data-access quality meaning |
| RESOURCES-7.24 | OPC Part 4 §7.38 Tables 176–179 | Severity, InfoType, LimitBits |
| RESOURCES-7.25 | Official UA-Nodeset StatusCode.csv, relevant rows | Numeric status identifiers |
| RESOURCES-7.26 | NIST water saturation table, 0.1–1.0 MPa absolute plus 0.101325 MPa | Bounded pressure/temperature lookup |

The completed registry has forty-four sources in §7, covering all 21 proposed
rows from map §E. The grouped ISA-88 / ISA-TR106 row has two separate entries;
the historical Part 6 pointer is recorded alongside the official CSV in §7.25.
RESOURCES-7.4 and RESOURCES-7.23 through RESOURCES-7.33 are HELD for their recorded
read scopes. Other technical texts remain CITED-NOT-HELD; reading a title page
or licence does not hold the underlying equations. The registry's coverage table
maps every proposed row to its stable id. Runtime remains offline.

## TIC202 observation policy

The engineering range is 0–100 °C. The synthetic nominal current map is
`I_mA = 4 + 16 * T_C / 100`; the observation current is limited to 3.8–20.5 mA,
corresponding to −1.25–103.125 °C. Those current endpoints and the selected
engineering-range status are **Temple-set model policy**, not a claim of NAMUR
NE 43 certification or a measured transmitter response.

For an otherwise Good point, measurements within the engineering range remain
Good. Outside that range the exported value stays within the synthetic reporting
limits and carries `Uncertain_EngineeringUnitsExceeded` with the appropriate
limit direction. Existing Bad or more specific Uncertain source statuses take
precedence. This does not lower reactor or jacket temperature and does not change
what the local controller receives. A local faceplate can therefore still display
the original process PV while an exported measurement reports 103.125 °C/Uncertain.
Native alarm evaluation also retains its original PV: an exported historical
`alarmValue` denotes the native point PV when the alarm was evaluated, as its
`valueMeaning` states. It is distinct from the projected current `pv` measurement.

The High-limit OPC UA code is **`0x40940600`**, not the map's `0x40940200`:
`0x40940000 | 0x00000400 | 0x00000200` includes `InfoType=DataValue` as well as
the High bit. The Low equivalent is `0x40940500`. The registered sensor-failure
base code is `0x808C0000`; a Bad observation publishes Null. Generic invalid data
receives generic Bad rather than an invented sensor diagnosis. OPC numeric codes
are not Ignition QualityCode numbers, and no installed Ignition conversion or
licence behavior is certified by this slice.

The live sim projection already supplies loop SP, OP, and MODE. The matching MOA
snapshot exporter now carries those fields in a strict `loops` array under schema
1.3, with `--legacy` preserving the schema 1.0 shape. The existing live stream
already carried them. The matching quality change preserves the Uncertain family. Its strict
schema 1.2 field set still omits numeric OPC status and limit metadata; transporting
those requires a separate contract extension. The old catalog
export and a test injecting the old over-range value are distinct paths; a
legacy test's passing result alone cannot verify the corrected live stream.

## Assertions and their limits

`COOLANT_ABOVE_SATURATION` compares jacket temperature to the NIST lookup under
an explicit **assumed absolute pressure**, defaulting to 0.101325 MPa. The exact
atmospheric table row is 373.1243 K (99.9743 °C). Linear interpolation is used only
inside the recorded 0.1–1.0 MPa interval; out-of-range pressure has no inferred
saturation temperature. This flags use of a single-phase water approximation
outside its declared condition; it neither supplies a pressure state nor
simulates boiling or constrains the temperature.

The feed-budget check is optional and uses a declared finite U3 feed budget.
That budget is an assumption for comparison with cumulative feed, not a built
feed tank, suction path, pump curve, or proof that achieved flow will stop.

Level-bound and automatic-trip-clear findings expose the existing clamps and
auto-reset behavior. They do not implement overflow destinations, interlocks,
latching reset permissives, or standby-pump flow establishment. A finding alone
does not restore lost material or make a clamp conserve volume.

`MODEL_OUT_OF_ENVELOPE` covers the held saturation table's pressure interval,
the explicit weir term's nonnegative excess-volume condition, and optional
mission-declared ranges for the observer's supported fields. The weir term
requires `Cweir * sqrt(head) * dt / (A1 * 3600) <= 1` for positive excess head,
using the pre-update liquid levels. That necessary per-term condition is not
a proof of stability of the complete model. Mission ranges are explicitly
Temple-set, not measured calibration envelopes. Bounds are inclusive; unavailable
values cannot certify an in-envelope result. The observer records excursions,
keeps the existing computation, and does not propagate quality changes to
dependent tags in this assertion-only slice.

The implemented accounting basis is **`legacy-liquid-volume-v1` for U4**:
legacy liquid inlet and outlet volumes and modeled liquid inventories. The ledger
reports missing sample coverage separately from numerical closure and exposes
residuals, including loss at a clamp. Its default absolute numerical tolerance
is Temple-set, 1e-9 m³. It is not a whole-plant mass balance, a component assay,
a gas balance, or energy closure. Product qualification remains
`quality_proxy_v1`; accepted analyzer output is not proof of conversion or of
acceptable composition in a product tank.

## Corrections carried forward to the gated proposal

These are algebra and bookkeeping corrections to the supplied map, not added
kinetic or property models:

- With consumer heat duties `Q_i` positive **into** cooling water and rejection
  positive **out**, `C_loop * dT/dt = sum(Q_i) - Q_rejected`. The map reversed
  that sign. A tower's approach is a temperature difference; an absolute lower
  supply-temperature bound must include the ambient reference. Branch flow
  competition needs a finite shared pump/header model; a fixed-pressure source
  does not itself make one branch steal another's flow.
- Net component generation has the same sign as accumulation:
  `delta_inventory = in - out + generation`. A component residual is therefore
  `in - out + generation - delta_inventory`. Total mass generation is zero.
  A reacting liquid/gas lane cannot claim conservation by adding raw m³ across
  phases; declare mass or component mole accounting, densities, and synthetic
  yields that conserve mass. Use absolute and relative tolerances that remain
  defined during zero-inlet startup and shutdown windows.
- The product-tank exponential mixing formula requires constant volume and
  balanced inlet/outlet flows. A filling tank needs its changing inventory in
  `d(V*c)/dt`. Separate initial concentration from the acceptance limit; a tank
  starting exactly at that limit receiving worse feed breaches immediately.
- A mean residence time or an analyzer time constant is not a hard completion
  deadline. Consequence tests must name the response threshold and hold time.
  A logged clamp residual is evidence of non-closure, not an acceptable
  disposal stream; a future repair must give that material a destination.

G1 pressure-driven flow, G2 composition/shared utilities/recovery scope, and G4
gateway licensing stay pending. Their future acceptance tests need conserved
inventories, explicit equipment logic, and held model sources before claiming
that the six proposed operating consequences are physically implemented.


## Validation receipt

### Stack handoff readback

The user requested a live Sovereign Stack read on 2026-09-26. The connector's
`where_did_i_leave_off` call succeeded (server timestamp 2026-09-27T01:08:49Z)
and returned the `experion-station-sim` handoff. `recall_insights` then returned
the outcome and both cited rulings; `get_open_threads` returned G2 unresolved.
The earlier assertion that this connector's boot call was master-only does
not describe the observed call.

- Outcome claim: `0ce00ce35596662c4ab540c0efd504a13e318408c6823417365eee7fbe722ab8`.
- Archive reference: `9f509c83b9cd3f0bd579a623e0a19338d178d55e018329cc17eb634367c88206`.
  Its receipt says `checked_at_write: verified`, 49,804 bytes. This seat retrieved
  that stored receipt; it did not fetch and independently re-hash the archive.
- Cited rulings: `32078c6dc67a5e5a9462a6d16acc34cd05310b0003c6b86fda9ea57efa1dfb7a`
  and `0e034083409c967bb03a668f0cbe111d5fe0cd5f7374ae378fa4ff8e7399eacd`.
  Their human receipts are attested. Public sources are admitted; the course
  supplies topic direction, with its own wording, figures and worked examples
  excluded from the implementation.
- G2: `thread_20260927_010603_1369c3d7`, `resolved: false`. The three options and
  absence of an exact prior ruling are preserved. No ruling or thread closure
  was written by this seat.

The readback exposed two incomplete work-order items in the initial slice:
only four proposed sources had been registered, and the generic
`MODEL_OUT_OF_ENVELOPE` assertion was missing. These were completed during the
handoff reconciliation; the MOA legacy control-field path was also extended
with an explicit versioned contract, separately from its existing live stream.

### Local validation

Implemented in the isolated simulator worktree on
`codex/public-source-map-v2`, based on `edd9dbcbb2b175fbf57121f3265794f8a082c146`.
The matching MOA worktree is on `codex/source-quality-v2`, based on `f94c1a7`.
Validation below was performed in the working trees before commit. No existing
experiment pin or evaluation receipt was rewritten, and no gateway or model
campaign was run.

- `node --test tests/*.test.js`: 1,037 tests total, 1,033 passed, 4 skipped,
  zero failures. Four localhost sidecar tests could not bind in the initial
  sandboxed attempt; the permitted run with localhost access passed.
- Golden drill, upset, U4 and archived-v2 tests: 31/31 passed.
  `git diff --exit-code edd9dbc -- src/models.js src/pid.js tests/fixtures`
  is empty: model equations, PID code and golden files are byte-identical.
- `python3 tools/build-dist.py`: regenerated the standalone and model stamp.
  `tools/smoke.sh /private/tmp/experion-source-map-smoke`: folder and standalone
  browser builds passed; standalone was exercised with DNS blocked.
- The long-mission regression runs 30 simulated minutes at normal operation,
  then 30 minutes with the product outlet closed. The normal U4 residual is
  about 2.1e-14 m³; the blocked outlet reaches the existing clamp and produces
  `LEVEL_AT_BOUND` plus `U4_LIQUID_CLOSURE_EXCEEDED`. This verifies detection,
  not a physics repair.
- MOA: `python3 -m unittest discover -s tests -v` completed successfully with
  178 tests and 6 skips. Node stream-boundary and legacy exporter tests passed
  13/13 with `MOA_STREAM_SIM_REPO=/private/tmp/experion-source-map-v2`.
  The legacy exporter conversions use a declared fake projection; the local
  subject-projection checks use the simulator worktree. These are not new
  pinned evaluations. See MOA's `docs/source-measurement-compatibility.md`.
- `git diff --check` is clean in both worktrees. The source registry and artifact
  class checks pass. New simulator files carry their required artifact markers.
