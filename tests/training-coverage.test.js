// @artifact dev
// The coverage matrix's Architecture task group (V3-PLAN section 6): every A-drill maps to
// tasks, and the eight legacy drills, their 42 tasks and the pass-mark wording are untouched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Training = require('../src/training.js');
const DrillArch = require('../src/drill-arch.js');

const LEGACY_GROUPS = ['Navigation and displays', 'Alarms', 'Control and faceplates', 'Batch and sequences', 'Trends and history', 'Messages and confirmations', 'Security and signatures', 'Abnormal situation handling'];
const LEGACY_DRILLS = ['D1', 'D2', 'D3', 'D4', 'D6', 'D9', 'D11', 'D12'];
const LEGACY_TASK_IDS = ['nav.command', 'nav.unit', 'nav.faceplate', 'nav.detail', 'nav.back', 'nav.sys',
  'alm.silence', 'alm.ack', 'alm.ackpage', 'alm.summary', 'alm.shelve', 'alm.unshelve', 'alm.comment', 'alm.help', 'alm.oos', 'alm.kpi',
  'ctl.mode', 'ctl.sp', 'ctl.op', 'ctl.raiselower', 'ctl.motor', 'ctl.tune', 'ctl.trip', 'ctl.pvtrack',
  'bat.start', 'bat.hold', 'bat.abort', 'bat.confirm', 'trn.open', 'trn.group', 'trn.events', 'trn.evfilter',
  'msg.open', 'msg.confirm', 'sec.logon', 'sec.signoff', 'sec.esig', 'sec.moc', 'abn.assist', 'abn.drill', 'abn.pass', 'abn.disable'];

test('GROUPS: the eight legacy groups keep their order and indices; Architecture is appended as the ninth', () => {
  assert.deepEqual(Training.GROUPS.slice(0, 8), LEGACY_GROUPS);
  assert.equal(Training.GROUPS.length, 9);
  assert.equal(Training.GROUPS[8], 'Architecture');
});

test('the 42 legacy tasks are present, in order, unchanged in group, and reference only legacy drills', () => {
  const tasks = Training.tasks();
  const legacy = tasks.filter(t => t.group !== 'Architecture');
  assert.deepEqual(legacy.map(t => t.id), LEGACY_TASK_IDS);
  for (const t of legacy) {
    assert.ok(LEGACY_GROUPS.includes(t.group), `${t.id} in a legacy group`);
    for (const d of t.drills) assert.ok(LEGACY_DRILLS.includes(d), `${t.id} references legacy drill ${d} only`);
  }
  assert.equal(Training.PASS_MARK, 80);
  assert.equal(Training.PASS_LABEL, '80 % pass mark — independent training threshold, not a vendor certification');
});

test('every architecture drill A1..A12 in src/drill-arch.js maps to at least one Architecture task, and no task id repeats', () => {
  const tasks = Training.tasks();
  const arch = tasks.filter(t => t.group === 'Architecture');
  assert.ok(arch.length >= 8, 'a real task group, not a token');
  const ids = tasks.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'task ids unique');
  assert.ok(arch.every(t => /^arch\./.test(t.id)), 'architecture tasks use the arch.* id prefix');
  const drillIds = DrillArch.drillIds();
  assert.deepEqual(drillIds, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12']);
  for (const d of drillIds) assert.ok(arch.some(t => t.drills.includes(d)), `${d} is mapped to an Architecture task`);
  // and every drill an Architecture task names is a real drill -- no phantom ids (the fault-vocabulary lesson from SA)
  for (const t of arch) for (const d of t.drills) assert.ok(drillIds.includes(d), `${t.id} names a real A-drill (${d})`);
  // the evidence/hypothesis/compare commands of V3-PLAN section 6 each have a task
  // the five default-rubric categories (V3-PLAN section 6) each have a task: stabilization, evidence, localization, post-action verification, debrief
  for (const id of ['arch.safe', 'arch.evidence', 'arch.compare', 'arch.hypothesis', 'arch.verify', 'arch.debrief']) assert.ok(ids.includes(id), id);
  // every task carries the T() shape
  for (const t of tasks) { assert.deepEqual(Object.keys(t), ['id', 'group', 'label', 'drills', 'features']); assert.ok(t.label.length > 8); assert.ok(t.features.length >= 1); }
});

test('coverage() and coverageSummary() report the new group and count 56 tasks', () => {
  const cov = Training.coverage(new Set(['arch.open', 'arch.evidence', 'nav.command']));
  assert.equal(cov.length, 9);
  const g = cov.find(x => x.name === 'Architecture');
  assert.equal(g.done, 2);
  assert.equal(g.total, Training.tasks().filter(t => t.group === 'Architecture').length);
  const s = Training.coverageSummary(new Set(['arch.open']));
  assert.equal(s.total, 56);
  assert.equal(s.done, 1);
  // a plain object works as the done-set too, as before
  assert.equal(Training.coverageSummary({ 'arch.debrief': true }).done, 1);
});
