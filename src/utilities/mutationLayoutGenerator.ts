// Example layouts for a mutation's requirements: the mutation centred in the
// smallest grid that fits its required crops on 8-way adjacent cells.

import type { MutationRequirementJSON } from "../services/greenhouseDataService";

export interface LayoutCell {
  cropId: string;
  isCenter: boolean;
}

export interface MutationLayout {
  grid: (LayoutCell | null)[][];
  gridSize: number;
  centerPosition: [number, number];
}

const DIRECTIONS_8WAY: [number, number][] = [
  [-1, 0],  // N
  [-1, 1],  // NE
  [0, 1],   // E
  [1, 1],   // SE
  [1, 0],   // S
  [1, -1],  // SW
  [0, -1],  // W
  [-1, -1], // NW
];

/** Mutation plus one ring of cells, or two rings if the first cannot hold every requirement. */
function calculateGridSize(mutationSize: number, totalRequirements: number): number {
  const baseSize = mutationSize + 2;
  
  const firstRingCells = (mutationSize + 2) * 4 - 4 + (mutationSize > 1 ? (mutationSize - 1) * 4 : 0);
  
  if (totalRequirements <= firstRingCells) {
    return baseSize;
  }
  
  return baseSize + 2;
}

/** Cells 8-way adjacent to the mutation's footprint, in row-major order (8 for 1x1, 12 for 2x2). */
function getAdjacentPositions(
  centerRow: number,
  centerCol: number,
  mutationSize: number,
  gridSize: number
): [number, number][] {
  const positions: [number, number][] = [];
  
  const occupiedCells = new Set<string>();
  for (let dr = 0; dr < mutationSize; dr++) {
    for (let dc = 0; dc < mutationSize; dc++) {
      occupiedCells.add(`${centerRow + dr},${centerCol + dc}`);
    }
  }
  
  const adjacentSet = new Set<string>();
  
  for (let dr = 0; dr < mutationSize; dr++) {
    for (let dc = 0; dc < mutationSize; dc++) {
      const cellRow = centerRow + dr;
      const cellCol = centerCol + dc;
      
      for (const [dRow, dCol] of DIRECTIONS_8WAY) {
        const newRow = cellRow + dRow;
        const newCol = cellCol + dCol;
        const key = `${newRow},${newCol}`;
        
        if (newRow < 0 || newRow >= gridSize || newCol < 0 || newCol >= gridSize) {
          continue;
        }
        
        if (occupiedCells.has(key)) {
          continue;
        }
        
        if (adjacentSet.has(key)) {
          continue;
        }
        
        adjacentSet.add(key);
        positions.push([newRow, newCol]);
      }
    }
  }
  
  positions.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
  });
  
  return positions;
}

/** Centres the mutation and fills adjacent cells with its required crops in order. */
export function generateMutationLayout(
  mutationId: string,
  mutationSize: number,
  requirements: MutationRequirementJSON[]
): MutationLayout {
  const totalRequirements = requirements.reduce((sum, req) => sum + req.count, 0);
  
  // No requirements (e.g. Lonelily): just the mutation with a one-cell border.
  if (totalRequirements === 0) {
    const gridSize = mutationSize + 2;
    const centerRow = 1;
    const centerCol = 1;
    
    const grid: (LayoutCell | null)[][] = Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, () => null)
    );
    
    for (let dr = 0; dr < mutationSize; dr++) {
      for (let dc = 0; dc < mutationSize; dc++) {
        grid[centerRow + dr][centerCol + dc] = {
          cropId: mutationId,
          isCenter: true,
        };
      }
    }
    
    return { grid, gridSize, centerPosition: [centerRow, centerCol] };
  }
  
  const gridSize = calculateGridSize(mutationSize, totalRequirements);
  
  const centerRow = Math.floor((gridSize - mutationSize) / 2);
  const centerCol = Math.floor((gridSize - mutationSize) / 2);
  
  const grid: (LayoutCell | null)[][] = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => null)
  );
  
  for (let dr = 0; dr < mutationSize; dr++) {
    for (let dc = 0; dc < mutationSize; dc++) {
      grid[centerRow + dr][centerCol + dc] = {
        cropId: mutationId,
        isCenter: true,
      };
    }
  }
  
  const adjacentPositions = getAdjacentPositions(centerRow, centerCol, mutationSize, gridSize);
  
  const cropsToPlace: string[] = [];
  for (const req of requirements) {
    for (let i = 0; i < req.count; i++) {
      cropsToPlace.push(req.crop);
    }
  }
  
  for (let i = 0; i < cropsToPlace.length && i < adjacentPositions.length; i++) {
    const [row, col] = adjacentPositions[i];
    grid[row][col] = {
      cropId: cropsToPlace[i],
      isCenter: false,
    };
  }
  
  return { grid, gridSize, centerPosition: [centerRow, centerCol] };
}

/** Stub: always returns fallbackGround. */
export function getGroundTypeForCrop(_cropId: string, fallbackGround: string): string {
  return fallbackGround;
}
