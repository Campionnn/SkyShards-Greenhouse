import React, { useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useFitCellSize } from "../../hooks";
import type { FlowRunnerState, PlotState, ScenarioPlot, SimConfig, TimedEvent } from "../../simulator";
import { getGroundImagePath } from "../../types/greenhouse";
import { getCellPixelPosition, getGridDimensions } from "../../utilities";
import { CropImage } from "../shared";
import { kindData, nameOf } from "./format";
import { SimTooltip, type TooltipTarget } from "./SimTooltip";
import { buttonClass } from "./styles";

type Mark = "harvested" | "spawned" | "decayed" | "destroyed" | "debt" | "teleported" | "exploded";

const MARK_STYLE: Record<Mark, { ring: string; glyph: string; color: string; label: string }> = {
  harvested: { ring: "rgba(234,179,8,0.9)", glyph: "✦", color: "text-yellow-300", label: "harvested" },
  spawned: { ring: "rgba(52,211,153,0.9)", glyph: "+", color: "text-emerald-300", label: "spawned" },
  decayed: { ring: "rgba(248,113,113,0.9)", glyph: "✕", color: "text-red-300", label: "decayed / died" },
  destroyed: { ring: "rgba(251,146,60,0.9)", glyph: "✕", color: "text-orange-300", label: "destroyed" },
  debt: { ring: "rgba(239,68,68,0.95)", glyph: "!", color: "text-red-400", label: "short of an item" },
  teleported: { ring: "rgba(192,132,252,0.9)", glyph: "»", color: "text-purple-300", label: "teleported here" },
  exploded: { ring: "rgba(244,63,94,0.95)", glyph: "✹", color: "text-rose-400", label: "exploded" },
};

/** Footprint size of a plant / item id (large mutations mark their whole footprint). */
const sizeOf = (id: string): number => kindData(id)?.size ?? 1;

/** Key for the grid marks; they show what happened in the last simulated cycle. */
export const PlotMarkLegend: React.FC = () => (
  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
    {(Object.keys(MARK_STYLE) as Mark[]).map((m) => (
      <span key={m} className="flex items-center gap-1">
        <span className={`font-bold ${MARK_STYLE[m].color}`}>{MARK_STYLE[m].glyph}</span>
        {MARK_STYLE[m].label}
      </span>
    ))}
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded border border-dashed border-cyan-400/70" />
      empty target cell
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded border border-dashed border-red-500/70" />
      missing - no stock to re-place
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded" style={{ boxShadow: "inset 0 0 0 1px rgba(103,232,249,0.7)" }} />
      natural spawn
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded" style={{ boxShadow: "inset 0 0 0 2px rgba(251,146,60,0.8)" }} />
      rival
    </span>
  </div>
);

function marksFrom(events: TimedEvent[]): Map<string, { mark: Mark; size: number }> {
  const marks = new Map<string, { mark: Mark; size: number }>();
  for (const e of events) {
    const at = (r: number, c: number, mark: Mark, size = 1) => marks.set(`${r},${c}`, { mark, size });
    if (e.kind === "harvested") at(e.row, e.col, "harvested", sizeOf(e.kindId));
    else if (e.kind === "spawned") at(e.row, e.col, "spawned", sizeOf(e.mutationId));
    else if (e.kind === "decayed" || e.kind === "diedOfThirst") at(e.row, e.col, "decayed", sizeOf(e.kindId));
    else if (e.kind === "destroyed") at(e.row, e.col, "destroyed", sizeOf(e.kindId));
    else if (e.kind === "debt") at(e.row, e.col, "debt", sizeOf(e.item));
    else if (e.kind === "teleported") at(e.row, e.col, "teleported");
    else if (e.kind === "exploded") at(e.row, e.col, "exploded");
  }
  return marks;
}

export interface PlotViewProps {
  plot: PlotState;
  runner: FlowRunnerState | undefined;
  def: ScenarioPlot | undefined;
  events: TimedEvent[];
  onEditRotation?: () => void;
  /** Largest cell size in px (the focused single-plot view uses a bigger one). */
  maxCell?: number;
  /** Unresolved shortfalls ("plot:row,col:item"): layout plants the player could not afford to re-place. */
  openDebts?: string[];
  /** For the hover cards: current stage length and the scenario's config. */
  stageSeconds: number;
  config: SimConfig;
}

/** One plot, read-only: standing plants, empty labelled target cells, and what changed this cycle. */
export const PlotView: React.FC<PlotViewProps> = ({
  plot,
  runner,
  def,
  events,
  onEditRotation,
  maxCell = 48,
  openDebts = [],
  stageSeconds,
  config,
}) => {
  const fitRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<TooltipTarget | null>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: maxCell, min: 16 });
  const { width, height } = getGridDimensions(cellSize, gap);
  const marks = useMemo(() => marksFrom(events), [events]);

  const stage = def && runner ? def.flow.stages[runner.stageIndex] : undefined;
  const occupied = new Set<string>();
  for (const p of plot.plants) {
    for (let dr = 0; dr < p.size; dr++) for (let dc = 0; dc < p.size; dc++) occupied.add(`${p.row + dr},${p.col + dc}`);
  }
  const counts = {
    standing: plot.plants.filter((p) => p.origin !== "spawned" && !p.isDeadPlant).length,
    spawns: plot.plants.filter((p) => p.origin === "spawned").length,
    dead: plot.plants.filter((p) => p.isDeadPlant).length,
    openSlots: plot.slots.filter((s) => !occupied.has(`${s.row},${s.col}`)).length,
  };
  const missing = openDebts
    .filter((k) => k.startsWith(`${plot.id}:`))
    .map((k) => {
      const [, cell, item] = k.split(":");
      const [row, col] = cell.split(",").map(Number);
      return { row, col, item };
    })
    .filter((m) => !occupied.has(`${m.row},${m.col}`));

  return (
    <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 min-w-0 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-slate-200">Plot {plot.id}</h3>
          {stage && (
            <p className="text-xs text-slate-400 break-words">
              <span className="text-slate-500">
                Stage {runner!.stageIndex + 1}/{def!.flow.stages.length}
              </span>{" "}
              {stage.label || stage.id}
              <span className="text-slate-500"> · {runner!.cyclesInStage} cycles in</span>
              {runner!.pendingTransition && <span className="text-amber-300"> · change pending</span>}
              {runner!.finished && <span className="text-slate-500"> · holding final stage</span>}
            </p>
          )}
        </div>
        {onEditRotation && (
          <button className={`${buttonClass.neutral} flex-shrink-0`} onClick={onEditRotation} title="Edit this plot's rotation">
            <Pencil className="w-3 h-3" />
            Rotation
          </button>
        )}
      </div>

      <div ref={fitRef} className="w-full">
        <div className="relative mx-auto select-none" style={{ width, height }}>
          {Array.from({ length: 100 }, (_, i) => {
            const r = Math.floor(i / 10);
            const c = i % 10;
            const key = `${r},${c}`;
            if (occupied.has(key)) return null;
            const { top, left } = getCellPixelPosition(r, c, cellSize, gap);
            const ground = plot.groundOverrides[key] ?? plot.groundTiles[key];
            return (
              <div
                key={key}
                className={`absolute rounded border ${ground ? "border-emerald-700/20" : "border-slate-700/20"}`}
                style={{ top, left, width: cellSize, height: cellSize, ...(ground ? { backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: `${cellSize}px ${cellSize}px` } : {}) }}
                title={ground ? (plot.groundOverrides[key] ? `${ground.replaceAll("_", " ")} (changed during simulation)` : ground.replaceAll("_", " ")) : "air (no ground)"}
              />
            );
          })}

          {plot.slots.map((s) => {
            const { top, left } = getCellPixelPosition(s.row, s.col, cellSize, gap);
            const size = s.size * cellSize + (s.size - 1) * gap;
            if (occupied.has(`${s.row},${s.col}`)) return null;
            return (
              <div
                key={`slot-${s.row}-${s.col}`}
                className="absolute rounded border-2 border-dashed border-cyan-400/70 bg-cyan-500/10 flex items-center justify-center pointer-events-auto"
                style={{ top, left, width: size, height: size }}
                onMouseEnter={() => setHover({ kind: "slot", slot: s, ineligibleCycles: plot.slotIneligibleCycles[`${s.row},${s.col}`] ?? 0 })}
                onMouseLeave={() => setHover(null)}
              >
                <div className="opacity-45 grayscale-[40%]">
                  <CropImage cropId={s.mutationId} cropName={nameOf(s.mutationId)} width={size * 0.6} height={size * 0.6} showFallback={false} />
                </div>
                {plot.slotIneligibleCycles[`${s.row},${s.col}`] > 0 && (
                  <span className="absolute bottom-0 right-0.5 text-[9px] text-amber-300">⚠</span>
                )}
              </div>
            );
          })}

          {plot.plants.map((p) => {
            const { top, left } = getCellPixelPosition(p.row, p.col, cellSize, gap);
            const size = p.size * cellSize + (p.size - 1) * gap;
            const ground = plot.groundOverrides[`${p.row},${p.col}`] ?? plot.groundTiles[`${p.row},${p.col}`];
            const growing = !p.isDeadPlant && p.origin !== "placed" && p.readyStage > 0 && p.stage < p.readyStage;
            return (
              <div
                key={p.id}
                className="absolute rounded overflow-hidden flex items-center justify-center cursor-default"
                onMouseEnter={() => setHover({ kind: "plant", plant: p })}
                onMouseLeave={() => setHover(null)}
                style={{
                  top,
                  left,
                  width: size,
                  height: size,
                  ...(ground ? { backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: `${cellSize}px ${cellSize}px` } : {}),
                  boxShadow: p.isRival
                    ? "inset 0 0 0 2px rgba(251,146,60,0.8)"
                    : p.origin === "spawned"
                      ? "inset 0 0 0 1px rgba(103,232,249,0.7)"
                      : p.kindId === "devourer_root"
                        ? "inset 0 0 0 2px rgba(190,18,60,0.8)"
                        : undefined,
                  filter: p.isDeadPlant ? "grayscale(1) brightness(0.55)" : p.frozen ? "hue-rotate(180deg) saturate(0.6)" : undefined,
                }}
              >
                <CropImage
                  cropId={p.kindId}
                  cropName={nameOf(p.kindId)}
                  width={size * (p.size === 1 ? 0.8 : 0.6)}
                  height={size * (p.size === 1 ? 0.8 : 0.6)}
                  hasGroundContext
                  showFallback
                />
                {growing && (
                  <div className="absolute bottom-0 left-0 h-[3px] bg-emerald-400/80" style={{ width: `${(p.stage / p.readyStage) * 100}%` }} />
                )}
                {(p.gate.asleep || p.gate.ratAlive) && <span className="absolute top-0 right-0.5 text-[9px] text-amber-300">z</span>}
                {p.kindId === "blastberry" && p.gate.primed && <span className="absolute top-0 left-0.5 text-[9px] text-rose-400">✹</span>}
              </div>
            );
          })}

          {missing.map((m) => {
            const { top, left } = getCellPixelPosition(m.row, m.col, cellSize, gap);
            const size = sizeOf(m.item) * cellSize + (sizeOf(m.item) - 1) * gap;
            return (
              <div
                key={`missing-${m.row}-${m.col}`}
                className="absolute rounded border-2 border-dashed border-red-500/70 bg-red-500/10 flex items-center justify-center"
                style={{ top, left, width: size, height: size }}
                onMouseEnter={() => setHover({ kind: "missing", item: m.item, row: m.row, col: m.col })}
                onMouseLeave={() => setHover(null)}
              >
                <div className="opacity-35">
                  <CropImage cropId={m.item} cropName={nameOf(m.item)} width={size * 0.7} height={size * 0.7} showFallback={false} />
                </div>
                <span className="absolute top-0 right-0.5 text-[10px] font-bold text-red-400">!</span>
              </div>
            );
          })}

          {[...marks.entries()].map(([key, { mark, size: cells }]) => {
            const [r, c] = key.split(",").map(Number);
            const { top, left } = getCellPixelPosition(r, c, cellSize, gap);
            const span = cells * cellSize + (cells - 1) * gap;
            const style = MARK_STYLE[mark];
            return (
              <div
                key={`mark-${key}`}
                className="absolute rounded pointer-events-none flex items-start justify-end"
                style={{ top, left, width: span, height: span, boxShadow: `0 0 0 2px ${style.ring}` }}
              >
                <span className={`text-[10px] leading-none font-bold ${style.color} drop-shadow`} style={{ marginTop: 1, marginRight: 2 }}>
                  {style.glyph}
                </span>
              </div>
            );
          })}

          {hover && (
            <SimTooltip
              target={hover}
              cellSize={cellSize}
              gap={gap}
              gridWidth={width}
              gridHeight={height}
              stageSeconds={stageSeconds}
              config={config}
            />
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>{counts.standing} placed/planted</span>
        <span className="text-cyan-300/90">{counts.spawns} natural spawns</span>
        <span>{counts.openSlots} open target cells</span>
        {counts.dead > 0 && <span className="text-red-300/90">{counts.dead} dead plants</span>}
        {missing.length > 0 && <span className="text-red-300">{missing.length} missing (no stock)</span>}
      </div>
    </div>
  );
};
