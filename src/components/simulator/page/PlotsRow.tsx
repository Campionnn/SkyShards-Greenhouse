import React, { useState } from "react";
import { ChevronDown, FolderOpen, Plus, ScanSearch } from "lucide-react";
import type { PlotState } from "../../../simulator";
import { KitButton } from "../../ui/kit";
import { PlotMarkLegend } from "../markers";
import { legendSize, markerKey, type GridMarker } from "../markerStyles";
import { FIT_HEIGHT_RESERVE } from "../PlotView";

// The simulator page's plots row: up to three plot grids side by side (3 columns down to 960px,
// 2 below, 1 below 640px), an "Add plot" tile while there are fewer than three, and the legend
// strip with the Sanity check toggle under them.

/** The legend entries shown before "N more": the ones on almost every grid. */
const COMMON: GridMarker[] = [
  { indicator: "slotReady", label: "target" },
  { indicator: "slotRequirements", label: "missing requirements" },
  { indicator: "spawn" },
  { mark: "harvested" },
  { mark: "decayed" },
];

export const PlotLegendStrip: React.FC<{
  normalProfile: boolean;
  /** `markerKey`s drawn on the hovered grid element: those entries light up. */
  highlight: readonly string[];
  sanityOn: boolean;
  onSanityToggle: () => void;
}> = ({ normalProfile, highlight, sanityOn, onSanityToggle }) => {
  const [open, setOpen] = useState(false);
  const more = legendSize(normalProfile) - COMMON.length;
  // Collapsed, a hovered element's entries that aren't among the common ones still show (after them).
  const shown = new Set(COMMON.map(markerKey));
  const extra: GridMarker[] = open
    ? []
    : highlight.filter((k) => !shown.has(k)).map((k) => (k.startsWith("mark:") ? { mark: k.slice(5) } : { indicator: k.slice(10) }) as GridMarker);
  return (
    <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {open ? (
          <PlotMarkLegend normalProfile={normalProfile} highlight={highlight} className="text-secondary" />
        ) : (
          <PlotMarkLegend normalProfile={normalProfile} highlight={highlight} items={[...COMMON, ...extra]} className="text-secondary" />
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="focus-ring hit-area inline-flex cursor-pointer items-center gap-1 rounded-inner px-1 text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg-body"
        >
          <ChevronDown className={`size-3 transition-transform duration-(--duration-ink) ease-snappy ${open ? "rotate-180" : ""}`} />
          {open ? "Fewer" : `${more} more`}
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {sanityOn && <span className="hidden text-secondary text-fg-meta sm:inline">Hover an empty cell or target slot</span>}
        <KitButton
          variant="ghost"
          // On is a selected state (a mode you are in), so it takes the selection colour, not go.
          className={sanityOn ? "border-select/35 bg-select/10 text-select-fg hover:bg-select/20 hover:text-select-fg" : undefined}
          aria-pressed={sanityOn}
          onClick={onSanityToggle}
          title="Hover an empty cell or target slot to see which mutations could spawn there now, and why the others can't"
        >
          <ScanSearch />
          Sanity check
        </KitButton>
      </div>
    </div>
  );
};

/** The dashed "Add plot N" tile, the size of a grid. */
const AddPlotTile: React.FC<{ next: number; onLoadLayout: () => void; onEmptyPlot: () => void }> = ({ next, onLoadLayout, onEmptyPlot }) => (
  <div className="min-w-0">
    {/* Same offset as a plot's header (30px + 8px gap), so the tile lines up with the grids. */}
    <div
      className="mx-auto mt-[38px] flex aspect-square flex-col items-center justify-center gap-2.5 rounded-container border-[1.5px] border-dashed border-line-strong p-4 text-center"
      style={{ width: `min(100%, max(320px, calc(100vh - ${FIT_HEIGHT_RESERVE}px)))` }}
    >
      <b className="text-body font-semibold text-fg">Add plot {next}</b>
      <span className="text-secondary text-fg-meta">Up to 3 plots share one inventory and clock</span>
      <div className="mt-1 flex flex-wrap justify-center gap-1.5">
        <KitButton onClick={onLoadLayout}>
          <FolderOpen />
          Load layout…
        </KitButton>
        <KitButton variant="ghost" onClick={onEmptyPlot}>
          <Plus />
          Empty plot
        </KitButton>
      </div>
    </div>
  </div>
);

export interface PlotsRowProps {
  plots: PlotState[];
  /** Renders one plot (the page passes a PlotView). */
  render: (plot: PlotState) => React.ReactNode;
  /** Show the "Add plot" tile (fewer than 3 plots and not previewing). */
  canAdd: boolean;
  nextPlotNumber: number;
  onLoadLayout: () => void;
  onEmptyPlot: () => void;
  normalProfile: boolean;
  legendHighlight: readonly string[];
  sanityOn: boolean;
  onSanityToggle: () => void;
}

export const PlotsRow: React.FC<PlotsRowProps> = ({
  plots,
  render,
  canAdd,
  nextPlotNumber,
  onLoadLayout,
  onEmptyPlot,
  normalProfile,
  legendHighlight,
  sanityOn,
  onSanityToggle,
}) => (
  <section aria-label="Plots">
    <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 min-[640px]:grid-cols-2 min-[960px]:grid-cols-3">
      {plots.map((p) => (
        <div key={p.id} className="min-w-0">
          {render(p)}
        </div>
      ))}
      {canAdd && <AddPlotTile next={nextPlotNumber} onLoadLayout={onLoadLayout} onEmptyPlot={onEmptyPlot} />}
    </div>
    <PlotLegendStrip normalProfile={normalProfile} highlight={legendHighlight} sanityOn={sanityOn} onSanityToggle={onSanityToggle} />
  </section>
);
