<!-- @artifact dev -->
# Facelift baseline audit — measured before the design spec arrived

**Status:** measured 2026-09-14, MacBook seat (claude-opus-5), on `facelift/baseline` off `v3` at
`d6954a0`. **No tracked file was changed to produce it.** Protocol:
`docs/dev/FACELIFT-REVIEW-PROTOCOL.md`.

The point of measuring first is that a review which says *"this drops that pair to 3.2:1, below AA"*
is worth more than one that says *"that looks like a contrast risk"* — and that the spec cannot be
blamed for problems that were already here, nor credited with fixing ones it did not.

---

## 0. The headline: the contrast gate exists, and it is set one tier below the rule

`src/palette.js` already ships `contrastRatio()`, `luminance()` and `textPairs()`, and **two tests
already enforce contrast** — `tests/palette.test.js:48` and `tests/app-palette-limits.test.js:70`.

They enforce **≥ 3:1**. That is the WCAG AA bar for **large text**. Anthony's rule is AA on every
text-on-background pair, which for normal text is **4.5:1**.

That single tier explains why 29 real pairs fail at the sizes they actually render at while the suite
is green: the gate passes them at 3:1 and they render at 9–12.5 px, where 4.5:1 is required.

**Proved, not inferred.** Raising the threshold in both tests to 4.5 and running:

```
# pass 12   # fail 2
representative: Urgent text on fill  #FFFFFF on #FF0000
```

**The first thing to fail is Urgent — the highest ISA-18.2 priority, in the default palette.**
Reverted immediately; `git status` clean.

**What this means for the review.** Contrast work is not a risk the spec introduces; it is a
pre-existing gap the spec is well placed to close, and the machinery to enforce it already exists
and is already wired into the suite. Raising that constant is a one-line change — but it fails today,
so it can only be raised *together with* the colour fixes. That is a natural, checkable acceptance
criterion for any item that touches alarm colour.

---

## 1. Contrast, measured

143 real text-on-background pairs (not the cartesian product — pairs that actually render, derived
by walking the template's DOM nesting and resolving every `{{ }}`-bound colour to its definition).
**113 pass. 1 passes as legitimately large text. 29 fail at their rendered size.**

Every ratio below was independently recomputed by a second agent from the WCAG formula, not taken
from `palette.js`'s own helper. They matched to three decimals.

| Pair | Ratio | Size | Verdict |
|---|---|---|---|
| `#8A6A3A` on `#BFBFBF` — SVG pipe captions *HTM*, *FUEL GAS* | **2.72** | 10 px bold | fails even the 3.0 large-text floor — the worst pair in the app |
| `#FFFFFF` on `#FF0000` — **Urgent** alarm text, `representative` | **4.00** | 9–12.5 px bold | fails AA normal |
| `#FFFFFF` on `#916AAD` — **Journal**, `isa101` preset | **4.31** | 9–12.5 px bold | fails AA normal |
| `#FFFFFF` on `#00A000` — KPI verdict banner | **3.48** | 12 px bold | fails AA normal |
| `#7A6400` on `#CFCFCB` — KPI tile numeral | 3.68 | 20 px bold | **passes** — genuinely large text |
| `prioDim` × every priority, both presets (10 pairs) | 3.12 – 4.33 | 9–12.5 px | fail AA normal — the largest single cluster |

Two things worth carrying into the review:

- **The same green passes at one size and fails at another.** `#00A000` is fine on a 20 px numeral
  and fails on a 12 px banner. Contrast must be judged **per rendered instance**, never per colour.
- **The `isa101` preset is not AA-clean either.** The repo already ships an ISA-101-aligned palette,
  selectable today. A spec that simply proposes "switch to the ISA-101 preset" does **not** resolve
  contrast on its own, and the review should not accept it as if it did.

## 2. Keyboard: not a defect, an absence

- `:focus` / `focus-visible` rules in the app and `support.js`: **zero**.
- `<button>` elements: **zero**. `tabindex` attributes: **zero**.
- `onClick` handlers: **133**, all on plain `<div>`s, which cannot take keyboard focus.
- `<input>` elements: 20, **every one** setting `outline:none` with no replacement.

**The station is currently unusable by keyboard.** This is not something a facelift can break,
and — importantly — it is not something a colour-only facelift can *fix* either. Anthony's rule
("keyboard focus visible") cannot be satisfied by restyling. If the spec proposes focus styling, it
must come with focusability; if it does not mention keyboard at all, the memo should say that the
rule remains unmet either way and is a separate piece of work.

## 3. Target size

Essentially every discrete control measures under 44×44 CSS px in at least one dimension, most on
height: toolbar buttons, menu triggers, faceplate SILENCE / ACK / DETAIL, mode buttons, raise/lower
arrows, graphic point boxes. Pre-existing, and the one place the A11y rule is clearly unmet today by
a wide margin.

## 4. Tick and animation

- **`renderVals()` ≈ 0.72 ms** against a 500 ms budget (view-model cost). Enormous headroom; a
  facelift would have to be extravagant to threaten the tick. Measured on an M3 Pro.
- **The alarm blink is already compliant.** Text and priority letters never disappear, the background
  never fully hides, minimum opacity 0.25–0.4 on trip glows. It is the reference case for
  "nothing animated that hides state" — a new animation should be judged against it.
- **A second animation system exists**: the PIP coach mascot (`@keyframes` bob / blink / needle /
  caret). Purely decorative, respects `prefers-reduced-motion`, indicates no process state.

## 5. Hidden truth, and the coverage gap that matters

The instructor/trainee split is enforced by `instructorAllowed()`, `this.instr.hidden`, the
`can()` security ladder, the debrief's `DEBRIEF_REVEALED` / `TRAINEE_SAFE` projections,
`CHART_VISIBILITY` + `ceAllowed()`, and the `healthProjection` / `truthProjection` divide.

**`tests/leakage.test.js` would give a new rendering surface ZERO automatic coverage.** Verified
independently: it never calls `renderVals()`, never serialises a template or view-model, and runs its
detector only against `FaultEngine` projections on a bare `Topology.build()` graph. It does load a
`Component` — but to seed the topology, not to render.

So: **if the spec proposes any new panel, chip, tooltip or label that could carry instructor
material, the existing leakage gate will not catch it.** Such an item is ACCEPT WITH CHANGE at best,
conditional on extending the gate to cover it. This is the most important single fact in this audit
for judging a new-surface proposal.

## 6. What the facelift must not move

- **Goldens**: 31/31, byte-identical. Proof is the digest, not the pass count.
- **Engine/behaviour tests** must not move at all.
- **Rendering/DOM tests** may change *only* where the change is presentational, and the memo says
  which and why.
- **104 distinct hex literals** appear across `tests/` — any colour change risks tripping a test
  that asserts one. (An auditor reported 757 occurrences; the critic found that figure wrong by more
  than 2×. The distinct-value count of 104 is correct and is the one to work from.)
- `tests/process-text.test.js` and the alarm-help coverage gate pin **user-visible prose** against
  the live configuration. A relabelling item is a behaviour change wearing a facelift's clothes.

## 7. Rule 7

| | Baseline |
|---|---|
| Single-file build | **777,170 bytes (0.74 MB)** |
| External runtime references | **zero** (the only `http://` is the SVG namespace identifier — a name, not a fetch) |
| `@import` / `@font-face` / CDN | **zero** in both builds |

A **linked** web font is a Rule 7 breach. An **inlined subset** is a size question against the number
above. Those are different items and the memo will treat them differently.

## 8. Gap in this baseline, stated rather than hidden

The systematic **ISA-101 redundant-coding sweep was not completed.** One of the five audit agents
returned a stub (its summary was the literal string `"test"`); the completeness critic caught it and
said so. What I verified directly instead:

- Both palettes map all four ISA-18.2 priorities and ship `prio` / `prioText` / `prioDim` triples.
- Priority is redundantly coded on the surfaces I inspected: the counters carry letters (`U`/`H`/`L`),
  faceplates show mode as text (`A` / `C`), motors show `RUN`, valves show numeric position.
- Decorative colour **does** appear on normal states — the blue vessel liquid fills (`#41608A`,
  `#4a6a8a`, `#93A8B8`). ISA-101 wants colour reserved for abnormal; level shading is a long-standing
  convention, so this is a judgement call for Anthony, not a clear breach.

**Not yet established:** an exhaustive per-surface list of where colour is the *only* signal. That is
the sharpest test under Rule 1 and it is the one thing this baseline still owes. It will be completed
before the review memo is written, or the memo will state which items it could not judge on that
axis. Recorded here so nobody mistakes silence for a clean bill.
