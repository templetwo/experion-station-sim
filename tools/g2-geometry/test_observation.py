# @artifact dev
"""Analytical observation cases for the geometry recipe's receiving product tank."""
import copy
import math
import unittest

import numpy as np

from model import load_recipe
from observation import analyzer, quality


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.recipe = load_recipe()
        self.times = np.arange(0, 40.5, .5)

    def history(self, composition):
        states = np.zeros((len(self.times), 96))
        # A different chamber has deliberately contradictory composition.
        states[:, 8:12] = [100, 0, 0, 0]
        for i, time in enumerate(self.times):
            value = composition(time)
            if value is not None:
                a, water = value
                states[i, 16:20] = 100 * np.array([a, 1 - a - water, water, 0])
        return states

    def at(self, values, time):
        return values[round(time / .5)]

    def test_quality_limits_are_mass_fractions_with_inclusive_boundaries(self):
        limits = self.recipe["quality"]
        a, w = limits["max_a_mass_fraction"], limits["max_w_mass_fraction"]
        masses = np.array([a, 1-a-w, w, 0])
        q = quality(self.recipe, masses)
        self.assertTrue(q["valid"] and q["qualified"])
        self.assertEqual(q, quality(self.recipe, masses * 1000))
        for index in (0, 2):
            bad = masses.copy()
            bad[index] += .001
            bad[1] -= .001
            self.assertFalse(quality(self.recipe, bad)["qualified"])

    def test_empty_invalid_and_subminimum_inventories_are_unknown(self):
        minimum = self.recipe["quality"]["minimum_inventory_kg"]
        for masses in ([0, 0, 0, 0], [0, minimum/2, 0, 0], [-1, 100, 0, 0],
                       [math.nan, 100, 0, 0], [0, math.inf, 0, 0], [1e308]*4, [1, 2, 3]):
            with self.subTest(masses=masses):
                self.assertEqual(quality(self.recipe, masses), {
                    "valid": False, "qualified": None, "a_mass_fraction": None, "w_mass_fraction": None})
        self.assertTrue(quality(self.recipe, [0, minimum, 0, 0])["qualified"])

    def test_step_response_has_exact_delay_lag_and_product_location(self):
        states = self.history(lambda t: (.1, .001) if t < 5 else (.7, .005))
        before = states.copy()
        readings = analyzer(self.recipe, self.times, states)
        for time in range(0, 41, 5):
            elapsed = max(0, time - 5 - self.recipe["analyzer"]["transport_delay_s"])
            decay = math.exp(-elapsed / self.recipe["analyzer"]["lag_s"])
            row = self.at(readings, time)
            self.assertTrue(row["valid"])
            self.assertAlmostEqual(row["a_mass_fraction"], .7 + (.1-.7)*decay, places=13)
            self.assertAlmostEqual(row["w_mass_fraction"], .005 + (.001-.005)*decay, places=13)
        np.testing.assert_array_equal(states, before)
        # Truth already fails while the delayed observation is still in band.
        self.assertFalse(quality(self.recipe, states[10, 16:20])["qualified"])
        self.assertEqual(self.at(readings, 5)["a_mass_fraction"], .1)

    def test_invalid_delayed_truth_invalidates_at_exact_sample_boundary(self):
        readings = analyzer(self.recipe, self.times, self.history(lambda t: (.1, .001) if t < 5 else None))
        self.assertTrue(self.at(readings, 19.5)["valid"])
        self.assertEqual(self.at(readings, 20), {"valid": False, "a_mass_fraction": None,
                                              "w_mass_fraction": None, "sample_source_time_s": 5.0})

    def test_reacquisition_resumes_lag_from_held_numeric_state(self):
        readings = analyzer(self.recipe, self.times, self.history(
            lambda t: (.1, .001) if t < 5 else None if t < 10 else (.7, .004)))
        self.assertFalse(self.at(readings, 20)["valid"])
        self.assertFalse(self.at(readings, 24.5)["valid"])
        self.assertAlmostEqual(self.at(readings, 25)["a_mass_fraction"], .1)
        decay = math.exp(-5 / self.recipe["analyzer"]["lag_s"])
        self.assertAlmostEqual(self.at(readings, 30)["a_mass_fraction"], .7+(.1-.7)*decay, places=13)

    def test_first_valid_inventory_initializes_only_after_its_transport_delay(self):
        readings = analyzer(self.recipe, self.times, self.history(lambda t: None if t < 5 else (.4, .002)))
        self.assertTrue(all(not row["valid"] for row in readings[:40]))
        self.assertEqual(self.at(readings, 20), {"valid": True, "a_mass_fraction": .4,
                                              "w_mass_fraction": .002, "sample_source_time_s": 5.0})

    def test_sample_hold_preserves_values_and_timestamp(self):
        readings = analyzer(self.recipe, self.times, self.history(lambda t: (.1, .001) if t < 5 else (.7, .005)))
        sample = self.at(readings, 25)
        self.assertEqual(sample["sample_source_time_s"], 10)
        for time in np.arange(25, 30, .5):
            self.assertEqual(self.at(readings, time), sample)
        self.assertGreater(self.at(readings, 30)["a_mass_fraction"], sample["a_mass_fraction"])

    def test_malformed_or_unresolved_time_grids_are_rejected(self):
        states = self.history(lambda t: (.1, .001))
        for times in ([], [1], [0, 0], [0, math.nan], [0, .5, 1.1]):
            with self.subTest(times=times), self.assertRaises(ValueError):
                analyzer(self.recipe, times, states[:len(times)])
        for key in ("transport_delay_s", "sample_period_s"):
            r = copy.deepcopy(self.recipe)
            r["analyzer"][key] += .25
            with self.assertRaisesRegex(ValueError, "resolve analyzer delay"):
                analyzer(r, self.times, states)
        r = copy.deepcopy(self.recipe)
        r["analyzer"]["sample_period_s"] = 1e-12
        with self.assertRaisesRegex(ValueError, "resolve analyzer delay"):
            analyzer(r, self.times, states)

    def test_invalid_timing_and_wrong_state_shape_are_rejected(self):
        states = self.history(lambda t: (.1, .001))
        for key, value in (("lag_s", 0), ("sample_period_s", -1),
                           ("transport_delay_s", math.nan), ("lag_s", True)):
            r = copy.deepcopy(self.recipe)
            r["analyzer"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                analyzer(r, self.times, states)
        with self.assertRaises(ValueError):
            analyzer(self.recipe, self.times, states[:, :40])


if __name__ == "__main__":
    unittest.main()
