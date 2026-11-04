import { isFreePlacedItem, type SimConfig } from "../config";
import type { GameData, ItemId } from "../data/types";
import { isBazaarItem } from "../economy/bazaar";
import { createLayoutResolver } from "../flow/layout";
import type { Condition, StepLayout } from "../flow/types";
import type { ResolvedLayout } from "./context";
import { bump } from "./summary";
import type { MarketSummary, Scenario, SimulationState } from "./state";

// Normal (non-ironman) profiles: the Bazaar. The engine only moves and counts items; prices
// never enter a run (economy/valuation.ts prices the counts), so runs stay deterministic and
// splittable. Ironman scenarios (no `settings.profile`) never reach any of this: no
// `summary.market`, no purchases, no sales, so their states are byte-identical to before.
//
// - Buying (`spend`, sim/inventory.ts): a placement short of a Bazaar item buys the shortfall.
// - Selling (`sellSurplus`, run.ts): after every online session, mutation items above the
//   reserve are sold.
// - Building (`placeLayoutPlants` in setup): the free starting layouts are counted, so the page
//   can show what building them would cost, outside the profit.

export const isNormalProfile = (state: SimulationState): boolean => state.scenario.settings.profile === "normal";

export function emptyMarket(): MarketSummary {
  return { produced: {}, bought: {}, sold: {}, built: {} };
}

/** Units bought plus sold so far: changes exactly when the player visited the Bazaar (effort). */
export function marketTotals(m: MarketSummary): number {
  let n = 0;
  for (const q of Object.values(m.bought)) n += q;
  for (const q of Object.values(m.sold)) n += q;
  return n;
}

/** The run's Bazaar counts, or null in ironman. */
export const marketOf = (state: SimulationState): MarketSummary | null => state.summary.market ?? null;

/** Count units the run produced (called by `credit`). No-op in ironman. */
export function countProduced(state: SimulationState, item: ItemId, qty: number): void {
  const m = state.summary.market;
  if (m && qty > 0) bump(m.produced, item, qty);
}

/** Can a normal profile buy this placed item instead of going short? */
export const canBuy = (state: SimulationState, item: ItemId): boolean => !!state.summary.market && isBazaarItem(item);

/** Placed items a layout puts down (not base crops or fire), by item. */
function placedCounts(layout: ResolvedLayout, config: SimConfig): Record<ItemId, number> {
  const out: Record<ItemId, number> = {};
  for (const d of layout.plants) if (d.origin === "placed" && !isFreePlacedItem(d.kindId, config)) bump(out, d.kindId);
  return out;
}

function triggerThresholds(conds: Condition[], out: Record<ItemId, number>): void {
  for (const c of conds) {
    if (c.kind === "group") triggerThresholds(c.of, out);
    else if (c.kind === "inventoryAtLeast" || c.kind === "inventoryBelow") out[c.item] = Math.max(out[c.item] ?? 0, Math.max(0, Math.ceil(c.qty)));
  }
}

/** How the automatic reserve of each item was worked out (for the page). */
export interface ReservePlan {
  /** Kept per item: overrides where set, otherwise the automatic reserve. Only mutation items are ever sold. */
  reserve: Record<ItemId, number>;
  /** The automatic reserve before overrides. */
  auto: Record<ItemId, number>;
}

/**
 * The stock kept back from selling, per mutation item. Automatic: for each plot, the most of that
 * item any one step's layout places; summed over the plots; raised to the largest
 * `inventoryAtLeast` / `inventoryBelow` threshold any exit names for it (so selling can't stop a
 * flow that waits for stock to build up). `settings.reserve` overrides it per item. Pure.
 */
export function reservePlan(scenario: Scenario, data: GameData, resolve: (layout: StepLayout) => ResolvedLayout = createLayoutResolver(data)): ReservePlan {
  const auto: Record<ItemId, number> = {};
  for (const plot of scenario.plots) {
    const most: Record<ItemId, number> = {};
    for (const step of plot.flow.steps) {
      let counts: Record<ItemId, number>;
      try {
        counts = placedCounts(resolve(step.layout), scenario.settings.config);
      } catch {
        continue; // an invalid layout fails validation elsewhere
      }
      for (const [item, n] of Object.entries(counts)) most[item] = Math.max(most[item] ?? 0, n);
    }
    for (const [item, n] of Object.entries(most)) bump(auto, item, n);
  }
  const thresholds: Record<ItemId, number> = {};
  for (const plot of scenario.plots) for (const step of plot.flow.steps) for (const exit of step.exits) triggerThresholds(exit.when, thresholds);
  for (const [item, n] of Object.entries(thresholds)) auto[item] = Math.max(auto[item] ?? 0, n);

  const reserve: Record<ItemId, number> = {};
  for (const [item, n] of Object.entries(auto)) if (data.mutations[item]) reserve[item] = n;
  for (const [item, raw] of Object.entries(scenario.settings.reserve ?? {})) {
    if (!data.mutations[item]) continue;
    const n = Math.max(0, Math.floor(Number(raw)));
    if (Number.isFinite(n)) reserve[item] = n;
  }
  return { reserve, auto };
}

/**
 * The player sells, on the Bazaar, every mutation item held above its reserve. Called by run()
 * once per online cycle, after every plot's session. Sold units leave the inventory; they are not
 * "consumed" (the ledger keeps placements only). No RNG, no events.
 */
export function sellSurplus(state: SimulationState, data: GameData, reserve: Record<ItemId, number>): void {
  const m = state.summary.market;
  if (!m) return;
  for (const item of Object.keys(state.inventory).sort()) {
    if (!data.mutations[item] || !isBazaarItem(item)) continue;
    const surplus = Math.floor((state.inventory[item] ?? 0) - (reserve[item] ?? 0));
    if (surplus <= 0) continue;
    state.inventory[item] -= surplus;
    bump(m.sold, item, surplus);
  }
}
