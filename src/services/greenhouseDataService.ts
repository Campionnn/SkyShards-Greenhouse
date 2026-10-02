// Loads and caches /greenhouse/data.json (crop, mutation and effect definitions).
// Synchronous getters return undefined/empty until loadGreenhouseData resolves.

export interface EffectDefinition {
  name: string;
  description: string;
}

export interface CropDataJSON {
  name: string;
  size: number;
  ground: string;
  growth_stages: number | null;
  /** Days until the plant decays; 0 = never. */
  decay?: number;
  /** Spawns a plant must help before it may decay: an int, "infinite" (never), or null (N/A: timer-only). */
  minimum_mutations?: number | "infinite" | null;
  positive_buffs: string[];
  negative_buffs: string[];
  drops: Record<string, number>;
}

export interface MutationRequirementJSON {
  crop: string;
  count: number;
}

export interface MutationDataJSON {
  name: string;
  size: number;
  ground: string;
  requirements: MutationRequirementJSON[];
  special?: string;
  rarity: string;
  growth_stages: number | null;
  decay: number;
  /** Spawns a plant must help before it may decay: an int, "infinite" (never), or null (N/A: timer-only). */
  minimum_mutations?: number | "infinite" | null;
  positive_buffs: string[];
  negative_buffs: string[];
  drops: Record<string, number>;
  requires_watering: boolean;
  harvest_info?: string;
  growing_info?: string;
}

export interface GreenhouseDataJSON {
  crops: Record<string, CropDataJSON>;
  mutations: Record<string, MutationDataJSON>;
  effects: Record<string, EffectDefinition>;
}

let cachedData: GreenhouseDataJSON | null = null;
let loadPromise: Promise<GreenhouseDataJSON> | null = null;

/** Fetches data.json once; concurrent calls share the request and a failure allows a retry. */
export async function loadGreenhouseData(): Promise<GreenhouseDataJSON> {
  if (cachedData) {
    return cachedData;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = fetch("/greenhouse/data.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load greenhouse data: ${response.statusText}`);
      }
      return response.json();
    })
    .then((data: GreenhouseDataJSON) => {
      cachedData = data;
      return data;
    })
    .catch((error) => {
      loadPromise = null;
      throw error;
    });

  return loadPromise;
}

export function getCropData(cropId: string): (CropDataJSON & { id: string }) | undefined {
  if (!cachedData) return undefined;
  
  const crop = cachedData.crops[cropId];
  if (!crop) return undefined;
  
  return { ...crop, id: cropId };
}

export function getMutationData(mutationId: string): (MutationDataJSON & { id: string }) | undefined {
  if (!cachedData) return undefined;
  
  const mutation = cachedData.mutations[mutationId];
  if (!mutation) return undefined;
  
  return { ...mutation, id: mutationId };
}

export function getEffectData(effectId: string): EffectDefinition | undefined {
  if (!cachedData) return undefined;
  return cachedData.effects[effectId];
}

export function getAllCrops(): (CropDataJSON & { id: string })[] {
  if (!cachedData) return [];
  
  return Object.entries(cachedData.crops).map(([id, crop]) => ({
    ...crop,
    id,
  }));
}

export function getAllMutations(): (MutationDataJSON & { id: string })[] {
  if (!cachedData) return [];
  
  return Object.entries(cachedData.mutations).map(([id, mutation]) => ({
    ...mutation,
    id,
  }));
}

export function getAllEffects(): (EffectDefinition & { id: string })[] {
  if (!cachedData) return [];
  
  return Object.entries(cachedData.effects).map(([id, effect]) => ({
    ...effect,
    id,
  }));
}

export function isDataLoaded(): boolean {
  return cachedData !== null;
}

export function getRawData(): GreenhouseDataJSON | null {
  return cachedData;
}

/** Looks the id up as a crop, then as a mutation. */
export function getItemData(itemId: string): 
  | { type: "crop"; data: CropDataJSON & { id: string } }
  | { type: "mutation"; data: MutationDataJSON & { id: string } }
  | undefined {
  const crop = getCropData(itemId);
  if (crop) {
    return { type: "crop", data: crop };
  }
  
  const mutation = getMutationData(itemId);
  if (mutation) {
    return { type: "mutation", data: mutation };
  }
  
  return undefined;
}
