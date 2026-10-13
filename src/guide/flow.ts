/**
 * Loading the shipped Rose Dragon flow and describing its farms for people.
 *
 * Everything here is derived from the flows file and game data: names from each step's label,
 * costs from the resolved layout (placed items are paid, base crops and fire are free), products
 * from the target cells, and the goal from the Done step's exits. Only the per-farm tips are
 * authored text (see tips.ts).
 */
import { isFreePlacedItem, kindDef } from "../simulator";
import type { GameData } from "../simulator/data/types";
import type { createLayoutResolver } from "../simulator/flow/layout";
import type { ResolvedLayout } from "../simulator/sim/context";
import type { Scenario } from "../simulator/sim/state";
import type { ItemCount, PlotId } from "./types";

export const SHIPPED_FLOW_URL = "/greenhouse/flows/rose-dragon.flows.json";
/** Empty farmland: the step every plot starts on and returns to while it waits. */
export const HUB = "hub";
/** Shown when a plot is blocked only on Dead Plants / Fermento. */
export const SUPPLIES = "supplies";
/** The final step. */
export const DONE = "done";
/** Dead Plants and Fermento: inputs the player farms separately, outside the mutation ladder. */
export const SUPPLY_ITEMS = ["dead_plant", "fermento"] as const;
/** Fragments are what an All-in Aloe harvest actually drops (9 become 1 Aloe). */
export const ALOE_FRAGMENT = "all_in_aloe_fragment";

/** The subset of the flows format the Guide relies on. */
export interface FlowsFile {
  kind?: string;
  version?: number;
  plots: Scenario["plots"];
  script?: Scenario["script"];
}

/** Parse and sanity-check a flows file. Throws with a player-readable message. */
export function parseFlows(text: string): FlowsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That flows file is not valid JSON.");
  }
  if (!raw || typeof raw !== "object") throw new Error("That flows file is empty.");
  const file = raw as FlowsFile;
  if (!Array.isArray(file.plots) || file.plots.length === 0) throw new Error("That flows file has no plots.");
  for (const plot of file.plots) {
    if (!plot?.flow?.steps?.length) throw new Error(`Plot ${plot?.id ?? "?"} has no steps.`);
    if (!plot.script?.source?.trim()) {
      throw new Error(`Plot ${plot.id} has no script, so the Guide cannot decide anything for it.`);
    }
    for (const id of [HUB, DONE]) {
      if (!plot.flow.steps.some((s) => s.id === id)) throw new Error(`Plot ${plot.id} has no "${id}" step.`);
    }
  }
  return file;
}

/**
 * The whole flow as a Simulator scenario, starting where the player is now: each plot on the farm
 * they reported, their inventory as the starting stock and their schedule and stats. Scripts stay
 * attached, so the Simulator runs the same decisions the Guide shows.
 */
export function simulatorScenario(flow: FlowsFile, input: { inventory: Record<string, number>; plots: Record<PlotId, { farm: string } | undefined>; settings: Scenario["settings"] }): Scenario {
  const plots = structuredClone(flow.plots);
  for (const plot of plots) {
    const farm = input.plots[plot.id]?.farm ?? HUB;
    const index = plot.flow.steps.findIndex((s) => s.id === farm);
    plot.flow.startIndex = index < 0 ? 0 : index;
  }
  const startingInventory: Record<string, number> = {};
  for (const [item, amount] of Object.entries(input.inventory)) if (Number.isFinite(amount) && amount > 0) startingInventory[item] = Math.floor(amount);
  const scenario: Scenario = { plots, startingInventory, settings: structuredClone(input.settings) };
  if (flow.script?.source.trim()) scenario.script = structuredClone(flow.script);
  return scenario;
}

/** Fetch the shipped flow from the app's public directory. */
export async function loadShippedFlow(fetchImpl: typeof fetch = fetch): Promise<FlowsFile> {
  const response = await fetchImpl(SHIPPED_FLOW_URL);
  if (!response.ok) throw new Error(`Could not load the Rose Dragon flow (HTTP ${response.status}).`);
  return parseFlows(await response.text());
}

/** The display name of a crop, mutation or item id. */
export function itemName(data: GameData, id: string): string {
  if (id === ALOE_FRAGMENT) return "All-in Aloe Fragment";
  const name = kindDef(data, id)?.name;
  return name ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One farm (flow step) on one plot, described for the player. */
export interface Farm {
  id: string;
  plotId: PlotId;
  /** Short name ("Commons farm", "Magic Jellybean"). */
  name: string;
  /** The step's full label from the flows file. */
  label: string;
  /** The label's note after the name ("keep inputs while growing", "no Dead Plants or Fermento"), if any. */
  detail: string;
  layout: ResolvedLayout;
  /** The step's share code, for opening it in the Designer (absent for inline layout specs). */
  code?: string;
  /** Paid items placed from the inventory, most first. */
  cost: ItemCount[];
  /** Free base crops (and fire) planted or placed for free. */
  free: ItemCount[];
  /** The mutations its target cells grow. */
  products: ItemCount[];
  /** Hub, supplies and Done are not farms the player builds. */
  kind: "farm" | "hub" | "supplies" | "done";
}

const NAME_OVERRIDES: Record<string, string> = {
  [HUB]: "Empty farmland",
  [SUPPLIES]: "Out of supplies",
  [DONE]: "Done",
  "shellfruit-cheese": "Shellfruit (Cheesebite corner kept)",
};

/** "Devourer: keep inputs while growing" -> "Devourer"; parenthetical notes are kept in `label`. */
function shortName(id: string, label: string | undefined): string {
  if (NAME_OVERRIDES[id]) return NAME_OVERRIDES[id];
  const text = (label ?? id).trim();
  const cut = text.split(/[:(]/)[0].trim();
  return cut || text;
}

/** "Devourer: keep inputs while growing" -> "keep inputs while growing"; "X (no bought inputs)" -> "no Dead Plants or Fermento". */
export function labelDetail(id: string, label: string | undefined): string {
  if (!label || NAME_OVERRIDES[id]) return "";
  const text = label.trim();
  const name = text.split(/[:(]/)[0].trim();
  const rest = text.slice(name.length).trim();
  const parts = [...rest.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const tail = rest.replace(/\([^)]*\)/g, "").replace(/^[\s:]+/, "").trim();
  // The flow's labels say "bought"; these inputs are farmed, not bought.
  return [tail, ...parts].filter(Boolean).join(" · ").replace(/\bno bought inputs\b/, "no Dead Plants or Fermento");
}

function counts(entries: string[]): ItemCount[] {
  const map = new Map<string, number>();
  for (const id of entries) map.set(id, (map.get(id) ?? 0) + 1);
  return [...map].map(([item, count]) => ({ item, count })).sort((a, b) => b.count - a.count || (a.item < b.item ? -1 : 1));
}

export type Resolver = ReturnType<typeof createLayoutResolver>;

/** Every plot's farms, keyed by plot then step id. */
export interface Catalog {
  plots: PlotId[];
  farms: Record<PlotId, Farm[]>;
  /** The goal items and how many of each (read from the Done step's exits). */
  goal: ItemCount[];
  /** Every item the player may need to report: supplies, placed inputs, products, goal, fragments. */
  items: string[];
}

export function farmOf(catalog: Catalog, plotId: PlotId, stepId: string): Farm {
  const farm = catalog.farms[plotId]?.find((f) => f.id === stepId);
  if (!farm) throw new Error(`Plot ${plotId} has no farm called "${stepId}".`);
  return farm;
}

/** The goal: every `inventoryAtLeast` condition on the Done step's own exit. */
export function goalItems(flow: FlowsFile): ItemCount[] {
  const done = flow.plots[0].flow.steps.find((s) => s.id === DONE);
  const out = new Map<string, number>();
  for (const exit of done?.exits ?? []) {
    for (const cond of exit.when) {
      if (cond.kind === "inventoryAtLeast") out.set(cond.item, Math.max(out.get(cond.item) ?? 0, cond.qty));
    }
  }
  return [...out].map(([item, count]) => ({ item, count }));
}

export function buildCatalog(flow: FlowsFile, resolve: Resolver): Catalog {
  const farms: Record<PlotId, Farm[]> = {};
  const items = new Set<string>([...SUPPLY_ITEMS]);
  for (const plot of flow.plots) {
    farms[plot.id] = plot.flow.steps.map((step) => {
      const layout = resolve(step.layout);
      const paid = layout.plants.filter((p) => p.origin === "placed" && !isFreePlacedItem(p.kindId)).map((p) => p.kindId);
      const free = layout.plants.filter((p) => p.origin === "planted" || isFreePlacedItem(p.kindId)).map((p) => p.kindId);
      for (const id of paid) items.add(id);
      for (const s of layout.slots) items.add(s.mutationId);
      const kind: Farm["kind"] = step.id === HUB ? "hub" : step.id === SUPPLIES ? "supplies" : step.id === DONE ? "done" : "farm";
      return {
        id: step.id,
        plotId: plot.id,
        name: shortName(step.id, step.label),
        label: step.label ?? step.id,
        detail: labelDetail(step.id, step.label),
        layout,
        ...("code" in step.layout ? { code: step.layout.code } : {}),
        cost: counts(paid),
        free: counts(free),
        products: counts(layout.slots.map((s) => s.mutationId)),
        kind,
      };
    });
  }
  const goal = goalItems(flow);
  for (const g of goal) items.add(g.item);
  items.add(ALOE_FRAGMENT);
  return { plots: flow.plots.map((p) => p.id), farms, goal, items: [...items] };
}

/** Rarity of an item for grouping the inventory (supplies and fragments get their own groups). */
export type ItemGroup = "supplies" | "goal" | "common" | "uncommon" | "rare" | "epic" | "legendary";

export const GROUP_LABELS: Record<ItemGroup, string> = {
  supplies: "Dead Plants & Fermento",
  goal: "Goal (legendaries)",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const GROUP_ORDER: ItemGroup[] = ["supplies", "goal", "common", "uncommon", "rare", "epic", "legendary"];

export function itemGroup(data: GameData, catalog: Catalog, id: string): ItemGroup {
  if ((SUPPLY_ITEMS as readonly string[]).includes(id)) return "supplies";
  if (id === ALOE_FRAGMENT || catalog.goal.some((g) => g.item === id)) return "goal";
  const rarity = data.mutations[id]?.rarity;
  if (rarity === "common" || rarity === "uncommon" || rarity === "rare" || rarity === "epic" || rarity === "legendary") return rarity;
  return "common";
}

/** The inventory items grouped for the inventory panel, each group sorted by name. */
export function groupedItems(data: GameData, catalog: Catalog): { group: ItemGroup; items: string[] }[] {
  const byGroup = new Map<ItemGroup, string[]>();
  for (const id of catalog.items) {
    const group = itemGroup(data, catalog, id);
    byGroup.set(group, [...(byGroup.get(group) ?? []), id]);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    items: byGroup.get(group)!.sort((a, b) => {
      if (group === "goal") {
        // Goal items in the Done step's order, the fragment right after the Aloe.
        const rank = (id: string) => (id === ALOE_FRAGMENT ? catalog.goal.findIndex((g) => g.item === "all_in_aloe") + 0.5 : catalog.goal.findIndex((g) => g.item === id));
        return rank(a) - rank(b);
      }
      return itemName(data, a).localeCompare(itemName(data, b));
    }),
  }));
}
