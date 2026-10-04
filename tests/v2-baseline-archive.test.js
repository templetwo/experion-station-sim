// @artifact dev
// The archived v2 golden baseline (tests/fixtures/v2-baseline/) is read-only history: this
// test proves nothing in it has changed since it was archived (option A of P2L-EXPANSION-SPEC
// section 10 Q2, Anthony 2026-09-03). The sha256 list in its README is the record.
//
// The second archive, tests/fixtures/v31-baseline/, is the 3.1.0 release line: every golden fixture
// (drills, upsets, arch/, u4/) as it stood at 1f0147e, copied before stage S1 of the credibility pass
// re-captured any of them (docs/dev/CREDIBILITY-PASS-SPEC.md section 11, CR10). Same discipline, below:
// an intact-and-complete check against its README, and a live-equals-archived check whose exceptions
// are named with their reasons.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, 'fixtures', 'v2-baseline');

test('the archived v2 baseline is intact and complete', () => {
  const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  const listed = [...readme.matchAll(/^\| `([^`]+\.json)` \| `([0-9a-f]{64})` \|$/gm)].map((m) => ({ file: m[1], sha: m[2] }));
  assert.equal(listed.length, 21, 'the README must list all 21 archived fixtures');
  for (const { file, sha } of listed) {
    const bytes = fs.readFileSync(path.join(DIR, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, `${file} has changed since it was archived`);
  }
  const onDisk = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(onDisk, listed.map((x) => x.file).sort(), 'every archived file is listed and every listed file exists');
});

test('the archive was a verbatim copy of the live goldens at the moment of archiving (no live golden has moved yet)', () => {
  // Deliberately NOT a permanent invariant: the first justified re-capture will make a live
  // golden differ from its archived copy, and that is the point of the archive. Until then,
  // this proves the copy was exact. When a golden is re-captured, list it in KNOWN_RECAPTURED.
  // 2026-09-03, option A (Anthony): the fixed-bed floor (src/models.js fixedBed, bedSS floored at
  // the inlet less 5 C) moved exactly these three -- the runs where quench drove the bed below
  // its own inlet. Measured before the change: no other golden moved (CHANGELOG 3.1.0).
  //
  // 2026-10-04, credibility pass S1 (docs/dev/CREDIBILITY-PASS-SPEC.md section 11, CR10): every one of the 21 moved again, so
  // every one is listed, each with the reasons measured at the re-capture. Measured, not assumed: with the eight mechanisms named
  // here switched off in a scratch tree every fixture came back equal to its 3.1.0 copy (model stamp aside), and each mechanism
  // alone moved exactly the fixtures it is named against. The 3.1.0 copies live in tests/fixtures/v31-baseline/ and the second
  // check below keeps the set of movers exact; with every v2 fixture listed this one no longer compares anything live.
  //   CUTOFF   the FIC211 low-flow cutoff (spec 2.2): its raw value is noise around 0, the observed value is exactly 0, so the
  //            loop at zero setpoint stops dithering MV211. Numeric only (the end-state or physics digest): it moves all 35,
  //            drill-D11 also by two steps (4021 -> 4023).
  //   SAT      transmitter saturation (spec 2.4, D7): TIC202 reports its 103.125 limit and the controller sees that, not the model.
  //   PUMP     FIC102's output held at 0 while P-101 is stopped (spec 3.2, D1), where 3.1.0 wound it up to 100.
  //   ILK-RX   the R-201 trip holds FIC102 at 0 (spec 3.2, D10, CR19).
  //   ILK-BED  the R-310 bed trip holds TIC311 at 0 (spec 3.2, D10, CR19).
  //   MARGIN   the debrief margin (spec 3.6, D9): the trip row's note now reads 'no trip · peak 86.3 % vs trip 98 %' and the
  //            drill goldens digest score.breakdown.
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
    'drill-D3.json',         // CUTOFF, PUMP
    'drill-D4.json',         // CUTOFF, SAT, ILK-RX (alarm load 78.3 -> 26.7 per 10 min, events 197 -> 72; score unchanged)
    'drill-D6.json',         // CUTOFF, MARGIN
    'drill-D9.json',         // CUTOFF, MARGIN
    'upset-agit-batch.json', // CUTOFF
    'upset-agit.json',       // CUTOFF
    'upset-cool.json',       // CUTOFF, SAT, ILK-RX (FIC102:PVHI no longer raised, events 31 -> 57)
    'upset-drift.json',      // CUTOFF
    'upset-foul.json',       // CUTOFF
    'upset-pump.json',       // CUTOFF, PUMP
    'upset-rxn.json',        // CUTOFF
    'upset-stick.json',      // CUTOFF (its run never saturates TIC202)
    'upset-surge.json',      // CUTOFF
    'upset-vap.json',        // CUTOFF
    'upset-xmtr.json',       // CUTOFF
  ];
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    if (KNOWN_RECAPTURED.includes(file)) continue;
    const live = fs.readFileSync(path.join(__dirname, 'fixtures', file));
    const archived = fs.readFileSync(path.join(DIR, file));
    assert.ok(live.equals(archived), `${file}: the live golden differs from the archive but is not listed as re-captured`);
  }
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
  const readme = fs.readFileSync(path.join(DIR31, 'README.md'), 'utf8');
  const listed = [...readme.matchAll(/^\| `([^`]+\.json)` \| `([0-9a-f]{64})` \|$/gm)].map((m) => ({ file: m[1], sha: m[2] }));
  assert.equal(listed.length, 40, 'the README must list all 40 archived fixtures');
  for (const { file, sha } of listed) {
    const bytes = fs.readFileSync(path.join(DIR31, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, `${file} has changed since it was archived`);
  }
  assert.deepEqual(jsonUnder(DIR31), listed.map((x) => x.file).sort(), 'every archived file is listed and every listed file exists');
});

test('every live golden equals its 3.1.0 copy unless it is listed as re-captured since 3.1.0', () => {
  // Like the v2 check above this is deliberately not a permanent invariant: each golden a stage
  // re-captures is listed here with its reasons. Unlike it, the list is exact in both directions: a
  // listed file must really differ from its archived copy (a stale entry is a failure), and every
  // file not listed, the five Unit 04 goldens in u4/ included, must be byte-identical.
  // Reason codes as in KNOWN_RECAPTURED above (credibility pass S1, 2026-10-04): 35 of the 40 moved, all by the CUTOFF at least.
  // The five Unit 04 goldens (u4/) are deliberately absent: none of the S1 mechanisms reaches them, so the loop below proves them
  // byte-identical instead of listing them.
  const KNOWN_RECAPTURED_SINCE_31 = [
    'drill-D1.json',         // CUTOFF
    'drill-D11.json',        // CUTOFF (steps 4021 -> 4023), MARGIN
    'drill-D12.json',        // CUTOFF, ILK-BED (score 10 -> 16, alarm load 14.2 -> 5 per 10 min, events 45 -> 15)
    'drill-D2.json',         // CUTOFF, MARGIN
    'drill-D3.json',         // CUTOFF, PUMP (outcome unchanged: score 13, TK-101 overflow trip; FIC102 ends at OP 0, not 100)
    'drill-D4.json',         // CUTOFF, SAT, ILK-RX (alarm load 78.3 -> 26.7 per 10 min, events 197 -> 72; score unchanged)
    'drill-D6.json',         // CUTOFF, MARGIN
    'drill-D9.json',         // CUTOFF, MARGIN
    'upset-agit-batch.json', // CUTOFF
    'upset-agit.json',       // CUTOFF
    'upset-air.json',        // CUTOFF
    'upset-bedact.json',     // CUTOFF, ILK-BED (TIC311:PVHI no longer raised, events 37 -> 14)
    'upset-cool.json',       // CUTOFF, SAT, ILK-RX (FIC102:PVHI no longer raised, events 31 -> 57)
    'upset-drift.json',      // CUTOFF
    'upset-foul.json',       // CUTOFF
    'upset-pump.json',       // CUTOFF, PUMP
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
  const archived = jsonUnder(DIR31);
  for (const file of KNOWN_RECAPTURED_SINCE_31) {
    assert.ok(archived.includes(file), `${file} is listed as re-captured but has no 3.1.0 copy`);
  }
  for (const file of archived) {
    const live = fs.readFileSync(path.join(__dirname, 'fixtures', file));
    const old = fs.readFileSync(path.join(DIR31, file));
    if (KNOWN_RECAPTURED_SINCE_31.includes(file)) {
      assert.ok(!live.equals(old), `${file} is listed as re-captured since 3.1.0 but equals its archived copy: take it off the list`);
      continue;
    }
    assert.ok(live.equals(old), `${file}: the live golden differs from the 3.1.0 archive but is not listed as re-captured since 3.1.0`);
  }
});
