// @artifact dev
// App-level tests for step B6: standards-based drill scorer (ESS.Kpi, RESOURCES 2.7, 2.8),
// operator task coverage matrix and the 80 % independent pass mark (RESOURCES 2.12),
// Message Summary confirm, electronic signatures, disable-alarms-for-asset (2.12),
// and the management-of-change audit in the event journal (2.1, 2.13).
const test = require('node:test');
const assert = require('node:assert/strict');
const Training = require('../src/training.js');
const Kpi = require('../src/kpi.js');
const Models = require('../src/models.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();

function boot(sec) {
  const c = new Component({});
  c.initSim();
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds) { for (let i = 0; i < seconds * 2; i++) c.step(0.5); }
function sign(c, pw, reason) { c.setState({ dlgPw: pw, dlgReason: reason }); return c.signAction(); }
const cfgEvents = (c) => c.events.filter((e) => e.type === 'CONFIG');

test('scoring breakdown sums to the score, pass mark is 80 and labelled independent', () => {
  const c = boot('OPER');
  c.setState({ oper: 'AV' });
  run(c, 10);
  const d = c.drillDefs()[0];
  c.startDrill(d);
  run(c, 20);
  assert.equal(c.state.drill.injected, true);
  run(c, 20);
  const m = c.state.drill.m;
  assert.ok(m.tAlarm, 'the drill alarm annunciated');
  c.setState({ sec: 'OPER' });
  c.ackAlarm(c.alarmEngine.unacked().find((a) => a.tag === 'FIC102'));
  c.setMode('FIC102', 'MAN');
  for (let i = 0; i < 12 && !c.state.dlg; i++) { run(c, 10); c.ackPage(); }   // the bad PV keeps raising PVLO / PVLL on the point; ack them as they come
  const ended = c.state.dlg;
  assert.equal(ended && ended.type, 'debrief', 'the drill ended and the debrief opened');
  const sc = c.scoreDrill(ended.drill, d.a);
  const earned = sc.breakdown.reduce((a, r) => a + r.earned, 0);
  const max = sc.breakdown.reduce((a, r) => a + r.max, 0);
  assert.equal(max, 100);
  assert.equal(sc.score, Math.round(earned / max * 100));
  assert.equal(sc.passMark, 80);
  assert.equal(Training.PASS_MARK, 80);
  assert.match(Training.PASS_LABEL, /independent/i);
  assert.match(Training.PASS_LABEL, /not a vendor certification/i);
  assert.deepEqual(sc.breakdown.map((r) => r.id), ['ack', 'action', 'trip', 'stable', 'load', 'quiz', 'othertrips']);
  // the debrief renders the breakdown and the label, and the record is stored under the logon name
  c.setState({ debAns: d.a });
  const r = c.submitDebrief(ended.drill, d.a);
  assert.equal(r.score, sc.score);
  const v = c.renderVals();
  assert.equal(v.dg.dbBreak.length, 7);
  assert.match(v.dg.dbPassT, /80 % pass mark/);
  assert.match(v.dg.dbPassT, /independent training threshold, not a vendor certification/);
  assert.equal(c.trainingRecords.length, 1);
  assert.equal(c.trainingRecords[0].oper, 'AV');
  assert.equal(c.trainingRecords[0].score, sc.score);
  assert.ok(c.events.some((e) => /DRILL D1 SCORE/.test(e.desc) && e.newV === 'AV'));
  c.setState({ dlg: { type: 'record' } });
  const rv = c.renderVals();
  assert.equal(rv.dg.recRows.length, 1);
  assert.equal(rv.dg.recRows[0].oper, 'AV');
  // the record keeps only the last 20 results
  for (let i = 0; i < 25; i++) Training.addRecord(c.trainingRecords, Training.recordFor('X', 'D1', 'n', sc, 0, ''), 20);
  assert.equal(c.trainingRecords.length, 20);
});

test('scorer uses the KPI module for the alarm load element', () => {
  const m = { tAlarm: 0, tAck: 10000, tAct: 60000, tStable: 200000, trip: false, quizCorrect: true, alarmsPer10min: 0.5 };
  const perfect = Kpi.scoreDrill(m);
  assert.equal(perfect.score, 100);
  assert.equal(perfect.pass, true);
  const loaded = Kpi.scoreDrill(Object.assign({}, m, { alarmsPer10min: 10 }));
  assert.equal(loaded.breakdown.find((r) => r.id === 'load').earned, 0);
  assert.equal(loaded.score, 90);
  const tripped = Kpi.scoreDrill(Object.assign({}, m, { trip: true, tStable: null }));
  assert.equal(tripped.score, 65);
  assert.equal(tripped.pass, false);
});

test('coverage matrix marks tasks done after the corresponding handlers run', () => {
  const c = boot('OPER');
  run(c, 4);
  const done = () => Training.coverage(c.tasksDone).flatMap((g) => g.rows).filter((r) => r.done).map((r) => r.id);
  assert.equal(Training.tasks().length >= 30, true, 'about 30 tasks');
  // 8 -> 9 at stage S4: the coverage matrix gained the Architecture task group, per
  // V3-PLAN section 6 ("the Coverage matrix in src/training.js gains the architecture task
  // group and maps A-drills to tasks"). The eight legacy groups are unchanged and still
  // first in order; this asserts the addition, not a rewrite.
  assert.deepEqual(Training.GROUPS.length, 9);
  assert.deepEqual(Training.GROUPS.slice(0, 8), [
    'Navigation and displays', 'Alarms', 'Control and faceplates', 'Batch and sequences',
    'Trends and history', 'Messages and confirmations', 'Security and signatures',
    'Abnormal situation handling',
  ], 'the eight legacy groups must survive unchanged and in order');
  assert.deepEqual(done(), []);
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'x');
  c.ackAlarm(c.alarmEngine.unacked()[0]);
  c.setState({ selAlm: c.alarms[0].id, dlg: { type: 'shelve', dur: 15, reasonSel: 'NUISANCE / CHATTERING' } });
  c.shelve(15);
  c.setMode('TIC301', 'MAN');
  c.seqCmd('START');
  c.nav('trend');
  c.postMsg('INSTRUCTOR: hello', { confirm: true, src: 'INSTR' });
  c.confirmMsg(c.msgs[0].id);
  c.silence();
  c.openFp('FIC102');
  c.setState({ cmd: 'ALM' }); c.parseCmd();
  const got = done();
  for (const id of ['alm.ack', 'alm.shelve', 'ctl.mode', 'bat.start', 'trn.open', 'msg.confirm', 'alm.silence', 'nav.faceplate', 'nav.command', 'alm.summary']) assert.ok(got.includes(id), id + ' should be ticked: ' + got.join(','));
  assert.ok(!got.includes('alm.unshelve'));
  c.setState({ dlg: { type: 'coverage' } });
  const v = c.renderVals();
  assert.equal(v.dg.covGroups.length, 9);   // + Architecture (S4)
  const ack = v.dg.covGroups.find((g) => g.name === 'Alarms').rows.find((r) => r.label.startsWith('Acknowledge an alarm'));
  assert.equal(ack.tick, '✓');
  assert.match(ack.drills, /D1/);
  const s = Training.coverageSummary(c.tasksDone);
  assert.equal(s.done, got.length);
  // the task-done set survives a process reset (it belongs to the session)
  c.initSim();
  assert.ok(c.tasksDone.has('alm.ack'));
});

test('a CONFIRM message stays in the status-bar count until confirmed and the confirm logs the operator name', () => {
  const c = boot('OPER');
  c.setState({ oper: 'TRAINEE B' });
  run(c, 2);
  c.postMsg('routine notice');
  assert.equal(c.renderVals().cMsg, 0);
  const m = c.postMsg('SCM202: CONFIRM CHARGE COMPLETE', { confirm: true, src: 'SCM202' });
  let v = c.renderVals();
  assert.equal(v.cMsg, 1);
  assert.equal(v.msgOn, true);
  assert.notEqual(v.msgBg, v.msgFg, 'MSG indicator paints');
  const bg1 = v.msgBg; c.setState({ blink: !c.state.blink }); assert.notEqual(c.renderVals().msgBg, bg1, 'MSG indicator blinks');
  c.setState({ display: 'msgs' });
  v = c.renderVals();
  const row = v.msgsR.find((r) => r.txt === m.txt);
  assert.equal(row.needs, true);
  // VIEW cannot confirm
  c.setState({ sec: 'VIEW' });
  assert.equal(c.confirmMsg(m.id), false);
  assert.equal(c.renderVals().cMsg, 1);
  c.setState({ sec: 'OPER' });
  row.confCb();
  assert.equal(m.confirmed, true);
  assert.equal(m.confirmedBy, 'TRAINEE B');
  v = c.renderVals();
  assert.equal(v.cMsg, 0);
  assert.equal(v.msgOn, false);
  assert.match(v.msgsR.find((r) => r.txt === m.txt).confT, /CONFIRMED .* BY TRAINEE B/);
  const ev = c.events.find((e) => /MESSAGE CONFIRMED/.test(e.desc));
  assert.equal(ev.src, 'SCM202');
  assert.equal(ev.newV, 'TRAINEE B');
  assert.equal(ev.who, 'TRAINEE B');
  assert.ok(c.tasksDone.has('bat.confirm'));
  assert.equal(c.confirmMsg(m.id), false, 'a second confirm is refused');
});

test('sequence and interlock prompts require a confirm; instructor drill messages too', () => {
  const c = boot('OPER');
  c.seqCmd('START');
  run(c, 120);
  assert.equal(c.P.b.phase, 'HEATUP');
  const prompt = c.msgs.find((m) => /CONFIRM CHARGE COMPLETE/.test(m.txt));
  assert.ok(prompt, 'SCM202 prompt posted');
  assert.equal(prompt.confirm, true);
  assert.equal(prompt.src, 'SCM202');
  c.setState({ sec: 'MNGR' });
  c.startDrill(c.drillDefs()[0]);
  assert.equal(c.msgs[0].confirm, true);
  assert.equal(c.msgs[0].src, 'INSTR');
  c.endDrill('ENDED BY INSTRUCTOR');
  assert.equal(c.msgs[0].confirm, true);
  c.setState({ dlg: null });
  // interlock notice
  c.latchTadShed();
  const il = c.msgs.find((m) => /INTERLOCK: TI216/.test(m.txt));
  assert.equal(il.confirm, true);
  assert.equal(c.pendingMsgs().length, 4);
});

test('e-signature refuses without a valid password or reason and logs name, level and reason when signed', () => {
  const c = boot('ENGR');
  c.setState({ oper: 'ENG ONE' });
  run(c, 2);
  let ran = null;
  c.withSignature('TEST ACTION', 'ENGR', (reason) => { ran = reason; });
  assert.equal(c.state.dlg.type, 'esig');
  assert.equal(sign(c, '', 'because'), false, 'no password');
  assert.equal(ran, null);
  assert.equal(sign(c, 'oper', 'because'), false, 'a lower-level password does not sign an ENGR action');
  assert.ok(c.events.some((e) => /SIGNATURE REFUSED/.test(e.desc) && /BELOW ENGR/.test(e.newV)));
  assert.equal(ran, null);
  assert.equal(sign(c, 'engr', ''), false, 'reason required');
  assert.equal(ran, null);
  assert.equal(sign(c, 'engr', 'loop retune'), true);
  assert.equal(ran, 'loop retune');
  assert.equal(c.state.dlg, null);
  const ev = c.events.find((e) => /E-SIGNATURE — TEST ACTION/.test(e.desc));
  assert.ok(ev);
  assert.match(ev.desc, /loop retune/);
  assert.equal(ev.newV, 'ENG ONE (ENGR)');
  assert.equal(ev.lvl, 'ENGR');
  assert.equal(ev.who, 'ENG ONE');
  assert.ok(c.tasksDone.has('sec.esig'));
  // OPER cannot even open the dialog for an ENGR action
  const d = boot('OPER');
  let hit = false;
  d.withSignature('X', 'ENGR', () => { hit = true; });
  assert.equal(d.state.dlg, null);
  assert.equal(hit, false);
});

test('critical actions go through the signature: trip point, priority, tuning, OOS, snapshot restore during a drill', () => {
  const c = boot('ENGR');
  run(c, 2);
  // trip point
  c.storeEntry('TIC201', 'TP:PVHI', 168);
  assert.equal(c.L.TIC201.alm.PVHI[0], 165, 'not applied before the signature');
  assert.equal(c.state.dlg.type, 'esig');
  sign(c, 'engr', 'rationalisation review');
  assert.equal(c.L.TIC201.alm.PVHI[0], 168);
  let ev = cfgEvents(c).find((e) => /PVHI TRIP POINT CHANGE/.test(e.desc));
  assert.equal(ev.oldV, '165.00'); assert.equal(ev.newV, '168.00'); assert.match(ev.desc, /rationalisation review/);
  // tuning
  c.storeEntry('TIC201', 'K', 2.5);
  assert.equal(c.L.TIC201.K, 2);
  sign(c, 'engr', 'retune');
  assert.equal(c.L.TIC201.K, 2.5);
  ev = cfgEvents(c).find((e) => /K CHANGE/.test(e.desc));
  assert.equal(ev.oldV, '2.00'); assert.equal(ev.newV, '2.50');
  // priority via the Point Detail row
  c.setState({ detailTag: 'TIC201', detailTab: 'alarms' });
  const row = c.renderVals().dpt.almRows.find((r) => r.cond === 'PVLO');
  row.prioCb();
  assert.equal(c.L.TIC201.alm.PVLO[1], 'Low');
  sign(c, 'engr', 'raise priority');
  assert.equal(c.L.TIC201.alm.PVLO[1], 'High');
  ev = cfgEvents(c).find((e) => /PVLO PRIORITY CHANGE/.test(e.desc));
  assert.equal(ev.oldV, 'Low'); assert.equal(ev.newV, 'High');
  // OOS signed, RTS unsigned but journaled
  c.setOos('TIC201', 'PVLO', true);
  assert.equal(c.isOos('TIC201', 'PVLO'), false);
  sign(c, 'mngr', 'instrument fault');
  assert.equal(c.isOos('TIC201', 'PVLO'), true);
  c.setOos('TIC201', 'PVLO', false);
  assert.equal(c.isOos('TIC201', 'PVLO'), false);
  assert.equal(cfgEvents(c).filter((e) => /PVLO SERVICE STATE/.test(e.desc)).length, 2);
  // snapshot restore during a drill is signed with the manager password
  c.setState({ sec: 'MNGR' });
  c.instr.auth = true;
  c.saveSlot(0, 'before');
  run(c, 4);
  c.startDrill(c.drillDefs()[0]);
  const tBefore = c.P.t;
  c.restoreSlot(0);
  assert.equal(c.state.dlg.type, 'esig');
  assert.equal(c.P.t, tBefore, 'not restored yet');
  sign(c, 'mngr', 'restart the exercise');
  assert.ok(c.P.t < tBefore, 'restored after the signature');
  assert.ok(cfgEvents(c).some((e) => /SNAPSHOT RESTORED DURING DRILL/.test(e.desc)));
  // without a drill the restore is direct
  c.saveSlot(1, 'plain');
  run(c, 2);
  c.restoreSlot(1);
  assert.equal(c.state.dlg, null);
});

test('asset disable puts every condition of the asset into DISABLED, shows the indicator, re-enable clears it', () => {
  const c = boot('MNGR');
  c.setState({ oper: 'SHIFT MGR' });
  run(c, 2);
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'x');
  c.raiseA('R-201', 'HI TEMP TRIP', 'Urgent', 186, 'DEG C', 'trip');
  // OPER / ENGR are refused
  c.setState({ sec: 'ENGR' });
  c.toggleAssetAlarms('R-201');
  assert.equal(c.state.dlg, null);
  c.setState({ sec: 'MNGR' });
  c.setState({ almAsset: 'R-201', display: 'alarms' });
  const btn = c.renderVals().av.btns.find((b) => b.label === 'DISABLE ASSET');
  btn.cb();
  assert.equal(c.state.dlg.type, 'esig');
  assert.equal(c.disabledAssets.size, 0);
  sign(c, 'mngr', 'maintenance outage on R-201');
  assert.ok(c.disabledAssets.has('R-201'));
  const tags = c.assetTags('R-201');
  assert.deepEqual(tags.sort(), ['AI205', 'FIC102', 'R-201', 'TIC201', 'TIC202'].sort());
  let n = 0;
  for (const tag of tags) { const l = c.L[tag]; if (!l) continue; for (const cond in l.alm) { const r = c.alarmEngine.get(tag + '.' + cond); assert.equal(r && r.state, 'OOSRV', tag + '.' + cond); assert.equal(r.disabledBy, 'ASSET:R-201'); n++; } }
  assert.ok(n >= 12, 'every configured condition of the asset is parked: ' + n);
  const trip = c.alarmEngine.get('R-201.HI TEMP TRIP');
  assert.equal(trip.state, 'OOSRV');
  assert.equal(trip.disabledBy, 'ASSET:R-201');
  assert.equal(c.alarmEngine.counts().unack, 0);
  let v = c.renderVals();
  assert.equal(v.disOn, true);
  assert.equal(v.cDis, n + 1);
  assert.equal(v.av.btns.find((b) => b.label === 'ENABLE ASSET') != null, true);
  c.setState({ shelfView: 'OOS' });
  v = c.renderVals();
  assert.ok(v.av.rows.every((r) => r.state === 'DISABLED'));
  assert.match(v.av.tree.find((t) => t.label.startsWith('R-201')).label, /ALARMS DISABLED/);
  const sys = v.sysPanels.find((p) => p.title === 'ALARM SYSTEM');
  assert.match(sys.rows.find((r) => r.k === 'Alarms disabled').v, /R-201/);
  // a new alarm on the disabled asset is parked, not annunciated
  c.raiseA('TIC202', 'PVHH', 'Urgent', 90, 'DEG C', 'x');
  assert.equal(c.alarmEngine.get('TIC202.PVHH').state, 'OOSRV');
  assert.equal(c.hornTop(), null);
  // an alarm elsewhere still annunciates
  c.raiseA('TIC311', 'PVHI', 'High', 370, 'DEG C', 'x');
  assert.equal(c.alarmEngine.get('TIC311.PVHI').state, 'UNACK');
  // per-condition RTS is refused while the asset is disabled
  c.setOos('TIC201', 'PVHI', false);
  assert.equal(c.alarmEngine.get('TIC201.PVHI').state, 'OOSRV');
  // MOC entries with old / new, name and reason
  const ev = cfgEvents(c).find((e) => /ALARMS DISABLED FOR ASSET/.test(e.desc));
  assert.equal(ev.src, 'R-201'); assert.equal(ev.oldV, '0 DISABLED'); assert.equal(ev.newV, '1 DISABLED'); assert.equal(ev.who, 'SHIFT MGR'); assert.match(ev.desc, /maintenance outage/);
  // re-enable restores every record; the still-active ones annunciate
  c.setState({ shelfView: 'MAIN', dlg: null });
  c.toggleAssetAlarms('R-201');
  sign(c, 'mngr', 'outage complete');
  assert.equal(c.disabledAssets.size, 0);
  assert.ok(c.alarmEngine.list().every((r) => !r.disabledBy));
  assert.equal(c.alarmEngine.get('TIC201.PVHI').state, 'UNACK');
  assert.equal(c.alarmEngine.get('TIC202.PVLO').state, 'NORM', 'a condition that never alarmed returns to NORM');
  v = c.renderVals();
  assert.equal(v.disOn, false);
  assert.equal(v.cDis, 0);
  assert.ok(cfgEvents(c).some((e) => /ALARMS RE-ENABLED FOR ASSET/.test(e.desc)));
  assert.ok(c.tasksDone.has('abn.disable'));
});

test('every configuration change produces a CONFIG event with old and new values; MOC view and count', () => {
  const c = boot('ENGR');
  c.setState({ oper: 'ENG TWO' });
  run(c, 2);
  const before = c.mocCount;
  const expect = [];
  c.storeEntry('TIC201', 'K', 3); sign(c, 'engr', 'r1'); expect.push(['K CHANGE', '2.00', '3.00']);
  c.storeEntry('TIC201', 'SPHILM', 172); expect.push(['SPHILM CHANGE', '170.00', '172.00']);
  c.storeEntry('TIC201', 'TP:PVHH', 176); sign(c, 'engr', 'r2'); expect.push(['PVHH TRIP POINT CHANGE', '175.00', '176.00']);
  c.storeEntry('TIC201', 'ALMDB', 3); expect.push(['ALARM DEADBAND CHANGE', '2.00', '3.00']);
  c.storeEntry('TIC201', 'ALMDELAY', 5); expect.push(['ALARM ON-DELAY CHANGE', '0.00', '5.00']);
  c.storeEntry('TIC201', 'TGTHI', 156); expect.push(['TARGET HIGH CHANGE', '160.00', '156.00']);
  c.setPvTrack('TIC201', true); expect.push(['PV TRACKING CHANGE', 'OFF', 'ON']);
  c.setPalette('isa101'); expect.push(['ALARM COLOUR PHILOSOPHY CHANGE', 'REPRESENTATIVE', 'ISA-101']);
  c.setOos('TIC201', 'PVLO', true); sign(c, 'engr', 'r3'); expect.push(['PVLO SERVICE STATE', 'IN SERVICE', 'OUT OF SERVICE']);
  c.setState({ detailTag: 'TIC201', detailTab: 'alarms' });
  c.renderVals().dpt.almRows.find((r) => r.cond === 'PVHI').prioCb(); sign(c, 'engr', 'r4'); expect.push(['PVHI PRIORITY CHANGE', 'High', 'Urgent']);
  c.setState({ detailTab: 'tuning' });
  c.renderVals().dpt.tuneRows.find((r) => r.param === 'CTLACTN').cb(); expect.push(['CONTROL ACTION CHANGE', 'REV', 'DIR']);
  c.seqCmd('START');
  c.setState({ sec: 'MNGR' });
  c.toggleAssetAlarms('R-310'); sign(c, 'mngr', 'r5'); expect.push(['ALARMS DISABLED FOR ASSET', '0 DISABLED', '1 DISABLED']);
  const cfg = cfgEvents(c);
  for (const [what, o, n] of expect) {
    const ev = cfg.find((e) => e.desc.startsWith(what));
    assert.ok(ev, what + ' missing: ' + cfg.map((e) => e.desc).join(' | '));
    assert.equal(ev.oldV, o, what + ' old'); assert.equal(ev.newV, n, what + ' new');
    assert.ok(ev.who === 'ENG TWO', what + ' carries the operator name');
    assert.ok(['ENGR', 'MNGR'].includes(ev.lvl));
  }
  assert.equal(c.mocCount - before, expect.length);
  // a sequence-driven limit set is listed as CONFIG but attributed to the program and not counted (verification round 1)
  const ps = cfg.find((e) => e.desc.startsWith('ALARM LIMIT SET CHARGE'));
  assert.ok(ps); assert.equal(ps.oldV, 'IDLE'); assert.equal(ps.newV, 'CHARGE'); assert.equal(ps.who, 'SCM202'); assert.equal(ps.lvl, 'PROGRAM');
  // signed changes carry the reason
  assert.match(cfg.find((e) => e.desc.startsWith('K CHANGE')).desc, /r1/);
  // deadband / delay took effect on the point
  assert.equal(c.almDeadband(c.L.TIC201), 3); assert.equal(c.almDelay(c.L.TIC201), 5);
  // MOC command opens the change log: events display filtered to CONFIG, with the count in the title and System Status
  c.setState({ cmd: 'MOC' }); c.parseCmd();
  assert.equal(c.state.display, 'events'); assert.equal(c.state.evtFilter, 'CONFIG');
  const v = c.renderVals();
  assert.ok(v.evR.every((e) => e.type === 'CONFIG'));
  assert.equal(v.evR.length, cfg.length);
  assert.match(v.evTitle, new RegExp('CHANGE LOG \\(MOC\\) — ' + c.mocCount));
  assert.ok(v.evFilters.some((f) => /CONFIG/.test(f.label)));
  assert.ok(v.evR.every((e) => e.who === 'ENG TWO' || e.who === 'SCM202'));
  assert.match(v.evTitle, /1 program-driven limit sets listed, not counted/);
  const sys = v.sysPanels.find((p) => p.title === 'ALARM SYSTEM');
  assert.equal(sys.rows.find((r) => r.k === 'Config changes').v, c.mocCount + ' SINCE STARTUP (MOC)');
  assert.ok(c.tasksDone.has('sec.moc'));
  // the count survives a process reset
  c.initSim();
  assert.equal(c.mocCount, before + expect.length);
});

test('logon captures the operator name; it lands on every event, and sign off keeps it', () => {
  const c = boot('OPER');
  run(c, 2);
  assert.equal(c.operName(), 'OPERATOR');
  c.setState({ dlg: { type: 'logon' }, dlgName: 'j. doe', dlgPw: 'supv' });
  c.logon();
  assert.equal(c.state.sec, 'SUPV');
  assert.equal(c.operName(), 'J. DOE');
  assert.equal(c.state.dlg, null);
  const ev = c.events[0];
  assert.match(ev.desc, /SECURITY LEVEL CHANGE — OPERATOR OPERATOR → J. DOE/);
  assert.equal(ev.oldV, 'OPER'); assert.equal(ev.newV, 'SUPV');
  c.silence();
  assert.equal(c.events[0].who, 'J. DOE');
  assert.equal(c.renderVals().evR[0].who, 'J. DOE');
  c.signOff();
  assert.equal(c.state.sec, 'VIEW');
  assert.equal(c.operName(), 'J. DOE');
  assert.ok(c.tasksDone.has('sec.logon') && c.tasksDone.has('sec.signoff'));
  // wrong password leaves the name alone
  c.setState({ dlg: { type: 'logon' }, dlgName: 'someone', dlgPw: 'nope' });
  c.logon();
  assert.equal(c.operName(), 'J. DOE');
  const v = c.renderVals();
  assert.equal(v.dg.logonIsOper, true);
  assert.equal(v.dg.operCur, 'J. DOE');
});

test('a full batch attributes its phase limit sets to SCM202 at level PROGRAM and adds nothing to the MOC count', () => {
  const c = boot('OPER');
  c.setState({ oper: 'JANE' });
  run(c, 2);
  const before = c.mocCount;
  c.seqCmd('START');
  for (let i = 0; i < 60 * 60 * 2 && c.P.b.phase !== 'IDLE'; i++) c.step(0.5);
  assert.equal(c.P.b.phase, 'IDLE', 'the batch ran to completion');
  const sets = c.events.filter((e) => e.type === 'CONFIG' && e.src === 'SCM202');
  assert.ok(sets.length >= 6, 'six phase transitions journaled: ' + sets.length);
  assert.ok(sets.every((e) => e.who === 'SCM202' && e.lvl === 'PROGRAM'));
  assert.ok(!c.events.some((e) => e.type === 'CONFIG' && e.who === 'JANE'), 'nothing is attributed to the trainee');
  assert.equal(c.mocCount, before);
});

test('the disabled-asset set travels with an instructor snapshot in both directions', () => {
  // direction A: snapshot before the disable, restore after it -> nothing is disabled and new alarms annunciate
  const c = boot('MNGR');
  run(c, 2);
  c.instr.auth = true;
  const before = c.snapshotData('before');
  assert.deepEqual(before.disabledAssets, []);
  c.toggleAssetAlarms('R-201'); sign(c, 'mngr', 'outage');
  assert.ok(c.disabledAssets.has('R-201'));
  c.restoreSnapshot(before, 'r');
  let v = c.renderVals();
  assert.equal(c.disabledAssets.size, 0);
  assert.equal(v.disOn, false); assert.equal(v.cDis, 0);
  assert.ok(c.alarmEngine.list().every((r) => !r.disabledBy));
  c.setState({ silenced: true });
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'x');
  assert.equal(c.alarmEngine.get('TIC201.PVHI').state, 'UNACK');
  assert.equal(c.state.silenced, false, 'the horn re-armed');
  // direction B: snapshot while disabled, restore after the re-enable -> the asset is disabled again and ENABLE works
  const c2 = boot('MNGR');
  run(c2, 2);
  c2.instr.auth = true;
  c2.toggleAssetAlarms('R-201'); sign(c2, 'mngr', 'outage');
  const during = c2.snapshotData('during');
  assert.deepEqual(during.disabledAssets, ['R-201']);
  c2.toggleAssetAlarms('R-201'); sign(c2, 'mngr', 'back');
  assert.equal(c2.disabledAssets.size, 0);
  c2.restoreSnapshot(during, 'r');
  v = c2.renderVals();
  assert.ok(c2.disabledAssets.has('R-201'));
  assert.equal(v.disOn, true);
  assert.ok(v.cDis >= 12);
  assert.equal(c2.alarmEngine.list().filter((r) => r.disabledBy === 'ASSET:R-201').length, v.cDis);
  c2.setState({ sec: 'ENGR' });
  c2.setOos('TIC201', 'PVHI', false);
  assert.equal(c2.alarmEngine.get('TIC201.PVHI').state, 'OOSRV', 'per-condition RTS still refused while disabled');
  c2.setState({ sec: 'MNGR' });
  c2.toggleAssetAlarms('R-201'); sign(c2, 'mngr', 'restored');
  assert.equal(c2.disabledAssets.size, 0);
  assert.ok(c2.alarmEngine.list().every((r) => !r.disabledBy));
  assert.equal(c2.renderVals().cDis, 0);
  // a snapshot without the list (older ring entry) derives the set from the record flags
  const legacy = c2.snapshotData('legacy');
  c2.toggleAssetAlarms('R-310'); sign(c2, 'mngr', 'o');
  const flagged = c2.snapshotData('flagged'); delete flagged.disabledAssets;
  c2.restoreSnapshot(legacy, 'r');
  assert.equal(c2.disabledAssets.size, 0);
  c2.restoreSnapshot(flagged, 'r');
  assert.deepEqual([...c2.disabledAssets], ['R-310']);
});

test('an alarm key with no prior record on a disabled asset is parked without horn, journal line or KPI row', () => {
  const c = boot('MNGR');
  run(c, 2);
  c.toggleAssetAlarms('R-201'); sign(c, 'mngr', 'outage');
  assert.equal(c.alarmEngine.get('R-201.HI TEMP TRIP'), undefined);
  c.setState({ silenced: true });
  const nAlarm = c.events.filter((e) => e.type === 'ALARM').length;
  const nLog = c.alarmLog.length;
  c.raiseA('R-201', 'HI TEMP TRIP', 'Urgent', 186, 'DEG C', 'trip');
  const r = c.alarmEngine.get('R-201.HI TEMP TRIP');
  assert.equal(r.state, 'OOSRV'); assert.equal(r.disabledBy, 'ASSET:R-201'); assert.equal(r.prio, 'Urgent'); assert.equal(r.val, 186);
  assert.equal(c.state.silenced, true, 'the horn stayed silent');
  assert.equal(c.hornTop(), null);
  assert.equal(c.events.filter((e) => e.type === 'ALARM').length, nAlarm, 'no ALARM journal line');
  assert.equal(c.alarmLog.length, nLog, 'no KPI alarm-log row');
  assert.ok(c.events.some((e) => e.type === 'SYSTEM' && e.src === 'R-201' && /HI TEMP TRIP DISABLED — ASSET:R-201/.test(e.desc)));
  // an existing parked record gets the new value but no second journal line
  c.raiseA('R-201', 'HI TEMP TRIP', 'Urgent', 190, 'DEG C', 'trip');
  assert.equal(c.alarmEngine.get('R-201.HI TEMP TRIP').val, 190);
  assert.equal(c.events.filter((e) => e.type === 'ALARM').length, nAlarm);
  // re-enable: the trip alarm comes back into service and annunciates
  c.toggleAssetAlarms('R-201'); sign(c, 'mngr', 'done');
  assert.equal(c.alarmEngine.get('R-201.HI TEMP TRIP').state, 'UNACK');
});

test('the ALARM HELP button ticks its coverage task and the signature dialog restores the dialog it replaced', () => {
  const c = boot('OPER');
  c.setState({ display: 'alarms' });
  c.renderVals().av.helpToggle();
  assert.equal(c.state.almHelp, true);
  assert.ok(c.tasksDone.has('alm.help'));
  c.renderVals().av.helpToggle();
  assert.equal(c.state.almHelp, false);
  // e-signature over an open dialog: cancel brings the previous dialog back, signing closes both
  c.setState({ sec: 'ENGR', dlg: { type: 'help' } });
  c.openEntry('FIC102', 'K'); c.setState({ entryText: '9' }); c.commitEntry();
  assert.equal(c.state.dlg.type, 'esig');
  c.renderVals().dg.close();
  assert.equal(c.state.dlg && c.state.dlg.type, 'help');
  assert.equal(c.L.FIC102.K !== 9, true);
  c.setState({ dlg: { type: 'help' } });
  c.openEntry('FIC102', 'K'); c.setState({ entryText: '9' }); c.commitEntry();
  sign(c, 'engr', 'retune');
  assert.equal(c.state.dlg, null);
  assert.equal(c.L.FIC102.K, 9);
});

// ---- residual verifier findings (B6 round 2) ----
test('a deadband or on-delay store on a point with active alarms keeps them standing: no RTN / re-raise pair, no new horn', () => {
  const c = boot('ENGR');
  run(c, 2);
  for (let i = 0; i < 4; i++) { c.L.TIC301.pv = 300; c.scan(0.5); }
  const st = () => c.alarms.filter((a) => a.tag === 'TIC301').map((a) => a.cond + ':' + a.state).sort().join();
  assert.equal(st(), 'PVHH:UNACK,PVHI:UNACK');
  c.ackPage();
  const rtn = () => c.events.filter((e) => e.src === 'TIC301' && e.type === 'ALARM').length;
  const n0 = rtn(), log0 = c.alarmLog.length;
  c.setState({ silenced: true });
  c.storeEntry('TIC301', 'ALMDELAY', 30);
  for (let i = 0; i < 4; i++) { c.L.TIC301.pv = 300; c.scan(0.5); }
  assert.equal(st(), 'PVHH:ACKED,PVHI:ACKED', 'still standing and acknowledged');
  assert.equal(rtn(), n0, 'no RTN / ALARM journal lines'); assert.equal(c.alarmLog.length, log0); assert.equal(c.state.silenced, true, 'no new horn');
  assert.equal(c.L.TIC301.almDelay, 30);
  c.storeEntry('TIC301', 'ALMDB', 25);
  for (let i = 0; i < 4; i++) { c.L.TIC301.pv = 300; c.scan(0.5); }
  assert.equal(st(), 'PVHH:ACKED,PVHI:ACKED'); assert.equal(rtn(), n0);
  assert.equal(cfgEvents(c).filter((e) => /ALARM (DEADBAND|ON-DELAY) CHANGE/.test(e.desc)).length, 2, 'both CONFIG rows');
  // the new values apply to future evaluations: after the PV returns, the next alarm waits the new 30 s
  c.L.TIC301.pv = 170; for (let i = 0; i < 4; i++) c.scan(0.5);   // PVHI trips at 200: 170 is under trip minus the new 25 deadband
  assert.equal(st(), '', 'acknowledged alarms return straight to NORM');
  for (let i = 0; i < 20; i++) { c.L.TIC301.pv = 300; c.scan(0.5); }
  assert.ok(!c.alarms.some((a) => a.tag === 'TIC301' && a.active), 'not yet: 10 s of a 30 s delay');
  for (let i = 0; i < 44; i++) { c.L.TIC301.pv = 300; c.scan(0.5); }
  assert.ok(c.alarms.some((a) => a.tag === 'TIC301' && a.active), 'after 30 s');
});

test('CONFIRM-required messages survive the Message Summary cap', () => {
  const c = boot('OPER');
  const m = c.postMsg('needs it', { confirm: true, src: 'INSTR' });
  for (let i = 0; i < 450; i++) c.postMsg('noise ' + i);
  assert.ok(c.msgs.length <= 401 && c.msgs.length >= 400);
  assert.equal(c.pendingMsgs().length, 1);
  assert.equal(c.renderVals().cMsg, 1);
  assert.ok(c.confirmMsg(m.id));
  for (let i = 0; i < 10; i++) c.postMsg('more ' + i);
  assert.equal(c.msgs.length, 400, 'once confirmed it is trimmed like any other');
});

test('a snapshot restore during a drill is signed on the instructor authority: the instructor password opens and signs it at any station level', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 5); c.saveSlot(0, 'before');
  run(c, 5); c.startDrill(c.drillDefs()[0]);
  c.restoreSlot(0);
  assert.equal(c.state.dlg && c.state.dlg.type, 'esig', 'dialog opens without a MNGR logon');
  assert.equal(c.state.sec, 'OPER');
  assert.equal(sign(c, 'oper', 'x'), false, 'operator password refused');
  assert.ok(sign(c, 'instr', 'restart the exercise'));
  assert.equal(c.state.drill, null, 'restored: drill gone');
  const cfg = cfgEvents(c).find((e) => /SNAPSHOT RESTORED DURING DRILL/.test(e.desc));   // the E-SIGNATURE line itself is truncated by the restore (CODE-MAP B6 hazard)
  assert.ok(cfg && /restart the exercise/.test(cfg.desc), 'CONFIG entry carries the reason');
  c.withSignature('INSTRUCTOR CHECK', 'MNGR', () => {}, { instr: true }); assert.ok(sign(c, 'instr', 'r'));
  const ev = c.events.find((e) => /^E-SIGNATURE — INSTRUCTOR CHECK/.test(e.desc));
  assert.ok(ev && /\(INSTRUCTOR\)/.test(ev.newV), 'signed as the instructor: ' + (ev && ev.newV));
  // without the instructor session the station level still gates it
  const d = boot('OPER'); run(d, 5); d.saveSlot(0, 's'); run(d, 5); d.startDrill(d.drillDefs()[0]); d.restoreSlot(0);
  assert.equal(d.state.dlg, null); assert.match(d.state.msg, /HIGHER SECURITY LEVEL REQUIRED \(MNGR\)/);
  // an ordinary signature does not accept the instructor password
  const e = boot('ENGR'); e.instr.auth = true; e.withSignature('X', 'ENGR', () => {}); assert.equal(sign(e, 'instr', 'r'), false);
});

test('a second signature request while one is pending is refused with a message and nothing is replaced', () => {
  const c = boot('ENGR');
  let a = 0, b = 0;
  c.withSignature('ACTION A', 'ENGR', () => a++);
  c.withSignature('ACTION B', 'ENGR', () => b++);
  assert.match(c.state.msg, /SIGNATURE PENDING — SIGN OR CANCEL ACTION A FIRST/);
  assert.equal(c.state.dlg.desc, 'ACTION A');
  sign(c, 'engr', 'r');
  assert.equal(a, 1); assert.equal(b, 0);
  c.withSignature('ACTION B', 'ENGR', () => b++); sign(c, 'engr', 'r');
  assert.equal(b, 1, 'after signing, the next request is accepted');
});

test('a rejected command zone entry does not tick the nav.command coverage task; automatic phase sets are attributed to SCM202', () => {
  const c = boot('OPER');
  c.setState({ cmd: 'NOPE' }); c.parseCmd();
  assert.ok(!c.tasksDone.has('nav.command')); assert.match(c.state.msg, /DISPLAY NOT FOUND: NOPE/);
  c.setState({ cmd: 'ALM' }); c.parseCmd();
  assert.ok(c.tasksDone.has('nav.command')); assert.equal(c.state.display, 'alarms');
  c.setState({ oper: 'JANE' }); c.seqCmd('START'); run(c, 600);
  const sets = cfgEvents(c).filter((e) => /ALARM LIMIT SET/.test(e.desc));
  assert.ok(sets.length >= 2);
  assert.ok(sets.every((e) => e.who === 'SCM202' && e.lvl === 'PROGRAM'), sets.map((e) => e.who + '/' + e.lvl).join());
});

// ---- final QA (2026-08-29): drill D4 must be passable by its own recommended action ----

// Drives drill D4 from a settled plant with a seeded generator. `policy(c, d, ctx)` runs after every step once the first
// alarm is in; ctx.since is the seconds since that alarm. Every unacknowledged alarm is acknowledged as it comes.
function runD4(seed, policy) {
  const c = boot('OPER');
  c.rand = Models.createRand(seed);
  run(c, 60);
  const def = c.drillDefs().find((d) => d.id === 'D4');
  c.startDrill(def);
  const peak = { rT: 0, tankL: 0 };
  let tAlarm = null;
  for (let i = 0; i < 1600 && c.state.drill; i++) {
    c.step(0.5);
    const d = c.state.drill; if (!d) break;
    peak.rT = Math.max(peak.rT, c.P.rT); peak.tankL = Math.max(peak.tankL, c.P.tankL);
    if (d.m.tAlarm) {
      if (tAlarm == null) tAlarm = c.P.t;
      policy(c, d, { since: (c.P.t - tAlarm) / 1000 });
      for (const a of c.alarmEngine.unacked()) c.ackAlarm(a);
    }
  }
  const d = c.state.dlg && c.state.dlg.drill;
  assert.ok(d && d.reason, 'D4 seed ' + seed + ': reached the debrief');
  return { c, d, def, peak, score: c.scoreDrill(d, def.a) };
}
const setOp = (c, tag, v) => { c.openEntry(tag, 'OP'); c.setState({ entryText: String(v) }); c.commitEntry(); };
// the guidance, followed literally: cut feed to 20 % (here 60 s after the first alarm), then when TIC201 is falling and
// TK-101 passes 80 % restore FIC102 toward 60 %, acknowledging as alarms come
function guidance(state) {
  return (c, d, ctx) => {
    if (!state.cut && ctx.since >= 60) { c.silence(); c.setMode('FIC102', 'MAN'); setOp(c, 'FIC102', 20); state.cut = true; }
    state.rT = state.rT || []; state.rT.push(c.P.rT); if (state.rT.length > 40) state.rT.shift();
    const falling = state.rT.length >= 40 && state.rT[state.rT.length - 1] < state.rT[0] - 0.3;
    if (state.cut && !state.restored && falling && c.P.tankL >= 80) { setOp(c, 'FIC102', 60); state.restored = true; }
  };
}

test('D4: following the recommended sequence literally passes (>= 80) inside the drill window with no trip on any unit', () => {
  for (const seed of [3, 5, 11]) {
    const st = {};
    const { c, d, peak, score } = runD4(seed, guidance(st));
    assert.ok(st.cut && st.restored, 'seed ' + seed + ': feed was cut and restored');
    assert.equal(d.reason, 'STABILIZED', 'seed ' + seed + ': ' + d.reason);
    assert.ok(d.m.tAct && d.m.tAck, 'seed ' + seed + ': ack and action credited');
    assert.equal(!!d.m.trip, false, 'seed ' + seed + ': no R-201 trip');
    assert.equal(d.m.otherTrips || 0, 0, 'seed ' + seed + ': no other trip');
    assert.deepEqual(Object.keys(c.P.trips).filter((k) => c.P.trips[k]), [], 'seed ' + seed + ': no trip standing');
    assert.ok(peak.rT < 185 && peak.tankL < 90, 'seed ' + seed + ': peaks ' + peak.rT.toFixed(1) + ' / ' + peak.tankL.toFixed(1));
    assert.ok(score.score >= 80 && score.pass, 'seed ' + seed + ': score ' + score.score);
    assert.equal(score.breakdown.find((r) => r.id === 'trip').earned, 20);
    assert.equal(score.breakdown.find((r) => r.id === 'stable').earned, 15);
  }
});

test('D4: doing nothing still fails, and cutting feed without restoring it does not pass either', () => {
  const idle = runD4(5, () => {});
  assert.ok(idle.d.m.trip, 'the reactor tripped with no operator action');
  assert.ok(idle.score.score < 80 && !idle.score.pass, 'nothing: ' + idle.score.score);
  assert.equal(idle.score.breakdown.find((r) => r.id === 'trip').earned, 0);
  // feed cut at the first alarm and left cut: TK-101 fills and trips — counted as an other-equipment deduction, not as
  // the drill's trip, and the drill does not stabilise (LIC101 is a related point), so the trainee does not pass
  const cut = runD4(5, (c, d, ctx) => { if (!c._cut) { c.setMode('FIC102', 'MAN'); setOp(c, 'FIC102', 20); c._cut = true; } });
  assert.equal(!!cut.d.m.trip, false, 'no R-201 trip after cutting feed');
  assert.ok(cut.peak.tankL >= 98 && cut.d.m.otherTrips === 1, 'TK-101 tripped: ' + cut.peak.tankL.toFixed(1) + ' / ' + cut.d.m.otherTrips);
  assert.deepEqual(cut.d.m.otherTripList, ['TK-101 HIHI TRIP']);
  assert.notEqual(cut.d.reason, 'STABILIZED');
  const rows = cut.score.breakdown;
  assert.equal(rows.find((r) => r.id === 'trip').earned, 20, 'the drill trip criterion is R-201 only');
  assert.equal(rows.find((r) => r.id === 'othertrips').earned, -10, 'the tank trip deducts 10');
  assert.ok(cut.score.score < 80 && !cut.score.pass, 'cut only: ' + cut.score.score);
  // the debrief shows both rows and the guidance text, and the quiz answer names the whole sequence
  cut.c.setState({ debAns: cut.def.a });
  cut.c.submitDebrief(cut.d, cut.def.a);
  const v = cut.c.renderVals();
  assert.ok(v.dg.dbRows.some((r) => r.k === 'Other equipment trips' && /TK-101 HIHI TRIP/.test(r.v)));
  assert.ok(v.dg.dbGuideOn && /restore feed/i.test(v.dg.dbGuide) && /TK-101/.test(v.dg.dbGuide));
  assert.match(cut.def.opts[cut.def.a], /restore feed/i);
  assert.ok(v.dg.dbBreak.some((b) => b.label === 'Other equipment trips' && b.pts === '-10 / 0'));
});

test('drill trip lists: the drill equipment decides the trip criterion; a drill without a list owns every trip; the scorer deducts and caps other trips', () => {
  const c = boot('OPER');
  const defs = c.drillDefs();
  const keys = ['ovf', 'rx', 'psv', 'batch', 'bed', 'skin'];
  for (const d of defs) if (d.trips) for (const k of d.trips) assert.ok(keys.includes(k), d.id + ' lists ' + k);
  assert.deepEqual(defs.find((d) => d.id === 'D4').trips, ['rx']);
  assert.deepEqual(defs.find((d) => d.id === 'D2').trips, ['ovf', 'rx']);
  assert.deepEqual(defs.find((d) => d.id === 'D9').trips, ['psv']);
  assert.deepEqual(defs.find((d) => d.id === 'D11').trips, ['batch']);
  assert.deepEqual(defs.find((d) => d.id === 'D12').trips, ['bed']);
  assert.equal(defs.find((d) => d.id === 'D1').trips, undefined);
  // dTrip with a running D4: TK-101 is 'other', R-201 is the drill's
  c.setState({ drill: { def: defs.find((d) => d.id === 'D4'), t0: c.P.t, ti: c.P.t, injected: true, m: {}, stableFor: 0 } });
  c.dTrip('TK-101', 'HIHI TRIP');
  assert.equal(c.state.drill.m.trip, undefined); assert.equal(c.state.drill.m.otherTrips, 1);
  c.dTrip('R-201', 'HI TEMP TRIP');
  assert.equal(c.state.drill.m.trip, true);
  // D1 has no list: any trip is the drill's
  c.setState({ drill: { def: defs.find((d) => d.id === 'D1'), t0: c.P.t, ti: c.P.t, injected: true, m: {}, stableFor: 0 } });
  c.dTrip('V-401', 'PSV LIFT');
  assert.equal(c.state.drill.m.trip, true); assert.equal(c.state.drill.m.otherTrips, undefined);
  c.setState({ drill: null });
  // the module: no row without the metric, -10 per trip capped at -20, score never below 0
  const base = { tAlarm: 0, tAck: 10000, tAct: 20000, tStable: 60000, trip: false, quizCorrect: true, alarmsPer10min: 0 };
  assert.ok(!Kpi.scoreDrill(base).breakdown.some((r) => r.id === 'othertrips'));
  assert.equal(Kpi.scoreDrill(base).score, 100);
  const one = Kpi.scoreDrill(Object.assign({}, base, { otherTrips: 1 }));
  assert.equal(one.score, 90); assert.equal(one.breakdown.find((r) => r.id === 'othertrips').earned, -10);
  const three = Kpi.scoreDrill(Object.assign({}, base, { otherTrips: 3 }));
  assert.equal(three.score, 80, 'capped at 20');
  assert.equal(three.breakdown.reduce((a, r) => a + r.max, 0), 100, 'the deduction row carries no maximum');
  assert.equal(Kpi.scoreDrill({ otherTrips: 3, trip: true }).score, 0, 'clamped at 0');
});
