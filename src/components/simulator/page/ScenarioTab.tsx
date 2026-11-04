import React from "react";
import { Copy, Download, Eraser, FolderInput, Pencil, Plus, Trash2, Trophy, Upload } from "lucide-react";
import { MAX_PLOTS, type Scenario, type ScenarioIssue } from "../../../simulator";
import { useContextMenu, type ContextMenuEntry } from "../../ui/contextMenuContext";
import { IconButton, KitButton, KitLabel } from "../../ui/kit";
import { surface } from "../../ui/surface";
import { addPlot, layoutSummary } from "../scenarioEdit";

// The drawer's Scenario tab: the plot list (edit flow, duplicate, remove), adding plots, problems
// and sharing. The same actions also live on the page (plot ⋯ menus, the Add-plot tile, the
// Problems pill, the Share menu); this is the one place that lists them all.

export const ScenarioTab: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  onEditFlow: (plotId: number) => void;
  onDuplicate: (plotId: number) => void;
  onRemove: (plotId: number) => void;
  /** Right-click menu for a plot row (needs a ContextMenuProvider above). */
  plotMenu?: (plotId: number) => ContextMenuEntry[];
  onLoadLayout: () => void;
  issues: ScenarioIssue[];
  warnings: ScenarioIssue[];
  error: string | null;
  onExport: () => void;
  onImport: () => void;
  onSubmit: () => void;
  /** Wipe everything back to a fresh simulator (the page shows an Undo toast). */
  onStartOver?: () => void;
}> = ({ scenario, onChange, onEditFlow, onDuplicate, onRemove, plotMenu, onLoadLayout, issues, warnings, error, onExport, onImport, onSubmit, onStartOver }) => {
  const openMenu = useContextMenu();
  const errors = issues.filter((i) => i.level === "error");
  const full = scenario.plots.length >= MAX_PLOTS;
  return (
    <div className="space-y-5">
      <section>
        <KitLabel className="mb-2">Plots · {scenario.plots.length} of {MAX_PLOTS}</KitLabel>
        <ul className="space-y-1.5">
          {scenario.plots.map((p) => (
            <li key={p.id} className={`flex items-center gap-2 px-3 py-2 ${surface.card}`} onContextMenu={plotMenu ? (e) => openMenu(e, plotMenu(p.id)) : undefined}>
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium text-fg">Plot {p.id}</div>
                <div className="truncate text-secondary text-fg-meta">
                  {p.flow.steps.length} step{p.flow.steps.length > 1 ? "s" : ""}
                  {p.flow.loop ? ", looping" : ""}
                  {p.script?.source.trim() ? (p.script.enabled === false ? ", script off" : ", scripted") : ""} ·{" "}
                  {layoutSummary(p.flow.steps[p.flow.startIndex]?.layout ?? { code: "" })}
                </div>
              </div>
              <KitButton variant="ghost" onClick={() => onEditFlow(p.id)}>
                <Pencil /> Flow
              </KitButton>
              <IconButton aria-label={full ? "All three plots are in use" : "Duplicate this plot"} disabled={full} onClick={() => onDuplicate(p.id)}>
                <Copy />
              </IconButton>
              <IconButton aria-label="Remove plot" disabled={scenario.plots.length <= 1} onClick={() => onRemove(p.id)}>
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <KitButton variant="accent" onClick={onLoadLayout} title="From the Calculator, the Designer, your saved layouts or a share link">
            <FolderInput /> Load layout…
          </KitButton>
          <KitButton variant="ghost" onClick={() => onChange(addPlot(scenario))} disabled={full}>
            <Plus /> Empty plot
          </KitButton>
        </div>
      </section>

      {(errors.length > 0 || error || warnings.length > 0) && (
        <section>
          <KitLabel className="mb-2">Problems</KitLabel>
          <ul className="space-y-1.5">
            {(errors.length ? errors : error ? [{ level: "error" as const, path: "Scenario", message: error }] : []).map((i, k) => (
              <li key={`e${k}`} className="rounded-control border border-problem/25 bg-problem/5 px-3 py-2 text-secondary">
                <div className="text-fg-muted">{i.path}</div>
                <div className="text-problem">{i.message}</div>
              </li>
            ))}
            {warnings.map((i, k) => (
              <li key={`w${k}`} className="rounded-control border border-warn/20 bg-warn/5 px-3 py-2 text-secondary">
                <div className="text-fg-muted">{i.path}</div>
                <div className="text-warn">{i.message}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <KitLabel className="mb-2">Share</KitLabel>
        <div className="flex flex-wrap gap-2">
          <KitButton onClick={onExport} title="Choose what to include, then download and copy your flows as JSON">
            <Download /> Export flows
          </KitButton>
          <KitButton onClick={onImport} title="Replace your plots from an exported flows file">
            <Upload /> Import flows
          </KitButton>
          <KitButton onClick={onSubmit} title="Put these flows on the public leaderboard (log in with Discord)">
            <Trophy className="text-coin" /> Submit to leaderboard
          </KitButton>
        </div>
      </section>

      {onStartOver && (
        <section>
          <KitLabel className="mb-2">Start over</KitLabel>
          <KitButton variant="danger" onClick={onStartOver} title="Remove every plot, flow and script, empty the starting inventory and restore every setting to its default (you can undo it)">
            <Eraser /> Start over
          </KitButton>
        </section>
      )}
    </div>
  );
};
