import React, { useCallback, useId, useMemo, useState } from "react";
import { History, Pin, Search, X } from "lucide-react";
import type { FlowRunnerState, ScenarioPlot } from "../../simulator";
import { Panel } from "../ui";
import { buttonClass, inputClass } from "./styles";
import { timelineEntryAt, timelineGeometry, timelineStats } from "./timeline";

const COLOURS = ["bg-emerald-500/60", "bg-blue-500/60", "bg-purple-500/60", "bg-amber-500/60", "bg-cyan-500/60", "bg-pink-500/60"];

type Inspection = { plotId: number; stepId: string; startCycle?: number; historyIndex?: number; atCycle?: number };

type Props = { flows: FlowRunnerState[]; defs: ScenarioPlot[]; cycle: number };

/** Time-based hit testing keeps even sub-pixel visits inspectable without distorting the bars. */
export const FlowTimeline: React.FC<Props> = ({ flows, defs, cycle }) => {
  const [hovered, setHovered] = useState<Inspection | null>(null);
  const [pinned, setPinned] = useState<Inspection | null>(null);
  const [pointerPlot, setPointerPlot] = useState<number | null>(null);
  const [windowSize, setWindowSize] = useState(0);
  const detailId = useId();
  const [previousCycle, setPreviousCycle] = useState(cycle);
  if (previousCycle !== cycle) {
    setPreviousCycle(cycle);
    if (cycle < previousCycle) { setPinned(null); setHovered(null); }
  }
  const lastEntries = useMemo(() => new Map(flows.map((runner) => {
    let index = runner.history.length - 1;
    while (index >= 0 && runner.history[index].skipped) index--;
    return [runner.plotId, runner.history[index]];
  })), [flows]);
  const fromCycle = windowSize ? Math.max(0, cycle - windowSize) : 0;
  const span = Math.max(1, cycle - fromCycle);
  const valid = (selection: Inspection | null) => {
    if (!selection || !defs.some((d) => d.id === selection.plotId && d.flow.steps.some((s) => s.id === selection.stepId))) return null;
    if (selection.historyIndex !== undefined) {
      const entry = flows.find((f) => f.plotId === selection.plotId)?.history[selection.historyIndex];
      if (!entry || entry.stepId !== selection.stepId || entry.startCycle !== selection.startCycle) return null;
    }
    return selection;
  };
  const activePin = valid(pinned);
  const selection = activePin ?? valid(hovered);
  if (pinned && !activePin) setPinned(null);
  const hoverLegend = useCallback((value: Inspection | null) => { if (!pinned) setHovered(value); }, [pinned]);
  const pinLegend = useCallback((value: Inspection) => { setPinned(value); setHovered(null); }, []);
  const inspectEntry = (runner: FlowRunnerState, index: number, atCycle?: number): Inspection => ({
    plotId: runner.plotId, historyIndex: index, stepId: runner.history[index].stepId,
    startCycle: runner.history[index].startCycle, atCycle,
  });
  const clear = () => { setPinned(null); setHovered(null); };

  return (
    <Panel title="Step timeline" icon={<History />} description="Hover anywhere on a bar to inspect a visit. Click or tap to pin details; use arrow keys on a focused bar to browse visits.">
      <div className="space-y-3" onPointerLeave={() => setHovered(null)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHovered(null); }} onKeyDown={(e) => { if (e.key === "Escape") clear(); }}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>Shared cycle clock · {cycle.toLocaleString()} cycles</span>
          <label className="flex items-center gap-2">
            View
            <select aria-label="Timeline cycle range" className={inputClass} value={windowSize} onChange={(e) => { setWindowSize(Number(e.target.value)); setHovered(null); }}>
              <option value={0}>Entire run</option>
              <option value={50}>Last 50 cycles</option>
              <option value={200}>Last 200 cycles</option>
              <option value={1000}>Last 1,000 cycles</option>
            </select>
          </label>
        </div>
        <div className="flex justify-between pl-14 text-[11px] text-slate-500 tabular-nums">
          <span>cycle {fromCycle.toLocaleString()}</span>
          <span>cycle {cycle.toLocaleString()}</span>
        </div>
        {flows.map((runner) => {
          const def = defs.find((d) => d.id === runner.plotId);
          const current = def?.flow.steps[runner.stepIndex];
          const selected = selection?.plotId === runner.plotId ? selection : null;
          const selectedEntry = selected?.historyIndex !== undefined ? runner.history[selected.historyIndex] : null;
          const cursor = pointerPlot === runner.plotId ? selected?.atCycle : undefined;
          const atPointer = (e: React.MouseEvent<HTMLDivElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const atCycle = Math.min(cycle, Math.max(fromCycle, fromCycle + ((e.clientX - rect.left) / rect.width) * span));
            const index = timelineEntryAt(runner.history, atCycle);
            return index === null ? null : inspectEntry(runner, index, Math.floor(atCycle));
          };
          const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(e.key)) return;
            e.preventDefault();
            const indices = runner.history.flatMap((h, i) => !h.skipped && timelineGeometry(h, cycle, fromCycle) ? [i] : []);
            if (!indices.length) return;
            const index = selected?.historyIndex ?? indices[indices.length - 1];
            let next = index;
            if (e.key === "Home") next = indices[0];
            else if (e.key === "End") next = indices[indices.length - 1];
            else if (e.key === "ArrowLeft") next = [...indices].reverse().find((i) => i < index) ?? indices[0];
            else if (e.key === "ArrowRight") next = indices.find((i) => i > index) ?? indices[indices.length - 1];
            const value = inspectEntry(runner, next);
            if (e.key === "Enter" || e.key === " ") setPinned(activePin?.plotId === value.plotId && activePin?.historyIndex === value.historyIndex ? null : value);
            else { setPinned(null); setHovered(value); }
          };
          const accessibleEntry = selectedEntry ?? lastEntries.get(runner.plotId);
          const status = runner.finished ? "Holding final step" : runner.pendingTransition ? "Waiting for player session" : "Current";
          return (
            <div key={runner.plotId} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-300">Plot {runner.plotId}</span>
                <div
                  role="slider" tabIndex={0} aria-label={`Plot ${runner.plotId} step timeline`}
                  aria-valuemin={fromCycle} aria-valuemax={cycle} aria-valuenow={Math.max(fromCycle, Math.min(cycle, accessibleEntry?.startCycle ?? 0))}
                  aria-valuetext={accessibleEntry ? `${def?.flow.steps[accessibleEntry.stepIndex]?.label || accessibleEntry.stepId}, cycles ${accessibleEntry.startCycle} to ${accessibleEntry.endCycle ?? "now"}` : "No visits"}
                  aria-describedby={!selection || selected ? detailId : undefined}
                  className="relative h-9 min-w-0 flex-1 rounded bg-slate-700/30 cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                  onPointerEnter={(e) => { if (e.pointerType !== "touch") setPointerPlot(runner.plotId); }}
                  onPointerLeave={() => {
                    setPointerPlot(null);
                    setHovered((previous) => previous?.plotId === runner.plotId ? null : previous);
                  }}
                  onPointerCancel={() => { setPointerPlot(null); setHovered((previous) => previous?.plotId === runner.plotId ? null : previous); }}
                  onPointerMove={(e) => {
                    if (e.pointerType === "touch" || activePin) return;
                    const next = atPointer(e);
                    setHovered((previous) => previous?.plotId === next?.plotId && previous?.historyIndex === next?.historyIndex && previous?.atCycle === next?.atCycle ? previous : next);
                  }}
                  onClick={(e) => {
                    const value = atPointer(e);
                    if (activePin?.plotId === value?.plotId && activePin?.historyIndex === value?.historyIndex) clear();
                    else { setPinned(value); setHovered(null); }
                  }}
                  onFocus={() => {
                    if (!activePin) {
                      let index = runner.history.length - 1;
                      while (index >= 0 && (runner.history[index].skipped || !timelineGeometry(runner.history[index], cycle, fromCycle))) index--;
                      if (index >= 0) setHovered(inspectEntry(runner, index));
                    }
                  }}
                  onBlur={() => setHovered((previous) => previous?.plotId === runner.plotId ? null : previous)}
                  onKeyDown={onKeyDown}
                >
                  <TimelineBars history={runner.history} cycle={cycle} fromCycle={fromCycle} selectedStep={selected?.stepId} />
                  {cursor !== undefined && cursor >= fromCycle && cursor <= cycle && (
                    <div className="absolute inset-y-0 w-px bg-white pointer-events-none" style={{ left: `${((cursor - fromCycle) / span) * 100}%` }} />
                  )}
                </div>
              </div>
              <p className="pl-14 text-xs text-slate-400 break-words">
                {status}: <span className="text-slate-200">{runner.stepIndex + 1}. {current?.label || current?.id || "Unknown step"}</span>
              </p>
            </div>
          );
        })}
        <div id={detailId} className="min-h-28 rounded-md border border-slate-600/40 bg-slate-900/40 p-3">
          {selection ? (
            <TimelineDetails selection={selection} flows={flows} defs={defs} cycle={cycle} pinned={!!activePin} onPin={() => setPinned(selection)} onClear={clear} />
          ) : (
            <div className="space-y-2 text-xs text-slate-400">
              <p className="font-medium text-slate-300">Inspect a step without hunting through the legend</p>
              <p>Hover a bar for its full name, cycle range and time spent. Matching visits of the same step are highlighted.</p>
              <p>Expand a plot’s step list below to search all steps, including skipped and unvisited ones.</p>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {defs.map((def) => (
            <StepLegend key={def.id} def={def} runner={flows.find((f) => f.plotId === def.id)} cycle={cycle} selectedStep={selection?.plotId === def.id ? selection.stepId : undefined}
              onHover={hoverLegend} onPin={pinLegend} />
          ))}
        </div>
      </div>
    </Panel>
  );
};

const TimelineBars = React.memo(function TimelineBars({ history, cycle, fromCycle, selectedStep }: {
  history: FlowRunnerState["history"]; cycle: number; fromCycle: number; selectedStep?: string;
}) {
  return <div className="absolute inset-0 overflow-hidden rounded" aria-hidden="true">
    {history.map((entry, i) => {
      const geometry = timelineGeometry(entry, cycle, fromCycle);
      if (!geometry) return null;
      const highlighted = selectedStep === entry.stepId;
      return <div key={i}
        className={`absolute inset-y-0 flex items-center justify-center border-r border-slate-950/60 text-xs text-white ${COLOURS[entry.stepIndex % COLOURS.length]} ${selectedStep && !highlighted ? "opacity-25" : ""} ${highlighted ? "ring-1 ring-inset ring-white/70" : ""}`}
        style={{ left: `${geometry.left}%`, width: `${geometry.width}%`, minWidth: geometry.width === 0 ? 2 : undefined, transform: geometry.left === 100 ? "translateX(-100%)" : undefined }}
      >{geometry.width >= 4 ? entry.stepIndex + 1 : null}</div>;
    })}
  </div>;
});

function TimelineDetails({ selection, flows, defs, cycle, pinned, onPin, onClear }: {
  selection: Inspection; flows: FlowRunnerState[]; defs: ScenarioPlot[]; cycle: number; pinned: boolean; onPin: () => void; onClear: () => void;
}) {
  const def = defs.find((d) => d.id === selection.plotId)!;
  const runner = flows.find((f) => f.plotId === selection.plotId);
  const index = def.flow.steps.findIndex((s) => s.id === selection.stepId);
  const step = def.flow.steps[index];
  const entry = selection.historyIndex !== undefined ? runner?.history[selection.historyIndex] : undefined;
  const allStats = useMemo(() => timelineStats(runner?.history ?? [], cycle), [runner?.history, cycle]);
  const stats = allStats.get(step.id);
  const visits = stats?.visits ?? 0;
  const status = entry?.endCycle === null ? runner?.finished ? "Holding final step" : runner?.pendingTransition ? "Waiting for player session" : "Current visit" : entry ? "Completed visit" : visits ? "Step summary" : stats?.skipped ? "Skipped on arrival" : "Not visited yet";
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-slate-400">Plot {def.id} · Step {index + 1} · {status}{selection.atCycle !== undefined ? ` · cursor cycle ${selection.atCycle.toLocaleString()}` : ""}</p>
          <p className="mt-1 font-medium text-slate-100 break-words">{step.label || step.id}</p>
        </div>
        <button type="button" className={buttonClass.neutral} onClick={pinned ? onClear : onPin} aria-label={pinned ? "Unpin timeline details" : "Pin timeline details"}>
          {pinned ? <X className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}{pinned ? "Unpin" : "Pin"}
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300 tabular-nums">
        {entry && <span>Cycles {entry.startCycle.toLocaleString()}–{entry.endCycle === null ? `now (${cycle.toLocaleString()})` : entry.endCycle.toLocaleString()} · {Math.max(0, (entry.endCycle ?? cycle) - entry.startCycle).toLocaleString()} cycles this visit</span>}
        <span>{visits.toLocaleString()} built {visits === 1 ? "visit" : "visits"} · {(stats?.cycles ?? 0).toLocaleString()} cycles total</span>
        {!!stats?.skipped && <span className="text-amber-300">{stats.skipped.toLocaleString()} skipped on arrival (no layout built)</span>}
      </div>
    </div>
  );
}

const StepLegend = React.memo(function StepLegend({ def, runner, cycle, selectedStep, onHover, onPin }: {
  def: ScenarioPlot; runner?: FlowRunnerState; cycle: number; selectedStep?: string;
  onHover: (value: Inspection | null) => void; onPin: (value: Inspection) => void;
}) {
  const [query, setQuery] = useState("");
  const stats = useMemo(() => timelineStats(runner?.history ?? [], cycle), [runner?.history, cycle]);
  const needle = query.trim().toLowerCase();
  const filtered = def.flow.steps.flatMap((step, index) => !needle || `${index + 1} ${step.id} ${step.label ?? ""}`.toLowerCase().includes(needle) ? [{ step, index }] : []);
  return (
    <details className="rounded-md border border-slate-600/30 bg-slate-800/30" onToggle={(e) => { if (!e.currentTarget.open) onHover(null); }}>
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-300 focus-visible:outline-emerald-400">Plot {def.id} steps <span className="text-slate-500">· {def.flow.steps.length} total · {Array.from(stats.values()).filter((s) => s.visits > 0).length} visited</span></summary>
      <div className="px-3 pb-3 space-y-2">
        <label className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input type="search" aria-label={`Search Plot ${def.id} steps`} placeholder="Search step names or numbers…" className={`${inputClass} w-full`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <p className="text-[11px] text-slate-500">Hover to highlight all visits. Click to pin a step summary. Counts cover the entire run.</p>
        <div className="max-h-52 overflow-y-auto scrollbar-dark space-y-1">
          {!filtered.length && <p className="py-2 text-xs text-slate-400">No matching steps.</p>}
          {filtered.map(({ step, index }) => {
            const value = { plotId: def.id, stepId: step.id };
            const count = stats.get(step.id);
            const active = selectedStep === step.id;
            return (
              <button key={step.id} type="button" onPointerEnter={(e) => { if (e.pointerType !== "touch") onHover(value); }} onPointerLeave={() => onHover(null)} onPointerCancel={() => onHover(null)} onFocus={() => onHover(value)} onBlur={() => onHover(null)} onClick={() => onPin(value)}
                className={`flex w-full items-start gap-2 rounded border px-2 py-2 text-left text-xs cursor-pointer focus-visible:outline-emerald-400 ${active ? "border-emerald-500/50 bg-emerald-500/10" : "border-transparent hover:bg-slate-700/40"}`}>
                <span className={`inline-flex min-w-6 h-6 px-1 shrink-0 items-center justify-center rounded text-white ${COLOURS[index % COLOURS.length]}`}>{index + 1}</span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block break-words text-slate-200">{step.label || step.id}{runner?.stepIndex === index && <span className="ml-2 text-emerald-300">· current</span>}</span>
                  <span className="block text-slate-500">{count?.visits ? `${count.visits} built visits · ${count.cycles} cycles` : "Not built yet"}{count?.skipped ? ` · ${count.skipped} skipped` : ""}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
});
