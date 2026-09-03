// @artifact dev
// tools/coach/serve.py _process_section(unit, focus_tags): the unit's orientation section
// is ~3 000 characters and context_pack caps the "process" key at 900, so the paragraph
// that matters for THIS request (the point in alarm, the point selected, the tag named
// in the question) must come first or the model never sees it. Found by the verify pass
// on the E-301 sign fix: with TIC301 in alarm, "E-301 is a PREHEATER" sat at offset ~1 900
// of the U1 section and was truncated away on every request.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const COACH = path.join(ROOT, 'tools', 'coach');

function py(expr) {
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(COACH)}); import serve; print(json.dumps(${expr}))`;
  return JSON.parse(execFileSync('python3', ['-c', code], { cwd: ROOT, encoding: 'utf8' }));
}

test('with no focus the unit section is in document order', () => {
  const s = py("serve._process_section('U1')");
  assert.match(s, /^UNIT ONE RECEIPT AND CONVERSION\n/);
  assert.match(s.split('\n\n')[0], /FI100/, 'the first paragraph is the supply paragraph');
});

test('a focus tag moves its paragraph(s) to the front, inside the 900-character cap', () => {
  const plain = py("serve._process_section('U1')");
  const focused = py("serve._process_section('U1', ['TIC301'])");
  assert.ok(plain.indexOf('E-301 is a PREHEATER') > 900, 'precondition: unfocused, the E-301 paragraph is beyond the cap');
  assert.ok(focused.slice(0, 900).includes('E-301 is a PREHEATER'), 'focused on TIC301, the E-301 paragraph must be inside the cap');
  // same paragraphs, none duplicated, none lost
  const paras = (s) => s.split('\n').slice(1).join('\n').split('\n\n').map((p) => p.trim()).filter(Boolean);
  assert.deepEqual(paras(focused).slice().sort(), paras(plain).slice().sort());
  assert.equal(new Set(paras(focused)).size, paras(focused).length);
});

test('focus is keyed on tags the station sends: ask tags, the selected point, the alarm tags', () => {
  const pack = py("serve.context_pack('', {'screen': {'unit': 'U1', 'selected': 'TIC301'}, 'alarms': [], 'points': [], 'catalog': []})");
  assert.ok(pack.process.includes('E-301 is a PREHEATER'), 'selected point TIC301 must pull the E-301 paragraph forward');
  const packAlarm = py("serve.context_pack('', {'screen': {'unit': 'U1'}, 'alarms': [{'tag': 'PIC401', 'cond': 'PVHI'}], 'points': [], 'catalog': []})");
  assert.ok(packAlarm.process.includes('LIC401 holds the drum level'), 'PIC401 in alarm must pull the drum paragraph forward');
  const packNone = py("serve.context_pack('', {'screen': {'unit': 'U1'}, 'alarms': [], 'points': [], 'catalog': []})");
  assert.match(packNone.process.split('\n\n')[0], /FI100/, 'with nothing in focus, document order');
  assert.ok(packNone.process.length <= 900);
});
