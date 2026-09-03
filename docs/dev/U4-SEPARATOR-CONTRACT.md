<!-- @artifact dev -->
# Unit 04 — two-chamber weir separator V-502: the build contract

**Status:** architect's contract, 2026-09-03, MacBook seat (claude-fable-5-1). Anthony's ask,
verbatim: "add 2 chamber separators with setable depth wall". Confirmed reading: a horizontal
separator split by an internal weir plate into two chambers; the mixed liquid enters the first
chamber, water settles and is drawn from its bottom, the lighter hydrocarbon overflows the weir
into the second chamber where its level is controlled to the product draw; the weir height is
adjustable live, not fixed at build time. This is the first cut of Stage 2 in
`docs/dev/P2L-EXPANSION-SPEC.md` §3–§5, with the recycle loop and purge deliberately left for a
later cut (they couple back into R-310 and force the golden re-capture that waits on §10 Q2).

Every builder reads this whole file before writing a line. The names below are the contract;
nobody renames anything. Hard rules 1–7 of `docs/dev/UPGRADE-PLAN.md` and `V3-PLAN.md` §1 hold.

## 0. Two rules that make this unit additive

1. **The v2 goldens do not move.** `tests/_fixture.js` `endState()` / `alarmSequence()` are scoped
   to the **v2 universe** — the 24 points, 10 valves, and the alarm/event sources that existed
   before Unit 04 — so `tests/golden-upsets.test.js`, `tests/golden-drills.test.js` and the
   A-drill fixtures stay byte-identical. Unit 04 gets its own golden file. Nothing in `stepU1`,
   `stepU2`, `stepU3` or their parameters changes.
2. **Unit 04 never draws from the shared random stream.** Its measurement noise comes from a
   second seeded generator, `ctx.rand4` (`ESS.Models.createRand(seed ^ 0x5eed4)` in the app,
   snapshotted as `randState4`, restored with `randState`). When `ctx.rand4` is absent (module
   tests that build their own ctx), Unit 04 noise is **zero** — it must never touch `ctx.rand`
   and never fall back to `Math.random`.

## 1. Process (our own prose; generic textbook unit operation)

Unit 03 effluent — finished hydrocarbon liquid, the water the hydrofinishing made, and a little
light gas — is cooled in **E-502** (trim cooler on cooling water, `TIC502` → `TV-502`) and enters
**V-502**, a horizontal three-phase separator with a weir plate. In the **first chamber** the water
settles under the oil and is drawn from the bottom on interface control (`LIC504` → `WV-504`);
the oil overflows the **weir** into the **second chamber**, whose level is controlled to the
product draw (`LIC503` → `LV-503`). Gas leaves overhead on pressure control (`PIC505` →
`PV-505`). **The weir height is settable** (instructor plant variable `weirH`, per cent of vessel
height, default 55, range 30–90): it fixes how deep the oil layer sits over the interface in the
first chamber, so it sets the interface control window and the carry-over behaviour.

Failure modes the unit must reproduce, each visible on the board:
- **Interface too high** (near the weir crest): water goes over the weir with the oil → `AI509`
  (water in the oil draw) rises → product off-spec. Quiet on the separator, loud downstream.
- **Interface too low** (thin water layer): the water draw pulls oil → `AI510` (oil in the water
  draw) rises → a process-water excursion. Environmental, does not alarm hard.
- **Weir raised live**: the first chamber fills to the new crest before overflow resumes; the
  second chamber starves and `LIC503` closes `LV-503` — a product interruption the operator did
  not cause with any valve. **Weir lowered live**: the oil layer dumps over, `LIC503` swings.
- **Inlet too warm** (`TIC502` high): more vapour and less condensed water — pressure rises on
  `PIC505` and less water reaches the boot.
- **Pressure**: `PV-505` failed or PIC505 in MAN → `PIC505` rises → PSV-502 lifts at 1100 kPa.

## 2. Tag database (add to `initSim()` in the page; ranges/alarms are the contract)

| tag | kind | desc | eu | lo–hi | pv / sp / op | act / tuning | alarms `[value, prio]` | cm |
|---|---|---|---|---|---|---|---|---|
| TIC502 | pid | `E-502 SEPARATOR INLET TEMP` | DEG C | 0–200 | 45 / 45 / 60 | DIR, K 1.2, T1 2.0, T2 0.2, sphilm 90, splolm 25 | PVLO 30 Low · PVHI 60 High · PVHH 80 Urgent | CM20_TIC502 |
| LIC503 | pid | `V-502 OIL CHAMBER LEVEL` | % | 0–100 | 50 / 50 / 50 | DIR, K 1.2, T1 2.5, sphilm 85, splolm 15 | PVLL 10 Urgent · PVLO 25 Low · PVHI 75 High · PVHH 90 Urgent | CM21_LIC503 |
| LIC504 | pid | `V-502 WATER INTERFACE LEVEL` | % | 0–100 | 25 / 25 / 45 | DIR, K 1.5, T1 3.0, sphilm 45, splolm 8 | PVLL 5 Urgent · PVLO 12 Low · PVHI 40 High · PVHH 48 Urgent | CM22_LIC504 |
| PIC505 | pid | `V-502 SEPARATOR PRESSURE` | KPA | 0–1500 | 800 / 800 / 40 | DIR, K 0.8, T1 0.8, dec 0, sphilm 1000, splolm 500 | PVLL 400 Urgent · PVLO 600 Low · PVHI 950 High · PVHH 1050 Urgent | CM23_PIC505 |
| AI509 | ind | `V-502 WATER IN OIL DRAW` | % | 0–20 | 0.3 | dec 2, tgtLo 0, tgtHi 1 | PVHI 2 High · PVHH 5 Urgent | CM24_AI509 |
| AI510 | ind | `V-502 OIL IN WATER DRAW` | % | 0–20 | 0.2 | dec 2, tgtLo 0, tgtHi 1 | PVHI 2 High | CM25_AI510 |

Point-shape conventions are the existing ones (`P({...})` for pid, the literal object for `ind`
with `_as:{}`; see `initSim`). Equipment (not points, but alarm sources and asset ids):
`V-502` (PSV-502 lift), `E-502`. Every new alarm needs an authored `src/alarm-help.js` entry
(`tests/alarm-help-coverage.test.js` derives the inventory and fails otherwise).

Valves (`this.V` in the page, `VALVE_TARGET` in models, `VALVE_OF` in topology — all three, or
`tests/models-valves.test.js` fails): `TV502 {pos:.6, fail:1}` (cooling water fails open — safe),
`LV503 {pos:.5, fail:0}`, `WV504 {pos:.45, fail:0}`, `PV505 {pos:.4, fail:1}` (vents on air loss).

`Topology.UNITS` gains `'U4'`; `VALVE_OF` gains `TIC502:'TV502', LIC503:'LV503', LIC504:'WV504',
PIC505:'PV505'`; the app's `unitOf()` gains the U4 list `['TIC502','LIC503','LIC504','PIC505',
'AI509','AI510','V-502','E-502']`. Asset tree: `U4 · UNIT 04 SEPARATION` with children
`E-502` (tags TIC502) and `V-502` (tags LIC503, LIC504, PIC505, AI509, AI510, V-502).

## 3. Physics (`src/models.js`; builder 1)

State `P.s` (created in `createState`, snapshotted for free because it lives in `P`):
```
s: { Tin: 45,  hw: 25,  ho: 30,  h2: 50,  pres: 800,  qover: 0,  wcarry: 0,  ocarry: 0 }
```
`hw` water interface height in chamber 1 (% of vessel), `ho` oil layer thickness above it,
`h2` oil level in chamber 2, `pres` kPa, `Tin` °C. Total chamber-1 liquid `h1 = hw + ho`.

`PARAMS.U4` (all values are this simulator's own; calibrated so that the design point —
FIC310 at 40 m³/h, `weirH` 55, all loops on setpoint — is a steady state with `hw` 25, `h2` 50,
`pres` 800, `Tin` 45, `AI509` ≈ 0.3, `AI510` ≈ 0.2):
```
waterFrac 0.15   // water made per m3 of U3 feed at full activity (HDO stoichiometry, scaled)
gasFrac   0.004  // light gas made per m3 of feed at 45 C, kmol-equivalent scaled to kPa/s below
A1 0.30, A2 0.18 // chamber areas, m3 per % of height (chamber 1 wider)
Cweir 6.0        // overflow coefficient: q_over = Cweir * max(0, h1 - W)^1.5   (Francis form)
Cw 30, Cp 45     // water and product draw capacities, m3/h at full valve and 50 % head
carryBand 10     // water starts going over the weir when hw > W - carryBand (% of height)
thinBand 8       // oil goes out the water draw when hw < thinBand
kP 0.9           // kPa per (m3/h gas imbalance) per second
Cg 12            // vent capacity, m3/h at full valve and design dP
Pdown 100        // off-gas header pressure, kPa
Thot 0.5         // inlet temp = Thot*(h.pre + h.bed)/2 ... cooled by TV-502: see below
coolK 220        // C of cooling at full TV-502
tauT 45, tauL 4  // temperature lag s, level lag s
psvSet 1100, psvReset 1000
```
Equations, per step of `dt` seconds (all flows in m³/h, convert with /3600 where a level integrates):
- `qfeed = P.h.f` (Unit 03 fresh feed, m³/h). `act = envOf(P).catAct * (P.faults.bedact ? magOf(P).bedact : 1)` (the same activity Unit 03 uses; **read only**).
- `qw_in = qfeed * waterFrac * act`, `qo_in = qfeed - qw_in`.
- `Thot = 0.5*(P.h.pre + P.h.bed)`; `TinSS = max(30, Thot - coolK * V.TV502.pos)`; `s.Tin = lag(s.Tin, TinSS, tauT, dt)`. (At design pre 320 / bed 378 → Thot 349; TV502 0.6 → 349 − 132 = 217 → **wrong**: calibrate `coolK` so that TV502 at 0.6 gives 45: `coolK = (349 − 45)/0.6 ≈ 507`. Builder: set `coolK 507` and state the calibration in the comment.)
- Water carry-over (interface too high): `s.wcarry = qw_in * clamp((s.hw - (W - carryBand)) / carryBand, 0, 1)` where `W = envOf(P).weirH`.
- Water draw: `qw_out = Cw * V.WV504.pos * sqrt(max(s.hw, 0) / 50)`.
- Oil carry-under (interface too low): `s.ocarry = qw_out * clamp((thinBand - s.hw) / thinBand, 0, 1)`.
- Weir overflow: `h1 = s.hw + s.ho`; `s.qover = Cweir * max(0, h1 - W) ** 1.5`.
- `d hw = (qw_in - s.wcarry - qw_out) / A1 / 3600 * dt`; `d ho = (qo_in - s.ocarry - s.qover) / A1 / 3600 * dt`; both clamped to [0, 100] and `s.ho ≥ 0`.
- Product draw: `qp = Cp * V.LV503.pos * sqrt(max(s.h2, 0) / 50)`; `d h2 = (s.qover + s.wcarry - qp) / A2 / 3600 * dt`, clamped.
- Gas: `qg_in = qfeed * gasFrac * (1 + max(0, s.Tin - 45) / 40) * 3600 /* m3/h gas-equivalent */`; `qg_out = Cg * V.PV505.pos * sqrt(max(s.pres - Pdown, 0) / 700)`; `d pres = kP * (qg_in - qg_out) * dt`, clamped [0, 1500]. Builder calibrates `gasFrac`/`Cg` so design is steady at 800 kPa with PV505 at 0.4.
- PSV: `if (s.pres >= psvSet && !P.trips.psv502) { P.trips.psv502 = true; raiseTrip(ctx, 'V-502', 'PSV LIFT', s.pres, 'KPA', 'SEPARATOR RELIEF — VENTING TO FLARE'); }`; while lifted the vent adds `Cg * 1.5`; reset below `psvReset` with `ctx.clear('V-502','PSV LIFT')`.
- Measurements (`measureU4(P, L, n4)`): `TIC502.pv = s.Tin + n4(0.3)`, `LIC503.pv = s.h2 + n4(0.2)`, `LIC504.pv = s.hw + n4(0.2)`, `PIC505.pv = s.pres + n4(2)`, `AI509.pv = 100 * s.wcarry / max(s.qover + s.wcarry, 0.01)` blended with a 0.3 % floor and lagged 30 s, `AI510.pv = 100 * s.ocarry / max(qw_out, 0.01)` with a 0.2 % floor, lagged 30 s. `n4` is `noise(ctx.rand4)` or a zero function when `ctx.rand4` is absent (rule 0.2).
- `stepU4(P, L, V, dt, ctx)`: `moveValves` already strokes the four new valves through `VALVE_TARGET` — add `TV502: (P,L)=>L.TIC502.op/100, LV503: (P,L)=>L.LIC503.op/100, WV504: (P,L)=>L.LIC504.op/100, PV505: (P,L)=>L.PIC505.op/100`. `step()` calls `stepU4` **after** `stepU3`. Export `stepU4`.
- **Air loss** (`P.faults.air`) already drives every valve to its `fail` position through `moveValves`; nothing extra.

Provenance: register **`### 4.12`** in `docs/RESOURCES.md` **before** writing the physics
(standing ruling, V3-PLAN §11 gate 5): textbook bucket-and-weir three-phase separator design
(Arnold & Stewart, *Surface Production Operations*, vol. 1, Gulf Professional; cite by name),
API Specification 12J *Oil and Gas Separators* (retention time and sizing basis; cite by name,
reproduce nothing), and the Francis weir formula (open-channel hydraulics, public domain). Cite
in code comments as `RESOURCES 4.12`. Every equation above is a training-fidelity correlation of
that shape, not a property package: the header comment says so, and lists what is invented
(`carryBand`, `thinBand`, `gasFrac`, `kP`, the 30 s analyser lag).

Tests (`tests/models-u4.test.js`, builder 1): design point is steady (30 min, every U4 state
within 1 % of its design value, no alarms); raising `weirH` from 55 to 70 starves chamber 2 and
`h2` falls until overflow resumes; lowering to 40 dumps oil into chamber 2; interface driven to
50 % (WV504 closed in MAN) makes `AI509` exceed 2 %; interface driven below 8 % makes `AI510`
exceed 2 %; `TIC502` at 80 °C raises pressure; PV505 closed lifts the PSV at 1100 and it resets
below 1000; with `ctx.rand4` absent two runs are bit-identical and `ctx.rand` is never called
(spy); with `ctx.rand4` present U1–U3 states are bit-identical to a run without U4 noise.

## 4. Prose (builder 2)

- `src/alarm-help.js`: one entry per condition in §2 plus `V-502.PSV LIFT` in `EQUIPMENT_TRIPS`
  (`{value: 1100, eu: 'KPA', prio: 'Urgent'}`) and its TABLE entry. Consequence / probable cause /
  corrective action must be the model's (§3): e.g. LIC504.PVHH is water over the weir into the
  product (AI509 rises), not "tank overflow"; LIC504.PVLL is oil to process water (AI510);
  TIC502.PVHI is less condensed water and more vapour (PIC505 rises); PIC505.PVHH names PSV-502
  at 1100; LIC503.PVLL names the weir: "chamber 2 starves when the weir is raised or the first
  chamber is below the crest — check weirH before blaming LV-503". Response-time bands as the
  existing file uses them. **Fail-safe directions must match §2**: TV-502 and PV-505 fail open,
  LV-503 and WV-504 fail closed.
- `src/process.js`: a `UNIT FOUR SEPARATION` section (heading ALL-CAPS letters and spaces,
  under 40 characters), inserted after UNIT THREE and before UNIT TWO's off-train note stays
  where it is; add `UNIT 04  separation` to THE ROUTE; every tag named goes into `TAGS_NAMED`
  (the gate `tests/process-text.test.js` enforces it); numbers must match §2 (the gate checks
  them). Say what the weir does, the two interface failure modes, the "raise the weir and
  chamber 2 starves" trap, and that separation is gravity settling with a declared correlation.
  Rewrite WHAT IS NOT SIMULATED: the separator now exists; still absent are the recycle gas
  compressor, make-up hydrogen, purge and the stabiliser; no property package or flash solver;
  the carry-over curve shape is invented and the settling criterion is by name.
- `src/instructor.js` `variableDefs()`: add `{ id: 'weirH', label: 'V-502 weir height', path: 'env.weirH', eu: '%', min: 30, max: 90, def: 55 }` in the file's existing shape (read it), and `envDefaults()` in `src/models.js` gains `weirH: 55` (builder 1 owns models.js: builder 2 states the need, builder 1 adds it — coordinate through the contract, not the file).
- `tools/coach/serve.py`: `_UNIT_SECTION['U4'] = 'UNIT FOUR SEPARATION'`; `tools/coach/guide.txt`
  gains a `U4:` line in the existing style (tags and equipment only).

## 5. Page and gates (single writer: the integrating seat)

Tag database, `this.V`, `unitOf`, `pidOrder` (append the four loops **after** the existing
thirteen — order is part of determinism), `histTags`, `valveMap` **and** its duplicate literal in
`diagnose()`, `assetTree`, `builtinViews`, `trackerLanes`, `TGS` (`TG06 · SEPARATION`: LIC503 pv,
LIC504 pv, PIC505 pv, AI509 pv), `utabs` (`UNIT 04 · SEPARATION`), the View menu, `sysLinks`,
`runCmd` (`U4` / `UNIT04`), `peakOf`, the `isG4` graphic (vessel with two chambers, the weir line
drawn at `weirH`, water and oil fills in chamber 1, oil in chamber 2, E-502 with TV-502, the
four valves with positions, point boxes through `mkGv`/`mkVl`, a `WEIR nn %` label, the title
`UNIT 04 — SEPARATION · TWO-CHAMBER WEIR SEPARATOR`), the `rand4` plumbing (`initSim`,
`setSeed`, `snapshotData`, `restoreSnapshot`, `modelCtx`), `stepU4` in `step()`, `dasRules`
(LIC504 PVHH suppresses the consequential AI509 PVHI/PVHH as a DAS group), `Topology.UNITS` and
`VALVE_OF`, `tests/_fixture.js` scoping (rule 0.1) with a test that pins the v2 universe list,
the topology baselines (`tests/topology.test.js` node/edge/point counts — re-measured, not
guessed), a `tests/app-u4.test.js` (unit reachable, graphic data, trend group, tabs, replay
determinism with `rand4`, air loss drives the four valves to their fail positions), and a
`tests/golden-u4.test.js` capturing the U4 end state for three scenarios under the
two-independent-runs protocol. Then `build-dist.py`, `smoke.sh`, the full suite, an adversarial
verify pass, commit, push.

## 6. Out of scope for this cut, stated so nobody infers it

No recycle gas compressor, make-up hydrogen, purge, inert accumulation or the `pH2` coupling into
R-310 (that is the change that moves U3 goldens and waits on §10 Q2). No stabiliser. No emulsion
band on the interface transmitter (a later upset; the interface measurement is honest here). No
compressor surge. Hydrogen stays a boundary condition.
