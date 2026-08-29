// App-level tests for step B4: ESS.Models and ESS.Pid wired into the Component,
// state-based alarm limits per SCM202 phase (ISA-TR18.2.6 pattern, RESOURCES 2.19),
// the new indications (TI216, TI314/TI315, AI316, AI205), PV tracking and the
// PROGRAM mode attribute (EXP-01 control conventions, RESOURCES 2.12).
const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();

function boot(seed, sec) {
  const c = new Component({});
  c.initSim();
  c.rand = Models.createRand(seed || 1);
  if (sec) c.setState({ sec });
  return c;
}
// run through the real Component.step(); stops early when `until` returns true
function run(c, seconds, until) { for (let i = 0; i < seconds * 2; i++) { c.step(0.5); if (until && until()) return true; } return false; }
const activeKeys = (c) => c.alarms.filter((a) => a.active).map((a) => a.key);
const evs = (c, src) => c.events.filter((e) => e.src === src).map((e) => e.desc).reverse();

test('baseline: 30 sim-minutes through step() with no alarms or trips on any unit', () => {
  const c = boot(3);
  run(c, 1800);
  assert.deepEqual(activeKeys(c), []);
  assert.deepEqual(c.P.trips, {});
  assert.ok(Math.abs(c.L.TIC201.pv - 150) < 6, 'R-201 held at setpoint');
  assert.ok(c.L.AI205.pv > 78 && c.L.AI205.pv < 92, 'conversion indication ' + c.L.AI205.pv);
  assert.ok(c.L.TI314.pv < 440 && c.L.TI315.pv < 450, 'tube skins in their normal band');
  assert.ok(c.L.AI316.pv > 2 && c.L.AI316.pv < 4.5, 'excess O2 ' + c.L.AI316.pv);
  assert.equal(c.L.TI216.pv < 60, true, 'adiabatic end temperature idle');
  for (const t of c.histTags()) assert.ok(c.hist[t].length > 3000, 'history collected for ' + t);
});

test('every drill fault still produces its expected first alarm inside the drill time limit', () => {
  const defs = boot(1).drillDefs();
  assert.ok(defs.length >= 8);
  for (const def of defs) {
    const c = boot(5);
    run(c, 60);
    if (def.needBatch) {
      c.seqCmd('START', true);
      assert.ok(run(c, 2400, () => !def.when || def.when(c.P)), def.id + ': batch never reached the injection condition');
    }
    c.startDrill(def);
    assert.ok(c.state.drill && c.state.drill.def.id === def.id, def.id + ' armed');
    const hit = run(c, 720, () => !!(c.state.drill && c.state.drill.m.tAlarm));
    assert.ok(hit, def.id + ' (' + def.fault + '): no alarm on ' + def.rel.join('/') + ' within 12 min; active: ' + activeKeys(c).join(','));
    const first = c.alarmEngine.active().find((a) => def.rel.includes(a.tag));
    assert.ok(first, def.id + ': alarm on a related tag');
    c.endDrill('TEST');
  }
});

test('a batch runs CHARGE..IDLE through step(), journals a limit set per phase and returns the loops to OPERATOR', () => {
  const c = boot(4);
  c.seqCmd('START', true);
  const seen = [];
  const done = run(c, 2700, () => { const ph = c.P.b.phase; if (seen[seen.length - 1] !== ph) seen.push(ph); return ph === 'IDLE' && seen.length > 1; });
  assert.ok(done, 'batch did not complete: ' + seen.join('>'));
  assert.deepEqual(seen, ['CHARGE', 'HEATUP', 'FEED', 'REACT', 'COOL', 'DRAIN', 'IDLE']);
  assert.ok(!c.P.trips.batch, 'clean batch must not trip');
  assert.ok(!c.alarms.some((a) => a.tag === 'TIC212' || a.tag === 'TI216' || a.tag === 'LI215' || a.tag === 'FIC211'), 'no U2 alarm on a clean batch: ' + c.alarms.map((a) => a.key));
  const sets = evs(c, 'SCM202').filter((d) => d.startsWith('ALARM LIMIT SET')).map((d) => d.split(' ')[3]);
  assert.deepEqual(sets, ['CHARGE', 'HEATUP', 'FEED', 'REACT', 'COOL', 'DRAIN', 'IDLE']);
  const react = c.events.find((e) => e.src === 'SCM202' && e.desc.startsWith('ALARM LIMIT SET REACT'));
  assert.match(react.desc, /TIC212 PVHI 88/); assert.match(react.desc, /FIC211 PVLO OFF/); assert.match(react.desc, /LI215 PVLO 60/);
  assert.equal(react.oldV, 'FEED'); assert.equal(react.newV, 'REACT');
  c.step(0.5);
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
  assert.equal(c.phaseSet, 'IDLE');
});

test('state-based limits: disabled conditions leave the point, tightened ones change the trip point, Point Detail names the set', () => {
  const c = boot(2);
  const L = c.L;
  assert.equal(c.phaseSet, 'IDLE');
  assert.equal(L.LI215.alm.PVLO, undefined, 'level low off in IDLE');
  assert.equal(L.FIC211.alm.PVLO, undefined, 'monomer flow low off outside FEED');
  assert.equal(L.TIC212.alm.PVHI[0], 95);
  const force = (phase, held) => { c.P.b.phase = phase; c.P.b.held = !!held; c.syncPhaseSet(); };
  force('CHARGE');
  assert.equal(c.phaseSet, 'CHARGE');
  assert.equal(L.LI215.alm.PVLO, undefined);
  force('HEATUP');
  assert.deepEqual(L.LI215.alm.PVLO.slice(0, 2), [30, 'Low']);
  assert.ok(L.LI215.almOff.PVLO === undefined, 'no longer listed as disabled');
  force('FEED');
  assert.deepEqual(L.FIC211.alm.PVLO.slice(0, 2), [8, 'Low'], 'flow low active in FEED');
  assert.equal(L.FIC211.alm.PVHI[0], 28);
  force('FEED', true);
  assert.equal(c.phaseSet, 'HELD');
  assert.equal(L.FIC211.alm.PVLO, undefined, 'a held feed is not a low-flow alarm');
  assert.equal(L.FIC211.alm.PVHI[0], 8, 'flow while held is abnormal');
  force('REACT');
  assert.equal(L.TIC212.alm.PVHI[0], 88); assert.equal(L.TIC212.alm.PVHH[0], 100);
  assert.equal(L.TI216.alm.PVHI[0], 98);
  assert.deepEqual(L.LI215.alm.PVLO.slice(0, 2), [60, 'Low']);
  // an alarm that is active when its condition is disabled returns to normal
  L.LI215.pv = 20; c.L.LI215.almDelay = 0;
  c.scan(0.5);
  assert.ok(c.alarms.some((a) => a.key === 'LI215.PVLO' && a.active));
  force('DRAIN');
  const r = c.alarmEngine.get('LI215.PVLO');
  assert.equal(r.active, false, 'disabled condition cleared');
  assert.equal(L.LI215.almOff.PVLO[0], 60, 'kept for display as DISABLED');
  assert.ok(c.events.some((e) => e.src === 'SCM202' && e.desc.startsWith('ALARM LIMIT SET DRAIN') && /LI215 PVLO OFF/.test(e.desc)));
  // Point Detail > Alarms shows the phase set and the disabled row
  c.setState({ display: 'detail', detailTag: 'LI215', detailTab: 'alarms' });
  const v = c.renderVals();
  assert.match(v.dpt.almNote, /Phase set: DRAIN/);
  const off = v.dpt.almRows.find((x) => x.cond === 'PVLO');
  assert.equal(off.state, 'DISABLED'); assert.match(off.note, /phase set DRAIN/);
  assert.equal(v.dpt.almRows.find((x) => x.cond === 'PVHI').state, 'NORMAL');
  // every phase set names only configured points and conditions with alarm help
  for (const [ph, set] of Object.entries(c.phaseSets())) for (const tag in set) { assert.ok(c.L[tag], ph + ' ' + tag); for (const cond in set[tag]) assert.equal(c.alarmHelpFor(tag, cond).found, true, ph + ' ' + tag + '.' + cond + ' has alarm help'); }
});

test('PROGRAM mode attribute: operator SP / OP / MODE stores are rejected with a callout and a journal entry while the sequence owns the loop', () => {
  const c = boot(2, 'OPER');
  c.seqCmd('START', true);
  c.step(0.5);
  assert.equal(c.L.TIC212.modeAttr, 'PROGRAM');
  const spBefore = c.L.TIC212.sp, modeBefore = c.L.TIC212.mode;
  c.openEntry('TIC212', 'SP');
  assert.equal(c.state.entry, null, 'entry field never opened');
  assert.match(c.state.msg, /PROGRAM/);
  c.setMode('TIC212', 'MAN');
  assert.equal(c.L.TIC212.mode, modeBefore);
  c.raiseLower('TIC212', 1);
  assert.equal(c.L.TIC212.sp, spBefore);
  const rej = c.events.filter((e) => e.src === 'TIC212' && e.type === 'OPERATOR' && /WRITE REJECTED/.test(e.desc));
  assert.equal(rej.length, 3, 'three rejections journaled');
  assert.match(rej[0].desc, /MODE ATTRIBUTE PROGRAM/);
  // engineering parameters stay writable
  c.setState({ sec: 'ENGR' });
  c.openEntry('TIC212', 'K');
  assert.deepEqual(c.state.entry, { tag: 'TIC212', param: 'K' });
  c.setState({ entry: null });
  // callout on the faceplate and the detail display, gone after about 5 s
  c.openFp('TIC212');
  c.setState({ display: 'detail', detailTag: 'TIC212', detailTab: 'main' });
  let v = c.renderVals();
  assert.equal(v.fps[0].calloutOn, true); assert.match(v.fps[0].calloutT, /PROGRAM/); assert.equal(v.fps[0].frameBc, '#CC0000');
  assert.equal(v.dpt.calloutOn, true); assert.notEqual(v.dpt.mainRows.find((r) => r.param === 'SP').rowBg, 'transparent');
  run(c, 6);
  v = c.renderVals();
  assert.equal(v.fps[0].calloutOn, false); assert.equal(v.dpt.calloutOn, false);
  // when the sequence ends the attribute returns to OPERATOR and the store is accepted
  c.setState({ sec: 'OPER' });
  c.seqCmd('ABORT');
  c.P.b.phase = 'IDLE'; c.step(0.5);
  assert.equal(c.L.TIC212.modeAttr, 'OPERATOR');
  c.setMode('TIC212', 'AUTO');
  c.openEntry('TIC212', 'SP');
  assert.deepEqual(c.state.entry, { tag: 'TIC212', param: 'SP' });
});

test('PV tracking makes MAN -> AUTO bumpless (OP continuous, no step above 1 %) and defaults on for the cascade secondaries', () => {
  const c = boot(7, 'ENGR');
  for (const t of ['FIC102', 'TIC202', 'TIC213']) assert.equal(c.L[t].pvtrack, true, t + ' tracks by default');
  for (const t of ['LIC101', 'TIC201', 'TIC301', 'PIC401']) assert.equal(c.L[t].pvtrack, false, t);
  // LIC401 has no derivative term, so the transfer is judged on P + I alone (TIC301's derivative-on-PV jitters with measurement noise in every mode)
  const l = c.L.LIC401;
  c.setPvTrack('LIC401', true);
  c.setMode('LIC401', 'MAN');
  l.op = 60; l.I = 60;
  run(c, 240);
  assert.ok(Math.abs(l.sp - l.pv) < 0.5, 'SP followed PV in MAN: sp ' + l.sp + ' pv ' + l.pv);
  const opBefore = l.op;
  c.setMode('LIC401', 'AUTO');
  let maxStep = 0, prev = opBefore;
  for (let i = 0; i < 20; i++) { c.step(0.5); maxStep = Math.max(maxStep, Math.abs(l.op - prev)); prev = l.op; }
  assert.ok(maxStep < 1, 'largest OP step after transfer ' + maxStep.toFixed(3) + ' %');
  assert.ok(Math.abs(l.op - opBefore) < 1.5, 'OP continuous across the transfer');
  // without tracking the same transfer carries the accumulated error into the first AUTO output
  const d = boot(7, 'ENGR');
  const m = d.L.LIC401;
  d.setMode('LIC401', 'MAN'); m.op = 60; m.I = 60;
  run(d, 240);
  assert.ok(Math.abs(m.sp - m.pv) > 2, 'SP stayed put without tracking: sp ' + m.sp + ' pv ' + m.pv);
  d.setMode('LIC401', 'AUTO');
  const o0 = m.op; run(d, 30);
  assert.ok(Math.abs(m.op - o0) > 1, 'controller works off the standing error');
});

test('TI216 Urgent sheds the monomer feed and holds the sequence; the assistant explains it', () => {
  const c = boot(6);
  c.seqCmd('START', true);
  assert.ok(run(c, 2400, () => c.P.b.phase === 'FEED' && c.P.b.Cm > 8), 'reached FEED');
  c.injectFault('agit', true);
  assert.ok(run(c, 600, () => c.tadShed), 'TI216 interlock latched; alarms ' + activeKeys(c));
  assert.ok(c.alarms.some((a) => a.key === 'TI216.PVHH' && a.active));
  assert.equal(c.L.FIC211.mode, 'MAN'); assert.equal(c.L.FIC211.op, 0);
  assert.equal(c.P.b.held, true);
  assert.equal(c.phaseSet, 'HELD');
  assert.ok(c.events.some((e) => e.type === 'SYSTEM' && e.src === 'TI216' && /FIC211 SHED/.test(e.desc) && /HOLD/.test(e.desc)));
  assert.ok(c.diagnose().some((i) => i.id === 'shed.tad'));
  run(c, 20);
  assert.ok(c.V.MV211.pos < 0.02, 'monomer valve closed');
  assert.ok(c.renderVals().tv !== undefined);
  c.setState({ tg: 'TG04', display: 'trend' });
  assert.ok(c.renderVals().tv.pens.some((p) => p.label === 'TI216.PV'));
});

test('tube-skin Urgent trips the fuel like the bed trip; a fast fuel step drops excess O2 into its Low alarm', () => {
  const c = boot(2, 'OPER');
  run(c, 60);
  c.L.TIC311.mode = 'MAN'; c.L.TIC311.op = 100;
  assert.ok(run(c, 300, () => c.P.trips.skin), 'skin trip; alarms ' + activeKeys(c));
  assert.ok(c.alarms.some((a) => a.key === 'H-310.TUBE SKIN TRIP' && a.active));
  assert.ok(c.alarms.some((a) => (a.key === 'TI315.PVHH' || a.key === 'TI314.PVHH')));
  assert.ok(c.alarms.some((a) => a.key === 'AI316.PVLO'), 'O2 low while the register lagged');
  run(c, 12);
  assert.ok(c.V.FV311.pos < 0.05, 'fuel valve closed by the skin trip: ' + c.V.FV311.pos);
  assert.ok(c.diagnose().some((i) => i.id === 'trip.skin'));
  assert.ok(run(c, 600, () => !c.P.trips.skin), 'trip resets once both skins are below 400 C');
  assert.equal(c.alarmHelpFor('H-310', 'TUBE SKIN TRIP').found, true);
  c.setState({ tg: 'TG05', display: 'trend' });
  const pens = c.renderVals().tv.pens.map((p) => p.label);
  assert.ok(pens.includes('TI314.PV') && pens.includes('TI315.PV'));
  c.setState({ display: 'graphic', unit: 'U3' });
  const tags = c.renderVals().gv3.map((p) => p.tag);
  for (const t of ['TI314', 'TI315', 'AI316']) assert.ok(tags.includes(t), t + ' on the U3 graphic');
  c.setState({ unit: 'U2' });
  assert.ok(c.renderVals().gv2.some((p) => p.tag === 'TI216'));
  c.setState({ unit: 'U1' });
  assert.ok(c.renderVals().gvList.some((p) => p.tag === 'AI205'));
});

// ---- verification round 1: TI216 interlock is level-held and the batch is recoverable without ABORT ----
function shedBatch(seed) {
  const c = boot(seed, 'OPER');
  c.seqCmd('START', true);
  assert.ok(run(c, 2400, () => c.P.b.phase === 'FEED' && c.P.b.Cm > 8), 'reached FEED');
  c.injectFault('agit', true);
  assert.ok(run(c, 600, () => c.tadShed), 'TI216 interlock latched; alarms ' + activeKeys(c));
  return c;
}

test('TI216 interlock is level-held: AUTO and RESUME are refused while the Urgent alarm stands and the feed cannot restart', () => {
  const c = shedBatch(6);
  c.step(0.5);
  assert.equal(c.P.b.held, true);
  const nEv = c.events.length;
  c.setMode('FIC211', 'AUTO');
  assert.equal(c.L.FIC211.mode, 'MAN', 'interlock keeps FIC211 in MAN');
  assert.match(c.calloutOf('FIC211'), /TI216 URGENT INTERLOCK/);
  assert.ok(c.events.slice(0, c.events.length - nEv).some((e) => e.type === 'OPERATOR' && e.src === 'FIC211' && /WRITE REJECTED/.test(e.desc)));
  c.seqCmd('HOLD');                                   // RESUME attempt
  assert.equal(c.P.b.held, true, 'RESUME refused while the interlock stands');
  assert.match(c.state.msg, /RESUME REFUSED/);
  assert.ok(c.events.some((e) => e.src === 'SCM202' && /RESUME REFUSED/.test(e.desc)));
  c.openEntry('FIC211', 'OP'); c.setState({ entryText: '50' }); c.commitEntry();
  assert.equal(c.L.FIC211.op, 0);
  assert.ok(c.diagnose().some((i) => i.id === 'shed.tad' && /HELD/.test(i.title)));
  let checked = 0;
  while (c.L.TI216._as.PVHH && checked < 120) {           // every scan while the Urgent alarm stands
    c.step(0.5); checked++;
    assert.equal(c.L.FIC211.mode, 'MAN'); assert.equal(c.L.FIC211.op, 0); assert.equal(c.L.FIC211.sp, 0);
    if (checked > 24) assert.ok(c.P.b.mf < 1, 'no monomer flows once MV-211 has closed (3 s lag): ' + c.P.b.mf);
    assert.equal(c.P.b.held, true);
  }
  assert.ok(checked > 24, 'interlock stood long enough to observe the closed valve: ' + checked);
  assert.ok(c.V.MV211.pos < 0.02, 'MV-211 closed');
});

test('after a TI216 shed clears, RESUME lets the SCM restore FIC211 to AUTO and the batch completes without ABORT', () => {
  const c = shedBatch(6);
  run(c, 5);
  assert.ok(run(c, 600, () => c.L.M202.lock <= 0), 'lockout expired');
  c.motorCmd('M202', true);
  assert.equal(c.L.M202.run, true, 'agitator restarted');
  assert.ok(run(c, 1800, () => !c.tadShed), 'interlock released; alarms ' + activeKeys(c));
  assert.ok(c.events.some((e) => e.type === 'SYSTEM' && e.src === 'TI216' && /SHED RELEASED/.test(e.desc) && /RESUME PERMITTED/.test(e.desc)));
  assert.equal(c.P.b.held, true, 'sequence stays held until the operator resumes');
  assert.equal(c.L.FIC211.mode, 'MAN', 'the shed left FIC211 in MAN');
  c.seqCmd('HOLD');                                   // RESUME
  assert.equal(c.P.b.held, false);
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  assert.equal(c.L.FIC211.mode, 'AUTO', 'SCM restored the loop mode it owns');
  assert.ok(c.events.some((e) => e.type === 'SYSTEM' && e.src === 'SCM202' && /FIC211 MODE RESTORED BY SEQUENCE \(MAN → AUTO\)/.test(e.desc)));
  assert.ok(run(c, 300, () => c.P.b.mf > 5), 'monomer feed resumed: ' + c.P.b.mf);
  assert.ok(run(c, 4800, () => c.P.b.phase === 'REACT'), 'FEED completed');
  assert.ok(run(c, 7200, () => c.P.b.phase === 'IDLE'), 'batch completed; phase ' + c.P.b.phase);
  assert.ok(!c.P.trips.batch, 'no R-202 trip');
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
});

test('TI216 Urgent outside FEED sheds the feed but journals no HOLD', () => {
  const c = boot(3);
  c.P.b.phase = 'REACT'; c.syncPhaseSet();
  c.L.TI216.pv = 150; c.L.TI216.almDelay = 0;
  c.scan(0.5); c.interlocks();
  assert.equal(c.tadShed, true);
  assert.equal(c.P.b.held, false);
  const ev = c.events.find((e) => e.src === 'TI216' && /SHED/.test(e.desc));
  assert.ok(ev && !/HOLD/.test(ev.desc), 'event: ' + (ev && ev.desc));
  assert.doesNotMatch(c.state.msg, /HELD/);
  assert.ok(c.diagnose().some((i) => i.id === 'shed.tad' && !/HELD/.test(i.title)));
});

test('tube-skin trip reset threshold is 400 DEG C in the model, the assistant and the alarm help', () => {
  const c = boot(2, 'OPER');
  run(c, 60);
  c.L.TIC311.mode = 'MAN'; c.L.TIC311.op = 100;
  assert.ok(run(c, 300, () => c.P.trips.skin), 'skin trip');
  const rule = c.diagnose().find((i) => i.id === 'trip.skin');
  assert.match(rule.why, /below 400 °C/);
  const h = c.alarmHelpFor('H-310', 'TUBE SKIN TRIP');
  assert.match(h.consequence, /below 400 DEG C/);
  assert.doesNotMatch(rule.why + h.consequence + h.correctiveAction, /420/);
  c.L.TIC311.op = 0;
  assert.ok(run(c, 900, () => !c.P.trips.skin), 'trip reset');
  assert.ok(c.P.h.ts1 < 400 && c.P.h.ts2 < 400, 'reset only once both skins are below 400: ' + c.P.h.ts1 + ' / ' + c.P.h.ts2);
});

test('M202-trip advice tells the operator to HOLD (FIC211 is program-owned during FEED) and its GO opens the U2 graphic', () => {
  const c = boot(4, 'OPER');
  c.seqCmd('START', true);
  assert.ok(run(c, 2400, () => c.P.b.phase === 'FEED' && c.P.b.Cm > 8), 'reached FEED');
  c.injectFault('agit', true);
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM');
  c.setMode('FIC211', 'MAN');
  assert.equal(c.L.FIC211.mode, 'AUTO', 'MAN store rejected under PROGRAM');
  const rule = c.diagnose().find((i) => i.id === 'mtrip.M202');
  assert.match(rule.steps[0].t, /HOLD the sequence/);
  assert.doesNotMatch(rule.steps[0].t, /FIC211 to MAN/);
  c.setState({ unit: 'U1', display: 'alarms' });
  rule.steps[0].go();
  assert.equal(c.state.unit, 'U2'); assert.equal(c.state.display, 'graphic');
  const acc = c.diagnose().find((i) => i.id === 'risk.acc');
  if (acc) assert.match(acc.steps[0].t, /HOLD the sequence/);
  c.seqCmd('HOLD');
  assert.equal(c.P.b.held, true);
  assert.equal(c.L.FIC211.modeAttr, 'PROGRAM', 'attribute follows on the next scan');
  c.step(0.5);
  assert.equal(c.L.FIC211.modeAttr, 'OPERATOR');
});
