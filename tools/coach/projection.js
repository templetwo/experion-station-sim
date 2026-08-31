// @artifact dev
/*
 * TRAINEE_SAFE snapshot for the optional AI coach sidecar (tools/coach/).
 * The simulator page never fetches. This builder reads only operator-visible
 * fields: alarm list, loop PV/mode, selected alarm help, A-drill id/title.
 * It must not copy P.archFaults, fault ids, instructor journal, or hidden truth.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESS_COACH_PROJ = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function round(v) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return Math.round(v * 10) / 10;
  }

  function alarmRow(a) {
    if (!a) return null;
    return {
      tag: a.tag || '',
      cond: a.cond || '',
      prio: a.prio || '',
      state: a.state || '',
      val: round(a.val),
      eu: a.eu || '',
      desc: a.desc || ''
    };
  }

  function build(c) {
    if (!c) return { alarms: [], points: [], selected: null, help: null, drill: null };
    var S = c.state || {};
    var L = c.L || {};
    var E = c.alarmEngine;
    var recs = (E && typeof E.list === 'function') ? E.list() : [];
    var alarms = recs.slice(0, 12).map(alarmRow).filter(Boolean);
    var want = {};
    recs.forEach(function (a) { if (a && a.tag) want[a.tag] = true; });
    if (S.sel) want[S.sel] = true;
    var points = [];
    Object.keys(want).sort().slice(0, 10).forEach(function (tag) {
      var l = L[tag];
      if (!l) return;
      points.push({
        tag: tag,
        pv: round(l.pv),
        sp: round(l.sp),
        op: round(l.op),
        mode: l.mode || '',
        badPv: !!l.badPv
      });
    });
    var selected = null;
    var help = null;
    if (S.selAlm != null && E && typeof E.get === 'function') {
      selected = alarmRow(E.get(S.selAlm));
      if (selected && essHelp()) {
        var cfg = { prio: selected.prio, eu: selected.eu };
        var h = essHelp().resolve(selected.tag, selected.cond, cfg);
        if (h) {
          help = {
            priority: h.priority,
            setting: h.setting,
            responseTime: h.responseTime,
            consequence: h.consequence,
            probableCause: h.probableCause,
            correctiveAction: h.correctiveAction
          };
        }
      }
    }
    var drill = null;
    if (c.P && c.P.aDrill && c.P.aDrill.id) {
      var title = c.P.aDrill.id;
      var DA = essDrill();
      if (DA && typeof DA.drillById === 'function') {
        var def = DA.drillById(c.P.aDrill.id);
        if (def && def.title) title = def.title;
      }
      drill = { id: c.P.aDrill.id, title: title };
    }
    return {
      unit: S.unit || '',
      display: S.display || '',
      sec: S.sec || '',
      oper: (typeof c.operName === 'function' ? c.operName() : (S.oper || 'OPERATOR')),
      alarms: alarms,
      points: points,
      selected: selected,
      help: help,
      drill: drill
    };
  }

  function ess() {
    if (typeof globalThis !== 'undefined' && globalThis.ESS) return globalThis.ESS;
    if (typeof window !== 'undefined' && window.ESS) return window.ESS;
    return null;
  }
  function essHelp() { var E = ess(); return E && E.AlarmHelp; }
  function essDrill() { var E = ess(); return E && E.DrillArch; }

  return { build: build };
});
