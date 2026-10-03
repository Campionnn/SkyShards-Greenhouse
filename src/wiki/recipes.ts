// Recipe graph helpers for the wiki: what an item is made from (the crafting
// tree, without quantities) and what it is used in. Pure; safe for tests.

import type { GreenhouseDataJSON } from "../services/greenhouseDataService";

export interface RecipeSource {
  /** Ingredient ids, in data order, without duplicates. */
  ingredients: string[];
  /** Plain-text note for mutations that don't spawn from a normal recipe. */
  note: string | null;
}

// Mutations with a "special" spawn rule. `ingredients` lists the crops the rule
// still depends on, so the tree can continue through them.
const SPECIAL_RECIPES: Record<string, RecipeSource> = {
  requires_zero_adjacent: {
    ingredients: [],
    note: "Spawns on its own in a spot with no crops in any of the 8 surrounding cells.",
  },
  all_positive_crop_effects: {
    ingredients: [],
    note: "Spawns where every one of its positive effects reaches it from neighbouring crops.",
  },
  grow_the_jerryseed: {
    ingredients: [],
    note: "Grown from a Jerryseed.",
  },
  explode_turtlellini_with_blastberry: {
    ingredients: ["turtlellini", "blastberry"],
    note: "A Turtlellini exploded twice by a Blastberry.",
  },
};

export function getRecipeSource(data: GreenhouseDataJSON, id: string): RecipeSource {
  const mutation = data.mutations[id];
  if (!mutation) return { ingredients: [], note: null };

  const fromRequirements = unique(mutation.requirements.map((req) => req.crop));
  if (mutation.special) {
    const special = SPECIAL_RECIPES[mutation.special];
    return {
      ingredients: unique([...fromRequirements, ...(special?.ingredients ?? [])]),
      note: special?.note ?? humanize(mutation.special),
    };
  }
  return { ingredients: fromRequirements, note: null };
}

/** True when the item has nothing further to expand (a base crop or a no-ingredient special). */
export function isLeaf(data: GreenhouseDataJSON, id: string): boolean {
  return getRecipeSource(data, id).ingredients.length === 0;
}

/** Item id -> ids of mutations that list it as an ingredient, sorted by name. */
export function buildUsedInMap(data: GreenhouseDataJSON): Map<string, string[]> {
  const usedIn = new Map<string, string[]>();
  for (const id of Object.keys(data.mutations)) {
    for (const ingredient of getRecipeSource(data, id).ingredients) {
      const list = usedIn.get(ingredient) ?? [];
      list.push(id);
      usedIn.set(ingredient, list);
    }
  }
  const nameOf = (id: string) => data.mutations[id]?.name ?? data.crops[id]?.name ?? id;
  for (const list of usedIn.values()) list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return usedIn;
}

/**
 * Every node path in the full tree below `id`, as "/"-joined id chains
 * (e.g. "devourer/zombud/fleshtrap"). Used by "Expand all". Cycles are cut.
 */
export function collectExpandablePaths(data: GreenhouseDataJSON, id: string): string[] {
  const paths: string[] = [];
  const walk = (current: string, path: string, ancestors: Set<string>) => {
    for (const child of getRecipeSource(data, current).ingredients) {
      if (ancestors.has(child) || isLeaf(data, child)) continue;
      const childPath = `${path}/${child}`;
      paths.push(childPath);
      walk(child, childPath, new Set(ancestors).add(child));
    }
  };
  walk(id, id, new Set([id]));
  return paths;
}

/** Distinct base crops (no further ingredients) the full tree bottoms out in. */
export function collectBaseIngredients(data: GreenhouseDataJSON, id: string): string[] {
  const seen = new Set<string>();
  const leaves: string[] = [];
  const walk = (current: string) => {
    for (const child of getRecipeSource(data, current).ingredients) {
      if (seen.has(child)) continue;
      seen.add(child);
      if (isLeaf(data, child)) leaves.push(child);
      else walk(child);
    }
  };
  walk(id);
  return leaves;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function humanize(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
