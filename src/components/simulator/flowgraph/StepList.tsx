import React from "react";
import { ArrowRight, ChevronRight, CodeXml, Flag, Plus, Repeat, SlidersHorizontal, StickyNote, TriangleAlert, Zap } from "lucide-react";
import { CropImage } from "../../shared";
import { KitButton, KitLabel, Pill } from "../../ui/kit";
import { nameOf } from "../format";
import { useFlowEditor } from "./context";
import { overrideCount } from "./InspectorFields";
import { exitTarget } from "./model";
import { conditionSummary, EXIT_STYLE, exitKind, layoutFacts, stepLabel, targetName, unreachedSteps, type ExitKind } from "./shared";

// The phone version of the canvas: the same steps as cards in flow order, each with its exits
// as "→ target  when …" lines. Tapping a step (or Plot settings) opens the inspector as a sheet.

const EXIT_ICON: Record<ExitKind, React.ReactNode> = {
  normal: <ArrowRight />,
  arrive: <Zap />,
  restart: <Repeat />,
  finish: <Flag />,
  missing: <TriangleAlert />,
};

export const StepList: React.FC<{ onOpen: (i: number) => void; onOpenPlot?: () => void }> = ({ onOpen, onOpenPlot }) => {
  const api = useFlowEditor();
  const { plot } = api;
  const steps = plot.flow.steps;
  const scriptOnly = api.scripted ? unreachedSteps(plot) : new Set<number>();
  const overrides = overrideCount(plot.policies);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-8 scrollbar-dark">
      {onOpenPlot && (
        <button
          type="button"
          onClick={onOpenPlot}
          className="mb-4 flex w-full cursor-pointer items-center gap-3 rounded-container border border-line bg-surface-card px-3 py-2.5 text-left transition-[background-color,transform] duration-150 ease-snappy active:scale-[0.99] active:bg-surface-hover"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-hover text-fg-muted ring-1 ring-inset ring-line">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-title font-medium text-fg">Plot settings</span>
            <span className="block truncate text-secondary text-fg-meta">
              {plot.flow.loop ? "Loops" : "No loop"} · {overrides ? `${overrides} action override${overrides === 1 ? "" : "s"}` : "actions inherited"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-meta" />
        </button>
      )}
      <KitLabel className="mb-2 px-1">Steps · {steps.length}</KitLabel>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const f = layoutFacts(s);
          const targets = f.targets.reduce((n, [, c]) => n + c, 0);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(i)}
                aria-label={`Step ${i + 1}: ${stepLabel(s)}`}
                className="w-full cursor-pointer rounded-container border border-line bg-surface-card p-3 text-left transition-[background-color,transform] duration-150 ease-snappy active:scale-[0.99] active:bg-surface-hover"
              >
                <div className="flex items-start gap-2.5">
                  <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-hover ring-1 ring-inset ring-line">
                    <CropImage cropId={f.icon} cropName={nameOf(f.icon)} size="custom" width={26} height={26} showFallback={false} />
                    <span className="absolute -top-1.5 -left-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-inner bg-surface-hover px-1 text-meta font-semibold tabular-nums text-fg-body shadow">
                      {i + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 pt-px">
                    <span className="flex items-start gap-1.5">
                      <span className="min-w-0 flex-1 text-title font-semibold leading-snug text-fg">{stepLabel(s)}</span>
                      {i === plot.flow.startIndex && (
                        <Pill tone="emerald" strong className="mt-0.5">
                          START
                        </Pill>
                      )}
                      {scriptOnly.has(i) && (
                        <Pill tone="sky" className="mt-0.5" title="Entered by the plot script">
                          <CodeXml />
                        </Pill>
                      )}
                    </span>
                    <span className="mt-0.5 block text-secondary tabular-nums text-fg-meta">
                      {f.plants} plant{f.plants === 1 ? "" : "s"} · {targets ? `${targets} target${targets === 1 ? "" : "s"}` : "no targets"}
                    </span>
                  </span>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-fg-meta" />
                </div>
                {f.targets.length > 0 && (
                  <span className="mt-2.5 flex flex-wrap gap-1">
                    {f.targets.slice(0, 4).map(([id, n]) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-inner bg-surface-well py-0.5 pr-1.5 pl-1 text-secondary font-medium text-fg-body ring-1 ring-inset ring-line">
                        <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={14} height={14} showFallback={false} />
                        {nameOf(id)}
                        {n > 1 && <span className="tabular-nums text-fg-meta">×{n}</span>}
                      </span>
                    ))}
                    {f.targets.length > 4 && <span className="self-center px-1 text-secondary text-fg-meta">+{f.targets.length - 4}</span>}
                  </span>
                )}
                {s.ui?.note && (
                  <span className="mt-2 flex items-start gap-1.5 text-secondary leading-snug text-fg-muted">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-fg-meta" />
                    <span className="line-clamp-2">{s.ui.note}</span>
                  </span>
                )}
                {s.exits.length > 0 ? (
                  <ol className="mt-2.5 flex flex-col gap-1.5 border-t border-line pt-2.5">
                    {s.exits.map((e, j) => {
                      const k = exitKind(plot, i, e);
                      return (
                        <li key={j} className="flex items-start gap-2 text-body leading-snug">
                          <span className={`mt-0.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5 ${EXIT_STYLE[k].text}`} title={EXIT_STYLE[k].label}>
                            {EXIT_ICON[k]}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium text-fg">{targetName(plot, i, exitTarget(plot, i, e))}</span>
                            <span className="text-fg-meta"> when </span>
                            <span className="text-fg-muted">{conditionSummary(e.when, e.match, steps, api.secondsPerCycle)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-2.5 border-t border-line pt-2.5 text-secondary text-fg-meta">No exits: the plot stays here.</p>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <KitButton variant="dashed" size="md" className="mt-3 h-10 w-full" onClick={() => onOpen(api.addStep({}))}>
        <Plus /> Add step
      </KitButton>
    </div>
  );
};
