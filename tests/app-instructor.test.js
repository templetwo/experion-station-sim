// App-level tests for step B5-instructor: the instructor station (Forge PTS instructor
// feature list, RESOURCES 2.14) with seeded determinism, action-journal replay and
// snapshot / backtrack after the cstr-ots architecture notes (RESOURCES 4).
const test = require('node:test');
const assert = require('node:assert/strict');
const Models = require('../src/models.js');
const Instr = require('../src/instructor.js');
const { load } = require('../tools/logic-harness');

const { Component } = load();

function boot(sec) {
  const c = new Component({});
  c.initSim();
  if (sec) c.setState({ sec });
  return c;
}
function run(c, seconds) { for (let i = 0; i < seconds * 2; i++) c.step(0.5); }
const clone = (o) => JSON.parse(JSON.stringify(o));

// Walks a render object and collects every string (functions skipped); `skip` names top-level keys left out.
function strings(o, skip, out, path) {
  out = out || []; path = path || '';
  if (o == null) return out;
  if (typeof o === 'string') { out.push(path + ': ' + o); return out; }
  if (typeof o !== 'object') return out;
  for (const k of Object.keys(o)) {
    const p = path ? path + '.' + k : k;
    if (skip.includes(p)) continue;
    strings(o[k], skip, out, p);
  }
  return out;
}

test('snapshot / restore round-trips the full state: P, L, V, alarm records and sim time', () => {
  const c = boot('MNGR');
  run(c, 120);
  c.setUpset('surge', true);
  run(c, 420);
  assert.ok(c.alarms.length > 0, 'the surge produced at least one alarm before the snapshot');
  const before = { P: clone(c.P), L: clone(c.L), V: clone(c.V), n: c.alarms.length, t: c.P.t, keys: c.alarms.map((a) => a.key + ':' + a.state).sort() };
  c.saveSlot(0, 'before');
  assert.equal(c.instr.snapshots[0].name, 'before');
  assert.equal(c.instr.snapshots[0].seed, c.seed);
  run(c, 300);
  c.setMode('TIC202', 'MAN');
  assert.notEqual(c.P.t, before.t);
  assert.notDeepEqual(clone(c.P), before.P);
  c.restoreSlot(0);
  assert.deepEqual(clone(c.P), before.P);
  assert.deepEqual(clone(c.L), before.L);
  assert.deepEqual(clone(c.V), before.V);
  assert.equal(c.P.t, before.t);
  assert.equal(c.alarms.length, before.n);
  assert.deepEqual(c.alarms.map((a) => a.key + ':' + a.state).sort(), before.keys);
  assert.equal(c.L.TIC202.mode, 'CAS', 'the later mode change was undone');
  for (const t of c.histTags()) assert.ok(c.hist[t].every((r) => r[0] <= before.t), 'history truncated to the snapshot time for ' + t);
  assert.ok(c.events.every((e) => e.t <= before.t + 1), 'events after the snapshot were dropped');
  assert.equal(c.instr.snapshots.length, Instr.SLOTS);
  assert.ok(Instr.SLOTS >= 8);
});

test('backtrack ring buffer holds the last 10 sim-minutes at 30 s spacing and the buttons restore', () => {
  const c = boot('MNGR');
  run(c, 900);
  const ring = c.instr.ring;
  assert.equal(ring.length, 21, 'ten minutes at 30 s = 20 intervals + the current point');
  for (let i = 1; i < ring.length; i++) assert.equal(ring[i].t - ring[i - 1].t, 30000, 'spacing ' + i);
  assert.ok(ring[0].t >= c.P.t - 600000 - 30000, 'oldest entry inside the 10 min window (plus the current interval)');
  assert.equal(ring[ring.length - 1].t - ring[0].t, 600000, 'the ring spans exactly ten minutes');
  assert.ok(ring[ring.length - 1].t <= c.P.t);
  const now = c.P.t;
  c.backtrack(120000);
  assert.ok(now - c.P.t >= 120000 && now - c.P.t < 150000, 'restored about two minutes back: ' + (now - c.P.t));
  assert.ok(c.instr.ring.every((s) => s.t <= c.P.t), 'ring entries later than the restored time are gone');
  const after2 = c.P.t;
  c.backtrack(600000);
  assert.ok(after2 - c.P.t >= 480000, 'ten minutes back reaches the oldest available point');
});

test('freeze stops the clock, STEP advances exactly one 0.5 s tick, RUN resumes, fast time multiplies', () => {
  const c = boot('MNGR');
  run(c, 10);
  c.freeze();
  const t0 = c.P.t;
  c.tick(); c.tick();
  assert.equal(c.P.t, t0, 'frozen: the UI tick does not advance the process');
  assert.equal(c.renderVals().spdT, 'FROZEN');
  c.stepOnce();
  assert.equal(c.P.t, t0 + 500, 'STEP advances one tick');
  assert.equal(c.state.speed, 0, 'still frozen after a step');
  c.setSpeed(1); c.tick();
  assert.equal(c.P.t, t0 + 1000);
  c.setSpeed(10); c.tick();
  assert.equal(c.P.t, t0 + 6000, '10x runs ten steps per UI tick');
  assert.deepEqual(Instr.speeds(), [1, 2, 5, 10]);
});

test('replay of the action journal onto a snapshot reproduces the same PV trajectory with the same seed', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 60);
  c.setUpset('surge', true);
  run(c, 30);
  c.saveSlot(1, 'start');
  const t0 = c.P.t;
  // trainee actions at distinct sim times
  run(c, 20); c.setMode('TIC202', 'MAN');
  run(c, 20); c.storeEntry('TIC202', 'OP', 60);
  run(c, 20); c.raiseLower('TIC202', 1); c.raiseLower('TIC202', 1);
  run(c, 30); c.silence(); const a = c.alarms.find((x) => !x.ack); if (a) c.ackAlarm(a);
  run(c, 20); c.setMode('TIC202', 'CAS');
  run(c, 60); c.motorCmd('P101', false);
  run(c, 20); c.motorCmd('P101', true);
  run(c, 90);
  const t1 = c.P.t;
  const journal = clone(c.instr.journal.filter((e) => e.t > t0));
  assert.ok(journal.length >= 8, 'actions journaled: ' + journal.length);
  assert.ok(journal.every((e) => e.t >= t0 && e.t <= t1));
  assert.ok(journal.some((e) => e.op === 'MODE' && e.arg === 'MAN'));
  assert.ok(journal.some((e) => e.op === 'STORE' && e.param === 'OP'));
  assert.ok(journal.some((e) => e.op === 'START' && e.tag === 'P101'));
  const traj = (tag) => c.hist[tag].filter((r) => r[0] > t0).map((r) => r.slice());
  const orig = { TIC201: traj('TIC201'), LIC101: traj('LIC101'), TIC202: traj('TIC202') };
  const origEvents = c.events.filter((e) => e.t > t0 && e.type === 'OPERATOR').map((e) => e.t + ' ' + e.src + ' ' + e.desc + ' ' + e.oldV + ' ' + e.newV);
  const origMode = c.L.TIC202.mode, origRun = c.L.P101.run, origAlarms = c.alarms.map((x) => x.key + ':' + x.state).sort();

  c.startReplay(1);
  assert.ok(c.instr.replay, 'replay armed');
  assert.equal(c.P.t, t0, 'restored to the snapshot');
  assert.equal(c.hist.TIC201.filter((r) => r[0] > t0).length, 0);
  c.replayToEnd();
  assert.equal(c.instr.replay, null, 'replay finished');
  assert.equal(c.P.t, t1, 'replay ran to the original end time');
  for (const tag of Object.keys(orig)) assert.deepEqual(traj(tag), orig[tag], tag + ' trajectory identical after replay');
  assert.equal(c.L.TIC202.mode, origMode);
  assert.equal(c.L.P101.run, origRun);
  assert.deepEqual(c.alarms.map((x) => x.key + ':' + x.state).sort(), origAlarms);
  const replayEvents = c.events.filter((e) => e.t > t0 && e.type === 'OPERATOR').map((e) => e.t + ' ' + e.src + ' ' + e.desc + ' ' + e.oldV + ' ' + e.newV);
  assert.deepEqual(replayEvents, origEvents, 'the operator journal is reproduced');
  assert.deepEqual(clone(c.instr.journal.filter((e) => e.t > t0)), journal, 'the action journal is rebuilt identically by the replay');
});

test('a different seed gives a different trajectory; the same seed repeats it', () => {
  const trajFor = (seed) => { const c = boot('MNGR'); c.setSeed(seed); c.initSim(); run(c, 60); return c.hist.TIC201.map((r) => r[1]); };
  assert.deepEqual(trajFor(7), trajFor(7));
  assert.notDeepEqual(trajFor(7), trajFor(8));
  const c = boot('MNGR');
  assert.equal(c.seed, Instr.DEFAULT_SEED);
  assert.equal(typeof c.rand.getState, 'function');
  c.setSeed(42);
  assert.equal(c.instr.seed, 42);
  assert.equal(c.snapshotData('x').seed, 42);
});

test('hidden upset leaves no trace in the trainee-visible displays; the assistant still diagnoses symptoms', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 30);
  c.setHidden(true);
  c.setUpset('cool', true);
  c.setUpset('air', true);
  c.setVariable('cwT', 14);
  c.instr.auth = false;
  run(c, 120);
  assert.ok(c.alarms.length > 0, 'the upsets are real: alarms came in');
  assert.ok(c.events.every((e) => e.src !== 'INSTR'), 'no instructor events in the journal');
  const skip = ['menus', 'instr', 'dg.reasons', 'dg.drills'];
  const forbidden = /instructor|inject|malfunction|upset|backup in 5 min|air loss — valves/i;
  for (const display of ['graphic', 'alarms', 'events', 'msgs', 'trend', 'detail', 'sys', 'kpi', 'instr']) {
    c.setState({ display, detailTag: 'TIC202', detailTab: 'alarms' });
    const v = c.renderVals();
    assert.equal(v.isInstr, false, display + ': instructor display never renders for a trainee');
    assert.equal(v.instr.on, false);
    assert.equal(v.instr.vars, undefined, 'no instructor variables in the trainee render');
    assert.equal(v.instr.upsets, undefined);
    const hits = strings(v, skip).filter((s) => forbidden.test(s));
    assert.deepEqual(hits, [], display + ' leaks the injection');
  }
  const sys = c.renderVals().sysPanels.find((p) => p.title === 'SIMULATION ENGINE');
  assert.ok(!sys.rows.some((r) => r.k === 'Upsets'), 'System Status carries no upset row while hidden');
  c.setState({ display: 'graphic' });
  const ids = c.diagnose().map((i) => i.id);
  assert.ok(ids.includes('air'), 'the assistant infers the air loss from valves not following their outputs: ' + ids.join(','));
  // not hidden: the journal and System Status do show instructor activity
  const d = boot('MNGR');
  run(d, 10);
  d.setUpset('surge', true);
  assert.ok(d.events.some((e) => e.src === 'INSTR'));
  const sys2 = d.renderVals().sysPanels.find((p) => p.title === 'SIMULATION ENGINE');
  assert.equal(sys2.rows.find((r) => r.k === 'Upsets').v, 'SURGE');
});

test('instructor display is refused at OPER without a password and opens with instr / mngr', () => {
  const c = boot('OPER');
  run(c, 4);
  c.openInstructor();
  assert.notEqual(c.state.display, 'instr');
  assert.equal(c.renderVals().isInstr, false);
  assert.equal(c.state.dlg.type, 'logon');
  assert.equal(c.state.dlg.instr, true);
  assert.match(c.state.msg, /INSTRUCTOR/);
  assert.match(c.renderVals().dg.logonNote, /instructor password/);
  c.setState({ dlgPw: 'oper' }); c.logon();
  assert.equal(c.instructorAllowed(), false, 'an operator password does not open the station');
  c.setState({ dlg: { type: 'logon', instr: true }, dlgPw: 'instr' }); c.logon();
  assert.equal(c.state.display, 'instr');
  assert.equal(c.state.sec, 'OPER', 'the instructor password does not change the trainee security level');
  const v = c.renderVals();
  assert.equal(v.isInstr, true);
  assert.equal(v.instr.on, true);
  assert.equal(v.instr.upsets.length, Instr.upsetDefs().length);
  assert.equal(v.instr.vars.length, 6);
  assert.equal(v.instr.presets.length, 5);
  assert.equal(v.instr.slots.length, 8);
  c.lockInstructor();
  assert.equal(c.state.display, 'graphic');
  assert.equal(c.renderVals().isInstr, false);
  // SUPV is a trainee level too
  c.setState({ sec: 'SUPV' }); c.openInstructor();
  assert.notEqual(c.state.display, 'instr');
  // MNGR opens directly, and the command zone routes INSTR
  c.setState({ sec: 'MNGR', dlg: null, cmd: 'INSTR' }); c.parseCmd();
  assert.equal(c.state.display, 'instr');
  assert.equal(c.renderVals().isInstr, true);
  // the status-bar SIM link is the same gate
  c.setState({ sec: 'OPER', display: 'graphic' });
  c.renderVals().instrOpen();
  assert.equal(c.state.dlg.type, 'logon');
});

test('initial conditions are data and load through a restore: batch presets reach their phase, U1 steady state is clean', () => {
  const c = boot('MNGR');
  c.saveSlot(3, 'keep');
  c.applyPreset('U2_REACT');
  assert.equal(c.P.b.phase, 'REACT');
  assert.equal(c.state.unit, 'U2');
  assert.ok(c.instr.snapshots[3], 'saved slots survive an initial-condition load');
  assert.ok(c.events.some((e) => /INITIAL CONDITION LOADED/.test(e.desc)));
  c.applyPreset('U2_FEED');
  assert.equal(c.P.b.phase, 'FEED');
  assert.ok(c.P.b.lvl >= 55);
  c.applyPreset('U1_SS');
  assert.equal(c.alarms.filter((a) => a.active).length, 0);
  assert.equal(c.P.b.phase, 'IDLE');
  c.applyPreset('U1_HIFEED');
  assert.equal(c.L.LIC101.sp, 40);
  assert.ok(c.P.rT > 158 && c.P.rT < 170, 'reactor near its High limit: ' + c.P.rT);
  c.applyPreset('U3_HILOAD');
  assert.equal(c.L.FIC310.sp, 46);
  assert.ok(c.P.h.bed > 420 && c.P.h.bed < 440, 'bed hotspot under its High limit: ' + c.P.h.bed);
  assert.ok(c.P.h.ts2 > 384, 'tube skins above design: ' + c.P.h.ts2);
  assert.deepEqual(c.P.trips, {});
  for (const p of Instr.presets()) assert.ok(typeof p.cb === 'undefined' && typeof p.run === 'number', 'preset ' + p.id + ' is plain data');
});

test('upset magnitudes and instructor variables reach the models through P', () => {
  const c = boot('MNGR');
  run(c, 10);
  c.setMagnitude('surge', 20);
  assert.equal(c.P.mag.surge, 20);
  c.setUpset('surge', true); run(c, 30);
  assert.ok(c.P.qin > 75 && c.P.qin < 86, 'surge of 20 m3/h: ' + c.P.qin);
  c.setUpset('surge', false);
  c.setVariable('cwT', 14); assert.equal(c.P.Tcw, 14);
  c.setVariable('Tamb', 200); assert.equal(c.P.env.Tamb, 45, 'clamped to the defined range');
  c.setVariable('catAct', 1.2); assert.equal(c.variableValue('catAct'), 1.2);
  c.setVariable('feedConc', 1.1); c.setVariable('monoPurity', 0.9); c.setVariable('foulRate', 2);
  const snap = c.snapshotData('v');
  assert.equal(snap.P.env.feedConc, 1.1);
  assert.equal(snap.P.Tcw, 14);
  // drift upset: the level indication walks away from the real level
  c.setMagnitude('drift', 3); c.setUpset('drift', true); run(c, 60);
  assert.ok(c.L.LIC101.pv - c.P.tankL > 2.5, 'drift after one minute at 3 %/min: ' + (c.L.LIC101.pv - c.P.tankL));
  c.setUpset('drift', false); run(c, 2);
  assert.ok(Math.abs(c.L.LIC101.pv - c.P.tankL) < 0.5, 'clearing the upset recalibrates the transmitter');
  assert.deepEqual(Object.keys(Models.magDefaults()).sort(), ['bedact', 'coolLoss', 'drift', 'surge']);
  c.clearUpsets();
  assert.ok(Instr.upsetDefs().every((d) => !c.upsetOn(d.k)));
});

test('live assessment shows drill metrics on the instructor display and the journal text is readable', () => {
  const c = boot('MNGR');
  run(c, 30);
  const d2 = c.drillDefs().find((d) => d.id === 'D2');
  c.startDrill(d2);
  run(c, 120);
  c.setState({ display: 'instr' });
  const v = c.renderVals();
  assert.equal(v.instr.assess.on, true);
  assert.match(v.instr.assess.name, /D2/);
  assert.ok(v.instr.assess.rows.length >= 6);
  assert.equal(v.instr.assess.rows[0].k, 'First alarm');
  c.setMode('TIC202', 'MAN');
  const rows = c.renderVals().instr.journal.rows;
  assert.ok(rows.length >= 1);
  assert.match(rows[0].txt, /TIC202 MODE MAN/);
  c.endDrill('TEST');
});
