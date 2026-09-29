import React, { useMemo, useState } from "react";
import { History, ListOrdered, Play, RotateCcw, Square, StepForward } from "lucide-react";
import type { FlowRunnerState, ScenarioPlot, TimedEvent } from "../../simulator";
import type { SimulationView } from "../../hooks/useSimulation";
import { LOG_CYCLES } from "../../hooks/useSimulation";
import { Panel, SegmentedControl } from "../ui";
import { debtText, describeEvent, formatCoins, formatDuration } from "./format";
import { buttonClass, inputClass } from "./styles";

/** Visible bound for one Run (the reference tool uses 1-500); the engine itself is uncapped. */
const MAX_RUN = 500;

// ---- Run controls -----------------------------------------------------------

export const RunControls: React.FC<{
  view: SimulationView;
  plotCount: number;
  onRun: (n: number) => void;
  onStep: () => void;
  onStop: () => void;
  onReset: () => void;
  seed: number;
  onSeedChange: (seed: number) => void;
}> = ({ view, plotCount, onRun, onStep, onStop, onReset, seed, onSeedChange }) => {
  const [n, setN] = useState(200);
  const running = view.status === "running";
  const ready = view.status === "ready";
  // While a run is in flight, show the worker's running totals.
  const summary = (running && view.progress?.summary) || view.snapshot?.state.summary;

  let status = "Loading...";
  if (view.status === "error") status = "Scenario has errors - see the Scenario panel.";
  else if (running && view.progress) status = `${view.progress.done} / ${view.progress.total} cycles`;
  else if (ready && summary) {
    status = view.lastCall
      ? `${view.lastCall.truncated ? "Stopped after" : "Ran"} ${view.lastCall.cyclesRun} cycle${view.lastCall.cyclesRun === 1 ? "" : "s"} on ${plotCount} plot(s). Rivals: ${summary.rivals.spawned} spawned, ${summary.rivals.cleared} cleared.`
      : `Set up ${plotCount} plot(s). Cycle ${view.snapshot!.state.cycle}.`;
  }

  return (
    <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonClass.primary} onClick={() => onRun(n)} disabled={!ready} title="Run N growth cycles">
          <Play className="w-3.5 h-3.5" /> Run
        </button>
        <input
          type="range"
          min={1}
          max={MAX_RUN}
          value={n}
          onChange={(e) => setN(e.target.valueAsNumber)}
          className="w-32 accent-emerald-500"
          aria-label="Cycles to run"
        />
        <input
          type="number"
          min={1}
          max={100000}
          value={n}
          onChange={(e) => setN(Math.max(1, e.target.valueAsNumber || 1))}
          className={`${inputClass} w-20 text-right`}
          aria-label="Cycles to run"
        />
        <button className={buttonClass.neutral} onClick={onStep} disabled={!ready} title="Advance exactly one growth cycle">
          <StepForward className="w-3.5 h-3.5" /> Step
        </button>
        <button className={buttonClass.danger} onClick={onStop} disabled={!running}>
          <Square className="w-3.5 h-3.5" /> Stop
        </button>
        <button className={buttonClass.neutral} onClick={onReset} disabled={running || view.status === "loading"} title="Back to cycle 0">
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-400 ml-auto" title="Changing the seed restarts the simulation">
          seed
          <input
            type="number"
            className={`${inputClass} w-24 text-right`}
            value={seed}
            onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onSeedChange(e.target.valueAsNumber)}
            disabled={running}
          />
        </label>
      </div>
      <div className="h-1 bg-slate-700/50 rounded overflow-hidden">
        {running && view.progress && (
          <div className="h-full bg-emerald-500/80 transition-all" style={{ width: `${(view.progress.done / Math.max(1, view.progress.total)) * 100}%` }} />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-slate-400">{status}</p>
        {summary && view.snapshot && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-slate-400">
              Profit <span className="text-slate-100 font-medium">{formatCoins(summary.profit)}</span>
            </span>
            <span className="text-slate-400">
              <span className="text-emerald-300 font-medium">{formatCoins(summary.coinsPerDay)}</span>/day
            </span>
            <span className="text-slate-400">
              {summary.cyclesRun} cycles · {formatDuration(summary.elapsedSeconds)}
            </span>
            {(running ? summary.debtEvents === 0 : view.snapshot.report.sustainable) ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">no debt</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30" title={view.snapshot.report.firstDebt ? debtText(view.snapshot.report.firstDebt) : undefined}>
                {running ? "in debt" : `debt at cycle ${view.snapshot.report.firstDebt?.cycle}`}
              </span>
            )}
          </div>
        )}
      </div>
      {view.error && view.status !== "error" && <p className="text-xs text-red-300">{view.error}</p>}
    </div>
  );
};

// ---- Recent events --------------------------------------------------------

export const EventLog: React.FC<{ log: TimedEvent[]; plotIds: number[] }> = ({ log, plotIds }) => {
  const [plot, setPlot] = useState(String(plotIds[0] ?? 1));
  const selected = plotIds.includes(Number(plot)) ? Number(plot) : plotIds[0];
  const byCycle = useMemo(() => {
    const groups = new Map<number, TimedEvent[]>();
    for (const e of log) {
      if (e.plotId !== selected) continue;
      const g = groups.get(e.cycle) ?? [];
      g.push(e);
      groups.set(e.cycle, g);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [log, selected]);

  return (
    <Panel title="Recent events" icon={<ListOrdered />} description={`Last ${LOG_CYCLES} cycles, newest first.`}>
      {plotIds.length > 1 && (
        <SegmentedControl
          size="xs"
          className="mb-2"
          value={String(selected)}
          onChange={setPlot}
          options={plotIds.map((id) => ({ value: String(id), label: `Plot ${id}` }))}
        />
      )}
      <div className="max-h-72 overflow-y-auto scrollbar-dark pr-1 space-y-2">
        {byCycle.length === 0 && <p className="text-xs text-slate-500">Nothing yet - Step or Run.</p>}
        {byCycle.map(([cycle, events]) => (
          <div key={cycle}>
            <div className="text-[11px] text-slate-500 uppercase tracking-wide">Cycle {cycle}</div>
            <ul className="text-xs text-slate-300 space-y-0.5">
              {events.map((e, i) => (
                <li key={i} className={e.kind === "debt" ? "text-red-300" : e.kind === "spawned" ? "text-emerald-200" : undefined}>
                  {describeEvent(e)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
};

// ---- Stage timeline -------------------------------------------------------

export const StageTimeline: React.FC<{ flows: FlowRunnerState[]; defs: ScenarioPlot[]; cycle: number }> = ({ flows, defs, cycle }) => {
  const span = Math.max(1, cycle);
  const colours = ["bg-emerald-500/50", "bg-blue-500/50", "bg-purple-500/50", "bg-amber-500/50", "bg-cyan-500/50", "bg-pink-500/50"];
  return (
    <Panel title="Stage timeline" icon={<History />} description="Each plot runs its own rotation on the shared clock.">
      <div className="space-y-2">
        <div className="flex justify-between text-[10px] text-slate-500 pl-14">
          <span>cycle 0</span>
          <span>cycle {cycle}</span>
        </div>
        {flows.map((f) => {
          const def = defs.find((d) => d.id === f.plotId);
          return (
            <div key={f.plotId} className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-12 flex-shrink-0">Plot {f.plotId}</span>
              <div className="relative flex-1 h-5 bg-slate-700/30 rounded overflow-hidden">
                {f.history.map((h, i) => {
                  const end = h.endCycle ?? cycle;
                  const left = (h.startCycle / span) * 100;
                  const width = Math.max(0.5, ((end - h.startCycle) / span) * 100);
                  const label = def?.flow.stages[h.stageIndex]?.label || h.stageId;
                  return (
                    <div
                      key={i}
                      className={`absolute top-0 bottom-0 ${colours[h.stageIndex % colours.length]} border-r border-slate-900/60 text-[10px] text-slate-100 flex items-center justify-center overflow-hidden`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${label}: cycles ${h.startCycle}-${h.endCycle ?? "now"}`}
                    >
                      {width >= 2.5 ? h.stageIndex + 1 : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {defs.map((d) =>
            d.flow.stages.map((s, i) => (
              <span key={`${d.id}-${s.id}`} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className={`inline-flex w-4 h-4 items-center justify-center rounded text-[10px] text-slate-100 ${colours[i % colours.length]}`}>{i + 1}</span>
                Plot {d.id}: {s.label || s.id}
              </span>
            ))
          )}
        </div>
      </div>
    </Panel>
  );
};
