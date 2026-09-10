// Client for the /api endpoints defined in the x-screenforge header of
// contracts/screen-spec.schema.json.

import type {
  AssetSummary,
  GenerateError,
  GenerateResponse,
  MachineContext,
  PanelClass,
  ScreenSpec,
  TagsSnapshot,
} from "./spec";

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

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const res = await request(path, { headers: { Accept: "application/json" } }, timeoutMs);
  if (!res.ok) throw new Error(`GET ${path} returned HTTP ${res.status}.`);
  return (await res.json()) as T;
}

export function fetchTags(assetId: string): Promise<TagsSnapshot> {
  return getJson<TagsSnapshot>(`/tags/${encodeURIComponent(assetId)}`, 1500);
}

export function fetchContext(assetId: string): Promise<MachineContext> {
  return getJson<MachineContext>(`/context/${encodeURIComponent(assetId)}`, 3000);
}

export function fetchAssets(): Promise<AssetSummary[]> {
  return getJson<AssetSummary[]>("/assets", 3000);
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
      typeof c.size_hint === "string" &&
      (typeof c.bind_tag === "string" || Array.isArray(c.bind_alarms)),
  );
}

/** POST /generate. Reads the body whatever the HTTP status, as the contract requires. */
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

  if (isObject(payload) && isObject(payload.error) && typeof payload.error.message === "string") {
    return { error: payload.error as unknown as GenerateError };
  }
  if (isObject(payload) && looksLikeSpec(payload.spec)) {
    return { spec: payload.spec, meta: isObject(payload.meta) ? payload.meta : undefined };
  }
  throw new Error(`/generate returned HTTP ${res.status} without a usable { spec } or { error } body.`);
}
