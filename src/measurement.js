// @artifact production
// Transmitter reporting for every analog point. From 3.2.0 the observed value feeds the
// controllers and the alarm scan (plant-core measure() writes it to l.pvObs every tick): a
// controller cannot see what the transmitter cannot send. Anthony's decision,
// docs/dev/CREDIBILITY-PASS-SPEC.md §2.4. observe() itself stays pure and never mutates the point.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESS.Measurement = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Temple-set synthetic transmitter, not an assertion of NE 43 conformance.
  // I = 4 + 16 * T / 100 mA; the declared reporting interval is 3.8..20.5 mA.
  // Exact engineering endpoints avoid floating point subtraction at 3.8 mA.
  const TIC202 = Object.freeze({
    lower: 0, upper: 100, reportingLower: -1.25, reportingUpper: 103.125,
    nominalLowMa: 4, nominalHighMa: 20, reportingLowMa: 3.8, reportingHighMa: 20.5
  });

  // Declared reporting window for every analog point, the 4..20 mA loop convention: live
  // measurement between 3.8 mA and 20.5 mA, i.e. lo - 1.25 % to hi + 3.125 % of span. This
  // generalises the Temple-set reporting interval through the NE 43 convention registered at
  // RESOURCES-7.35 (CITED-NOT-HELD); it is not a claim of conformance (spec §2.2). Flows read 0
  // below 1 % of span.
  const RANGE_POLICY = Object.freeze({
    lowFrac: -0.0125, highFrac: 0.03125, flowCutoffFrac: 0.01,
    nominalLowMa: 4, nominalHighMa: 20, reportingLowMa: 3.8, reportingHighMa: 20.5
  });

  function isAnalog(p) {
    return (p.kind === 'pid' || p.kind === 'ind') && Number.isFinite(p.lo) && Number.isFinite(p.hi) && p.hi > p.lo;
  }
  function isFlow(p) { return String(p.eu || '').toUpperCase() === 'M3/H'; }

  // The window a point reports through, or null when the point declares no usable range.
  // TIC202 keeps answering from its shipped precedent only when a caller declares no range at
  // all (neither lo nor hi); a declared but unusable range is left alone like any other tag's.
  function rangeOf(point) {
    const p = point || {};
    if (isAnalog(p)) {
      const span = p.hi - p.lo;
      return Object.freeze({
        lower: p.lo, upper: p.hi, span,
        reportingLower: p.lo + RANGE_POLICY.lowFrac * span,
        reportingUpper: p.hi + RANGE_POLICY.highFrac * span
      });
    }
    if (p.tag === 'TIC202' && p.lo == null && p.hi == null) {
      return Object.freeze({ lower: TIC202.lower, upper: TIC202.upper, span: TIC202.upper - TIC202.lower,
        reportingLower: TIC202.reportingLower, reportingUpper: TIC202.reportingUpper });
    }
    return null;
  }

  // RESOURCES-7.23: OPC Part 8 data quality meanings and Null for Bad values.
  // RESOURCES-7.24: Part 4 StatusCode bits; LimitBits require InfoType DataValue.
  // RESOURCES-7.25: OPC Foundation StatusCode.csv numeric assignments.
  const STATUS = Object.freeze({
    Good: 0x00000000,
    Uncertain: 0x40000000,
    Bad: 0x80000000,
    Bad_SensorFailure: 0x808C0000,
    Uncertain_NoCommunicationLastUsable: 0x408F0000,
    Uncertain_EngineeringUnitsExceeded: 0x40940000
  });
  const DATA_VALUE = 0x400;
  const LIMIT_MASK = 0x300;
  const LIMITS = ['NONE', 'LOW', 'HIGH', 'CONSTANT'];

  function validStatus(value) {
    return Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
  }

  function family(code) {
    const severity = code >>> 30;
    return severity >= 2 ? 'BAD' : severity === 1 ? 'UNCERTAIN' : 'GOOD';
  }

  function limitOf(code) {
    return (code & 0xC00) === DATA_VALUE ? LIMITS[(code & LIMIT_MASK) >>> 8] : 'NONE';
  }

  function nameOf(code, suppliedName) {
    const base = (code & 0xFFFF0000) >>> 0;
    const known = Object.keys(STATUS).find(name => STATUS[name] === base);
    if (known) return known;
    // Preserve a supplied OPC symbolic name only when its severity agrees.
    if (typeof suppliedName === 'string' && /^(Good|Uncertain|Bad)(_[A-Za-z0-9]+)?$/.test(suppliedName)
        && suppliedName.split('_')[0].toUpperCase() === family(code)) return suppliedName;
    return null; // A numeric source code can be valid without a local name lookup.
  }

  function result(pv, code, suppliedName) {
    const quality = family(code);
    return {
      pv: quality === 'BAD' ? null : pv,
      badPv: quality === 'BAD',
      quality,
      statusCode: code >>> 0,
      statusName: nameOf(code, suppliedName),
      limit: limitOf(code)
    };
  }

  // Reads only the visible point's tag, kind, declared range, unit, PV, quality and optional
  // OPC status.
  // STALE/UNKNOWN map to generic Uncertain: age alone proves neither a sensor
  // failure nor failed communication. Part 8 forbids LastUsableValue for stale.
  // Existing Bad/Uncertain source statuses take precedence over range reporting;
  // an uncertain status keeps its subcode, with the current range limit attached.
  // Range reporting (ruling R8, spec §2.2): inside the nominal range a reading is Good. Beyond it
  // but inside the window the transmitter still reports the value, so it stays Good with the
  // DataValue limit bit (LOW or HIGH). At or beyond a window edge the value is clamped to the edge
  // and reads Uncertain_EngineeringUnitsExceeded with the limit.
  function observe(point) {
    const p = point || {};
    const declared = p.quality == null ? 'GOOD' : String(p.quality).toUpperCase();
    let code = validStatus(p.statusCode) ? p.statusCode : STATUS.Good;

    if (family(code) === 'BAD') return result(null, code, p.statusName);
    if (p.badPv) return result(null, STATUS.Bad_SensorFailure);
    if (declared === 'BAD' || declared === 'ERROR' || !Number.isFinite(p.pv)) {
      return result(null, STATUS.Bad);
    }
    if (declared !== 'GOOD' && family(code) === 'GOOD') code = STATUS.Uncertain;

    let pv = p.pv;
    const r = rangeOf(p);
    if (r && isFlow(p) && Math.abs(pv) < RANGE_POLICY.flowCutoffFrac * r.span) pv = 0;
    if (r && (pv < r.lower || pv > r.upper)) {
      const limit = pv < r.lower ? 0x100 : 0x200;
      const saturated = pv <= r.reportingLower || pv >= r.reportingUpper;
      pv = Math.max(r.reportingLower, Math.min(r.reportingUpper, pv));
      if (saturated && (family(code) === 'GOOD' || code === STATUS.Uncertain)) {
        code = STATUS.Uncertain_EngineeringUnitsExceeded;
      }
      code = ((code & ~LIMIT_MASK) | DATA_VALUE | limit) >>> 0;
    }
    return result(pv, code, p.statusName);
  }

  return { observe, rangeOf, RANGE_POLICY, TIC202, STATUS };
});
