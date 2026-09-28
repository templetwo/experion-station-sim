// @artifact production
/*
 * ESS.Plausibility: read-only, instructor-facing checks on the legacy model.
 * No finding changes P, L, V, alarms, trips, random streams, or control decisions.
 * snapshot(P,V) brackets one existing scan; advance mutates ONLY its observer.
 * Persist the observer with a checkpoint to resume its cumulative audit/ledger.
 *
 * NIST water saturation rows: RESOURCES-7.26 (HELD). Linear interpolation and
 * the assumed 0.101325 MPa absolute pressure are declared Temple choices; this
 * is not a pressure state or a boiling model. Outside the table, no answer.
 *
 * All other checks compare this repository's declared model with its output.
 * U4 accounting reproduces its liquid-volume update terms, not total mass,
 * gas, composition, product-tank inventory, or a thermodynamic balance.
 * The 1e-9 m3 closure allowance is Temple-set numerical tolerance, not a source
 * value. An absent flow sample means incomplete coverage, never proven closure.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./models'));
  else (root.ESS = root.ESS || {}).Plausibility = factory(root.ESS.Models);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Models) {
  'use strict';

  const SATURATION = Object.freeze([
    [.1, 372.7559], [.101325, 373.1243], [.2, 393.3601], [.3, 406.6724],
    [.4, 416.7584], [.5, 424.9811], [.6, 431.9765], [.7, 438.0962],
    [.8, 443.5565], [.9, 448.5005], [1, 453.0280]
  ].map(row => Object.freeze(row)));
  const SHUTDOWNS = ['ovf', 'rx', 'batch', 'bed', 'skin'];
  const LEVELS = [
    ['P.tankL', 'tankL'], ['P.drumL', 'drumL'],
    ['P.s.hw', 'hw'], ['P.s.ho', 'ho'], ['P.s.h2', 'h2']
  ];
  const RATES = ['feed_rate_m3h', 'water_draw_rate_m3h', 'oil_underflow_rate_m3h', 'product_draw_rate_m3h'];
  const ENVELOPE_FIELDS = Object.freeze(['P.Tj', 'P.Tcw', 'P.tankL', 'P.drumL',
    'P.h.f', 'P.h.pre', 'P.h.bed', 'P.s.Tin', 'P.s.pres', 'P.s.hw', 'P.s.ho', 'P.s.h2',
    'P.env.catAct', 'P.env.weirH']);
  const finite = Number.isFinite;
  const numberOrNull = value => finite(value) ? value : null;
  const copy = value => JSON.parse(JSON.stringify(value));

  function saturationTemperature(pressure) {
    if (!finite(pressure) || pressure < SATURATION[0][0] || pressure > SATURATION[SATURATION.length - 1][0]) return null;
    for (let i = 0; i < SATURATION.length; i++) {
      const row = SATURATION[i];
      if (pressure === row[0]) return row[1] - 273.15;
      if (pressure < row[0]) {
        const previous = SATURATION[i - 1];
        return previous[1] + (row[1] - previous[1]) * (pressure - previous[0]) / (row[0] - previous[0]) - 273.15;
      }
    }
    return null;
  }

  function snapshot(P, V) {
    const s = P.s || {}, trips = P.trips || {};
    const result = { t: numberOrNull(P.t), Tj: numberOrNull(P.Tj), tankL: numberOrNull(P.tankL),
      drumL: numberOrNull(P.drumL), h: { f: numberOrNull(P.h && P.h.f) }, s: {}, trips: {},
      envelope_values: {}, weir_height_percent: P.env && finite(P.env.weirH) ? P.env.weirH : 55,
      // Same absent-valve fallback as models.js vpos, used by legacy module tests.
      water_valve_position: V && V.WV504 && finite(V.WV504.pos) ? V.WV504.pos : .45 };
    for (const k of ['hw', 'ho', 'h2', 'wcarry', 'ocarry', 'qover']) result.s[k] = numberOrNull(s[k]);
    for (const k of SHUTDOWNS) result.trips[k] = !!trips[k];
    for (const field of ENVELOPE_FIELDS) {
      const value = field.slice(2).split('.').reduce((state, key) => state == null ? undefined : state[key], P);
      result.envelope_values[field] = numberOrNull(value);
    }
    return result;
  }

  function liquidInventory(P) {
    const s = P.s || {}, c = Models.PARAMS.U4;
    return [s.hw, s.ho, s.h2].every(finite) ? c.A1 * (s.hw + s.ho) + c.A2 * s.h2 : null;
  }

  function option(options, key, fallback, allowNull) {
    const value = options[key] === undefined ? fallback : options[key];
    if (allowNull && value === null) return null;
    if (!finite(value) || value < 0) throw Error('invalid_plausibility_option:' + key);
    return value;
  }

  function create(P, options) {
    const o = options || {}, inventory = liquidInventory(P);
    const configuration = {
      coolant_pressure_mpa_abs: option(o, 'coolant_pressure_mpa_abs', .101325, false),
      feed_inventory_m3: option(o, 'feed_inventory_m3', null, true),
      u4_closure_tolerance_m3: option(o, 'u4_closure_tolerance_m3', 1e-9, true),
      model_envelopes: modelEnvelopes(o.model_envelopes)
    };
    return { version: 1, options: configuration, start_sim_time_ms: numberOrNull(P.t), end_sim_time_ms: numberOrNull(P.t),
      feed_volume_m3: 0, active: [], findings: [],
      u4_liquid: { scope: 'U4 liquid volume only', status: 'unobserved',
        tolerance_m3: configuration.u4_closure_tolerance_m3, elapsed_ms: 0, covered_ms: 0,
        inventory_start_m3: inventory, inventory_current_m3: inventory,
        inlet_m3: 0, water_draw_m3: 0, oil_underflow_m3: 0, product_draw_m3: 0,
        unobserved_inventory_changes: 0, unobserved_inventory_delta_m3: 0,
        covered_inventory_delta_m3: 0, covered_residual_m3: 0, residual_m3: null,
        max_abs_interval_residual_m3: 0 }
    };
  }

  // These are declared mission envelopes, never inferred calibration ranges.
  // Only snapshot fields are accepted, and one declaration per field prevents
  // coalescing different correlation limits into the same finding history.
  function modelEnvelopes(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > ENVELOPE_FIELDS.length) throw Error('invalid_plausibility_option:model_envelopes');
    const fields = new Set();
    return Array.from(value, item => {
      if (!item || !ENVELOPE_FIELDS.includes(item.field) || fields.has(item.field) ||
          !finite(item.min) || !finite(item.max) || item.min > item.max ||
          typeof item.correlation !== 'string' || !item.correlation.trim() || item.correlation.length > 120) {
        throw Error('invalid_plausibility_option:model_envelopes');
      }
      fields.add(item.field);
      return { field: item.field, min: item.min, max: item.max, correlation: item.correlation.trim(),
        basis: 'Temple-set mission envelope; not a measured calibration range' };
    });
  }

  function checkEnvelopes(observer, before, after, dt) {
    for (const envelope of observer.options.model_envelopes || []) {
      const value = after.envelope_values && after.envelope_values[envelope.field];
      if (!finite(value) || value < envelope.min || value > envelope.max) {
        record(observer, { code: 'MODEL_OUT_OF_ENVELOPE', field: envelope.field,
          correlation: envelope.correlation, value: numberOrNull(value), min: envelope.min, max: envelope.max,
          basis: envelope.basis,
          detail: finite(value) ? 'Model input or output is outside its declared mission envelope; the value is not constrained.' :
            'The declared mission envelope cannot be evaluated because its model value is unavailable.' });
      }
    }
    // The existing U4 explicit weir update removes Cweir*head^1.5*dt/3600
    // m3 from an excess head holding A1*head m3. This necessary per-term
    // nonnegative-volume condition is algebra from the implemented Francis
    // equation (RESOURCES-4.12), not a calibrated operating envelope or proof
    // that the complete integration step is stable. Use PRE-update levels.
    const head = before.s.hw + before.s.ho - before.weir_height_percent;
    if (finite(before.s.hw) && finite(before.s.ho) && finite(head) && head > 0) {
      const maxDt = Models.PARAMS.U4.A1 * 3600 / (Models.PARAMS.U4.Cweir * Math.sqrt(head));
      if (dt > maxDt) record(observer, { code: 'MODEL_OUT_OF_ENVELOPE', field: 'U4.weir.dt_s',
        correlation: 'Explicit Francis weir update', value: dt, min: 0, max: maxDt,
        head_percent: head, basis: 'Existing weir equation nonnegative excess-volume condition',
        detail: 'The weir term alone can drain more than the available excess head in one step; dynamics remain unchanged.' });
    }
  }

  // P.h.f is updated by U3 before U4 reads it; valve positions are moved by U1
  // before either. s.ocarry is the actual oil-underflow term U4 used this tick.
  // The existing productSample hook supplies qp BEFORE chamber 2 changes.
  // Only the water draw lacks an observation seam: mirror its single expression
  // from models.js separator(), using PRE-update hw and the valve used this scan.
  // Tests compare this reconstruction with actual inventory updates and clamps.
  function u4FlowSample(before, after, productSample) {
    if (!productSample || !finite(productSample.draw_rate_m3h) || !finite(productSample.dt_s) ||
        !finite(before.s.hw) || !finite(after.h.f) || !finite(after.s.ocarry) || !finite(after.water_valve_position)) return null;
    return { basis: 'legacy-liquid-volume-v1', dt_s: productSample.dt_s,
      feed_rate_m3h: Math.max(0, after.h.f),
      water_draw_rate_m3h: Models.PARAMS.U4.Cw * after.water_valve_position * Math.sqrt(Math.max(before.s.hw, 0) / 50),
      oil_underflow_rate_m3h: after.s.ocarry,
      product_draw_rate_m3h: productSample.draw_rate_m3h };
  }

  function record(observer, finding) {
    finding.sim_time_ms = observer.end_sim_time_ms;
    observer.active.push(finding);
    const previous = observer.findings.find(f => f.code === finding.code && f.field === finding.field);
    if (previous) {
      const first = previous.first_sim_time_ms, count = previous.occurrences;
      Object.assign(previous, finding, { first_sim_time_ms: first, last_sim_time_ms: finding.sim_time_ms, occurrences: count + 1 });
    } else {
      observer.findings.push(Object.assign({}, finding, { first_sim_time_ms: finding.sim_time_ms, last_sim_time_ms: finding.sim_time_ms, occurrences: 1 }));
    }
  }

  function checkLiquid(observer, before, after, dt, sample) {
    const ledger = observer.u4_liquid, initial = liquidInventory(before), current = liquidInventory(after);
    ledger.elapsed_ms += dt * 1000;
    if (finite(initial) && finite(ledger.inventory_current_m3) && initial !== ledger.inventory_current_m3) {
      const jump = initial - ledger.inventory_current_m3;
      ledger.unobserved_inventory_changes++;
      ledger.unobserved_inventory_delta_m3 += jump;
      record(observer, { code: 'U4_INVENTORY_DISCONTINUITY', field: 'P.s', inventory_change_m3: jump,
        detail: 'U4 liquid inventory changed between observed scans. The ledger cannot certify closure across this unobserved change.' });
    }
    ledger.inventory_current_m3 = current;
    const complete = sample && sample.dt_s === dt && finite(initial) && finite(current) &&
      RATES.every(key => finite(sample[key]) && sample[key] >= 0);
    if (complete) {
      const hours = dt / 3600;
      const incoming = sample.feed_rate_m3h * hours;
      const water = sample.water_draw_rate_m3h * hours, oil = sample.oil_underflow_rate_m3h * hours;
      const product = sample.product_draw_rate_m3h * hours, delta = current - initial;
      const residual = incoming - water - oil - product - delta;
      ledger.covered_ms += dt * 1000;
      ledger.inlet_m3 += incoming; ledger.water_draw_m3 += water;
      ledger.oil_underflow_m3 += oil; ledger.product_draw_m3 += product;
      ledger.covered_inventory_delta_m3 += delta;
      ledger.covered_residual_m3 += residual;
      ledger.max_abs_interval_residual_m3 = Math.max(ledger.max_abs_interval_residual_m3, Math.abs(residual));
      if (ledger.tolerance_m3 !== null && (Math.abs(residual) > ledger.tolerance_m3 || Math.abs(ledger.covered_residual_m3) > ledger.tolerance_m3)) {
        record(observer, { code: 'U4_LIQUID_CLOSURE_EXCEEDED', field: 'P.s',
          interval_residual_m3: residual, covered_residual_m3: ledger.covered_residual_m3, tolerance_m3: ledger.tolerance_m3,
          detail: 'U4 liquid inflow minus declared liquid outflows and accumulation exceeds the declared volume tolerance; gas and composition are outside this ledger.' });
      }
    }
    const fullCoverage = ledger.covered_ms === ledger.elapsed_ms && ledger.unobserved_inventory_changes === 0;
    ledger.residual_m3 = fullCoverage ? ledger.covered_residual_m3 : null;
    ledger.status = !fullCoverage ? 'incomplete' : ledger.tolerance_m3 === null ? 'tolerance_undeclared' :
      Math.abs(ledger.covered_residual_m3) > ledger.tolerance_m3 || ledger.max_abs_interval_residual_m3 > ledger.tolerance_m3 ? 'outside_tolerance' : 'within_tolerance';
  }

  function advance(observer, before, after, dt, flowSample, context) {
    if (!finite(dt) || dt <= 0) throw Error('invalid_plausibility_dt');
    observer.end_sim_time_ms = after.t;
    observer.active = [];
    const pressure = observer.options.coolant_pressure_mpa_abs, saturation = saturationTemperature(pressure);
    if (saturation === null) {
      record(observer, { code: 'SATURATION_LOOKUP_OUT_OF_ENVELOPE', field: 'P.Tj', assumed_pressure_mpa_abs: pressure,
        detail: 'The declared coolant pressure is outside the held NIST table; saturation is not extrapolated.' });
      record(observer, { code: 'MODEL_OUT_OF_ENVELOPE', field: 'coolant_pressure_mpa_abs',
        correlation: 'NIST water saturation lookup', value: pressure, min: SATURATION[0][0], max: SATURATION[SATURATION.length - 1][0],
        basis: 'RESOURCES-7.26 held table pressure interval',
        detail: 'The saturation lookup is outside its declared pressure envelope; no extrapolated temperature is published.' });
    } else if (finite(after.Tj) && after.Tj > saturation) {
      record(observer, { code: 'COOLANT_ABOVE_SATURATION', field: 'P.Tj', temperature_c: after.Tj,
        saturation_temperature_c: saturation, assumed_pressure_mpa_abs: pressure,
        detail: 'Jacket temperature exceeds water saturation at the declared assumed absolute pressure; the legacy model has no boiling or pressure state.' });
    }
    checkEnvelopes(observer, before, after, dt);
    for (const [field, key] of LEVELS) {
      if(context&&context.materialMode==='composition_mass_v1'&&field.startsWith('P.s.'))continue; // component geometry has explicit overflow, not these legacy clamps
      const value = field.startsWith('P.s.') ? after.s[key] : after[key];
      if (finite(value) && (value <= 0 || value >= 100)) {
        record(observer, { code: 'LEVEL_AT_BOUND', field, value_percent: value, bound_percent: value <= 0 ? 0 : 100,
          missing_volume_m3: null,
          detail: 'A legacy level bound was reached. A bound alone cannot quantify discarded volume; U4 has a separate liquid ledger.' });
      }
    }
    for (const key of SHUTDOWNS) {
      if (before.trips[key] && !after.trips[key]) {
        record(observer, { code: 'TRIP_AUTO_CLEARED', field: 'P.trips.' + key,
          detail: 'An existing shutdown latch cleared during the process scan without an operator reset. This audit does not change its reset behavior.' });
      }
    }
    if (finite(after.h.f)) observer.feed_volume_m3 += Math.max(0, after.h.f) * dt / 3600;
    const budget = observer.options.feed_inventory_m3;
    if (budget !== null && observer.feed_volume_m3 > budget) {
      record(observer, { code: 'FEED_INVENTORY_UNACCOUNTED', field: 'P.h.f', feed_volume_m3: observer.feed_volume_m3,
        declared_feed_inventory_m3: budget, excess_volume_m3: observer.feed_volume_m3 - budget,
        detail: 'Cumulative U3 feed exceeds the declared mission feed budget. The current model has no finite U3 feed tank.' });
    }
    checkLiquid(observer, before, after, dt, flowSample);
    return observer;
  }

  function project(observer) { return observer ? copy(observer) : null; }
  return { create, snapshot, advance, u4FlowSample, project, saturationTemperature };
});
