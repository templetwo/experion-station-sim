<!-- @artifact dev -->
# Governed live operations

PEB consumes a self-contained copy built with `python3 tools/rt/build-artifact.py OUTPUT`.
Run `python3 tools/build-dist.py` first. The artifact pins source bytes, prepared
checkpoint, generated standalone station and Node major/minor runtime. No production
path evaluates the HTML or imports the test logic harness.

`extracted-methods.json` inventories the statically shared native methods.
`PlantKernel` checkpoints P/L/V, both RNGs, alarm engine, complete fault schedules,
phase/interlock latches, bounded trends, instructor/replay and exercise state,
message IDs, cause/effect deduplication, revisions, attention and product totals.
RT history keeps the most recent five minutes; full replay reconstructs longer
trajectories. Standalone keeps its existing history and local clock.

`?rt=1` requires the authenticated PEB parent. It has no local simulation timer.
Commands are intents; only the next committed parent snapshot changes the process.
The PEB worktree `/private/tmp/peb-live-coordinator/docs/realtime/README.md` contains
launch, credential, ownership, review, export and commissioning instructions.


## Observation and plausibility slice (2026-09-26)

`PlantProjection.project()` publishes the synthetic TIC202 transmitter reading
from `Measurement.observe()`. Its declared 0–100 °C range has a reporting interval
of −1.25–103.125 °C. Outside the nominal range the point carries `UNCERTAIN`, an
OPC UA `status_code`, `status_name`, and `limit`; Bad readings are Null. `sp_milli`,
`op_milli`, and `mode` retain their existing meaning. The controller still consumes
the native model PV; the native station faceplate, alarm history and control
trajectory keep their existing semantics. This is an export policy, not a
transmitter added to the control path.

The kernel checkpoints `plausibility` separately from process/control state.
Only instructor/evaluator projections include its findings and ledger. The local
instructor screen shows the findings too. Old checkpoints without this field
start a new observation interval at their restored process state.

The defaults assume 0.101325 MPa absolute jacket pressure, no declared feed
budget, and a 1e-9 m³ numerical tolerance for the legacy U4 liquid-volume terms.
To declare a different mission assumption when creating a kernel state:

```js
const state = PlantKernel.create({
  plausibility: {
    coolant_pressure_mpa_abs: 0.7,
    feed_inventory_m3: 25,
    u4_closure_tolerance_m3: 1e-9,
    model_envelopes: [{
      field: 'P.h.f', min: 30, max: 50,
      correlation: 'U4 inlet mission assumption'
    }]
  }
});
```

These assumptions never establish a pressure state, a feed tank, physical
composition, or whole-plant mass closure. A coolant pressure outside the held
NIST table produces a finding, not an extrapolated temperature. See
[the implementation contract](../PUBLIC-SOURCE-MAP-V2.md) and RESOURCES-7.23
through RESOURCES-7.26 for source receipts and the remaining gates.

`MODEL_OUT_OF_ENVELOPE` reports an out-of-table saturation pressure, a weir
integration step whose weir term alone can drain more than the initial excess
head, and excursions from explicitly declared `model_envelopes`. The optional
30–50 m³/h example above is a synthetic mission assumption, not a measured
calibration range. No mission envelopes are assumed by default. Available fields
are listed in `ENVELOPE_FIELDS` in `src/plausibility.js`; bounds are inclusive.
Missing values produce a finding too. Findings coalesce by field and remain
instructor-only; they neither constrain dynamics nor change exported quality.

The generated model ID and checkpoint bytes change with this additive observer.
Existing trajectory golden files remain unchanged. Consumers must build a fresh
artifact and explicitly update their own version pins before consuming this
working tree; this change does not rewrite an existing experiment's provenance.
MOA's matching compatibility change accepts uncertain source quality while
withholding those values from conclusions that require Good measurements.
