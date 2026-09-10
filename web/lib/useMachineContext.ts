// Machine context for an asset: GET /context/{asset_id}, falling back to the
// frozen fixtures in contracts/ when /api is not running. The fixture is used
// immediately so the screen never waits on a slow connection failure.

import { useEffect, useState } from "react";
import { fetchAssets, fetchContext } from "./api";
import { FIXTURE_ASSETS, FIXTURE_CONTEXTS } from "./contracts";
import type { AssetSummary, MachineContext } from "./spec";

export type ContextSource = "api" | "fixture";

interface Loaded {
  assetId: string;
  context: MachineContext | null;
  source: ContextSource | null;
  error: string | null;
}

export function useMachineContext(assetId: string): Omit<Loaded, "assetId"> {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchContext(assetId).then(
      (context) => {
        if (!cancelled) setLoaded({ assetId, context, source: "api", error: null });
      },
      (e: unknown) => {
        if (cancelled) return;
        const fixture = FIXTURE_CONTEXTS[assetId];
        setLoaded(
          fixture
            ? { assetId, context: fixture, source: "fixture", error: null }
            : { assetId, context: null, source: null, error: e instanceof Error ? e.message : String(e) },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (!loaded || loaded.assetId !== assetId) {
    const fixture = FIXTURE_CONTEXTS[assetId] ?? null;
    return { context: fixture, source: fixture ? "fixture" : null, error: null };
  }
  return { context: loaded.context, source: loaded.source, error: loaded.error };
}

export function useAssets(): AssetSummary[] {
  const [apiAssets, setApiAssets] = useState<AssetSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAssets().then(
      (assets) => {
        if (!cancelled && Array.isArray(assets) && assets.length > 0) setApiAssets(assets);
      },
      () => {
        // API offline: the fixture list below is the fallback.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return apiAssets ?? FIXTURE_ASSETS;
}
