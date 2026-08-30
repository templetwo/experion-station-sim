<!-- @artifact dev -->
# v2 upgrade plan and engineering conventions

Goal: implement the five changes in `docs/RESOURCES.md` section 5 (ISA-18.2 alarm engine; Alarm Summary parity; documented colour and limit philosophy; better process dynamics; instructor mode and standards-based scoring) without breaking the two shipping artefacts: the folder build (`Experion Station Simulator.dc.html` + `support.js` + `src/`) and the single-file offline build (`dist/experion-station-sim-standalone.html`).

Read `docs/dev/CODE-MAP.md` before touching the app. Read the relevant section of `docs/RESOURCES.md` before implementing a feature that cites it.

## Hard rules
1. No Honeywell text, tables, screenshots, artwork, icons or file names in the repo or the app. Names of parameters, priorities, displays and behaviours are fine (they are conventions); prose must be our own. Never link to mirrored manuals. Cite public sources in code comments by short name and RESOURCES.md section, e.g. `// ISA-18.2 state model per alerta isa_18_2.py (RESOURCES 2.5)`.
2. Do not edit `support.js` (generated runtime; the only local patch is the SVG tspan fix). Do not hand-edit `dist/`; regenerate it with `python3 tools/build-dist.py`.
3. The app stays a single `.dc.html` page plus plain-script modules. No bundler, no ES modules, no npm dependencies, no network calls. Everything must work from `file://` and inside the standalone.
4. Keep every existing feature working: three units, drills D1–D12, command zone, F-keys, faceplates, Point Detail, trends, security levels, Ops Assistant. The existing trip thresholds (98 % tank, 185 °C R-201, 950 kPa PSV, 110 °C R-202, 480 °C R-310) stay unless a cited source justifies a change.
5. Before every commit: `node --test tests/*.test.js` passes (the glob form works on every node 22 build; a bare `tests/` path is rejected by newer builds), `python3 tools/build-dist.py` runs, `tools/smoke.sh` reports ok for both builds. Commit messages end with the standard Co-Authored-By / Claude-Session trailer used in this repo's history.

## Module convention (`src/*.js`)
UMD-style plain scripts that work both as browser globals and under node:
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.ESS = root.ESS || {}).AlarmEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // ... pure logic, no DOM, no timers, no globals ...
  return { /* api */ };
});
```
Load order in the app head, BEFORE `<script src="./support.js"></script>`:
```html
<script src="./src/alarm-engine.js"></script>
```
`tools/logic-harness.js` evaluates these in document order, then the Component class, so app-level tests see `ESS.*` exactly as the browser does. `tools/build-dist.py` inlines every `./src/*.js` referenced this way into the standalone.

## Tests (`tests/*.test.js`, node 22 built-in runner)
```js
const test = require('node:test'); const assert = require('node:assert/strict');
const Engine = require('../src/alarm-engine.js');           // module-level
const { load } = require('../tools/logic-harness');          // app-level
test('baseline runs 30 sim-minutes with no alarms', () => {
  const { Component } = load(); const c = new Component({}); c.initSim();
  for (let i = 0; i < 3600; i++) c.step(0.5);
  assert.equal(c.alarms.filter(a => a.active).length, 0);
});
```
App-level tests drive the Component directly: `initSim()`, `step(dt)`, `injectFault()`, `ackAlarm()`, `renderVals()`. Never rely on timers or the DOM in tests.

## Stages
A. Pure modules, built in parallel, new files only (no app edits, no git):
   - `src/alarm-engine.js` + `tests/alarm-engine.test.js`: ISA-18.2 state machine.
   - `src/models.js` + `tests/models.test.js`: upgraded U1/U2/U3 process dynamics with the same state fields the app reads.
   - `src/pid.js`, `src/kpi.js`, `src/palette.js` + tests: PID with anti-windup, bumpless transfer, PV tracking and PROGRAM mode; ISA-18.2/EEMUA alarm KPIs and drill scoring; ISA-101 palette.
B. Integration into the app, strictly sequential, each step verified and committed:
   B1 alarm engine wired in (states, sub-priority, two events per alarm, deadband and on-delay, indication per state).
   B2 Alarm Summary parity (asset pane, columns, repeat folding, comments, Shelved view with reason and timer, DAS tab, Alarm Help, KPI panel).
   B3 colour and limit philosophy (palette, limit band, philosophy help page, loop tuning tab).
   B4 process models wired in, state-based alarm limits per SCM phase, tube-skin alarms, PV tracking and PROGRAM modes.
   B5 instructor mode (snapshot, initial conditions, backtrack, freeze, fast time, hidden upsets), standards-based scorer, drill coverage matrix, Message Summary confirm, electronic signature on critical actions, disable-alarms-for-asset (MNGR), MOC audit events.
C. Release: CHANGELOG 2.0.0, README, version strings, dist rebuild, tag, push.
