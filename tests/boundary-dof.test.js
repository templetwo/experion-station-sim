// @artifact dev
// ESS.BoundaryDof -- module-level tests for the W1 boundary-stream declaration (lane A)
// and the control-loop specification-integrity check (lane B). No app, no logic-harness.
// docs/dev/W1-BOUNDARY-DOF-CONTRACT.md is the contract these tests hold the module to.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BD = require('../src/boundary-dof.js');
const Models = require('../src/models.js');

// ---- helpers --------------------------------------------------------------

function getField(obj, fieldPath) {
  return fieldPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Minimal loop record: the shape checkLoopSpec needs (tag, mode, modeAttr, master,
// slave, badPv). Mirrors tests/pid.test.js's mkLoop but trimmed to lane B's inputs.
function loopFx(tag, o) {
  return Object.assign({ tag, kind: 'pid', mode: 'AUTO', modeAttr: 'OPERATOR', master: null, slave: null, badPv: false }, o);
}

function findByCode(findings, code) {
  return findings.find((f) => f.code === code);
}

// The three cascades as they ship, built by hand from "Experion Station Simulator.dc.html"
// lines 1844-1860 (LIC101/FIC102, TIC201/TIC202, TIC212/TIC213).
function shippedCascadesL() {
  return {
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'CAS', master: 'LIC101' }),
    TIC201: loopFx('TIC201', { mode: 'AUTO', slave: 'TIC202' }),
    TIC202: loopFx('TIC202', { mode: 'CAS', master: 'TIC201' }),
    TIC212: loopFx('TIC212', { mode: 'MAN', slave: 'TIC213' }),
    TIC213: loopFx('TIC213', { mode: 'CAS', master: 'TIC212' }),
  };
}

// ---- module surface ---------------------------------------------------------

test('module hygiene: pure UMD, no DOM/timers/randomness/clock; exact export surface', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'boundary-dof.js'), 'utf8');
  assert.match(src.split('\n').slice(0, 3).join('\n'), /@artifact production/);
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // strip comment lines
  for (const bad of [/\bdocument\b/, /\bwindow\./, /setTimeout|setInterval|requestAnimationFrame/, /Math\.random/, /Date\.now|new Date/]) {
    assert.equal(bad.test(code), false, `src/boundary-dof.js must not contain ${bad}`);
  }
  assert.deepEqual(
    Object.keys(BD).sort(),
    ['PLANT_MAP', 'BOUNDARY_STREAMS', 'ISLANDS', 'check', 'checkBoundaries', 'checkLoopSpec', 'formatRefusal'].sort(),
    'no export beyond the seven the contract names'
  );
  assert.equal(typeof BD.checkBoundaries, 'function');
  assert.equal(typeof BD.checkLoopSpec, 'function');
  assert.equal(typeof BD.check, 'function');
  assert.equal(typeof BD.formatRefusal, 'function');
});

// ---- the declared data (contract section 2) ---------------------------------

test('declares exactly one boundary stream, U3-U4, with exactly three named vars', () => {
  assert.equal(BD.BOUNDARY_STREAMS.length, 1);
  const stream = BD.BOUNDARY_STREAMS[0];
  assert.equal(stream.id, 'U3-U4');
  assert.equal(stream.from, 'U3');
  assert.equal(stream.to, 'U4');
  assert.equal(stream.vars.length, 3);
  assert.deepEqual(stream.vars.map((v) => v.name).sort(), ['Tbed', 'Tpre', 'qfeed']);
});

test('declares exactly two islands, U1 and U2, each with a non-empty reason', () => {
  assert.equal(BD.ISLANDS.length, 2);
  const units = BD.ISLANDS.map((i) => i.unit).sort();
  assert.deepEqual(units, ['U1', 'U2']);
  for (const island of BD.ISLANDS) {
    assert.equal(typeof island.reason, 'string');
    assert.ok(island.reason.length > 0, `${island.unit} island reason must be non-empty`);
  }
});

test("every declared var's field resolves on a real P from Models.createState(), matching the contract's table", () => {
  const P = Models.createState(0);
  const byName = {};
  for (const v of BD.BOUNDARY_STREAMS[0].vars) byName[v.name] = v.field;
  assert.deepEqual(byName, { qfeed: 'h.f', Tpre: 'h.pre', Tbed: 'h.bed' });
  for (const v of BD.BOUNDARY_STREAMS[0].vars) {
    const val = getField(P, v.field);
    assert.equal(typeof val, 'number', `${v.name} (${v.field}) must resolve to a number on a fresh P`);
    assert.ok(Number.isFinite(val), `${v.name} (${v.field}) must be finite on a fresh P`);
  }
});

// ---- lane A: boundary-stream specification -----------------------------------

test('lane A passes on a fresh P and always emits BOUNDARY_SPEC_STRUCTURAL as a note that alone never sets ok:false', () => {
  const P = Models.createState(0);
  const res = BD.checkBoundaries(P);
  assert.equal(res.lane, 'A');
  assert.equal(res.ok, true);
  const note = findByCode(res.findings, 'BOUNDARY_SPEC_STRUCTURAL');
  assert.ok(note, 'BOUNDARY_SPEC_STRUCTURAL must always be emitted by lane A');
  assert.equal(note.severity, 'note');
  // no refuse-severity finding accompanies a clean P
  assert.equal(res.findings.some((f) => f.severity === 'refuse'), false);
});

test('lane A refuses with BOUNDARY_NOT_FINITE when a boundary field is NaN', () => {
  const P = Models.createState(0);
  P.h.f = NaN;
  const res = BD.checkBoundaries(P);
  assert.equal(res.lane, 'A');
  assert.equal(res.ok, false);
  const finding = findByCode(res.findings, 'BOUNDARY_NOT_FINITE');
  assert.ok(finding, 'BOUNDARY_NOT_FINITE must be reported');
  assert.equal(finding.severity, 'refuse');
  // the structural note still fires alongside the refusal
  const note = findByCode(res.findings, 'BOUNDARY_SPEC_STRUCTURAL');
  assert.ok(note);
  assert.equal(note.severity, 'note');
});

test('lane A refuses with BOUNDARY_NOT_FINITE for each of the other two boundary vars too', () => {
  for (const field of ['h.pre', 'h.bed']) {
    const P = Models.createState(0);
    let o = P;
    const parts = field.split('.');
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = NaN;
    const res = BD.checkBoundaries(P);
    assert.equal(res.ok, false, `NaN at ${field} must refuse`);
    assert.ok(findByCode(res.findings, 'BOUNDARY_NOT_FINITE'), `NaN at ${field} must report BOUNDARY_NOT_FINITE`);
  }
});

// ---- lane B: control-loop specification integrity ----------------------------

test('lane B passes on the three shipped cascades in their shipped modes, with no findings at all', () => {
  const L = shippedCascadesL();
  const res = BD.checkLoopSpec(L);
  assert.equal(res.lane, 'B');
  assert.equal(res.ok, true);
  assert.deepEqual(res.findings, []);
});

test('CASCADE_OPEN is REPORTED but never refuses: an open cascade is legitimate operation', () => {
  // LIC101 AUTO with its slave FIC102 left in MAN instead of CAS: the cascade is open and
  // the master is not in control. This is worth SAYING and must never be refused --
  // tests/app-instructor.test.js does exactly this to TIC202 and then starts D1, and drill
  // D6's whole premise is taking a slave to MAN (src/models.js:52). pid.js back-calculates
  // through INITMAN so the state is well-posed: one specification, the operator's OP.
  const L = {
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'MAN', master: 'LIC101' }),
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, true, 'an open cascade must NOT refuse -- it is ordinary operation');
  const finding = findByCode(res.findings, 'CASCADE_OPEN');
  assert.ok(finding, 'CASCADE_OPEN must still be reported');
  assert.equal(finding.severity, 'note');
  assert.deepEqual([...finding.tags].sort(), ['FIC102', 'LIC101']);
});

test('CASCADE_OPEN also fires when the master is CAS (not just AUTO) and the slave is not CAS', () => {
  const L = {
    TIC201: loopFx('TIC201', { mode: 'CAS', master: 'GHOST', slave: 'TIC202' }),
    TIC202: loopFx('TIC202', { mode: 'AUTO', master: 'TIC201' }),
  };
  const res = BD.checkLoopSpec(L);
  const finding = findByCode(res.findings, 'CASCADE_OPEN');
  assert.ok(finding);
  assert.equal(finding.severity, 'note');
});

test('CASCADE_NO_MASTER: constructed, reported, named, refuse severity, ok:false (master tag absent)', () => {
  // FIC102 is CAS but declares no master at all.
  const L = { FIC102: loopFx('FIC102', { mode: 'CAS', master: null }) };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, false);
  const finding = findByCode(res.findings, 'CASCADE_NO_MASTER');
  assert.ok(finding, 'CASCADE_NO_MASTER must be reported');
  assert.equal(finding.severity, 'refuse');
});

test('CASCADE_NO_MASTER: constructed, reported, named, refuse severity, ok:false (master tag not present in L)', () => {
  // FIC102 is CAS and names a master tag that restoreSnapshot never populated into L.
  const L = { FIC102: loopFx('FIC102', { mode: 'CAS', master: 'LIC101' }) };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, false);
  const finding = findByCode(res.findings, 'CASCADE_NO_MASTER');
  assert.ok(finding);
  assert.equal(finding.severity, 'refuse');
});

test('exclusion: modeAttr PROGRAM is sequence-owned -- an open-looking cascade does not refuse, and LOOP_SEQUENCE_OWNED is a note', () => {
  const L = {
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'MAN', master: 'LIC101', modeAttr: 'PROGRAM' }),
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, true, 'a PROGRAM-owned slave mode must not refuse');
  assert.equal(res.findings.some((f) => f.severity === 'refuse'), false);
  assert.equal(findByCode(res.findings, 'CASCADE_OPEN'), undefined, 'CASCADE_OPEN must not fire under the PROGRAM exclusion');
  const note = findByCode(res.findings, 'LOOP_SEQUENCE_OWNED');
  assert.ok(note, 'LOOP_SEQUENCE_OWNED must be emitted');
  assert.equal(note.severity, 'note');
});

test('exclusion: badPv is a shed response, not a specification choice -- does not refuse, and LOOP_SHED is a note', () => {
  const L = {
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'MAN', master: 'LIC101', badPv: true }),
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, true, 'a shed (badPv) slave mode must not refuse');
  assert.equal(res.findings.some((f) => f.severity === 'refuse'), false);
  assert.equal(findByCode(res.findings, 'CASCADE_OPEN'), undefined, 'CASCADE_OPEN must not fire under the badPv exclusion');
  const note = findByCode(res.findings, 'LOOP_SHED');
  assert.ok(note, 'LOOP_SHED must be emitted');
  assert.equal(note.severity, 'note');
});

test('exclusion: master MAN with slave CAS is well-posed -- no finding at all (TIC212/TIC213 as shipped)', () => {
  const L = {
    TIC212: loopFx('TIC212', { mode: 'MAN', slave: 'TIC213' }),
    TIC213: loopFx('TIC213', { mode: 'CAS', master: 'TIC212' }),
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, true);
  assert.deepEqual(res.findings, [], 'master MAN / slave CAS is well-posed and must not produce even a note');
});

// ---- check(P, L): both lanes concatenated ------------------------------------

test('check(P, L) concatenates both lanes and ok is the AND of theirs', () => {
  const goodP = Models.createState(0);
  const badP = Models.createState(0);
  badP.h.f = NaN;
  const goodL = shippedCascadesL();
  // a genuinely REFUSING lane-B state: a loop in CAS whose master does not exist.
  // (An open cascade is only a note -- see the CASCADE_OPEN test above.)
  const badL = { FIC102: loopFx('FIC102', { mode: 'CAS', master: 'GHOST' }) };

  const bothGood = BD.check(goodP, goodL);
  assert.equal(bothGood.ok, true);
  // lane A's structural note still shows up in the concatenated findings
  assert.ok(findByCode(bothGood.findings, 'BOUNDARY_SPEC_STRUCTURAL'));
  assert.deepEqual(bothGood.findings.filter((f) => f.severity === 'refuse'), []);

  const aBadOnly = BD.check(badP, goodL);
  assert.equal(aBadOnly.ok, false, 'lane A refusing must make check() refuse');
  assert.ok(findByCode(aBadOnly.findings, 'BOUNDARY_NOT_FINITE'));

  const bBadOnly = BD.check(goodP, badL);
  assert.equal(bBadOnly.ok, false, 'lane B refusing must make check() refuse');
  assert.ok(findByCode(bBadOnly.findings, 'CASCADE_NO_MASTER'));

  const bothBad = BD.check(badP, badL);
  assert.equal(bothBad.ok, false);
  assert.ok(findByCode(bothBad.findings, 'BOUNDARY_NOT_FINITE'));
  assert.ok(findByCode(bothBad.findings, 'CASCADE_NO_MASTER'));
  // both lanes' findings really are concatenated into one array
  assert.equal(
    bothBad.findings.length,
    BD.checkBoundaries(badP).findings.length + BD.checkLoopSpec(badL).findings.length
  );
});

// ---- formatRefusal ------------------------------------------------------------

test('formatRefusal names the refusing code from a lane A refusal', () => {
  const P = Models.createState(0);
  P.h.pre = NaN;
  const res = BD.checkBoundaries(P);
  const msg = BD.formatRefusal(res);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  assert.match(msg, /BOUNDARY_NOT_FINITE/);
});

test('formatRefusal names the refusing code from a lane B refusal', () => {
  const L = { FIC102: loopFx('FIC102', { mode: 'CAS' }) };   // CAS with no master declared
  const res = BD.checkLoopSpec(L);
  const msg = BD.formatRefusal(res);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
  assert.match(msg, /CASCADE_NO_MASTER/);
});

test('formatRefusal prefers a refusing finding over an earlier note', () => {
  // CASCADE_OPEN (note) is pushed before CASCADE_NO_MASTER (refuse); the refusal must win.
  const L = {
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'MAN', master: 'LIC101' }),
    TIC213: loopFx('TIC213', { mode: 'CAS' }),
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.ok, false);
  assert.match(BD.formatRefusal(res), /CASCADE_NO_MASTER/);
});


// ---- PLANT_MAP: the declared plant map artifact ---------------------------------
// Anthony, 2026-09-13: "Record the topology as a declared plant map artifact: U1 and U2 are
// islands, U3 to U4 is the only boundary. Item 1 reads that map, it doesn't invent couplings."
// These tests are what stop the map drifting from the model it claims to describe.

test('PLANT_MAP declares all four units, exactly one boundary, and exactly two islands', () => {
  const m = BD.PLANT_MAP;
  assert.deepEqual(m.units, ['U1', 'U2', 'U3', 'U4']);
  assert.equal(m.boundaries.length, 1, 'U3 -> U4 is the only inter-unit material coupling');
  assert.equal(m.boundaries[0].id, 'U3-U4');
  assert.deepEqual(m.islands.map((i) => i.unit).sort(), ['U1', 'U2']);
  assert.ok(m.assertion && m.assertion.length > 0, 'the map must state what it asserts');
  assert.ok(m.derivedFrom && /models\.js/.test(m.derivedFrom), 'the map must say where it came from');
});

test('PLANT_MAP.boundaries and .islands are the same objects as the standalone exports', () => {
  // One source of truth. If these ever diverge, a consumer reading the map and a consumer
  // reading the exports would see different plants.
  assert.equal(BD.PLANT_MAP.boundaries, BD.BOUNDARY_STREAMS);
  assert.equal(BD.PLANT_MAP.islands, BD.ISLANDS);
});

test('PLANT_MAP.notBoundaries lists the shared inputs that must NOT become network edges', () => {
  // P.Tcw, env.Tamb and env.catAct are read by two units but written by neither unit's step
  // code -- instructor and fault inputs, not material streams. A pressure-flow network that
  // counted them would carry phantom edges.
  const nb = BD.PLANT_MAP.notBoundaries;
  assert.ok(Array.isArray(nb) && nb.length > 0);
  for (const f of ['P.Tcw', 'env.Tamb', 'env.catAct', 'P.t']) {
    assert.ok(nb.includes(f), `${f} must be declared as not-a-boundary`);
  }
  // and none of them may appear as a declared boundary var
  const declared = BD.BOUNDARY_STREAMS.flatMap((b) => b.vars.map((v) => 'P.' + v.field));
  for (const f of nb) assert.equal(declared.includes(f), false, `${f} must not also be declared a boundary`);
});

test('lane B reports CASCADE_OPEN first, ahead of the exclusion notes', () => {
  // Anthony, 2026-09-13: "CASCADE_OPEN first." It is lane B's lead finding.
  const L = {
    // a PROGRAM-owned pair, which pushes a LOOP_SEQUENCE_OWNED note during the walk
    FIC211: loopFx('FIC211', { mode: 'AUTO', slave: 'GHOSTSLAVE', modeAttr: 'PROGRAM' }),
    GHOSTSLAVE: loopFx('GHOSTSLAVE', { mode: 'MAN', master: 'FIC211', modeAttr: 'PROGRAM' }),
    // and an open cascade, declared second so the walk would naturally find it later
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'MAN', master: 'LIC101' }),
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.findings[0].code, 'CASCADE_OPEN', 'CASCADE_OPEN must lead lane B');
  assert.ok(res.findings.some((f) => f.code === 'LOOP_SEQUENCE_OWNED'), 'the note must still be present');
  assert.equal(res.ok, true, 'neither finding refuses');
});

test('reporting order never changes whether lane B refuses', () => {
  // ok is a property of the set, not the order. A refusing finding behind the CASCADE_OPEN
  // lead must still refuse, and formatRefusal must still name it.
  const L = {
    LIC101: loopFx('LIC101', { mode: 'AUTO', slave: 'FIC102' }),
    FIC102: loopFx('FIC102', { mode: 'MAN', master: 'LIC101' }),
    TIC213: loopFx('TIC213', { mode: 'CAS' }),   // CAS with no master -> refuse
  };
  const res = BD.checkLoopSpec(L);
  assert.equal(res.findings[0].code, 'CASCADE_OPEN', 'the note still leads');
  assert.equal(res.ok, false, 'the refusal behind it still refuses');
  assert.match(BD.formatRefusal(res), /CASCADE_NO_MASTER/);
});
