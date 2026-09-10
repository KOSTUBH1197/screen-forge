import { findTag, formatValue, tagTitle } from "@/lib/format";
import { activeAlarmsOnTag, SEVERITY_COLOR, worstSeverity } from "@/lib/severity";
import { CellFrame } from "./CellFrame";
import type { RegistryProps } from "./types";

export function NavTile({ component, context, live, onNavigate }: RegistryProps) {
  const tagName = component.bind_tag ?? "";
  const tag = findTag(context, tagName);
  const raw = live.snapshot?.tags[tagName];
  const severity = worstSeverity(activeAlarmsOnTag(context, live.snapshot, tagName));

  return (
    <CellFrame title={tagTitle(tag)} binding={tagName} severity={severity}>
      <div className="flex flex-1 items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className="numeral text-3xl font-bold leading-none"
            style={{ color: severity ? SEVERITY_COLOR[severity] : "var(--text)" }}
          >
            {formatValue(raw, tag)}
          </span>
          <span className="text-sm text-muted">{tag.unit}</span>
        </div>
        <button
          type="button"
          disabled={!onNavigate}
          onClick={() => onNavigate?.(component)}
          className="shrink-0 rounded-md border border-cell-border px-3 py-1.5 text-sm font-semibold text-text hover:bg-track disabled:cursor-not-allowed disabled:opacity-40"
        >
          Details ›
        </button>
      </div>
    </CellFrame>
  );
}
