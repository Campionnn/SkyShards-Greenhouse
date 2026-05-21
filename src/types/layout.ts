/**
 * Type definitions for optimized designer layout storage
 */

// Minimal placement data - only essential information
export interface OptimizedPlacement {
  cropId: string;
  position: [number, number];
}

// Single crop/mutation placement for mod export
export interface ModExportPlacement {
  cropId: string;
  name: string;
  position: [number, number];
  size: number;
  ground: string;
}

// Complete mod export payload — self-contained so the mod needs no external data
export interface ModExportData {
  version: number;
  source: string;
  url: string;
  exportedAt: string;
  grid: {
    size: number;
    inputs: ModExportPlacement[];
    targets: ModExportPlacement[];
  };
  metadata: {
    layoutName: string;
    totalInputs: number;
    totalTargets: number;
  };
}

// Optimized layout format
export interface SavedLayout {
  id: string;              // Unique identifier
  name: string;            // User-provided name
  savedAt: number;         // Timestamp when first saved
  modifiedAt: number;      // Timestamp when last modified
  inputs: OptimizedPlacement[];
  targets: OptimizedPlacement[];
}
