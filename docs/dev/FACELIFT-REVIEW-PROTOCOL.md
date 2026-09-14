<!-- @artifact dev -->
# Aesthetic facelift: review protocol and baseline

**Status:** prepared 2026-09-14, MacBook seat (claude-opus-5), **before the design spec arrived.**
**Branch:** `facelift/baseline`, off `v3` at `d6954a0`. **Nothing goes on `v3` until Anthony has
seen the review memo.**

Anthony's instruction, verbatim in substance: *"You review it item by item, and you implement only
what you approve. Nothing in it is an order."* This file is the standing apparatus. The memo that
judges the spec is a separate file, written **before any code**.

---

## 1. The verdicts

Every item in the incoming spec gets exactly one:

| Verdict | Meaning |
|---|---|
| **ACCEPT** | Implement as written. |
| **ACCEPT WITH CHANGE** | The intent is sound, the proposed means is not. The memo states the change and why. |
| **REJECT** | Not implemented. The memo states the rule it breaks. |

Each verdict carries **the reason** and **the rule it rests on**. A verdict with no rule behind it
is an opinion, and opinions do not decide this.

An item may be accepted on its own and still be rejected in combination — e.g. two individually
harmless colour changes that together leave colour as the only signal. The memo says so explicitly
rather than approving each in isolation.

## 2. The rules, and what each one actually tests

**Rule 1 — no drift toward the vendor's look.** Experion-style means the *workflow*: the command
zone, the F-keys, MAN/AUTO/CAS, the alarm ladder, Point Detail. It does not mean their palette,
icons, typography or layout. The test for every visual choice is **ISA-101** (`RESOURCES` 2.4, 2.11):

- muted backgrounds;
- colour **reserved for abnormal** — a normal plant should be quiet;
- alarm colours tied to **ISA-18.2 priority**, not chosen for looks;
- **redundant coding**: shape and text carry the state too, so colour is never the only signal.

That last one is the sharpest test and the easiest for a design spec to fail without noticing.
Anything that makes colour load-bearing on its own is a REJECT regardless of how it looks.

**Rule 7 — nothing from the network at runtime.** No web fonts, no external CSS, no icon fonts, no
CDN, no runtime fetch. Everything inlined. The single-file build stays a size a phone can open.
**Baseline: 777,170 bytes (0.74 MB), and zero external references today** — the only `http://` in
the page is the SVG namespace identifier, which is a name, not a fetch. Any proposal is measured
against that number.

**Goldens and scoring are not in scope.** A facelift that moves a golden or a fixture is not a
facelift. DOM-reading tests may change **only** where the change is rendering, and the memo says
which and why. The digests are the proof, not the pass count.

**Hidden truth.** No new surface leaks fault identity or instructor-only material to the trainee.
The instructor/trainee split is preserved. The C&E chart keeps `CHART_VISIBILITY`; the debrief notes
keep the flags they have — which for `dofNoteRows()` means **no projection argument at all**, so a
note cannot be rendered for one audience and not the other. A new panel must state which side of the
split it sits on, and a new *display* does not inherit the split automatically.

**Accessibility and speed.** WCAG AA on every text-on-background pair (4.5:1 normal, 3.0:1 large);
targets big enough for a finger; keyboard focus visible; nothing animated that hides state; the
0.5 s tick stays smooth.

## 3. Where a facelift is most likely to go wrong here

Recorded in advance so the review is not improvising when the spec lands.

1. **Colour as the only signal.** The highest-risk failure and the least visible one. Every proposed
   state colour is checked for a shape or text companion.
2. **Contrast lost to taste.** Softer greys read as calmer and fail AA. The baseline table (§4) gives
   the current ratio for each pair, so a proposal can be judged as a delta rather than a vibe.
3. **A web font.** The single most likely Rule 7 breach in any design spec, because designers
   reasonably assume one is available. It is not, and no amount of inlining makes a *downloaded*
   font compliant — an inlined subset is a size question, a linked one is a Rule 7 breach.
4. **Animation that hides state.** A fade or a slide that makes an alarm invisible for 200 ms is
   forbidden, however subtle. The existing blink is the reference case: it must keep the alarm
   legible in both phases.
5. **A new panel that forgets the split.** Anything new that renders instructor material must opt
   into the gate; it will not be caught automatically unless `tests/leakage.test.js` covers it.
6. **Prose rewrites tripping the text gates.** `tests/process-text.test.js` and the alarm-help
   coverage gate pin user-visible prose against the live configuration. A relabelling item is a
   behaviour change wearing a facelift's clothes.

## 4. Baseline

Measured on `facelift/baseline` before any change. The audit tables live in
`docs/dev/FACELIFT-BASELINE-AUDIT.md`; the headline numbers:

| Measure | Baseline |
|---|---|
| Single-file build | 777,170 bytes (0.74 MB) |
| External runtime references | **zero** |
| `@import` / `@font-face` / CDN | **zero** in both builds |
| Suite | 993 tests, 0 fail (992 pass / 1 skip with `anthropic`; 989 / 4 skip without) |
| Goldens | 31/31, byte-identical |
| Smoke | ok on both builds |

**Before screenshots:** `.facelift/before/shot-folder.png` and `.facelift/before/shot-dist.png`,
captured from `tools/smoke.sh` at 1400×900 on both builds. The after set is captured the same way,
same size, same scenario, so the comparison is like-for-like.

## 5. Order of work

1. Baseline captured. **(done)**
2. Spec arrives.
3. **Review memo written — every item, a verdict, a reason, a rule. No code yet.**
4. Anthony reads the memo.
5. Only then: implement what was accepted, on this branch. A whole skin goes behind a theme switch
   with today's look as the fallback and the default.
6. After screenshots, suite 0 fail, goldens by digest, smoke ok on both builds.
7. Nothing reaches `v3` without Anthony's word.

## 6. What this protocol does not decide

Taste. If an item is compliant with every rule and is simply a look Anthony does or does not want,
the memo says **ACCEPT (taste — Anthony's call)** and does not pretend a rule settles it. Dressing a
preference up as a rule violation would corrupt the only thing that makes this review worth having.
