<!-- @artifact production -->
# Training model

What this simulator teaches, and how it decides a trainee has learned it.

This document is written for an instructor who needs to know whether this trains
their operators — not for a developer reading the code. It describes the two
drill curricula the simulator runs, the rubric and safety rule behind every
score, and the boundary between what a trainee is shown and what an instructor
can see. Every number below is read directly from the source that computes it
(`src/drill-arch.js`, `src/kpi.js`, `src/training.js`); none is estimated.

Every architecture surface in the simulator — the ARCH display, the SIGNAL PATH
action, the node inspector — carries a persistent banner: *"Conceptual training
architecture. Simulated; not a Honeywell diagnostic display."* That sentence is
not boilerplate. The topology, the fault catalogue and the twelve drills below
are this project's own teaching model of a distributed control system, built
from published standards and open literature (`docs/RESOURCES.md`), not a copy
of any vendor's product or any real facility's configuration. Point and display
*names* follow public convention where that helps a trainee transfer what they
learn here to a real console; nothing else is borrowed.

**What this document describes, as of this writing.** The architecture-drill
curriculum below — the twelve drills, the scoring rubric, the safety gate, and
the trainee/instructor projection split — is specified as data, as independently
unit-tested logic, and as a live trainee path. ARCH exposes Learn, Trace,
Diagnose and Debrief. A1 to A12 start from the Training Drills dialog
(`startADrillFromMenu`): the drill's `basePreset` loads, the fault timeline
arms, and the view opens in Diagnose. Evidence, pin-compare, hypothesis and
verify commands are Diagnose-only. Learn is hidden while an A-drill is running.
Completed A-drills use the same 20-entry training record
(`ESS.Training.addRecord`/`recordFor`) as the process drills, but carry only the
neutral trainee title until adjudication; the internal causal title remains an
instructor/debrief fact.

## Two curricula, not one

The simulator runs two families of drill, built and scored differently, and
neither replaces the other.

- **Eight legacy process drills** (`D1, D2, D3, D4, D6, D9, D11, D12`) train an
  operator to run the plant: recognise an abnormal condition, take the correct
  corrective action inside a time window, keep the unit from tripping, and
  stabilise it. They are graded by `ESS.Kpi.scoreDrill` against timers and flags
  the running simulator itself measures — how long an alarm sat unacknowledged,
  how long until the right action landed, whether anything tripped.
- **Twelve architecture drills, A1 to A12** (`src/drill-arch.js`) train an
  operator to reason about *why* an indication is bad — which layer of the
  control system actually failed — without destabilising the plant while they
  work it out. They are graded by `ESS.DrillArch.scoreDrill` against a journal
  of the trainee's own recorded actions: what they marked as evidence, what they
  compared, what failure domain they named, and whether they verified their own
  conclusion.

Both scorers enforce the same 80-point pass mark under the same label (see
*The pass mark*, below), and both return the same score/pass/breakdown shape
that `ESS.Training.addRecord` keeps in a 20-entry training record. Neither
scorer reads the other's inputs. An instructor can run both curricula in one
session and sees one consistent pass/fail line, built two different ways
depending on what the drill is actually testing.

## The twelve architecture drills

Each drill starts from a settled process condition (its `basePreset`), lets the
trainee stabilise, then injects one hidden fault at a fixed simulated time. The
trainee is never told what was injected — only what it looks like from the
board. What follows is what the drill is teaching and the specific hidden
condition behind it, both read from the drill's own data in
`src/drill-arch.js`.

| # | Title | What it teaches | Hidden condition |
|---|---|---|---|
| A1 | Frozen flow measurement | Tell a frozen/stuck reading from a genuine loss of flow; use valve position as independent evidence | FIC102's transmitter output freezes at its last value while the flow loop keeps calling for correction |
| A2 | Input channel failure | Tell a field-device fault from an I/O-path fault; use the field element's own diagnostics as the tie-breaker | FIC211's input channel reports bad quality while the field transmitter itself is fine |
| A3 | Bias with GOOD quality | GOOD quality is not proof of correctness; verify a slow bias independently | LIC101 develops a slow bias with no bad-quality flag ever raised |
| A4 | Redundancy switchover | Recognise a brief, self-correcting redundancy event; don't overreact to it | U3's primary controller fails over to standby; the process stays controlled throughout |
| A5 | Controller loss | Recognise a common-cause pattern — many points invalid together — and fix it one layer up, not loop by loop | U2's controller is lost; every control module it executes goes stale together |
| A6 | Single network path degradation | Tell degraded redundancy from total loss; show restraint when data stays fresh | One of U1's two redundant network paths degrades; the other keeps carrying live data |
| A7 | Communications partition | Tell a comms failure from a process upset; recognise the shared stale-data signature across a whole unit | Both of U3's redundant network paths are lost together; U3's points go stale as one pattern |
| A8 | Server / flex service loss | Tell a server (SERVICE) fault from a controller (CONTROL) fault; use the console profile as the tie-breaker | The data server degrades; the flex profile goes stale while the console profile (which bypasses it) stays correct |
| A9 | Local station failure | One HMI going dark is not a plant-wide event; tell it apart from the server fault it can resemble (A8) | The simulated peer station stops updating; the server and every controller stay healthy |
| A10 | Historian gap | Tell live control health from historical-data availability; a collection gap is an INFORMATION fault, not a CONTROL fault | History collection stops for an interval; live values and control are unaffected throughout |
| A11 | Assistant loss | The Ops Assistant is advisory, not load-bearing; operate normally without it | The Ops Assistant becomes unavailable mid-upset; indication and control are unaffected |
| A12 | Causal measurement bias | Trace a bad field measurement through the cascade controller to its process consequence | TIC201 biases low while R-201 is already running hot on high feed; the master controller raises the cascade demand, warming the jacket and real reactor relative to an unbiased run |

A1 through A11 each inject a single fault from one of the topology's seven
layers (FIELD, IO, CONTROL, NETWORK, SERVICE, HMI, INFORMATION). A12 is the
capstone: the same field-layer bias as A1/A3, but applied to the master of a
cascade. The biased-low TIC201 measurement makes the otherwise healthy master
raise TIC202's demand, which warms the jacket and real reactor relative to an
unbiased run. The trainee must distinguish the FIELD root cause from the
controller and process consequences it produces.

## How an architecture drill is scored

Every drill asks for the same diagnostic response: five recorded actions
across evidence, localization, verification and debrief, plus one of two
honest forms of stabilization evidence. A drill with a mapped process alarm
uses the accepted ACK. An architecture-only fault that leaves the process
stable uses **safe restraint** instead: stabilization credit appears only after
the trainee completes the whole diagnostic workflow without taking the drill's
major-unsafe action. The simulator does not synthesize an alarm just to make
the rubric reachable.

| Category | What it asks for | Default weight |
|---|---|---|
| Stabilize | Acknowledge a real mapped indication, or complete the diagnosis while safely restraining action | 30 |
| Evidence | Mark the primary point as evidence, then pin it side by side against a second, correlated point | 25 |
| Localization | Submit a **failure domain** — not a specific cause — as the hypothesis | 20 |
| Verification | Re-check the primary point after diagnosis to confirm the picture is resolved or understood | 15 |
| Debrief | Answer the debrief's cause-vs-symptom question correctly | 10 |

Three drills override these weights to match what they're actually testing: A5
(controller loss) shifts weight toward localization — 25 / 25 / **30** / 10 /
10 — because finding the one shared cause behind many stale points is the
whole point of that drill. A6 (single-path degradation) shifts weight toward
evidence — 20 / **30** / 25 / 15 / 10 — because checking *both* redundant
paths, not just the one the alarm points at, is what the drill is teaching. A9
(local station failure) shifts weight toward verification — 20 / 25 / 25 /
**20** / 10 — telling a station fault apart from the server fault it resembles
(A8) takes a confirming check. Every drill's weights still sum to 100.

Time is deliberately not a scored dimension here. None of these twelve drills
tests alarm-response urgency the way the legacy drills do, so giving time a
fabricated small weight would be dishonest; the honest weight is zero.
Assistant/AI latency never enters either scorer's clock.

Each recorded-action category's score is the fraction of its required actions
the trainee actually completed, matched against their own journal — not
against what they clicked, but against what the system accepted as having
happened. Evidence, for example, has two required actions and earns half its
weight when only one is complete. Safe restraint is necessarily outcome-based:
it earns its category only when the diagnostic workflow is complete and the
safety gate remains clear.

Scoring begins at an accepted `DRILL.FAULT_PRESENT` lifecycle receipt for that
drill. Pre-fault checklist actions remain part of the record but cannot earn
causal credit. Localization is one binding decision: the first accepted
post-onset hypothesis is the answer that is scored, so spraying every layer
cannot turn an early wrong answer into a later correct one. A pre-onset guess
does not lock out the first eligible post-onset decision. Crossing 80 is also
not sufficient by itself: every required action must be present before an
architecture run is labeled a pass. A 90-point run with its required debrief
missing is therefore incomplete, not passed.

## The safety gate

Every drill also defines its own single major-unsafe move — the one thing a
trainee could do that would make the exercise unsafe to run for real, even if
everything else about their diagnosis was right. If the trainee's journal shows
that move actually happening, the drill's score is capped below the 80-point
pass mark no matter how much category credit was otherwise earned. A trainee
who correctly identifies the failure domain, gathers every piece of evidence,
and still trips the gate does not pass.

**The gate is outcome-based.** It fires on what happened, not on what was
attempted and prevented. A trainee who reaches for the unsafe move and is
refused — the system declines the command — never trips the gate, because a
terminal penalty attaches to what actually happened in the simulated world,
not to what the trainee tried and the system stopped. Intent belongs in the
debrief, which informs the conversation afterward rather than punishing the
attempt itself. This is a deliberate architectural ruling, and it is the
reason the gate checks only *accepted* actions in the journal: a rejected
command was never applied to the plant, so it cannot be the thing the gate
exists to catch.

Every drill's gate is specific to the trap it sets, not a generic rule. Some
examples, in the drills' own words:

- **A1** — forcing FIC102 to MAN and driving the valve open from a frozen
  reading, without first checking whether the field element is even moving, is
  a MAN-and-abandon move on a measurement problem, not a flow problem.
- **A2** — taking FIC211 out of service to silence the bad-quality shed,
  instead of checking the field element first, defeats the very safeguard
  (SHEDHOLD) the drill is teaching the trainee to read.
- **A5** — defeating the M202 agitator interlock to force a restart while the
  whole U2 controller domain is stale treats a common-cause failure as a
  single-equipment problem — exactly the wrong localisation.
- **A12** — suppressing TIC201 because its indication conflicts with independent
  process evidence hides the symptom instead of locating and correcting the
  biased field measurement.

A gated score is capped, not zeroed: category credit for genuinely completed
work is not erased. The cap simply means the pass/fail line cannot be crossed
while the gate is armed — the score is held at 79 or below, whatever the raw
total would otherwise have been.

## Evidence over guessing

The scorer is built to reward the *process* of diagnosis, not a lucky guess at
the cause. Two things follow from that, and both are load-bearing for what the
drills actually teach:

**The localization category credits a failure domain, not a root cause.** A
trainee submits one of FIELD, IO, CONTROL, NETWORK, SERVICE, HMI or
INFORMATION as their hypothesis — never a specific fault name, tag, or "what
broke." This is deliberate: the simulator is teaching a trainee to narrow *where*
a problem lives fast enough to respond correctly, which is the operationally
useful skill. Naming the exact defective component is an engineering-team
follow-up, not an operator's job in the moment, and scoring it that way would
reward memorised pattern-matching over the reasoning the drill is actually
built to exercise.

**Evidence has to be recorded to count.** Looking at a point is not evidence;
marking it is. Every drill requires the trainee to explicitly mark their
primary point as evidence and then pin it side by side against a second,
correlated point before the evidence category credits anything. A trainee who
correctly diagnoses the fault without ever using the evidence tools gets no
credit for evidence gathered informally — the rubric cannot see it, because it
never happened as a recorded action.

**The scorer reads the journal, never the screen.** Every category, and the
safety gate itself, is graded against the same input: a sequence of recorded
actions (what was done, by whom, against what target, with what result). The
scorer never inspects what the display currently shows, what a trainee has
selected, or any other transient UI state. Score the same journal twice and
the result is identical, byte for byte, every time — nothing about the grade
depends on anything that isn't in the permanent record of what the trainee did.

## The eight legacy drills

Each process-operations drill is a single equipment or process upset with one
correct sequence of moves:

| # | Title | Teaches | Trainee action |
|---|---|---|---|
| D1 | Flow transmitter failure (FIC102) | Reading a SHEDHOLD response: the loop sheds to MAN and holds the last good output rather than chasing a bad reading | Acknowledge and confirm the shed behaviour |
| D2 | Feed surge — tank level rising | The first correct move on a rising level is more outlet flow, not shelving the alarm | Raise outlet flow (FIC102/LIC101 output) |
| D3 | Feed pump trip | The correct restart sequence: loop to MAN/OP 0, start the pump after lockout, then restore AUTO | Restart P-101 in the right order |
| D4 | Cooling water loss — exotherm | Cut feed to arrest a developing exotherm, then restore it before the tank reaches high level, confirming the reactor is cooling | Cut, then restore, reactor feed |
| D6 | Stuck coolant valve (stiction) | Recognising valve stiction — output moves, the process variable it drives does not | Take the loop to MAN and work around the stuck valve |
| D9 | Flash drum pressure high | A loop left in MAN by a previous shift will not respond no matter how the pressure trends | Return the loop to AUTO |
| D11 | Agitator trip during semi-batch feed (Unit 02) | Why restarting a tripped agitator immediately is dangerous: accumulated, unmixed monomer reacts all at once | Cut monomer feed and maximise cooling before any restart |
| D12 | Catalyst activity surge — bed overtemp (Unit 03) | Managing a runaway bed temperature at constant preheat before the 480 °C fuel trip | Raise quench flow and/or lower the preheater setpoint |

The drill dialog offers two explicit initial-condition contracts. **Canonical**
loads the drill's declared preset (and any declared setup, such as D9's
previous-shift MAN condition) before arming. **Live state** preserves the plant
exactly as it is and never manufactures that setup or starts a batch. The
chosen source and preset are retained through snapshot/replay; replay rebuilds
the canonical state before restoring the label so provenance cannot describe a
plant state that never existed.

D9 and D12 also define explicit no-alarm response horizons. A qualifying D9
AUTO recovery must remain safe for 180 simulated seconds; a qualifying D12
quench/preheat response must remain safe for 300. Only those declared drills
can complete proactively. Other drills cannot turn a quiet interval into
stabilization evidence, and a declared proactive run resets its horizon if its
own safety predicate stops being true.

These are graded by `ESS.Kpi.scoreDrill` against six weighted rows — time to
acknowledge (20), correct action and its latency (25), no trip on the drill's
own equipment (20), process stabilised (15), alarm load carried during the
drill (10), and the debrief question (10) — with a flat, capped deduction for
any *other* piece of equipment that trips along the way. This is a metrics
scorer: it reads timers and flags the running simulator itself measured (when
the alarm fired, when the right action landed, whether anything tripped), not
a recorded evidence trail. That's the right instrument for these drills — they
are testing response speed and correct procedure under a known-shape upset,
not diagnostic reasoning about which architectural layer failed.

The two scorers coexist without touching each other's inputs. Nothing in the
architecture drills' scoring reads the D-series metrics. An instructor can run
either family, or mix them in one session, and each result is graded on its own
terms.

## The pass mark

Both curricula enforce the same 80-point threshold. Architecture drills also
require every required action and a fault-present receipt; the threshold does
not substitute for completion. The wording actually shown
to a trainee or instructor today — in the drill debrief and the training-record
note, both driven by `ESS.Training.PASS_LABEL` — is:

> **80 % pass mark — independent training threshold, not a vendor
> certification.**

`src/kpi.js` and `src/drill-arch.js` each also carry their own pass-mark string
on their `scoreDrill()` return value, worded slightly differently from the one
above and from each other; neither is currently rendered anywhere in the app,
which always displays `ESS.Training.PASS_LABEL` regardless of which scorer
produced the result.

This is this project's own bar, chosen and documented independently of any
vendor operator-certification program (see `docs/RESOURCES.md` §2.12, on the
HAC program's own use of 80 %, which this threshold is deliberately consistent
with in form but not derived from). Passing a drill here is evidence that a
trainee reasoned correctly and safely through this simulator's own exercise.
It is not, and is never presented as, a substitute for any vendor's formal
operator certification.

## What a trainee sees, and what an instructor sees

The architecture drills only work as a diagnostic exercise if the trainee has
to actually diagnose something — so the simulator draws a hard line between
what a trainee-visible surface can show and what only the instructor's own
projection carries.

**A trainee sees evidence and explicitly graded drill cues, not a highlighted
root node.** Process indications, alarm behavior and independent comparisons
carry measured evidence. Effects that this simulator does not implement in its
process state are presented in a separate **SIMULATED ARCHITECTURE INDICATIONS —
DRILL CUE LANE, NOT PROCESS VALUES** panel. Those authored indications are
diagnostic exercise inputs; neither the UI nor PIP may promote them to measured
board facts. The
ARCH display and SIGNAL PATH view still provide the structural map, but while
an A-drill is live every topology node reports UNKNOWN: the exact node health
computed from the hidden fault is itself answer-key truth even when it contains
no literal fault id. In Diagnose mode the view also withholds the full
downstream blast radius of a selected node (it falls back to the one-hop
structural picture), because handing the trainee either the root marker or the
whole consequence path would remove the reasoning the drill exists to test.
Diagnose is reachable: the Training Drills dialog starts A1 to A12 in that
mode, and the ARCH mode chips offer it whenever Learn is not hidden.

**An instructor sees truth.** A separate, instructor-only projection of the
same underlying state carries the actual active fault: its id, its domain, its
target and its magnitude. This is the projection the Architecture panel and
the debrief timeline draw from when an instructor is reviewing a run.

**No trainee-visible surface ever carries a fault id, an internal target/node
identifier, a truth-backed root marker or root-cause text.** Observable
annunciator identities such as `U1 NETWORK PATH B` remain available when the
exercise requires comparing redundant members; they identify the indication,
not the hidden engine node or cause.
This isn't an interface convention that a busy afternoon could accidentally
violate — it is enforced at the application projection boundary. The view
module has no parameter through which a fault id, instance id or root-cause
string can arrive, and the live-drill caller replaces truth-derived per-node
health with a uniform UNKNOWN projection before building the trainee view. The red
failure marker and exact-node architecture timeline belong to the instructor's
own view and authorized replay. The live trainee Debrief mode is still
available for its required response, but it omits truth-backed architecture
rows; it cannot be used as an answer-key side channel.
