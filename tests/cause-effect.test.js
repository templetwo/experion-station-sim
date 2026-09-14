// @artifact dev
// ESS.CauseEffect -- module-level tests for the W2 cause-and-effect matrix: the declared
// data, the seam reader's verify() checked against the six raiseTrip(...) call sites in
// src/models.js (parsed live, never a hardcoded copy), the chart, and the createRecorder()
// log. No app, no logic-harness. docs/dev/W2-CAUSE-EFFECT-CONTRACT.md is the contract these
// tests hold the module to.
//
// Field shapes below (variable/comparator/threshold as separate fields, `reset` a
// formatted '< N' string, the recorder's per-event time field spelled `t`) are read
// directly off the shipped src/cause-effect.js, not guessed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CE = require('../src/cause-effect.js');

// ---- helpers: read the live source, never a hardcoded copy of its numbers -------------

function modelsSrc() {
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'models.js'), 'utf8');
}

function appSrc() {
  return fs.readFileSync(path.join(__dirname, '..', 'Experion Station Simulator.dc.html'), 'utf8');
}

function findByCode(findings, code) {
  return findings.find((f) => f.code === code);
}

// All six raiseTrip(...) call sites in src/models.js, in source order: (src, cond, the raw
// value-expression text, eu, desc) -- a real parse of the live file, not a copy of it.
function parseRaiseTripSites(src) {
  const re = /raiseTrip\(ctx,\s*'([^']+)',\s*'([^']+)',\s*([^,]+),\s*'([^']+)',\s*'([^']+)'\)/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push({ src: m[1], cond: m[2], variable: m[3], eu: m[4], desc: m[5] });
  return out;
}

// The PARAMS.<unit> object text, sliced from its opening brace -- wide enough to reach
// tripT/resetT or psvSet/psvReset for every unit as they stand today.
function paramsBlock(src, unitKey) {
  const idx = src.indexOf(unitKey + ': {');
  assert.ok(idx !== -1, `PARAMS.${unitKey}: { not found in src/models.js`);
  return src.slice(idx, idx + 6000);
}

// Threshold/comparator/reset for each of the six onTrip rows, parsed from the guard and
// reset lines around each raiseTrip call. TK-101 and V-401 guard on a literal number;
// R-201/R-202/R-310/V-502 guard on c.tripT/c.resetT (or c.psvSet/c.psvReset), resolved
// against the live PARAMS block for that unit.
function siteFacts(src) {
  function one(guardRe, resetRe, paramsUnit, paramsRe) {
    const g = guardRe.exec(src);
    assert.ok(g, `guard pattern not found in src/models.js: ${guardRe}`);
    const r = resetRe.exec(src);
    assert.ok(r, `reset pattern not found in src/models.js: ${resetRe}`);
    if (paramsUnit) {
      const p = paramsRe.exec(paramsBlock(src, paramsUnit));
      assert.ok(p, `PARAMS.${paramsUnit} trip/reset pair not found`);
      return { comparator: g[1], threshold: Number(p[1]), reset: Number(p[2]) };
    }
    return { comparator: g[1], threshold: Number(g[2]), reset: Number(r[2]) };
  }
  return {
    TK101_HIHI: one(
      /P\.tankL\s*(>=|>)\s*(\d+)\s*&&\s*!P\.trips\.ovf/,
      /P\.trips\.ovf\s*&&\s*P\.tankL\s*(<|<=)\s*(\d+)/
    ),
    R201_HITEMP: one(
      /P\.rT\s*(>=|>)\s*c\.tripT/,
      /P\.trips\.rx\s*&&\s*P\.rT\s*(<|<=)\s*c\.resetT/,
      'U1',
      /tripT:\s*(\d+),\s*resetT:\s*(\d+)/
    ),
    V401_PSV: one(
      /P\.drumP\s*(>=|>)\s*(\d+)\)\s*\{/,
      /P\.trips\.psv\s*&&\s*P\.drumP\s*(<|<=)\s*(\d+)/
    ),
    R202_HITEMP: one(
      /b\.T\s*(>=|>)\s*c\.tripT/,
      /P\.trips\.batch\s*&&\s*b\.T\s*(<|<=)\s*c\.resetT/,
      'U2',
      /tripT:\s*(\d+),\s*resetT:\s*(\d+)/
    ),
    R310_HITEMP: one(
      /h\.bed\s*(>=|>)\s*c\.tripT/,
      /P\.trips\.bed\s*&&\s*h\.bed\s*(<|<=)\s*c\.resetT/,
      'U3',
      /tripT:\s*(\d+),\s*resetT:\s*(\d+)/
    ),
    V502_PSV: one(
      /s\.pres\s*(>=|>)\s*c\.psvSet/,
      /P\.trips\.psv502\s*&&\s*s\.pres\s*(<|<=)\s*c\.psvReset/,
      'U4',
      /psvSet:\s*(\d+),\s*psvReset:\s*(\d+)/
    ),
  };
}

// H-310 tube-skin trip: raised in the app's interlocks(), never through ctx.onTrip
// (docs/dev/W2-CAUSE-EFFECT-CONTRACT.md §0.3). Parsed from the app file for the same
// verbatim-desc reason the six onTrip rows are checked against models.js.
function h310SkinFact(app) {
  const m = /raiseA\('H-310','TUBE SKIN TRIP','Urgent',.*?,'([^']+)','([^']+)'\);/.exec(app);
  assert.ok(m, 'H-310 TUBE SKIN TRIP raiseA(...) site not found in the app');
  return { src: 'H-310', cond: 'TUBE SKIN TRIP', eu: m[1], desc: m[2] };
}

// Bare identifiers the contract's own §2 table uses for each row's variable -- 'tankL',
// 'rT', 'drumP' (the model reads P.tankL/P.rT/P.drumP but the contract table drops the P.
// prefix), 'b.T', 'h.bed', 's.pres' (kept, since those are themselves sub-objects of P).
// Used as a substring check, tolerant of either a bare or P.-qualified `variable` field.
const CORE_VAR = {
  TK101_HIHI: 'tankL',
  R201_HITEMP: 'rT',
  V401_PSV: 'drumP',
  R202_HITEMP: 'b.T',
  R310_HITEMP: 'h.bed',
  V502_PSV: 's.pres',
};

const SRC_TO_ID = {
  'TK-101': 'TK101_HIHI',
  'R-201': 'R201_HITEMP',
  'V-401': 'V401_PSV',
  'R-202': 'R202_HITEMP',
  'R-310': 'R310_HITEMP',
  'V-502': 'V502_PSV',
};

// ---- module surface ---------------------------------------------------------

test('module hygiene: pure UMD, no DOM/timers/randomness/clock; exact export surface', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'cause-effect.js'), 'utf8');
  assert.match(src.split('\n').slice(0, 3).join('\n'), /@artifact production/);
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const bad of [/\bdocument\b/, /\bwindow\./, /setTimeout|setInterval|requestAnimationFrame/, /Math\.random/, /Date\.now|new Date/]) {
    assert.equal(bad.test(code), false, `src/cause-effect.js must not contain ${bad}`);
  }
  assert.deepEqual(
    Object.keys(CE).sort(),
    ['MATRIX', 'CHART_VISIBILITY', 'causes', 'effects', 'cells', 'createRecorder', 'verify', 'chart', 'annotateDefeat'].sort(),
    'no export beyond the eight the contract names (§1)'
  );
  for (const fn of ['causes', 'effects', 'cells', 'createRecorder', 'verify', 'chart', 'annotateDefeat']) {
    assert.equal(typeof CE[fn], 'function', `${fn} must be a function`);
  }
  assert.ok(CE.MATRIX, 'MATRIX must be exported');
});

// ---- the declared data (contract §2) -----------------------------------------

test('declares ten cause rows: seven process trips (six onTrip), two motor trips, one permissive', () => {
  const rows = CE.causes();
  assert.equal(rows.length, 10, 'exactly ten declared causes');
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ['H310_SKIN', 'M202_TRIP', 'P101_PERMISSIVE', 'P101_TRIP', 'R201_HITEMP', 'R202_HITEMP',
     'R310_HITEMP', 'TK101_HIHI', 'V401_PSV', 'V502_PSV']
  );
  // The three families, each with its own count.
  const byKind = (k) => rows.filter((r) => r.kind === k).map((r) => r.id).sort();
  assert.equal(byKind('process-trip').length, 7, 'seven process trips');
  assert.deepEqual(byKind('motor-trip'), ['M202_TRIP', 'P101_TRIP']);
  assert.deepEqual(byKind('permissive'), ['P101_PERMISSIVE']);
  const onTrip = rows.filter((r) => r.seam === 'onTrip');
  assert.equal(onTrip.length, 6, "exactly six rows carry seam:'onTrip'");
  assert.deepEqual(
    onTrip.map((r) => r.id).sort(),
    ['R201_HITEMP', 'R202_HITEMP', 'R310_HITEMP', 'TK101_HIHI', 'V401_PSV', 'V502_PSV']
  );
  const skin = rows.find((r) => r.id === 'H310_SKIN');
  assert.ok(skin, 'H310_SKIN must be declared');
  assert.equal(skin.seam, 'app', 'H310_SKIN bypasses the onTrip seam (§0.3)');
  // Only the latching rows latch. The permissive is continuous -- it is re-evaluated on every
  // START and nothing is held, which is exactly why it can be enforced without a reset.
  for (const r of rows) {
    assert.equal(r.latched, r.kind !== 'permissive', `${r.id}.latched`);
  }

  // THE STANDARD SCHEMA (Anthony, 2026-09-13: "Rows carry latch, reset, lockout and permissive").
  // Every row carries all four, whatever family it belongs to; a field that does not apply is
  // null, never absent. That is what makes the schema standard rather than bespoke.
  for (const r of rows) {
    for (const f of ['latch', 'reset', 'lockout', 'permissive']) {
      assert.ok(f in r, `${r.id} must carry the field "${f}" even when it is null`);
    }
    assert.equal(typeof r.enforced, 'boolean', `${r.id}.enforced must be declared either way`);
    assert.ok(r.reset && typeof r.reset.kind === 'string', `${r.id}.reset needs a kind`);
  }

  // ENFORCED vs ADVISORY -- the distinction that makes the motor rows honest.
  // A process trip really shuts the valve. The P-101 permissive really refuses the START.
  // A motor trip latch does NOT block a restart: START clears it and runs.
  for (const r of rows.filter((x) => x.kind === 'process-trip')) {
    assert.equal(r.enforced, true, `${r.id}: a process trip is enforced by the plant`);
  }
  for (const r of rows.filter((x) => x.kind === 'motor-trip')) {
    assert.equal(r.enforced, false, `${r.id}: a motor trip latch is advisory -- START clears it`);
    assert.equal(r.reset.kind, 'manual-start');
    assert.equal(r.reset.recorded, true, `${r.id}: the defeat must be recorded`);
    assert.equal(r.lockout.sec, 30, `${r.id}: 30 s lockout after a trip (tripMotor sets m.lock=30)`);
    assert.equal(r.lockout.alsoSec, 15, `${r.id}: 15 s after an operator stop`);
  }
  const perm = rows.find((r) => r.id === 'P101_PERMISSIVE');
  assert.equal(perm.enforced, true, 'the P-101 level permissive is the one motor guard that refuses');
  assert.equal(perm.lockout, null);
  assert.equal(perm.latch, null);
});

test('every onTrip cause matches its raiseTrip(...) call site in src/models.js: src, cond, desc, eu, comparator, threshold, reset', () => {
  const src = modelsSrc();
  const sites = parseRaiseTripSites(src);
  assert.equal(sites.length, 6, 'exactly six raiseTrip(...) call sites in src/models.js');
  const facts = siteFacts(src);
  const rowsById = {};
  for (const r of CE.causes()) rowsById[r.id] = r;

  for (const site of sites) {
    const id = SRC_TO_ID[site.src];
    assert.ok(id, `raiseTrip site for ${site.src} has no matrix-row mapping expected in this test`);
    const row = rowsById[id];
    assert.ok(row, `matrix must declare ${id}`);
    assert.equal(row.src, site.src, `${id}.src`);
    assert.equal(row.cond, site.cond, `${id}.cond`);
    assert.equal(row.desc, site.desc, `${id}.desc must be the raiseTrip description, verbatim`);
    assert.equal(row.eu, site.eu, `${id}.eu`);
    assert.equal(row.seam, 'onTrip', `${id}.seam`);
    assert.equal(row.variable, CORE_VAR[id], `${id}.variable`);
    const f = facts[id];
    assert.equal(row.comparator, f.comparator, `${id}.comparator`);
    assert.equal(row.threshold, f.threshold, `${id}.threshold`);
    // The declared expr names the variable too ('P.tankL < 90'), which is more useful than the
    // bare '< 90' this test derives from the code. Containment keeps the check strict about the
    // threshold while allowing the richer form.
    assert.ok(row.reset.expr.includes('< ' + f.reset),
      `${id}.reset: declared "${row.reset.expr}" must contain the derived "< ${f.reset}"`);
  }
});

test('H310_SKIN matches the app-side interlock, verbatim: src, cond, desc, eu', () => {
  const fact = h310SkinFact(appSrc());
  const row = CE.causes().find((r) => r.id === 'H310_SKIN');
  assert.ok(row);
  assert.equal(row.src, fact.src);
  assert.equal(row.cond, fact.cond);
  assert.equal(row.desc, fact.desc);
  assert.equal(row.eu, fact.eu);
});

test('FV311 is declared causedBy both R310_HITEMP and H310_SKIN', () => {
  const fv311 = CE.effects().find((e) => e.id === 'FV311');
  assert.ok(fv311, 'FV311 must be a declared effect');
  assert.deepEqual([...fv311.causedBy].sort(), ['H310_SKIN', 'R310_HITEMP']);
});

// ---- verify(): the seam reader vs. the matrix (contract §3) -------------------

test('verify(): SEAM_TRIP_UNDECLARED is raised, named, and refuses, for a trip the matrix does not declare', () => {
  const rec = CE.createRecorder();
  rec.observe('X-999', 'BOGUS TRIP', 12345);
  const res = CE.verify(rec.seen());
  assert.equal(res.ok, false);
  const f = findByCode(res.findings, 'SEAM_TRIP_UNDECLARED');
  assert.ok(f, 'SEAM_TRIP_UNDECLARED must be reported');
  assert.equal(f.severity, 'refuse');
});

test('verify(): SEAM_ROW_UNREACHED is raised, named, and refuses, when an onTrip row never fires', () => {
  const res = CE.verify([]);
  assert.equal(res.ok, false, 'no observations at all must refuse -- none of the six rows fired');
  const f = findByCode(res.findings, 'SEAM_ROW_UNREACHED');
  assert.ok(f, 'SEAM_ROW_UNREACHED must be reported');
  assert.equal(f.severity, 'refuse');
});

test('verify(): five of six onTrip rows observed still leaves the sixth SEAM_ROW_UNREACHED', () => {
  const rec = CE.createRecorder();
  const rows = CE.causes().filter((r) => r.seam === 'onTrip');
  const missing = rows[rows.length - 1];
  let t = 0;
  for (const r of rows.slice(0, -1)) rec.observe(r.src, r.cond, (t += 1));
  const res = CE.verify(rec.seen());
  assert.equal(res.ok, false);
  const unreached = res.findings.filter((f) => f.code === 'SEAM_ROW_UNREACHED');
  assert.ok(unreached.length >= 1, 'SEAM_ROW_UNREACHED must be reported');
  assert.ok(
    unreached.some((f) => (f.tags || []).includes(missing.id) || (f.detail || '').includes(missing.id)),
    `the unreached finding must name the row that never fired (${missing.id})`
  );
  for (const f of unreached) assert.equal(f.severity, 'refuse');
});

test('verify(): the complete, correct set of six onTrip observations verifies clean', () => {
  const rec = CE.createRecorder();
  const rows = CE.causes().filter((r) => r.seam === 'onTrip');
  let t = 1000;
  for (const r of rows) rec.observe(r.src, r.cond, (t += 1000));
  const res = CE.verify(rec.seen());
  assert.equal(res.ok, true, JSON.stringify(res.findings));
  assert.equal(res.findings.filter((f) => f.severity === 'refuse').length, 0);
  assert.equal(findByCode(res.findings, 'SEAM_TRIP_UNDECLARED'), undefined);
  assert.equal(findByCode(res.findings, 'SEAM_ROW_UNREACHED'), undefined);
});

test('verify(): (src, cond) is compared as an ordered pair, not membership of either half -- the right trips in the wrong order are caught', () => {
  const rec = CE.createRecorder();
  const rows = CE.causes().filter((r) => r.seam === 'onTrip');
  let t = 0;
  for (const r of rows) rec.observe(r.src, r.cond, (t += 1));
  // Corrupt exactly one entry: swap src and cond on the TK-101 observation. Both halves
  // individually are strings the matrix knows about (TK-101 is a real src, HIHI TRIP is a
  // real cond) -- a membership-only check, or one keyed on either field alone, would wave
  // this straight through. Comparing the pair in order must not.
  const seen = rec.seen().map((e) => (e.src === 'TK-101' && e.cond === 'HIHI TRIP' ? { ...e, src: e.cond, cond: e.src } : e));
  const res = CE.verify(seen);
  assert.equal(res.ok, false, 'a swapped (src, cond) pair must not verify as if it matched TK101_HIHI');
  assert.ok(findByCode(res.findings, 'SEAM_TRIP_UNDECLARED'), 'the swapped pair itself names no declared row');
  assert.ok(findByCode(res.findings, 'SEAM_ROW_UNREACHED'), 'TK101_HIHI never actually fired in its declared order');
});

// ---- createRecorder(): the log itself (contract §3) ---------------------------

test('createRecorder(): seen() starts empty, and reset() clears it', () => {
  const rec = CE.createRecorder();
  assert.deepEqual(rec.seen(), []);
  rec.observe('TK-101', 'HIHI TRIP', 1);
  assert.equal(rec.seen().length, 1);
  rec.reset();
  assert.deepEqual(rec.seen(), []);
});

test('createRecorder(): observing the same (src, cond) twice at different times yields two entries -- no de-duplication', () => {
  // A second firing after a reset is a genuinely new trip event (contract §3, bullet 2)
  // and must be recorded as one, not folded into the first.
  const rec = CE.createRecorder();
  rec.observe('R-310', 'HI TEMP TRIP', 100);
  rec.observe('R-310', 'HI TEMP TRIP', 500);
  const seen = rec.seen();
  const matching = seen.filter((e) => e.src === 'R-310' && e.cond === 'HI TEMP TRIP');
  assert.equal(matching.length, 2, 'two distinct trip events, not deduplicated into one');
  assert.deepEqual(matching.map((e) => e.t).sort((a, b) => a - b), [100, 500]);
});

// ---- chart() / cells() / effects() (contract §4, acceptance (c)) --------------

test('cells() references only real cause ids and real effect ids -- no orphan cells', () => {
  const causeIds = new Set(CE.causes().map((r) => r.id));
  const effectIds = new Set(CE.effects().map((e) => e.id));
  const cells = CE.cells();
  assert.ok(Array.isArray(cells) && cells.length > 0);
  for (const cell of cells) {
    assert.ok(causeIds.has(cell.causeId), `cell references unknown cause ${cell.causeId}`);
    assert.ok(effectIds.has(cell.effectId), `cell references unknown effect ${cell.effectId}`);
    assert.equal(typeof cell.action, 'string');
    assert.ok(cell.action.length > 0, `cell ${cell.causeId}->${cell.effectId} must carry an action`);
  }
});

test('chart() returns no orphan cells, and its rows/cols cover every declared cause and effect', () => {
  const c = CE.chart();
  assert.ok(Array.isArray(c.orphans), 'chart().orphans must be an array');
  assert.equal(c.orphans.length, 0, `chart() must have no orphan cells: ${JSON.stringify(c.orphans)}`);
  const rowIds = new Set(c.rows.map((r) => r.id));
  const colIds = new Set(c.cols.map((col) => col.id));
  assert.deepEqual([...rowIds].sort(), CE.causes().map((r) => r.id).sort());
  assert.deepEqual([...colIds].sort(), CE.effects().map((e) => e.id).sort());
  for (const cell of c.cells) {
    assert.ok(rowIds.has(cell.causeId), `chart cell references a row not in chart().rows: ${cell.causeId}`);
    assert.ok(colIds.has(cell.effectId), `chart cell references a col not in chart().cols: ${cell.effectId}`);
  }
});

// ---- the visibility flag (contract §4) ----------------------------------------

test("CHART_VISIBILITY is exactly 'instructor'", () => {
  assert.equal(CE.CHART_VISIBILITY, 'instructor');
});

// ---------------------------------------------------------------------------
// Site citations must RESOLVE, not merely exist.
//
// Added after the verify pass found H310_SKIN citing "…dc.html:2836" -- a line that had become
// `const P=this.P, L=this.L;` inside stepU2. The citation was CORRECT WHEN WRITTEN and went stale
// inside the same change that wrote it: wiring the recorder and the chart added ~37 lines above it
// and pushed the real interlock down to :2873. Nothing asserted on `site`, so it went unnoticed.
//
// The fix is not a better line number. It is to stop citing line numbers into a 3100-line file that
// this very work item edits -- CLAUDE.md's own doctrine is "Line numbers drift. Grep for the
// symbol." Each site is now {file, anchor}, and these tests DERIVE the location from the anchor.
// If the code moves the anchor moves with it; if the code changes, this goes red.
// ---------------------------------------------------------------------------
const fsSite = require('node:fs');
const pathSite = require('node:path');
const ROOT_SITE = pathSite.join(__dirname, '..');

function allSites() {
  const out = [];
  for (const c of CE.causes()) if (c.site) out.push({ owner: 'cause ' + c.id, site: c.site });
  for (const e of CE.effects()) if (e.site) out.push({ owner: 'effect ' + e.id, site: e.site });
  return out;
}

test('every site citation is an {file, anchor} pair, never a bare line number', () => {
  const sites = allSites();
  assert.ok(sites.length > 0, 'there must be site citations to check');
  for (const { owner, site } of sites) {
    assert.equal(typeof site, 'object', `${owner}: site must be an object, not a string`);
    assert.equal(typeof site.file, 'string', `${owner}: site.file`);
    assert.equal(typeof site.anchor, 'string', `${owner}: site.anchor`);
    assert.ok(site.anchor.length > 10, `${owner}: the anchor must be distinctive enough to grep`);
    assert.equal(/:\d+\s*$/.test(site.file), false, `${owner}: site.file must carry no line number`);
  }
});

test('every site anchor resolves to exactly one place in the file it names', () => {
  const bad = [];
  for (const { owner, site } of allSites()) {
    let text;
    try { text = fsSite.readFileSync(pathSite.join(ROOT_SITE, site.file), 'utf8'); }
    catch { bad.push(`${owner}: cannot read ${site.file}`); continue; }
    let n = 0, i = 0;
    while ((i = text.indexOf(site.anchor, i)) !== -1) { n++; i += 1; }
    if (n !== 1) bad.push(`${owner}: anchor found ${n} times in ${site.file} (want exactly 1): ${site.anchor}`);
  }
  assert.deepEqual(bad, [], 'site anchors must each resolve uniquely:\n' + bad.join('\n'));
});

test('each cause site anchor really is the code that raises that cause', () => {
  // Not just "the anchor exists" -- the anchor must name the right trip.
  // Scoped to the onTrip seam: those anchors are raiseTrip(...) calls, which literally carry the
  // src and cond strings. Motor and permissive rows are raised by the app through other shapes
  // (tripMotor('M202', …), a bare level test), so their anchors are pinned for UNIQUE RESOLUTION
  // by the test above rather than for string containment. Relaxing that here rather than silently
  // weakening the whole assertion.
  for (const c of CE.causes().filter((r) => r.seam === 'onTrip')) {
    const text = fsSite.readFileSync(pathSite.join(ROOT_SITE, c.site.file), 'utf8');
    const line = text.split('\n').find((l) => l.includes(c.site.anchor));
    assert.ok(line, `${c.id}: anchor not found`);
    assert.ok(line.includes(c.src), `${c.id}: the cited line must name ${c.src} -- got: ${line.trim().slice(0, 90)}`);
    assert.ok(line.includes(c.cond), `${c.id}: the cited line must name "${c.cond}"`);
  }
});

// ---------------------------------------------------------------------------
// THE JOIN KEY, and the annotation built on it.
//
// Anthony's ruling, 2026-09-13: "Join key is the effect column, named DRV-M202 exactly as
// motorCmd builds it. Scored from the matrix means the defeat resolves to that column, and the
// reader annotates cause and cause-state at reset. Annotation only."
//
// The join is a STRING EQUALITY between an id in this module and a string the app constructs at
// runtime as 'DRV-' + tag. Nothing else connects the drill gate to the matrix, so the id is not
// cosmetic and these tests pin it against the app's own source rather than against a copy.
// ---------------------------------------------------------------------------

test('the motor effect columns are named exactly as the app constructs the defeat target', () => {
  const app = fsSite.readFileSync(pathSite.join(ROOT_SITE, 'Experion Station Simulator.dc.html'), 'utf8');
  // The one place the app builds the target. If this template ever changes, the join silently
  // breaks and every annotation stops resolving -- so the template itself is pinned.
  assert.ok(app.includes("this.archSynthEvent('INTERLOCK.DEFEAT','DRV-'+tag,null)"),
    "the app must still build the defeat target as 'DRV-' + tag");
  for (const tag of ['P101', 'M202']) {
    const id = 'DRV-' + tag;                       // built the same way the app builds it
    const col = CE.effects().find((e) => e.id === id);
    assert.ok(col, `${id} must be a declared effect column -- it is the join key`);
    assert.equal(col.kind, 'motor');
  }
});

test('each motor column names exactly the cause row for its own motor', () => {
  assert.deepEqual(CE.effects().find((e) => e.id === 'DRV-M202').causedBy, ['M202_TRIP']);
  assert.deepEqual(CE.effects().find((e) => e.id === 'DRV-P101').causedBy, ['P101_TRIP']);
});

test('annotateDefeat resolves DRV-M202 and names the cause and the advisory latch', () => {
  const a = CE.annotateDefeat('DRV-M202', null);
  assert.equal(a.resolved, true);
  assert.equal(a.column, 'DRV-M202');
  assert.deepEqual(a.causes, ['M202_TRIP']);
  assert.match(a.text, /M-202 MOTOR TRIP/);
  assert.match(a.text, /30 s lockout/);
  assert.match(a.text, /advisory/, 'the annotation must say the plant permits the restart');
  assert.match(a.text, /cause-state at reset: not evaluated/);
});

test('annotateDefeat reports the cause-state when the caller can observe it', () => {
  const a = CE.annotateDefeat('DRV-P101', { tankL: 42.7 });
  assert.match(a.text, /cause-state at reset: tankL=42\.7/);
  // P-101 is the motor that DOES have an enforced guard, and the annotation says which.
  assert.match(a.text, /permissive P\.tankL >= 5/);
});

test('an unresolvable target is reported as unresolvable, not guessed at', () => {
  const a = CE.annotateDefeat('DRV-NOSUCH', null);
  assert.equal(a.resolved, false);
  assert.deepEqual(a.causes, []);
  assert.match(a.text, /no declared effect column/);
});

test('annotateDefeat is ANNOTATION ONLY: it returns text and scores nothing', () => {
  // The whole ruling turns on this. The function must expose no score, no cap, no severity, and
  // must not be reachable from anything that does. Its return shape is the proof.
  const a = CE.annotateDefeat('DRV-M202', { anything: 1 });
  assert.deepEqual(Object.keys(a).sort(), ['causes', 'column', 'resolved', 'target', 'text']);
  for (const forbidden of ['score', 'cap', 'penalty', 'severity', 'weight', 'earned', 'max']) {
    assert.equal(forbidden in a, false, `annotateDefeat must not return "${forbidden}"`);
  }
  // and the module must not reach the scorer in CODE. Comment lines are stripped first, the same
  // way the purity check does it: the comments SHOULD mention src/drill-arch.js, because they are
  // what record that this module deliberately does not touch it.
  const src = fsSite.readFileSync(pathSite.join(ROOT_SITE, 'src', 'cause-effect.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal(/DrillArch|drill-arch|scoreDrill|applyGate/.test(code), false,
    'src/cause-effect.js must not reference the drill scorer in code -- gate logic is unchanged');
});
