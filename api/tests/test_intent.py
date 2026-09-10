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
