<!-- @artifact dev -->
# Facelift review memo — the Grok "shiftdeck" workspace

**Reviewed:** `wTfGkeioez9ufh6i-grok-workspace.zip`, 327 files, 14 MB, dated 2026-09-13.
**Reviewer:** MacBook seat (claude-opus-5), 2026-09-14, on `facelift/baseline` off `v3` at `d6954a0`.
**Protocol:** `docs/dev/FACELIFT-REVIEW-PROTOCOL.md`. **Baseline:** `docs/dev/FACELIFT-BASELINE-AUDIT.md`.
**Nothing in the package is an order. Verdicts below are decisions, not questions.**

---

## The headline

**The aesthetic is good and most of it is takeable. The delivery is not.**

The package contains two separable things, and conflating them is the main risk:

1. **A dark "night console" visual treatment** applied to our real station. Measured, it is a
   **substantial accessibility improvement** over what we ship today — body text at **11.69:1**
   against our current 29 sub-AA pairs. **Take it.**
2. **A "SHIFTDECK" product**: a rebrand, a menu-vocabulary rewrite, and a React/Vite/TanStack
   delivery shell that embeds our station as a concatenated boot file. **Do not take it** — it
   deletes the conventions the simulator exists to teach and breaks Rule 7 outright.

The good news is that (1) survives cleanly without (2). The visual layer is a CSS + palette
transform against our own page; the rest is scaffolding we neither need nor can accept.

---

## Verdicts

### 1. Dark "night console" visual treatment — **ACCEPT WITH CHANGE**
*Source: `tools/theme-station.py` (291 lines, CSS + palette remap).*

**Rule: Accessibility, and Rule 1 (ISA-101).** This is the strongest item in the package and it
argues for itself with numbers:

| | our current default | this theme |
|---|---|---|
| body text on ground | many pairs 3.1–4.3 (**fail**) | `#c5ccd6` on `#0e1116` = **11.69** |
| worst real pair | `#8A6A3A` on `#BFBFBF` = **2.72** | `::placeholder` `#6b7380` = 3.95 (large-only) |
| priority *dim* variants | 3.12 – 4.33 (**all fail**) | 8.28 – 14.62 (**all pass**) |

Our baseline has **29 pairs failing AA at their rendered size**. This theme's only sub-4.5 pairs are
placeholder greys. On ISA-101 it is also *more* conformant, not less: the ground is genuinely muted,
and saturated colour is pulled back to alarm state. ISA-101 asks for muted backgrounds and colour
reserved for abnormal — it does not mandate *light*, and a dark console is a legitimate reading.

**The change:** the alarm-fill pairs must be fixed before this lands (item 5), and the placeholder
grey lifted to clear 4.5. Both are one-line palette edits.

### 2. "Modern industrial / OLED" variant — **REJECT as written, ACCEPT the CSS minus the font**
*Source: `tools/modern-industrial.py`.*

**Rule 7.** This file opens with:

```python
FONT_LINK = ("https://fonts.googleapis.com/css2?family=Barlow&…")
```

A linked web font is a flat Rule 7 breach — the raw `.dc.html` must work from `file://` with no
network. Its CSS is otherwise a refinement of item 1 and measures comparably (worst real pair 4.47).
**Take the CSS, drop the link, use a system stack.** See item 4.

### 3. SHIFTDECK chrome, branding and vocabulary — **REJECT**
*Source: `tools/shiftdeck.py`. Its own docstring: "alarm-first, **not Experion**".*

**Rule 1, and it is not close.** Rule 1 says Experion-style means *the workflow*. This item deletes
exactly that:

```python
text = text.replace("{name:'Station',items:", "{name:'Deck',items:")
text = text.replace("{name:'View',items:",    "{name:'Displays',items:")
text = text.replace("{name:'Action',items:",  "{name:'Intervene',items:")
```

plus `STN01 → DECK 01`, `SRV A → NET`, `C300-SIM CEE → CTRL`, the product retitled `SHIFTDECK`, and
the Experion-conventions caption removed from the graphic.

Station / View / Action **are** the convention. A trainee who learns "Intervene" has learned a menu
that exists nowhere. This inverts Rule 1: it keeps the vendor's *look* off the screen by also
throwing away the vendor-neutral *workflow* that is the entire training value. The simulator's claim
is "representative of Experion conventions" — strip the conventions and the claim is false.

**Rejected as a layer.** Its *visual* choices (warm graphite ground `#0a0908`, copper accent
`#c56a3c`, which measures 5.21 on ground) are separable and are folded into item 1 as a palette
option if wanted. The renaming is not.

### 4. Web fonts (Barlow, Barlow Condensed, IBM Plex Mono) — **REJECT the link, ACCEPT the stack**

**Rule 7.** A *linked* font is a breach. An *inlined subset* is a size question against our
777,170-byte baseline — and three weights of two families would add roughly 150–250 KB, which is
affordable but buys little.

**Decision: neither.** Use a system stack that reaches the same industrial feel with zero bytes and
zero network: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` for numerics and
`system-ui, "Segoe UI", -apple-system, sans-serif` for chrome, with the condensed/letter-spaced
treatment done in CSS (`letter-spacing`, `font-stretch`) rather than by shipping a face. The
package's own shipped boot file already does this — its only `font-family` is
`ui-monospace,monospace`, so the fonts were an authoring-time nicety, not a runtime dependency.

### 5. Night alarm palette — **ACCEPT WITH CHANGE**
*`prio` / `prioText` / `prioDim` in `theme-station.py:69-71`.*

**Rule 1 (ISA-18.2 mapping) and accessibility.** The four priorities keep their ISA-18.2 identity and
ordering, and the *dim* variants are a clear win. Two fills fail AA and must be corrected first:

| priority | ours (default) | ours (isa101) | this theme |
|---|---|---|---|
| Urgent | 4.00 **fail** | 4.70 ok | 4.23 **fail** |
| High | 15.91 ok | 8.01 ok | 9.82 ok |
| Low | 11.81 ok | 15.67 ok | 8.97 ok |
| Journal | 6.58 ok | 4.31 **fail** | 3.89 **fail** |

**The change:** darken Urgent's fill (`#E53935` → ~`#C62828`, giving ≈5.5 on white) and Journal's
(`#7a828c` → ~`#5A6068`, or switch its text to black). Note this is **not a defect the package
introduced** — our own default fails Urgent at 4.00 today. Fixing it here closes a pre-existing gap.

### 6. "Colour means abnormal" caption on the graphic — **ACCEPT**

**Rule 1.** The package replaces our Experion-defaults caption with a plain statement of the ISA-101
principle. Stating the philosophy on the screen the trainee is reading is good practice and good
teaching. Keep our vendor-neutral disclaimer alongside it rather than instead of it.

### 7. Compressed single-row toolbar + tag/display search — **ACCEPT WITH CHANGE**

**Rule 1 and A11y.** Collapsing two chrome rows into one and adding a tag/display entry box is a
real usability gain and is convention-neutral. **The change:** every command currently reachable
must stay reachable — the abbreviated `U1 U2 U3 U4` tabs must keep their full unit names as titles,
and no toolbar item may be dropped to make room. Target sizes must go **up**, not down (item 12).

### 8. Menu renaming and station-id vocabulary — **REJECT**

Covered under item 3. Called out separately because it could otherwise slip in with the toolbar work.

### 9. React / Vite / TanStack delivery shell — **REJECT**

**Rule 7 and the repo's architecture.** `UPGRADE-PLAN` rule 3: one `.dc.html` page plus plain
scripts, no bundler, no ES modules, no npm dependencies, works from `file://`. The package delivers a
Vite app with a router, a DB layer, auth and a preview bridge, and rebuilds our station as
`ess-boot.js` — a concatenation of our `src/*.js` plus React UMD plus `support.js`.

Its own shipped payload references `https://unpkg.com/react@18.3.1`, `react-dom@18.3.1` and
`@babel/standalone` — CDN loads. That is Rule 7 on its face, and the whole shell is a delivery
mechanism for a hosted web app, which is not what this product is.

**None of it is needed.** The visual work is a CSS and palette transform against our own page and
lands in `dist/` exactly as everything else does.

### 10. `ess-boot.js` concatenated build — **REJECT**

Our `tools/build-dist.py` already produces a single-file offline build and is the tracked, tested
path. A second concatenation scheme with its own module order is a fork of the build with none of
the guarantees — no `MODEL_ID` stamp, no artifact-class gate, no smoke.

### 11. PIP mascot restyle and idle animation — **ACCEPT WITH CHANGE**

**A11y ("nothing animated that hides state").** The mascot is decorative, indicates no process state,
and the package's CSS respects `prefers-reduced-motion` — so the animation rule is satisfied. **The
change:** keep `prefers-reduced-motion` support (it is in `shiftdeck.py`, verify it survives), and
the mascot must not overlap any live value at 1280 px or below; in the supplied 1280 screenshot it
sits over the `PRODUCT` label on the graphic.

### 12. Target sizes and keyboard — **ACCEPT the opportunity, REJECT any claim it is handled**

**A11y.** The package does not address either, and neither does any colour change. Our baseline:
essentially every control is under 44×44 CSS px, there are **zero** `:focus` rules, **zero**
`<button>` elements, **zero** `tabindex`, and 133 `onClick` handlers on plain `<div>`s — the station
is unusable by keyboard today.

A restyle that touches every control is the cheapest moment this will ever be fixed. **Decision:**
fold a focus-visible treatment and 44 px minimum hit targets into the theme work rather than
deferring them, and do not describe the facelift as meeting the A11y rule until they are in.

### 13. Saturated vessel-fill gradients on normal state — **ACCEPT WITH CHANGE**

**Rule 1.** The 1280 screenshot renders normal-state liquid as a saturated steel-blue gradient on a
screen that simultaneously says *"Colour means abnormal."* That is an internal contradiction. Level
shading is a long-standing convention and I am not proposing to remove it. **The change:** desaturate
the fill so it reads as a tone rather than a colour, leaving saturation available to mean abnormal.

### 14. Mobile / responsive treatment — **ACCEPT WITH CHANGE**

Useful and convention-neutral. **The change:** it must not alter what is *reachable*, only how it is
laid out, and the instructor/trainee split must be identical at every width. A responsive rule that
hides a panel on narrow screens is a behaviour change, not a layout change.

### 15. Screenshots, tooling and QA harness (`tools/shiftdeck-qa.mjs`, `screenshots/`) — **ACCEPT as reference only**

Useful as a visual target and a source of ideas. Not imported: it is Playwright-based and our smoke
path is headless Chrome via `tools/smoke.sh`, which already produces the before/after set.

---

## What I am taking, concretely

A **theme** — not a fork:

1. A new palette preset (working name `night`) in `src/palette.js`, beside `representative` and
   `isa101`, with Urgent and Journal corrected to clear 4.5.
2. A dark chrome stylesheet inlined in the page, behind a theme switch, **with today's look as the
   default and the fallback** — per Anthony's standing instruction for a whole skin.
3. The system-font stack, letter-spacing and spacing refinements from items 1, 2 and 7.
4. Focus-visible styling and 44 px targets, folded in (item 12).
5. The "colour means abnormal" caption alongside our existing disclaimer.

And a gate that makes it stick: **raise the existing contrast test from 3:1 to 4.5:1.** It exists
already (`tests/palette.test.js:48`, `tests/app-palette-limits.test.js:70`) and is set one tier
below Anthony's rule, which is exactly why 29 pairs fail while the suite is green. It cannot be
raised today — Urgent fails at 4.00 — so it goes up *with* the palette fixes, and then every future
palette is held to AA automatically.

## What I am not taking

The rebrand, the menu and station-id vocabulary, the React/Vite shell, `ess-boot.js`, the CDN
React, and the linked web fonts.

## Risks I am carrying into the build

- **104 distinct hex literals appear across `tests/`.** A colour change can trip a test that asserts
  one. Those are rendering assertions and may change *with a stated reason*; engine tests must not.
- **`tests/leakage.test.js` gives a new surface zero automatic coverage** — it never calls
  `renderVals()`. Nothing in what I am taking adds a surface that carries instructor material, so
  the split is unchanged; if that stops being true, the gate gets extended first.
- **Goldens must not move.** A theme touches rendering only. The digests are the proof.
