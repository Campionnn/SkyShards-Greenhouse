import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { FlaskConical, Grid3X3, RotateCcw, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GRID_SIZE } from "../../constants";
import { useGreenhouseData, useGridState, useLockedPlacements, useDesigner, useInfoModal } from "../../context";
import { useGridPlacement, useFitCellSize, focusKey, useTargetsVisible, useInputsVisible } from "../../hooks";
import {
  getGridDimensions,
  simulateEffects,
  effectiveEffects,
  effectsGivenBy,
  LocalStorageManager,
  makeIncomingLayout,
  simulatorHandoffState,
  solverResultCells,
  copyShareLink,
} from "../../utilities";
import {
  GridBackground,
  LockedPlacementCell,
  PlacementPreview,
  DragValidationOverlay,
  CropCell,
  MutationCell,
  EffectTooltip,
  GridVisibilityToggle,
  focusFade,
  FOCUS_TRANSITION,
} from "../grid";
import { LOCKED_CELL, UNLOCKED_CELL } from "../grid/gridCellStyles";
import { cn } from "../ui/cn";
import { KitButton, Pill } from "../ui/kit";
import { useToast } from "../ui/toastContext";
import type { SolveResponse, CropPlacement, MutationResult } from "../../types/greenhouse";
import type { SolveErrorInfo } from "../../services";
import { SolverProgress } from "./SolverProgress";
import { ResultSummary, SolveErrorPanel } from "./ResultSummary";
import { ResultLists } from "./ResultLists";
import { useResultFocus, useSharedResultFocus } from "./resultFocusContext";
import type { SolveSession, SolveRunMeta } from "./solverStatus";

interface SolverResultsProps {
  result: SolveResponse | null;
  error: SolveErrorInfo | null;
  /** Present while a solve is running. */
  session?: SolveSession | null;
  /** Facts about the finished solve (time taken, where it ran). */
  runMeta?: SolveRunMeta | null;
  onClear?: () => void;
  onDismissError?: () => void;
  onRetry?: () => void;
  /** "none": the Mutations / Crops to plant lists are rendered elsewhere (ResultLists, e.g. the left rail). */
  lists?: "inline" | "none";
}

// A crop or mutation placement on the grid.
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
          <span className="font-semibold text-fg">Click to place crops</span>,{" "}
          <span className="font-semibold text-fg">right-click to remove</span>
          {!hasResult && <>, Esc to stop placing</>}
        </span>
      );
    }
    if (hoveredPlacementId && !isPlacementMode) {
      return (
        <span>
          Drag to move, <span className="font-semibold text-fg">right-click to remove</span>
        </span>
      );
    }
    if (isPlacementMode && hoverInfo) {
      return (
        <span>
          <span className="font-semibold text-fg">Click to place crops</span>, right-click to remove
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
      : "Add targets and press Solve to find the best layout for your cells";
  };

  const message = getMessage();
  return message ? <p className="py-1.5 text-center text-secondary text-fg-meta">{message}</p> : null;
};

export const SolverResults: React.FC<SolverResultsProps> = ({
  result,
  error,
  session,
  runMeta,
  onClear,
  onDismissError,
  onRetry,
  lists = "inline",
}) => {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const { unlockedCells } = useGridState();
  const { lockedPlacements, selectedCropForPlacement, isPlacementMode } = useLockedPlacements();
  const { loadFromSolverResult } = useDesigner();
  const { openInfo } = useInfoModal();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [targetsVisible, setTargetsVisible] = useTargetsVisible();
  const [inputsVisible, setInputsVisible] = useInputsVisible();
  const [hoveredEffectItem, setHoveredEffectItem] = useState<PlacementItem | null>(null);

  // Grid sizing: the whole 10x10 plot, fitted to the column's width, never scrolling sideways.
  const fitRef = useRef<HTMLDivElement>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: 64 });
  const gridRef = useRef<HTMLDivElement>(null);
  const { width: gridWidth, height: gridHeight } = getGridDimensions(cellSize, gap);
  const unit = cellSize + gap;

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

  const nameOf = useCallback(
    (id: string) => getMutationDef(id)?.name || getCropDef(id)?.name || id.replace(/_/g, " "),
    [getCropDef, getMutationDef]
  );

  // The layout on screen (locks + solver result) as a Simulator handoff.
  const currentLayout = useMemo(() => {
    const cells = solverResultCells(result, lockedPlacements);
    if (!cells.inputs.length && !cells.targets.length) return null;
    return makeIncomingLayout(cells, "calculator", nameOf, "Calculator result");
  }, [result, lockedPlacements, nameOf]);

  // Save each finished result for the Simulator's layout picker.
  const isFinalResult = !!result && !session && result.status !== "SOLVING";
  useEffect(() => {
    if (isFinalResult && currentLayout) {
      LocalStorageManager.saveLastSolverLayout({ code: currentLayout.code, name: currentLayout.name, savedAt: Date.now() });
    }
  }, [isFinalResult, currentLayout]);

  const handleSendToSimulator = useCallback(() => {
    if (!currentLayout) {
      toast({ title: "Nothing to simulate", description: "Place some locked crops or solve first", variant: "warning", duration: 3000 });
      return;
    }
    navigate("/simulator", { state: simulatorHandoffState(currentLayout) });
  }, [currentLayout, navigate, toast]);

  const handleCopyShareLink = useCallback(async () => {
    if (!currentLayout) {
      toast({ title: "Nothing to share", description: "Place some locked crops or solve first", variant: "warning", duration: 3000 });
      return;
    }
    try {
      await copyShareLink(currentLayout.code);
      toast({ title: "Share link copied!", description: "Paste this link in Discord or share with others", variant: "success", duration: 3000 });
    } catch (err) {
      toast({ title: "Couldn't copy the link", description: err instanceof Error ? err.message : "Clipboard not available", variant: "error", duration: 5000 });
    }
  }, [currentLayout, toast]);

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

  // Cells under any placement (crops, targets, locks) get no empty-cell tile: a tile under a
  // target would show through when the target fades.
  const coveredCells = useMemo(() => {
    const cells = new Set(occupiedCells);
    const cover = ([r, c]: [number, number], size: number) => {
      for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) cells.add(`${r + dr},${c + dc}`);
    };
    for (const m of result?.mutations || []) cover(m.position, m.size);
    for (const l of lockedPlacements) cover(l.position, l.size);
    return cells;
  }, [occupiedCells, result, lockedPlacements]);

  // Hovering or clicking an entry in the Mutations / Crops to plant lists finds it on the grid. With
  // the lists rendered elsewhere (ResultFocusProvider around both), the shared focus drives the grid.
  const ownFocus = useResultFocus(result, lockedPlacements);
  const focus = useSharedResultFocus() ?? ownFocus;

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
    // Crops and locks are plants; target mutations are slots, which receive effects but give none.
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

  // The hovered solver crop/mutation or locked placement (none while dragging).
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


  const hasResult = !!result;
  const isSolving = !!session;
  const isFinal = hasResult && !isSolving && result.status !== "SOLVING";

  const renderGrid = () => (
    <div ref={fitRef} className="w-full min-w-0">
      <div data-testid="solver-grid">
        <div
          ref={gridRef}
          className="relative mx-auto select-none"
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
                if (coveredCells.has(key)) return null;
                const isUnlocked = unlockedCells.has(key);
                return (
                  <div
                    key={key}
                    style={{
                      position: "absolute",
                      top: rowIndex * unit,
                      left: colIndex * unit,
                      width: cellSize,
                      height: cellSize,
                      // Empty unlocked cells fade with everything else while a list entry is shown.
                      ...(isUnlocked && focus.active ? focusFade("dimmed") : {}),
                      transition: FOCUS_TRANSITION,
                    }}
                    className={cn("rounded-inner", isUnlocked ? UNLOCKED_CELL.green : LOCKED_CELL)}
                  />
                );
              }),
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
              focus={focus.visualFor(focusKey("input", item.id))}
              hidden={!inputsVisible}
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
              hidden={!targetsVisible}
              onClick={() => openInfo(item.id)}
              title=""
              onMouseEnter={() => setHoveredEffectItem(item)}
              onMouseLeave={() => setHoveredEffectItem(null)}
              focus={focus.visualFor(focusKey("target", item.id))}
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
                focus={focus.visualFor(focusKey("input", placement.crop))}
                hidden={!inputsVisible}
              />
            );
          })}

          {dragState?.isDragging && dragValidation && (
            <DragValidationOverlay
              position={dragState.currentPosition}
              size={lockedPlacements.find((p) => p.id === dragState.placementId)?.size ?? 1}
              cellSize={cellSize}
              gap={gap}
              isValid={dragValidation.valid}
            />
          )}

          {previewPosition && selectedCropForPlacement && !dragState && !paintState && (
            <PlacementPreview position={previewPosition} crop={selectedCropForPlacement} isValid={previewValidation?.valid ?? false} cellSize={cellSize} gap={gap} />
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
    </div>
  );

  const unlockedCount = unlockedCells.size;
  const hasLayout = hasResult || lockedPlacements.length > 0;

  return (
    <section className="@container flex min-w-0 flex-col gap-3" aria-label="Result" data-testid="solver-results">
      {/* Live status while solving */}
      {session && <SolverProgress session={session} />}

      {/* Failure / no solution */}
      {error && !isSolving && <SolveErrorPanel error={error} onDismiss={onDismissError} onRetry={onRetry} />}

      {/* The verdict (score, status, stats), then what you can do with the layout. */}
      {isFinal && <ResultSummary result={result} meta={runMeta ?? null} unlockedCount={unlockedCount} />}
      {(hasLayout || ((hasResult || error) && onClear)) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {isSolving && hasResult && <Pill tone="neutral">Best layout so far</Pill>}
          {hasLayout && !isSolving && (
            <>
              <KitButton variant="ghost" onClick={handleSendToDesigner} title="Open this layout in the Designer">
                <Grid3X3 /> Designer
              </KitButton>
              <KitButton variant="ghost" onClick={handleSendToSimulator} title="Run this layout in the Simulator">
                <FlaskConical /> Simulate
              </KitButton>
              <KitButton variant="ghost" onClick={handleCopyShareLink} title="Copy a share link to this layout">
                <Share2 /> Share
              </KitButton>
            </>
          )}
          {(hasResult || error) && !isSolving && onClear && (
            <KitButton variant="ghost" onClick={onClear} title="Clear the result" aria-label="Clear the result">
              <RotateCcw /> Clear
            </KitButton>
          )}
          {hasLayout && (
            <GridVisibilityToggle
              targetsVisible={targetsVisible}
              onTargetsVisibleChange={setTargetsVisible}
              inputsVisible={inputsVisible}
              onInputsVisibleChange={setInputsVisible}
              className="ml-auto"
            />
          )}
        </div>
      )}

      {renderGrid()}
      <StatusMessage
        hoveredPlacementId={hoveredPlacementId}
        isPlacementMode={isPlacementMode}
        hoverInfo={hoverInfo}
        hasResult={hasResult || isSolving}
        hasLockedPlacements={lockedPlacements.length > 0}
      />

      {lists === "inline" && <ResultLists result={result} focus={focus} className="@container/lists sm:grid sm:grid-cols-2 sm:gap-x-6" />}
    </section>
  );
};