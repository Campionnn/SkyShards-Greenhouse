import React, { useMemo, useRef, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useFitCellSize } from "../../hooks";
import {
  defaultGameData,
  isDry,
  sanityCheck,
  THUNDERLING_MAX_CHARGE,
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
import { CompassFrame, COMPASS_RESERVE } from "../grid";
import { kindData, nameOf, plantIconOf } from "./format";
import { hoveredCellOffset } from "./sanityFormat";
import { PlotMarkLegend } from "./markers";
import { DRY_FILTER, MARK_STYLE, type GridMarker, type Mark } from "./markerStyles";
import { SimTooltip, type TooltipTarget } from "./SimTooltip";
import { buttonClass } from "./styles";

/** Footprint size of a plant or item id, so large mutations mark their whole footprint. */
const sizeOf = (id: string): number => kindData(id)?.size ?? 1;

export { PlotMarkLegend };
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
  }
  return marks;
}

export interface PlotViewProps {
  plot: PlotState;
  runner: FlowRunnerState | undefined;
  def: ScenarioPlot | undefined;
  events: TimedEvent[];
  onEditFlow?: () => void;
  /** Largest cell size in px. */
  maxCell?: number;
  /** Unresolved shortfalls ("plot:row,col:item"): layout plants the player could not afford to re-place. */
  openDebts?: string[];
  /** Hover-card inputs. */
  cycleSeconds: number;
  config: SimConfig;
  /** Snapshot state for the Sanity Check inspector; omitted = off, with no extra hover targets. */
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
  const { cellSize, gap } = useFitCellSize(fitRef, { max: maxCell, min: 16, reserve: COMPASS_RESERVE });
  const { width, height } = getGridDimensions(cellSize, gap);
  const marks = useMemo(() => marksFrom(events), [events]);
  // Sanity Check results, memoised per cell for the current snapshot state.
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

  /** Sets state only when the hovered thing or checked cell changed (memoised check results compare by identity). */
  const hoverIf = (next: TooltipTarget) =>
    setHover((prev) => {
      if (prev && prev.kind === "plant" && next.kind === "plant" && prev.plant === next.plant && prev.check === next.check) return prev;
      if (prev && prev.kind === "slot" && next.kind === "slot" && prev.slot === next.slot && prev.check === next.check) return prev;
      return next;
    });
  /** Cell under the mouse within a size x size element (a multi-cell element is one hover target). */
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
    dry: plot.plants.filter((p) => isDry(p)).length,
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

  /** The icons drawn on the hovered element, mirroring the rendering below, so the card explains them without the legend. */
  const markersFor = (t: TooltipTarget): GridMarker[] => {
    const out: GridMarker[] = [];
    const anchorOf = t.kind === "plant" ? t.plant : t.kind === "slot" ? t.slot : t;
    const key = `${anchorOf.row},${anchorOf.col}`;
    if (t.kind === "plant") {
      const p = t.plant;
      if (p.isRival) out.push({ indicator: "rival", label: "rival (natural spawn)" });
      else if (p.origin === "spawned") out.push({ indicator: "spawn", label: "natural spawn" });
      else if (p.kindId === "devourer_root") out.push({ indicator: "root", label: "devourer root" });
      if (p.isDeadPlant) out.push({ indicator: "dead", label: "dead plant" });
      else if (isDry(p)) out.push({ indicator: "dry", label: "dried out - halted until watered" });
      if (t.watchStatus === "halted") out.push({ indicator: "halted" });
      if (!p.isDeadPlant && p.origin !== "placed" && p.readyStage > 0 && p.stage < p.readyStage)
        out.push({ indicator: "growing", label: `still growing (stage ${p.stage} / ${p.readyStage})` });
      const overcharged = p.kindId === "thunderling" && (p.gate.charge ?? 0) >= THUNDERLING_MAX_CHARGE;
      if (p.gate.asleep) out.push({ indicator: "sleepy", label: "asleep - the player wakes it when online" });
      else if (p.gate.ratAlive) out.push({ indicator: "sleepy", label: "a rat is eating it - vacuumed when online" });
      else if (overcharged) out.push({ indicator: "sleepy", label: "overcharged - discharged when the player is online" });
      if (p.kindId === "blastberry" && p.gate.primed) out.push({ indicator: "primed", label: "primed - breaking it blows up the 8 cells around it" });
    } else if (t.kind === "slot") {
      const status = t.watched ? t.watchStatus : undefined;
      out.push({
        indicator:
          status === "requirements" ? "slotRequirements" : status === "blocked" ? "slotBlocked" : t.watched ? "slotReady" : "slotUnchecked",
      });
      if (t.ineligibleCycles > 0)
        out.push({ indicator: "unmet", label: `requirements not met for the last ${t.ineligibleCycles} cycle${t.ineligibleCycles === 1 ? "" : "s"}` });
    } else if (t.kind === "missing") {
      out.push({ indicator: "missing" }, { mark: "debt", label: "short of this item - the player retries each time they are online" });
    }
    const mark = marks.get(key);
    if (mark && !(mark.mark === "debt" && t.kind === "missing"))
      out.push({ mark: mark.mark, label: `${MARK_STYLE[mark.mark].label} (last cycle)` });
    return out;
  };

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
        <CompassFrame className="mx-auto">
        <div className="relative select-none" style={{ width, height }}>
          {Array.from({ length: 100 }, (_, i) => {
            const r = Math.floor(i / 10);
            const c = i % 10;
            const key = `${r},${c}`;
            if (occupied.has(key)) return null;
            const { top, left } = getCellPixelPosition(r, c, cellSize, gap);
            const ground = plot.groundOverrides[key] ?? plot.groundTiles[key];
            const groundText = ground ? (plot.groundOverrides[key] ? `${ground.replaceAll("_", " ")} (changed during simulation)` : ground.replaceAll("_", " ")) : "air (no ground)";
            const cellMark = marks.get(key);
            return (
              <div
                key={key}
                className={`absolute rounded border ${ground ? "border-emerald-700/20" : "border-slate-700/20"}`}
                style={{ top, left, width: cellSize, height: cellSize, ...(ground ? { backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: `${cellSize}px ${cellSize}px` } : {}) }}
                title={cellMark ? `${groundText}\n${MARK_STYLE[cellMark.mark].glyph} ${MARK_STYLE[cellMark.mark].label} (last cycle)` : groundText}
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
                      // One element covers the footprint: check the cell under the cursor, not the anchor.
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
                {/* Flex, not block: avoids a line-height strut pushing the inline-flex image off-centre. */}
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
            const dry = isDry(p);
            // Checked target standing on its slot but dried out: uptime status `halted`.
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
                  cropId={plantIconOf(p)}
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
                {(p.gate.asleep || p.gate.ratAlive || (p.kindId === "thunderling" && (p.gate.charge ?? 0) >= THUNDERLING_MAX_CHARGE)) && <span className="absolute top-0 right-0.5 text-[9px] text-amber-300">z</span>}
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
            // The "missing" overlay on this cell already draws "!": keep the ring (new this cycle), drop the duplicate glyph.
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
              markers={markersFor(hover)}
            />
          )}
        </div>
        </CompassFrame>
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
