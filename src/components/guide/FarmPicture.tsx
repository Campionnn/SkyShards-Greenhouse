/**
 * A farm drawn exactly as its layout builds it: ground tiles, crops and placed items with their
 * real images, and dashed target cells showing what grows there.
 *
 * Static (no simulation state), so it works for any step of the flow. Optional overlays mark the
 * cells a session places, and the player's reported facts (missing / standing / primed). In `pick`
 * mode every layout anchor is a button, for the facts editor.
 */
import React, { useMemo, useRef } from "react";
import { useFitCellSize } from "../../hooks/useFitCellSize";
import { isFreePlacedItem } from "../../simulator";
import type { ResolvedLayout } from "../../simulator/sim/context";
import { getGroundImagePath } from "../../types/greenhouse";
import { getCellPixelPosition, getGridDimensions } from "../../utilities/gridCalculations";
import { CropImage } from "../shared/CropImage";
import { CompassFrame, COMPASS_RESERVE } from "../grid/CompassFrame";
import type { Cell, PlotFacts } from "../../guide";

const GRID = 10;
const key = (r: number, c: number) => `${r},${c}`;

export interface FarmPictureProps {
  layout: ResolvedLayout;
  /** Display names for alt text and titles. */
  nameOf: (id: string) => string;
  /** Largest cell in px (the picture shrinks to fit its container). */
  maxCell?: number;
  minCell?: number;
  /** Fixed cell size: skips measuring (thumbnails, server render). */
  cellSize?: number;
  /** Cells placed from inventory this session: drawn with a gold ring. */
  highlight?: Cell[];
  facts?: PlotFacts;
  /** Draw N/E/S/W around the grid. */
  compass?: boolean;
  /** Every layout anchor becomes a button. */
  onPick?: (target: PickTarget) => void;
  className?: string;
}

export type PickTarget =
  | { kind: "plant"; row: number; col: number; id: string; paid: boolean }
  | { kind: "slot"; row: number; col: number; id: string };

export const FarmPicture: React.FC<FarmPictureProps> = ({
  layout,
  nameOf,
  maxCell = 36,
  minCell = 12,
  cellSize: fixed,
  highlight,
  facts,
  compass = true,
  onPick,
  className = "",
}) => {
  const fitRef = useRef<HTMLDivElement>(null);
  const fitted = useFitCellSize(fitRef, { max: maxCell, min: minCell, reserve: compass ? COMPASS_RESERVE : 0 });
  const cellSize = fixed ?? fitted.cellSize;
  const gap = fixed ? (fixed < 16 ? 1 : 2) : fitted.gap;
  const { width, height } = getGridDimensions(cellSize, gap);

  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const p of layout.plants) for (let dr = 0; dr < p.size; dr++) for (let dc = 0; dc < p.size; dc++) set.add(key(p.row + dr, p.col + dc));
    return set;
  }, [layout]);
  const highlighted = new Set((highlight ?? []).map((c) => key(c.row, c.col)));
  const missing = new Set((facts?.missing ?? []).map((c) => key(c.row, c.col)));
  const primed = new Set((facts?.primed ?? []).map((c) => key(c.row, c.col)));
  const standing = new Map((facts?.standing ?? []).map((s) => [key(s.row, s.col), s]));
  const span = (size: number) => size * cellSize + (size - 1) * gap;
  const Tag = (onPick ? "button" : "div") as "button";

  const grid = (
    <div className="relative select-none" style={{ width, height }}>
      {Array.from({ length: GRID * GRID }, (_, i) => {
        const r = Math.floor(i / GRID);
        const c = i % GRID;
        const ground = layout.groundTiles[key(r, c)];
        return (
          <div
            key={i}
            aria-hidden
            className={`absolute rounded-[2px] ${ground ? "" : "bg-slate-900/70 ring-1 ring-inset ring-slate-700/30"}`}
            style={{
              ...getCellPixelPosition(r, c, cellSize, gap),
              width: cellSize,
              height: cellSize,
              ...(ground ? { backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: "cover", imageRendering: "pixelated" } : {}),
            }}
          />
        );
      })}

      {layout.slots.map((s) => {
        const k = key(s.row, s.col);
        if (occupied.has(k)) return null;
        const size = span(s.size);
        const grown = standing.get(k);
        return (
          <Tag
            key={`slot-${k}`}
            type={onPick ? "button" : undefined}
            onClick={onPick ? () => onPick({ kind: "slot", row: s.row, col: s.col, id: s.mutationId }) : undefined}
            title={`Target: ${nameOf(s.mutationId)}${grown ? ` (standing, stage ${grown.stage}${grown.fullyGrown ? ", fully grown" : ""})` : ""}`}
            aria-label={onPick ? `Target cell for ${nameOf(s.mutationId)} at row ${s.row + 1}, column ${s.col + 1}` : undefined}
            className={`absolute flex items-center justify-center rounded border-2 border-dashed ${
              grown ? "border-emerald-400/90 bg-emerald-500/20" : "border-cyan-300/70 bg-cyan-500/10"
            } ${onPick ? "guide-press cursor-pointer" : ""}`}
            style={{ ...getCellPixelPosition(s.row, s.col, cellSize, gap), width: size, height: size }}
          >
            <div className={grown ? "" : "opacity-45"}>
              <CropImage cropId={s.mutationId} cropName={nameOf(s.mutationId)} width={size * 0.62} height={size * 0.62} showFallback={false} />
            </div>
            {grown && cellSize >= 18 && (
              <span className="absolute bottom-0 right-0.5 text-[9px] font-semibold leading-none text-emerald-200 drop-shadow">{grown.fullyGrown ? "✓" : grown.stage}</span>
            )}
          </Tag>
        );
      })}

      {layout.plants.map((p) => {
        const k = key(p.row, p.col);
        const size = span(p.size);
        const paid = p.origin === "placed" && !isFreePlacedItem(p.kindId);
        const gone = missing.has(k);
        const ring = highlighted.has(k) ? "0 0 0 2px rgba(251,191,36,0.95)" : gone ? "0 0 0 2px rgba(248,113,113,0.95)" : undefined;
        return (
          <Tag
            key={`plant-${k}`}
            type={onPick ? "button" : undefined}
            onClick={onPick ? () => onPick({ kind: "plant", row: p.row, col: p.col, id: p.kindId, paid }) : undefined}
            title={`${nameOf(p.kindId)} — ${paid ? "placed from your inventory" : "free"}${gone ? " (missing)" : ""}`}
            aria-label={onPick ? `${nameOf(p.kindId)} at row ${p.row + 1}, column ${p.col + 1}` : undefined}
            className={`absolute flex items-center justify-center rounded ${onPick ? "guide-press cursor-pointer" : ""}`}
            style={{ ...getCellPixelPosition(p.row, p.col, cellSize, gap), width: size, height: size, boxShadow: ring }}
          >
            <div style={gone ? { opacity: 0.25, filter: "grayscale(1)" } : undefined}>
              <CropImage
                cropId={p.kindId}
                cropName={nameOf(p.kindId)}
                width={size * (p.size === 1 ? 0.82 : 0.62)}
                height={size * (p.size === 1 ? 0.82 : 0.62)}
                hasGroundContext
                showFallback
              />
            </div>
            {gone && <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-red-400 drop-shadow">✕</span>}
            {primed.has(k) && <span className="absolute left-0.5 top-0 text-[10px] leading-none text-rose-400 drop-shadow">✹</span>}
          </Tag>
        );
      })}
    </div>
  );

  return (
    <div ref={fixed ? undefined : fitRef} className={`w-full ${className}`}>
      {compass ? <CompassFrame className="mx-auto">{grid}</CompassFrame> : <div className="mx-auto w-fit">{grid}</div>}
    </div>
  );
};
