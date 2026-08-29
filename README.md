# Experion-Style Operator Station Training Simulator

A browser-based, single-page training simulator that reproduces the conventions of a Honeywell Experion PKS Console/Flex Station: HMIWeb-style gray graphics, four alarm priorities (Journal/Low/High/Urgent) with authentic flash/ack behavior, PID faceplates (MAN/AUTO/CAS, SP-in-AUTO / OP-in-MAN rules), Point Detail tabs with Experion parameter names (K, T1/T2 in minutes, SPHILM/OPHILM, SHEDHOLD…), alarm shelving, event journal, trends, station security levels (oper/supv/engr/mngr), scored training drills, and a rule-based Ops Assistant.

**Independent training aid — not a Honeywell product.** Contains no Honeywell software, artwork, or manual text. Colors, columns, and key legends are representative defaults; real sites configure these. Experion® is a trademark of Honeywell International Inc.

## Live process units
| Unit | Model | Training focus |
|---|---|---|
| U1 | Tank → exothermic CSTR (cascade) → HX → flash drum, feed pump | Continuous ops, cascade, runaway, floods |
| U2 | Semi-batch polymerization, SCM-driven sequence, agitator | Batch phases, monomer accumulation hazard |
| U3 | Fired preheater + fixed-bed reactor with quench | Nonlinear exotherm, trip avoidance |

## Run it
- **From this folder:** open `Launcher.dc.html` (or the simulator file directly) in a modern browser.
- **Offline / single file:** `dist/experion-station-sim-standalone.html` — fully self-contained, no network needed.

## Quick reference
- Command zone: type a tag (`FIC102`), `ALM`, `EVT`, `TRN`, `U1`/`U2`/`U3`, `ASSIST`, `DRILL`
- Keys: F1 silence · F2 acknowledge · F3 alarm summary · F4 detail of selected
- Security passwords (training defaults): `oper`, `supv`, `engr`, `mngr`
- Drills: menu bar → Drills → Start Drill (scored debrief); instructor panel via status-bar `SIM` link

## Create the private repo (from this folder)
```bash
git init && git add -A && git commit -m "v1.1.1 — three-unit operator station simulator"
gh repo create experion-station-sim --private --source=. --push
```
(or create an empty private repo on github.com, then `git remote add origin … && git push -u origin main`)

## Versioning
Semantic versioning; see `CHANGELOG.md`. Current: **v1.1.1**.

## Files
- `Experion Station Simulator.dc.html` — the full application (UI + process models + drills)
- `Launcher.dc.html` — app launcher / start screen
- `support.js` — page runtime (required next to the app files)
- `dist/` — self-contained offline build
