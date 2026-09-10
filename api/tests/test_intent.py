"""
Proof that api/intent.py resolves the right machine from a bare prompt.

Run:
    cd api && venv/bin/pytest tests/test_intent.py -q

The cases are written the way an operator types, including the ones that
must NOT resolve: an unresolvable prompt has to return None so /generate can
answer with an "intent" error rather than silently picking a machine.
"""

import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parent.parent

if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

import intent  # noqa: E402

CONVEYOR = "line1.conveyorA"
CHILLER = "plant.utilities.chiller1"

RESOLVES = [
    ("what's going on with the conveyor", CONVEYOR),
    ("is the belt still running?", CONVEYOR),
    ("Is motor 1 running right now?", CONVEYOR),
    ("are PLC1 and VFD1 still talking to us?", CONVEYOR),
    ("show me line 1", CONVEYOR),
    ("compressor running?", CHILLER),
    ("list all chiller alarms", CHILLER),
    ("refrigerant looks low, what should I be watching", CHILLER),
    ("condenser pressure keeps spiking", CHILLER),
    ("is the BMS gateway online?", CHILLER),
    ("trend chilled water supply and return temps", CHILLER),
]

# Prompts that must stay unresolved: no machine named, or both named.
UNRESOLVED = [
    "show me anything critical",
    "what's broken",
    "",
    "compare the conveyor and the chiller",
]


@pytest.mark.parametrize("prompt,expected", RESOLVES)
def test_resolves_expected_asset(prompt, expected):
    assert intent.resolve_asset_id(prompt) == expected, (
        f"{prompt!r} should resolve to {expected}"
    )


@pytest.mark.parametrize("prompt", UNRESOLVED)
def test_unresolvable_prompts_return_none(prompt):
    assert intent.resolve_asset_id(prompt) is None, (
        f"{prompt!r} should not resolve to any machine"
    )


# --------------------------------------------------------------------------
# Control-intent detection
# --------------------------------------------------------------------------

# Must be refused by the read-only gate.
CONTROL = [
    "I want to start the motor from here",
    "drop the compressor speed a bit",
    "stop the conveyor",
    "please reset that trip",
    "can I change the speed setpoint?",
    "how do I increase the belt speed",
    "give me a start button",
    "let me turn the compressor off",
    "add stop/start controls to this screen",
]

# Must NOT be refused: these only look like commands. Every one of these
# contains a control verb, and getting any of them wrong would refuse a
# perfectly normal monitoring request in front of a judge.
NOT_CONTROL = [
    "why did the line stop earlier?",              # asks about a past event
    "did someone hit the e-stop or open the door?",  # e-stop is a signal name
    "is motor 1 running right now?",
    "show me anything critical",
    "I need the motor status and any alarms for the conveyor on one screen",
    "compare supply vs return water temperature",
    "condenser pressure keeps spiking, give me what I need to keep an eye on it",
    "trend chilled water supply and return temps over the last hour",
    "was the compressor restarted overnight?",
]


@pytest.mark.parametrize("prompt", CONTROL)
def test_control_requests_are_detected(prompt):
    assert intent.control_request(prompt) is not None, (
        f"{prompt!r} asks to change the machine and must hit the read-only gate"
    )


@pytest.mark.parametrize("prompt", NOT_CONTROL)
def test_monitoring_requests_are_not_refused(prompt):
    assert intent.control_request(prompt) is None, (
        f"{prompt!r} is a monitoring request and must NOT be refused"
    )
