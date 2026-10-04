<!-- @artifact dev -->
# Credibility Pass — Design Spec for 3.2.0

Path at commit: `docs/dev/CREDIBILITY-PASS-SPEC.md`
Status: **rev 1**, 2026-10-03. Design brainstormed with Anthony and approved section by section
in conversation; written for his review before an implementation plan is made.
Author: MacBook seat (claude-fable-5-1), Claude Code session 9570056f.
Record correction: the rev 1 commit `911329c` says the suite was 0-fail on the branch. It was
not. The cherry-picked report `docs/playtest-2026-10-02.md` lacked its artifact marker and the two
artifact-class tests failed; the message was written before the test output was read. Fixed in
the commit that adds this note, left in history rather than rewritten (V3-PLAN §I practice).
Inputs: `docs/playtest-2026-10-02.md` and `docs/playtest-pip-2026-10-02.md` (black-box runs
against main at `1f0147e`, brought over from PR #8), and the review of PR #8 of 2026-10-03
(chronicle claim `52167a2e`), which found PR #8's fixes unsound and is why this pass exists.

---

## 0. Purpose, scope, success

0.1 **Purpose.** The simulator must not teach a first-time operator a wrong habit or erode their
trust, and PIP must never state a false board fact. Anthony's framing: the process produces,
not each facet. Every item below is a credibility item; nothing here is a feature.

0.2 **In scope**, exactly:

| Group | Items |
|---|---|
| Operator defects | D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, D14 (playtest §2) |
| PIP defects | P1, P2, P3, P4, P5, P6, P7, P8, plus P9, P10 and P13 because the same mechanism closes them (PIP report §2) |
| Cheap credibility picks | the HMI items of playtest §5.10 except trend zoom and pan: U5, U7, U8, U10; and R2, R6 (playtest §4) |
| Coupled by R6 | the A5 restart-scoring defect logged in `docs/dev/A5-RESTART-SCORING-DEFECT.md` |
| Release | 3.2.0, carrying everything unreleased on main since 3.1.0 |

0.3 **Out of scope, logged.** U1, U2, U3 (beyond what D2 covers), U4, U6, U9, U11, U12, U13, U14;
R1, R3, R4, R5, R7, R8; the suspected items S1 to S3; PIP P11, P12 and the unsafe-guidance
list beyond what the grounding layer catches; the cascade range widening noted under D8. Each
goes into `docs/dev/FIDELITY-INTAKE.md` (§1.5), with the playtest as its first intake.

0.4 **Success.** (a) A re-run of both playtest reports finds none of the in-scope defects:
logic-level items proven by harness tests in the suite, browser-level items by the out-of-tree
replay of §9.3. (b) `node --test tests/*.test.js` green on a Mac build, `python3 tools/build-dist.py`
clean, `tools/smoke.sh` ok on both builds. (c) Goldens moved only where this spec says they move,
each named in the archive guard with its reason. (d) 3.2.0 tagged.

0.5 **Standing constraints, unchanged.** Hard rules 1 to 5 of `docs/dev/UPGRADE-PLAN.md`, rules
6 and 7 of `docs/dev/V3-PLAN.md`: no vendor material, no employer material, zero dependencies,
the deterministic core never waits on a network or a model, `support.js` and `dist/` never
hand-edited, the six trip thresholds untouched (§3 adds indication at a trip, never a threshold).
Goldens move only under option A: the archived v2 baseline stays byte-for-byte, movers are
re-captured after the final build of a stage, and the archive guard names each with its reason.
The W2 matrix declares and never enforces. PIP stays advisory.

0.6 **Decisions taken in this design**, Anthony's answers of 2026-10-03, in order:

1. Outcome: the credibility pass, over Stream A W3 to W5, G2 stage two, and PIP shadow mode.
2. Scope: defects plus the cheap credibility picks (0.2), everything else logged (0.3).
3. Verification: harness tests in-repo, browser replay out-of-tree beside the seat 3/3
   verify instruments.
4. PIP model policy: cloud-first, local model only as the fallback, with the grounding layer
   carrying the credibility either way.
5. Approach: two seams and one principle (this document), over minimal patches and over a
   fidelity-first stage.
6. R6: enforce the trip latch with A5 re-keyed, chosen by this seat on Anthony's "you choose".
7. PIP voice, Anthony mid-design: very concise, a couple of sentences per answer, fewer words.

Control rulings made during execution are numbered CR1, CR2, ... in the stage ledgers and cited
here as CRn, so they are never confused with the playtest's realism items R1 to R8. The ones that
changed this document or the code, in the order made (S1, 2026-10-03 and 2026-10-04):

- **CR6.** NE 43 was already registered at RESOURCES-7.35; §2.2 corrected, no duplicate entry.
- **CR8.** The band rule of §2.2: Good with the limit bit inside the window, Uncertain only when
  saturated. Replaces the inherited TIC202 rows for -0.001 and 100.001.
- **CR9.** `measure()` writes `pvObs` only when the observed value is finite, else the raw value.
- **CR10.** The FIC211 low-flow cutoff moves every fixture (§11); accepted as the honest plant; the
  3.1.0 fixtures are archived under `tests/fixtures/v31-baseline/` before any re-capture.
- **CR11.** Drill D4's stabilisation requires the feed restored (its debrief: "feed left cut fills
  the tank"): a `stable:'restore'` mode on D4 alone, the inherited alarm part AND FIC102 back in CAS
  with LIC101 in control, or FIC102 output at or above 40 % with flow at or above 40 m3/h, AND
  TK-101 below 80 %, both plant values observed. Shelving keeps the inherited semantics: a shelved
  related alarm counts as quiet, as in every drill. Found when §2.4 let "cut feed and never restore
  it" pass; the previous passing behaviour is recorded in the S1 changelog entry.
- **CR12 / CR12b.** The UNCERTAIN hatch opacity is 0.30, the highest value measured to clear WCAG
  AA for every label on a hatched box under both palettes; the BAD hatch stays at 0.85. A
  saturation marker that does not sit under text is a design item for the fidelity intake, not
  widened into S1.
- **CR13.** "Every operator-facing value" (§2.3) includes the Alarm Summary live column and the
  trend legend value; both read the observed value. The page's "PV shows crosshatch" help answer
  says bad or uncertain; the coach files' wording is S5's.
- **CR14.** The faceplate's saturation cue is its note line ("SATURATED — REPORTED AT <LOW|HIGH>
  LIMIT"), consistent with the Point Detail note; the graphic's cue stays the hatch.
- **CR15.** A pre-existing render crash (the BADPV note on a point with no shed option) is fixed on
  the line Task 4 edits, with a test rendering a bad analyzer faceplate in composition mode.
- **CR16.** During a DNS outage the dist smoke stands as the gate for commits and pushes (the
  folder build differs only by fetching React from a CDN); the folder smoke must be green before
  the stage closes. It was, at every later task.
- **CR17.** `setTracking` coerces a non-finite target to 0 (the module's safe default; the output
  clamp still applies) and says so in its header.
- **CR18.** The hold is the code's truth and the matrix only names it: a trip whose cause the
  matrix cannot name still tracks, with the raw cause id as the reason. §12's "missing reason
  source" means a missing flag or run state, never a missing name.
- **CR19.** Interlock tracking moves every run where a §3.2 interlock holds a loop, including the
  R-310 bed trip on TIC311 (drill-D12, upset-bedact); §11 amended.
- **CR20.** PV tracking during a device hold stands: FIC102 carries the declared `pvtrack`
  option, so an AUTO loop's SP tracks its PV (0) while the pump is stopped and stays there after
  the restart until the operator re-enters it, the same convention as INITMAN; CAS recovers on the
  primary's ramp. The flag and the tracked SP are visible and D1's changelog narrative says so.
- **CR21.** The slow restart after a pump stop is the textbook bumpless return of an initialised
  primary (LIC101 back-calculates to the output that commands zero flow while FIC102's SP tracks
  its PV) and is accepted. Its measured consequence (seed 4: TK-101 peaks 73 % after a 60 s stop
  and 86 % after 180 s; a restart 280 to 340 s after the stop still ends in the overflow trip
  unless FIC102 is pre-positioned in MAN) is the lesson, not a defect: drill D3's debrief says so,
  the S1 changelog carries the table, and S5's PIP safety card already says to put FIC102 in MAN
  at 20 to 30 % before the restart.
- **CR22.** The Live Diagnosis card tells the same truth as the flag: an initialised primary whose
  secondary is not in CAS keeps the "cascade broken" card; one whose secondary is in CAS and held
  gets a card that says the secondary is held and names the flag text, with its step pointing at
  the secondary's faceplate.
- **CR22b.** The output-saturated diagnosis card is withheld for a loop whose output the plant
  holds: a held output is not a disturbance exceeding the loop, and the flag names the hold.
- **CR23.** The page's "What is INITMAN?" help answer knows the held case (the secondary may be
  in CAS with its output held; the flag names the hold; the primary returns bumplessly when it
  clears). The coach corpus under `tools/coach/` stays S5's, as CR13 ruled.

---

## 1. Branch, baseline, release mechanics

1.1 **Branch** `fix/playtest-2026-10` from origin/main at `1f0147e`. The two reports are the
first two commits: `ca4323d` is PR #8's own docs commit cherry-picked with its source noted,
`620cbe7` is the PIP report taken verbatim from PR #8 commit `be0fc27`. None of PR #8's code is
reused. PR #8 is closed on Anthony's word with a comment pointing at the new PR.

1.2 **Checkout.** The MacBook clone moves off `facelift/baseline` onto this branch. The untracked
`NIGHT PREVIEW.dc.html` is left alone and is never committed.

1.3 **Release 3.2.0.** The changelog's `[Unreleased]` block becomes the 3.2.0 entry: the
credibility pass on top of W1, W2, G2 stage one, the source measurement policy, the
product-quality warning and guidance, and the governed live operations already there. Version
strings live in two places and both change: the System Status line in the page (`v3.1.0`) and
the README's current-version line.

1.4 **Build and goldens.** `dist/` is built on the Mac. The PR #8 review showed a Linux build
differs from a Mac build by one gzip header byte per blob; building on the Mac keeps `dist/`
stable. Only goldens that move are re-captured, by test-name pattern, after the final build of
the stage that moved them (`golden-recapture-workflow`), and `tests/v2-baseline-archive.test.js`
lists each mover with its reason, as the 2026-09-03 re-capture did. §11 lists the expected movers.

1.5 **Intake doc.** `docs/dev/FIDELITY-INTAKE.md` is created with the template convergence spec
§6 asks for and the playtest's deferred items as the first intake. This discharges work item W8
of `docs/dev/CONVERGENCE-SPEC.md` §10.8 on the way; nothing is wired to a process.

---

## 2. Seam A — what the operator sees: the measurement policy (D7, D14)

2.1 **Today.** `src/measurement.js` `observe(point)` classifies quality from OPC-style status
bits and already reports a range limit, with one special case: TIC202 is clamped to a reporting
window and marked `Uncertain_EngineeringUnitsExceeded`. Alarm evaluation in `src/plant-core.js`
already reads an observed value where one exists (`const pv=observed?observed.pv:l.pv`). The
faceplates and the graphic read the raw point value directly; `observe()` is called in six
places in the page. Several model equations read their own points' raw values (`L.FIC102.pv`,
the U4 analyzer and level points), so the raw value cannot be overwritten.

2.2 **The policy, generalised.** `observe()` applies one declared range policy per point class
instead of the TIC202 special case, and must reproduce TIC202's reporting window exactly, with
the band rule below applied to every point including TIC202 (a test pins that):

- Analog points (`pid` and `ind` kinds): reporting window from `lo - 0.0125 * span` to `hi + 0.03125 * span`, the 3.8 mA and 20.5 mA failure-information limits of NAMUR NE 43. Inside the nominal range the reading is Good. Beyond the nominal range but inside the window the transmitter still reports the value: status Good with the DataValue limit bit (`LOW` or `HIGH`), so a tiny overshoot never reads as uncertain. At or beyond a window edge the value is clamped to that edge with status `Uncertain_EngineeringUnitsExceeded` and the limit; that is the saturated reading the hatch, Live Diagnosis and the coach treat as uncertain (controller ruling CR8, 2026-10-03; not playtest item R8). Existing Bad and Uncertain source statuses keep precedence, as today.
- Flow points (engineering unit `M3/H`): low-flow cutoff, `|pv| < 0.01 * span` reports `0`
  with quality GOOD. This is D14's model-side half.
- Discrete and motor points: unchanged.

NE 43 is registered at `docs/RESOURCES.md` §7.35 (CITED-NOT-HELD); the policy cites `RESOURCES-7.35`.
(Rev 1 said it was not yet registered; corrected 2026-10-03 when Task 1 found §7.35, controller ruling CR6.)

2.3 **One observed field.** Each tick, after the models write `l.pv` and before controllers and
alarms run, plant-core writes `l.pvObs` (and the quality fields `observe()` returns) for every
analog point. Raw `l.pv` stays the model's. Consumers of `pvObs`: the PID module (`stepPid` reads
`loop.pvObs` when present, for the error, the derivative, `lastPv` and PV tracking), alarm evaluation (already
wired to the observed value), the faceplates, the graphic value boxes, Point Detail, trend pens,
the alarm text, and the coach projection. The model equations keep reading `pv`.

2.4 **The decision.** The loop and the alarm engine act on the observed value. A controller
cannot see what the transmitter cannot send; a display-only clamp would make the loop act on a
number the operator is told is impossible, the same class of fiction as D6. This moves goldens
for runs that leave a transmitter's range (§11).

2.5 **Rendering.** The existing crosshatch for BAD quality extends to UNCERTAIN with a lighter
hatch that passes the WCAG AA gate under both palettes. Live Diagnosis keeps its over-range line.
`fmt()` never prints a negative zero at any precision (`-0`, `-0.0`, `-0.0000` all become their
positive form). Together with 2.2's cutoff this closes D14.

---

## 3. Seam B — what loops do: one output-tracking facility (D1, D8, D10)

3.1 **In `src/pid.js`.** A loop can be told to track: `setTracking(loop, target, reason, kind)`
and `clearTracking(loop)`, stored on the loop as `trk: {on, target, reason, kind}` where `kind`
is `interlock` or `device`. `stepPid` honours it: when `trk.on` and (`kind === 'interlock'` or
the mode is not MAN), the output is held at `clampOp(target)`, `trackIntegrator` runs so the
return is bumpless, PV tracking applies, and the scan returns. `runInitman` treats a tracking
secondary like an open cascade: `loop.init = slave.mode !== 'CAS' || (slave.trk && slave.trk.on)`,
so the primary of a tracking secondary back-calculates instead of winding up. This closes the
LIC101 wind-up the tester saw beside D1. The module stays pure: it is told, it never decides.

3.2 **In plant-core, once per tick, before `pids()`.** `forcedOutputs()` derives the tracking set
from the same trip bits and run flags `VALVE_TARGET` in `src/models.js` already uses:

| Loop | Condition | Kind | Target | Reason text |
|---|---|---|---|---|
| FIC102 | `P.trips.rx` | interlock | 0 | `R-201 HI TEMP TRIP` |
| FIC102 | `!L.P101.run` (and no trip) | device | `l.safeop` (0 today) | `P-101 STOPPED` |
| FIC211 | `P.trips.batch` | interlock | 0 | `R-202 HI TEMP TRIP` |
| TIC213 | `P.trips.batch` | interlock | 0 | `R-202 HI TEMP TRIP` |
| TIC311 | `P.trips.bed` or `P.trips.skin` | interlock | 0 | `R-310 BED TRIP` or `R-310 SKIN TRIP` |

The reason text of an interlock row is the declared `src` and `cond` of its cause in
`src/cause-effect.js`, read at build time, so the flag can never name a trip differently from the
chart; the table above shows the intent, not literals. A test asserts that the interlock rows
equal the effect columns the matrix declares, so the matrix keeps declaring and `VALVE_TARGET`
keeps enforcing; `forcedOutputs()` reads the code's own trip flags, never the matrix.

3.3 **Operator writes.** An OP entry on a loop tracking by interlock is refused:
`ENTRY REJECTED — OUTPUT INTERLOCKED (R-201 HI TEMP TRIP)`, not journaled. On a loop tracking by
device feedback the operator owns OP in MAN (pre-positioning the valve before a restart stays
possible and drill D3 can teach it); in AUTO and CAS the entry path already refuses OP.

3.4 **Indication.** The faceplate and Point Detail show one flag beside the mode line, where
INITMAN shows today: `INTERLOCK · R-201 HI TEMP TRIP`, `TRACK · P-101 STOPPED`, or
`INITMAN · OP AT HI LIMIT` when a primary's back-calculated output sits at its limit. The
displayed OP is the tracked value, so OP equals the valve (D10).

3.5 **D8 is indication, not dynamics.** `runInitman` already back-calculates. The cascade map
`casMap.TIC202` commands TIC202 between 10 and 70 °C, so an operator setpoint of 75 pins TIC201 at
100 % and a return to CAS clamps the setpoint to 70. Changes: the `OP AT HI LIMIT` flag; Point
Detail's cascade row states the commandable range from the map (`casMap(0)` to `casMap(100)`);
a return to CAS that clamps the setpoint journals `SP CLAMPED TO CASCADE RANGE 70.0` and says so
in the message zone. Widening the map is a dynamics change and is logged to the intake doc.

3.6 **D9.** The Point Detail ladder labels PVHH and PVLL `pre-trip alarm` and adds a `trip` row
whose value comes from the W2 declaration for that source (185 °C for R-201 from
`src/cause-effect.js`), so the number can never disagree with the code. The drill debrief's
"trip avoided" line states the margin to the documented trip point.

---

## 4. Sequence ownership and HOLD (D3, D6)

4.1 **HOLD freezes.** In `sequence()` (`src/models.js`), while `b.held`: the phase timer does not
advance, no phase transition fires, CHARGE does not raise the level, DRAIN does not lower it.
Equipment goes to its hold state once, at the HOLD command in `seqCmd`: the feed setpoint
`L.FIC211.sp` is written to 0 there, next to the existing `SEQUENCE HELD — FEED STOPPED` record.
The jacket keeps holding temperature at its current setpoint. RESUME re-asserts the phase's
setpoints. The HOLD button reads RESUME while held.

4.2 **Ownership honest.** FIC211 and TIC212 carry `modeAttr: 'PROGRAM'` in every active phase
while not held, because the sequence writes their setpoints. On HOLD both go to `OPERATOR` on the
next scan and the sequence stops writing them until RESUME, so an operator setpoint during a hold
is honoured. This keeps the M202-trip advice and `tests/app-models.test.js` ("HOLD the sequence",
attribute `OPERATOR` on the next scan) as designed. Under PROGRAM an operator write is refused
with the existing mode-attribute message and nothing is journaled (D6's second half).

4.3 **Trips.** `P.trips.batch` keeps zeroing the feed and forcing MV211 and JV213; with §3 the
two loops show `INTERLOCK · R-202 HI TEMP TRIP` while it holds.

---

## 5. Journal and clock continuity (D4, D5)

5.1 **What wipes the journal today.** `applyPreset()` calls `initSim()`, which empties `events`,
`msgs`, `alarmLog`, resets `eid` to 1 and `t0`; runs the settle; takes a snapshot that carries
that fresh journal (`events`, `msgs`, `eid`, `alarmLog`, `t0` are snapshot keys); and restores it.

5.2 **Scope rule.** The journal belongs to the session, not to the process state. An IC load
lifts `events`, `msgs`, `alarmLog`, `eid` and `t0` out before `initSim()`, discards the settle's
internal entries, puts the session journal back after `restoreSnapshot()`, keeps `eid` counting,
and appends one record: `INITIAL CONDITION LOADED — <PRESET> (SETTLED <n> S)`. A canonical drill
start appends a trainee-visible `DRILL <id> STARTED — <name> — CANONICAL` record. KPI windows and
the bad-actor history survive. Trends (`hist`) reset with the IC: they are process data, and the
report did not ask otherwise. The instructor's own snapshot restore (ring and slots) keeps today's
semantics, a rewind of the journal to the snapshot's time, because replay and release gate 3
depend on it.

5.3 **The clock.** The jump is the settle: `p.run` seconds (120 s for the U1 presets, variable
for batch presets) advanced at the moment of the load. The settle ends at the base time instead
of starting there. `applyPreset(id, {baseTime})` runs a dry settle from time 0 to measure its
length for that preset and seed, then runs the real settle from `baseTime - length` so it ends
exactly at `baseTime`. Alarms raised during the settle land in the preceding minutes, like a
plant that was already running. The load stays a pure function of preset, seed and base time,
so replay and the `presetBaseT` receipt in the DRILL journal entry are unchanged.

5.4 **SIM label.** The status-bar clock reads `SIM hh:mm:ss` whenever the run control is frozen
or at a speed other than 1, computed from `state.speed` alone; no core code reads the wall clock.

---

## 6. Alarm timing, trip reset, and A5 (R2, R6)

6.1 **R2.** `almDelay(l)` is by point class today (flows 15 s, levels 60 s, else 0), which is
why LIC101's pre-trip alarm annunciated at 88 % and the trip beat the high-high. The policy becomes
priority-aware and is declared in one table: an Urgent limit gets at most 5 s on-delay regardless
of class; High keeps the class delay; Low and Journal are unchanged. The alarm philosophy already
cited (RESOURCES 2.9 and 2.5) carries the rationale. Alarm-sequence digests move for runs with
Urgent flow or level alarms (§11).

6.2 **R6, the enforced latch.** A tripped motor needs RESET before START.

- `motorCmd(tag, 'RESET')`: permitted only while `m.trip` and the cause has cleared, P-101 when
  `P.tankL >= 5` and no pump fault is active, M-202 when no agitator fault is active. It clears
  `m.trip`, journals `TRIP RESET`, and leaves the lockout timer alone.
- START while `m.trip`: refused with `START INHIBITED — TRIP NOT RESET`. The 30 s lockout after
  a trip and 15 s after a stop are unchanged.
- The faceplate shows a RESET button while tripped.
- `src/cause-effect.js` motor rows: `enforced: true`, `reset: {kind: 'operator-reset', ...}`,
  and their field-by-field tests update. `motorCmd` stops stamping `INTERLOCK.DEFEAT` because
  a defeat is no longer possible.

6.3 **A5 re-keyed.** Drill A5's gate moves from `INTERLOCK.DEFEAT` on `DRV-M202` to the lesson
its description already claims: a `MOTOR.RESET` or `MOTOR.START` on `DRV-M202` while the U2
controller domain is stale (the `CONTROLLER_LOSS` fault active on `CTRL-U2`, which the scorer,
being instructor-side, may read). A textbook restart after the cause has cleared stops being
penalised, which closes `docs/dev/A5-RESTART-SCORING-DEFECT.md`. The gate predicate is new to
`src/drill-arch.js` (gates were keyed on action type and target only); its test drives the real
fault path, not a hand-set `m.trip`, the gap that defect document names. Only A5's score fixture
moves; its physics digest does not.

---

## 7. HMI (D2, D11, D12, D13, U5, U7, U8, U10)

7.1 **D2.** Root cause: the entry field's ref callback in `renderVals()` calls `focus()` on every
render at 2 Hz, so any other input loses focus to a pending entry within half a second
(reproduced in the PR #8 review through the PIP ask box). New rule: focus once when an entry
opens; commit only on Enter inside the field; discard on blur, Escape, display change (`nav()`),
faceplate close, and Command-zone focus. One focus-once helper serves every auto-focused field,
including the alarm comment dialog (U8). Nothing is journaled unless committed.

7.2 **D12 and U7.** The Alarm Summary gets sortable column headers with an indicator and a
DEFAULT reset; the default order stays the engine's own (`E.compare`: unacknowledged first, then
priority). While the pointer is over the list the order is held; rows younger than 10 s are
highlighted. Selection stays by alarm id; the status line drops a selection whose alarm has
cleared.

7.3 **D13.** Message-zone text clears 20 s of sim time after `msgT` or on the next accepted
action (a stored entry, a mode change, an acknowledge, a shelve, a navigation, a logon),
whichever comes first.

7.4 **D11.** The asset label follows the displayed unit, read from the asset tree, not a string.

7.5 **U5.** A single click on a trend pen selects it; SIGNAL PATH is an explicit action on the
selected pen, the same entry the Point Detail already has.

7.6 **U10.** The unit graphic scales to fit its pane; tag text at 1280×800 goes from about 9 px
to at least 11 px, measured by the replay script. Every new indicator passes the WCAG AA gate
under both palettes.

---

## 8. PIP: grounded, concise, cloud-first (P1 to P10, P13)

Nothing in this section touches the deterministic core. Rule 7 holds: the page calls relative
`/api/coach/` paths only; `src/*.js` stays network-free.

8.1 **The projection says more, all of it trainee-visible.** `coachProjection()` in the page
and `tools/coach/projection.js` add: `motors` (tag, run, trip, cause, lockout seconds, last
command and its time), `batch` (phase, held, timer seconds, level), `trips` (source, condition,
active, since, threshold and unit from the W2 declaration), `clock` (station time string, speed,
sim label), `drill` for an armed D-series drill (id, name, start mode, never the injection time),
`tracking` (loop, kind, reason from §3), and each named point's alarm limits. Hidden instructor
truth stays out; the banned-token scrub stays.

8.2 **Board facts first.** `board_facts(ask, projection)` in `tools/coach/serve.py` answers
deterministically, before any model runs, the question kinds the playtest broke: is a motor
tripped, running or stopped; did a trip act; is an interlock active (the simulator has no bypass,
so "disabled" is never true); batch phase and hold; the highest-priority alarm, from the engine's
order as the projection carries it; the station time; the trip points; which drill is armed.
The facts go into the prompt as `BOARD FACTS (authoritative)` lines and stay in hand for 8.3.

8.3 **Every answer is verified before it is shown.** `verify_answer(text, facts, projection)`
extracts claims: a tag with a value and unit; a motor state; a trip or interlock state; a phase or
hold; the highest alarm; any claim of having acted (`is now in`, `I have set`, `OP is now`,
`interlock is disabled`). A contradicted core claim replaces the whole answer with the grounded
one built from the facts, one or two sentences. A wrong number or unit is corrected inline from
the board; more than two corrections replaces the answer. Unparseable text passes. Corrections
are counted in health and logged to stderr.

8.4 **Whole answers.** Both stream paths accumulate the text, trim it to the cap at the last full
sentence, verify it, and emit it as one `text` event followed by `done`; `think` still streams.
The client needs no new event type (PR #8's `replace` event is what its client threw on). The
cap error path becomes the trim, which also closes the defect `docs/dev/P2L-EXPANSION-SPEC.md`
§2.5 documented: a long correct answer is never discarded after streaming.

8.5 **Concise by construction.** `tools/coach/prompt.txt` voice section: two sentences, three at
most; fewer words; no preamble, no recap, no boilerplate "most useful check" sentence. Caps:
`TIP_WORDS` 70 → 40, `ASK_WORDS` 200 → 60, with the model's token budget tied to the cap. Tests
assert the word counts on the stub transcripts.

8.6 **Operator text is data.** The ask is delimited in the user turn as data and the role is
restated after it; the existing injection patterns are kept; 8.3's action and interlock rules
catch what gets through. Regression tests are built from the P7 and P8 transcripts.

8.7 **Scope, leaks, errors.** An ask with an out-of-scope cue (weather, sports, news, recipes and
the like) and no plant vocabulary gets a fixed one-line refusal without a model call (P9). A
prompt-leak ask gets a refusal, not an error (P10). "Cannot reach the local model" is said only
when the backend was unreachable; other failures say what failed and that LIVE DIAGNOSIS works.

8.8 **Cloud-first, honest fallback.** `COACH_PROVIDER=auto` already prefers the cloud when a
credential exists. The launcher and the README make the credential the recommended path and
point at CLOUDKEY at the station; the local model answers only without one. `/api/coach/health`
probes the active backend (Ollama's tag list, or the cloud credential) with a 10 s cache and
reports `backend` truthfully (P13). The panel shows model and provider and a one-line notice
when the lightweight local model is answering.

8.9 **Tests, zero dependencies.** `tools/coach/selftest.py` unit-tests `board_facts`,
`verify_answer`, the trim and the scope gate against a hand-authored fixture built from the PIP
report (`tests/fixtures/coach/playtest-pip-2026-10-02.json`: ask, board, the recorded bad answer,
the expected text); a node test runs it. `tests/coach-grounding.test.js` spawns `serve.py`
against the fake-Ollama pattern of `tests/coach-sidecar.test.js`, returning the recorded bad
answers, and asserts the emitted text and word counts.

---

## 9. Tests, goldens, browser replay, release gates

9.1 **Tests first.** Each defect gets a failing harness test before its fix:

| Item | Test asserts |
|---|---|
| D1 | pump stop: FIC102 tracks SAFEOP with `TRACK · P-101 STOPPED`; restart: max flow never above SPHILM 80; MAN OP honoured; flag cleared after restart |
| D3 | HOLD during CHARGE: phase, level and timer unchanged over 120 s; RESUME continues |
| D4 | journal count after a canonical start ≥ before + 1; event ids unique; `eid` continues |
| D5 | sim time after a canonical start equals base time plus the steps taken |
| D6 | PROGRAM in CHARGE; operator SP refused, not journaled; OPERATOR on hold; SP during hold held |
| D7 | TIC202 `pvObs` capped at the reporting window with UNCERTAIN quality when saturated, Good with its limit bit inside the band; `stepPid` reads it; TIC202's reporting window reproduced |
| D8 | `INITMAN · OP AT HI LIMIT` text; CAS return journals the clamp |
| D9 | ladder shows `pre-trip alarm` and a trip row equal to the W2 declaration |
| D10 | FIC102 OP equals 0 while the R-201 trip holds; OP entry refused |
| D11 to D14 | asset label per unit; sort order per column and default; message cleared after 20 s and after an accepted action; `fmt` never negative zero; flow cutoff |
| R2 | Urgent on-delay ≤ 5 s, class delays otherwise |
| R6 | START refused while latched; RESET refused while the cause holds and permitted after; matrix rows enforced |
| A5 | a restart after the cause cleared scores 100; a reset while CTRL-U2 is stale trips the gate; driven through the real fault path |
| U5, U7, U8 | state-level: pen selection; order held while hovered; dialog field focused |
| PIP | §8.9 |

9.2 **Goldens.** Movers only, after the final build of the stage, each named in the archive
guard with its reason. The nondeterminism checks in `tests/golden-*.test.js` stay.

9.3 **Browser replay, out-of-tree.** `~/experion-station-sim-verify/playtest-2026-10/`, one
Playwright script per browser-level repro: D2 through the Command zone and through the PIP ask
box, D11, D12, D13, U5, U7, U8, U10 (font size measured), D14 as displayed. Run against both
builds served locally before the release; the log and screenshots are filed to the chronicle as
the receipt. The repo gains no dependency.

9.4 **Gates per stage.** Suite 0-fail, build clean, smoke ok on both builds, goldens as §11, the
AA contrast gate green under both palettes, commit and push on the branch.

9.5 **Release.** Changelog entry, version strings, Mac build, movers re-captured, smoke, replay
receipt, tag 3.2.0, intake doc in place. Merge to main is Anthony's.

---

## 10. Stages for the plan

Strictly sequential; the page does not merge. Each stage ends green on the gates of 9.4.

| Stage | Sections | Delivers |
|---|---|---|
| S1 seams | 2, 3 | measurement policy generalised, `pvObs`, output tracking, flags, D7, D8, D9, D10, D14 model half, D1 |
| S2 sequence and journal | 4, 5 | HOLD, ownership, journal scope rule, settle ends at base time, SIM label, D3, D4, D5, D6 |
| S3 alarms and reset | 6 | on-delay policy, RESET, matrix rows, A5 re-key, R2, R6 |
| S4 HMI | 7 | D2, D11, D12, D13, U5, U7, U8, U10, D14 display half |
| S5 PIP | 8 | projection, facts, verifier, whole answers, caps, prompt, scope, health, launcher, README |
| S6 release | 1, 9 | intake doc, changelog, versions, goldens, replay receipt, 3.2.0 |

Execution follows `CLAUDE.md`: builder and verifier loops one tier below this seat, every stage
adversarially verified before its commit, never skipped.

---

## 11. Expected golden movers

Expected, to be measured by the build; the archive guard lists the actual set.

| Fixture | Moved by |
|---|---|
| upset-pump, drill-D3 | §3 FIC102 tracking (D1); §6.1 Urgent on-delay (R2) |
| drill-D11, upset-agit-batch, arch A5 physics | §4 ownership (D6) |
| arch A5 score | §6.3 gate re-key |
| upset-cool, drill-D4, upset-stick, any run where TIC202 reaches a window edge (saturates) | §2 saturation (D7) |
| runs with Urgent level alarms (overflow runs) | §6.1 (R2) |
| runs where an interlock in the §3.2 table holds a loop: the R-201 trip on FIC102 (upset-cool, drill-D4), the R-310 bed trip on TIC311 (drill-D12, upset-bedact), the R-202 trip on FIC211 and TIC213 | §3 interlock tracking (D10); measured at Task 6 (CR19) |
| every v2 fixture, every arch fixture, and the g2-lifecycle archived-run comparison | §2.2 low-flow cutoff on FIC211: its raw value is noise around 0 and the observed value is exactly 0, so the loop at zero setpoint stops dithering MV211; numeric-only moves, measured at Task 3 (controller ruling CR10, 2026-10-03) |

Nothing may move for a reason outside this table; a fixture that moves for another reason is a finding,
not a re-capture. Because the cutoff moves every fixture, the stage's closing task first archives the
3.1.0 fixtures (as of `1f0147e`) under `tests/fixtures/v31-baseline/`, and the archive guard compares the
live goldens against that baseline too, each S1 mover listed with its reasons, so "what moved since
3.1.0" stays answerable; the v2 archive is untouched (CR10).

---

## 12. Failure modes, fail safe

| Where | On failure |
|---|---|
| `forcedOutputs()` | a missing reason source means no tracking; a test pins it |
| measurement policy | anything non-finite maps to BAD as today; never throws |
| settle dry run | a non-finite state refuses the load with today's `SNAPSHOT REFUSED` |
| verifier | an internal error passes the text through with a stderr line; an answer is never lost |
| health probe | a timeout reports `backend: unknown`, never `up` |
| cloud path | the existing ladder: cloud refusal before answering falls back to the local model and says so |

---

## Appendix A — defect-to-mechanism map

| Item | Mechanism | Section |
|---|---|---|
| D1 | device-feedback tracking + primary INITMAN | 3 |
| D2 | focus-once, discard on leave | 7.1 |
| D3 | HOLD freezes; hold state written once | 4.1 |
| D4 | journal is session-scoped | 5.2 |
| D5 | settle ends at base time; SIM label | 5.3, 5.4 |
| D6 | PROGRAM while running, OPERATOR on hold | 4.2 |
| D7 | range policy, `pvObs`, crosshatch | 2 |
| D8 | limit indication, clamp journaled | 3.5 |
| D9 | ladder from the W2 declaration | 3.6 |
| D10 | interlock tracking, OP equals valve | 3.2 to 3.4 |
| D11 | asset label from the asset tree | 7.4 |
| D12, U7 | sortable, held while hovered, new-row highlight | 7.2 |
| D13 | message expiry and clear | 7.3 |
| D14 | low-flow cutoff, formatter | 2.2, 2.5 |
| R2 | priority-aware on-delay | 6.1 |
| R6, A5 | enforced latch, RESET, gate re-key | 6.2, 6.3 |
| U5 | pen click selects | 7.5 |
| U8 | focus-once helper | 7.1 |
| U10 | graphic scales to fit | 7.6 |
| P1, P2, P3, P4, P5, P6, P12 | board facts + verifier | 8.2, 8.3 |
| P7, P8 | data delimiting + action and interlock rules | 8.6, 8.3 |
| P9 | scope gate | 8.7 |
| P10 | trim, refusal, honest error text | 8.4, 8.7 |
| P13 | health probe | 8.8 |
