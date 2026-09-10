"use client";

import { useCallback, useRef, useState } from "react";
import { API_BASE, ApiUnreachableError, generateScreen } from "@/lib/api";
import { GOLDEN_SPECS } from "@/lib/contracts";
import { PANEL_CLASSES, PANEL_RULES } from "@/lib/layout";
import type { PanelClass, ScreenSpec } from "@/lib/spec";
import { useLiveTags, type TagSource } from "@/lib/useLiveTags";
import { useAssets, useMachineContext, type ContextSource } from "@/lib/useMachineContext";
import { ErrorCard, type ConsoleError } from "./ErrorCard";
import { PANEL_NOMINAL_WIDTH, PanelFrame } from "./PanelFrame";
import {
  IDLE_PROGRESS,
  ProgressStages,
  STAGE_OF_ERROR,
  STAGES,
  type GenerationProgress,
} from "./ProgressStages";
import { ScaleToFit } from "./ScaleToFit";
import { ScreenRenderer } from "./ScreenRenderer";

const EXAMPLE_PROMPTS = [
  "Show conveyor A motor status and active alarms",
  "Trend the chiller supply water temperature",
  "Communications health for the conveyor",
  "Let me start the conveyor motor",
];

type ViewMode = "single" | "side-by-side";

type Origin =
  | { kind: "golden"; key: string; file: string }
  | { kind: "generated"; prompt: string; elapsedMs: number };

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      <div className="flex rounded-lg border border-cell-border bg-bg p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              value === option.value ? "bg-neutral-fill text-bezel" : "text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SourceBadge({ tags, context }: { tags: TagSource; context: ContextSource | null }) {
  const live = tags === "api";
  const text = tags === "connecting" ? "Connecting…" : live ? "Live tags from API" : "Mock tags · API offline";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-cell-border px-3 py-1 text-xs font-semibold text-muted">
      <span className={`size-2 rounded-full ${live ? "bg-neutral-fill" : "border border-faint"}`} aria-hidden />
      {text}
      {context === "fixture" && <span className="font-normal text-faint">· context from fixtures</span>}
    </span>
  );
}

export function OperatorConsole() {
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState("auto");
  const [panel, setPanel] = useState<PanelClass>("medium");
  const [view, setView] = useState<ViewMode>("single");
  const [spec, setSpec] = useState<ScreenSpec>(GOLDEN_SPECS[0].spec);
  const [origin, setOrigin] = useState<Origin>({ kind: "golden", key: GOLDEN_SPECS[0].key, file: GOLDEN_SPECS[0].file });
  const [progress, setProgress] = useState<GenerationProgress>(IDLE_PROGRESS);
  const [error, setError] = useState<ConsoleError | null>(null);
  const runId = useRef(0);

  const assets = useAssets();
  const { context, source: contextSource, error: contextError } = useMachineContext(spec.asset_id);
  const { live, source: tagSource } = useLiveTags(context);
  const running = progress.status === "running";

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text) return;
    const id = ++runId.current;
    const started = performance.now();
    setError(null);
    setProgress({ status: "running", active: 0, failed: null, elapsedMs: null });

    // /generate is one request, so the first stages advance on a timer while it runs.
    const advance = (stage: number) =>
      setProgress((p) => (id === runId.current && p.status === "running" && p.active < stage ? { ...p, active: stage } : p));
    const timers = [window.setTimeout(() => advance(1), 700), window.setTimeout(() => advance(2), 1500)];

    try {
      const result = await generateScreen({
        prompt: text,
        asset_id: target === "auto" ? null : target,
        panel_class: panel,
      });
      if (id !== runId.current) return;

      if ("error" in result) {
        const failed = STAGE_OF_ERROR[result.error.stage] ?? STAGES.length - 1;
        setProgress({ status: "failed", active: failed, failed, elapsedMs: performance.now() - started });
        setError({ kind: "api", error: result.error });
        return;
      }

      advance(3);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      if (id !== runId.current) return;
      const elapsedMs = performance.now() - started;
      setSpec(result.spec);
      setOrigin({ kind: "generated", prompt: text, elapsedMs });
      setProgress({ status: "done", active: STAGES.length, failed: null, elapsedMs });
    } catch (e) {
      if (id !== runId.current) return;
      setProgress(IDLE_PROGRESS);
      setError(
        e instanceof ApiUnreachableError
          ? { kind: "unreachable", message: e.message }
          : { kind: "client", message: e instanceof Error ? e.message : String(e) },
      );
    } finally {
      timers.forEach((t) => window.clearTimeout(t));
    }
  }, [prompt, target, panel]);

  const loadGolden = (key: string) => {
    const golden = GOLDEN_SPECS.find((g) => g.key === key);
    if (!golden) return;
    runId.current += 1; // abandon any in-flight generation
    setSpec(golden.spec);
    setOrigin({ kind: "golden", key: golden.key, file: golden.file });
    setProgress(IDLE_PROGRESS);
    setError(null);
  };

  const versionDrift = context !== null && context.context_version !== spec.context_version;

  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-text">ScreenForge</h1>
          <p className="text-sm text-muted">Describe the screen you need. Get a validated, responsive HMI.</p>
        </div>
        <SourceBadge tags={tagSource} context={contextSource} />
      </header>

      <section className="rounded-xl border border-cell-border bg-surface p-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <label htmlFor="prompt" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Operator request
          </label>
          <div className="flex flex-col gap-3 lg:flex-row">
            <textarea
              id="prompt"
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void generate();
                }
              }}
              placeholder="e.g. Show me the conveyor motor status and any active alarms"
              className="min-h-14 flex-1 resize-y rounded-lg border border-cell-border bg-bg px-3 py-2 text-lg text-text placeholder:text-faint focus:border-neutral-fill focus:outline-none"
            />
            <div className="flex flex-wrap gap-3 lg:w-64 lg:flex-col">
              <select
                aria-label="Machine"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="flex-1 rounded-lg border border-cell-border bg-bg px-3 py-2.5 text-sm text-text lg:flex-none"
              >
                <option value="auto">Machine: detect from request</option>
                {assets.map((asset) => (
                  <option key={asset.asset_id} value={asset.asset_id}>
                    {asset.name} ({asset.asset_id})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={running || prompt.trim() === ""}
                className="flex-1 rounded-lg bg-neutral-fill px-5 py-2.5 text-base font-bold text-bezel hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 lg:flex-none"
              >
                {running ? "Generating…" : "Generate screen"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border border-cell-border px-3 py-1 text-xs text-muted hover:border-neutral-fill hover:text-text"
              >
                {example}
              </button>
            ))}
          </div>
        </form>
        {progress.status !== "idle" && (
          <div className="mt-4">
            <ProgressStages progress={progress} />
          </div>
        )}
      </section>

      {error && <ErrorCard error={error} apiBase={API_BASE} hasScreen />}

      <section className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmented
          label="Panel"
          value={panel}
          onChange={setPanel}
          disabled={view === "side-by-side"}
          options={PANEL_CLASSES.map((p) => ({ value: p, label: `${PANEL_RULES[p].diagonal} ${p}` }))}
        />
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "single", label: "Single panel" },
            { value: "side-by-side", label: "All three" },
          ]}
        />
        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Golden screen
          <select
            value={origin.kind === "golden" ? origin.key : ""}
            onChange={(e) => loadGolden(e.target.value)}
            className="rounded-lg border border-cell-border bg-bg px-3 py-2 text-sm font-normal normal-case tracking-normal text-text"
          >
            {origin.kind !== "golden" && <option value="">— generated screen —</option>}
            {GOLDEN_SPECS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <p className="text-sm text-muted">
        {origin.kind === "golden" ? (
          <>
            Golden fixture <code className="numeral text-text">contracts/fixtures/{origin.file}</code>
          </>
        ) : (
          <>
            Generated from <q className="text-text">{origin.prompt}</q> in{" "}
            <span className="numeral">{(origin.elapsedMs / 1000).toFixed(1)} s</span>
          </>
        )}
        {" · "}
        <span className="numeral">{spec.asset_id}</span>
      </p>

      {versionDrift && (
        <p role="status" className="rounded-lg border border-cell-border bg-surface px-4 py-2 text-sm text-text">
          This screen was built against <span className="numeral">{spec.context_version}</span>, but the machine context is now{" "}
          <span className="numeral">{context.context_version}</span>. Regenerate to pick up the change.
        </p>
      )}

      {!context && (
        <p role="alert" className="rounded-lg border border-sev-1/70 bg-cell px-4 py-3 text-sm text-text">
          No machine context for <span className="numeral">{spec.asset_id}</span>
          {contextError ? `: ${contextError}` : "."} The screen can&apos;t be rendered without it.
        </p>
      )}

      {context &&
        (view === "single" ? (
          <ScaleToFit width={PANEL_NOMINAL_WIDTH[panel]}>
            <PanelFrame panel={panel} spec={spec} context={context} snapshot={live.snapshot}>
              <ScreenRenderer spec={spec} panel={panel} context={context} live={live} />
            </PanelFrame>
          </ScaleToFit>
        ) : (
          <div className="flex items-start gap-4">
            {PANEL_CLASSES.map((p) => (
              // Widths proportional to nominal panel widths, so all three share one scale.
              <div key={p} style={{ flex: `${PANEL_NOMINAL_WIDTH[p]} 1 0%`, minWidth: 0 }}>
                <ScaleToFit width={PANEL_NOMINAL_WIDTH[p]}>
                  <PanelFrame panel={p} spec={spec} context={context} snapshot={live.snapshot}>
                    <ScreenRenderer spec={spec} panel={p} context={context} live={live} />
                  </PanelFrame>
                </ScaleToFit>
              </div>
            ))}
          </div>
        ))}

      <details className="rounded-xl border border-cell-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">
          Screen specification JSON <span className="font-normal text-faint">· the only thing the model produces</span>
        </summary>
        <pre className="numeral max-h-[480px] overflow-auto px-4 pb-4 text-xs leading-relaxed text-muted">
          {JSON.stringify(spec, null, 2)}
        </pre>
      </details>
    </main>
  );
}
