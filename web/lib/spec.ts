// TypeScript mirror of contracts/screen-spec.schema.json and
// contracts/machine-context.schema.json. The contracts are the source of truth;
// if these types and the schemas disagree, the schemas win.

export type PanelClass = "small" | "medium" | "large";
export type SizeHint = "compact" | "medium" | "wide";
export type ComponentType =
  | "alarm_banner"
  | "status_indicator"
  | "gauge"
  | "trend"
  | "comms_health"
  | "nav_tile";

interface ComponentBase {
  id: string;
  type: ComponentType;
  priority: number;
  size_hint: SizeHint;
  min_panel?: PanelClass;
}

export type TagComponent = ComponentBase & { bind_tag: string; bind_alarms?: undefined };
export type AlarmComponent = ComponentBase & { bind_alarms: string[]; bind_tag?: undefined };
export type SpecComponent = TagComponent | AlarmComponent;

export interface ScreenSpec {
  screen_id: string;
  title: string;
  asset_id: string;
  context_version: string;
  components: SpecComponent[];
  permissions: { mode: "read_only" };
}

export interface TagDef {
  name: string;
  type: "bool" | "int" | "float";
  unit: string;
  access: "read" | "read_write";
  description?: string;
  range?: { min: number; max: number };
}

export type TripOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export interface AlarmDef {
  id: string;
  desc: string;
  priority: 1 | 2 | 3 | 4;
  tag: string;
  trip?: { op: TripOp; value: number | boolean };
}

export interface CommsDef {
  device: string;
  protocol: "modbus_tcp" | "opc_ua" | "profinet" | "ethernet_ip" | "mqtt";
  endpoint: string;
  health_tag: string;
}

export interface MachineContext {
  asset_id: string;
  name: string;
  aliases?: string[];
  context_version: string;
  asset_hierarchy: { level: string; id: string; name: string }[];
  tags: TagDef[];
  io: { digital_in: string[]; digital_out: string[]; analog_in: string[]; analog_out: string[] };
  alarms: AlarmDef[];
  comms: CommsDef[];
}

export type TagValue = boolean | number;

/** Response body of GET /tags/{asset_id}. */
export interface TagsSnapshot {
  asset_id: string;
  context_version: string;
  timestamp: string;
  tags: Record<string, TagValue>;
  alarms: Record<string, boolean>;
}

export type ErrorStage = "intent" | "context" | "generation" | "schema" | "whitelist" | "read_only";

export interface GenerateError {
  stage: ErrorStage;
  message: string;
  field: string | null;
  details?: unknown;
}

/** Response body of POST /generate. */
export type GenerateResponse =
  | { spec: ScreenSpec; meta?: Record<string, unknown> }
  | { error: GenerateError };

export interface AssetSummary {
  asset_id: string;
  name: string;
  context_version: string;
}
