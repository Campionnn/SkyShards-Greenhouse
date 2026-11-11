import React from "react";
import { CropImage } from "../shared";
import { cn } from "../ui/cn";

/** An item's icon at an exact size (any crop, mutation or drop id; a fallback for unknown ones). */
export const ItemIcon: React.FC<{ id: string; name: string; size: number; className?: string }> = ({ id, name, size, className }) => (
  <CropImage cropId={id} cropName={name} size="custom" width={size} height={size} showFallback className={cn("shrink-0", className)} />
);

/**
 * An item icon on a small tile (a 1px edge, a lighter ground than the page), so near-black items
 * (Coalroot, Witherbloom, Ashwreath) stay visible on cards and in the recipe band.
 */
export const IconTile: React.FC<{ id: string; name: string; size: number; className?: string }> = ({ id, name, size, className }) => (
  <span className={cn("grid shrink-0 place-items-center rounded-inner border border-line-control bg-surface-hover", className)} style={{ width: size + 6, height: size + 6 }}>
    <ItemIcon id={id} name={name} size={size} />
  </span>
);
