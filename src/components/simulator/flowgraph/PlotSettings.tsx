import React from "react";
import { CodeXml, Play, Repeat } from "lucide-react";
import { CropImage } from "../../shared";
import { KitLabel, Pill, Switch } from "../../ui/kit";
import { ActionsTab } from "./ActionsTab";
import { useFlowEditor } from "./context";
import { Dropdown, MenuItem } from "./InspectorPopover";
import { setLoop } from "./model";
import { layoutFacts, stepTitle } from "./shared";

// The inspector with no step selected: settings of the whole plot (loop, start step, the plot's
// action overrides and its script status).

export const PlotSettings: React.FC = () => {
  const api = useFlowEditor();
  const { plot, scenario } = api;
  const { steps, loop, startIndex } = plot.flow;
  const start = steps[startIndex];
  const script = plot.script;
  const scriptOn = !!script?.source.trim() && script.enabled !== false;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1 px-4 pt-4">
        <h2 className="text-[15px] font-semibold leading-snug text-slate-100">Plot {api.plotId} flow</h2>
        <p className="text-[12px] text-slate-500">
          {steps.length} {steps.length === 1 ? "step" : "steps"} · {loop ? "loops" : "stops at the end"} · shared clock &amp; inventory. Select a step to edit it.
        </p>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-4">
        <section className="flex items-start gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
          <span className="pt-px">
            <Switch checked={loop} onChange={(v) => api.edit((p) => setLoop(p, v))} label="Loop" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-100">
              <Repeat className="h-3.5 w-3.5 text-violet-300" /> Loop
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-500">
              {loop ? (
                <>Loop: after the last step, an exit that names no step goes back to step 1, and the flow never finishes.</>
              ) : (
<>Loop: after the last step, go back to step 1. Off: the last step may finish the flow and hold its layout.</>
              )}
            </p>
          </div>
        </section>
        <section className="flex flex-col gap-2.5 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-100">
              <Play className="h-3.5 w-3.5 text-emerald-400" /> Start step
            </div>
            <p className="mt-0.5 text-[12px] text-slate-500">Where the plot begins the run.</p>
          </div>
          <Dropdown
            label="Start step"
            title={start ? stepTitle(start, startIndex) : undefined}
            width={300}
            className="h-8 w-full"
            button={
              start ? (
                <>
                  <CropImage cropId={layoutFacts(start).icon} cropName="" size="custom" width={16} height={16} showFallback={false} className="shrink-0" />
                  <span className="truncate">{stepTitle(start, startIndex)}</span>
                </>
              ) : (
                "None"
              )
            }
          >
            {(close) =>
              steps.map((s, k) => (
                <MenuItem
                  key={s.id}
                  checked={k === startIndex}
                  icon={<CropImage cropId={layoutFacts(s).icon} cropName="" size="custom" width={18} height={18} showFallback={false} />}
                  onSelect={() => {
                    api.edit((p) => ({ ...p, flow: { ...p.flow, startIndex: k } }));
                    close();
                  }}
                >
                  {stepTitle(s, k)}
                </MenuItem>
              ))
            }
          </Dropdown>
        </section>
        <section className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
          <CodeXml className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          <span className="flex-1 text-[13px] font-medium text-slate-100">Plot script</span>
          {scriptOn ? (
            <Pill tone="sky">attached{api.scripted ? " · may jump between steps" : ""}</Pill>
          ) : script?.source.trim() ? (
            <Pill>disabled</Pill>
          ) : (
            <span className="text-[12px] text-slate-500">none</span>
          )}
        </section>
      </div>
      <div className="px-4 pt-6 pb-6">
        <KitLabel className="mb-1">Plot actions</KitLabel>
        <ActionsTab
          value={plot.policies}
          onChange={(policies) =>
            api.edit((p) => {
              const next = { ...p };
              if (policies) next.policies = policies;
              else delete next.policies;
              return next;
            })
          }
          inherited={scenario.settings.policies}
          inheritsFrom="the scenario defaults"
          hint="What the player does on this plot while online. Steps can override these again; everything not overridden follows the scenario defaults."
        />
      </div>
    </div>
  );
};
