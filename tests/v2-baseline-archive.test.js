// @artifact dev
// The archived v2 golden baseline (tests/fixtures/v2-baseline/) is read-only history: this
// test proves nothing in it has changed since it was archived (option A of P2L-EXPANSION-SPEC
// section 10 Q2, Anthony 2026-09-03). The sha256 list in its README is the record.
//
// The second archive, tests/fixtures/v31-baseline/, is the 3.1.0 release line: every golden fixture
// (drills, upsets, arch/, u4/) as it stood at 1f0147e, copied before stage S1 of the credibility pass
// re-captured any of them (docs/dev/CREDIBILITY-PASS-SPEC.md section 11, CR10).
//
// Both archives get the same two checks: intact and complete (the README's sha256 table), and a check that the live goldens
// differ from the archive exactly where the list of re-captured fixtures says (CR31): every listed file must really differ
// from its archived copy, so a stale entry fails as surely as an unlisted mover, and every other file must equal its copy.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, 'fixtures', 'v2-baseline');

/**
 * Intact and complete: the README's sha256 table (rows like | `file.json` | `<64 hex>` |) names exactly `count` fixtures, each
 * hashes to its listed value, and `onDisk` (the archive's .json files, sorted, relative to `dir`) is exactly the listed set.
 */
function assertArchiveIntact({ dir, onDisk, count }) {
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  const listed = [...readme.matchAll(/^\| `([^`]+\.json)` \| `([0-9a-f]{64})` \|$/gm)].map((m) => ({ file: m[1], sha: m[2] }));
  assert.equal(listed.length, count, `the README must list all ${count} archived fixtures`);
  for (const { file, sha } of listed) {
    const bytes = fs.readFileSync(path.join(dir, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, `${file} has changed since it was archived`);
  }
  assert.deepEqual(onDisk, listed.map((x) => x.file).sort(), 'every archived file is listed and every listed file exists');
}

/**
 * CR31: a guard that lists every fixture must still assert something, so the list of re-captured fixtures is held exact in both
 * directions. Every file listed must really differ, byte for byte, from its archived copy (a stale entry fails and names the
 * file); every archived file not listed must equal its copy (an unlisted mover fails and names the file); a file is listed once
 * and has an archived copy (a typo fails). `archived` is the archive's file list relative to `dir`; the live copy of each file
 * sits in tests/fixtures/ under the same relative path.
 */
function assertListedMoversExact({ dir, archived, listed, since }) {
  const twice = listed.find((file, i) => listed.indexOf(file) !== i);
  assert.equal(twice, undefined, `${twice} is listed twice as re-captured since ${since}`);
  for (const file of listed) {
    assert.ok(archived.includes(file), `${file} is listed as re-captured since ${since} but has no archived copy`);
  }
  for (const file of archived) {
    const live = fs.readFileSync(path.join(__dirname, 'fixtures', file));
    const copy = fs.readFileSync(path.join(dir, file));
    if (listed.includes(file)) {
      assert.ok(!live.equals(copy), `${file} is listed as re-captured since ${since} but equals its archived copy: take it off the list`);
    } else {
      assert.ok(live.equals(copy), `${file} differs from its archived ${since} copy but is not listed as re-captured since ${since}`);
    }
  }
}

test('the archived v2 baseline is intact and complete', () => {
  assertArchiveIntact({ dir: DIR, onDisk: fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(), count: 21 });
});

test('every golden listed as re-captured since v2 really differs from its archived v2 copy, and every unlisted one equals it', () => {
  // Not "the live goldens equal the archive": each justified re-capture makes a golden differ from its archived copy, and that is
  // the point of the archive. This holds the record of which ones have moved exact in both directions (CR31): a golden listed in
  // KNOWN_RECAPTURED must really differ from its v2 copy, so a stale entry fails and names the file, and every golden not listed
  // must equal it. When a golden is re-captured, list it here with its reasons.
  // 2026-09-03, option A (Anthony): the fixed-bed floor (src/models.js fixedBed, bedSS floored at
  // the inlet less 5 C) moved exactly these three -- the runs where quench drove the bed below
  // its own inlet. Measured before the change: no other golden moved (CHANGELOG 3.1.0).
  //
  // 2026-10-04, credibility pass S1 (docs/dev/CREDIBILITY-PASS-SPEC.md section 11, CR10): every one of the 21 moved again, so
  // every one is listed, each with the reasons measured at the re-capture. Measured, not assumed: with the eight mechanisms named
  // here switched off in a scratch tree every fixture came back equal to its 3.1.0 copy (model stamp aside), and each mechanism
  // alone moved exactly the fixtures it is named against. All 21 differ from their v2 copies, which this check asserts one by one;
  // the 3.1.0 copies live in tests/fixtures/v31-baseline/ and the second check below holds that list the same way.
  //   CUTOFF   the spec 2.2 low-flow cutoff, which observe() applies to every M3/H point (a reading under 1 % of span reads 0).
  //            FIC211's moves all 35 on its own: its raw value is noise around 0, the observed value is exactly 0, so the loop at
  //            zero setpoint stops dithering MV211; numeric only (the end-state or physics digest), drill-D11 also by two steps
  //            (4021 -> 4023). FIC102's own cutoff moves nothing alone, but where the plant holds that loop shut (PUMP, ILK-RX) it
  //            also changes the end state of drill-D3, drill-D4, upset-cool and upset-pump (switched off with the holds left on,
  //            exactly those four move); the cutoff on FI100, FIC310 and FIC313 moves no fixture.
  //   SAT      transmitter saturation (spec 2.4, D7): TIC202 reports its 103.125 limit and the controller sees that, not the model.
  //   PUMP     FIC102's output held at 0 while P-101 is stopped (spec 3.2, playtest D1), where 3.1.0 wound it up to 100.
  //   ILK-RX   the R-201 trip holds FIC102 at 0 (spec 3.2, D10, CR19).
  //   ILK-BED  the R-310 bed trip holds TIC311 at 0 (spec 3.2, D10, CR19).
  //   MARGIN   the debrief margin (spec 3.6, playtest D9): the trip row's note now reads 'no trip · peak 86.3 % vs trip 98 %'
  //            (drill D2's; drill D9's reads 'no trip · peak 854.9 KPA vs trip 950 KPA') and the drill goldens digest score.breakdown.
  // Mechanisms that moved no golden: the R-202 trip rows (FIC211, TIC213), because no fixture reaches that trip, and drill D4's
  // 'restore' stability rule (CR11), because the goldens are unattended runs that never acknowledge, so none reaches a
  // stability verdict; spec 11 also expected upset-stick to saturate TIC202, and its run never does.
  const KNOWN_RECAPTURED = [
    'drill-D12.json',        // 3.1.0 fixed-bed floor; S1: CUTOFF, ILK-BED (score 10 -> 16, alarm load 14.2 -> 5 per 10 min)
    'upset-air.json',        // 3.1.0 fixed-bed floor; S1: CUTOFF
    'upset-bedact.json',     // 3.1.0 fixed-bed floor; S1: CUTOFF, ILK-BED (TIC311:PVHI no longer raised, events 37 -> 14)
    'drill-D1.json',         // CUTOFF
    'drill-D11.json',        // CUTOFF, MARGIN
    'drill-D2.json',         // CUTOFF, MARGIN
    'drill-D3.json',         // CUTOFF (also FIC102's), PUMP
    'drill-D4.json',         // CUTOFF (also FIC102's), SAT, ILK-RX (alarm load 78.3 -> 26.7 per 10 min, events 197 -> 72; score unchanged).
                             // Its alarm sequence moved too: TIC201:DEVHI and FIC102:PVHI are gone, and LIC101:PVHI, TIC201:PVLO, an
                             // Urgent TIC201:PVLL and TIC301:PVLO are new, because the held feed returns over about 3.5 min after the
                             // trip clears instead of surging at once
    'drill-D6.json',         // CUTOFF, MARGIN
    'drill-D9.json',         // CUTOFF, MARGIN
    'upset-agit-batch.json', // CUTOFF
    'upset-agit.json',       // CUTOFF
    'upset-cool.json',       // CUTOFF (also FIC102's), SAT, ILK-RX (FIC102:PVHI no longer raised, events 31 -> 57)
    'upset-drift.json',      // CUTOFF
    'upset-foul.json',       // CUTOFF
    'upset-pump.json',       // CUTOFF (also FIC102's), PUMP
    'upset-rxn.json',        // CUTOFF
    'upset-stick.json',      // CUTOFF (its run never saturates TIC202)
    'upset-surge.json',      // CUTOFF
    'upset-vap.json',        // CUTOFF
    'upset-xmtr.json',       // CUTOFF
  ];
  assertListedMoversExact({ dir: DIR, archived: fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(), listed: KNOWN_RECAPTURED, since: 'v2' });
});

const DIR31 = path.join(__dirname, 'fixtures', 'v31-baseline');

/** Every .json under dir as a sorted, '/'-joined path relative to dir (arch/ and u4/ keep their subdirectory). */
function jsonUnder(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) out.push(...jsonUnder(dir, r));
    else if (ent.name.endsWith('.json')) out.push(r);
  }
  return out.sort();
}

test('the archived 3.1.0 baseline is intact and complete', () => {
  assertArchiveIntact({ dir: DIR31, onDisk: jsonUnder(DIR31), count: 40 });
});

test('every golden listed as re-captured since 3.1.0 really differs from its 3.1.0 copy, and every unlisted one equals it', () => {
  // The same check as the v2 one above (CR31), against the 3.1.0 copies: each golden a stage re-captures is listed here with its
  // reasons, a listed file must really differ from its copy (a stale entry fails and names the file), and every file not listed,
  // the five Unit 04 goldens in u4/ included, must be byte-identical.
  // Reason codes as in KNOWN_RECAPTURED above (credibility pass S1, 2026-10-04): 35 of the 40 moved, all by the CUTOFF at least.
  // The five Unit 04 goldens (u4/) are deliberately absent: none of the S1 mechanisms reaches them, so the check below proves them
  // byte-identical instead of listing them.
  const KNOWN_RECAPTURED_SINCE_31 = [
    'drill-D1.json',         // CUTOFF
    'drill-D11.json',        // CUTOFF (steps 4021 -> 4023), MARGIN
    'drill-D12.json',        // CUTOFF, ILK-BED (score 10 -> 16, alarm load 14.2 -> 5 per 10 min, events 45 -> 15)
    'drill-D2.json',         // CUTOFF, MARGIN
    'drill-D3.json',         // CUTOFF (also FIC102's), PUMP (outcome unchanged: score 13, TK-101 overflow trip; FIC102 ends at OP 0, not 100)
    'drill-D4.json',         // CUTOFF (also FIC102's), SAT, ILK-RX (alarm load 78.3 -> 26.7 per 10 min, events 197 -> 72; score unchanged).
                             // Its alarm sequence moved too: TIC201:DEVHI and FIC102:PVHI are gone, and LIC101:PVHI, TIC201:PVLO, an
                             // Urgent TIC201:PVLL and TIC301:PVLO are new, because the held feed returns over about 3.5 min after the
                             // trip clears instead of surging at once
    'drill-D6.json',         // CUTOFF, MARGIN
    'drill-D9.json',         // CUTOFF, MARGIN
    'upset-agit-batch.json', // CUTOFF
    'upset-agit.json',       // CUTOFF
    'upset-air.json',        // CUTOFF
    'upset-bedact.json',     // CUTOFF, ILK-BED (TIC311:PVHI no longer raised, events 37 -> 14)
    'upset-cool.json',       // CUTOFF (also FIC102's), SAT, ILK-RX (FIC102:PVHI no longer raised, events 31 -> 57)
    'upset-drift.json',      // CUTOFF
    'upset-foul.json',       // CUTOFF
    'upset-pump.json',       // CUTOFF (also FIC102's), PUMP
    'upset-rxn.json',        // CUTOFF
    'upset-stick.json',      // CUTOFF (its run never saturates TIC202)
    'upset-surge.json',      // CUTOFF
    'upset-vap.json',        // CUTOFF
    'upset-xmtr.json',       // CUTOFF
    'arch/A1.json',          // CUTOFF (physics digest only; health digest, score and gates unchanged, as for every arch fixture)
    'arch/A1_gated.json',    // CUTOFF
    'arch/A2.json',          // CUTOFF
    'arch/A3.json',          // CUTOFF
    'arch/A4.json',          // CUTOFF
    'arch/A5.json',          // CUTOFF
    'arch/A6.json',          // CUTOFF
    'arch/A6_gated.json',    // CUTOFF
    'arch/A7.json',          // CUTOFF
    'arch/A8.json',          // CUTOFF
    'arch/A9.json',          // CUTOFF
    'arch/A10.json',         // CUTOFF
    'arch/A11.json',         // CUTOFF
    'arch/A12.json',         // CUTOFF
  ];
  assertListedMoversExact({ dir: DIR31, archived: jsonUnder(DIR31), listed: KNOWN_RECAPTURED_SINCE_31, since: '3.1.0' });
});
