import { GRID_SIZE } from "../constants";

/** Minimal placement shape used by the generic validators. */
export interface BasePlacement {
  id: string;
  position: [number, number];
  size: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Random placement id: `${prefix}-${timestamp}-${random}`. */
export function generatePlacementId(prefix: string = "placement"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** True if two square placements overlap. */
export function doPlacementsOverlapByPlacement<T extends BasePlacement>(
  placementA: T,
  placementB: T
): boolean {
  const [aRow, aCol] = placementA.position;
  const [bRow, bCol] = placementB.position;
  const aSize = placementA.size;
  const bSize = placementB.size;
  
  const noOverlap = 
    aRow + aSize <= bRow ||
    bRow + bSize <= aRow ||
    aCol + aSize <= bCol ||
    bCol + bSize <= aCol;
  
  return !noOverlap;
}

/** True if the square at position/size overlaps any placement except excludeId. */
export function isPositionOccupiedByPlacements<T extends BasePlacement>(
  position: [number, number],
  size: number,
  placements: T[],
  excludeId?: string
): boolean {
  const [row, col] = position;
  
  for (const placement of placements) {
    if (excludeId && placement.id === excludeId) continue;
    
    const [pRow, pCol] = placement.position;
    const pSize = placement.size;
    
    const noOverlap = 
      row + size <= pRow ||
      pRow + pSize <= row ||
      col + size <= pCol ||
      pCol + pSize <= col;
    
    if (!noOverlap) return true;
  }
  
  return false;
}

/** Placements (except excludeId) overlapping the square at position/size. */
export function findOverlappingPlacements<T extends BasePlacement>(
  position: [number, number],
  size: number,
  placements: T[],
  excludeId?: string
): T[] {
  const [row, col] = position;
  const overlapping: T[] = [];
  
  for (const placement of placements) {
    if (excludeId && placement.id === excludeId) continue;
    
    const [pRow, pCol] = placement.position;
    const pSize = placement.size;
    
    const noOverlap = 
      row + size <= pRow ||
      pRow + pSize <= row ||
      col + size <= pCol ||
      pCol + pSize <= col;
    
    if (!noOverlap) {
      overlapping.push(placement);
    }
  }
  
  return overlapping;
}

/** The placement covering the cell, if any. */
export function getPlacementAtCell<T extends BasePlacement>(
  row: number,
  col: number,
  placements: T[]
): T | undefined {
  for (const placement of placements) {
    const [pRow, pCol] = placement.position;
    const pSize = placement.size;
    
    if (
      row >= pRow && row < pRow + pSize &&
      col >= pCol && col < pCol + pSize
    ) {
      return placement;
    }
  }
  return undefined;
}

/** Fails if any cell of the placement lies outside the grid. */
export function validateGridBounds(
  position: [number, number],
  size: number,
  gridSize: number = GRID_SIZE
): ValidationResult {
  const [row, col] = position;
  
  if (row < 0 || col < 0 || row + size > gridSize || col + size > gridSize) {
    return { valid: false, error: "Placement would be outside the grid" };
  }
  
  return { valid: true };
}

/** Fails unless every cell of the placement is in allowedCells ("row,col" keys). */
export function validateAllowedCells(
  position: [number, number],
  size: number,
  allowedCells: Set<string>
): ValidationResult {
  const [row, col] = position;
  
  for (let dr = 0; dr < size; dr++) {
    for (let dc = 0; dc < size; dc++) {
      const cellKey = `${row + dr},${col + dc}`;
      if (!allowedCells.has(cellKey)) {
        return { valid: false, error: "Placement requires unlocked cells" };
      }
    }
  }
  
  return { valid: true };
}

/** Fails if the placement overlaps another (except excludeId). */
export function validateNoOverlap<T extends BasePlacement>(
  position: [number, number],
  size: number,
  placements: T[],
  excludeId?: string
): ValidationResult {
  if (isPositionOccupiedByPlacements(position, size, placements, excludeId)) {
    return { valid: false, error: "Position is occupied by another placement" };
  }
  
  return { valid: true };
}
