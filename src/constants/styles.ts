/** White glow that keeps dark crops visible on farmland. */
export const CROP_IMAGE_GLOW_FILTER = "drop-shadow(0 0 5px rgba(255, 255, 255, 0.7))";

/** Dark crops that blend into the farmland texture. */
export const CROPS_NEEDING_GLOW = ["choconut", "chocoberry", "dead_plant"] as const;

export function needsCropGlow(cropId: string, groundType: string): boolean {
  return CROPS_NEEDING_GLOW.includes(cropId as any) && groundType === "farmland";
}
