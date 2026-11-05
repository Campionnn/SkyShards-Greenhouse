import { getRarityTextColor } from "../../utilities";
import type { CropFilterCategory } from "../../types/greenhouse";

/** Rarity colour for rarity filters (item names only), the default text colour otherwise. */
export const defaultGetFilterColor = (value: CropFilterCategory): string => {
  if (value === "common" || value === "uncommon" || value === "rare" || value === "epic" || value === "legendary") {
    return getRarityTextColor(value);
  }
  return "text-fg-body";
};
