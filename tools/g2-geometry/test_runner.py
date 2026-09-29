# @artifact dev
"""Receipt-boundary tests: input identity, all-state errors and dispatch meaning."""
import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import numpy as np

import run as runner
from model import load_recipe, transfer_slice

HERE = Path(__file__).resolve().parent


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recipe = load_recipe()
        # Historical inputs come only from the SHA-verified archived runtime.
        # The unchanged capture adapters deliberately refuse today's live model.
        archive = HERE.parent / "g2-history/archive.cjs"
        cls.trace = json.loads(subprocess.check_output(
            ["node", str(archive), "--capture", "geometry"], cwd=HERE.parent.parent))
        cls.activity_trace = json.loads(subprocess.check_output(
            ["node", str(archive), "--capture", "geometry", "--scenario", "activity-step"],
            cwd=HERE.parent.parent))
        expected = {key: cls.trace["source"][key] for key in (
            "revision", "model_id", "model_stamp_sha256", "harness_sha256",
            "provenance_dependency_sha256", "capture_script_sha256")}
        cls.source_patch = patch.object(runner, "verified_native_source", return_value=expected)
        cls.source_patch.start()
        cls.addClassCleanup(cls.source_patch.stop)

    def test_native_phases_preserve_declared_units_and_full_grid(self):
        for phase in ("pre", "post_u3"):
            segments = runner.native_segments(self.recipe, self.trace, phase)
            self.assertEqual(len(segments), 6000)
            self.assertEqual(sum(s["duration_s"] for s in segments), 3000)
            frame = self.trace["intervals"][1200][phase]
            values = segments[1200]["input"]
            self.assertEqual(values["temperature_k"], frame["bed_temperature_c"] + 273.15)
            self.assertEqual(values["feed_kg_s"], frame["flow_m3h"] * self.recipe["feed_density_kg_m3"] / 3600)
            self.assertEqual(values["activity"], frame["effective_activity"])
            self.assertEqual(values["water_valve"], frame["water_valve_position"])
            self.assertEqual(values["product_valve"], frame["product_valve_position"])

    def test_native_rejects_schema_scenario_and_step_mismatches(self):
        changes = [
            lambda t: t.update(schema="g2-native-input-v1"),
            lambda t: t.update(scenario="unregistered-case"),
            lambda t: t["source"].update(step_s=1),
        ]
        for index, change in enumerate(changes):
            trace = copy.deepcopy(self.trace)
            change(trace)
            with self.subTest(change=index), self.assertRaises(ValueError):
                runner.native_segments(self.recipe, trace, "pre")

    def test_native_rejects_truncation_gaps_and_undeclared_frames(self):
        changes = [
            lambda t: t["intervals"].pop(),
            lambda t: t["intervals"][1].update(start_s=1),
            lambda t: t["intervals"][0].update(start_s=False),
            lambda t: t["intervals"][0]["pre"].update(flow_m3h=float("nan")),
            lambda t: t["intervals"][0]["pre"].update(flow_m3h=True),
            lambda t: t["intervals"][0]["pre"].update(unrelated_state="hidden"),
            lambda t: t["intervals"][0]["pre"].pop("effective_activity"),
        ]
        for index, change in enumerate(changes):
            trace = copy.deepcopy(self.trace)
            change(trace)
            with self.subTest(change=index), self.assertRaises(ValueError):
                runner.native_segments(self.recipe, trace, "pre")

    def test_activity_trace_exceeding_frozen_envelope_is_not_a_composition_case(self):
        trace = self.activity_trace
        self.assertEqual(self.recipe["envelope"]["temperature_k"][1], 800)
        for phase in ("pre", "post_u3"):
            violating = [r for r in trace["intervals"] if r[phase]["bed_temperature_c"] + 273.15 > 800]
            self.assertTrue(violating)
            with self.subTest(phase=phase), self.assertRaises(ValueError) as raised:
                runner.native_segments(self.recipe, trace, phase)
            self.assertIn("MODEL_OUT_OF_ENVELOPE", str(raised.exception))
            self.assertIn(f"{phase} interval {violating[0]['start_s']} s:", str(raised.exception))

    def test_rejected_activity_phases_are_reported_not_simulated_or_counted_as_passes(self):
        # This isolates routing/receipt semantics: a fake assessed result is not
        # a physics validation and is never written as a repository receipt.
        assessed = dict(times=np.array([0, .5]), states=np.zeros((2, 96)))
        verified_source = runner.verified_native_source()
        output = io.StringIO()
        with patch.object(runner, "prescribed_cases", return_value={}), \
                patch.object(runner, "verified_native_source", return_value=verified_source), \
                patch.object(runner.subprocess, "check_output", side_effect=[
                    json.dumps(self.trace).encode(), json.dumps(self.activity_trace).encode()]), \
                patch.object(runner, "evaluate", return_value=({"passed": True}, assessed)) as evaluate, \
                patch.object(runner.sys, "argv", ["run.py"]), redirect_stdout(output):
            runner.main()
        receipt = json.loads(output.getvalue())
        self.assertEqual(set(receipt["cases"]), {"native-heater-loss-pre", "native-heater-loss-post_u3"})
        self.assertEqual(evaluate.call_count, 2)
        self.assertEqual(set(receipt["rejected_cases"]), {"native-activity-step-pre", "native-activity-step-post_u3"})
        for item in receipt["rejected_cases"].values():
            self.assertEqual(item["status"], "not_assessed")
            self.assertNotIn("passed", item)
            self.assertNotIn("dispatch", item)
            self.assertGreater(item["temperature_range_k"][1], 800)
        self.assertNotIn("activity-step", receipt["phase_comparisons"])
        self.assertIn("assessed cases only", receipt["acceptance_scope"])
        self.assertTrue(receipt["passed"])

    def test_an_error_finding_cannot_pass_even_when_numerics_and_closure_pass(self):
        result = dict(times=np.array([0, .5]), states=np.zeros((2, 96)))
        summary = {"findings": [{"code": "G_IN_LIQUID", "severity": "error"}]}
        with patch.object(runner, "simulate", return_value=result), \
                patch.object(runner, "summarize", return_value=summary), \
                patch.object(runner, "comparison", return_value={"passed": True}), \
                patch.object(runner, "closure", return_value={"passed": True}), \
                patch.object(runner, "consequence_checks", return_value={"fixture": True}):
            evaluated, _ = runner.evaluate(self.recipe, "fixture", [])
        self.assertFalse(evaluated["passed"])

    def test_comparison_includes_ledger_states_not_only_inventories(self):
        a = dict(times=np.array([0, .5, 1]), states=np.zeros((3, 96)))
        b = dict(times=a["times"].copy(), states=a["states"].copy())
        b["states"][1, -1] = 2
        comparison = runner.comparison(self.recipe, a, b)
        self.assertEqual(comparison["maximum_abs_inventory_error_kg"], 0)
        self.assertEqual(comparison["maximum_abs_all_state_error_kg"], 2)
        self.assertFalse(comparison["passed"])

    def test_comparison_rejects_broadcastable_shape_and_time_mismatch(self):
        a = dict(times=np.array([0, .5, 1]), states=np.zeros((3, 96)))
        for b in (dict(times=a["times"], states=np.zeros((3, 1))),
                  dict(times=np.array([0, .5, 1.5]), states=a["states"])):
            with self.subTest(shape=b["states"].shape), self.assertRaises(ValueError):
                runner.comparison(self.recipe, a, b)

    def dispatch_history(self):
        states = np.zeros((4, 96))
        # Initial good product, then off-spec, then empty/unknown. These are
        # classification fixtures, not a claimed dynamically conserved run.
        states[0, 16:20] = [1, 9, 0, 0]
        states[1, 16:20] = [4, 6, 0, 0]
        states[3, 16:20] = [1, 9, 0, 0]
        states[:, transfer_slice("product_dispatch").start] = [0, 1, 3, 6]
        states[:, transfer_slice("product_transfer").start] = [0, 10, 20, 30]
        return dict(times=np.array([0, .5, 1, 1.5]), states=states)

    def test_dispatch_counts_external_output_once_and_uses_truth_not_analyzer(self):
        result = self.dispatch_history()
        observed = [dict(valid=True, a_mass_fraction=0.0, w_mass_fraction=0.0) for _ in result["times"]]
        with patch.object(runner, "analyzer", return_value=observed):
            summary = runner.summarize(self.recipe, result)
        meter = summary["dispatch"]
        self.assertEqual(meter["gross_kg"], 6)
        self.assertEqual(meter["qualified_kg"], 1)
        self.assertEqual(meter["off_band_kg"], 2)
        self.assertEqual(meter["unknown_kg"], 3)
        self.assertEqual(meter["sum_residual_kg"], 0)
        self.assertEqual(summary["analyzer_dispatch_coverage"], dict(valid_kg=6, unknown_kg=0))
        with patch.object(runner, "analyzer", return_value=[dict(valid=False) for _ in result["times"]]):
            withheld = runner.summarize(self.recipe, result)
        self.assertEqual(withheld["dispatch"], meter)
        self.assertEqual(withheld["analyzer_dispatch_coverage"], dict(valid_kg=0, unknown_kg=6))

    def test_decreasing_external_dispatch_cannot_reduce_recorded_loss(self):
        result = self.dispatch_history()
        result["states"][:, transfer_slice("product_dispatch").start] = [0, 2, 1, 3]
        observed = [dict(valid=False) for _ in result["times"]]
        with patch.object(runner, "analyzer", return_value=observed), self.assertRaises(ValueError):
            runner.summarize(self.recipe, result)


if __name__ == "__main__":
    unittest.main()
