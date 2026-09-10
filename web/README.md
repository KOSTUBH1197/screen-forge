# ScreenForge /web — renderer

Owned by Person A (Kostubh). Renders a screen spec that conforms to
`contracts/screen-spec.schema.json` (git tag `contracts-frozen`) at three panel
classes. Layout comes only from `priority`, `size_hint` and `min_panel`.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
```

The API base URL defaults to `http://localhost:8000`. Override it with
`NEXT_PUBLIC_API_BASE`. With no API running, /web still works: tag values come
from a local mock simulator and golden screens load from `contracts/fixtures`.

Open a golden screen directly by URL:
`/?golden=status-alarms|trend|comms&panel=small|medium|large&view=single|side-by-side`

## What /web expects from /api

The contract in `CLAUDE.md` only names the endpoints. These are the shapes /web
reads; anything else is reported on screen, never silently patched.

**CORS:** allow origin `http://localhost:3000`, methods `GET, POST`, header `Content-Type`.

**`GET /tags/{asset_id}`**, polled once a second:

```json
{
  "asset_id": "line1.conveyorA",
  "context_version": "conveyorA@v3",
  "timestamp": "2026-09-11T10:15:00Z",
  "tags":   { "Motor_1_RunStatus": true, "Temperature_PV": 61.4 },
  "alarms": { "ALM_HT01": false, "ALM_LP01": false, "ALM_MT01": true }
}
```

`alarms` maps every alarm id in the context to whether it is active; the alarm
banner and severity colours depend on it. Comms health tags are booleans.

**`POST /generate`** with `{ "prompt": string, "asset_id": string | null, "panel_class": "small" | "medium" | "large" }`:

- Success: `{ "spec": <screen spec> }`, optionally with `"meta": {}`.
- Failure, any HTTP status: `{ "error": "message" }` or, better,
  `{ "error": { "stage": "intent" | "context" | "generation" | "schema" | "whitelist" | "read_only", "message": "...", "field": "/components/2/bind_tag" } }`.
  `stage` decides which progress step turns red and the headline shown.

Machine contexts are read from `contracts/fixtures` because the contract has no
context endpoint.
