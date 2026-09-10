"""
Spec generator -- turns an operator's plain-English prompt into a validated
screen specification.

Pipeline:
  1. Retrieve the machine context for the requested asset (dropping "io" --
     see note below).
  2. Build a system prompt containing the rules + 3 golden few-shot examples.
  3. Call the LLM using OpenAI's Structured Outputs (strict JSON-schema mode)
     so the SHAPE of the response is almost guaranteed correct.
  4. Strip null binding fields (strict mode requires every field present,
     so the model emits bind_tag/bind_alarms/bind_device/bind_asset every
     time, three of them null).
  5. Run the cleaned candidate through the real validator (the same one
     used everywhere else -- this function never trusts the LLM's output
     on its own).
  6. If invalid, retry ONCE, appending the validator's error to the prompt
     so the model can see exactly what it got wrong.
  7. If still invalid, give up and return the error. Never return a spec
     that didn't pass validation, no matter how close it looks.

Why "io" is deliberately left out of what the model sees: none of the six
component types bind to raw I/O signals (Emergency_Stop, Door_Switch, etc)
-- only to tags, alarms, and comms devices. Including "io" would only give
the model more surface area to hallucinate an invalid binding from, for
zero benefit.
"""

import json
import os
from pathlib import Path

from openai import OpenAI

import context_store
import validator

MODEL_NAME = "gpt-4o-mini"

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "contracts" / "fixtures"
SCREEN_SPEC_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "contracts" / "screen-spec.schema.json"

_GOLDEN_FIXTURE_NAMES = [
    "spec.golden.status-alarms.json",
    "spec.golden.trend.json",
    "spec.golden.comms.json",
]

COMPONENT_TYPES = ["alarm_banner", "status_indicator", "gauge", "trend", "nav_tile", "comms_health"]

# A strict-mode-compatible schema. Every property must be listed in
# "required" (that's a Structured Outputs requirement, not a design choice)
# -- optional-in-spirit fields are made "nullable" instead of actually
# optional. This is NOT the same file as contracts/screen-spec.schema.json;
# that one enforces the real business rules (exactly one binding per type)
# via if/then, which strict mode does not support. This schema only has to
# get the SHAPE right; the real schema + validator.py enforce correctness.
GENERATION_SCHEMA = {
    "type": "object",
    "required": ["screen_id", "title", "asset_id", "context_version", "components", "permissions"],
    "additionalProperties": False,
    "properties": {
        "screen_id": {"type": "string"},
        "title": {"type": "string"},
        "asset_id": {"type": "string"},
        "context_version": {"type": "string"},
        "components": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "type", "priority", "size_hint", "min_panel",
                             "bind_tag", "bind_alarms", "bind_device", "bind_asset"],
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": COMPONENT_TYPES},
                    "priority": {"type": "integer"},
                    "size_hint": {"type": "string", "enum": ["compact", "medium", "wide"]},
                    "min_panel": {"type": ["string", "null"], "enum": ["small", "medium", "large", None]},
                    "bind_tag": {"type": ["string", "null"]},
                    "bind_alarms": {"type": ["array", "null"], "items": {"type": "string"}},
                    "bind_device": {"type": ["string", "null"]},
                    "bind_asset": {"type": ["string", "null"]},
                },
            },
        },
        "permissions": {
            "type": "object",
            "required": ["mode"],
            "additionalProperties": False,
            "properties": {"mode": {"type": "string", "enum": ["read_only"]}},
        },
    },
}


def _load_golden_examples() -> list[dict]:
    examples = []
    for name in _GOLDEN_FIXTURE_NAMES:
        with open(FIXTURES_DIR / name) as f:
            examples.append(json.load(f))
    return examples


def _context_for_prompt(asset_id: str) -> dict:
    """The machine context, with 'io' deliberately dropped -- see module docstring."""
    ctx = context_store.get_context(asset_id)
    return {k: v for k, v in ctx.items() if k != "io"}


def _build_system_prompt() -> str:
    examples_text = "\n\n".join(
        f"Example {i+1}:\n{json.dumps(ex, indent=2)}"
        for i, ex in enumerate(_load_golden_examples())
    )
    return f"""You generate HMI screen specifications for an industrial operator interface.

RULES (violating any of these makes the spec unusable):
- Output ONLY a JSON object. No prose, no markdown code fences, no explanation.
- Every component's binding fields (bind_tag, bind_alarms, bind_device, bind_asset) must all
  be present in your output, but exactly ONE of them should be non-null for each component.
  Set the other three to null.
- alarm_banner components must use bind_alarms (a list of alarm ids). Never bind_tag.
- comms_health components must use bind_device (a device name from the context's comms list).
- nav_tile components must use bind_asset. You will rarely need this component.
- status_indicator, gauge, and trend components must use bind_tag (a single tag name).
- Every tag name, alarm id, or device name you reference MUST come from the machine context
  you are given. Never invent one, even if a plausible-sounding name would fit the request.
- permissions.mode must always be "read_only".
- Never include position, coordinate, width, height, color, or font fields. Only priority,
  size_hint, and min_panel control layout, and the renderer computes layout from those --
  not you.
- priority: 1 is most important/urgent. If the request implies urgency (an alarm, a fault),
  that component should get priority 1.
- size_hint: "wide" means the component always takes a full row to itself, on every panel
  size. "compact" means it wants minimal space. "medium" is the default for most components.
- min_panel: set to "medium" only if the component genuinely needs more room than a 7" panel
  offers (e.g. a trend chart). Otherwise use "small" or leave it appropriate for a compact view.
- context_version in your output must exactly match the context_version given to you below.
- screen_id should be a short unique-looking string, e.g. "gen_<short-random-string>".

Here are 3 correct, real examples showing exactly the shape and style expected:

{examples_text}
"""


def _strip_nulls(spec: dict) -> dict:
    """
    Remove null-valued binding fields from every component, so the cleaned
    spec matches the real contracts/screen-spec.schema.json shape (which
    does not expect the other three binding fields to be present at all,
    let alone null).
    """
    cleaned = dict(spec)
    cleaned["components"] = [
        {k: v for k, v in comp.items() if v is not None}
        for comp in spec.get("components", [])
    ]
    return cleaned


def _call_llm(system_prompt: str, user_prompt: str) -> dict:
    """
    Real call to OpenAI using Structured Outputs. Requires OPENAI_API_KEY
    to be set in the environment (see .env.example).
    """
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "screen_specification",
                "schema": GENERATION_SCHEMA,
                "strict": True,
            },
        },
    )
    return json.loads(response.choices[0].message.content)


def generate_and_validate(prompt: str, asset_id: str, panel_class: str, llm_fn=_call_llm) -> tuple[dict | None, dict | None]:
    """
    Full pipeline: call the LLM, clean it, validate it, retry once on
    failure with the error appended, then give up.

    llm_fn is injectable so tests can run this whole pipeline without a
    real network call -- production code should never need to pass it.

    Returns (spec, None) on success, or (None, error_dict) on failure,
    where error_dict matches the agreed /generate error shape:
        { "message": str, "stage": str, "field": str | None }
    """
    ctx = _context_for_prompt(asset_id)
    system_prompt = _build_system_prompt()
    base_user_prompt = (
        f"Operator request: \"{prompt}\"\n"
        f"Target panel class: {panel_class}\n"
        f"Machine context:\n{json.dumps(ctx, indent=2)}"
    )

    for attempt in range(2):  # first attempt + one retry
        user_prompt = base_user_prompt
        try:
            raw = llm_fn(system_prompt, user_prompt)
        except Exception as e:
            return None, {"message": f"LLM call failed: {e}", "stage": "llm", "field": None}

        cleaned = _strip_nulls(raw)
        result = validator.validate_spec(cleaned)

        if result.valid:
            return cleaned, None

        if attempt == 0:
            # Retry once, appending the validator's own error text so the
            # model can see exactly what it got wrong.
            base_user_prompt = (
                base_user_prompt
                + "\n\nYour previous attempt was rejected for this reason:\n"
                + "\n".join(result.errors)
                + "\nFix this specific problem and try again."
            )
            continue

        # Second attempt also failed -- give up honestly.
        return None, {
            "message": "; ".join(result.errors) if result.errors else "Generated spec failed validation.",
            "stage": result.failed_layer,
            "field": None,
        }

    # Unreachable, but keeps type checkers happy.
    return None, {"message": "Unknown generation failure.", "stage": "other", "field": None}