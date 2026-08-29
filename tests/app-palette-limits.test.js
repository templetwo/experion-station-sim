// App-level tests for step B3: colour philosophy (ESS.Palette presets read
// through one getter), the Range / Critical / Standard / Target limit ladder,
// the alarm-and-display philosophy page and the Loop Tune additions.
// Sources: Rockwell process HMI style guide (RESOURCES 2.4), PAS HMI paper
// (2.10), ASM gray-background and limit-ladder guidance (2.11), ISA-18.2 and
// EEMUA 191 (2.19).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const Palette = require('../src/palette.js');
const Philosophy = require('../src/philosophy.js');

const { Component } = load();

function boot(props, sec) {
  const c = new Component(props || {});
  c.initSim();
  if (sec) c.setState({ sec });
  return c;
}

test('switching the palette changes alarm summary row colours and the alarm line', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  c.setState({ display: 'alarms', blink: true });
  let v = c.renderVals();
  assert.equal(c.paletteName(), 'representative');
  assert.equal(v.av.rows[0].bg, '#FFE000', 'representative High fill');
  assert.equal(v.al.bg, '#FFE000', 'alarm line follows the same getter');
  assert.equal(v.cnts[1].bg, '#FFE000', 'High counter chip');
  c.setPalette('isa101');
  v = c.renderVals();
  assert.equal(c.paletteName(), 'isa101');
  assert.equal(v.av.rows[0].bg, '#EC8629', 'ISA-101 High fill');
  assert.equal(v.al.bg, '#EC8629');
  assert.equal(v.cnts[0].bg, '#E22028'); assert.equal(v.cnts[1].bg, '#EC8629'); assert.equal(v.cnts[2].bg, '#F5E11B');
  assert.ok(c.events.some(e => e.desc === 'ALARM COLOUR PHILOSOPHY CHANGE' && e.newV === 'ISA-101'), 'change is journaled');
  // graphic alarm box and faceplate ticks read the same source
  c.setState({ display: 'graphic', unit: 'U1' });
  c.openFp('TIC201');
  v = c.renderVals();
  const box = v.gvList.find(p => p.tag === 'TIC201');
  assert.equal(box.aBg, '#EC8629');
  const fp = v.fps.find(f => f.tag === 'TIC201');
  assert.ok(fp.ticks.some(t => t.c === '#EC8629') && fp.ticks.some(t => t.c === '#E22028'), 'faceplate ticks use configured priority colours');
  // menu item for the preset exists in the Station menu
  const station = v.menus.find(m => m.name === 'Station');
  assert.ok(station.items.some(i => /Alarm colour philosophy: ISA-101/.test(i.label || '')));
});

test('the palette data-prop and highColor both feed the getter', () => {
  const c = boot({ palette: 'isa101' });
  assert.equal(c.paletteName(), 'isa101');
  assert.equal(c.prioColor('Urgent'), '#E22028');
  const d = boot({ highColor: '#FFA500' });
  assert.equal(d.prioColor('High'), '#FFA500', 'highColor overrides High on the representative preset');
  d.setPalette('isa101');
  assert.equal(d.prioColor('High'), '#EC8629', 'the ISA-101 preset keeps its documented value');
  assert.equal(boot({ palette: 'bogus' }).paletteName(), 'representative');
});

test('every priority/text pair is at least 3:1 in both presets as the app draws them', () => {
  for (const props of [{}, { highColor: '#FFA500' }]) {
    const c = boot(props);
    for (const name of Palette.list()) {
      c.setPalette(name);
      const p = c.colours();
      for (const pr of Palette.textPairs(p)) {
        assert.ok(Palette.contrastRatio(pr.fg, pr.bg) >= 3, name + ': ' + pr.label + ' ' + pr.fg + ' on ' + pr.bg);
      }
      for (const k of ['Urgent', 'High', 'Low', 'Journal']) {
        assert.ok(Palette.contrastRatio(c.prioText(k), c.prioColor(k)) >= 3, name + ' ' + k);
        assert.ok(Palette.contrastRatio(c.prioDark(k), '#C6C6C6') >= 3, name + ' ' + k + ' dim on list background');
      }
    }
  }
});

test('the limit ladder is ordered for every point and the band renders everywhere', () => {
  const c = boot();
  for (const tag in c.L) {
    const b = c.limitBand(c.L[tag]);
    const seq = [b.rangeLo, b.critLo, b.stdLo, b.tgtLo, b.tgtHi, b.stdHi, b.critHi, b.rangeHi];
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i - 1] <= seq[i], tag + ' rung ' + i + ': ' + seq.join(' <= '));
    assert.ok(b.tgtLo < b.tgtHi, tag + ' has a real target band');
  }
  // configured values land on the rungs
  const t = c.limitBand(c.L.TIC201);
  assert.deepEqual([t.rangeLo, t.critLo, t.stdLo, t.stdHi, t.critHi, t.rangeHi], [0, 130, 140, 165, 175, 200]);
  assert.equal(t.tgtLo, 140); assert.equal(t.tgtHi, 160, 'auto target = SP ± 5 % of range, clamped to the standard band');
  const i = c.limitBand(c.L.TI312);
  assert.deepEqual([i.tgtLo, i.tgtHi, i.stdHi, i.critHi], [360, 420, 440, 480], 'indication points use their configured normal band');
  // overview boxes, faceplates and Point Detail carry the band
  c.setState({ display: 'graphic', unit: 'U1' });
  c.openFp('LIC101');
  let v = c.renderVals();
  const gv = v.gvList.find(p => p.tag === 'LIC101');
  assert.ok(gv.bandOn && gv.band.length >= 5, 'segments beside the box');
  assert.equal(v.gvList.find(p => p.tag === 'P101').bandOn, false, 'motors carry no ladder');
  const total = gv.band.reduce((s, x) => s + Number(x.h), 0);
  assert.ok(Math.abs(total - 46) < 0.5, 'segments tile the 46 px box: ' + total);
  assert.ok(v.fps.find(f => f.tag === 'LIC101').bands.length >= 5, 'faceplate bar carries the bands');
  c.openFp('P101');
  assert.equal(c.renderVals().fps.find(f => f.tag === 'P101').bands.length, 0, 'motor faceplate has none');
  c.setState({ display: 'detail', detailTag: 'LIC101', detailTab: 'main' });
  v = c.renderVals();
  assert.ok(v.dpt.hasBand);
  assert.deepEqual(v.dpt.limitRows.map(r => r.param), ['PVEUHI', 'PVHH', 'PVHI', 'TGTHI', 'TGTLO', 'PVLO', 'PVLL', 'PVEULO']);
  assert.equal(v.dpt.limitRows.filter(r => r.cur === 'pointer').length, 2, 'only the target rows are editable');
});

test('ENGR edits the target band; ordering and security are enforced', () => {
  const c = boot(null, 'ENGR');
  const l = c.L.TIC201;
  c.openEntry('TIC201', 'TGTHI');
  assert.equal(c.state.entry.param, 'TGTHI');
  c.setState({ entryText: '162' }); c.commitEntry();
  assert.equal(l.tgtHi, 162); assert.equal(l.tgtLo, 140, 'auto low is frozen when the engineer fixes the band');
  assert.ok(c.events.some(e => e.desc === 'TARGET HIGH CHANGE' && e.newV === '162.00'));
  c.openEntry('TIC201', 'TGTLO'); c.setState({ entryText: '170' }); c.commitEntry();
  assert.equal(l.tgtLo, 140, 'low above high is rejected');
  assert.match(c.state.msg, /TARGET BAND/);
  c.openEntry('TIC201', 'TGTHI'); c.setState({ entryText: '190' }); c.commitEntry();
  assert.equal(l.tgtHi, 162, 'outside the standard band is rejected');
  const b = c.limitBand(l);
  assert.ok(b.stdLo <= b.tgtLo && b.tgtLo < b.tgtHi && b.tgtHi <= b.stdHi);
  const o = boot(null, 'OPER');
  o.openEntry('TIC201', 'TGTHI');
  assert.equal(o.state.entry, null, 'OPER cannot open the target entry');
  assert.match(o.state.msg, /ENGR/);
});

test('the philosophy dialog opens and names the four sources', () => {
  const c = boot();
  const help = c.renderVals().menus.find(m => m.name === 'Help');
  const item = help.items.find(i => /Alarm and display philosophy/.test(i.label || ''));
  assert.ok(item, 'Help menu item present');
  item.cb();
  assert.equal(c.state.dlg.type, 'philosophy');
  const v = c.renderVals();
  assert.ok(v.dg.open && v.dg.isPhil);
  const text = v.dg.phil.sections.map(s => s.title + ' ' + s.body).join(' ') + ' ' + v.dg.phil.sources.map(s => s.name).join(' ');
  for (const src of ['ISA-18.2', 'EEMUA 191', 'ASM Consortium gray-background paper', 'Rockwell process HMI style guide']) assert.ok(text.includes(src), 'cites ' + src);
  assert.ok(/5 % Urgent, 10 % High and 85 % Low/.test(text) && /80 \/ 15 \/ 5/.test(text), 'both priority distributions');
  for (const w of ['grey', 'blink', 'flash', 'Shelving', 'Suppression', 'Out of service', 'deadband', 'on-delay', 'ladder']) assert.ok(new RegExp(w, 'i').test(text), 'covers ' + w);
  assert.equal(v.dg.phil.ladder.length, 8);
  assert.equal(v.dg.phil.swatches.length, 4);
  // command-zone entry point
  c.setState({ dlg: null, cmd: 'PHILOSOPHY' }); c.parseCmd();
  assert.equal(c.state.dlg.type, 'philosophy');
  assert.equal(Philosophy.sources().length, 4);
});

test('Loop Tune shows ISA-equivalent tuning, a PV tracking toggle and a step-response sparkline', () => {
  const c = boot(null, 'ENGR');
  for (let i = 0; i < 240; i++) c.step(0.5);
  c.setState({ display: 'detail', detailTag: 'TIC201', detailTab: 'tuning' });
  let v = c.renderVals();
  const byParam = (p) => v.dpt.tuneRows.find(r => r.param === p);
  assert.match(byParam('K').note, /REVERSE/);
  assert.match(byParam('T1').value, /MIN$/);
  assert.equal(byParam('ISA').value, '2.00 / 8.00 MIN / 0.50 MIN');
  assert.match(byParam('PARALLEL').value, /^2\.00 \/ 0\.0042 \/S \/ 60\.0 S$/);
  assert.equal(byParam('PVTRACK').value, 'OFF');
  byParam('PVTRACK').cb();
  assert.equal(c.L.TIC201.pvtrack, true);
  assert.ok(c.events.some(e => e.desc === 'PV TRACKING CHANGE' && e.newV === 'ON'));
  assert.ok(v.dpt.spark.pv.split(' ').length > 20 && v.dpt.spark.sp && v.dpt.spark.op, 'sparkline has points');
  assert.equal(v.dpt.spark.span, '5 MIN');
  // PV tracking: SP follows PV in MAN, then AUTO starts at zero error
  const l = c.L.TIC201; c.setMode('TIC201', 'MAN'); l.sp = 100;
  c.pids(0.5);
  assert.ok(Math.abs(l.sp - l.pv) < 1e-9, 'SP tracks PV in MAN');
  const o = boot(null, 'OPER');
  o.setPvTrack('TIC201', true);
  assert.equal(o.L.TIC201.pvtrack, false, 'PV tracking needs ENGR');
});
