<!-- @artifact dev -->
# Power-to-Liquids Expansion — Build Spec

**Status:** proposal, not ratified. Anthony's decisions are marked in §10.
**Target:** `experion-station-sim` v3.1, from branch `v3` @ `ffde6c7`
**Produced:** 2026-09-02 by the MacBook seat (claude-opus-5[1m]) via a 13-agent
workflow — 6 parallel readers grounded in the real source, 3 independent flowsheet
designs, adversarial critique of each, then synthesis. Design scores 6 / 5 / 6.

---

## VERIFICATION NOTE — read this before trusting any number below

This spec was produced by delegated agents. The reviewing seat independently
re-checked the load-bearing claims against the code at `ffde6c7`. What was
actually verified, and what was not:

**VERIFIED — the demo failure mechanism (§2.5).** `tools/coach/serve.py:437`
raises `RuntimeError` when an answer exceeds the spoken-word cap, discarding it
*after* it has already streamed to the operator. `serve.py:570-575` then catches
**every** exception and emits one string:
`"PIP cannot reach the local model (%s). LIVE DIAGNOSIS still works."`
So a correct answer that simply ran long is thrown away and replaced with a false
report of a network outage. Caps are TIP_WORDS=42 / ASK_WORDS=76, while
`num_predict = max(180, cap*3)` lets the model generate ~130 words. This is the
most probable cause of "PIP was completely useless" in front of the operators.

**VERIFIED — the flowsheet correction (§3).** The synthesis caught a
thermodynamic error present in *all three* candidate designs: each routed liquid
water to a boot on V-401. V-401 runs at TIC301 sp 180 °C / PIC401 sp 600 kPa
(confirmed at `Experion Station Simulator.dc.html:1730,1732`). Water saturation
at 600 kPa is 158.8 °C by steam tables (Antoine gives 162 °C). At 180 °C that
water is superheated and leaves overhead — the boot cannot exist. Relocating the
three-phase separation onto the U3 cold separator (~45 °C) is correct.

**VERIFIED — the existing separator.** V-401 is *already* a controlled
two-variable separator: LIC401 level, PIC401 pressure, PSV lift at 950 kPa,
LearnChemE flash model (`src/models.js:302-327`). An earlier claim by this seat
that "no separators are modelled" was **wrong and is retracted.** Do not repeat
it to an operator; it falsifies in thirty seconds against the U1 graphic.

**VERIFIED — AI205 conversion** is pinned at pv 85 with target band 75–95
(`...dc.html:1728`), which is what forces the recycle loop onto U3 rather than U1.

**NOT INDEPENDENTLY VERIFIED:** the remaining file:line citations, the effort
estimates, the published-model attributions, and the token-budget measurements.
Treat those as the workflow's claims, not confirmed fact. Spot-check before
building on any single one.

**KNOWN CONTAMINATION:** the workflow's briefing carried this seat's false
"no separators exist" claim. The ground readers corrected it from source and the
synthesis states the correction explicitly — but any design reasoning that leans
on a scarcity of separation equipment should be re-read with that in mind.

---

# THE PLAN — Power-to-Liquids Expansion, Experion Station Simulator v3.1

**Prepared for:** Anthony Vasquez Sr.
**Repo:** `/Users/vaquez/experion-station-sim`, branch `v3`, HEAD `ffde6c7`
**Author:** MacBook seat (claude-opus-5[1m]), 2026-09-02. Every code claim below was read at HEAD before it was written down.

---

## 1. WHAT WENT WRONG AND WHY THIS FIXES IT

Two failures, one cause.

**PIP could only read the board back.** `context_pack()` at `tools/coach/serve.py:167` returns nine keys — `lookingAt`, `screen`, `alarms[:6]`, `points[:8]`, `selectedAlarm`, `selectedAlarmHelp`, `drill`, `arch`, `guide[:1000]`. Not one of them says what the plant makes, how the equipment connects, or why a trip point is where it is. Worse, the two paths the operators actually watched — the autonomous tip and the EXPLAIN ALARM button — both send `ask=''`, so `_question_topic()` falls through to the 93-character OVERVIEW chunk of `guide.txt`. The model had less context than the operator standing next to it.

Meanwhile the station already builds a `catalog` of every configured point with its description on every request (`Experion Station Simulator.dc.html:1879`) and `context_pack` silently drops it. And the first three suggestion chips in the Ops Assistant (`:4676`) are "What am I looking at?", "What is this screen?", "How do I drive this station?" — none of which matches any keyword in `topics()` (`:2771-2790`), so they fall straight through to the uninformed model. The UI advertises orientation and has nothing behind it.

**No process description exists anywhere.** Zero hits in the station page for "process description", "process overview", "feedstock", "product spec". The entire process narrative in the shipped product is one `<text>` element on the U1 graphic: `TK-101 FEED → R-201 REACTOR → E-301 EXCHANGER → V-401 FLASH DRUM · SIMULATION`.

The expansion fixes this because **the process description is the deliverable and the plant is what makes it worth writing.** Right now there is no story to tell: three unconnected trains making an unnamed product. Once there is a real material path — feed in, water out, unreacted gas back around, product to spec — the orientation document writes itself, PIP has something to know, and the alarms mean something. Section 2 ships the document for the plant you have today. Sections 3-7 build the plant that makes it worth reading.

One correction you should carry into any conversation about this, because it will come up: **a separator is already modelled.** V-401 is real — `exchangerAndDrum()` at `src/models.js:302-327` integrates drum level and drum pressure, lifts a PSV at 950 kPa, and drives LIC401/PIC401 with eight authored alarm-help entries. The gap is not a missing vessel. It is: no composition, no interface level, no recycle, no purge, no column, no product spec. Say it that way or the first operator who opens the U1 graphic falsifies you in thirty seconds.

---

## 2. SHIP NOW — days, not weeks

Nine items. No new tags, no new valves, no physics change, **zero golden fixtures move.** This is the demo fix and it is independent of everything after it.

### 2.1 `src/process.js` — the orientation document, production class

New module, `// @artifact production` on line 1, UMD wrapper copied verbatim from `src/philosophy.js:15-18`. Exports `overview()`, `units()`, `hazards()`, `fidelity()`, `sources()`. **Also carries the whole document as one sentinel-delimited plain-text block** between `/* PROCESS-TEXT-BEGIN */` and `/* PROCESS-TEXT-END */` so `serve.py` can read it as text with no JS execution and no second copy to drift.

Add `<script src="./src/process.js">` after `Experion Station Simulator.dc.html:24`. `tools/build-dist.py` rewrites every `<script src="./...">` by uuid5 automatically and `tools/logic-harness.js:43-47` auto-loads them — no build edit, no harness edit.

Section 6 of this plan is the draft text for the **target** plant. For Ship Now, cut it to the three units that exist today and everything else goes under WHAT IS NOT SIMULATED. Two hours of editing, not a rewrite.

### 2.2 The PROC dialog — clone of the philosophy page

Exact template, five edits:
- template body `<sc-if value="{{ dg.isProcess }}">`, modelled on `dg.isPhil` at `:1512-1538`
- `processView()` beside `philosophyView()` at `:5082`
- `titles` map at `:4703`, `widths` at `:4704`, `isProcess:dgT==='process'` in the `dg` object at `:4711`
- Help menu item at `:4361` and a `runCmd` word at `:4111` (`PROCESS` / `OVERVIEW` / `PLANT`)
- rewrite the first three chips at `:4676` so they resolve, and add matching `topics()` entries at `:2771-2790`

~50 lines. No new screen flag, no navigation-history semantics.

### 2.3 PIP: always-on plant identity in SYSTEM

`serve.py:52-57` builds SYSTEM from `prompt.txt`. Append a ≤250-word PLANT block read from `src/process.js`'s sentinel range. This is the part that must be unconditional, because the tip and explain paths send `ask=''` and any keyword routing hands them nothing — that is the exact path your operators watched fail.

Do **not** restructure `prompt.txt`: `tests/coach-stream.test.js:39-45` pins six phrases in it verbatim. Append only, from a separate file.

### 2.4 PIP: a `process` key in `context_pack`, routed by unit not by keyword

Between `arch` and `guide` at `serve.py:197-207`:
```python
"process": _process_section(unit, topic)[:900],
```
Key it off `projection["screen"]["unit"]` — a hard fact the station already sends — not `_question_topic()`. Measured headroom is ~4,500 tokens worst case against `num_ctx: 8192`; ~550 tokens of new content fits.

**Trap, verified:** the guide section splitter at `serve.py:305` is `line.isupper() and line.replace(" ","").isalpha() and len(line) < 40`. `"CO2 CONDITIONING"` and `"H2 GENERATION"` return `False` and get silently folded into the previous section. Every heading in `process.js` is ALL-CAPS, alphabetic-plus-spaces, under 40 characters. **"CARBON DIOXIDE AND HYDROGEN SUPPLY", never "CO2 AND H2 SUPPLY."** Section 6 already obeys this.

### 2.5 PIP: stop discarding correct answers and blaming the network

This is the sharpest defect in the coach and it is the demo failure. At `serve.py:437`, once the word cap is exceeded, `stream_reply` raises `RuntimeError("Ollama answer exceeded the local spoken-word cap")`. The handler at `serve.py:570-575` converts *every* exception to one string keyed on the class name:

> "PIP cannot reach the local model (RuntimeError). LIVE DIAGNOSIS still works."

The operator watches a correct answer stream in word by word and then get wiped and replaced with a false claim of an outage. Six distinct failures share that one message.

The discard itself is deliberate and pinned (`tests/coach-sidecar.test.js:223-240`: truncation must fail visibly, partial text cannot be success). Do not silently trim. What *can* change without touching those assertions: **the message text and a distinguishing reason code.** A cap over-run should say so.

And retune together with it: `num_predict = max(180, cap*3)` at `serve.py:396` lets the model generate ~130 words against a 42-word acceptance cap, with nothing but a prose "LIMIT:" line to stop it. **Giving PIP a process description gives it more to say and raises the over-run rate.** The knowledge injection and the cap retune must ship in the same commit or the coach gets measurably worse.

### 2.6 Render the catalog PIP already receives

The station sends all 24 point descriptions on every request (`:1879`); `context_pack` uses them only as a lookup table inside `_find_point`. Render them as a one-line-per-tag nameplate. ~700 chars, ~175 tokens, zero new authoring. Do this even if everything else slips.

### 2.7 Fix the E-301 sign, before anyone builds on it

`src/models.js:309` is `P.hxT = lag(P.hxT, P.rT + 60 * V.TV301.pos * P.foulF, 90, dt)` — outlet temperature **rises** as TV-301 opens, from a 150 °C reactor to a 180 °C setpoint. TIC301 is configured `act:'REV'`, which is heating action. `diagnose()` at `:2746` agrees ("Reduce heat input at TIC301"). The graphic labels HTM next to it.

But `src/alarm-help.js:164-166` tells the operator to **"Open TV-301 further"** to cure a HIGH temperature, which in the model makes it hotter, and `:157` blames PVLL on "TV-301 open too far." The model is coherent — **E-301 is a flash preheater on hot oil, not a product cooler** — and two prose surfaces contradict it and each other.

Fix: rename `TIC301.desc` from `'E-301 PRODUCT OUTLET TEMP'` to `'E-301 FLASH PREHEAT OUTLET TEMP'` (`:1730`), and rewrite the four `TIC301.*` help entries at `alarm-help.js:155-170`. Costs nothing, and it is exactly the class of thing a veteran finds in ninety seconds.

### 2.8 Add the alarm-help coverage gate

There isn't one. `alarm-help.js:362-366` returns a polite generic paragraph for an unauthored key. Today coverage happens to be 100% (65 entries against 53 configured conditions). Add the test now, while it is green, so the expansion cannot quietly ship 50 alarms with 12 help entries. `tests/app-alarm-summary.test.js:160-173` already sweeps every tag × condition; make coverage an explicit assertion rather than an accident.

### 2.9 Add the process-text consistency gate

A test that walks every tag string in `src/process.js` and asserts it exists in `this.L` **and that the prose matches the point's `desc`.** This is cheap, and it is the single best defence against the exact failure being fixed. (One of the candidate designs wrote "FIC310 fuel gas" twice in its orientation document; `Experion Station Simulator.dc.html:1741` says `'R-310 FRESH FEED FLOW'` and the fuel valve is FV311 stroked directly by TIC311 with no cascade. That document would have died on first contact with a faceplate.)

**Ship Now total: 4-6 focused days. Zero new tags. Zero goldens moved. It fixes both operator complaints.**

---

## 3. THE PLANT

### Recommendation, and what I took from where

The three candidate designs scored 6 / 5 / 6. I am taking **Design 1's spine** — keep all three existing units, add exactly ONE new unit, change no existing equation except where explicitly declared — because it is the only one that ships inside a year and the only one that does not put months of verified calibration at risk.

But **all three designs contained the same fatal flaw, and the fix changes the flowsheet.** Every one of them routed liquid water from V-401's bottom draw into a three-phase separator boot. V-401's own modelled conditions are TIC301 sp = 180 °C (`:1730`) at PIC401 sp = 600 kPa (`:1732`). Water's saturation temperature at 600 kPa is 158.8 °C. **At every pressure that drum can legally hold, 180 °C water is superheated steam and leaves overhead.** The interface level, the water-carryover scenario, the hydrocarbon-to-boot scenario — the three best pieces of operator content produced — were all hung on a stream that does not exist.

Two designs also built the recycle loop on R-201, which is worse. AI205 is pinned at 85% conversion (`:1728`), and `PARAMS.U1.kRef` at `src/models.js:117` carries the comment `design k*tau = 5.67, conversion 0.85`. A recycle loop exists *because* per-pass conversion is low. And V-401's 950 kPa PSV is one of the five frozen trip thresholds. So those designs simultaneously promised "physics unchanged" and a gas synthesis loop, which are mutually exclusive.

**The fix is structural, not a patch: put the recycle loop and the three-phase separator on the U3 upgrading section, not on U1.**

Why this works, and why nobody saw it:
- H-310 + R-310 is already a fired charge heater with two passes, tube-skin trips, and an exothermic fixed bed with an interbed quench. That **is** a hydrofinishing reactor. FIC313 is already a quench flow.
- A hydrofinishing section has a hot separator, a trim cooler, a **cold** three-phase separator, a recycle gas compressor, make-up hydrogen on loop pressure and a purge on flow. Textbook, and it is the exact topology asked for.
- Hydrodeoxygenation makes water stoichiometrically, and it condenses in the **cold** separator at ~45 °C, where it is genuinely liquid. The water boot is now on a vessel where water is water.
- The inerts are **reaction-generated** (C1-C4 made by cracking and HDO), not an invented feed impurity. That is the honest mechanism.
- **There is no pressure point anywhere on U3 today.** No frozen threshold is touched. Loop pressure is a new point and I can declare it.
- AI205's 85% conversion stays on R-201 in U1 where a once-through liquid-phase conversion at 85% is entirely plausible. No conflict.
- And `fixedBed()` at `src/models.js:494-505` already scales the whole hot-spot exotherm through a single multiplier: `const act = envOf(P).catAct * (P.faults.bedact ? magOf(P).bedact : 1)`. **Hydrogen partial pressure enters as one more factor on that line.** The coupling from the new recycle loop to the existing runaway hazard costs one term.

**Taken from Design 1:** the one-new-unit spine; decoupling U3 through intermediate storage so its physics and goldens survive; the refusal to relabel U2's Lucia/Finkler/Engell polymerization (`PARAMS.U2` carries `gel` and `gelUnmixed: 2.0` — a Trommsdorff term; calling it oligomerization is a lie the physics contradicts); the design-point unity calibration constraint and its test; no compressor surge model, declared out of scope in writing; drawing the U4 graphic once with the column in place; and the "HOW GOOD ARE THE NUMBERS" section as a permanent product convention.

**Taken from Design 3:** the DP interface transmitter that lies under an emulsion band while remaining healthy — the best single training idea any of them produced; deliberately tripping the compressor before the interlock does; disclosed scaling for any training-observability parameter; the three cheap safety edits in order; golden governance (archive the v2 baseline before the first re-capture); and the process-text consistency test.

**Taken from Design 2:** the register and structure of the orientation document; Souders-Brown on compressor suction knock-out; Fair (1961) flooding plus a minimum-vapour weep point so both ends of the column window are physical; the explicit INVENTED list as standing practice; and never remapping unit ids or equipment tag numbers.

**Rejected:** ten units and a unit-registry refactor (9-14 months, and its own thesis broke on AI205). Rachford-Rice inside V-401 — it recalibrates drill D9 and the `upset-vap` golden for no operator-visible gain, and RR-plus-complete-immiscibility is internally contradictory anyway. The mimic-renderer refactor as a prerequisite — the finding is correct and verified (`support.js` `walkFor` has no cap), but it pays off at unit five and this plan has four; it becomes mandatory for any expansion past U4. An electrolyser (deferred; it is an open question, not a decision I should make for you). Any surge model. Any renumbering.

### The board

Four units. Display codes unchanged — `'U1'`/`'U2'`/`'U3'` are load-bearing strings in `src/topology.js:46`, in `unitOf` (`:2725-2730`), in ~14 app enumerations, in every A-drill node id, and implicitly in 35 golden fixtures.

---

#### U1 · INTERMEDIATE CONVERSION — existing physics, unchanged

Crude oxygenate intermediate arrives at the battery limit from the off-board carbon-dioxide hydrogenation block. It is received into a surge tank, pumped to a liquid-phase catalytic reactor where it is condensed and dehydrated to a crude hydrocarbon plus water, then heated and let down into a flash drum that takes light ends and reaction water overhead and sends crude liquid to intermediate storage.

| | |
|---|---|
| **Equipment** | TK-101 intermediate surge drum · P-101 charge pump · FV-102 · R-201 stirred jacketed conversion reactor · TV-202 jacket · E-301 flash preheater (HTM) / TV-301 · V-401 hot flash drum / LV-401, PV-401 · PSV-401 @ 950 kPa |
| **Loops** | LIC101 → FIC102 cascade (tank level by feed rate, SPHILM 80 M3/H because that is the jacket's limit) · TIC201 → TIC202 cascade (reactor by jacket coolant) · TIC301 flash preheat outlet · LIC401 drum level · PIC401 drum pressure |
| **Watched** | AI205 per-pass conversion, 85% nominal, target band 75-95 |
| **Hazard** | Thermal runaway. Heat generation rises with temperature faster than the jacket removes it. Hard trip 185 °C (`PARAMS.U1.tripT`). The fast handle is feed, not coolant. Secondary: TK-101 overfill at 98%, and P-101 low-level trip at 2%. |
| **Model** | Henson & Seborg exothermic CSTR (APMonitor PDC), `E_R: 8750`, pre-exponential re-anchored to 150 °C. `docs/RESOURCES.md` §4. Unchanged. |
| **Change** | Prose only, plus the E-301 sign fix (§2.7). |

#### U2 · BATCH CAMPAIGN REACTOR — existing physics, unchanged, honestly off-train

A semi-batch jacketed reactor with dosed feed and an external exchanger, run under sequence control. **It is not in the fuel train and the orientation document says so in one sentence.** It stays because it is the only place in the product where a trainee learns sequence control, PROGRAM mode write rejection, phase-based alarm limits, and HOLD/ABORT. Multi-unit boards covering a continuous train plus a campaign batch unit are ordinary. Relabelling a Trommsdorff gel effect as a power-to-liquids step would be worse than the seam.

| | |
|---|---|
| **Equipment** | R-202 · M-202 agitator · MV-211 · JV-213 · SCM202 |
| **Loops** | FIC211 dose flow (PROGRAM-owned in FEED) · TIC212 → TIC213 cascade |
| **Watched** | TI216 adiabatic end temperature · PI214 · LI215 |
| **Hazard** | Accumulated unreacted feed. Agitator loss during FEED. Trip 110 °C. |
| **Model** | Lucia, Finkler & Engell semi-batch polymerization (do-mpc), `docs/RESOURCES.md` §4. Unchanged. |

#### U3 · HYDROFINISHING — existing physics, one declared coupling added

Crude liquid is drawn from intermediate storage, mixed with hot recycle hydrogen, fired to reaction temperature in a two-pass heater, and passed over a fixed catalyst bed that saturates olefins and removes residual oxygenates. A cold liquid quench between the beds holds the hot spot.

| | |
|---|---|
| **Equipment** | H-310 two-pass fired heater / FV-310 charge, FV-311 fuel · R-310 fixed catalyst bed · QV-313 quench |
| **Loops** | FIC310 charge from storage · TIC311 heater outlet on fuel · FIC313 interbed quench |
| **Watched** | TI312 bed hot spot (High 440, trip 480) · TI314/TI315 tube skins (trip 500) · AI316 flue-gas excess O2 (Low 1.5) |
| **Hazard** | Two independent ones. Tube-skin overheat, which a normal mixed outlet temperature hides. And bed hot-spot runaway, which grows faster than linearly with inlet temperature. |
| **Model** | APMonitor/Badgwell two-pass fired heater; LearnChemE PFR parametric sensitivity for the hot spot. `docs/RESOURCES.md` §4. Structure unchanged. |
| **Change** | **One term.** `src/models.js:497` becomes `const act = envOf(P).catAct * bedactF * pH2F`, where `pH2F` is the hydrogen-partial-pressure factor from U4's recycle loop, calibrated to exactly 1.000 at the design point. And FIC313's quench liquid is now identified as cold rundown drawn from V-502, which couples the new separator's level control directly to the existing bed hazard. |

#### U4 · SEPARATION, RECYCLE AND PRODUCT RECOVERY — NEW

Reactor effluent is separated hot; the vapour is cooled and separated cold into gas, hydrocarbon and water; the gas is recompressed to the reactor with a purge to hold light ends down; the water is drained to process condensate; and the hydrocarbon is stabilized in a distillation column to a product vapour-pressure specification.

| | |
|---|---|
| **Equipment** | V-501 hot separator / LV-501 · E-502 recycle trim cooler / TV-502 · V-502 cold three-phase separator with water boot / LV-503, WV-504 · K-501 recycle gas compressor (M K-501) / FV-507 · make-up H2 PV-505 · purge PV-506 · T-601 stabilizer · E-602 reboiler / SV-602 · E-603 overhead condenser · V-603 reflux drum / DV-605, RV-603 |
| **Loops — recycle and separation (Stage 2)** | LIC501 V-501 hot separator level → T-601 feed · TIC502 cold separator inlet temperature · LIC503 V-502 total liquid level → T-601 feed and the FIC313 quench header · **LIC504 V-502 water interface level** · PIC505 recycle loop pressure, held on make-up hydrogen · FIC506 purge flow · FIC507 recycle gas rate to the bed |
| **Loops — stabilizer (Stage 3)** | TIC601 bottoms temperature → FIC602 reboiler steam (cascade) · FIC603 reflux · PIC604 overhead pressure · LIC605 reflux drum level · LIC606 bottoms level to rundown |
| **Watched** | AI508 recycle gas hydrogen purity · AI509 water in the hydrocarbon draw · PDI607 column differential pressure · AI608 product Reid vapour pressure — the first product-spec surface in the simulator |
| **Hazards** | Three, different in kind. (a) Water carryover into a hot column — pressure and dP excursion, and the first alarm is in the wrong unit. (b) Hydrocarbon out of the water boot to condensate — quiet, environmental, does not alarm hard. (c) Light-ends accumulation in the recycle loop — silent for half an hour, then it eats the bed's hot-spot margin through the operator's own corrective action. |
| **Models** | Stokes settling against residence time with the API 12J / Arnold & Stewart criterion; DP interface measurement (textbook instrumentation); Souders-Brown (1934) entrainment for the compressor suction; Skogestad Column A compartment-lumped per Luyben for T-601; Fair (1961) flooding via the Souders-Brown C-factor plus a minimum-vapour weep point; component mass balance with purge per Downs & Vogel (1993), **already registered** in `docs/RESOURCES.md` §4 and named in `docs/dev/V3-PLAN.md:264` as the sanctioned source for exactly this unit. |

**Off board, stated as such:** carbon dioxide capture and compression, water electrolysis, oxygen handling, hydrogen compression, and the crude oxygenate synthesis itself. Hydrogen and crude intermediate arrive at the battery limit. This is honest scoping — you do not put a whole site on one console — and the orientation document says it in the second paragraph.

---

## 4. THE SEPARATION TRAIN

Four separation devices. Each has a distinct control problem and a distinct failure. None is decoration.

### V-401 · HOT FLASH DRUM (U1, exists, **unchanged**)

Separates light ends and reaction water overhead from crude hydrocarbon liquid at 180 °C / 600 kPa.

I am deliberately **not** replacing the vapour-fraction line at `src/models.js:311` with a rigorous flash. That line — `const vapf = clamp(0.02 + (P.hxT - 165) * 0.004, 0, 0.3)` — is calibrated, and the comment at `:315-316` records that B4 tuned the `vap` upset "so that PIC401 left in MAN reaches its PVHI limit inside the drill window while AUTO holds the drum with the vent open (the original 1.9 never alarmed)." Replacing it recalibrates drill D9, moves the `upset-vap` golden, and buys the operator nothing they can see. The drum stays exactly as it is.

**Control problem, already good:** the level is the liquid seal between a 600 kPa drum and the letdown line. Lose it and gas blows by LV-401. Flood it and liquid carries into the overhead. PSV-401 at 950 kPa is a reportable event, not a control action.

### V-501 · HOT SEPARATOR (U4, new — small, and it is the compressor's first line of defence)

Separates reactor effluent at reaction temperature: vapour to the trim cooler, hot liquid to the stabilizer feed.

One loop, LIC501. It earns a place because it is where the **hot** split happens, which is what makes the cold separator's job tractable, and because a hot separator liquid draw arriving hot is exactly what a stabilizer feed wants — it halves the reboiler duty and it is normal design.

### V-502 · COLD THREE-PHASE SEPARATOR (U4, new — the centrepiece)

Separates gas / hydrocarbon / water at ~45 °C at loop pressure. Hydrodeoxygenation makes water stoichiometrically, and at 45 °C water's vapour pressure is 9.6 kPa against a loop pressure of several MPa — **essentially all of it condenses here.** That is why the boot is on this vessel and not on V-401.

Four handles that fight each other:

- **LIC504 · WATER INTERFACE LEVEL**, measured by differential pressure across a fixed span calibrated for two assumed densities: `dP = ρ_w·g·h_w + ρ_o·g·(H − h_w)`. Too high and water climbs into the hydrocarbon draw, goes to a hot column, flashes, and spikes PDI607. Too low and hydrocarbon leaves through the boot to process condensate — quiet, no hard alarm, environmental event.

  **The best training object in the expansion lives here.** When an emulsion band of intermediate density occupies part of the span, the linear dP-to-height mapping is simply wrong, and **the transmitter is healthy.** It is reporting a plant that changed underneath its calibration. The trainee who diagnoses "bad transmitter" and puts LIC504 in MAN makes it worse. Nothing in the product teaches this today, and every operator who has run a separator, a desalter or a decanter has a story about it.

- **LIC503 · TOTAL LIQUID LEVEL.** Coupled to separation quality through residence time. Run the vessel light to get gas space and the water droplets do not have time to fall, so water carries over **with the interface exactly on setpoint.** Level and separation quality are the same knob. Operators who learned on knockout drums get this wrong.

- **PIC505 · loop pressure** on make-up hydrogen (see §5 — this is *not* on the purge, and that matters).

- **TIC502 · cold separator inlet temperature.** Colder means more water condenses here and less carries forward.

**Fidelity, declared:** no property package, no K-values, no flash solver. Water is treated as fully condensed at cold-separator conditions (defensible from its vapour pressure at 45 °C); hydrocarbon condensation is a temperature-driven correlation of the same class as the existing V-401 line, but with a stated basis and a stated ceiling. This is a deliberate choice — it kills the numerical-stability risk, the per-tick performance risk (no Newton or bisection inside a five-substep loop in front of a full `renderVals()` rebuild), and the Rachford-Rice-plus-immiscibility contradiction, all at once. A veteran does not care whether you solved Rachford-Rice. They care whether the drum behaves right when they move the cooler outlet.

### T-601 · STABILIZER (U4, new — the slow one)

Separates dissolved light ends overhead from stabilized product in the bottoms, setting the product's vapour pressure. A stabilizer is the honest column to pick because it is a near-binary split by design, so a binary dynamic model is a fair representation rather than a shortcut.

Five handles, not independent:

- **TIC601 → FIC602** bottoms temperature on reboiler steam. This is the vapour-load handle and the specification handle, and it trades directly against yield.
- **FIC603** reflux. Reflux and reboiler are both heat applied at opposite ends and they fight.
- **PIC604** column pressure. Move it and every tray temperature moves at once.
- **LIC605 / LIC606** reflux drum and bottoms levels — the material balance, and they are coupled.
- **PDI607** differential pressure. The flooding indicator. Watch the trend, not the number.
- **AI608** product Reid vapour pressure — the spec, on an analyser cycle that lags the process. *(A stabilizer is run to RVP or TVP, not to "light ends vol %". Naming it correctly costs nothing and buys credibility.)*

**Flooding signature:** dP climbing, base level falling then swinging, overhead temperature falling, AI608 off-spec. The instinct is to add reflux, which adds liquid to a column that already cannot pass liquid. **Cut the reboiler first.** Modelled from the Souders-Brown C-factor / Fair (1961) percent-of-flood, with tray efficiency collapsing above ~85% of flood. The other end is modelled too: below a minimum vapour F-factor the trays weep and dump, and the column goes quiet and useless in a completely different way. Both ends of the window are physical, not scripted.

**Stiffness, checked:** `tick()` at `Experion Station Simulator.dc.html:2533` runs `for(let i=0;i<n;i++) this.step(0.5)` — the speed multiplier increases the step *count*, not `dt`. `dt` is pinned at 0.5 s at every speed. Column A's fastest mode is the linearised tray hydraulic lag at ~3.8 s, so `dt/τ ≈ 0.13` under explicit Euler, and compartment lumping to 8 stages makes it slower still. Comfortably stable in principle — but it must be verified against `tests/models.test.js:251`, which asserts the existing models stay finite and bounded at speed ×5, before Stage 3 is called done.

### What I am not building, and will say so

No coalescer, no rag-layer chemistry, no emulsion break, no demister carryover, no packed-column mass transfer, no side draw, no pumparound, **no compressor surge model.** K-501 is a fixed-speed machine with a head-flow characteristic, a run/trip state and a discharge pressure. A credible surge model needs a real compressor map, and a rotating-equipment operator spots a fake one instantly — that is precisely the class of thing that lost the first demo. K-501 does have a trip, and the trip is a superb drill that needs no surge physics at all.

---

## 5. RECYCLE, PURGE AND INERTS

This is the part the current simulator cannot touch in any form, and it is the highest-value operator content in the plan.

### The loop

Gas off V-502 is mostly unreacted hydrogen and is far too valuable to burn, so K-501 compresses it and returns it to the H-310 charge. That closes a loop, and every closed loop accumulates whatever has no way out.

### The mechanism — a mass balance, not invented physics

The bed makes light ends (C1-C4) by cracking and by hydrodeoxygenation. Light ends do not react further and do not condense at cold-separator conditions, so the **only** exit is the purge, PV-506. Make-up hydrogen carries a small nitrogen/argon fraction on top of that. At steady state:

```
y_light,loop  ≈  (generation + make-up impurity) / F_purge
```

Halve the purge and you roughly double the loop light ends. This is the textbook recycle/purge result, structurally identical to the purge/inert loop in the Tennessee Eastman process (Downs & Vogel 1993) — which is already a registered source in `docs/RESOURCES.md` §4 and is **named by standing ruling** at `docs/dev/V3-PLAN.md:264` as the correct source for exactly this unit. Follow the ruling; do not build a five-correlation stack instead.

### The control scheme, and why the obvious one is wrong

**Make-up hydrogen holds loop pressure (PIC505 → PV-505). The purge is on flow control (FIC506 → PV-506).** This is the standard scheme on every hydrotreat and synthesis loop, and it is not a stylistic choice.

One of the candidate designs put the *purge* on pressure control and marketed the double duty as pedagogy. That is a steady-state mass-balance error. With the purge as the pressure manipulated variable, purge flow at steady state is pinned by the overall gas balance and is **independent of the pressure setpoint** — the operator physically cannot walk the loop to a new bad light-ends steady state. What you get instead is a pressure runaway to relief in minutes, which is loud, not the silent 45-minute drift advertised. Anyone who has run an ammonia, methanol or hydrotreat loop knows this scheme on sight, and getting it wrong would be the demo failure one layer deeper.

With the correct scheme, pinching FIC506 for a perfectly good economic reason genuinely and quietly moves the loop composition. That is the drill.

### The coupling back to the bed — one term

Light ends displace hydrogen, so hydrogen partial pressure at R-310 falls: `pH2 = P_loop × y_H2`. Hydrogenation rate falls roughly first order in `pH2` at low partial pressure. That enters `src/models.js:497` as one more factor on the existing `act` multiplier, **calibrated so it is exactly 1.000 at the design point**, with a test that runs the plant at design for 30 simulated minutes and asserts the factor stays inside 1.000 ± 1e-6.

Be honest about what that test does: it pins the design steady state, not every trajectory. Existing U3 drills deliberately run away from design, which is where the factor bites. Keep it as a guard, do not sell it as trajectory preservation, and re-capture U3's goldens deliberately with a written justification.

### The scenario shape, and the payoff

It develops over 30-60 simulated minutes and **nothing alarms.** AI508 hydrogen purity sags. Bed conversion falls, product goes off-spec on AI608, and **the bed gets colder, not hotter,** because it is doing less hydrogenation. The trained-in corrective action — raise TIC311 to recover the bed outlet — works, briefly, and spends the hot-spot margin. Then somebody opens the purge, hydrogen comes back, the exotherm returns at the higher preheat temperature, and TI312 climbs toward its 440 High and its 480 trip. **That double exotherm is the payoff and it is why this is worth building.**

Low hydrogen partial pressure also promotes coking, so the loop couples to the existing `env.catAct` instructor variable (`src/instructor.js:293`) through a slow activity decay. That is real hydroprocessing behaviour and it costs one state.

### The economics, which is the actual lesson

Purging burns hydrogen. Not purging costs a reactor. The right answer is to open the purge, accept the loss, and let the loop clean out over an hour. There is no clever way to have both and the sim should not pretend there is.

### Disclosed scaling

The loop gas holdup is sized so that the accumulation is observable inside a training session — the time constant is holdup divided by purge rate, and a physically-sized loop takes hundreds of hours. **This is a training-scaling choice, not a physical claim, and it is stated in the code comment and in the orientation document.** A veteran accepts a disclosed scaling factor. They never forgive an undisclosed one.

---

## 6. THE PROCESS DESCRIPTION

Ships in `src/process.js` (production class), rendered in the PROC dialog, and read as sentinel-delimited plain text by `serve.py` so PIP and the operator share one source. Headings are ALL-CAPS, alphabetic-plus-spaces, under 40 characters, because of `serve.py:305`.

---

```
═══════════════════════════════════════════════════════════
PLANT ORIENTATION — SYNTHETIC FUELS DEMONSTRATION PLANT
What you are driving
═══════════════════════════════════════════════════════════

READ THIS FIRST

This is a training simulator. The plant described here does not
exist. It is a generic power-to-liquids process assembled from
textbook unit operations so that operators can practise on
realistic control problems. It is not modelled on, derived from,
or intended to represent any company's plant, and no proprietary
flowsheet, catalyst, operating condition, separation train or
control scheme has been used or inferred. Every number on this
board is this simulator's own.

Equipment tag numbers do not follow the unit layout. They follow
the original demonstration train and three expansions were built
around it. You will get used to it. Every plant you have ever
worked was the same.

WHAT THE PLANT MAKES

The plant takes a crude oxygenate intermediate and hydrogen and
makes a finished liquid hydrocarbon blendstock.

The intermediate arrives at the battery limit from the carbon
dioxide hydrogenation block, which runs on its own board and is
not your responsibility. Hydrogen arrives at the battery limit
from the site's electrolysis plant, which is also not yours. Your
job starts where the intermediate is received and ends where
finished blendstock leaves for the tank farm.

The chemistry, at the level you need it. In Unit One the
intermediate is condensed and dehydrated over a catalyst into a
crude hydrocarbon liquid, and it makes water while it does it. In
Unit Three that crude liquid is finished over a second catalyst
with hydrogen, which saturates what is left unsaturated and
strips out what oxygen is left, and it makes water again. Water
is a co-product, not a contaminant. The reactions make it
stoichiometrically and there is a great deal of it. Getting the
water out cleanly is most of what the separation section does,
and it is the source of more upsets than anything else on this
board.

THE ROUTE THROUGH THE PLANT

  UNIT 01 receipt and conversion
    -> hot flash, crude liquid to intermediate storage
  UNIT 03 hydrofinishing
  UNIT 04 separation, recycle and product recovery
    -> finished blendstock to tankage

UNIT 02, the batch reactor, is on this board but is not in that
path. See the end of this document.

UNIT ONE  RECEIPT AND CONVERSION

Crude intermediate is received into TK-101 on level control.
LIC101 is a cascade master: it holds tank level by setting the
flow setpoint of FIC102. FIC102's setpoint is limited to 80 M3/H
because that is where R-201 runs out of jacket cooling. TK-101 is
a surge vessel and it is meant to swing. Do not chase it.

P-101 takes suction from the tank. Below 2 percent tank level it
is tripped to protect it. That is a protection, not a nuisance.
If you have hit it, you had already lost the tank.

R-201 is the conversion reactor: a well-stirred, jacket-cooled
vessel running at about 150 DEG C. Two things about it matter
more than everything else combined.

First, it is temperature-controlled by a cascade. TIC201 measures
reactor temperature and sets the setpoint of TIC202, which
controls jacket coolant temperature through TV-202. If you break
that cascade and drive the jacket by hand, you own the exotherm.

Second, the reaction makes heat in proportion to how fast it is
going, and it goes faster when it is hotter. That is positive
feedback, and it is why this reactor has a hard trip at 185 DEG C.
Above about 165 DEG C the jacket is working near its limit and the
margin closes quickly. When you see reactor temperature rising
with the jacket already cold and wide open, CUT FEED. You remove
heat by removing reactants, not by asking the cooling water for
something it does not have. Then watch TK-101, because feed is
still arriving at the battery limit and the tank will fill.

AI205 reads per-pass conversion, nominally 85 percent. It is your
health indicator for this reactor.

Reactor effluent is heated in E-301 and let down into V-401, the
hot flash drum. E-301 is a PREHEATER on hot oil, not a cooler. It
raises the effluent from reactor temperature to flash temperature,
about 180 DEG C, so that the light ends and the reaction water go
overhead and crude hydrocarbon liquid stays in the bottom. Open
TV-301 further and the drum gets hotter and makes more vapour.

LIC401 holds the drum level with LV-401; PIC401 holds the pressure
with PV-401. The level in V-401 is a liquid seal. Lose it and gas
blows through LV-401 into the liquid line. Flood it and liquid
carries over into the overhead. The relief valve is set at 950 KPA;
lifting it is a reportable event, not a control action.

E-301 fouls. It fouls slowly all the time and there is nothing you
can do about the baseline. What you notice first is TIC301's output
climbing across a shift to hold the same outlet temperature. When
it saturates, the flash duty changes and PIC401 starts to work.

Crude liquid from V-401 goes to intermediate storage. Overhead
vapour and reaction water go off plot to the light ends and
condensate header.

UNIT THREE  HYDROFINISHING

Crude liquid is drawn from intermediate storage on FIC310, mixed
with hot recycle hydrogen, fired to about 320 DEG C in H-310, and
passed over the fixed catalyst bed in R-310.

H-310 is a two-pass fired heater. It has two independent hazards
and they are not the same thing. The process one is outlet
temperature, TIC311. The equipment one is TUBE SKIN TEMPERATURE,
TI314 and TI315: a fouled or low-flow pass runs its tubes hot
while the mixed outlet still looks normal. There is a tube-skin
trip at 500 DEG C that closes the fuel valve. AI316 reads excess
oxygen in the flue gas; below about 1.5 percent you are
approaching incomplete combustion, and that is a firebox problem,
not a temperature problem.

R-310 is a fixed bed with exothermic reactions in it, which means
it has a HOT SPOT, a point inside the bed hotter than either end.
TI312 reads it. The hot spot moves, and it grows faster than
linearly with inlet temperature: a 10 DEG C rise at the heater
outlet is not a 10 DEG C rise in the bed. The bed trips at
480 DEG C.

FIC313 is the interbed quench. It is cold rundown drawn from
V-502 in Unit Four, so if you lose level on that separator you
lose your quench. When TI312 starts to climb, BACK OFF THE HEATER
BEFORE YOU ADD QUENCH. Quench cools the bed inlet, but the heat
is being made inside the bed, and the only way to make less of it
is to send in less feed at a lower temperature.

The other thing that controls this bed is hydrogen, and it does
not have a controller on this unit. It is in Unit Four.

UNIT FOUR  SEPARATION, RECYCLE AND PRODUCT RECOVERY

This is where the plant's material balance is actually decided
and it is where most of your attention goes.

THE SEPARATORS. Bed effluent goes first to V-501, the hot
separator, which takes the vapour off the top and drops hot
liquid out of the bottom straight to the stabiliser. LIC501 holds
that level.

The vapour is cooled in E-502 on TIC502 and enters V-502, the
COLD THREE-PHASE SEPARATOR, where it settles into three layers:
gas at the top, hydrocarbon in the middle, water in the boot at
the bottom. You control all three.

  PIC505 holds loop pressure by admitting make-up hydrogen.
  LIC503 holds the TOTAL liquid level, drawing hydrocarbon off
    the side to the stabiliser and to the Unit Three quench.
  LIC504 holds the INTERFACE, the boundary between water and
    hydrocarbon, by draining water out of the boot.

Two failure modes, and they look nothing alike on the board.

Interface too high means water is climbing into the hydrocarbon
draw. Water then goes to the stabiliser, hits a hot tray, flashes,
and the column differential pressure spikes. YOU WILL SEE IT IN
THE COLUMN BEFORE YOU SEE IT IN THE SEPARATOR.

Interface too low means hydrocarbon is going out of the boot into
the process condensate system. That one does not alarm loudly and
it is an environmental event. The tell is a falling interface with
a perfectly normal total level. Read the two levels against each
other, never one at a time.

And a third thing that is not a failure of either loop. Separation
is gravity settling, and gravity settling needs time. If you run
the vessel level low to get more gas space, you cut the liquid
residence time, the water droplets do not have time to fall, and
water carries over WITH THE INTERFACE EXACTLY ON SETPOINT. Level
and separation quality are the same knob. Operators who learned on
knockout drums get this wrong.

AI509 reads water in the hydrocarbon draw. If it is rising, water
is going forward, and you have maybe an hour before the column
tells you about it in a much less pleasant way.

One more thing about LIC504. It is a differential pressure
transmitter calibrated for a clean water layer under a clean
hydrocarbon layer with known densities. If an emulsion band builds
between the two phases, and it will when the feed runs cool or the
rate changes, the differential pressure no longer corresponds to
the interface height. THE TRANSMITTER IS NOT BROKEN. It is
reporting a plant that has changed underneath its calibration. If
you put LIC504 in manual because the transmitter is bad, you are
now flying blind on the one loop that matters.

THE RECYCLE LOOP AND THE PURGE. Gas off V-502 is mostly unreacted
hydrogen and far too valuable to burn, so K-501 compresses it and
sends it back to the H-310 charge. That closes a loop, and every
closed loop accumulates whatever has no way out.

The bed makes light ends while it works. Light ends do not react
further and they do not condense in the cold separator, so the
only way out of the loop is the purge. AI508 reads hydrogen purity
in the recycle gas.

Understand this or you will get caught. At steady state, the light
ends in the loop are set by the ratio of what the bed makes to
what you purge. Halve the purge and you roughly double them.
Nothing alarms. Loop pressure will not tell you, because pressure
is on control and make-up hydrogen simply admits less. What
happens instead is slow: light ends displace hydrogen, hydrogen
partial pressure at the bed falls, the finishing reactions slow
down, product goes off specification on AI608, and THE BED GETS
COLDER, not hotter, because it is making less heat.

The wrong response, and it is the natural one, is to raise TIC311
to get the bed temperature back. That works, briefly, and it
spends your hot-spot margin. Then somebody opens the purge,
hydrogen comes back, the reactions come back at the higher preheat
temperature, and you find out how much margin you had left.

The right response is to open the purge, accept the hydrogen loss,
and let the loop clean itself out over the next hour. Purging
costs money. Not purging costs a reactor.

K-501 is the machine that holds all of this together. If you lose
it, loop pressure collapses, hydrogen at the bed collapses, and the
bed cools. And if the V-502 level runs away toward the compressor,
trip it yourself rather than waiting for the interlock. Losing the
plant is cheaper than losing the machine.

T-601, THE STABILISER. Hydrocarbon from V-501 and V-502 is fed to
a distillation column that takes light ends overhead and leaves
stabilised product in the bottom. Overhead vapour is condensed in
E-603 and collected in V-603. LIC605 holds drum level by letting
distillate away; FIC603 returns reflux. Bottoms are boiled in
E-602 on TIC601, and stabilised product leaves on LIC606 to
rundown.

You have four handles: column pressure PIC604, bottoms level
LIC606, reflux FIC603 and reboiler duty through TIC601. THEY ARE
NOT INDEPENDENT. Pushing reboiler duty puts more vapour up the
column; more vapour means more pressure drop; past a point the
vapour will not let the liquid down and the column FLOODS. PDI607
reads column differential pressure and it is your flooding
indicator. Watch its trend, not its number. AI608 reads product
vapour pressure; that is your specification.

A flooding column looks like this: differential pressure climbing,
bottoms level falling and then swinging, overhead temperature
falling, AI608 going off specification. The instinct is to add
reflux. Adding reflux adds liquid to a column that already cannot
pass liquid. CUT THE REBOILER FIRST. Get the vapour load down, let
the trays drain, then put the duty back slowly.

At the other end, starve it of vapour and the trays weep and dump
and the column goes quiet and does nothing at all. Both ends are
failures. The window is narrower than it looks.

This column is slow. It takes an hour or more to line out. One
move, then wait, and read the trend. The second correction is
usually the one that does the damage.

UNIT TWO  BATCH REACTOR

R-202 is a semi-batch reactor on this board and NOT in the fuel
train. It makes a specialty product on a campaign basis and shares
the site's cooling and control room. It is here because this board
covers it, not because it feeds anything above.

It runs under sequence control, SCM202: CHARGE, HEATUP, FEED,
REACT, COOL, DRAIN. While the sequence owns a loop the faceplate
shows PROGRAM and your setpoint and mode changes are rejected.
That is the sequence protecting itself, not a fault.

TI216 is the adiabatic end temperature: where the batch would go
if all cooling were lost right now. It is the number that decides
whether you can keep feeding. If the agitator M-202 trips during
FEED, HOLD THE SEQUENCE FIRST. An unmixed reactor with feed still
going in accumulates unreacted material, and TI216 will tell you
what that is worth.

THE FOUR THINGS THAT WILL BITE YOU

1. THE CONVERSION EXOTHERM. R-201 makes heat faster when it is
   hotter. Cooling has a limit. Feed is the fast handle.
2. THE BED HOT SPOT. R-310 makes its heat inside the bed. Back off
   the heater before you add quench.
3. WATER. Both reactions make it. V-502 gets it out. Get that
   wrong and it turns up in the column, in the condensate, or in
   the product.
4. THE RECYCLE LOOP. Anything that does not react and does not
   condense builds up until you purge it, and it builds up
   quietly.

HOW GOOD ARE THE NUMBERS

Honest answer: good enough to teach control, not good enough to
design equipment.

R-201 uses a published exothermic-CSTR parameter set with its rate
constant re-anchored to this plant's operating point. R-310 uses a
published fixed-bed parametric-sensitivity model for the hot spot,
and H-310 a published two-pass fired heater. T-601 uses a
published binary distillation model with the stage count, holdups
and relative volatility scaled to this plant, and its flooding and
weeping limits come from published tray capacity correlations.

There is no property package on this board. The separators do not
solve a rigorous equilibrium. Water is treated as fully condensed
at cold separator conditions, which is close to true at 45 DEG C
and would be wrong anywhere warmer. Hydrocarbon condensation is a
temperature correlation, not a flash. The relationship between
separator residence time and carryover is a smooth curve fitted to
the standard settling criterion, not a measured one. The rate at
which light ends build up in the recycle loop is deliberately
scaled so that it is visible inside a training session; a real loop
of this size would take far longer. That is a training decision and
it is stated here so you do not mistake it for physics.

Not modelled at all, and you should not read anything into their
absence: compressor surge and anti-surge control, emulsions and rag
layers as a chemistry, demister carryover, packed-column mass
transfer, and any relief system sizing beyond the set pressures
shown.

Trip points, alarm limits and equipment protections are this
simulator's own and are listed on each point's Alarms tab. When the
help text and the faceplate disagree, believe the faceplate.

═══════════════════════════════════════════════════════════
```

---

## 7. OPERATOR SCENARIOS UNLOCKED

Eight. For each, why the current three units cannot produce it.

**1. THE PINCHED PURGE (45-60 min, the flagship).** FIC506 is cut 30% for a good economic reason. Nothing alarms. AI508 hydrogen purity sags, AI608 product RVP drifts off spec, TI312 bed temperature falls. The trained-in correction — raise TIC311 — works briefly and spends the hot-spot margin. Then the purge is opened, hydrogen returns, and TI312 climbs toward 440 High and 480 trip at the elevated preheat. *Impossible today: no recycle, no purge, no composition, no accumulation of any kind in the codebase.*

**2. THE INTERFACE THAT LIED.** Feed rate is cut on nights. Lower velocity, better settling — except the rate change drops V-502's temperature and an emulsion band builds. LIC504's DP transmitter, calibrated for two clean densities, reads a low interface. The controller closes WV-504. Real water level climbs behind a reading that says it is falling. Nothing alarms on U4. Ninety minutes later TIC601 collapses, PDI607 spikes and AI608 goes off spec — in a unit the trainee was not watching. *Impossible today: no interface, no composition, no downstream unit for a symptom to appear in.*

**3. HYDROCARBON OUT OF THE BOOT.** WV-504 sticks open or the interface runs low. Product goes to process condensate. Falling interface, perfectly normal total level. Quiet, does not alarm hard, environmental event. Every operator who has run a separator has seen it. *Impossible today: one liquid phase in the whole codebase.*

**4. SEPARATION LOST AT A CORRECT SETPOINT.** The operator drops LIC503 to make gas room during a pressure excursion. Both level loops sit exactly on setpoint. Residence time falls below the Stokes requirement and water carries over anyway. **The board says everything is fine and the product is wrong.** This is the scenario that proves the sim understands separators rather than just drawing them.

**5. COLUMN FLOODING ON A DUTY STEP.** TIC601 pushed to make bottoms spec. PDI607 climbs, base level collapses then swings, overhead temperature falls, AI608 off spec. The instinct is to add reflux; the correct action is to cut the reboiler and wait. *Nothing in the current sim can flood.*

**6. RECYCLE COMPRESSOR TRIP.** K-501 trips. Loop pressure collapses, hydrogen at the bed falls off a cliff, the bed cools. The counterintuitive part is the direction — TI312 falling — and the operator may add heat, then the machine is restarted into a hot bed with full hydrogen. **Needs no surge model to be a superb drill.** And the pre-trip version is better: LIC503 climbing toward the compressor with a stuck drain, three minutes to decide to trip it yourself and take a plant outage rather than let liquid reach the impeller. Taking a certain large loss to avoid a probable larger one, on a clock.

**7. QUENCH LOST FROM ANOTHER UNIT.** V-502 loses level; FIC313's quench header runs dry; TI312 climbs with nothing wrong on U3's own board. The cause is in U4, the alarm is in U3. *Impossible today: FIC313's quench comes from nowhere.*

**8. FROZEN PURGE ANALYSER — the bridge to the A-drills.** `FROZEN_MEASUREMENT` on `XMTR-AI508`. **Zero new fault definitions needed** — `src/fault-engine.js` targets node *kinds*, and `src/topology.js` derives a transmitter node for every new point automatically. AI508 reads a comfortable purity forever while the loop degrades. The only independent evidence is PIC505's make-up demand and AI608 disagreeing with the analyser. This is exactly the A-series cause-versus-symptom lesson attached to a real process consequence for the first time.

---

## 8. BUILD PLAN

Effort in focused engineer-days. Every stage leaves the sim shippable.

> **Status, 2026-09-02 (MacBook seat, claude-fable-5-1), branch `feat/stage0-process-description`.**
> Stage 0 has landed: §2.1, §2.3–2.6 and §2.9 in commits `f6c8c69` / `3cd6aaf`; §2.2 (PROC dialog,
> command `PROCESS`, the three orientation chips and their `topics()`), §2.7 (E-301 sign, both prose
> surfaces) and §2.8 (derived alarm-help coverage gate) in the tree with this note. Stage 1 has
> landed except the decision that is Anthony's: GATE 3 fixed and proven both ways -- the start
> (`presetBaseT` is `P.t`; snapshot `wall` is caller-supplied) and the replay (the verify pass
> found `step()` capturing `P`/`L` before applying a replayed drill start, a one-step generator
> phase slip; fixed, and the regressions now compare the full trajectory), the `moveValves`
> guard with `MODEL_VALVES`,
> `Topology.validate()` wired into `initSim()` with the `unitOf` catch-all removed, and RESOURCES
> §4 split into 4.1–4.11 with every citation made specific and a gate-5 test refusing the bare id.
> **Not done, by design:** the golden-baseline archive (§10 Q2) -- nothing in Stage 1 re-captured a
> v2 fixture, so the decision is still open and still Anthony's. Details in `CHANGELOG.md` 3.1.0.
> **Waiting on that decision, with the change already written and measured:** flooring the R-310 bed
> reading at its inlet (`src/models.js fixedBed`, one line) moves three v2 goldens (D12, `air`,
> `bedact`); see CHANGELOG 3.1.0 known limitations. The 2026-09-03 veteran review that found it also
> found the operating story contradicting the model on feed, quench, fouling and fail-safe direction;
> all of that was prose and is fixed.

### STAGE 0 · SHIP NOW — 4-6 days

§2 in full. Zero new tags, zero goldens moved. Fixes both demo complaints. **Do this first regardless of every decision below.**

### STAGE 1 · FOUNDATION — 5-7 days, no new units

Everything here is pure risk reduction and each item is independently valuable.

**GATE 3 is already red and must be fixed before anything else.** `tests/release-gates.test.js` is uncommitted-modified in your tree and its new subtest at `:211` fails with *"the trainee drill-start path made 6 wall-clock reads … 6 !== 0."* Root cause, traced: `const presetBaseT=Date.now();` at `Experion Station Simulator.dc.html:2891` (D-drills) and `:3637` (A-drills). `applyPreset()` at `:3107` already accepts `baseTime` and threads it to `initSim()` at `:3112` — the plumbing exists; the two call sites read wall clock. Replace them with the current simulation clock. **Every new unit adds a preset, so every new drill would inherit a known-broken replay.** Half a day.

**`moveValves` NaN guard.** `src/models.js:251-263`: the loop is `for (const k in V)` but `tgt` at `:253-257` is a closed literal of the ten current valves. A valve added to `this.V` with no `tgt` entry gets `g === undefined`, and `clamp` at `:102` does not guard NaN, so `v.pos` silently becomes NaN, `makeSnapshot` throws on a non-finite value, and every snapshot / backtrack / replay / instructor test collapses. A prior probe measured this single omission at 98 failures. Twelve new valves are twelve chances to hit it. **~20 lines: derive the target map, or `if (g === undefined) continue;` plus a test.** Highest value-per-line in the whole plan.

**Wire `Topology.validate()` into `initSim()`.** It is a genuine, non-vacuous contract check at `src/topology.js:320-374` with positive-control tests, and grep confirms **nothing calls it at runtime.** Without it, a new tag missing from `unitOf` (`:2725-2730`, catch-all `return 'U1'` at `:2728`) silently files under U1, `validate()` still returns clean, and `blastRadius('CTRL-U1')` starts including separator tags — which would teach a trainee that losing U1's controller takes down U4. ~15 lines converts a silent failure into a loud one.

**Restructure `docs/RESOURCES.md` §4 into `### 4.1 … 4.n` subsections.** Verified: §4 is at `docs/RESOURCES.md:167` and is a single flat table with **zero** `### 4.x` headings. `tests/provenance.test.js:25-33` resolves `RESOURCES-<n>` against `## n` / `### n.m` only, so every source in §4 collapses to the one id `RESOURCES-4`, and any new model can pass GATE 5 by claiming it. That is laundering, not provenance. Register each source as its own subsection **before a line of new physics is written** — which is what `docs/dev/V3-PLAN.md:264` already told the team to do.

**Golden governance decision.** `tests/golden-upsets.test.js:5` states that re-capturing destroys the S0 v2 baseline the stage exists to create. Before the first re-capture, copy the 35 fixtures verbatim to `tests/fixtures/v2-baseline/` with a README saying what they froze and when. Costs nothing, preserves the honest record, removes the reason to hesitate. **This is your call, not an engineering chore.**

**Alarm-help coverage gate and process-text consistency gate** (§2.8, §2.9), if they slipped from Stage 0.

### STAGE 2 · U4 SEPARATION AND RECYCLE — 15-20 days

The unit you asked for, minus the column.

- **Physics** (~200 lines in `src/models.js`): V-501 hot split; V-502 three-phase with Stokes settling, carryover/carry-under and the DP interface; two-component recycle gas balance with generation and purge; K-501 characteristic plus run/trip; the one-term `pH2F` factor on `src/models.js:497`; `PARAMS.U4`; `createState` additions following the `P.b` / `P.h` nesting convention at `:214-227`; `measureU4`; export at `:532`. **Add all seven valves to the `tgt` map.**
- **Tag database** (10 points, 7 valves, 1 motor at `:1720-1749`), plus ~28 alarm conditions.
- **The ~14 hardcoded enumerations that fail silently:** `unitOf` `:2725-2730` (edit *first* — the U1 catch-all swallows new tags), `pidOrder` `:2798` (a loop not listed **never executes**), `histTags` `:2549`, `valveMap` `:2595` **and** its duplicate literal at `:2756` **and** `Topology.VALVE_OF` at `src/topology.js:51-54` (three copies, one validated), `assetTree` `:2369`, `builtinViews` `:2409`, `trackerLanes` `:2449` (unlisted units are **silently dropped** from the KPI tracker at `:2451`), `TGS` `:4464`, `utabs` `:4656`, `isG4` `:4764`, View menu `:4359`, `sysLinks` `:4735`, `runCmd` `:4098`, `peakOf` `:2731`, `casMap`/`invMap` `:2793-2794`, and `Topology.UNITS` at `src/topology.js:46`.
- **Graphic:** one `<sc-if value="{{ isG4 }}">` block, ~130-150 lines of hand-drawn SVG plus `gv4`/`vl4`/`gfx4` coordinate tables. **Draw it once with the column in place** so Stage 3 is data, not artwork. The moving water interface on V-502 needs two fill rectangles and a boundary line — genuinely new geometry. `mkGv` / `mkVl` at `:4390-4407` are free.
- **Authored prose — the real cost:** ~30 `src/alarm-help.js` entries × four fields = ~120 sentences at the standard of the existing V-401 block (`:154-207`), plus `EQUIPMENT_TRIPS` for PSV-502 and the K-501 trip, plus `dasRules()` entries at `:2462-2470` so a lost interface does not annunciate twelve consequential alarms.
- **Faults:** 3 new process upsets (emulsion, boot plug, blow-by), each needing an `upsetDefs()` row at `src/instructor.js:270`, a hardcoded `F.<key>` branch in models.js, a `PARAMS` magnitude, and a `UPSET_CLASS` ruling in `src/upset-bridge.js` — which is an architect's ruling of record gated by `tests/upset-class-honesty.test.js`, so it is calendar time, not engineer-days. **Zero new architecture fault definitions** — the fault engine targets node kinds.
- **Tests:** re-capture 35 goldens under the two-independent-construction protocol; hand-edit ~22 measured baselines across 9 files (114 nodes → ~140, 247 edges → ~290, the per-layer `deepEqual` at `tests/topology.test.js:157-161`, 24 points → 34, 12 command paths, 84 applicable paths, 10 `VALVE_OF` entries); 2 new presets; 2-3 D-drills (each needs a `dAct` branch at `:2939`); 1-2 A-drills (cheap — `buildDrill` generates the whole rubric from a ~15-line spec).
- **Calibration.** Not free, and no candidate design budgeted it. The repo's own comments show the rate: `src/models.js:315-316` records B4 tuning `vap` so PIC401 alarms inside the drill window; `PARAMS.U1.coolBackupMs` records a 2026-08-29 QA finding that drill D4 could not be passed by its own recommended action. Eight scenarios that must each reproduce a described signature inside a drill window is **~4-5 days on its own.**

### STAGE 3 · T-601 STABILIZER — 12-15 days

8 points, 5 valves, ~22 conditions, ~22 help entries, the `TIC601 → FIC602` cascade, an LP steam utility boundary condition (the reboiler needs a heat source and this board has none — one PARAMS entry plus a line in the orientation document), Column A compartment-lumped to 8 stages, Souders-Brown/Fair flooding and the weep point, a lined-out column preset (a cold column cannot start a drill), and **numerical validation at speed ×5 against `tests/models.test.js:251`.** Graphic is data only — the artwork landed in Stage 2. Second golden re-capture.

### DEFERRED, NOT DESIGNED HERE

Product fractionation. An electrolyser block. The data-driven mimic renderer — the finding is correct and I verified `support.js`'s `walkFor` has no child cap, but it pays for itself at unit five and this plan has four. **It becomes a hard prerequisite for any expansion past U4.**

### Sequencing constraint

`Experion Station Simulator.dc.html` is 5,102 lines in one React component. It is a **single-writer resource** — this cannot be fanned out to parallel agents at the page level, and `tests/release-gates.test.js:445-500` exists because three commits on this branch shipped a page calling methods it did not define. Every stage ends with `python3 tools/stamp-model-id.py`, `tools/build-dist.py`, `tools/smoke.sh`.

**Totals: Stage 0, 4-6 days. Stage 1, 5-7 days. Stage 2, 15-20 days. Stage 3, 12-15 days. About 36-48 engineer-days for the whole thing.** At evenings and days off, Stage 0+1 is two to three weeks and the full plant is five to seven months. **Stage 0 alone fixes the demo failure.**

---

## 9. RISKS AND WHAT I WOULD NOT DO

**1. The prose is the product and it is the thing that will slip.** ~52 alarm-help entries and ~210 authored sentences is more writing than coding, and until §2.8 lands there is no gate forcing it — an unauthored condition degrades to a polite generic paragraph. If this ships with 50 new alarms and 15 help entries, veterans will conclude the sim got wider and shallower. This is the single most likely way to reproduce the original failure at double the surface area.

**2. A fatal flaw that survived into this plan, named.** The candidate designs' three-phase separator was fed liquid water from a 180 °C / 600 kPa drum where water is steam. I moved the boot to a cold separator at ~45 °C, which fixes it structurally. **But that fix depends on hydrodeoxygenation in R-310 making enough water to be worth a boot**, and R-310's existing model has no water make at all — it is a lumped exotherm. The water rate is therefore a new stoichiometric term I am adding and calibrating, not something the existing model produces. It is defensible (HDO makes water stoichiometrically) and it belongs on the INVENTED list. If the calibrated water rate turns out too small to give the interface loop anything to do, the interface training content weakens and Stage 2's centrepiece needs re-scoping. **Check this in the first two days of Stage 2, before the graphic is drawn.**

**3. Column stiffness at speed is argued, not tested.** `dt` is pinned at 0.5 s at every multiplier (`:2533`) and Column A's fastest mode is ~3.8 s, so `dt/τ ≈ 0.13`. Sound reasoning; untested. If it misbehaves, the fallback is a 3-section lumped column — cheaper, weaker teaching object.

**4. Performance is unmeasured.** `renderVals()` rebuilds every binding on every `setState` at 500 ms, `tick()` runs up to five `step(0.5)` calls per tick, and this plan takes the board from 24 points to 42. **This is why I refused a per-tick flash solver.** It should still be profiled once in Stage 2.

**5. Alarm load.** ~52 new conditions on top of 53 nearly doubles the annunciated surface, and a flooding column or a lost interface will produce a genuine flood. That is realistic, and it is exactly what the ISA-18.2 / EEMUA KPI display measures. Author `dasRules()` in the same commit as the alarms or the KPI screen will show the trainer failing its own alarm philosophy — and a veteran will notice and enjoy pointing it out.

**6. Things I am accepting as disappointments, deliberately.** No compressor surge model — a rotating-equipment operator will ask within minutes and the answer must be "not modelled." No property package. No rag-layer chemistry (the *phenomenon* is modelled as an interface-measurement error; the emulsion itself is not). The carryover curve shape is mine; the Stokes criterion is published. Every one of these goes on the INVENTED list in the models.js header **and** in the fidelity section of the orientation document.

**7. What I would not do.** I would not renumber unit ids or equipment tags. I would not replace V-401's calibrated `vapf` line. I would not build ten units. I would not put the recycle loop on R-201. I would not put the purge on pressure control. I would not fake surge. I would not build the mimic renderer yet. And I would not add a retrieval tool to the coach — `tests/coach-sidecar.test.js:260-264` asserts the local model request carries no `tools` key, and PIP is deliberately tool-free.

**8. Proprietary boundary — held by construction, not by intent.** Generic textbook unit operations only. Every model cited to a registered public source. All conditions re-anchored to the simulator's own operating point. Nothing about catalyst composition, real reactor conditions, real conversion or selectivity, real recycle ratios, real separation-train arrangement, capacities, yield curves or cost structure. Carbon dioxide capture, electrolysis, oxygen handling and hydrogen compression are off board. The disclaimer sits in the first paragraph of the orientation document, in the `models.js` header, on the U4 graphic footer, and in the About dialog — extending the existing discipline at `src/alarm-help.js:10-12` and `src/topology.js:63-74`.

Two operational notes. **Do not commit the company's name to `serve.py`'s BANNED list.** That writes it permanently into a public repo's git history in the same commit explaining why it must never appear. Use a salted hash, or load the list at runtime from outside the tree, or match a generic pattern. And extend the existing "Greene Street" grep precedent in `tests/provenance.test.js` to cover employer and site names across the shipped artifacts.

The risk here is not that the design crosses the line — it does not. It is that five months of incremental authoring drifts across it one sentence at a time. That is a permanent control, not a one-time check.

**9. `docs/dev/V3-PLAN.md:264` is a standing architect's ruling** naming Tennessee Eastman as the source for a recycle unit and requiring registration in RESOURCES.md **before writing a line.** This plan follows it. If a future stage wants to deviate, argue against the ruling on the record rather than routing around it.

---

## 10. OPEN QUESTIONS FOR ANTHONY

1. **Does the plant make its own hydrogen?** I put electrolysis, CO2 capture and the hydrogenation block off board at the battery limit. That is honest scoping and it keeps the build to four units. Adding an electrolyser (Ulleberg 2003 is a real published model, and the crossover-at-turndown hazard is a genuine operator lesson) is a fifth unit, roughly +15 days, and it makes the "power-to-liquids" framing complete rather than partial. **Your call on whether the framing needs it.**

2. **The golden baseline.** `tests/golden-upsets.test.js:5` says re-capturing destroys the S0 v2 baseline the stage exists to create. This plan re-captures twice. Do you want the v2 fixtures archived to `tests/fixtures/v2-baseline/` as a read-only historical artifact first, or is the baseline retired once the plant is deliberately different? **This must be decided before the first new tag is added, not discovered after.**

3. **Fidelity ceiling on the separators.** I chose no property package and no flash solver — temperature-driven condensation with a declared ceiling, so the numerics stay boring and the page stays fast. The alternative buys compositional realism at the cost of a Newton solve per vessel per tick and a real chance of instability at speed. **Are you comfortable defending "no property package, and here is why" to a HYSYS-fluent operator?** I think yes; you are the one who will be in the room.

4. **Stage 3 or stop at Stage 2.** Stages 0-2 give you an orientation document, a working coach, a three-phase separator with real interface control, a recycle loop with purge and inert accumulation, and eight new scenarios. The column adds flooding, product spec and the reflux/reboiler fight — the largest single class of process control an operator does — for another 12-15 days and the plan's highest numerical risk. **Both are shippable products; only you know whether the next demo needs a column.**

5. **Who writes the 210 sentences.** This is the bottleneck and it cannot be delegated to anyone who does not know the process. If it is you, five to seven months is realistic. If it is not, tell me who and I will restructure Stage 2 around review rather than authorship.