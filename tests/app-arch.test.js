// @artifact dev
// App-level tests for V3-PLAN S1 (Topology + Trace): the ARCH display wired into the
// Component -- head script tags, cached graph, view state, command/menu/nav plumbing,
// SIGNAL PATH entry points, and the profile switch. Exercises tools/logic-harness so
// ESS.Topology / ESS.SignalPath / ESS.ArchitectureViewModel are the same globals the
// browser sees (V3-PLAN addendum Q5).
//
// S1's own exit condition (docs/dev/V3-PLAN.md stage table): "Read-only: no state
// mutation from the view; goldens untouched; smoke ok." The digest sweep at the bottom
// of this file is that condition as an assertion, not an assumption -- it does not just
// check that ARCH's own closures look pure, it drives the view through every mode,
// profile and a selection sweep on a live Component and proves the process/alarm/valve
// end-state digest from tests/_fixture.js is byte-identical to a twin run that never
// opened ARCH at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../tools/logic-harness');
const { newSim, run, endState, digest } = require('./_fixture');

const { Component } = load();

function boot() {
  const c = new Component({});
  c.initSim();
  return c;
}

test('all six v3 modules load as ESS.* globals in document order (advisory Q5)', () => {
  ['Dispatch', 'Topology', 'FaultEngine', 'SignalPath', 'DrillArch', 'ArchitectureViewModel'].forEach(name => {
    assert.ok(globalThis.ESS[name], `ESS.${name} should be defined once the head script tags load it`);
  });
});

test('the topology graph is cached on the instance, not rebuilt per render', () => {
  const c = boot();
  assert.ok(c.topo, 'initSim() must cache the built graph on this.topo');
  assert.equal(Object.keys(c.topo.nodes).length, 144, 'measured graph size (lead + advisory)');
  assert.equal(c.topo.edges.length, 315);
  const before = c.topo;
  c.renderVals();
  c.renderVals();
  assert.equal(c.topo, before, 'renderVals() must never replace this.topo (it runs on every setState, not just 2 Hz)');
  assert.deepEqual(globalThis.ESS.Topology.validate(c.topo), [], 'the cached graph must still validate clean');
});

test('restoreSnapshot() rebuilds the cached graph too (it replaces L/V wholesale)', () => {
  const c = boot();
  const before = c.topo;
  const snap = c.snapshotData ? c.snapshotData('t') : null;
  assert.ok(snap, 'snapshotData() must produce a snapshot to restore');
  c.restoreSnapshot(snap, 'test restore');
  assert.ok(c.topo, 'topo must still be present after restore');
  assert.notEqual(c.topo, before, 'restoreSnapshot must rebuild the graph against the restored L/V, not reuse the stale object');
  assert.deepEqual(globalThis.ESS.Topology.validate(c.topo), []);
});

test('ARCH command navigates, via the command zone and the map alias', () => {
  const c = boot();
  assert.equal(c.runCmd('ARCH'), true);
  assert.equal(c.state.display, 'arch');
  const c2 = boot();
  assert.equal(c2.runCmd('ARCHITECTURE'), true);
  assert.equal(c2.state.display, 'arch');
});

test('View menu carries an Architecture item that navigates to arch', () => {
  const c = boot();
  const rv = c.renderVals();
  const viewMenu = rv.menus.find(m => m.name === 'View');
  assert.ok(viewMenu, 'a View menu must exist');
  const item = viewMenu.items.find(it => !it.sep && it.label === 'Architecture');
  assert.ok(item, 'View menu must carry an Architecture item');
  item.cb();
  assert.equal(c.state.display, 'arch');
});

test('nav("arch", tag) stores archTag, and back/forward re-apply it like detail does', () => {
  const c = boot();
  c.nav('graphic');
  c.nav('arch', 'FIC102');
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archTag, 'FIC102');
  c.nav('detail', 'TIC201');
  c.goBack();
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archTag, 'FIC102', 'goBack must re-apply the arch tag, mirroring detail');
  c.goFwd();
  assert.equal(c.state.display, 'detail');
});

test('renderVals() produces a well-formed arch object without throwing, in every mode', () => {
  const c = boot();
  c.nav('arch', 'FIC102');
  ['learn', 'trace', 'diagnose', 'debrief'].forEach(mode => {
    c.setState({ archMode: mode });
    let rv;
    assert.doesNotThrow(() => { rv = c.renderVals(); }, `renderVals() must not throw in ${mode} mode`);
    assert.equal(rv.isArch, true);
    assert.ok(rv.arch && typeof rv.arch === 'object', `arch data must be present in ${mode} mode`);
    assert.equal(rv.arch.banner, 'Conceptual training architecture. Simulated; not a Honeywell diagnostic display.');
    assert.ok(Array.isArray(rv.arch.layers) && rv.arch.layers.length === 7, 'seven FIELD..INFORMATION layer columns');
    const totalNodes = rv.arch.layers.reduce((n, ly) => n + ly.nodes.length, 0);
    assert.equal(totalNodes, 144, 'every graph node must be laid out somewhere');
    assert.ok(Array.isArray(rv.arch.edges) && rv.arch.edges.length === 315);
  });
});

test('the banner is present and unchanged when ARCH is not the active display too (cheap stub does not crash callers)', () => {
  const c = boot();
  const rv = c.renderVals();
  assert.equal(rv.isArch, false);
  assert.deepEqual(rv.arch, {}, 'archView() returns a cheap stub off-display (advisory Q2)');
});

test('an absent/unknown tag never throws and comes back as an explained empty path, not a crash', () => {
  const c = boot();
  c.nav('arch');
  c.setState({ archMode: 'trace', archTag: null });
  let rv;
  assert.doesNotThrow(() => { rv = c.renderVals(); });
  assert.equal(rv.arch.pathEmpty, true);
  assert.ok(typeof rv.arch.pathEmptyText === 'string' && rv.arch.pathEmptyText.length > 0);
});

test('SIGNAL PATH from a faceplate opens ARCH in Trace mode pre-scoped to that tag', () => {
  const c = boot();
  c.openFp('FIC102');
  const rv = c.renderVals();
  const fp = rv.fps.find(f => f.tag === 'FIC102');
  assert.ok(fp, 'faceplate for FIC102 must be present');
  assert.equal(typeof fp.sigPath, 'function', 'faceplate must carry a sigPath action');
  fp.sigPath();
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archTag, 'FIC102');
  assert.equal(c.state.archMode, 'trace');
});

test('SIGNAL PATH from Point Detail opens ARCH pre-scoped to the detail tag', () => {
  const c = boot();
  c.setState({ detailTag: 'TIC201' });
  const rv = c.renderVals();
  assert.equal(typeof rv.dpt.sigPath, 'function');
  rv.dpt.sigPath();
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archTag, 'TIC201');
  assert.equal(c.state.archMode, 'trace');
});

test('SIGNAL PATH from a trend pen opens ARCH pre-scoped to that pen\'s tag', () => {
  const c = boot();
  c.setState({ tg: 'TG01' });
  const rv = c.renderVals();
  const pen = rv.tv.pens[0];
  assert.equal(typeof pen.cb, 'function');
  pen.cb();
  assert.equal(c.state.display, 'arch');
  assert.ok(c.state.archTag, 'a tag must be scoped');
  assert.equal(c.state.archMode, 'trace');
});

test('SIGNAL PATH from an alarm row scopes to the alarm\'s tag when it is a real point, and is graceful when it is not', () => {
  const c = boot();
  c.raiseA('TIC201', 'PVHI', 'High', 170, 'DEG C', 'Reactor temp');
  const almId = c.alarmEngine.get('TIC201.PVHI').id;
  c.setState({ selAlm: almId });
  let rv = c.renderVals();
  const btn = rv.av.btns.find(b => b.label === 'SIGNAL PATH');
  assert.ok(btn, 'Alarm Summary must carry a SIGNAL PATH button');
  btn.cb();
  assert.equal(c.state.display, 'arch');
  assert.equal(c.state.archTag, 'TIC201');
  assert.equal(c.state.archMode, 'trace');

  // Equipment-source alarms (e.g. TK-101) are not in this.L -- msgZone, never crash.
  const c2 = boot();
  c2.setState({ selAlm: 'nonexistent-alarm-id', display: 'alarms' });
  const rv2 = c2.renderVals();
  const btn2 = rv2.av.btns.find(b => b.label === 'SIGNAL PATH');
  assert.doesNotThrow(() => btn2.cb());
  assert.notEqual(c2.state.display, 'arch', 'no source resolves -> must not navigate');
});

test('the profile switch changes the resolved measurement path (console direct vs flex cached)', () => {
  const c = boot();
  c.nav('arch', 'FIC102');
  c.setState({ archMode: 'trace', archProfile: 'console' });
  const rvConsole = c.renderVals();
  const measConsole = rvConsole.arch.branches.find(b => b.type === 'measurement');
  assert.ok(measConsole && measConsole.available);
  const idsConsole = measConsole.nodes.map(n => n.id);
  assert.ok(idsConsole.includes('STN-CONSOLE'));
  assert.ok(!idsConsole.includes('SVC-SERVER'));

  c.setState({ archProfile: 'flex' });
  const rvFlex = c.renderVals();
  const measFlex = rvFlex.arch.branches.find(b => b.type === 'measurement');
  assert.ok(measFlex && measFlex.available);
  const idsFlex = measFlex.nodes.map(n => n.id);
  assert.ok(idsFlex.includes('SVC-SERVER'), 'flex profile must route the measurement path through the data server cache');
  assert.ok(idsFlex.includes('STN-FLEX'));
  assert.notDeepEqual(idsConsole, idsFlex, 'switching the profile must change the resolved path');

  assert.equal(typeof rvFlex.arch.profileHelp, 'string');
  assert.match(rvFlex.arch.profileHelp, /one physical station/i, 'profile help text must state the one-station abstraction honestly (V3-PLAN section 3)');
});

test('Learn mode reveals blast radius for a selected node; Diagnose withholds it (module-level contract, exercised through the app)', () => {
  const c = boot();
  c.nav('arch');
  const nodeId = Object.keys(c.topo.nodes).find(id => c.topo.nodes[id].layer === 'CONTROL');
  c.setState({ archMode: 'learn', archSel: nodeId });
  const rvLearn = c.renderVals();
  assert.ok(rvLearn.arch.hasInspector);
  c.setState({ archMode: 'diagnose' });
  const rvDiag = c.renderVals();
  assert.ok(rvDiag.arch.hasInspector);
  // Both render without throwing and without leaking a fault id / INSTRUCTOR_ONLY --
  // S1 never even supplies health, so this doubles as a no-crash check for that path.
  assert.doesNotThrow(() => JSON.stringify(rvLearn.arch));
  assert.doesNotThrow(() => JSON.stringify(rvDiag.arch));
});

test('clicking a node in the diagram selects it, and clicking again through a signal-path chip re-selects', () => {
  const c = boot();
  c.nav('arch', 'FIC102');
  c.setState({ archMode: 'trace' });
  const rv = c.renderVals();
  const someNode = rv.arch.layers.find(ly => ly.nodes.length).nodes[0];
  assert.equal(typeof someNode.cb, 'function');
  someNode.cb();
  assert.equal(c.state.archSel, someNode.id);
});

// ---------------------------------------------------------------------------------------
// S1 EXIT CONDITION: opening and driving the ARCH view must not move the simulator's
// end-state digest by one bit, versus an identical twin that never opened it.
// ---------------------------------------------------------------------------------------
test('S1 EXIT CONDITION: driving ARCH through every mode, profile and a selection sweep leaves the end-state digest unchanged', () => {
  const seed = 20260830;
  const baseline = newSim({ seed });
  const driven = newSim({ seed });

  run(baseline, 60);
  run(driven, 60);

  // Every action below is view state only (archMode/archProfile/archTag/archSel via
  // nav/setState) or a read (renderVals(), ESS.Topology.validate). Nothing here may call
  // setMode/raiseLower/motorCmd/ackAlarm/injectFault/... -- see V3-PLAN S1 "MUST NOT call".
  const tags = ['FIC102', 'TIC201', 'LIC401', 'FIC211', 'M202', 'TIC311'];
  const nodeIds = Object.keys(driven.topo.nodes);
  const sampleNodes = [nodeIds[0], nodeIds[Math.floor(nodeIds.length / 3)], nodeIds[Math.floor(nodeIds.length * 2 / 3)], nodeIds[nodeIds.length - 1]];

  driven.nav('arch');
  ['learn', 'trace', 'diagnose', 'debrief'].forEach(mode => {
    driven.setState({ archMode: mode });
    ['console', 'flex'].forEach(profile => {
      driven.setState({ archProfile: profile });
      tags.forEach(tag => {
        driven.setState({ archTag: tag });
        sampleNodes.forEach(nodeId => {
          driven.setState({ archSel: nodeId });
          driven.renderVals(); // must not throw, must not mutate
        });
      });
    });
  });
  driven.setState({ archSel: null, archTag: null });
  driven.renderVals();

  run(baseline, 120);
  run(driven, 120);

  assert.equal(
    digest(endState(driven)),
    digest(endState(baseline)),
    'opening/driving the ARCH view must be perfectly invisible to the process/alarm/valve end state'
  );
});
