# @artifact dev
"""Analytical observation regressions; synthetic histories, no live imports."""
import copy
import math
import unittest

import numpy as np

from model import analyzer, load_recipe


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.recipe = load_recipe()
        self.times = np.arange(0.0, 40.5, 0.5)

    def history(self, composition):
        """Make 100 kg product inventories, or empty inventories for None."""
        states = np.zeros((len(self.times), 40))
        for index, time in enumerate(self.times):
            fractions = composition(time)
            if fractions is not None:
                a, water = fractions
                states[index, 8:12] = 100 * np.array([a, 1 - a - water, water, 0])
        return states

    def at(self, readings, time):
        return readings[int(round(time / 0.5))]

    def test_invalid_delayed_inventory_invalidates_at_sample_boundary(self):
        states = self.history(lambda t: (0.1, 0.001) if t < 5 else None)
        readings = analyzer(self.recipe, self.times, states)
        self.assertTrue(self.at(readings, 19.5)["valid"])
        at_boundary = self.at(readings, 20)
        self.assertFalse(at_boundary["valid"])
        self.assertIsNone(at_boundary["a_mass_fraction"])
        self.assertIsNone(at_boundary["w_mass_fraction"])
        self.assertEqual(at_boundary["sample_source_time_s"], 5)

    def test_delay_not_resolved_by_observation_grid_is_rejected(self):
        recipe = copy.deepcopy(self.recipe)
        recipe["analyzer"]["transport_delay_s"] = 15.25
        states = self.history(lambda t: (0.1, 0.001))
        with self.assertRaisesRegex(ValueError, "resolve analyzer delay"):
            analyzer(recipe, self.times, states)

    def test_recovery_holds_last_numeric_state_then_resumes_lag(self):
        def composition(time):
            if time < 5:
                return (0.1, 0.001)
            return None if time < 10 else (0.7, 0.004)

        readings = analyzer(self.recipe, self.times, self.history(composition))
        self.assertFalse(self.at(readings, 20)["valid"])
        self.assertFalse(self.at(readings, 24.5)["valid"])
        recovered = self.at(readings, 25)
        self.assertTrue(recovered["valid"])
        self.assertAlmostEqual(recovered["a_mass_fraction"], 0.1, places=13)
        self.assertAlmostEqual(recovered["w_mass_fraction"], 0.001, places=13)
        # No integration time elapses at reacquisition; the following five
        # seconds follow the analytical first-order response from the held state.
        response = self.at(readings, 30)
        decay = math.exp(-5 / self.recipe["analyzer"]["lag_s"])
        self.assertAlmostEqual(response["a_mass_fraction"], 0.7 + (0.1 - 0.7) * decay, places=13)
        self.assertAlmostEqual(response["w_mass_fraction"], 0.004 + (0.001 - 0.004) * decay, places=13)

    def test_initial_empty_inventory_stays_unknown_until_first_valid_sample(self):
        states = self.history(lambda t: None if t < 5 else (0.4, 0.002))
        readings = analyzer(self.recipe, self.times, states)
        for time, reading in zip(self.times, readings):
            if time < 20:
                self.assertFalse(reading["valid"], msg=f"invented reading at {time}")
                self.assertIsNone(reading["a_mass_fraction"])
                self.assertIsNone(reading["w_mass_fraction"])
        # The documented first-ever initialization policy seeds the filter
        # directly. Recovery after an earlier valid value is tested separately.
        first = self.at(readings, 20)
        self.assertTrue(first["valid"])
        self.assertAlmostEqual(first["a_mass_fraction"], 0.4, places=13)
        self.assertAlmostEqual(first["w_mass_fraction"], 0.002, places=13)
        self.assertEqual(first["sample_source_time_s"], 5)

    def test_known_step_has_exact_delay_and_first_order_sample_response(self):
        states = self.history(lambda t: (0.1, 0.001) if t < 5 else (0.7, 0.005))
        readings = analyzer(self.recipe, self.times, states)
        for time in (0, 5, 10, 15, 20, 25, 30, 35, 40):
            elapsed = max(0, time - 5 - self.recipe["analyzer"]["transport_delay_s"])
            decay = math.exp(-elapsed / self.recipe["analyzer"]["lag_s"])
            reading = self.at(readings, time)
            self.assertTrue(reading["valid"])
            self.assertAlmostEqual(reading["a_mass_fraction"], 0.7 + (0.1 - 0.7) * decay, places=13)
            self.assertAlmostEqual(reading["w_mass_fraction"], 0.005 + (0.001 - 0.005) * decay, places=13)

    def test_sample_hold_retains_value_and_source_time_between_samples(self):
        states = self.history(lambda t: (0.1, 0.001) if t < 5 else (0.7, 0.005))
        readings = analyzer(self.recipe, self.times, states)
        published = self.at(readings, 25)
        self.assertEqual(published["sample_source_time_s"], 10)
        for time in np.arange(25, 30, 0.5):
            self.assertEqual(self.at(readings, time), published)
        self.assertGreater(self.at(readings, 30)["a_mass_fraction"], published["a_mass_fraction"])
        self.assertEqual(self.at(readings, 30)["sample_source_time_s"], 15)


if __name__ == "__main__":
    unittest.main()
