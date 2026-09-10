// Alarm severity is the only thing a rendered screen uses colour for.

import type { AlarmDef, MachineContext, TagsSnapshot } from "./spec";

export type Severity = AlarmDef["priority"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  1: "var(--sev-1)",
  2: "var(--sev-2)",
  3: "var(--sev-3)",
  4: "var(--sev-4)",
};

/** Alarms on this tag that are active in the snapshot, most severe first. */
export function activeAlarmsOnTag(context: MachineContext, snapshot: TagsSnapshot | null, tagName: string): AlarmDef[] {
  if (!snapshot) return [];
  return context.alarms
    .filter((a) => a.tag === tagName && snapshot.alarms[a.id] === true)
    .sort((a, b) => a.priority - b.priority);
}

export function worstSeverity(alarms: AlarmDef[]): Severity | null {
  return alarms.length === 0 ? null : alarms.reduce<Severity>((worst, a) => (a.priority < worst ? a.priority : worst), 4);
}
