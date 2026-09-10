"""
Intent parsing for operator prompts -- everything we work out about a request
BEFORE any LLM call.

Two questions:
  1. Which machine is the operator talking about? (resolve_asset_id)
     /web offers a "detect machine from request" option that sends
     asset_id: null, and this answers it from the words in the prompt.
  2. Is the operator asking us to CHANGE something rather than watch it?
     (control_request) The MVP is read-only, so such a request must be
     answered with an explanation, not with a quiet monitoring screen.

Deliberately keyword/pattern-based, not model-based: it runs in
microseconds, it never fails open, and when it can't tell it says so
instead of guessing. A wrong guess here would silently build a screen for
the wrong machine, which is worse than asking the operator to name the
asset.
"""

import re

# (asset_id, keywords). Every keyword is matched case-insensitively as a
# plain substring of the prompt. Keywords are drawn from what an operator
# would actually type for that machine -- its name, its major equipment, and
# the tag/comms vocabulary unique to it. Words shared by both machines
# ("motor" on its own, "vfd", "temperature", "pressure") are deliberately
# absent: they would make every prompt ambiguous.
ASSET_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    (
        "line1.conveyorA",
        ("conveyor", "belt", "motor 1", "motor1", "motor_1", "line 1", "line1",
         "plc1", "vfd1"),
    ),
    (
        "plant.utilities.chiller1",
        ("chiller", "compressor", "refrigerant", "condenser", "evaporator",
         "chilled water", "chilled_water", "bms"),
    ),
]


def resolve_asset_id(prompt: str) -> str | None:
    """
    Best-effort asset_id for a prompt that didn't name one.

    Returns the asset_id whose keywords appear most often in the prompt, or
    None when nothing matches or two machines tie -- callers must treat None
    as "ask the operator", never as a default.
    """
    text = (prompt or "").lower()

    scores = [
        (asset_id, sum(1 for keyword in keywords if keyword in text))
        for asset_id, keywords in ASSET_KEYWORDS
    ]
    ranked = sorted(scores, key=lambda pair: pair[1], reverse=True)

    best_asset, best_score = ranked[0]
    if best_score == 0:
        return None
    if len(ranked) > 1 and ranked[1][1] == best_score:
        # Two machines matched equally well -- genuinely ambiguous.
        return None
    return best_asset


# --------------------------------------------------------------------------
# Control-intent detection (the read-only gate's trigger)
# --------------------------------------------------------------------------

# Verbs that mean "change the machine", as opposed to "show me the machine".
_CONTROL_VERBS = (
    r"(?:start|stop|restart|set|change|adjust|increase|decrease|raise|lower|"
    r"drop|bump|open|close|reset|enable|disable|turn|override|ramp|jog|"
    r"speed up|slow down)"
)

# Phrases where a control verb is a NOUN naming a signal, not an action being
# requested. Removed from the text before matching, so "did someone hit the
# e-stop or open the door?" doesn't read as a command -- while "hit the e-stop
# then start the motor" still does.
#
# Anchored on word boundaries, NOT plain substrings: "e stop" as a substring
# also sits inside "let m|e stop| the belt" and "pleas|e stop| the motor",
# and stripping it there deletes the verb and silently lets a real control
# request through.
_NOT_A_COMMAND = re.compile(r"\b(?:e[-\s]?stop|emergency\s+stop)\b", re.IGNORECASE)

# Every control verb above is also an ordinary verb for working a SCREEN:
# you open an overview, close a banner, set a panel size, reset a view. What
# separates the two is the object -- "open the valve" acts on the machine,
# "open the chiller overview" just navigates. So when the thing being acted on
# is part of the interface, it isn't a control request.
_VIEW_OBJECTS = (
    "screen", "view", "overview", "page", "dashboard", "display", "panel",
    "layout", "trend", "chart", "graph", "banner", "tile", "gauge", "widget",
    "summary", "zoom", "alarm", "alarms", "comms", "readout",
)

# "start monitoring the chiller", "stop showing me the comms tiles" -- a
# control verb followed by a viewing verb is still just viewing.
_VIEW_GERUNDS = (
    "monitoring", "showing", "displaying", "watching", "tracking", "trending",
    "viewing", "looking",
)

# How far past the verb to look for its object.
_OBJECT_WINDOW = 40

# A control verb alone is not enough: "why did the line stop earlier?" asks
# about an event, it doesn't ask us to stop anything. What marks a real
# control request is the FRAME around the verb -- an imperative opening, or
# the operator saying they want to do it.
# Patterns built around a control VERB. These are the ambiguous ones, so a
# match only counts once the object has been checked (see control_request).
_VERB_PATTERNS = [
    # Imperative: a clause begins with the command itself. Not just the start
    # of the prompt -- "the motor is off, start it" and "..., now stop the
    # belt" are the same request with a preamble.
    rf"(?:^|[,;.]\s*|\b(?:now|then|and)\s+)(?:please\s+)?{_CONTROL_VERBS}\b",
    # Someone stating they want to act, or asking whether they may.
    #   "I want to start the motor from here", "can I reset that trip?"
    rf"\b(?:i want to|i need to|i'd like to|i would like to|let me|"
    rf"allow me to|can i|could i|may i|how do i|how can i|can you|"
    rf"could you|can we|we need to|i should be able to)\b"
    rf"[^.?!]{{0,40}}?\b{_CONTROL_VERBS}\b",
]

# Patterns that name a control AFFORDANCE outright: "give me a start button",
# "add stop/start controls to this screen". These aren't verb-ambiguous, so
# they skip the object check -- a start button is a control even though it
# lives on a screen, and object-checking them would read "...to this screen"
# as evidence that it isn't one.
_AFFORDANCE_PATTERNS = [
    rf"\b{_CONTROL_VERBS}\s+button\b",
    r"\bbutton to\s+\w+",
    r"\b(?:give me|add|put|include)\b[^.?!]{0,30}\bcontrols?\b",
]

_COMPILED_VERB_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _VERB_PATTERNS]
_COMPILED_AFFORDANCE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _AFFORDANCE_PATTERNS]


def _acts_on_the_interface(text: str, verb_end: int) -> bool:
    """
    True when the object just after a control verb is part of the SCREEN
    rather than part of the machine -- "open the chiller overview" as opposed
    to "open the discharge valve".
    """
    tail = text[verb_end:verb_end + _OBJECT_WINDOW]
    words = re.findall(r"[a-z]+", tail)
    return any(word in _VIEW_OBJECTS or word in _VIEW_GERUNDS for word in words)


def control_request(prompt: str) -> str | None:
    """
    Return the phrase that reads as a request to CHANGE the machine, or None
    when the prompt is just asking to see it.

    The returned phrase is quoted back to the operator so the refusal names
    what it's refusing, rather than being a generic "not allowed".

    When it's a close call this deliberately answers None. Refusing a genuine
    viewing request is the worse error: it breaks normal use in front of a
    judge, while a missed control request costs only the explanation -- the
    read-only guarantee itself is structural (the spec vocabulary has no write
    component, and validator.py rejects any binding to a write-access tag).
    """
    text = _NOT_A_COMMAND.sub(" ", (prompt or "").lower())

    # Asking for a control affordance is unambiguous -- no object check.
    for pattern in _COMPILED_AFFORDANCE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(0).strip()

    # A control verb only counts if it acts on the machine, not the screen.
    for pattern in _COMPILED_VERB_PATTERNS:
        for match in pattern.finditer(text):
            if _acts_on_the_interface(text, match.end()):
                continue  # this one is about the screen; keep looking
            return match.group(0).strip()
    return None
