"""
Context store.

Loads every machine-context JSON file from contracts/fixtures/ once, at
startup, and keeps them in a plain Python dict in memory, keyed by asset_id.

Why load once instead of reading the file every time someone asks?
Because these files don't change during a demo (until the "machine change
adaptation" feature bumps a context_version later) -- so re-reading disk on
every request would just be slower for no benefit.
"""

import json
from pathlib import Path

# This assumes api/ and contracts/ are siblings inside the repo root, e.g.:
#   repo-root/
#     contracts/fixtures/*.json
#     api/context_store.py   <- this file
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "contracts" / "fixtures"

# The filename pattern for machine contexts (not screen specs -- those also
# live in this folder, so we filter by prefix).
CONTEXT_FILE_PREFIX = "context."


class ContextNotFoundError(Exception):
    """Raised when someone asks for an asset_id we don't have a context for."""
    pass


def _load_all_contexts() -> dict:
    """
    Scan contracts/fixtures/ for every file starting with 'context.', load
    it as JSON, and return a dict keyed by that context's asset_id.
    """
    contexts = {}
    if not FIXTURES_DIR.exists():
        raise FileNotFoundError(
            f"Fixtures folder not found at {FIXTURES_DIR}. "
            "Check that contracts/fixtures/ exists relative to the api/ folder."
        )

    for file_path in sorted(FIXTURES_DIR.glob(f"{CONTEXT_FILE_PREFIX}*.json")):
        with open(file_path, "r") as f:
            data = json.load(f)
        asset_id = data["asset_id"]
        contexts[asset_id] = data

    return contexts


# Loaded exactly once, when this module is first imported (i.e. when the
# FastAPI app starts up).
_CONTEXTS = _load_all_contexts()


def list_asset_ids() -> list[str]:
    """Return every asset_id we currently have a context for."""
    return list(_CONTEXTS.keys())


def get_context(asset_id: str) -> dict:
    """
    Return the full machine context dict for a given asset_id.
    Raises ContextNotFoundError if it doesn't exist.
    """
    if asset_id not in _CONTEXTS:
        raise ContextNotFoundError(
            f"No machine context found for asset_id='{asset_id}'. "
            f"Known asset_ids: {list_asset_ids()}"
        )
    return _CONTEXTS[asset_id]


def reload_context(asset_id: str, new_context: dict) -> None:
    """
    Replace one context in memory (used later by the reconciler when a
    context_version bumps). Not needed yet -- just here so the shape exists.
    """
    _CONTEXTS[asset_id] = new_context