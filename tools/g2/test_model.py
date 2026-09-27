# @artifact dev
"""Analytical and accounting checks for the offline synthetic mass-lump model."""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest

import numpy as np

import model


VESSELS = ("reactor", "separator", "product", "offspec")
INVENTORY = slice(0, 16)
FEED = slice(16, 20)
WATER = slice(20, 24)
GAS = slice(24, 28)
DISPATCH = slice(28, 32)
OFFSPEC_DISPATCH = slice(32, 36)
GENERATION = slice(36, 40)


def recipe(empty=False):
    result = model.load_recipe()
    if empty:
        for vessel in VESSELS:
            result["initial_mass_kg"][vessel] = [0.0] * 4
    return result


def inputs(r, **changes):
    result = {"feed_kg_s": 1.0,
              "temperature_k": r["kinetics"]["temperature_ref_k"],
              "activity": 1.0, "divert_fraction": 0.0}
    result.update(changes)
    return result


def run(r, duration=360.0, method="rk4", step_s=.5, **changes):
    return model.simulate(r, [{"duration_s": duration, "input": inputs(r, **changes)}],
                          method=method, step_s=step_s)


def component_inventory(state):
    return np.asarray(state)[INVENTORY].reshape(4, 4).sum(axis=0)


def component_outputs(state):
    state = np.asarray(state)
    return state[WATER] + state[GAS] + state[DISPATCH] + state[OFFSPEC_DISPATCH]


class AnalyticalReactorTests(unittest.TestCase):
    def test_constant_feed_matches_exact_cstr_transient_in_every_reactor_component(self):
        # Independent closed-form solution: first solve total holdup (reaction
        # cannot change it), then reactant survival. Their difference is reacted A.
        r = recipe(empty=True)
        flow, tau = .7, r["residence_s"]["reactor"]
        k = r["kinetics"]["k_ref_s_inv"]
        for method in ("rk4", "DOP853"):
            with self.subTest(method=method):
                result = run(r, method=method, feed_kg_s=flow)
                t = np.asarray(result["times"])
                total = flow * tau * (-np.expm1(-t / tau))
                a = flow / (k + 1 / tau) * (-np.expm1(-(k + 1 / tau) * t))
                expected = (total - a)[:, None] * np.asarray(r["kinetics"]["mass_yields"])
                expected[:, 0] = a
                np.testing.assert_allclose(result["states"][:, :4], expected,
                                           rtol=2e-7, atol=2e-6)

    def test_steady_conversion_is_cstr_conversion_and_not_plug_flow_conversion(self):
        r = recipe(empty=True)
        tau = r["residence_s"]["reactor"]
        k = r["kinetics"]["k_ref_s_inv"]
        state = run(r, duration=20*tau, step_s=2.0)["states"][-1]
        conversion = 1 - state[0] / np.sum(state[:4])
        self.assertAlmostEqual(conversion, k*tau/(1+k*tau), delta=1e-8)
        self.assertGreater(abs(conversion - (1-math.exp(-k*tau))), .05)

    def test_zero_activity_transports_reactant_without_generating_other_components(self):
        r = recipe(empty=True)
        result = run(r, activity=0.0)
        states = result["states"]
        self.assertTrue(np.all(states[:, GENERATION] == 0))
        np.testing.assert_array_equal(states[:, :16].reshape(-1, 4, 4)[:, :, 1:], 0)
        tau = r["residence_s"]["reactor"]
        expected_a = tau * (-np.expm1(-result["times"]/tau))
        np.testing.assert_allclose(states[:, 0], expected_a, rtol=1e-9, atol=1e-8)

    def test_zero_rate_parameter_also_disables_reaction(self):
        r = recipe(empty=True)
        r["kinetics"]["k_ref_s_inv"] = 0.0
        self.assertEqual(model.rate_constant(r, 800.0, 1.0), 0.0)
        result = run(r, duration=30.0)
        np.testing.assert_array_equal(result["states"][:, GENERATION], 0)

    def test_rate_reference_zero_activity_and_monotonic_temperature(self):
        r = recipe()
        tref = r["kinetics"]["temperature_ref_k"]
        kref = r["kinetics"]["k_ref_s_inv"]
        self.assertAlmostEqual(model.rate_constant(r, tref, 1.0), kref)
        self.assertAlmostEqual(model.rate_constant(r, tref, .5), .5*kref)
        self.assertEqual(model.rate_constant(r, tref, 0.0), 0.0)
        self.assertLess(model.rate_constant(r, 500.0, 1.0), kref)
        self.assertGreater(model.rate_constant(r, 750.0, 1.0), kref)

    def test_non_grid_feed_event_is_integrated_at_its_declared_time(self):
        r = recipe(empty=True)
        segments = [{"duration_s": .7, "input": inputs(r, activity=0)},
                    {"duration_s": 1.1, "input": inputs(r, feed_kg_s=0, activity=0)}]
        tau = r["residence_s"]["reactor"]
        expected_a = tau * (-math.expm1(-.7/tau)) * math.exp(-1.1/tau)
        for method in ("rk4", "DOP853"):
            with self.subTest(method=method):
                result = model.simulate(r, segments, method=method, step_s=.5)
                np.testing.assert_allclose(result["times"], [0, .5, .7, 1.2, 1.7, 1.8], atol=1e-12)
                np.testing.assert_allclose(result["states"][-1, FEED], [.7, 0, 0, 0], atol=1e-12)
                self.assertAlmostEqual(result["states"][-1, 0], expected_a, delta=1e-10)


class ConservationTests(unittest.TestCase):
    def assert_closes(self, r, states):
        first, last = states[0], states[-1]
        # Independent accounting uses only recorded state deltas. In particular,
        # a restart window must not count cumulative pre-window feed twice.
        residual = ((last[FEED] - first[FEED])
                    - (component_outputs(last) - component_outputs(first))
                    + (last[GENERATION] - first[GENERATION])
                    - (component_inventory(last) - component_inventory(first)))
        np.testing.assert_allclose(residual, 0, rtol=0, atol=2e-9)
        check = model.closure(r, states)
        np.testing.assert_allclose(check["component_residual_kg"], residual, rtol=0, atol=2e-10)
        self.assertLess(abs(check["total_residual_kg"]), 2e-9)
        self.assertLess(check["maximum_abs_component_residual_kg"], 2e-9)

    def test_reaction_generates_components_but_not_total_mass(self):
        r = recipe(empty=True)
        states = run(r)["states"]
        self.assertLess(states[-1, 36], 0)
        self.assertTrue(np.all(states[-1, 37:40] > 0))
        np.testing.assert_allclose(states[:, GENERATION].sum(axis=1), 0, rtol=0, atol=2e-9)
        self.assert_closes(r, states)
        self.assert_closes(r, states[len(states)//2:])

    def test_nonzero_initial_inventory_is_included_in_no_feed_discharge_limit(self):
        r = recipe()
        states = run(r, duration=3600, step_s=2.0, feed_kg_s=0.0)["states"]
        self.assertTrue(np.all(states[:, FEED] == 0))
        initial = component_inventory(states[0]).sum()
        discharged = np.array([component_outputs(state).sum() for state in states])
        self.assertGreater(discharged[-1], 0)
        self.assertTrue(np.all(discharged <= initial + 2e-9))
        self.assertGreater(component_inventory(states[-1]).sum(), 0,
                           "well-mixed tanks retain tails rather than emptying at one residence time")
        self.assert_closes(r, states)

    def test_all_component_partitions_have_declared_destinations(self):
        r = recipe(empty=True)
        r["feed_mass_fractions"] = [.1, .2, .3, .4]
        final = run(r, activity=0, divert_fraction=.3)["states"][-1]
        # No reaction: the amount that has passed the separator is the supplied
        # component mass less material still upstream. Account for both receiving
        # tanks AND their dispatch so tank residence times cannot hide routing loss.
        passed = final[FEED] - final[:4] - final[4:8]
        product_route = final[8:12] + final[12:16] + final[DISPATCH] + final[OFFSPEC_DISPATCH]
        np.testing.assert_allclose(product_route, passed*np.asarray(r["partition"]["product"]), atol=2e-9)
        np.testing.assert_allclose(final[WATER], passed*np.asarray(r["partition"]["water"]), atol=2e-9)
        np.testing.assert_allclose(final[GAS], passed*np.asarray(r["partition"]["gas"]), atol=2e-9)
        np.testing.assert_allclose(product_route + final[WATER] + final[GAS], passed, atol=2e-9)

    def test_diversion_changes_destination_without_changing_upstream_or_destroying_mass(self):
        r = recipe(empty=True)
        normal = run(r, divert_fraction=0)["states"]
        diverted = run(r, divert_fraction=1)["states"]
        np.testing.assert_allclose(normal[:, :8], diverted[:, :8], rtol=0, atol=1e-12)
        np.testing.assert_array_equal(normal[:, 12:16], 0)
        np.testing.assert_array_equal(diverted[:, 8:12], 0)
        np.testing.assert_allclose(normal[-1, 8:12] + normal[-1, DISPATCH],
                                   diverted[-1, 12:16] + diverted[-1, OFFSPEC_DISPATCH], atol=2e-9)
        self.assert_closes(r, normal)
        self.assert_closes(r, diverted)

    def test_closure_reports_deliberately_unaccounted_mass(self):
        r = recipe()
        first = model.initial_state(r)
        last = first.copy()
        last[8] += .25
        report = model.closure(r, np.vstack((first, last)))
        self.assertAlmostEqual(report["total_residual_kg"], -.25)
        np.testing.assert_allclose(report["component_residual_kg"], [-.25, 0, 0, 0], atol=1e-12)
        self.assertAlmostEqual(report["maximum_abs_component_residual_kg"], .25)


class BoundaryTests(unittest.TestCase):
    def test_initial_state_contains_declared_inventory_and_zero_cumulative_ledgers(self):
        r = recipe()
        state = model.initial_state(r)
        self.assertEqual(state.shape, (40,))
        np.testing.assert_array_equal(state[:16], np.concatenate([r["initial_mass_kg"][v] for v in VESSELS]))
        np.testing.assert_array_equal(state[16:], 0)
        state[0] = 999
        self.assertNotEqual(model.initial_state(r)[0], 999)

    def test_empty_quality_is_unknown_and_acceptance_uses_true_component_fractions(self):
        r = recipe()
        q = model.quality(r, [0, 0, 0, 0])
        self.assertFalse(q["valid"])
        self.assertIsNone(q["qualified"])
        self.assertIsNone(q["a_mass_fraction"])
        self.assertIsNone(q["w_mass_fraction"])
        at_limits = model.quality(r, [150, 848, 2, 0])
        self.assertTrue(at_limits["valid"])
        self.assertTrue(at_limits["qualified"])
        self.assertAlmostEqual(at_limits["a_mass_fraction"], .15)
        self.assertAlmostEqual(at_limits["w_mass_fraction"], .002)
        self.assertFalse(model.quality(r, [151, 847, 2, 0])["qualified"])
        self.assertFalse(model.quality(r, [150, 847, 3, 0])["qualified"])

    def test_low_capacity_is_reported_without_clipping_the_trajectory(self):
        normal = recipe(empty=True)
        small = copy.deepcopy(normal)
        small["capacity_kg"]["product"] = .1
        a = run(normal, duration=60)["states"]
        b = run(small, duration=60)["states"]
        np.testing.assert_array_equal(a, b)
        self.assertGreater(b[-1, 8:12].sum(), .1)
        found = model.findings(small, b)
        self.assertTrue(any(row["code"] == "CAPACITY_EXCEEDED" and row["inventory"] == "product"
                            and row["maximum_kg"] > .1 for row in found))
        self.assert_closes_without_correction(small, b)

    def assert_closes_without_correction(self, r, states):
        result = model.closure(r, states)
        self.assertLess(abs(result["total_residual_kg"]), 2e-9)

    def test_negative_inventory_remains_visible_as_a_finding(self):
        r = recipe()
        state = model.initial_state(r)
        state[8] = -1.0
        original = state.copy()
        found = model.findings(r, np.array([state]))
        self.assertTrue(any(row["code"] == "NEGATIVE_MASS" and row["minimum_kg"] == -1 for row in found))
        np.testing.assert_array_equal(state, original)

    def test_nonfinite_results_are_reported_and_invalid_compositions_are_unknown(self):
        r = recipe()
        state = model.initial_state(r)
        state[8] = np.nan
        self.assertTrue(any(row["code"] == "NONFINITE_STATE" for row in model.findings(r, np.array([state]))))
        for masses in ([1, 2, np.nan, 0], [-1, 2, 0, 0], [0, np.inf, 0, 0], [1, 2, 3]):
            with self.subTest(masses=masses):
                quality = model.quality(r, masses)
                self.assertFalse(quality["valid"])
                self.assertIsNone(quality["qualified"])

    def test_inputs_must_be_finite_and_inside_every_declared_envelope(self):
        r = recipe()
        model.validate_input(r, inputs(r))
        for key, (low, high) in r["envelope"].items():
            for value in (low, high):
                model.validate_input(r, inputs(r, **{key: value}))
            for value in (low-1, high+1, float("nan"), float("inf"), -float("inf"), True, None):
                with self.subTest(key=key, value=value):
                    with self.assertRaises(ValueError):
                        model.validate_input(r, inputs(r, **{key: value}))
        missing = inputs(r)
        del missing["activity"]
        with self.assertRaises(ValueError):
            model.validate_input(r, missing)

    def test_recipe_rejects_unbalanced_undefined_and_nonfinite_physical_parameters(self):
        invalid = []
        def alter(section, key, value):
            r = recipe()
            r[section][key] = value
            invalid.append(r)
        alter("kinetics", "mass_yields", [0, .8, .3, .02])
        alter("kinetics", "mass_yields", [0, .78, .20])
        alter("partition", "water", [0, 0, 0, 0])
        alter("partition", "gas", [0, 0, 0, -.1])
        alter("residence_s", "reactor", 0)
        alter("capacity_kg", "product", -1)
        alter("kinetics", "k_ref_s_inv", float("nan"))
        alter("initial_mass_kg", "reactor", [-1, 0, 0, 0])
        alter("initial_mass_kg", "separator", [0, 0, 0])
        alter("units", "mass", "m3")
        alter("envelope", "activity", [1, 0])
        wrong_feed = recipe(); wrong_feed["feed_mass_fractions"] = [.5, 0, 0, 0]; invalid.append(wrong_feed)
        wrong_components = recipe(); wrong_components["components"] = ["P", "A", "W", "G"]; invalid.append(wrong_components)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            for index, r in enumerate(invalid):
                with self.subTest(case=index):
                    path.write_text(json.dumps(r), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        model.load_recipe(path)

    def test_derivative_is_pure_and_tracks_no_invented_mass_source(self):
        r = recipe()
        x = model.initial_state(r)
        u = inputs(r)
        before_recipe, before_x, before_u = copy.deepcopy(r), x.copy(), u.copy()
        dx = model.derivative(r, x, u)
        self.assertEqual(dx.shape, (40,))
        self.assertTrue(np.isfinite(dx).all())
        self.assertEqual(r, before_recipe)
        np.testing.assert_array_equal(x, before_x)
        self.assertEqual(u, before_u)
        self.assertAlmostEqual(dx[GENERATION].sum(), 0, delta=1e-12)
        self.assertAlmostEqual(component_inventory(dx).sum() + component_outputs(dx).sum(), u["feed_kg_s"], delta=1e-12)


if __name__ == "__main__":
    unittest.main()
