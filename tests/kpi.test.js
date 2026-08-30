// @artifact dev
const test = require('node:test');
const assert = require('node:assert/strict');
const Kpi = require('../src/kpi.js');

const MIN = 60000;
function ev(t, key, prio, type) { return { t, key, prio: prio || 'Low', type: type || 'raise' }; }

test('quiet plant: one alarm per 10 minutes is GOOD', () => {
  const h = [];
  for (let i = 0; i < 6; i++) h.push(ev(i * 10 * MIN + MIN, 'T' + i + '.PVHI', i === 0 ? 'Urgent' : (i < 2 ? 'High' : 'Low')));
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 60 * MIN });
  assert.equal(m.total, 6);
  assert.equal(m.per10min.avg, 1);
  assert.equal(m.per10min.peak, 1);
  assert.equal(m.perDay, 144);
  assert.equal(m.floods.length, 0);
  assert.equal(m.floodPct, 0);
  assert.equal(m.chattering.length, 0);
  assert.equal(m.health.verdict, 'GOOD');
  assert.ok(m.health.checks.every(c => c.pass));
});

test('flood detection: 12 alarms in two minutes marks a flood and OVERLOADED verdict', () => {
  const h = [];
  for (let i = 0; i < 12; i++) h.push(ev(20 * MIN + i * 10000, 'A' + i + '.PVHI', 'High'));
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 60 * MIN });
  assert.equal(m.floods.length, 1);
  assert.equal(m.floods[0].start, 20 * MIN);
  // the last raise that still sees 10 within 10 min is the third (t = 20:20), so the flood ends at 30:20
  assert.equal(m.floods[0].end, 30 * MIN + 20000);
  assert.ok(Math.abs(m.floodPct - (10 * MIN + 20000) / (60 * MIN) * 100) < 0.05);
  assert.equal(m.per10min.peak, 12);
  assert.equal(m.health.verdict, 'OVERLOADED');
});

test('flood intervals merge and are capped at the window end', () => {
  const h = [];
  for (let i = 0; i < 30; i++) h.push(ev(55 * MIN + i * 5000, 'B' + (i % 15) + '.PVLO'));
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 60 * MIN });
  assert.equal(m.floods.length, 1);
  assert.equal(m.floods[0].end, 60 * MIN);
});

test('chattering: three raises of the same key within 60 s', () => {
  const h = [ev(0, 'FIC102.PVLO'), ev(20000, 'FIC102.PVLO'), ev(45000, 'FIC102.PVLO'), ev(5 * MIN, 'LIC101.PVHI'), ev(9 * MIN, 'LIC101.PVHI')];
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 10 * MIN });
  assert.deepEqual(m.chattering, [{ key: 'FIC102.PVLO', count: 3 }]);
  assert.equal(m.health.checks.find(c => c.id === 'chattering').pass, false);
});

test('standing alarms use the configurable stale threshold', () => {
  const h = [ev(1 * MIN, 'R-201.PVHH', 'Urgent'), ev(2 * MIN, 'TIC202.DEVHI', 'High'), ev(4 * MIN, 'TIC202.DEVHI', 'High', 'rtn')];
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 30 * MIN, staleAfterMs: 20 * MIN });
  assert.equal(m.standing.length, 1);
  assert.equal(m.standing[0].key, 'R-201.PVHH');
  assert.equal(m.standing[0].durationMs, 29 * MIN);
  const nominal = Kpi.computeMetrics(h, { t0: 0, t1: 30 * MIN });
  assert.equal(nominal.standing.length, 0, '24 h nominal threshold not reached');
});

test('bad actors: top-10 and their share of load', () => {
  const h = [];
  for (let i = 0; i < 40; i++) h.push(ev(i * MIN, 'NOISY.PVHI'));
  for (let i = 0; i < 12; i++) h.push(ev(i * 3 * MIN + 1000, 'K' + i + '.PVLO'));
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 60 * MIN });
  assert.equal(m.badActors.length, 10);
  assert.equal(m.badActors[0].key, 'NOISY.PVHI');
  assert.equal(m.badActors[0].count, 40);
  assert.ok(Math.abs(m.badActors[0].pct - 40 / 52 * 100) < 0.1);
  assert.ok(m.badActorPct > 90);
  assert.equal(m.health.checks.find(c => c.id === 'badActors').pass, false);
});

test('priority distribution compares to the 80/15/5 target; Journal is not alarm load', () => {
  const h = [];
  for (let i = 0; i < 80; i++) h.push(ev(i * 1000, 'L' + i, 'Low'));
  for (let i = 0; i < 15; i++) h.push(ev(i * 1000 + 100, 'H' + i, 'High'));
  for (let i = 0; i < 5; i++) h.push(ev(i * 1000 + 200, 'U' + i, 'Urgent'));
  for (let i = 0; i < 7; i++) h.push(ev(i * 1000 + 300, 'J' + i, 'Journal'));
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 100000 });
  assert.equal(m.total, 100);
  assert.equal(m.journal, 7);
  assert.deepEqual(m.priority.pct, { Urgent: 5, High: 15, Low: 80 });
  assert.deepEqual(m.priority.deviation, { Urgent: 0, High: 0, Low: 0 });
  assert.deepEqual(Kpi.thresholds.priorityTarget, { Low: 80, High: 15, Urgent: 5 });
});

test('accepts app-style ALARM type and unsorted input; empty history is safe', () => {
  const h = [{ t: 5000, key: 'X.PVHI', prio: 'Low', type: 'ALARM' }, { t: 1000, key: 'Y.PVHI', prio: 'Low', type: 'ALARM' }];
  const m = Kpi.computeMetrics(h);
  assert.equal(m.total, 2);
  assert.equal(m.window.t0, 1000);
  const e = Kpi.computeMetrics([]);
  assert.equal(e.total, 0);
  assert.equal(e.health.verdict, 'GOOD');
});

test('MANAGEABLE band: above 150/day but below 300/day', () => {
  const h = [];
  for (let i = 0; i < 90; i++) h.push(ev(i * 40000, 'M' + i + '.PVHI'));   // 90 in 60 min = 2160/day, 15 per 10 min
  const m = Kpi.computeMetrics(h, { t0: 0, t1: 60 * MIN, floodCount: 100 });
  assert.equal(m.per10min.avg, 15);
  assert.equal(m.perDay, 2160);
  assert.equal(m.health.verdict, 'OVERLOADED');
  const g = Kpi.computeMetrics(h.filter((_, i) => i % 9 === 0), { t0: 0, t1: 60 * MIN });   // 10 in 60 min = 240/day, avg 1.67
  assert.equal(g.perDay, 240);
  assert.equal(g.health.verdict, 'MANAGEABLE');
});

test('scoreDrill: perfect run scores 100 and passes at 80', () => {
  const r = Kpi.scoreDrill({ tAlarm: 0, tAck: 10000, tAct: 60000, tStable: 400000, trip: false, quizCorrect: true, alarmsPer10min: 1 });
  assert.equal(r.score, 100);
  assert.equal(r.pass, true);
  assert.equal(r.passMark, 80);
  assert.match(r.passLabel, /independent/);
  assert.equal(r.breakdown.length, 6);
  assert.equal(r.breakdown.reduce((a, b) => a + b.max, 0), 100);
});

test('scoreDrill: slow ack, trip and wrong quiz fail the drill with a readable breakdown', () => {
  const r = Kpi.scoreDrill({ tAlarm: 0, tAck: 150000, tAct: 300000, tStable: null, trip: true, quizCorrect: false, alarmsPer10min: 5.5 });
  assert.ok(r.score < 80 && r.pass === false, 'score ' + r.score);
  const by = Object.fromEntries(r.breakdown.map(b => [b.id, b]));
  assert.equal(by.ack.earned, 3);
  assert.equal(by.action.earned, 15);
  assert.equal(by.trip.earned, 0);
  assert.equal(by.stable.earned, 0);
  assert.equal(by.load.earned, 5);
  assert.equal(by.quiz.earned, 0);
  assert.equal(r.score, 23);
});

test('scoreDrill: rubric overrides weights and pass mark; missing metrics do not throw', () => {
  const r = Kpi.scoreDrill({}, { weights: { ack: 50, action: 50, trip: 0, stable: 0, load: 0, quiz: 0 }, passMark: 50 });
  assert.equal(r.score, 0);
  assert.equal(r.passMark, 50);
  const ok = Kpi.scoreDrill({ tAlarm: 0, tAck: 1000, tAct: 2000 }, { weights: { ack: 50, action: 50, trip: 0, stable: 0, load: 0, quiz: 0 }, passMark: 50 });
  assert.equal(ok.score, 100);
  const wrong = Kpi.scoreDrill({ tAlarm: 0, tAck: 1000, tAct: 2000, actionCorrect: false });
  assert.equal(wrong.breakdown.find(b => b.id === 'action').earned, 0);
});
