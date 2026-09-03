// @artifact dev
// The archived v2 golden baseline (tests/fixtures/v2-baseline/) is read-only history: this
// test proves nothing in it has changed since it was archived (option A of P2L-EXPANSION-SPEC
// section 10 Q2, Anthony 2026-09-03). The sha256 list in its README is the record.
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
