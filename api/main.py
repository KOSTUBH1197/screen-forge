"""
ScreenForge API -- main FastAPI application.

Run this with:
    uvicorn main:app --reload --port 8000

Then visit http://localhost:8000/docs in a browser -- FastAPI auto-generates
an interactive test page for every endpoint, for free. Use it constantly
while building; it's faster than curl for poking at things by hand.
"""

from dotenv import load_dotenv
load_dotenv()  # reads .env into environment variables -- must run before generator.py
                # is imported, since it reads OPENAI_API_KEY at call time, not import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import context_store
import tag_simulator
import generator

app = FastAPI(title="ScreenForge API")

# CORS = Cross-Origin Resource Sharing. Browsers block a webpage running on
# one address from calling an API running on a *different* address, unless
# the API explicitly says "it's fine, I trust that address." Kostubh's
# Next.js app runs on http://localhost:3000 during development; without this,
# his frontend's fetch() calls to your API would be silently blocked by the
# browser, not your code -- a classic "why is nothing happening" bug.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/tags/{asset_id:path}")
def get_tags(asset_id: str):
    """
    Return live simulated tag values for one asset.

    asset_id uses ':path' in the route because our asset_ids contain dots
    and look like 'line1.conveyorA' or 'plant.utilities.chiller1' -- without
    ':path', FastAPI would still match this fine since dots aren't slashes,
    but ':path' future-proofs it in case an asset_id ever contains a slash.
    """
    try:
        return tag_simulator.get_live_values(asset_id)
    except context_store.ContextNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/health")
def health():
    """Simple liveness check -- useful during integration to confirm the
    server is even running before debugging anything more complicated."""
    return {"status": "ok", "known_assets": context_store.list_asset_ids()}


class GenerateRequest(BaseModel):
    prompt: str
    asset_id: str
    panel_class: str  # "small" | "medium" | "large"


@app.post("/generate")
def generate(req: GenerateRequest):
    """
    Turn an operator's plain-English prompt into a validated screen spec.
    Returns { "spec": {...} } on success, or { "error": {...} } on failure
    -- this endpoint itself always returns HTTP 200; the caller checks
    which key is present, per the agreed API contract in CLAUDE.md.
    """
    try:
        context_store.get_context(req.asset_id)
    except context_store.ContextNotFoundError as e:
        return {"error": {"message": str(e), "stage": "other", "field": "asset_id"}}

    spec, error = generator.generate_and_validate(req.prompt, req.asset_id, req.panel_class)
    if error is not None:
        return {"error": error}
    return {"spec": spec}