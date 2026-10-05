import React from "react";
import { Eye } from "lucide-react";
import { DRY_FILTER, INDICATOR_LABEL, MARK_STYLE, type GridMarker, type Indicator, type Mark } from "./markerStyles";

/** The swatch drawn for each grid indicator, shared by the legend and the hover card. */
const INDICATOR_SWATCH: Record<Indicator, React.ReactNode> = {
  slotReady: (
    <>
      <span className="inline-block w-3 h-3 rounded border border-dashed border-cyan-400/70" />
      <Eye className="w-3 h-3 text-cyan-300/80" />
    </>
  ),
  slotBlocked: <span className="inline-block w-3 h-3 rounded border border-dashed border-amber-400/80" />,
  slotRequirements: <span className="inline-block w-3 h-3 rounded border border-dashed border-red-500/80" />,
  halted: <span className="inline-block w-3 h-3 rounded border-2 border-dashed border-amber-600/90" style={{ filter: DRY_FILTER }} />,
  slotUnchecked: <span className="inline-block w-3 h-3 rounded border border-dashed border-slate-500/60" />,
  missing: <span className="inline-block w-3 h-3 rounded border border-dashed border-red-500/70" />,
  spawn: <span className="inline-block w-3 h-3 rounded" style={{ boxShadow: "inset 0 0 0 1px rgba(103,232,249,0.7)" }} />,
  rival: <span className="inline-block w-3 h-3 rounded" style={{ boxShadow: "inset 0 0 0 2px rgba(251,146,60,0.8)" }} />,
  root: <span className="inline-block w-3 h-3 rounded" style={{ boxShadow: "inset 0 0 0 2px rgba(190,18,60,0.8)" }} />,
  growing: <span className="inline-block w-3 h-[3px] bg-emerald-400/80" />,
  dead: <span className="inline-block w-3 h-3 rounded bg-slate-500" style={{ filter: "grayscale(1) brightness(0.55)" }} />,
  dry: <span className="inline-block w-3 h-3 rounded bg-emerald-500" style={{ filter: DRY_FILTER }} />,
  sleepy: <span className="text-[9px] text-amber-300">z</span>,
  primed: <span className="text-[9px] text-rose-400">✹</span>,
  unmet: <span className="text-[9px] text-amber-300">⚠</span>,
};

const MarkerItem: React.FC<{ marker: GridMarker }> = ({ marker }) => (
  <span className="flex items-center gap-1">
    <span className="flex flex-shrink-0 items-center gap-1">
      {"mark" in marker ? (
        <span className={`font-bold ${MARK_STYLE[marker.mark].color}`}>{MARK_STYLE[marker.mark].glyph}</span>
      ) : (
        INDICATOR_SWATCH[marker.indicator]
      )}
    </span>
    <span>{marker.label ?? ("mark" in marker ? MARK_STYLE[marker.mark].label : INDICATOR_LABEL[marker.indicator])}</span>
  </span>
);

/** Legend for the grid marks (events of the last simulated cycle) and the other grid indicators. */
export const PlotMarkLegend: React.FC = () => (
  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
    {(Object.keys(MARK_STYLE) as Mark[]).map((m) => (
      <MarkerItem key={m} marker={{ mark: m }} />
    ))}
    {(Object.keys(INDICATOR_LABEL) as Indicator[]).map((i) => (
      <MarkerItem key={i} marker={{ indicator: i }} />
    ))}
  </div>
);

/** The hover card's "On the grid" section: the icons drawn on the hovered element, with their legend meaning. */
export const GridMarkersSection: React.FC<{ markers: GridMarker[] }> = ({ markers }) =>
  markers.length === 0 ? null : (
    <div className="mb-2 space-y-0.5 text-[11px] text-slate-300" data-testid="grid-markers">
      <div className="uppercase tracking-wide text-slate-500">On the grid</div>
      {markers.map((m, i) => (
        <MarkerItem key={i} marker={m} />
      ))}
    </div>
  );
