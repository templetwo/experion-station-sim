<!-- @artifact dev -->
# CLAUDE.md

Guidance for Claude Code working in this repository.

`README.md` describes what the simulator *is* and how to run it — read it once,
don't restate it. This file is what you need to *change* it safely.

## Orientation, in order

1. `docs/dev/CODE-MAP.md` — structural map of the 3 100-line application file.
   Read it before touching the app. Its line numbers drift; use them as anchors,
   then grep.
2. `docs/dev/UPGRADE-PLAN.md` — the engineering conventions. Its **hard rules 1–5
   are binding** and did not expire with v2.
3. `docs/dev/V3-PLAN.md` — the current work (see *Current work* below).
4. `docs/RESOURCES.md` — the verified public sources every design decision cites.

## Commands

```bash
node --test tests/*.test.js     # 197 tests, ~1.5 s, no dependencies
python3 tools/build-dist.py     # rebuild dist/ after ANY change to the app or src/
tools/smoke.sh                  # headless-Chrome check of both builds
tools/strip-dev.sh              # list/produce the production-only tree (dry run by default)
```

Run all three of the first three before every commit. The glob in
`node --test tests/*.test.js` is load-bearing: a bare `tests/` path is rejected
by current node 22 builds. Verified here on node v22.23.2.

`tools/smoke.sh` needs Google Chrome at `/Applications/Google Chrome.app`. It
loads the folder build normally and the dist build with DNS blocked, and greps
console output for real errors against a noise filter.

## The five hard rules that will bite you

From `docs/dev/UPGRADE-PLAN.md`, compressed. Read the original for the full text.

1. **No Honeywell material.** No vendor text, tables, screenshots, artwork, icons
   or file names, and never a link to a mirrored manual. Parameter and display
   *names* are conventions and are fine; prose must be ours. Cite public sources
   in code comments by short name and RESOURCES section:
   `// ISA-18.2 state model per alerta isa_18_2.py (RESOURCES 2.5)`.
2. **Never edit `support.js`. Never hand-edit `dist/`.** `support.js` is the
   generated dc runtime carrying exactly one local patch (the SVG `tspan` fix,
   CHANGELOG 1.1.1). `dist/` is regenerated with `tools/build-dist.py`.
3. **No bundler, no ES modules, no npm dependencies, no network calls.** The app
   is one `.dc.html` page plus plain scripts and must work from `file://` and
   inside the standalone.
4. **Keep every existing feature working**, including the five trip thresholds
   (98 % tank, 185 °C R-201, 950 kPa PSV, 110 °C R-202, 480 °C R-310), unless a
   cited source justifies a change.
5. **Test + build + smoke before every commit.**

v3 adds two more (`docs/dev/V3-PLAN.md` §1): **no employer or real-site material,
ever** — nothing from any real facility, demo databases included — and **the
deterministic core never waits on a network or a model**.

## Architecture you can't see from one file read

**Two shipping artifacts, always kept in step.** The folder build (`Experion
Station Simulator.dc.html` + `support.js` + `src/`) and the single-file offline
build (`dist/experion-station-sim-standalone.html`). A change to either the app
or `src/` is not finished until `build-dist.py` has run.

**`src/*.js` are UMD plain scripts**, not modules: `module.exports` under node,
`root.ESS.<Name>` in the browser. Pure logic — no DOM, no timers, no globals.
They are loaded in the app `<head>` **before** `support.js`, and
`tools/build-dist.py` inlines any `<script src="./...">` it finds, so a new
module needs no build change — just add the tag in the right place.

**The app is one `class Component extends DCLogic`** inside a
`<script type="text/x-dc" data-dc-script>` block, with the HTML template above it
in `<x-dc>`. The single most important consequence:

> React state (`this.state`) re-renders. Instance fields (`this.L`, `this.P`,
> `this.V`, `this.alarms`, `this.events`) **do not** — mutating them changes
> nothing on screen. The UI is pumped at 2 Hz by `tick()` calling
> `setState({tk,blink})`.

`renderVals()` returns the flat object the template renders against, and event
handlers are closures created fresh inside it and referenced by name in the
template (`onClick="{{ p.click }}"`). A throwing `renderVals()` shows a red
overlay, not a console error.

**Template syntax is not JSX and not a JS expression language.** `{{ expr }}` is
a *property path* resolved against the render object — no expressions, no method
calls. Directives are `sc-if`, `sc-else`, `sc-for list="{{ }}" as="x"`. `class`
becomes `className`; `on*` become React handlers. Compute in `renderVals()`, not
in the template.

**The tag database is `this.L`**, built in `initSim()` — 24 points keyed by tag,
each carrying its control module (`cm:`), engineering range, alarm map (`alm:`)
and mode state. `this.V` holds 10 valves with a fail-safe direction. Process
state and dynamics come from `ESS.Models`.

**Randomness is seeded and must stay that way.** `this.rand =
ESS.Models.createRand(this.seed)` (mulberry32, with `getState`/`setState`) is the
only randomness source; snapshots carry `seed` and `randState` so a run, a
snapshot and a replay reproduce. `src/models.js` and the app both contain
`Math.random()` *fallbacks* for when `ctx.rand` is absent — never rely on them,
and never add a new one.

## Testing conventions

Two tiers, both on the node 22 built-in runner, no assertion library beyond
`node:assert/strict`:

```js
const Engine = require('../src/alarm-engine.js');    // module-level: pure module
const { load } = require('../tools/logic-harness');  // app-level: the Component
const { Component } = load(); const c = new Component({}); c.initSim();
for (let i = 0; i < 3600; i++) c.step(0.5);          // drive time explicitly
```

`tools/logic-harness.js` evaluates `src/*.js` in document order and then the
`Component` class under node, so app-level tests see `ESS.*` exactly as the
browser does and can call `initSim()`, `step(dt)`, `injectFault()`, `ackAlarm()`
and `renderVals()`.

**Never rely on timers or the DOM in a test.** Advance simulated time by calling
`step(dt)` in a loop. Assert exact values, not ranges, wherever the model is
deterministic.

## Traps

- **`dist/` is a seed artifact, not a from-scratch build.** `build-dist.py`
  *reads the existing dist* to recover the bundler manifest, template and the
  React UMD blobs. Deleting `dist/` makes the build unrecoverable from this repo
  alone. Regenerate it; never clean it.
- **Line numbers in `CODE-MAP.md` drift.** Grep for the symbol.
- **The app file has spaces in its name** (`Experion Station Simulator.dc.html`).
  Quote it, and don't split shell output on whitespace.
- **Integration is sequential, not parallel.** One 3 100-line page does not merge.
  Two agents editing it concurrently will lose work.
- **`{{ }}` inside an SVG `<text>`** renders through a runtime `tspan` patch
  (CHANGELOG 1.1.1). If value boxes in a graphic go blank, that patch is why.

## Artifact classes

Every file declares `@artifact production` or `@artifact dev` in its first three
lines, so a release tree can be stripped mechanically. **Any file you add must
carry a marker** or `tests/artifact-classes.test.js` fails.

- New `src/*.js` → `production`. New tests, tools, `docs/dev/*` → `dev`.
- `CHANGELOG.md` is `production` and canonical — never stripped.
- `docs/RESOURCES.md` is `production`, because `src/` comments cite it by section.
- Four files carry no marker (`support.js`, `dist/`, `LICENSE`, `.thumbnail`) and
  are classified in `tests/artifact-classes.test.js` and `tools/strip-dev.sh`
  only — keep those two lists in step.

Full reasoning: `docs/dev/ARTIFACT-CLASSES.md`.

## Current work: v3

`docs/dev/V3-PLAN.md` is the contract — Anthony's spec plus an architect's
addendum recording what was verified against the code. v3 makes the simulator an
*architecture-aware* trainer: a conceptual `FIELD → IO → CONTROL → NETWORK →
SERVICE → HMI → INFORMATION` topology, a composable fault engine whose truth is
instructor-only, twelve evidence-scored A-series drills, and deterministic replay.

Stages run **S0 → SA → S1 … S5, sequentially**, each ending green on tests,
build and smoke. Read §G of the addendum before starting: S0 freezes v2 behaviour
in golden digests, and nothing else may begin until it has.

Execution model Anthony set: **Sonnet agents run build/test/verify loops, Fable
advises, Opus architects.** The v2 lesson is not negotiable — the verifier caught
a real bug at *every* integration step. Never skip the verify pass.

## Commits

Conventional subject (`feat(scope):`, `fix(scope):`, `release:`), a body that
explains *why* and names the tests that cover it, and the repo's two trailers:

```
Co-Authored-By: Claude <model name> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<id>
```

Use your own model name in the trailer — the history reads `Claude Fable 5`
because that seat built v2. Don't inherit another seat's identity.

Commit only when asked. `dist/` is tracked, so a rebuild belongs in the same
commit as the change that caused it.
