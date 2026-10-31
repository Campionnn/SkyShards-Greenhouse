import React from "react";
import { CodeXml, Pencil, Play, Repeat } from "lucide-react";
import { CropImage } from "../../shared";
import { InfoHint } from "../../ui/InfoHint";
import { KitButton, KitLabel, Pill, Switch } from "../../ui/kit";
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

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1 px-4 pt-4">
        <h2 className="text-title font-semibold leading-snug text-fg">Plot {api.plotId} flow</h2>
        <p className="text-secondary text-fg-meta">
          {steps.length} {steps.length === 1 ? "step" : "steps"} · {loop ? "loops" : "stops at the end"} · shared clock &amp; inventory. Select a step to edit it.
        </p>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-4">
        <section className="flex items-start gap-3 rounded-container border border-line bg-surface-card p-3">
          <span className="pt-px">
            <Switch checked={loop} onChange={(v) => api.edit((p) => setLoop(p, v))} label="Loop" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-body font-medium text-fg">
              <Repeat className="h-3.5 w-3.5 text-restart" /> Loop
              <InfoHint title="Loop">
                On: after the last step, an exit that names no step goes back to step 1, and the flow never finishes. Off: the last step may finish the flow and hold its layout.
              </InfoHint>
            </div>
            <p className="mt-0.5 text-secondary leading-snug text-fg-meta">{loop ? "Back to step 1 after the last step" : "Stops at the end"}</p>
          </div>
        </section>
        <section className="flex flex-col gap-2.5 rounded-container border border-line bg-surface-card p-3">
          <div>
            <div className="flex items-center gap-1.5 text-body font-medium text-fg">
              <Play className="h-3.5 w-3.5 text-go-fg" /> Start step
            </div>
            <p className="mt-0.5 text-secondary text-fg-meta">Where the plot begins the run.</p>
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
        <PlotScriptCard />
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
          hint="What the player does on this plot while online. Steps can override these again (While on this step); everything not overridden follows the scenario defaults."
        />
      </div>
    </div>
  );
};

/** Lines of the script that carry code (not blank, not only a comment), for the preview. */
function previewLines(source: string, n: number): string[] {
  const lines = source.split("\n").map((l) => l.replace(/\s+$/, ""));
  const code = lines.filter((l) => l.trim() && !/^\s*(\/\/|#)/.test(l));
  return (code.length ? code : lines.filter((l) => l.trim())).slice(0, n);
}

/** The plot's script: status, a short preview and the buttons that open the script editor. */
const PlotScriptCard: React.FC = () => {
  const api = useFlowEditor();
  const script = api.plot.script;
  const source = script?.source ?? "";
  const has = !!source.trim();
  const on = has && script?.enabled !== false;
  const lines = has ? source.split("\n").length : 0;
  const controller = api.scenario.script;
  const controllerHas = !!controller?.source.trim();
  const preview = has ? previewLines(source, 3) : [];
  return (
    <section className="flex flex-col gap-2.5 rounded-container border border-line bg-surface-card p-3" aria-label="Plot script">
      <div className="flex items-center gap-2">
        <CodeXml className="h-3.5 w-3.5 shrink-0 text-script" />
        <span className="flex-1 text-body font-medium text-fg">Plot script</span>
        {on ? (
          <Pill tone="sky" title={api.scripted ? "It can move this plot between steps (plot.goto)" : undefined}>
            enabled · {lines} line{lines === 1 ? "" : "s"}
          </Pill>
        ) : has ? (
          <Pill title="Kept, but it never runs">disabled · {lines} line{lines === 1 ? "" : "s"}</Pill>
        ) : (
          <span className="text-secondary text-fg-meta">none</span>
        )}
      </div>
      {has ? (
        <pre
          className={`overflow-hidden rounded-control border border-line bg-surface-well px-2.5 py-2 font-mono text-meta leading-[1.55] ${on ? "text-fg-body" : "text-fg-meta"}`}
          title={source.length > 400 ? `${source.slice(0, 400)}…` : source}
        >
          {preview.map((l, i) => (
            <span key={i} className="block truncate">
              {l}
            </span>
          ))}
          {lines > preview.length && <span className="block text-fg-meta">…</span>}
        </pre>
      ) : (
        <p className="flex items-center gap-1.5 text-secondary text-fg-meta">
          No script on this plot.
          <InfoHint title="Plot script">Code that runs alongside this flow: break a mutation at a stage, move the plot between steps from code, keep variables.</InfoHint>
        </p>
      )}
      {api.openScript && (
        <div className="flex flex-wrap gap-1.5">
          <KitButton onClick={() => api.openScript!("plot")}>
            <Pencil /> {has ? "Edit script" : "Write a script"}
          </KitButton>
          <KitButton variant="ghost" onClick={() => api.openScript!("controller")} title="The scenario's controller script: it sees and acts on every plot">
            <CodeXml /> Controller script
            <span className={`text-meta ${controllerHas ? "text-script" : "text-fg-meta"}`}>{controllerHas ? (controller?.enabled === false ? "off" : "on") : "none"}</span>
          </KitButton>
        </div>
      )}
    </section>
  );
};