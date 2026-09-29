# @artifact dev
"""Independent analytical, material-accounting and geometry boundary checks."""
import math
import unittest

import numpy as np

import model


VESSELS = ("reactor", "water", "oil", "chamber2", "product", "offspec")
TRANSFER_NAMES = ("feed", "reactor_water", "reactor_oil", "reactor_gas", "water_draw",
                  "oil_underflow", "water_carry", "oil_weir", "product_transfer", "diversion",
                  "product_dispatch", "offspec_dispatch", "water_overflow", "oil_overflow",
                  "chamber2_overflow", "product_overflow", "offspec_overflow")
EXTERNAL_OUTPUTS = ("reactor_gas", "water_draw", "oil_underflow", "product_dispatch",
                    "offspec_dispatch", "water_overflow", "oil_overflow", "chamber2_overflow",
                    "product_overflow", "offspec_overflow")


def counter(name):
    index = TRANSFER_NAMES.index(name)
    return slice(28 + 4*index, 32 + 4*index)


def recipe(empty=False):
    r = model.load_recipe()
    if empty:
        r["initial_mass_kg"] = {name: [0.0]*4 for name in VESSELS}
    return r


def inputs(r, **changes):
    result = {"feed_kg_s": 5.0, "temperature_k": r["kinetics"]["temperature_ref_k"],
              "activity": 1.0, "water_valve": .5, "product_valve": .5,
              "weir_height_percent": 55.0, "divert_fraction": 0.0}
    result.update(changes)
    return result


def run(r, duration=60.0, method="rk4", step_s=.5, state=None, **changes):
    return model.simulate(r, [{"duration_s": duration, "input": inputs(r, **changes)}],
                          method=method, step_s=step_s, state=state)


class ReactorTests(unittest.TestCase):
    def test_empty_reactor_matches_closed_form_mass_and_reaction_transient(self):
        r = recipe(empty=True)
        flow, reference, k = 7.0, r["reactor"]["reference_holdup_kg"], r["kinetics"]["k_ref_s_inv"]
        for method in ("rk4", "DOP853"):
            result = run(r, duration=80, method=method, feed_kg_s=flow)
            t = result["times"]
            total = reference * -np.expm1(-flow*t/reference)
            a = flow/(flow/reference+k) * -np.expm1(-(flow/reference+k)*t)
            expected = (total-a)[:, None] * np.array(r["kinetics"]["mass_yields"])
            expected[:, 0] = a
            np.testing.assert_allclose(result["states"][:, :4], expected, rtol=2e-7, atol=2e-6)

    def test_steady_conversion_increases_as_feed_decreases(self):
        r = recipe(empty=True)
        mass = r["reactor"]["reference_holdup_kg"]
        r["initial_mass_kg"]["reactor"] = [mass, 0, 0, 0]
        k = r["kinetics"]["k_ref_s_inv"]
        conversions = []
        for flow in (5, 10):
            final = run(r, duration=360, feed_kg_s=flow)["states"][-1, :4]
            self.assertAlmostEqual(final.sum(), mass, delta=2e-9)
            conversion = 1-final[0]/final.sum()
            self.assertAlmostEqual(conversion, k*mass/(flow+k*mass), delta=2e-10)
            conversions.append(conversion)
        self.assertGreater(conversions[0]-conversions[1], r["acceptance"]["minimum_flow_conversion_gain"])

    def test_zero_feed_isolates_reactor_material_while_reaction_continues(self):
        r = recipe(empty=True)
        r["initial_mass_kg"]["reactor"] = [1000, 0, 0, 0]
        result = run(r, duration=20, feed_kg_s=0)
        states, t = result["states"], result["times"]
        expected_a = 1000*np.exp(-r["kinetics"]["k_ref_s_inv"]*t)
        np.testing.assert_allclose(states[:, 0], expected_a, rtol=2e-7, atol=2e-6)
        np.testing.assert_allclose(states[:, :4].sum(axis=1), 1000, atol=2e-9)
        np.testing.assert_array_equal(states[:, 4:24], 0)
        np.testing.assert_array_equal(states[:, 28:], 0)

    def test_zero_activity_and_zero_rate_cannot_generate_product(self):
        for zero in ("activity", "rate"):
            r = recipe(empty=True)
            changes = {"activity": 0} if zero == "activity" else {}
            if zero == "rate":
                r["kinetics"]["k_ref_s_inv"] = 0
            states = run(r, **changes)["states"]
            np.testing.assert_array_equal(states[:, 24:28], 0)
            np.testing.assert_array_equal(states[:, :24].reshape(-1, 6, 4)[:, :, 1:], 0)

    def test_rate_reference_temperature_and_activity_have_declared_effects(self):
        r = recipe()
        k, tref = r["kinetics"]["k_ref_s_inv"], r["kinetics"]["temperature_ref_k"]
        self.assertAlmostEqual(model.rate_constant(r, tref, 1), k)
        self.assertAlmostEqual(model.rate_constant(r, tref, .5), .5*k)
        self.assertEqual(model.rate_constant(r, 800, 0), 0)
        self.assertLess(model.rate_constant(r, 500, 1), k)
        self.assertGreater(model.rate_constant(r, 750, 1), k)


class AccountingTests(unittest.TestCase):
    def assert_closes(self, r, states):
        delta = states-states[0]
        inventory = delta[:, :24].reshape(-1, 6, 4).sum(axis=1)
        outputs = sum(delta[:, counter(name)] for name in EXTERNAL_OUTPUTS)
        residual = delta[:, counter("feed")]-outputs+delta[:, 24:28]-inventory
        np.testing.assert_allclose(residual, 0, rtol=0, atol=2e-8)
        np.testing.assert_allclose(delta[:, 24:28].sum(axis=1), 0, rtol=0, atol=2e-8)
        reported = model.closure(r, states)
        self.assertTrue(reported["passed"], reported)
        np.testing.assert_allclose(reported["component_residual_kg"], residual[-1], atol=2e-9)
        self.assertLess(abs(reported["total_residual_kg"]), 2e-8)

    def test_declared_layout_and_all_internal_transfers_close(self):
        r = recipe()
        self.assertEqual(model.SIZE, 96)
        self.assertEqual(tuple(t["name"] for t in model.TRANSFERS), TRANSFER_NAMES)
        states = run(r, duration=90, divert_fraction=.35)["states"]
        self.assertLess(states[-1, 24], 0)
        self.assertTrue(np.all(states[-1, 25:28] > 0))
        self.assert_closes(r, states)
        self.assert_closes(r, states[len(states)//2:])

    def test_all_reactor_effluent_components_reach_declared_phase_destinations(self):
        r = recipe(empty=True)
        r["feed_mass_fractions"] = [.1, .2, .3, .4]
        state = run(r, duration=80, activity=0)["states"][-1]
        discharged = state[counter("feed")]-state[:4]
        for name, mask in (("reactor_water", [0, 0, 1, 0]),
                           ("reactor_oil", [1, 1, 0, 0]), ("reactor_gas", [0, 0, 0, 1])):
            np.testing.assert_allclose(state[counter(name)], discharged*np.array(mask), atol=2e-9)
        self.assertEqual(state[4:24].reshape(5, 4)[:, 3].sum(), 0)

    def test_diversion_changes_only_receiving_destination_and_conserves_total(self):
        r = recipe()
        direct = run(r, duration=30, divert_fraction=0)["states"]
        diverted = run(r, duration=30, divert_fraction=1)["states"]
        np.testing.assert_array_equal(direct[:, :16], diverted[:, :16])
        np.testing.assert_allclose(direct[:, counter("product_transfer")], diverted[:, counter("diversion")], atol=1e-12)
        np.testing.assert_array_equal(direct[:, counter("diversion")], 0)
        np.testing.assert_array_equal(diverted[:, counter("product_transfer")], 0)
        self.assert_closes(r, direct)
        self.assert_closes(r, diverted)

    def test_checkpoint_restart_preserves_counter_offsets_and_trajectory(self):
        r = recipe()
        first = run(r, duration=20, water_valve=1)
        second_input = inputs(r, feed_kg_s=2, product_valve=1)
        resumed = model.simulate(r, [{"duration_s": 25, "input": second_input}], state=first["states"][-1])
        whole = model.simulate(r, [{"duration_s": 20, "input": inputs(r, water_valve=1)},
                                  {"duration_s": 25, "input": second_input}])
        np.testing.assert_array_equal(resumed["states"], whole["states"][40:])
        self.assertTrue(np.any(resumed["states"][0, 28:] > 0))
        self.assert_closes(r, resumed["states"])

    def test_non_grid_feed_event_integrates_exact_external_feed(self):
        r = recipe(empty=True)
        segments = [{"duration_s": .7, "input": inputs(r, feed_kg_s=3, activity=0)},
                    {"duration_s": 1.1, "input": inputs(r, feed_kg_s=0, activity=0)}]
        for method in ("rk4", "DOP853"):
            result = model.simulate(r, segments, method=method)
            np.testing.assert_allclose(result["times"], [0, .5, .7, 1.2, 1.7, 1.8], atol=1e-12)
            np.testing.assert_allclose(result["states"][-1, counter("feed")], [2.1, 0, 0, 0], atol=1e-12)
            self.assert_closes(r, result["states"])

    def test_unrecorded_mass_is_reported_as_nonclosure(self):
        r = recipe()
        states = run(r, duration=5)["states"]
        states[-1, 17] += .25
        check = model.closure(r, states)
        self.assertFalse(check["passed"])
        self.assertAlmostEqual(check["component_residual_kg"][1], -.25, delta=1e-9)

    def test_internal_transfer_error_fails_local_closure_even_when_total_still_closes(self):
        r = recipe()
        states = run(r, duration=5)["states"]
        states[-1, counter("oil_weir").start+1] += .25
        check = model.closure(r, states)
        self.assertAlmostEqual(check["total_residual_kg"], 0, delta=1e-9)
        self.assertFalse(check["passed"], "matching total mass cannot hide a wrong source/destination ledger")

    def test_packets_use_integrated_counters_and_keep_identity_across_restart(self):
        r = recipe()
        whole = run(r, duration=5)
        first = run(r, duration=2)
        resumed = run(r, duration=3, state=first["states"][-1])
        packets = model.interval_packets(r, whole)
        self.assertEqual(len(packets), 10*len(TRANSFER_NAMES))
        self.assertEqual(len({p["transfer_id"] for p in packets}), len(packets))
        combined = model.interval_packets(r, first) + model.interval_packets(r, resumed, time_origin_s=2)
        self.assertEqual(packets, combined)
        for name in TRANSFER_NAMES:
            selected = [p for p in packets if p["name"] == name]
            np.testing.assert_allclose(np.sum([p["component_mass_kg"] for p in selected], axis=0),
                                       whole["states"][-1, counter(name)], atol=1e-12)
            for packet in selected:
                duration = (packet["interval_end_sim_ms"]-packet["interval_start_sim_ms"])/1000
                np.testing.assert_allclose(np.array(packet["interval_mean_component_rate_kg_s"])*duration,
                                           packet["component_mass_kg"], atol=1e-12)
                self.assertTrue(packet["valid"])
        first_draw = next(p for p in packets if p["name"] == "water_draw")
        endpoint_draw = model.fluxes(r, whole["states"][1], inputs(r))["water_draw"]*.5
        self.assertGreater(np.max(np.abs(np.array(first_draw["component_mass_kg"])-endpoint_draw)), 1e-5,
                           "an endpoint rate must not replace a transferred interval mass")

    def test_packet_negative_roundoff_is_flagged_while_material_reversal_is_rejected(self):
        r = recipe()
        result = {"times": np.array([0.0, .5]),
                  "states": np.array([model.initial_state(r), model.initial_state(r)])}
        column = counter("product_dispatch").start
        tiny = r["numerics"]["negative_mass_tolerance_kg"]/2
        result["states"][1, column] = -tiny
        packet = next(p for p in model.interval_packets(r, result) if p["name"] == "product_dispatch")
        self.assertFalse(packet["valid"])
        self.assertEqual(packet["component_mass_kg"][0], -tiny, "roundoff is not erased")
        self.assertIsNotNone(packet["reason"])
        result["states"][1, column] = -2*r["numerics"]["negative_mass_tolerance_kg"]
        with self.assertRaisesRegex(ValueError, "NEGATIVE_MASS"):
            model.interval_packets(r, result)


class GeometryTests(unittest.TestCase):
    def test_initial_levels_are_derived_from_declared_component_volumes(self):
        r = recipe()
        state = model.initial_state(r)
        geom = model.geometry(r, state)
        expected = {"hw": 25, "ho": 30, "h1": 55, "h2": 50}
        self.assertEqual(set(geom["levels_percent"]), set(expected))
        for name, level in expected.items():
            self.assertAlmostEqual(geom["levels_percent"][name], level, delta=1e-12)
        self.assertAlmostEqual(geom["volumes_m3"]["product"], 6, delta=1e-12)
        state[4] += 80  # 0.1 m3 of A, not 0.08 m3 of water.
        changed = model.geometry(r, state)
        self.assertAlmostEqual(changed["levels_percent"]["hw"], 3.1/.12)

    def test_empty_sources_have_no_withdrawal_or_negative_inventory(self):
        r = recipe(empty=True)
        state = model.initial_state(r)
        flows = model.fluxes(r, state, inputs(r, feed_kg_s=0, water_valve=1, product_valve=1))
        for flow in flows.values():
            np.testing.assert_array_equal(flow, 0)
        states = run(r, duration=10, feed_kg_s=0, water_valve=1, product_valve=1)["states"]
        np.testing.assert_array_equal(states, 0)

    def test_competing_withdrawals_share_each_sources_available_material(self):
        r = recipe(empty=True)
        r["capacity_m3"] = {name: .01 for name in r["capacity_m3"]}
        r["initial_mass_kg"].update({"water": [0, 0, 11999, 0], "oil": [1, 1, 0, 0],
                                    "chamber2": [1, 1, 0, 0], "product": [1, 1, 0, 0]})
        state = model.initial_state(r)
        before = state.copy()
        flows = model.fluxes(r, state, inputs(r, feed_kg_s=0, water_valve=1, product_valve=1,
                                             weir_height_percent=30))
        np.testing.assert_array_equal(state, before)
        for i, name in enumerate(VESSELS[1:], 1):
            outgoing = sum((flows[t["name"]] for t in model.TRANSFERS if t["source"] == name), np.zeros(4))
            self.assertTrue(np.all(outgoing >= 0))
            self.assertTrue(np.all(outgoing <= state[4*i:4*i+4]/r["availability_time_s"] + 1e-10), name)
        states = run(r, duration=20, feed_kg_s=0, water_valve=1, product_valve=1,
                     weir_height_percent=30)["states"]
        self.assertGreaterEqual(states[:, :24].min(), -r["numerics"]["negative_mass_tolerance_kg"])
        AccountingTests().assert_closes(r, states)

    def test_capacity_excursion_is_retained_and_spills_into_external_reject(self):
        r = recipe(empty=True)
        r["initial_mass_kg"]["product"] = [0, 24000, 0, 0]  # 30 m3, capacity24.
        result = run(r, duration=20, feed_kg_s=0)
        states = result["states"]
        self.assertEqual(model.geometry(r, states[0])["volumes_m3"]["product"], 30)
        self.assertGreater(states[-1, counter("product_overflow")].sum(), 0)
        self.assertTrue(any(f["code"] == "CAPACITY_EXCEEDED" for f in model.findings(r, states)))
        AccountingTests().assert_closes(r, states)

    def test_weir_threshold_and_starvation_agree_with_refined_integration(self):
        r = recipe(empty=True)
        r["initial_mass_kg"].update({"water": [0, 0, 3601, 0], "oil": [1, 1, 0, 0],
                                    "chamber2": [1, 1, 0, 0]})
        kwargs = {"duration": 20, "feed_kg_s": 0, "water_valve": 1,
                  "product_valve": 1, "weir_height_percent": 30}
        candidate = run(r, **kwargs)
        half = run(r, step_s=.25, **kwargs)
        reference = run(r, method="DOP853", **kwargs)
        n = r["numerics"]
        for states in (candidate["states"], half["states"][::2]):
            np.testing.assert_allclose(states, reference["states"],
                                       atol=n["comparison_abs_kg"], rtol=n["comparison_rel"])
            self.assertGreaterEqual(states[:, :24].min(), -n["negative_mass_tolerance_kg"])
        self.assertLess(np.max(np.abs(half["states"][::2]-reference["states"])),
                        np.max(np.abs(candidate["states"]-reference["states"])))


class ValidationTests(unittest.TestCase):
    def test_invalid_checkpoint_state_is_rejected_without_repair(self):
        r = recipe()
        for column, value in ((0, math.nan), (3, math.inf), (4, -1),
                              (28, -1), (24, 1), (25, 1)):
            state = model.initial_state(r)
            state[column] = value
            original = state.copy()
            with self.subTest(column=column, value=value), self.assertRaises(ValueError):
                run(r, duration=1, state=state)
            np.testing.assert_array_equal(state, original)
        invalid = model.initial_state(r)
        invalid[0] = math.nan
        self.assertEqual(model.findings(r, [invalid])[0]["code"], "NONFINITE_STATE")
        with self.assertRaises(ValueError):
            model.closure(r, [invalid])
        with self.assertRaises(ValueError):
            run(r, duration=1, state=model.initial_state(r)[:40])
        valid = model.initial_state(r)
        mixed = valid.tolist()
        mixed[0] = True
        for malformed in (valid.astype(str), valid.astype(complex), np.zeros(96, dtype=bool), mixed):
            with self.subTest(dtype=np.asarray(malformed).dtype), self.assertRaises(ValueError):
                run(r, duration=1, state=malformed)

    def test_all_inputs_require_exact_keys_finite_values_and_envelope_bounds(self):
        r = recipe()
        for key, bounds in r["envelope"].items():
            for value in (math.nan, math.inf, -math.inf, True, bounds[0]-1, bounds[1]+1):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    model.validate_input(r, inputs(r, **{key: value}))
        wrong = inputs(r)
        del wrong["water_valve"]
        for values in (wrong, dict(inputs(r), hidden_fault=True)):
            with self.assertRaises(ValueError):
                model.validate_input(r, values)

    def test_gas_sentinel_cannot_hide_mass_in_liquid_phase(self):
        r = recipe()
        r["phase_assignment"]["oil"][3] = 1
        r["phase_assignment"]["gas"][3] = 0
        with self.assertRaises(ValueError):
            model.validate_recipe(r)
        r = recipe()
        r["initial_mass_kg"]["product"][3] = 1
        with self.assertRaises(ValueError):
            model.validate_recipe(r)
        r = recipe()
        state = model.initial_state(r)
        state[19] = 1
        with self.assertRaises(ValueError):
            run(r, state=state)

    def test_recipe_rejects_nonconservation_nonfinite_parameters_and_units(self):
        mutations = [lambda r: r["kinetics"].update(mass_yields=[0, .8, .2, .1]),
                     lambda r: r["units"].update(mass="m3"),
                     lambda r: r["geometry"].update(area1_m3_per_percent=0),
                     lambda r: r.update(availability_time_s=0),
                     lambda r: r["kinetics"].update(k_ref_s_inv=math.nan),
                     lambda r: r["liquid_specific_volume_m3_kg"].__setitem__(3, .1),
                     lambda r: r["feed_mass_fractions"].__setitem__(0, .9)]
        for mutate in mutations:
            r = recipe()
            mutate(r)
            with self.assertRaises(ValueError):
                model.validate_recipe(r)


if __name__ == "__main__":
    unittest.main()
