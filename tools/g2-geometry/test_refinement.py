# @artifact dev
"""Cheap supplement orchestration tests; mocked trajectories prove no physics."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import refine


class RefinementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.basis = refine.load_basis()

    def copy_basis(self, destination):
        for name in (*refine.BASE_FILES, "refine.py", "refinement-plan.json", "receipts/geometry-v1.json"):
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(refine.HERE / name, target)

    def test_frozen_failed_basis_is_verified_without_a_capture_or_solve(self):
        with patch.object(refine, "simulate", side_effect=AssertionError("must not solve")), \
                patch.object(refine.subprocess, "check_output", side_effect=AssertionError("must not capture")):
            basis = refine.load_basis()
        self.assertEqual(basis["base_failed_receipt_sha256"], refine.BASE_RECEIPT_SHA256)
        self.assertEqual(basis["frozen_plan_sha256"], refine.PLAN_SHA256)
        self.assertEqual(basis["files_sha256"]["refine.py"], refine.digest((refine.HERE / "refine.py").read_bytes()))
        self.assertIs(basis["base"]["passed"], False)

    def test_tampered_plan_recipe_receipt_or_computational_source_is_rejected(self):
        targets = (("refinement-plan.json", "plan hash"), ("recipe.json", "recipe hash"),
                   ("receipts/geometry-v1.json", "base receipt hash"), ("model.py", "source hashes"),
                   ("run.py", "source hashes"), ("capture-native.cjs", "source hashes"))
        for name, message in targets:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                self.copy_basis(directory)
                target = directory / name
                target.write_bytes(target.read_bytes() + b"\n")
                with patch.object(refine, "simulate", side_effect=AssertionError("must not solve")), \
                        self.assertRaisesRegex(ValueError, message):
                    refine.load_basis(directory)

    def native_fixture(self):
        basis = copy.deepcopy(self.basis)
        trace = {"source": {"model_id": "mocked-source"}, "events": []}
        data = json.dumps(trace).encode()
        basis["base"]["native_captures"]["heater-loss"] = dict(sha256=refine.digest(data), **trace)
        return basis, data

    def test_native_hash_rejection_precedes_every_simulation(self):
        basis, data = self.native_fixture()
        with patch.object(refine.subprocess, "check_output", return_value=data + b"\n"), \
                patch.object(refine, "simulate") as solve, \
                patch.object(refine.runner, "native_segments") as segments, \
                self.assertRaisesRegex(ValueError, "capture hash"):
            refine.campaign(basis)
        solve.assert_not_called()
        segments.assert_not_called()

    def test_native_metadata_and_case_list_cannot_be_substituted(self):
        basis, data = self.native_fixture()
        basis["base"]["native_captures"]["heater-loss"]["source"] = {"different": True}
        with patch.object(refine.subprocess, "check_output", return_value=data), \
                self.assertRaisesRegex(ValueError, "metadata"):
            refine.prepare_cases(basis)
        basis, data = self.native_fixture()
        with patch.object(refine.subprocess, "check_output", return_value=data), \
                patch.object(refine.runner, "prescribed_cases", return_value={}), \
                patch.object(refine.runner, "native_segments", return_value=[]), \
                self.assertRaisesRegex(ValueError, "cases differ"):
            refine.prepare_cases(basis)

    def test_only_fresh_heater_capture_and_exact_nine_cases_are_reconstructed(self):
        basis, data = self.native_fixture()
        with patch.object(refine.subprocess, "check_output", return_value=data) as capture, \
                patch.object(refine.runner, "native_segments", side_effect=lambda recipe, trace, phase: [phase]) as segments:
            cases, receipt = refine.prepare_cases(basis)
        self.assertEqual(list(cases), list(refine.CASES))
        self.assertEqual(cases["native-heater-loss-pre"], ["pre"])
        self.assertEqual(cases["native-heater-loss-post_u3"], ["post_u3"])
        self.assertEqual([call.args[2] for call in segments.call_args_list], ["pre", "post_u3"])
        self.assertEqual(capture.call_args.args[0][-2:], ["--scenario", "heater-loss"])
        self.assertEqual(capture.call_count, 1)
        self.assertEqual(receipt["sha256"], refine.digest(data))

    @staticmethod
    def result(step):
        times = np.arange(round(1 / step) + 1) * step
        return dict(times=times, states=np.tile(np.arange(96, dtype=float), (len(times), 1)))

    def test_resampling_is_exact_and_retains_all_96_fields(self):
        result = self.result(.125)
        result["states"][:, 95] = result["times"]
        sampled = refine.common_observations(result, np.array([0, .5, 1]))
        np.testing.assert_array_equal(sampled["states"], result["states"][[0, 4, 8]])
        for times in ([0, .50000001, 1], [0, .5, 1.5], [0, .5, .5], [0, float("nan")]):
            with self.subTest(times=times), self.assertRaises(ValueError):
                refine.common_observations(result, np.array(times))

    def evaluate_mocked(self, *, fail_closure=False, finding=None, mismatch=False):
        closure_lengths, consequence_times, calls = [], [], []

        def simulate(recipe, segments, **kwargs):
            calls.append(kwargs)
            result = self.result(kwargs["step_s"])
            if mismatch and kwargs["method"] == "rk4":
                result["states"][-1, 95] += 10
            return result

        def check_closure(recipe, states):
            closure_lengths.append(len(states))
            return {"passed": not (fail_closure and len(states) > 3)}

        def consequences(recipe, name, result, summary):
            consequence_times.append(result["times"].tolist())
            return {"original_consequence": True}

        with patch.object(refine, "simulate", side_effect=simulate), \
                patch.object(refine, "closure", side_effect=check_closure), \
                patch.object(refine, "findings", side_effect=lambda recipe, states: [finding] if finding and len(states) > 3 else []), \
                patch.object(refine.runner, "summarize", return_value={"classification_step_s": .5}), \
                patch.object(refine.runner, "consequence_checks", side_effect=consequences), redirect_stderr(io.StringIO()):
            reference, results = refine.evaluate_case(self.basis["recipe"], "zero-feed", [], self.basis["plan"],
                                                       {"closure_by_method": {"refined_reference": {"passed": True}}})
        return reference, results, closure_lengths, consequence_times, calls

    def test_fine_grid_audit_and_common_grid_consequences_are_separate(self):
        reference, results, lengths, times, calls = self.evaluate_mocked()
        self.assertEqual(lengths, [3, 9, 17])
        self.assertEqual(times, [[0, .5, 1], [0, .5, 1]])
        self.assertTrue(reference["base_refined_reference_closure_identical"])
        self.assertTrue(all(result["passed"] for result in results.values()))
        cfg = self.basis["recipe"]["numerics"]
        self.assertEqual(calls, [dict(method="DOP853", step_s=.5, rtol=cfg["reference_rtol"] / 100,
                                     atol=cfg["reference_atol_kg"] / 100),
                                 dict(method="rk4", step_s=.125), dict(method="rk4", step_s=.0625)])

    def test_intermediate_closure_errors_and_last_state_field_cannot_hide_in_sampling(self):
        for options in ({"fail_closure": True}, {"finding": {"severity": "error", "code": "TEST_ERROR"}}, {"mismatch": True}):
            with self.subTest(options=options):
                _, results, _, _, _ = self.evaluate_mocked(**options)
                self.assertTrue(all(result["passed"] is False for result in results.values()))
        _, results, _, _, _ = self.evaluate_mocked(finding={"severity": "note", "code": "CAPACITY"})
        self.assertTrue(all(result["passed"] for result in results.values()))

    def test_campaign_reports_each_step_failure_without_selecting_a_live_step(self):
        cases = {name: [] for name in refine.CASES}

        def evaluate(recipe, name, segments, plan, base):
            return {"passed": True}, {str(step): {"passed": not (step == .125 and name == "crest-carry-and-starvation")}
                                      for step in refine.STEPS}

        with patch.object(refine, "prepare_cases", return_value=(cases, {"sha256": "mock-only"})), \
                patch.object(refine, "evaluate_case", side_effect=evaluate), redirect_stderr(io.StringIO()):
            receipt = refine.campaign(self.basis)
        self.assertIs(receipt["passed"], False)
        self.assertIs(receipt["steps"]["0.125"]["accepted"], False)
        self.assertIs(receipt["steps"]["0.0625"]["accepted"], True)
        self.assertEqual(receipt["excluded_native_activity"]["status"], "not_reassessed")
        self.assertNotIn("selected_step_s", receipt)
        self.assertEqual(receipt["base_failed_receipt_sha256"], refine.BASE_RECEIPT_SHA256)

    def test_cli_reports_failure_and_protects_immutable_outputs_before_campaign(self):
        for name in ("receipts/geometry-v1.json", "refinement-plan.json", "recipe.json", "run.py"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                refine.validate_output(refine.HERE / name)
        with self.assertRaises(ValueError):
            refine.validate_output(refine.ROOT / "tools/g2/receipts/stage-one.json")
        output = io.StringIO()
        with patch.object(refine.sys, "argv", ["refine.py"]), \
                patch.object(refine, "load_basis", return_value=self.basis), \
                patch.object(refine, "campaign", return_value={"passed": False}), redirect_stdout(output):
            status = refine.main()
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(output.getvalue()), {"passed": False})


if __name__ == "__main__":
    unittest.main()
