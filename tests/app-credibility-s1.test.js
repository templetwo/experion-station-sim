// @artifact dev
// Credibility pass, stage S1: observed values and output tracking (docs/dev/CREDIBILITY-PASS-SPEC.md §2, §3).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Models = require('../src/models.js');
const CauseEffect = require('../src/cause-effect.js');
const AlarmHelp = require('../src/alarm-help.js');
const Palette = require('../src/palette.js');
const fs = require('node:fs');
const path = require('node:path');

// Point Detail rows come from the page's mRow(label,param,value,canEdit,note): read .value and .note.
const { Component } = load();
function boot(seed, sec) {
  const c = new Component({});
  c.initSim();
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
// Jacket cooling lost by the operator's own hand: TIC202 to MAN, OP 0, exactly the playtest's D7 repro.
function loseCooling(c) { c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 0); }
// Hatch strength for a saturated (UNCERTAIN) reading. The brief had 0.45; controller ruling CR12 lowered it to 0.30
// because 0.45 left the 9 px unit label and the 10 px mode letter under AA (see the AA test below).
const UNCERTAIN_HATCH = 0.30;

test('D7: the jacket transmitter saturates at its reporting limit and the loop record tracks the observed value', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110), 'the jacket model exceeded 110 C');
  const l = c.L.TIC202;
  assert.equal(l.pvObs, 103.125);
  assert.equal(l.obs.quality, 'UNCERTAIN');
  assert.equal(l.obs.limit, 'HIGH');
  assert.ok(l.pv > 103.125, 'the raw model value is untouched');
  c.step(0.5);
  assert.equal(l.lastPv, 103.125, 'the loop record tracks the observed value, not the model');
  const last = c.hist.TIC202[c.hist.TIC202.length - 1];
  assert.equal(last[1], 103.125, 'the trend pen carries the observed value');
});

test('D7: alarms evaluate the observed value and report it', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.alarms.some((a) => a.tag === 'TIC202' && a.cond === 'PVHH' && a.active)), 'PVHH raised');
  const a = c.alarms.find((x) => x.tag === 'TIC202' && x.cond === 'PVHH' && x.active);
  assert.ok(a.val <= 103.125, 'the alarm value is the reported value, never the model value: ' + a.val);
});

test('measure() is idempotent and writes obs for every pid and ind point', () => {
  const c = boot(4);
  c.step(0.5);
  for (const k in c.L) { const l = c.L[k]; if (l.kind === 'pid' || l.kind === 'ind') { assert.ok(l.obs, k); assert.equal(typeof l.pvObs, 'number', k); } }
  const before = JSON.stringify(c.L.TIC201.obs);
  c.measure();
  assert.equal(JSON.stringify(c.L.TIC201.obs), before);
});

test('a bad PV keeps the raw value as pvObs so the shed path is unchanged', () => {
  const c = boot(4, 'OPER');
  c.injectFault('xmtr', true);                 // FIC102 transmitter fault -> badPv after its hold time
  assert.ok(run(c, 600, () => c.L.FIC102.badPv), 'FIC102 went bad');
  assert.equal(c.L.FIC102.obs.quality, 'BAD');
  assert.equal(c.L.FIC102.pvObs, c.L.FIC102.pv);
});

// Beyond the brief's four: the D7 alarm test above raises PVHH at 85, well inside the window, so
// the model value and the reported value agree when it fires and it cannot tell the two apart.
test('D7: the alarm scan evaluates and reports the observed value, not the model value', () => {
  const c = boot(4, 'OPER');
  const l = c.L.TIC202;
  l.pv = 120;                                   // the model is far past anything the transmitter can send
  l.alm.PVHH = [105, 'Urgent', 12];             // a limit above the reporting window: no report can ever reach it
  c.measure();
  c.scan(0.5);
  const hi = c.alarms.find((a) => a.tag === 'TIC202' && a.cond === 'PVHI');
  assert.ok(hi && hi.active, 'PVHI (70) raised from the reported value');
  assert.equal(hi.val, 103.125, 'the alarm carries the value the transmitter reports');
  assert.ok(!c.alarms.some((a) => a.tag === 'TIC202' && a.cond === 'PVHH' && a.active), 'a limit above the window is never reached by what the transmitter reports');
});

test('measure() runs after the models and before the controllers and the alarm scan (spec §2.3)', () => {
  const c = boot(4);
  const order = [];
  for (const name of ['stepU4', 'measure', 'pids', 'scan']) { const f = c[name].bind(c); c[name] = (...a) => { order.push(name); return f(...a); }; }
  c.step(0.5);
  assert.deepEqual(order, ['stepU4', 'measure', 'pids', 'scan']);
});

test('measure() falls back to the raw value when the observed value is not finite (CR9)', () => {
  const c = boot(4);
  const M = globalThis.ESS.Measurement, real = M.observe;
  M.observe = () => ({ pv: NaN, badPv: false, quality: 'GOOD', statusCode: 0, statusName: 'Good', limit: 'NONE' });
  try { c.measure(); } finally { M.observe = real; }
  assert.equal(c.L.TIC201.pvObs, c.L.TIC201.pv, 'a NaN never reaches the controller through pvObs');
});

test('D14: fmt never prints a negative zero at any precision', () => {
  const c = boot(1);
  assert.equal(c.fmt(-0.04, 1), '0.0');
  assert.equal(c.fmt(-0.004, 2), '0.00');
  assert.equal(c.fmt(-0.4, 0), '0');
  assert.equal(c.fmt(-0.00004, 4), '0.0000');
  assert.equal(c.fmt(-0.6, 0), '-1');
  assert.equal(c.fmt(-1.26, 1), '-1.3');
  assert.equal(c.fmt(null, 1), '—');
  assert.equal(c.fmt(NaN, 1), '—');
  assert.equal(c.fmt(undefined, 1), '—');
});

test('D7: the page renders the observed value and hatches an uncertain reading', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  const l = c.L.TIC202;
  assert.equal(c.pvShown(l), 103.125);
  assert.equal(c.hatchOp(l), UNCERTAIN_HATCH);
  assert.equal(c.hatchOp(c.L.TIC201), 0);
  c.nav('detail', 'TIC202');
  const v = c.renderVals();
  const pvRow = v.dpt.mainRows.find((r) => r.param === 'PV');
  assert.match(pvRow.value, /^103\.1 /);
  assert.match(pvRow.note, /UNCERTAIN/);
});

test('a bad PV still hatches at full strength', () => {
  const c = boot(4, 'OPER');
  c.injectFault('xmtr', true);
  assert.ok(run(c, 600, () => c.L.FIC102.badPv));
  assert.equal(c.hatchOp(c.L.FIC102), 0.85);
});

// Beyond the brief's three: its D7 test reaches the helpers and the Point Detail row. These pin the
// other consumers of the observed value (the graphic value box, the faceplate, the band note, the
// data-acquisition row) and the helpers' on-the-fly fallback, so a regression in the page's wiring
// cannot pass unseen. Only the graphic value box hatches; the faceplate has no hatch to show.
test('D7: the graphic value box, the faceplate and the band note show the observed value; only the box hatches', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  assert.ok(c.L.TIC202.pv > 110, 'the model value is past 110, so a raw read would print it');
  c.openFp('TIC202');
  c.nav('detail', 'TIC202');
  const v = c.renderVals();
  const box = v.gvList.find((g) => g.tag === 'TIC202');
  assert.equal(box.pvT, '103.1');
  assert.equal(box.hatchOp, UNCERTAIN_HATCH);
  assert.equal(v.gvList.find((g) => g.tag === 'TIC201').hatchOp, 0);
  assert.equal(v.fps.find((f) => f.tag === 'TIC202').pvT, '103.1');
  assert.match(v.dpt.bandNote, /^PV 103\.1 DEG C is /);
});

test('D14: a small flow reads 0.0 on the graphic, the faceplate and the band note; a reading that rounds to -0.0 prints 0.0', () => {
  const c = boot(4, 'OPER');
  c.L.FIC211.pv = -0.3;                         // inside the low-flow cutoff: 1 % of the 40 M3/H span is 0.4
  c.L.TIC202.pv = -0.04;                        // not a flow: inside the window, reported as read, rounds to -0.0
  c.measure();
  c.openFp('FIC211');                           // an unpinned faceplate closes when another opens, so one at a time
  c.nav('detail', 'FIC211');
  let v = c.renderVals();
  assert.equal(v.gv2.find((g) => g.tag === 'FIC211').pvT, '0.0');
  assert.equal(v.gvList.find((g) => g.tag === 'TIC202').pvT, '0.0');
  assert.equal(v.fps.find((f) => f.tag === 'FIC211').pvT, '0.0');
  assert.match(v.dpt.bandNote, /^PV 0\.0 M3\/H is inside the target band\./, 'judged on the observed 0.0; the raw -0.3 sits below the range');
  c.L.FIC211.pv = 0.3;                          // a positive flow inside the cutoff, so the bar can tell raw from observed
  c.measure();
  const fic = c.renderVals().fps.find((f) => f.tag === 'FIC211');
  assert.equal(fic.pvT, '0.0');
  assert.equal(fic.pvH, 0, 'the faceplate bar follows the observed value, which the cutoff reports as zero');
  assert.equal(c.renderVals().dpt.bandMarker, '160.0', 'the ladder marker sits on the zero rung (the bottom of the 160 px ladder), not the raw 0.3 just above it');
  c.openFp('TIC202');
  v = c.renderVals();
  assert.equal(v.fps.find((f) => f.tag === 'TIC202').pvT, '0.0');
});

test('D7: a data-acquisition point reports through the same window on the graphic and in Point Detail', () => {
  const c = boot(4, 'OPER');
  c.L.TI312.pv = 700;                           // 0-600 DEG C: the transmitter reports at most 618.75
  c.measure();
  c.nav('detail', 'TI312');
  const v = c.renderVals();
  const box = v.gv3.find((g) => g.tag === 'TI312');
  assert.equal(box.pvT, '619');
  assert.equal(box.hatchOp, UNCERTAIN_HATCH);
  assert.equal(v.dpt.mainRows.find((r) => r.param === 'PV').value, '619 DEG C');
});

test('pvShown and hatchOp observe on the fly when a point has no observation yet', () => {
  const c = boot(1);
  const l = c.L.TIC202;
  delete l.obs;
  l.pv = 120;
  assert.equal(c.pvShown(l), 103.125);
  assert.equal(c.hatchOp(l), UNCERTAIN_HATCH);
  assert.equal(c.pvShown(c.L.P101), c.L.P101.pv, 'a motor has no transmitter window');
  assert.equal(c.hatchOp(c.L.P101), 0);
  assert.equal(c.obsOf(l).quality, 'UNCERTAIN', 'observed on the fly when there is no obs');
  assert.equal(c.obsOf(c.L.P101), null, 'a motor has no observation');
  const kept = { pv: 50, quality: 'GOOD', limit: 'NONE' };
  l.obs = kept;
  assert.equal(c.obsOf(l), kept, 'a written observation is used as it stands');
});

test('D14: a data-acquisition flow below the cutoff reads zero in its faceplate number and indicator bar', () => {
  const c = boot(4, 'OPER');
  c.L.FI100.pv = 1;                             // FI100 is an indicator: 1 M3/H is inside the cutoff (1 % of 150 is 1.5)
  c.measure();
  c.openFp('FI100');
  const fp = c.renderVals().fps.find((f) => f.tag === 'FI100');
  assert.equal(fp.pvT, '0.0');
  assert.equal(fp.indH, 0, 'the indicator bar follows the observed value, not the raw 1 M3/H');
});

// CR12 gate: the saturation hatch must clear WCAG AA (4.5:1) for every label drawn on a graphic value box,
// measured on every hatch pixel (the stripe is the darkest). The page draws the box, the hatch pattern and
// the labels in literal colours, which do not follow the alarm colour philosophy, so the ratios are the same
// under representative, isa101 and night; read them from the template so that an edit to any of the four
// unit graphics re-runs the measurement. The BAD hatch (0.85) is not gated: it is the shipped strength and
// its small labels sit below 4.5 (unit 3.59, mode 3.46), as they did before CR12.
test('CR12: the saturation hatch clears WCAG AA for every label on a value box, in all four unit graphics', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'Experion Station Simulator.dc.html'), 'utf8');
  const hex = '#[0-9A-Fa-f]{6}';
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const over = (top, under, a) => '#' + rgb(top).map((v, i) => Math.round(a * v + (1 - a) * rgb(under)[i]).toString(16).padStart(2, '0')).join('');
  const c = boot(4);
  c.L.TIC202.pv = 120;                          // saturated: UNCERTAIN, reported at the window edge
  c.measure();
  const alpha = c.hatchOp(c.L.TIC202);
  assert.equal(alpha, UNCERTAIN_HATCH);
  const blocks = html.split(/<sc-for list="\{\{ (?:gvList|gv2|gv3|gv4) \}\}"/).slice(1)
    .map((b) => b.slice(0, b.indexOf('{{ p.modeT }}</text>') + '{{ p.modeT }}</text>'.length));
  assert.equal(blocks.length, 4, 'four unit graphics draw value boxes');
  for (const [i, b] of blocks.entries()) {
    const box = b.match(new RegExp(`width="128" height="46" fill="(${hex})"`));
    const pid = b.match(/fill="url\(#(hatch\d?)\)" opacity="\{\{ p\.hatchOp \}\}"/);
    assert.ok(box && pid, `graphic ${i + 1}: the box fill and the hatch reference are literal`);
    const pat = html.match(new RegExp(`<pattern id="${pid[1]}"[^>]*>\\s*<rect[^>]*fill="(${hex})"[^>]*></rect>\\s*<line[^>]*style="stroke:(${hex})`));
    assert.ok(pat, `graphic ${i + 1}: pattern ${pid[1]} is two literal colours`);
    const pixels = { stripe: over(pat[2], box[1], alpha), ground: over(pat[1], box[1], alpha) };
    for (const key of ['tag', 'pvT', 'euT', 'modeT']) {
      const fg = b.match(new RegExp(`fill:(${hex})">\\{\\{ p\\.${key} \\}\\}</text>`));
      assert.ok(fg, `graphic ${i + 1}: the ${key} label is a literal colour`);
      for (const [name, bg] of Object.entries(pixels)) {
        const ratio = Palette.contrastRatio(fg[1], bg);
        assert.ok(ratio >= 4.5, `graphic ${i + 1}: ${key} ${fg[1]} on the ${name} pixel ${bg} is ${ratio.toFixed(2)}:1, under AA 4.5:1`);
      }
    }
  }
});

// CR13: every operator-facing PV is the observed one. Beyond the faceplate and the graphic, the Alarm
// Summary's live column and the trend legend read the transmitter value too, so a saturated TIC202 reads
// 103.1 there and never the model's 110. The DEVHI row is PV minus SP on the observed PV (SP has tracked to 80).
test('CR13: the Alarm Summary live value and the trend legend value show the observed value', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  assert.ok(c.L.TIC202.pv > 110, 'the model value is past 110, so a raw read would print it');
  const v = c.renderVals();
  const byCond = Object.fromEntries(v.av.rows.filter((r) => r.tag === 'TIC202').map((r) => [r.cond, r]));
  assert.ok(byCond.PVHH && byCond.PVHI && byCond.DEVHI, 'the saturation puts TIC202 PVHH, PVHI and DEVHI on the Alarm Summary');
  assert.equal(byCond.PVHH.live, '103.1');
  assert.equal(byCond.PVHI.live, '103.1');
  assert.equal(byCond.DEVHI.live, '23.1', '103.125 - 80, not the model 110.3 - 80');
  assert.equal(v.tv.pens.find((p) => p.label === 'TIC202.PV').val, '103.1');
});

test('the crosshatch help answer names both hatches: bad quality, and a saturated reading at its limit', () => {
  const a = boot(1).topics().find((t) => t.t === 'PV shows crosshatch').a;
  assert.match(a, /full hatch is bad quality/i);
  assert.match(a, /BADPV/);
  assert.match(a, /shed/i);
  assert.match(a, /light hatch is a saturated/i);
  assert.match(a, /reporting limit/i);
});

// CR14: the faceplate has no hatch, so its saturation cue is the note line under the controls. A saturated
// reading says where it is reported; BADPV keeps precedence; an UNCERTAIN reading with no limit to name (a
// stale analyzer) says nothing rather than "NONE LIMIT".
test('CR14: the faceplate note says SATURATED at the limit, BADPV still wins, and a limit-less UNCERTAIN stays quiet', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 1800, () => c.L.TIC202.pv > 110));
  c.openFp('TIC202');
  const noteOf = (b, tag) => b.renderVals().fps.find((f) => f.tag === tag).noteT;
  assert.equal(noteOf(c, 'TIC202'), 'SATURATED — REPORTED AT HIGH LIMIT');
  c.L.TIC202.badPv = true;                      // the observation is still UNCERTAIN: a bad flag must outrank it
  assert.equal(noteOf(c, 'TIC202'), 'BADPV — SHED (HOLD)');

  const d = boot(4, 'OPER');
  d.injectFault('xmtr', true);                  // FIC102 transmitter fault -> badPv after its hold time
  assert.ok(run(d, 600, () => d.L.FIC102.badPv));
  d.openFp('FIC102');
  assert.equal(noteOf(d, 'FIC102'), 'BADPV — SHED (HOLD)');

  const e = boot(4, 'OPER');
  e.L.AI205.quality = 'STALE';                  // UNCERTAIN from its source status, inside the range: no limit to name
  e.measure();
  assert.equal(e.L.AI205.obs.quality, 'UNCERTAIN');
  assert.equal(e.L.AI205.obs.limit, 'NONE');
  e.openFp('AI205');
  assert.equal(noteOf(e, 'AI205'), '');
});

// The data-acquisition Point Detail row names the limit of a saturated reading, as the regulatory row does,
// and only a reading that has a limit (the help answer says Point Detail names it).
test('the data-acquisition Point Detail row names the limit of a saturated reading, and only then', () => {
  const c = boot(4, 'OPER');
  const pvRow = () => c.renderVals().dpt.mainRows.find((r) => r.param === 'PV');
  c.L.TI312.pv = 700;                           // 0-600 DEG C: reported at the 618.75 window edge, HIGH limit
  c.measure();
  c.nav('detail', 'TI312');
  assert.equal(pvRow().value, '619 DEG C');
  assert.equal(pvRow().note, 'UNCERTAIN — HIGH LIMIT, reported at the transmitter limit');
  c.L.TI312.pv = 380;
  c.measure();
  assert.equal(pvRow().note, '', 'a healthy reading carries no note');
  c.L.AI205.quality = 'STALE';
  c.measure();
  c.nav('detail', 'AI205');
  assert.equal(pvRow().note, '', 'UNCERTAIN with no limit has none to name');
});

// CR15: only regulatory points carry a shed option. The faceplate's BADPV note used to call l.shed.replace for any
// bad point, so a bad indicator (the product analyzers start bad in composition mode, before the first sample)
// threw in renderVals, which the page shows as the red render-error overlay. The indicator's note is plain BADPV;
// a regulatory point's note is byte-identical to what it always read.
test('CR15: a bad indicator point opens a faceplate that renders, with a plain BADPV note', () => {
  const c = new Component({});
  c.initSim(0, { materialMode: 'composition_mass_v1' });
  assert.equal(c.L.AI511.badPv, true, 'the analyzer starts bad: no sample has been published yet');
  assert.equal(c.L.AI511.shed, undefined, 'an indicator has no shed option');
  c.setState({ fps: [...c.state.fps, { tag: 'AI511', x: 30, y: 44, pin: false }] });
  let v;
  assert.doesNotThrow(() => { v = c.renderVals(); });
  assert.equal(v.fps.find((f) => f.tag === 'AI511').noteT, 'BADPV');
});

test('CR15: a regulatory point keeps its exact BADPV note for every shed option that sheds', () => {
  const c = boot(4, 'OPER');
  c.openFp('FIC102');
  c.L.FIC102.badPv = true;
  const noteOf = () => c.renderVals().fps.find((f) => f.tag === 'FIC102').noteT;
  assert.equal(c.L.FIC102.shed, 'SHEDHOLD');
  assert.equal(noteOf(), 'BADPV — SHED (HOLD)');
  for (const [opt, tail] of [['SHEDLOW', 'LOW'], ['SHEDHIGH', 'HIGH'], ['SHEDSAFE', 'SAFE']]) {
    c.L.FIC102.shed = opt;
    assert.equal(noteOf(), 'BADPV — SHED (' + tail + ')', opt);
  }
});

const tripFlagOfCause = { R201_HITEMP: 'rx', R202_HITEMP: 'batch', R310_HITEMP: 'bed', H310_SKIN: 'skin' };

test('D1: a stopped pump makes FIC102 track SAFEOP, its primary runs INITMAN, and the restart does not surge', () => {
  const c = boot(4, 'OPER');
  run(c, 60);
  c.motorCmd('P101', false);
  c.step(0.5);
  assert.deepEqual({ on: c.L.FIC102.trk.on, kind: c.L.FIC102.trk.kind, reason: c.L.FIC102.trk.reason }, { on: true, kind: 'device', reason: 'P-101 STOPPED' });
  assert.equal(c.L.FIC102.op, 0);
  assert.equal(c.L.LIC101.init, true);
  run(c, 60);
  assert.equal(c.L.FIC102.op, 0, 'no wind-up while the pump is stopped');
  assert.equal(c.L.LIC101.op, 0, 'the primary back-calculated to the stopped feed (invMap(0)); the plant before tracking left it at 64.25: ' + c.L.LIC101.op);
  c.motorCmd('P101', true);
  assert.equal(c.L.P101.run, true, 'the lockout had expired');
  const t0 = c.P.t;
  let maxFlow = 0, t30 = null, t50 = null;
  run(c, 900, () => {                          // the whole recovery: the flow peaks at about 404 s, past any shorter window
    const t = (c.P.t - t0) / 1000, f = c.L.FIC102.pv;
    maxFlow = Math.max(maxFlow, f);
    if (t30 === null && f >= 30) t30 = t;
    if (t50 === null && f >= 50) t50 = t;
    return false;
  });
  assert.ok(maxFlow <= 80.5, 'flow after restart never exceeds SPHILM 80: ' + maxFlow);
  assert.ok(Math.abs(t30 - 103.5) <= 0.5, 'the feed first reaches 30 m3/h 103.5 s after START, on the primary integral ramp up from 0 (one scan of tolerance): ' + t30);
  assert.ok(Math.abs(t50 - 166.5) <= 0.5, 'and 50 m3/h 166.5 s after START (one scan of tolerance): ' + t50);
  assert.equal(c.L.FIC102.trk.on, false, 'tracking released on restart');
  assert.equal(c.L.LIC101.init, false);
});

test('D1: in MAN the operator owns the output while the pump is stopped; returning to AUTO re-engages tracking', () => {
  const c = boot(4, 'OPER');
  c.motorCmd('P101', false);
  c.step(0.5);
  c.setMode('FIC102', 'MAN');
  assert.equal(c.storeEntry('FIC102', 'OP', 40), true);
  run(c, 5);
  assert.equal(c.L.FIC102.op, 40, 'device tracking yields in MAN');
  c.setMode('FIC102', 'AUTO');
  c.step(0.5);
  assert.equal(c.L.FIC102.op, 0, 'tracking engages again outside MAN');
});

test('D10: the R-201 trip holds FIC102 at zero in every mode, shows why, and refuses an OP entry', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 2400, () => c.P.trips.rx), 'R-201 tripped at 185 C');
  const l = c.L.FIC102;
  assert.deepEqual({ kind: l.trk.kind, reason: l.trk.reason }, { kind: 'interlock', reason: 'R-201 HI TEMP TRIP' });
  assert.equal(l.op, 0);
  c.setMode('FIC102', 'MAN');
  c.storeEntry('FIC102', 'OP', 80);
  assert.match(c.state.msg, /ENTRY REJECTED — OUTPUT INTERLOCKED \(R-201 HI TEMP TRIP\)/);
  assert.ok(c.events.some((e) => /^WRITE REJECTED — OUTPUT INTERLOCKED — R-201 HI TEMP TRIP/.test(e.desc)), 'the refusal is journaled');
  run(c, 30);
  assert.equal(l.op, 0, 'OP equals the forced valve');
  assert.ok(c.V.FV102.pos < 0.01, 'the valve is shut: ' + c.V.FV102.pos);
  assert.ok(!c.events.some((e) => e.desc === 'OP CHANGE' && e.src === 'FIC102' && e.newV === '80.00'), 'a refused write is never journaled as a change');
});

test('tracking is released when the trip resets, and a restored snapshot recomputes it from the flags', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 2400, () => c.P.trips.rx));
  const snap = c.snapshotData('mid-trip');
  assert.ok(run(c, 3600, () => !c.P.trips.rx), 'the trip reset below 160 C');
  assert.equal(c.L.FIC102.trk.on, false);
  c.restoreSnapshot(snap, 'test');
  assert.equal(c.P.trips.rx, true);
  c.L.FIC102.trk = { on: false, target: null, reason: '', kind: 'device' };   // corrupt the stored record on purpose
  c.step(0.5);
  assert.equal(c.L.FIC102.trk.on, true, 'the tick recomputed tracking from the restored trip flag');
  assert.equal(c.L.FIC102.trk.kind, 'interlock');
});

test('the tracking set equals the W2 matrix effect columns, cause by cause', () => {
  const c = boot(4);
  const loopOf = {}; for (const [loop, valve] of Object.entries(c.valveMap())) loopOf[valve] = loop;
  for (const col of CauseEffect.effects().filter((e) => e.kind === 'valve')) {
    const loop = c.L[loopOf[col.target]];
    assert.ok(loop, col.target + ' has a loop');
    for (const causeId of col.causedBy) {
      const flag = tripFlagOfCause[causeId];
      assert.ok(flag, causeId + ' has a trip flag');
      for (const k of Object.keys(tripFlagOfCause)) c.P.trips[tripFlagOfCause[k]] = false;
      c.L.P101.run = true;
      c.P.trips[flag] = true;
      c.forcedOutputs();
      assert.equal(loop.trk.on, true, col.target + ' tracks under ' + causeId);
      assert.equal(loop.trk.kind, 'interlock');
      const cause = CauseEffect.causes().find((x) => x.id === causeId);
      assert.equal(loop.trk.reason, cause.src + ' ' + cause.cond);
      c.P.trips[flag] = false;
      c.forcedOutputs();
      assert.equal(loop.trk.on, false);
    }
  }
  assert.equal(CauseEffect.effects().filter((e) => e.kind === 'valve').length, 4, 'four valve columns are declared');
});

// Beyond the brief's five. The mutation pass over forcedOutputs() and the OP refusal left these alive: a return value
// nobody read, FIC211 forced on a sequence HOLD or an agitator stop, a refusal that took MODE and SP with it, a refusal that
// outlived the trip (clearTracking keeps `kind`, so only trk.on tells a released loop from a held one), and a SAFEOP target
// that was a fixed zero.
test('forcedOutputs() returns exactly the loops of the valve columns the matrix declares for each cause, and nothing else', () => {
  const c = boot(4);
  const loopOf = {}; for (const [loop, valve] of Object.entries(c.valveMap())) loopOf[valve] = loop;
  const valveCols = CauseEffect.effects().filter((e) => e.kind === 'valve');
  const trips = CauseEffect.causes().filter((x) => x.kind === 'process-trip');
  const flagOf = (cause) => cause.latch.field.replace('P.trips.', '');
  assert.equal(trips.length, 7, 'seven process trips are declared');
  for (const cause of trips) {
    for (const t of trips) c.P.trips[flagOf(t)] = false;
    c.P.trips[flagOf(cause)] = true;
    const expected = valveCols.filter((col) => col.causedBy.includes(cause.id)).map((col) => loopOf[col.target]).sort();
    assert.deepEqual([...c.forcedOutputs()].sort(), expected, cause.id + ': the matrix names the loops');
  }
  for (const t of trips) c.P.trips[flagOf(t)] = false;
  assert.deepEqual([...c.forcedOutputs()], [], 'no trip and the pump running: nothing tracks');
  c.L.M202.run = false; c.P.b.held = true;      // an agitator stop and a sequence HOLD force no output: FIC211 tracks under the R-202 trip only
  assert.deepEqual([...c.forcedOutputs()], [], 'a stopped agitator and a held sequence force nothing');
  c.L.P101.run = false;
  assert.deepEqual([...c.forcedOutputs()], ['FIC102'], 'a stopped pump forces FIC102 alone');
});

// CR18: the hold is the code's truth and the matrix only names it. A trip flag whose cause the matrix cannot name still holds
// its loop, with the raw cause id as its reason text; an empty matrix and no matrix module at all read the same.
test('an interlock the matrix cannot name still holds its loop, and the raw cause id names it (CR18)', () => {
  const c = boot(4);
  const ESSg = globalThis.ESS, CE = ESSg.CauseEffect, real = CE.causes;
  const reasons = (flag) => {                  // the loops held under this one trip flag, with the reason each carries
    for (const f of ['rx', 'batch', 'bed', 'skin']) c.P.trips[f] = false;
    c.P.trips[flag] = true;
    const out = {};
    for (const tag of c.forcedOutputs()) { const t = c.L[tag].trk; assert.deepEqual([t.on, t.kind, t.target], [true, 'interlock', 0], tag); out[tag] = t.reason; }
    return out;
  };
  const rawIds = [['rx', { FIC102: 'R201_HITEMP' }], ['batch', { FIC211: 'R202_HITEMP', TIC213: 'R202_HITEMP' }], ['bed', { TIC311: 'R310_HITEMP' }], ['skin', { TIC311: 'H310_SKIN' }]];
  try {
    CE.causes = () => [];                      // the matrix has lost every cause
    for (const [flag, expected] of rawIds) assert.deepEqual(reasons(flag), expected, flag + ': held, named by the raw id');
    ESSg.CauseEffect = undefined;              // and with no matrix module at all
    for (const [flag, expected] of rawIds) assert.deepEqual(reasons(flag), expected, flag + ': held without a matrix module');
  } finally { CE.causes = real; ESSg.CauseEffect = CE; }
  assert.deepEqual(reasons('rx'), { FIC102: 'R-201 HI TEMP TRIP' }, 'with the matrix back, its own name');
  assert.deepEqual(reasons('skin'), { TIC311: 'H-310 TUBE SKIN TRIP' });
});

// Spec §12: a missing flag or run state means no tracking, and never an exception. (A missing name is the test above.)
test('a missing run state or flag record means no tracking and never throws (spec §12)', () => {
  const c = boot(4);
  delete c.L.P101;                             // no pump record, so no run state to read
  assert.deepEqual([...c.forcedOutputs()], [], 'no P-101 record, no device hold on FIC102');
  c.P.trips.rx = true;                         // an interlock needs the flag, not the pump
  assert.deepEqual([...c.forcedOutputs()], ['FIC102']);
  c.P.trips = undefined;                       // no flag record at all: the model always creates P.trips, so the guard is defensive only
  assert.deepEqual([...c.forcedOutputs()], [], 'no flag record, no interlock');
  assert.equal(c.L.FIC102.trk.on, false, 'and the loop is released');
});

test('D10: the OP refusal sits at the shared write gate, refuses OP and nothing else, and lifts when the trip resets', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 2400, () => c.P.trips.rx), 'R-201 tripped');
  const refused = /ENTRY REJECTED — OUTPUT INTERLOCKED \(R-201 HI TEMP TRIP\)/;
  c.openEntry('FIC102', 'OP');                  // in CAS: refused as interlocked, not as an invalid mode
  assert.match(c.state.msg, refused);
  assert.ok(!c.state.entry, 'no entry field opened');
  c.setMode('FIC102', 'MAN');                   // a mode change is not an OP entry
  assert.equal(c.L.FIC102.mode, 'MAN');
  c.setState({ msg: '' });
  c.openEntry('FIC102', 'OP');
  assert.match(c.state.msg, refused);
  assert.ok(!c.state.entry, 'no entry field opened in MAN either');
  c.setState({ msg: '' });
  c.raiseLower('FIC102', 1);
  assert.match(c.state.msg, refused);
  assert.equal(c.L.FIC102.op, 0, 'RAISE does not move a held output');
  assert.equal(c.events.filter((e) => /^WRITE REJECTED — OUTPUT INTERLOCKED/.test(e.desc)).length, 3, 'each refused route is journaled once');
  assert.deepEqual(c.instr.journal.filter((e) => e.tag === 'FIC102').map((e) => e.op), ['MODE'], 'no refused write reaches the replay journal');
  assert.equal(c.storeEntry('FIC102', 'SP', 50), true, 'the refusal is OP only: an SP write is not an OP write');
  assert.equal(c.L.FIC102.sp, 50, 'the SP entry was stored');
  assert.ok(c.events.some((e) => e.desc === 'SP CHANGE' && e.src === 'FIC102' && e.newV === '50.00'), 'and journaled as a change');
  assert.equal(c.events.filter((e) => /^WRITE REJECTED — OUTPUT INTERLOCKED/.test(e.desc)).length, 3, 'and no further refusal was raised');
  assert.ok(run(c, 3600, () => !c.P.trips.rx), 'the trip reset');
  assert.equal(c.L.FIC102.trk.on, false);
  assert.equal(c.storeEntry('FIC102', 'OP', 30), true);
  assert.equal(c.L.FIC102.op, 30, 'the operator owns the output again');
  assert.ok(c.events.some((e) => e.desc === 'OP CHANGE' && e.src === 'FIC102' && e.newV === '30.00'), 'and the entry is journaled as a change');
});

test('D1: a loop returned from MAN to AUTO while the pump is stopped holds at its SAFEOP and says why', () => {
  const c = boot(4, 'OPER');
  c.L.FIC102.safeop = 15;
  c.motorCmd('P101', false);
  c.step(0.5);
  c.setMode('FIC102', 'MAN');
  assert.equal(c.storeEntry('FIC102', 'OP', 40), true);
  run(c, 5);
  assert.equal(c.L.FIC102.op, 40, 'the operator owns the output in MAN');
  c.setMode('FIC102', 'AUTO');
  c.step(0.5);
  assert.equal(c.L.FIC102.op, 15, 'the hold is at SAFEOP, not a fixed zero');
  const t = c.L.FIC102.trk;
  assert.deepEqual({ on: t.on, kind: t.kind, target: t.target, reason: t.reason }, { on: true, kind: 'device', target: 15, reason: 'P-101 STOPPED' });
});

test('a trip and a stopped pump together: the interlock outranks the device hold, and the device hold takes over when the trip resets', () => {
  const c = boot(4, 'OPER');
  loseCooling(c);
  assert.ok(run(c, 2400, () => c.P.trips.rx), 'R-201 tripped');
  c.motorCmd('P101', false);                   // the pump stops while the trip stands
  c.step(0.5);
  const hold = () => { const t = c.L.FIC102.trk; return { on: t.on, kind: t.kind, reason: t.reason }; };
  assert.deepEqual(hold(), { on: true, kind: 'interlock', reason: 'R-201 HI TEMP TRIP' }, 'the trip outranks the stopped pump');
  assert.ok(run(c, 3600, () => !c.P.trips.rx), 'the trip reset');
  assert.equal(c.L.P101.run, false, 'with the pump still stopped');
  assert.deepEqual(hold(), { on: true, kind: 'device', reason: 'P-101 STOPPED' }, 'the device hold takes over on the same scan');
});

test('the flag names the hold: TRACK while the pump is stopped, NOTE when the operator overrides it in MAN, INTERLOCK under a trip', () => {
  const c = boot(4, 'OPER');
  assert.equal(c.flagText(c.L.FIC102), '');
  c.motorCmd('P101', false); c.step(0.5);
  assert.equal(c.flagText(c.L.FIC102), 'TRACK · P-101 STOPPED');
  assert.equal(c.flagText(c.L.LIC101), 'INITMAN');
  c.setMode('FIC102', 'MAN'); c.step(0.5);
  assert.equal(c.flagText(c.L.FIC102), 'NOTE · P-101 STOPPED');
  const d = boot(4, 'OPER');
  loseCooling(d);
  assert.ok(run(d, 2400, () => d.P.trips.rx));
  assert.equal(d.flagText(d.L.FIC102), 'INTERLOCK · R-201 HI TEMP TRIP');
  d.setMode('FIC102', 'MAN'); d.step(0.5);
  assert.equal(d.flagText(d.L.FIC102), 'INTERLOCK · R-201 HI TEMP TRIP', 'an interlock holds in MAN too');
});

test('D8: a secondary setpoint beyond the cascade range pins the primary, the flag says so, and the CAS return journals the clamp', () => {
  const c = boot(4, 'OPER');
  run(c, 30);
  c.setMode('TIC202', 'AUTO');
  assert.equal(c.storeEntry('TIC202', 'SP', 75), true);
  run(c, 5);
  assert.equal(c.L.TIC201.init, true);
  assert.equal(c.L.TIC201.op, 100);
  assert.equal(c.flagText(c.L.TIC201), 'INITMAN · OP AT HI LIMIT');
  assert.equal(c.casRange('TIC202'), '10.0–70.0 DEG C');
  c.setMode('TIC202', 'CAS');
  assert.equal(c.L.TIC202.sp, 70);
  const ev = c.events.find((e) => e.src === 'TIC202' && e.desc === 'SP CLAMPED TO CASCADE RANGE');
  assert.ok(ev, 'the clamp is journaled');
  assert.equal(ev.newV, '70.0');
  assert.match(c.state.msg, /SP CLAMPED TO CASCADE RANGE 70\.0 DEG C/);
});

test('a CAS return inside the cascade range journals no clamp', () => {
  const c = boot(4, 'OPER');
  run(c, 30);
  c.setMode('TIC202', 'AUTO');
  c.storeEntry('TIC202', 'SP', 40);
  run(c, 5);
  c.setMode('TIC202', 'CAS');
  assert.ok(!c.events.some((e) => e.desc === 'SP CLAMPED TO CASCADE RANGE'));
});

test('the faceplate and the Point Detail carry the flag', () => {
  const c = boot(4, 'OPER');
  c.motorCmd('P101', false); c.step(0.5);
  c.nav('detail', 'FIC102');
  const v = c.renderVals();
  const casc = v.dpt.mainRows.find((r) => r.param === 'CASC');
  assert.equal(casc.note, 'TRACK · P-101 STOPPED');
  c.nav('detail', 'TIC201');
  const casc2 = c.renderVals().dpt.mainRows.find((r) => r.param === 'CASC');
  assert.match(casc2.value, /PRIMARY OF TIC202 · COMMANDS SP 10\.0–70\.0 DEG C/);
});

// Beyond the brief's four. Its last test is titled for the faceplate but reads only Point Detail; the others meet
// only the HIGH limit, mid-range INITMAN and a CAS return that changes nothing.
test('the faceplate flag is flagText for every kind of point: a held loop, an initialising primary, a motor and an indicator', () => {
  const c = boot(4, 'OPER');
  c.motorCmd('P101', false); c.step(0.5);
  c.setState({ fps: ['FIC102', 'LIC101', 'P101', 'FI100'].map((tag, i) => ({ tag, x: 30 + 250 * i, y: 44, pin: true })) });
  const flagOf = (tag) => c.renderVals().fps.find((f) => f.tag === tag).initT;
  assert.equal(flagOf('FIC102'), 'TRACK · P-101 STOPPED');
  assert.equal(flagOf('LIC101'), 'INITMAN');
  assert.equal(flagOf('P101'), '', 'a motor has no flag');
  assert.equal(flagOf('FI100'), '', 'nor has an indicator point');
});

test('INITMAN names a limit only when OP is within 0.2 of it; with the pump stopped LIC101 reads plain INITMAN until the observed flow is zero, then OP AT LO LIMIT (CR20)', () => {
  const c = boot(4, 'OPER');
  const flag = (op) => c.flagText({ init: true, op, ophilm: 100, oplolm: 0 });
  assert.equal(flag(99.9), 'INITMAN · OP AT HI LIMIT');
  assert.equal(flag(99.7), 'INITMAN', 'the tolerance is 0.2, not more');
  assert.equal(flag(0.1), 'INITMAN · OP AT LO LIMIT');
  assert.equal(flag(0.3), 'INITMAN', 'on the low side too');
  assert.equal(c.flagText({ op: 100, ophilm: 100, oplolm: 0 }), '', 'a loop that is not initialising shows no limit flag even at its limit');
  assert.equal(c.flagText({ trk: { on: false, target: null, reason: '', kind: 'device' } }), '', 'a released hold shows nothing');
  c.motorCmd('P101', false); c.step(0.5);
  const lic = c.L.LIC101;
  assert.equal(c.flagText(lic), 'INITMAN', 'one scan after the stop LIC101 is initialising but still mid-range');
  assert.ok(run(c, 120, () => c.flagText(lic) !== 'INITMAN'), 'LIC101 reached its low limit');
  assert.equal(lic.op, 0, 'the observed flow reads zero below the cutoff, so LIC101 back-calculates to exactly invMap(0)');
  assert.equal(c.flagText(lic), 'INITMAN · OP AT LO LIMIT');
  run(c, 60);
  c.motorCmd('P101', true);
  assert.equal(c.L.P101.run, true, 'the lockout had expired');
  c.step(0.5);
  assert.equal(c.flagText(c.L.FIC102), '', 'the restart releases the hold, and the flag with it');
  assert.equal(c.flagText(lic), '', 'and LIC101 is out of INITMAN');
});

test('D8: the clamp journals the low side too, journals nothing when the return changes nothing, and nothing when the primary is not pinned', () => {
  const a = boot(4, 'OPER');
  run(a, 30);
  a.setMode('TIC202', 'AUTO');
  assert.equal(a.storeEntry('TIC202', 'SP', 7), true);
  run(a, 5);
  assert.equal(a.L.TIC201.op, 0);
  assert.equal(a.flagText(a.L.TIC201), 'INITMAN · OP AT LO LIMIT');
  a.setMode('TIC202', 'CAS');
  assert.equal(a.L.TIC202.sp, 10, 'the return clamps up to the bottom of the cascade range');
  const ev = a.events.find((e) => e.src === 'TIC202' && e.desc === 'SP CLAMPED TO CASCADE RANGE');
  assert.ok(ev, 'the low-side clamp is journaled');
  assert.deepEqual({ type: ev.type, oldV: ev.oldV, newV: ev.newV }, { type: 'SYSTEM', oldV: '7.0', newV: '10.0' });
  assert.match(a.state.msg, /SP CLAMPED TO CASCADE RANGE 10\.0 DEG C/);
  const mc = a.events.find((e) => e.desc === 'MODE CHANGE' && e.src === 'TIC202' && e.newV === 'CAS');
  assert.ok(mc && mc.oldV === 'AUTO', 'the return is still journaled as the mode change AUTO to CAS, its own old and new values intact: ' + JSON.stringify(mc));

  const b = boot(4, 'OPER');                   // a setpoint exactly at the top of the range pins the primary, and the return changes nothing
  run(b, 30);
  b.setMode('TIC202', 'AUTO');
  b.storeEntry('TIC202', 'SP', 70);
  run(b, 5);
  assert.equal(b.flagText(b.L.TIC201), 'INITMAN · OP AT HI LIMIT');
  b.setMode('TIC202', 'CAS');
  assert.equal(b.L.TIC202.sp, 70);
  assert.ok(!b.events.some((e) => e.desc === 'SP CLAMPED TO CASCADE RANGE'), 'a return that moves nothing is not a clamp');

  const d = boot(4, 'OPER');                   // CAS taken in the same scan as the entry: the SP snaps to the primary's old output, which is not a clamp
  run(d, 30);
  d.setMode('TIC202', 'AUTO');
  d.storeEntry('TIC202', 'SP', 60);
  d.setMode('TIC202', 'CAS');
  assert.ok(Math.abs(d.L.TIC202.sp - 60) > 1, 'the setpoint did move: ' + d.L.TIC202.sp);
  assert.ok(!d.events.some((e) => e.desc === 'SP CLAMPED TO CASCADE RANGE'), 'but the primary was not pinned, so no clamp is claimed');
});

test('a primary whose secondary has no cascade map entry names its cascade without a dangling range; a point with no cascade says NONE', () => {
  const c = boot(4, 'OPER');
  assert.equal(c.casRange('FIC102'), '0.0–80.0 M3/H', 'the range is cut to the secondary\'s SP limits, not the raw map');
  assert.equal(c.casRange('TIC213'), '5.0–120.0 DEG C');
  delete c.pidCtx().casMap.TIC202;
  assert.equal(c.casRange('TIC202'), '');
  assert.equal(c.casRange('NOSUCHTAG'), '', 'an unknown tag has none');
  const cascOf = (tag) => { c.nav('detail', tag); return c.renderVals().dpt.mainRows.find((r) => r.param === 'CASC'); };
  assert.equal(cascOf('TIC201').value, 'PRIMARY OF TIC202');
  assert.equal(cascOf('TIC202').value, 'SECONDARY OF TIC201');
  assert.deepEqual({ value: cascOf('PIC401').value, note: cascOf('PIC401').note }, { value: 'NONE', note: '' });
});

// CR22: the Live Diagnosis card tells the same truth as the flag. Since the plant started holding a secondary in CAS,
// its primary is initialised without any cascade being broken; the card must not say it is.
test('CR22: the INITMAN card says the secondary is held when it is in CAS under a hold, names the flag verbatim, and says cascade broken only when it left CAS', () => {
  const c = boot(4, 'OPER');
  c.motorCmd('P101', false); c.step(0.5);
  const card = (b) => b.diagnose().find((x) => x.id === 'init.LIC101');
  const held = card(c);
  assert.ok(held, 'LIC101 is initialised, so it has a card');
  assert.equal(held.sev, 'INFO');
  assert.equal(held.title, 'LIC101 in INITMAN — FIC102 is held');
  assert.doesNotMatch(held.title, /cascade broken/);
  assert.equal(held.why, 'Its secondary FIC102 is in CAS but its output is held (TRACK · P-101 STOPPED), so the primary is initialized and tracks for a bumpless return.');
  assert.ok(held.why.includes(c.flagText(c.L.FIC102)), 'the card names the flag the faceplate shows, verbatim');
  assert.deepEqual(held.steps.map((s) => s.t), ['Open FIC102 to see what holds it. The hold clears when its cause clears.']);
  c.setState({ fps: [] });
  held.steps[0].go();
  assert.ok(c.state.fps.some((f) => f.tag === 'FIC102'), 'the one step opens the secondary\'s faceplate');

  for (const mode of ['MAN', 'AUTO']) {        // the operator takes the secondary out of CAS, held or not: now the cascade is broken
    c.setMode('FIC102', mode); c.step(0.5);
    const broken = card(c);
    assert.equal(broken.sev, 'INFO', mode);
    assert.equal(broken.title, 'LIC101 in INITMAN — cascade broken', mode);
    assert.equal(broken.why, 'Its secondary FIC102 is not in CAS, so the primary is initialized and tracks for a bumpless return.', mode);
    assert.deepEqual(broken.steps.map((s) => s.t), ['Return FIC102 to CAS when ready.'], mode);
    c.setState({ fps: [] });
    broken.steps[0].go();
    assert.ok(c.state.fps.some((f) => f.tag === 'FIC102'), 'and that step opens the secondary\'s faceplate too: ' + mode);
  }
  c.setMode('FIC102', 'CAS'); c.step(0.5);     // back in CAS with the pump still stopped: held again, not broken
  assert.equal(card(c).title, 'LIC101 in INITMAN — FIC102 is held');

  const d = boot(4, 'OPER');                    // an interlock holds the secondary: the card names that flag, not the pump's
  loseCooling(d);
  assert.ok(run(d, 2400, () => d.P.trips.rx), 'R-201 tripped');
  assert.equal(d.flagText(d.L.FIC102), 'INTERLOCK · R-201 HI TEMP TRIP');
  assert.equal(card(d).title, 'LIC101 in INITMAN — FIC102 is held');
  assert.equal(card(d).why, 'Its secondary FIC102 is in CAS but its output is held (INTERLOCK · R-201 HI TEMP TRIP), so the primary is initialized and tracks for a bumpless return.');

  const e = boot(4, 'OPER');                    // init one scan stale: the secondary is back in CAS with no hold, so there is nothing to say
  e.step(0.5);
  e.L.LIC101.init = true;
  assert.equal(card(e), undefined, 'neither a held card nor a cascade-broken one');
});
