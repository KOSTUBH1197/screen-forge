// Live tag values for one machine: polls GET /tags/{asset_id} once a second and
// falls back to the local mock simulator when /api is not reachable, so /web
// runs standalone. Keeps a ring buffer of the last 60 numeric samples per tag.

import { useEffect, useState } from "react";
import { fetchTags } from "./api";
import { MockTagSimulator } from "./mockTags";
import type { MachineContext, TagsSnapshot } from "./spec";

export const HISTORY_CAPACITY = 60;
const POLL_MS = 1000;
/** While the API is down, only retry it this often; mock values fill the gap. */
const API_RETRY_MS = 5000;

export type TagSource = "api" | "mock" | "connecting";

export interface LiveValues {
  snapshot: TagsSnapshot | null;
  /** Oldest first, at most HISTORY_CAPACITY samples. */
  history: Record<string, number[]>;
}

interface State {
  key: string | null;
  live: LiveValues;
  source: TagSource;
}

const NO_VALUES: LiveValues = { snapshot: null, history: {} };

function keyOf(context: MachineContext): string {
  return `${context.asset_id}|${context.context_version}`;
}

export function useLiveTags(context: MachineContext | null): { live: LiveValues; source: TagSource } {
  const [state, setState] = useState<State>({ key: null, live: NO_VALUES, source: "connecting" });

  useEffect(() => {
    if (!context) return;
    const key = keyOf(context);
    const simulator = new MockTagSimulator(context);
    let cancelled = false;
    let busy = false;
    let nextApiAttempt = 0;

    const apply = (snapshot: TagsSnapshot, source: TagSource) => {
      setState((prev) => {
        const previous = prev.key === key ? prev.live.history : {};
        const history: Record<string, number[]> = {};
        for (const [name, value] of Object.entries(snapshot.tags)) {
          if (typeof value !== "number") continue;
          const series = previous[name] ?? [];
          const kept = series.length >= HISTORY_CAPACITY ? series.slice(series.length - HISTORY_CAPACITY + 1) : series;
          history[name] = [...kept, value];
        }
        return { key, live: { snapshot, history }, source };
      });
    };

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (Date.now() >= nextApiAttempt) {
          try {
            const snapshot = await fetchTags(context.asset_id);
            if (cancelled) return;
            if (snapshot.asset_id === context.asset_id) {
              apply(snapshot, "api");
              return;
            }
          } catch {
            // Fall through to the mock simulator below.
          }
          if (cancelled) return;
          nextApiAttempt = Date.now() + API_RETRY_MS;
        }
        apply(simulator.tick(), "mock");
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [context]);

  if (!context || state.key !== keyOf(context)) return { live: NO_VALUES, source: "connecting" };
  return { live: state.live, source: state.source };
}
