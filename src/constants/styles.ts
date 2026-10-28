/** White glow that keeps dark crops visible on farmland. */
export const CROP_IMAGE_GLOW_FILTER = "drop-shadow(0 0 5px rgba(255, 255, 255, 0.7))";

/** Dark crops that blend into the farmland texture. */
export const CROPS_NEEDING_GLOW = ["choconut", "chocoberry", "dead_plant"] as const;

export function needsCropGlow(cropId: string, groundType: string): boolean {
  return (CROPS_NEEDING_GLOW as readonly string[]).includes(cropId) && groundType === "farmland";
}

/**
 * How target mutation spots are drawn on the Calculator and Designer grids:
 * - solid: like a planted crop, with a cyan glow
 * - faded: a darkened, dashed spot with a see-through icon (the cell to leave empty)
 * - hidden: just the ground, so only what you plant shows
 */
export type TargetDisplay = "solid" | "faded" | "hidden";

export const TARGET_DISPLAYS: readonly TargetDisplay[] = ["solid", "faded", "hidden"];
