/**
 * The Guide's persistent picture of the player's greenhouse, and how it changes.
 *
 * Trust-and-correct: when the player confirms a plot ("Done with Plot 1"), the Guide moves that plot
 * to its new farm and subtracts exactly what the projection placed from stock. It never adds
 * harvests: they are random, so the player enters them. A check-in lasts until every plot is
 * confirmed; then the next visit starts a new one.
 */
import { kindDef } from "../simulator";
import type { GameData } from "../simulator/data/types";
import type { Settings } from "../simulator/sim/state";
import { ALOE_FRAGMENT, HUB, type Catalog, type FlowsFile } from "./flow";
import type { GuideInput, GuideMemory, PlotFacts, PlotId, PlotInput, PlotOutcome } from "./types";

/** What the page stores and edits. */
export interface GuideState {
  inventory: Record<string, number>;
  plots: Record<PlotId, PlotInput>;
  settings: Settings;
  memory: GuideMemory;
}

export const STARTER_SUPPLIES: Record<string, number> = { dead_plant: 250, fermento: 50 };

export function emptyFacts(): PlotFacts {
  return { missing: [], standing: [], primed: [], devourerRefresh: false };
}

export function hasFacts(facts: PlotFacts | undefined): boolean {
  return !!facts && (facts.missing.length > 0 || facts.standing.length > 0 || facts.primed.length > 0 || facts.devourerRefresh);
}

/** Every plot on empty farmland with the given stock. */
export function initialState(flow: FlowsFile, settings: Settings, inventory: Record<string, number> = STARTER_SUPPLIES): GuideState {
  const plots: Record<PlotId, PlotInput> = {};
  for (const plot of flow.plots) plots[plot.id] = { farm: HUB };
  return { inventory: { ...inventory }, plots, settings, memory: { builtOnce: {} } };
}

export function toInput(state: GuideState): GuideInput {
  return { inventory: state.inventory, plots: state.plots, settings: state.settings, memory: state.memory };
}

/**
 * Confirm one plot: it is now on `outcome.to`, its facts are cleared (they described the old farm),
 * and the deterministic placement cost is taken from stock. Harvests are left to the player.
 */
export function confirmPlot(state: GuideState, outcome: PlotOutcome): GuideState {
  const inventory = { ...state.inventory };
  for (const { item, count } of outcome.spent) inventory[item] = Math.max(0, (inventory[item] ?? 0) - count);
  const plots = { ...state.plots, [outcome.plotId]: { farm: outcome.to, acted: true } };
  // The script's "built once" memory is only advanced by entries the player actually made.
  const memory = outcome.action === "enter" ? { builtOnce: { ...outcome.builtOnce } } : state.memory;
  return { ...state, inventory, plots, memory };
}

/** What `undoPlot` needs to put a confirmation back exactly. */
export interface Confirmation {
  plotId: PlotId;
  before: PlotInput;
  spent: PlotOutcome["spent"];
  memory: GuideMemory;
}

export function confirmationOf(state: GuideState, outcome: PlotOutcome): Confirmation {
  return { plotId: outcome.plotId, before: state.plots[outcome.plotId], spent: outcome.spent, memory: state.memory };
}

/** Undo a confirmation: the plot goes back and what it spent is returned (later edits are kept). */
export function undoPlot(state: GuideState, confirmation: Confirmation): GuideState {
  const inventory = { ...state.inventory };
  for (const { item, count } of confirmation.spent) inventory[item] = (inventory[item] ?? 0) + count;
  return { ...state, inventory, plots: { ...state.plots, [confirmation.plotId]: confirmation.before }, memory: confirmation.memory };
}

export function allActed(state: GuideState): boolean {
  return Object.values(state.plots).every((p) => p.acted);
}

/** "I'm back": forget which plots acted this login. Farms and facts stay. */
export function startNewCheckIn(state: GuideState): GuideState {
  const plots: Record<PlotId, PlotInput> = {};
  for (const [id, plot] of Object.entries(state.plots)) plots[Number(id)] = { farm: plot.farm, facts: plot.facts };
  return { ...state, plots };
}

/** The player corrected where a plot is: new farm, unknown facts, not acted. */
export function setFarm(state: GuideState, plotId: PlotId, farm: string): GuideState {
  return { ...state, plots: { ...state.plots, [plotId]: { farm } } };
}

export function setFacts(state: GuideState, plotId: PlotId, facts: PlotFacts | undefined): GuideState {
  const plot = state.plots[plotId];
  return { ...state, plots: { ...state.plots, [plotId]: { ...plot, facts: hasFacts(facts) ? facts : undefined } } };
}

export function setItem(state: GuideState, item: string, amount: number): GuideState {
  const inventory = { ...state.inventory };
  if (!Number.isFinite(amount) || amount <= 0) delete inventory[item];
  else inventory[item] = Math.floor(amount);
  return { ...state, inventory };
}

/** Problems a player can fix, in plain words. Empty means the state is usable. */
export function validate(state: GuideState, catalog: Catalog, data: GameData): string[] {
  const problems: string[] = [];
  for (const [item, amount] of Object.entries(state.inventory)) {
    if (item !== ALOE_FRAGMENT && !kindDef(data, item)) problems.push(`"${item}" isn't an item the greenhouse knows.`);
    if (!Number.isFinite(amount) || amount < 0) problems.push(`${item} has an impossible amount (${amount}).`);
  }
  for (const id of catalog.plots) {
    const plot = state.plots[id];
    if (!plot) problems.push(`Plot ${id} is missing.`);
    else if (!catalog.farms[id].some((f) => f.id === plot.farm)) problems.push(`Plot ${id} has no farm called "${plot.farm}".`);
  }
  return problems;
}

/** Migrate whatever was stored to a usable state, dropping anything that no longer fits the flow. */
export function restoreState(raw: unknown, flow: FlowsFile, catalog: Catalog, defaults: Settings): GuideState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GuideState> & { version?: number };
  if (r.version !== 2) return null; // the first Guide's check-in shape is not migrated
  const base = initialState(flow, defaults, {});
  const inventory: Record<string, number> = {};
  for (const [item, amount] of Object.entries(r.inventory ?? {})) {
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) inventory[item] = Math.floor(amount);
  }
  const plots = { ...base.plots };
  for (const id of catalog.plots) {
    const saved = r.plots?.[id];
    if (saved && typeof saved.farm === "string" && catalog.farms[id].some((f) => f.id === saved.farm)) {
      plots[id] = { farm: saved.farm, facts: saved.facts, acted: saved.acted === true };
    }
  }
  const settings = r.settings
    ? { ...defaults, ...r.settings, playerStats: { ...defaults.playerStats, ...r.settings.playerStats }, config: defaults.config, policies: defaults.policies }
    : defaults;
  const builtOnce = r.memory?.builtOnce && typeof r.memory.builtOnce === "object" ? r.memory.builtOnce : {};
  return { inventory, plots, settings, memory: { builtOnce } };
}
