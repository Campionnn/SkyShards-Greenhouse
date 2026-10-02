/** Saved designer layout format. */

import type { GroundTile } from "../utilities/designEncoding";

export interface OptimizedPlacement {
  cropId: string;
  position: [number, number];
}

export interface SavedLayout {
  id: string;
  name: string;
  savedAt: number;         // ms timestamp, first save
  modifiedAt: number;      // ms timestamp, last change
  inputs: OptimizedPlacement[];
  targets: OptimizedPlacement[];
  groundTiles?: GroundTile[]; // absent in older saves
}
