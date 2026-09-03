<!-- @artifact production -->
# Experion-Style Operator Station Training Simulator

A browser-based, single-page training simulator that reproduces the conventions of a Honeywell Experion PKS Console/Flex Station: HMIWeb-style gray graphics, four alarm priorities (Journal/Low/High/Urgent) with an ISA-18.2 alarm lifecycle, PID faceplates (MAN/AUTO/CAS, PROGRAM mode attribute, PV tracking), Point Detail tabs with Experion parameter names (K, T1/T2 in minutes, SPHILM/OPHILM, SHEDHOLD, ALMDB/ALMDELAY), alarm shelving with reasons, dynamic suppression, out-of-service, an event journal with management-of-change audit, trends, station security levels with electronic signatures, scored training drills, an instructor station with snapshots and replay, a rule-based Ops Assistant, and a conceptual architecture-training layer: an ARCH view teaching the FIELD → IO → CONTROL → NETWORK → SERVICE → HMI → INFORMATION path behind every point, in Learn, Trace, Diagnose and Debrief modes, across the console and flex station profiles.

**Independent training aid, not a Honeywell product.** Contains no Honeywell software, artwork, or manual text. Colors, columns, and key legends are representative defaults; real sites configure these. Experion® is a trademark of Honeywell International Inc. Alarm help, the philosophy page and every rationalisation field describe this simulator only.

## Live process units
| Unit | Model | Training focus |
|---|---|---|
| U1 | Tank, exothermic CSTR (Henson/Seborg form, cascade), heat exchanger, flash drum, feed pump | Continuous ops, cascade, runaway, floods |
| U2 | Semi-batch polymerization (Lucia/Engell form), SCM-driven sequence, agitator, adiabatic-temperature interlock | Batch phases, monomer accumulation hazard, state-based alarm limits |
| U3 | Two-pass fired heater (Badgwell form) with tube-skin temperatures and excess O2, fixed-bed reactor with quench | Nonlinear exotherm, trip avoidance |

## Run it
- **Station + AI coach (one launch):** double-click `Launch Station.command`, or `python3 tools/coach/launch.py`. One browser window: the console, PIP the hover coach, and a live token stream in Ops Assistant. The default local model is the lightweight `granite4:1b`; set `COACH_MODEL` to use another installed Ollama model. For a cloud model instead, `pip install anthropic`, sign in once with `ant auth login` (or export `ANTHROPIC_API_KEY`) on an org that has API credits, and launch with `COACH_PROVIDER=anthropic` (`COACH_CLOUD_MODEL` defaults to `claude-opus-5`, `COACH_CLOUD_EFFORT` to `medium`), or enter the key at the station instead: Help → *PIP cloud credential…* (command `CLOUDKEY`, SUPV or above) hands it to the local sidecar for the session only; the page still only talks to the local sidecar, and the raw `.html` stays offline. Leave the Terminal open. The raw `.html` file cannot talk to a model (browsers block that); this launch is the together path.
- **From this folder, no AI:** open `Launcher.dc.html` (or the simulator file directly) in a modern browser. Needs `support.js` and the `src/` folder beside the app; React is fetched from a CDN on first load.
- **Offline / single file, no AI:** `dist/experion-station-sim-standalone.html`, fully self-contained, no network needed.

## Quick reference
- Command zone: a tag (`FIC102`), `ALM`, `EVT`, `MSG`, `TRN`, `SYS`, `KPI`, `MOC`, `INSTR`, `PHILOSOPHY`, `PROCESS`, `COVERAGE`, `RECORD`, `ALMHELP`, `ASSIST`, `ARCH`, `DRILL`, `HELP`, `U1`/`U2`/`U3`, `SIL`, `ACK`
- Keys: F1 silence, F2 acknowledge, F3 alarm summary, F4 detail of selected
- Security passwords (training defaults): `oper`, `supv`, `engr`, `mngr`; instructor station: `instr` (or the MNGR level). The logon dialog also takes an operator name that is stamped on every journal entry.
- Architecture view: command `ARCH` (also `SIGNAL PATH`), the View menu, or the SIGNAL PATH action on faceplates, Point Detail, the Alarm Summary and trend pens — opens the FIELD → IO → CONTROL → NETWORK → SERVICE → HMI → INFORMATION view pre-scoped to that tag; Learn (layers, terminology, blast radius), Trace (follow a point or command), Diagnose (hidden fault, evidence commands), Debrief (synchronized timeline); console/flex station profile switch; a persistent banner marks it a conceptual training display, not a diagnostic one
- Drills: menu bar, Drills, Start Drill (scored debrief, 80 % pass mark, independent of any vendor certification); Training record and Coverage dialogs from the same menu. Eight D-series process drills and twelve architecture drills (A1–A12). A-series START loads the drill's initial condition and opens ARCH in Diagnose; evidence scoring and a safety gate; Learn is hidden while an A-drill is running. RANDOM DRILL stays D-series.
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
Semantic versioning; see `CHANGELOG.md`. Current: **v3.0.0** (unreleased on the `v3` branch; `main` remains 2.0.0).

## Files
- `Experion Station Simulator.dc.html`: the application (template + station logic)
- `src/`: plain-script modules loaded by the page before `support.js`, in load order: `model-id.js` (generated build stamp, `ESS.MODEL_ID` — do not hand-edit), `alarm-engine.js`, `pid.js`, `kpi.js`, `palette.js`, `models.js`, `alarm-help.js`, `philosophy.js`, `instructor.js`, `training.js`, `dispatch.js` (command/event journal boundary), `topology.js` (derived architecture graph), `fault-engine.js`, `signal-path.js`, `drill-arch.js` (architecture drills A1–A12), `architecture-view-model.js`, `debrief.js`
- `Launcher.dc.html`: app launcher / start screen
- `support.js`: page runtime (required next to the app files)
- `dist/`: self-contained offline build
- `tools/`, `tests/`, `docs/`: build script, smoke test, node harness, test suites, documentation
