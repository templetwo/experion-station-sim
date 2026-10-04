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
  const KNOWN_RECAPTURED = ['drill-D12.json', 'upset-air.json', 'upset-bedact.json'];
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
  const KNOWN_RECAPTURED_SINCE_31 = [];
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
