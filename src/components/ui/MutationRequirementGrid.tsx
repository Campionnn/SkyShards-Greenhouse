import React, { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { solveGreenhouseDirect } from "../../services/greenhouseService";
import { getGroundImagePath } from "../../types/greenhouse";
import { CropImage } from "../shared";
import type { SolveResponse, CropPlacement, MutationResult } from "../../types/greenhouse";
import type { CropDataJSON, MutationDataJSON } from "../../services/greenhouseDataService";

interface MutationRequirementGridProps {
  mutationId: string;
  // Crop/mutation data by id, for ground types.
  cropDataMap?: Record<string, CropDataJSON | MutationDataJSON>;
}

function generateFullGrid(): [number, number][] {
  const cells: [number, number][] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      cells.push([row, col]);
    }
  }
  return cells;
}

export const MutationRequirementGrid: React.FC<MutationRequirementGridProps> = ({
  mutationId,
  cropDataMap = {},
}) => {
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    
    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => resizeObserver.disconnect();
  }, []);

  // Solve an example layout with one of the mutation on a full grid (15 s limit).
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const fetchLayout = async () => {
      setLoading(true);
      setError(null);

      try {
        const cells = generateFullGrid();
        const targets = [{ mutation: mutationId, count: 1, maximize: false }];
        
        const response = await solveGreenhouseDirect(cells, targets, abortController.signal, 15);
        
        if (!abortController.signal.aborted) {
          setResult(response);
          setLoading(false);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load layout");
          setLoading(false);
        }
      }
    };

    fetchLayout();

    return () => {
      abortController.abort();
    };
  }, [mutationId]);

  const getGroundType = (cropId: string): string => {
    const cropData = cropDataMap[cropId];
    if (cropData) {
      return cropData.ground;
    }
    return "farmland";
  };

  const gap = 2;

  if (loading) {
    return (
      <div 
        ref={containerRef}
        className="w-full flex items-center justify-center py-8"
      >
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (error || !result) {
    return (
      <div 
        ref={containerRef}
        className="w-full text-center py-4 text-sm text-red-400"
      >
        {error || "Failed to load layout"}
      </div>
    );
  }

  const targetMutation = result.mutations.find(m => m.mutation === mutationId);
  
  const placementMap = new Map<string, CropPlacement>();
  for (const placement of result.placements) {
    const key = `${placement.position[0]},${placement.position[1]}`;
    placementMap.set(key, placement);
  }

  const mutationMap = new Map<string, MutationResult>();
  for (const mutation of result.mutations) {
    const key = `${mutation.position[0]},${mutation.position[1]}`;
    mutationMap.set(key, mutation);
  }

  // Bounding box of every placement and mutation footprint.
  let minRow = 10, maxRow = -1, minCol = 10, maxCol = -1;
  
  for (const placement of result.placements) {
    const [row, col] = placement.position;
    const size = placement.size || 1;
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row + size - 1);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col + size - 1);
  }
  
  for (const mutation of result.mutations) {
    const [row, col] = mutation.position;
    const size = mutation.size || 1;
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row + size - 1);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col + size - 1);
  }
  
  if (minRow > maxRow) {
    minRow = 0; maxRow = 0; minCol = 0; maxCol = 0;
  }
  
  let gridRows = maxRow - minRow + 1;
  let gridCols = maxCol - minCol + 1;

  // Pad to at least 5x5. Boxes up to 3x3 are centred on the target mutation,
  // larger ones on the box itself.
  const MIN_GRID_SIZE = 5;
  const originalGridRows = gridRows;
  const originalGridCols = gridCols;

  if (gridRows < MIN_GRID_SIZE || gridCols < MIN_GRID_SIZE) {
    const targetRows = Math.max(gridRows, MIN_GRID_SIZE);
    const targetCols = Math.max(gridCols, MIN_GRID_SIZE);
    
    if (targetMutation && originalGridRows <= 3 && originalGridCols <= 3) {
      const [mutRow, mutCol] = targetMutation.position;
      const mutSize = targetMutation.size || 1;
      const mutCenterRow = mutRow + (mutSize - 1) / 2;
      const mutCenterCol = mutCol + (mutSize - 1) / 2;
      
      const gridCenterRow = (targetRows - 1) / 2;
      const gridCenterCol = (targetCols - 1) / 2;
      
      const shiftRow = gridCenterRow - mutCenterRow;
      const shiftCol = gridCenterCol - mutCenterCol;
      
      minRow = Math.floor(-shiftRow);
      maxRow = minRow + targetRows - 1;
      minCol = Math.floor(-shiftCol);
      maxCol = minCol + targetCols - 1;
      
      gridRows = targetRows;
      gridCols = targetCols;
    } else {
      const paddingTop = Math.floor((targetRows - gridRows) / 2);
      const paddingLeft = Math.floor((targetCols - gridCols) / 2);
      
      minRow -= paddingTop;
      maxRow = minRow + targetRows - 1;
      minCol -= paddingLeft;
      maxCol = minCol + targetCols - 1;
      
      gridRows = targetRows;
      gridCols = targetCols;
    }
  }

  // Non-anchor cells of multi-cell items; the item renders from its top-left cell.
  const occupiedCells = new Set<string>();
  
  for (const mutation of result.mutations) {
    const [mRow, mCol] = mutation.position;
    const size = mutation.size || 1;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (r !== 0 || c !== 0) {
          occupiedCells.add(`${mRow + r},${mCol + c}`);
        }
      }
    }
  }
  
  for (const placement of result.placements) {
    const [pRow, pCol] = placement.position;
    const size = placement.size || 1;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (r !== 0 || c !== 0) {
          occupiedCells.add(`${pRow + r},${pCol + c}`);
        }
      }
    }
  }

  const boundedCellSize = containerWidth > 0 
    ? Math.floor((containerWidth - (gridCols - 1) * gap) / gridCols) 
    : 28;
  const boundedGridWidth = gridCols * boundedCellSize + (gridCols - 1) * gap;
  const boundedGridHeight = gridRows * boundedCellSize + (gridRows - 1) * gap;

  return (
    <div ref={containerRef} className="w-full">
      <div
        className="relative mx-auto"
        style={{
          width: boundedGridWidth,
          height: boundedGridHeight,
        }}
      >
        {Array.from({ length: gridRows }).map((_, localRowIdx) =>
          Array.from({ length: gridCols }).map((_, localColIdx) => {
            const rowIdx = localRowIdx + minRow;
            const colIdx = localColIdx + minCol;
            const key = `${rowIdx},${colIdx}`;
            const placement = placementMap.get(key);
            const mutation = mutationMap.get(key);

            if (occupiedCells.has(key)) {
              return null;
            }

            const cellTop = localRowIdx * (boundedCellSize + gap);
            const cellLeft = localColIdx * (boundedCellSize + gap);

            if (mutation) {
              const mutationWidth = mutation.size * boundedCellSize + (mutation.size - 1) * gap;
              const mutationHeight = mutation.size * boundedCellSize + (mutation.size - 1) * gap;
              const groundType = getGroundType(mutation.mutation);
              const imageSize = Math.min(mutationWidth - 8, mutationHeight - 8);

              return (
                <div
                  key={key}
                  className="absolute"
                  style={{
                    top: cellTop,
                    left: cellLeft,
                    width: mutationWidth,
                    height: mutationHeight,
                    backgroundImage: `url(${getGroundImagePath(groundType)})`,
                    backgroundSize: `${boundedCellSize}px ${boundedCellSize}px`,
                    backgroundPosition: "top left",
                    backgroundRepeat: "repeat",
                    borderRadius: 3,
                    boxShadow: "0 0 6px rgba(0, 200, 255, 0.8), inset 0 0 4px rgba(0, 200, 255, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 10,
                  }}
                >
                  <CropImage
                    cropId={mutation.mutation}
                    cropName={mutation.mutation}
                    width={imageSize}
                    height={imageSize}
                    showGround={false}
                    groundType={groundType}
                    hasGroundContext={true}
                    showFallback={false}
                  />
                </div>
              );
            }

            if (placement) {
              const cropSize = placement.size || 1;
              const cropWidth = cropSize * boundedCellSize + (cropSize - 1) * gap;
              const cropHeight = cropSize * boundedCellSize + (cropSize - 1) * gap;
              const groundType = getGroundType(placement.crop);
              const imageSize = Math.min(cropWidth - 6, cropHeight - 6);

              return (
                <div
                  key={key}
                  className="absolute"
                  style={{
                    top: cellTop,
                    left: cellLeft,
                    width: cropWidth,
                    height: cropHeight,
                    backgroundImage: `url(${getGroundImagePath(groundType)})`,
                    backgroundSize: `${boundedCellSize}px ${boundedCellSize}px`,
                    backgroundPosition: "top left",
                    backgroundRepeat: "repeat",
                    borderRadius: 3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <CropImage
                    cropId={placement.crop}
                    cropName={placement.crop}
                    width={imageSize}
                    height={imageSize}
                    showGround={false}
                    groundType={groundType}
                    hasGroundContext={true}
                    showFallback={false}
                  />
                </div>
              );
            }

            // Empty cell.
            return (
              <div
                key={key}
                className="absolute bg-slate-800/30 border border-slate-700/30"
                style={{
                  top: cellTop,
                  left: cellLeft,
                  width: boundedCellSize,
                  height: boundedCellSize,
                  borderRadius: 3,
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
