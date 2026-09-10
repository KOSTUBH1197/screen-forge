import { clamp, findTag, formatValue, rangeOf, tagTitle } from "@/lib/format";
import { activeAlarmsOnTag, SEVERITY_COLOR, worstSeverity } from "@/lib/severity";
import { CellFrame } from "./CellFrame";
import type { RegistryProps } from "./types";

// 240 degree dial, angles measured clockwise from 12 o'clock.
const START = -120;
const SWEEP = 240;
const CX = 100;
const CY = 100;
const R = 80;

function pointAt(deg: number, radius: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

function arcPath(from: number, to: number): string {
  const [x1, y1] = pointAt(from, R);
  const [x2, y2] = pointAt(to, R);
  const largeArc = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function Gauge({ component, context, live }: RegistryProps) {
  const tagName = component.bind_tag ?? "";
  const tag = findTag(context, tagName);
  const raw = live.snapshot?.tags[tagName];
  const severity = worstSeverity(activeAlarmsOnTag(context, live.snapshot, tagName));
  const range = rangeOf(tag);
  const span = range.max - range.min || 1;
  const fractionOf = (v: number) => clamp((v - range.min) / span, 0, 1);
  const fraction = typeof raw === "number" ? fractionOf(raw) : 0;
  const valueColor = severity ? SEVERITY_COLOR[severity] : "var(--neutral-fill)";
  const text = formatValue(raw, tag);

  const limits = context.alarms.flatMap((a) =>
    a.tag === tagName && a.trip && typeof a.trip.value === "number" ? [{ alarm: a, value: a.trip.value }] : [],
  );
  const [minX] = pointAt(START, R);
  const [maxX] = pointAt(START + SWEEP, R);

  return (
    <CellFrame
      title={tagTitle(tag)}
      binding={tagName}
      severity={severity}
      badge={tag.access === "read_write" ? "Setpoint · read-only" : undefined}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <svg viewBox="0 0 200 160" className="h-full max-h-64 w-full" role="img" aria-label={`${tagTitle(tag)}: ${text} ${tag.unit}`}>
          <path d={arcPath(START, START + SWEEP)} fill="none" stroke="var(--track)" strokeWidth={14} strokeLinecap="round" />
          {fraction > 0.002 && (
            <path
              d={arcPath(START, START + SWEEP * fraction)}
              fill="none"
              stroke={valueColor}
              strokeWidth={14}
              strokeLinecap="round"
            />
          )}
          {limits.map(({ alarm, value }) => {
            const deg = START + SWEEP * fractionOf(value);
            const [x1, y1] = pointAt(deg, R - 13);
            const [x2, y2] = pointAt(deg, R + 13);
            const isActive = live.snapshot?.alarms[alarm.id] === true;
            return (
              <line
                key={alarm.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isActive ? SEVERITY_COLOR[alarm.priority] : "var(--text-faint)"}
                strokeWidth={3}
              >
                <title>{`${alarm.id} trips ${alarm.trip?.op} ${value}`}</title>
              </line>
            );
          })}
          <text
            x={CX}
            y={CY + 6}
            textAnchor="middle"
            className="numeral"
            fontSize={40}
            fontWeight={700}
            fill={severity ? valueColor : "var(--text)"}
          >
            {text}
          </text>
          <text x={CX} y={CY + 28} textAnchor="middle" fontSize={14} fill="var(--text-muted)">
            {tag.unit}
          </text>
          <text x={minX} y={157} textAnchor="middle" className="numeral" fontSize={12} fill="var(--text-faint)">
            {range.min}
          </text>
          <text x={maxX} y={157} textAnchor="middle" className="numeral" fontSize={12} fill="var(--text-faint)">
            {range.max}
          </text>
        </svg>
      </div>
    </CellFrame>
  );
}
