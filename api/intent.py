"""
Intent parsing for operator prompts -- everything we work out about a request
BEFORE any LLM call.

Right now that means one question: which machine is the operator talking
about? /web offers a "detect machine from request" option that sends
asset_id: null, and this module answers it from the words in the prompt.

Deliberately keyword-based, not model-based: it runs in microseconds, it
never fails open, and when it can't tell it says so instead of guessing. A
wrong guess here would silently build a screen for the wrong machine, which
is worse than asking the operator to name the asset.
"""

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
