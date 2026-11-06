import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Brush, Info, Lock, Trash2, X } from "lucide-react";
import { useGreenhouseData, useLockedPlacements, useInfoModal } from "../../context";
import { getRarityTextColor, LocalStorageManager } from "../../utilities";
import { CropImage, SearchFilterHeader } from "../shared";
import { useCropFiltering } from "../../hooks/shared/useCropFiltering";
import type { CropDefinition, MutationDefinition, SelectedCropForPlacement } from "../../types/greenhouse";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { IconButton, KitInput, KitLabel, Pill } from "../ui/kit";

interface CropConfigurationsPanelProps {
  className?: string;
  /** Render as a collapsible section (closed unless priorities or locks are set). */
  collapsible?: boolean;
}

/** One crop: image, name (rarity colour on mutation names), info, brush (lock it on the grid), priority. */
const CropItemRow: React.FC<{
  crop: CropDefinition;
  mutation?: MutationDefinition;
  priority: number;
  defaultPriority: number;
  isPlacementActive: boolean;
  onInfoClick: () => void;
  onEditClick: () => void;
  onPriorityChange: (value: number) => void;
  onRowClick?: () => void;
}> = ({ crop, mutation, priority, defaultPriority, isPlacementActive, onInfoClick, onEditClick, onPriorityChange, onRowClick }) => {
  const displayValue = priority !== defaultPriority ? priority.toString() : "";
  const [inputValue, setInputValue] = useState<string>(displayValue);
  useEffect(() => {
    setInputValue(displayValue);
  }, [displayValue]);

  const handlePriorityChange = (value: string) => {
    setInputValue(value);
    if (value === "") {
      onPriorityChange(defaultPriority);
      return;
    }
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) onPriorityChange(numValue);
  };

  return (
    <li
      className={cn(
        "flex h-10 min-w-0 items-center gap-1.5 rounded-control px-1.5 transition-colors duration-(--duration-hover)",
        isPlacementActive ? "bg-coin/10 ring-1 ring-coin/50" : "hover:bg-surface-hover",
      )}
    >
      {onRowClick && mutation ? (
        <button
          type="button"
          onClick={onRowClick}
          className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-inner text-left"
          title={`Add ${crop.name} to the targets`}
        >
          <CropImage cropId={crop.id} cropName={crop.name} size="sm" className="size-7 shrink-0" imageClassName="size-6" fallbackClassName="text-meta text-fg-meta" />
          <span className={cn("truncate text-body font-medium", getRarityTextColor(mutation.rarity))}>{crop.name}</span>
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <CropImage cropId={crop.id} cropName={crop.name} size="sm" className="size-7 shrink-0" imageClassName="size-6" fallbackClassName="text-meta text-fg-meta" />
          <span className={cn("truncate text-body font-medium", mutation ? getRarityTextColor(mutation.rarity) : "text-fg")}>{crop.name}</span>
        </span>
      )}
      <IconButton aria-label={`About ${crop.name}`} onClick={onInfoClick}>
        <Info />
      </IconButton>
      <IconButton
        aria-label={isPlacementActive ? `Stop placing ${crop.name}` : `Lock ${crop.name} on the grid`}
        title={isPlacementActive ? "Stop placing (Esc)" : "Place on the grid: the solver works around it"}
        aria-pressed={isPlacementActive}
        onClick={onEditClick}
        className={isPlacementActive ? "text-coin hover:text-coin" : undefined}
      >
        {isPlacementActive ? <X /> : <Brush />}
      </IconButton>
      <KitInput
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        value={inputValue}
        placeholder={defaultPriority.toString()}
        onChange={(e) => handlePriorityChange(e.target.value)}
        aria-label={`${crop.name} priority (0 to 100; higher = use less)`}
        title="Priority: higher = use less of this crop (0 = no preference, 100 = avoid)"
        className="h-7 w-12 shrink-0 px-1.5 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
    </li>
  );
};

export const CropConfigurationsPanel: React.FC<CropConfigurationsPanelProps> = ({ className, collapsible = false }) => {
  const { crops, getCropDef, getMutationDef, addMutation } = useGreenhouseData();
  const { lockedPlacements, selectedCropForPlacement, setSelectedCropForPlacement, removeLockedPlacement, clearLockedPlacements, setPriority, getPriority, priorities, defaultPriorities } =
    useLockedPlacements();
  const { openInfo } = useInfoModal();
  const [priorityWarningDismissed, setPriorityWarningDismissed] = useState(false);
  // Collapsible: closed unless priorities or locks are already set.
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    const custom = Object.keys(LocalStorageManager.loadPriorities() || {}).length > 0;
    return custom || (LocalStorageManager.loadLockedPlacements() || []).length > 0;
  });

  const { searchTerm, setSearchTerm, filter, setFilter, filteredCrops } = useCropFiltering({ crops, mutations: [] });

  const hasPriorities = useMemo(
    () => Object.keys(priorities).some((cropId) => (priorities[cropId] || 0) !== (defaultPriorities[cropId] || 0)),
    [priorities, defaultPriorities],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedCropForPlacement) setSelectedCropForPlacement(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedCropForPlacement, setSelectedCropForPlacement]);

  // Toggles placement mode for the crop.
  const handleEditClick = useCallback(
    (crop: CropDefinition) => {
      if (selectedCropForPlacement?.id === crop.id) setSelectedCropForPlacement(null);
      else {
        const selection: SelectedCropForPlacement = { id: crop.id, name: crop.name, size: crop.size, ground: crop.ground };
        setSelectedCropForPlacement(selection);
      }
    },
    [selectedCropForPlacement, setSelectedCropForPlacement],
  );

  const getLockedPlacementName = useCallback((cropId: string): string => getCropDef(cropId)?.name ?? getMutationDef(cropId)?.name ?? cropId, [getCropDef, getMutationDef]);

  const resetPriorities = () => Object.keys(priorities).forEach((cropId) => setPriority(cropId, defaultPriorities[cropId] || 0));
  const status = [hasPriorities ? "priorities" : null, lockedPlacements.length > 0 ? `${lockedPlacements.length} locked` : null].filter(Boolean).join(" · ");

  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col gap-3", className)} aria-labelledby="priorities-title" data-testid="priorities-panel">
      <header className="flex min-h-7 shrink-0 items-center gap-2">
        {collapsible ? (
          <button type="button" id="priorities-title" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="focus-ring cursor-pointer rounded-inner text-left">
            <KitLabel>Priorities &amp; locks</KitLabel>
          </button>
        ) : (
          <h2 id="priorities-title">
            <KitLabel>Priorities &amp; locks</KitLabel>
          </h2>
        )}
        <InfoHint title="Priorities & locks" width={280}>
          <p>Priorities tell the solver which crops to use sparingly: higher = use less (0 = no preference, 100 = avoid).</p>
          <p>The brush locks a crop on the grid, so the solver must work around it. Right-click a lock on the grid to remove it.</p>
        </InfoHint>
        {status && <Pill tone="warn">{status}</Pill>}
        {open && hasPriorities && (
          <LinkButton className="ml-auto text-meta" onClick={resetPriorities} title="Reset every priority to its default">
            Reset priorities
          </LinkButton>
        )}
      </header>

      {open && (
        <>
          <SearchFilterHeader className="shrink-0" searchTerm={searchTerm} onSearchChange={setSearchTerm} searchPlaceholder="Find a crop" filter={filter} onFilterChange={setFilter} />

          {hasPriorities && !priorityWarningDismissed && (
            <div className="flex shrink-0 items-start gap-2 rounded-control border border-warn/30 bg-warn/10 p-2">
              <p className="flex-1 text-secondary text-warn">Priorities make cached solves less likely, so solving can take longer.</p>
              <IconButton aria-label="Dismiss" onClick={() => setPriorityWarningDismissed(true)}>
                <X />
              </IconButton>
            </div>
          )}

          {lockedPlacements.length > 0 && (
            <section className="shrink-0 space-y-1.5" aria-label="Locked placements">
              <KitLabel
                actions={
                  <IconButton aria-label="Remove every lock" title="Remove every locked placement" onClick={clearLockedPlacements}>
                    <Trash2 />
                  </IconButton>
                }
              >
                <span className="inline-flex items-center gap-1">
                  <Lock aria-hidden className="size-3 text-coin" /> Locked ({lockedPlacements.length})
                </span>
              </KitLabel>
              <ul className="scrollbar-dark max-h-32 space-y-0.5 overflow-y-auto">
                {lockedPlacements.map((placement) => {
                  const name = getLockedPlacementName(placement.crop);
                  return (
                    <li key={placement.id} className="flex min-w-0 items-center gap-2 rounded-control px-1.5 py-0.5 hover:bg-surface-hover">
                      <CropImage cropId={placement.crop} cropName={name} size="xs" className="size-5 shrink-0" imageClassName="size-5" fallbackText="" showFallback={false} />
                      <span className="min-w-0 flex-1 truncate text-secondary text-fg-body">
                        {name}{" "}
                        <span className="tabular-nums text-fg-meta">
                          ({placement.position[0]}, {placement.position[1]})
                        </span>
                      </span>
                      <IconButton aria-label={`Remove the lock on ${name} at ${placement.position[0]}, ${placement.position[1]}`} onClick={() => removeLockedPlacement(placement.id)}>
                        <X />
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {filteredCrops.length === 0 ? (
            <p className="shrink-0 py-4 text-center text-secondary text-fg-meta">No crops match the filter.</p>
          ) : (
            <ul className="scrollbar-dark min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain md:-mr-1.5 md:pr-1.5" aria-label="Crops">
              {filteredCrops.map((crop) => (
                <CropItemRow
                  key={crop.id}
                  crop={crop}
                  mutation={crop.isMutation ? getMutationDef(crop.id) : undefined}
                  priority={getPriority(crop.id)}
                  defaultPriority={defaultPriorities[crop.id] || 0}
                  isPlacementActive={selectedCropForPlacement?.id === crop.id}
                  onInfoClick={() => openInfo(crop.id)}
                  onEditClick={() => handleEditClick(crop)}
                  onPriorityChange={(val) => setPriority(crop.id, val)}
                  onRowClick={crop.isMutation ? () => addMutation(crop.id, crop.name) : undefined}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};
