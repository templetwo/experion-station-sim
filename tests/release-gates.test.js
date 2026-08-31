// @artifact dev
// V3-PLAN section 11, the five release gates for v3.0.0 — mechanically asserted instead
// of left as prose someone eyeballs at the end of the build.
//
// TWO RULES THIS FILE HOLDS ITSELF TO.
//  1. A gate that cannot fail is not a gate. Every assertion here is one that would have
//     gone red at some point in this build, or guards a property that can regress.
//  2. Never assert aspiration. Where a gate is not yet assertable, it SKIPS with the
//     stage that arms it named. Where a gate is assertable and BLOCKED by a known,
//     owned defect, it says BLOCKED and names the finding — that is a different state
//     from "not wired yet" and the two must not be blurred.
//
// COMPOSES, DOES NOT DUPLICATE. The deep proofs live in their own files and are named
// here so a reader can find them: leakage.test.js (section 10), provenance.test.js
// (gate 5 detail), refusal-scoring.test.js (the outcome-based safety-gate ruling),
// upset-class-honesty.test.js (arch/process split), model-id.test.js (the stamp),
// determinism/golden-*.test.js (S0). This file asserts the GATE, and checks those
// files still exist to carry the detail.
//
// Seat mbp-v3-gates (claude-opus-5), TASK s5-release-gates, base a7e7bd0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../tools/logic-harness');
const Topology = require('../src/topology.js');
const SignalPath = require('../src/signal-path.js');
const DrillArch = require('../src/drill-arch.js');
const Instructor = require('../src/instructor.js');

const ROOT = path.join(__dirname, '..');
const APP_PAGE = path.join(ROOT, 'Experion Station Simulator.dc.html');
const rd = (p) => fs.readFileSync(p, 'utf8');

function builtGraph() {
  const { Component } = load();
  const c = new Component({});
  c.initSim();
  return Topology.build({ L: c.L, V: c.V, assetTree: c.assetTree(), unitOf: (t) => c.unitOf(t) });
}
const graph = builtGraph();
const drillIds = DrillArch.drillIds();
const locOf = (id) => DrillArch.drillById(id).expectedActions.find((x) => x.id === 'LOC');

// ==================================================== GATE 1 — LEARNING

test('GATE 1 LEARNING: every layer is reachable, and every drill localises to a real one', async (t) => {
  await t.test('the layer vocabulary is the full seven the gate names', () => {
    assert.deepEqual(Topology.LAYERS.slice(),
      ['FIELD', 'IO', 'CONTROL', 'NETWORK', 'SERVICE', 'HMI', 'INFORMATION']);
  });

  await t.test('every layer is populated by real nodes in the built graph', () => {
    const seen = new Set(Object.keys(graph.nodes).map((id) => graph.nodes[id].layer));
    const empty = Topology.LAYERS.filter((l) => !seen.has(l));
    assert.deepEqual(empty, [], `layers with no node to reason about: ${empty.join(', ')}`);
  });

  await t.test('every layer is REACHABLE from a real point via ESS.SignalPath', () => {
    // The gate is about tracing, not merely about nodes existing. A layer no path ever
    // touches cannot be reasoned through from a bad-looking PV.
    const tags = Object.keys(graph.pointPaths || {});
    assert.ok(tags.length > 0, 'no configured points — the sweep would be vacuous');
    const reached = new Set();
    for (const tag of tags) {
      for (const p of SignalPath.applicablePaths(graph, tag)) {
        for (const profile of SignalPath.PROFILES) {
          const r = SignalPath.resolve(graph, tag, { path: p, profile });
          (r.nodes || []).forEach((n) => {
            const node = graph.nodes[typeof n === 'string' ? n : n.id];
            if (node) reached.add(node.layer);
          });
        }
      }
    }
    const unreachable = Topology.LAYERS.filter((l) => !reached.has(l));
    assert.deepEqual(unreachable, [],
      `layers no signal path ever reaches: ${unreachable.join(', ')} — a trainee cannot ` +
      'trace through a layer that no path touches');
  });

  await t.test('all twelve A-drills localise to a real Topology layer', () => {
    assert.equal(drillIds.length, 12);
    const bad = drillIds.filter((id) => {
      const loc = locOf(id);
      return !loc || Topology.LAYERS.indexOf(loc.payloadMatch.domain) < 0;
    });
    assert.deepEqual(bad, [], `drills localising to a non-layer: ${bad.join(', ')}`);
  });

  await t.test('a trainee starts an A-drill from the Training Drills dialog and lands in Diagnose', () => {
    const { Component } = load();
    const c = new Component({});
    c.initSim();
    c.setState({ dlg: { type: 'drills' } });
    const listed = c.renderVals().dg.archDrills || [];
    assert.equal(listed.length, 12, 'A1-A12 must be reachable from the trainee dialog');
    assert.deepEqual(listed.map((x) => x.id), drillIds);
    const a6 = listed.find((x) => x.id === 'A6');
    a6.cb();
    assert.equal(c.P.aDrill && c.P.aDrill.id, 'A6');
    assert.equal(c.state.display, 'arch');
    assert.equal(c.state.archMode, 'diagnose');
    const chips = (c.renderVals().arch.modeChips || []).map((m) => m.label || m.id);
    assert.ok(chips.some((x) => String(x).toUpperCase().includes('DIAGNOSE')),
      'Diagnose must be offered: ' + chips.join(','));
    assert.ok(!chips.some((x) => x === 'LEARN'), 'Learn stays hidden during the drill');
  });
});

// ==================================================== GATE 2 — OPERATIONS

test('GATE 2 OPERATIONS: the safety gate is live and outcome-based', async (t) => {
  await t.test('every drill defines at least one major-unsafe action', () => {
    const bare = drillIds.filter((id) => !(DrillArch.drillById(id).safetyGate || []).length);
    assert.deepEqual(bare, [], `drills with no safety gate: ${bare.join(', ')}`);
  });

  await t.test('the gate is LIVE: an accepted unsafe action caps the score below pass', () => {
    for (const id of drillIds) {
      const g = DrillArch.drillById(id).safetyGate[0];
      const res = DrillArch.scoreDrill(id, [{
        seq: 1, simTime: 100, actor: 'TRAINEE', accepted: true,
        actionType: g.actionType,
        target: Array.isArray(g.target) ? g.target[0] : g.target,
        payload: g.payloadMatch ? Object.assign({}, g.payloadMatch) : null
      }]);
      assert.equal(res.gated, true, `${id}: an unsafe action did not trip the gate`);
      assert.equal(res.pass, false, `${id}: a gated run must not pass`);
      assert.ok(res.score < DrillArch.PASS_MARK);
    }
  });

  await t.test('the rubric rewards evidence over guessing', () => {
    // "drills reward keeping the process safe over guessing the root cause" — a lone
    // correct hypothesis must not reach the pass mark on its own.
    const id = drillIds[0];
    const loc = locOf(id);
    const guessOnly = DrillArch.scoreDrill(id, [{
      seq: 1, simTime: 100, actor: 'TRAINEE', accepted: true,
      actionType: loc.actionType, payload: Object.assign({}, loc.payloadMatch)
    }]);
    assert.equal(guessOnly.pass, false,
      'a correct guess with no evidence, stabilization or verification reached the pass mark');
  });

  await t.test('the outcome-based ruling is pinned, and pinned elsewhere', () => {
    // Composed, not duplicated: tests/refusal-scoring.test.js holds the ruling and names
    // gateIsOutcomeBased as the single assertion to flip if it is overturned.
    assert.ok(fs.existsSync(path.join(__dirname, 'refusal-scoring.test.js')),
      'the file holding the outcome-based safety-gate ruling is gone');
    const src = rd(path.join(__dirname, 'refusal-scoring.test.js'));
    assert.match(src, /gateIsOutcomeBased/, 'the named reversal point is gone from the pin');
  });
});

// ==================================================== GATE 3 — DETERMINISM

test('GATE 3 DETERMINISM: the invariant is stated, stamped, and pure where it is wired', async (t) => {
  await t.test('the invariant is recorded VERBATIM in docs/ARCHITECTURE.md', () => {
    const md = rd(path.join(ROOT, 'docs', 'ARCHITECTURE.md'));
    assert.match(md, /given the same `ESS\.MODEL_ID`/,
      'V3-PLAN section 10 requires the deterministic invariant verbatim in ARCHITECTURE.md');
    assert.match(md, /PRNG state/);
    assert.match(md, /wall clock|Math\.random/,
      'the prohibition half of the invariant is missing');
  });

  await t.test('the core takes no wall-clock or uncontrolled-random dependency', () => {
    // The invariant's own prohibition, asserted rather than trusted.
    //
    // ONE ALLOWANCE, BY NAME, AND IT IS THE ONLY ONE. src/models.js createState(now) reads
    // Date.now() ONLY when the caller supplies no `now`: `t: now === undefined ? Date.now()
    // : now`. That is the simulation's start-time SEED, and the invariant is stated over a
    // fixed initial snapshot -- a restored snapshot carries its own `t`, so no deterministic
    // path reaches this branch. Allowing it by exact location rather than by pattern means
    // a SECOND wall-clock read anywhere in the core still goes red, which is the property
    // worth having. If this line moves, update the allowance deliberately; do not widen it.
    const ALLOWED = { 'src/models.js': /now === undefined \? Date\.now\(\) : now/ };
    const offenders = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
      const key = `src/${f}`;
      rd(path.join(ROOT, 'src', f)).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // prose, not code
        if (/Math\.random\s*\(/.test(line)) offenders.push(`${key}:${i + 1} Math.random`);
        if (/Date\.now\s*\(/.test(line) && !(ALLOWED[key] && ALLOWED[key].test(line))) {
          offenders.push(`${key}:${i + 1} Date.now`);
        }
      });
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  await t.test('the one allowed wall-clock read still looks exactly as allowed', () => {
    // Guards the allowance above from silently covering a rewritten line.
    assert.match(rd(path.join(ROOT, 'src', 'models.js')),
      /t: now === undefined \? Date\.now\(\) : now/,
      'the allowed seed line changed shape — re-derive the allowance rather than widening it');
  });

  await t.test('scoring is a pure function of drill + journal', () => {
    const id = drillIds[0];
    const loc = locOf(id);
    const journal = [{ seq: 1, simTime: 10, actor: 'TRAINEE', accepted: true, actionType: loc.actionType, payload: Object.assign({}, loc.payloadMatch) }];
    assert.deepEqual(DrillArch.scoreDrill(id, journal), DrillArch.scoreDrill(id, journal));
  });

  await t.test('the MODEL_ID stamp is checked, and checked elsewhere', () => {
    assert.ok(fs.existsSync(path.join(__dirname, 'model-id.test.js')));
    assert.ok(fs.existsSync(path.join(__dirname, 'determinism.test.js')));
  });

  await t.test('replay REFUSES across a truncation rather than returning a short plan', () => {
    // GATE 3 WAS BLOCKED HERE UNTIL ac7e5c6 AND IS NOW LIVE AT MODEL LEVEL. The failure
    // class the gate exists to catch is a replay that reports COMPLETE while reproducing a
    // DIFFERENT exercise. An explicit refusal is the opposite of that, so a refused replay
    // is the gate WORKING, never a gate failure. Cross-lens judgment, seat mbp-v3-gates.
    const CAP = Instructor.JOURNAL_CAP;
    const I = Instructor.create({});
    for (let n = 0; n < 50; n++) Instructor.journalAdd(I, { t: n, op: 'UPSET', tag: 'x', arg: n });
    const snap = { t: 49, journalSeq: I.seq };
    for (let n = 0; n < CAP + 500; n++) Instructor.journalAdd(I, { t: 100 + n, op: 'UPSET', tag: 'x', arg: n });
    const plan = Instructor.replayPlan(I, snap, Infinity);
    assert.equal(plan.entries.length, 0, 'a truncated replay must not be returned short');
    assert.equal(plan.refused, 'JOURNAL_TRUNCATED');
    assert.ok(/seq \d+-\d+/.test(plan.reason), 'the refusal must name the lost range, not just refuse');
    assert.equal(typeof plan.lostFromSeq, 'number');
  });

  await t.test('CONTROL: an untruncated journal is NOT refused', () => {
    // Without this the assertion above would pass against a replay that refuses everything.
    const I = Instructor.create({});
    for (let n = 0; n < 50; n++) Instructor.journalAdd(I, { t: n, op: 'UPSET', tag: 'x', arg: n });
    const snap = { t: 49, journalSeq: I.seq };
    for (let n = 0; n < 10; n++) Instructor.journalAdd(I, { t: 100 + n, op: 'UPSET', tag: 'x', arg: n });
    const plan = Instructor.replayPlan(I, snap, Infinity);
    assert.equal(plan.entries.length, 10);
    assert.ok(!plan.refused);
  });

  await t.test('the INSTRUCTOR is told a replay was refused, and what was lost', () => {
    // WAS BLOCKED, NOW LIVE. Gate 3 claims an INSTRUCTOR can restore and replay — a claim
    // about the instructor-facing surface, not only the module. Until 934b81d the app's
    // startReplay read only plan.entries.length and rendered a REFUSED plan as "NO ACTIONS
    // RECORDED AFTER SNAPSHOT": false, and reassuring, which is the failure the refusal
    // exists to prevent moved up one layer. Found by cross-lens at ac7e5c6, fixed by the
    // lead at 934b81d.
    // SCOPE OF THIS ASSERTION, stated exactly: it reads the WORKING-TREE page, because that
    // is what a test file in the tree can read. The claim that the fix is also in the
    // COMMITTED bytes was verified separately by hand (git show 934b81d:<page> | grep
    // 'REPLAY REFUSED' -> 2 occurrences) and is NOT what this assertion proves. On this
    // branch the working tree has repeatedly not been the commit — 934b81d itself ships a
    // page calling this.aDrillWatch and this.archSynthEvent with zero definitions in the
    // committed bytes — so the distinction is load-bearing, not pedantry.
    const page = rd(APP_PAGE);
    const at = page.indexOf('startReplay(i){');
    assert.ok(at > 0, 'startReplay is gone from the app page');
    const body = page.slice(at, at + 2000);
    const refusedAt = body.indexOf('plan.refused');
    const emptyAt = body.indexOf('plan.entries.length');
    assert.ok(refusedAt > 0, 'startReplay does not read plan.refused — a refused replay would be silent');
    assert.ok(refusedAt < emptyAt,
      'startReplay checks entries.length BEFORE plan.refused, so a refusal still renders as ' +
      '"nothing recorded" — the order is the whole fix');
    assert.match(body, /REPLAY REFUSED/, 'the refusal is not surfaced to the instructor by name');
    assert.match(body, /lostFromSeq/, 'the refusal message does not say WHICH actions were lost');
  });
});

// ==================================================== GATE 4 — SEPARATION

test('GATE 4 SEPARATION: the core reaches no network, and names no gateway', async (t) => {
  // The cheapest gate to regress and the one that has held all build. One accidental
  // fetch() in a helper and the standalone stops being standalone.
  const NETWORK = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.connection)\b/;
  const DYNAMIC_IMPORT = /\bimport\s*\(/;

  await t.test('no src/*.js module reaches the network', () => {
    const offenders = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
      rd(path.join(ROOT, 'src', f)).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (NETWORK.test(line) || DYNAMIC_IMPORT.test(line)) offenders.push(`src/${f}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  await t.test('the app page reaches the network nowhere', () => {
    const offenders = [];
    rd(APP_PAGE).split('\n').forEach((line, i) => {
      if (NETWORK.test(line) || DYNAMIC_IMPORT.test(line)) offenders.push(`app:${i + 1} ${line.trim().slice(0, 80)}`);
    });
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  await t.test('no absolute URL outside XML namespaces', () => {
    // An xmlns is a namespace identifier, never fetched. Anything else is a live link.
    const offenders = [];
    for (const [label, file] of [['app', APP_PAGE]].concat(
      fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => [`src/${f}`, path.join(ROOT, 'src', f)]))) {
      rd(file).split('\n').forEach((line, i) => {
        const m = line.match(/https?:\/\/[^\s"'<>)]+/g);
        if (!m) return;
        m.forEach((u) => {
          if (/w3\.org|xmlns/.test(line)) return;
          offenders.push(`${label}:${i + 1} ${u}`);
        });
      });
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  await t.test('nothing in the core names a gateway or model service', () => {
    const BANNED = /\b(gateway|grpc|websocket server|model service|inference endpoint|openai|anthropic|api[_-]?key)\b/i;
    const offenders = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
      rd(path.join(ROOT, 'src', f)).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (BANNED.test(line)) offenders.push(`src/${f}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  await t.test('the shipped standalone reaches no REMOTE HOST at runtime', () => {
    // THE GATE IS "RUNS FULLY OFFLINE", so the property is remote REACHABILITY, not the
    // presence of a URL string. Two unpkg.com URLs DO appear in the standalone, and they
    // are not a violation: they sit in the <script type="__bundler/ext_resources">
    // manifest as URL -> uuid IDENTIFIERS for resources the bundler has already inlined
    // as blobs. support.js (the dc-runtime shim, which hard rule 2 forbids editing) reads
    // the embedded blob and only falls back to fetch(s.src) when a blob is MISSING.
    //
    // Which is exactly the regression this asserts. If a future build drops a blob while
    // leaving its id in the manifest, the URL still looks the same, nothing errors, and
    // the standalone silently starts loading React from the network on first open —
    // offline it would simply fail to render. So the real gate is: EVERY external
    // resource id must have its uuid embedded. That is the condition gate 4 rests on.
    const dist = path.join(ROOT, 'dist', 'experion-station-sim-standalone.html');
    assert.ok(fs.existsSync(dist), 'the standalone artifact is missing');
    const html = rd(dist);

    const m = html.match(/<script type="__bundler\/ext_resources">\s*(\[[\s\S]*?\])\s*<\/script>/);
    const ext = m ? JSON.parse(m[1]) : [];
    const orphans = ext.filter((e) => {
      // once as its own id in this manifest; a second occurrence means it is embedded
      return (html.split(e.uuid).length - 1) < 2;
    });
    assert.deepEqual(orphans.map((e) => e.id), [],
      'external resources declared but NOT embedded — the standalone will fetch these from ' +
      'the network on first open and will not render offline');

    // No remote host anywhere OUTSIDE that manifest and the runtime's own prose.
    const declared = new Set(ext.map((e) => e.id));
    const remote = (html.match(/https?:\/\/[^\s"'<>)]+/g) || [])
      .filter((u) => !/w3\.org|schema\.org|purl\.org/.test(u))
      .filter((u) => !declared.has(u))
      .filter((u) => u !== 'https://\u2026'); // an ellipsis in a support.js comment
    assert.deepEqual(remote, [], `unexplained remote hosts in the standalone: ${remote.slice(0, 5).join(', ')}`);

    assert.equal(/<script\s+src=\s*["']https?:/.test(html), false, 'the standalone loads a remote script');
    assert.equal(/<link[^>]+href=\s*["']https?:/.test(html), false, 'the standalone loads a remote stylesheet');
  });

  await t.test('the standalone inlines everything: no local script tags left either', () => {
    const html = rd(path.join(ROOT, 'dist', 'experion-station-sim-standalone.html'));
    assert.equal(/<script\s+src=\s*["']\.\//.test(html), false,
      'the standalone still references a local ./src file instead of inlining it');
  });
});

// ==================================================== BUILD INTEGRITY

test('BUILD INTEGRITY: the page never calls a method it does not define', async (t) => {
  // NOT one of the five gates — a guard against the failure class that has broken this
  // branch THREE times: a commit staged from a dirty tree while another lane was mid-edit,
  // capturing a page that CALLS a method whose definition lives only in the working tree.
  // aaba44a (stamp computed over a dirty tree), 5733756 (two lanes mixed into one sha), and
  // 934b81d (this.aDrillWatch + this.archSynthEvent called, zero definitions) were all the
  // same shape. Every module suite stayed green each time, because the defect is in the
  // PAGE and only the folder build exercises it.
  //
  // The instrument is seat 3/3's, from its 934b81d verdict: compare every `this.X(` CALL in
  // the page against every method DEFINITION in it. Adopted here so it runs on every suite
  // rather than only when a verifier happens to look.
  const page = rd(APP_PAGE);

  await t.test('every this.X() call resolves to a definition or an assigned field', () => {
    const calls = new Set();
    const callRe = /this\.([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = callRe.exec(page))) calls.add(m[1]);

    const defined = new Set();
    // class methods:  "  name(args) {"
    const defRe = /^\s{2}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
    while ((m = defRe.exec(page))) defined.add(m[1]);
    // assigned function fields:  "this.name = (…) =>" / "= function"
    const assignRe = /this\.([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
    while ((m = assignRe.exec(page))) defined.add(m[1]);
    // anything assigned at all can hold a callable supplied elsewhere
    const anyAssign = /this\.([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = anyAssign.exec(page))) defined.add(m[1]);

    // Inherited from DCLogic and the browser surface the harness stubs.
    const INHERITED = new Set(['setState', 'forceUpdate', 'render', 'renderVals',
      'componentDidMount', 'componentDidUpdate', 'componentWillUnmount', 'constructor']);

    const missing = [...calls].filter((n) => !defined.has(n) && !INHERITED.has(n)).sort();
    assert.deepEqual(missing, [],
      'the app page calls methods it does not define: ' + missing.join(', ') +
      '. This is the signature of a commit staged from a dirty tree — the definitions ' +
      'exist in someone\'s working tree and not in what was committed. Stage by path, and ' +
      'verify the slice in a scratch clone at the sha before announcing it.');
  });

  await t.test('POSITIVE CONTROL: the scan would catch a missing definition', () => {
    // Without this the assertion above passes on an empty call set or a broken regex.
    const calls = (page.match(/this\.[A-Za-z_$][\w$]*\s*\(/g) || []).length;
    assert.ok(calls > 100, `only ${calls} this.X() calls found — the scan regex is not working`);
    const fake = 'class C {\n  a(){ this.definitelyNotDefined(1); }\n}';
    const fakeCalls = [...fake.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]);
    assert.ok(fakeCalls.includes('definitelyNotDefined'), 'the call regex misses a real call');
  });
});

// ==================================================== GATE 5 — PROVENANCE

test('GATE 5 PROVENANCE: every concept traces to a registered public source', async (t) => {
  await t.test('the registries exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'RESOURCES.md')));
    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'SOURCE-PROVENANCE.md')),
      'V3-PLAN S5 requires docs/SOURCE-PROVENANCE.md as the provenance registry');
  });

  await t.test('the automated provenance check EXISTS and is not vacuous', () => {
    const p = path.join(__dirname, 'provenance.test.js');
    assert.ok(fs.existsSync(p), 'gate 5 names an automated provenance test; it is missing');
    const src = rd(p);
    assert.match(src, /RESOURCES-/, 'the provenance test no longer resolves registry ids');
    assert.match(src, /POSITIVE CONTROL/, 'the provenance test lost its own teeth check');
  });

  await t.test('every topology node still carries a resolving sourceBasis', () => {
    const bare = Object.keys(graph.nodes).filter((id) => !(graph.nodes[id].sourceBasis || []).length);
    assert.deepEqual(bare, [], `nodes with no provenance: ${bare.join(', ')}`);
  });

  await t.test('RULE 6: no employer or real-site material by name', () => {
    // The local-only exclusion registry, asserted so it cannot leak into a shipped artifact.
    const BANNED = /\bGreene Street\b/i;
    const offenders = [];
    for (const [label, file] of [['app', APP_PAGE], ['dist', path.join(ROOT, 'dist', 'experion-station-sim-standalone.html')]]) {
      if (!fs.existsSync(file)) continue;
      if (BANNED.test(rd(file))) offenders.push(label);
    }
    assert.deepEqual(offenders, [], `real-site material present in: ${offenders.join(', ')}`);
  });

  await t.test('RULE 1: no vendor artwork, icons or filenames shipped', () => {
    const html = rd(APP_PAGE);
    assert.equal(/\.(png|jpe?g|gif|ico|woff2?)\b/i.test(html), false,
      'a binary asset filename is referenced from the app page — rule 1 forbids vendor artwork/icons');
  });

  await t.test('SKIPPED: rules 1 and 6 across the whole DIFF', { skip:
    'Gate 5 says "rules 1 and 6 hold across the diff". This file asserts them across the ' +
    'shipped ARTIFACTS, which is what a test can see. A diff-wide review of every commit ' +
    'from f8301fb is a human judgment about provenance of prose and imagery, not a ' +
    'mechanical check, and V3-PLAN S5 assigns it to the release review. Recording the ' +
    'boundary rather than pretending the artifact check covers it.'
  }, () => {});
});
