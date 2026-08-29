const test = require('node:test');
const assert = require('node:assert/strict');
const Palette = require('../src/palette.js');

test('list and lookup; unknown names fall back to representative', () => {
  assert.deepEqual(Palette.list(), ['representative', 'isa101']);
  assert.equal(Palette.getPalette('isa101').name, 'isa101');
  assert.equal(Palette.getPalette('nope').name, 'representative');
  const a = Palette.getPalette('isa101'); a.prio.Urgent = '#000000';
  assert.equal(Palette.getPalette('isa101').prio.Urgent, '#E22028', 'presets are returned as copies');
});

test('representative preset matches the app defaults', () => {
  const p = Palette.getPalette('representative');
  assert.deepEqual(p.prio, { Urgent: '#FF0000', High: '#FFE000', Low: '#00D8D8', Journal: '#909090' });
  assert.deepEqual(p.prioDim, { Urgent: '#A00000', High: '#7A6400', Low: '#00696D', Journal: '#666666' });
  assert.equal(p.bg, '#BFBFBF');
});

test('isa101 preset carries the documented style-guide values (RESOURCES 2.4)', () => {
  const p = Palette.getPalette('isa101');
  assert.equal(p.bg, '#E0E0E0');
  assert.equal(p.line, '#A0A0A4');
  assert.deepEqual(p.prio, { Urgent: '#E22028', High: '#EC8629', Low: '#F5E11B', Journal: '#916AAD' });
  assert.deepEqual(p.state, { stopped: '#808080', running: '#F0F0F0', manual: '#93C2E4' });
});

test('every palette has the same shape', () => {
  const keys = ['Urgent', 'High', 'Low', 'Journal'];
  for (const n of Palette.list()) {
    const p = Palette.getPalette(n);
    for (const grp of ['prio', 'prioText', 'prioDim']) assert.deepEqual(Object.keys(p[grp]), keys, n + '.' + grp);
    assert.deepEqual(Object.keys(p.state), ['stopped', 'running', 'manual']);
    assert.deepEqual(Object.keys(p.stateText), ['stopped', 'running', 'manual']);
    for (const v of [p.bg, p.line, p.text]) assert.match(v, /^#[0-9A-F]{6}$/);
  }
});

test('contrast helper matches WCAG reference values', () => {
  assert.ok(Math.abs(Palette.contrastRatio('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.ok(Math.abs(Palette.contrastRatio('#FFFFFF', '#000000') - 21) < 1e-9);
  assert.ok(Math.abs(Palette.contrastRatio('#777777', '#FFFFFF') - 4.48) < 0.01);
  assert.ok(Math.abs(Palette.luminance('#FFFFFF') - 1) < 1e-9);
  assert.equal(Palette.luminance('#000'), 0);
});

test('every text/background pair in both presets is at least 3:1', () => {
  for (const n of Palette.list()) {
    const p = Palette.getPalette(n);
    const pairs = Palette.textPairs(p);
    assert.ok(pairs.length >= 20);
    for (const pr of pairs) {
      const r = Palette.contrastRatio(pr.fg, pr.bg);
      assert.ok(r >= 3, n + ': ' + pr.label + ' ' + pr.fg + ' on ' + pr.bg + ' = ' + r.toFixed(2));
    }
  }
});
