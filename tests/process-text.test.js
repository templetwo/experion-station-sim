// @artifact dev
// The process-text consistency gate.
//
// src/process.js is the plant orientation document. It is the ONE source the
// operator's PROC dialog and PIP's context both read, which makes it the one
// place a confident, wrong sentence can reach a veteran board operator and a
// coach at the same time. This file makes that prose falsifiable.
//
// It asserts three things:
//   1. Every point tag the prose names actually exists in the running plant.
//   2. Every tag-shaped token in the prose is declared in tagsNamed(), so the
//      document cannot quietly grow a reference nothing checks.
//   3. The load-bearing NUMBERS in the prose match the live configuration —
//      trip points, reset points, alarm limits, setpoint clamps. This is the
//      assertion that matters: the tag list goes stale loudly, but a retuned
//      trip point goes stale silently, and the operator is the one who finds it.
//
// Plus a structural check: every heading obeys the same rule tools/coach/serve.py
// applies when it splits sections. A heading that fails that rule is silently
// folded into the section above it, and PIP is handed the wrong context with no
// error anywhere.
//
// If you edit src/process.js and this goes red, the PROSE is wrong, not the test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const Process = require('../src/process.js');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim(1700000000000);
  return c;
}

test('PROCESS TEXT: every tag the prose names exists in the plant', () => {
  const c = boot();
  const missing = Process.tagsNamed().filter((t) => !c.L[t]);
  assert.deepEqual(missing, [],
    `the orientation document names points that do not exist: ${missing.join(', ')}. ` +
    'An operator reading this would look for a faceplate that is not there.');
});

test('PROCESS TEXT: no tag appears in the prose without being declared', () => {
  const c = boot();
  const declared = new Set(Process.tagsNamed());
  const text = Process.text();
  // Instrument-tag shape used by this plant's point list: 2-3 letters + 3 digits.
  const found = new Set((text.match(/\b[A-Z]{2,3}[0-9]{3}\b/g) || []));
  const undeclared = [...found].filter((t) => c.L[t] && !declared.has(t));
  assert.deepEqual(undeclared, [],
    `these real tags appear in the prose but are not in tagsNamed(): ${undeclared.join(', ')}. ` +
    'Add them there so test 1 checks them, or the document can drift unchecked.');
});

test('PROCESS TEXT: named tags are not contradicted by their own descriptions', () => {
  const c = boot();
  // A weak but real check: the point must carry a description at all, and the
  // prose must not call a controller an indicator or vice versa. `kind:'ind'`
  // points cannot be driven by the operator, and the document tells the
  // operator which ones those are.
  for (const t of Process.tagsNamed()) {
    const p = c.L[t];
    assert.ok(p.desc && p.desc.length > 3, `${t} has no usable description`);
  }
  // FI100 is explicitly described in the prose as indication only. If it ever
  // becomes a controller, the sentence "you do not control it" becomes a lie.
  assert.equal(c.L.FI100.kind, 'ind',
    'the prose tells the operator FI100 is indication only — it is now controllable');
  assert.match(Process.text(), /FI100[\s\S]{0,120}indication/,
    'the FI100 sentence no longer says it is indication only');
});

test('PROCESS TEXT: the trip and reset values in the prose are the real ones', () => {
  const Models = require('../src/models.js');
  const P = Models.PARAMS;
  const text = Process.text();

  // R-201 conversion reactor
  assert.equal(P.U1.tripT, 185, 'R-201 trip moved; the prose says 185');
  assert.equal(P.U1.resetT, 160, 'R-201 reset moved; the prose says 160');
  assert.match(text, /hard trip at 185 DEG C/);
  assert.match(text, /back to 160 DEG C/);

  // R-202 batch reactor
  assert.equal(P.U2.tripT, 110, 'R-202 trip moved; the prose says 110');
  assert.equal(P.U2.resetT, 70, 'R-202 reset moved; the prose says 70');
  assert.match(text, /trips at 110 DEG C and does not reset\s*\n?until 70/);

  // R-310 fixed bed
  assert.equal(P.U3.tripT, 480, 'R-310 trip moved; the prose says 480');
  assert.equal(P.U3.resetT, 400, 'R-310 reset moved; the prose says 400');
  assert.match(text, /trips at 480 DEG C/);
});

test('PROCESS TEXT: the alarm limits in the prose are the real ones', () => {
  const c = boot();
  const text = Process.text();

  // The tube-skin claim is the one most likely to be wrong, because the two
  // passes deliberately do NOT share limits and it is tempting to write one
  // number for both.
  // Compare limit and priority only. initSim() appends a runtime deadband as a
  // third element, which is a display/hysteresis concern the prose never states.
  const lim = (t, cond) => c.L[t].alm[cond].slice(0, 2);
  assert.deepEqual(lim('TI314', 'PVHI'), [440, 'High']);
  assert.deepEqual(lim('TI314', 'PVHH'), [490, 'Urgent']);
  assert.deepEqual(lim('TI315', 'PVHI'), [450, 'High']);
  assert.deepEqual(lim('TI315', 'PVHH'), [500, 'Urgent']);
  assert.match(text, /pass 1 is\s*\n?High at 440 and Urgent at 490 DEG C, pass 2 is High at 450 and Urgent at\s*\n?500/,
    'the per-pass tube-skin limits in the prose no longer match the configuration');

  // Excess oxygen
  assert.deepEqual(lim('AI316', 'PVLO'), [1.5, 'Low']);
  assert.match(text, /1\.5 percent/);

  // Bed hot spot
  assert.deepEqual(lim('TI312', 'PVHI'), [440, 'High']);
  assert.deepEqual(lim('TI312', 'PVHH'), [480, 'Urgent']);

  // Reactor feed setpoint clamp — the prose explains WHY it is 80
  assert.equal(c.L.FIC102.sphilm, 80, 'the FIC102 setpoint clamp moved; the prose says 80 M3/H');
  assert.match(text, /limited to 80 M3\/H/);

  // Conversion indicator and its target band
  assert.equal(c.L.AI205.pv, 85);
  assert.equal(c.L.AI205.tgtLo, 75);
  assert.equal(c.L.AI205.tgtHi, 95);
  assert.match(text, /nominally 85 percent/);
  assert.match(text, /75 to 95/);
});

test('PROCESS TEXT: the V-401 relief description matches the model', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'models.js'), 'utf8');
  // The model lifts the PSV at 950 kPa and reseats below 900. Both numbers are
  // in the operator's document, and lifting a relief valve is the one event in
  // Unit One the operator must never treat as a control action.
  assert.match(src, /P\.drumP\s*>[=]?\s*950|drumP\s*>=?\s*950/,
    'the V-401 PSV lift point is no longer 950 kPa in models.js');
  assert.match(src, /P\.drumP\s*<\s*900/,
    'the V-401 PSV reseat point is no longer 900 kPa in models.js');
  assert.match(Process.text(), /lifts at 950 KPA and\s*\n?reseats below 900/);
});

test('PROCESS TEXT: the Unit 04 numbers in the prose are the real ones', () => {
  // Every number the UNIT FOUR section states, pinned to the configuration and the model the
  // way the U1-U3 gates above pin theirs (U4-SEPARATOR-CONTRACT section 4: "the gate checks them").
  const Models = require('../src/models.js');
  const Instr = require('../src/instructor.js');
  const c = boot();
  const text = Process.text();
  const lim = (t, cond) => c.L[t].alm[cond].slice(0, 2);
  // setpoints
  assert.equal(c.L.TIC502.sp, 45); assert.match(text, /separator inlet\s*\n?at 45 DEG C/);
  assert.equal(c.L.LIC504.sp, 25); assert.match(text, /interface at 25 percent/);
  assert.equal(c.L.PIC505.sp, 800); assert.match(text, /PIC505 holds 800 KPA/);
  // alarm limits
  assert.deepEqual(lim('LIC504', 'PVHI'), [40, 'High']);
  assert.deepEqual(lim('LIC504', 'PVHH'), [48, 'Urgent']);
  assert.match(text, /LIC504 is High at 40 percent and Urgent at 48/);
  assert.deepEqual(lim('AI509', 'PVHI'), [2, 'High']);
  assert.deepEqual(lim('AI509', 'PVHH'), [5, 'Urgent']);
  assert.match(text, /AI509 reads water in the oil draw, High at 2 percent\s*\n?and Urgent at 5/);
  assert.ok(c.L.AI510.alm.PVHI && !c.L.AI510.alm.PVHH, 'AI510 carries a High alarm only, as the prose says');
  assert.match(text, /carries a High alarm only/);
  // the weir
  assert.equal(Models.envDefaults().weirH, 55);
  const w = Instr.variableDefs().find((d) => d.k === 'weirH');
  assert.deepEqual([w.min, w.max, w.def], [30, 90, 55]);
  assert.match(text, /55 percent of vessel height by default, adjustable from 30 to 90/);
  // relief
  assert.equal(Models.PARAMS.U4.psvSet, 1100);
  assert.equal(Models.PARAMS.U4.psvReset, 1000);
  assert.match(text, /PSV-502 lifts at 1100\s*\n?KPA and reseats below 1000/);
  // analyser lag: both analysers are lagged 30 s in measureU4
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'models.js'), 'utf8');
  assert.equal((src.match(/L\.AI5(09|10)\.pv = lag\([^;]*, 30, dt\)/g) || []).length, 2, 'the analyser lag is no longer 30 s for both analysers');
  assert.match(text, /lag the interface that makes\s*\n?them by about half a minute/);
});

test('PROCESS TEXT: headings survive the coach section splitter', () => {
  // tools/coach/serve.py splits guide/process sections with:
  //     line.isupper() and line.replace(" ","").isalpha() and len(line) < 40
  // A heading with a digit or a hyphen fails silently and is folded into the
  // previous section, so PIP is handed the wrong context and nothing errors.
  const sections = Process.sections();
  assert.ok(sections.length >= 6, `expected the document to split into sections, got ${sections.length}`);
  for (const s of sections) {
    assert.ok(s.title.length < 40, `heading too long for the splitter: "${s.title}"`);
    assert.equal(s.title, s.title.toUpperCase(), `heading is not upper case: "${s.title}"`);
    assert.match(s.title, /^[A-Za-z ]+$/,
      `heading contains a character the splitter rejects (digit or punctuation): "${s.title}"`);
    assert.ok(s.body.trim().length > 0, `section "${s.title}" is empty`);
  }
});

test('PROCESS TEXT: the document states its own limits', () => {
  const text = Process.text();
  // The three claims that keep this honest in front of a veteran.
  assert.match(text, /does not exist/, 'the document must say the plant is not real');
  assert.match(text, /no proprietary flowsheet, catalyst, operating/,
    'the document must state the proprietary boundary');
  assert.match(text, /WHAT IS NOT SIMULATED/,
    'the document must enumerate what is outside the trainer');
  const f = Process.fidelity();
  assert.ok(f.notModelled.length >= 3, 'fidelity() must name what is not modelled');
  assert.match(f.ceiling, /[Nn]ot a process design tool/);
});

test('PROCESS TEXT: every published source is named', () => {
  const s = Process.sources();
  assert.ok(s.length >= 5, 'each simulated unit should name the model it rests on');
  for (const item of s) {
    assert.ok(item.name && item.name.length > 5, 'a source needs a name');
    assert.ok(item.use && item.use.length > 5, `source "${item.name}" needs a stated use`);
  }
});
