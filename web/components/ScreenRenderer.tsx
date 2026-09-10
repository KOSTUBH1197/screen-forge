import { useMemo } from "react";
import { FIXTURE_CONTEXTS } from "@/lib/contracts";
import { computeLayout, type LayoutItem } from "@/lib/layout";
import type { MachineContext, PanelClass, ScreenSpec, SpecComponent } from "@/lib/spec";
import type { LiveValues } from "@/lib/useLiveTags";
import { lookupComponent } from "./registry";

const SHORT_MIN_HEIGHT = 132;
const TALL_MIN_HEIGHT = 260;

interface ScreenRendererProps {
  spec: ScreenSpec;
  panel: PanelClass;
  context: MachineContext;
  live: LiveValues;
  onNavigate?: (component: SpecComponent) => void;
}

function bindingLabel(component: SpecComponent): string {
  return (
    component.bind_alarms?.join(", ") ?? component.bind_device ?? component.bind_asset ?? component.bind_tag ?? "(unbound)"
  );
}

/**
 * Defence in depth only: the /api validator is what guarantees bindings.
 * A component that fails here is not drawn, and nothing is repaired.
 */
function bindingProblem(component: SpecComponent, context: MachineContext): string | null {
  const version = context.context_version;
  switch (component.type) {
    case "alarm_banner": {
      if (!component.bind_alarms) return "alarm_banner has no bind_alarms";
      const missing = component.bind_alarms.filter((id) => !context.alarms.some((a) => a.id === id));
      return missing.length > 0 ? `${missing.join(", ")} not found in ${version}` : null;
    }
    case "comms_health": {
      if (component.bind_device !== undefined) {
        return context.comms.some((c) => c.device === component.bind_device)
          ? null
          : `device ${component.bind_device} not found in ${version}`;
      }
      if (component.bind_tag !== undefined) {
        return context.comms.some((c) => c.health_tag === component.bind_tag)
          ? null
          : `${component.bind_tag} is not a comms health tag in ${version}`;
      }
      return "comms_health has no bind_device";
    }
    case "nav_tile": {
      if (component.bind_asset === undefined) return "nav_tile has no bind_asset";
      return FIXTURE_CONTEXTS[component.bind_asset] ? null : `asset ${component.bind_asset} has no machine context`;
    }
    default: {
      if (component.bind_tag === undefined) return `${component.type} has no bind_tag`;
      return context.tags.some((t) => t.name === component.bind_tag) ? null : `${component.bind_tag} not found in ${version}`;
    }
  }
}

function RendererNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div role="alert" className="flex h-full flex-col justify-center gap-1 rounded-lg border border-dashed border-cell-border bg-cell p-4">
      <p className="text-sm font-semibold text-text">⚠ {title}</p>
      <p className="numeral text-xs text-muted">{detail}</p>
    </div>
  );
}

function Cell({ item, context, live, onNavigate }: { item: LayoutItem } & Omit<ScreenRendererProps, "spec" | "panel">) {
  const { component } = item;
  const entry = lookupComponent(component.type);
  if (!entry) {
    return (
      <RendererNotice
        title={`Unsupported component type "${component.type}"`}
        detail={`${component.id} is not in the component registry, so it is not rendered.`}
      />
    );
  }
  const problem = bindingProblem(component, context);
  if (problem) {
    return <RendererNotice title={`${entry.label} binding not usable`} detail={`${component.id}: ${problem}`} />;
  }
  return <entry.Component component={component} context={context} live={live} height={item.height} onNavigate={onNavigate} />;
}

export function ScreenRenderer({ spec, panel, context, live, onNavigate }: ScreenRendererProps) {
  const layout = useMemo(() => computeLayout(spec, panel), [spec, panel]);

  return (
    <div className="flex flex-col gap-3" data-panel={panel} data-columns={layout.columns}>
      {layout.rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {row.items.map((item) => {
            const entry = lookupComponent(item.component.type);
            const minHeight = entry?.fitContent
              ? undefined
              : item.height === "short"
                ? SHORT_MIN_HEIGHT
                : (entry?.tallMinHeight ?? TALL_MIN_HEIGHT);
            return (
              <div
                key={item.component.id}
                data-component-id={item.component.id}
                // Components in a row that is not full grow in proportion to their span.
                style={{ flex: `${item.span} 1 0%`, minWidth: 0, minHeight }}
              >
                <Cell item={item} context={context} live={live} onNavigate={onNavigate} />
              </div>
            );
          })}
        </div>
      ))}

      {layout.hidden.length > 0 && (
        <footer className="rounded-md border border-dashed border-cell-border px-3 py-2 text-xs text-faint">
          <p className="mb-1 font-semibold uppercase tracking-wider">Hidden on this panel ({layout.hidden.length})</p>
          <ul className="space-y-0.5">
            {layout.hidden.map(({ component, reasons }) => (
              <li key={component.id}>
                <span className="numeral text-muted">
                  {component.id} · {component.type} · {bindingLabel(component)}
                </span>
                {" — "}
                {reasons.join("; ")}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
