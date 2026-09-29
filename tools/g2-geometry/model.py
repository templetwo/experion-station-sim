# @artifact dev
"""Offline geometry reference; no native imports or live state.

RESOURCES-7.37 supplies balance/rate forms, RESOURCES-4.12 the registered
separator arrangement, and RESOURCES-7.48 the independent integrator. All
numerical assumptions are in the separately committed synthetic recipe.
"""
from pathlib import Path
import json
import math
from numbers import Real

import numpy as np
from scipy.integrate import solve_ivp


INVENTORIES = ("reactor", "water", "oil", "chamber2", "product", "offspec")
INPUT_KEYS = ("feed_kg_s", "temperature_k", "activity", "water_valve",
              "product_valve", "weir_height_percent", "divert_fraction")
TRANSFERS = tuple(dict(name=name, source=source, destination=destination) for name, source, destination in (
    ("feed", "external_feed", "reactor"),
    ("reactor_water", "reactor", "water"),
    ("reactor_oil", "reactor", "oil"),
    ("reactor_gas", "reactor", "external_gas"),
    ("water_draw", "water", "external_water"),
    ("oil_underflow", "oil", "external_water"),
    ("water_carry", "water", "chamber2"),
    ("oil_weir", "oil", "chamber2"),
    ("product_transfer", "chamber2", "product"),
    ("diversion", "chamber2", "offspec"),
    ("product_dispatch", "product", "external_product"),
    ("offspec_dispatch", "offspec", "external_offspec"),
    ("water_overflow", "water", "external_reject"),
    ("oil_overflow", "oil", "external_reject"),
    ("chamber2_overflow", "chamber2", "external_reject"),
    ("product_overflow", "product", "external_reject"),
    ("offspec_overflow", "offspec", "external_reject"),
))
SIZE = 96
INVENTORY_SLICES = {name: slice(4 * i, 4 * i + 4) for i, name in enumerate(INVENTORIES)}
GENERATION_SLICE = slice(24, 28)
TRANSFER_SLICES = {entry["name"]: slice(28 + 4 * i, 32 + 4 * i) for i, entry in enumerate(TRANSFERS)}
_INVENTORY_INDEX = {name: i for i, name in enumerate(INVENTORIES)}
_EXTERNAL_OUT = tuple(i for i, entry in enumerate(TRANSFERS) if entry["destination"] not in _INVENTORY_INDEX)
_INCIDENCE = np.zeros((len(INVENTORIES), len(TRANSFERS)))
for _i, _entry in enumerate(TRANSFERS):
    if _entry["source"] in _INVENTORY_INDEX:
        _INCIDENCE[_INVENTORY_INDEX[_entry["source"]], _i] -= 1
    if _entry["destination"] in _INVENTORY_INDEX:
        _INCIDENCE[_INVENTORY_INDEX[_entry["destination"]], _i] += 1
_INCIDENCE.setflags(write=False)


def transfer_slice(name):
    return TRANSFER_SLICES[name]


def _number(value, label, minimum=None, positive=False):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not math.isfinite(value):
        raise ValueError(f"{label}: expected a finite number")
    if (minimum is not None and value < minimum) or (positive and value <= 0):
        raise ValueError(f"{label}: outside allowed range")
    return value


def _vector(value, label, total=None):
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{label}: expected four component values")
    for item in value:
        _number(item, label, minimum=0)
    if total is not None and not math.isclose(sum(value), total, rel_tol=0, abs_tol=1e-12):
        raise ValueError(f"{label}: must sum to {total}")


def _keys(value, names, label):
    if not isinstance(value, dict) or set(value) != set(names):
        raise ValueError(f"{label}: expected exactly {', '.join(names)}")


def validate_recipe(recipe):
    """Validate the declared model; never repair, normalize or replace inputs."""
    try:
        if recipe["schema"] != "g2-geometry-v1" or recipe["components"] != ["A", "P", "W", "G"]:
            raise ValueError("unsupported recipe schema or component order")
        if recipe["units"] != {"mass": "kg", "time": "s", "temperature": "K", "volume": "m3", "flow": "m3/h"}:
            raise ValueError("recipe units must be kg, s, K, m3, m3/h")
        for name in ("id", "basis", "parameter_provenance", "gas_disposition"):
            if not isinstance(recipe[name], str) or not recipe[name].strip():
                raise ValueError(f"{name}: expected a nonempty declaration")
        _vector(recipe["feed_mass_fractions"], "feed fractions", 1)
        _number(recipe["feed_density_kg_m3"], "feed density", positive=True)
        specific = recipe["liquid_specific_volume_m3_kg"]
        _vector(specific, "liquid specific volumes")
        if any(v <= 0 for v in specific[:3]) or specific[3] != 0:
            raise ValueError("A/P/W require positive specific volumes; G requires the zero routing sentinel")
        phase = recipe["phase_assignment"]
        _keys(phase, ("water", "oil", "gas"), "phase assignment")
        for name in phase:
            _vector(phase[name], name + " phase assignment")
        for i in range(4):
            if not math.isclose(sum(phase[name][i] for name in phase), 1, rel_tol=0, abs_tol=1e-12):
                raise ValueError("each component phase assignment must sum to one")
        if phase["water"][3] != 0 or phase["oil"][3] != 0 or phase["gas"][3] != 1:
            raise ValueError("G must route entirely to the external gas sink, never a liquid inventory")
        kinetics = recipe["kinetics"]
        _number(kinetics["k_ref_s_inv"], "reference rate", minimum=0)
        _number(kinetics["temperature_ref_k"], "reference temperature", positive=True)
        _number(kinetics["activation_over_r_k"], "activation/R", minimum=0)
        _vector(kinetics["mass_yields"], "mass yields", 1)
        if kinetics["mass_yields"][0] != 0:
            raise ValueError("irreversible A consumption cannot yield A")
        _number(recipe["reactor"]["reference_holdup_kg"], "reactor reference holdup", positive=True)
        expected_law = "component_out_kg_s = feed_kg_s * reactor_component_kg / reference_holdup_kg; zero feed isolates reactor material while reaction can continue"
        if recipe["reactor"]["outlet_law"] != expected_law:
            raise ValueError("unsupported reactor outlet law")
        geometry_values = recipe["geometry"]
        for name in ("area1_m3_per_percent", "area2_m3_per_percent", "carry_band_percent", "thin_band_percent"):
            _number(geometry_values[name], name, positive=True)
        for name in ("water_draw_m3h", "product_draw_m3h", "weir_m3h_per_percent_1_5"):
            _number(geometry_values[name], name, minimum=0)
        _keys(recipe["capacity_m3"], ("chamber1", "chamber2", "product", "offspec"), "capacities")
        for name, value in recipe["capacity_m3"].items():
            _number(value, name + " capacity", positive=True)
        for name in ("overflow_time_s", "availability_time_s"):
            _number(recipe[name], name, positive=True)
        _keys(recipe["tank_dispatch_time_s"], ("product", "offspec"), "dispatch times")
        for name, value in recipe["tank_dispatch_time_s"].items():
            _number(value, name + " dispatch time", positive=True)
        _keys(recipe["initial_mass_kg"], INVENTORIES, "initial inventories")
        for name, masses in recipe["initial_mass_kg"].items():
            _vector(masses, name + " initial mass")
            if name != "reactor" and masses[3] != 0:
                raise ValueError("G_IN_LIQUID: initial " + name)
        for name in ("max_a_mass_fraction", "max_w_mass_fraction"):
            if _number(recipe["quality"][name], name, minimum=0) > 1:
                raise ValueError(name + ": expected a mass fraction at most one")
        _number(recipe["quality"]["minimum_inventory_kg"], "minimum quality inventory", positive=True)
        analyzer = recipe["analyzer"]
        _number(analyzer["transport_delay_s"], "analyzer delay", minimum=0)
        for name in ("lag_s", "sample_period_s"):
            _number(analyzer[name], name, positive=True)
        if analyzer["location"] != "receiving product tank" or analyzer["basis"] != "mass fractions A and W":
            raise ValueError("unsupported analyzer location or basis")
        _keys(recipe["envelope"], INPUT_KEYS, "input envelope")
        for name, limits in recipe["envelope"].items():
            if not isinstance(limits, list) or len(limits) != 2:
                raise ValueError(name + ": expected lower and upper envelope limits")
            for value in limits:
                _number(value, name + " limit", minimum=0, positive=name == "temperature_k")
            if limits[0] > limits[1] or name in ("water_valve", "product_valve", "divert_fraction") and limits[1] > 1:
                raise ValueError(name + ": invalid envelope")
        for name in ("candidate_step_s", "refined_step_s", "reference_rtol", "reference_atol_kg", "reference_max_step_s",
                     "closure_abs_kg", "closure_rel", "comparison_abs_kg", "comparison_rel", "negative_mass_tolerance_kg"):
            _number(recipe["numerics"][name], name, positive=True)
        for name in ("breach_hold_s", "baseline_hold_s"):
            _number(recipe["acceptance"][name], name, positive=True)
        for name in ("minimum_heat_loss_conversion_drop", "minimum_flow_conversion_gain"):
            if _number(recipe["acceptance"][name], name, minimum=0) > 1:
                raise ValueError(name + ": expected a fraction at most one")
        # The rate must remain finite throughout the declared temperature/activity envelope.
        rate_constant(recipe, recipe["envelope"]["temperature_k"][1], recipe["envelope"]["activity"][1])
    except (KeyError, TypeError, OverflowError) as exc:
        raise ValueError(f"incomplete or invalid recipe: {exc}") from exc
    return recipe


def load_recipe(path=None):
    return validate_recipe(json.loads(Path(path or Path(__file__).with_name("recipe.json")).read_text()))


def validate_input(recipe, values):
    _keys(values, INPUT_KEYS, "input")
    for name in INPUT_KEYS:
        value = _number(values[name], name)
        low, high = recipe["envelope"][name]
        if not low <= value <= high:
            raise ValueError(f"MODEL_OUT_OF_ENVELOPE: {name}={value}, allowed [{low}, {high}]")
    return values


def rate_constant(recipe, temperature_k, activity):
    _number(temperature_k, "temperature K", positive=True)
    _number(activity, "activity", minimum=0)
    p = recipe["kinetics"]
    if activity == 0 or p["k_ref_s_inv"] == 0:
        return 0.0
    try:
        result = activity * p["k_ref_s_inv"] * math.exp(-p["activation_over_r_k"] * (1 / temperature_k - 1 / p["temperature_ref_k"]))
    except OverflowError as exc:
        raise ValueError("NONFINITE_RATE: Arrhenius rate overflow") from exc
    if not math.isfinite(result):
        raise ValueError("NONFINITE_RATE: Arrhenius rate")
    return result


def _state(recipe, state, check_counters=True):
    try:
        raw = np.asarray(state)
        if raw.dtype.kind not in "iuf" or (isinstance(state, (list, tuple)) and any(isinstance(v, (bool, np.bool_)) for v in state)):
            raise ValueError("state values must be real numbers, not booleans or strings")
        y = raw.astype(float, copy=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("state must contain 96 finite real values") from exc
    if y.shape != (SIZE,) or not np.isfinite(y).all():
        raise ValueError("NONFINITE_STATE or invalid shape: expected 96 finite values")
    tolerance = recipe["numerics"]["negative_mass_tolerance_kg"]
    if np.min(y[:24]) < -tolerance:
        raise ValueError(f"NEGATIVE_MASS: inventory minimum {float(np.min(y[:24]))} kg")
    if np.any(y[7:24:4] != 0):
        raise ValueError("G_IN_LIQUID: G cannot be hidden by a zero liquid specific volume")
    if check_counters:
        if np.min(y[28:]) < -tolerance:
            raise ValueError("NEGATIVE_MASS: cumulative transfer")
        if y[24] > tolerance or np.min(y[25:28]) < -tolerance:
            raise ValueError("invalid signed reaction-generation ledger")
        limit = recipe["numerics"]["closure_abs_kg"] + recipe["numerics"]["closure_rel"] * max(1, float(np.abs(y[24:28]).sum()))
        if abs(float(y[24:28].sum())) > limit:
            raise ValueError("reaction-generation ledger does not conserve total mass")
    return y


def initial_state(recipe):
    validate_recipe(recipe)
    y = np.zeros(SIZE)
    for name, interval in INVENTORY_SLICES.items():
        y[interval] = recipe["initial_mass_kg"][name]
    return _state(recipe, y).copy()


def _volume_data(recipe, y):
    volumes = y[:24].reshape(6, 4)[1:] @ np.asarray(recipe["liquid_specific_volume_m3_kg"])
    p = recipe["geometry"]
    hw, ho, h2 = volumes[0] / p["area1_m3_per_percent"], volumes[1] / p["area1_m3_per_percent"], volumes[2] / p["area2_m3_per_percent"]
    return volumes, (hw, ho, h2)


def geometry(recipe, state):
    y = _state(recipe, state)
    volumes, (hw, ho, h2) = _volume_data(recipe, y)
    return {"volumes_m3": {"water": float(volumes[0]), "oil": float(volumes[1]), "chamber1": float(volumes[0] + volumes[1]),
                            "chamber2": float(volumes[2]), "product": float(volumes[3]), "offspec": float(volumes[4])},
            "levels_percent": {"hw": float(hw), "ho": float(ho), "h1": float(hw + ho), "h2": float(h2)}}


def _rates(recipe, y, values):
    """Every entry is kg/s; liquid request equations are converted from m3/h."""
    _state(recipe, y, check_counters=False)
    masses = y[:24].reshape(6, 4)
    specific = np.asarray(recipe["liquid_specific_volume_m3_kg"])
    volumes, (hw, ho, h2) = _volume_data(recipe, y)
    p, cap = recipe["geometry"], recipe["capacity_m3"]
    rates = np.zeros((len(TRANSFERS), 4))
    rates[0] = values["feed_kg_s"] * np.asarray(recipe["feed_mass_fractions"])
    reactor_out = values["feed_kg_s"] * masses[0] / recipe["reactor"]["reference_holdup_kg"]
    for index, phase in enumerate(("water", "oil", "gas"), start=1):
        rates[index] = reactor_out * recipe["phase_assignment"][phase]
    clip = lambda value: min(1.0, max(0.0, value))
    water_draw = p["water_draw_m3h"] * values["water_valve"] * math.sqrt(max(0, hw) / 50) / 3600
    water_carry = float(rates[1] @ specific) * clip((hw - (values["weir_height_percent"] - p["carry_band_percent"])) / p["carry_band_percent"])
    oil_underflow = water_draw * clip((p["thin_band_percent"] - hw) / p["thin_band_percent"])
    oil_weir = p["weir_m3h_per_percent_1_5"] * max(0, hw + ho - values["weir_height_percent"]) ** 1.5 / 3600
    product_draw = p["product_draw_m3h"] * values["product_valve"] * math.sqrt(max(0, h2) / 50) / 3600
    total1 = float(volumes[0] + volumes[1])
    excess1 = max(0, total1 - cap["chamber1"]) / recipe["overflow_time_s"]
    water_overflow = excess1 * volumes[0] / total1 if total1 > 0 else 0.0
    oil_overflow = excess1 * volumes[1] / total1 if total1 > 0 else 0.0
    over = [max(0, volumes[i] - cap[name]) / recipe["overflow_time_s"]
            for i, name in ((2, "chamber2"), (3, "product"), (4, "offspec"))]

    def withdraw(inventory_index, requests):
        volume = float(volumes[inventory_index - 1])
        total = sum(q for _, q in requests)
        if volume <= 0 or total == 0:
            return
        if not math.isfinite(total) or total < 0:
            raise ValueError("NONFINITE_FLOW or negative requested withdrawal")
        factor = min(1.0, volume / (recipe["availability_time_s"] * total))
        density_vector = masses[inventory_index] / volume
        for index, requested in requests:
            rates[index] = density_vector * (requested * factor)

    # One shared availability limit per donor, including overflow and dispatch.
    withdraw(1, ((4, water_draw), (6, water_carry), (12, water_overflow)))
    withdraw(2, ((5, oil_underflow), (7, oil_weir), (13, oil_overflow)))
    diversion = values["divert_fraction"]
    withdraw(3, ((8, product_draw * (1 - diversion)), (9, product_draw * diversion), (14, over[0])))
    withdraw(4, ((10, volumes[3] / recipe["tank_dispatch_time_s"]["product"]), (15, over[1])))
    withdraw(5, ((11, volumes[4] / recipe["tank_dispatch_time_s"]["offspec"]), (16, over[2])))
    if not np.isfinite(rates).all():
        raise ValueError("NONFINITE_FLOW: component transfer")
    return rates


def fluxes(recipe, state, values):
    validate_recipe(recipe)
    validate_input(recipe, values)
    rates = _rates(recipe, _state(recipe, state), values)
    return {entry["name"]: rates[i].copy() for i, entry in enumerate(TRANSFERS)}


def _derivative(recipe, y, values, k):
    rates = _rates(recipe, y, values)
    result = np.zeros(SIZE)
    result[:24] = (_INCIDENCE @ rates).reshape(24)
    generation = np.asarray(recipe["kinetics"]["mass_yields"], dtype=float).copy()
    generation[0] = -1
    generation *= k * y[0]
    result[:4] += generation
    result[GENERATION_SLICE] = generation
    result[28:] = rates.reshape(-1)
    if not np.isfinite(result).all():
        raise ValueError("NONFINITE_STATE: derivative")
    return result


def derivative(recipe, state, values):
    validate_recipe(recipe)
    validate_input(recipe, values)
    return _derivative(recipe, _state(recipe, state), values, rate_constant(recipe, values["temperature_k"], values["activity"]))


def simulate(recipe, segments, method="rk4", step_s=0.5, state=None, rtol=None, atol=None):
    """Restart each input segment; preserve all cumulative counters on resume.

    Negative inventories beyond the declared tolerance and nonfinite states
    fail, including integrator trial stages. No values are clipped or repaired.
    Capacity thresholds instead have explicit finite-time overflow transfers.
    """
    validate_recipe(recipe)
    _number(step_s, "step", positive=True)
    if method not in ("rk4", "DOP853"):
        raise ValueError("supported methods: rk4, DOP853")
    rtol = recipe["numerics"]["reference_rtol"] if rtol is None else _number(rtol, "rtol", positive=True)
    atol = recipe["numerics"]["reference_atol_kg"] if atol is None else _number(atol, "atol", positive=True)
    y = initial_state(recipe) if state is None else _state(recipe, state).copy()
    times, rows, now = [0.0], [y.copy()], 0.0
    for segment in segments:
        if not isinstance(segment, dict) or set(segment) != {"duration_s", "input"}:
            raise ValueError("segment must contain duration_s and input")
        duration = _number(segment["duration_s"], "segment duration", positive=True)
        values = validate_input(recipe, segment["input"])
        count = math.ceil(duration / step_s)
        grid = np.arange(1, count + 1, dtype=float) * step_s
        grid = grid[grid < duration]
        grid = np.append(grid, duration)
        k = rate_constant(recipe, values["temperature_k"], values["activity"])
        fun = lambda t, v: _derivative(recipe, v, values, k)
        if method == "DOP853":
            sol = solve_ivp(fun, (0, duration), y, method="DOP853", t_eval=grid, rtol=rtol, atol=atol,
                           max_step=recipe["numerics"]["reference_max_step_s"])
            if not sol.success:
                raise RuntimeError(sol.message)
            block = sol.y.T
        else:
            block, previous = [], 0.0
            for elapsed in grid:
                dt = elapsed - previous
                k1 = fun(previous, y)
                k2 = fun(previous + dt / 2, y + dt * k1 / 2)
                k3 = fun(previous + dt / 2, y + dt * k2 / 2)
                k4 = fun(elapsed, y + dt * k3)
                y = y + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
                _state(recipe, y)
                block.append(y.copy())
                previous = elapsed
        for elapsed, row in zip(grid, block):
            _state(recipe, row)
            if np.min(row[28:] - rows[-1][28:]) < -recipe["numerics"]["negative_mass_tolerance_kg"]:
                raise ValueError("NEGATIVE_MASS: a cumulative transfer decreased")
            times.append(now + float(elapsed))
            rows.append(row.copy())
        y = rows[-1].copy()
        now += duration
    return {"times": np.asarray(times), "states": np.asarray(rows)}


def _history(states, finite=True):
    raw = np.asarray(states)
    if raw.dtype.kind not in "iuf":
        raise ValueError("history must contain real numeric values")
    array = raw.astype(float, copy=False)
    if array.ndim != 2 or array.shape[1] != SIZE or len(array) == 0:
        raise ValueError("expected a nonempty history with 96 columns")
    if finite and not np.isfinite(array).all():
        raise ValueError("NONFINITE_STATE: history")
    return array


def closure(recipe, states):
    """Audit external and local balances against integrated transfer counters."""
    states = _history(states)
    delta = states - states[0]
    inventory = delta[:, :24].reshape(-1, 6, 4)
    transfers = delta[:, 28:].reshape(-1, len(TRANSFERS), 4)
    incoming = transfers[:, 0]
    outgoing = transfers[:, _EXTERNAL_OUT].sum(axis=1)
    generation = delta[:, GENERATION_SLICE]
    residual = incoming - outgoing + generation - inventory.sum(axis=1)
    total_residual = incoming.sum(axis=1) - outgoing.sum(axis=1) - inventory.sum(axis=(1, 2))
    local = np.einsum("ij,tjk->tik", _INCIDENCE, transfers) - inventory
    local[:, 0] += generation
    initial = states[0, :24].reshape(6, 4)
    p = recipe["numerics"]
    scale = np.maximum(1, incoming + initial.sum(axis=0) + np.abs(generation))
    limit = p["closure_abs_kg"] + p["closure_rel"] * scale
    total_limit = p["closure_abs_kg"] + p["closure_rel"] * np.maximum(1, incoming.sum(axis=1) + initial.sum())
    local_scale = np.maximum(1, np.einsum("ij,tjk->tik", np.abs(_INCIDENCE), np.abs(transfers)) + initial)
    local_scale[:, 0] += np.abs(generation)
    local_limit = p["closure_abs_kg"] + p["closure_rel"] * local_scale
    # Total external discharge cannot exceed initial inventory plus feed.
    # Components have an additional signed reaction-generation term.
    bound_excess = outgoing - (initial.sum(axis=0) + incoming + generation)
    total_bound_excess = outgoing.sum(axis=1) - (initial.sum() + incoming.sum(axis=1))
    bounds_passed = bool(np.all(bound_excess <= limit) and np.all(total_bound_excess <= total_limit))
    return {"total_residual_kg": float(total_residual[-1]), "component_residual_kg": residual[-1].tolist(),
            "maximum_abs_component_residual_kg": float(np.max(np.abs(residual))),
            "maximum_abs_total_residual_kg": float(np.max(np.abs(total_residual))),
            "maximum_abs_inventory_residual_kg": float(np.max(np.abs(local))),
            "inventory_component_residual_kg": {name: local[-1, i].tolist() for i, name in enumerate(INVENTORIES)},
            "external_mass_bound_passed": bounds_passed,
            "maximum_external_mass_bound_excess_kg": float(max(0, np.max(total_bound_excess))),
            "passed": bool(np.all(np.abs(residual) <= limit) and np.all(np.abs(total_residual) <= total_limit)
                           and np.all(np.abs(local) <= local_limit) and bounds_passed)}


def findings(recipe, states):
    states = _history(states, finite=False)
    result = []
    if not np.isfinite(states).all():
        return [{"code": "NONFINITE_STATE", "severity": "error"}]
    minimum = float(min(np.min(states[:, :24]), np.min(states[:, 28:])))
    if minimum < -recipe["numerics"]["negative_mass_tolerance_kg"]:
        result.append({"code": "NEGATIVE_MASS", "severity": "error", "minimum_kg": minimum})
    if np.any(states[:, 7:24:4] != 0):
        result.append({"code": "G_IN_LIQUID", "severity": "error"})
    volumes = states[:, :24].reshape(-1, 6, 4)[:, 1:] @ np.asarray(recipe["liquid_specific_volume_m3_kg"])
    for name, volume, transfers in (("chamber1", volumes[:, 0] + volumes[:, 1], ("water_overflow", "oil_overflow")),
                                    ("chamber2", volumes[:, 2], ("chamber2_overflow",)),
                                    ("product", volumes[:, 3], ("product_overflow",)),
                                    ("offspec", volumes[:, 4], ("offspec_overflow",))):
        maximum = float(np.max(volume))
        capacity = recipe["capacity_m3"][name]
        if maximum > capacity:
            counter_mass = sum(float((states[-1, transfer_slice(n)] - states[0, transfer_slice(n)]).sum()) for n in transfers)
            result.append({"code": "CAPACITY_EXCEEDED", "severity": "note", "inventory": name,
                           "maximum_volume_m3": maximum, "capacity_m3": capacity,
                           "maximum_excess_volume_m3": maximum - capacity,
                           "overflow_transfers": list(transfers), "overflow_counter_kg": counter_mass,
                           "policy": "finite-time overflow to external_reject; capacity is a threshold, never a hard clamp"})
    return result


def interval_packets(recipe, result, time_origin_s=0.0):
    """Emit integrated mass, never draw reconstructed from post-step levels.

    time_origin_s lets a caller retain absolute interval IDs across a resumed
    history. Tiny negative roundoff is preserved and marked invalid, not clipped.
    """
    validate_recipe(recipe)
    _number(time_origin_s, "time origin", minimum=0)
    times = np.asarray(result["times"], dtype=float)
    states = _history(result["states"])
    if times.ndim != 1 or len(times) != len(states) or not np.isfinite(times).all() or times[0] != 0 or np.any(np.diff(times) <= 0):
        raise ValueError("packet times must increase from zero and match the history")
    for state in states:
        _state(recipe, state)
    packets = []
    for i, dt in enumerate(np.diff(times)):
        start_ms, end_ms = 1000 * (time_origin_s + times[i]), 1000 * (time_origin_s + times[i + 1])
        for entry in TRANSFERS:
            mass = states[i + 1, transfer_slice(entry["name"])] - states[i, transfer_slice(entry["name"])]
            if float(np.min(mass)) < -recipe["numerics"]["negative_mass_tolerance_kg"]:
                raise ValueError("NEGATIVE_MASS: integrated interval transfer")
            valid = bool(np.all(mass >= 0))
            packets.append({"schema": "g2-geometry-transfer-v1", "recipe_id": recipe["id"],
                            "transfer_id": f"{entry['name']}:{float(start_ms)!r}:{float(end_ms)!r}",
                            "name": entry["name"], "source": entry["source"], "destination": entry["destination"],
                            "interval_start_sim_ms": float(start_ms), "interval_end_sim_ms": float(end_ms),
                            "components": list(recipe["components"]), "component_mass_kg": mass.tolist(),
                            "interval_mean_component_rate_kg_s": (mass / dt).tolist(),
                            "valid": valid, "reason": None if valid else "NEGATIVE_TRANSFER_WITHIN_NUMERICAL_TOLERANCE"})
    return packets
