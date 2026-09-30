<!-- @artifact dev -->
# Receiving-product quality warning, version 1

2026-09-29. Baseline: merged main
`fa5e0e4427f64ff50a79a10f9141a22bbe832723`, model
`3e89d782780389e3a9855f17375588b6b2fc1f78e96b37e4fc0f16f99cc029bd`.

## Problem and bounded decision

The user reported that delayed AI511 reached about 73 mass % unconverted A
during heater loss while its displayed limit was 15 mass %, without a quality
alarm or diagnosis. The source confirms the gap: fresh composition runs gave
AI511 and AI512 empty alarm maps. The user's wider regression report remains
user-reported evidence; its underlying script and screenshot were not supplied
in this turn.

Add measured-quality warnings and advice to consider manual off-spec routing.
This implements the user's request to decide the warning behavior under the
existing simulator-adjustment authorization. It is a new documented policy,
not a claim that an earlier ruling was found. The integration contract's ban on
automatic trips or diversion remains in force. No automatic process action is
introduced, and no Stack ruling is recorded.

## Warning configuration

| Fresh composition run | Default warning | Priority | Extra delay | Deadband |
|---|---|---|---|---|
| AI511: receiving-tank A | PVHI at 15.000 mass % | High | 0 s | 0 mass % |
| AI512: receiving-tank water | PVHI at 0.200 mass % | High | 0 s | 0 mass % |

Thresholds come from the existing synthetic recipe's quality limits, not a new
chemical or product specification. Existing HI alarm semantics raise at or
above the threshold and clear below it. Equality is therefore a **warning at
the limit**, not proof of off-spec material: the material classifier continues
to accept values at the limit. Alarm configuration never changes that classifier.

The analyzer already has 15 s transport delay, 30 s lag and a 5 s sample cycle.
This warning adds no further delay. The default station deadband would be
1 mass % on a 0–100 range, which would prevent a 0.200 mass % water alarm from
clearing at any nonnegative reading. Zero added deadband is a declared choice
for these deterministic sampled signals, not a sourced industrial setting.
Existing engineer configuration, acknowledgement, shelving and out-of-service
controls still apply. There is no new Urgent limit or protective interlock.

State and limit mechanisms use the existing registered basis:
[RESOURCES-2.5, 2.6 and 2.9](../RESOURCES.md). Alarm Help fields follow
RESOURCES-2.10. Numeric recipe limits and analyzer timing remain exactly those
in `src/material-recipe.js`; no new external source or library is required.

## Evidence boundary

The shared `productAnalyzerObservation()` helper reads only the published point,
the simulation clock and declared analyzer timing. It does not read component
inventories, hidden faults, truth qualification or the routing destination.
It requires an explicit valid status code, quality and bad-PV flag; a finite
GOOD value; ordered, nonfuture source/publication timestamps; publication age
at most 5 s and source age at most 20 s. Ages are recomputed from timestamps.

Unavailable, BAD, UNCERTAIN, stale, malformed or future-dated samples cannot
raise a new quality warning or clear a retained one. Pending limit delays do
not accumulate through unknown evidence. A retained alarm may still be visible
in the alarm system, but diagnosis describes unavailable evidence rather than
asserting a current breach or recovery. A subsequent valid below-limit sample
can return the alarm to normal through the existing lifecycle.

The specific quality diagnosis uses eligible UNACK/ACKED alarm records and
valid published samples. It follows presentation policy v1 for suppression,
shelving, acknowledgement, fallback coverage and the eight-card limit.
Guidance distinguishes the delayed receiving-tank sample from the current
incoming stream. It suggests checking heater/bed or separator observations
and considering **TO OFF-SPEC** through the existing instructor routing panel.
Opening that panel does not operate the route. Diversion protects future tank
input; it does not clean the existing tank or stop either tank's outlet.

## Compatibility and review

Default legacy runs have no new points or alarms. New composition runs receive
the warning configuration. Restored snapshots retain their exact stored
configuration, including custom thresholds, delay and deadband; older snapshots
with empty analyzer alarm maps are not silently migrated. Their receiving-tank
panel identifies missing warnings and offers the fresh-run path. Existing
snapshot/checkpoint schemas and material recipes are unchanged.

The receiving-product panel is moved above the U4 drawing and wraps at narrow
widths so the fixed PIP mascot cannot cover the analyzer-limit explanation.
The user's paused browser and the merged-main server remain untouched while
this candidate is developed in a separate worktree.

Prospective `tests/product-quality-alarm-v1.test.js` checks the alarm/evidence
boundary, native heater-loss delay, manual routing, alarm states and snapshot
continuation. The alarm-help coverage inventory now includes both runtime
modes. Existing historical recipes, receipts, model bindings and golden files
are preserved; this change does not extend their evidence to the new model ID.

## Validation

The full Node suite reports **1121 pass, 4 skip, 0 fail**. The new warning and
expanded Alarm Help checks contribute 17 focused passing checks. Standalone
build and both folder/offline browser smoke checks pass. Independent review
also exercised a retained alarm with BAD sample quality through snapshot restore
and continued stepping, with identical resulting state.

The native heater-loss test removes heat at 600 s. Material first exceeds the
A specification at 1007.5 s; the warning raises at 1055 s on AI511's 15.096
mass % sample. A parallel run with the new alarm maps disabled has identical
material, process, valve, accounting and random-generator state. The route
remains at product throughout; the test does not assert that doing so is the
right operator choice.

An isolated headless-browser layout check, separate from the user's paused
tab, exercised the actual rebuilt page at 800×600, 1000×700 and 1440×900. The
receiving-product panel and PIP bounds did not intersect in any case; the
narrow-window screenshots were also visually inspected. These are checked
viewport sizes, not a claim about every possible window geometry.

Candidate model ID:
`abb52acb751d0ce14270e40f38fb27ea80d962e07a95f74b77333e028ece6f89`.
Main remains on `fa5e0e4` pending review of this separate change.
