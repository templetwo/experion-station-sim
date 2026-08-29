// Transition table tests transliterated from alerta isa_18_2.py (RESOURCES 2.5),
// loxalarm delay / shelve semantics (2.9), Siemens indication table (2.6),
// Experion sub-priority ordering (2.1) and PIN folding / DAS semantics (2.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const AE = require('../src/alarm-engine.js');

const MIN = 60000;
function mk(opts) { return AE.createEngine(opts); }
function hi(e, t, extra) {
  return e.raise(Object.assign({ tag: 'TIC201', cond: 'PVHI', prio: 'High', subprio: 5, val: 170, eu: 'degC', desc: 'Reactor temp', tripValue: 165, t }, extra || {}));
}
function types(evs) { return evs.map(e => e.type); }

// ---- transition table -------------------------------------------------------

test('T1 raise from NORM -> UNACK with ALARM event', () => {
  const e = mk(); const ev = hi(e, 1000);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'UNACK');
  assert.deepEqual(types(ev), ['ALARM']);
  assert.equal(ev[0].from, 'NORM'); assert.equal(ev[0].to, 'UNACK');
  assert.equal(r.ack, false); assert.equal(r.active, true); assert.equal(r.shelved, false);
  assert.equal(r.count, 1); assert.equal(r.t, 1000); assert.equal(r.lastT, 1000);
});

test('T2 ack UNACK -> ACKED', () => {
  const e = mk(); hi(e, 1000);
  const ev = e.ack('TIC201.PVHI', 2000);
  assert.deepEqual(types(ev), ['ACK']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'ACKED'); assert.equal(r.ack, true); assert.equal(r.ackT, 2000);
});

test('T3 RTN ACKED -> NORM (record dropped from list, kept in all())', () => {
  const e = mk(); hi(e, 1000); e.ack('TIC201.PVHI', 2000);
  const ev = e.rtn('TIC201', 'PVHI', 3000, 160);
  assert.deepEqual(types(ev), ['RTN']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'NORM'); assert.equal(r.active, false); assert.equal(r.val, 160);
  assert.equal(e.list().length, 0); assert.equal(e.all().length, 1);
});

test('T4 RTN UNACK -> RTNUN', () => {
  const e = mk(); hi(e, 1000);
  const ev = e.rtn('TIC201', 'PVHI', 3000);
  assert.deepEqual(types(ev), ['RTN']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'RTNUN'); assert.equal(r.ack, false); assert.equal(r.active, false);
  assert.equal(e.list().length, 1);
});

test('T5 ack RTNUN -> NORM', () => {
  const e = mk(); hi(e, 1000); e.rtn('TIC201', 'PVHI', 3000);
  const ev = e.ack(e.get('TIC201.PVHI').id, 4000);
  assert.deepEqual(types(ev), ['ACK']);
  assert.equal(e.get('TIC201.PVHI').state, 'NORM');
});

test('T6 re-alarm RTNUN -> UNACK increments count, keeps first t', () => {
  const e = mk(); hi(e, 1000); e.rtn('TIC201', 'PVHI', 3000);
  const ev = hi(e, 5000);
  assert.deepEqual(types(ev), ['ALARM']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'UNACK'); assert.equal(r.count, 2); assert.equal(r.t, 1000); assert.equal(r.lastT, 5000);
});

test('T7 re-alarm with higher priority while ACKED -> UNACK (escalated)', () => {
  const e = mk(); hi(e, 1000); e.ack('TIC201.PVHI', 2000);
  const ev = hi(e, 3000, { prio: 'Urgent' });
  assert.deepEqual(types(ev), ['ALARM']);
  assert.equal(ev[0].escalated, true);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'UNACK'); assert.equal(r.prio, 'Urgent');
});

test('T8 re-alarm with same or lower priority while ACKED stays ACKED, no event', () => {
  const e = mk(); hi(e, 1000); e.ack('TIC201.PVHI', 2000);
  assert.deepEqual(hi(e, 3000, { val: 175 }), []);
  assert.deepEqual(hi(e, 3500, { prio: 'Low' }), []);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'ACKED'); assert.equal(r.prio, 'High'); assert.equal(r.val, 170);
});

test('T9 repeated raise while UNACK is a no-op except value update', () => {
  const e = mk(); hi(e, 1000);
  assert.deepEqual(hi(e, 2000, { val: 180 }), []);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'UNACK'); assert.equal(r.val, 180); assert.equal(r.count, 1);
});

test('T10 ack on ACKED or NORM returns no events', () => {
  const e = mk(); hi(e, 1000); e.ack('TIC201.PVHI', 2000);
  assert.deepEqual(e.ack('TIC201.PVHI', 2500), []);
  e.rtn('TIC201', 'PVHI', 3000);
  assert.deepEqual(e.ack('TIC201.PVHI', 3500), []);
  assert.deepEqual(e.ack('NOPE.X', 1), []);
});

test('T11 RTN on a record that is not live returns no events', () => {
  const e = mk();
  assert.deepEqual(e.rtn('TIC201', 'PVHI', 1), []);
  hi(e, 1000); e.rtn('TIC201', 'PVHI', 2000);
  assert.deepEqual(e.rtn('TIC201', 'PVHI', 3000), []);
});

test('T12 shelve from UNACK -> SHLVD with reason and until', () => {
  const e = mk(); hi(e, 1000);
  const ev = e.shelve('TIC201.PVHI', { reason: 'nuisance during startup', durationMs: 30 * MIN, t: 2000 });
  assert.deepEqual(types(ev), ['SHELVE']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'SHLVD'); assert.equal(r.shelved, true); assert.equal(r.ack, true);
  assert.equal(r.shelveReason, 'nuisance during startup'); assert.equal(r.until, 2000 + 30 * MIN);
  assert.equal(ev[0].reason, 'nuisance during startup');
});

test('T13 shelve from ACKED and RTNUN allowed; from NORM refused', () => {
  const e = mk(); hi(e, 1000); e.ack('TIC201.PVHI', 1500);
  assert.equal(e.shelve('TIC201.PVHI', { t: 2000 }).length, 1);
  e.unshelve('TIC201.PVHI', 2500); e.rtn('TIC201', 'PVHI', 3000);
  assert.equal(e.get('TIC201.PVHI').state, 'RTNUN');
  assert.equal(e.shelve('TIC201.PVHI', { t: 3500 }).length, 1);
  e.unshelve('TIC201.PVHI', 4000);
  assert.equal(e.get('TIC201.PVHI').state, 'NORM');
  assert.deepEqual(e.shelve('TIC201.PVHI', { t: 4500 }), []);
});

test('T14 shelve duration is clamped to maxShelveMs and defaults when omitted', () => {
  const e = mk({ maxShelveMs: 60 * MIN, defaultShelveMs: 15 * MIN }); hi(e, 0);
  const ev = e.shelve('TIC201.PVHI', { durationMs: 5 * 60 * MIN, t: 0 });
  assert.equal(ev[0].durationMs, 60 * MIN); assert.equal(e.get('TIC201.PVHI').until, 60 * MIN);
  e.unshelve('TIC201.PVHI', 1);
  e.shelve('TIC201.PVHI', { t: 1 });
  assert.equal(e.get('TIC201.PVHI').until, 1 + 15 * MIN);
});

test('T15 unshelve -> UNACK when still in alarm', () => {
  const e = mk(); hi(e, 1000); e.shelve('TIC201.PVHI', { t: 2000 });
  const ev = e.unshelve('TIC201.PVHI', 3000);
  assert.deepEqual(types(ev), ['UNSHELVE']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'UNACK'); assert.equal(r.until, 0); assert.equal(r.shelveReason, '');
});

test('T16 unshelve -> NORM when condition cleared while shelved (RTN kept it SHLVD)', () => {
  const e = mk(); hi(e, 1000); e.shelve('TIC201.PVHI', { t: 2000 });
  const ev = e.rtn('TIC201', 'PVHI', 2500);
  assert.deepEqual(types(ev), ['RTN']);
  assert.equal(e.get('TIC201.PVHI').state, 'SHLVD');
  e.unshelve('TIC201.PVHI', 3000);
  assert.equal(e.get('TIC201.PVHI').state, 'NORM');
});

test('T17 shelve expiry via tick auto-unshelves with auto:true', () => {
  const e = mk(); hi(e, 0); e.shelve('TIC201.PVHI', { durationMs: 10 * MIN, t: 0 });
  assert.deepEqual(e.tick(9 * MIN), []);
  const ev = e.tick(10 * MIN);
  assert.deepEqual(types(ev), ['UNSHELVE']);
  assert.equal(ev[0].auto, true);
  assert.equal(e.get('TIC201.PVHI').state, 'UNACK');
});

test('T18 suppress by design from UNACK -> DSUPR with trigger key; unsuppress -> UNACK', () => {
  const e = mk(); hi(e, 1000);
  const ev = e.suppress('TIC201.PVHI', 'P101.TRIP', 2000);
  assert.deepEqual(types(ev), ['SUPPRESS']);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.state, 'DSUPR'); assert.equal(r.suppressedBy, 'P101.TRIP'); assert.equal(r.ack, true);
  const ev2 = e.unsuppress('TIC201.PVHI', 3000);
  assert.deepEqual(types(ev2), ['UNSUPPRESS']);
  assert.equal(r.state, 'UNACK'); assert.equal(r.suppressedBy, '');
});

test('T19 unsuppress -> NORM when the condition cleared while suppressed', () => {
  const e = mk(); hi(e, 1000); e.suppress('TIC201.PVHI', 'X', 2000);
  e.rtn('TIC201', 'PVHI', 2500);
  assert.equal(e.get('TIC201.PVHI').state, 'DSUPR');
  e.unsuppress('TIC201.PVHI', 3000);
  assert.equal(e.get('TIC201.PVHI').state, 'NORM');
});

test('T20 out of service from any state -> OOSRV; rts -> UNACK if live', () => {
  const e = mk(); hi(e, 1000); e.ack('TIC201.PVHI', 1500);
  const ev = e.oos('TIC201.PVHI', 2000);
  assert.deepEqual(types(ev), ['OOS']);
  assert.equal(e.get('TIC201.PVHI').state, 'OOSRV');
  assert.deepEqual(e.shelve('TIC201.PVHI', { t: 2100 }), []);
  assert.deepEqual(e.oos('TIC201.PVHI', 2200), []);
  const ev2 = e.rts('TIC201.PVHI', 3000);
  assert.deepEqual(types(ev2), ['RTS']);
  assert.equal(e.get('TIC201.PVHI').state, 'UNACK');
});

test('T21 rts -> NORM when not live; raise while OOSRV stays OOSRV', () => {
  const e = mk(); hi(e, 1000); e.oos('TIC201.PVHI', 2000);
  e.rtn('TIC201', 'PVHI', 2500);
  assert.deepEqual(e.rts('TIC201.PVHI', 3000).map(x => x.to), ['NORM']);
  e.oos('TIC201.PVHI', 3100);
  assert.equal(e.get('TIC201.PVHI').state, 'OOSRV');
  hi(e, 3200);
  assert.equal(e.get('TIC201.PVHI').state, 'OOSRV');
  assert.equal(e.get('TIC201.PVHI').active, true);
});

test('T22 ackAll acknowledges UNACK and RTNUN only', () => {
  const e = mk();
  hi(e, 1); e.raise({ tag: 'LIC101', cond: 'PVLO', prio: 'Low', t: 2 }); e.raise({ tag: 'PIC401', cond: 'PVHH', prio: 'Urgent', t: 3 });
  e.rtn('LIC101', 'PVLO', 4); e.shelve('PIC401.PVHH', { t: 5 });
  const ev = e.ackAll(6);
  assert.equal(ev.length, 2);
  assert.equal(e.get('TIC201.PVHI').state, 'ACKED');
  assert.equal(e.get('LIC101.PVLO').state, 'NORM');
  assert.equal(e.get('PIC401.PVHH').state, 'SHLVD');
});

test('T23 Journal alarms are events only by default', () => {
  const e = mk();
  const ev = e.raise({ tag: 'FI100', cond: 'PVHI', prio: 'Journal', val: 1, t: 1 });
  assert.equal(ev.length, 1); assert.equal(ev[0].journal, true); assert.equal(ev[0].type, 'ALARM');
  assert.equal(e.all().length, 0);
  assert.equal(e.topUnack(), null);
});

test('T24 Journal alarms recorded when recordJournal, but never annunciate', () => {
  const e = mk({ recordJournal: true });
  e.raise({ tag: 'FI100', cond: 'PVHI', prio: 'Journal', val: 1, t: 1 });
  const r = e.get('FI100.PVHI');
  assert.equal(r.state, 'UNACK');
  assert.equal(AE.annunciates(r), false);
  assert.equal(e.topUnack(), null);
  assert.equal(AE.indication('UNACK', 'Journal').audible, false);
});

test('T25 unknown priority falls back to Low; subprio clamps to 0..15', () => {
  const e = mk();
  e.raise({ tag: 'A', cond: 'X', prio: 'Weird', subprio: 99, t: 1 });
  e.raise({ tag: 'B', cond: 'X', prio: 'High', subprio: -4, t: 1 });
  assert.equal(e.get('A.X').prio, 'Low'); assert.equal(e.get('A.X').subprio, 15);
  assert.equal(e.get('B.X').subprio, 0);
});

test('T26 unshelve / unsuppress / rts on wrong state are no-ops', () => {
  const e = mk(); hi(e, 1);
  assert.deepEqual(e.unshelve('TIC201.PVHI', 2), []);
  assert.deepEqual(e.unsuppress('TIC201.PVHI', 2), []);
  assert.deepEqual(e.rts('TIC201.PVHI', 2), []);
});

test('T27 comment is stored on the record and survives transitions', () => {
  const e = mk(); hi(e, 1);
  assert.equal(e.comment('TIC201.PVHI', 'checked jacket flow'), true);
  e.ack('TIC201.PVHI', 2); e.rtn('TIC201', 'PVHI', 3);
  assert.equal(e.get('TIC201.PVHI').comment, 'checked jacket flow');
  assert.equal(e.comment('nope', 'x'), false);
});

test('T28 events carry the record identity and both endpoint states', () => {
  const e = mk(); const ev = hi(e, 7);
  const x = ev[0];
  assert.equal(x.key, 'TIC201.PVHI'); assert.equal(x.tag, 'TIC201'); assert.equal(x.cond, 'PVHI');
  assert.equal(x.prio, 'High'); assert.equal(x.subprio, 5); assert.equal(x.t, 7);
  assert.equal(x.val, 170); assert.equal(x.eu, 'degC'); assert.equal(x.desc, 'Reactor temp');
  assert.equal(x.id, e.get('TIC201.PVHI').id);
});

// ---- repeat folding ----------------------------------------------------------

test('fold: re-raise within window after RTN+ack folds (count 2, first t kept)', () => {
  const e = mk(); hi(e, 0); e.ack('TIC201.PVHI', 1); e.rtn('TIC201', 'PVHI', 2 * MIN);
  const ev = hi(e, 5 * MIN);
  assert.equal(ev[0].folded, true);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.count, 2); assert.equal(r.t, 0); assert.equal(r.lastT, 5 * MIN); assert.equal(r.state, 'UNACK');
  assert.equal(e.all().length, 1);
});

test('fold: re-raise outside window starts a fresh occurrence', () => {
  const e = mk({ foldWindowMs: 10 * MIN }); hi(e, 0); e.ack('TIC201.PVHI', 1); e.rtn('TIC201', 'PVHI', 2 * MIN);
  const ev = hi(e, 13 * MIN);
  assert.equal(ev[0].folded, undefined);
  const r = e.get('TIC201.PVHI');
  assert.equal(r.count, 1); assert.equal(r.t, 13 * MIN);
});

test('fold: tick prunes NORM records once the fold window has passed', () => {
  const e = mk(); hi(e, 0); e.ack('TIC201.PVHI', 1); e.rtn('TIC201', 'PVHI', 2 * MIN);
  e.tick(11 * MIN); assert.equal(e.all().length, 1);
  e.tick(12 * MIN + 1); assert.equal(e.all().length, 0);
  hi(e, 13 * MIN); assert.equal(e.get('TIC201.PVHI').count, 1);
});

// ---- Dynamic Alarm Suppression ------------------------------------------------

test('DAS: active trigger suppresses listed alarms already active and those raised later', () => {
  const e = mk({ dasRules: { 'P101.TRIP': ['FIC102.PVLO', 'LIC101.PVHI'] } });
  e.raise({ tag: 'FIC102', cond: 'PVLO', prio: 'High', t: 1 });
  const ev = e.raise({ tag: 'P101', cond: 'TRIP', prio: 'Urgent', t: 2 });
  assert.deepEqual(types(ev), ['ALARM', 'SUPPRESS']);
  assert.equal(e.get('FIC102.PVLO').state, 'DSUPR'); assert.equal(e.get('FIC102.PVLO').suppressedBy, 'P101.TRIP');
  const ev2 = e.raise({ tag: 'LIC101', cond: 'PVHI', prio: 'Low', t: 3 });
  assert.deepEqual(types(ev2), ['ALARM', 'SUPPRESS']);
  assert.equal(e.get('LIC101.PVHI').state, 'DSUPR');
  assert.equal(e.unacked().length, 1);
  const dv = e.dasView();
  assert.equal(dv[0].trigger, 'P101.TRIP'); assert.equal(dv[0].active, true);
  assert.deepEqual(dv[0].suppressedKeys.sort(), ['FIC102.PVLO', 'LIC101.PVHI']);
});

test('DAS: trigger RTN releases follow-on alarms to UNACK or NORM per live state', () => {
  const e = mk({ dasRules: { 'P101.TRIP': ['FIC102.PVLO', 'LIC101.PVHI'] } });
  e.raise({ tag: 'P101', cond: 'TRIP', prio: 'Urgent', t: 1 });
  e.raise({ tag: 'FIC102', cond: 'PVLO', prio: 'High', t: 2 });
  e.raise({ tag: 'LIC101', cond: 'PVHI', prio: 'Low', t: 3 });
  e.rtn('LIC101', 'PVHI', 4);
  const ev = e.rtn('P101', 'TRIP', 5);
  assert.deepEqual(types(ev), ['RTN', 'UNSUPPRESS', 'UNSUPPRESS']);
  assert.equal(e.get('FIC102.PVLO').state, 'UNACK');
  assert.equal(e.get('LIC101.PVHI').state, 'NORM');
  assert.equal(e.dasView()[0].suppressedKeys.length, 0);
});

test('DAS: unshelve while trigger active lands in DSUPR', () => {
  const e = mk({ dasRules: { 'P101.TRIP': ['FIC102.PVLO'] } });
  e.raise({ tag: 'FIC102', cond: 'PVLO', prio: 'High', t: 1 });
  e.shelve('FIC102.PVLO', { t: 2 });
  e.raise({ tag: 'P101', cond: 'TRIP', prio: 'Urgent', t: 3 });
  assert.equal(e.get('FIC102.PVLO').state, 'SHLVD');
  const ev = e.unshelve('FIC102.PVLO', 4);
  assert.deepEqual(types(ev), ['UNSHELVE', 'SUPPRESS']);
  assert.equal(e.get('FIC102.PVLO').state, 'DSUPR');
});

// ---- sort order and queries ---------------------------------------------------

test('sort: Urgent > High > Low > Journal, then subprio desc, then time desc', () => {
  const e = mk({ recordJournal: true });
  e.raise({ tag: 'A', cond: 'X', prio: 'Low', subprio: 15, t: 9 });
  e.raise({ tag: 'B', cond: 'X', prio: 'High', subprio: 2, t: 1 });
  e.raise({ tag: 'C', cond: 'X', prio: 'High', subprio: 2, t: 5 });
  e.raise({ tag: 'D', cond: 'X', prio: 'Urgent', subprio: 0, t: 2 });
  e.raise({ tag: 'E', cond: 'X', prio: 'High', subprio: 7, t: 1 });
  e.raise({ tag: 'F', cond: 'X', prio: 'Journal', subprio: 15, t: 99 });
  const order = e.list().sort(AE.compare).map(r => r.tag);
  assert.deepEqual(order, ['D', 'E', 'C', 'B', 'A', 'F']);
  assert.equal(e.topUnack().tag, 'D');
  e.ack('D.X', 10);
  assert.equal(e.topUnack().tag, 'E');
});

test('queries: active/unacked/shelved/suppressed/oos/byUnit/counts', () => {
  const e = mk();
  e.raise({ tag: 'TIC201', cond: 'PVHI', prio: 'High', t: 1 });
  e.raise({ tag: 'LIC101', cond: 'PVLO', prio: 'Low', t: 2 });
  e.raise({ tag: 'PIC401', cond: 'PVHH', prio: 'Urgent', t: 3 });
  e.raise({ tag: 'TIC212', cond: 'PVHI', prio: 'High', t: 4 });
  e.raise({ tag: 'TIC311', cond: 'PVHI', prio: 'High', t: 5 });
  e.ack('TIC201.PVHI', 6);
  e.shelve('LIC101.PVLO', { t: 7 });
  e.suppress('TIC212.PVHI', 'MANUAL', 8);
  e.oos('TIC311.PVHI', 9);
  assert.equal(e.active().length, 5);
  assert.deepEqual(e.unacked().map(r => r.tag), ['PIC401']);
  assert.deepEqual(e.shelved().map(r => r.tag), ['LIC101']);
  assert.deepEqual(e.suppressed().map(r => r.tag), ['TIC212']);
  assert.deepEqual(e.oos().map(r => r.tag), ['TIC311']);
  assert.deepEqual(e.byUnit(tag => /^(TIC2|LIC1|PIC4)/.test(tag)).map(r => r.tag).sort(), ['LIC101', 'PIC401', 'TIC201', 'TIC212']);
  const c = e.counts();
  assert.deepEqual(c, { Urgent: 1, High: 1, Low: 0, Journal: 0, total: 2, unack: 1 });
});

// ---- indication table ------------------------------------------------------------

test('indication: Siemens per-state table', () => {
  assert.deepEqual(AE.indication('UNACK'), { blink: true, audible: true, steady: false, inverse: false });
  assert.deepEqual(AE.indication('RTNUN'), { blink: true, audible: false, steady: false, inverse: true });
  assert.deepEqual(AE.indication('ACKED'), { blink: false, audible: false, steady: true, inverse: false });
  for (const s of ['SHLVD', 'DSUPR', 'OOSRV', 'NORM']) {
    assert.deepEqual(AE.indication(s), { blink: false, audible: false, steady: false, inverse: false }, s);
  }
  assert.deepEqual(AE.STATES, ['NORM', 'UNACK', 'ACKED', 'RTNUN', 'SHLVD', 'DSUPR', 'OOSRV']);
});

// ---- evaluateLimit ---------------------------------------------------------------

test('evaluateLimit: HI deadband hysteresis', () => {
  let m;
  ({ memo: m } = AE.evaluateLimit({ pv: 99, trip: 100, kind: 'HI', deadband: 5, dt: 0.5 }));
  assert.equal(m.active, false);
  let r = AE.evaluateLimit({ pv: 100, trip: 100, kind: 'HI', deadband: 5, dt: 0.5, memo: m });
  assert.equal(r.active, true);
  r = AE.evaluateLimit({ pv: 96, trip: 100, kind: 'HI', deadband: 5, dt: 0.5, memo: m });
  assert.equal(r.active, true, 'inside deadband stays active');
  r = AE.evaluateLimit({ pv: 94.9, trip: 100, kind: 'HI', deadband: 5, dt: 0.5, memo: m });
  assert.equal(r.active, false);
});

test('evaluateLimit: LO deadband hysteresis', () => {
  const m = { raw: false, active: false, onT: 0, offT: 0 };
  assert.equal(AE.evaluateLimit({ pv: 10, trip: 10, kind: 'LO', deadband: 2, dt: 1, memo: m }).active, true);
  assert.equal(AE.evaluateLimit({ pv: 11.5, trip: 10, kind: 'LO', deadband: 2, dt: 1, memo: m }).active, true);
  assert.equal(AE.evaluateLimit({ pv: 12.1, trip: 10, kind: 'LO', deadband: 2, dt: 1, memo: m }).active, false);
});

test('evaluateLimit: on-delay requires the condition to persist', () => {
  const m = { raw: false, active: false, onT: 0, offT: 0 };
  const step = pv => AE.evaluateLimit({ pv, trip: 100, kind: 'HI', deadband: 1, onDelaySec: 15, dt: 5, memo: m }).active;
  assert.equal(step(101), false); assert.equal(step(101), false);
  assert.equal(step(98), false, 'blip resets the on timer');
  assert.equal(step(101), false); assert.equal(step(101), false);
  assert.equal(step(101), true, 'active after 15 s continuous');
});

test('evaluateLimit: off-delay holds the alarm through a short dip', () => {
  const m = { raw: false, active: false, onT: 0, offT: 0 };
  const step = pv => AE.evaluateLimit({ pv, trip: 100, kind: 'HI', deadband: 0, offDelaySec: 10, dt: 4, memo: m }).active;
  assert.equal(step(101), true);
  assert.equal(step(90), true); assert.equal(step(90), true);
  assert.equal(step(101), true, 'dip shorter than off-delay keeps active');
  assert.equal(step(90), true); assert.equal(step(90), true);
  assert.equal(step(90), false, 'clears after 10 s below');
});

// ---- integration-style scenario and performance guard -----------------------------

test('scenario: scan loop drives raise/rtn through evaluateLimit with events logged', () => {
  const e = mk();
  const memo = {};
  const log = [];
  const pvs = [90, 101, 102, 103, 99.8, 99.2, 98, 90, 90];
  for (let i = 0; i < pvs.length; i++) {
    const { active } = AE.evaluateLimit({ pv: pvs[i], trip: 100, kind: 'HI', deadband: 1, dt: 0.5, memo });
    const t = i * 500;
    const r = e.get('LIC101.PVHI');
    if (active && !(r && r.active)) log.push(...e.raise({ tag: 'LIC101', cond: 'PVHI', prio: 'High', val: pvs[i], eu: '%', t }));
    if (!active && r && r.active) log.push(...e.rtn('LIC101', 'PVHI', t, pvs[i]));
    log.push(...e.tick(t));
  }
  assert.deepEqual(types(log), ['ALARM', 'RTN']);
  assert.equal(log[1].t, 3000);
  assert.equal(e.get('LIC101.PVHI').state, 'RTNUN');
});

test('performance: 500 records, 200 mixed operations plus list/sort in well under a second', () => {
  const e = mk();
  for (let i = 0; i < 500; i++) e.raise({ tag: 'T' + i, cond: 'PVHI', prio: ['Urgent', 'High', 'Low'][i % 3], subprio: i % 16, t: i });
  const t0 = Date.now();
  for (let k = 0; k < 200; k++) {
    e.ack('T' + (k * 7 % 500) + '.PVHI', 1000 + k);
    e.rtn('T' + (k * 3 % 500), 'PVHI', 2000 + k);
    e.tick(3000 + k);
    e.list().sort(AE.compare); e.counts(); e.topUnack();
  }
  assert.ok(Date.now() - t0 < 1000);
});
