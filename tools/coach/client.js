// @artifact dev
/* Injected only by tools/coach/serve.py. Uses window.__ESS_COACH_CORE__ from the station. */
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

  function core() { return window.__ESS_COACH_CORE__ || null; }

  function scrub(text) {
    var t = String(text || '');
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    BANNED.forEach(function (id) { t = t.split(id).join('[hidden]'); });
    return t;
  }

  var busy = false;
  var lastSig = '';
  var lastTipAt = 0;
  var modelName = 'granite4.2:8b';

  fetch('/api/health').then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.model) modelName = j.model;
  }).catch(function () {});

  function advise(kind, question) {
    var c = core();
    if (!c) return;
    var p = c.projection();
    if (!p) {
      c.paint({ coachStatus: modelName, coachText: 'Station not ready yet.' });
      return;
    }
    if (busy) return;
    busy = true;
    c.paint({ coachStatus: 'THINKING · ' + modelName });
    fetch('/api/advise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, ask: question || '', projection: p })
    }).then(function (r) { return r.json(); }).then(function (j) {
      busy = false;
      c.paint({
        coachStatus: j.ok ? modelName : 'SIDECAR DOWN',
        coachText: scrub(j.text || j.error || 'No reply.')
      });
    }).catch(function () {
      busy = false;
      c.paint({
        coachStatus: 'SIDECAR DOWN',
        coachText: 'Cannot reach ' + modelName + '. LIVE DIAGNOSIS above still works.'
      });
    });
  }

  window.__ESS_COACH_ASK = function (kind, q) { advise(kind || 'explain', q || ''); };

  function sigOf(p) {
    if (!p || !p.alarms) return '';
    return p.alarms.map(function (a) { return a.tag + '.' + a.cond + '.' + a.state; }).join('|');
  }

  function tick() {
    var c = core();
    if (!c) { setTimeout(tick, 400); return; }
    if (!c._hello) {
      c._hello = true;
      c.paint({
        coachStatus: modelName,
        coachText: 'Watching the board on ' + modelName + '. I will speak when an alarm raises. EXPLAIN ALARM, or type a question and ASK AI.'
      });
    }
    var p = c.projection();
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
  setTimeout(tick, 400);
})();
