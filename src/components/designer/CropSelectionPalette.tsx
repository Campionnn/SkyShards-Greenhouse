import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ListFilter } from "lucide-react";
import { useDesigner, useGreenhouseData, type DesignerMode } from "../../context";
import { KitLabel, Segmented } from "../ui/kit";
import { Dropdown, MenuItem } from "../ui/Popover";
import { cn } from "../ui/cn";
import { CropImage, CropSearchInput, SearchFilterHeader, defaultGetFilterColor } from "../shared";
import { useCropFiltering } from "../../hooks/shared/useCropFiltering";
import { CROP_FILTER_OPTIONS } from "../../constants";
import { getRarityTextColor, GROUND_TYPES, type GroundType } from "../../utilities";
import { getGroundImagePath, type CropDefinition, type CropFilterCategory } from "../../types/greenhouse";

// The Designer's palette (research/designer-v2; also the simulator flow editor's layout workspace and the
// Designer's phone sheet): Inputs | Targets with counts, named ground swatches, search + filter, then the
// tiles in Crops / Mutations groups. It fills its box (only the tiles scroll) and lays itself out from its
// own width: as many tile columns as fit at 68px or more, ground swatches 3 / 2 / 1 per row.
// Tile names wrap at spaces only (no hyphenation, never mid-word): 68px fits the longest one-word name,
// "Witherbloom" (67px at 11px Inter). The size badge shows only on items bigger than 1×1; selection is the
// select role (no yellow). What the next click does is said above the grid (PickStatus), not here.

const groundName = (g: string) => g.replace(/_/g, " ");

/** Tiles are at least this wide (see above). */
const MIN_TILE = 68;
const TILE_GAP = 2;
/** The tile list borrows 4px of the surrounding padding for its 6px scrollbar (every host pads ≥ 6px). */
const SCROLL_BORROW = 4;
const SCROLLBAR = 6;
/** One ground swatch with its name beside the texture needs ~99px ("netherrack" is 57px at 11px). */
const SWATCH_MIN = 99;

/** Inputs | Targets with counts (D19). Switching to Targets drops a picked plain crop: it can't be a target (D20). */
export const PaletteModeSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const { mode, setMode, inputPlacements, targetPlacements, selectedCropForPlacement, setSelectedCropForPlacement } = useDesigner();
  const label = (name: string, n: number) => (
    <span className="whitespace-nowrap">
      {name} <span className="ml-0.5 tabular-nums text-fg-meta">{n}</span>
    </span>
  );
  return (
    <Segmented<DesignerMode>
      label="Place as"
      value={mode}
      onChange={(m) => {
        setMode(m);
        if (m === "targets" && selectedCropForPlacement && !selectedCropForPlacement.isMutation) setSelectedCropForPlacement(null);
      }}
      className={cn("[&>button]:flex-1 pointer-coarse:[&>button]:h-11", className)}
      options={[
        { value: "inputs", title: "Place crops and mutations that feed the targets", label: label("Inputs", inputPlacements.length) },
        { value: "targets", title: "Place the mutation spots you want to check", label: label("Targets", targetPlacements.length) },
      ]}
    />
  );
};

const Tile: React.FC<{ crop: CropDefinition; rarity?: string; selected: boolean; onClick: () => void; onContextMenu?: () => void }> = ({
  crop,
  rarity,
  selected,
  onClick,
  onContextMenu,
}) => (
  <button
    type="button"
    aria-pressed={selected}
    title={`${crop.size > 1 ? `${crop.name} (${crop.size}×${crop.size})` : crop.name}${onContextMenu ? ". Right-click to place as a target." : ""}`}
    onClick={onClick}
    onContextMenu={
      onContextMenu
        ? (e) => {
            e.preventDefault();
            onContextMenu();
          }
        : undefined
    }
    className={cn(
      "focus-ring relative flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-control pt-1.5 pb-1 transition-colors duration-(--duration-hover)",
      selected ? "bg-select/10 ring-2 ring-select ring-inset" : "hover:bg-surface-hover",
    )}
  >
    <CropImage cropId={crop.id} cropName={crop.name} size="custom" width={30} height={30} showFallback />
    {/* Two lines, broken at spaces only; "Do-not-eat-shroom" breaks at its own hyphens. Rarity colour on the name only. */}
    <span className={cn("line-clamp-2 w-full text-center text-meta hyphens-none", rarity ? getRarityTextColor(rarity) : "text-fg-body")}>{crop.name}</span>
    {crop.size > 1 && <span className="absolute top-0.5 right-0.5 rounded-inner bg-surface-well px-1 text-meta tabular-nums text-fg-muted">{`${crop.size}×${crop.size}`}</span>}
  </button>
);

/**
 * Named ground swatches (D22): the texture with its name beside it, 3, 2 or 1 per row (whatever the width
 * fits without cutting a name). Click toggles; picking ground drops the crop pick and back (the provider).
 * The caption is the count only: painting is announced once, by the status above the grid.
 */
const GroundSwatches: React.FC<{ columns: 1 | 2 | 3; onPicked?: () => void }> = ({ columns, onPicked }) => {
  const { groundTiles, selectedGround, setSelectedGround } = useDesigner();
  const pick = (g: GroundType) => {
    setSelectedGround(selectedGround === g ? null : g);
    if (selectedGround !== g) onPicked?.();
  };
  const one = columns === 1;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex h-4 min-w-0 items-center justify-between gap-2">
        <KitLabel>Ground</KitLabel>
        <span className="min-w-0 truncate text-meta tabular-nums text-fg-meta">{groundTiles.length} painted</span>
      </div>
      <div className={cn("grid", columns === 3 ? "grid-cols-3 gap-1" : columns === 2 ? "grid-cols-2 gap-1" : "grid-cols-1 gap-0.5")}>
        {GROUND_TYPES.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={selectedGround === g}
            title={`Paint ${groundName(g)} on bare cells. Right-click erases.`}
            onClick={() => pick(g)}
            className={cn(
              "focus-ring flex min-w-0 cursor-pointer items-center rounded-control border pr-1.5 pl-1 text-meta transition-colors duration-(--duration-hover) pointer-coarse:h-11",
              one ? "h-6 gap-1.5" : "h-8 gap-1.5",
              selectedGround === g ? "border-select bg-select/10 text-select-fg" : "border-line bg-surface-control text-fg-body hover:border-line-control",
            )}
          >
            <img src={getGroundImagePath(g)} alt="" className={cn("shrink-0 rounded-inner", one ? "size-4" : "size-6")} />
            <span className="min-w-0 truncate">{groundName(g)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/** In a narrow rail: the search, and the filter as an icon-width menu button beside it (a dot when filtered). */
const CompactSearch: React.FC<{ search: string; onSearch: (v: string) => void; filter: CropFilterCategory; onFilter: (v: CropFilterCategory) => void }> = ({
  search,
  onSearch,
  filter,
  onFilter,
}) => {
  const current = CROP_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? "All";
  return (
    <div className="flex min-w-0 shrink-0 gap-1">
      <CropSearchInput value={search} onChange={onSearch} placeholder="Search..." className="flex-1 pointer-coarse:[&_input]:h-11" />
      <Dropdown
        label={`Filter: ${current}`}
        title={`Filter: ${current}`}
        look="plain"
        chevron={false}
        width={200}
        align="end"
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-line-control bg-surface-well text-fg-muted transition-colors duration-(--duration-hover) hover:border-fg-meta hover:text-fg pointer-coarse:size-11"
        button={
          <>
            <ListFilter aria-hidden className="size-3.5" />
            {filter !== "all" && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-select" />}
          </>
        }
      >
        {(close) =>
          CROP_FILTER_OPTIONS.map((o) => (
            <MenuItem
              key={o.value}
              checked={filter === o.value}
              onSelect={() => {
                onFilter(o.value);
                close();
              }}
            >
              <span className={defaultGetFilterColor(o.value)}>{o.label}</span>
            </MenuItem>
          ))
        }
      </Dropdown>
    </div>
  );
};

interface CropSelectionPaletteProps {
  className?: string;
  /** The Inputs | Targets switch on top (default). The phone sheet shows it in its peek row instead. */
  showMode?: boolean;
  /** After an item or a ground is picked (the phone sheet folds down). */
  onPicked?: () => void;
}

/** The palette. Give it a box with a height (a flex column, or `h-full` in a sized box): only the tiles scroll. */
export const CropSelectionPalette: React.FC<CropSelectionPaletteProps> = ({ className, showMode = true, onPicked }) => {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(212);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => el.clientWidth > 0 && setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tileArea = width + SCROLL_BORROW - SCROLLBAR;
  const columns = Math.max(2, Math.floor((tileArea + TILE_GAP) / (MIN_TILE + TILE_GAP)));
  const groundColumns = width >= 3 * SWATCH_MIN + 8 ? 3 : width >= 2 * SWATCH_MIN + 4 ? 2 : 1;
  const narrow = width < 2 * SWATCH_MIN + 4;

  const { crops, mutations } = useGreenhouseData();
  const { selectedCropForPlacement, setSelectedCropForPlacement, mode, setMode } = useDesigner();
  // Targets mode lists mutations only (D20).
  const additionalFilter = useMemo(() => (mode === "targets" ? (c: CropDefinition) => !!c.isMutation : undefined), [mode]);
  // `crops` arrives grouped by rarity (GreenhouseDataContext), so the separators line up.
  const { searchTerm, setSearchTerm, filter, setFilter, filteredCrops, getMutationDef } = useCropFiltering({ crops, mutations, additionalFilter });
  const plain = filteredCrops.filter((c) => !c.isMutation);
  const muts = filteredCrops.filter((c) => c.isMutation);
  // A second click on the picked tile drops it (D24).
  const pick = (c: CropDefinition) => {
    if (selectedCropForPlacement?.id === c.id) setSelectedCropForPlacement(null);
    else {
      setSelectedCropForPlacement({ id: c.id, name: c.name, size: c.size, isMutation: c.isMutation ?? false });
      onPicked?.();
    }
  };
  // Right-click on a mutation picks it as a target in one go: switches to Targets and selects it (no toggle-off).
  const pickTarget = (c: CropDefinition) => {
    if (mode !== "targets") setMode("targets");
    if (selectedCropForPlacement?.id !== c.id) setSelectedCropForPlacement({ id: c.id, name: c.name, size: c.size, isMutation: true });
    onPicked?.();
  };
  const cols = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  return (
    <div ref={root} className={cn("flex min-h-0 min-w-0 flex-col gap-2.5", className)}>
      {showMode && <PaletteModeSwitch className={cn("flex w-full shrink-0", narrow && "[&>button]:px-1")} />}
      <div className="shrink-0">
        <GroundSwatches columns={groundColumns} onPicked={onPicked} />
      </div>
      {narrow ? (
        <CompactSearch search={searchTerm} onSearch={setSearchTerm} filter={filter} onFilter={setFilter} />
      ) : (
        <SearchFilterHeader
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filter={filter}
          onFilterChange={setFilter}
          className="shrink-0 pointer-coarse:[&_button]:h-11 pointer-coarse:[&_input]:h-11"
        />
      )}
      {/* The scrollbar sits in 4px of the host's padding (-mr-1), so the tiles keep their width without poking past it. */}
      <div className="scrollbar-dark -mr-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {plain.length > 0 && (
          <section aria-label="Crops" className="mb-2">
            <KitLabel className="mb-1">Crops</KitLabel>
            <div className="grid gap-0.5" style={cols}>
              {plain.map((c) => (
                <Tile key={c.id} crop={c} selected={selectedCropForPlacement?.id === c.id} onClick={() => pick(c)} />
              ))}
            </div>
          </section>
        )}
        {muts.length > 0 && (
          <section aria-label="Mutations">
            <KitLabel className="mb-1">Mutations</KitLabel>
            <div className="grid gap-0.5" style={cols}>
              {muts.map((c, i) => {
                const rarity = getMutationDef(c.id)?.rarity;
                const prev = i > 0 ? getMutationDef(muts[i - 1].id)?.rarity : rarity;
                return (
                  <React.Fragment key={c.id}>
                    {/* A thin rule between rarities (D25). */}
                    {prev !== rarity && <span aria-hidden className="col-span-full my-1 h-px bg-line" />}
                    <Tile crop={c} rarity={rarity} selected={selectedCropForPlacement?.id === c.id} onClick={() => pick(c)} onContextMenu={() => pickTarget(c)} />
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        )}
        {filteredCrops.length === 0 && <p className="py-8 text-center text-secondary text-fg-meta">No items found</p>}
      </div>
    </div>
  );
};
