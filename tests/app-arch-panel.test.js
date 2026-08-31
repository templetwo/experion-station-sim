// @artifact dev
// App-level tests for the instructor Architecture panel (V3-PLAN S2, DO section 8 items
// 1-4): the topology fault matrix, per-injection onset/duration/step-or-ramp/magnitude/
// visibility/recovery, dispatch+journal routing, blast radius shown to the instructor, and
// the trainee/instructor projection split. Exercises the app-level entry points
// (c.setArchFault / c.clearArchFault / c.archPanel()) and the dispatch TYPEs they wrap
// ('ARCH_FAULT_ACTIVATE', 'ARCH_FAULT_CLEAR') rather than src/fault-engine.js directly --
// that module's own contract is tests/fault-engine.test.js's job.
//
// Does not edit src/models.js or any of the four verification-gate test files.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FaultEngine = require('../src/fault-engine.js');
const { load } = require('../tools/logic-harness');
const { newSim, run, endState, digest } = require('./_fixture');

const { Component } = load();

function boot(sec) {
  const c = new Component({});
  c.initSim();
  c.instr.auth = true;
  if (sec) c.setState({ sec });
  return c;
}

function isActive(c, faultId, targetNodeId) { return FaultEngine.isActive(c.P.archFaults, faultId, targetNodeId); }

// ---------------------------------------------------------------- reserved pairs (D2 seam)

test('the three legacy ARCHITECTURE upset pairs are reserved: the panel refuses to re-target them', () => {
  const c = boot('MNGR');
  const reserved = [
    ['FROZEN_MEASUREMENT', 'XMTR-FIC102'],
    ['BIASED_MEASUREMENT', 'XMTR-LIC101'],
    ['VALVE_RESPONSE_FAILURE', 'VLV-TV202'],
  ];
  for (const [faultId, targetNodeId] of reserved) {
    const before = c.instr.journal.length;
    c.setArchFault(faultId, targetNodeId, {});
    assert.equal(isActive(c, faultId, targetNodeId), false, `${faultId}@${targetNodeId}: must not activate through the panel`);
    const entry = c.instr.journal[c.instr.journal.length - 1];
    assert.equal(c.instr.journal.length, before + 1, 'a refused command is still journaled once');
    assert.equal(entry.accepted, false);
    assert.match(entry.reason, /reserved/);
  }
  // Confirms archApplicableFaults() also excludes exactly these pairs from the matrix,
  // not merely refuses them at dispatch time -- the two must agree or the panel would
  // offer a cell it then refuses to activate.
  for (const [faultId, targetNodeId] of reserved) {
    assert.ok(c.archIsReserved(faultId, targetNodeId), `${faultId}@${targetNodeId} should read as reserved`);
    const node = c.topo.nodes[targetNodeId];
    assert.ok(!c.archApplicableFaults(node).includes(faultId), `${targetNodeId}'s matrix row must not offer ${faultId}`);
  }
  // But a DIFFERENT, non-reserved fault at the same node (XMTR-FIC102 is a TRANSMITTER,
  // legally targetable by BIASED_MEASUREMENT/NOISY_MEASUREMENT too) is not blanket-excluded
  // -- only the exact reserved (faultId, node) pair is.
  assert.ok(c.archApplicableFaults(c.topo.nodes['XMTR-FIC102']).includes('NOISY_MEASUREMENT'),
    'a non-reserved fault at a reserved node must still be offered');
});

// ---------------------------------------------------------------- basic activate / clear

test('STEP activation is immediate, journals once as INSTRUCTOR, and clears cleanly', () => {
  const c = boot('MNGR');
  run(c, 10);
  const before = c.instr.journal.length;
  c.setArchFault('CONTROLLER_LOSS', 'CTRL-U2', { mode: 'STEP' });
  assert.equal(isActive(c, 'CONTROLLER_LOSS', 'CTRL-U2'), true);
  assert.equal(c.instr.journal.length, before + 1, 'exactly one journal entry per dispatch');
  const entry = c.instr.journal[c.instr.journal.length - 1];
  assert.equal(entry.op, 'ARCHFAULT'); assert.equal(entry.tag, 'CTRL-U2'); assert.equal(entry.arg, 'CONTROLLER_LOSS');
  assert.equal(entry.accepted, true); assert.equal(entry.instr, true);

  const health = FaultEngine.healthProjection(c.archFaultState(), c.topo);
  assert.equal(health.nodes['CTRL-U2'].health, 'FAILED', 'CONTROLLER_LOSS marks its own node FAILED');
  // propagate: 'BLAST' -- something downstream of CTRL-U2 must degrade too.
  const degraded = Object.values(health.nodes).filter((n) => n.health === 'DEGRADED');
  assert.ok(degraded.length > 0, 'a BLAST-propagating fault must degrade at least one downstream node');

  c.clearArchFault('CONTROLLER_LOSS', 'CTRL-U2');
  assert.equal(isActive(c, 'CONTROLLER_LOSS', 'CTRL-U2'), false);
  const health2 = FaultEngine.healthProjection(c.archFaultState(), c.topo);
  assert.equal(health2.nodes['CTRL-U2'].health, 'HEALTHY', 'clearing returns the node to HEALTHY');
});

test('a duplicate activation on the same (fault, node) is refused and leaves state unchanged', () => {
  const c = boot('MNGR');
  c.setArchFault('STATION_LOSS_PEER', 'STN-FLEX', {});
  assert.equal(isActive(c, 'STATION_LOSS_PEER', 'STN-FLEX'), true);
  const before = JSON.stringify(c.P.archFaults);
  c.setArchFault('STATION_LOSS_PEER', 'STN-FLEX', {});
  assert.equal(JSON.stringify(c.P.archFaults), before, 'a refused re-activation must not mutate archFaults');
  const entry = c.instr.journal[c.instr.journal.length - 1];
  assert.equal(entry.accepted, false);
});

// ---------------------------------------------------------------- magnitude

test('a magnitude-bearing fault requires an explicit, in-range magnitude; STEP mode applies it immediately', () => {
  const c = boot('MNGR');
  const before = c.instr.journal.length;
  c.setArchFault('BIASED_MEASUREMENT', 'XMTR-AI205', { magnitude: null });
  assert.equal(isActive(c, 'BIASED_MEASUREMENT', 'XMTR-AI205'), false, 'missing magnitude must be refused');
  assert.equal(c.instr.journal[c.instr.journal.length - 1].accepted, false);

  c.setArchFault('BIASED_MEASUREMENT', 'XMTR-AI205', { magnitude: 999 });
  assert.equal(isActive(c, 'BIASED_MEASUREMENT', 'XMTR-AI205'), false, 'out-of-range magnitude must be refused');

  c.setArchFault('BIASED_MEASUREMENT', 'XMTR-AI205', { magnitude: 2, mode: 'STEP' });
  assert.equal(isActive(c, 'BIASED_MEASUREMENT', 'XMTR-AI205'), true);
  const inst = FaultEngine.listActive(c.P.archFaults).find((f) => f.instanceId === 'BIASED_MEASUREMENT@XMTR-AI205');
  assert.equal(inst.magnitude, 2, 'STEP mode starts at the requested magnitude immediately');
  assert.ok(c.instr.journal.length >= before + 3);
});

// ---------------------------------------------------------------- RAMP mode

test('RAMP mode starts magnitude at 0 and reaches the target only after the ramp time elapses', () => {
  const c = boot('MNGR');
  run(c, 10);
  c.setArchFault('NOISY_MEASUREMENT', 'XMTR-FI100', { magnitude: 4, mode: 'RAMP', rampSec: 20 });
  const at0 = FaultEngine.listActive(c.P.archFaults).find((f) => f.instanceId === 'NOISY_MEASUREMENT@XMTR-FI100');
  assert.equal(at0.magnitude, 0, 'a RAMP starts at 0, never the target, at the instant of activation');

  run(c, 10); // halfway through the 20 s ramp
  let inst = FaultEngine.listActive(c.P.archFaults).find((f) => f.instanceId === 'NOISY_MEASUREMENT@XMTR-FI100');
  assert.ok(inst.magnitude > 1.5 && inst.magnitude < 2.5, `expected ~2 at the ramp midpoint, got ${inst.magnitude}`);

  run(c, 15); // past the 20 s mark
  inst = FaultEngine.listActive(c.P.archFaults).find((f) => f.instanceId === 'NOISY_MEASUREMENT@XMTR-FI100');
  assert.equal(inst.magnitude, 4, 'the ramp must reach exactly the target and hold, never overshoot');

  run(c, 20);
  inst = FaultEngine.listActive(c.P.archFaults).find((f) => f.instanceId === 'NOISY_MEASUREMENT@XMTR-FI100');
  assert.equal(inst.magnitude, 4, 'magnitude holds at target once the ramp is complete');
  // Health never scales with magnitude (FaultEngine.FAULT_DEFS.healthEffect is fixed): the
  // node is DEGRADED from the instant of activation, not only once the ramp completes.
  const health = FaultEngine.healthProjection(c.archFaultState(), c.topo);
  assert.equal(health.nodes['XMTR-FI100'].health, 'DEGRADED');
});

// ---------------------------------------------------------------- delayed onset

test('a delayed onset stays pending, not active, until its scheduled sim time is reached', () => {
  const c = boot('MNGR');
  run(c, 10);
  const t0 = c.P.t;
  c.setArchFault('HISTORIAN_GAP', 'SVC-HISTORY', { delaySec: 30 });
  assert.equal(isActive(c, 'HISTORIAN_GAP', 'SVC-HISTORY'), false, 'must not be active before its onset');
  assert.equal(c.P.archPending.length, 1);
  assert.equal(c.P.archPending[0].fireAt, t0 + 30000);

  run(c, 29);
  assert.equal(isActive(c, 'HISTORIAN_GAP', 'SVC-HISTORY'), false, 'still pending 1 s before onset');

  run(c, 2); // crosses t0+30000
  assert.equal(isActive(c, 'HISTORIAN_GAP', 'SVC-HISTORY'), true, 'active once the onset time is reached');
  assert.equal(c.P.archPending.length, 0);
  const inst = FaultEngine.listActive(c.P.archFaults).find((f) => f.instanceId === 'HISTORIAN_GAP@SVC-HISTORY');
  assert.ok(inst.activatedAt >= t0 + 30000 && inst.activatedAt < t0 + 30000 + 1000,
    `onset fired at the scheduled time, got activatedAt=${inst.activatedAt} vs expected ~${t0 + 30000}`);
});

test('clearing a still-pending injection cancels it before it ever fires', () => {
  const c = boot('MNGR');
  c.setArchFault('COMMS_PARTITION', 'NET-U3-A', { delaySec: 60 });
  assert.equal(c.P.archPending.length, 1);
  c.clearArchFault('COMMS_PARTITION', 'NET-U3-A');
  assert.equal(c.P.archPending.length, 0);
  run(c, 120);
  assert.equal(isActive(c, 'COMMS_PARTITION', 'NET-U3-A'), false, 'a cancelled pending injection must never fire');
});

// ---------------------------------------------------------------- duration auto-expiry

test('a duration-limited fault auto-clears at expiry with no further instructor action', () => {
  const c = boot('MNGR');
  run(c, 5);
  c.setArchFault('REDUNDANCY_SWITCHOVER', 'CTRL-U3', { durationSec: 12 });
  assert.equal(isActive(c, 'REDUNDANCY_SWITCHOVER', 'CTRL-U3'), true);
  run(c, 11);
  assert.equal(isActive(c, 'REDUNDANCY_SWITCHOVER', 'CTRL-U3'), true, 'not yet expired at 11 s of 12');
  run(c, 2);
  assert.equal(isActive(c, 'REDUNDANCY_SWITCHOVER', 'CTRL-U3'), false, 'expired at/after 12 s');
  assert.equal(Object.keys(c.P.archMeta).length, 0, 'the schedule ledger entry is cleaned up on auto-clear');
});

test('an indefinite injection (no duration) never auto-clears', () => {
  const c = boot('MNGR');
  c.setArchFault('ASSISTANT_LOSS', 'APP-ASSIST', {});
  run(c, 600);
  assert.equal(isActive(c, 'ASSISTANT_LOSS', 'APP-ASSIST'), true, 'no duration means cleared explicitly by the instructor only');
});

// ---------------------------------------------------------------- hidden mode

test('hidden mode: the panel leaves no instructor trace in trainee events, but the ARCH symptom still shows', () => {
  const c = boot('MNGR');
  c.setHidden(true);
  const before = c.events.length;
  c.setArchFault('NET_PATH_DEGRADED', 'NET-U1-A', {});
  assert.ok(c.events.slice(0, c.events.length - before).every((e) => e.src !== 'INSTR'),
    'no INSTR-sourced event while hidden');
  const health = FaultEngine.healthProjection(c.archFaultState(), c.topo);
  assert.notEqual(health.nodes['NET-U1-A'].health, 'HEALTHY',
    'the ARCH view keeps showing the symptom even while hidden -- symptoms are process evidence, by design');

  c.setHidden(false);
  const before2 = c.events.length;
  c.setArchFault('SERVER_SERVICE_DEGRADED', 'SVC-SERVER', {});
  assert.ok(c.events.slice(0, c.events.length - before2).some((e) => e.src === 'INSTR'),
    'not hidden: the panel mirrors an INSTR event the same way UPSET does');
});

// ---------------------------------------------------------------- journal replay determinism

// endState()'s `counts.events` is bookkeeping, not physics: starting and finishing a
// replay itself always appends "REPLAY FROM SNAPSHOT" / "REPLAY STARTED" / "REPLAY
// COMPLETE" rows (app addEvent calls in restoreSnapshot()/startReplay()/replayCheckDone(),
// none of them new to this panel), so c.events after finishing a replay is NEVER expected
// to equal c.events from the live run that fed the snapshot -- app-instructor.test.js's own
// "action journal is complete" test excludes exactly `/^REPLAY /`-prefixed rows from its
// own before/after comparison for the same reason. digest(endState()) has no such
// exclusion, so comparing it straight across a replay boundary is comparing the wrong
// thing, not a regression; strip `counts` (the only bookkeeping field endState() carries)
// before hashing, same as that established exclusion, applied more simply.
function physicsDigest(c) { return digest({ ...endState(c), counts: undefined }); }

test('a scheduled RAMP+duration injection replays deterministically from a snapshot', () => {
  const c = boot('MNGR');
  run(c, 20);
  c.saveSlot(0, 'pre-injection');
  const tSnap = c.P.t;
  run(c, 5); // a beat after the save, so the scheduling command's own journal entry has a distinct t
  c.setArchFault('NOISY_MEASUREMENT', 'XMTR-FIC211', { magnitude: 3, mode: 'RAMP', rampSec: 10, delaySec: 15, durationSec: 40 });
  run(c, 90);
  const finalHealth1 = JSON.stringify(FaultEngine.healthProjection(c.archFaultState(), c.topo));
  const finalActive1 = FaultEngine.listActive(c.P.archFaults);
  const finalDigest1 = physicsDigest(c);

  c.startReplay(0);
  assert.equal(c.P.t, tSnap);
  c.replayToEnd();
  const finalHealth2 = JSON.stringify(FaultEngine.healthProjection(c.archFaultState(), c.topo));
  const finalActive2 = FaultEngine.listActive(c.P.archFaults);
  const finalDigest2 = physicsDigest(c);

  assert.equal(finalHealth1, finalHealth2, 'ARCH health projection identical after replay');
  assert.deepEqual(finalActive1, finalActive2, 'engine active-fault list identical after replay (magnitude included)');
  assert.equal(finalActive1.length, 0, 'the 40 s duration (onset +15 s) must have expired by +90 s in BOTH runs -- otherwise this assertion is vacuous');
  assert.equal(finalDigest1, finalDigest2, 'the physics golden digest is untouched by the panel, with or without replay');
});

// ---------------------------------------------------------------- panel view model

test('archPanel(): the matrix respects the layer filter and excludes reserved pairs; the stage form tracks the selected cell', () => {
  const c = boot('MNGR');
  c.setState({ display: 'instr' });
  const all = c.archPanel();
  assert.ok(all.rows.length > 5, 'the matrix should list more than a handful of nodes');
  assert.ok(all.rows.every((r) => r.cells.length > 0), 'every listed row has at least one applicable fault');
  assert.ok(!all.rows.some((r) => r.id === 'XMTR-FIC102' && r.cells.some((cell) => cell.faultId === 'FROZEN_MEASUREMENT')),
    'the reserved pair must not appear as a matrix cell');

  c.setState({ archFilterLayer: 'NETWORK' });
  const net = c.archPanel();
  assert.ok(net.rows.length > 0 && net.rows.every((r) => r.layer === 'NETWORK'), 'the NETWORK filter shows only NETWORK-layer rows');

  assert.equal(all.stage, null, 'no stage form before a cell is selected');
  c.archStageSelect('CTRL-U1', 'CONTROLLER_LOSS');
  const staged = c.archPanel();
  assert.ok(staged.stage);
  assert.equal(staged.stage.nodeId, 'CTRL-U1');
  assert.equal(staged.stage.faultId, 'CONTROLLER_LOSS');
  assert.equal(staged.stage.hasMag, false, 'CONTROLLER_LOSS has no magnitudeRange');
  assert.equal(staged.stage.canActivate, true);
  assert.equal(staged.stage.showClear, false);

  staged.stage.activate();
  const staged2 = c.archPanel();
  assert.equal(staged2.stage.canActivate, false, 'once active, the form flips to CLEAR');
  assert.equal(staged2.stage.showClear, true);
  assert.equal(staged2.activeEmpty, false);
  const row = staged2.active.find((a) => a.faultId === 'CONTROLLER_LOSS' && a.nodeId === 'CTRL-U1');
  assert.ok(row, 'the active/pending list carries the new injection');
  assert.equal(row.statusT, 'ACTIVE');
  assert.match(row.blastT, /downstream node/, 'blast radius text names at least one downstream node for a BLAST fault');
  assert.match(row.recoveryT, /instructor/i, 'recovery condition text is surfaced');
});

test('archPanel() is unreachable for a non-instructor render, same as the rest of instructorView()', () => {
  const c = boot('OPER');
  c.instr.auth = false;
  c.setArchFault('ASSISTANT_LOSS', 'APP-ASSIST', {}); // instr.auth bypassed at the call site is not the point here
  const v = c.renderVals();
  assert.equal(v.instr.on, false);
  assert.equal(v.instr.arch, undefined, 'no architecture panel data reaches a non-instructor render');
});

// ---------------------------------------------------------------- no leak to the trainee ARCH surface

test('an active panel-injected fault never leaks its fault id or instance id into the trainee ARCH health projection', () => {
  const c = boot('MNGR');
  c.setArchFault('STATION_LOSS_PEER', 'STN-CONSOLE', {});
  const health = FaultEngine.healthProjection(c.archFaultState(), c.topo);
  const serialized = JSON.stringify(health);
  assert.ok(!serialized.includes('STATION_LOSS_PEER'), 'fault id must not appear in the trainee-facing health projection');
  assert.ok(!serialized.includes('INSTRUCTOR_ONLY'), 'truthVisibility marker must not appear in the trainee-facing health projection');
  assert.ok(!serialized.includes('STATION_LOSS_PEER@STN-CONSOLE'), 'instance id must not appear either');
  assert.equal(health.nodes['STN-CONSOLE'].health, 'FAILED');
});
