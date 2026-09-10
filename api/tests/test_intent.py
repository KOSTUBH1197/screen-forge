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
    # The four Kostubh listed as "must still be refused". The last one is why
    # alarm words only count as an interface object for navigation verbs:
    # you open alarms to look at them, you reset one to change the machine.
    "I want to start the motor from here",
    "drop the compressor speed a bit",
    "stop the conveyor",
    "can you reset the high temperature alarm",
    "open the discharge valve",
    "close the bypass valve",
    "set the speed setpoint to 50",
    # The verb sits in a later clause, after a preamble.
    "the motor is off, start it",
    "someone hit the e-stop, now start the motor",
    "check the temp and then stop the belt",
    # Regression: "e stop" as a bare substring also sits inside "let m|e stop|"
    # and "pleas|e stop|". Stripping it there used to delete the verb and let
    # a real control request through.
    "let me stop the belt",
    "please stop the motor",
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
    # The six Kostubh verified as wrongly refused. "can you show me when the
    # compressor will start" is the odd one out: the object check doesn't save
    # it (the object IS the compressor), but "show me ... when ... will" makes
    # it a question about the machine, not an instruction to it.
    "open the chiller overview",
    "set up a screen for the conveyor alarms",
    "turn on the trend view for condenser pressure",
    "close up view of motor 1",
    "lower half of the screen should show alarms",
    "can you show me when the compressor will start",
    # Every control verb is also an ordinary verb for working a SCREEN. These
    # all used to be refused: the object, not the verb, is what decides.
    "open the conveyor screen",
    "open up the trend for temperature",
    "open alarms for the conveyor",
    "can I open the chiller overview?",
    "set the panel to large",
    "reset the view",
    "close the alarm banner",
    "turn to the chiller page",
    "start monitoring the chiller",
    "stop showing me the comms tiles",
    "drop the trend off this screen",
    "increase the size of the gauge",
    "show me alarms and open the trend",
    "temperature has been creeping up all shift, show me how it is trended",
    "belt speed and pressure please, big numbers",
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
