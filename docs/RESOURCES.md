<!-- @artifact production -->
# Experion Station Sim: Resource Guide

> Repo copy. Section 3 has its links withheld on purpose: those locations host proprietary Honeywell material and, per the rule in that section, are not linked from this repository. The maintainer keeps the unredacted copy outside the repo. Colours, names and behaviours cited from Honeywell public spec sheets are reference only; no Honeywell text, tables, screenshots or artwork are reproduced here or in the simulator.

Compiled 2026-08-29 from six verified search angles. Every URL below was fetched or returned by a search during the research pass. Licence lines are stated honestly; nothing in the "reference only" tier may be copied, linked from the repo, or vendored.

## 1. Does Honeywell have a GitHub / public code?

No. The official `github.com/honeywell` organisation exists but has zero public repositories (verified via `gh api orgs/honeywell`, `public_repos: 0`), and `HoneywellConnectedEnterprise` likewise has none; no org named Honeywell-Inc, HoneywellProcess, honeywell-forge, honeywell-process-solutions or honeywellconnected exists. Honeywell publishes no Experion, HMIWeb, Control Builder or ControlEdge code, samples or SDKs on GitHub or GitLab, and no public REST/GraphQL API documentation exists for Experion R520/R530 (the only official data paths are OPC UA, ODBC, Excel Data Exchange and the Network/Server API named in the spec sheets). All fidelity therefore has to come from Honeywell's freely downloadable marketing/spec PDFs, open standards, and independent modelling. Record this so future sessions do not re-search it.

## 2. Use freely

Ranked by how much each would improve the simulator. "Official Honeywell public" documents are copyrighted marketing/spec material downloadable without login: use numbers, names and behaviours as reference; never reproduce text, tables, screenshots or artwork.

### 2.1 Experion LX HMI Specification LX03-200-530 (Release 530, Nov 2024, 61 pp)
- URL: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pmc/modular-systems/experion-lx/hon-ia-pmc-experion-lx-hmi-specificationsheet-en.pdf
- Older R520 edition: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pmc/field-instruments/pmt-hps-lx03-200-520-experion-lx-v01-0.pdf
- Licence: official Honeywell public spec sheet, copyrighted, no login. Reference for numbers and names only.
- Verified content: priorities "Journal, Low, High to Urgent" plus alarm sub-priority 0 to 15; up to two events per alarm (enter and return-to-normal); point script triggers OnAlarm / OnNormal / OnAcknowledge / OnTimer / OnChange / OnOperChange; VBScript server scripting "typically less than 50 lines"; limits 4,000 active alarms, 1,000 messages, 32,767 SOE, 1.2 million events; 32 pens per trend set, trend periods 1/5/20 min; per-point parameters Operator Control Level, Control Inhibit, Control Confirmation, Control Deadband, PV Fail Alarm; "up to 4 native windows or 16 using SafeView"; licence option names LX-ALMTND Alarm Tracker, LX-SVALGP Alarm Shelving, LX-PZE000 Station Pan and Zoom, LX-ADSP01 Advanced HMIWeb Solution Pack; OPC UA v1.04 DA/HA, ODBC, Excel Data Exchange.
- Concrete change: add sub-priority 0 to 15 to every alarm record and use it as the secondary sort key in the Alarm Summary; emit two journal events per alarm (enter, RTN) and log logins, operator actions and config changes to the same event file.

### 2.2 Experion Alarming Product Information Note (PN-12-29-ENG, June 2012, 3 pp)
- URL: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/experion-pks/operations/operator-stations/pmt-hps-experion-alarming-pin.pdf
- Licence: official Honeywell public PIN, copyrighted, contains screenshots (do not reuse).
- Verified content: location/asset pane with one-click filtering and active counts; customizable columns including trip value and live value; saved custom views; repeat-alarm folding with first time, last time and count; per-alarm comments; Alarm Help tab (cause / impact / recommended action); shelving via right-click with a separate shelved view and manual or timer-based un-shelve; Dynamic Alarm Suppression with a tab listing suppressed and suppressing alarms, cleared when the trigger returns to normal; Alarm Tracker (per-unit tracks, real-time region right, historical left, click a cluster to filter).
- Concrete change: implement auto-unshelve timer, a separate Shelved view, a DAS tab with trigger plus follow-on alarms, repeat-alarm collapsing, and an Alarm Help pane on the Point Detail alarm tab.

### 2.3 Experion HMI Product Information Note (PN-13-07-ENG, Oct 2013, 5 pp)
- URL: https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc-list-migration/Asset-Experion-HMI-PIN.pdf
- Licence: official Honeywell public PIN, copyrighted, screenshots not reusable.
- Verified content: Console Station (direct controller access, console-based ack, audible annunciation) vs Flex Station (cached server access); Station-based vs Operator-based security with change of user without loss of view; toolbar for silence/ack and display call-up; message zone; status bar with active alarms and system faults; Operator Callouts attached to the object when an entry is rejected; tabbed navigation with alarm indication; SafeView workspaces; built-in display set (alarm summary, trend, system status, operating groups, point detail, faceplates, loop tuning); ASM colour rules (bright colour only for alarms and process data, equipment in shades of the background, animation only for critical info); 32-parameter trends with events, zoom box, drag-and-drop.
- Concrete change: add a message zone plus status-bar alarm counts, Operator Callout style inline rejection on out-of-range entries, and a Station-based vs Operator-based logon toggle.

### 2.4 Rockwell Automation Process HMI Style Guide (PROCES-WP023A-EN-P, May 2019)
- URL: https://literature.rockwellautomation.com/idc/groups/literature/documents/wp/proces-wp023_-en-p.pdf
- Licence: free public vendor white paper, Rockwell copyright and PlantPAx branding; colour values are facts and may be adopted, prose/screenshots may not.
- Verified content: ISA-101 aligned palette with hex values: background #E0E0E0, lines/equipment #A0A0A4, Low magenta #916AAD, Medium yellow #F5E11B, High orange #EC8629, Urgent red #E22028, stopped #808080, running #F0F0F0, manual/transition #93C2E4; Level 1 to 4 display hierarchy; sections on alarm summary configuration, alarm banner, faceplate alarm tab, audible tones, shelving depiction.
- Concrete change: replace guessed Honeywell colours with this documented, standards-aligned four-priority palette and cite it in the README as the sim's colour philosophy source.

### 2.5 alerta ISA-18.2 alarm state machine (Apache-2.0)
- URL: https://github.com/alerta/alerta/blob/master/alerta/models/alarms/isa_18_2.py
- Licence: open source, Apache-2.0 (2,528 stars). Port to JS with attribution and NOTICE retention.
- Verified content: states NORM, UNACK, ACKED, RTNUN, SHLVD, DSUPR, OOSRV; transitions for ack/unack, re-alarm on more severe, RTN from ACKED to NORM and UNACK to RTNUN, shelve from any state, unshelve to NORM or UNACK depending on live state. No transitions into DSUPR/OOSRV are coded and there is no shelve timeout, so add those yourself.
- Concrete change: rewrite the alarm engine around this state table, adding RTN-unacknowledged and out-of-service as first-class states, with unit tests transliterated from the transition list.

### 2.6 Siemens white paper "Setting a new standard in alarm management" (2022, UNRESTRICTED)
- URL: https://assets.new.siemens.com/siemens/assets/api/uuid:e35e8dba-e98d-442a-8d52-fbc0a13c22ab/simatic-pcs-7-alarm-management.pdf
- Licence: free public download, Siemens copyright, tables footnoted to ISA-18.2; reference only, no screenshots.
- Verified content: per-state indication table (Unacknowledged = audible + colour + symbol + blink; Acknowledged = colour + symbol, no blink; Shelved/Suppressed/OOS = no audible, no blink); deadband and on-delay examples (flow 5% / 15 s, level 5% / 60 s); shelving UX (reason dialog, shelved icon active only when shelved alarms exist); stale threshold >24 h.
- Concrete change: blink only while unacknowledged, silence on ack, add per-tag deadband and on-delay to stop chattering, and add a reason prompt to the shelve dialog.

### 2.7 exida white paper "Alarm Management and ISA-18: A Journey, Not a Destination"
- URL: https://www.exida.com/articles/ALARM-MANAGEMENT-AND-ISA-18-A-JOURNEY-NOT-A-DESTINATION.pdf
- Licence: free download, exida copyright 2018-2020; the KPI table is ISA-derived, quote numbers with attribution.
- Verified content: ~150/day acceptable vs ~300 manageable; ~1 vs ~2 per 10 min; max 10 per 10 min; flood <1% of time; top-10 alarms <1 to 5% of load; chattering zero; stale <5/day; priority split ~80/15/5 (plus <1% highest with four priorities).
- Concrete change: an alarm-health KPI panel and drill scoring thresholds using these numbers.

### 2.8 UvEternity/alarm-performance-analyser (MIT)
- URL: https://github.com/UvEternity/alarm-performance-analyser
- Licence: MIT, Python stdlib only.
- Verified content: flood (10 in 10 min), chattering (3+ in 60 s), stale (>24 h), bad actors, 80/15/5 check; references/benchmarks.md documents each threshold. Note it has no Honeywell-specific parser despite the README claim; column matching is generic.
- Concrete change: export the event journal as CSV in a shape this tool accepts, and port its metric definitions into the drill scorer.

### 2.9 Vanderhell/loxalarm (MIT)
- URL: https://github.com/Vanderhell/loxalarm
- Licence: MIT, C99.
- Verified content: single-alarm lifecycle with on_delay_ms, off_delay_ms, latch-until-ack, shelve with max_shelve_ms timeout, states NORMAL/ACTIVE/LATCHED_RETURN/SHELVED/OUT_OF_SERVICE.
- Concrete change: on/off delay and maximum shelve duration semantics, small enough to transliterate to JS alongside the alerta table.

### 2.10 PAS / Hollifield free white papers on isa.org
- HMI: https://www.isa.org/getmedia/06130a38-f7af-4b35-8c9c-2c34f25c1977/The-High-Performance-HMI-Overview-v2-01.pdf
- ISA-18.2: https://www.isa.org/getmedia/55b4210e-6cb2-4de4-89f8-2b5b6b46d954/PAS-Understanding-ISA-18-2.pdf
- Licence: free downloads, PAS copyright 2010/2012; principles only, no figures.
- Verified content: alarm indicator next to the value flashes while unacknowledged then stays steady; redundant priority coding (colour + shape + text); status by brightness plus a word, not red/green; right-click rationalisation pop-up (Priority, Setting, Response Time, Consequences, Causes, Corrective Actions).
- Concrete change: rationalisation pop-up fields on each alarm, which double as drill rubric items.

### 2.11 ASM Consortium papers hosted by Honeywell
- Why Gray Backgrounds (Bullemer, Reising, Laberge, 2011): https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/February%2028%202011%20-%20Why%20Gray%20Backgrounds%20for%20DCS%20Operating%20Displays.pdf
- Operator Interface Requirements (2009, 30 pp): https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/January%2017%202009%20-%20Operator%20Interface%20Requirements.pdf
- Alarm Management and Operator Graphics (Andow, Honeywell, 2005, 52 slides): https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/presentations/May%2026%202005%20-%20Alarm%20Management%20and%20Operator%20Graphics.pdf
- Licence: publicly hosted; Gray Backgrounds has no explicit licence line ("sponsored by ASM Consortium"), the 2009 paper is "(c) 2009 ASM Consortium all rights reserved", the Andow deck is "(c) 2005 Honeywell". Cite, do not copy figures.
- Verified content: luminance-contrast rationale for grey; overview vs equipment-detail vs task-based displays; ~5% Urgent / 10% High / 85% Low; the limit ladder Range High, Critical High, Standard High, Target High, Target Low, Standard Low, Critical Low, Range Low mapped to PVHH/PVHI/PVLO.
- Concrete change: a "why the screens look like this" help page citing these, and a Range/Critical/Standard/Target limit band on overview shapes.

### 2.12 Honeywell Academy public catalogue and course outlines
- E-Learning catalogue Rev37 (7/15/2026): https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/training/documents-and-downloads/honeywell-academy-e-learning-subscription-services/Honeywell-Automation-E-Learning-Courses.pdf
- EXP-01: https://process.honeywell.com/content/dam/process/en/documents/training-docs/control-monitoring-and-safety-systems/exp/EXP-01-Experion-PKS-Fundamentals-Controller-Operation.pdf
- EXP-01OR: https://process.honeywell.com/content/dam/process/en/documents/training-docs/control-monitoring-and-safety-systems/exp/EXP-01OR-Experion-PKS-Fundamentals-Controller-Orion-Operation.pdf
- EXP-26: https://process.honeywell.com/content/dam/process/en/documents/training-docs/control-monitoring-and-safety-systems/exp/EXP-26-Experion-PKS-Fundamentals-SCADA-Operation.pdf
- MT modules (verified 200): EXP-7009, 7010, 7013, 7017, 7019, 7020, 7021, 7043, 7044, 7045, 7054, 7055, 7058, 7059 at `https://process.honeywell.com/content/dam/process/en/documents/training-docs/control-monitoring-and-safety-systems/mt/EXP-70xx-MT-<title>.pdf` (example: https://process.honeywell.com/content/dam/process/en/documents/training-docs/control-monitoring-and-safety-systems/mt/EXP-7010-MT-Experion-PKS-Assets-And-Operator-Configuration.pdf). EXP-7012-MT 404s at the guessed filename despite appearing in one angle's fetch; treat that one as unverified.
- HAC certification PIN: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/training/documents-and-downloads/honeywell-automation-certification-(hac)-program/Honeywell-Automation-Certification-Program-Experion-PKS.pdf
- Licence: official public catalogue pages, copyrighted; the courses and videos are paid. Use titles and objectives as a feature inventory only.
- Verified content: 49 "Experion Station Operator Videos" titles (Command zone, Online Data Search, Equipment Summary/Detail, Electronic Signatures, disabling alarms for an asset, alarm and event comments, Message Summary silence/ack/confirm, System Status, SCM detail, export/print); EXP-01 objectives include "control conventions (automatic, manual, cascade, PV tracking, and program)", Advance Parameter Security, Procedural Operations Interactive Instructions; HAC uses an 80% pass mark, 3-year validity, 90-day retake.
- Concrete change: a coverage matrix mapping scored drills to the 49 operator tasks; add PV tracking and PROGRAM to the mode list; 80% drill pass threshold (labelled independent, not HAC).

### 2.13 Experion HS PIN, Experion SCADA PIN, Experion HS brochure
- HS PIN: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pmc/modular-systems/controledge-plc/Experion-HS-PIN.pdf
- SCADA PIN: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/experion-elevate/pmt-hps-experion-scada-pin.pdf
- HS brochure: https://process.honeywell.com/content/dam/process/en/documents/downloads/Expeion-HS-03.pdf (typo is Honeywell's)
- Licence: official Honeywell public marketing, copyrighted, screenshots not reusable.
- Verified content: "alarm tracker, dynamic alarm suppression and alarm shelving"; inbuilt management of change "who changed what & when"; Trend with Events; VBScript and JScript as HMIWeb scripting languages; 32 pens per trend; alarm management aligned to EEMUA 191, ISA-18.2, API RP 1167.
- Concrete change: MOC-style audit entries in the event journal for engr/mngr configuration edits.

### 2.14 Honeywell Forge Process Training Simulator PIN and Workforce Competency white paper
- PTS PIN (July 2020): https://hcenews.honeywell.com/rs/093-RAU-212/images/Honeywell_Forge_Process_Training1_Simulator-PIN.pdf
- White paper (2021): https://hcenews.honeywell.com/rs/093-RAU-212/images/Honeywell_Forge_Workforce_Competency-High_Fidelity_Simulation.pdf
- Control Global HUG 2026 article: https://www.controlglobal.com/show-coverage/honeywell-users-group/article/55383764/honeywell-charts-path-to-accessible-simulation-training
- Licence: official Honeywell public marketing (feature list only); Control Global is public trade press, cite as observed.
- Verified content: instructor station with snapshots, initial conditions, backtracks, freeze/step/fast time, upsets, instructor variables, performance assessment; SimC300 + Experion Station architecture; training progression detect deviation, handle alarms, diagnose cause; Honeywell's own next-gen OTS HMI is browser-based with reusable trend and alarm components.
- Concrete change: an instructor mode with snapshot/backtrack/freeze/fast-time and hidden upsets separate from the trainee view.

### 2.15 Experion Operations Assistant brochure and press release
- Brochure: https://process.honeywell.com/content/dam/process/en/documents/document-lists/hon-ia-hps-bro-experion-operations.pdf
- Press release (19 Mar 2026): https://www.honeywell.com/us/en/news/press-releases/2026/03/honeywell-unveils-commercial-launch-of-ai-powered-control-room-assistant-following-successful-pilot
- Licence: official Honeywell public marketing, screenshots not reusable.
- Verified content: Operator Advisor Dashboard, Lookahead Runway, Alarm Assistance and Situation Guidance (critical parameters plus upstream/downstream impacts), Predictive Alerts, work instructions; pilot predictions 5 to 10 minutes before alarms.
- Concrete change: shape the rule-based Ops Assistant into those four surfaces (lower priority).

### 2.16 Orion Console PIN and white paper, C300 PIN, System HINTS newsletters
- Orion PIN (PN-12-23-ENG, 2014): https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/experion-pks/human-machine-interface-hmi/experion%C2%AE-orion-console/pmt-hps-pin-experion-orion-console.pdf
- Orion white paper (2015): https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/experion-pks/human-machine-interface-hmi/experion%C2%AE-orion-console/pmt-hps-experion-orion-console-whitepaper-final-sw.pdf
- C300 PIN (PN-12-49-ENG): https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/experion-pks/controllers/c300-controller/pmt-hps-exp_c300_pin.pdf
- System HINTS archive: https://process.honeywell.com/us/en/support/support-newsletters (June 2025 issue: https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_list_hints/2025/hon-ia-hps-2025-june-system-hints.pdf)
- Licence: official Honeywell public, copyrighted, reference only.
- Verified content: PIN describes a permanent plant-overview strip and pre-configured display sets per operating mode and an Alarm Light Panel; the white paper (not the PIN) names "Orchestration", "Integrated Limit Displays" and pan-and-zoom; C300 PIN confirms CM/SCM naming, CEE-supplied detail/group display templates, OperTune from standard PID displays; HINTS tracks R520/R530 naming.
- Concrete change: optional overview strip across the top with a virtual alarm light whose colour follows the highest standing priority; a Loop Tuning tab on PID Point Detail.

### 2.17 PlantCruise HMI Specification PC03-200-530
- URL: https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pmc/modular-systems/plantcruise-by-experion/hon-ia-pmc-plantcruise-by-experion-technical-note-en.pdf
- Licence: official Honeywell public spec sheet. Near-identical to the LX spec; keep only as a cross-check.

### 2.18 Small third-party GitHub items (conventions only)
- andreili/Honeywell-API-test, Unlicense (public domain) but compiles against proprietary SDK headers not in the repo: https://github.com/andreili/Honeywell-API-test. Use only the EPrmType parameter-type list (CHAR, INT2, INT4, REAL, DBLE, HIST, VAR, ENUM, DATE_TIME, STATUS, SRCADDR, DSTADDR, SERVAR, POINTREF, INT8, TIME, DELTATIME, TIMEOFDAY, ALARMHANDLE, POINTREF2; the source spells two of them with typos) for an engr-level parameter browser. Created 2018, not 2024.
- LP-Atkins/Honeywell-Experion-Utilities, no licence (all rights reserved), read only: https://github.com/LP-Atkins/Honeywell-Experion-Utilities. Shows real server-script idioms `Server.ParamValue("TAG.PARAM")`, `.DESC`, `.CHNLNAME.n`, `.INITREQ`, `Script.Timeout`.
- 40csmith40/Honeywell-IO-Browser, no licence, read only: https://github.com/40csmith40/Honeywell-IO-Browser. Shows the Control Builder XML export shape (Block, BlockDef, TemplateName, AssignedTo, Parameters).
- kotoba-lang/dcs, Apache-2.0: https://github.com/kotoba-lang/dcs. Data-first area/tag/loop/alarm schema with a pure PID; useful when refactoring the three units into declarative configs.
- FUXA, MIT: https://github.com/frangoteam/FUXA (alarm docs at docs/HowTo-setup-Alarms.md in the main repo). Generic SCADA; alarm history with ack attribution and a role model.
- OSHMI / json-scada, GPL-3.0: https://github.com/riclolsen/OSHMI and https://github.com/riclolsen/json-scada. Study only (copyleft); full alarms/events/tabular/trend viewer set.
- react-scada-hmi, MIT: https://github.com/CoffeESIME/react-scada-hmi. Small ISA-101 symbol set; LinearGauge does not actually expose HH/H/L/LL props.
- PackML-StateMachine, MIT: https://github.com/aljoshakoecher/PackML-StateMachine. PackML (not exactly ISA-88) state machine, reference for the SCM Hold/Restart/Abort logic.

### 2.19 Standards (purchase required, cite clause numbers only)
- ANSI/ISA-18.2-2016: https://www.isa.org/products/ansi-isa-18-2-2016-management-of-alarm-systems-for ; IEC 62682:2022 (CHF 380): https://webstore.iec.ch/en/publication/65543
- ISA-101 family: https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards (TR101.02 free TOC: https://www.grahamnasby.com/files_publications/ISA-TR101-02-2019_TOC-excerpt.pdf)
- ISA-TR18.2.6-2012 batch alarms: https://www.isa.org/products/isa-tr18-2-6-2012-alarm-systems-for-batch-and-disc ; free TOC https://www.grahamnasby.com/files_publications/ISA-TR18-2-6-2012_TOC-excerpt.pdf ; free InTech article with a state-based alarm limit table per batch step: https://www.grahamnasby.com/files_publications/NasbyG_2019_Alford-et-al_ApplyingAlarmManagement_InTech_jan-feb2019_article.pdf
- ISA-88 Part 1: https://www.isa.org/products/isa-88-00-01-2010-batch-control-part-1-models ; free NAMUR state-model alignment paper: https://atpinfo.de/wp-content/uploads/2024/09/WG-POSITION_MTP-ISA88-Synchronization_EN_2024-09-09.pdf
- ISA-106: https://www.isa.org/standards-and-publications/isa-standards/isa-106-standards ; free Yokogawa two-page TR1 summary (Manual / Computer Assisted / Fully Automated, example state diagram): https://web-material3.yokogawa.com/ISA_106_TR1_Infographic.us.pdf
- EEMUA 191 Ed 4 (GBP 205 non-member): https://www.eemua.org/products/publications/digital/eemua-publication-191 ; free contents PDF: https://www.eemua.org/getattachment/9d3f8071-55c3-49bf-a74a-3bf6ad4a2e0f/Contents-EEMUA-Publication-191-Edition4-November-2024.pdf ; free ProcessVue KPI paper: https://www.processvue.com/downloads/Alarm_system_performance_KPIs_V1_0.pdf
- NAMUR NA 102 (EUR 57.31): https://www.dinmedia.de/en/technical-rule/namur-na-102/117401738 ; free CERN overview deck tying the standards together: https://indico.cern.ch/event/1140188/contributions/4795047/attachments/2416095/4147080/2022_04_01_ICForum_CTTB_AlarmManagementStandards.pdf (warning: slide 4 links a CERN-hosted copy of ISA-18.2-2009; never follow or link that)
- Note: ISA product pages carry an explicit prohibition on feeding ISA text into AI tools. Implement the models, cite the clauses, never paste text.

## 3. Reference only, never copy

Rule for everything here: open it privately to check that a name, a mode semantic, an icon state or a behaviour in the sim matches real convention; then implement from scratch in the sim's own words and artwork. No text, tables, screenshots, frames or file names go into the repo, and no links to these locations appear in the repo, README, docs or issues.

- suifengtec/Honeywell-Experion-PKS-R431-Manuals: [URL withheld from repo] About 185 proprietary EPDOC PDFs (roughly 260 MB) re-hosted without permission, including HMIWeb Display Building Guide (EPDOC-XX54), HMIWeb Object Specification (X174), Solution Pack Operator and Alarm Philosophy (X173), Server Scripting Reference (X129), Operators Guide (XX80), Server and Client Configuration Guide (X127), System Alarms Reference (X140), Control Builder Parameter Reference (XX18). Likely to be DMCA'd. Default branch is "KyleDavis".
- ManualsLib Experion LX Operator's Guide (EXDOC-XX80-en-500A, R500, 331 pp): [URL withheld from repo] Host unstable (HTTP 525 on most fetches). A search snippet claimed it states that Urgent with sub-priority 15 renders as Critical when critical alarm support is enabled; that sub-claim is unverified.
- pdfcoffee copy of Server and Client Configuration Guide EP-DSXX26 R400 and idoc.pub copy of Control Builder Components Reference EP-DCX365 R311.2: exist, carry Honeywell non-disclosure text on the front matter. The verifier rejected these as sources; everything the sim needs is in section 2. Listed here only so nobody re-searches them.
- Scribd / manualzz / studylib / dgfg.nl / dcsmodule.com copies of the HMIWeb Display Building Guide, SIM-C300 User Guide, EXP01 student books and the Experion HS Application Development Guide: seen in search results, not verified, same rule. One snippet from these confirmed the Station security ladder VIEW Only < ACK Only < OPER < SUPV < ENGR < MNGR, which matches the sim.
- C300 Controller Capacity TI EP03-300-511 (July 2019): [URL withheld from repo] Publicly served but stamped "Honeywell Internal" / "Honeywell Proprietary" on every page. Useful facts (SIM-C300 runs a 50 ms base cycle, 20 ms not supported; max 15 parallel paths in an SCM) may be cited as numbers; do not quote, reproduce tables or link.
- ASM Consortium 2009 webinar slides (Effective Operator Display Design overview): [URL withheld from repo] Publicly served but page 1 restricts it to ASM member-company employees and every page is stamped "ASM Consortium Proprietary". Do not use.
- Third-party YouTube recordings of real Station screens (titles and channels verified via oEmbed, content not viewed): [URL withheld from repo] (Station and Detail Display), [URL withheld from repo] (tag search and alarm setpoint), [URL withheld from repo] (Control Builder / Quick Builder / HMIWeb tour), [URL withheld from repo] (architecture overview), [URL withheld from repo] (creating a PID), [URL withheld from repo] (alarm configuration in Control Builder), [URL withheld from repo] (Orion Console first look). Watch for a visual conformance review of faceplates, detail tabs and alarm summary; no frame capture, no embedding.
- Murdoch University theses (Lum 2011, 108 pp; Godfrey 2016, 181 pp): https://researchportal.murdoch.edu.au/view/pdfCoverPage?instCode=61MUN_INST&filePid=13136908250007891&download=true and filePid=13137021460007891. Author copyright, no CC licence. The prose is an independent, non-Honeywell description of SIM-C300, CEE, CM/SCM, PID mode attributes (Operator vs Program, MAN/AUTO) and cascade behaviour and may be cited; the embedded screenshots are Honeywell artwork and must not be reproduced.
- Honeywell screenshots inside otherwise-usable brochures (HS brochure, Operations Assistant brochure, Alarming/HMI PINs, Orion PIN): same rule, the screenshots are off limits even though the documents are public.

## 4. Better process dynamics

Twelve sources, each now its own subsection so each carries its own id. Code cites the specific model it implements — `RESOURCES 4.4` for the Henson/Seborg CSTR, `RESOURCES 4.2` for the Badgwell fired heater — not the section as a whole. A bare `RESOURCES-4` no longer discharges release gate 5 for a model: §4 is a registry of twelve distinct sources and a citation must name the subsection whose model it actually uses. Order and content are unchanged from the flat table this replaces; only the ids are new.

### 4.1 do-mpc industrial polymerization reactor (Lucia, Finkler, Engell)
- Resource: do-mpc industrial polymerization reactor (Lucia, Finkler, Engell, J. Process Control 23(9) 2013, DOI 10.1016/j.jprocont.2013.08.008)
- URL: https://www.do-mpc.com/en/latest/example_gallery/industrial_poly.html (parameters in examples/industrial_poly/template_model.py of github.com/do-mpc/do-mpc)
- Licence: Code LGPL-3.0; equations and parameters are published academic content, re-implement with citation, do not paste the file
- Unit upgraded: U2 semi-batch polymer
- What it gives: 8 ODEs (water/monomer/polymer mass, reactor, steel, jacket-out, EHE, coolant temperatures) plus accumulated monomer and adiabatic temperature safety states, 3 inputs, Arrhenius kinetics, 90 C +/- 2 C quality window. The adiabatic-temperature variable is a natural Urgent alarm / SHEDHOLD trigger; dosing phases map onto the SCM.

### 4.2 APMonitor Fired Heater case study (Badgwell)
- Resource: APMonitor Fired Heater case study (Badgwell)
- URL: https://apmonitor.com/dde/index.php/Main/FiredHeaterSimulation
- Licence: Public page, no licence statement; re-derive with attribution, ask before verbatim code reuse
- Unit upgraded: U3 fired preheater
- What it gives: Two-pass heater: MVs FC1, FC2, FG; DVs TI1, TI2; CVs TO, FO, DT, TS1, TS2 as transfer functions and a 36-state state-space model. Tube-skin temperatures become High/Urgent alarm candidates; feed TO into the existing fixed-bed model.

### 4.3 LearnChemE PFR and flash-drum demos
- Resource: LearnChemE ParametricSensitivityOfPFRWithHeatExchange and flash-drum demos
- URL: https://github.com/LearnChemE/LearnChemE.github.io (demos/ParametricSensitivityOfPFRWithHeatExchange, demos/AdiabaticFlashDrumWithBinaryLiquidFeed, demos/MultipleSteadyStatesInACSTR)
- Licence: No top-level LICENSE (root package.json says MIT, learnchemejs/LICENSE is MIT, per-demo terms unclear); treat as reference, re-derive textbook models
- Unit upgraded: U3 fixed-bed reactor and U1 flash drum
- What it gives: Validated numerics for hot-spot location vs coolant temperature (runaway in a cooled PFR) and an adiabatic binary flash with VLE.

### 4.4 APMonitor PDC exothermic CSTR (Henson and Seborg)
- Resource: APMonitor PDC exothermic CSTR (Henson and Seborg parameters)
- URL: https://github.com/APMonitor/pdc and https://apmonitor.com/pdc/index.php/Main/StirredReactor
- Licence: pdc repo has no LICENSE (ask before copying code); the model is textbook and may be re-implemented; GEKKO is MIT
- Unit upgraded: U1 CSTR cascade
- What it gives: Canonical parameter set (E/R = 8750 K, k0 = 7.2e10, UA = 5e4, dH = 5e4) with a known runaway threshold above ~305 K jacket temperature; ideal for calibrating jacket-inner / reactor-outer cascade and deriving SPHILM/OPHILM limits.

### 4.5 pc-gym model_classes.py
- Resource: pc-gym model_classes.py (Imperial College, arXiv 2410.22093)
- URL: https://github.com/MaximilianB2/pc-gym
- Licence: MIT
- Unit upgraded: U1 CSTR train, plus extras
- What it gives: Same Henson/Seborg CSTR, four_tank, heat_exchanger, distillation_column, cstr_series_recycle, polymerisation_reactor, batch, hydraulic_tank; disturbance and constraint-violation definitions reusable for drill grading.

### 4.6 CBE30338 (Kantor) notebooks
- Resource: CBE30338 (Kantor) notebooks
- URL: https://github.com/jckantor/CBE30338
- Licence: Code MIT; text licence file says CC BY-NC-ND 4.0 (README says BY-NC-SA); port code and equations only
- Unit upgraded: U1 tank and CSTR, all faceplates
- What it gives: Anti-reset-windup PID and bumpless transfer (important for MAN/AUTO/CAS switching), gravity-drained and interacting tanks, exothermic CSTR with steady-state multiplicity.

### 4.7 Virtual Labs IIT Kharagpur experiments
- Resource: Virtual Labs IIT Kharagpur experiments
- URL: https://virtual-labs.github.io/exp-continuous-stirred-tank-reactor-iitkgp/ (repos exp-continuous-stirred-tank-reactor-iitkgp, exp-heat-exchanger-iitkgp, exp-flash-drum-iitkgp, exp-polymerization-reactor-iitkgp under github.com/virtual-labs)
- Licence: AGPL-3.0 (copyleft; reference or re-implement, do not copy)
- Unit upgraded: U1 whole train, U2
- What it gives: Browser-native JS reference implementations of CSTR with separate jacket unit and PI auto/manual, heat exchanger, flash drum.

### 4.8 Tennessee Eastman Process (Downs and Vogel 1993)
- Resource: Tennessee Eastman Process (Downs and Vogel 1993)
- URL: https://github.com/jkitchin/tennessee-eastman-profbraatz (pure-Python backend) and https://github.com/camaramm/tennessee-eastman-challenge (Ricker's C version and Simulink loop design, MIT wrapper with Ricker's permission)
- Licence: UIUC/Braatz BSD-style permissive notice; MIT wrapper; cite Downs and Vogel and Ricker
- Unit upgraded: Candidate fourth unit
- What it gives: 50 states, 41 measurements, 12 MVs, 20 IDV disturbances, canonical fault scenarios; the C version compiles to WASM with Emscripten.

### 4.9 cstr-ots (Kurian George)
- Resource: cstr-ots (Kurian George)
- URL: https://github.com/KURIANGEORGE57/cstr-ots (live: https://cstr-ots.vercel.app)
- Licence: No licence (all rights reserved); read for architecture only
- Unit upgraded: U1 CSTR, instructor features
- What it gives: Closest existing analogue: deliberately open-loop-unstable thermal design, 6 s cooling-water transport delay, 12 s thermowell lag, seeded determinism plus action-journal replay, snapshot/backtrack, headless acceptance harness.

### 4.10 DWSIM (offline trajectory generator)
- Resource: DWSIM (offline trajectory generator)
- URL: https://github.com/DanWBR/dwsim (tutorial part 3: https://dwsim.org/wiki/index.php?title=Dynamic_Simulation_Tutorial_with_DWSIM_and_Python,_Part_3:_Adding_a_PID_Controller)
- Licence: GPL-3.0 (DTL LGPL-3); desktop only
- Unit upgraded: U1 whole train
- What it gives: Build the real tank/CSTR/HX/flash flowsheet with property packages, run upsets, export time series to calibrate the JS ODE coefficients or precompute drill trajectories.

### 4.11 Bodylight.js FMU Compiler with OMChemSim / ThermoSysPro / ThermoPower
- Resource: Bodylight.js FMU Compiler with OMChemSim / ThermoSysPro / ThermoPower
- URL: https://github.com/creative-connections/Bodylight.js-FMU-Compiler ; https://github.com/FOSSEE/OMChemSim (BSD-3) ; https://github.com/modelica-3rdparty/ThermoSysPro (Modelica License 2 mirror)
- Licence: Compiler GPL-3.0 (check shim licence before shipping); model libraries permissive
- Unit upgraded: U1 flash and HX, U3 furnace gas side
- What it gives: Only route found to run rigorous Modelica unit models in a static page via WASM; the result is an opaque compiled engine, not a readable reference.

### 4.12 Three-phase weir separator (Arnold and Stewart; API 12J; Francis weir)
- Resource: Arnold and Stewart, *Surface Production Operations*, vol. 1 (Gulf Professional Publishing) for the bucket-and-weir three-phase separator; API Specification 12J *Oil and Gas Separators* for the retention-time sizing basis; the Francis weir formula from open-channel hydraulics
- URL: Print / purchase sources with no free full text, so nothing is linked to a mirrored copy. API standards catalogue: https://www.api.org/products-and-services/standards . The Francis formula (flow proportional to head over the crest to the 3/2 power) is textbook open-channel hydraulics and public domain, with no single owning source.
- Licence: Book and standard are copyrighted; both are cited by name only and nothing is reproduced -- no text, tables, figures, sizing charts or retention-time tables. The Francis relation itself is public domain and is implemented directly.
- Unit upgraded: U4 two-chamber weir separator V-502 (water interface and oil-chamber levels, weir overflow, water and oil carry-over, overhead pressure and PSV-502)
- What it gives: The arrangement itself -- an inlet chamber where water settles under the oil and is drawn from the bottom on interface control, an internal weir plate the oil overflows into a second chamber whose level sets the product draw, and gas leaving overhead on pressure control -- together with the two failure directions that make the unit worth training on: an interface carried up near the weir crest sends water over with the oil (product off-spec), and an interface run too thin sends oil out of the water draw (a process-water excursion). API 12J supplies the way of thinking about the size, minutes of liquid retention per chamber rather than a droplet-settling calculation, which is what the chamber areas here are chosen against. Francis supplies the 3/2 head exponent, which makes the weir a soft level clamp instead of a hard one: raise the weir live and the first chamber must fill to the new crest before overflow resumes, so the second chamber starves for a measurable time.

## 5. Suggested next five changes to the simulator

1. Rebuild the alarm engine on the ISA-18.2 state model. Port alerta's state table (2.5) plus loxalarm's on/off delay and max-shelve-timeout semantics (2.9), add Experion sub-priority 0 to 15 and the two-events-per-alarm journal convention from the LX spec (2.1), and drive indication per state (blink only while unacknowledged, no blink for shelved/OOS) per the Siemens table (2.6). Write unit tests from the transition list.

2. Bring the Alarm Summary to the feature set in the Experion Alarming PIN (2.2): asset/location pane with live counts, trip-value and live-value columns, repeat-alarm folding with first/last/count, per-alarm comments, a separate Shelved view with auto-unshelve timer and reason prompt, a DAS tab listing trigger and follow-on alarms, and an Alarm Help pane using the PAS rationalisation fields (2.10). Add an Alarm Tracker strip as a stretch item.

3. Adopt a documented colour and limit philosophy. Switch to the Rockwell ISA-101 palette hex values (2.4), write a short alarm-philosophy page citing ISA-18.2, EEMUA 191, the ASM gray-background paper and the Andow priority-distribution numbers (2.11, 2.19), and add the Range/Critical/Standard/Target limit band to overview shapes and Point Detail (2.11).

4. Upgrade the process models one unit at a time. U2: re-implement the Lucia/Engell semi-batch polymerization model with its adiabatic-temperature safety variable wired to an Urgent alarm and SHEDHOLD logic, and apply state-based alarm limits per SCM phase using the ISA-TR18.2.6 InTech table pattern (section 4, 2.19). U3: port the Badgwell fired-heater state-space model and add tube-skin temperature alarms, using LearnChemE's PFR parametric-sensitivity demo to validate the fixed-bed hot spot. U1: calibrate the cascade against the Henson/Seborg CSTR parameters and use Kantor's anti-windup PID for bumpless MAN/AUTO/CAS transfer.

5. Add an instructor mode and a standards-based scorer. Implement snapshot / initial condition / backtrack / freeze / fast-time and hidden upsets per the Forge PTS PIN (2.14) and cstr-ots's seeded action-journal replay (section 4); score drills with the exida/ISA KPI thresholds and the alarm-performance-analyser metrics (2.7, 2.8); build the drill coverage matrix from the 49 Honeywell Academy operator video titles and EXP-01 objectives (2.12), including PV tracking and PROGRAM modes, Message Summary with confirm, Electronic Signatures and "disable alarms for an asset"; use an 80% pass mark clearly labelled as independent of HAC.

## 6. Dropped in verification

- claude-dev-suite/knowledge_base (https://github.com/claude-dev-suite/knowledge_base): rejected. Its Sources block cites manualslib/manualzz mirrors of Honeywell manuals, and its Experion vocabulary (DMOTOR, VMOTOR, DVALVE, AVALVE, ALMPRI 1/3/4) does not match public Experion naming (DEVCTL, JOURNAL/LOW/HIGH/URGENT); using it would propagate fabricated parameter names.
- ManualsLib / pdfcoffee / idoc.pub mirrors of the Experion LX Operator's Guide, Server and Client Configuration Guide EP-DSXX26 and Control Builder Components Reference EP-DCX365: rejected as sources; leaked proprietary documents with explicit non-disclosure front matter, hosts unstable, and the sim's needs are met by the official LX spec and PINs. Retained in section 3 as text-only pointers.
- ASM Consortium July 2009 webinar slide deck: rejected; publicly served but stamped ASM Consortium Proprietary, members only.
- C300 Controller Capacity TI EP03-300-511: kept only as a cited-numbers source because the cover is stamped "Honeywell Internal"; do not link.
- Experion LX HMI spec R520 URL as originally implied: the file is real but lives at the field-instruments path given in 2.1, not next to the R530 file.
- Orion Console PIN description: corrected; "Orchestration", "Integrated Limit Displays" and pan-and-zoom are in the 2015 white paper, not the PIN, and the PIN's device is an "Alarm Light Panel".
- EXP-01 outline: corrected; it does not mention EXP-01-CT or an 80% pass mark, those come from the HAC PIN.
- EXP-1014 and EXP-1016: corrected; they are instructor-led courses under the /exp/ path, not /mt/ modules. EXP-7012-MT, 7044/7045/7048/7049/7052/7056 filenames were partly guessed; only the ones listed in 2.12 returned 200.
- System HINTS "HMIWeb Display Sizing Guidelines" issue: unverified; not in the June 2025 issue.
- andreili/Honeywell-API-test date: corrected from 2024 to Dec 2018; two enum typos in the source were silently corrected in the summary.
- suifengtec mirror count: corrected from "~40+" to about 185 PDFs; created 2025-08 with imported history last pushed 2023-03.
- Experion SCADA PIN: the word "Elevate" appears only in the URL folder, not the document; cite it as the Experion SCADA PIN.
- OPC UA security policy spelling: the LX spec writes "BASIC256 SHA-256", not "Basic256Sha256".
- FUXA: issue #1310 is closed, and the alarm HowTo lives at docs/HowTo-setup-Alarms.md in the main repo, not the wiki.
- react-scada-hmi: LinearGauge does not expose explicit HH/H/L/LL props despite the README.
- alarm-performance-analyser: no Honeywell-specific export parser exists; column matching is generic.
- CBE30338 text licence: LICENSE-TEXT.txt is CC BY-NC-ND 4.0, README says BY-NC-SA; treat prose and figures as non-commercial, no derivatives.
- do-mpc page: does not itself cite Lucia/Finkler/Engell 2013; cite the paper via its DOI yourself. It calls the reactor "batch", the paper says semi-batch.
- ISA-101 and IEC 63303: ISA page does not mention IEC 63303; say "adopted as IEC 63303:2024".
- ISA-106: no ISA-106 bundle is confirmed (page copy refers to the ISA-101 bundle); the Yokogawa infographic is two pages and uses Manual / Computer Assisted / Fully Automated, not "prompted / semi-automatic".
- EEMUA 191: transient suppression is clause 6.4.4, not under 6.3.
- NAMUR NA 102 content ("one alarm per 10 minutes per operator"): not verifiable from the product page; attribute to EEMUA/ProcessVue secondary sources.
- Honeywell PID equation forms (EQA to EQE, K/T1/T2 interactive form): only seen in a control.com snippet and a dead theprocesscontrol.com page; unverified, do not cite.
- Honeywell developer portals, open-source disclosure page, Forge API marketplace: checked, contain nothing Experion-related.
- Official "Experion PKS Server Specifications EP03-200-xxx": not found on any Honeywell domain, only mirrors; not listed.
- cstr-ots reaction: A+B->2C, not A+B->C; loops described inconsistently as PI/PID in the repo.
- DWSIM tutorial: a three-part series, not a single page with the title originally cited.
- GitHub topics and code searches for hmiweb, hscnetapi, Server.ParamValue, SHEDHOLD, OPHILM: nothing beyond this project and unrelated hits; honeywellForge exists only as an individual user account.