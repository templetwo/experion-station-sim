<!-- @artifact dev -->
# Live Diagnosis alarm presentation, version 1

2026-09-29. Baseline: `fd8b6f4f635bba150e5beebf79871703cb00b985`, model
`74154cd676c888fd8df23e8dd500f45f4814cce192396e01396f9b8bfb6eaf14`.

## Evidence and decision

The user's independent verification of that build confirmed the relief,
reseat-journal and tank-accounting repairs. It also exposed a presentation
conflict: the first closed-vent relief lift produces one unacknowledged alarm
in the banner, but Live Diagnosis showed three urgent cards. The pressure
symptom card consumed live PIC505 records even while dynamically suppressed;
the generic alarm card counted those symptoms and the already-covered relief
again. The user's verification remains user-reported evidence; no raw browser
log was supplied here.

This change adopts a new simulator presentation policy: **alarm-backed urgency
follows alarm state; suppressed symptoms remain labelled context**. This is an
implementation decision under the existing simulator-adjustment authorization,
not a recovered earlier Anthony ruling or a Stack record. Review and merging
remain separate decisions.

The existing implementation basis is `src/alarm-engine.js` (`counts`,
`indication`, `suppressedBy`) and `src/plant-core.js` (`dasRules`). Their
registered state/indication sources are [RESOURCES-2.5 and RESOURCES-2.6](../RESOURCES.md).
Grouping diagnosis cards under a suppression cause is this simulator's policy;
it is not asserted to be a requirement quoted from a standard.

## State and evidence rules

| Alarm state | Diagnosis presentation |
|---|---|
| UNACK | Active alarm guidance, retaining its priority. |
| ACKED | Active alarm guidance remains; acknowledgement does not clear the condition. |
| DSUPR | Labelled suppressed context, associated with its `suppressedBy` cause where available; no independent urgent alarm card. |
| SHLVD | Labelled shelved context; no independent urgent alarm card. |
| OOSRV | Labelled out-of-service context; no independent urgent alarm card. |
| RTNUN | Returned-alarm review guidance; never described as a still-active cause. |

Alarm totals and unacknowledged counts come from the alarm engine, the same
source as the station banner. The total covers UNACK and ACKED; unacknowledged
also includes RTNUN. Context and diagnosis counts are separate quantities.
Journal records retain their engine counting semantics without acquiring
urgent diagnosis priority.

The generic active-alarm fallback covers records without specific guidance.
It must not duplicate the urgency of a relief or pressure card already present.
An unrelated, unsuppressed urgent alarm must still receive urgent coverage.
When the PSV reseats and suppression releases, an active pressure alarm can
again produce pressure guidance.

Pressure interpretation continues to require a GOOD published PIC505 value.
A retained alarm with BAD or UNCERTAIN measurement quality is evidence of the
alarm record, not proof of current pressure. Suppressed context may report the
record's state without asserting an independently measured process condition.

This scope is the local rule-based Live Diagnosis display and its alarm-backed
rules. Independent predictive, controller and measurement-quality guidance is
not itself an alarm annunciation and is not silenced merely because an alarm
is suppressed. This does not establish that every older rule is based solely
on public observations. The remote model-coach projection contract is unchanged.

## Prospective checks and historical limits

The updated `tests/live-diagnosis-u4.test.js` and the new
`tests/live-diagnosis-presentation-v1.test.js` supplement
cover actual repeated native relief cycles, the first lift, acknowledgement,
suppression release, an independent urgent alarm, shelving, out-of-service,
returned alarms, Journal priority, measurement quality and read-only rendering.
They also check that labelled context reaches the display rather than existing
only as hidden metadata.

The eight-card display limit must not hide an unrelated urgent alarm. Coverage
is calculated from the cards actually displayed, with a summary slot reserved
for remaining active alarm records when needed.

At the default composition run's first lift (72 s frame), expect one urgent
PSV-502 card with two suppressed PIC505 conditions available as context. The
alarm counts are one active and one unacknowledged. After acknowledging the
PSV, it remains an active urgent card while unacknowledged becomes zero.

These are prospective presentation checks. The original
[manual-check follow-up](G2-MANUAL-CHECK-FOLLOWUP.md), numerical recipes,
failed-candidate receipts, native campaign and forensic records retain their
original revision/model bindings. Rebuilding the app changes its model ID;
that does not turn any old receipt into an evaluation of the new build.
No process equation, alarm-engine transition, controller, material ledger,
MOA pin or external model call is changed by this policy.

## Validation

The 16 focused diagnosis checks pass, including independent review of the
eight-card overflow case. The full Node suite reports **1110 pass, 4 skip,
0 fail**. The standalone rebuild and both folder/offline browser smoke checks
pass. The folder screenshot also confirms the always-visible count lines fit
the assistant panel. No existing user browser tab was operated.

The rebuilt model ID is
`3e89d782780389e3a9855f17375588b6b2fc1f78e96b37e4fc0f16f99cc029bd`.
Only the application and generated production artifacts changed; all process
modules, numerical recipes and historical receipt files remain byte-identical
to the baseline above.
