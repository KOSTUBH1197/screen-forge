// Client-side stand-in for GET /tags/{asset_id}, used only when /api is not
// reachable so /web still runs standalone. Produces the same TagsSnapshot shape
// the API contract defines. The real simulator lives in /api.

import type { AlarmDef, MachineContext, TagDef, TagsSnapshot, TagValue, TripOp } from "./spec";

interface Excursion {
  ticksLeft: number;
  target: TagValue;
}

const EXCURSION_CHANCE = 0.012;
const BOOL_FLIP_CHANCE = 0.004;

export function evaluateTrip(value: TagValue | undefined, op: TripOp, limit: number | boolean): boolean {
  if (value === undefined) return false;
  switch (op) {
    case ">":
      return value > limit;
    case ">=":
      return value >= limit;
    case "<":
      return value < limit;
    case "<=":
      return value <= limit;
    case "==":
      return value === limit;
    case "!=":
      return value !== limit;
  }
}

function rangeOf(tag: TagDef): { min: number; max: number } {
  return tag.range ?? { min: 0, max: 100 };
}

function firstTrip(context: MachineContext, tag: TagDef): AlarmDef["trip"] | undefined {
  return context.alarms.find((a) => a.tag === tag.name && a.trip)?.trip;
}

/** Where a healthy value of this tag sits: safely on the non-alarm side of its trip. */
function normalValue(context: MachineContext, tag: TagDef): TagValue {
  const trip = firstTrip(context, tag);
  if (tag.type === "bool") {
    if (trip && typeof trip.value === "boolean") {
      const abnormal = trip.op === "==" ? trip.value : !trip.value;
      return !abnormal;
    }
    return true;
  }
  const { min, max } = rangeOf(tag);
  if (trip && typeof trip.value === "number") {
    if (trip.op === ">" || trip.op === ">=") return min + (trip.value - min) * 0.7;
    if (trip.op === "<" || trip.op === "<=") return trip.value + (max - trip.value) * 0.75;
  }
  return min + (max - min) * 0.6;
}

function excursionTarget(context: MachineContext, tag: TagDef): TagValue | null {
  const trip = firstTrip(context, tag);
  if (!trip) return null;
  if (tag.type === "bool") {
    return !normalValue(context, tag);
  }
  if (typeof trip.value !== "number") return null;
  const { min, max } = rangeOf(tag);
  const push = (max - min) * 0.08;
  if (trip.op === ">" || trip.op === ">=") return Math.min(max, trip.value + push);
  if (trip.op === "<" || trip.op === "<=") return Math.max(min, trip.value - push);
  return null;
}

export class MockTagSimulator {
  private readonly context: MachineContext;
  private readonly values: Record<string, TagValue> = {};
  private readonly excursions: Record<string, Excursion> = {};

  constructor(context: MachineContext) {
    this.context = context;
    for (const tag of context.tags) {
      this.values[tag.name] = normalValue(context, tag);
    }
  }

  tick(): TagsSnapshot {
    for (const tag of this.context.tags) {
      this.step(tag);
    }
    const tags: Record<string, TagValue> = {};
    for (const tag of this.context.tags) {
      const v = this.values[tag.name];
      tags[tag.name] = tag.type === "int" && typeof v === "number" ? Math.round(v) : v;
    }
    const alarms: Record<string, boolean> = {};
    for (const alarm of this.context.alarms) {
      alarms[alarm.id] = alarm.trip ? evaluateTrip(tags[alarm.tag], alarm.trip.op, alarm.trip.value) : false;
    }
    return {
      asset_id: this.context.asset_id,
      context_version: this.context.context_version,
      timestamp: new Date().toISOString(),
      tags,
      alarms,
    };
  }

  private step(tag: TagDef): void {
    // Setpoints and commands hold still; nobody is writing to them (read-only MVP).
    if (tag.access === "read_write") return;

    const normal = normalValue(this.context, tag);
    let excursion = this.excursions[tag.name];
    if (!excursion) {
      const target = excursionTarget(this.context, tag);
      const chance = tag.type === "bool" ? BOOL_FLIP_CHANCE : EXCURSION_CHANCE;
      if (target !== null && Math.random() < chance) {
        excursion = { ticksLeft: 6 + Math.floor(Math.random() * 9), target };
        this.excursions[tag.name] = excursion;
      }
    }

    if (tag.type === "bool") {
      this.values[tag.name] = excursion ? excursion.target : normal;
    } else {
      const { min, max } = rangeOf(tag);
      const current = this.values[tag.name] as number;
      const goal = (excursion ? excursion.target : normal) as number;
      const pull = excursion ? 0.3 : 0.1;
      const noise = (Math.random() - 0.5) * (max - min) * 0.02;
      this.values[tag.name] = Math.min(max, Math.max(min, current + (goal - current) * pull + noise));
    }

    if (excursion) {
      excursion.ticksLeft -= 1;
      if (excursion.ticksLeft <= 0) delete this.excursions[tag.name];
    }
  }
}
