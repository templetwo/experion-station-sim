// ESS.Instructor — instructor-station data and helpers for the simulator.
//
// What a process training simulator's instructor station carries, in our own
// design: snapshots and initial conditions, an automatic backtrack ring, freeze /
// step / fast time, upsets with a hidden switch and a magnitude, instructor
// variables, an action journal that can be replayed, and live assessment
// (Forge PTS instructor feature list, RESOURCES 2.14; seeded determinism plus
// action-journal replay and snapshot / backtrack as in the cstr-ots architecture
// notes, RESOURCES 4). Pure logic: no DOM, no timers, no Component access; the
// app owns the process state and calls these helpers with plain data.
//
// API
//   create(opts)                 -> instructor state {auth, hidden, seed, seq, snapshots[8], ring, journal, replay, log}
//   resetRun(I)                  clear ring / journal / replay for a fresh process (snapshots, auth, hidden, seed stay)
//   clone(o)                     JSON deep clone (process state is plain data)
//   makeSnapshot(src, name)      -> snapshot record from {t, P, L, V, alarms, eventsCount, journalSeq, tadShed, phaseSet, disabledAssets, seed,
//                                randState, drill}; throws when P, L or V hold a non-finite number (JSON would turn it
//                                into null and a restore would corrupt the process state)
//   nonFinitePath(o, prefix)     first path holding NaN / Infinity, or null
//   pushRing(I, snap, t)         30 s ring buffer covering the last 10 sim-minutes; returns true when stored
//   ringPick(I, t, backMs)       newest ring entry at or before t - backMs (oldest if none is that old)
//   trimAfter(I, t, seq)         drop ring entries later than t and journal entries after sequence seq (time when seq is null)
//   journalAdd(I, entry)         append {t, op, tag, ...} stamped with the next sequence number; capped
//   replayPlan(I, snap, nowT)    entries journaled after the snapshot (by sequence, so actions taken while frozen at the
//                                snapshot time count) up to nowT, ordered; instructor entries (instr:true) included
//   replayDue(replay, t)         entries whose time has come, advancing the cursor
//   journalText(e, fmtT)         one-line text for a journal entry
//   presets()                    initial-condition definitions (data only)
//   upsetDefs()                  upset list with the magnitude control where meaningful
//   variableDefs()               instructor variables and their ranges
//   speeds()                     [1, 2, 5, 10]
//   RING_MS, RING_SPAN_MS, SLOTS, JOURNAL_CAP, DEFAULT_SEED
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.ESS = root.ESS || {}).Instructor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RING_MS = 30000;            // backtrack spacing, sim ms
  var RING_SPAN_MS = 600000;      // backtrack depth, sim ms
  var SLOTS = 8;                  // named snapshot slots
  var JOURNAL_CAP = 2000;
  var LOG_CAP = 200;
  var DEFAULT_SEED = 20260829;

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function create(opts) {
    opts = opts || {};
    var I = {
      auth: false,                // instructor password given this session
      hidden: false,              // upsets leave no trace in trainee displays
      seed: opts.seed || DEFAULT_SEED,
      seq: 0,                     // journal sequence counter; a snapshot records the value at save time
      snapshots: [], ring: [], journal: [], replay: null, log: [], lastRingT: -Infinity
    };
    for (var i = 0; i < SLOTS; i++) I.snapshots.push(null);
    return I;
  }

  function resetRun(I) {
    I.ring = []; I.journal = []; I.replay = null; I.lastRingT = -Infinity;
  }

  function nonFinitePath(o, prefix) {
    if (typeof o === 'number') return isFinite(o) ? null : (prefix || 'value');
    if (!o || typeof o !== 'object') return null;
    for (var k in o) {
      var hit = nonFinitePath(o[k], prefix ? prefix + '.' + k : k);
      if (hit) return hit;
    }
    return null;
  }

  function makeSnapshot(src, name) {
    var bad = nonFinitePath({ P: src.P, L: src.L, V: src.V }, '');
    if (bad) throw new Error('non-finite value at ' + bad);
    return {
      name: name || '', t: src.t, wall: src.wall || 0,
      seed: src.seed, randState: src.randState == null ? null : src.randState,
      P: clone(src.P), L: clone(src.L), V: clone(src.V),
      alarms: clone(src.alarms), eventsCount: src.eventsCount || 0, journalSeq: src.journalSeq == null ? null : src.journalSeq,
      tadShed: !!src.tadShed, phaseSet: src.phaseSet || null,
      disabledAssets: Array.isArray(src.disabledAssets) ? src.disabledAssets.slice() : [],
      drill: src.drill ? clone(src.drill) : null
    };
  }

  function pushRing(I, snap, t) {
    if (t - I.lastRingT < RING_MS) return false;
    I.lastRingT = t;
    I.ring.push(snap);
    var floor = t - RING_SPAN_MS - 1;
    while (I.ring.length && I.ring[0].t < floor) I.ring.shift();
    return true;
  }

  function ringPick(I, t, backMs) {
    if (!I.ring.length) return null;
    var want = t - backMs, best = null;
    for (var i = 0; i < I.ring.length; i++) if (I.ring[i].t <= want) best = I.ring[i];
    return best || I.ring[0];
  }

  // Journal entries are cut by sequence when the snapshot carries one: with the sim frozen, actions taken after the
  // save share its sim time, and only the sequence tells which side of the snapshot they belong to.
  function trimAfter(I, t, seq) {
    I.ring = I.ring.filter(function (s) { return s.t <= t; });
    I.journal = I.journal.filter(function (e) { return seq == null ? e.t <= t : e.seq <= seq; });
    I.lastRingT = I.ring.length ? I.ring[I.ring.length - 1].t : -Infinity;
  }

  function journalAdd(I, entry) {
    entry.seq = ++I.seq;
    I.journal.push(entry);
    if (I.journal.length > JOURNAL_CAP) I.journal.splice(0, I.journal.length - JOURNAL_CAP);
  }

  function logAdd(I, t, txt) {
    I.log.unshift({ t: t, txt: txt });
    if (I.log.length > LOG_CAP) I.log.length = LOG_CAP;
  }

  function replayPlan(I, snap, nowT) {
    var afterSnap = snap.journalSeq == null ? function (e) { return e.t > snap.t; } : function (e) { return e.seq > snap.journalSeq; };
    var list = I.journal.filter(function (e) { return afterSnap(e) && e.t <= nowT; })
      .sort(function (a, b) { return a.t - b.t || a.seq - b.seq; }).map(clone);
    return { entries: list, i: 0, fromT: snap.t, endT: list.length ? list[list.length - 1].t : snap.t, toT: nowT };
  }

  function replayDue(replay, t) {
    var due = [];
    while (replay.i < replay.entries.length && replay.entries[replay.i].t <= t) due.push(replay.entries[replay.i++]);
    return due;
  }

  function journalText(e, fmtT) {
    var tt = fmtT ? fmtT(e.t) : String(e.t);
    var body;
    switch (e.op) {
      case 'MODE': body = e.tag + ' MODE ' + e.arg; break;
      case 'STORE': body = e.tag + ' ' + e.param + ' ' + e.arg; break;
      case 'RAISE': body = e.tag + ' RAISE'; break;
      case 'LOWER': body = e.tag + ' LOWER'; break;
      case 'START': case 'STOP': body = e.tag + ' ' + e.op; break;
      case 'SEQ': body = 'SCM202 ' + e.arg; break;
      case 'ACK': body = 'ACK ' + e.arg; break;
      case 'ACKPAGE': body = 'ACK PAGE'; break;
      case 'SIL': body = 'SILENCE'; break;
      case 'SHELVE': body = 'SHELVE ' + e.arg + ' ' + e.mins + ' MIN'; break;
      case 'UNSHELVE': body = 'UNSHELVE ' + e.arg; break;
      case 'UPSET': body = 'INSTR UPSET ' + e.tag + ' ' + e.arg; break;
      case 'MAG': body = 'INSTR MAGNITUDE ' + e.tag + ' = ' + e.arg; break;
      case 'VAR': body = 'INSTR VARIABLE ' + e.tag + ' = ' + e.arg; break;
      case 'SEED': body = 'INSTR SEED ' + e.arg; break;
      case 'DRILL': body = 'INSTR DRILL ' + e.tag + ' ARMED'; break;
      case 'DRILLEND': body = 'INSTR DRILL ' + e.tag + ' ENDED'; break;
      case 'CTLACTN': body = e.tag + ' CONTROL ACTION ' + e.arg; break;
      case 'PVTRACK': body = e.tag + ' PV TRACKING ' + e.arg; break;
      case 'OOS': body = e.tag + ' ' + e.cond + (e.arg === 'ON' ? ' OUT OF SERVICE' : ' RETURN TO SERVICE'); break;
      case 'PRIO': body = e.tag + ' ' + e.cond + ' PRIORITY ' + String(e.arg).toUpperCase(); break;
      case 'COMMENT': body = 'COMMENT ' + e.arg + ': ' + e.text; break;
      case 'CONFIRM': body = 'CONFIRM MESSAGE ' + e.tag + ': ' + e.arg; break;
      case 'ASSET': body = 'ALARMS ' + (e.arg === 'ON' ? 'DISABLED' : 'RE-ENABLED') + ' FOR ASSET ' + e.tag; break;
      default: body = e.op + (e.tag ? ' ' + e.tag : '') + (e.arg != null ? ' ' + e.arg : '');
    }
    return tt + '  ' + body;
  }

  // Initial conditions as data: overrides applied to a fresh process, optionally a batch start and a
  // condition to run to (phase / level), then a settling run. The app builds the snapshot and restores it.
  function presets() {
    return [
      { id: 'U1_SS', label: 'U1 steady state', desc: 'Continuous unit at design feed, all loops on setpoint, no batch running.', run: 120 },
      { id: 'U1_HIFEED', label: 'U1 high feed', desc: 'Feed tank drawn down at a low level setpoint: throughput up, R-201 near its High limit with little jacket margin left.',
        set: { L: { LIC101: { sp: 40 } } }, run: 480 },
      { id: 'U2_FEED', label: 'U2 batch mid-FEED', desc: 'A batch started and run into the FEED phase with about half the monomer charged.',
        batch: true, waitPhase: 'FEED', waitLvl: 55, maxRun: 3600, run: 10 },
      { id: 'U2_REACT', label: 'U2 batch REACT', desc: 'A batch run through FEED into REACT: monomer inventory still high, jacket working.',
        batch: true, waitPhase: 'REACT', maxRun: 6000, run: 10 },
      { id: 'U3_HILOAD', label: 'U3 high load', desc: 'Fired reactor at raised feed and preheat: the bed hotspot sits just under its High limit, skins above design.',
        set: { L: { FIC310: { sp: 46 }, TIC311: { sp: 322 } } }, run: 480 }
    ];
  }

  // Upsets = the existing faults, each with the magnitude control that makes sense for it.
  function upsetDefs() {
    return [
      { k: 'xmtr', label: 'FIC102 transmitter failure (BADPV)', unit: 'U1' },
      { k: 'drift', label: 'LIC101 transmitter drift', unit: 'U1', mag: { key: 'drift', label: 'Drift rate', min: 0.2, max: 5, step: 0.1, eu: '% / MIN' } },
      { k: 'surge', label: 'Feed inflow surge (8 min)', unit: 'U1', mag: { key: 'surge', label: 'Surge', min: 10, max: 80, step: 5, eu: 'M3/H' } },
      { k: 'pump', label: 'P-101 pump trip (one-shot)', unit: 'U1' },
      { k: 'cool', label: 'Cooling water loss (backup in 5 min)', unit: 'U1', mag: { key: 'coolLoss', label: 'Fraction lost', min: 0.25, max: 1, step: 0.05, eu: '' } },
      { k: 'stick', label: 'TV-202 valve stiction (+ reaction load)', unit: 'U1' },
      { k: 'vap', label: 'Flash drum vapor surge (5 min)', unit: 'U1' },
      { k: 'air', label: 'Instrument air loss — valves to fail state', unit: 'ALL' },
      { k: 'rxn', label: 'Off-spec feed: reaction rate step', unit: 'U1' },
      { k: 'foul', label: 'E-301 fouling (progressive)', unit: 'U1' },
      { k: 'agit', label: 'M-202 agitator trip (one-shot)', unit: 'U2' },
      { k: 'bedact', label: 'R-310 catalyst activity step', unit: 'U3', mag: { key: 'bedact', label: 'Activity ×', min: 1.1, max: 1.6, step: 0.05, eu: '' } }
    ];
  }

  // Instructor variables: plant conditions the trainee cannot see directly. `path` names the P field.
  function variableDefs() {
    return [
      { k: 'feedConc', label: 'Feed concentration', path: 'env.feedConc', min: 0.7, max: 1.3, step: 0.01, def: 1, eu: '× design', dec: 2 },
      { k: 'cwT', label: 'Cooling water supply', path: 'Tcw', min: 4, max: 20, step: 0.5, def: 8, eu: 'DEG C', dec: 1 },
      { k: 'Tamb', label: 'Ambient temperature', path: 'env.Tamb', min: -10, max: 45, step: 1, def: 25, eu: 'DEG C', dec: 0 },
      { k: 'foulRate', label: 'E-301 fouling rate (baseline 2 %/h × this; the fouling upset runs on top)', path: 'env.foulRate', min: 0.5, max: 3, step: 0.1, def: 1, eu: '× base', dec: 1 },
      { k: 'catAct', label: 'R-310 catalyst activity', path: 'env.catAct', min: 0.7, max: 1.3, step: 0.01, def: 1, eu: '× design', dec: 2 },
      { k: 'monoPurity', label: 'Monomer purity', path: 'env.monoPurity', min: 0.8, max: 1, step: 0.01, def: 1, eu: 'fraction', dec: 2 }
    ];
  }

  function getPath(P, path) { return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, P); }
  function setPath(P, path, v) {
    var parts = path.split('.'), o = P;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = v;
  }

  function speeds() { return [1, 2, 5, 10]; }

  return {
    create: create, resetRun: resetRun, clone: clone, makeSnapshot: makeSnapshot,
    pushRing: pushRing, ringPick: ringPick, trimAfter: trimAfter,
    journalAdd: journalAdd, logAdd: logAdd, nonFinitePath: nonFinitePath, replayPlan: replayPlan, replayDue: replayDue, journalText: journalText,
    presets: presets, upsetDefs: upsetDefs, variableDefs: variableDefs, getPath: getPath, setPath: setPath, speeds: speeds,
    RING_MS: RING_MS, RING_SPAN_MS: RING_SPAN_MS, SLOTS: SLOTS, JOURNAL_CAP: JOURNAL_CAP, DEFAULT_SEED: DEFAULT_SEED
  };
});
