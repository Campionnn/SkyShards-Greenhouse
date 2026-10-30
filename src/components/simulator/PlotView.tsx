import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eye, MoreHorizontal, Pencil } from "lucide-react";
import { IconButton, KitButton } from "../ui/kit";
import { Popover } from "../ui/Popover";
import { useContextMenu, type ContextMenuEntry } from "../ui/contextMenuContext";
import type { PlotUptime } from "./page/plotUptime";
import { useFitCellSize } from "../../hooks";
import {
  defaultGameData,
  isDry,
  sanityCheck,
  THUNDERLING_MAX_CHARGE,
  type FlowRunnerState,
  type PlotState,
  type SanityCheckResult,
  type ScenarioPlot,
  type SimConfig,
  type SimulationState,
  type TimedEvent,
  type WatchStatus,
} from "../../simulator";
import { GRID_SIZE } from "../../constants";
import { getGroundImagePath } from "../../types/greenhouse";
import { getCellPixelPosition, getGridDimensions } from "../../utilities";
import { CropImage } from "../shared";
import { kindData, nameOf, plantIconOf } from "./format";
import { hoveredCellOffset } from "./sanityFormat";
import { PlotMarkLegend } from "./markers";
import { DRY_FILTER, MARK_STYLE, markerKey, type GridMarker, type Mark } from "./markerStyles";
import { SimTooltip, type TooltipTarget } from "./SimTooltip";

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
    else if (e.kind === "borrowed") at(e.row, e.col, "borrowed", sizeOf(e.item));
    else if (e.kind === "bought") at(e.row, e.col, "bought", sizeOf(e.item));
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
  /** Reports the legend entries (`markerKey`s) drawn on the hovered element; `[]` when nothing is hovered. */
  onHoverMarkers?: (plotId: number, keys: string[]) => void;
  /** Items of the header's ⋯ menu (Replace layout, Duplicate, Remove); call `close` after choosing. No menu when omitted or it returns nothing. */
  menu?: (close: () => void) => React.ReactNode;
  /** Right-click menu for the whole plot (header and grid); usually the ⋯ menu's actions. Needs a ContextMenuProvider above. */
  contextMenu?: () => ContextMenuEntry[];
  /** Cap the cell size so the whole grid fits the viewport height under the sticky page header, with the results tabs peeking in. */
  fitHeight?: boolean;
  /** Uptime of this plot's checked targets so far (`plotUptime`); the footer shows it when given. */
  uptime?: PlotUptime | null;
}

/**
 * Height around the grid that must stay on screen with `fitHeight`: site nav 56, sticky command bar
 * and KPI strip ~100, the plot header 38 and footer 28, the legend row 40 and the results tab bar
 * peeking in under it 52.
 */
export const FIT_HEIGHT_RESERVE = 56 + 100 + 38 + 28 + 40 + 52;

/** One decimal, never rounding a not-quite-full uptime up to "100%" (that would read as perfect). */
const formatUptime = (r: number) => `${r >= 1 ? "100" : (Math.floor(r * 1000) / 10).toFixed(1)}%`;

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
  onHoverMarkers,
  menu,
  contextMenu,
  fitHeight,
  uptime,
}) => {
  const openContextMenu = useContextMenu();
  const fitRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The hovered cell, not the hovered thing: the card is re-derived from the current plot on every
  // render, so it follows the snapshot live (e.g. holding → to step) without the mouse moving.
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: maxCell, min: 16, ...(fitHeight ? { heightReserve: FIT_HEIGHT_RESERVE } : {}) });
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuItems = menu && menuOpen ? menu(() => setMenuOpen(false)) : null;

  // Touch has no hover: a tap inspects the cell (tap it again, or anywhere else, to close).
  const touchTap = useRef(false);
  useEffect(() => {
    if (!hoverCell) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && !gridRef.current?.contains(e.target as Node)) setHoverCell(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [hoverCell]);
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

  /** Tracks the cell under the mouse (scale-aware); state changes only when the cell does. */
  const cellAt = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const { dr: row, dc: col } = hoveredCellOffset(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), GRID_SIZE, cellSize, gap);
    return { row, col };
  };
  const trackHover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const { row, col } = cellAt(e);
    setHoverCell((prev) => (prev && prev.row === row && prev.col === col ? prev : { row, col }));
  };
  const onTap = (e: React.PointerEvent<HTMLDivElement>) => {
    touchTap.current = e.pointerType !== "mouse";
    if (!touchTap.current) return;
    const { row, col } = cellAt(e);
    setHoverCell((prev) => (prev && prev.row === row && prev.col === col ? null : { row, col }));
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

  /**
   * What the hovered cell shows right now, topmost first (the same stacking as the rendering below:
   * missing-item ghosts over plants over slot ghosts over bare ground). Derived from this render's
   * plot, so the card stays live while the snapshot changes under a still mouse.
   */
  const hoverTargetAt = (row: number, col: number): TooltipTarget | null => {
    const covers = (a: { row: number; col: number }, size: number) => row >= a.row && row < a.row + size && col >= a.col && col < a.col + size;
    const check = checkAt(row, col);
    for (let i = missing.length - 1; i >= 0; i--) {
      const m = missing[i];
      if (covers(m, sizeOf(m.item))) return { kind: "missing", item: m.item, row: m.row, col: m.col };
    }
    for (let i = plot.plants.length - 1; i >= 0; i--) {
      const p = plot.plants[i];
      if (!covers(p, p.size)) continue;
      const anchor = `${p.row},${p.col}`;
      const watchStatus: WatchStatus | undefined = watchedKeys.has(anchor) ? plot.watchStatus?.[anchor] : undefined;
      return { kind: "plant", plant: p, watchStatus, ...(check ? { check } : {}) };
    }
    for (let i = plot.slots.length - 1; i >= 0; i--) {
      const s = plot.slots[i];
      const key = `${s.row},${s.col}`;
      if (occupied.has(key) || !covers(s, s.size)) continue;
      return {
        kind: "slot",
        slot: s,
        ineligibleCycles: plot.slotIneligibleCycles[key] ?? 0,
        watched: watchedKeys.has(key),
        watchStatus: plot.watchStatus?.[key],
        ...(check ? { check } : {}),
      };
    }
    // Bare ground gets a card only with the Sanity Check on; otherwise its native title explains it.
    return check ? { kind: "check", row, col, result: check } : null;
  };
  const hover = hoverCell ? hoverTargetAt(hoverCell.row, hoverCell.col) : null;

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

  // Tell the page which legend entries apply to the hovered element (bare cells still report a last-cycle mark).
  const hoverMarkers: GridMarker[] = hover
    ? markersFor(hover)
    : hoverCell && marks.has(`${hoverCell.row},${hoverCell.col}`)
      ? [{ mark: marks.get(`${hoverCell.row},${hoverCell.col}`)!.mark }]
      : [];
  const hoverKeys = [...new Set(hoverMarkers.map(markerKey))].join("|");
  // `onHoverMarkers` should be stable (useCallback); the cleanup clears this plot's entry on change/unmount.
  useEffect(() => {
    if (!onHoverMarkers) return;
    const id = plot.id;
    onHoverMarkers(id, hoverKeys ? hoverKeys.split("|") : []);
    return () => onHoverMarkers(id, []);
  }, [hoverKeys, plot.id, onHoverMarkers]);

  return (
    <div className="@container min-w-0 flex flex-col" onContextMenu={contextMenu ? (e) => openContextMenu(e, contextMenu()) : undefined}>
      <div className="mb-2 flex h-[30px] min-w-0 items-center gap-2 text-[13px]">
        <h3 className="shrink-0 font-semibold text-slate-100">Plot {plot.id}</h3>
        {step && (
          <>
            <span className="min-w-0 truncate text-slate-300" title={step.label || step.id}>
              {step.label || step.id}
            </span>
            <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-slate-500">
              · step {runner!.stepIndex + 1}/{def!.flow.steps.length}
            </span>
            {def!.flow.steps.length <= 8 && def!.flow.steps.length > 1 && (
              <span className="hidden shrink-0 items-center gap-[3px] @[420px]:flex" aria-hidden title={`Step ${runner!.stepIndex + 1} of ${def!.flow.steps.length}`}>
                {def!.flow.steps.map((s, i) => (
                  <i key={s.id} className={`h-1.5 w-1.5 rounded-[2px] ${i === runner!.stepIndex ? "bg-slate-100" : "bg-slate-400/20"}`} />
                ))}
              </span>
            )}
            {runner!.pendingTransition && <span className="shrink-0 whitespace-nowrap text-[11px] text-amber-300">change pending</span>}
            {runner!.finished && <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-500">holding final step</span>}
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {onEditFlow && (
            <KitButton variant="ghost" onClick={onEditFlow} title="Edit this plot's flow" className="!h-[26px] !px-2">
              <Pencil />
              Flow
            </KitButton>
          )}
          {menu && (
            <>
              <IconButton
                ref={setMenuAnchor}
                aria-label={`Plot ${plot.id} actions`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="!h-[26px] !w-[26px]"
              >
                <MoreHorizontal />
              </IconButton>
              <Popover anchor={menuAnchor} open={menuOpen && !!menuItems} onClose={() => setMenuOpen(false)} label={`Plot ${plot.id} actions`} role="menu" align="end" width={240}>
                {menuItems}
              </Popover>
            </>
          )}
        </span>
      </div>

      <div ref={fitRef} className="w-full">
        <div
          ref={gridRef}
          className="relative mx-auto select-none rounded-xl bg-slate-950/60 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]"
          style={{ width, height }}
          onPointerMove={trackHover}
          onPointerDown={onTap}
          onMouseLeave={() => setHoverCell(null)}
        >
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
              markers={hoverMarkers}
            />
          )}
        </div>
      </div>

      <div className="mx-auto mt-2 flex min-h-5 w-full flex-wrap items-baseline gap-x-3.5 gap-y-0.5 text-[12px] text-slate-500" style={{ maxWidth: width }}>
        <span title="Placed and planted layout plants">
          <b className="font-semibold tabular-nums text-slate-300">{counts.standing}</b> planted
        </span>
        <span title="Natural spawns standing on the plot">
          <b className="font-semibold tabular-nums text-slate-300">{counts.spawns}</b> spawned
        </span>
        {runner && (
          <span className="hidden @[420px]:inline">
            <b className="font-semibold tabular-nums text-slate-300">{runner.cyclesInStep}</b> cycles in step
          </span>
        )}
        {counts.openSlots > 0 && (
          <span className="hidden @[340px]:inline" title="Target cells without their mutation">
            <b className="font-semibold tabular-nums text-slate-300">{counts.openSlots}</b> open
          </span>
        )}
        {counts.dead > 0 && <span className="text-red-300/90">{counts.dead} dead</span>}
        {counts.dry > 0 && (
          <span className="text-amber-400/90" title="Dried out: halted until watered">
            {counts.dry} dried out
          </span>
        )}
        {missing.length > 0 && (
          <span className="text-red-300" title="Layout plants the player could not re-place (no stock)">
            {missing.length} missing
          </span>
        )}
        {uptime && (
          <span
            className={`ml-auto font-semibold tabular-nums ${uptime.unsustainable ? "text-red-300" : "text-slate-200"}`}
            title={`Uptime of this plot's checked targets so far${uptime.unsustainable ? ": a checked target lacked its requirements (not sustainable)" : ""}`}
          >
            {formatUptime(uptime.ratio)} up
          </span>
        )}
      </div>
    </div>
  );
};
