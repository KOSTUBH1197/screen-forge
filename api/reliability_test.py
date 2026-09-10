"""
Reliability test for the spec generator, against the REAL LLM.

Runs a fixed list of realistic operator prompts through
generator.generate_and_validate() -- real network calls, real cost, no mocks --
and reports how many produced a valid screen spec and why the rest failed.

Run (from the repo root or from api/):
    python api/reliability_test.py

Needs OPENAI_API_KEY or GROQ_API_KEY in the environment or in api/.env
(gitignored). generator.llm_provider() decides which one is used, and the
report records it. Writes api/reliability_report.json so runs can be diffed.

How retries are counted: generate_and_validate() does not report how many LLM
calls it made, but it accepts llm_fn. We pass a thin wrapper that increments a
counter and then calls the real generator._call_llm unchanged, so the count is
observed, not guessed. 1 call = passed or failed on the first attempt;
2 calls = the internal retry ran.

Rate limits: a provider's per-minute quota (HTTP 429) says nothing about the
model's reliability, so the wrapper waits and re-sends that same call instead
of letting it count as an "llm" failure. Waits are recorded per prompt.
"""

import json
import math
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

API_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(API_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(API_DIR / ".env")

import openai  # noqa: E402

import generator  # noqa: E402

REPORT_PATH = API_DIR / "reliability_report.json"
PASS_RATE_REQUIRED = 0.8  # the sprint gate: >= 16 of 20
RATE_LIMIT_MAX_WAITS = 8
RATE_LIMIT_DEFAULT_WAIT_S = 20.0

CONVEYOR = "line1.conveyorA"
CHILLER = "plant.utilities.chiller1"

# (prompt, asset_id, panel_class, intent). Written the way operators actually
# type, not tuned to be easy. "stress" prompts don't map cleanly onto one
# component, ask for something the registry can't show, or imply control.
PROMPTS = [
    # --- Conveyor A ---
    ("Is motor 1 running right now?", CONVEYOR, "small", "status"),
    ("I need the motor status and any alarms for the conveyor on one screen", CONVEYOR, "large", "status+alarms"),
    ("temperature has been creeping up all shift, show me how it's trended", CONVEYOR, "medium", "trend"),
    ("are the PLC and the drive still talking to us?", CONVEYOR, "small", "comms"),
    ("what's going on with the conveyor", CONVEYOR, "medium", "vague"),
    ("show me anything critical", CONVEYOR, "small", "vague"),
    ("belt speed and pressure please, big numbers", CONVEYOR, "large", "status"),
    ("I want to start the motor from here", CONVEYOR, "small", "stress: implies control"),
    ("why did the line stop earlier?", CONVEYOR, "large", "stress: history/root cause"),
    ("did someone hit the e-stop or open the door?", CONVEYOR, "medium", "stress: signals not in tags"),
    # --- Chiller 1 ---
    ("compressor running?", CHILLER, "small", "status"),
    ("list all chiller alarms", CHILLER, "medium", "alarms"),
    ("chiller overview: compressor status, pressures and alarms", CHILLER, "large", "status+alarms"),
    ("trend chilled water supply and return temps over the last hour", CHILLER, "medium", "trend"),
    ("is the BMS gateway online? check the VFD comms too", CHILLER, "large", "comms"),
    ("is everything ok with the chiller", CHILLER, "small", "vague"),
    ("refrigerant looks low, what should I be watching", CHILLER, "medium", "stress: open-ended"),
    ("condenser pressure keeps spiking, give me what I need to keep an eye on it", CHILLER, "large", "stress: open-ended"),
    ("compare supply vs return water temperature", CHILLER, "small", "stress: derived value"),
    ("drop the compressor speed a bit", CHILLER, "medium", "stress: implies control"),
]


def describe_components(spec: dict) -> list[str]:
    """Short 'type(binding)' strings so the report shows what the model built."""
    out = []
    for c in spec.get("components", []):
        binding = c.get("bind_tag") or c.get("bind_device") or c.get("bind_asset") or ",".join(c.get("bind_alarms") or [])
        out.append(f"{c.get('type')}({binding})")
    return out


def _retry_after_seconds(error: openai.RateLimitError) -> float:
    try:
        return max(1.0, float(error.response.headers.get("retry-after")))
    except (AttributeError, TypeError, ValueError):
        return RATE_LIMIT_DEFAULT_WAIT_S


def run_one(prompt: str, asset_id: str, panel_class: str) -> dict:
    llm_calls = 0
    rate_limit_waits = 0

    def counting_llm(system_prompt: str, user_prompt: str) -> dict:
        nonlocal llm_calls, rate_limit_waits
        llm_calls += 1
        for wait in range(RATE_LIMIT_MAX_WAITS + 1):
            try:
                return generator._call_llm(system_prompt, user_prompt)  # the real network call
            except openai.RateLimitError as e:
                # A request bigger than the whole per-minute quota never fits; waiting won't help.
                if wait == RATE_LIMIT_MAX_WAITS or "Request too large" in str(e):
                    raise
                delay = _retry_after_seconds(e)
                rate_limit_waits += 1
                print(f"        (rate limited by provider, waiting {delay:.0f}s and re-sending the same call)", flush=True)
                time.sleep(delay)
        raise AssertionError("unreachable")

    started = time.monotonic()
    try:
        spec, error = generator.generate_and_validate(prompt, asset_id, panel_class, llm_fn=counting_llm)
    except Exception as e:  # the pipeline is supposed to return errors, not raise
        spec, error = None, {"stage": "uncaught_exception", "message": f"{type(e).__name__}: {e}", "field": None}
    elapsed = round(time.monotonic() - started, 2)

    success = spec is not None
    return {
        "success": success,
        "stage": None if success else error.get("stage"),
        "error_message": None if success else error.get("message"),
        "llm_calls": llm_calls,
        "retry_needed_to_succeed": (llm_calls > 1) if success else None,
        "rate_limit_waits": rate_limit_waits,
        "seconds": elapsed,
        "components": describe_components(spec) if success else None,
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")

    try:
        provider, model = generator.llm_provider()
    except RuntimeError as e:
        print(f"{e}, then re-run.")
        print("This test deliberately makes real LLM calls; it cannot run without a key.")
        return 2

    total = len(PROMPTS)
    required = math.ceil(PASS_RATE_REQUIRED * total)
    print(f"ScreenForge reliability test: {total} prompts, provider {provider}, model {model}, real LLM calls\n", flush=True)

    results = []
    for i, (prompt, asset_id, panel_class, intent) in enumerate(PROMPTS, start=1):
        outcome = run_one(prompt, asset_id, panel_class)
        results.append({"n": i, "prompt": prompt, "asset_id": asset_id, "panel_class": panel_class, "intent": intent, **outcome})
        status = "PASS" if outcome["success"] else f"FAIL [{outcome['stage']}]"
        calls = f"{outcome['llm_calls']} call{'s' if outcome['llm_calls'] != 1 else ''}"
        print(f"[{i:2}/{total}] {status:<22} {asset_id:<26} {panel_class:<6} {calls}, {outcome['seconds']}s  \"{prompt}\"", flush=True)

    passed = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    pass_rate = len(passed) / total
    meets = len(passed) >= required
    by_stage = Counter(r["stage"] for r in failed)
    first_try = sum(1 for r in passed if not r["retry_needed_to_succeed"])
    waits = sum(r["rate_limit_waits"] for r in results)

    print("\n" + "=" * 78)
    print(f"MEETS THRESHOLD (>= {required}/{total})" if meets else f"BELOW THRESHOLD, needs work (need >= {required}/{total})")
    print(f"{len(passed)} / {total} produced a valid spec ({pass_rate:.0%} pass rate)  [{provider}: {model}]")
    print(f"Passed on the first LLM call: {first_try}; passed only after the internal retry: {len(passed) - first_try}")
    if failed:
        print("Failures by stage: " + ", ".join(f"{n} failed at {stage}" for stage, n in by_stage.most_common()))
    else:
        print("Failures by stage: none")
    if waits:
        print(f"Provider rate-limit waits during the run: {waits} (calls were re-sent, not counted as failures)")
    print("=" * 78)

    if failed:
        print("\nFAILING PROMPTS (full error text):")
        for r in failed:
            print(f"\n#{r['n']} [{r['asset_id']}, {r['panel_class']}, {r['intent']}] after {r['llm_calls']} LLM call(s)")
            print(f"  prompt: \"{r['prompt']}\"")
            print(f"  stage:  {r['stage']}")
            print(f"  error:  {r['error_message']}")

    report = {
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provider": provider,
        "model": model,
        "summary": {
            "total": total,
            "passed": len(passed),
            "pass_rate": round(pass_rate, 3),
            "required_to_pass": required,
            "meets_threshold": meets,
            "passed_after_retry": len(passed) - first_try,
            "failures_by_stage": dict(by_stage),
            "rate_limit_waits": waits,
        },
        "results": results,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nFull results saved to {REPORT_PATH}")
    return 0 if meets else 1


if __name__ == "__main__":
    sys.exit(main())
