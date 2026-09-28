#!/usr/bin/env python3
# @artifact dev
"""Reproduce the separately versioned offline geometry experiment; no live writes."""
import argparse
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

import numpy as np
import scipy

from model import (INVENTORIES, TRANSFERS, closure, findings, geometry, load_recipe,
                   simulate, transfer_slice, validate_input)
from observation import analyzer, quality

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
GROUNDWORK = "0b62c3407436873818f29fed964bb58fc7322a89"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inputs(**changes):
    values = dict(feed_kg_s=40 * 800 / 3600, temperature_k=650.0, activity=1.0,
                  water_valve=0.45, product_valve=0.5,
                  weir_height_percent=55.0, divert_fraction=0.0)
    return values | changes


def segment(duration, **changes):
    return {"duration_s": duration, "input": inputs(**changes)}


def prescribed_cases():
    """Declared interventions; numerical/specification margins remain in the recipe."""
    return {
        "heat-loss-and-recovery": [segment(600), segment(1200, temperature_k=450), segment(3600)],
        "reduced-feed": [segment(600), segment(1200, feed_kg_s=20 * 800 / 3600)],
        "zero-feed": [segment(900, feed_kg_s=0)],
        "blocked-product-outlet": [segment(600), segment(1200, product_valve=0), segment(600)],
        "crest-carry-and-starvation": [segment(600, weir_height_percent=30, water_valve=0),
                                       segment(600, weir_height_percent=90, water_valve=1),
                                       segment(600, feed_kg_s=0, water_valve=1, product_valve=1)],
        "diversion": [segment(600), segment(600, divert_fraction=1), segment(600)],
        "activity-loss": [segment(600), segment(1200, activity=0.35), segment(600)],
    }


@lru_cache(maxsize=1)
def verified_native_source():
    # Reuse the immutable validator: compare actual source bytes, not just a
    # revision string supplied in a trace. No network or simulator advance.
    source = json.loads(subprocess.check_output(
        ["node", "-e", "process.stdout.write(JSON.stringify(require('./tools/g2/capture-native.cjs').provenance()))"], cwd=ROOT))
    return {key: source[key] for key in ("revision", "model_id", "model_stamp_sha256", "harness_sha256")} | {
        "provenance_dependency_sha256": source["capture_script_sha256"],
        "capture_script_sha256": digest((HERE / "capture-native.cjs").read_bytes())}


def native_segments(recipe, trace, phase):
    if trace.get("schema") != "g2-geometry-native-v1" or phase not in ("pre", "post_u3"):
        raise ValueError("unsupported native schema or scan phase")
    if trace.get("scenario") not in ("heater-loss", "activity-step") or trace.get("source", {}).get("step_s") != 0.5:
        raise ValueError("native scenario and 0.5 s source step are required")
    if any(trace["source"].get(key) != value for key, value in verified_native_source().items()):
        raise ValueError("native source identity does not match verified runtime and adapter bytes")
    events = ([dict(time_s=600, action="setMode", tag="TIC311", mode="MAN"),
               dict(time_s=600, action="storeEntry", tag="TIC311", parameter="OP", value=0, unit="%"),
               dict(time_s=1800, action="setMode", tag="TIC311", mode="AUTO", retained_sp_c=320)]
              if trace["scenario"] == "heater-loss" else
              [dict(time_s=600, action="setMagnitude", key="bedact", value=1.35),
               dict(time_s=600, action="setUpset", key="bedact", on=True),
               dict(time_s=1800, action="setUpset", key="bedact", on=False)])
    if trace.get("events") != events:
        raise ValueError("native commands do not match the declared scenario")
    rows = trace.get("intervals")
    if not isinstance(rows, list) or len(rows) != 6000:
        raise ValueError("native capture must contain all 6000 intervals")
    result = []
    for i, row in enumerate(rows):
        if (isinstance(row.get("start_s"), bool) or isinstance(row.get("end_s"), bool) or
                row.get("start_s") != i * 0.5 or row.get("end_s") != (i + 1) * 0.5):
            raise ValueError("native trace needs contiguous exact 0.5 s intervals starting at zero")
        keys = {"flow_m3h", "bed_temperature_c", "effective_activity", "water_valve_position",
                "product_valve_position", "weir_height_percent"}
        for label in ("pre", "post_u3"):
            frame = row.get(label)
            if not isinstance(frame, dict) or set(frame) != keys or any(
                    isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value)
                    for value in frame.values()):
                raise ValueError("native frame must contain exactly six finite numeric fields")
        frame = row[phase]
        values = dict(feed_kg_s=frame["flow_m3h"] * recipe["feed_density_kg_m3"] / 3600,
                      temperature_k=frame["bed_temperature_c"] + 273.15,
                      activity=frame["effective_activity"],
                      water_valve=frame["water_valve_position"],
                      product_valve=frame["product_valve_position"],
                      weir_height_percent=frame["weir_height_percent"], divert_fraction=0.0)
        try:
            validate_input(recipe, values)
        except ValueError as exc:
            raise ValueError(f"{phase} interval {row['start_s']} s: {exc}") from exc
        result.append({"duration_s": 0.5, "input": values})
    return result


def comparison(recipe, candidate, reference):
    if not np.array_equal(candidate["times"], reference["times"]):
        raise ValueError("comparison requires identical observation times")
    a, b = candidate["states"], reference["states"]
    if a.shape != b.shape or a.ndim != 2 or a.shape != (len(candidate["times"]), 96) or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError("comparison requires matching finite 96-field state arrays")
    error = np.abs(a - b)
    cfg = recipe["numerics"]
    limit = cfg["comparison_abs_kg"] + cfg["comparison_rel"] * np.maximum(np.abs(a), np.abs(b))
    return dict(maximum_abs_inventory_error_kg=float(np.max(error[:, :24])),
                maximum_abs_all_state_error_kg=float(np.max(error)),
                maximum_tolerance_fraction=float(np.max(error / limit)),
                passed=bool(np.all(error <= limit)))


def first_sustained(times, flags, start, duration):
    began = None
    for time, flag in zip(times, flags):
        if time < start:
            continue
        if not flag:
            began = None
        elif began is None:
            began = float(time)
        if began is not None and time - began >= duration:
            return began
    return None


def converted_fraction(row):
    total = float(row[:4].sum())
    return None if total <= 0 else float(1 - row[0] / total)


def summarize(recipe, result):
    times, states = result["times"], result["states"]
    truth = [quality(recipe, row[16:20]) for row in states]
    measured = analyzer(recipe, times, states)
    hold = recipe["acceptance"]["breach_hold_s"]
    observed_off = [q["valid"] and (q["a_mass_fraction"] > recipe["quality"]["max_a_mass_fraction"] or
                    q["w_mass_fraction"] > recipe["quality"]["max_w_mass_fraction"]) for q in measured]
    meter = dict(qualified_kg=0.0, off_band_kg=0.0, unknown_kg=0.0)
    coverage = dict(valid_kg=0.0, unknown_kg=0.0)
    # This dispatch crosses the external boundary. LV503 is internal and excluded.
    component_amounts = np.diff(states[:, transfer_slice("product_dispatch")], axis=0)
    if np.any(component_amounts < -recipe["numerics"]["negative_mass_tolerance_kg"]):
        raise ValueError("cumulative external product dispatch must be nondecreasing")
    amounts = component_amounts.sum(axis=1)
    for i, amount in enumerate(amounts):
        key = "unknown_kg" if not truth[i]["valid"] else "qualified_kg" if truth[i]["qualified"] else "off_band_kg"
        meter[key] += float(amount)
        coverage["valid_kg" if measured[i]["valid"] else "unknown_kg"] += float(amount)
    meter["gross_kg"] = float(amounts.sum())
    meter["sum_residual_kg"] = meter["gross_kg"] - sum(meter[k] for k in ("qualified_kg", "off_band_kg", "unknown_kg"))
    meter["classification_step_s"] = float(np.max(np.diff(times)))
    meter["classification_rule"] = "integrated external product dispatch, classified by left-end receiving-tank truth; analyzer coverage reported separately"
    transfers = {t["name"]: (states[-1, transfer_slice(t["name"])] - states[0, transfer_slice(t["name"])]).tolist() for t in TRANSFERS}
    checkpoints = []
    for requested in sorted(set(t for t in (0, 600, 900, 1800, 2100, float(times[-1])) if t <= times[-1])):
        i = int(np.searchsorted(times, requested))
        checkpoints.append(dict(time_s=float(times[i]), reactor_converted_mass_fraction=converted_fraction(states[i]),
                                geometry=geometry(recipe, states[i]), product_truth=truth[i], analyzer=measured[i]))
    baseline = [q for t, q in zip(times, truth) if 600 - recipe["acceptance"]["baseline_hold_s"] <= t <= 600]
    breach = first_sustained(times, [q["qualified"] is False for q in truth], 0, hold)
    recovered = (None if breach is None else first_sustained(
        times, [q["qualified"] is True for q in truth], max(1800, breach + hold), hold))
    return dict(closure=closure(recipe, states), findings=findings(recipe, states),
                initial_geometry=geometry(recipe, states[0]), final_geometry=geometry(recipe, states[-1]),
                initial_quality=truth[0], final_quality=truth[-1],
                minimum_inventory_component_kg=float(np.min(states[:, :24])),
                baseline_qualified=bool(baseline and all(q["qualified"] is True for q in baseline)),
                truth_offspec_first_sustained_s=breach,
                analyzer_offspec_first_sustained_s=first_sustained(times, observed_off, 0, hold),
                truth_requalified_first_sustained_s=recovered,
                requalification_search="only after a sustained breach, and no earlier than the declared 1800 s heat/activity restoration time",
                dispatch=meter, analyzer_dispatch_coverage=coverage,
                integrated_transfers_component_kg=transfers, checkpoints=checkpoints)


def consequence_checks(recipe, name, result, summary):
    times, states = result["times"], result["states"]
    at = lambda t: states[int(np.searchsorted(times, t))]
    transfers = summary["integrated_transfers_component_kg"]
    amount = lambda name: sum(transfers[name])
    checks = {}
    if name == "heat-loss-and-recovery" or name.startswith("native-heater-loss"):
        breach = summary["truth_offspec_first_sustained_s"]
        observed = summary["analyzer_offspec_first_sustained_s"]
        drop = converted_fraction(at(600)) - converted_fraction(at(1800))
        summary["heat_loss_conversion_drop"] = drop
        checks = dict(baseline_qualified=summary["baseline_qualified"],
                      conversion_drop=drop >= recipe["acceptance"]["minimum_heat_loss_conversion_drop"],
                      receiving_inventory_offspec=breach is not None,
                      analyzer_later=breach is not None and observed is not None and observed > breach,
                      contamination_at_heat_restore=quality(recipe, at(1800)[16:20])["qualified"] is False,
                      off_band_dispatch_retained=summary["dispatch"]["off_band_kg"] > 0)
    elif name == "reduced-feed":
        gain = converted_fraction(at(1800)) - converted_fraction(at(600))
        summary["reduced_feed_conversion_gain"] = gain
        checks["conversion_gain"] = gain >= recipe["acceptance"]["minimum_flow_conversion_gain"]
    elif name == "zero-feed":
        checks = dict(no_feed=amount("feed") == 0,
                      isolated_reactor_discharge=all(amount(n) == 0 for n in ("reactor_water", "reactor_oil", "reactor_gas")),
                      downstream_inventory_drains=amount("product_dispatch") > 0)
    elif name == "blocked-product-outlet":
        closed = at(1800)[transfer_slice("product_transfer")] - at(600)[transfer_slice("product_transfer")]
        checks = dict(closed_draw_stops=bool(np.all(closed == 0)), declared_overflow=amount("chamber2_overflow") > 0)
    elif name == "crest-carry-and-starvation":
        checks = dict(water_carries=amount("water_carry") > 0, oil_underflows=amount("oil_underflow") > 0,
                      oil_crosses_weir=amount("oil_weir") > 0)
    elif name == "diversion":
        checks = dict(offspec_tank_receives=amount("diversion") > 0,
                      offspec_dispatch=amount("offspec_dispatch") > 0,
                      internal_product_draw_stops_during_diversion=bool(np.all(at(1200)[transfer_slice("product_transfer")] == at(600)[transfer_slice("product_transfer")])) )
    elif name == "activity-loss":
        checks["conversion_falls"] = converted_fraction(at(1800)) < converted_fraction(at(600))
    elif name.startswith("native-activity-step"):
        checks["conversion_rises_with_native_activity_multiplier"] = converted_fraction(at(1800)) > converted_fraction(at(600))
    return checks


def evaluate(recipe, name, segments):
    cfg = recipe["numerics"]
    candidate = simulate(recipe, segments, step_s=cfg["candidate_step_s"])
    reference = simulate(recipe, segments, method="DOP853", step_s=cfg["candidate_step_s"])
    refined = simulate(recipe, segments, method="DOP853", step_s=cfg["candidate_step_s"],
                       rtol=cfg["reference_rtol"] / 100, atol=cfg["reference_atol_kg"] / 100)
    half = simulate(recipe, segments, step_s=cfg["refined_step_s"])
    indexes = np.searchsorted(half["times"], candidate["times"])
    sampled_half = dict(times=half["times"][indexes], states=half["states"][indexes])
    summary = summarize(recipe, candidate)
    numerical = dict(rk4_vs_reference=comparison(recipe, candidate, reference),
                     reference_refinement=comparison(recipe, reference, refined),
                     rk4_vs_refined_reference=comparison(recipe, candidate, refined),
                     half_step_vs_refined_reference=comparison(recipe, sampled_half, refined))
    summary["numerics"] = numerical
    summary["closure_by_method"] = {key: closure(recipe, value["states"]) for key, value in
                                    (("candidate", candidate), ("reference", reference), ("refined_reference", refined), ("half_step", half))}
    summary["consequence_checks"] = consequence_checks(recipe, name, candidate, summary)
    summary["passed"] = bool(all(c["passed"] for c in numerical.values()) and
                             all(c["passed"] for c in summary["closure_by_method"].values()) and
                             all(summary["consequence_checks"].values()) and
                             not any(f.get("severity") == "error" for f in summary["findings"]))
    return summary, candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    recipe = load_recipe()
    files = ("model.py", "observation.py", "recipe.json", "requirements.txt", "run.py", "capture-native.cjs")
    receipt = dict(_artifact="@artifact dev", schema="g2-geometry-receipt-v1", groundwork_revision=GROUNDWORK,
                   scope="offline synthetic geometry reference only; no live component, energy, pressure, checkpoint, PLANT_MAP or MOA change",
                   versions=dict(python=platform.python_version(), numpy=np.__version__, scipy=scipy.__version__),
                   files_sha256={name: digest((HERE / name).read_bytes()) for name in files},
                   preserved_stage_one_receipt_sha256=digest((ROOT / "tools/g2/receipts/stage-one.json").read_bytes()),
                   numerics=recipe["numerics"],
                   reference_refinement=dict(rtol=recipe["numerics"]["reference_rtol"] / 100,
                                             atol_kg=recipe["numerics"]["reference_atol_kg"] / 100),
                   classification="truth and analyzer coverage are separate; more qualified output is not an acceptance target",
                   prescribed_segments=prescribed_cases(), native_captures={}, cases={}, rejected_cases={}, phase_comparisons={},
                   reproduce="python -B tools/g2-geometry/run.py --out tools/g2-geometry/receipts/geometry-v1.json (pinned offline environment)")
    cases = dict(receipt["prescribed_segments"])
    for scenario in ("heater-loss", "activity-step"):
        data = subprocess.check_output(["node", str(HERE / "capture-native.cjs"), "--scenario", scenario], cwd=ROOT)
        trace = json.loads(data)
        receipt["native_captures"][scenario] = dict(sha256=digest(data), source=trace["source"], events=trace["events"],
                                                   provenance="fresh capture with runtime/harness bytes independently verified")
        for phase in ("pre", "post_u3"):
            name = f"native-{scenario}-{phase}"
            try:
                cases[name] = native_segments(recipe, trace, phase)
            except ValueError as exc:
                if "MODEL_OUT_OF_ENVELOPE" not in str(exc):
                    raise
                receipt["rejected_cases"][name] = dict(
                    status="not_assessed", reason=str(exc),
                    interpretation="capture is evidence of native inputs outside the committed recipe; no geometry trajectory or composition consequence is claimed",
                    temperature_range_k=[min(row[phase]["bed_temperature_c"] + 273.15 for row in trace["intervals"]),
                                         max(row[phase]["bed_temperature_c"] + 273.15 for row in trace["intervals"])])
    native_results = {}
    for name, segments in cases.items():
        print(f"Evaluating {name}", file=sys.stderr, flush=True)
        summary, result = evaluate(recipe, name, segments)
        receipt["cases"][name] = summary
        if name.startswith("native-"):
            native_results[name] = result
        print(f"{name}: passed={summary['passed']}", file=sys.stderr, flush=True)
    for scenario in ("heater-loss", "activity-step"):
        if f"native-{scenario}-pre" not in native_results or f"native-{scenario}-post_u3" not in native_results:
            continue
        before = native_results[f"native-{scenario}-pre"]
        after = native_results[f"native-{scenario}-post_u3"]
        delta = np.abs(before["states"] - after["states"])
        receipt["phase_comparisons"][scenario] = dict(
            meaning="different one-way input timings, not a numerical pass/fail or a new live interface",
            maximum_inventory_difference_kg=float(np.max(delta[:, :24])),
            final_inventory_difference_kg=float(np.max(delta[-1, :24])),
            proposed_future_phase="post_u3, immediately before U4, subject to live-interface review")
    receipt["acceptance_scope"] = "passed covers assessed cases only; rejected captures remain explicitly not assessed"
    receipt["passed"] = (all(case["passed"] for case in receipt["cases"].values()) and
                         all(f"native-heater-loss-{phase}" in receipt["cases"] for phase in ("pre", "post_u3")))
    output = json.dumps(receipt, indent=2, allow_nan=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
        print(json.dumps(dict(passed=receipt["passed"], receipt=str(args.out))))
    else:
        print(output, end="")
    if not receipt["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
