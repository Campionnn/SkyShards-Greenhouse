import React, { useMemo, useState, useRef, useCallback } from "react";
import { CheckCircle2, AlertCircle, Grid3X3, Eye, EyeOff, Zap, Clock, RotateCcw, Paintbrush } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GRID_SIZE } from "../../constants";
import { useGreenhouseData, useGridState, useLockedPlacements, useDesigner, useInfoModal } from "../../context";
import { useGridPlacement, useFitCellSize } from "../../hooks";
import {
  getGridDimensions,
  getRarityTextColor,
  simulateEffects,
  effectiveEffects,
  effectsGivenBy,
} from "../../utilities";
import {
  GridBackground,
  LockedPlacementCell,
  PlacementPreview,
  DragValidationOverlay,
  CropCell,
  MutationCell,
  EffectTooltip,
} from "../grid";
import { CropImage } from "../shared";
import { SectionLabel } from "../ui";
import { useToast } from "../ui/toastContext";
import type { SolveResponse, CropPlacement, MutationResult, JobProgress } from "../../types/greenhouse";

interface SolverResultsProps {
  result: SolveResponse | null;
  error: string | null;
  isLoading: boolean;
  progress?: JobProgress | null;
  queuePosition?: number | null;
  onClear?: () => void;
}

// Represents a crop/mutation placement on the grid
interface PlacementItem {
  id: string;
  name: string;
  size: number;
  startRow: number;
  startCol: number;
  locked?: boolean;
  isMutation?: boolean;
}

function getOccupiedCells(position: [number, number], size: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let dr = 0; dr < size; dr++) {
    for (let dc = 0; dc < size; dc++) {
      cells.push([position[0] + dr, position[1] + dc]);
    }
  }
  return cells;
}

function processPlacementsToItems(
  placements: CropPlacement[],
  getCropDef: (id: string) => { name: string } | undefined,
  getMutationDef: (id: string) => { name: string } | undefined
): { items: PlacementItem[]; occupiedCells: Set<string> } {
  const items: PlacementItem[] = [];
  const occupiedCells = new Set<string>();

  for (const p of placements) {
    const cropDef = getCropDef(p.crop);
    const mutationDef = getMutationDef(p.crop);
    const displayName = cropDef?.name || mutationDef?.name || p.crop.replace(/_/g, " ");

    items.push({
      id: p.crop,
      name: displayName,
      size: p.size,
      startRow: p.position[0],
      startCol: p.position[1],
      locked: p.locked || false,
    });

    for (const [row, col] of getOccupiedCells(p.position, p.size)) {
      occupiedCells.add(`${row},${col}`);
    }
  }

  return { items, occupiedCells };
}

function processMutationsToItems(
  mutations: MutationResult[],
  getMutationDef: (id: string) => { name: string } | undefined
): PlacementItem[] {
  return mutations.map(m => {
    const mutationDef = getMutationDef(m.mutation);
    const displayName = mutationDef?.name || m.mutation.replace(/_/g, " ");
    return {
      id: m.mutation,
      name: displayName,
      size: m.size,
      startRow: m.position[0],
      startCol: m.position[1],
      isMutation: true,
    };
  });
}

const StatTile: React.FC<{ label: string; value: string; hint?: string; tone?: "emerald" | "sky" | "slate" }> = ({
  label,
  value,
  hint,
  tone = "slate",
}) => {
  const color = tone === "emerald" ? "text-emerald-400" : tone === "sky" ? "text-sky-300" : "text-slate-200";
  return (
    <div className="bg-slate-700/30 rounded-md px-3 py-2 min-w-0" title={hint}>
      <span className="text-[11px] uppercase tracking-wide text-slate-400 block">{label}</span>
      <span className={`text-lg font-semibold leading-tight ${color}`}>{value}</span>
    </div>
  );
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 flex-1 ${className}`}>{children}</div>
);


const LoadingState: React.FC = () => (
  <Card>
    <div className="flex items-center gap-2 mb-3">
      <Grid3X3 className="w-4 h-4 text-emerald-400" />
      <h3 className="text-sm font-medium text-slate-200">Solution</h3>
    </div>
    <div className="flex flex-col items-center justify-center py-8">
      <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-3" />
      <span className="text-sm text-slate-400">Solving...</span>
    </div>
  </Card>
);

const ErrorState: React.FC<{ error: string }> = ({ error }) => (
  <Card>
    <div className="flex items-center gap-2 mb-3">
      <AlertCircle className="w-4 h-4 text-red-400" />
      <h3 className="text-sm font-medium text-slate-200">Error</h3>
    </div>
    <div className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-md text-red-300 text-sm">
      {error}
    </div>
  </Card>
);

const QueueBanner: React.FC<{ position: number }> = ({ position }) => (
  <div className="mb-4 bg-blue-500/20 border border-blue-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <Clock className="w-4 h-4 text-blue-400" />
      <span className="text-sm text-slate-300">Position in queue</span>
    </div>
    <span className="text-2xl font-bold text-blue-400">#{position}</span>
  </div>
);

const ProgressBar: React.FC<{ progress: JobProgress }> = ({ progress }) => {
  const elapsed = Math.round(progress.elapsed_seconds);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const time = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const pct = progress.percentage !== null && progress.percentage > 0 ? Math.round(progress.percentage) : null;
  return (
    <div className="mb-4 bg-slate-700/30 rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs text-slate-300 truncate">{progress.current_activity || progress.phase}</span>
        <span className="text-xs text-slate-400 flex items-center gap-3 flex-shrink-0">
          <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-emerald-400" />{progress.solutions_found}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{time}</span>
          {pct !== null && <span className="text-emerald-400">{pct}%</span>}
        </span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full bg-emerald-500 transition-all duration-300 ${pct === null ? "animate-pulse w-1/3" : ""}`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
};

const StatusMessage: React.FC<{
  hoveredPlacementId: string | null;
  isPlacementMode: boolean;
  hoverInfo: { cell: [number, number] } | null;
  hasResult: boolean;
  hasLockedPlacements: boolean;
}> = ({ hoveredPlacementId, isPlacementMode, hoverInfo, hasResult, hasLockedPlacements }) => {
  const getMessage = () => {
    if (hoveredPlacementId && isPlacementMode) {
      return (
        <span>
          <span className="font-semibold text-emerald-400">Click to place crops</span>,{" "}
          <span className="font-semibold text-red-400">right-click to remove</span>
          {!hasResult && <>, Esc to stop placing</>}
        </span>
      );
    }
    if (hoveredPlacementId && !isPlacementMode) {
      return (
        <span>
          Drag to move, <span className="font-semibold text-red-400">right-click to remove</span>
        </span>
      );
    }
    if (isPlacementMode && hoverInfo) {
      return (
        <span>
          <span className="font-semibold text-emerald-400">Click to place crops</span>, right-click to remove
          {!hasResult && <>, Esc to stop placing</>}
        </span>
      );
    }
    if (isPlacementMode) {
      return hasResult
        ? "Click to place crops, right-click to remove"
        : "Click to place crops, right-click to remove, Esc to stop placing";
    }
    if (hasLockedPlacements) {
      return "Drag locked placements to move, right-click to remove";
    }
    return hasResult
      ? ""
      : "Configure your targets and click \"Solve\" to find the optimal crop placement";
  };

  return <div className="text-center py-2 text-slate-500 text-sm">{getMessage()}</div>;
};

export const SolverResults: React.FC<SolverResultsProps> = ({
  result,
  error,
  isLoading,
  progress,
  queuePosition,
  onClear,
}) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const { unlockedCells } = useGridState();
  const { lockedPlacements, selectedCropForPlacement, isPlacementMode } = useLockedPlacements();
  const { loadFromSolverResult } = useDesigner();
  const { openInfo } = useInfoModal();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [showMutations, setShowMutations] = useState(true);
  const [hoveredEffectItem, setHoveredEffectItem] = useState<PlacementItem | null>(null);

  // Grid sizing: fit the available width, never scroll.
  const fitRef = useRef<HTMLDivElement>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: 60 });
  const gridRef = useRef<HTMLDivElement>(null);
  const { width: gridWidth, height: gridHeight } = getGridDimensions(cellSize, gap);

  // Handle sending current grid content to designer
  const handleSendToDesigner = useCallback(() => {
    const inputs: Array<{ id: string; name: string; position: [number, number]; size: number }> = [];
    const targets: Array<{ id: string; name: string; position: [number, number]; size: number }> = [];

    for (const placement of lockedPlacements) {
      const cropDef = getCropDef(placement.crop);
      const mutationDef = getMutationDef(placement.crop);
      const displayName = cropDef?.name || mutationDef?.name || placement.crop.replace(/_/g, " ");
      inputs.push({ id: placement.crop, name: displayName, position: placement.position, size: placement.size });
    }

    if (result) {
      for (const placement of result.placements || []) {
        const overlapsWithLocked = lockedPlacements.some(locked => {
          const [lr, lc] = locked.position;
          const [pr, pc] = placement.position;
          const noOverlap =
            pr + placement.size <= lr || lr + locked.size <= pr ||
            pc + placement.size <= lc || lc + locked.size <= pc;
          return !noOverlap;
        });
        if (!overlapsWithLocked) {
          const cropDef = getCropDef(placement.crop);
          const mutationDef = getMutationDef(placement.crop);
          const displayName = cropDef?.name || mutationDef?.name || placement.crop.replace(/_/g, " ");
          inputs.push({ id: placement.crop, name: displayName, position: placement.position, size: placement.size });
        }
      }
      for (const mutation of result.mutations || []) {
        const mutationDef = getMutationDef(mutation.mutation);
        const cropDef = getCropDef(mutation.mutation);
        const displayName = mutationDef?.name || cropDef?.name || mutation.mutation.replace(/_/g, " ");
        targets.push({ id: mutation.mutation, name: displayName, position: mutation.position, size: mutation.size });
      }
    }

    if (inputs.length === 0 && targets.length === 0) {
      toast({ title: "Nothing to send", description: "Place some locked crops or solve first", variant: "warning", duration: 3000 });
      return;
    }

    loadFromSolverResult(inputs, targets);
    toast({ title: "Sent to Designer", description: `Loaded ${inputs.length} inputs and ${targets.length} targets`, variant: "success", duration: 3000 });
    navigate("/designer");
  }, [lockedPlacements, result, getCropDef, getMutationDef, loadFromSolverResult, toast, navigate]);

  const {
    hoveredPlacementId,
    setHoveredPlacementId,
    dragState,
    paintState,
    hoverInfo,
    previewPosition,
    previewValidation,
    dragValidation,
    handleMouseMove,
    handleMouseLeave,
    handleMouseDown,
    handleMouseUp,
    handleContextMenu,
    handlePlacementMouseDown,
    cancelDrag,
  } = useGridPlacement({ cellSize, gap, gridRef });

  const groundOf = useCallback((id: string) => {
    const cropDef = getCropDef(id);
    const mutationDef = getMutationDef(id);
    return cropDef?.ground || mutationDef?.ground || "farmland";
  }, [getCropDef, getMutationDef]);

  const { items: cropItems, occupiedCells } = useMemo(() => {
    if (!result) return { items: [], occupiedCells: new Set<string>() };
    return processPlacementsToItems(result.placements || [], getCropDef, getMutationDef);
  }, [result, getCropDef, getMutationDef]);

  const mutationItems = useMemo(() => {
    if (!result || !result.mutations) return [];
    return processMutationsToItems(result.mutations, getMutationDef);
  }, [result, getMutationDef]);

  // Effect propagation over the displayed layout (solver crops + mutations + locks).
  // Locked placements are also in result.placements for final results, so dedupe by position.
  const effectSim = useMemo(() => {
    const seen = new Set<string>();
    const sims: { id: string; position: [number, number]; size: number; isSlot?: boolean }[] = [];
    const add = (id: string, position: [number, number], size: number, isSlot = false) => {
      const key = `${position[0]},${position[1]}`;
      if (seen.has(key)) return;
      seen.add(key);
      sims.push({ id, position, size, isSlot });
    };
    // Crops and locks are real plants; the target mutations are slots, which
    // receive effects but never give any (see utilities/effectSimulation).
    for (const p of result?.placements || []) add(p.crop, p.position, p.size);
    for (const m of result?.mutations || []) add(m.mutation, m.position, m.size, true);
    for (const l of lockedPlacements) add(l.crop, l.position, l.size);
    return simulateEffects(sims);
  }, [result, lockedPlacements]);

  const effectInfoFor = useCallback((id: string, position: [number, number], size: number, isSlot = false) => {
    const raw = effectSim.heldOver(position, size);
    const has = effectiveEffects(raw);
    return { has, suppressed: [...raw].filter(e => !has.has(e)), gives: effectsGivenBy(id, isSlot) };
  }, [effectSim]);

  // Whatever is hovered: a solver crop/mutation, or a locked placement (not while dragging)
  const hoveredEffects = useMemo(() => {
    if (dragState?.isDragging) return null;
    let item: PlacementItem | null = hoveredEffectItem;
    if (!item && hoveredPlacementId) {
      const lp = lockedPlacements.find(p => p.id === hoveredPlacementId);
      if (lp) {
        const def = getCropDef(lp.crop) || getMutationDef(lp.crop);
        item = { id: lp.crop, name: def?.name || lp.crop.replace(/_/g, " "), size: lp.size, startRow: lp.position[0], startCol: lp.position[1], locked: true };
      }
    }
    if (!item) return null;
    return { item, ...effectInfoFor(item.id, [item.startRow, item.startCol], item.size, !!item.isMutation) };
  }, [hoveredEffectItem, hoveredPlacementId, lockedPlacements, getCropDef, getMutationDef, effectInfoFor, dragState]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  const hasResult = !!result;
  const isOptimal = result?.status === "OPTIMAL";
  const isSolving = progress !== null && progress !== undefined;

  const renderGrid = () => (
    <div ref={fitRef} className="w-full">
      <div
        ref={gridRef}
        className="relative select-none mx-auto"
        style={{ width: gridWidth, height: gridHeight, cursor: isPlacementMode ? "crosshair" : "default" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onMouseUp={handleMouseUp}
      >
        {hasResult ? (
          Array.from({ length: GRID_SIZE }).flatMap((_, rowIndex) =>
            Array.from({ length: GRID_SIZE }).map((_, colIndex) => {
              const key = `${rowIndex},${colIndex}`;
              if (occupiedCells.has(key)) return null;
              const isUnlocked = unlockedCells.has(key);
              return (
                <div
                  key={key}
                  style={{ position: "absolute", top: rowIndex * (cellSize + gap), left: colIndex * (cellSize + gap), width: cellSize, height: cellSize }}
                  className={`rounded ${isUnlocked ? "bg-emerald-600/40 border border-emerald-500/30" : "bg-slate-700/30 border border-slate-600/20"}`}
                />
              );
            })
          )
        ) : (
          <GridBackground cellSize={cellSize} gap={gap} unlockedCells={unlockedCells} />
        )}

        {cropItems.map((item, index) => (
          <CropCell
            key={`${item.id}-${item.startRow}-${item.startCol}-${index}`}
            id={item.id}
            name={item.name}
            position={[item.startRow, item.startCol]}
            size={item.size}
            groundType={groundOf(item.id)}
            cellSize={cellSize}
            gap={gap}
            isLocked={item.locked}
            onClick={() => openInfo(item.id)}
            title=""
            onMouseEnter={() => setHoveredEffectItem(item)}
            onMouseLeave={() => setHoveredEffectItem(null)}
          />
        ))}

        {mutationItems.map((item, index) => (
          <MutationCell
            key={`mutation-${item.id}-${item.startRow}-${item.startCol}-${index}`}
            id={item.id}
            name={item.name}
            position={[item.startRow, item.startCol]}
            size={item.size}
            groundType={groundOf(item.id)}
            cellSize={cellSize}
            gap={gap}
            showImage={showMutations}
            onClick={() => openInfo(item.id)}
            title=""
            onMouseEnter={() => setHoveredEffectItem(item)}
            onMouseLeave={() => setHoveredEffectItem(null)}
          />
        ))}

        {lockedPlacements.map((placement) => {
          const isBeingDragged = dragState?.placementId === placement.id && dragState?.isDragging;
          const isHovered = hoveredPlacementId === placement.id && !isBeingDragged && !isPlacementMode;
          const displayPlacement = isBeingDragged ? { ...placement, position: dragState.currentPosition } : placement;
          return (
            <LockedPlacementCell
              key={placement.id}
              placement={displayPlacement}
              cellSize={cellSize}
              gap={gap}
              isDragging={isBeingDragged}
              isHovered={isHovered}
              isPlacementMode={isPlacementMode}
              onMouseDown={(e) => handlePlacementMouseDown(placement.id, e)}
              onMouseEnter={() => setHoveredPlacementId(placement.id)}
              onMouseLeave={() => setHoveredPlacementId(null)}
              onClick={() => openInfo(placement.crop)}
              onCancelDrag={cancelDrag}
            />
          );
        })}

        {dragState?.isDragging && dragValidation && (
          <DragValidationOverlay
            position={dragState.currentPosition}
            size={lockedPlacements.find(p => p.id === dragState.placementId)?.size ?? 1}
            cellSize={cellSize}
            gap={gap}
            isValid={dragValidation.valid}
          />
        )}

        {previewPosition && selectedCropForPlacement && !dragState && !paintState && (
          <PlacementPreview
            position={previewPosition}
            crop={selectedCropForPlacement}
            isValid={previewValidation?.valid ?? false}
            cellSize={cellSize}
            gap={gap}
          />
        )}

        {hoveredEffects && !isPlacementMode && (
          <EffectTooltip
            id={hoveredEffects.item.id}
            name={hoveredEffects.item.name}
            position={[hoveredEffects.item.startRow, hoveredEffects.item.startCol]}
            size={hoveredEffects.item.size}
            has={hoveredEffects.has}
            gives={hoveredEffects.gives}
            suppressed={hoveredEffects.suppressed}
            cellSize={cellSize}
            gap={gap}
            gridWidth={gridWidth}
            gridHeight={gridHeight}
            note={hoveredEffects.item.locked ? "locked" : hoveredEffects.item.isMutation ? "target" : undefined}
          />
        )}
      </div>
    </div>
  );

  const mutationCounts = new Map<string, number>();
  (result?.mutations || []).forEach((m) => mutationCounts.set(m.mutation, (mutationCounts.get(m.mutation) || 0) + 1));
  const placementCounts = new Map<string, number>();
  (result?.placements || []).forEach((p) => placementCounts.set(p.crop, (placementCounts.get(p.crop) || 0) + 1));
  const totalCells =
    (result?.placements || []).reduce((sum, p) => sum + p.size * p.size, 0) +
    (result?.mutations || []).reduce((sum, m) => sum + m.size * m.size, 0);

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 min-h-[24px]">
        {!hasResult ? (
          <Grid3X3 className="w-4 h-4 text-emerald-400" />
        ) : isOptimal ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : isSolving ? (
          <div className="w-4 h-4 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
        ) : (
          <AlertCircle className="w-4 h-4 text-yellow-400" />
        )}
        <h3 className="text-sm font-medium text-slate-200">
          {!hasResult ? "Solution" : isSolving ? "Current best solution" : isOptimal ? "Optimal solution" : `Solution (${result.status.toLowerCase()})`}
        </h3>
        {hasResult && result.cache_hit && <span className="text-[11px] text-slate-500">cached</span>}
        <div className="ml-auto flex items-center gap-2">
          {(hasResult || lockedPlacements.length > 0) && (
            <button
              onClick={handleSendToDesigner}
              className="px-2 py-1 text-xs bg-purple-500/40 hover:bg-purple-500/60 border border-purple-500/30 rounded text-slate-100 transition-colors flex items-center gap-1 cursor-pointer"
              title="Open this layout in the Designer"
            >
              <Paintbrush className="w-3 h-3" />
              Designer
            </button>
          )}
          {hasResult && onClear && (
            <button
              onClick={onClear}
              className="px-2 py-1 text-xs bg-slate-600/50 hover:bg-slate-600/70 border border-slate-600/30 rounded text-slate-300 transition-colors flex items-center gap-1 cursor-pointer"
              title="Clear results"
            >
              <RotateCcw className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {queuePosition !== null && queuePosition !== undefined && <QueueBanner position={queuePosition} />}
      {progress && <ProgressBar progress={progress} />}

      {/* Score */}
      {hasResult && !isSolving && result.score !== undefined && result.score !== null && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <StatTile
            label="Score"
            value={result.score.toFixed(2)}
            tone="emerald"
            hint="What the solver maximizes: expected spawns per tick of the maximize targets plus the weighted effect value of every target spot"
          />
          <StatTile
            label="Effects"
            value={`${(result.effect_value ?? 0) >= 0 ? "+" : ""}${(result.effect_value ?? 0).toFixed(2)}`}
            tone={(result.effect_value ?? 0) > 0 ? "sky" : "slate"}
            hint="The part of the score that comes from your effect weights"
          />
          <StatTile
            label="Spawns / tick"
            value={(result.expected_spawns_per_tick ?? 0).toFixed(2)}
            hint="Expected mutation spawns per growth tick, summed over every spot (competing mutations dilute the roll)"
          />
        </div>
      )}

      {/* Grid */}
      <SectionLabel
        actions={
          hasResult ? (
            <button
              onClick={() => setShowMutations(!showMutations)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 hover:text-slate-200 cursor-pointer"
              title={showMutations ? "Hide mutation overlays" : "Show mutation overlays"}
            >
              {showMutations ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{showMutations ? "Hide targets" : "Show targets"}</span>
            </button>
          ) : undefined
        }
      >
        Layout
      </SectionLabel>
      {renderGrid()}
      <StatusMessage
        hoveredPlacementId={hoveredPlacementId}
        isPlacementMode={isPlacementMode}
        hoverInfo={hoverInfo}
        hasResult={hasResult}
        hasLockedPlacements={lockedPlacements.length > 0}
      />

      {/* Mutation Summary */}
      {hasResult && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
            Mutations
          </h4>
          <div className="space-y-2">
            {Array.from(mutationCounts.entries()).map(([mutationId, count]) => {
              const mutationDef = getMutationDef(mutationId);
              const displayName = mutationDef?.name || mutationId.replace(/_/g, " ");
              return (
                <div
                  key={mutationId}
                  className="flex items-center justify-between bg-slate-700/30 rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <CropImage cropId={mutationId} cropName={displayName} size="xs" showFallback={false} />
                    <span className={`text-sm ${mutationDef ? getRarityTextColor(mutationDef.rarity) : "text-slate-200"}`}>{displayName}</span>
                  </div>
                  <span className="text-sm font-medium text-emerald-400">x{count}</span>
                </div>
              );
            })}
            {mutationCounts.size === 0 && (
              <div className="text-center py-2 text-xs text-slate-500">No mutations found</div>
            )}
          </div>
        </div>
      )}

      {/* Crop Placements */}
      {hasResult && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
            Crop Placements
          </h4>
          <div className="flex flex-wrap gap-2">
            {Array.from(placementCounts.entries()).map(([cropId, count]) => {
              const cropDef = getCropDef(cropId);
              const mutationDef = getMutationDef(cropId);
              const displayName = cropDef?.name || mutationDef?.name || cropId.replace(/_/g, " ");
              return (
                <div key={cropId} className="flex items-center gap-2 bg-slate-700/30 rounded-md px-2 py-1">
                  <CropImage cropId={cropId} cropName={displayName} size="xs" showFallback={false} />
                  <span className="text-xs text-slate-300">{displayName}</span>
                  <span className="text-xs text-slate-500">x{count}</span>
                </div>
              );
            })}
            {placementCounts.size === 0 && (
              <div className="text-center py-2 text-xs text-slate-500">No crops placed</div>
            )}
          </div>
        </div>
      )}

      {/* Total Cells Used */}
      {hasResult && (
        <div className="bg-slate-700/30 rounded-md px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Total Cells Used:</span>
            <span className="text-sm font-medium text-emerald-400">{totalCells}</span>
          </div>
        </div>
      )}
    </Card>
  );
};
