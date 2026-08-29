// App-level tests for step B1: the ISA-18.2 engine wired into the Component.
// Behaviour under test follows alerta isa_18_2.py (RESOURCES 2.5), loxalarm
// delay semantics (2.9), the Siemens indication / delay examples (2.6) and the
// Experion LX two-events-per-alarm and sub-priority conventions (2.1, 2.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');

const { Component } = load();
const MIN = 60000;

function boot(sec) {
  const c = new Component({});
  c.initSim();
  if (sec) c.setState({ sec });
  return c;
}
const rec = (c, key) => c.alarmEngine.get(key);
const evDesc = (c, src) => c.events.filter(e => e.src === src).map(e => e.desc).reverse();
function hold(c, fn, seconds) { for (let i = 0; i < seconds * 2; i++) { fn(); c.scan(0.5); c.P.t += 500; } }

test('raise -> ack -> RTN removes the alarm from the summary', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  assert.equal(rec(c, 'TIC201.PVHI').state, 'UNACK');
  assert.equal(c.state.silenced, false, 'horn re-armed on a new UNACK alarm');
  c.ackAlarm(rec(c, 'TIC201.PVHI'));
  assert.equal(rec(c, 'TIC201.PVHI').state, 'ACKED');
  c.clearA('TIC201', 'PVHI', 150);
  assert.equal(c.alarms.length, 0);
  assert.equal(c.alarmEngine.counts().total, 0);
});

test('RTN before ack -> RTNUN stays visible, ack -> gone', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  c.clearA('TIC201', 'PVHI', 150);
  const r = rec(c, 'TIC201.PVHI');
  assert.equal(r.state, 'RTNUN');
  assert.equal(r.active, false); assert.equal(r.ack, false);
  assert.equal(c.visAlarms().length, 1, 'RTNUN row remains in the MAIN view');
  assert.deepEqual(c.alarmEngine.indication(r.state, r.prio), { blink: true, audible: false, steady: false, inverse: true });
  assert.equal(c.hornTop(), null, 'RTNUN never sounds the horn');
  c.ackAlarm(r);
  assert.equal(c.alarms.length, 0);
});

test('on-delay: a 5 s excursion on a flow loop does not alarm, a sustained one does after 15 s', () => {
  const c = boot();
  const f = c.L.FIC102;                                     // flow loop -> 15 s default on-delay
  assert.equal(c.almDelay(f), 15);
  hold(c, () => { f.pv = 10; }, 5);                         // below PVLO 15 for 5 s
  hold(c, () => { f.pv = 60; }, 5);
  assert.equal(rec(c, 'FIC102.PVLO'), undefined, 'short excursion suppressed');
  hold(c, () => { f.pv = 10; }, 14.5);
  assert.equal(rec(c, 'FIC102.PVLO'), undefined, 'not yet at the delay');
  hold(c, () => { f.pv = 10; }, 1);
  assert.equal(rec(c, 'FIC102.PVLO').state, 'UNACK');
  const l = c.L.TIC201; l.almDelay = 3;                     // per-point override
  hold(c, () => { l.pv = 170; }, 2.5);
  assert.equal(rec(c, 'TIC201.PVHI'), undefined);
  hold(c, () => { l.pv = 170; }, 1);
  assert.equal(rec(c, 'TIC201.PVHI').state, 'UNACK');
});

test('deadband prevents chatter around the trip point', () => {
  const c = boot();
  const l = c.L.TIC201;                                     // span 200 -> 2 DEG C deadband, no delay
  assert.equal(c.almDelay(l), 0);
  hold(c, () => { l.pv = 165; }, 0.5);
  assert.equal(rec(c, 'TIC201.PVHI').state, 'UNACK');
  for (let i = 0; i < 20; i++) { l.pv = i % 2 ? 164.2 : 165.3; c.scan(0.5); }
  assert.equal(rec(c, 'TIC201.PVHI').count, 1, 'no re-alarm inside the deadband');
  assert.equal(evDesc(c, 'TIC201').filter(d => /ALARM/.test(d)).length, 1);
  hold(c, () => { l.pv = 162.5; }, 0.5);                    // 165 - 2 = 163 -> clear below it
  assert.equal(rec(c, 'TIC201.PVHI').state, 'RTNUN');
  l.almDb = 10; hold(c, () => { l.pv = 165; }, 0.5); hold(c, () => { l.pv = 156; }, 0.5);
  assert.equal(rec(c, 'TIC201.PVHI').active, true, 'per-point deadband override honoured');
});

test('shelve requires a reason, caps at 60 min, auto-unshelves and re-annunciates', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  const r = rec(c, 'TIC201.PVHI');
  c.setState({ selAlm: r.id, dlg: { type: 'shelve' }, dlgReason: '' });
  c.shelve(15);
  assert.equal(r.state, 'UNACK', 'no reason -> refused');
  assert.match(c.state.msg, /REASON REQUIRED/);
  c.setState({ dlg: { type: 'shelve', reasonSel: 'OTHER' }, dlgReason: '' });
  c.shelve(15);
  assert.equal(r.state, 'UNACK', 'OTHER without detail -> refused');
  c.setState({ dlg: { type: 'shelve', reasonSel: 'MAINTENANCE IN PROGRESS' }, dlgReason: 'washdown' });
  c.setState({ silenced: true });
  c.shelve(90);
  assert.equal(r.state, 'SHLVD');
  assert.equal(r.shelveReason, 'MAINTENANCE IN PROGRESS — washdown');
  assert.equal(r.until - c.P.t, 60 * MIN, 'capped at 60 min');
  assert.equal(c.state.dlg, null);
  assert.equal(c.visAlarms().length, 0, 'gone from the MAIN view');
  c.setState({ shelfView: 'SHELVED' });
  assert.equal(c.visAlarms()[0].key, 'TIC201.PVHI');
  assert.equal(c.hornTop(), null);
  assert.equal(c.alarmEngine.counts().total, 0, 'shelved alarms are not counted as active');
  c.P.t += 61 * MIN; c.alarmTick();
  assert.equal(r.state, 'UNACK', 're-annunciated while the condition is still present');
  assert.equal(c.state.silenced, false, 'horn re-armed');
  assert.ok(evDesc(c, 'TIC201').some(d => /SHELVE PERIOD EXPIRED — ALARM RE-ANNUNCIATED/.test(d)));
  assert.ok(c.msgs.some(m => /ALARM SHELVED 60 MIN: TIC201 PVHI/.test(m.txt)));
});

test('DAS: a pump trip suppresses its consequential alarms and releases them when it clears', () => {
  const c = boot();
  c.raiseA('FIC102', 'PVLO', 'Low', 10, 'M3/H', 'Feed flow');
  c.tripMotor('P101', 'UNCOMMANDED STOP');
  c.scan(0.5);
  assert.equal(rec(c, 'P101.TRIP').state, 'UNACK');
  const f = rec(c, 'FIC102.PVLO');
  assert.equal(f.state, 'DSUPR'); assert.equal(f.suppressedBy, 'P101.TRIP');
  c.raiseA('LIC101', 'PVHI', 'High', 82, '%', 'Tank level');
  assert.equal(rec(c, 'LIC101.PVHI').state, 'DSUPR', 'new follow-on alarm born suppressed');
  assert.equal(c.alarmEngine.counts().total, 1, 'only the trigger is an active alarm');
  c.setState({ shelfView: 'SUPPRESSED' });
  assert.deepEqual(c.visAlarms().map(a => a.key).sort(), ['FIC102.PVLO', 'LIC101.PVHI']);
  assert.ok(evDesc(c, 'FIC102').some(d => /SUPPRESSED BY P101.TRIP/.test(d)));
  c.L.P101.trip = false; c.L.P101.run = true; c.scan(0.5);
  assert.equal(f.state, 'UNACK', 'released to UNACK because the condition is still live');
  assert.equal(rec(c, 'LIC101.PVHI').state, 'UNACK');
  assert.ok(evDesc(c, 'FIC102').some(d => /SUPPRESSION RELEASED/.test(d)));
});

test('out of service: ENGR gate, never annunciates, return to service re-annunciates if still active', () => {
  const c = boot('OPER');
  c.setOos('TIC201', 'PVHI', true);
  assert.equal(c.isOos('TIC201', 'PVHI'), false, 'OPER cannot take a condition out of service');
  c.setState({ sec: 'ENGR' });
  c.setOos('TIC201', 'PVHI', true);
  assert.equal(c.isOos('TIC201', 'PVHI'), true);
  hold(c, () => { c.L.TIC201.pv = 172; }, 2);
  const r = rec(c, 'TIC201.PVHI');
  assert.equal(r.state, 'OOSRV'); assert.equal(r.active, true);
  assert.equal(c.alarmEngine.counts().unack, 0);
  assert.equal(c.hornTop(), null);
  assert.equal(evDesc(c, 'TIC201').filter(d => /ALARM HIGH/.test(d)).length, 0, 'no ALARM journal entry while OOS');
  const v = c.renderVals();
  assert.equal(v.cOos, 1);
  c.setState({ shelfView: 'OOS' });
  assert.equal(c.visAlarms()[0].state, 'OOSRV');
  c.setOos('TIC201', 'PVHI', false);
  assert.equal(r.state, 'UNACK', 'returned to service with the condition present -> annunciates');
  assert.ok(evDesc(c, 'TIC201').some(d => /RETURNED TO SERVICE — ALARM ANNUNCIATED/.test(d)));
});

test('journal: two events per alarm (entry with priority and sub-priority, return to normal) plus ACK', () => {
  const c = boot();
  hold(c, () => { c.L.TIC201.pv = 176; }, 0.5);             // PVHI 165 and PVHH 175 together
  hold(c, () => { c.L.TIC201.pv = 150; }, 0.5);
  const d = evDesc(c, 'TIC201');
  assert.deepEqual(d.filter(x => /PVHI/.test(x)), ['PVHI ALARM HIGH 8', 'PVHI RETURN TO NORMAL']);
  assert.deepEqual(d.filter(x => /PVHH/.test(x)), ['PVHH ALARM URGENT 12', 'PVHH RETURN TO NORMAL']);
  assert.ok(c.events.filter(e => e.src === 'TIC201').every(e => e.type === 'ALARM'));
  c.ackPage();
  assert.ok(evDesc(c, 'TIC201').includes('PVHI ACKNOWLEDGED'));
  assert.ok(evDesc(c, 'STN01').some(x => /PAGE ACKNOWLEDGE \(2 ALARMS\)/.test(x)));
  assert.equal(c.alarms.length, 0);
});

test('Alarm Summary rows carry the state column and priority with sub-priority, sorted by the engine comparator', () => {
  const c = boot();
  c.raiseA('TIC202', 'PVLO', 'Low', 15, 'DEG C', 'Jacket');
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  c.raiseA('TIC201', 'PVHH', 'Urgent', 176, 'DEG C', 'Reactor temp');
  c.ackAlarm(rec(c, 'TIC201.PVHI'));
  c.setState({ display: 'alarms' });
  const v = c.renderVals();
  assert.deepEqual(v.av.rows.map(r => [r.cond, r.prio, r.state]), [['PVHH', 'URGENT 12', 'UNACK'], ['PVHI', 'HIGH 8', 'ACKED'], ['PVLO', 'LOW 8', 'UNACK']]);
  assert.equal(v.av.rows[1].ackT, 'ACK');
  assert.equal(v.cU, 1); assert.equal(v.cH, 1); assert.equal(v.cL, 1); assert.equal(v.cUn, 2);
  assert.match(v.al.txt, /TIC201 {3}PVHH {3}URGENT 12 {3}UNACK/);
  assert.deepEqual(v.av.filters.map(f => f.label), ['ALL', 'UNACK', 'SHELVED', 'SUPPRESSED', 'OOS']);
});

test('every display and dialog renders after an upset without throwing', () => {
  const c = boot('ENGR');
  c.injectFault('cool', true);
  for (let i = 0; i < 1200; i++) c.step(0.5);
  assert.ok(c.alarms.length > 0);
  c.setState({ selAlm: c.alarms[0].id, sel: 'TIC201', fps: [{ tag: 'TIC201', x: 10, y: 10, pin: false }, { tag: 'P101', x: 10, y: 10, pin: false }] });
  for (const display of ['graphic', 'alarms', 'events', 'msgs', 'trend', 'detail', 'sys']) {
    c.setState({ display, detailTab: 'alarms' });
    assert.doesNotThrow(() => c.renderVals(), display);
  }
  for (const type of ['logon', 'shelve', 'drills', 'instr', 'help', 'about', 'reset', 'sysmenu']) {
    c.setState({ dlg: { type } });
    const v = c.renderVals();
    assert.equal(v.dg.open, true, type);
  }
  c.setState({ display: 'detail', detailTag: 'TIC201', dlg: null });
  const row = c.renderVals().dpt.almRows.find(r => r.cond === 'PVHH');
  assert.ok(['UNACK', 'ACKED', 'RTNUN', 'DSUPR', 'ACTIVE', 'NORMAL'].includes(row.state));
  assert.equal(row.oosT, 'OOS');
  assert.equal(row.prio, 'URGENT 12');
});
