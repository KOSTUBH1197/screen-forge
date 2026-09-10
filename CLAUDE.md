# ScreenForge

Runtime HMI screen generator. An operator types or speaks a request; the system
produces a validated JSON screen specification and renders it responsively.

## Non-negotiable invariants

1. The LLM outputs ONLY a JSON screen specification conforming to
   contracts/screen-spec.schema.json. It never outputs HTML, JSX, CSS, inline
   styles, or pixel coordinates. If you are tempted to have the model emit UI
   code, stop; that breaks the entire premise of the project.
2. The screen specification contains NO position, coordinate, width, height,
   colour or font fields. Components carry `priority`, `size_hint` and optional
   `min_panel` only. Layout is computed by the renderer.
3. Validation never auto-repairs an invalid specification. It returns an
   explicit structured error. Silent repair is forbidden.
4. Every bound tag or alarm id must exist in that asset's machine context. The
   whitelist is derived from the machine context at request time, never
   hand-maintained.
5. MVP is read-only. No component may write to a tag. `permissions.mode` is
   always "read_only".
6. Files under contracts/ are frozen. If a change seems necessary, stop and
   raise it with the other developer. Do not edit them unilaterally.

## Panel classes
- small (7"): priority 1-3, one column, hides components with min_panel: medium
- medium (10"): priority 1-6, two columns
- large (15"+): everything

## API contract
- POST /generate { prompt, asset_id, panel_class } -> { spec } | { error }
- GET /tags/{asset_id} -> live values

## Ownership
- /web is owned by Person A (Kostubh). Do not create or edit files there unless you are A.
- /api is owned by Person B (Mokshad). Do not create or edit files there unless you are B.

## Style
- Small, reviewable commits. One concern per commit.
- No new dependencies without a one-line reason in the commit message.
- Prefer boring, explicit code. This is demoed to judges, not shipped to prod.
