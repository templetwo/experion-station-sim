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
  assert.ok(Math.abs((now - c.P.t) - 120000) <= Instr.RING_MS / 2, 'restored about two minutes back: ' + (now - c.P.t));
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
  const noSeq = (list) => list.map((e) => { const o = clone(e); delete o.seq; return o; });
  assert.deepEqual(noSeq(c.instr.journal.filter((e) => e.t > t0)), noSeq(journal), 'the action journal is rebuilt identically by the replay (sequence numbers are fresh)');
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
  const forbidden = /instructor|inject|malfunction|upset|backup in \d+ min|air loss — valves/i;
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

// --- verification round 1 regressions

test('replay reproduces instructor interventions made after the snapshot (upset, magnitude, variable)', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 30);
  c.saveSlot(2, 'quiet');
  const t0 = c.P.t;
  run(c, 1); c.setMagnitude('surge', 30); c.setUpset('surge', true);
  run(c, 60); c.setVariable('cwT', 14);
  run(c, 360);
  const sig = () => c.alarms.map((a) => a.key + ':' + a.state).sort();
  const orig = sig();
  assert.ok(orig.length > 0, 'the surge raised alarms');
  c.setMode('TIC202', 'MAN');
  run(c, 10);
  const t1 = c.P.t, origPv = c.hist.LIC101.filter((r) => r[0] > t0).map((r) => r[1]);
  const instrEntries = c.instr.journal.filter((e) => e.instr);
  assert.deepEqual(instrEntries.map((e) => e.op), ['MAG', 'UPSET', 'VAR']);
  assert.ok(instrEntries.every((e) => e.t > t0));
  c.startReplay(2);
  assert.ok(!c.P.faults.surge, 'restored to the quiet snapshot');
  assert.equal(c.P.Tcw, 8);
  c.replayToEnd();
  assert.equal(c.P.t, t1);
  assert.equal(c.P.faults.surge, true, 'the upset is re-injected by the replay');
  assert.equal(c.P.mag.surge, 30);
  assert.equal(c.P.Tcw, 14);
  assert.deepEqual(sig(), orig, 'the alarm picture is reproduced');
  assert.deepEqual(c.hist.LIC101.filter((r) => r[0] > t0).map((r) => r[1]), origPv, 'the LIC101 trajectory is reproduced');
  c.setState({ display: 'instr' });
  assert.ok(c.renderVals().instr.journal.rows.some((r) => /INSTR UPSET surge ON/.test(r.txt)), 'instructor rows read in the journal list');
});

test('instructor variables, magnitudes and the seed never reach the trainee journal, hidden or not', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 10);
  assert.equal(c.instr.hidden, false);
  c.setVariable('cwT', 14);
  c.setMagnitude('coolLoss', 0.5);
  c.setSeed(77);
  c.instr.auth = false;
  c.setState({ display: 'events' });
  const rows = c.renderVals().evR.map((r) => r.src + ' ' + r.desc);
  assert.ok(rows.every((r) => !/VARIABLE|MAGNITUDE|SEED|COOLING WATER SUPPLY/.test(r)), rows.join(' | '));
  assert.ok(c.events.every((e) => e.src !== 'INSTR'));
  assert.ok(c.instr.log.some((e) => /VARIABLE COOLING WATER SUPPLY = 14.0 DEG C/.test(e.txt)), 'the instructor log keeps it');
  assert.ok(c.instr.log.some((e) => /UPSET MAGNITUDE COOLLOSS = 0.5/.test(e.txt)));
  assert.ok(c.instr.log.some((e) => /RANDOM SEED SET 77/.test(e.txt)));
});

test('actions taken while frozen at the snapshot time replay; actions journaled before the save do not', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 30);
  c.setMode('TIC202', 'MAN');            // before the save: part of the snapshot state
  c.freeze();
  c.saveSlot(0, 'frozen');
  const snap = c.instr.snapshots[0];
  assert.equal(typeof snap.journalSeq, 'number');
  c.storeEntry('TIC202', 'OP', 30);      // after the save, same sim time
  assert.equal(c.instr.journal[c.instr.journal.length - 1].t, snap.t);
  c.setSpeed(1); run(c, 60);
  const op = c.L.TIC202.op, pv = c.hist.TIC202.map((r) => r[1]);
  c.startReplay(0);
  assert.ok(c.instr.replay, 'replay armed: ' + c.state.msg);
  assert.deepEqual(c.instr.replay.entries.map((e) => e.op), ['STORE'], 'only the entry after the save is replayed');
  assert.equal(c.instr.journal.filter((e) => e.op === 'MODE').length, 1, 'the earlier MODE entry survives the restore untouched');
  c.replayToEnd();
  assert.equal(c.L.TIC202.mode, 'MAN');
  assert.equal(c.L.TIC202.op, op);
  assert.deepEqual(c.hist.TIC202.map((r) => r[1]), pv);
  assert.deepEqual(c.instr.journal.map((e) => e.op), ['MODE', 'STORE'], 'no duplicate entries after the replay');
});

test('loading an initial condition disarms a pending drill so its fault is not baked into the condition', () => {
  const c = boot('MNGR');
  run(c, 40);
  c.startDrill(c.drillDefs().find((d) => d.id === 'D4'));
  assert.ok(c.state.drill);
  c.applyPreset('U1_SS');
  assert.equal(c.state.drill, null);
  assert.ok(!c.P.faults.cool, 'no cooling-loss fault in the loaded condition');
  assert.ok(Object.values(c.P.faults).every((v) => !v), 'no fault at all');
  assert.equal(c.alarms.filter((a) => a.active).length, 0);
  assert.equal(c.instr.replay, null);
});

test('switching HIDDEN UPSETS on scrubs instructor events already mirrored into the trainee journal', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 10);
  c.setUpset('rxn', true);
  assert.ok(c.events.some((e) => e.src === 'INSTR' && /UPSET ON/.test(e.desc)), 'mirrored while not hidden');
  c.setHidden(true);
  assert.ok(c.events.every((e) => e.src !== 'INSTR'));
  c.setState({ display: 'events' });
  const rows = c.renderVals().evR.map((r) => r.src + ' ' + r.desc);
  assert.ok(rows.every((r) => !/INSTR|UPSET|reaction rate/i.test(r)), rows.join(' | '));
  assert.match(c.instr.log[0].txt, /HIDDEN UPSETS ON — 1 INSTR EVENTS REMOVED/);
  const sys = c.renderVals().sysPanels.find((p) => p.title === 'SIMULATION ENGINE');
  assert.ok(!sys.rows.some((r) => r.k === 'Upsets'));
});

test('the security gate stays in force for live input while a replay runs; replayed entries bypass it', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 30);
  c.saveSlot(0, 'a');
  run(c, 10); c.setMode('TIC202', 'MAN');
  run(c, 60);
  c.setState({ sec: 'VIEW' });
  c.startReplay(0);
  assert.ok(c.instr.replay);
  c.setMode('TIC201', 'MAN');
  assert.equal(c.L.TIC201.mode, 'AUTO', 'VIEW cannot change a mode live during the replay');
  assert.match(c.state.msg, /HIGHER SECURITY LEVEL REQUIRED/);
  assert.ok(!c.instr.journal.some((e) => e.tag === 'TIC201'), 'the refused action is not journaled');
  c.replayToEnd();
  assert.equal(c.L.TIC202.mode, 'MAN', 'the replayed MODE entry was applied although the live level is VIEW');
  assert.equal(c._replayApplying, false);
});

// ---------------------------------------------------------------- verification round 2

test('the R-310 bed stays finite and recovers after the trip across the offered catalyst activity and upset ranges', () => {
  const vDef = Instr.variableDefs().find((d) => d.k === 'catAct');
  const uDef = Instr.upsetDefs().find((d) => d.k === 'bedact').mag;
  const cases = [];
  for (const cat of [vDef.min, 1, vDef.max]) for (const mag of [uDef.min, 1.35, uDef.max]) cases.push({ cat, mag, preset: false });
  cases.push({ cat: 1, mag: 1.35, preset: true });
  cases.push({ cat: vDef.max, mag: uDef.max, preset: true });
  for (const k of cases) {
    const c = boot('MNGR');
    if (k.preset) c.applyPreset('U3_HILOAD'); else run(c, 30);
    c.setVariable('catAct', k.cat); c.setMagnitude('bedact', k.mag); c.setUpset('bedact', true);
    let peak = 0, tripped = false, reset = false;
    for (let i = 0; i < 2400; i++) {
      c.step(0.5);
      assert.ok(Number.isFinite(c.P.h.bed), `bed non-finite at ${i / 2} s for ${JSON.stringify(k)}`);
      peak = Math.max(peak, c.P.h.bed);
      if (c.P.trips.bed) tripped = true; else if (tripped) reset = true;
    }
    assert.ok(peak < 800, `bed peak ${peak} for ${JSON.stringify(k)}`);
    if (k.cat * k.mag >= 1.3) assert.ok(tripped && reset, `trip and reset expected for ${JSON.stringify(k)}: ${tripped} ${reset}`);
    assert.ok(Number.isFinite(c.L.TI312.pv));
    assert.ok(c.snapshotData('ok'), 'a snapshot of a finite state is accepted');
  }
});

test('a snapshot of a non-finite process state is refused instead of being cloned to null', () => {
  const c = boot('MNGR');
  run(c, 5);
  c.P.h.bed = NaN;
  assert.equal(Instr.nonFinitePath({ P: c.P }, ''), 'P.h.bed');
  assert.throws(() => Instr.makeSnapshot({ t: c.P.t, P: c.P, L: c.L, V: c.V, alarms: [] }, 'x'), /non-finite value at P\.h\.bed/);
  c.saveSlot(0, 'bad');
  assert.equal(c.instr.snapshots[0], null);
  assert.match(c.state.msg, /SNAPSHOT REFUSED/);
  assert.match(c.instr.log[0].txt, /SNAPSHOT REFUSED — NON-FINITE VALUE AT P\.H\.BED/);
  const ringBefore = c.instr.ring.length;
  run(c, 31);
  assert.equal(c.instr.ring.length, ringBefore, 'the backtrack ring skips a non-finite state');
});

test('a drill armed after the snapshot is journaled and replayed; a snapshot taken during a drill keeps it', () => {
  const c = boot('MNGR');
  run(c, 60);
  c.saveSlot(0, 'pre-drill');
  run(c, 10);
  c.startDrill(c.drillDefs().find((d) => d.id === 'D4'));
  const armed = c.instr.journal.find((e) => e.op === 'DRILL');
  assert.ok(armed && armed.tag === 'D4' && armed.instr === true);
  run(c, 60);
  assert.ok(c.state.drill && c.state.drill.injected && c.P.faults.cool);
  c.saveSlot(1, 'mid-drill');
  assert.equal(c.instr.snapshots[1].drill.id, 'D4');
  c.setMode('TIC202', 'MAN');
  run(c, 120);
  const live = { rT: c.P.rT, faults: clone(c.P.faults), m: clone(c.state.drill.m), hist: clone(c.hist.TIC201) };
  c.startReplay(0);
  assert.equal(c.state.drill, null, 'the pre-drill snapshot carries no drill');
  c.replayToEnd();
  assert.equal(c.instr.replay, null);
  assert.ok(c.state.drill && c.state.drill.injected, 'the replay armed and injected the drill');
  assert.deepEqual(c.P.faults, live.faults);
  assert.equal(c.P.rT, live.rT);
  assert.deepEqual(c.state.drill.m, live.m);
  assert.deepEqual(c.hist.TIC201, live.hist);
  assert.ok(c.instr.journal.some((e) => e.op === 'DRILL' && e.tag === 'D4'), 'the drill is journaled again by the replay');
  c.restoreSlot(1);
  assert.ok(c.state.drill && c.state.drill.def.id === 'D4' && c.state.drill.injected, 'restoring a mid-drill snapshot keeps the running drill');
  assert.ok(c.P.faults.cool);
  c.endDrill('ENDED BY INSTRUCTOR');
  assert.ok(c.instr.journal.some((e) => e.op === 'DRILLEND' && e.tag === 'D4'));
  assert.equal(c.state.drill, null);
  assert.match(Instr.journalText(armed, (t) => String(t)), /INSTR DRILL D4 ARMED/);
});

test('the instructor logon accepts only the instructor passwords and never changes the security level', () => {
  const c = boot('OPER');
  for (const pw of ['supv', 'engr', 'mngrx', 'oper']) {
    c.setState({ cmd: 'INSTR' }); c.parseCmd();
    assert.ok(c.state.dlg && c.state.dlg.instr, 'instructor logon prompt');
    c.setState({ dlgPw: pw }); c.logon();
    assert.equal(c.state.sec, 'OPER', pw + ' must not change the level');
    assert.equal(c.instr.auth, false);
    assert.match(c.state.msg, /INVALID PASSWORD/);
    assert.ok(c.state.dlg, 'the prompt stays open');
    c.setState({ dlg: null });
  }
  c.setState({ cmd: 'INSTR' }); c.parseCmd();
  c.setState({ dlgPw: 'instr' }); c.logon();
  assert.equal(c.instr.auth, true);
  assert.equal(c.state.sec, 'OPER');
  assert.equal(c.state.display, 'instr');
  const d = boot('OPER');
  d.setState({ dlg: { type: 'logon' }, dlgPw: 'supv' }); d.logon();
  assert.equal(d.state.sec, 'SUPV', 'the ordinary logon still changes the level');
});

test('RANDOM DRILL draws from the seeded generator', () => {
  const orig = Math.random;
  Math.random = () => { throw new Error('unseeded draw'); };
  try {
    const pick = (seed) => { const c = boot('MNGR'); c.setSeed(seed); run(c, 5); c.setState({ dlg: { type: 'drills' } }); c.renderVals().dg.randomDrill(); return c.state.drill.def.id; };
    const ids = new Set();
    for (let s = 1; s <= 12; s++) { const a = pick(s); assert.equal(a, pick(s), 'same seed, same drill'); ids.add(a); }
    assert.ok(ids.size > 1, 'different seeds pick different drills');
  } finally { Math.random = orig; }
});

test('with HIDDEN UPSETS on, arming a drill leaves no trace in the trainee Message Summary', () => {
  const c = boot('MNGR');
  c.instr.auth = true;
  run(c, 5);
  c.setHidden(true);
  c.startDrill(c.drillDefs()[3]);
  c.lockInstructor();
  c.setState({ display: 'msgs' });
  const v = c.renderVals();
  assert.equal(v.msgsR.length, 0, 'nothing in the Message Summary');
  const txt = strings(v, ['instr', 'dg.drills']).join(' | ');   // the drill picker lists every definition by design
  assert.ok(!/drill D4|D4 armed|DRILL D4/i.test(txt), txt.match(/.{0,40}(drill D4|D4 armed|DRILL D4).{0,40}/i));   // the DRILL IN PROGRESS banner may show; the drill's identity may not
  assert.ok(!c.msgs.some((m) => /drill/i.test(m.txt)));
  assert.ok(c.instr.log.some((l) => /DRILL D4 ARMED/.test(l.txt)), "the instructor log still names it");
  const d = boot('MNGR');
  run(d, 5);
  d.startDrill(d.drillDefs()[3]);
  assert.match(d.msgs[0].txt, /^INSTRUCTOR: drill D4 armed/, 'not hidden: the trainee is told');
  assert.equal(d.msgs[0].confirm, true, 'the instructor message asks for a confirm (B6)');
});

// ---- residual verifier findings (B5 round 3) ----
test('action journal is complete: one of every operator, engineer, manager and instructor action replays to identical trajectories, alarm and event counts', () => {
  const c = boot('MNGR');
  c.instr.auth = true;
  run(c, 30);
  c.saveSlot(3, 'complete');
  const t0 = c.P.t;
  const sign = (pw, why) => { assert.equal(c.state.dlg && c.state.dlg.type, 'esig', 'signature requested'); c.setState({ dlgPw: pw, dlgReason: why }); assert.ok(c.signAction()); };
  run(c, 5);  c.setUpset('cool', true); c.setVariable('feedConc', 1.1); c.setMagnitude('coolLoss', 0.8);        // instructor
  run(c, 5);  c.setMode('TIC202', 'MAN'); c.storeEntry('TIC202', 'OP', 55); c.raiseLower('TIC202', 1);          // operator control
  run(c, 5);  c.setCtlAction('TIC202', c.L.TIC202.act === 'DIR' ? 'REV' : 'DIR');                                                                 // control action
  run(c, 5);  c.setPvTrack('LIC401', true);                                                                      // PV tracking
  run(c, 5);  c.setOos('TIC201', 'PVHI', true); sign('engr', 'oos');                                            // OOS (signed)
  run(c, 5);  c.setOos('TIC201', 'PVHI', false);                                                                // RTS
  run(c, 5);  c.setPriority('TIC201', 'DEVHI', 'Urgent'); sign('engr', 'prio');                                 // priority (signed)
  run(c, 5);  c.storeEntry('TIC201', 'K', 3); sign('engr', 'tune');                                             // tuning (signed)
  run(c, 5);  c.storeEntry('TIC201', 'ALMDB', 2); c.storeEntry('TIC201', 'ALMDELAY', 5);                       // deadband / on-delay
  run(c, 5);  c.storeEntry('TIC201', 'SPHILM', 175); c.storeEntry('TIC201', 'TP:PVHI', 168); sign('engr', 'tp'); // limits, trip point (signed)
  run(c, 5);  c.toggleAssetAlarms('TK-101'); sign('mngr', 'dis');                                               // asset disable (signed)
  run(c, 5);  c.toggleAssetAlarms('TK-101'); sign('mngr', 'ena');                                               // asset enable (signed)
  run(c, 60);
  const alm = c.alarms.find((a) => a.active); assert.ok(alm, 'the cooling loss raised an alarm');
  c.silence(); c.ackAlarm(alm); c.setState({ selAlm: alm.key });
  c.commentAlarmKey(alm.key, 'seen by the trainee');                                                            // comment
  c.shelveAlarm(alm.key, 5, 'KNOWN PROCESS UPSET');                                                             // shelve
  run(c, 20); c.unshelveAlarm(alm.key);                                                                          // unshelve
  run(c, 5);  c.startDrill(c.drillDefs().find((d) => d.id === 'D1'));                                           // drill start
  const pm = c.pendingMsgs()[0]; assert.ok(pm, 'the drill armed message awaits a confirm');
  run(c, 5);  c.confirmMsg(pm.id);                                                                              // message confirm
  run(c, 30); c.endDrill('ENDED BY INSTRUCTOR'); c.setState({ dlg: null });                                     // drill end
  run(c, 60);
  const t1 = c.P.t;
  const ops = new Set(c.instr.journal.filter((e) => e.t > t0).map((e) => e.op));
  const missing = ['UPSET', 'VAR', 'MAG', 'MODE', 'STORE', 'RAISE', 'CTLACTN', 'PVTRACK', 'OOS', 'PRIO', 'ASSET', 'SIL', 'ACK', 'COMMENT', 'SHELVE', 'UNSHELVE', 'DRILL', 'CONFIRM', 'DRILLEND'].filter((op) => !ops.has(op));
  assert.deepEqual(missing, [], 'every action journaled');
  for (const op of ['UPSET', 'VAR', 'MAG', 'MODE', 'STORE', 'RAISE', 'CTLACTN', 'PVTRACK', 'OOS', 'PRIO', 'ASSET', 'SIL', 'ACK', 'COMMENT', 'SHELVE', 'UNSHELVE', 'DRILL', 'CONFIRM', 'DRILLEND'])
    assert.ok(ops.has(op), 'journaled: ' + op);
  for (const e of c.instr.journal) assert.match(Instr.journalText(e, (t) => String(t)), /\S/, 'journal text readable');
  const traj = (tag) => c.hist[tag].filter((r) => r[0] > t0).map((r) => r.slice());
  const tags = ['TIC201', 'TIC202', 'LIC101', 'LIC401', 'FIC102'];
  const orig = {}; for (const t of tags) orig[t] = traj(t);
  // event counts by type after the snapshot; E-SIGNATURE lines are excluded because a replay applies a signed action
  // directly (the signature was given when it was recorded) and the signed CONFIG entry carries the name and reason;
  // the REPLAY COMPLETE bookkeeping line the replay itself writes is excluded too
  const evCounts = () => { const m = {}; for (const e of c.events) if (e.t > t0 && !/^E-SIGNATURE|^REPLAY /.test(e.desc)) m[e.type] = (m[e.type] || 0) + 1; return m; };
  const almCount = () => c.alarmLog.filter((a) => a.t > t0).length;
  const cfg = () => ({ act: c.L.TIC202.act, pvt: c.L.LIC401.pvtrack, oos: c.isOos('TIC201', 'PVHI'), prio: c.L.TIC201.alm.DEVHI[1], K: c.L.TIC201.K, db: c.L.TIC201.almDb, dl: c.L.TIC201.almDelay, sphilm: c.L.TIC201.sphilm, tp: c.L.TIC201.alm.PVHI[0], dis: [...c.disabledAssets], cmt: c.alarmEngine.get(alm.key).comment, conf: c.msgs.filter((m) => m.confirmed).length });
  const origEv = evCounts(), origAlm = almCount(), origCfg = cfg(), origAlarms = c.alarms.map((x) => x.key + ':' + x.state).sort();
  assert.ok(origAlm > 0 && origCfg.conf === 1 && origCfg.cmt === 'seen by the trainee');
  c.startReplay(3);
  assert.equal(c.P.t, t0);
  c.replayToEnd();
  assert.equal(c.instr.replay, null); assert.equal(c.P.t, t1);
  for (const t of tags) assert.deepEqual(traj(t), orig[t], t + ' trajectory identical after replay');
  assert.deepEqual(evCounts(), origEv, 'event counts by type identical');
  assert.equal(almCount(), origAlm, 'alarm log count identical');
  assert.deepEqual(cfg(), origCfg, 'every configuration and alarm-state change reproduced');
  assert.deepEqual(c.alarms.map((x) => x.key + ':' + x.state).sort(), origAlarms);
});

test('with HIDDEN UPSETS on, ending a drill leaves no instructor text in the Message Summary, events or System Status', () => {
  const c = boot('OPER');
  c.instr.auth = true;
  run(c, 10);
  c.setHidden(true);
  c.startDrill(c.drillDefs().find((d) => d.id === 'D9'));   // D9 has a setup event too
  run(c, 60);
  c.instr.auth = false;
  c.endDrill('ENDED BY INSTRUCTOR');
  c.setState({ display: 'msgs' });
  const leak = /INSTRUCTOR:|drill D9|D9 (armed|ended)|DRILL D9|DRILL SETUP/i;   // the menus and coverage matrix name the feature by design; the debrief names the scenario by design
  const vis = strings(c.renderVals(), ['instr', 'dg', 'menus']).join(' | ');
  assert.ok(!leak.test(vis), vis.match(/.{0,40}(INSTRUCTOR:|drill D9|D9 (armed|ended)|DRILL D9|DRILL SETUP).{0,40}/i));
  assert.ok(!c.msgs.some((m) => /drill|instructor/i.test(m.txt)), 'no message');
  assert.ok(!c.events.some((e) => /drill|instr/i.test(e.desc + e.src)), 'no event names the drill');
  for (const display of ['events', 'sys']) { c.setState({ display, assist: true }); const s = strings(c.renderVals(), ['instr', 'dg', 'menus']).join(' | '); assert.ok(!leak.test(s), display + ': ' + s.match(/.{0,40}(INSTRUCTOR:|drill D9|DRILL D9|DRILL SETUP).{0,40}/i)); }
  assert.ok(c.instr.log.some((l) => /DRILL D9 ENDED/.test(l.txt)), 'the instructor log keeps it');
  const d = boot('OPER'); run(d, 10); d.startDrill(d.drillDefs()[0]); run(d, 5); d.endDrill('ENDED BY INSTRUCTOR');
  assert.match(d.msgs[0].txt, /^INSTRUCTOR: drill D1 ended/); assert.equal(d.msgs[0].confirm, true);
});

test('the fouling-rate variable acts on its own as a slow baseline that the fouling upset accelerates', () => {
  const c = boot();
  c.setVariable('foulRate', 3);
  run(c, 1800);
  assert.ok(c.P.foulF < 0.98 && c.P.foulF > 0.9, 'baseline fouling at x3 after 30 min: ' + c.P.foulF);
  assert.ok(Math.abs(c.P.foulF - c.P.foulBase) < 1e-9, 'without the upset the factor sits on the baseline');
  const base = c.P.foulF;
  c.setUpset('foul', true); run(c, 300);
  assert.ok(c.P.foulF < base - 0.3, 'the upset runs on top: ' + c.P.foulF);
  c.setUpset('foul', false); run(c, 600);
  assert.ok(Math.abs(c.P.foulF - c.P.foulBase) < 1e-6 && c.P.foulBase < base, 'recovers to the (still declining) baseline, never above it');
  const d = boot(); run(d, 1800);
  assert.ok(d.P.foulF > 0.985, 'design rate: about 1 % in 30 min: ' + d.P.foulF);
  assert.match(Instr.variableDefs().find((v) => v.k === 'foulRate').label, /baseline/i, 'the panel says what it does');
});

test('D11 armed from an IDLE Unit 02 reaches its first alarm and a debrief (the 12-minute limit counts from the injection)', () => {
  const c = boot('OPER');
  c.startDrill(c.drillDefs().find((d) => d.id === 'D11'));
  let g = 0, tInj = 0;
  while (c.state.drill && g++ < 8000) { c.step(0.5); if (c.state.drill && c.state.drill.injected && !tInj) tInj = c.state.drill.tInj; }
  const dd = c.state.dlg && c.state.dlg.type === 'debrief' && c.state.dlg.drill;
  assert.ok(dd, 'a debrief opened');
  assert.ok(tInj > dd.t0 + 600000, 'injected well after arming: ' + ((tInj - dd.t0) / 60000).toFixed(1) + ' min');
  assert.ok(dd.m.tAlarm && dd.m.tAlarm >= tInj, 'first alarm after the injection');
  assert.ok(dd.tEnd - tInj >= 720000 - 1000, 'the limit ran from the injection');
  assert.deepEqual(Object.keys(c.drillFromData(c.drillData() || { id: 'D11', t0: 1, ti: 1 })).sort(), ['def', 'injected', 'm', 'stableFor', 't0', 'tInj', 'ti']);
  // ungated drills keep counting from arming
  const d = boot('OPER'); d.startDrill(d.drillDefs()[0]); g = 0; while (d.state.drill && g++ < 3000) d.step(0.5);
  const e = d.state.dlg && d.state.dlg.drill; assert.ok(e && e.tEnd - e.t0 <= 720000 + 1000);
});

test('R-310 stays finite for 60 sim-minutes at every slider extreme on the high-load condition', () => {
  const vDef = Instr.variableDefs().find((d) => d.k === 'catAct');
  const uDef = Instr.upsetDefs().find((d) => d.k === 'bedact').mag;
  for (const k of [{ cat: vDef.max, mag: uDef.max }, { cat: vDef.min, mag: uDef.max }, { cat: vDef.max, mag: uDef.min }]) {
    const c = boot('MNGR');
    c.applyPreset('U3_HILOAD');
    c.storeEntry('FIC310', 'SP', c.L.FIC310.sphilm); c.storeEntry('TIC311', 'SP', c.L.TIC311.sphilm);
    c.setVariable('catAct', k.cat); c.setMagnitude('bedact', k.mag); c.setUpset('bedact', true);
    let peak = 0;
    for (let i = 0; i < 7200; i++) {
      c.step(0.5);
      for (const f of ['bed', 'ts1', 'ts2', 'o2', 'Tin']) if (c.P.h[f] !== undefined) assert.ok(Number.isFinite(c.P.h[f]), f + ' non-finite at ' + i / 2 + ' s ' + JSON.stringify(k));
      peak = Math.max(peak, c.P.h.bed);
    }
    assert.ok(peak < 800, 'peak ' + peak + ' ' + JSON.stringify(k));
    for (const t of Object.keys(c.L)) assert.ok(Number.isFinite(c.L[t].pv), t + ' finite');
    assert.ok(c.snapshotData('ok'));
  }
});

// ---- final QA (2026-08-29): backtrack picks the ring entry nearest the requested age ----

test('backtrack −30 S restores the ring entry nearest 30 s back, not the first one at least 30 s old', () => {
  const c = boot('MNGR');
  run(c, 660);
  const now = c.P.t;
  for (const back of [30000, 120000, 600000]) {
    const ring = c.instr.ring.slice();
    const nearest = ring.reduce((b, s) => (Math.abs(s.t - (now - back)) < Math.abs(b.t - (now - back)) ? s : b), ring[0]);
    assert.equal(Instr.ringPick(c.instr, now, back).t, nearest.t, 'ringPick ' + back + ' picks the nearest entry');
    assert.ok(Math.abs((now - nearest.t) - back) <= Instr.RING_MS / 2, back + ': nearest entry is within half the ring spacing');
  }
  c.backtrack(30000);
  const moved = now - c.P.t;
  assert.ok(moved >= 15000 && moved <= 45000, '−30 S moved ' + moved + ' ms');
  // module level: entries 0, 30 and 60 s old — 30 s back is the middle one, 45 s back (an exact tie) the older one,
  // 10 min back the oldest, and an empty ring gives null
  const I = { ring: [{ t: 940000 }, { t: 970000 }, { t: 1000000 }], lastRingT: 1000000 };
  assert.equal(Instr.ringPick(I, 1000000, 30000).t, 970000);
  assert.equal(Instr.ringPick(I, 1000000, 45000).t, 940000, 'a tie goes to the older entry');
  assert.equal(Instr.ringPick(I, 1000000, 600000).t, 940000);
  assert.equal(Instr.ringPick({ ring: [], lastRingT: -Infinity }, 1000000, 30000), null);
});
