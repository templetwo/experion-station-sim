<!-- @artifact production -->
# Experion-Style Operator Station Training Simulator

A browser-based, single-page training simulator that reproduces the conventions of a Honeywell Experion PKS Console/Flex Station: HMIWeb-style gray graphics, four alarm priorities (Journal/Low/High/Urgent) with an ISA-18.2 alarm lifecycle, PID faceplates (MAN/AUTO/CAS, PROGRAM mode attribute, PV tracking), Point Detail tabs with Experion parameter names (K, T1/T2 in minutes, SPHILM/OPHILM, SHEDHOLD, ALMDB/ALMDELAY), alarm shelving with reasons, dynamic suppression, out-of-service, an event journal with management-of-change audit, trends, station security levels with electronic signatures, scored training drills, an instructor station with snapshots and replay, a rule-based Ops Assistant, and a conceptual architecture-training layer: an ARCH view teaching the FIELD → IO → CONTROL → NETWORK → SERVICE → HMI → INFORMATION path behind every point, in Learn and Trace modes, across the console and flex station profiles.

**Independent training aid, not a Honeywell product.** Contains no Honeywell software, artwork, or manual text. Colors, columns, and key legends are representative defaults; real sites configure these. Experion® is a trademark of Honeywell International Inc. Alarm help, the philosophy page and every rationalisation field describe this simulator only.

## Live process units
| Unit | Model | Training focus |
|---|---|---|
| U1 | Tank, exothermic CSTR (Henson/Seborg form, cascade), heat exchanger, flash drum, feed pump | Continuous ops, cascade, runaway, floods |
| U2 | Semi-batch polymerization (Lucia/Engell form), SCM-driven sequence, agitator, adiabatic-temperature interlock | Batch phases, monomer accumulation hazard, state-based alarm limits |
| U3 | Two-pass fired heater (Badgwell form) with tube-skin temperatures and excess O2, fixed-bed reactor with quench | Nonlinear exotherm, trip avoidance |

## Run it
- **From this folder:** open `Launcher.dc.html` (or the simulator file directly) in a modern browser. Needs `support.js` and the `src/` folder beside the app; React is fetched from a CDN on first load.
- **Offline / single file:** `dist/experion-station-sim-standalone.html`, fully self-contained, no network needed.

## Quick reference
- Command zone: a tag (`FIC102`), `ALM`, `EVT`, `MSG`, `TRN`, `SYS`, `KPI`, `MOC`, `INSTR`, `PHILOSOPHY`, `COVERAGE`, `RECORD`, `ALMHELP`, `ASSIST`, `ARCH`, `DRILL`, `HELP`, `U1`/`U2`/`U3`, `SIL`, `ACK`
- Keys: F1 silence, F2 acknowledge, F3 alarm summary, F4 detail of selected
- Security passwords (training defaults): `oper`, `supv`, `engr`, `mngr`; instructor station: `instr` (or the MNGR level). The logon dialog also takes an operator name that is stamped on every journal entry.
- Architecture view: command `ARCH` (also `SIGNAL PATH`), the View menu, or the SIGNAL PATH action on faceplates, Point Detail, the Alarm Summary and trend pens — opens the FIELD → IO → CONTROL → NETWORK → SERVICE → HMI → INFORMATION view pre-scoped to that tag; Learn mode (layers, terminology, blast radius) and Trace mode (follow a point or command); console/flex station profile switch; a persistent banner marks it a conceptual training display, not a diagnostic one
- Drills: menu bar, Drills, Start Drill (scored debrief, 80 % pass mark, independent of any vendor certification); Training record and Coverage dialogs from the same menu. The eight D-series drills remain playable exactly as before; twelve architecture drills (A1–A12), with their own evidence-based scorer and safety gate, are defined and tested but not yet reachable from this menu — they arrive with the Diagnose mode of a later v3 stage
- Instructor station: status-bar `SIM` link or command `INSTR`: freeze/step/speed, eight snapshot slots, initial-condition presets, backtrack, upsets with a hidden switch and magnitudes, instructor variables, action journal replay, live assessment
- Alarm Summary: location pane with counts, Trip/Live/State/Sub-priority/Count columns, MAIN/UNACK/SHELVED/SUPPRESSED/OOS views, comments, Alarm Help pane, Alarm Tracker strip, disable alarms for an asset (MNGR, signed)
- Station menu: alarm colour philosophy (representative defaults or an ISA-101 preset; SUPV), Help > Alarm and display philosophy

## Development
- Tests: `node --test tests/*.test.js` (node 22, no dependencies)
- Rebuild the offline build after any change: `python3 tools/build-dist.py` (never hand-edit `dist/`)
- Headless browser check of both builds: `tools/smoke.sh`
- `tools/logic-harness.js` evaluates the `src/` modules and the Component class under node for app-level tests
- `docs/dev/CODE-MAP.md` (structure, v2 change notes), `docs/dev/UPGRADE-PLAN.md` (rules and conventions), `docs/RESOURCES.md` (verified public references the design is based on)

## Versioning
Semantic versioning; see `CHANGELOG.md`. Current: **v2.0.0**.

## Files
- `Experion Station Simulator.dc.html`: the application (template + station logic)
- `src/`: plain-script modules loaded by the page before `support.js`, in load order: `model-id.js` (generated build stamp, `ESS.MODEL_ID` — do not hand-edit), `alarm-engine.js`, `pid.js`, `kpi.js`, `palette.js`, `models.js`, `alarm-help.js`, `philosophy.js`, `instructor.js`, `training.js`, `dispatch.js` (command/event journal boundary), `topology.js` (derived architecture graph), `fault-engine.js`, `signal-path.js`, `drill-arch.js` (architecture drills A1–A12), `architecture-view-model.js`
- `Launcher.dc.html`: app launcher / start screen
- `support.js`: page runtime (required next to the app files)
- `dist/`: self-contained offline build
- `tools/`, `tests/`, `docs/`: build script, smoke test, node harness, test suites, documentation
