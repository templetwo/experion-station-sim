/*
 * ESS.Palette — colour philosophy presets for the station display.
 *
 * Presets
 *   'representative'  the sim's current defaults (bright saturated priority
 *                     fills on the neutral grey chrome, as in the shipping
 *                     app: Urgent red, High yellow, Low cyan, Journal grey).
 *   'isa101'          the ISA-101-aligned values documented in the Rockwell
 *                     Process HMI Style Guide (RESOURCES 2.4): background
 *                     #E0E0E0, lines #A0A0A4, priority fills Urgent #E22028,
 *                     High #EC8629, Medium #F5E11B, Low #916AAD, equipment
 *                     stopped #808080, running #F0F0F0, manual #93C2E4.
 *                     The style guide's four alarm levels map onto the four
 *                     Experion priorities in rank order: Urgent -> Urgent red,
 *                     High -> High orange, Low -> Medium yellow, Journal
 *                     (event-only, lowest) -> Low magenta.
 *
 * API
 *   getPalette(name) -> {
 *     name, bg, line, text,
 *     prio:     {Urgent, High, Low, Journal}   fill behind an alarm row/badge
 *     prioText: {Urgent, High, Low, Journal}   text colour on that fill
 *     prioDim:  {Urgent, High, Low, Journal}   dark variant used as text on bg
 *     state:    {stopped, running, manual}     equipment state fills
 *     stateText:{stopped, running, manual}     text on those fills
 *     band:     {target, normal, range, marker}  limit-ladder band fills
 *               (target = operating band, normal = inside the standard
 *               limits, range = the rest of the instrument range, marker =
 *               the live PV pointer); critical and standard zones are drawn
 *               with the priority colour of the alarm that guards them.
 *   }  (unknown name falls back to 'representative')
 *   list() -> ['representative', 'isa101']
 *   contrastRatio(fg, bg) -> WCAG 2.x luminance contrast ratio (1..21)
 *   luminance(hex) -> relative luminance 0..1
 *   textPairs(palette) -> [{label, fg, bg}] every text/background pair the
 *     display draws, for auditing (tests require each >= 3:1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.ESS = root.ESS || {}).Palette = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PRESETS = {
    representative: {
      name: 'representative', bg: '#BFBFBF', line: '#3A3A3A', text: '#000000',
      prio: { Urgent: '#FF0000', High: '#FFE000', Low: '#00D8D8', Journal: '#909090' },
      prioText: { Urgent: '#FFFFFF', High: '#000000', Low: '#000000', Journal: '#000000' },
      prioDim: { Urgent: '#A00000', High: '#7A6400', Low: '#00696D', Journal: '#666666' },
      state: { stopped: '#FFFFFF', running: '#4A4A4A', manual: '#FFE000' },
      stateText: { stopped: '#4A4A4A', running: '#FFFFFF', manual: '#000000' },
      band: { target: '#6E86A0', normal: '#F2F2F0', range: '#A8A8A4', marker: '#000000' }
    },
    isa101: {
      name: 'isa101', bg: '#E0E0E0', line: '#A0A0A4', text: '#000000',
      prio: { Urgent: '#E22028', High: '#EC8629', Low: '#F5E11B', Journal: '#916AAD' },
      prioText: { Urgent: '#FFFFFF', High: '#000000', Low: '#000000', Journal: '#FFFFFF' },
      prioDim: { Urgent: '#A9161D', High: '#8A4609', Low: '#6E6300', Journal: '#5C3E78' },
      state: { stopped: '#808080', running: '#F0F0F0', manual: '#93C2E4' },
      stateText: { stopped: '#000000', running: '#000000', manual: '#000000' },
      band: { target: '#93C2E4', normal: '#F0F0F0', range: '#A0A0A4', marker: '#000000' }
    }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function list() { return Object.keys(PRESETS); }
  function getPalette(name) { return clone(PRESETS[name] || PRESETS.representative); }

  function channel(v) {
    var c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function parseHex(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(hex) {
    var c = parseHex(hex);
    return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  }

  function contrastRatio(fg, bg) {
    var a = luminance(fg), b = luminance(bg);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  function textPairs(p) {
    var pairs = [{ label: 'text on bg', fg: p.text, bg: p.bg }];
    Object.keys(p.prio).forEach(function (k) {
      pairs.push({ label: k + ' text on fill', fg: p.prioText[k], bg: p.prio[k] });
      pairs.push({ label: k + ' dim text on bg', fg: p.prioDim[k], bg: p.bg });
      pairs.push({ label: k + ' dim text on white', fg: p.prioDim[k], bg: '#FFFFFF' });
      pairs.push({ label: 'white text on ' + k + ' dim', fg: '#FFFFFF', bg: p.prioDim[k] });
    });
    Object.keys(p.state).forEach(function (k) {
      pairs.push({ label: k + ' state text', fg: p.stateText[k], bg: p.state[k] });
    });
    return pairs;
  }

  return { getPalette: getPalette, list: list, contrastRatio: contrastRatio, luminance: luminance, textPairs: textPairs };
});
