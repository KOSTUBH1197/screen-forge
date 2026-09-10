// Client for the /api endpoints in the frozen contract (CLAUDE.md):
//   POST /generate { prompt, asset_id, panel_class } -> { spec } | { error }
//   GET  /tags/{asset_id} -> live values

import type { GenerateResponse, PanelClass, ScreenSpec, TagsSnapshot } from "./spec";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

/** The API could not be reached at all (refused, DNS, timeout). */
export class ApiUnreachableError extends Error {}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
  } catch {
    throw new ApiUnreachableError(
      controller.signal.aborted
        ? `No response from ${API_BASE}${path} within ${timeoutMs / 1000} s.`
        : `Cannot reach the ScreenForge API at ${API_BASE}.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTags(assetId: string): Promise<TagsSnapshot> {
  const res = await request(`/tags/${encodeURIComponent(assetId)}`, { headers: { Accept: "application/json" } }, 1500);
  if (!res.ok) throw new Error(`GET /tags returned HTTP ${res.status}.`);
  return (await res.json()) as TagsSnapshot;
}

export interface GenerateRequest {
  prompt: string;
  asset_id: string | null;
  panel_class: PanelClass;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Minimal structural check so a broken response shows a readable error instead
 * of crashing the renderer. This is NOT the validator (that lives in /api) and it
 * never repairs anything: a spec either passes as-is or is refused.
 */
export function looksLikeSpec(value: unknown): value is ScreenSpec {
  if (!isObject(value)) return false;
  if (typeof value.asset_id !== "string" || typeof value.title !== "string") return false;
  if (typeof value.context_version !== "string") return false;
  if (!isObject(value.permissions) || value.permissions.mode !== "read_only") return false;
  if (!Array.isArray(value.components)) return false;
  return value.components.every(
    (c) =>
      isObject(c) &&
      typeof c.id === "string" &&
      typeof c.type === "string" &&
      typeof c.priority === "number" &&
      typeof c.size_hint === "string",
  );
}

/** POST /generate. Reads the body whatever the HTTP status. */
export async function generateScreen(body: GenerateRequest): Promise<GenerateResponse> {
  const res = await request(
    "/generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    },
    90_000,
  );

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`/generate returned HTTP ${res.status} with a body that is not JSON.`);
  }

  // The contract doesn't fix the error shape: accept a plain string or an object with a message.
  if (isObject(payload) && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return { error: { message: error } };
    if (isObject(error) && typeof error.message === "string") {
      return {
        error: {
          message: error.message,
          stage: typeof error.stage === "string" ? error.stage : undefined,
          field: typeof error.field === "string" ? error.field : null,
          details: error.details,
        },
      };
    }
  }
  if (isObject(payload) && looksLikeSpec(payload.spec)) {
    return { spec: payload.spec, meta: isObject(payload.meta) ? payload.meta : undefined };
  }
  throw new Error(`/generate returned HTTP ${res.status} without a usable { spec } or { error } body.`);
}
