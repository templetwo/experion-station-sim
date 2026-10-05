// @artifact production
/*
 * ESS.Pid — the sim's Experion-style PID as a pure, testable module.
 *
 * Operates on the same loop record the app keeps in `this.L[tag]`
 * (CODE-MAP 2.4/2.5): pv, sp, op, I, lastPv, K, T1, T2, act, mode, modeAttr,
 * master, slave, init, sphilm, splolm, ophilm, oplolm, badPv, lo, hi, tag.
 * Optional extra fields this module reads/writes: pvtrack (bool),
 * dFilter (seconds, derivative filter time constant), dState (filtered
 * derivative memory, %/s), pvObs (the observed transmitter value the plant
 * writes each tick; read through pvOf, never written here), trk (the output-
 * tracking request {on, target, reason, kind}; the plant sets and clears it
 * through setTracking / clearTracking, stepPid and runInitman read it), spCutoff
 * (a flow loop's low-flow cutoff in engineering units; the plant sets it from the
 * measurement policy, this module only reads it, CR40).
 *
 * Equation (error in % of span, times in minutes, ISA standard form; pv is pvOf(loop)):
 *   e  = (pv - sp) / span * 100   for DIR,  (sp - pv) for REV
 *   OP = K * e  +  I  +  D,   I += K * e * dt / (T1 * 60),
 *   D  = -K * T2 * 60 * d(pv%)/dt   (derivative on PV, optionally filtered)
 * OP is clamped to [OPLOLM, OPHILM]; the integral is back-calculated so
 * the sum equals the clamped value (anti-reset-windup, Kantor CBE30338
 * "PID control with anti-windup", RESOURCES 4.6) and integration is skipped
 * while the error would push further into the active limit.
 *
 * API
 *   stepPid(loop, dt, ctx) -> loop      one control interval (dt seconds).
 *     ctx = { loops: {tag: loop}, casMap: {slaveTag: masterOp -> slaveSp},
 *             invMap: {slaveTag: slaveSp -> masterOp}, dFilter?: seconds }
 *     - primaries (loop.slave set) run INITMAN back-calculation when the
 *       slave is not in CAS, or is in CAS but tracking its output (tracking
 *       below): op tracks invMap(slave.sp), init = true.
 *     - CAS loops take sp = clamp(casMap[tag](master.op), SPLOLM, SPHILM).
 *     - tracking (see tracking(loop)): a CAS loop still takes its SP from the
 *       master first; then OP is held, at trk.target itself for an interlock
 *       (the plant forces the valve there whatever the loop's output limits, so
 *       OP must read the valve, CR34) and at clamp(trk.target, OPLOLM, OPHILM)
 *       for a device hold; the integrator tracks OP so the release is bumpless,
 *       and with pvtrack the SP follows PV. Nothing else runs on that scan. A
 *       primary that is running INITMAN never reaches this branch on that scan,
 *       so a request of its own is ignored while it back-calculates (the planned
 *       callers are never primaries).
 *     - MAN / bad PV: no control action; integrator tracks op so a later
 *       transfer to AUTO is bumpless; with pvtrack the SP tracks PV
 *       (PVTRACK-style option: SP follows PV in MAN so AUTO starts at
 *       zero error).
 *     - low-flow shutoff (CR40, CR40b, CREDIBILITY-PASS-SPEC 2.2): a loop that
 *       carries spCutoff and owns its setpoint (mode AUTO; not MAN, not CAS, not
 *       held by tracking, PV good) drives OP to OPLOLM while sp <= spCutoff. The
 *       transmitter reads 0 below the cutoff, so SP 0 against an observed 0 is
 *       no error; without this the output froze wherever the integral tail left
 *       it and a flow the loop could not see kept running. A zero setpoint means
 *       no flow, not no error. The integrator tracks OP as in a hold, so the
 *       return is bumpless when the setpoint rises above the cutoff. A cascade
 *       secondary following its master (CAS) is exempt: its setpoint is the
 *       master's demand passing through the band on a cascade return, not an
 *       instruction to stop; the master's output limit and the plant's interlock
 *       and device holds (tracking) close the valve where that is meant. PV
 *       tracking does not apply inside the shutoff: the setpoint is the stop
 *       instruction and must not be overwritten by the running flow (applied, a
 *       pvtrack loop in AUTO at SP 0 would take SP := PV and re-open on the next
 *       scan). Nothing else runs on that scan.
 *   transferMode(loop, newMode, ctx) -> {ok, reason}   bumpless MAN->AUTO,
 *     AUTO->CAS, etc.: the integrator is re-initialised so the first AUTO/
 *     CAS output equals the current OP, while no tracking request is in
 *     force (a tracking loop holds its target on the next scan instead).
 *     Does not gate on security; the app does that. Refuses CAS without a
 *     master and non-MAN with bad PV.
 *   canOperatorWrite(loop, param) -> boolean   PROGRAM mode attribute:
 *     while modeAttr is 'PROGRAM' the sequence owns SP, OP and MODE, so
 *     operator writes to those are denied; engineering parameters (K, T1,
 *     T2, limits, trip points) stay writable. (EXP-01 objectives list
 *     "PV tracking, and program" as control conventions, RESOURCES 2.12.)
 *   writeDenial(loop, param) -> string    message-zone text for a denial.
 *   isaForm(K, T1, T2) -> {Kc, Ti, Td, TiSec, TdSec, Kp, Ki, Kd}
 *     the loop's tuning expressed as ISA standard form (minutes and
 *     seconds) and as parallel/independent gains for the Loop Tune tab.
 *   loopError(loop) -> error in % of span, signed for the control action.
 *   pvOf(loop) -> number    the PV every read in this module uses: loop.pvObs when the
 *     plant wrote an observed transmitter value (a number), else the raw loop.pv. A
 *     controller cannot see what the transmitter cannot send (CREDIBILITY-PASS-SPEC 2.3),
 *     so the error, the derivative, lastPv and PV tracking all act on it.
 *   setTracking(loop, target, reason, kind)   the plant tells the loop to hold its output at
 *     target for a reason (the operator-facing text, e.g. 'P-101 STOPPED'). A non-finite target
 *     (undefined, NaN, Infinity) is stored as 0, so a bad value can never reach OP as NaN. The
 *     hold is the target itself for an interlock (the plant forces the valve to it regardless of
 *     the loop's output limits, CR34) and clamp(target, OPLOLM, OPHILM) for a device hold. kind
 *     is 'interlock' (holds in every mode) or 'device' (device feedback: yields to the operator
 *     in MAN); any other kind is taken as 'device'. Stored as loop.trk = {on, target, reason,
 *     kind}. The module is told; it never decides who tracks (CREDIBILITY-PASS-SPEC 3.1).
 *   clearTracking(loop)   release the hold: trk.on goes false, target and reason are emptied,
 *     kind is kept. A loop that never tracked is left exactly as it was.
 *   tracking(loop) -> boolean   true when a tracking request is in force for this scan: kind
 *     'interlock' in any mode, kind 'device' outside MAN. stepPid and runInitman both ask it.
 *   shutoff(loop) -> boolean   true when the low-flow shutoff holds the loop on this scan: spCutoff
 *     finite, mode AUTO (it owns its setpoint), no tracking request in force, PV good, sp <= spCutoff.
 *     The one question stepPid and the plant's Live Diagnosis saturation card both ask, so an output
 *     the shutoff parks at OPLOLM is not read as a loop saturated by a disturbance (CR40).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.ESS = root.ESS || {}).Pid = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var OPERATOR_OWNED = { SP: true, OP: true, MODE: true };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function span(loop) { var s = loop.hi - loop.lo; return s > 0 ? s : 100; }

  // The value the controller sees: the observed transmitter value when the plant wrote one
  // (plant-core measure(), spec §2.3), otherwise the raw point value. Never the model's truth
  // when a transmitter would have saturated.
  function pvOf(loop) { return typeof loop.pvObs === 'number' ? loop.pvObs : loop.pv; }

  function loopError(loop) {
    var raw = loop.act === 'DIR' ? (pvOf(loop) - loop.sp) : (loop.sp - pvOf(loop));
    return raw / span(loop) * 100;
  }

  function clampSp(loop, sp) {
    var lo = typeof loop.splolm === 'number' ? loop.splolm : loop.lo;
    var hi = typeof loop.sphilm === 'number' ? loop.sphilm : loop.hi;
    return clamp(sp, lo, hi);
  }

  function clampOp(loop, op) {
    var lo = typeof loop.oplolm === 'number' ? loop.oplolm : 0;
    var hi = typeof loop.ophilm === 'number' ? loop.ophilm : 100;
    return clamp(op, lo, hi);
  }

  function mapFn(table, tag) {
    if (!table) return null;
    var f = table[tag];
    return typeof f === 'function' ? f : null;
  }

  // Derivative of PV in %/s, optionally through a first-order filter
  // (derivative-on-measurement filter, Kantor CBE30338, RESOURCES 4.6).
  function pvDerivative(loop, dt, ctx) {
    var raw = ((pvOf(loop) - loop.lastPv) / span(loop)) * 100 / dt;
    var tau = typeof loop.dFilter === 'number' ? loop.dFilter : (ctx && typeof ctx.dFilter === 'number' ? ctx.dFilter : 0);
    if (!(tau > 0)) { loop.dState = raw; return raw; }
    var prev = typeof loop.dState === 'number' ? loop.dState : raw;
    var filtered = prev + (raw - prev) * dt / (tau + dt);
    loop.dState = filtered;
    return filtered;
  }

  function derivativeTerm(loop, dt, ctx) {
    if (!(loop.T2 > 0) || !(dt > 0)) return 0;
    return -loop.K * loop.T2 * 60 * pvDerivative(loop, dt, ctx);
  }

  // Hold the integrator so that a later transfer to AUTO reproduces the
  // current OP (I = OP - P - D with D taken as zero at rest).
  function trackIntegrator(loop) {
    loop.I = loop.op - loop.K * loopError(loop);
    loop.lastPv = pvOf(loop);
    loop.dState = 0;
  }

  function runInitman(loop, ctx) {
    var slave = ctx && ctx.loops ? ctx.loops[loop.slave] : null;
    if (!slave) { loop.init = false; return false; }
    loop.init = slave.mode !== 'CAS' || tracking(slave);
    if (!loop.init) return false;
    var inv = mapFn(ctx.invMap, loop.slave);
    var target = inv ? inv(slave.sp) : slave.sp;
    loop.op = clampOp(loop, target);
    trackIntegrator(loop);
    return true;
  }

  function followMaster(loop, ctx) {
    var master = ctx && ctx.loops ? ctx.loops[loop.master] : null;
    if (!master) return;
    var cas = mapFn(ctx.casMap, loop.tag);
    loop.sp = clampSp(loop, cas ? cas(master.op) : master.op);
  }

  // A bad PV must never drag the SP with it (the shed already holds the loop in MAN).
  function applyPvTracking(loop) {
    if (loop.pvtrack && !loop.badPv) loop.sp = clampSp(loop, pvOf(loop));
  }

  // Output tracking (spec §3.1): the plant tells a loop to hold its output at a target with a
  // reason. An interlock holds in every mode, at the raw target (CR34: the plant forces the valve there
  // whatever the loop's output limits, so OP reads the valve); a device-feedback hold yields to the
  // operator in MAN and stays inside the output limits. The module is told, it never decides who tracks.
  // A target that is not a finite number is held at 0 rather than let NaN into OP and the integrator.
  function setTracking(loop, target, reason, kind) {
    var t = Number.isFinite(target) ? target : 0;
    loop.trk = { on: true, target: t, reason: String(reason || ''), kind: kind === 'interlock' ? 'interlock' : 'device' };
  }
  function clearTracking(loop) {
    if (loop.trk && loop.trk.on) loop.trk = { on: false, target: null, reason: '', kind: loop.trk.kind };
  }
  function tracking(loop) {
    return !!(loop.trk && loop.trk.on) && (loop.trk.kind === 'interlock' || loop.mode !== 'MAN');
  }

  // The CR40 shutoff question, shared with the plant's Live Diagnosis (see the header). In stepPid it is asked after the tracking and MAN /
  // bad-PV paths have returned, so those three terms only matter to a caller outside it.
  function shutoff(loop) {
    return loop.mode === 'AUTO' && !loop.badPv && !tracking(loop) && Number.isFinite(loop.spCutoff) && loop.sp <= loop.spCutoff;
  }

  function stepPid(loop, dt, ctx) {
    ctx = ctx || {};
    if (loop.kind && loop.kind !== 'pid') return loop;
    if (typeof loop.lastPv !== 'number') loop.lastPv = pvOf(loop);
    if (typeof loop.I !== 'number') loop.I = loop.op;

    if (loop.slave && runInitman(loop, ctx)) { applyPvTracking(loop); return loop; }
    if (loop.mode === 'CAS' && loop.master) followMaster(loop, ctx);
    if (tracking(loop)) { loop.op = loop.trk.kind === 'interlock' ? loop.trk.target : clampOp(loop, loop.trk.target); applyPvTracking(loop); trackIntegrator(loop); return loop; }
    if (loop.mode === 'MAN' || loop.badPv) { applyPvTracking(loop); trackIntegrator(loop); return loop; }
    // Low-flow shutoff (CR40, CR40b): a flow loop that owns its setpoint (AUTO) and whose setpoint is at or below its cutoff closes to
    // OPLOLM. The observed PV reads 0 below the cutoff, so the ordinary law would see no error and leave the valve cracked. A CAS
    // secondary is exempt: its setpoint is its master's demand passing through the band, not an instruction to stop. No PV tracking in
    // here: the setpoint is the stop instruction, and the running flow must not overwrite it.
    if (shutoff(loop)) {
      loop.op = clampOp(loop, typeof loop.oplolm === 'number' ? loop.oplolm : 0);
      trackIntegrator(loop);
      return loop;
    }

    var e = loopError(loop);
    var P = loop.K * e;
    var D = derivativeTerm(loop, dt, ctx);
    var lo = typeof loop.oplolm === 'number' ? loop.oplolm : 0;
    var hi = typeof loop.ophilm === 'number' ? loop.ophilm : 100;

    var unclamped = P + loop.I + D;
    var pushingHigh = unclamped >= hi && e > 0;
    var pushingLow = unclamped <= lo && e < 0;
    if (loop.T1 > 0 && !pushingHigh && !pushingLow) loop.I += loop.K * e * dt / (loop.T1 * 60);

    var op = P + loop.I + D;
    if (op > hi) { op = hi; loop.I = op - P - D; }
    if (op < lo) { op = lo; loop.I = op - P - D; }
    loop.op = op;
    loop.lastPv = pvOf(loop);
    return loop;
  }

  function transferMode(loop, newMode, ctx) {
    ctx = ctx || {};
    if (loop.badPv && newMode !== 'MAN') return { ok: false, reason: 'PV BAD — SHED ACTIVE, MODE CHANGE DENIED' };
    if (newMode === 'CAS' && !loop.master) return { ok: false, reason: 'NO CASCADE CONNECTION CONFIGURED' };
    if (loop.mode === newMode) return { ok: true, reason: '' };
    var old = loop.mode;
    loop.mode = newMode;
    if (newMode === 'CAS') followMaster(loop, ctx);
    if (newMode !== 'MAN') trackIntegrator(loop);
    return { ok: true, reason: '', from: old };
  }

  function canOperatorWrite(loop, param) {
    if (!loop || loop.modeAttr !== 'PROGRAM') return true;
    return !OPERATOR_OWNED[String(param).toUpperCase()];
  }

  function writeDenial(loop, param) {
    if (canOperatorWrite(loop, param)) return '';
    return 'MODE ATTRIBUTE PROGRAM — ' + String(param).toUpperCase() + ' OWNED BY SEQUENCE';
  }

  function isaForm(K, T1, T2) {
    var Ti = T1 > 0 ? T1 : Infinity;
    var Td = T2 > 0 ? T2 : 0;
    return {
      Kc: K, Ti: Ti, Td: Td,
      TiSec: Ti === Infinity ? Infinity : Ti * 60, TdSec: Td * 60,
      Kp: K, Ki: Ti === Infinity ? 0 : K / (Ti * 60), Kd: K * Td * 60
    };
  }

  return { stepPid: stepPid, transferMode: transferMode, canOperatorWrite: canOperatorWrite, writeDenial: writeDenial, isaForm: isaForm, loopError: loopError, pvOf: pvOf, setTracking: setTracking, clearTracking: clearTracking, tracking: tracking, shutoff: shutoff };
});
