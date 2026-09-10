import { clamp, findTag, formatValue, rangeOf, tagTitle } from "@/lib/format";
import { activeAlarmsOnTag, SEVERITY_COLOR, worstSeverity } from "@/lib/severity";
import type { CommsDef } from "@/lib/spec";
import { CellFrame } from "./CellFrame";
import type { RegistryProps } from "./types";

const PROTOCOL_LABEL: Record<CommsDef["protocol"], string> = {
  modbus_tcp: "Modbus TCP",
  opc_ua: "OPC UA",
  profinet: "PROFINET",
  ethernet_ip: "EtherNet/IP",
  mqtt: "MQTT",
};

function qualityWord(percent: number): string {
  if (percent >= 80) return "Good";
  if (percent >= 50) return "Degraded";
  return "Poor";
}

export function CommsHealth({ component, context, live }: RegistryProps) {
  const tagName = component.bind_tag ?? "";
  const tag = findTag(context, tagName);
  const device = context.comms.find((c) => c.health_tag === tagName);
  const raw = live.snapshot?.tags[tagName];
  const severity = worstSeverity(activeAlarmsOnTag(context, live.snapshot, tagName));
  const range = rangeOf(tag);
  const percent = typeof raw === "number" ? clamp(((raw - range.min) / (range.max - range.min || 1)) * 100, 0, 100) : 0;
  const color = severity ? SEVERITY_COLOR[severity] : "var(--neutral-fill)";

  return (
    <CellFrame
      title={device ? device.device.replaceAll("_", " ") : tagTitle(tag)}
      binding={tagName}
      severity={severity}
      badge={device ? PROTOCOL_LABEL[device.protocol] : undefined}
    >
      <div className="flex flex-1 flex-col justify-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="numeral text-5xl font-bold leading-none" style={{ color: severity ? color : "var(--text)" }}>
            {formatValue(raw, tag)}
          </span>
          <span className="text-lg text-muted">{tag.unit}</span>
          <span className="ml-auto text-sm font-semibold uppercase tracking-wide text-muted">
            {typeof raw === "number" ? `Link ${qualityWord(percent)}` : ""}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-track" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} />
        </div>
        {device && <p className="numeral truncate text-xs text-faint">{device.endpoint}</p>}
      </div>
    </CellFrame>
  );
}
