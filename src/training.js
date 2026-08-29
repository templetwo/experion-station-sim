/*
 * ESS.Training — operator task inventory, coverage matrix, training record
 * and the message / signature / change-log record shapes used by the station.
 *
 * The task list is our own: it is written from the feature inventory the
 * public course catalogues describe (RESOURCES 2.12: navigation, alarm and
 * event handling, electronic signatures, message confirmation, asset alarm
 * disable, SCM detail) and from the displays this simulator actually has.
 * No vendor task names or course text are reproduced. The pass mark is this
 * simulator's own threshold and is labelled independent of any vendor
 * certification (RESOURCES 2.12, HAC uses 80 % for its own scheme).
 *
 * API
 *   GROUPS                          ordered group names
 *   tasks()                         [{id, group, label, drills:[ids], features:[names]}]
 *   coverage(doneSet)               [{name, done, total, rows:[{id,label,done,drills,features}]}]
 *   coverageSummary(doneSet)        {done, total, pct}
 *   PASS_MARK, PASS_LABEL           80 and the independent-threshold wording
 *   addRecord(list, rec, cap)       prepend rec, trim to cap (default 20); returns list
 *   recordFor(oper, drillId, name, result, endedT, reason)  -> record shape
 *   message(t, txt, opts)           {id, t, txt, confirm, confirmed, confirmedBy, confirmT, src}
 *   pending(msgs)                   messages that still need a confirm
 *   SIGNED_ACTIONS                  ids of actions that require an electronic signature
 *   configChange(what, oldV, newV, reason, who, lvl) -> plain change-log record
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.ESS = root.ESS || {}).Training = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GROUPS = ['Navigation and displays', 'Alarms', 'Control and faceplates', 'Batch and sequences', 'Trends and history', 'Messages and confirmations', 'Security and signatures', 'Abnormal situation handling'];
  var PASS_MARK = 80;
  var PASS_LABEL = PASS_MARK + ' % pass mark — independent training threshold, not a vendor certification';

  function T(id, group, label, drills, features) { return { id: id, group: group, label: label, drills: drills || [], features: features || [] }; }
  var ALL = ['D1', 'D2', 'D3', 'D4', 'D6', 'D9', 'D11', 'D12'];

  function tasks() {
    var G = GROUPS;
    return [
      T('nav.command', G[0], 'Call up a display or point from the command zone', ALL, ['Command zone']),
      T('nav.unit', G[0], 'Switch between the unit graphics', ['D11', 'D12'], ['Unit tabs', 'View menu']),
      T('nav.faceplate', G[0], 'Open a faceplate from a graphic point box', ALL, ['Unit graphics', 'Faceplates']),
      T('nav.detail', G[0], 'Open Point Detail for a point', ['D1', 'D6', 'D9'], ['Point Detail', 'F4', 'DETAIL button']),
      T('nav.back', G[0], 'Use display back / forward history', [], ['Toolbar ◄ ►']),
      T('nav.sys', G[0], 'Read System Status', [], ['System Status']),
      T('alm.silence', G[1], 'Silence the horn', ALL, ['F1', 'SILENCE']),
      T('alm.ack', G[1], 'Acknowledge an alarm', ALL, ['F2', 'ACK', 'Faceplate ACK']),
      T('alm.ackpage', G[1], 'Acknowledge a page of alarms', ['D2', 'D3', 'D4'], ['ACK PAGE']),
      T('alm.summary', G[1], 'Filter the Alarm Summary by location', ALL, ['Alarm Summary location pane']),
      T('alm.shelve', G[1], 'Shelve a nuisance alarm with a reason and duration', [], ['SHELVE dialog']),
      T('alm.unshelve', G[1], 'Unshelve an alarm', [], ['UNSHELVE']),
      T('alm.comment', G[1], 'Add a comment to an alarm', [], ['COMMENT dialog']),
      T('alm.help', G[1], 'Read the Alarm Help for a condition', ['D1', 'D4', 'D9'], ['ALARM HELP pane', 'Point Detail > Alarms']),
      T('alm.oos', G[1], 'Take an alarm out of service and return it (signed)', [], ['Point Detail > Alarms OOS / RTS']),
      T('alm.kpi', G[1], 'Review alarm system performance', [], ['KPI display']),
      T('ctl.mode', G[2], 'Change a controller mode (MAN / AUTO / CAS)', ['D3', 'D4', 'D6', 'D9'], ['Faceplate', 'Point Detail']),
      T('ctl.sp', G[2], 'Store a setpoint in AUTO', ['D2', 'D12'], ['Faceplate SP entry']),
      T('ctl.op', G[2], 'Store an output in MAN', ['D3', 'D4', 'D11'], ['Faceplate OP entry']),
      T('ctl.raiselower', G[2], 'Raise / lower the selected parameter', ['D2', 'D12'], ['RAISE / LOWER', 'Arrow keys']),
      T('ctl.motor', G[2], 'Start or stop a motor with its permissive', ['D3'], ['Motor faceplate']),
      T('ctl.tune', G[2], 'Change PID tuning at ENGR (signed)', [], ['Point Detail > Loop Tune']),
      T('ctl.trip', G[2], 'Change an alarm trip point (signed)', [], ['Point Detail > Alarms']),
      T('ctl.pvtrack', G[2], 'Toggle PV tracking on a loop', [], ['Point Detail > Loop Tune']),
      T('bat.start', G[3], 'Start the batch sequence', ['D11'], ['Unit 02 START']),
      T('bat.hold', G[3], 'Hold or resume the sequence', ['D11'], ['Unit 02 HOLD / RESUME']),
      T('bat.abort', G[3], 'Abort the sequence to COOL', [], ['Unit 02 ABORT']),
      T('bat.confirm', G[3], 'Confirm a sequence prompt', ['D11'], ['Message Summary CONFIRM']),
      T('trn.open', G[4], 'Open a trend group', ALL, ['TREND', 'Trend display']),
      T('trn.group', G[4], 'Change trend group or time span', ['D4', 'D12'], ['Trend chips']),
      T('trn.events', G[4], 'Read the Event Summary', ALL, ['Event Summary']),
      T('trn.evfilter', G[4], 'Filter events by type', [], ['Event Summary chips']),
      T('msg.open', G[5], 'Open the Message Summary', ALL, ['MSG', 'Message Summary']),
      T('msg.confirm', G[5], 'Confirm a message that requires it', ALL, ['Message Summary CONFIRM', 'Status bar MSG']),
      T('sec.logon', G[6], 'Log on with an operator name and level', [], ['Station security dialog']),
      T('sec.signoff', G[6], 'Sign off to view only', [], ['Station security dialog']),
      T('sec.esig', G[6], 'Sign a critical action electronically', [], ['Electronic signature dialog']),
      T('sec.moc', G[6], 'Review the change log', [], ['MOC command', 'Event Summary CONFIG']),
      T('abn.assist', G[7], 'Use the Ops Assistant guidance', ALL, ['Ops Assistant panel']),
      T('abn.drill', G[7], 'Complete a drill debrief', ALL, ['Drill debrief']),
      T('abn.pass', G[7], 'Pass a drill at the 80 % mark', ALL, ['Drill debrief']),
      T('abn.disable', G[7], 'Disable and re-enable alarms for an asset (MNGR, signed)', [], ['Alarm Summary asset pane'])
    ];
  }

  function coverage(done) {
    var has = function (id) { return !!(done && (typeof done.has === 'function' ? done.has(id) : done[id])); };
    var byGroup = {};
    tasks().forEach(function (t) {
      var g = byGroup[t.group] || (byGroup[t.group] = { name: t.group, done: 0, total: 0, rows: [] });
      var d = has(t.id);
      g.total++; if (d) g.done++;
      g.rows.push({ id: t.id, label: t.label, done: d, drills: t.drills.join(', '), features: t.features.join(' · ') });
    });
    return GROUPS.filter(function (g) { return byGroup[g]; }).map(function (g) { return byGroup[g]; });
  }

  function coverageSummary(done) {
    var d = 0, n = 0;
    coverage(done).forEach(function (g) { d += g.done; n += g.total; });
    return { done: d, total: n, pct: n ? Math.round(d / n * 100) : 0 };
  }

  function addRecord(list, rec, cap) {
    cap = cap || 20;
    list.unshift(rec);
    if (list.length > cap) list.length = cap;
    return list;
  }

  function recordFor(oper, drillId, name, result, endedT, reason) {
    return { t: endedT, oper: oper || 'OPERATOR', drill: drillId, name: name, score: result.score, pass: result.pass, passMark: result.passMark, breakdown: result.breakdown.slice(), reason: reason || '' };
  }

  var msgSeq = 1;
  function message(t, txt, opts) {
    opts = opts || {};
    return { id: msgSeq++, t: t, txt: txt, src: opts.src || 'STN01', confirm: !!opts.confirm, confirmed: false, confirmedBy: '', confirmT: 0 };
  }
  function pending(msgs) { return (msgs || []).filter(function (m) { return m.confirm && !m.confirmed; }); }

  var SIGNED_ACTIONS = ['alarm.oos', 'alarm.trip', 'alarm.priority', 'asset.disable', 'pid.tuning', 'instr.restore'];

  function configChange(what, oldV, newV, reason, who, lvl) {
    return { what: what, oldV: oldV == null ? '' : String(oldV), newV: newV == null ? '' : String(newV), reason: reason || '', who: who || 'OPERATOR', lvl: lvl || '' };
  }

  return { GROUPS: GROUPS, PASS_MARK: PASS_MARK, PASS_LABEL: PASS_LABEL, tasks: tasks, coverage: coverage, coverageSummary: coverageSummary,
    addRecord: addRecord, recordFor: recordFor, message: message, pending: pending, SIGNED_ACTIONS: SIGNED_ACTIONS, configChange: configChange };
});
