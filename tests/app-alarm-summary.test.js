// @artifact dev
// App-level tests for step B2: Alarm Summary parity (asset pane, trip/live
// columns, repeat folding, comments, saved views), Alarm Help and the KPI
// display. Feature list per the Experion Alarming PIN (RESOURCES 2.2),
// rationalisation fields per PAS (2.10), KPI thresholds per exida and
// alarm-performance-analyser (2.7, 2.8).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const AlarmHelp = require('../src/alarm-help.js');

const { Component } = load();

function boot(sec) {
  const c = new Component({});
  c.initSim();
  if (sec) c.setState({ sec });
  return c;
}
const rec = (c, key) => c.alarmEngine.get(key);
const advance = (c, ms) => { c.P.t += ms; };

test('asset pane filters the visible rows and counts update live', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  c.raiseA('TIC212', 'PVHI', 'High', 96, 'DEG C', 'Batch temp');
  c.raiseA('R-310', 'HI TEMP TRIP', 'Urgent', 481, 'DEG C', 'Bed trip');
  assert.equal(c.visAlarms().length, 3, 'PLANT shows everything');
  c.setState({ almAsset: 'U2' });
  assert.deepEqual(c.visAlarms().map(a => a.tag), ['TIC212']);
  c.setState({ almAsset: 'R-310' });
  assert.deepEqual(c.visAlarms().map(a => a.tag), ['R-310'], 'equipment node catches the equipment trip source');
  c.setState({ almAsset: 'R-201' });
  assert.deepEqual(c.visAlarms().map(a => a.tag), ['TIC201']);
  let counts = c.assetCounts();
  assert.equal(counts.PLANT.active, 3); assert.equal(counts.PLANT.unack, 3);
  assert.equal(counts.U1.active, 1); assert.equal(counts.U3.unack, 1); assert.equal(counts['TK-101'].active, 0);
  c.ackAlarm(rec(c, 'TIC201.PVHI'));
  counts = c.assetCounts();
  assert.equal(counts.U1.active, 1, 'acked alarm is still active');
  assert.equal(counts.U1.unack, 0, 'unack count drops after ack');
  // ACK PAGE acts on the visible rows only
  c.setState({ almAsset: 'U2' });
  c.ackPage();
  assert.equal(rec(c, 'TIC212.PVHI').ack, true);
  assert.equal(rec(c, 'R-310.HI TEMP TRIP').ack, false, 'alarm outside the filtered page is untouched');
  const v = c.renderVals();
  const tree = v.av.tree.map(n => n.label);
  assert.ok(tree[0] === 'PLANT' && tree.some(l => /R-202/.test(l)) && tree.some(l => /H-310/.test(l)));
  assert.equal(v.av.tree.find(n => /UNIT 02/.test(n.label)).unack, 0);
  assert.equal(v.av.tree.find(n => /UNIT 03/.test(n.label)).unack, 1);
});

test('trip value and live value columns come from the point and the process', () => {
  const c = boot();
  c.L.TIC201.pv = 171.4;
  c.raiseA('TIC201', 'PVHI', 'High', 171.4, 'DEG C', 'Reactor temp');
  c.P.h.bed = 483;
  c.raiseA('R-310', 'HI TEMP TRIP', 'Urgent', 483, 'DEG C', 'Bed trip');
  let rows = c.renderVals().av.rows;
  const r1 = rows.find(r => r.tag === 'TIC201');
  assert.equal(r1.trip, '165.0');
  assert.equal(r1.live, '171.4');
  c.L.TIC201.pv = 168.2;                                   // live value follows the PV, not the value at raise
  rows = c.renderVals().av.rows;
  assert.equal(rows.find(r => r.tag === 'TIC201').live, '168.2');
  const r2 = rows.find(r => r.tag === 'R-310');
  assert.equal(r2.trip, '480');
  assert.equal(r2.live, '483');
  assert.equal(rec(c, 'R-310.HI TEMP TRIP').tripValue, 480, 'equipment trip value resolved from the help table');
});

test('repeat folding shows a count above 1 after chatter and the KPI log records each raise', () => {
  const c = boot();
  for (let i = 0; i < 3; i++) {
    c.raiseA('FIC102', 'PVLO', 'Low', 12, 'M3/H', 'Feed flow');
    advance(c, 5000);
    c.clearA('FIC102', 'PVLO', 20);
    advance(c, 5000);
  }
  const r = rec(c, 'FIC102.PVLO');
  assert.equal(r.count, 3);
  const row = c.renderVals().av.rows.find(x => x.tag === 'FIC102');
  assert.equal(row.cnt, '3');
  assert.equal(c.alarmLog.filter(e => e.type === 'raise' && e.key === 'FIC102.PVLO').length, 3);
  assert.equal(c.kpiMetrics(0).chattering.length, 1, 'three raises inside 60 s is a chattering alarm');
});

test('alarm comment persists on the record, marks the row and logs an event (OPER+)', () => {
  const c = boot();
  c.raiseA('LIC401', 'PVHI', 'High', 78, '%', 'Drum level');
  const r = rec(c, 'LIC401.PVHI');
  c.setState({ selAlm: r.id, sec: 'VIEW' });
  c.commentAlarm('should not store');
  assert.equal(r.comment, '', 'VIEW cannot comment');
  c.setState({ sec: 'OPER' });
  c.commentAlarm('   ');
  assert.equal(r.comment, '', 'blank comment refused');
  c.openComment();
  assert.equal(c.state.dlg.type, 'comment');
  c.commentAlarm('LV-401 stroked by hand, maintenance called');
  assert.equal(r.comment, 'LV-401 stroked by hand, maintenance called');
  assert.equal(c.state.dlg, null);
  const ev = c.events.find(e => e.type === 'OPERATOR' && e.src === 'LIC401' && /COMMENT/.test(e.desc));
  assert.ok(ev, 'operator event journaled');
  assert.equal(ev.newV, r.comment);
  const v = c.renderVals();
  assert.equal(v.av.rows[0].cmt, 'C');
  assert.match(v.av.selInfo, /maintenance called/);
  c.ackAlarm(r);
  assert.equal(rec(c, 'LIC401.PVHI').comment, r.comment, 'comment survives acknowledge');
});

test('saved views apply a location and filter together', () => {
  const c = boot();
  c.setState({ almAsset: 'R-201', shelfView: 'UNACK' });
  c.saveView();
  assert.equal(c.state.savedViews.length, 1);
  assert.equal(c.state.savedViews[0].name, 'R-201 UNACK');
  c.saveView();
  assert.equal(c.state.savedViews.length, 1, 'duplicate names are refused');
  c.setState({ almAsset: 'PLANT', shelfView: 'MAIN', display: 'graphic' });
  const v = c.renderVals();
  const views = v.av.views.map(x => x.label);
  assert.deepEqual(views.slice(0, 4), ['U1 ALL', 'U2 ALL', 'U3 ALL', 'U4 ALL']);
  v.av.views[4].cb();
  assert.equal(c.state.almAsset, 'R-201');
  assert.equal(c.state.shelfView, 'UNACK');
  assert.equal(c.state.display, 'alarms');
});

test('KPI display renders with a synthetic flood and reports it', () => {
  const c = boot();
  const keys = [['LIC101', 'PVHI', 'High'], ['FIC102', 'PVLO', 'Low'], ['TIC201', 'PVHI', 'High'], ['TIC202', 'PVHI', 'High'], ['TIC301', 'PVHI', 'High'], ['LIC401', 'PVHI', 'High'],
    ['PIC401', 'PVHI', 'High'], ['TIC212', 'PVHI', 'High'], ['PI214', 'PVHI', 'High'], ['TIC311', 'PVHI', 'High'], ['TI312', 'PVHI', 'High'], ['FIC313', 'PVLO', 'Low']];
  for (const [tag, cond, prio] of keys) { c.raiseA(tag, cond, prio, c.L[tag].pv, c.L[tag].eu, c.L[tag].desc); advance(c, 4000); }
  const m = c.kpiMetrics(30);
  assert.equal(m.total, 12);
  assert.ok(m.floods.length >= 1, 'flood detected');
  assert.ok(m.floodPct > 0);
  assert.equal(m.health.verdict, 'OVERLOADED');
  c.setState({ cmd: 'KPI' }); c.parseCmd();
  assert.equal(c.state.display, 'kpi');
  const v = c.renderVals();
  assert.equal(v.isKpi, true);
  assert.match(v.kpi.verdict, /OVERLOADED/);
  assert.equal(v.kpi.tiles[0].value, '12');
  assert.ok(v.kpi.checks.find(x => /flood/i.test(x.label)).res === 'FAIL');
  assert.equal(v.kpi.actors.length, 10, 'top-10 bad actors');
  assert.match(v.kpi.lists[0].v, /\d\d:\d\d:\d\d/, 'flood period listed');
  assert.match(v.kpi.footer, /exida|ISA-18\.2/);
  assert.ok(v.menus.find(mn => mn.name === 'View').items.some(i => i.label === 'Alarm KPI'));
  assert.ok(v.tbtns.some(b => b.label === 'KPI'));
  const tracker = c.renderVals().av.tracker;
  assert.equal(tracker.length, 4);
  assert.ok(tracker.find(l => l.label === 'U1').bars.length >= 1, 'tracker shows the U1 cluster');
});

test('alarm help resolves for every condition of every point, and for every equipment and discrete alarm', () => {
  const c = boot();
  let n = 0;
  for (const tag in c.L) {
    for (const cond in c.L[tag].alm) {
      const h = c.alarmHelpFor(tag, cond);
      assert.equal(h.found, true, 'missing help for ' + tag + '.' + cond);
      assert.match(h.priority, new RegExp('^' + c.L[tag].alm[cond][1].toUpperCase() + ' \\d+$'));
      assert.match(h.setting, new RegExp(String(c.L[tag].alm[cond][0])), 'setting names the configured trip point');
      assert.ok(h.responseTime.length > 2, tag + '.' + cond + ' responseTime');
      for (const f of ['consequence', 'probableCause', 'correctiveAction']) assert.ok(h[f].length > 20, tag + '.' + cond + ' ' + f);
      n++;
    }
  }
  assert.ok(n >= 40, 'iterated ' + n + ' conditions');
  const extras = [['P101', 'TRIP'], ['M202', 'TRIP'], ['P101', 'CMDFAIL'], ['FIC102', 'BADPV'], ['TK-101', 'HIHI TRIP'], ['R-201', 'HI TEMP TRIP'], ['V-401', 'PSV LIFT'], ['R-202', 'HI TEMP TRIP'], ['R-310', 'HI TEMP TRIP']];
  for (const [tag, cond] of extras) {
    const h = c.alarmHelpFor(tag, cond);
    assert.equal(h.found, true, 'missing help for ' + tag + '.' + cond);
  }
  assert.match(c.alarmHelpFor('R-201', 'HI TEMP TRIP').setting, /185/);
  assert.equal(AlarmHelp.resolve('XX999', 'PVHI').found, false);
  // Point Detail > Alarms section and the summary pane both render the six fields
  c.setState({ display: 'detail', detailTag: 'TIC201', detailTab: 'alarms', detailAlmCond: 'DEVHI' });
  let v = c.renderVals();
  assert.deepEqual(v.dpt.help.fields.map(f => f.k), ['Priority', 'Setting', 'Response time', 'Consequence', 'Probable cause', 'Corrective action']);
  assert.match(v.dpt.help.fields[1].v, /15/);
  assert.equal(v.dpt.helpConds.length, 5);
  c.raiseA('TIC201', 'DEVHI', 'High', 18, 'DEG C', 'Reactor temp');
  c.setState({ display: 'alarms', selAlm: rec(c, 'TIC201.DEVHI').id, almHelp: true });
  v = c.renderVals();
  assert.equal(v.av.helpOn, true);
  assert.match(v.av.help.title, /TIC201 DEVHI/);
  assert.equal(v.av.help.fields.length, 6);
});
