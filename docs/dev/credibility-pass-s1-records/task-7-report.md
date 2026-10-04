<!-- @artifact dev -->
# Task 7 report: the flag beside the mode line, INITMAN at a limit, the cascade-return clamp

Seat: MacBook seat (Claude Sonnet 5.5, implementer subagent). Branch `fix/playtest-2026-10`, BASE `605253e`.
Commit: `62ef3f5` feat(hmi): one flag names what holds a loop; INITMAN says when it is at a limit; a clamped CAS return is journaled
Not pushed (the brief's `git push` was skipped by instruction).

## 1. What I implemented

`src/plant-core.js`, beside `pvShown` / `hatchOp`:
- `flagText(l)`: `''`, `INITMAN`, `INITMAN · OP AT HI LIMIT`, `INITMAN · OP AT LO LIMIT`, `INTERLOCK · <reason>`, `TRACK · <reason>`, `NOTE · <reason>`. It keys on `ESS.Pid.tracking(l)` (INTERLOCK / TRACK only while the hold is applied; NOTE for a device hold the operator has overridden in MAN), exactly as the brief's code.
- `casRange(slaveTag)`: the cascade map's `f(0)`..`f(100)` cut to the secondary's own SP limits, `'10.0–70.0 DEG C'` for TIC202; `''` when the map or the point is missing.
- `setMode`: `pinned` / `spBefore` captured before `transferMode`; after the MODE CHANGE event (and before `dAct`, the rest untouched) a pinned CAS return whose setpoint moved journals `SP CLAMPED TO CASCADE RANGE` (SYSTEM, old and new via `fmt`) and posts `SP CLAMPED TO CASCADE RANGE 70.0 DEG C` to the message zone.

`Experion Station Simulator.dc.html`:
- faceplate: `initT:this.flagText(l)` (was `l.init?'INITMAN':''`).
- Point Detail Cascade row: value gains ` · COMMANDS SP <casRange>` for a primary, note is `this.flagText(dl)` (was `dl.init?'INITMAN — tracking secondary':''`). One local, `const casR=dl.slave?this.casRange(dl.slave):''`, so the phrase is left out when `casRange` is empty (see deviations).

`dist/experion-station-sim-standalone.html` rebuilt and `src/model-id.js` restamped (hash line only) by `python3 tools/build-dist.py`, in the same commit.

The coach / Live Diagnosis / help strings about INITMAN were left alone (out of scope).

## 2. What I tested, and results

| Gate | Result |
|---|---|
| `node --test tests/app-credibility-s1.test.js` | 41/41 (the brief's 4 plus 4 extra) |
| `node --test tests/*.test.js` at HEAD | 1198 tests, 1161 pass, 36 fail, 1 skipped |
| `python3 tools/build-dist.py` | clean; rebuild reproducible (identical size and file set) |
| `tools/smoke.sh` on the committed tree | `SMOKE folder: ok (147436 byte screenshot)`, `SMOKE dist: ok (147659 byte screenshot)` (DNS was up, so both ran) |

### Red-set comparison (BASE vs HEAD)

BASE was a scratch worktree at `605253e` (`git worktree add /tmp/t7-base 605253e`, removed with `git worktree remove --force`). Names compared with the `not ok NNN - ` prefix stripped (numbering shifts when tests are added). `diff` of the two sorted name lists is empty: the same 36 names, nothing else.

BASE: 1190 tests / 1150 pass / 36 fail / 4 skipped. HEAD: 1198 / 1161 / 36 / 1. Arithmetic: 1150 + 8 new tests + 3 un-skipped = 1161. The 3 extra skips at BASE are the optional PIP cloud-sidecar tests (`tests/coach-cloud.test.js`, `tests/coach-credential.test.js`), which skip when `python3 -c 'import anthropic'` fails: under `/tmp` `python3` resolves to 3.14.6 (no `anthropic`), in the repo to pyenv 3.10.12 (has it). Environment only, unrelated to this change; I confirmed it with a foreground rerun at BASE (still 4 skipped, same 36 names).

The 36 (14 architecture goldens, 8 drill goldens, 13 upset goldens, 1 archived-checkpoint test):
- A1 Frozen flow measurement: diagnose phase earns 90 but cannot pass before the debrief answer
- A2 Input channel failure: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A3 Bias with GOOD quality: diagnose phase is 60 before SAFE_RESTRAINT/debrief; no alarm is synthesized
- A4 Redundancy switchover: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A5 Controller loss: weighted diagnose-phase fixture is 65 before SAFE_RESTRAINT/debrief completion
- A6 Single network path degradation: weighted diagnose-phase fixture is 70
- A7 Communications partition: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A8 Server / flex service loss: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A9 Local station failure: weighted diagnose-phase fixture is 70
- A10 Historian gap: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A11 Assistant loss: diagnose-phase fixture is 60 before SAFE_RESTRAINT/debrief completion
- A12 Causal measurement bias: low TIC201 bias moves the real measurement/controller physics digest
- A1 gated: seizing MAN before diagnosing anything caps a would-be 90 down to 79 and flips pass to false
- A6 gated: an unrelated MODE.SET still trips the gate even though the raw score was already under the cap
- actual archived v1 checkpoints resume explicit legacy operation without inventing composition
- golden: drill D1, D2, D3, D4, D6, D9, D11, D12 unattended run is deterministic and matches the committed fixture (8)
- golden upset: xmtr, drift, surge, pump, cool, stick, vap, air, rxn, foul, agit, bedact, agit-batch (13)

### Mutation pass (my own code, scratch copy, the real tree untouched)

31 single-point mutants against the focused test file; 30 killed, 1 survivor, which is equivalent.
- flagText: tracking() forced true; INTERLOCK/TRACK swapped; HI tolerance 0 and 0.5; LO tolerance 0 and 0.5; LO branch deleted; HI branch deleted; `trk.on` ignored; NOTE text dropped; INITMAN checked before the hold. All killed.
- casRange: not cut to SP limits (hi, lo); hyphen for the en dash; unit dropped. All killed.
- setMode: `pinned` requirement dropped; no-change guard dropped; pinned LO side dropped; pinned HI side dropped; `pinned` computed after the transfer; clamp journaled between the MODE CHANGE `addEvent` and its `events[0]` assignments; oldV is the new SP; message text changed; event typed OPERATOR. All killed.
- page: faceplate back to bare INITMAN; Point Detail note back to the old one; casR guard removed; cascade row drops the range. All killed.
- Survivor S10, `pinned` fires on any mode (not only CAS): equivalent. `transferMode` only moves SP through `followMaster` on a CAS transfer, so on any other mode change `l.sp` cannot differ from `spBefore` and the no-change guard already suppresses the journal. The brief's `m==='CAS'&&` term is redundant, not untested behaviour.
- Writing the mutants showed one weak assertion of mine (it counted MODE CHANGE events but did not pin the CAS-return event's own old/new values, so the clamp journal inserted between the MODE CHANGE `addEvent` and its `events[0]` assignments would have slipped through); I tightened it before running the pass, and that mutant (S6) is killed.

### Browser check (offline dist, headless Chrome, probe script injected into a copy under /tmp; nothing in the repo changed)

Measured in the real page (faceplate 242 px wide):
- P-101 stopped: FIC102 flag `TRACK · P-101 STOPPED`; LIC101 `INITMAN` at t+5 s and `INITMAN · OP AT LO LIMIT` at t+19 s; TIC201 and the P101 motor faceplate show no flag. (screenshot 1)
- FIC102 taken to MAN: `NOTE · P-101 STOPPED`. (screenshot 2)
- A real R-201 trip (jacket cooling lost, sim fast-forwarded with `step()` until `trips.rx`, about t+178 s): `INTERLOCK · R-201 HI TEMP TRIP` with FIC102 in CAS and in MAN. (screenshot 3)
- TIC202 AUTO with SP 75: TIC201 OP 100.0 %, flag `INITMAN · OP AT HI LIMIT`; the CAS return puts `SP CLAMPED TO CASCADE RANGE 70.0 DEG C` in the message zone and clears TIC201's flag. (screenshot 4)
- Point Detail: TIC201 Cascade row `PRIMARY OF TIC202 · COMMANDS SP 10.0–70.0 DEG C`; FIC102 `SECONDARY OF LIC101` with note `TRACK · P-101 STOPPED`. (screenshot 5)
- Layout: the faceplate's flag row has no wrap rule, so a long flag and the mode line share the 222 px row and both wrap. Row height 18 px with no flag, 30 px with a two-line flag, 42 px for `INTERLOCK · R-201 HI TEMP TRIP` (flag column about 107 px). Nothing overflows the faceplate (`flag right edge <= faceplate right edge` in every case), nothing clips, the button row below is intact. I made no template change.

Screenshots (git-excluded): `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-7-screens/1-...png` to `5-...png`. In screenshot 1 the JSON text across the top bar is my probe's hidden output element leaking, not part of the page.

## 3. TDD evidence

RED, after appending the brief's four tests and before any implementation:

    $ node --test tests/app-credibility-s1.test.js
    not ok 34 - the flag names the hold: TRACK while the pump is stopped, ...
      error: 'c.flagText is not a function'   name: 'TypeError'
    not ok 35 - D8: a secondary setpoint beyond the cascade range pins the primary, ...
      error: 'c.flagText is not a function'   name: 'TypeError'
    ok 36 - a CAS return inside the cascade range journals no clamp
    not ok 37 - the faceplate and the Point Detail carry the flag
      expected: 'TRACK · P-101 STOPPED'   actual: ''
    # tests 37   # pass 34   # fail 3

Test 37 does not call `flagText` itself: it fails on its first assertion because the Cascade row still carried the old note. Test 36 is a negative test (no clamp journaled when none is due), so it passes before the clamp exists; it guards over-journaling afterwards.

GREEN, after the implementation (brief's four only): `# tests 37  # pass 37  # fail 0`.
Final, with the four extras and the tidy-ups: `# tests 41  # pass 41  # fail 0`.

## 4. Files changed (commit 62ef3f5, 5 files, +174 / -5)

- `src/plant-core.js` (+27): `flagText`, `casRange`, the `setMode` pinned detection and clamp journal
- `Experion Station Simulator.dc.html` (+3 / -2): the `casR` line, and the faceplate `initT` and Cascade row lines replaced in place
- `tests/app-credibility-s1.test.js` (+141): the brief's four and four extras
- `src/model-id.js` (+1 / -1): hash restamp
- `dist/experion-station-sim-standalone.html` (+2 / -2): rebuilt

`NIGHT PREVIEW.dc.html` untouched and unstaged.

## 5. Self-review findings

Edge cases (the task's list):
- A loop with no `trk`: `flagText` returns `''`; pinned by a synthetic record, by a released `{on:false}` hold, and by the motor and indicator faceplates.
- An indicator point (or motor) with no `init`: `''`; the faceplate test renders `P101` and `FI100` and reads `initT`.
- A primary whose slave has no casMap entry: `casRange` returns `''` (also for an unknown tag); the Point Detail row then reads `PRIMARY OF TIC202` with no dangling ` · COMMANDS SP `. All three shipped primaries (LIC101, TIC201, TIC212) have map entries, so this is unreachable today but legal for the PID module (an identity map); the test deletes the TIC202 entry to exercise it.

Other checks:
- Brief literals kept exactly: the strings, the 0.2 tolerance, the `1e-9` guard, the `SYSTEM` event type, the message text.
- `setMode`: everything after the MODE CHANGE event (`dAct`, `journal`, `taskDone`, `archSynthEvent`) is untouched. The clamp sits after the `events[0].oldV/newV` assignments; a mutant that put it between them is killed.
- `pinned` reads `master.init` from the last scan. A CAS return in the same scan as the SP entry (before the primary re-tracked) moves the SP but is not claimed as a clamp; test D8 (third scenario) pins that, so the journal never says "clamped" when it was not.
- A device-hold NOTE only ever appears in MAN, an INTERLOCK in any mode: both pinned by the brief's first test.
- No new files, no `Math.random`, no network, no `support.js` edit, `dist/` only via the build, six trip thresholds untouched.

## 6. Deviations from the brief's literals

1. CR20 instant: no deviation. Measured (seed 4): at boot LIC101 OP = 50.000; one scan after the stop LIC101 is `init` with OP 50.000, so the flag is plain `INITMAN`, as the brief's literal says; FIC102 holds at 0 and its SP tracks its PV (52.40). LIC101's OP then decays (38.29 at 1.5 s, 29.41 at 2.5 s, 17.16 at 4.5 s, 10.13 at 6.5 s, 3.36 at 10.5 s after the stop) and steps from about 1.1 to exactly 0 at 15.5 s (seeds 1 and 4; 15.0 s for seed 7), the scan where FIC102's observed flow falls under the transmitter low-flow cutoff and its tracked SP reads 0. From then on the flag reads `INITMAN · OP AT LO LIMIT`. The brief's tests never reach the LO branch, so an extra test pins it (plain INITMAN until the flow reads zero, then the LO text, and both flags cleared one scan after the restart).
2. Point Detail cascade row: the brief's literal appends ` · COMMANDS SP ` + `casRange(...)` unconditionally. I guard it (`casR?' · COMMANDS SP '+casR:''`) so an empty range cannot leave a dangling phrase. Identical output whenever the map has an entry, which is every shipped primary. This is the only behavioural line beyond the brief's code.
3. Four extra tests beyond the brief's four (the brief's last test is titled for the faceplate but reads only Point Detail, so a revert of the faceplate line survived it; the other three meet only the HIGH limit, mid-range INITMAN and one no-change CAS return).
4. The brief's Step 6 `git push` was not run.
5. The brief predicted every new test would fail with `c.flagText is not a function`; the real RED is two of those, one assertion mismatch and one vacuous pass (see section 3).

## 7. Issues and concerns

- Live Diagnosis now contradicts the new flag for the primary of a tracking secondary. The existing rule near page line 2742 (`k+' in INITMAN — cascade broken'`, "Its secondary X is not in CAS ... Return X to CAS when ready") keys on `l.init`, and since Tasks 5 and 6 `init` is also true when the secondary IS in CAS but tracking (pump stopped). With P-101 stopped the panel reads `INFO LIC101 in INITMAN — cascade broken` beside a faceplate that says `TRACK · P-101 STOPPED` on FIC102 (visible in screenshots 1 and 2). I left it alone because the coach/help strings were declared out of scope; it wants a one-line fix in the S5 coach pass or Task 9's docs pass (the rule should say the secondary is held by the plant, not that the cascade is broken).
- The faceplate flag wraps (section 2, Layout). Legible and nothing clips, but crowded with a wrapped mode line; if a single-line flag is wanted it is a separate template decision (flex-wrap with the flag on its own line).
- Equivalent mutant S10 (redundant `m==='CAS'&&`), informational.
- The skip-count difference between the scratch worktree and the repo is the pyenv `python3` resolution, informational.

---

# Fix round 1 (before review): ruling CR22, the INITMAN diagnosis card tells the same truth as the flag

Commit: `4554b98` fix(hmi): the diagnosis card says the secondary is held, not that the cascade is broken (CR22), on top of `62ef3f5`. Not pushed.
This resolves concern 1 of the first report.

## What changed

`Experion Station Simulator.dc.html`, `diagnose()`, the INITMAN card loop (id `'init.'+k`):
- Initialised primary, secondary NOT in CAS: the existing "cascade broken" card, byte-identical (title, why, step).
- Initialised primary, secondary IN CAS (so initialised only because the plant holds the secondary): an INFO card with the same id.
  - title: `LIC101 in INITMAN — FIC102 is held`
  - why: `Its secondary FIC102 is in CAS but its output is held (TRACK · P-101 STOPPED), so the primary is initialized and tracks for a bumpless return.` The parenthesis is `this.flagText(secondary)`, verbatim (so it reads `INTERLOCK · R-201 HI TEMP TRIP` under a trip).
  - one step, `Open FIC102 to see what holds it. The hold clears when its cause clears.`, with `go:gFp(l.slave)` (the secondary's faceplate).
- Addition beyond the two shapes the ruling names (flagged so you can veto it): a secondary in CAS that is NOT held (`ESS.Pid.tracking(secondary)` false) raises no card. By the ruling's own reasoning that state cannot persist (init is recomputed every scan); it only occurs for the render(s) between the operator returning the secondary to CAS and the next scan, when `init` is one scan stale. Without the guard the held card would read "output is held ()". With it, there is nothing to say for those milliseconds.

`tests/app-credibility-s1.test.js`: one new test, `CR22: the INITMAN card says the secondary is held when it is in CAS under a hold, names the flag verbatim, and says cascade broken only when it left CAS`. It pins, with exact strings (the model is deterministic, seed 4):
1. Pump stopped, one scan: the `init.LIC101` card is INFO, title not matching /cascade broken/ and equal to the held title, why equal to the full sentence containing `TRACK · P-101 STOPPED` (and containing `flagText(FIC102)`), one step with the exact text, and `go()` opens FIC102's faceplate (state.fps reset first, so it is not vacuous).
2. FIC102 to MAN, then to AUTO: the card is the cascade-broken card with its exact title, why ("Its secondary FIC102 is not in CAS ...") and step, and its `go()` opens FIC102; then FIC102 back to CAS (pump still stopped): held again.
3. A real R-201 trip (jacket cooling lost): the card names `INTERLOCK · R-201 HI TEMP TRIP` verbatim, not a pump.
4. The stale case (`LIC101.init` forced true, FIC102 in CAS, no hold): no card.

`dist/experion-station-sim-standalone.html` rebuilt and `src/model-id.js` restamped, in the same commit.

## Evidence

RED (test first, page unchanged):

    $ node --test tests/app-credibility-s1.test.js
    not ok 42 - CR22: the INITMAN card says the secondary is held ...
      expected: 'LIC101 in INITMAN — FIC102 is held'
      actual:   'LIC101 in INITMAN — cascade broken'
    # tests 42   # pass 41   # fail 1

GREEN after the page edit: `# tests 42  # pass 42  # fail 0` (same command).

Gates, in order, on the tree committed:
- `python3 tools/build-dist.py`: wrote dist (798536 bytes, 31 manifest entries).
- `node --test tests/*.test.js`: `# tests 1199  # pass 1162  # fail 36  # skipped 1`. Red-set comparison against BASE `605253e`, recreated as a scratch worktree (1190 / 1150 / 36 / 4 skipped; the skip difference is the pyenv `python3`, as before): `diff` of the two sorted name lists is empty, the same 36 names (14 architecture, 8 drill, 13 upset, 1 archived-checkpoint), nothing else. The new test is `ok 184 - CR22: ...`.
- `tools/smoke.sh`: `SMOKE folder: ok (147610 byte screenshot)`, `SMOKE dist: ok (147516 byte screenshot)`.
- Scratch worktree and copies removed afterwards.

Mutation pass over the change (scratch copy, real tree untouched), 12 mutants, 12 killed: held card never produced; stale guard dropped; flag text hardcoded to the pump hold; held severity WARN; held step opens the primary; broken only when the secondary is in MAN; held id changed; flag dropped from the why; cause clause dropped from the step; held tested before the CAS check (AUTO under a hold would read held); broken-card title changed; broken-card step changed. The last two confirm the "keep unchanged" half of the ruling is pinned.

Browser (offline dist, headless Chrome, probe injected into a /tmp copy; nothing in the repo changed), both read from the real Live Diagnosis panel:
- pump stopped: `LIC101 in INITMAN — FIC102 is held`, expanded why `Its secondary FIC102 is in CAS but its output is held (TRACK · P-101 STOPPED), so the primary is initialized and tracks for a bumpless return.`, step `1. Open FIC102 to see what holds it. The hold clears when its cause clears.` with the GO button (screenshot 6).
- pump stopped, FIC102 in MAN: `LIC101 in INITMAN — cascade broken`, `Its secondary FIC102 is not in CAS, so ...`, `Return FIC102 to CAS when ready.` (screenshot 7, unchanged text).
Screenshots 6 and 7 are in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-7-screens/` (git-excluded).

## Concerns found while verifying this (not fixed; outside CR22's scope)

1. Same class of mismatch, one card above: the `sat.` card (`FIC102 output saturated at 0%`, "The controller has no more range — the disturbance exceeds this loop. Windup is prevented, but the PV cannot be held.") still fires for a loop whose output is held by the plant. Confirmed by a direct run (seed 4, P-101 stopped 40 s): `FIC102 mode CAS op 0 flag "TRACK · P-101 STOPPED"` and `sat.FIC102` WARN present, because FIC102 is in a PVLL alarm with OP at 0. The loop is not out of range; the plant is holding it. A rule that skips the card when `ESS.Pid.tracking(l)` (or says the output is held) would fix it; I did not touch it because CR22 names only the INITMAN card. It needs a ruling.
2. The help answer "What is INITMAN?" (page near line 2797) and `tools/coach/guide.txt:31` still say the primary initialises when a secondary leaves CAS and the fix is to put the secondary back in CAS. True as far as it goes, but silent about the held case, where the secondary is already in CAS. S5's coach pass is the natural home.

---

# Fix round 2 (before review): rulings CR22b and CR23

Commit: `d9e6564` fix(hmi): a held loop raises no saturation card; the INITMAN help answer knows the held case (CR22b, CR23), on top of `4554b98`. Not pushed.
This resolves both concerns of fix round 1 (the `sat.` card, and the "What is INITMAN?" help answer). My round-1 addition (no card for a secondary in CAS with no hold) was accepted as-is and is untouched.

## What changed

`Experion Station Simulator.dc.html`:
- CR22b, `diagnose()`, the output-saturated loop (`id:'sat.'+k`): one guard added to the loop's condition, `&&!ESS.Pid.tracking(l)`, right after `l.mode!=='MAN'`, with a two-line comment. Checked mechanically: removing that one inserted substring from the new line reproduces the old line byte for byte, so nothing else about the card (title, why, steps, severity, the announced-alarm condition) changed.
- CR23, the `topics()` entry `t:'What is INITMAN?'`: the existing two sentences are kept verbatim as the prefix (checked mechanically too) and one sentence is appended: `The secondary can also be in CAS with its output held by the plant (a stopped pump or an interlock): the flag beside its mode line names the hold, and the primary returns bumplessly when the hold clears.` The keyword list is unchanged, so the chip still resolves. `tools/coach/guide.txt` is untouched, as ruled.

`tests/app-credibility-s1.test.js`: two new tests.
1. `CR22b: a loop whose output the plant holds raises no saturation card, whichever kind of hold; a loop it does not hold still does`:
   - Pump stopped 40 s on the real plant (seed 4): flag `TRACK · P-101 STOPPED`, FIC102 OP exactly 0, mode not MAN, an active alarm on FIC102 (so every other condition of the card holds), and `sat.FIC102` absent.
   - The same state with only the hold's record changed (no step runs, so the plant does not rewrite it): `on:false` gives the card with the exact title `FIC102 output saturated at 0%` (so the hold is the one variable); an interlock-kind hold gives no card; the pump hold put back gives none.
   - The cooling-loss path (`loseCooling`, run to the R-201 trip): FIC102 flag `INTERLOCK · R-201 HI TEMP TRIP`, TIC201 flag `INITMAN · OP AT HI LIMIT`, and `sat.TIC201` present with the exact title `TIC201 output saturated at 100%`: the card still fires for a loop the plant does not hold.
2. `CR23: the INITMAN help answer keeps the broken-cascade case and says the secondary can be in CAS with its output held`: the answer starts with the unchanged two sentences and matches the four phrases of the added one. No existing test pins help-answer text for this topic (the other tests that touch `topics()` only check chip keywords and the three orientation topics), so this is a new assertion, in the style of the existing crosshatch-answer test.

`dist/experion-station-sim-standalone.html` rebuilt (798981 bytes) and `src/model-id.js` restamped, in the same commit.

## A hole the mutation pass found in my own first draft of the CR22b test

My first draft also claimed "an interlock hold raises no saturation card" from the real R-201 trip, asserting `sat.FIC102` absent 60 s after the trip. The mutation pass showed that claim was vacuous: mutant G3 (guard covers device holds only) survived. Cause, measured: after the R-201 trip FIC102's PVLO and PVLL are suppressed by the trip itself (state `DSUPR`, `suppressedBy: "R-201.HI TEMP TRIP"`), so they are never in the announced set (UNACK/ACKED) the card requires, and the card cannot fire for FIC102 there with or without the guard. I replaced that half: the interlock kind is now asked of the guard on the pump-stop state by editing the hold's record (stated in a comment), and the real trip scenario is kept only for what it can honestly show, the TIC201 positive control. Consequence worth knowing: for FIC102 the interlock-plus-announced-alarm combination is not reachable through a real trip in the shipped plant, so the guard's interlock coverage is defensive, pinned at the predicate level.

## Evidence

RED (tests first, page unchanged):

    $ node --test tests/app-credibility-s1.test.js
    not ok 43 - CR22b: a loop whose output the plant holds raises no saturation card ...
      a held output is not a disturbance exceeding the loop
      + actual:  { id: 'sat.FIC102', sev: 'WARN', title: 'FIC102 output saturated at 0%', why: 'The controller has no more range — the disturbance exceeds this loop. ...' }
      - expected: undefined
    not ok 44 - CR23: the INITMAN help answer keeps the broken-cascade case and says the secondary can be in CAS with its output held
      actual: 'When a cascade secondary leaves CAS, ... Fix: put the secondary back in CAS.'
    # tests 44   # pass 42   # fail 2

GREEN after the page edits: `# tests 44  # pass 44  # fail 0` (same command).

Gates, in order, on the tree committed:
- `python3 tools/build-dist.py`: wrote dist (798981 bytes, 31 manifest entries).
- `node --test tests/*.test.js`: `# tests 1201  # pass 1164  # fail 36  # skipped 1`; new tests `ok 185 - CR22b: ...` and `ok 186 - CR23: ...`. Red-set comparison against BASE `605253e` (recreated as a scratch worktree: 1190 / 1150 / 36 / 4 skipped, the skip difference being the pyenv `python3` as before): `diff` of the sorted red-name lists is empty, the same 36 names (14 architecture, 8 drill, 13 upset, 1 archived-checkpoint), nothing else.
- `tools/smoke.sh`: `SMOKE folder: ok (147476 byte screenshot)`, `SMOKE dist: ok (147540 byte screenshot)`.
- Scratch worktree, copies and logs removed afterwards.

Mutation pass (scratch copy, real tree untouched), 13 mutants, 12 killed: guard removed; guard inverted; guard for device holds only (the one that exposed the vacuous half, now killed); guard for interlock holds only; card never raised; guard keyed on the tag FIC102 instead of the hold; card title changed (pins "nothing else changes"); help: held sentence dropped, examples dropped, flag clause dropped, bumpless clause dropped, existing sentence altered. The one survivor, G7 (guard written as `l.trk&&l.trk.on` instead of `ESS.Pid.tracking(l)`), is equivalent: the two differ only for a device hold in MAN, which the card's own `l.mode!=='MAN'` condition already excludes.

Browser (offline dist, headless Chrome, probe injected into a /tmp copy; nothing in the repo changed), pump stopped 29 s, then the "What is INITMAN?" chip's action:
- `diagnose()` cards: `alarms.active` and `init.LIC101 | LIC101 in INITMAN — FIC102 is held`; no `sat.FIC102`. (Before CR22b the `sat.FIC102` card is present from about t+20 s on.)
- The assistant panel renders the full new answer, including the held-case sentence; the Live Diagnosis panel lists only the alarm summary and the held INITMAN card. Screenshot 8 in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-7-screens/` (git-excluded).

## Concerns and observations (no action taken)

- `tools/coach/guide.txt:31` still reads "INITMAN: cascade primary initializes when the secondary leaves CAS." That is as ruled (the coach corpus is S5's); it is now the one place left that describes only the broken-cascade cause.
- Pre-existing, unrelated to this change: asking "What is INITMAN?" also shows the "Why can I not change OP?" answer as a second hit, because that topic's keyword `man` is a substring of INITMAN. Visible in screenshot 8. Harmless, but a keyword-matching quirk for S5's assistant pass to know about.

---

# Fix round 3 (post-review): CR22c, Important 2, CR24, Minor 2, Minor 5, CR25

Commit: `4f6cb2e` fix(hmi): no saturation card for a held or initialised loop; the real skin trip pins the interlock case; the cascade range reads the primary's limits; the hold sits on the Output row (CR22c, CR24, CR25), on top of `0d5abc1`. Not pushed. Files: `src/plant-core.js`, `Experion Station Simulator.dc.html`, `tests/app-credibility-s1.test.js`, `src/model-id.js`, `dist/experion-station-sim-standalone.html` (+185 / -31).

I verified each finding against the running model before changing anything.

## Per finding

**Important 1, CR22c.** Verified: seed 4, TIC202 AUTO, SP 75: at t+277.5 s after the entry `diagnose()` returns both `sat.TIC201` and `init.TIC201`, TIC201 `init` true, OP 100, flag `INITMAN · OP AT HI LIMIT`, alarms PVHI and DEVHI UNACK, and the `sat.` card's step is "Consider MAN" (which INITMAN overwrites). Fix: `&&!l.init` beside `!ESS.Pid.tracking(l)` in the page's saturation loop (the card line is identical to HEAD's apart from that guard and the helper call of Minor 2, checked mechanically). Positive control moved off `loseCooling`, to real unheld, uninitialised primaries that saturate under their own control, measured on seed 4:
- TIC201 under the `cool` fault, first card 157 s after injection: AUTO, TIC202 stays CAS, `init` false, no `trk`, flag empty, OP 0, GOOD, PVHI/DEVHI/PVHH UNACK, title `TIC201 output saturated at 0%` (low limit).
- LIC101 under the `surge` fault, first card 445.5 s after injection: AUTO, FIC102 CAS and unheld, `init` false, flag empty, OP 100, GOOD, PVHI UNACK, title `LIC101 output saturated at 100%` (high limit).
Both are asserted event-driven (run until the card first appears, then check the state; TIC201's window is short, OP is back above 0.2 by about +10 s). A third test, `CR22c: an initialised primary at its limit ...`, runs the D8 setup to the announced alarm, asserts `init.TIC201` present and `sat.TIC201` absent, and isolates the cause on the record (`init=false` brings the card back, `init=true` removes it).

**Important 2.** Verified: `dasRules()` has no entry for `H-310.TUBE SKIN TRIP` (the R-201 trip suppresses FIC102's PVLO/PVLL, which is why my round-2 comment was true for FIC102 and false in general). Seed 2, TIC311 to MAN at OP 100 until `trips.skin` (31 s), `setMode('TIC311','AUTO')`, one scan: flag `INTERLOCK · H-310 TUBE SKIN TRIP`, mode AUTO, OP 0, GOOD, PVHI and PVHH UNACK (still UNACK 20 s later), `sat.TIC311` absent with the real hold and `TIC311 output saturated at 0%` with only the hold taken off the record. The CR22b test now runs exactly that, the false comment is replaced with the true one (R-201 suppresses FIC102's alarms; the skin trip has no rule), and the pump-stop interlock-kind record edit stays as the predicate-level check with an honest comment. (One trap I hit while probing: the isolating check must be made inside the UNACK window; at +24 s the alarms had already returned to RTNUN and the card could not fire either way. The test checks at +0.5 s.)

**Minor 1, CR24.** `casRange` reads `m=this.L[s.master]` and pushes `m.oplolm`/`m.ophilm` through the map (0 and 100 only when there is no master or the limit is null), still cut to the secondary's SP limits. Test `CR24`: default `10.0–70.0 DEG C`; `storeEntry('TIC201','OPHILM',90)` gives `10.0–64.0 DEG C`; `OPLOLM` 10 gives `16.0–64.0 DEG C`, and Point Detail shows the same; null limits and no master give `10.0–70.0`; a narrowed 20/80 pair gives `22.0–58.0`; and the D8 setup with OPHILM 90 pins TIC201 at 90, flag `INITMAN · OP AT HI LIMIT`, SP 64 after the CAS return, journal `75.0` to `64.0`, and `ev.newV` equal to the upper edge parsed from `casRange`.

**Minor 2.** `opLimitOf(l)` (`'HI'`, `'LO'` or `''`, 0.2 margin, HI first) beside `flagText`, used by `flagText`, by `setMode`'s `pinned`, and by the page's saturation card (the title keeps `Math.round(l.op)`). `grep` over `src/`, `tools/`, `tests/` and the page finds the margin expression once. Outputs unchanged; the existing flag, clamp and card tests cover all three sites (mutants below).

**Minor 5.** (a) The same-scan CAS snap now pins the exact value `42.078826486800764` (`10 + 0.6 * 53.46471081133461`) and its equality with `casMap.TIC202(TIC201.op)`. (b) The LO-limit test: my first attempt asserted "the observed flow was still above zero the scan before the flag flips", and that was false (RED, `...scan before: 0`). The real sequence, measured (seed 4, per scan): scan 30 the observed flow first reads exactly 0 (raw 1.0597, under the 1.2 cutoff) and FIC102's SP tracks to 0, but LIC101 (which steps before FIC102) is still at OP 1.1034, so the flag is still plain `INITMAN`; scan 31 LIC101 back-calculates to exactly 0 and the flag names the LO limit. The test now pins that (flag plain and SP 0 on the zero scan, flag change exactly one scan later, `pvShown(FIC102) === 0`, `LIC101.op === 0`) and its title says so. This also corrects how I described it before (original report section 6 and my first status message): the observed flow falls under the cutoff on the scan before LIC101 reaches 0, not on the same scan. (The earlier commit message makes no such claim.)

**CR25.** Page: the Output row's note is `'limits lo – hi'` plus `' · '` plus the flag when it starts `INTERLOCK · `, `TRACK · ` or `NOTE · `; the Cascade row's note is the flag only when it starts `INITMAN`, else `''`. The brief's page test is updated (FIC102 with P-101 stopped: Output note exactly `limits 0 – 100 · TRACK · P-101 STOPPED`, Cascade note empty; the unpinned-TIC201 range regex kept) and a new test `CR25` pins every flavour on real states: TRACK (FIC102), NOTE (FIC102 overridden in MAN), plain INITMAN (LIC101, Cascade `PRIMARY OF FIC102 · COMMANDS SP 0.0–80.0 M3/H | INITMAN`, Output just the limits), `INITMAN · OP AT HI LIMIT` on TIC201's Cascade row with no hold on its Output row, a flag-less PIC401, and TIC311 under the real skin trip (Output `limits 0 – 100 · INTERLOCK · H-310 TUBE SKIN TRIP`, Cascade `NONE | ` with an empty note). Faceplate untouched.

## Evidence

RED (tests first, source and page unchanged), `node --test tests/app-credibility-s1.test.js`: `# tests 48  # pass 44  # fail 4`:
- `the faceplate and the Point Detail carry the flag`: expected `limits 0 – 100 · TRACK · P-101 STOPPED`, actual `limits 0 – 100`
- `CR22c ...`: `sat.TIC201` present where `undefined` expected
- `CR24 ...`: expected `10.0–64.0 DEG C`, actual `10.0–70.0 DEG C`
- `CR25 ...`: Cascade note `TRACK · P-101 STOPPED` where `''` expected, Output note without the hold
The CR22b rewrite, the card's own cases and Minor 5 (apart from the false assertion described above) were green at once: they assert behaviour that already existed, so their sensitivity is shown by the mutants.

GREEN after the edits: `# tests 48  # pass 48  # fail 0`.

Gates on the committed tree:
- `python3 tools/build-dist.py`: wrote dist (799635 bytes, 31 manifest entries); a second build leaves dist and model-id byte-identical.
- `node --test tests/*.test.js`: `# tests 1205  # pass 1168  # fail 36  # skipped 1`. BASE `605253e` recreated as a scratch worktree (1190 / 1150 / 36 / 4 skipped; the skip difference is the pyenv `python3`, as before): `diff` of the sorted red-name lists is empty, the same 36 names, nothing else. (1201 at `0d5abc1` plus the 4 new tests.)
- `tools/smoke.sh`: `SMOKE folder: ok (147573 byte screenshot)`, `SMOKE dist: ok (147601 byte screenshot)`.
- Scratch worktree, copies and logs removed afterwards.

Mutation pass (scratch copy, real tree untouched), 29 mutants, 28 killed:
- helper: HI margin 0; LO margin 0; labels swapped; HI margin 0.5; flag naming the wrong side
- helper's three sites: card LO-only; card HI-only; `pinned` LO-only; `pinned` HI-only; `pinned` asking the secondary
- CR22c: initialised guard removed; every primary excluded (`!l.slave`); held guard removed; held guard for device holds only (killed by the real skin trip); card never raised
- CR24: back to 0/100; OPHILM only; OPLOLM only; no null fallback; reading the secondary's own limits
- CR25: hold dropped from Output; no separator; Cascade shows the whole flag; Cascade shows nothing; INITMAN also on Output; hold regex missing NOTE, INTERLOCK or TRACK
- Survivor: dropping the `s.master?...:null` guard in `casRange`. Equivalent: `this.L[undefined]` is `undefined`, which the downstream `m&&` already treats as "no master".

Browser (offline dist, headless Chrome, probe injected into a /tmp copy; nothing in the repo changed): FIC102 with P-101 stopped, Output row note `limits 0 – 100 · TRACK · P-101 STOPPED`, Cascade `SECONDARY OF LIC101` with no note; TIC311 under a real skin trip, Output note `limits 0 – 100 · INTERLOCK · H-310 TUBE SKIN TRIP` (wraps to three lines in the note column, legible, nothing clipped), Cascade `NONE` with no note, and no saturation card in the Live Diagnosis list; TIC201 pinned by the D8 setup, Cascade note `INITMAN · OP AT HI LIMIT`, Output note just the limits. Screenshots 9 to 11 in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/task-7-screens/` (git-excluded).

## Concerns

None new. For the controller's docs: spec §3.5 still says the cascade range is `casMap(0)` to `casMap(100)` (CR24 makes it the primary's OP limits), and §3.4 says the flag shows "beside the mode line ... in Point Detail" without the Output-row/Cascade-row split of CR25; both are the controller's docs commit, as ruled.
