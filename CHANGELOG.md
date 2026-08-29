# Changelog
All notable changes to the simulator. Semantic versioning.

## [1.1.0] — 2026-08-29
### Added
- Unit 02: semi-batch polymerization reactor (R-202) — SCM202 sequence (CHARGE→HEATUP→FEED→REACT→COOL→DRAIN), agitator M-202, program-driven monomer SP (MODEATTR=PROGRAM), monomer-accumulation model with 110 °C trip
- Unit 03: fired preheater (H-310, TIC311) + exothermic fixed-bed reactor (R-310, TI312 hotspot) with quench loop FIC313 and 480 °C fuel trip
- Ops Assistant dock: live rule-based diagnosis (trips, runaway risk, bad PV, stuck valves, saturation, broken cascades, alarm floods, lockouts) with step-by-step guidance and GO navigation; ask-a-question topic matcher
- Indication-only (DACA) faceplates for FI100 / PI214 / LI215 / TI312 with alarm ticks and Point Detail Alarm/Chart tabs
- Drills D11 (agitator trip mid-feed, auto-starts a batch) and D12 (catalyst activity surge)
- Trend groups TG04 (batch) and TG05 (fired reactor); instructor faults for agitator trip and bed activity
- Unit tabs on graphics; command-zone `U1`/`U2`/`U3`/`ASSIST`

## [1.0.0] — 2026-08-28
### Added
- Station chrome: menu bar, toolbar, command/message zones, flashing alarm line, status bar with security level
- Five-loop continuous unit (U1) with exothermic CSTR cascade, FOPDT dynamics, Experion-form PID (K, T1/T2 minutes, anti-windup, bumpless, INITMAN)
- Alarm Summary (shelving with time-box + auto-ack), Event Summary with old/new values, Message Summary, 3 trend groups, Point Detail (Main/Alarms/Loop Tune/Chart/Control Module), System Status
- Station-based security levels (oper/supv/engr/mngr), ENGR-gated tuning
- Six scored drills with ASM-style debrief; hidden instructor panel with 9 faults + sim speed
