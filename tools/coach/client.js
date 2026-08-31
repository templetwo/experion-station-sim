// @artifact dev
/* Injected only by tools/coach/serve.py. The PAGE never fetches. */
(function () {
  'use strict';
  if (window.__ESS_COACH_UI__) return;
  window.__ESS_COACH_UI__ = true;

  var BANNED = [
    'FROZEN_MEASUREMENT', 'BIASED_MEASUREMENT', 'NOISY_MEASUREMENT',
    'OPEN_INPUT_BAD_QUALITY', 'VALVE_RESPONSE_FAILURE',
    'CONTROLLER_LOSS', 'REDUNDANCY_SWITCHOVER',
    'NET_PATH_DEGRADED', 'COMMS_PARTITION',
    'SERVER_SERVICE_DEGRADED', 'STATION_LOSS_PEER',
    'HISTORIAN_GAP', 'ASSISTANT_LOSS', 'INSTRUCTOR_ONLY'
  ];

  function findLogic() {
    var all = document.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var L = all[i].logic;
      if (L && L.alarmEngine && L.L && typeof L.setState === 'function') return L;
    }
    return null;
  }

  function projection() {
    var c = findLogic();
    if (!c || !window.ESS_COACH_PROJ) return null;
    return window.ESS_COACH_PROJ.build(c);
  }

  function scrub(text) {
    var t = String(text || '');
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    BANNED.forEach(function (id) { t = t.split(id).join('[hidden]'); });
    return t;
  }

  function paint(patch) {
    var c = findLogic();
    if (!c) return;
    var next = { coachLive: true, assist: true };
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    c.setState(next);
  }

  var busy = false;
  var lastSig = '';
  var lastTipAt = 0;

  function advise(kind, question) {
    var p = projection();
    if (!p) { paint({ coachStatus: 'WAITING', coachText: 'Station not ready yet.' }); return; }
    if (busy) return;
    busy = true;
    paint({ coachStatus: 'THINKING', assist: true });
    fetch('/api/advise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, ask: question || '', projection: p })
    }).then(function (r) { return r.json(); }).then(function (j) {
      busy = false;
      paint({
        coachStatus: j.ok ? 'LOCAL MODEL' : 'SIDECAR DOWN',
        coachText: scrub(j.text || j.error || 'No reply.')
      });
    }).catch(function () {
      busy = false;
      paint({
        coachStatus: 'SIDECAR DOWN',
        coachText: 'Cannot reach the local model. LIVE DIAGNOSIS above still works.'
      });
    });
  }

  window.__ESS_COACH_ASK = function (kind, q) { advise(kind || 'explain', q || ''); };

  function sigOf(p) {
    if (!p || !p.alarms) return '';
    return p.alarms.map(function (a) { return a.tag + '.' + a.cond + '.' + a.state; }).join('|');
  }

  function tick() {
    var c = findLogic();
    if (c && !c.state.coachLive) paint({ coachStatus: 'LOCAL MODEL', coachText: 'Watching the board. I will speak when an alarm raises. EXPLAIN ALARM or type a question and ASK AI.' });
    var p = projection();
    if (!p) { setTimeout(tick, 800); return; }
    if (!lastSig) { lastSig = sigOf(p); setTimeout(tick, 2000); return; }
    var s = sigOf(p);
    var now = Date.now();
    var newUnack = p.alarms.some(function (a) {
      return a.state === 'UNACK' && lastSig.indexOf(a.tag + '.' + a.cond + '.UNACK') < 0;
    });
    lastSig = s;
    if (newUnack && !busy && (now - lastTipAt) > 8000) {
      lastTipAt = now;
      advise('tip', '');
    }
    setTimeout(tick, 2000);
  }
  setTimeout(tick, 600);
})();
