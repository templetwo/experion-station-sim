// @artifact dev
'use strict';

// Anthony's ruling (2026-09-13): "Make the grep a test. Derive the trip count
// from raiseTrip and the source count from §7, fail on any prose that
// disagrees." This file does exactly that, and nothing else.
//
// Two ground truths are DERIVED from code/data, never hardcoded:
//   1. the trip count -- from `raiseTrip(` CALL SITES in src/models.js
//   2. the registered-source count -- from `### 7.n` headings in docs/RESOURCES.md
//
// Prose in the documents below is then scanned for claims about those two
// numbers, and any claim that disagrees with the derived truth fails --
// UNLESS it is a documented, deliberate exception on the ALLOWLIST below.
// The allowlist itself is checked for rot: every entry's substring must
// still be present in its file, or the test fails (a stale entry cannot
// hide silently). See "PROVING IT WORKS" at the bottom of this file for how
// to demonstrate both failure directions.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Derivation 1: the trip count, from src/models.js raiseTrip( CALL SITES.
// ---------------------------------------------------------------------------
//
// A call site looks like: raiseTrip(ctx, 'TAG', 'CONDITION', val, eu, desc)
// The function DEFINITION (`function raiseTrip(ctx, src, cond, val, eu, desc) {`)
// has bare identifiers, not string literals, right after `ctx,` -- so requiring
// a quoted string as the second argument excludes the definition without
// needing to special-case it. Comment lines are skipped defensively too.
function deriveTripSites() {
  const text = read('src/models.js');
  const callRe = /raiseTrip\(\s*ctx\s*,\s*'([^']+)'\s*,\s*'([^']+)'/;
  const sites = [];
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return;
    if (/function\s+raiseTrip\s*\(/.test(line)) return;
    const m = callRe.exec(line);
    if (m) sites.push({ src: m[1], cond: m[2], lineNo: i + 1, line: trimmed });
  });
  return sites;
}

// ---------------------------------------------------------------------------
// Derivation 2: the registered-source count, from docs/RESOURCES.md §7.
// ---------------------------------------------------------------------------
function deriveResourceHeadings() {
  const text = read('docs/RESOURCES.md');
  const headingRe = /^### 7\.(\d+)\b/gm;
  const nums = [];
  let m;
  while ((m = headingRe.exec(text))) nums.push(Number(m[1]));
  return nums;
}

// ---------------------------------------------------------------------------
// Number-word helpers. Only small, closed vocabularies -- exactly what the
// actual prose uses -- to keep the matcher conservative.
// ---------------------------------------------------------------------------
const SMALL_NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
function smallWordToNum(w) {
  if (/^\d+$/.test(w)) return Number(w);
  return SMALL_NUM_WORDS[w.toLowerCase()];
}

const BIG_NUM_WORDS = {
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, 'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23,
  'twenty-four': 24, 'twenty-five': 25, 'twenty-six': 26, 'twenty-seven': 27,
  'twenty-eight': 28, 'twenty-nine': 29, thirty: 30,
};
function bigWordToNum(w) {
  return BIG_NUM_WORDS[w.toLowerCase()];
}

// ---------------------------------------------------------------------------
// The prose documents to scan (at minimum, per the task).
// ---------------------------------------------------------------------------
const PROSE_FILES = [
  'CLAUDE.md',
  'docs/dev/UPGRADE-PLAN.md',
  'docs/dev/V3-PLAN.md',
  'docs/dev/CONVERGENCE-SPEC.md',
  'docs/dev/W1-BOUNDARY-DOF-CONTRACT.md',
  'CHANGELOG.md',
];

// ---------------------------------------------------------------------------
// Trip-count claim matcher.
//
// Deliberately narrow: only fires on the actual structural shapes this
// repo's prose uses to state the trip count, each requiring "trip" to be
// part of the match (never a bare number near an unrelated noun like
// "six read-only agents" or "Unit 04"). Verified against the live text of
// every file in PROSE_FILES before being fixed here (see the session notes);
// widen it only after re-checking against the real files, not in the
// abstract -- a matcher that fires on innocent prose is worse than none.
// ---------------------------------------------------------------------------
// Context shown in failure messages only -- NOT used for allowlist matching
// (see isAllowed below, which uses exact span overlap instead, precisely so
// a wide display window can never accidentally absorb a *different* nearby
// match's allowlisted text and wrongly excuse an unrelated claim).
const TRIP_CONTEXT_BEFORE = 60;
const TRIP_CONTEXT_AFTER = 80;

function findTripClaims(text) {
  const claims = [];

  // P1: a number immediately before "trip threshold(s)", e.g.
  //     "the five trip thresholds", "*five* trip thresholds", "six trip thresholds"
  const p1 = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b\*{0,2}\s+trip[\s-]thresholds?\b/gi;
  let m;
  while ((m = p1.exec(text))) {
    const num = smallWordToNum(m[1]);
    if (num === undefined) continue;
    claims.push(makeClaim(text, m, num, 'P1: "<N> trip threshold(s)"'));
  }

  // P4: "There are **N**:" introducing the list, scoped to occur after a
  // "trip threshold(s)" mention within the same paragraph (<=400 chars back).
  const p4 = /There are\s+\*{0,2}(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\*{0,2}\s*:/gi;
  while ((m = p4.exec(text))) {
    const ctxBefore = text.slice(Math.max(0, m.index - 400), m.index);
    if (!/trip[\s-]thresholds?/i.test(ctxBefore)) continue;
    const num = smallWordToNum(m[1]);
    if (num === undefined) continue;
    claims.push(makeClaim(text, m, num, 'P4: "There are <N>:" (trip thresholds)'));
  }

  // P5: "All N are raised" (through raiseTrip()).
  const p5 = /\bAll\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+are\s+raised\b/gi;
  while ((m = p5.exec(text))) {
    const num = smallWordToNum(m[1]);
    if (num === undefined) continue;
    claims.push(makeClaim(text, m, num, 'P5: "All <N> are raised"'));
  }

  return claims;
}

function makeClaim(text, m, claimed, pattern) {
  const start = Math.max(0, m.index - TRIP_CONTEXT_BEFORE);
  const end = Math.min(text.length, m.index + m[0].length + TRIP_CONTEXT_AFTER);
  return {
    claimed,
    pattern,
    matchText: m[0],
    matchStart: m.index,
    matchEnd: m.index + m[0].length,
    context: text.slice(start, end),
  };
}

// ---------------------------------------------------------------------------
// Source-count claim matcher: registered-source totals in docs/RESOURCES.md §7.
// ---------------------------------------------------------------------------
const SRC_CONTEXT_BEFORE = 60;
const SRC_CONTEXT_AFTER = 40;

function findSourceCountClaims(text) {
  const claims = [];
  let m;

  // "<spelled-number> works|sources", e.g. "Twenty-two works", "twenty-two *works*"
  const spelled = /\b(fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty-one|twenty-two|twenty-three|twenty-four|twenty-five|twenty-six|twenty-seven|twenty-eight|twenty-nine|thirty)\b\*{0,2}\s+(works|sources)\b/gi;
  while ((m = spelled.exec(text))) {
    const num = bigWordToNum(m[1]);
    if (num === undefined) continue;
    claims.push(makeSrcClaim(text, m, num, 'spelled "<N> works/sources"'));
  }

  // "RESOURCES-7.1 <connector> RESOURCES-7.N" -- only counted as a range
  // claim when an explicit range connector (through/to/-/–/—/…/...) sits
  // between them; "RESOURCES-7.1 and RESOURCES-7.3" (two specific cites) is
  // deliberately NOT a range claim.
  const idRange = /RESOURCES-7\.1\b[`\s]*(?:through|to|-|–|—|\.\.\.|…)[`\s]*RESOURCES-7\.(\d+)\b/gi;
  while ((m = idRange.exec(text))) {
    claims.push(makeSrcClaim(text, m, Number(m[1]), 'id range "RESOURCES-7.1 ... RESOURCES-7.N"'));
  }

  // bare "7.1-7.N" / "7.1 through 7.N"
  const bareRange = /\b7\.1\s*(?:-|–|—|through|to)\s*7\.(\d+)\b/gi;
  while ((m = bareRange.exec(text))) {
    claims.push(makeSrcClaim(text, m, Number(m[1]), 'bare id range "7.1-7.N"'));
  }

  return claims;
}

function makeSrcClaim(text, m, claimed, pattern) {
  const start = Math.max(0, m.index - SRC_CONTEXT_BEFORE);
  const end = Math.min(text.length, m.index + m[0].length + SRC_CONTEXT_AFTER);
  return {
    claimed,
    pattern,
    matchText: m[0],
    matchStart: m.index,
    matchEnd: m.index + m[0].length,
    context: text.slice(start, end),
  };
}

// ---------------------------------------------------------------------------
// THE ALLOWLIST.
//
// Every entry names a file and a distinctive, exact substring of the
// deliberately-stale (or quoting-while-correcting) text, plus a one-line
// reason. A disagreeing claim is excused only if its surrounding context
// contains one of these substrings for the SAME file.
//
// Reciprocal rule (checked below, separately): every substring here must
// still occur verbatim in its file. An entry that matches nothing is itself
// a failure -- the allowlist cannot rot silently.
// ---------------------------------------------------------------------------
const TRIP_ALLOWLIST = [
  {
    file: 'docs/dev/V3-PLAN.md',
    substring: 'the five trip thresholds stay',
    reason:
      'Historical v3 stage-contract line, left exactly as written on purpose; ' +
      'the dated note immediately below it (2026-09-13) carries the correction to six.',
  },
  {
    file: 'docs/dev/V3-PLAN.md',
    substring: 'The line above says *five* trip thresholds',
    reason: 'The correcting note quotes the old line before stating "There are six."',
  },
  {
    file: 'CHANGELOG.md',
    substring: 'keeps its "five trip thresholds" line',
    reason: "Describes V3-PLAN.md's preserved historical line, not a fresh claim about the count.",
  },
  {
    file: 'CHANGELOG.md',
    substring: 'hard rule 4: five trip thresholds → six',
    reason: 'States the old count and the correction in the same clause (arrow notation).',
  },
  {
    file: 'CHANGELOG.md',
    substring: 'must not start without. The five trip thresholds are unchanged.',
    reason: 'Historical release entry (Stage 0/1), dated before Unit 04 shipped the sixth trip in 3.1.0: five was true then.',
  },
  {
    file: 'CHANGELOG.md',
    substring:
      'the five trip thresholds (98 % TK-101, 185 °C R-201, 950 kPa PSV, 110 °C R-202, 480 °C R-310) are unchanged',
    reason:
      'Historical release entries (the v2.0.0 and v3.0.0 sections), both dated before Unit 04 ' +
      'shipped the sixth trip; matches two changelog entries with identical wording.',
  },
];

// No registered-source disagreements exist today -- every prose mention of
// the §7 count already says twenty-two / 7.1-7.22. The allowlist mechanism
// (and its rot-check) is still exercised below with an empty list, so a
// future stale mention is caught the same way a trip-count one would be.
const SOURCE_ALLOWLIST = [];

// Precise, not proximity-based: an allowlist entry excuses a claim only when
// the claim's OWN matched text physically overlaps an occurrence of the
// entry's substring in the source text. This deliberately does NOT use a
// wide "nearby context" window -- two different disagreeing claims can sit
// within a couple hundred characters of each other (as V3-PLAN.md's stale
// line and its correcting note do), and a window-based check would let one
// match's allowlisted text accidentally excuse the other, unrelated match.
function findAllOccurrences(text, substring) {
  const starts = [];
  let from = 0;
  let i;
  while ((i = text.indexOf(substring, from)) !== -1) {
    starts.push(i);
    from = i + 1;
  }
  return starts;
}

function isAllowed(allowlist, file, text, claim) {
  return allowlist.find((a) => {
    if (a.file !== file) return false;
    return findAllOccurrences(text, a.substring).some((occStart) => {
      const occEnd = occStart + a.substring.length;
      return claim.matchStart < occEnd && claim.matchEnd > occStart;
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('derivation', () => {
  test('trip count is derived from raiseTrip( call sites in src/models.js', () => {
    const sites = deriveTripSites();
    assert.ok(
      sites.length > 0,
      'expected at least one raiseTrip( call site in src/models.js -- derivation is broken',
    );
    // Every call site must actually have a real ctx object as first arg and
    // non-empty src/cond strings -- guards against a regex that "matched"
    // something malformed.
    for (const s of sites) {
      assert.ok(s.src.length > 0, `empty trip source at src/models.js:${s.lineNo}`);
      assert.ok(s.cond.length > 0, `empty trip condition at src/models.js:${s.lineNo}`);
    }
  });

  test('docs/RESOURCES.md §7 headings are contiguous 7.1..N with no gaps or duplicates', () => {
    const nums = deriveResourceHeadings();
    assert.ok(nums.length > 0, 'expected at least one "### 7.n" heading in docs/RESOURCES.md');
    const sorted = [...nums].sort((a, b) => a - b);
    const seen = new Set();
    const dupes = [];
    for (const n of sorted) {
      if (seen.has(n)) dupes.push(n);
      seen.add(n);
    }
    assert.deepEqual(dupes, [], `duplicate "### 7.n" headings found: 7.${dupes.join(', 7.')}`);
    for (let i = 0; i < sorted.length; i++) {
      assert.equal(
        sorted[i],
        i + 1,
        `"### 7.n" headings are not contiguous from 7.1: expected 7.${i + 1}, found 7.${sorted[i]}`,
      );
    }
  });
});

describe('trip-count prose claims agree with src/models.js (or are allowlisted)', () => {
  const tripCount = deriveTripSites().length;

  for (const file of PROSE_FILES) {
    test(`${file}`, () => {
      const text = read(file);
      const claims = findTripClaims(text);
      const failures = [];
      for (const claim of claims) {
        if (claim.claimed === tripCount) continue;
        if (isAllowed(TRIP_ALLOWLIST, file, text, claim)) continue;
        failures.push(
          `  claims ${claim.claimed} via ${claim.pattern} (derived truth: ${tripCount})\n` +
            `    match: ${JSON.stringify(claim.matchText)}\n` +
            `    context: ${JSON.stringify(claim.context)}`,
        );
      }
      assert.equal(
        failures.length,
        0,
        `${file} has unannotated trip-count claim(s) disagreeing with src/models.js ` +
          `(derived trip count = ${tripCount}):\n${failures.join('\n')}`,
      );
    });
  }
});

describe('registered-source-count prose claims agree with docs/RESOURCES.md §7 (or are allowlisted)', () => {
  const sourceCount = deriveResourceHeadings().length;

  for (const file of PROSE_FILES) {
    test(`${file}`, () => {
      const text = read(file);
      const claims = findSourceCountClaims(text);
      const failures = [];
      for (const claim of claims) {
        if (claim.claimed === sourceCount) continue;
        if (isAllowed(SOURCE_ALLOWLIST, file, text, claim)) continue;
        failures.push(
          `  claims ${claim.claimed} via ${claim.pattern} (derived truth: ${sourceCount})\n` +
            `    match: ${JSON.stringify(claim.matchText)}\n` +
            `    context: ${JSON.stringify(claim.context)}`,
        );
      }
      assert.equal(
        failures.length,
        0,
        `${file} has unannotated source-count claim(s) disagreeing with docs/RESOURCES.md §7 ` +
          `(derived source count = ${sourceCount}):\n${failures.join('\n')}`,
      );
    });
  }
});

describe('the allowlist cannot rot silently', () => {
  test('every TRIP_ALLOWLIST entry still matches real text in its file', () => {
    const stale = [];
    for (const entry of TRIP_ALLOWLIST) {
      const text = read(entry.file);
      if (!text.includes(entry.substring)) {
        stale.push(`  ${entry.file}: ${JSON.stringify(entry.substring)} (${entry.reason})`);
      }
    }
    assert.equal(
      stale.length,
      0,
      `stale TRIP_ALLOWLIST entries -- the text they excuse no longer exists, remove or update them:\n${stale.join('\n')}`,
    );
  });

  test('every SOURCE_ALLOWLIST entry still matches real text in its file', () => {
    const stale = [];
    for (const entry of SOURCE_ALLOWLIST) {
      const text = read(entry.file);
      if (!text.includes(entry.substring)) {
        stale.push(`  ${entry.file}: ${JSON.stringify(entry.substring)} (${entry.reason})`);
      }
    }
    assert.equal(
      stale.length,
      0,
      `stale SOURCE_ALLOWLIST entries -- the text they excuse no longer exists, remove or update them:\n${stale.join('\n')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// PROVING IT WORKS (not run as part of this suite -- see the session record
// for the actual transcript). Both directions were demonstrated by:
//
//   1. Copying one prose file (docs/dev/V3-PLAN.md) to a scratch path,
//      changing an allowlisted line to an un-annotated disagreeing count
//      ("the five trip thresholds stay" -> "the seven trip thresholds
//      stay", with the allowlist substring no longer present), pointing a
//      scratch copy of this test's PROSE_FILES/read() at the scratch tree,
//      and confirming the claim-comparison test for that file FAILED.
//
//   2. Restoring that file, then editing another scratch copy so that a
//      real TRIP_ALLOWLIST substring (e.g. "the five trip thresholds
//      stay") no longer occurs verbatim in the file, and confirming the
//      "every TRIP_ALLOWLIST entry still matches real text" test FAILED.
//
//   Both scratch trees and the scratch test copy were deleted afterward;
//   `git status --short` showed only this file as new.
// ---------------------------------------------------------------------------
