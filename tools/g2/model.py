# @artifact dev
"""Offline synthetic mass lumps. RESOURCES-7.37, 7.32, 7.48; no live imports.

Well-mixed compartments with first-order drains, prescribed temperature and
mass-conserving synthetic reaction yields. This is not fixed-bed chemistry or
an energy model. Numerical parameters belong to recipe.json, not the sources.
"""
from pathlib import Path
import json
import math

import numpy as np
from scipy.integrate import solve_ivp

INVENTORIES = ("reactor", "separator", "product", "offspec")
INPUT_KEYS = ("feed_kg_s", "temperature_k", "activity", "divert_fraction")


def _number(value, label, minimum=None, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: expected a finite number")
    if minimum is not None and value < minimum or positive and value <= 0:
        raise ValueError(f"{label}: outside allowed range")
    return value


def _vector(value, label, total=None):
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{label}: expected four mass components")
    for item in value:
        _number(item, label, minimum=0)
    if total is not None and not math.isclose(sum(value), total, abs_tol=1e-12, rel_tol=0):
        raise ValueError(f"{label}: must sum to {total}")


def validate_recipe(recipe):
    """Reject incomplete/invalid recipes before any calculation, without repair."""
    try:
        if recipe["schema"] != "g2-mass-lumps-v1" or recipe["components"] != ["A", "P", "W", "G"]:
            raise ValueError("unsupported material schema or component ordering")
        if recipe["units"] != {"mass": "kg", "time": "s", "temperature": "K", "feed": "kg/s"}:
            raise ValueError("recipe units must be kg, s, K, kg/s")
        _vector(recipe["feed_mass_fractions"], "feed fractions", 1)
        _number(recipe["feed_density_kg_m3"], "feed density", positive=True)
        k = recipe["kinetics"]
        _number(k["k_ref_s_inv"], "reference rate", minimum=0)
        _number(k["temperature_ref_k"], "reference temperature", positive=True)
        _number(k["activation_over_r_k"], "activation/R", minimum=0)
        _vector(k["mass_yields"], "mass yields", 1)
        if k["mass_yields"][0] != 0:
            raise ValueError("irreversible A reaction cannot yield A")
        for name in INVENTORIES:
            _number(recipe["residence_s"][name], name + " residence", positive=True)
            _number(recipe["capacity_kg"][name], name + " capacity", positive=True)
            _vector(recipe["initial_mass_kg"][name], name + " initial mass")
        for name in ("product", "water", "gas"):
            _vector(recipe["partition"][name], name + " partition")
        for i in range(4):
            if not math.isclose(sum(recipe["partition"][n][i] for n in ("product", "water", "gas")), 1, abs_tol=1e-12, rel_tol=0):
                raise ValueError("each component partition must sum to one")
        for key in ("max_a_mass_fraction", "max_w_mass_fraction"):
            if _number(recipe["quality"][key], key, minimum=0) > 1:
                raise ValueError("quality fraction must be at most one")
        _number(recipe["quality"]["minimum_inventory_kg"], "minimum inventory", positive=True)
        for key in ("transport_delay_s", "lag_s", "sample_period_s"):
            _number(recipe["analyzer"][key], key, minimum=0, positive=key != "transport_delay_s")
        for key in ("temperature_k", "feed_kg_s", "activity", "divert_fraction"):
            limits = recipe["envelope"][key]
            if not isinstance(limits, list) or len(limits) != 2:
                raise ValueError(f"invalid envelope: {key}")
            for value in limits:
                _number(value, key, minimum=0, positive=key == "temperature_k")
            if limits[0] > limits[1] or key in ("activity", "divert_fraction") and limits[1] > 1:
                raise ValueError(f"invalid envelope: {key}")
        for key in ("closure_abs_kg", "closure_rel", "reference_rtol", "reference_atol_kg", "reference_max_step_s", "comparison_abs_kg", "comparison_rel"):
            _number(recipe["tolerances"][key], key, positive=True)
    except (KeyError, TypeError) as exc:
        raise ValueError(f"incomplete recipe: {exc}") from exc
    return recipe


def load_recipe(path=None):
    return validate_recipe(json.loads(Path(path or Path(__file__).with_name("recipe.json")).read_text()))


def validate_input(recipe, values):
    if set(values) != set(INPUT_KEYS):
        raise ValueError("input must contain exactly " + ", ".join(INPUT_KEYS))
    for key in INPUT_KEYS:
        value = _number(values[key], key)
        low, high = recipe["envelope"][key]
        if not low <= value <= high:
            raise ValueError(f"MODEL_OUT_OF_ENVELOPE: {key}={value}, allowed [{low}, {high}]")
    return values


def rate_constant(recipe, temperature_k, activity):
    _number(temperature_k, "temperature K", positive=True)
    _number(activity, "activity", minimum=0)
    k = recipe["kinetics"]
    # Ratio of Arrhenius rates: RESOURCES-7.37. Activity is a synthetic multiplier.
    return activity * k["k_ref_s_inv"] * math.exp(-k["activation_over_r_k"] * (1 / temperature_k - 1 / k["temperature_ref_k"]))


def initial_state(recipe):
    return np.concatenate([np.asarray(recipe["initial_mass_kg"][n], dtype=float) for n in INVENTORIES] + [np.zeros(24)])


def derivative(recipe, state, values):
    """in - out + generation = accumulation, for each mass lump (7.37)."""
    y = np.asarray(state)
    tau = recipe["residence_s"]
    feed = np.asarray(recipe["feed_mass_fractions"]) * values["feed_kg_s"]
    reactor_out, separator_out = y[:4] / tau["reactor"], y[4:8] / tau["separator"]
    product_out, offspec_out = y[8:12] / tau["product"], y[12:16] / tau["offspec"]
    generation = np.asarray(recipe["kinetics"]["mass_yields"], dtype=float).copy()
    generation[0] = -1
    generation *= rate_constant(recipe, values["temperature_k"], values["activity"]) * y[0]
    oil = separator_out * recipe["partition"]["product"]
    water = separator_out * recipe["partition"]["water"]
    gas = separator_out * recipe["partition"]["gas"]
    diversion = values["divert_fraction"]
    return np.concatenate((feed - reactor_out + generation, reactor_out - separator_out,
                           (1 - diversion) * oil - product_out, diversion * oil - offspec_out,
                           feed, water, gas, product_out, offspec_out, generation))


def simulate(recipe, segments, method="rk4", step_s=0.5, rtol=None, atol=None, state=None):
    """Event-split integration; input is held over each declared segment.

    RK4 is the candidate, not the native simulator's integrator. DOP853 is the
    offline reference from SciPy (7.48). Neither is connected to live dynamics.
    """
    validate_recipe(recipe)
    _number(step_s, "step", positive=True)
    if method not in ("rk4", "DOP853"):
        raise ValueError("supported methods: rk4, DOP853")
    y = initial_state(recipe) if state is None else np.asarray(state, dtype=float).copy()
    if y.shape != (40,) or not np.isfinite(y).all():
        raise ValueError("state must contain 40 finite values")
    times, rows = [0.0], [y.copy()]
    now = 0.0
    for segment in segments:
        duration = _number(segment["duration_s"], "segment duration", positive=True)
        values = validate_input(recipe, segment["input"])
        count = math.ceil(duration / step_s)
        grid = np.minimum(np.arange(1, count + 1, dtype=float) * step_s, duration)
        fun = lambda t, v: derivative(recipe, v, values)
        if method == "DOP853":
            sol = solve_ivp(fun, (0, duration), y, method=method, t_eval=grid,
                           max_step=recipe["tolerances"]["reference_max_step_s"],
                           rtol=rtol if rtol is not None else recipe["tolerances"]["reference_rtol"],
                           atol=atol if atol is not None else recipe["tolerances"]["reference_atol_kg"])
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
                block.append(y.copy())
                previous = elapsed
        for elapsed, row in zip(grid, block):
            times.append(now + float(elapsed))
            rows.append(row.copy())
        y = rows[-1].copy()
        now += duration
    return {"times": np.asarray(times), "states": np.asarray(rows)}


def closure(recipe, states):
    """Include signed reaction generation; absolute floor also covers zero feed."""
    states = np.asarray(states)
    delta = states - states[0]
    inventory = delta[:, :16].reshape((-1, 4, 4)).sum(axis=1)
    outputs = delta[:, 20:36].reshape((-1, 4, 4)).sum(axis=1)
    residual = delta[:, 16:20] - outputs + delta[:, 36:40] - inventory
    total_residual = delta[:, 16:20].sum(axis=1) - outputs.sum(axis=1) - inventory.sum(axis=1)
    # Throughput scale remains meaningful while initial inventory drains.
    scale = np.maximum(1, np.abs(delta[:, 16:20]) + states[0, :16].reshape(4, 4).sum(axis=0))
    limits = recipe["tolerances"]["closure_abs_kg"] + recipe["tolerances"]["closure_rel"] * scale
    total_limits = recipe["tolerances"]["closure_abs_kg"] + recipe["tolerances"]["closure_rel"] * scale.sum(axis=1)
    return {"total_residual_kg": float(total_residual[-1]),
            "component_residual_kg": residual[-1].tolist(),
            "maximum_abs_component_residual_kg": float(np.max(np.abs(residual))),
            "maximum_abs_total_residual_kg": float(np.max(np.abs(total_residual))),
            "passed": bool(np.all(np.abs(residual) <= limits) and np.all(np.abs(total_residual) <= total_limits))}


def quality(recipe, masses):
    masses = np.asarray(masses, dtype=float)
    minimum = recipe["quality"]["minimum_inventory_kg"]
    if masses.shape != (4,) or not np.isfinite(masses).all() or np.any(masses < 0) or masses.sum() < minimum:
        return {"valid": False, "qualified": None, "a_mass_fraction": None, "w_mass_fraction": None}
    a, w = float(masses[0] / masses.sum()), float(masses[2] / masses.sum())
    return {"valid": True, "qualified": a <= recipe["quality"]["max_a_mass_fraction"] and w <= recipe["quality"]["max_w_mass_fraction"],
            "a_mass_fraction": a, "w_mass_fraction": w}


def findings(recipe, states):
    states = np.asarray(states)
    result = []
    if not np.isfinite(states).all():
        result.append({"code": "NONFINITE_STATE"})
    # Negative inventories/flow integrals are observations, never silently clipped.
    if np.min(states[:, :36]) < -recipe["tolerances"]["closure_abs_kg"]:
        result.append({"code": "NEGATIVE_MASS", "minimum_kg": float(np.min(states[:, :36]))})
    for i, name in enumerate(INVENTORIES):
        maximum = float(np.max(states[:, i * 4:i * 4 + 4].sum(axis=1)))
        if maximum > recipe["capacity_kg"][name]:
            result.append({"code": "CAPACITY_EXCEEDED", "inventory": name, "maximum_kg": maximum})
    return result


def analyzer(recipe, times, states):
    """A delayed, lagged, sampled observation of product truth (7.32).

    Offline resampling only. Prehistory equals the declared initial composition.
    Empty/invalid delayed inventory invalidates publication and holds the last
    numeric filter state. The first ever valid sample initializes the filter
    directly; reacquisition after a prior valid value resumes the declared lag.
    The input history and filter are not added to a native checkpoint.
    """
    times = np.asarray(times)
    if len(times) != len(states) or times[0] != 0 or np.any(np.diff(times) <= 0):
        raise ValueError("analyzer requires increasing times starting at zero")
    cfg = recipe["analyzer"]
    clock = cfg["sample_period_s"]
    if len(times) > 1:
        step = times[1] - times[0]
        if not np.allclose(np.diff(times), step, rtol=0, atol=1e-9):
            raise ValueError("analyzer requires a uniform observation grid")
        for period in (clock, cfg["transport_delay_s"]):
            if not math.isclose(period / step, round(period / step), abs_tol=1e-9):
                raise ValueError("observation grid must resolve analyzer delay and sample events exactly")
    truth = [quality(recipe, row[8:12]) for row in states]
    filtered = None if not truth[0]["valid"] else np.array([truth[0]["a_mass_fraction"], truth[0]["w_mass_fraction"]])
    readings, held, source_index = [], None, 0
    next_sample = 0.0
    for i, time in enumerate(times):
        # Integrate a piecewise-constant delayed truth over [previous, time).
        # Grid must resolve delay and sample events, rather than silently moving them.
        if i:
            prev = times[i - 1]
            idx = max(0, int(np.searchsorted(times, prev - cfg["transport_delay_s"] + 1e-10, side="right")) - 1)
            q = truth[idx]
            if q["valid"]:
                target = np.array([q["a_mass_fraction"], q["w_mass_fraction"]])
                filtered = target.copy() if filtered is None else target + (filtered - target) * math.exp(-(time - prev) / cfg["lag_s"])
        if time + 1e-9 >= next_sample:
            if not math.isclose(time, next_sample, abs_tol=1e-8):
                raise ValueError("output grid must include every analyzer sample time")
            source_index = max(0, int(np.searchsorted(times, time - cfg["transport_delay_s"] + 1e-10, side="right")) - 1)
            current = truth[source_index]
            if current["valid"] and filtered is None:
                filtered = np.array([current["a_mass_fraction"], current["w_mass_fraction"]])
            held = None if not current["valid"] or filtered is None else filtered.copy()
            next_sample += clock
        readings.append({"valid": held is not None,
                         "a_mass_fraction": None if held is None else float(held[0]),
                         "w_mass_fraction": None if held is None else float(held[1]),
                         "sample_source_time_s": float(times[source_index])})
    return readings
