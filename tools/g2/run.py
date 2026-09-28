#!/usr/bin/env python3
# @artifact dev
"""Reproduce the G2 offline milestone and emit a reviewable numerical receipt."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess

import numpy as np
import scipy

from model import analyzer, closure, findings, load_recipe, quality, simulate, validate_input

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prescribed_segments():
    # Synthetic histories, not inferred heater equations. The native case below
    # separately captures the existing heater's actual response to operator input.
    return [{"duration_s": duration, "input": {"feed_kg_s": 1.0, "temperature_k": temperature,
                                             "activity": 1.0, "divert_fraction": 0.0}}
            for duration, temperature in ((600, 650), (1200, 450), (3600, 650))]


def native_segments(recipe, trace):
    if trace.get("schema") != "g2-native-input-v1":
        raise ValueError("unsupported native capture schema")
    samples = trace["samples"]
    if len(samples) < 2 or trace["source"]["step_s"] != 0.5:
        raise ValueError("native trace must contain 0.5 s samples")
    result = []
    for i, row in enumerate(samples):
        if row["time_s"] != i * 0.5:
            raise ValueError("native trace must start at zero without missing/reordered samples")
        values = {"feed_kg_s": row["flow_m3h"] * recipe["feed_density_kg_m3"] / 3600,
                  "temperature_k": row["bed_temperature_c"] + 273.15,
                  "activity": row["activity"], "divert_fraction": 0.0}
        validate_input(recipe, values)
        if i < len(samples) - 1:
            result.append({"duration_s": 0.5, "input": values})
    return result


def comparison(recipe, candidate, reference):
    a, b = candidate["states"], reference["states"]
    if not np.array_equal(candidate["times"], reference["times"]):
        raise ValueError("comparison requires the same observation times")
    error = np.abs(a - b)
    tolerance = recipe["tolerances"]["comparison_abs_kg"] + recipe["tolerances"]["comparison_rel"] * np.maximum(np.abs(a), np.abs(b))
    return {"maximum_abs_inventory_error_kg": float(np.max(error[:, :16])),
            "maximum_abs_all_state_error_kg": float(np.max(error)),
            "maximum_tolerance_fraction": float(np.max(error / tolerance)),
            "passed": bool(np.all(error <= tolerance))}


def first_sustained(times, flags, start, duration=30):
    began = None
    for t, flag in zip(times, flags):
        if t < start:
            continue
        if not flag:
            began = None
        elif began is None:
            began = float(t)
        if began is not None and t - began >= duration:
            return began
    return None


def summarize(recipe, result, cut=600, recovery=1800):
    times, states = result["times"], result["states"]
    truth = [quality(recipe, row[8:12]) for row in states]
    observed = analyzer(recipe, times, states)
    offspec = [q["qualified"] is False for q in truth]
    measured_offspec = [q["valid"] and (q["a_mass_fraction"] > recipe["quality"]["max_a_mass_fraction"] or
                                      q["w_mass_fraction"] > recipe["quality"]["max_w_mass_fraction"]) for q in observed]
    breached = first_sustained(times, offspec, cut)
    recovered = first_sustained(times, [q["qualified"] is True for q in truth], recovery)
    baseline_qualified = all(q["qualified"] is True for t, q in zip(times, truth) if cut - 60 <= t <= cut)
    at_cut, at_recovery = states[int(np.searchsorted(times, cut)), :4], states[int(np.searchsorted(times, recovery)), :4]
    conversion_fell = bool(at_cut.sum() > 0 and at_recovery.sum() > 0 and at_recovery[0] / at_recovery.sum() > at_cut[0] / at_cut.sum())
    meter = {"qualified_kg": 0.0, "off_band_kg": 0.0, "unknown_kg": 0.0}
    # Account numerically integrated dispatch by the left-end truth classification.
    # Only classification time is discretized (0.5 s); material is never lost.
    for i, amount in enumerate(np.diff(states[:, 28:32].sum(axis=1))):
        key = "unknown_kg" if not truth[i]["valid"] else "qualified_kg" if truth[i]["qualified"] else "off_band_kg"
        meter[key] += float(amount)
    meter["gross_kg"] = float(states[-1, 28:32].sum() - states[0, 28:32].sum())
    meter["classification_step_s"] = float(np.max(np.diff(times)))
    meter["classification_rule"] = "interval dispatch assigned by left-end product truth; not analyzer readings"
    meter["sum_residual_kg"] = meter["gross_kg"] - sum(meter[k] for k in ("qualified_kg", "off_band_kg", "unknown_kg"))
    checkpoints = []
    for requested in (0, cut, cut + 300, recovery, recovery + 300, float(times[-1])):
        i = int(np.searchsorted(times, requested))
        if i >= len(times):
            continue
        r = states[i, :4]
        checkpoints.append({"time_s": float(times[i]), "reactor_converted_mass_fraction": None if r.sum() == 0 else float(1 - r[0] / r.sum()),
                            "product_inventory_kg": float(states[i, 8:12].sum()),
                            "product_truth": truth[i], "analyzer": observed[i]})
    return {"closure": closure(recipe, states), "findings": findings(recipe, states),
            "initial_quality": truth[0], "final_quality": truth[-1],
            "qualified_for_60s_before_cut": baseline_qualified,
            "reactor_converted_mass_fraction_fell_during_heat_loss": conversion_fell,
            "truth_offspec_first_sustained_30s_s": breached,
            "analyzer_offspec_first_sustained_30s_s": first_sustained(times, measured_offspec, cut),
            "truth_requalified_first_sustained_30s_s": recovered,
            "offspec_at_recovery": truth[int(np.searchsorted(times, recovery))]["qualified"] is False,
            "dispatch": meter, "checkpoints": checkpoints}


def evaluate(recipe, segments):
    candidate = simulate(recipe, segments)
    reference = simulate(recipe, segments, method="DOP853")
    refined = simulate(recipe, segments, method="DOP853", rtol=1e-12, atol=1e-14)
    half_step = simulate(recipe, segments, step_s=0.25)
    # All supplied scenario events are multiples of 0.5 s.
    coarse_half = {"times": half_step["times"][::2], "states": half_step["states"][::2]}
    half = comparison(recipe, coarse_half, refined)
    full = comparison(recipe, candidate, refined)
    summary = summarize(recipe, candidate)
    summary["numerics"] = {"candidate": "fixed RK4 0.5 s", "reference": "SciPy solve_ivp DOP853, restarted at every input change",
                           "rk4_vs_reference": comparison(recipe, candidate, reference),
                           "reference_tolerance_refinement": comparison(recipe, reference, refined),
                           "rk4_half_step_vs_refined_reference": half,
                           "rk4_vs_refined_reference": full,
                           "half_step_reduces_inventory_error": half["maximum_abs_inventory_error_kg"] < full["maximum_abs_inventory_error_kg"]}
    summary["passed"] = (summary["closure"]["passed"] and not summary["findings"] and
                         summary["qualified_for_60s_before_cut"] and summary["reactor_converted_mass_fraction_fell_during_heat_loss"] and
                         summary["truth_offspec_first_sustained_30s_s"] is not None and
                         summary["analyzer_offspec_first_sustained_30s_s"] is not None and
                         summary["analyzer_offspec_first_sustained_30s_s"] > summary["truth_offspec_first_sustained_30s_s"] and
                         summary["offspec_at_recovery"] and summary["dispatch"]["off_band_kg"] > 0 and
                         all(summary["numerics"][key]["passed"] for key in ("rk4_vs_reference", "reference_tolerance_refinement", "rk4_half_step_vs_refined_reference", "rk4_vs_refined_reference")) and
                         summary["numerics"]["half_step_reduces_inventory_error"])
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="write JSON receipt (stdout if omitted)")
    parser.add_argument("--native-input", type=Path, help="replay an existing capture; otherwise run pinned native capture")
    args = parser.parse_args()
    recipe = load_recipe()
    trace_bytes = args.native_input.read_bytes() if args.native_input else subprocess.check_output(["node", str(HERE / "capture-native.cjs")], cwd=ROOT)
    trace = json.loads(trace_bytes)
    scenarios = prescribed_segments()
    receipt = {"_artifact": "@artifact dev", "schema": "g2-stage-one-receipt-v1",
               "scope": "offline mass-lump surrogate and one-way native replay; no live composition, energy, hydraulics or product qualification change",
               "versions": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__},
               "files_sha256": {name: digest((HERE / name).read_bytes()) for name in ("model.py", "recipe.json", "requirements.txt", "run.py", "capture-native.cjs")},
               "native_input_sha256": digest(trace_bytes), "native_source": trace["source"], "native_events": trace["events"],
               "native_provenance": "supplied file; source metadata is not independently verified" if args.native_input else "fresh capture; runtime code and harness verified against pinned baseline hashes",
               "prescribed_segments": scenarios,
               "reference_tolerances": {"rtol": recipe["tolerances"]["reference_rtol"], "atol_kg": recipe["tolerances"]["reference_atol_kg"], "max_step_s": recipe["tolerances"]["reference_max_step_s"], "refined_rtol": 1e-12, "refined_atol_kg": 1e-14},
               "reproduce": "python tools/g2/run.py --out tools/g2/receipts/stage-one.json (in the pinned offline environment)",
               "prescribed": evaluate(recipe, scenarios), "native_replay": evaluate(recipe, native_segments(recipe, trace))}
    receipt["passed"] = receipt["prescribed"]["passed"] and receipt["native_replay"]["passed"]
    output = json.dumps(receipt, indent=2, allow_nan=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
        print(json.dumps({"passed": receipt["passed"], "receipt": str(args.out),
                          "native_truth_breach_s": receipt["native_replay"]["truth_offspec_first_sustained_30s_s"]}))
    else:
        print(output, end="")
    if not receipt["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
