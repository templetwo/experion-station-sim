<!-- @artifact production -->
# Architecture

*What the v3 architecture-aware training model is, what it teaches, and how it is
built. Ships with the simulator; describes the simulator.*

## 0. This is a conceptual training model, not a vendor diagram

Say this first because everything below depends on it being believed: the layers,
paths, profiles and faults in this document describe a **teaching model**, invented
for this simulator, not a reproduction of any real distributed control system's
internal design. It is deliberately simplified so a trainee can reason about
*failure domains* — field vs. wiring vs. controller vs. network vs. server vs.
station vs. history/application — without needing to know how any particular
vendor's product is actually built inside.

Real installations differ, often substantially, from the picture drawn here. No
vendor topology, capacities, diagnostic codes, screenshots, or file/table
reproductions appear anywhere in this simulator. Where a display, parameter, or
mode name follows a real-world convention (a naming choice, not proprietary
content — see `docs/RESOURCES.md`), the *prose that explains it* is always the
project's own. Every training surface that renders this architecture carries a
persistent, literal banner:

> Conceptual training architecture. Simulated; not a Honeywell diagnostic display.

That banner is not decoration. Treat every claim below the same way: a model built
to teach diagnostic reasoning, not a claim about how any specific real system works.

## 1. The deterministic invariant

The core makes one promise, and the rest of this document — and the fault, drill
and replay systems built on top of it — depends on it holding exactly:

> given the same `ESS.MODEL_ID`, initial snapshot, PRNG state, fixed step sequence,
> and ordered command journal, the simulator produces the same scored outcome and
> materially identical state trajectory

Concretely, the deterministic core (simulation, control, alarming, topology,
fault, drill and scoring logic) never depends on any of the following:

- **wall-clock time.** No dynamical calculation reads the real clock. `initSim()`
  does call `Date.now()` once, to seed a *display* origin `P.t` — but every place
  `src/models.js` uses `P.t` dynamically is a difference against a fault timestamp
  itself taken from `P.t` (a stored `P.t - P.faultT.<x>`), so the origin cancels
  out of every calculation that matters. This is verified, not assumed: running
  the same seeded scenario from two different `now` values is required to produce
  an identical trajectory.
- **uncontrolled `Math.random()`.** The only randomness source is
  `ESS.Models.createRand(seed)`, a seeded generator (mulberry32) exposing
  `getState()`/`setState()`, wired once in `initSim()` as `this.rand`. Snapshots
  carry `seed` and the generator's `randState` alongside process, control and
  alarm state, so a run, a snapshot, and a replay from that snapshot all reproduce
  the same trajectory. A small number of `Math.random()` fallbacks exist in the
  core for the case where no seeded generator was supplied; the app always
  supplies one, so they are unreached in normal operation and must stay that way.
- **network or model timing.** Nothing in the deterministic core issues a fetch, opens
  a socket, or waits on an external service or an AI model. Any future networked
  or model-backed capability (Section 12 of the v3 plan) is deliberately kept
  outside this boundary: it may observe a read-only projection and propose a
  command, never mutate state directly or gate a simulation step on a response.

**`ESS.MODEL_ID`** is the invariant's other fixed input: a hash computed once at
build time (`tools/stamp-model-id.py`) over the application page plus every
`src/*.js` module, exposed identically to both shipping artifacts as
`ESS.MODEL_ID`. It is a **provenance** stamp — it tells you which build produced a
trajectory — not a semantic version number to compare across builds. The invariant
is a promise about one fixed `MODEL_ID`; it says nothing about whether two
different builds must agree.

Everything downstream — the fault engine's composable transforms, the drill
scorer, and instructor snapshot/backtrack/replay — is only as trustworthy as this
invariant. An instructor who restores a snapshot and replays the same journal must
get back the same causal sequence, the same alarms, and the same score, every
time.

## 2. The seven-layer conceptual architecture

The model organizes everything a trainee can see or fail into seven layers, read
in the direction a measurement travels from the physical process to the trainee:

```
FIELD -> IO -> CONTROL -> NETWORK -> SERVICE -> HMI -> INFORMATION
```

| Layer | Teaches | What lives there |
|---|---|---|
| **FIELD** | The physical process and its instruments | Transmitters and final control elements (valves), plus motor/drive field devices |
| **IO** | The wiring between field and controller | Input channels (measurement) and output channels (command) |
| **CONTROL** | Where control decisions are made | Controllers, their control-execution environments (CEE), the control modules (CM) that hold each point, and sequence control modules (SCM) that drive batch phasing |
| **NETWORK** | How control data reaches the rest of the system | A pair of redundant network paths per unit |
| **SERVICE** | Shared server-side processing | Alarm/event service, data server (caches process data for the flex profile), history collection |
| **HMI** | Where a human looks | The one physical station, presented as two view profiles (Section 4) |
| **INFORMATION** | Stored and advisory information | Process history and the rule-based Ops Assistant |

A trainee who starts at "this reading looks wrong" is being taught to ask, in
order: is the *field device* lying, is it the *wiring*, is the *controller*
computing correctly, is the *network* carrying it, is a *shared service*
corrupting or hiding it, is it only this *station*, or is it only the
*information/history* layer that is broken while everything upstream is fine? That
question — which layer owns the failure — is the entire pedagogical point of the
model; see Section 5.

Two rendering modes exist so a trainee is never taught a single mandatory pipeline
as "the" architecture: a **beginner** rendering shows the layers as one simple
left-to-right progression, and an **advanced** rendering exposes the real branch
points — the split at the HMI layer between the console and flex profiles, and the
separate alarm and history legs that peel off from the control/network trunk
rather than running through it.

## 3. Four path types

Every point in the system can be asked about along up to four independent paths,
because a single tag genuinely has up to four different chains of things that can
break it:

| Path | What it traces |
|---|---|
| **measurement** | process condition → transmitter → input channel → control module → network → the station or service that displays it |
| **command** | control module → output channel → actuator (valve or motor) that the module drives |
| **alarm** | control module → the alarm/event service → the station's annunciation and event history |
| **history** | control module → the history-collection service → stored samples → trend read-back at a station |

Not every point resolves every path — only points that actually drive a valve or
motor (declared, see Section 6) resolve a command path — but every point resolves
at least a measurement path, which is the graph contract's one universal
requirement.

The four paths are not four independent graphs; they share their upstream trunk
(a point's control module, in particular) and diverge only where they genuinely
diverge — the alarm and history legs peel off toward their own service, and the
command leg runs the opposite direction, toward an actuator rather than toward a
consumer. See Section 7 for why command runs opposite the other three.

## 4. Station profiles: one physical station, two views

The simulator models exactly **one** physical operator station. Historically, a
console-type station reads process data directly on the controller/network path,
while a flex-type station reads a copy cached by a shared data server — two
different sets of things that can go wrong with the same displayed value. Rather
than build and maintain two full simulated stations to teach that distinction, the
simulator represents **console** and **flex** as two *view profiles* selectable on
its one station.

This is stated honestly everywhere the distinction matters, in the node text
itself:

> This simulator has ONE physical station; console and flex are modelled as view
> profiles on it, not as two machines.

Choosing a profile changes only the last leg of a resolved measurement, alarm, or
history path (Section 3) — the trunk from field through the control module is
identical regardless of profile; only the final hop into the station differs. Drills
that need a *second* station (peer-station-down scenarios) use a simulated Station
Health panel showing the other profile's status rather than a second modelled
machine — the same "represent the concept, don't duplicate the plant" choice.

The training payoff of the split: a data-server fault blinds the flex profile
while the console profile, reading the controller directly, stays correct — the
"is it the server or the controller?" diagnostic distinction a trainee has to
learn to make. Conversely, control itself can be perfectly healthy while a shared
service degrades one view of it. Neither profile is more "real" than the other;
they are two lenses onto the same one station.

## 5. Cause versus symptom: the spine of the whole feature

Everything in Sections 2 through 4 exists to support one distinction, and every
fault and every scored drill is built to test it: **where a failure happens is not
where its symptoms show up, and a trainee has to reason from the second to the
first.**

Concretely, drawn from the fault model's own domain boundaries:

- A **FIELD**-layer fault (a biased or frozen transmitter) can wreck a control
  response — the loop chases a wrong measurement, downstream alarms fire — while
  every IO, control, network, and server node reports perfectly healthy. Worse,
  it can do this with the point's quality flag still reporting GOOD: quality is
  evidence, not proof.
- A **SERVICE**-layer fault (the data server degrading) blinds only the flex
  profile while the console profile and the control layer underneath both stay
  correct — a server problem that looks, from the flex station, exactly like
  everything downstream of it failed.
- A single degraded **NETWORK** path shows up as degraded redundancy, with data
  still flowing on the surviving path — not a process outage, and not something a
  trainee should react to as one.
- An **INFORMATION**-layer fault (a historian gap, or the Ops Assistant going
  unavailable) leaves live values and control completely correct; only trends and
  advisory support are affected.

The engine that enforces this separation keeps two projections over the same
underlying state, never two copies of it: a **trainee projection** exposing only
observable symptoms and generic, health-derived language, and an **instructor
(truth) projection** exposing the actual fault, its domain and its target. The
trainee projection is constructed so that it is structurally incapable of
containing the instructor-only truth — not merely filtered at render time — which
is what the leakage tests in the v3 suite exist to keep proven across every drill.
Diagnose mode goes one step further and withholds even the full blast-radius
answer (Section 7) for the node the trainee is inspecting, because handing over
"everything downstream of this" would hand over the shortcut the drill exists to
test.

Scoring follows the same spine: a drill rewards keeping the process safe and
gathering evidence toward the correct failure *domain*, over merely guessing the
right answer, and a safety gate caps the score of any exercise where the trainee
takes a major-unsafe action regardless of whether they were right.

## 6. The graph is derived, not authored

The FIELD and CONTROL layers of the topology graph are **not** hand-drawn. They
are computed from the tag database (`this.L`, 24 points as of this build) and the
valve table (`this.V`, 10 valves) the simulator already maintains for every other
purpose:

- **Every point in `L` declares its own control module** in a `cm` field (for
  example `LIC101` carries `cm: 'CM1_LIC101'`) — the CONTROL-layer `CM` node for
  that point, and the point's edges into it, are read off this field, not
  independently authored.
- **Every point's `kind`** (`pid`, `ind`, or `motor`) selects whether the FIELD
  node built for it is a `TRANSMITTER` or a `MOTOR`, and whether it gets a
  command leg to a motor's start/stop channel.
- **Every point's `alm` map** (its configured alarm conditions — `PVLL`, `PVLO`,
  `PVHI`, `PVHH`, and so on) is read directly to produce that point's set of
  ALARM-semantic edges into the alarm service — one edge per configured
  condition, no more and no fewer than the point actually has configured.
- **Every valve in `V` declares its fail-safe direction** in a `fail` field, which
  becomes the training text on that valve's FIELD node (its fail-safe position on
  loss of instrument air).

This was a deliberate build choice, not an oversight: **a derived graph cannot
drift from the tag database it describes. A hand-authored one silently will**, and
the first person to notice would be a trainee being taught something false about a
point that had since changed underneath the graph. Only what genuinely is *not*
present in the tag database is declared directly — I/O channels, controllers and
their execution environments, network paths, server services, the station
profiles, and history/application nodes, along with the one mapping the tag
database has no field for at all: which control module strokes which valve (that
coupling lives in the process equations, not in either table, so it is declared
and cross-checked against both).

The measured shape of the graph this produces, as of this release: 24 points
produce 114 topology nodes and 247 edges, spanning all seven layers and all four
path types, with zero graph-contract violations (`ESS.Topology.validate()` returns
an empty problem list against the live tag database).

## 7. Edge direction and blast radius

Every edge in the topology graph points **from a thing to the things that break if
it fails.** That single rule, applied consistently, is what makes "what does this
failure affect" a plain forward walk of the graph rather than a bespoke
calculation per node — which is exactly what `blastRadius()` does: it walks
forward from a node through every edge that starts there, following the same walk
transitively, and collects every node (and therefore every point) reached along
the way.

This is *not* the same rule as "every edge points up the layer stack." Most edges
do run upward — a measurement's failure at the transmitter breaks everything from
the input channel up through the network, the service, and the station that
displays it, which is the same direction the measurement itself travels. But a
**command** edge runs the opposite way: from the control module toward the output
channel toward the actuator, because a control module that fails breaks the valve
or motor it commands, not the other way around — the actuator depends on the
module, even though in dataflow terms the module's demand travels *down* to the
actuator. Both cases obey the one real rule (edge points toward what depends on
it); only their layer direction differs, because command dataflow itself runs
opposite to measurement dataflow. The graph's own validity check enforces this
directly: a `COMMAND` edge is rejected if it runs up the layer stack, and every
other semantic except `HISTORY` and `CONFIG` (a store-and-retrieve leg, and a
layer-internal hosting relationship, respectively — neither is a one-way
progression) is rejected if it runs down.

Practically, this is what a trainee in Learn mode sees when they select a node and
ask "what does this affect": the transitive set of everything downstream, by this
one consistent rule, regardless of which layer or path type it belongs to. It is
also what Diagnose mode deliberately withholds for the node under inspection
(Section 5) — the same computation, available to Learn, held back where handing it
over would be handing over the answer.

## 8. Where this lives in code

For a maintainer who needs to change any of the above: the graph itself is built
and validated in `src/topology.js` (Sections 6 and 7 above describe its actual
behavior, not the plan that preceded it). Per-point, per-profile path resolution —
the profile leg described in Section 4 — is `src/signal-path.js`. The cause/symptom
split (Section 5) is enforced in `src/fault-engine.js`, whose two projections read
the same fault state without ever branching on the instructor-only marker to do
it. The render-ready view for the trainee-facing ARCH display, including the mode
gating that governs what Diagnose mode withholds, is `src/architecture-view-model.js`.
None of these four modules require one another at the file level — every src
module is a plain `<script>` global in both shipping artifacts, not something a
`require()` would survive in the browser — so each communicates with its
neighbors only through plain data shaped like the graph and projections described
here, never through a shared object reference.
