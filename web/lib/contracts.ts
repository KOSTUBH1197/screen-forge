// Frozen fixtures from contracts/ (git tag contracts-frozen), imported read-only.
// They are the machine contexts /web renders against, the golden screens, and
// the standalone fallback when /api is not running.
import chiller from "../../contracts/fixtures/context.chiller.json";
import conveyorA from "../../contracts/fixtures/context.conveyorA.json";
import comms from "../../contracts/fixtures/spec.golden.comms.json";
import statusAlarms from "../../contracts/fixtures/spec.golden.status-alarms.json";
import trend from "../../contracts/fixtures/spec.golden.trend.json";
import type { AssetSummary, MachineContext, ScreenSpec } from "./spec";

// TypeScript types JSON imports loosely (string instead of literal unions).
// The shape is guaranteed by contracts/*.schema.json, which every fixture passes.
const asContext = (json: unknown) => json as MachineContext;
const asSpec = (json: unknown) => json as ScreenSpec;

export const FIXTURE_CONTEXTS: Record<string, MachineContext> = Object.fromEntries(
  [asContext(conveyorA), asContext(chiller)].map((context) => [context.asset_id, context]),
);

export const FIXTURE_ASSETS: AssetSummary[] = Object.values(FIXTURE_CONTEXTS).map((context) => ({
  asset_id: context.asset_id,
  name: context.asset_hierarchy.at(-1) ?? context.asset_id,
  context_version: context.context_version,
}));

export interface GoldenSpec {
  key: string;
  file: string;
  label: string;
  spec: ScreenSpec;
}

export const GOLDEN_SPECS: GoldenSpec[] = [
  {
    key: "status-alarms",
    file: "spec.golden.status-alarms.json",
    label: "Conveyor A · status and alarms",
    spec: asSpec(statusAlarms),
  },
  {
    key: "trend",
    file: "spec.golden.trend.json",
    label: "Conveyor A · temperature trend",
    spec: asSpec(trend),
  },
  {
    key: "comms",
    file: "spec.golden.comms.json",
    label: "Chiller 1 · connectivity health",
    spec: asSpec(comms),
  },
];
