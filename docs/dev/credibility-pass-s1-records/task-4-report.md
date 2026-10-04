<!-- @artifact dev -->
# Task 4 report: the page shows the observed value, the crosshatch for UNCERTAIN, and no negative zero (D7 display, D14)

Status: DONE_WITH_CONCERNS. Commit `7131246` on `fix/playtest-2026-10` (BASE 48a72ff), one ahead of origin, not pushed.
Seat: MacBook seat (claude-sonnet-5-5), implementer. Host checked: Anthonys-MacBook-Pro.local.

## 1. What I implemented

`src/plant-core.js`, beside `fmt` (now at line 741), text verbatim from the brief:
- `fmt(v,dec)`: drops the sign when the formatted string is a negative zero (`-0`, `-0.0`, `-0.0000`); still `—` for null and NaN.
- `pvShown(l)`: `l.obs.pv` when numeric; otherwise, for pid and ind points, observe on the fly; otherwise the raw `l.pv`. A BAD point therefore keeps showing its raw value, as before.
- `hatchOp(l)`: `badPv` 0.85; `obs.quality === 'UNCERTAIN'` 0.45; else 0. Per CR8 only a saturated reading is UNCERTAIN, so a small overshoot stays unhatched.

`Experion Station Simulator.dc.html`, every edit located by its quoted code (the lines moved):
- Graphic value box: `pvT` through `this.pvShown(l)`, and `hatchOp:this.hatchOp(l)`. All four unit graphics share `mkGv`, so one edit covers U1 to U4.
- Faceplate: `const pvS=this.pvShown(l);` as the first line after `const l=...` in the faceplate block; used in `pvH` and `pvT` (as briefed) and in `indH` (section 2).
- Point Detail PV row, regulatory points: the brief's expression verbatim (value through `pvShown(dl)`, the BAD note, the UNCERTAIN note naming the limit).
- Point Detail band note: one local, `const pvB=this.pvShown(dl);`, replaces every raw `dl.pv` read in the band test and sentence. There are five reads on two lines (`inT` two, `inS` two, the printed value one), not the three the brief counts; leaving any of them raw would let the sentence and the band verdict disagree.

`src/model-id.js` and `dist/experion-station-sim-standalone.html`: restamped and rebuilt by `tools/build-dist.py`. A second build is a no-op (sha256 of both unchanged). I decoded the dist's embedded plant-core: byte-identical to `src/plant-core.js`; the page edits are present in the dist and the old `hatchOp:l.badPv?0.85:0` is gone.

## 2. Beyond the brief (two small extensions, same helper, easy to veto)

1. `indH`, the faceplate indicator bar for data-acquisition points, reads `pvS`. It sits in the same block as `pvH`; without it an indicator's bar and the number beside it would come from different sources. Pinned by the FI100 test (low-flow cutoff: the bar is 0, the raw 1 M3/H would draw 0.84).
2. The data-acquisition Point Detail PV row (the `else` branch's `mRow('Process variable','PV',...)`) reads `pvShown(dl)`. The brief names one row (line 3868) but the quoted code appears twice. Value only, no note added: an `ind` point can be UNCERTAIN with no limit (the composition-mode analyzers AI511, AI512 and LI513 through their declared quality), and the brief's note would then print "NONE LIMIT". The regulatory row keeps the brief's text exactly; for pid points UNCERTAIN can only come from saturation, so its limit is always LOW or HIGH.

## 3. Tests and TDD evidence

RED, before any source edit: the brief's three tests appended verbatim to `tests/app-credibility-s1.test.js`, 7 pass and 3 fail, each for the stated reason:
- D14: `'-0.0' !== '0.0'`
- D7 page test: `c.pvShown is not a function`
- bad PV test: `c.hatchOp is not a function`

GREEN after the implementation: 10 of 10.

My five additions (the file is now 15 tests: Task 3's 7, the brief's 3, mine 5). The brief's D7 test reaches the helpers and the Point Detail row only, so the rest of the page wiring was unpinned:
1. graphic box, faceplate and band note show 103.1 for a saturated TIC202; only the box hatches (0.45), TIC201 does not.
2. D14 as displayed: a raw -0.3 flow (FIC211) reads `0.0` on the graphic, the faceplate and in the band note ("inside the target band", where the raw value sat below the range); a positive sub-cutoff flow (0.3) draws a zero faceplate bar; a -0.04 temperature prints `0.0`.
3. a data-acquisition point (TI312, raw 700 on a 0 to 600 range) reads 619 on the graphic (hatched) and in Point Detail.
4. `pvShown` and `hatchOp` observe on the fly when a point has no `obs` (and a motor has no window).
5. a data-acquisition flow below the cutoff (FI100) reads zero in its faceplate number and indicator bar.

Wiring check: with the old page and the new helpers, four tests fail (the brief's D7 test, `110.3 DEG C`; my box and faceplate test, expected `103.1` actual `110.3`; my flow test, expected `0.0` actual `-0.3`; my ind test, expected `619` actual `700`). With the new page all pass.

Mutation check: each source edit reverted in turn (script restored both files and asserted sha256 equality afterwards), 17 of 17 killed.

| Mutation | Killed by (count) |
|---|---|
| fmt keeps the negative zero | 2 |
| pvShown always raw | 6 |
| pvShown without the on-the-fly fallback | 1 (fallback test only) |
| hatchOp never hatches UNCERTAIN | 4 |
| hatchOp BAD at 0.45 | 1 (brief's bad-PV test) |
| hatchOp without the fallback | 1 (fallback test only) |
| hatchOp UNCERTAIN at 0.85 | 4 |
| graphic value box raw | 3 |
| graphic hatch BAD-only again | 2 |
| faceplate bar `pvH` raw | 1 (flow test; needed the positive sub-cutoff case, a negative raw clamps to 0 either way) |
| faceplate bar `indH` raw | 1 (FI100 test) |
| faceplate number raw | 3 |
| Point Detail PV row (pid) raw | 1 |
| Point Detail pid row loses the UNCERTAIN note | 1 |
| Point Detail PV row (ind) raw | 1 |
| band note prints raw | 2 |
| band note `inT`/`inS` raw | 1 (flow test; needed the clamped target band [0, 2]) |

Full suite, `node --test tests/*.test.js`:
- Baseline, a pristine `git archive HEAD` export at 48a72ff: 1155 tests, 1109 pass, 36 fail, 10 skipped (nine of those skips come only from where the export runs: six artifact-class tests need git metadata, three PIP cloud tests need `import anthropic` to work under `python3`, which it does not from `/tmp`).
- Final, working tree: 1163 tests, 1126 pass, 36 fail, 1 skipped.
- The 36 failing names are identical to the baseline's (sorted-name diff empty): 14 arch fixtures, 8 golden drills, 13 golden upsets, 1 g2-lifecycle archived-run comparison. No NONDETERMINISM message in either run. No test added a red.
- `tools/smoke.sh`: before the commit `SMOKE folder: ok (147594 byte screenshot)`, `SMOKE dist: ok (147539)`; re-run on the committed tree `SMOKE folder: ok (147513)`, `SMOKE dist: ok (147391)`.

## 4. What I saw in the browser

The Playwright MCP blocks `file:`, so I served the repo read-only on `http://127.0.0.1:8791/` (localhost only; stopped afterwards) and drove the folder build: TIC202 faceplate, MAN, OP 0, then waited. The model passes 110 about 21 sim seconds after cooling is lost (measured with the harness), so 1x real time was enough.

- Faceplate: PV climbed through 47.3, then stopped at `103.1 DEG C` and stayed there in screenshots 26 s apart (20:04:37 and 20:05:03), by which time the model value was well past 110 (the harness run reaches 110 at 21 s after cooling is lost; PVHH raised at 20:04:14 with 85.4, consistent with that timing). SP 80.0, OP 0.0, MODE MAN, banner `PVHH URGENT`. Live Diagnosis still carries its existing `TIC202 reading uncertain` line.
- Graphic value box (lower left of unit 01): `103.1 DEG C` with a light diagonal hatch behind the text, text fully legible; TIC201 beside it (155.8) is the plain flat box. So the "value stops at 103.1 with a light hatch" holds on the graphic. The faceplate itself shows the value but carries no hatch or UNCERTAIN marker (see concern 3).
- Point Detail (DETAIL button): PV row `103.1 DEG C`, note `UNCERTAIN — HIGH LIMIT, reported at the transmitter limit`; band note `PV 103.1 DEG C is outside the standard limits — an alarm is configured to say so. ...`.
- Console: 161 parse-time errors, all the SVG parser objecting to raw `{{ }}` attributes before the runtime compiles the template (the noise `tools/smoke.sh` filters); three 404s (`/api/coach/health`, two `favicon.ico`), artefacts of a plain static server; no TypeError, ReferenceError or renderVals overlay.

Screenshots: `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-4-screens/` (git-excluded): `1-faceplate-and-graphic-saturated.png`, `2-graphic-box-tic202-hatched.png`, `3-graphic-box-tic201-plain.png`, `4-point-detail-pv-row-and-band-note.png`.

## 5. Concerns

1. Hatch contrast at the brief's 0.45. Spec §2.5 says the lighter hatch "passes the WCAG AA gate". I measured with `Palette.contrastRatio` against the darkest hatch stripe (`#A9A9A9` pattern line at opacity over the `#D8D8D8` box). At 0.45: PV value (16px, `#000`) 11.91:1, tag 5.76:1, but the 9px unit label (`#55524C`) 4.42:1 and the 10px mode letter (`#31548F`) 4.26:1, just under 4.5 at the worst pixel (flat box: 5.46 and 5.27). The existing BAD hatch at 0.85 is lower still (unit 3.59, mode 3.46), so this is not new, only slightly short of the spec's wording. The highest opacity that keeps every label at 4.5 on that pixel is 0.32 (mode letter), 0.41 (unit). The repo's AA gate (`tests/palette.test.js`, alarm palette pairs) does not test the hatch and stays green; the hatch colours are fixed in the template, so both palettes render the same box. I kept 0.45 as the brief and the controller specify. Decision for the controller: leave, or lower to 0.30.
2. Raw reads of the PV that remain, outside the brief's list and untouched: (a) Alarm Summary "live" column, `liveValueOf(a)` (`return a.cond==='DEVHI'?(l.pv-l.sp):l.pv`), shows the raw model value for a saturated point while the faceplate shows 103.1; (b) the trend legend value, `const cur=fld==='pv'?l.pv:...` in the trend pens builder, same; (c) the band marker in `bandSegments` reads raw `l.pv` but is clamped to the ladder, so it draws identically. (a) and (b) are one-token changes to `this.pvShown(l)` if wanted; they are the visible way an operator can still see a number the transmitter cannot send.
3. The faceplate has no hatch or UNCERTAIN marker; the playtest wording was "on the faceplate and graphic". The brief routes only the number and bar there, and the faceplate has no existing hatch to extend (`noteT` carries only BADPV). The graphic box and Point Detail carry the marker.
4. Any non-BAD UNCERTAIN reading now hatches, not only saturation (for example an analyzer with declared quality UNCERTAIN). None of AI511, AI512 or LI513 is on a graphic, so nothing changes on screen today.
5. Stale help text, not changed (outside the brief): the assistant answer `PV shows crosshatch` in the page (`Crosshatch means bad or uncertain PV quality. A BADPV alarm raises and the PID sheds ...`), `tools/coach/guide.txt` line 32 and `tools/coach/prompt.txt` line 32 describe the crosshatch as BAD behaviour only (BADPV, shed to MAN). A light hatch now means a saturated reading, which raises no BADPV and sheds nothing. The page answer says "or uncertain" and then describes only the BAD case; the coach files say only BAD. Worth a line each when the S4 or S5 tasks touch that text.

## 6. Self-review

- Scope: brief's three edits plus the two disclosed extensions, nothing else. No `Math.random`, DOM or timer in `src/plant-core.js`. `git diff --check` clean. New names (`pvShown`, `hatchOp`, `pvS`, `pvB`) are unique in the page and src.
- Staged by name: the five files. `NIGHT PREVIEW.dc.html` untouched and untracked. Nothing under `tests/fixtures/`. Not pushed. Trailers exactly as given (git parses both as trailers).
- I amended my own unpushed commit once (`7131246`, was `83f88a9`) to fold the strengthened tests in; the message names the tests and the mutation result.

## 7. Environment notes

- A compound command containing `rm -rf` on a `/tmp` path was blocked by the t2helix hook before anything ran; I redid the baseline comparison with `mktemp -d` and no delete. One directory, `/tmp/ess-base.*` (a pristine export of 48a72ff), remains in `/tmp`.
- The Playwright MCP wrote its output into `.playwright-mcp/` inside the repo; I copied the four screenshots out and removed that directory file by file. The localhost server is stopped (port 8791 free).

---

# Fix report 1: controller rulings CR12 and CR13, concerns 3 and 4

Status: DONE_WITH_CONCERNS. Commit `78aff56` on `fix/playtest-2026-10`, a new commit on top of `7131246` (not amended), two ahead of origin, not pushed. Subject as ruled: `fix(hmi): the saturation hatch clears AA at 0.30; the Alarm Summary live value and the trend legend read the observed value`, same two trailers.
Seat: MacBook seat (claude-sonnet-5-5), implementer.

## F1. What changed

CR12, `src/plant-core.js`: `hatchOp` UNCERTAIN opacity 0.45 to 0.30, with a comment naming CR12 and the test that measures it. BAD stays 0.85. Every test that asserted 0.45 (four assertions, all in `tests/app-credibility-s1.test.js`) now asserts one named constant, `UNCERTAIN_HATCH = 0.30`. No other test, source or live doc carried the number.

CR13, `Experion Station Simulator.dc.html`:
- `liveValueOf(a)`, the Alarm Summary live column: both branches now read `this.pvShown(l)` (`a.cond==='DEVHI'?(this.pvShown(l)-l.sp):this.pvShown(l)`). Both, because the alarm scan already evaluates DEVHI as observed PV minus SP (plant-core `const v=cond==='DEVHI'?(pv-l.sp):pv`), so a half change would leave the column disagreeing with the alarm it describes. Comment above it updated.
- `mkPens`, the trend legend's current value: `const cur=fld==='pv'?this.pvShown(l):...`. The Trend display and the Point Detail CHART tab share `mkPens`, so both legends change.

Concern 4, the page's `topics()` entry `PV shows crosshatch` now reads: "A crosshatch behind a value means the reading cannot be taken at face value. A full hatch is bad quality: a BADPV alarm raises and the PID sheds per its option — default SHEDHOLD: MODE to MAN, output held at the last good value. Keep it in MAN until the input is repaired. A light hatch is a saturated transmitter: the process has gone past what the instrument can send, so the number shown is its reporting limit, not the true value, and nothing sheds. Point Detail names the limit; act on the process, not the instrument." Keywords and chip label unchanged. `tools/coach/guide.txt` and `tools/coach/prompt.txt` untouched (stage S5). No test or fixture carried the old answer text.

Rebuilt: `src/model-id.js` and `dist/experion-station-sim-standalone.html` (decoded: embedded plant-core byte-identical to `src/plant-core.js` with 0.30; the page edits present, the old live-column, legend and help text absent).

Three new tests in `tests/app-credibility-s1.test.js` (file is now 18 tests):
1. `CR12: the saturation hatch clears WCAG AA for every label on a value box, in all four unit graphics`. It takes the opacity from `hatchOp` for a saturated TIC202, reads the box fill, the pattern's two colours and the four label colours out of the page template for each of the four unit graphics, and asserts every label is at least 4.5:1 on both pixel classes (stripe and ground). It also fails if any of those colours stops being a literal (palette-driven), because then the table below would need re-measuring per palette.
2. `CR13: the Alarm Summary live value and the trend legend value show the observed value`: with TIC202 saturated, the three TIC202 Alarm Summary rows read `103.1` (PVHH), `103.1` (PVHI) and `23.1` (DEVHI, 103.125 - 80), and `tv.pens` `TIC202.PV` reads `103.1` (the model reads 110.3 and 30.3).
3. `the crosshatch help answer names both hatches`: the answer names a full hatch as bad quality with BADPV and shed, and a light hatch as a saturated reading at its reporting limit.

## F2. Concern 3: which brief requirement each extension serves

- `indH` (faceplate indicator bar for data-acquisition points reads `pvS`): serves the brief's Step 4 faceplate item and spec §2.3's consumer list ("the faceplates"). Step 4 routes the faceplate's number and bar through the observed value; `pvH` is the bar for regulatory points and `indH` is the same bar for indicators, so without it an indicator's bar and the number beside it would come from different sources.
- Data-acquisition Point Detail PV row (value through `pvShown(dl)`): serves the brief's Step 4 "Point Detail PV row" item and spec §2.3 ("Point Detail"). The quoted row exists twice in the page (regulatory and data-acquisition branches); the brief's line number names the first. It also serves the commit's own stated aim, that operator-facing values are the observed ones, which CR13 now states as the rule.

## F3. Contrast measurements (CR12): the pairs, the ratios, the palettes

Reproduce: `node .superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-4-fix-aa-measure.js` (output saved beside it as `task-4-fix-aa-measure.txt`); the committed test re-derives the pass/fail from the template on every run.

Inputs, literals in the template and identical in all four unit graphics (`hatch`, `hatch2`, `hatch3`, `hatch4`): box `#D8D8D8`; pattern ground `#C4C4C4`; stripe `#A9A9A9` (3.5 of every 7 px); labels tag `#44413c` (10 px bold), PV value `#000000` (16 px bold), unit `#55524c` (9 px), mode letter `#31548F` (10 px bold). Hatch pixel = opacity times pattern colour plus (1 - opacity) times the box.

Ratios (WCAG relative-luminance contrast, `ESS.Palette.contrastRatio`), AA is 4.5:1 for all four (none is WCAG "large text"):

| Label | colour | flat box | 0.30 stripe | 0.30 ground | 0.45 stripe | 0.85 stripe (BAD) |
|---|---|---|---|---|---|---|
| PV value, 16 px bold | `#000000` | 14.73 | 12.81 | 13.89 | 11.91 | 9.68 |
| tag, 10 px bold | `#44413c` | 7.13 | 6.20 | 6.72 | 5.76 | 4.68 |
| unit, 9 px | `#55524c` | 5.46 | **4.75** | 5.15 | 4.42 (under) | 3.59 (under) |
| mode letter, 10 px bold | `#31548F` | 5.27 | **4.58** | 4.97 | 4.26 (under) | 3.46 (under) |

Pixel colours: 0.30 stripe `#CACACA`, ground `#D2D2D2`; 0.45 stripe `#C3C3C3`, ground `#CFCFCF`; 0.85 stripe `#B0B0B0`, ground `#C7C7C7`. At 0.30 the minimum over every label and pixel is 4.58:1 (mode letter on the stripe), so every pair clears AA; 0.45 failed two pairs, as reported. The BAD hatch at 0.85 is unchanged and still has unit 3.59 and mode 3.46 on the stripe, as it did before this pass.

Palettes. The repo has three colour philosophy presets, not two (`representative`, `isa101`, `night`); I measured under all three. The ratios above are identical under each, because the box, the pattern and the four labels are literal colours that the preset does not touch. Evidence from the real renderer: for the saturated TIC202 box under each preset (set through `setPalette` at SUPV), `hatchOp` is 0.3 and `pvT` is `103.1` in all three; what does change with the preset is the alarm chip (fill `#FF0000` / `#E22028` / `#C62828`, text `#FFFFFF` in all), the ladder band fills and the marker (`#000000`, `#000000`, `#E6EAF0`). None of those is a label drawn on a hatch pixel: the chip is its own opaque rect drawn after the hatch, and the band strip and marker sit left of the 128 px box. The chip pairs are the alarm palette's own, gated by `tests/palette.test.js` (green).

## F4. Evidence: RED, GREEN, mutation, gates

RED (tests first, before any source edit), `node --test tests/app-credibility-s1.test.js`: 18 tests, 11 pass, 7 fail, each for its stated reason: four assertions `0.45 !== 0.3` (the brief's D7 test, my box and faceplate test, my data-acquisition test, my fallback test); the new AA test stopped at its opacity precondition (`0.45 !== 0.3`); the CR13 test `'110.3' !== '103.1'`; the help test on the old text.
GREEN after the edits: one failure left, my own slice arithmetic in the AA test (the block was cut before `</text>` so the mode label could not match), fixed; 18 of 18.

Mutation check (script `task-4-fix-mutate.py`, every file restored and sha256-verified): 12 of 12 killed, none survive.

| Mutation | Result |
|---|---|
| hatchOp UNCERTAIN back to 0.45, code only | killed by 5 |
| hatchOp 0.45 and the test constant 0.45 together (only the AA assertions can fail) | killed by the AA test: `euT #55524c on the stripe pixel #c3c3c3 is 4.42:1, under AA 4.5:1` |
| unit label in graphic 3 lightened to `#777777` | AA test, `graphic 3 ... 2.73:1` |
| hatch4 stripe darkened to `#707070` | AA test, `graphic 4 ... 3.97:1` |
| graphic 2 box fill darkened to `#B0B0B0` | AA test, `graphic 2 ... 3.51:1` |
| graphic 1 PV label made palette-driven | AA test, `graphic 1: the pvT label is a literal colour` |
| live column raw outside DEVHI / raw in DEVHI / legend raw | CR13 test (3 mutations) |
| help answer drops "full hatch is bad quality" / "light hatch is a saturated" / "reporting limit" | help test (3 mutations) |

Covering tests, the command from the ruling and its output:
```
node --test tests/app-credibility-s1.test.js tests/app-alarms.test.js tests/app-palette-limits.test.js
# tests 40   # suites 0   # pass 40   # fail 0   # cancelled 0   # skipped 0   # todo 0
```

Gates:
- Build: `python3 tools/build-dist.py` wrote `dist/experion-station-sim-standalone.html (793918 bytes, 31 manifest entries)`.
- Full suite: `node --test tests/*.test.js`: 1166 tests, 1129 pass, 36 fail, 1 skipped. The failing names are identical to the pristine-baseline list (sorted-name diff empty): 14 arch fixtures, 8 golden drills, 13 golden upsets, 1 g2-lifecycle archived-run comparison. No NONDETERMINISM message. No test added a red. Nothing under `tests/fixtures/` touched.
- Smoke: `SMOKE folder: ok (147519 byte screenshot)`, `SMOKE dist: ok (147602 byte screenshot)`, exit 0.
- Browser, the folder build over a localhost-only static server (stopped afterwards), TIC202 in MAN at OP 0 as before: the graphic box shows `103.1` with a light diagonal hatch (visible in the device-scale crop, faint at normal scale; see F5.1); the Alarm Summary rows read live `103.1`, `103.1` and `23.1` with trips 85.0, 70.0 and 12.0; the Trend TG01 legend reads `TIC202.PV 103.1`; typing `crosshatch` into the assistant shows the new answer as a live hit. Console: the same 161 template parse errors, and 404 or 501 responses for `favicon.ico` and the sidecar endpoints (`/api/coach/stream`, `/api/coach/advise`), artefacts of a static server; no runtime exceptions.
- Screenshots 5 to 9 in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-4-screens/` (git-excluded): hatch crop at 0.30, graphic overview, Alarm Summary live column, trend legend, help answer.

## F5. Concerns that remain

1. Hatch visibility at 0.30, a consequence of the ruling, quantified rather than changed. Stripe against ground is 1.084:1 and the hatched box against the flat box is 1.104:1 (0.45: 1.131 and 1.162; BAD 0.85: 1.283 and 1.332). So the light hatch reads as a faint texture: clear in a device-scale crop, hard to see at normal viewport scale. The signal for a saturated reading is carried by the number sitting at the reporting limit, the Point Detail note, the alarm chip and the Live Diagnosis line, not by the hatch alone. If a stronger cue is wanted without touching label contrast (the binding limit is the label on the stripe), that is a design change (a quality glyph or a bordered box), not an opacity change; I did not make one.
2. The plan's Task 4 text, `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` lines 419, 443 and 474 (interface line, test, code), still says 0.45. It is a historical stage plan, and Anthony's rule for that class is to leave the old line and put a dated note beside it. I did not edit it; the spec record of CR12 and CR13, like CR6 to CR11 in `48a72ff`, is the controller's. The spec itself carries no opacity number.
3. Unchanged by design: the BAD hatch (0.85, unit 3.59 and mode 3.46 on the stripe, as before); the band marker in `bandSegments`, which still reads raw `l.pv` but is clamped to the ladder and so draws identically; the coach files for S5. The older commit `7131246` still says 0.45 in its message (history).

---

# Fix report 2: CR14 and the two required minors from the Task 4 review (plus the two welcome items)

Status: DONE_WITH_CONCERNS (the folder-build smoke could not run because DNS went down, see G3; one pre-existing crash found and flagged, see G4.1).
Commit: `7821df7` on `fix/playtest-2026-10`, a new commit on top of `78aff56` (never amended), not pushed. Subject as ruled: `fix(hmi): the faceplate says SATURATED at the limit; the band marker and the data-acquisition detail row read the observed value`, same two trailers, five files staged by name.
Seat: MacBook seat (claude-sonnet-5-5), implementer.
`docs/dev/CREDIBILITY-PASS-PLAN-S1.md` (the controller's uncommitted edit) was never touched, staged, stashed or reset; it is still the only other modified file in the tree.

## G1. What changed

CR14, `Experion Station Simulator.dc.html`, faceplate `noteT`: BADPV keeps precedence; otherwise a saturated UNCERTAIN reading says `SATURATED — REPORTED AT HIGH LIMIT` (or `LOW`). TIC202 at 103.1 reads exactly `SATURATED — REPORTED AT HIGH LIMIT`.

Minor 1, `bandSegments`: the ladder marker reads `this.pvShown(l)` for non-motor points (motors keep `run?1:0`). FIC211 at raw 0.3 now puts the Point Detail marker on the zero rung, `160.0` on the 160 px ladder, where the raw value drew `158.8`.

Minor 2, Point Detail: the data-acquisition PV row carries the same note as the regulatory row, guarded by `limit!=='NONE'`. Both rows now take it from one local (`satNote`), so the pid row's note is unchanged in text and gains the guard. The help answer's claim that Point Detail names the limit is now true for both kinds of point.

Welcome items taken: `obsOf(l)` in `src/plant-core.js` is the one place that decides "use the point's obs, else observe pid and ind points on the fly, a motor has none"; `pvShown`, `hatchOp`, the faceplate note and the Point Detail note all read it. The `fmt` test gains `NaN` and `undefined`.

Rebuilt: `src/model-id.js` and `dist/experion-station-sim-standalone.html` (embedded plant-core byte-identical to the source, with `obsOf`; every page edit present in the dist, the old fixed-height note lines absent).

Two new tests and three extended ones in `tests/app-credibility-s1.test.js` (file is now 20 tests):
1. new `CR14: the faceplate note says SATURATED at the limit, BADPV still wins, and a limit-less UNCERTAIN stays quiet`: saturated TIC202 reads `SATURATED — REPORTED AT HIGH LIMIT`; the same plant with `badPv` forced on while its observation is still UNCERTAIN reads BADPV (the precedence, which a real BAD point cannot show because its quality is BAD); a bad FIC102 reads BADPV; AI205 made STALE (UNCERTAIN, limit NONE) reads blank.
2. new `the data-acquisition Point Detail row names the limit of a saturated reading, and only then`: TI312 at raw 700 reads `619 DEG C` with `UNCERTAIN — HIGH LIMIT, reported at the transmitter limit`; healthy 380 reads blank; AI205 STALE reads blank.
3. extended D14 flow test: the ladder marker sits on the zero rung (`160.0`) for FIC211 at raw 0.3.
4. extended fallback test: `obsOf` observes on the fly, returns `null` for a motor, and uses a written obs as it stands.
5. extended fmt test: `NaN` and `undefined` print `—`.

## G2. Judgment calls to flag

1. The `limit!=='NONE'` guard is also on the faceplate note, not only on the Point Detail row as MINOR 2 wrote it. Without it a stale analyzer (UNCERTAIN, no limit) would print `SATURATED — REPORTED AT NONE LIMIT`. For regulatory points an UNCERTAIN reading always carries LOW or HIGH, so CR14's text is verbatim for every pid case; an indicator gets the note only when it has a limit.
2. `min-height` instead of `height` on the note line in both faceplate templates (regulatory, line 1488, and indicator, line 1515). The ruled text is about 205 px wide and the note column is about 167 px in both, so it needs two lines, and the note box was a fixed 13 px (12 px), so the second line spilled below its box (measured: box 13 px, content 24 px, overflow visible). With `min-height` the box measured 24 px, no overflow, an empty or short note stays exactly as tall as before. I kept the ruled text verbatim rather than shortening it.
3. `obsOf` makes `pvShown` slightly simpler than the brief's version: a written obs whose pv is not a number (a BAD point) is no longer re-observed on the fly; `pvShown` returns the raw value for it, as it always did for BAD points. The only difference is a stale BAD obs for the one tick after a fault clears.

## G3. Evidence

RED (tests first, before any source edit), `node --test tests/app-credibility-s1.test.js`: 20 tests, 16 pass, 4 fail for their stated reasons: marker `'158.8' !== '160.0'`; `c.obsOf is not a function`; faceplate note `''` against `SATURATED — REPORTED AT HIGH LIMIT`; data-acquisition note `''` against the UNCERTAIN note. The `NaN` and `undefined` additions pass already (coverage only). GREEN after the edits: 20 of 20.

Mutation check (script `task-4-fix2-mutate.py`, every file restored and sha256-verified): 33 of 33 killed over the whole current code state, none survive; and the five CR12 AA-gate mutations re-run against the refactored code, 5 of 5 killed (script `task-4-fix2-mutate-aa.py`). The new edits and what kills them:

| Mutation | Killed by |
|---|---|
| obsOf ignores a written obs / has no on-the-fly fallback / observes motors too | the extended fallback test (3 mutations) |
| pvShown always raw; hatchOp never hatches UNCERTAIN | 8 and 5 tests |
| band marker raw (Minor 1) | the extended flow test |
| ind row note blank again (Minor 2); pid row loses its note | the new detail test; the brief's D7 test |
| satNote without the NONE guard; satNote text shortened | the new detail test (2 mutations) |
| faceplate note without the SATURATED branch | CR14 test |
| faceplate note: SATURATED outranks BADPV | CR14 test (the forced-badPv assertion) |
| faceplate note without the NONE guard; text changed | CR14 test (2 mutations) |
| fmt loses its NaN guard | fmt test |

Covering tests, the ruled command and its output:
```
node --test tests/app-credibility-s1.test.js tests/app-alarms.test.js tests/app-palette-limits.test.js
# tests 42   # suites 0   # pass 42   # fail 0   # cancelled 0   # skipped 0   # todo 0
```

Gates:
- Build: `python3 tools/build-dist.py` wrote `dist/experion-station-sim-standalone.html (794372 bytes, 31 manifest entries)`.
- Full suite, `node --test tests/*.test.js`: 1168 tests, 1131 pass, 36 fail, 1 skipped. The failing names are identical to the pristine-baseline list (sorted-name diff empty): 14 arch fixtures, 8 golden drills, 13 golden upsets, 1 g2-lifecycle archived-run comparison. No NONDETERMINISM message. Nothing under `tests/fixtures/` touched. The controller's uncommitted plan edit was in the tree during the run and changed nothing.
- Smoke: `SMOKE dist: ok (147711 byte screenshot)` after the final edits. `SMOKE folder: FAIL (console errors)` with `failed to load https://unpkg.com/react@18.3.1/umd/react.production.min.js`. That build fetches React from the network and this machine's DNS went down during the session: `curl` exits 6 for every external host (`unpkg.com`, `github.com`, `example.com`), `python3` `gethostbyname` fails for them while `localhost` resolves, and a poll every 10 s for about 14 minutes never saw it return. The script is explicit that the folder build is the online one (`tools/smoke.sh`: folder online, dist with DNS blocked). It is environmental, not code: the same folder build had passed this smoke three times earlier in this task, and with the final bytes (after the `min-height` change) it ran in a real browser over localhost with CDN React while the network was still up (G3, browser). I did not route around the sandbox to get a network. The gate is therefore NOT closed for the folder build; `tools/smoke.sh` on a seat with DNS closes it.

Browser (folder build over a localhost-only static server, then the offline dist build over the same server with the component reached through React's fibre tree and the sim frozen; both servers stopped afterwards):
- Regulatory faceplate, TIC202 in MAN at OP 0: `SATURATED — REPORTED AT HIGH LIMIT` in dark red bold on two lines, clear of the SILENCE/ACK/DETAIL/SIG PATH row; before the `min-height` change the same screenshot showed the second line overflowing its 13 px box (screenshot 10); after it, box 24 px, no overflow (screenshot 11). Point Detail unchanged for TIC202 (screenshot 12).
- Indicator faceplate, TI312 forced to 700 with the sim frozen: the same note on two lines, buttons clear below (screenshot 13); its graphic box reads 619 with the hatch; Live Diagnosis says `TI312 reading uncertain`. Point Detail PV row `619 DEG C` with `UNCERTAIN — HIGH LIMIT, reported at the transmitter limit`, blank before this commit (screenshot 14).
- Console: the dist build's log was read in full and holds only the two 404s a static server causes (`/api/coach/health`, `favicon.ico`). For the folder build I saw only the error counts this round (160 at load, 161 later, matching the parse-time template noise and favicon 404 of the earlier rounds); the log text was not re-read.
- Screenshots 10 to 14 in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-4-screens/` (git-excluded).

## G4. Concerns that remain

0. The folder-build smoke gate is open for the environmental reason in G3; everything else in the three gates is green.
1. A pre-existing crash on the line CR14 edits, found while writing the indicator case and not fixed here (outside the ruling): the BADPV branch of the faceplate note does `l.shed.replace('SHED','')`, and indicator points have no `shed` field. In composition mode the product analyzers AI511 and AI512 start BAD (`pv:null`, `badPv:true`, no `shed`), so opening their faceplate (the analyzer board rows call `openFp(tag)`) makes `renderVals()` throw `Cannot read properties of undefined (reading 'replace')`, which the page shows as the red overlay. Reproduced on this tree and on a pristine export of `48a72ff`; the expression dates from v1.1.0. The one-line fix is `l.badPv?'BADPV'+(l.shed?' — SHED ('+l.shed.replace('SHED','')+')':''):(...)`, which leaves every regulatory note byte-identical. I did not make it because it is not part of the ruling and would change what the commit subject says; say the word and I will add it with a composition-mode test, or leave it for stage S4.
2. The saturation note is two lines in both faceplates (see G2.2). If a one-line note is preferred, the ruled text would need shortening (for example `SATURATED AT HIGH LIMIT`, about 150 px); I kept it verbatim.
3. Unchanged by design, as before: the BAD hatch at 0.85 (unit 3.59 and mode 3.46 on the stripe), the light hatch's low visibility (stripe against ground 1.084:1), `tools/coach/guide.txt` and `prompt.txt` for stage S5, and the plan doc's 0.45 lines (the controller's uncommitted edit).


---

# Fix report 3: CR15, a bad indicator point's faceplate note no longer crashes the render

Status: DONE. Commit `8144360` on `fix/playtest-2026-10`, a new commit on top of `7821df7` (never amended), four ahead of origin, not pushed. Subject as ruled: `fix(hmi): a bad indicator point's faceplate note no longer crashes the render`, same two trailers, four files staged by name (`src/plant-core.js` is unchanged in this commit).
Seat: MacBook seat (claude-sonnet-5-5), implementer.
`docs/dev/CREDIBILITY-PASS-PLAN-S1.md` (the controller's uncommitted edit) was not touched, staged, stashed or reset; same `5 insertions, 5 deletions` stat before and after.

## H1. What changed

`Experion Station Simulator.dc.html`, faceplate `noteT`, the BADPV branch, the one-line fix from fix report 2 verbatim in effect:
`l.badPv?'BADPV'+(l.shed?' — SHED ('+l.shed.replace('SHED','')+')':''):(...)` in place of `l.badPv?'BADPV — SHED ('+l.shed.replace('SHED','')+')':(...)`. A regulatory point's note is byte-identical to today's (`BADPV — SHED (HOLD)`, and `(LOW)`, `(HIGH)`, `(SAFE)`); a point with no shed option, an indicator, reads plain `BADPV`. `src/model-id.js` and `dist/experion-station-sim-standalone.html` rebuilt (the dist carries the new expression, the old one is absent).

Tests, `tests/app-credibility-s1.test.js` (file is now 22 tests; two new, two tightened):
1. new `CR15: a bad indicator point opens a faceplate that renders, with a plain BADPV note`: `new Component({})`, `initSim(0,{materialMode:'composition_mass_v1'})` (as `tests/g2-lifecycle.test.js` and `tests/g2-live-integration.test.js` do), asserts AI511 is `badPv` with no `shed`, pushes `{tag:'AI511',x:30,y:44,pin:false}` onto `state.fps`, asserts `renderVals()` does not throw and the faceplate note is exactly `BADPV`.
2. new `CR15: a regulatory point keeps its exact BADPV note for every shed option that sheds`: FIC102 bad with its default `SHEDHOLD` reads exactly `BADPV — SHED (HOLD)`, and with `SHEDLOW`, `SHEDHIGH`, `SHEDSAFE` reads `(LOW)`, `(HIGH)`, `(SAFE)` (`NOSHED` is left unpinned: its existing text reads `BADPV — SHED (NO)`, an oddity the fix does not change and I chose not to enshrine in a test).
3. tightened: the two regulatory BADPV assertions in the CR14 test (TIC202 with `badPv` forced, and the bad FIC102) are now exact strings, `BADPV — SHED (HOLD)`, not a prefix match.

## H2. Evidence

RED (tests first, before the edit): 22 tests, 21 pass, 1 fail with the crash itself, `Cannot read properties of undefined (reading 'replace')`; the exact regulatory pins pass on today's code, which is what makes them a byte-identity guard. GREEN after the one-line edit: 22 of 22, and the whole `renderVals()` for that composition-mode plant now completes.

Neighbouring crashes: a read-only sweep rendered the faceplate and Point Detail for AI511, AI512 and LI513 in composition mode at 0, 10, 40, 80, 120, 160 and 200 s of sim time (bad, then the first samples arrive). No other throw. While bad, the faceplate note reads `BADPV` and the value `—`; from 40 s on the analyzers are good and the note is blank.

Mutation check (script `task-4-fix3-mutate.py`, the page restored and sha256-verified each time): 7 of 7 killed, none survive.

| Mutation of the note expression | Killed by |
|---|---|
| back to the crashing expression | the new indicator test (1) |
| indicator reads `BAD PV` | indicator test, regulatory test, CR14 test (3) |
| regulatory dash changed / tail changed | regulatory test and CR14 test (2 each) |
| guard inverted | indicator test, regulatory test, CR14 test (3) |
| indicator note blank when bad | the indicator test (1) |
| SATURATED outranks BADPV (re-run on this line) | the CR14 test (1) |

Covering tests, the ruled command and its output:
```
node --test tests/app-credibility-s1.test.js tests/composition.test.js
# tests 38   # suites 0   # pass 38   # fail 0   # cancelled 0   # skipped 0   # todo 0
```

Gates:
- Build: `python3 tools/build-dist.py` wrote `dist/experion-station-sim-standalone.html (794387 bytes, 31 manifest entries)`; a re-run changes nothing.
- Full suite, `node --test tests/*.test.js`: 1170 tests, 1133 pass, 36 fail, 1 skipped. The failing names are identical to the pristine-baseline list (sorted-name diff empty): 14 arch fixtures, 8 golden drills, 13 golden upsets, 1 g2-lifecycle archived-run comparison. No NONDETERMINISM message. Nothing under `tests/fixtures/` touched.
- Smoke: `SMOKE dist: ok (147394 byte screenshot)` after the final edit. `SMOKE folder: FAIL` on `failed to load https://unpkg.com/react@18.3.1/umd/react.production.min.js`: DNS is still down for me (`curl` to `unpkg.com` exits 6), so, as the ruling says, the controller's run on this machine stands for the folder build.
- Browser, the offline dist build over localhost-only servers (stopped afterwards), composition mode entered exactly as `startMaterialRun()` does (`initSim(P.t,{materialMode:'composition_mass_v1'})`, frozen, unit 04), then `openFp('AI511')` as a click on the analyzer board row does: on the previous commit's dist the whole station goes blank behind a red banner, `index.renderVals(): Cannot read properties of undefined (reading 'replace')` (screenshot 15); on the fixed dist the station renders, the AI511 faceplate (`TK-503 UNCONVERTED A`) shows `— MASS %` and `BADPV` in the note line, Live Diagnosis says `AI511 reading unavailable` (screenshot 16). Screenshots 15 and 16 are in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-4-screens/`.

## H3. Concerns

None new. The folder-build smoke is the controller's run, as ruled. Not changed, noted: Point Detail's PV row for a bad indicator reads `— MASS %` with no note (the indicator row carries only the saturation note; the regulatory row says `BAD PV — crosshatch shown on graphic`); the earlier concern about this crash (G4.1) is closed by this commit.
