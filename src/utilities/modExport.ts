/**
 * Mod export utilities for generating layout data compatible with the
 * SkyShards Greenhouse companion Fabric mod.
 *
 * The export format is a self-contained JSON payload that includes all
 * information the mod needs to render an in-game overlay, without requiring
 * any external crop database.
 */

import type { DesignerPlacement } from "../context/DesignerContext";
import type { CropDefinition, MutationDefinition } from "../types/greenhouse";
import type { ModExportData, ModExportPlacement } from "../types/layout";
import { GRID_SIZE } from "../constants";

const EXPORT_VERSION = 1;
const EXPORT_SOURCE = "skyshards-greenhouse";
const EXPORT_URL = "https://greenhouse.skyshards.com";

/**
 * Look up the ground type for a crop/mutation by checking both definition lists.
 * Falls back to "farmland" if the crop is not found in either list.
 */
function resolveGround(
  cropId: string,
  crops: CropDefinition[],
  mutations: MutationDefinition[]
): string {
  const cropDef = crops.find((c) => c.id === cropId);
  if (cropDef) return cropDef.ground;

  const mutationDef = mutations.find((m) => m.id === cropId);
  if (mutationDef) return mutationDef.ground;

  return "farmland";
}

/**
 * Convert a DesignerPlacement into the mod-export format by enriching it
 * with ground type information from the crop/mutation definitions.
 */
function toModExportPlacement(
  placement: DesignerPlacement,
  crops: CropDefinition[],
  mutations: MutationDefinition[]
): ModExportPlacement {
  return {
    cropId: placement.cropId,
    name: placement.cropName,
    position: placement.position,
    size: placement.size,
    ground: resolveGround(placement.cropId, crops, mutations),
  };
}

/**
 * Generate the full mod-export JSON string from the current designer state.
 *
 * @param inputs  - Input crop placements from the designer
 * @param targets - Target mutation placements from the designer
 * @param crops   - All available crop definitions (for ground lookup)
 * @param mutations - All available mutation definitions (for ground lookup)
 * @param layoutName - Optional human-readable name for the layout
 * @returns Pretty-printed JSON string ready for clipboard or file download
 */
export function generateModExportJSON(
  inputs: DesignerPlacement[],
  targets: DesignerPlacement[],
  crops: CropDefinition[],
  mutations: MutationDefinition[],
  layoutName?: string
): string {
  const data: ModExportData = {
    version: EXPORT_VERSION,
    source: EXPORT_SOURCE,
    url: EXPORT_URL,
    exportedAt: new Date().toISOString(),
    grid: {
      size: GRID_SIZE,
      inputs: inputs.map((p) => toModExportPlacement(p, crops, mutations)),
      targets: targets.map((p) => toModExportPlacement(p, crops, mutations)),
    },
    metadata: {
      layoutName: layoutName || "Untitled Layout",
      totalInputs: inputs.length,
      totalTargets: targets.length,
    },
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Copy a JSON string to the system clipboard.
 * Returns true on success, false if the Clipboard API is unavailable.
 */
export async function exportModJSONToClipboard(json: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger a browser file download for the given JSON string.
 * Creates a temporary <a> element with a Blob URL and programmatically clicks it.
 */
export function exportModJSONToFile(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();

  // Cleanup
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
