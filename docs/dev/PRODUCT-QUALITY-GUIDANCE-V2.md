<!-- @artifact dev -->
# Product-quality guidance supplement, version 2

2026-09-30. Baseline: merged main
`3c29b29c664f09d07f49debb62684d87b0de3157` (PR #6), containing warning
implementation `6c4de08b8cc55a10acc436a96de0c3e1a39d6378`, model
`abb52acb751d0ce14270e40f38fb27ea80d962e07a95f74b77333e028ece6f89`.

## Correction and scope

The user's independent review found two actionable-advice failures: the coach
directed an operator to an instructor-only routing control, and suggested using
the receiving-tank reading to judge recovery even while its inlet was diverted.
The user reported a tank reading near 17.9% A persisting as that tank drained,
then increasing after incoming flow resumed despite prior heater recovery.
Those timings and readings remain user-reported observations, not a new
reproduction receipt. The current source confirms the underlying limitations.

This supplement takes the wording-first option under the existing authorization
to correct the simulator. Routing remains instructor-only. No operator routing
switch or new analyzer is added. It is a correction to guidance and layout, not
a new release criterion for product or a claim to resolve inlet observability.
PR #6 was already merged when this follow-up began; its historical validation
record is preserved in [warning policy v1](PRODUCT-QUALITY-WARNING-V1.md).

## Actionable guidance

Live Diagnosis and Alarm Help ask the trainee to request instructor consideration
of **TO OFF-SPEC**. The quality card no longer offers a GO action into the locked
panel. Existing trainee links still open Point Detail and process trends.
There is no permission change and no automatic diversion.

AI511 and AI512 describe delayed receiving-tank samples. During full diversion,
that tank's proportional outlet removes material without improving its retained
composition. Analyzer lag may still settle, so the wording does not promise a
perfectly frozen reading. Neither draining nor diversion cleans the tank, and
its reading cannot establish recovery of the incoming separator draw.

The trainee can review heater, bed and separator indications and allow
contaminated separator inventory to flush. Normal temperature or elapsed time
alone does not establish acceptable incoming composition. No fixed flushing
time or return-to-product threshold is invented. This board has no incoming A
analyzer. Returning to product requires instructor review of the available
evidence; the coach does not claim that this review creates a missing assay.

AI509 is the existing delayed draw-water **volume-percent proxy**, with a 0.30%
minimum. AI512 is receiving-tank water in **mass percent**, with its existing
0.200% warning limit. They refer to different streams, bases and timing; the
AI509 minimum cannot be compared directly with AI512's limit or used to certify
recovery. The board and water-warning guidance make that limitation visible.
The values, alarm settings and measurement calculations are unchanged.

## Source evidence and boundaries

These are explanations of existing implementation, not new physical claims:

- `src/models.js`, `stepU4Material()`: computes draw-water volume percentage
  from integrated component transfers and declared specific volumes.
- `src/models.js`, `measureU4()`: applies AI509's existing 0.30% floor and 30 s
  first-order lag.
- `src/material-model.js`: proportional component withdrawals and separate
  receiving/off-spec inventories; no dilution enters the receiving tank while
  the full inlet is diverted.
- `src/material-recipe.js` and the
  [live integration contract](G2-LIVE-INTEGRATION-CONTRACT.md): receiving-tank
  mass-fraction observations, delay and distinct historical volume proxy.
- `src/plant-core.js`, `instructorAllowed()` and `setMaterialDiversion()`: existing
  instructor authorization boundary, retained without modification.
- Alarm Help structure retains its registered basis, RESOURCES-2.10;
  alarm lifecycle and warning policy retain RESOURCES-2.5, RESOURCES-2.6 and
  RESOURCES-2.9. No new source registration is needed for this wording change.

PIP occupies a compact reserved footer on the Unit 04 graphic, with its existing
assistant action and status. The floating avatar remains on other displays.
This fixes overlap with LV-503's PRODUCT label without moving the obstruction
onto another process label.

## Prospective verification

`tests/product-quality-guidance-v2.test.js` is a new supplement for this
correction. The earlier warning suite retains its warning/evidence tests; its
old expectation of a GO link to the instructor panel is updated to the corrected
request-only behavior. The v1 result is not relabeled as covering these changes.

The full Node suite reports **1128 pass, 4 skip, 0 fail** (1132 total).
The two focused quality suites report **18/18 pass**, including seven new
guidance/render checks. An initial full-suite run caught an initialization-order
error in the PIP visibility expression; it was corrected before this passing
result. The new full-render checks cover U4, other units/displays, the protected
instructor-display fallback, and an offline dock click with model/network-call
traps and unchanged plant state.

Independent review found no blocking guidance or permission issues. Standalone
build and both folder/offline browser smoke checks pass. An isolated
headless browser checked 800×600, 1000×700, 1200×800 and 1440×900, each with the
assistant open and closed. The dock did not intersect the U4 SVG, its PRODUCT
label or the analyzer panel. It opened the assistant; changing to U3 restored
the floating avatar. Narrow layouts were also visually inspected. These checks
do not claim coverage of every viewport. No existing user browser was touched.

Candidate model ID:
`9805a552850e8928a458282b59984dcc04d80d91279c25ad03df0a4c61c8f981`.
The generated standalone is 790,378 bytes with SHA-256
`b286a3c535d04c963e6f947069ad4e8088c9c28f411bdf4aa475c19c52133339`;
the file served on local port 8769 was compared byte-for-byte with it.
The model ID changes because it hashes application/help content as well as
process code. Process, measurement and routing modules are unchanged.

Historical process receipts, archived baselines, MOA bindings, material recipes
and snapshot schemas remain unchanged.
