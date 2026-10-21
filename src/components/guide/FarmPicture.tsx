/**
 * A farm drawn exactly as its layout builds it, in the same style as the Simulator's plot view:
 * ground tiles, crops and placed items with their real images, and dashed target cells showing
 * what spawns there.
 *
 * Static (no simulation state), so it works for any step of the flow. Optional overlays mark the
 * cells a session places from the inventory, and inputs still missing from an earlier visit.
 * Hovering (or tapping) a cell shows what it is; clicking it (a second tap on touch) opens the
 * item's wiki modal when the app's InfoModalProvider is mounted.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFitCellSize } from "../../hooks/useFitCellSize";
import { isFreePlacedItem } from "../../simulator";
import type { GameData } from "../../simulator/data/types";
import type { ResolvedLayout } from "../../simulator/sim/context";
import { getGroundImagePath } from "../../types/greenhouse";
import { calculateCropImageDimensions, getCellPixelPosition, getGridDimensions } from "../../utilities/gridCalculations";
import { getRarityTextColor } from "../../utilities/rarity";
import { CropImage } from "../shared/CropImage";
import { CompassFrame, COMPASS_RESERVE } from "../grid/CompassFrame";
import { Portal } from "../ui/Portal";
import { useOptionalOpenInfo } from "../../context/InfoModalContext";
import type { Cell, PlotFacts } from "../../guide";

const GRID = 10;
const key = (r: number, c: number) => `${r},${c}`;

export interface FarmPictureProps {
  layout: ResolvedLayout;
  /** Display names for alt text and tooltips. */
  nameOf: (id: string) => string;
  /** Rarity and requirements for the tooltips. */
  data?: GameData;
  /** Largest cell in px (the picture shrinks to fit its container). */
  maxCell?: number;
  minCell?: number;
  /** Fixed cell size: skips measuring (thumbnails, server render). */
  cellSize?: number;
  /** Cells placed from inventory this session: marked gold. */
  highlight?: Cell[];
  facts?: PlotFacts;
  /** Draw N/E/S/W around the grid. */
  compass?: boolean;
  /** Hover / tap a cell to see what it is. Off for thumbnails. */
  tooltips?: boolean;
  className?: string;
}

type Tip =
  | { kind: "plant"; id: string; row: number; col: number; size: number; paid: boolean; placing: boolean; missing: boolean }
  | { kind: "slot"; id: string; row: number; col: number; size: number; stage?: number; fullyGrown?: boolean };

export const FarmPicture: React.FC<FarmPictureProps> = ({
  layout,
  nameOf,
  data,
  maxCell = 36,
  minCell = 12,
  cellSize: fixed,
  highlight,
  facts,
  compass = true,
  tooltips = true,
  className = "",
}) => {
  const fitRef = useRef<HTMLDivElement>(null);
  const fitted = useFitCellSize(fitRef, { max: maxCell, min: minCell, reserve: compass ? COMPASS_RESERVE : 0 });
  const cellSize = fixed ?? fitted.cellSize;
  const gap = fixed ? (fixed < 16 ? 1 : 2) : fitted.gap;
  const { width, height } = getGridDimensions(cellSize, gap);
  const [tip, setTip] = useState<{ tip: Tip; rect: DOMRect; pinned: boolean } | null>(null);
  const showTips = tooltips && cellSize >= 14;
  const openInfo = useOptionalOpenInfo();

  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const p of layout.plants) for (let dr = 0; dr < p.size; dr++) for (let dc = 0; dc < p.size; dc++) set.add(key(p.row + dr, p.col + dc));
    return set;
  }, [layout]);
  const highlighted = new Set((highlight ?? []).map((c) => key(c.row, c.col)));
  const missing = new Set((facts?.missing ?? []).map((c) => key(c.row, c.col)));
  const standing = new Map((facts?.standing ?? []).map((s) => [key(s.row, s.col), s]));
  const span = (size: number) => size * cellSize + (size - 1) * gap;

  // A tapped (pinned) tooltip closes on the next tap elsewhere, on scroll and on Escape.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-farm-cell]")) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tip]);

  /**
   * Mouse: hover shows the card, a click opens the item's wiki modal. Touch: a tap pins the card,
   * a second tap on the same cell opens the wiki modal (or closes the card when there is no modal).
   */
  const lastPointer = useRef("mouse");
  const tipProps = (t: Tip) =>
    showTips
      ? {
          "data-farm-cell": "",
          onPointerEnter: (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.pointerType === "mouse") setTip({ tip: t, rect: e.currentTarget.getBoundingClientRect(), pinned: false });
          },
          onPointerLeave: (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.pointerType === "mouse") setTip((cur) => (cur && !cur.pinned ? null : cur));
          },
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            lastPointer.current = e.pointerType;
          },
          onClick: (e: React.MouseEvent<HTMLDivElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const same = tip?.pinned && tip.tip.row === t.row && tip.tip.col === t.col;
            if (openInfo && (lastPointer.current === "mouse" || same)) {
              setTip(null);
              openInfo(t.id);
              return;
            }
            setTip(same ? null : { tip: t, rect, pinned: true });
          },
        }
      : {};

  const grid = (
    <div className="relative select-none" style={{ width, height }}>
      {Array.from({ length: GRID * GRID }, (_, i) => {
        const r = Math.floor(i / GRID);
        const c = i % GRID;
        if (occupied.has(key(r, c))) return null;
        const ground = layout.groundTiles[key(r, c)];
        return (
          <div
            key={i}
            aria-hidden
            className={`absolute rounded border ${ground ? "border-emerald-700/20" : "border-slate-700/20"}`}
            style={{
              ...getCellPixelPosition(r, c, cellSize, gap),
              width: cellSize,
              height: cellSize,
              ...(ground ? { backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: `${cellSize}px ${cellSize}px` } : {}),
            }}
          />
        );
      })}

      {layout.slots.map((s) => {
        const k = key(s.row, s.col);
        if (occupied.has(k)) return null;
        const size = span(s.size);
        const grown = standing.get(k);
        const image = calculateCropImageDimensions(s.size, cellSize, gap);
        return (
          <div
            key={`slot-${k}`}
            role="img"
            aria-label={`Target: ${nameOf(s.mutationId)}`}
            className={`absolute flex items-center justify-center rounded border-2 border-dashed ${showTips ? (openInfo ? "cursor-pointer" : "cursor-help") : ""} ${
              grown ? "border-emerald-400/80 bg-emerald-500/15" : "border-cyan-400/70 bg-cyan-500/10"
            }`}
            style={{ ...getCellPixelPosition(s.row, s.col, cellSize, gap), width: size, height: size }}
            {...tipProps({ kind: "slot", id: s.mutationId, row: s.row, col: s.col, size: s.size, stage: grown?.stage, fullyGrown: grown?.fullyGrown })}
          >
            {/* Flex, not block: a block wrapper's line-height strut pushes the image off-centre. */}
            <div className={`flex items-center justify-center ${grown ? "" : "opacity-45 grayscale-[40%]"}`}>
              <CropImage cropId={s.mutationId} cropName={nameOf(s.mutationId)} width={image.imageWidth * 0.75} height={image.imageHeight * 0.75} showFallback={false} />
            </div>
            {grown && cellSize >= 18 && (
              <span className="absolute bottom-0 right-0.5 text-[9px] font-semibold leading-none text-emerald-200 drop-shadow">{grown.fullyGrown ? "✓" : grown.stage}</span>
            )}
          </div>
        );
      })}

      {layout.plants.map((p) => {
        const k = key(p.row, p.col);
        const size = span(p.size);
        const paid = p.origin === "placed" && !isFreePlacedItem(p.kindId);
        const gone = missing.has(k);
        const placing = highlighted.has(k);
        const ground = layout.groundTiles[k];
        const image = calculateCropImageDimensions(p.size, cellSize, gap);
        return (
          <div
            key={`plant-${k}`}
            role="img"
            aria-label={`${nameOf(p.kindId)}${placing ? ", placed from your inventory" : ""}${gone ? ", missing" : ""}`}
            className={`absolute flex items-center justify-center overflow-hidden rounded ${showTips ? (openInfo ? "cursor-pointer" : "cursor-help") : ""} ${
              gone ? "border-2 border-dashed border-red-500/70 bg-red-500/10" : ""
            }`}
            style={{
              ...getCellPixelPosition(p.row, p.col, cellSize, gap),
              width: size,
              height: size,
              ...(ground && !gone ? { backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: `${cellSize}px ${cellSize}px` } : {}),
              boxShadow: placing && !gone ? "inset 0 0 0 1px rgba(251,191,36,0.75)" : undefined,
            }}
            {...tipProps({ kind: "plant", id: p.kindId, row: p.row, col: p.col, size: p.size, paid, placing, missing: gone })}
          >
            <div className={`flex items-center justify-center ${gone ? "opacity-35" : ""}`}>
              <CropImage cropId={p.kindId} cropName={nameOf(p.kindId)} width={image.imageWidth} height={image.imageHeight} hasGroundContext={!gone} showFallback />
            </div>
            {/* Gold corner: placed from your inventory. Small, so the crop stays visible. */}
            {placing && !gone && (
              <span
                aria-hidden
                className="absolute right-0 top-0 h-0 w-0 border-l-transparent border-t-amber-400"
                style={{ borderTopWidth: Math.max(5, Math.round(cellSize * 0.28)), borderLeftWidth: Math.max(5, Math.round(cellSize * 0.28)) }}
              />
            )}
            {gone && cellSize >= 14 && <span className="absolute right-0.5 top-0 text-[10px] font-bold text-red-400">!</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={fixed ? undefined : fitRef} className={`w-full min-w-0 max-w-full overflow-hidden ${className}`}>
      {compass ? <CompassFrame className="mx-auto">{grid}</CompassFrame> : <div className="mx-auto w-fit">{grid}</div>}
      {tip && <CellTooltip {...tip} nameOf={nameOf} data={data} hint={openInfo ? (tip.pinned ? "Tap again for details." : "Click for details.") : undefined} />}
    </div>
  );
};

const TIP_WIDTH = 210;

/** The hover card: what is on the cell, in words, for players who don't know every crop by sight. */
const CellTooltip: React.FC<{ tip: Tip; rect: DOMRect; nameOf: (id: string) => string; data?: GameData; hint?: string }> = ({ tip, rect, nameOf, data, hint }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = rect.right + 8;
    if (left + TIP_WIDTH > vw - pad) left = rect.left - 8 - TIP_WIDTH;
    if (left < pad) left = Math.max(pad, Math.min(vw - TIP_WIDTH - pad, rect.left + rect.width / 2 - TIP_WIDTH / 2));
    let top = rect.top;
    if (left < rect.right && left + TIP_WIDTH > rect.left) top = rect.bottom + 6; // centred under the cell
    if (top + h > window.innerHeight - pad) top = Math.max(pad, rect.top - h - 6);
    setPos({ top, left });
  }, [rect]);

  const rarity = data?.mutations[tip.id]?.rarity;
  // Only what the player has to act on; everything else is in the wiki modal a click away.
  let lines: { text: string; tone?: string }[] = [];
  if (tip.kind === "slot") {
    lines = [{ text: "Target cell: it spawns here. Leave it empty.", tone: "text-cyan-300" }];
    if (tip.stage !== undefined) lines.push({ text: tip.fullyGrown ? "Reported fully grown: harvest it." : `Reported growing (stage ${tip.stage}).`, tone: "text-emerald-300" });
  } else if (tip.missing) {
    lines = [{ text: "Missing: none in your inventory. Place one when you have it.", tone: "text-red-300" }];
  } else if (tip.placing) {
    lines = [{ text: "Place this from your inventory.", tone: "text-amber-300" }];
  }

  return (
    <Portal>
      <div
        ref={ref}
        role="tooltip"
        className="pointer-events-none fixed z-[9999] rounded-lg border border-slate-600/60 bg-slate-900/95 p-3 text-xs shadow-xl backdrop-blur-sm"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: TIP_WIDTH }}
      >
        <div className={`flex items-center gap-2 ${lines.length || hint ? "mb-1.5" : ""}`}>
          <CropImage cropId={tip.id} cropName={nameOf(tip.id)} size="xs" showFallback={false} />
          <div className="min-w-0">
            <div className={`truncate text-sm font-medium ${rarity ? getRarityTextColor(rarity) : "text-slate-100"}`}>{nameOf(tip.id)}</div>
            {rarity && <div className="text-[11px] capitalize text-slate-500">{rarity}</div>}
          </div>
        </div>
        <div className="space-y-1">
          {lines.map((l) => (
            <p key={l.text} className={l.tone ?? "text-slate-300"}>
              {l.text}
            </p>
          ))}
          {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
        </div>
      </div>
    </Portal>
  );
};
