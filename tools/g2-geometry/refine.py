#!/usr/bin/env python3
# @artifact dev
"""Test the frozen geometry campaign's two finer RK4 steps, offline only."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

import numpy as np
import scipy

import run as runner
from model import closure, findings, load_recipe, simulate

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PLAN_SHA256 = "c0623680e06644e31c0acce26e2c68291573a0e32aa9f5860a543ed5d9fd9bc5"
# The final failed base receipt is pinned separately from the prewritten plan.
BASE_RECEIPT_SHA256 = "8ff90faac5989bd07ea11f6dfaa51f4121a07e4778aa8c85f6b27b42531e3562"
BASE_FILES = ("model.py", "observation.py", "recipe.json", "requirements.txt",
              "run.py", "capture-native.cjs")
CASES = ("heat-loss-and-recovery", "reduced-feed", "zero-feed", "blocked-product-outlet",
         "crest-carry-and-starvation", "diversion", "activity-loss",
         "native-heater-loss-pre", "native-heater-loss-post_u3")
STEPS = (0.125, 0.0625)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_basis(directory=HERE):
    """Verify the unchanged experiment before running any new trajectory."""
    directory = Path(directory)
    plan_bytes = (directory / "refinement-plan.json").read_bytes()
    if digest(plan_bytes) != PLAN_SHA256:
        raise ValueError("frozen refinement plan hash mismatch")
    plan = json.loads(plan_bytes)
    if (plan.get("schema") != "g2-geometry-refinement-plan-v1" or
            plan.get("cases") != list(CASES) or plan.get("steps_s") != list(STEPS) or
            plan.get("observation_grid_s") != 0.5 or
            plan.get("basis_receipt") != "receipts/geometry-v1.json" or
            plan.get("reference") != dict(method="DOP853", rtol_divisor=100, atol_divisor=100,
                                          max_step="unchanged recipe reference_max_step_s")):
        raise ValueError("unsupported refinement plan")
    recipe_bytes = (directory / "recipe.json").read_bytes()
    if digest(recipe_bytes) != plan["basis_recipe_sha256"]:
        raise ValueError("frozen recipe hash mismatch")
    base_bytes = (directory / plan["basis_receipt"]).read_bytes()
    if digest(base_bytes) != BASE_RECEIPT_SHA256:
        raise ValueError("frozen failed base receipt hash mismatch")
    base = json.loads(base_bytes)
    if base.get("schema") != "g2-geometry-receipt-v1" or base.get("passed") is not False:
        raise ValueError("basis must be the failed geometry-v1 receipt")
    if list(base.get("cases", {})) != list(CASES):
        raise ValueError("base receipt must assess exactly the nine planned cases")
    if set(base.get("files_sha256", {})) != set(BASE_FILES):
        raise ValueError("base receipt must identify every computational source")
    files = {name: digest((directory / name).read_bytes()) for name in BASE_FILES}
    if files != base["files_sha256"]:
        raise ValueError("base receipt source hashes do not match current files")
    recipe = load_recipe(directory / "recipe.json")
    if base.get("numerics") != recipe["numerics"] or base.get("prescribed_segments") != runner.prescribed_cases():
        raise ValueError("base numerical limits or prescribed scenarios changed")
    if base.get("reference_refinement") != dict(rtol=recipe["numerics"]["reference_rtol"] / 100,
                                                atol_kg=recipe["numerics"]["reference_atol_kg"] / 100):
        raise ValueError("base refined reference tolerances changed")
    # These are the computational inputs to this supplement. Native runtime,
    # harness and legacy adapter fingerprints are also carried by its capture.
    files |= {name: digest((directory / name).read_bytes())
              for name in ("refine.py", "refinement-plan.json")}
    return dict(plan=plan, recipe=recipe, base=base, base_failed_receipt_sha256=digest(base_bytes),
                frozen_plan_sha256=digest(plan_bytes), files_sha256=files)


def prepare_cases(basis):
    """Recapture only heater loss; do not reclassify excluded native activity."""
    data = subprocess.check_output(
        ["node", str(HERE / "capture-native.cjs"), "--scenario", "heater-loss"], cwd=ROOT)
    expected = basis["base"]["native_captures"]["heater-loss"]
    if digest(data) != expected["sha256"]:
        raise ValueError("fresh native heater-loss capture hash differs from base receipt")
    trace = json.loads(data)
    if trace.get("source") != expected["source"] or trace.get("events") != expected["events"]:
        raise ValueError("native source or command metadata differs from base receipt")
    cases = runner.prescribed_cases()
    for phase in ("pre", "post_u3"):
        cases[f"native-heater-loss-{phase}"] = runner.native_segments(basis["recipe"], trace, phase)
    if list(cases) != basis["plan"]["cases"]:
        raise ValueError("reconstructed cases differ from the frozen plan")
    return cases, dict(sha256=digest(data), source=trace["source"], events=trace["events"],
                       provenance="fresh capture; exact bytes match failed base receipt; native runtime and adapter bytes independently verified")


def common_observations(result, reference_times):
    """Take exact existing observations; interpolation would hide grid errors."""
    times = np.asarray(result["times"])
    wanted = np.asarray(reference_times)
    states = np.asarray(result["states"])
    if (times.ndim != 1 or wanted.ndim != 1 or not len(times) or not len(wanted) or
            not np.isfinite(times).all() or not np.isfinite(wanted).all() or
            np.any(np.diff(times) <= 0) or np.any(np.diff(wanted) <= 0) or
            states.shape != (len(times), 96) or not np.isfinite(states).all()):
        raise ValueError("resampling requires finite ordered times and 96-field states")
    indexes = np.searchsorted(times, wanted)
    if np.any(indexes >= len(times)) or not np.array_equal(times[indexes], wanted):
        raise ValueError("fine trajectory does not contain the exact common observation grid")
    return dict(times=times[indexes], states=states[indexes])


def error_findings(items):
    return [item for item in items if item.get("severity") == "error"]


def evaluate_case(recipe, name, segments, plan, base_case):
    """Audit the full fine grid, then apply existing checks on the common grid."""
    cfg = recipe["numerics"]
    reference = simulate(recipe, segments, method="DOP853", step_s=plan["observation_grid_s"],
                         rtol=cfg["reference_rtol"] / plan["reference"]["rtol_divisor"],
                         atol=cfg["reference_atol_kg"] / plan["reference"]["atol_divisor"])
    reference_closure = closure(recipe, reference["states"])
    reference_findings = findings(recipe, reference["states"])
    previous_closure = base_case["closure_by_method"]["refined_reference"]
    reference_report = dict(method="DOP853", observation_step_s=plan["observation_grid_s"],
                            rtol=cfg["reference_rtol"] / plan["reference"]["rtol_divisor"],
                            atol_kg=cfg["reference_atol_kg"] / plan["reference"]["atol_divisor"],
                            max_step_s=cfg["reference_max_step_s"],
                            observations=len(reference["times"]), closure=reference_closure,
                            findings=reference_findings,
                            base_refined_reference_closure=previous_closure,
                            base_refined_reference_closure_identical=reference_closure == previous_closure,
                            passed=bool(reference_closure["passed"] and not error_findings(reference_findings)))
    results = {}
    for step in plan["steps_s"]:
        print(f"Refining {name}: RK4 step={step} s", file=sys.stderr, flush=True)
        try:
            fine = simulate(recipe, segments, method="rk4", step_s=step)
            full_closure = closure(recipe, fine["states"])
            full_findings = findings(recipe, fine["states"])
            common = common_observations(fine, reference["times"])
            numerical = runner.comparison(recipe, common, reference)
            summary = runner.summarize(recipe, common)
            consequences = runner.consequence_checks(recipe, name, common, summary)
            passed = bool(reference_report["passed"] and numerical["passed"] and full_closure["passed"] and
                          not error_findings(full_findings) and consequences and all(consequences.values()))
            result = dict(status="assessed", step_s=step, computed_states=len(fine["times"]),
                          observation_states=len(common["times"]),
                          closure_all_computed_states=full_closure, findings_all_computed_states=full_findings,
                          comparison_with_refined_reference=numerical, consequence_checks=consequences,
                          observation_summary=summary, passed=passed)
        except (ValueError, RuntimeError) as exc:
            result = dict(status="failed_to_complete", step_s=step, passed=False,
                          reason=f"{type(exc).__name__}: {exc}")
        results[str(step)] = result
        print(f"{name} step={step}: passed={result['passed']}", file=sys.stderr, flush=True)
    return reference_report, results


def campaign(basis):
    # Complete source/capture validation before the first physics solve.
    cases, capture = prepare_cases(basis)
    plan, recipe = basis["plan"], basis["recipe"]
    receipt = dict(_artifact="@artifact dev", schema="g2-geometry-refinement-receipt-v1",
                   groundwork_revision=basis["base"]["groundwork_revision"],
                   scope=plan["status"], acceptance=plan["acceptance"],
                   base_failed_receipt=plan["basis_receipt"],
                   base_failed_receipt_sha256=basis["base_failed_receipt_sha256"],
                   frozen_plan_sha256=basis["frozen_plan_sha256"], files_sha256=basis["files_sha256"],
                   versions=dict(python=platform.python_version(), numpy=np.__version__, scipy=scipy.__version__),
                   base_versions=basis["base"]["versions"], numerics=recipe["numerics"],
                   observation_grid_s=plan["observation_grid_s"],
                   prescribed_segments=runner.prescribed_cases(), native_captures={"heater-loss": capture},
                   excluded_native_activity=dict(status="not_reassessed", reason=plan["excluded"],
                                                 base_rejections=basis["base"]["rejected_cases"]),
                   references={}, steps={str(step): dict(step_s=step, cases={}, accepted=False) for step in plan["steps_s"]},
                   reproduce="python -B tools/g2-geometry/refine.py --out tools/g2-geometry/receipts/refinement-v1.json (pinned offline environment)",
                   decision="No live step is selected or authorized by this numerical supplement.")
    for name, segments in cases.items():
        print(f"Refined reference: {name}", file=sys.stderr, flush=True)
        try:
            reference, results = evaluate_case(recipe, name, segments, plan, basis["base"]["cases"][name])
        except (ValueError, RuntimeError) as exc:
            reference = dict(passed=False, status="failed_to_complete", reason=f"{type(exc).__name__}: {exc}")
            results = {str(step): dict(passed=False, status="not_assessed", step_s=step,
                                      reason="refined reference did not complete") for step in plan["steps_s"]}
        receipt["references"][name] = reference
        for step in plan["steps_s"]:
            receipt["steps"][str(step)]["cases"][name] = results[str(step)]
    for step in receipt["steps"].values():
        step["accepted"] = list(step["cases"]) == plan["cases"] and all(case["passed"] for case in step["cases"].values())
    receipt["passed"] = all(step["accepted"] for step in receipt["steps"].values())
    return receipt


def validate_output(path):
    """The supplement may not overwrite its basis or a computational source."""
    if path is None:
        return
    target = Path(path).resolve()
    protected = {HERE / name for name in (*BASE_FILES, "refine.py", "refinement-plan.json", "receipts/geometry-v1.json")}
    if target in protected or (ROOT / "tools/g2").resolve() in target.parents:
        raise ValueError("output may not overwrite a frozen basis or source")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="supplement receipt path; default is JSON on stdout")
    args = parser.parse_args()
    validate_output(args.out)
    receipt = campaign(load_basis())
    output = json.dumps(receipt, indent=2, allow_nan=False) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
        print(f"Wrote {args.out}; passed={receipt['passed']}", file=sys.stderr)
    else:
        print(output, end="")
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
