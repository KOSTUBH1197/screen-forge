import type { MachineContext, TagDef, TagValue } from "./spec";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function findTag(context: MachineContext, name: string): TagDef {
  // The renderer checks bindings against the context before a component renders,
  // so the fallback only keeps the types honest.
  return context.tags.find((t) => t.name === name) ?? { name, type: "float", unit: "", access: "read" };
}

export function tagTitle(tag: TagDef): string {
  return tag.description ?? tag.name.replaceAll("_", " ");
}

export function rangeOf(tag: TagDef, samples: number[] = []): { min: number; max: number } {
  if (tag.range) return tag.range;
  if (samples.length > 0) return { min: Math.min(...samples), max: Math.max(...samples) };
  return { min: 0, max: 100 };
}

function decimalsFor(tag: TagDef): number {
  if (tag.type !== "float") return 0;
  if (!tag.range) return 1;
  return tag.range.max - tag.range.min <= 30 ? 1 : 0;
}

export function formatNumber(value: number, tag: TagDef): string {
  return value.toFixed(decimalsFor(tag));
}

export function formatValue(value: TagValue | undefined, tag: TagDef): string {
  if (value === undefined) return "--";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  return formatNumber(value, tag);
}
