import React, { useMemo, useRef, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useFitCellSize } from "../../hooks";
import {
  defaultGameData,
  isDry,
  sanityCheck,
  type FlowRunnerState,
  type PlantState,
  type PlotState,
  type SanityCheckResult,
  type ScenarioPlot,
  type SimConfig,
  type SimulationState,
  type TimedEvent,
  type WatchStatus,
} from "../../simulator";
import { getGroundImagePath } from "../../types/greenhouse";
import { getCellPixelPosition, getGridDimensions } from "../../utilities";
import { CropImage } from "../shared";
import { kindData, nameOf } from "./format";
import { hoveredCellOffset } from "./sanityFormat";
import { SimTooltip, type TooltipTarget } from "./SimTooltip";
import { buttonClass } from "./styles";

type Mark =
  | "harvested"
  | "spawned"
  | "decayed"
  | "extended"
  | "dried"
  | "destroyed"
  | "debt"
  | "teleported"
  | "exploded"
  | "groundFixed"
  | "minigameRetry";

/** Tint for a dried-out (halted) plant: washed out and sandy, still clearly a living plant (unlike a Dead Plant's grey). */
const DRY_FILTER = "sepia(0.85) saturate(0.6) brightness(0.8)";

const MARK_STYLE: Record<Mark, { ring: string; glyph: string; color: string; label: string }> = {
  harvested: { ring: "rgba(234,179,8,0.9)", glyph: "✦", color: "text-yellow-300", label: "harvested" },
  spawned: { ring: "rgba(52,211,153,0.9)", glyph: "+", color: "text-emerald-300", label: "spawned" },
  decayed: { ring: "rgba(248,113,113,0.9)", glyph: "✕", color: "text-red-300", label: "decayed" },
  extended: { ring: "rgba(129,140,248,0.9)", glyph: "⧗", color: "text-indigo-300", label: "decay timer extended (minimum mutations not met)" },
  dried: { ring: "rgba(217,119,6,0.95)", glyph: "◌", color: "text-amber-500", label: "dried out (halted until watered)" },
  destroyed: { ring: "rgba(251,146,60,0.9)", glyph: "✕", color: "text-orange-300", label: "destroyed" },
  debt: { ring: "rgba(239,68,68,0.95)", glyph: "!", color: "text-red-400", label: "short of an item" },
  teleported: { ring: "rgba(192,132,252,0.9)", glyph: "»", color: "text-purple-300", label: "teleported here" },
  exploded: { ring: "rgba(244,63,94,0.95)", glyph: "✹", color: "text-rose-400", label: "exploded" },
  groundFixed: { ring: "rgba(163,230,53,0.9)", glyph: "▦", color: "text-lime-300", label: "ground fixed" },
  minigameRetry: { ring: "rgba(250,204,21,0.9)", glyph: "↻", color: "text-yellow-400", label: "minigame failed, retry next session" },
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
      <Eye className="w-3 h-3 text-cyan-300/80" />
      empty checked target (cyan: ready or not yet evaluated)
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded border border-dashed border-amber-400/80" />
      checked target blocked by something else
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded border border-dashed border-red-500/80" />
      checked target without its requirements (not sustainable)
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded border-2 border-dashed border-amber-600/90" style={{ filter: DRY_FILTER }} />
      checked target standing there dried out (halted: downtime, still sustainable)
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded border border-dashed border-slate-500/60" />
      target not checked
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
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded" style={{ boxShadow: "inset 0 0 0 2px rgba(190,18,60,0.8)" }} />
      devourer root
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-[3px] bg-emerald-400/80" />
      still growing (bar = progress)
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded bg-slate-500" style={{ filter: "grayscale(1) brightness(0.55)" }} />
      dead plant
    </span>
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded bg-emerald-500" style={{ filter: DRY_FILTER }} />
      dried out - halted until watered
    </span>
    <span className="flex items-center gap-1">
      <span className="text-[9px] text-amber-300">z</span>
      asleep / rat present / overcharged
    </span>
    <span className="flex items-center gap-1">
      <span className="text-[9px] text-rose-400">✹</span>
      blastberry primed
    </span>
    <span className="flex items-center gap-1">
      <span className="text-[9px] text-amber-300">⚠</span>
      target requirements unmet
    </span>
  </div>
);

function marksFrom(events: TimedEvent[]): Map<string, { mark: Mark; size: number }> {
  const marks = new Map<string, { mark: Mark; size: number }>();
  for (const e of events) {
    const at = (r: number, c: number, mark: Mark, size = 1) => marks.set(`${r},${c}`, { mark, size });
    if (e.kind === "harvested") at(e.row, e.col, "harvested", sizeOf(e.kindId));
    else if (e.kind === "spawned") at(e.row, e.col, "spawned", sizeOf(e.mutationId));
    else if (e.kind === "decayed") at(e.row, e.col, "decayed", sizeOf(e.kindId));
    else if (e.kind === "decayExtended") at(e.row, e.col, "extended", sizeOf(e.kindId));
    else if (e.kind === "driedOut") at(e.row, e.col, "dried", sizeOf(e.kindId));
    else if (e.kind === "destroyed") at(e.row, e.col, "destroyed", sizeOf(e.kindId));
    else if (e.kind === "debt") at(e.row, e.col, "debt", sizeOf(e.item));
    else if (e.kind === "teleported") at(e.row, e.col, "teleported");
    else if (e.kind === "exploded") at(e.row, e.col, "exploded");
    else if (e.kind === "groundFixed") at(e.row, e.col, "groundFixed");
    // A destroyed one already shows the "destroyed" mark; only the retry (plant left standing) needs its own.
    else if (e.kind === "minigameFailed" && e.outcome === "retry") at(e.row, e.col, "minigameRetry", sizeOf(e.kindId));
  }
  return marks;
}

export interface PlotViewProps {
  plot: PlotState;
  runner: FlowRunnerState | undefined;
  def: ScenarioPlot | undefined;
  events: TimedEvent[];
  onEditFlow?: () => void;
  /** Largest cell size in px (the focused single-plot view uses a bigger one). */
  maxCell?: number;
  /** Unresolved shortfalls ("plot:row,col:item"): layout plants the player could not afford to re-place. */
  openDebts?: string[];
  /** For the hover cards: current cycle length and the scenario's config. */
  cycleSeconds: number;
  config: SimConfig;
  /**
   * The Sanity Check inspector: pass the snapshot state to turn it on. Hovering
   * an empty cell (or a target slot) then shows which mutations could spawn
   * there. Omitted = off, and no extra hover targets exist.
   */
  sanityState?: SimulationState;
}

/** One plot, read-only: standing plants, empty labelled target cells, and what changed this cycle. */
export const PlotView: React.FC<PlotViewProps> = ({
  plot,
  runner,
  def,
  events,
  onEditFlow,
  maxCell = 48,
  openDebts = [],
  cycleSeconds,
  config,
  sanityState,
}) => {
  const fitRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<TooltipTarget | null>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: maxCell, min: 16 });
  const { width, height } = getGridDimensions(cellSize, gap);
  const marks = useMemo(() => marksFrom(events), [events]);
  // Sanity Check results, memoised per hovered cell for as long as it is the same snapshot state.
  const checkCache = useRef<{ state: SimulationState; plotId: number; results: Map<string, SanityCheckResult> } | null>(null);
  const checkAt = (row: number, col: number): SanityCheckResult | undefined => {
    if (!sanityState) return undefined;
    let cache = checkCache.current;
    if (!cache || cache.state !== sanityState || cache.plotId !== plot.id) {
      cache = { state: sanityState, plotId: plot.id, results: new Map() };
      checkCache.current = cache;
    }
    const key = `${row},${col}`;
    let result = cache.results.get(key);
    if (!result) {
      result = sanityCheck(sanityState, defaultGameData(), plot.id, row, col);
      cache.results.set(key, result);
    }
    return result;
  };

  /** Only change state when the hovered thing or checked cell changed (check results are memoised, so identity means "same cell"). */
  const hoverIf = (next: TooltipTarget) =>
    setHover((prev) => {
      if (prev && prev.kind === "plant" && next.kind === "plant" && prev.plant === next.plant && prev.check === next.check) return prev;
      if (prev && prev.kind === "slot" && next.kind === "slot" && prev.slot === next.slot && prev.check === next.check) return prev;
      return next;
    });
  /** The cell of a size x size element under the mouse (Sanity Check on: a multi-cell element is one hover target). */
  const cellUnder = (e: React.MouseEvent<HTMLDivElement>, row: number, col: number, size: number) => {
    if (size === 1) return { row, col };
    const { dr, dc } = hoveredCellOffset(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), size, cellSize, gap);
    return { row: row + dr, col: col + dc };
  };
  const hoverPlant = (e: React.MouseEvent<HTMLDivElement>, p: PlantState, watchStatus: WatchStatus | undefined) => {
    const cell = cellUnder(e, p.row, p.col, p.size);
    hoverIf({ kind: "plant", plant: p, watchStatus, check: checkAt(cell.row, cell.col) });
  };
  const hoverSlot = (e: React.MouseEvent<HTMLDivElement>, s: PlotState["slots"][number], key: string, isWatched: boolean) => {
    const cell = cellUnder(e, s.row, s.col, s.size);
    hoverIf({
      kind: "slot",
      slot: s,
      ineligibleCycles: plot.slotIneligibleCycles[key] ?? 0,
      watched: isWatched,
      watchStatus: plot.watchStatus?.[key],
      check: checkAt(cell.row, cell.col),
    });
  };

  const step = def && runner ? def.flow.steps[runner.stepIndex] : undefined;
  const watchedKeys = new Set(step?.watch ?? plot.slots.map((s) => `${s.row},${s.col}`));
  const occupied = new Set<string>();
  for (const p of plot.plants) {
    for (let dr = 0; dr < p.size; dr++) for (let dc = 0; dc < p.size; dc++) occupied.add(`${p.row + dr},${p.col + dc}`);
  }
  const counts = {
    standing: plot.plants.filter((p) => p.origin !== "spawned" && !p.isDeadPlant).length,
    spawns: plot.plants.filter((p) => p.origin === "spawned").length,
    dead: plot.plants.filter((p) => p.isDeadPlant).length,
    dry: plot.plants.filter((p) => isDry(p, config)).length,
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
  const missingKeys = new Set(missing.map((m) => `${m.row},${m.col}`));

  return (
    <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 min-w-0 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-slate-200">Plot {plot.id}</h3>
          {step && (
            <p className="text-xs text-slate-400 break-words">
              <span className="text-slate-500">
                Step {runner!.stepIndex + 1}/{def!.flow.steps.length}
              </span>{" "}
              {step.label || step.id}
              <span className="text-slate-500"> · {runner!.cyclesInStep} cycles in</span>
              {runner!.pendingTransition && <span className="text-amber-300"> · change pending</span>}
              {runner!.finished && <span className="text-slate-500"> · holding final step</span>}
            </p>
          )}
        </div>
        {onEditFlow && (
          <button className={`${buttonClass.neutral} flex-shrink-0`} onClick={onEditFlow} title="Edit this plot's flow">
            <Pencil className="w-3 h-3" />
            Flow
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
                {...(sanityState
                  ? {
                      onMouseEnter: () => setHover({ kind: "check", row: r, col: c, result: checkAt(r, c)! }),
                      onMouseLeave: () => setHover(null),
                    }
                  : {})}
              />
            );
          })}

          {plot.slots.map((s) => {
            const { top, left } = getCellPixelPosition(s.row, s.col, cellSize, gap);
            const size = s.size * cellSize + (s.size - 1) * gap;
            const key = `${s.row},${s.col}`;
            if (occupied.has(key)) return null;
            const isWatched = watchedKeys.has(key);
            const status = isWatched ? plot.watchStatus?.[key] : undefined;
            const short = status === "requirements";
            const blocked = status === "blocked";
            return (
              <div
                key={`slot-${s.row}-${s.col}`}
                className={`absolute rounded border-2 border-dashed flex items-center justify-center pointer-events-auto ${
                  short
                    ? "border-red-500/80 bg-red-500/10"
                    : blocked
                      ? "border-amber-400/80 bg-amber-500/10"
                      : isWatched
                        ? "border-cyan-400/70 bg-cyan-500/10"
                        : "border-slate-500/60 bg-slate-500/5"
                }`}
                style={{ top, left, width: size, height: size }}
                {...(sanityState
                  ? {
                      // One element covers the whole footprint: check the cell under the cursor, not the anchor.
                      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => hoverSlot(e, s, key, isWatched),
                      onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => hoverSlot(e, s, key, isWatched),
                    }
                  : {
                      onMouseEnter: () =>
                        setHover({
                          kind: "slot",
                          slot: s,
                          ineligibleCycles: plot.slotIneligibleCycles[key] ?? 0,
                          watched: isWatched,
                          watchStatus: plot.watchStatus?.[key],
                        }),
                    })}
                onMouseLeave={() => setHover(null)}
              >
                {/* A flex box (not a block) so the inline-flex image has no line-height strut pushing it off-centre. */}
                <div className={`flex items-center justify-center ${isWatched ? "opacity-45 grayscale-[40%]" : "opacity-25 grayscale"}`}>
                  <CropImage cropId={s.mutationId} cropName={nameOf(s.mutationId)} width={size * 0.6} height={size * 0.6} showFallback={false} />
                </div>
                {plot.slotIneligibleCycles[key] > 0 && (
                  <span className={`absolute bottom-0 right-0.5 text-[9px] ${short ? "text-red-400" : "text-amber-300"}`}>⚠</span>
                )}
                {isWatched && <Eye className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 ${blocked ? "text-amber-300/80" : short ? "text-red-300/80" : "text-cyan-300/80"}`} />}
              </div>
            );
          })}

          {plot.plants.map((p) => {
            const { top, left } = getCellPixelPosition(p.row, p.col, cellSize, gap);
            const size = p.size * cellSize + (p.size - 1) * gap;
            const ground = plot.groundOverrides[`${p.row},${p.col}`] ?? plot.groundTiles[`${p.row},${p.col}`];
            const growing = !p.isDeadPlant && p.origin !== "placed" && p.readyStage > 0 && p.stage < p.readyStage;
            const dry = isDry(p, config);
            // A checked target standing on its own slot but dried out: downtime (uptime status `halted`).
            const anchor = `${p.row},${p.col}`;
            const watchStatus = watchedKeys.has(anchor) ? plot.watchStatus?.[anchor] : undefined;
            const halted = watchStatus === "halted";
            return (
              <div
                key={p.id}
                className="absolute rounded overflow-hidden flex items-center justify-center cursor-default"
                {...(sanityState
                  ? {
                      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => hoverPlant(e, p, watchStatus),
                      onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => hoverPlant(e, p, watchStatus),
                    }
                  : { onMouseEnter: () => setHover({ kind: "plant", plant: p, watchStatus }) })}
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
                  filter: p.isDeadPlant ? "grayscale(1) brightness(0.55)" : dry ? DRY_FILTER : undefined,
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
                {halted && <div className="absolute inset-0 rounded border-2 border-dashed border-amber-600/90 pointer-events-none" />}
                {growing && (
                  <div className="absolute bottom-0 left-0 h-[3px] bg-emerald-400/80" style={{ width: `${(p.stage / p.readyStage) * 100}%` }} />
                )}
                {(p.gate.asleep || p.gate.ratAlive || (p.kindId === "thunderling" && (p.gate.charge ?? 0) >= config.thunderlingMaxCharge)) && <span className="absolute top-0 right-0.5 text-[9px] text-amber-300">z</span>}
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
            // A new shortfall also opens a "missing" overlay on the same cell, which already draws its own "!";
            // keep the ring (it shows the shortfall is new this cycle) but drop the second glyph.
            const showGlyph = !(mark === "debt" && missingKeys.has(key));
            return (
              <div
                key={`mark-${key}`}
                className="absolute rounded pointer-events-none flex items-start justify-end"
                style={{ top, left, width: span, height: span, boxShadow: `0 0 0 2px ${style.ring}` }}
              >
                {showGlyph && (
                  <span className={`text-[10px] leading-none font-bold ${style.color} drop-shadow`} style={{ marginTop: 1, marginRight: 2 }}>
                    {style.glyph}
                  </span>
                )}
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
              cycleSeconds={cycleSeconds}
              config={config}
              plot={plot}
            />
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>{counts.standing} placed/planted</span>
        <span className="text-cyan-300/90">{counts.spawns} natural spawns</span>
        <span>{counts.openSlots} open target cells</span>
        {counts.dead > 0 && <span className="text-red-300/90">{counts.dead} dead plants</span>}
        {counts.dry > 0 && <span className="text-amber-400/90">{counts.dry} dried out (halted)</span>}
        {missing.length > 0 && <span className="text-red-300">{missing.length} missing (no stock)</span>}
      </div>
    </div>
  );
};
