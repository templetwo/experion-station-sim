// @artifact dev
// Evaluate the app's <script data-dc-script> Component class outside the browser
// so pure logic (alarm engine, PID, process models, drills) can be unit-tested
// with node. Mirrors the dc-runtime: DCLogic base with props/state/setState.
// Usage: const { Component, load } = require('./tools/logic-harness');
const fs = require('fs');
const path = require('path');

class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(update, cb) {
    const upd = typeof update === 'function' ? update(this.state, this.props) : update;
    Object.assign(this.state, upd || {});
    if (cb) cb();
  }
  forceUpdate() {}
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() { return {}; }
}

function installBrowserStubs() {
  const g = globalThis;
  if (!g.window) g.window = g;
  const noop = () => {};
  const el = () => ({ addEventListener: noop, removeEventListener: noop, focus: noop, blur: noop, style: {}, value: '', getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) });
  if (!g.document) g.document = { addEventListener: noop, removeEventListener: noop, body: el(), documentElement: el(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, activeElement: null, hasAttribute: () => false, title: '' };
  if (!g.localStorage) { const m = new Map(); g.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; }
  if (!g.requestAnimationFrame) g.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 16);
  if (!g.cancelAnimationFrame) g.cancelAnimationFrame = clearTimeout;
  if (!g.navigator) g.navigator = { userAgent: 'node' };
  if (!g.AudioContext) g.AudioContext = undefined;
  if (!g.location) g.location = { href: 'file:///harness', search: '', hash: '' };
  if (!g.performance) g.performance = { now: () => Date.now() };
}

function load(opts = {}) {
  installBrowserStubs();
  const file = opts.file || path.join(__dirname, '..', 'Experion Station Simulator.dc.html');
  const html = fs.readFileSync(file, 'utf8');
  // local modules referenced from the page, in document order, before the component
  const srcs = [...html.matchAll(/<script src="(\.\/[^"]+)"><\/script>/g)].map(m => m[1]).filter(s => s !== './support.js');
  for (const s of srcs) {
    const code = fs.readFileSync(path.join(path.dirname(file), s), 'utf8');
    new Function('window', 'globalThis', code)(globalThis, globalThis);
  }
  const m = html.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no data-dc-script block found');
  const fn = new Function('DCLogic', 'StreamableLogic', 'React', m[1] + '\n;return (typeof Component!=="undefined"&&Component)||undefined;');
  const Component = fn(DCLogic, DCLogic, {});
  if (!Component) throw new Error('script did not define Component');
  return { Component, DCLogic, modules: srcs };
}

module.exports = { load, DCLogic };
if (require.main === module) {
  const { Component } = load();
  const c = new Component({});
  console.log('Component constructed; state keys:', Object.keys(c.state).length ? Object.keys(c.state).slice(0, 40) : '(state set later)');
  console.log('methods:', Object.getOwnPropertyNames(Component.prototype).length);
}
