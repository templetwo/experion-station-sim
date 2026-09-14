// @artifact dev
const test = require('node:test');
const assert = require('node:assert/strict');
const Palette = require('../src/palette.js');

test('list and lookup; unknown names fall back to representative', () => {
  assert.deepEqual(Palette.list(), ['representative', 'isa101', 'night']);
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

// ---------------------------------------------------------------------------
// THE CONTRAST GATE, raised from 3:1 to WCAG AA normal text (4.5:1) on 2026-09-14.
//
// It enforced 3:1 -- the AA bar for LARGE text -- while the alarm surfaces it governs render at
// 9-12.5 px, where 4.5 is required. That one tier is why 29 real pairs failed AA at their rendered
// size while this suite stayed green. Measured, not assumed: see docs/dev/FACELIFT-BASELINE-AUDIT.md.
//
// Two pre-existing failures in the LIGHT presets are allowlisted rather than "fixed", and the
// reason matters. `representative` is meant to represent Experion defaults, where urgent is red
// with white text; darkening it to reach 4.5 would make it LESS representative, which is the one
// thing that preset exists to be. `isa101` carries the published style-guide values (RESOURCES 2.4)
// for the same reason. Corrupting a citation to pass a test is worse than recording the debt.
//
// The `night` preset owes nothing to a vendor default and is therefore held to the full bar with no
// exceptions -- and passes all 24 pairs.
//
// The allowlist cannot rot: an entry that stops matching a real failure fails the test below, so a
// later palette fix forces the exception to be removed rather than quietly outliving its reason.
const AA_NORMAL = 4.5;
const KNOWN_SUB_AA = [
  { palette: 'representative', label: 'Urgent text on fill',
    why: 'Experion urgent is red with white text; darkening it makes the preset less representative.' },
  { palette: 'representative', label: 'High dim text on bg',
    why: 'Pre-existing; the dim tones are accents and borders on this preset, not body text.' },
  { palette: 'representative', label: 'Low dim text on bg',
    why: 'Pre-existing; the dim cyan is a band and border accent on this preset, not body text.' },
  { palette: 'representative', label: 'Journal dim text on bg',
    why: 'Pre-existing; journal is the quietest priority and its dim tone is deliberately recessive.' },
  { palette: 'isa101', label: 'Journal text on fill',
    why: 'Published ISA-101 style-guide value (RESOURCES 2.4); changing it would misquote the source.' },
];
const isKnown = (n, label) => KNOWN_SUB_AA.some((k) => k.palette === n && k.label === label);

test('every text/background pair meets WCAG AA (4.5:1), except the recorded pre-existing pairs', () => {
  const unexpected = [];
  for (const n of Palette.list()) {
    const p = Palette.getPalette(n);
    const pairs = Palette.textPairs(p);
    assert.ok(pairs.length >= 20);
    for (const pr of pairs) {
      const r = Palette.contrastRatio(pr.fg, pr.bg);
      if (r >= AA_NORMAL) continue;
      // Nothing may fall below the large-text floor, allowlisted or not.
      assert.ok(r >= 3, n + ': ' + pr.label + ' ' + pr.fg + ' on ' + pr.bg + ' = ' + r.toFixed(2) +
        ' is below even the 3:1 large-text floor');
      if (!isKnown(n, pr.label)) {
        unexpected.push(n + ': ' + pr.label + ' ' + pr.fg + ' on ' + pr.bg + ' = ' + r.toFixed(2));
      }
    }
  }
  assert.deepEqual(unexpected, [],
    'new sub-AA pairs -- fix the colour or, if it is genuinely unfixable, add it to KNOWN_SUB_AA ' +
    'with a reason:\n' + unexpected.join('\n'));
});

test('the night preset is held to full AA with no exceptions', () => {
  const p = Palette.getPalette('night');
  for (const pr of Palette.textPairs(p)) {
    const r = Palette.contrastRatio(pr.fg, pr.bg);
    assert.ok(r >= AA_NORMAL,
      'night: ' + pr.label + ' ' + pr.fg + ' on ' + pr.bg + ' = ' + r.toFixed(2) + ' (needs 4.5)');
  }
});

test('the sub-AA allowlist cannot rot: every entry still names a real failure', () => {
  const stale = [];
  for (const k of KNOWN_SUB_AA) {
    const p = Palette.getPalette(k.palette);
    const pr = Palette.textPairs(p).find((x) => x.label === k.label);
    if (!pr) { stale.push(k.palette + ': "' + k.label + '" no longer exists as a pair'); continue; }
    if (Palette.contrastRatio(pr.fg, pr.bg) >= AA_NORMAL) {
      stale.push(k.palette + ': "' + k.label + '" now passes AA -- remove the exception');
    }
    assert.ok(k.why && k.why.length > 20, k.palette + '/' + k.label + ' needs a real reason');
  }
  assert.deepEqual(stale, [], 'stale allowlist entries:\n' + stale.join('\n'));
});
