// TypeScript mirror of the frozen contracts (git tag contracts-frozen):
// contracts/screen-spec.schema.json and contracts/machine-context.schema.json.
// If these types and the schemas disagree, the schemas win.

export type PanelClass = "small" | "medium" | "large";
export type SizeHint = "compact" | "medium" | "wide";
export type ComponentType =
  | "alarm_banner"
  | "status_indicator"
  | "gauge"
  | "trend"
  | "nav_tile"
  | "comms_health";

/**
 * The schema lets any binding appear on any component. Which binding a type
 * needs is enforced by the /api validator; the renderer only refuses to draw
 * a component whose binding is missing.
 */
export interface SpecComponent {
  id: string;
  type: ComponentType;
  bind_tag?: string;
  bind_alarms?: string[];
  bind_device?: string;
  priority: number;
  size_hint: SizeHint;
  min_panel?: PanelClass;
}

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
  type: "bool" | "analog";
  unit?: string;
  access: "read" | "write";
}

export type AlarmPriority = "Critical" | "High" | "Warning";

export interface AlarmDef {
  id: string;
  desc: string;
  priority: AlarmPriority;
  tag: string;
}

export interface CommsDef {
  device: string;
  protocol: string;
  endpoint: string;
  health_tag: string;
}

export interface MachineContext {
  asset_id: string;
  context_version: string;
  asset_hierarchy: string[];
  tags: TagDef[];
  io: { digital_in?: string[]; digital_out?: string[]; analog_in?: string[]; analog_out?: string[] };
  alarms: AlarmDef[];
  comms: CommsDef[];
}

export type TagValue = boolean | number;

/**
 * Response body of GET /tags/{asset_id}. The contract only says "live values";
 * this is the shape /web expects. Confirm it with /api before integration.
 */
export interface TagsSnapshot {
  asset_id: string;
  context_version: string;
  timestamp: string;
  tags: Record<string, TagValue>;
  alarms: Record<string, boolean>;
}

/** Error from POST /generate. The contract only says { error }, so stage and field are optional. */
export interface GenerateError {
  message: string;
  stage?: string;
  field?: string | null;
  details?: unknown;
}

export type GenerateResponse =
  | { spec: ScreenSpec; meta?: Record<string, unknown> }
  | { error: GenerateError };

export interface AssetSummary {
  asset_id: string;
  name: string;
  context_version: string;
}
