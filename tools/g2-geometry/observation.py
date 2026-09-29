# @artifact dev
"""Offline receiving-tank observations; never used to define material truth."""
import math

import numpy as np


PRODUCT = slice(16, 20)


def quality(recipe, masses):
    """Assess the declared A/W mass limits, with empty/invalid inventory unknown."""
    masses = np.asarray(masses, dtype=float)
    limits = recipe["quality"]
    with np.errstate(over="ignore", invalid="ignore"):
        total = masses.sum()
    if (masses.shape != (4,) or not np.all(np.isfinite(masses))
            or not np.isfinite(total) or np.any(masses < 0) or total < limits["minimum_inventory_kg"]):
        return {"valid": False, "qualified": None,
                "a_mass_fraction": None, "w_mass_fraction": None}
    a, water = float(masses[0] / total), float(masses[2] / total)
    return {"valid": True,
            "qualified": a <= limits["max_a_mass_fraction"] and water <= limits["max_w_mass_fraction"],
            "a_mass_fraction": a, "w_mass_fraction": water}


def analyzer(recipe, times, states):
    """Delay, filter and sample product truth on an explicitly resolved grid.

    Prehistory is the initial composition. First-ever valid truth initializes
    the filter; an invalid interval holds its numeric state and invalidates
    publication at the next sample. Reacquisition resumes the lag from that
    held state. Values and source times are held between samples. This batch
    observer owns no native checkpoint state and never changes inventory.
    """
    times, states = np.asarray(times, dtype=float), np.asarray(states, dtype=float)
    if (times.ndim != 1 or len(times) == 0 or not np.all(np.isfinite(times))
            or times[0] != 0 or np.any(np.diff(times) <= 0)
            or states.shape != (len(times), 96)):
        raise ValueError("analyzer requires 96-state histories and increasing finite times starting at zero")
    cfg = recipe["analyzer"]
    delay, lag, period = (cfg[key] for key in ("transport_delay_s", "lag_s", "sample_period_s"))
    if (any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
            for v in (delay, lag, period)) or delay < 0 or lag <= 0 or period <= 0):
        raise ValueError("invalid analyzer timing")
    step = times[1] - times[0] if len(times) > 1 else period
    if not np.allclose(np.diff(times), step, rtol=0, atol=1e-9):
        raise ValueError("analyzer requires a uniform observation grid")
    if len(times) > 1 and any((v > 0 and round(v / step) < 1)
                              or not math.isclose(v / step, round(v / step), rel_tol=0, abs_tol=1e-9)
                              for v in (delay, period)):
        raise ValueError("observation grid must resolve analyzer delay and sample events exactly")
    delay_steps, sample_steps = round(delay / step), max(1, round(period / step))
    truth = [quality(recipe, row[PRODUCT]) for row in states]

    def fractions(index):
        q = truth[index]
        return np.array([q["a_mass_fraction"], q["w_mass_fraction"]]) if q["valid"] else None

    filtered, held, source_index = fractions(0), None, 0
    readings = []
    for i, time in enumerate(times):
        if i:
            # The delayed input is piecewise constant on [previous, current).
            target = fractions(max(0, i - 1 - delay_steps))
            if target is not None:
                filtered = (target.copy() if filtered is None else
                            target + (filtered - target) * math.exp(-(time - times[i - 1]) / lag))
        if i % sample_steps == 0:
            source_index = max(0, i - delay_steps)
            target = fractions(source_index)
            if target is None:
                held = None
            else:
                if filtered is None:
                    filtered = target.copy()
                held = filtered.copy()
        readings.append({"valid": held is not None,
                         "a_mass_fraction": None if held is None else float(held[0]),
                         "w_mass_fraction": None if held is None else float(held[1]),
                         "sample_source_time_s": float(times[source_index])})
    return readings
