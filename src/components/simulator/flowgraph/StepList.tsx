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
          className="mb-4 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 px-3 py-2.5 text-left transition-[background-color,transform] duration-150 ease-snappy active:scale-[0.99] active:bg-slate-800/70"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-400 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium text-slate-100">Plot settings</span>
            <span className="block truncate text-[12px] text-slate-500">
              {plot.flow.loop ? "Loops" : "No loop"} · {overrides ? `${overrides} action override${overrides === 1 ? "" : "s"}` : "actions inherited"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
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
                className="w-full cursor-pointer rounded-xl border border-slate-700/50 bg-slate-800/40 p-3 text-left transition-[background-color,transform] duration-150 ease-snappy active:scale-[0.99] active:bg-slate-800/70"
              >
                <div className="flex items-start gap-2.5">
                  <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-slate-800 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">
                    <CropImage cropId={f.icon} cropName={nameOf(f.icon)} size="custom" width={26} height={26} showFallback={false} />
                    <span className="absolute -top-1.5 -left-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-slate-700 px-1 text-[10.5px] font-semibold tabular-nums text-slate-200 shadow">
                      {i + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 pt-px">
                    <span className="flex items-start gap-1.5">
                      <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-slate-100">{stepLabel(s)}</span>
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
                    <span className="mt-0.5 block text-[12px] tabular-nums text-slate-500">
                      {f.plants} plant{f.plants === 1 ? "" : "s"} · {targets ? `${targets} target${targets === 1 ? "" : "s"}` : "no targets"}
                    </span>
                  </span>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-600" />
                </div>
                {f.targets.length > 0 && (
                  <span className="mt-2.5 flex flex-wrap gap-1">
                    {f.targets.slice(0, 4).map(([id, n]) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-slate-900/70 py-0.5 pr-1.5 pl-1 text-[11.5px] font-medium text-slate-300 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">
                        <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={14} height={14} showFallback={false} />
                        {nameOf(id)}
                        {n > 1 && <span className="tabular-nums text-slate-500">×{n}</span>}
                      </span>
                    ))}
                    {f.targets.length > 4 && <span className="self-center px-1 text-[11.5px] text-slate-500">+{f.targets.length - 4}</span>}
                  </span>
                )}
                {s.ui?.note && (
                  <span className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-slate-400">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" />
                    <span className="line-clamp-2">{s.ui.note}</span>
                  </span>
                )}
                {s.exits.length > 0 ? (
                  <ol className="mt-2.5 flex flex-col gap-1.5 border-t border-slate-700/50 pt-2.5">
                    {s.exits.map((e, j) => {
                      const k = exitKind(plot, i, e);
                      return (
                        <li key={j} className="flex items-start gap-2 text-[12.5px] leading-snug">
                          <span className={`mt-0.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5 ${EXIT_STYLE[k].text}`} title={EXIT_STYLE[k].label}>
                            {EXIT_ICON[k]}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium text-slate-100">{targetName(plot, i, exitTarget(plot, i, e))}</span>
                            <span className="text-slate-500"> when </span>
                            <span className="text-slate-400">{conditionSummary(e.when, e.match, steps)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-2.5 border-t border-slate-700/50 pt-2.5 text-[12px] text-slate-500">No exits: the plot stays here.</p>
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
