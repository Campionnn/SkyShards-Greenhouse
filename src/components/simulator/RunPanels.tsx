import React, { useMemo, useState } from "react";
import type { TimedEvent } from "../../simulator";
export { FlowTimeline } from "./FlowTimeline";
import { LOG_CYCLES } from "../../hooks/useSimulation";
import { Segmented } from "../ui/kit";
import { ResultCard } from "./page/ResultCard";
import { describeEvent } from "./format";

// ---- Recent events --------------------------------------------------------

export const EventLog: React.FC<{ log: TimedEvent[]; plotIds: number[]; className?: string }> = ({ log, plotIds, className }) => {
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
    <ResultCard
      title="Recent events"
      className={className}
      meta={`last ${LOG_CYCLES} cycles, newest first`}
      actions={
        plotIds.length > 1 ? (
          <Segmented label="Plot" value={String(selected)} onChange={setPlot} options={plotIds.map((id) => ({ value: String(id), label: `Plot ${id}` }))} />
        ) : undefined
      }
    >
      <div className="max-h-[420px] overflow-y-auto overscroll-contain pr-1 scrollbar-dark">
        {byCycle.length === 0 && <p className="text-[12.5px] text-slate-500">Nothing yet. Step or Run.</p>}
        <ol className="space-y-3">
          {byCycle.map(([cycle, events]) => (
            <li key={cycle} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
              <span className="pt-px text-[11px] tabular-nums text-slate-500">Cycle {cycle}</span>
              <ul className="space-y-0.5 text-[12.5px] text-slate-300">
                {events.map((e, i) => (
                  <li key={i} className={e.kind === "debt" ? "text-red-300" : e.kind === "spawned" ? "text-slate-100" : undefined}>
                    {describeEvent(e)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </ResultCard>
  );
};
