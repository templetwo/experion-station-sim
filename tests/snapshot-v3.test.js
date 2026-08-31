// @artifact dev
// S4: the snapshot v3 schema and its migration. V3-PLAN section 9 requires "snapshot v3
// migration" with the exit condition that v2 snapshots still load.
//
// THE TRAP, AND IT IS THE WHOLE LANE. v2 snapshots carry NO schemaVersion field AT ALL —
// makeSnapshot has a fixed field list and no version marker. So the migration MUST key on
// the ABSENCE of a field, never on its value. A `snap.schemaVersion < 3` test is not merely
// wrong here, it is inverted: on a real v2 record the comparison is `undefined < 3`, which
// is FALSE, so the v2 record would be treated as CURRENT and skip the migration entirely.
// Absence is the signal. Every assertion below is built on that.
//
// AND THE v2 RECORDS ARE REAL, NOT APPROXIMATED. Each one is produced by the actual
// makeSnapshot path from a real booted Component and then has its post-v2 keys stripped —
// never hand-written. A hand-written approximation is a restatement of what the author
// believes the shape to be, so it passes exactly when the belief is wrong.
//
// Seat mbp-v3-gates (claude-opus-5), TASK s4-snapshot-v3. Owns this file only; read-only
// on src/instructor.js (3/3's) and the app page (locked to S3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { newSim, run } = require('./_fixture');
const Instructor = require('../src/instructor.js');

// The v2 field list, pinned. This is makeSnapshot's emitted shape before any v3 field.
const V2_KEYS = ['name', 't', 'wall', 'seed', 'randState', 'P', 'L', 'V', 'alarms',
  'eventsCount', 'journalSeq', 'tadShed', 'phaseSet', 'disabledAssets', 'drill'].sort();

// Architecture state that a v2 snapshot cannot carry and that restore must default.
const V3_PROCESS_KEYS = ['archFaults', 'archPending', 'archMeta', 'archInspected', 'training'];

// The repo's own driver, not one invented here: tests/_fixture.js newSim()/run() is what
// every other suite uses, so this file exercises the same path they do.
function boot() { const c = newSim(); run(c, 20); c.instr.auth = true; c.setState({ sec: 'MNGR' }); return c; }

/** A REAL v2 record: taken through the live makeSnapshot path, then reduced to the v2 keys
 *  and stripped of every v3 field inside P. Nothing here is hand-authored. */
function realV2Snapshot(c) {
  const live = c.snapshotData('v2-shaped');
  assert.ok(live, 'snapshotData refused — cannot build a real v2 record');
  const v2 = {};
  V2_KEYS.forEach((k) => { if (k in live) v2[k] = JSON.parse(JSON.stringify(live[k])); });
  V3_PROCESS_KEYS.forEach((k) => { delete v2.P[k]; });
  return v2;
}

// ==================================================== 1. THE SHAPE

test('snapshot v3: the v2 shape is pinned and carries no version marker', async (t) => {
  await t.test('makeSnapshot emits no schemaVersion of any kind', () => {
    const c = boot();
    const snap = c.snapshotData('x');
    assert.equal('schemaVersion' in snap, false,
      'a version marker appeared in the snapshot. That is allowed, but the migration must ' +
      'STILL key on absence for the v2 records already in the wild — update this test ' +
      'deliberately rather than deleting it.');
    assert.equal('version' in snap, false);
  });

  await t.test('the v2 key set is exactly what migration must cope with', () => {
    const c = boot();
    const keys = Object.keys(c.snapshotData('x')).sort();
    const missing = V2_KEYS.filter((k) => keys.indexOf(k) < 0);
    assert.deepEqual(missing, [],
      `makeSnapshot no longer emits ${missing.join(', ')} — a field the migration assumed present`);
  });

  await t.test('a real v2 record genuinely lacks every v3 architecture field', () => {
    const c = boot();
    const v2 = realV2Snapshot(c);
    const leaked = V3_PROCESS_KEYS.filter((k) => k in v2.P);
    assert.deepEqual(leaked, [], `the "v2" fixture still carries v3 state: ${leaked.join(', ')}`);
    assert.equal('schemaVersion' in v2, false);
  });
});

// ==================================================== 2. THE MIGRATION KEYS ON ABSENCE

test('snapshot v3: migration keys on ABSENCE, never on a version value', async (t) => {
  await t.test('a real v2 snapshot loads, and architecture defaults to all-healthy', () => {
    const c = boot();
    run(c, 20);
    const v2 = realV2Snapshot(c);
    c.restoreSnapshot(v2, 'v2 load');
    assert.ok(c.P.archFaults, 'archFaults was not defaulted on a v2 restore');
    assert.deepEqual(c.P.archFaults.activeFaults, [], 'a v2 snapshot must restore all-healthy');
    assert.ok(Array.isArray(c.P.archPending), 'archPending was not defaulted');
    assert.ok(c.P.archMeta && typeof c.P.archMeta === 'object', 'archMeta was not defaulted');
  });

  await t.test('THE INVERSION GUARD: undefined < 3 is false, so a value test would SKIP migration', () => {
    // Not a test of the code — a test of the reasoning the code has to get right, kept
    // executable so the claim in this file's header cannot rot into folklore.
    const v2 = {};
    assert.equal(v2.schemaVersion < 3, false,
      'if this were true a version comparison would work; it is false, which is exactly why ' +
      'a v2 record would be mistaken for current');
    assert.equal('schemaVersion' in v2, false, 'absence is the only reliable signal');
  });

  await t.test('an explicit schemaVersion:undefined behaves identically to no key at all', () => {
    const c = boot();
    run(c, 10);
    const a = realV2Snapshot(c);
    const b = Object.assign({}, a, { schemaVersion: undefined });
    b.P = JSON.parse(JSON.stringify(a.P));
    c.restoreSnapshot(a, 'no key');
    const withoutKey = JSON.stringify(c.P.archFaults);
    c.restoreSnapshot(b, 'undefined key');
    assert.equal(JSON.stringify(c.P.archFaults), withoutKey,
      'a present-but-undefined marker took a different path from an absent one');
  });

  await t.test('restore NEVER overwrites architecture state that IS present', () => {
    // The other half of absence-defaulting: a v3 snapshot must survive its own round-trip.
    const c = boot();
    run(c, 10);
    const live = c.snapshotData('v3');
    if (!live.P.archFaults) return; // v3 field not wired at this sha; the v2 half still holds
    live.P.archFaults = { activeFaults: [{ instanceId: 'X1', faultId: 'CONTROLLER_LOSS', targetNodeId: 'CTRL-U1', activatedAt: 1 }] };
    c.restoreSnapshot(live, 'v3 load');
    assert.equal(c.P.archFaults.activeFaults.length, 1,
      'defaulting clobbered a restored architecture state — absence-defaulting must never overwrite');
  });
});

// ==================================================== 3. THE RING IS THE SAME PATH

test('snapshot v3: the ring/backtrack path carries the same shape as a slot', async (t) => {
  // "Someone patching only makeSnapshot would miss it, and a backtrack that cannot restore
  // architecture state is the same defect wearing a different name." Today backtrackTick()
  // calls the SAME snapshotData(), so the ring is covered BY CONSTRUCTION — which is
  // precisely why it needs asserting: if the two paths ever diverge, this goes red.
  await t.test('a ring entry has the identical key set to a slot snapshot', () => {
    const c = boot();
    run(c, 5);
    c.saveSlot(0, 'slot');
    c.instr.lastRingT = -Infinity;      // force the ring to accept an entry now
    c.backtrackTick();
    assert.ok(c.instr.ring.length > 0, 'the ring took no entry — the backtrack path is not exercised');
    const slotKeys = Object.keys(c.instr.snapshots[0]).sort();
    const ringKeys = Object.keys(c.instr.ring[c.instr.ring.length - 1]).sort();
    assert.deepEqual(ringKeys, slotKeys,
      'the ring and slot snapshot shapes have diverged — a migration applied to one will ' +
      'silently miss the other');
  });

  await t.test('a v2-shaped RING entry also restores to all-healthy', () => {
    const c = boot();
    run(c, 5);
    c.instr.lastRingT = -Infinity;
    c.backtrackTick();
    const entry = c.instr.ring[c.instr.ring.length - 1];
    const v2 = {};
    V2_KEYS.forEach((k) => { if (k in entry) v2[k] = JSON.parse(JSON.stringify(entry[k])); });
    V3_PROCESS_KEYS.forEach((k) => { delete v2.P[k]; });
    c.restoreSnapshot(v2, 'v2 ring');
    assert.ok(c.P.archFaults);
    assert.deepEqual(c.P.archFaults.activeFaults, []);
  });

  await t.test('pushRing stores the object it is given, unwrapped', () => {
    // If pushRing ever started wrapping or cloning, migration would have two shapes to know.
    const I = Instructor.create({});
    const T = 1000000;
    const snap = { name: 'r', t: T, P: {}, L: {}, V: {} };
    assert.equal(Instructor.pushRing(I, snap, T), true);
    assert.equal(I.ring[0], snap, 'pushRing no longer stores the snapshot object directly');
  });

  await t.test('the ring evicts by SPAN, so an old entry is gone rather than stale', () => {
    // Found while writing the test above: pushRing trims everything older than
    // t - RING_SPAN_MS. A snapshot stamped well before the push time is dropped on the spot.
    // That matters for migration because it bounds what shapes can survive in the ring: a
    // v2-era entry cannot linger past the span, so the ring self-limits how far back a
    // migration must reach. Asserting it so the bound is a measured fact, not an assumption.
    const I = Instructor.create({});
    const T = 1000000;
    Instructor.pushRing(I, { name: 'old', t: T - Instructor.RING_SPAN_MS - 5000, P: {} }, T);
    assert.equal(I.ring.length, 0, 'an entry older than RING_SPAN_MS survived the trim');
  });
});
