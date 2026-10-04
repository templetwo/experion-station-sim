<!-- @artifact dev -->
# Final fix wave: S1 whole-branch review (BASE bc18ac3)

Written by the MacBook seat (Sonnet 5.5, claude-sonnet-5-5; `hostname` = Anthonys-MacBook-Pro.local).
Branch `fix/playtest-2026-10`. Two commits, not pushed:

| SHA | Subject |
|---|---|
| `eaee69e` | fix(s1): whole-branch review wave: the pump card and alarm help give D3's restart; an interlocked OP is refused on the governed path; limits stay inside the reporting window; interlocks hold the raw target; SATURATED means a window edge |
| `6adc7c1` | docs(s1): the restart figure agrees with its test; the changelog says what the review wave changed; the plan's "(D9)" reads "playtest D9" |

Both carry exactly the two trailers (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`,
`Claude-Session: https://claude.ai/code/session_9570056f-f4cb-4340-b00e-c8e42fa63a76`). Staged by name. No
subagents, no push, `NIGHT PREVIEW.dc.html` untouched (still the only untracked file), `docs/dev/CREDIBILITY-PASS-SPEC.md`
untouched. Status: **DONE_WITH_CONCERNS** (judgment calls listed at the end; nothing blocked, no golden moved).

TDD throughout: every named test was written and seen red against BASE behaviour before the fix, then green.
Two are counter-tests that pass before and after on purpose (RT30, the second CR35 test); both were mutation-checked.

## Per item

**C1 (Critical), the P-101 trip card.** `Experion Station Simulator.dc.html`, the `mtrip.P101` branch of `diagnose()`.
Id, severity and the two `go` closures (FIC102, P101) are kept; step 3 had none and still has none.
- why: "...While the pump is stopped the plant holds FIC102 at its safe output (outside MAN) and its primary, LIC101,
  initializes, so after START the feed ramps back from zero instead of surging. The tank keeps filling in the meantime,
  and a late restart still ends in the TK-101 overflow trip unless FIC102 is pre-positioned."
- steps: (1) "Put FIC102 in MAN at 20 to 30 % before START; the output is yours in MAN while the pump is stopped."
  (2) "Wait out the lockout, then START P-101." (3) "Return FIC102 to CAS within a minute of START. In AUTO its setpoint
  stays where PV tracking left it (0 while the pump was stopped), so the feed does not recover and the tank overflows."
- I checked the card's claims against the plant instead of trusting the ledger (`final-fix-scripts/c1-card-claims-vs-plant.js`,
  seed 4, drill D3's own trip, stops of 40, 120, 280 s): CAS untouched recovers at 40 and 120 s and trips at 280 s;
  FIC102 left in AUTO from before the trip stays at SP 0 and trips at all three; MAN 25 % then CAS holds at all three;
  MAN 25 % then AUTO (SP = PV at the return, 33 to 41) and MAN left both trip at all three.
- Test: `tests/app-credibility-s1.test.js` "C1: the P-101 trip card says the hold and gives the restart drill D3 keys..."
  Exact strings for the card's own `why` (the alarm-backed card then inherits the banner line, asserted by prefix and a
  banner regexp), the three step texts, the go closure types, no "wind up" / "windup" / "OP 0", and the steps tied clause
  for clause to `d3.opts[d3.a]`. M-202's card is checked untouched. `ok 1 - C1: ...`.

**I1, ALARM HELP.** `src/alarm-help.js` `P101.TRIP` and `FIC102.PVLL` corrective actions now give MAN at 20 to 30 % before
START, START after the lockout, CAS within a minute, and the late-restart overflow (entry shape unchanged; `FIC102.PVLL`
keeps "open FV-102 in MAN" for the closed or stuck valve cause, and its 140 DEG C clause). `grep "restart lockout\|open FV-102"
tests/` found no pin, so nothing to update. Test "I1: the alarm help for the P-101 trip and for FIC102 PVLL..." pins both
strings exactly. `ok 1`. alarm-help-coverage, alarm-summary, coach-help-projection, product-quality-guidance, e301-sign green.

**I2, governed contract.** `src/control-contract.js` `validate`, right after the `interlockOwns` check:
`if(a.demand&&a.demand.field==='OP'&&l.trk&&l.trk.on&&l.trk.kind==='interlock')return 'native_interlock';`.
Reproduced first (`final-fix-scripts/i2-kernel-pre-post.js`, stash of the one file): BEFORE the command came back
`applied / committed` with the mode landed on MAN and OP 0, and from MAN `no_effect / already_in_requested_state`; AFTER both
are `rejected / native_interlock` with before == after and no revision bump.
Tests in `tests/rt-kernel.test.js`, using the file's own `K.restore(K.create())` fixtures and a real latched trip
(`P.rT = 190`, `P.trips.rx = true`, one kernel scan so `forcedOutputs()` derives the hold):
- `RT29`: validate returns `native_interlock`; the kernel outcome is `rejected`, reason `native_interlock`, `after` equals
  `before`, mode stays CAS, OP 0, revision unchanged; the mode-only command still lands (`applied / committed`); from MAN the OP
  demand is rejected, not "already in the requested state"; an SP demand in AUTO under the trip still validates.
- `RT30` (counter): with P-101 stopped (a device hold) the governed OP 25 demand in MAN is `applied / committed`, OP 25,
  so a restart can still be pre-positioned. Mutant "refuse every tracking hold" kills RT30; the fix kills RT29.

**I3, CR35, trip-point store.** `src/plant-core.js` `storeEntry`, the `TP:` branch, after the `o===v` early return and before
`withSignature`: a HI-side cond (PVHI, PVHH) above `ESS.Measurement.rangeOf(l).reportingUpper`, or a LO-side cond (PVLO, PVLL)
below `reportingLower`, sets the message zone `ENTRY REJECTED — LIMIT OUTSIDE REPORTING WINDOW <lower>–<upper>` and returns
false: no signature dialog, no event, no MOC record. DEVHI is not bounded (a PV-SP difference). The edge itself is accepted
(the alarm tests `>=` / `<=`, and a saturated reading sits on it).
- Message numbers: `fmt` at the point's decimals, or as many more as it takes to print the edge exactly (see Concerns 1).
  TIC202 reads `-1.25–103.125`, TI314 `-8.75–721.875`, TI216 `-2.5–206.25`.
- Tests "CR35: an alarm-limit store beyond the reporting window is refused before the signature, and the window edge itself is
  accepted": TIC202 PVHH 105, PVHI 103.2, PVLL -2, PVLO -1.3; TI314 PVHH 722; TI216 PVHH 207 all refused with the exact message and
  `[events.length, mocCount, dlg type, alarm limits]` unchanged; then 103.125, -1.25, 721.875, 206.25 and 90 accepted through the
  signature; DEVHI 300 still goes to the signature; TIC201 PVHH 205 (window top 206.25) accepted. Second test: PVHH stored at
  103.125 raises under cooling loss with `pvObs` 103.125. Mutant `>=` kills both. `ok 1`, `ok 2`.

**M1, CR34, interlock holds the raw target.** `src/pid.js` `stepPid`: `loop.op = loop.trk.kind === 'interlock' ? loop.trk.target :
clampOp(loop, loop.trk.target)`. Header and `setTracking` comments corrected in place (hold is the target itself for an
interlock, clamp for a device hold; non-finite target still 0).
- `tests/pid.test.js`: the ~263 test is a device-kind test and still holds, so it keeps its assertions and is renamed "a
  device hold keeps the target inside OPLOLM and OPHILM..."; a new test "an interlock holds the raw target, outside OPLOLM and
  OPHILM, with the integrator tracking it; a device hold of the same target stays clamped (CR34)" pins 0 under OPLOLM 20, 90 over
  OPHILM 80, the integrator, the MAN case with a NaN target (0 under OPLOLM 10), the clamped device twin, and the release. No other
  test assumed the clamp for an interlock.
- App test "CR34: an interlock holds FIC102 at 0 even when OPLOLM is stored above it...": FIC102 OPLOLM 10, the real R-201 trip
  (cooling lost, seed 4), `c.L.FIC102.op === 0`, flag `INTERLOCK · R-201 HI TEMP TRIP`, FV-102 shut, faceplate `opT` 0.0 and `initT`,
  Point Detail Output row `0.0 %` / `limits 10 – 100 · INTERLOCK · R-201 HI TEMP TRIP`; a stopped pump with the same OPLOLM holds 10.
  Red before (OP 10), green after. Golden check below.

**M2, CR36, SATURATED means a window edge.** `src/plant-core.js`, beside `obsOf`: `saturated(l)` (UNCERTAIN and the observed
value within the page's 1e-9 of `rangeOf(l).reportingUpper` or `reportingLower`) and `limitNote(l)` (the one text behind both
notes: `SATURATED — REPORTED AT <LOW|HIGH> LIMIT` only when saturated, `UNCERTAIN — <LOW|HIGH> LIMIT` for any other UNCERTAIN reading
with a limit, '' otherwise). The page's faceplate `noteT` and Point Detail `satNote` call it (the unused `obsD` / `obsF` locals
are gone); `hatchOp` is untouched (CR8; its comment says the hatch keys on quality). The crosshatch help answer now says a light
hatch is an uncertain reading, SATURATED means the transmitter is at the edge of its window, UNCERTAIN with a limit and no
SATURATED is the source flagging its own reading.
- Test "CR36: SATURATED is for a reading on a window edge...": TIC202 HIGH edge by the cooling-loss path (faceplate and Point
  Detail both `SATURATED — REPORTED AT HIGH LIMIT`); TIC202 LOW edge (pv -5 reports -1.25, `... LOW LIMIT` on both, hatch 0.30);
  TIC202 at 101 is GOOD with a HIGH limit bit, not saturated, no note; LI513 in composition mode at 101.5 reads
  `UNCERTAIN — HIGH LIMIT` on both with `pvShown` 101.5, hatch still 0.30; at -0.5 `UNCERTAIN — LOW LIMIT`; at 105 and -3 clamped to
  103.125 / -1.25 and `SATURATED` HIGH / LOW; a stale analyzer, a bad FIC102 and a motor are not saturated.
- Existing assertions kept consistent (see Concerns 2): the crosshatch help-answer regexes, the data-acquisition Point Detail row
  (`'SATURATED — REPORTED AT HIGH LIMIT'`, was `UNCERTAIN — HIGH LIMIT, reported at the transmitter limit`) and D7's `/UNCERTAIN/`
  match on the Point Detail note (now the exact SATURATED string). `ok 1`.

**M3.** Page: `shedNote: dl.badPv ? (dl.shed ? 'BAD PV — SHED ACTIVE' : 'BAD PV') : ''`. Test "M3: Point Detail says plain BAD PV for a
bad indicator, and keeps BAD PV — SHED ACTIVE for a regulatory point" (AI511 in composition mode; FIC102 healthy then bad). `ok 1`.

**M4.** `casRange`: the low edge is cut to the high one after the SP-limit cut. Test "M4: a narrowed primary prints an honest cascade
span, never an inverted one": shipped `0.0–80.0 M3/H`; LIC101 OPLOLM 70 gives `80.0–80.0 M3/H` (was `84.0–80.0`) in `casRange` and the
Point Detail Cascade row; OPLOLM 60 gives `72.0–80.0` unchanged. The CR24 test still passes. `ok 1`.

**M5.** The three raw `l.pv` alarm-record writes now pass `this.pvShown(l)`: `applyPhaseSet` (the return when a phase set switches
a standing condition off, ~399), `parkDisabled` (~1114) and `setOos` (~1343). Test "M5: the alarm records the three paths wrote
carry the observed value, not the raw model value": FIC211 with raw 0.3 (inside the cutoff, reads 0): the PVLO record `val` 0 and the
journal RETURN TO NORMAL `newV` '0.0' (was '0.3'), the signed OOS record `val` 0, the park record `val` 0, and a saturated TIC202
parks at 103.125 not 120. Red before (`actual: 0.3`). **Golden check immediately after: nothing moved**, so M5 stays.

**M6.** The "Why can I not change OP?" answer keeps its sentences and gains: " Under an interlock the output is held and an OP write is
refused, even in MAN, until the trip clears (the Message Zone shows OUTPUT INTERLOCKED, and the flag beside the mode line names the
hold)." No pin existed; test "M6: ..." pins the kept prefix, the exact new sentence, and that the page really refuses an OP write in
MAN under the R-201 trip with that wording and flag. `ok 1`.

**M7.** Measured (`final-fix-scripts/m7-restart-ramp-60-vs-60.5.js`, seed 4, plant run 60 s): after START, 30 m3/h at 103.5 s in every
case; 50 m3/h at **166.0 s after a stop of exactly 60 s** and **166.5 s after the 60.5 s the Task 6 test applies** (stop command, one scan,
then 60 s); 61 s gives 166.0; peak 79.55. CHANGELOG now says 166.0 s and that the test's 166.5 s is its 60.5 s stop and the figure moves by
a scan; the test (|t - 166.5| <= 0.5) is unchanged and consistent. (Docs commit.)

**M9.** `tests/g2-lifecycle.test.js`: at the restore instant the whole capture equals the checkpoint less `schema_version`,
`materialMode` and `composition`: same top-level keys, same `fields` keys, each key `deepEqual`, then the whole object. All existing
assertions kept. It held on the first run, as the review said. Mutation-checked: making `restore` drift `mocCount` by one fails the
test (P, L and V alone passed it), then reverted (`git status` clean). `ok 1`.

**Plan label.** `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` Task 8 heading: "(D9)" to "(playtest D9)". (Docs commit.)

## Golden check (no fixture may move; none did)

Run after M1 (with C1, I1, I2, I3 in place) and again immediately after M5 (with M2, M3, M4, M6 in place):
`node --test tests/golden-drills.test.js tests/golden-u4.test.js tests/golden-upsets.test.js tests/v2-baseline-archive.test.js
tests/drill-arch-fixtures.test.js tests/determinism.test.js tests/snapshot-v3.test.js tests/replay-drop.test.js
tests/release-gates.test.js tests/g2-lifecycle.test.js` gave, both times, `# tests 127 / # pass 126 / # fail 0 / # skipped 1`
(the skip is the suite's own). The two archive guards (v2 baseline, v3.1 baseline; "every golden listed as re-captured since 3.1.0 really
differs from its 3.1.0 copy, and every unlisted one equals it") are inside that run and inside the full suite. `git diff --stat
bc18ac3..HEAD` touches no file under `tests/fixtures/`. No re-capture was needed, none done.

## Gates

- Baseline at BASE: `# tests 1219 / # pass 1218 / # fail 0 / # skipped 1`.
- Code tree (before `eaee69e`, docs stashed): `# tests 1232 / # pass 1231 / # fail 0 / # cancelled 0 / # skipped 1` (+13 tests: C1, I1, RT29,
  RT30, CR35 x2, CR34 app, CR34 pid, CR36, M3, M4, M5, M6; M9 and the plan label add none).
- Docs tree (before `6adc7c1`): the same, `1232 / 1231 / 0 / 1`.
- `python3 tools/build-dist.py`: three consecutive builds on the final code tree are byte-identical
  (`dist/experion-station-sim-standalone.html` sha256 `d250a1bf...a21893`, `src/model-id.js` sha256 `c94516e3...a363bf9`); a rebuild on the docs tree
  leaves both unchanged. `dist/` and `src/model-id.js` are in `eaee69e`.
- `tools/smoke.sh`, run on the code tree and again on the docs tree: `SMOKE folder: ok`, `SMOKE dist: ok` both times.

## Files changed (bc18ac3..6adc7c1, 13 files, +481/-46)

`Experion Station Simulator.dc.html`, `dist/experion-station-sim-standalone.html`, `src/model-id.js`, `src/alarm-help.js`,
`src/control-contract.js`, `src/pid.js`, `src/plant-core.js`, `tests/app-credibility-s1.test.js`, `tests/g2-lifecycle.test.js`,
`tests/pid.test.js`, `tests/rt-kernel.test.js` (commit 1); `CHANGELOG.md`, `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` (commit 2).
Measurement and verification scripts are kept in `.superpowers/sdd/CREDIBILITY-PASS-PLAN-S1/final-fix-scripts/` (5 files; the /tmp scratch is removed).

## Self-review

- Each fix is one the review named; helper additions are `saturated` and `limitNote` (one text behind two notes, so the wording cannot drift) and the
  three-line `edge()` formatter in the TP: branch. No new `Math.random`, no network, no `support.js`, no hand-edited `dist/`.
- Messages and card text are original house voice, no vendor material; the rulings are cited by number (CR34, CR35, CR36, CR21, CR32, CR20, CR8, CR14, CR24).
- Honesty checks I made on my own new text: the card's AUTO / CAS / MAN claims were run against the plant (above); the CHANGELOG 166.0 / 166.5
  figures were measured, not inferred; the I3 message prints the edges it enforces.
- Mutants run and killed: restore drift (M9), refuse-all-holds (RT30), `>=` edge (CR35). The I2 before/after was reproduced with a real stash of the one file.
- Not changed, on purpose: `src/models.js` (still `ctx.raise('FIC102','BADPV',...,L.FIC102.pv)` at raise, outside the three named sites), the `lock.P101`
  INFO card (it shows only during the 15 s lockout after a manual stop, and a restart at the end of it is far inside the measured recoverable range, since 40 s
  and 120 s stops recover in CAS, so "wait, then START" teaches nothing false there; it does not mention the pre-position, which a later pass could add),
  `tools/coach/` (S5), the spec, and the plan's Task 5 snippet (`clampOp(loop, loop.trk.target)`, a historical contract).

## Concerns

1. **I3 message numbers deviate slightly from "use fmt at the point's decimals".** I print the exact enforced edge (fmt with as many decimals as it takes,
   at least the point's). At the point's decimals TIC202 would read `-1.3–103.1` and TI314, a dec-0 point, `-9–722`, and a trainee typing 722 (shown as the
   top) would be refused by a message that lists it as allowed. Still `fmt`, same page rejection path; if you want the literal form it is a one-line change in
   `edge()` and the strings in the CR35 test.
2. **Point Detail's saturated wording changed.** I read "the two notes say SATURATED — REPORTED AT <LOW|HIGH> LIMIT only when saturated(l)" literally, so Point Detail
   now reads like the faceplate and the old `UNCERTAIN — HIGH LIMIT, reported at the transmitter limit` is gone. Two existing assertions followed (the
   data-acquisition Point Detail row, D7's `/UNCERTAIN/`) and one CHANGELOG sentence. If you meant to keep the old Point Detail wording for the saturated case,
   `limitNote` is the single place to change and those two assertions revert.
3. **CHANGELOG got more than M7.** The docs commit also corrects the sentence the M2 change falsified and adds short clauses for I3, I2/M1, M4 and C1/I1/M6 in the
   paragraphs they belong to, so the release notes match the code. Say so if you would rather have M7 alone and write those yourself.
4. **One code commit, not two:** `plant-core.js` carries M2, I3, M4 and M5 together and a partial-stage split would have needed `git add -p`, so a single commit
   (with `dist/` and `src/model-id.js`) keeps every commit green.
5. For your spec docs commit: section 3.1 still says the hold is `clampOp(target)` for every kind (CR34 amends it), 3.3 and the CR21/CR32 card wording, and
   a replay of a journal recorded before this wave that stored an out-of-window limit would now refuse that store (the limit could never raise, so the plant
   trajectory cannot differ; only the stored limit would).

---

# Follow-up round: the re-review's N1 to N5 (on top of 7ef42eb)

MacBook seat (Sonnet 5.5, claude-sonnet-5-5; `hostname` = Anthonys-MacBook-Pro.local). One commit on top of the controller's
`7ef42eb`, not pushed: **`1241d40`** fix(s1): an edge alarm limit replays as stored; the cascade span stays inside both SP limits;
the OP help covers the shed (CR38). Two trailers as required. Staged by name; `dist/experion-station-sim-standalone.html` and
`src/model-id.js` are in it. Spec untouched, `NIGHT PREVIEW.dc.html` untouched. Status: **DONE_WITH_CONCERNS** (one expectation in
N5 turned out to be about a different scenario, see below; nothing blocked, no golden moved).

TDD: each test was written and seen red against `7ef42eb` behaviour first (N1 x2, the N2 case, the N3 sentence); N5 is a pin of
already-true values, so it was mutation-checked instead.

**N1 (Important), CR38, an edge limit replays as stored.** Reproduced as the reviewer described: the `cfg` closure in `storeEntry` journals
`fmt(v,3)`, so TIC301 PVHH 257.8125 became `'257.813'`; `applyJournalEntry` replays `storeEntry(Number(arg))`; `withSignature` runs the store
directly during a replay; the CR35 check then saw 257.813 over the 257.8125 top, refused it and left the limit at 215. Both halves are in
`src/plant-core.js`:
- (a) `cfg` journals a `TP:` store as `String(v)` (the round-tripping exact value, `Number(String(v)) === v`); the MOC event keeps `fmt(v,2)`
  and every other store keeps `fmt(v,3)` (asserted: an ALMDB store still journals `'2.000'`).
- (b) the TP: branch sets its window to null while `this._replayApplying` (the pattern `can()`, `withSignature` and `setMaterialDiversion` use),
  so the check does not run in a replay. The CR35 comment now says both.
- Tests (`tests/app-credibility-s1.test.js`), following the replay pattern of `tests/app-instructor.test.js` (`saveSlot`, signed stores,
  `startReplay`, `replayToEnd`):
  - "N1, CR38: a limit stored on a window edge that needs more than three decimals replays as stored, and the edge is still the edge": saves a slot;
    for TIC301 PVHH 257.8125, TIC212 PVHH 154.6875, TIC213 PVHI 134.0625 and AI316 PVLO -0.2625 it refuses one step over live (257.8126 and the
    like, the limit unchanged), then stores the edge through the signature; asserts every journal entry parses back to the stored value; replays
    with a spy on `msgZone` and asserts each limit equals the stored edge and that no `LIMIT OUTSIDE REPORTING WINDOW` message was raised; then
    that one step over is still refused live. `ok`.
  - "N1, CR38: the window check does not run while a replay applies: a journal entry an earlier build rounded to 257.813 still applies": a journal
    entry written the previous build's way (`c.journal('STORE','TIC301','257.813',{param:'TP:PVHH'})`) replays and the limit becomes 257.813, no refusal;
    a live store of 257.813 on a fresh plant is still refused (`-3.125–257.8125`), and so is 257.9 on the replayed plant. (A store of the value a limit
    already holds returns before the check, so the live assertion needs a plant that has not replayed it.) `ok`.
  - Mutants: restoring `fmt(v,3)` alone fails the first test (journal and replayed limit 257.813); restoring the unconditional check alone fails
    the second (limit stays 215). Each kills exactly its own test.
- Golden check right after N1 (with N2 and N3 in place): `golden-drills`, `golden-u4`, `golden-upsets`, `v2-baseline-archive`, `drill-arch-fixtures`,
  `determinism`, `snapshot-v3`, `replay-drop`, `release-gates`, `g2-lifecycle`, plus `app-instructor`, `app-adrill-replay` and `app-replay-refusal`:
  `# tests 167 / # pass 166 / # fail 0 / # skipped 1`. Nothing moved.

**N2, casRange, both ends.** `src/plant-core.js` `casRange`: `into(x) = max(SPLOLM, min(SPHILM, x))` (the same clamp `followMaster` applies),
`hi = into(max(a,b))`, `lo = min(into(min(a,b)), hi)` (the `lo = min(lo,hi)` guard is kept as asked; with a monotone clamp `lo <= hi` already holds by construction, so it is
redundant, and with inverted SP limits both ends simply become SPLOLM, as `followMaster`'s clamp would leave the SP). Test (the M4 test, extended): FIC102 SPLOLM 30 with LIC101 OPHILM 20, the plant run 10 s, FIC102
in CAS at `sp === 30` and `casRange` / the LIC101 Cascade row read `30.0–30.0 M3/H` (was `24.0–24.0`); OPHILM 50 reads `30.0–60.0` (a span that
straddles the floor); the OPLOLM 70 case still `80.0–80.0`, the shipped `0.0–80.0` and `72.0–80.0` unchanged; the CR24 test still passes.

**N3, the OP help answer and the shed.** Page `topics()`: the sentence now reads "Under an interlock or a shed the output is held and an OP write is
refused, even in MAN, until the cause clears; the Message Zone names the cause, and the flag beside the mode line names an interlock hold." The M6 test
pins the exact sentence (the existing sentences kept) and both behaviours it describes: in MAN under the R-201 trip the message is exactly
`ENTRY REJECTED — OUTPUT INTERLOCKED (R-201 HI TEMP TRIP)` with the flag `INTERLOCK · R-201 HI TEMP TRIP`; under the TI216 shed (`c.tadShed = true`) an OP
store on FIC211 is refused with exactly `FIC211: TI216 URGENT INTERLOCK — OP HELD BY SHED (MAN, OP 0)` and `flagText` is empty, the claim the old
sentence got wrong. Red before, green after.

**N5, the pid release value, and what it actually is.** The coordinator expected exactly 20 at `tests/pid.test.js` ~303. In the test as I wrote it the
loop `il` had last been held at 90 (the raw-target-above-OPHILM case), so its release is **exactly 80**, not 20: P = 10 and the tracked integrator is
80, the scan is pushing into OPHILM so there is no integral step, and the output clamps to 80 with the integrator back-calculated to 70. The 20 is the
*held-0* release the test's own comment described, which belongs to a different loop than the one released. So I pinned both, exactly, and fixed the
misleading comment: a fresh loop held at 0 under OPLOLM 20 (integrator -10) releases to exactly 20 with the integrator back-calculated to 10; `il`
releases to exactly 80 with the integrator 70. Mutant "the integrator tracks OP without the P term" fails 7 pid tests including this one; reverted.
(The values were computed with a node one-liner before the edit.)

**Plan as-built note.** `docs/dev/CREDIBILITY-PASS-PLAN-S1.md`, one blockquote line after Task 5's existing as-built note: the snippet's `tracking(loop)`
line clamps every hold; since CR34 an interlock-kind hold holds the raw target (the expression is given), because the plant forces the valve there
whatever the loop's limits and OP must read the valve (D10); only a device hold stays inside OPLOLM and OPHILM, and the CR17 note above ("the output
clamp still applies") is true of a device hold only.

## Gates on `1241d40`

- `node --test tests/*.test.js`: `# tests 1234 / # pass 1233 / # fail 0 / # cancelled 0 / # skipped 1` (was 1232; +2 N1 tests, the M4, M6 and CR34
  pid tests were extended in place).
- `python3 tools/build-dist.py`: three consecutive builds byte-identical (`dist/experion-station-sim-standalone.html` sha256 `16a44dd9...d63d2f8`,
  `src/model-id.js` sha256 `973242b1...8d718e11`); a rebuild after the last edit changed nothing; both files are in the commit.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.
- Files in the commit: `Experion Station Simulator.dc.html`, `dist/experion-station-sim-standalone.html`, `src/model-id.js`, `src/plant-core.js`,
  `tests/app-credibility-s1.test.js`, `tests/pid.test.js`, `docs/dev/CREDIBILITY-PASS-PLAN-S1.md` (7 files, +126/-16).

## Concerns

1. **N5's premise.** The release value in that test was 80, not 20 (above); I pinned the true values for both scenarios rather than force a 20 into the
   scenario that does not produce one. If you wanted only the held-0 case, the `il` release lines are the two to drop.
2. **Other journaled stores still round to three decimals.** Only `TP:` stores are exact now, as asked. A store typed with more than three decimals on
   any other parameter (K, T1, T2, SP and OP limits, deadband, on-delay) still journals `fmt(v,3)`, so its replay differs from the live value by under
   0.0005. Nothing validates against them, so no refusal can follow, but it is the same class of gap and a one-line widening of `cfg` and `done` if you
   want it closed.
3. **Journal text for trip points changes.** A `TP:` entry now prints as `TIC201 TP:PVHI 168` (and `TIC301 TP:PVHH 257.8125`), not `168.000`, in the
   instructor's journal list; display only, the existing replay round-trip test (which stores TIC201 `TP:PVHI` 168) is green.
4. **For your spec commit (CR38):** the journal records a trip-point store exactly; a replay does not run the CR35 window check (it reproduces what the live
   run accepted), so a journal an earlier build rounded over an edge replays as journaled. The spec's CR33 and CR17 wording stays yours.

---

# Final micro-round: CR38b and the OP help (on top of 65e7928)

MacBook seat (Sonnet 5.5, claude-sonnet-5-5; `hostname` = Anthonys-MacBook-Pro.local). One commit on top of the controller's
`65e7928`, not pushed: **`e57b8e6`** fix(s1): every operator store journals exactly, so a target band at an edge replays as stored; the
OP help names the TI216 shed (CR38b). Two trailers as required. Staged by name; `dist/experion-station-sim-standalone.html` and
`src/model-id.js` are in it. Spec untouched, `NIGHT PREVIEW.dc.html` untouched. Status: **DONE_WITH_CONCERNS** (one unrequested CHANGELOG
clause and one display note below; nothing blocked, no golden moved).

**1. CR38b, every operator store journals exactly.** Reproduced first (`final-fix-scripts/cr38b-band-replay-and-badpv-shed-repro.js`, seed 4): TIC201 `TP:PVHI`
168.0006 then TGTHI 168.0006 are both accepted live (band 140 / 168.0006), the journal holds `TP:PVHI=168.0006` and `TGTHI=168.001`, and the replay raises
`ENTRY REJECTED — TARGET BAND MUST LIE INSIDE 140.0 TO 168.0 AND LOW < HIGH` and leaves the band at `[null, null]` (auto). The mirror, `TP:PVLO` 140.0004 with
TGTLO 140.0004, journals `TGTLO=140.000` and fails the same way (live band `[140.0004, 160]`, replayed `[null, null]`).
- `src/plant-core.js` `storeEntry`: both closures now journal `String(v)`: `done` (SP and OP) and `cfg` (tuning, limits, target band, deadband, on-delay,
  trip points). The events and the MOC record keep `fmt(v,2)`. The CR38 comment moved above `done` and now says every operator store (CR38, CR38b),
  with both examples (257.8125 to 257.813 over the edge, 168.0006 to 168.001 past the limit).
- Reader check, done myself rather than taken on trust: the only consumers of a STORE entry are `applyJournalEntry` (`Number(e.arg)`, exact) and
  `Instructor.journalText` (prints `e.arg`); snapshots carry only `journalSeq`; `grep` finds no journal or STORE entry anywhere under `tests/fixtures/`.
- Test `tests/app-credibility-s1.test.js` "CR38b: every operator store journals exactly, so a target band stored at a limit replays as stored (TGTHI and
  its TGTLO mirror)": for each case it saves a slot, stores the limit through the signature and the band at the same value, asserts the live band
  (`[140, 168.0006]`, `[140.0004, 160]`), asserts both journal arguments equal `String(value)`, replays with a spy on `msgZone`, and asserts the replayed band
  equals the live band, the limit is as stored and neither `TARGET BAND MUST LIE INSIDE` nor `LIMIT OUTSIDE REPORTING WINDOW` was raised. It also pins the MOC
  event's display (`'168.00'`) and the exact journal argument of SP (152.25), OP (55.1234), ALMDB (2), ALMDELAY (5.5), OPHILM (90.0625) and a signed K (2.5),
  and that every STORE argument round-trips through `Number`. The N1 test's old "other stores keep three decimals" assertion (`ALMDB` `'2.000'`) is the
  assertion this replaces.
- Red before (`expected '168.0006', actual '168.001'`), green after. Mutants: `fmt(v,3)` back in `done` alone fails the SP assertion
  (`'152.250'`); back in `cfg` alone fails this test and the N1 edge test; the good file was restored byte for byte (`cmp`).
- Golden, archive and replay files right after the change: `golden-drills`, `golden-u4`, `golden-upsets`, `v2-baseline-archive`, `drill-arch-fixtures`,
  `determinism`, `snapshot-v3`, `replay-drop`, `release-gates`, `g2-lifecycle`, `app-instructor`, `app-adrill-replay`, `app-replay-refusal`, `app-scorer-moc`:
  `# tests 191 / # pass 190 / # fail 0 / # skipped 1`. No fixture moved.

**2. The OP help sentence, narrowed to the TI216 shed.** Page `topics()`: "Under an interlock, or the TI216 urgent shed on FIC211, the output is held and an OP
write is refused, even in MAN, until the cause clears; the Message Zone names the cause, and the flag beside the mode line names an interlock hold." Confirmed
the overclaim before fixing it: with FIC102 shed to MAN by the xmtr upset, `storeEntry('FIC102','OP',30)` returns true and OP becomes 30. The M6 test pins the exact
sentence and now all three behaviours: the R-201 interlock and the TI216 shed refuse (their exact messages, the flag only on the interlock), and the bad-PV
shed does not (`storeEntry` true, `op === 30`). Red before, green after.

**3. CHANGELOG.** Three edits, house voice: the I3 bullet gains "A replay reproduces what the live run accepted: every operator store now journals at its exact
value, not rounded to three decimals, and a replay does not run the window check, so a limit stored on an edge that needs four decimals (TIC301 PVHH 257.8125),
and a target band stored at an alarm limit that needs four (TIC201 TGTHI 168.0006 under its PVHI 168.0006), replay as stored (CR38, CR38b)"; the D8 bullet's cascade
clause now says the span is cut to both of the secondary's SP limits (`80.0–80.0 M3/H` above SPHILM, `30.0–30.0 M3/H` below SPLOLM), never an inverted span or one
outside them; and, beyond the two you asked for, the "Why can I not change OP?" clause now says "an interlock, or the TI216 urgent shed on FIC211", so the release notes
match the help text this round changed.

## Gates on `e57b8e6`

- `node --test tests/*.test.js`: `# tests 1235 / # pass 1234 / # fail 0 / # cancelled 0 / # skipped 1` (was 1234; +1, the CR38b test; the M6 and N1 tests were
  edited in place), run again on the committed tree after the commit.
- `python3 tools/build-dist.py`: three consecutive builds byte-identical (`dist/experion-station-sim-standalone.html` sha256 `917ae0ce...b2d8c`,
  `src/model-id.js` sha256 `09e2e3a0...a40cd`); a rebuild after the last edit changed nothing; both files are in the commit.
- `tools/smoke.sh`: `SMOKE folder: ok`, `SMOKE dist: ok`.
- Files in the commit: `CHANGELOG.md`, `Experion Station Simulator.dc.html`, `dist/experion-station-sim-standalone.html`, `src/model-id.js`, `src/plant-core.js`,
  `tests/app-credibility-s1.test.js` (6 files, +74/-15).

## Concerns

1. The third CHANGELOG edit (the TI216 shed in the OP-help clause) is beyond the two you listed; it keeps the notes true to the help text. Drop it if you want the
   changelog to carry only the two.
2. The instructor's journal list now prints every store at its exact value (`TIC201 SP 152.25`, `TIC201 K 2.5`, not `152.250` / `2.500`). Display only. A value a
   program computes with float noise would print long digits; typed entries come from `parseFloat` of a decimal string, so they stay short.
3. Nothing else open from my side. The spec's CR38b entry and the deferred-note withdrawal are yours.
