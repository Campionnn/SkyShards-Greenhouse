import type { CropDefinition, MutationDefinition, CropFilterCategory } from "../types/greenhouse";

/** Crop list filter options shared by the Calculator and Designer. */
export const CROP_FILTER_OPTIONS = [
  { value: "all" as CropFilterCategory, label: "All" },
  { value: "crops" as CropFilterCategory, label: "Crops" },
  { value: "mutations" as CropFilterCategory, label: "Mutations" },
  { value: "common" as CropFilterCategory, label: "Common" },
  { value: "uncommon" as CropFilterCategory, label: "Uncommon" },
  { value: "rare" as CropFilterCategory, label: "Rare" },
  { value: "epic" as CropFilterCategory, label: "Epic" },
  { value: "legendary" as CropFilterCategory, label: "Legendary" },
] as const;

/** Filters by kind (crop or mutation) or by mutation rarity. */
export function filterCropsByCategory(
  crops: CropDefinition[],
  filter: CropFilterCategory,
  getMutationDef: (cropId: string) => MutationDefinition | undefined
): CropDefinition[] {
  switch (filter) {
    case "crops":
      return crops.filter(c => !c.isMutation);
    
    case "mutations":
      return crops.filter(c => c.isMutation);
    
    case "common":
    case "uncommon":
    case "rare":
    case "epic":
    case "legendary":
      return crops.filter(c => {
        if (!c.isMutation) return false;
        const mutation = getMutationDef(c.id);
        return mutation?.rarity.toLowerCase() === filter.toLowerCase();
      });
    
    case "all":
    default:
      return crops;
  }
}

/** Case-insensitive name substring match. */
export function filterCropsBySearch(
  crops: CropDefinition[],
  searchTerm: string
): CropDefinition[] {
  if (!searchTerm.trim()) {
    return crops;
  }
  
  const term = searchTerm.toLowerCase();
  return crops.filter(c => c.name.toLowerCase().includes(term));
}

export function filterCrops(
  crops: CropDefinition[],
  filter: CropFilterCategory,
  searchTerm: string,
  getMutationDef: (cropId: string) => MutationDefinition | undefined
): CropDefinition[] {
  let filtered = filterCropsByCategory(crops, filter, getMutationDef);
  filtered = filterCropsBySearch(filtered, searchTerm);
  return filtered;
}
