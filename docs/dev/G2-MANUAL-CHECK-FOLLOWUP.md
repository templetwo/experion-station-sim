<!-- @artifact dev -->
# G2 live manual-check follow-up

2026-09-28. Baseline reviewed: `5e8f97cb1f21533a4f4bf976e40c60549fcee8de`,
model `de95d858805150a438b3d4dcacf7f6926da2cc51aecda639daba26bd84b10853`.
The native acceptance receipt remains attached to `80e1f55`, which has the
same production bytes. Neither that receipt nor the earlier numerical and
failed-candidate receipts is changed by this follow-up.

## User-operated evidence

The user reported passing startup availability, heater-loss contamination and
delayed indication, independent relief cycling, product diversion and exact
snapshot continuation. Plant actions used faceplates/buttons. Small page
scripts logged updates, froze at the prescribed times and repeated ten seconds
of stepping. The scripts and raw log were not supplied here; these observations
are recorded as user-reported evidence, separately from the code reproductions.
The user's browser was left frozen at 2:35 into the vent case and was not
operated, reloaded or inspected during the follow-up.

Three concerns were reported: a silent Live Diagnosis during relief, displayed
reseat pressure just above 1000 kPa, and reversal of product-tank level during
heater loss. Two additional observations concerned ongoing off-spec discharge
and slow TIC311 recovery. The correction that TI312 is a real bed-hotspot tag is
confirmed by the tag catalog and U3 graphic.

## Diagnosis coverage: defect repaired

The old rule list covered V-401 relief but omitted V-502. Its empty-result
message asserted that all loops were normal, although no such complete check
had been made. The repair adds:

- An urgent card for the operator-visible active V-502 PSV LIFT alarm.
- PIC505 high-pressure guidance based on its active alarm and a GOOD published
  pressure reading, including the consequence of MAN with a fixed output.
- A summary for active alarm conditions without a specific diagnosis, plus
  separate review guidance for returned alarm records.
- A scoped no-rule message, rather than an assertion that the plant is healthy.

BAD/UNCERTAIN measurement guidance does not infer transmitter failure or an
automatic MAN shed merely from signal quality. The new separator diagnosis uses
published measurements and alarm records, not hidden material or fault state.
The checks include repeated native relief cycles, acknowledgement, shelving,
returned alarms and unavailable/uncertain pressure evidence.

## Relief pressure: event and sampled state differ

The localized material event and the 0.5 s frame endpoint are different times.
After lift, gas leaves during the rest of the frame. After reseat, gas starts
accumulating again before the next frame endpoint. PIC505 then adds its existing
measurement noise. In the default fresh vent-closure case:

| Quantity | First lift | First reseat |
|---|---:|---:|
| Localized event time, s | 71.777153267 | 78.657277162 |
| Localized event pressure, kPa absolute | 1100.00000000005 | 999.999999999934 |
| Frame endpoint time, s | 72 | 79 |
| Frame endpoint material pressure, kPa absolute | 1096.653612 | 1001.483782 |
| PIC505 sampled PV, kPa | 1096.888090 | 1002.393212 |

The thresholds therefore operate correctly. The user's approximate 1096/1001
readings are consistent with frame sampling; the page logger itself was not
available to establish which field it recorded.

A separate journal defect was found: the localized reseat pressure was not
forwarded through the separator/model/Core clear path, so the native PSV RETURN
TO NORMAL entry retained the previous
lift value, 1100.0. Composition mode now passes the localized reseat pressure to
the alarm engine. The journal formats it as **1000.0**, rounded to one decimal;
that does not mean the strict-below-1000 predicate was removed. Journal time
continues to identify the processing scan (79 s in this example), not the
localized instant. Legacy-mode journal behavior is preserved.

New tests compare event pressure, frame pressure, noisy PV and journal value,
and prove identical physical trajectories before/after the logging repair.
Neither the numerical solver nor the lift/reseat thresholds changed.

## Receiving-tank level: expected balance under the declared recipe

Level is inventory-derived, not a purity indication. The reproduction gives
25.00% at startup, 22.99% at 600 s and 25.86% at 1800 s. The latter is lower than
the user's approximate 27%, while reproducing the reported reversal.

| Window, s | Product-tank inlet, m³ | External dispatch, m³ | Inventory change, m³ |
|---|---:|---:|---:|
| 0–600 | 5.254755 | 5.736726 | −0.481971 |
| 600–1800, heater off | 12.119262 | 11.430672 | +0.688590 |
| 1800–2580, heat restored | 8.544162 | 8.326740 | +0.217422 |

Unconverted A follows the oil route with P. The synthetic reaction converts A
into 78% P, 20% W and 2% G by mass; A/P have the same declared specific volume.
At fixed nominal feed, the reactor's oil-route volume is approximately
`40 × (1 − 0.22 X)` m³/h: about 32.07 at conversion 0.901 and 39.79 at conversion
0.024. Lower conversion therefore sends more liquid to the product route while
making it worse in composition. Separator residence and the receiving-tank
outlet determine the later level response. This is an internally consistent
consequence of the synthetic recipe, not a general claim about real chemistry.

The forensic reproduction's A contamination continues through heat restoration: AI511 peaks
at 74.290% at 42:55 and reads 70.859% at 47:36 in this reproduction.

## Tank outlets and slow heater recovery

Both tanks have continuous external outlets in the frozen recipe. Product
dispatch is inventory/600 s; off-spec dispatch is inventory/900 s. Changing
LV503 routing changes the destination of incoming material. Once diversion ends,
off-spec components decay by `exp(−t/900)` absent other inflow: after 300 s,
0.7165313 of each component remains. This is removal to the external off-spec
sink; it does not clean the inventory or return it to product. The instructor
panel now explains the continuing outlets beside the routing buttons.

TIC311's first return within 5 °C of its retained 320 °C SP occurs 17:49 after
AUTO in the reproduced case. Its existing bumpless transfer starts from the
current zero output; the default integral/tuning and native thermal dynamics
then restore heat gradually. Across 6000 paired legacy/composition frames, all
selected U3 process, PID and valve state fields match exactly. The slow recovery
was not introduced by composition. No tuning or thermal response was changed.

## Source and validation boundaries

The separately versioned [forensic record](../../tools/g2-live/receipts/manual-forensic-v1.json)
was produced by [inspect-manual-v1.cjs](../../tools/g2-live/inspect-manual-v1.cjs)
against an extracted copy of the exact `5e8f97c` runtime. All 31 production
files, the harness and the recipe are hash-checked before and after the run.
The paired U3 trajectory hash is
`077d7fe1b3d546443a750370633cac4cff104baf84411988cbce94357f27c647` in both modes.
This is explanatory reproduction evidence, not a new numerical acceptance or
an alteration to a historical result. To reproduce from the repository root:

```sh
ess_manual_root=$(mktemp -d)
git archive 5e8f97cb1f21533a4f4bf976e40c60549fcee8de src \
  'Experion Station Simulator.dc.html' tools/logic-harness.js \
  tools/g2-live/recipe-v2.json | tar -x -C "$ess_manual_root"
node tools/g2-live/inspect-manual-v1.cjs "$ess_manual_root" "$ess_manual_root/result.json"
```

The balance/outlet assumptions are in
[recipe-v2.json](../../tools/g2-live/recipe-v2.json) and
[material-model.js](../../src/material-model.js). Native U3 response is in
[models.js](../../src/models.js), [pid.js](../../src/pid.js) and
[plant-core.js](../../src/plant-core.js). The reporting regressions are covered by
[live-diagnosis-u4.test.js](../../tests/live-diagnosis-u4.test.js) and
[g2-relief-observation.test.js](../../tests/g2-relief-observation.test.js).

This follow-up changes diagnosis, the composition-mode reseat journal value and
an explanatory UI note. It adds no process connection, hydraulic network,
cooling utility, controller retune or MOA evaluation. The previous numerical
acceptance remains an eight-probe result with its original source hashes and
limits. Review and merging remain separate decisions.

Validation after the repair: **1101 Node tests pass, 4 skip**; standalone rebuild
and folder/offline smoke checks pass. The server on port 8767 was verified to
return the rebuilt standalone bytes. The patched runtime model ID is
`74154cd676c888fd8df23e8dd500f45f4814cce192396e01396f9b8bfb6eaf14`.
The user's already-loaded page retains its original code and frozen state.
