"""
Tag simulator.

Produces plausible live values for every tag in a machine context, without
any real hardware. This is the honest stand-in for a real PLC connection --
we say so openly in the pitch (see the project brief, Part 13).

How it behaves:
  - bool tags: usually stay put, occasionally flip (like a motor starting
    or stopping).
  - analog tags: drift slowly within a "normal" band around a baseline, and
    every so often take a bigger excursion outside that band -- which is
    what should trip an alarm on the HMI side.

State is kept in memory, per asset_id, so values drift smoothly across
repeated calls instead of jumping around randomly every time someone asks.
"""

import random
import time

import context_store

# Reasonable normal-operating baselines per tag name, used only by the
# simulator (a real PLC wouldn't need this -- it would just report reality).
# unit is informational only, taken from the tag's own definition.
# excursion_swing is a magnitude with a direction: a POSITIVE value can jump
# either way, a NEGATIVE one only ever falls. Refrigerant level is the reason
# the distinction exists -- "low refrigerant" is the interesting story, and a
# tank that spontaneously fills itself isn't one.
_BASELINES = {
    "Conveyor_Speed_SP": {"baseline": 1.2, "normal_swing": 0.05, "excursion_chance": 0.03, "excursion_swing": 0.4},
    "Temperature_PV": {"baseline": 45.0, "normal_swing": 1.5, "excursion_chance": 0.05, "excursion_swing": 20.0},
    "Pressure_Sensor": {"baseline": 3.2, "normal_swing": 0.1, "excursion_chance": 0.05, "excursion_swing": 2.0},
    "Chilled_Water_Supply_Temp": {"baseline": 7.0, "normal_swing": 0.3, "excursion_chance": 0.03, "excursion_swing": 5.0},
    "Chilled_Water_Return_Temp": {"baseline": 12.0, "normal_swing": 0.3, "excursion_chance": 0.03, "excursion_swing": 5.0},
    "Condenser_Pressure": {"baseline": 9.0, "normal_swing": 0.2, "excursion_chance": 0.05, "excursion_swing": 3.0},
    "Evaporator_Pressure": {"baseline": 4.0, "normal_swing": 0.15, "excursion_chance": 0.03, "excursion_swing": 1.5},
    # Lower excursion_chance than the others on purpose: a fall of 40 takes
    # roughly 8 steps to recover from, so at 0.05 the level would settle near
    # 45 and ALM_LR01 would simply be on for good. At 0.015 it sits near
    # baseline and dips below the alarm threshold now and then, which is the
    # behaviour worth showing.
    "Refrigerant_Level_PV": {"baseline": 85.0, "normal_swing": 2.0, "excursion_chance": 0.015, "excursion_swing": -40.0},
}

# Fallback for any analog tag we didn't hand-tune above (e.g. health tags
# treated as analog by mistake, or a tag added later) -- keeps the demo from
# crashing if someone adds a tag without updating this file.
_DEFAULT_ANALOG = {"baseline": 50.0, "normal_swing": 2.0, "excursion_chance": 0.02, "excursion_swing": 10.0}

# Physical limits, keyed by the tag's own unit rather than its name, so a tag
# that appears at runtime (the Phase 4 context bump adds one) is bounded
# without anyone editing this file. None means "no limit in that direction";
# degC is deliberately absent because chilled water legitimately goes below
# zero, while a percentage or a pressure below zero is a simulator bug.
_UNIT_LIMITS: dict[str, tuple[float | None, float | None]] = {
    "%": (0.0, 100.0),
    "bar": (0.0, None),
    "kpa": (0.0, None),
    "psi": (0.0, None),
    "m/s": (0.0, None),
    "rpm": (0.0, None),
    "hz": (0.0, None),
}


def _clamp_to_unit(value: float, unit: str | None) -> float:
    """Hold a value inside what its unit can physically mean."""
    low, high = _UNIT_LIMITS.get((unit or "").strip().lower(), (None, None))
    if low is not None:
        value = max(low, value)
    if high is not None:
        value = min(high, value)
    return value

# Bool tags representing "is this machine currently running normally" should
# start True (running) so a demo doesn't open with a false trip alarm already
# active. Bool tags representing an operator command (Start/Stop buttons)
# should start False (nothing commanded yet). Anything else defaults to False.
_BOOL_STARTS_TRUE = {"Motor_1_RunStatus", "Compressor_RunStatus"}

# Which alarm ids are currently "active" is computed from a simple threshold
# per alarm, evaluated against the tag named in that alarm's own definition
# (alarm["tag"] in the machine context). This lives here, not in contracts/,
# because it's purely a simulator concern -- a real PLC would already know
# whether its own alarm is active; we have to fake that decision ourselves.
_ALARM_CONDITIONS = {
    "ALM_HT01": lambda v: v > 60,      # High Temperature
    "ALM_LP01": lambda v: v < 2.0,     # Low Pressure
    "ALM_MT01": lambda v: v is False,  # Motor Trip (tripped = not running)
    "ALM_HP01": lambda v: v > 11,      # High Condenser Pressure
    "ALM_LR01": lambda v: v < 60,      # Low Refrigerant Level
    "ALM_CT01": lambda v: v is False,  # Compressor Trip (tripped = not running)
}

# In-memory "current value" state, per asset_id -> tag name -> value.
_STATE: dict[str, dict[str, float | bool]] = {}


def _init_state_for_asset(asset_id: str) -> None:
    ctx = context_store.get_context(asset_id)
    state = {}
    for tag in ctx["tags"]:
        if tag["type"] == "bool":
            if "Health" in tag["name"] or tag["name"] in _BOOL_STARTS_TRUE:
                state[tag["name"]] = True
            else:
                state[tag["name"]] = False
        else:
            profile = _BASELINES.get(tag["name"], _DEFAULT_ANALOG)
            state[tag["name"]] = profile["baseline"]
    _STATE[asset_id] = state


def _evaluate_alarms(ctx: dict, state: dict) -> dict[str, bool]:
    """
    Return { alarm_id: True/False } for every alarm defined on this asset,
    by checking the current value of that alarm's bound tag against a
    threshold condition. An alarm with no known condition defaults to
    inactive rather than crashing -- a missing condition should never take
    down the /tags endpoint.
    """
    alarm_states = {}
    for alarm in ctx["alarms"]:
        tag_name = alarm["tag"]
        current_value = state.get(tag_name)
        condition = _ALARM_CONDITIONS.get(alarm["id"])
        if condition is None or current_value is None:
            alarm_states[alarm["id"]] = False
        else:
            alarm_states[alarm["id"]] = bool(condition(current_value))
    return alarm_states


def _step_bool(current: bool, tag_name: str) -> bool:
    # Health tags: rarely flip (a comms dropout should be a rare, noticeable
    # event, not constant flapping).
    flip_chance = 0.01 if "Health" in tag_name else 0.03
    if random.random() < flip_chance:
        return not current
    return current


def _step_analog(current: float, tag_name: str, unit: str | None = None) -> float:
    profile = _BASELINES.get(tag_name, _DEFAULT_ANALOG)
    swing = profile["excursion_swing"]
    if random.random() < profile["excursion_chance"]:
        # A bigger jump -- this is what should trip an alarm. A negative
        # excursion_swing falls only; a positive one can go either way.
        if swing < 0:
            current -= abs(swing)
        else:
            current += random.choice([-1, 1]) * swing
    else:
        # Normal small drift.
        current += random.uniform(-1, 1) * profile["normal_swing"]
    # Pull gently back toward baseline so it doesn't wander off forever.
    current += (profile["baseline"] - current) * 0.05
    return round(_clamp_to_unit(current, unit), 2)


def get_live_values(asset_id: str) -> dict:
    """
    Return the current simulated value for every tag belonging to asset_id,
    advancing the simulation by one step. Initializes state on first call
    for a given asset.
    """
    if asset_id not in _STATE:
        _init_state_for_asset(asset_id)

    ctx = context_store.get_context(asset_id)
    state = _STATE[asset_id]

    for tag in ctx["tags"]:
        name = tag["name"]
        if tag["type"] == "bool":
            state[name] = _step_bool(state[name], name)
        else:
            state[name] = _step_analog(state[name], name, tag.get("unit"))

    return {
        "asset_id": asset_id,
        "context_version": ctx["context_version"],
        "timestamp": time.time(),
        "tags": dict(state),
        "alarms": _evaluate_alarms(ctx, state),
    }