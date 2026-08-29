// App-level tests for step B6: standards-based drill scorer (ESS.Kpi, RESOURCES 2.7, 2.8),
// operator task coverage matrix and the 80 % independent pass mark (RESOURCES 2.12),
// Message Summary confirm, electronic signatures, disable-alarms-for-asset (2.12),
// and the management-of-change audit in the event journal (2.1, 2.13).
const test = require('node:test');
const assert = require('node:assert/strict');
const Training = require('../src/training.js');
const Kpi = require('../src/kpi.js');
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
  assert.deepEqual(sc.breakdown.map((r) => r.id), ['ack', 'action', 'trip', 'stable', 'load', 'quiz']);
  // the debrief renders the breakdown and the label, and the record is stored under the logon name
  c.setState({ debAns: d.a });
  const r = c.submitDebrief(ended.drill, d.a);
  assert.equal(r.score, sc.score);
  const v = c.renderVals();
  assert.equal(v.dg.dbBreak.length, 6);
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
  assert.deepEqual(Training.GROUPS.length, 8);
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
  assert.equal(v.dg.covGroups.length, 8);
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
  c.seqCmd('START'); expect.push(['ALARM LIMIT SET CHARGE', 'IDLE', 'CHARGE']);
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
  assert.ok(v.evR.every((e) => e.who === 'ENG TWO'));
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
