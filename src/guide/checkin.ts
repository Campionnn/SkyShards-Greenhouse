/**
 * The Guide's persistent picture of the player's greenhouse, and how it changes.
 *
 * Trust-and-correct: when the player confirms a plot ("Done with Plot 1"), the Guide moves that plot
 * to its new farm and applies only the deterministic stock changes. It takes off what was placed,
 * credits what the session's own harvest paid for, and books any Zombud harvests the player counted
 * on the card. Ordinary harvests are random, so the player enters them. A check-in lasts until the
 * player starts the next one; confirmations (with their undo) are part of the stored state.
 */
import { kindDef } from "../simulator";
import type { GameData } from "../simulator/data/types";
import type { Settings } from "../simulator/sim/state";
import { ALOE_FRAGMENT, HUB, farmOf, type Catalog, type FlowsFile } from "./flow";
import { DEFAULT_CHECK_EVERY, activityFor } from "./schedule";
import type { Cell, GuideInput, GuideMemory, ItemCount, PlotFacts, PlotId, PlotInput, PlotOutcome, StandingPlant } from "./types";

/** An exact record of one confirmation, so Undo puts everything back, even after a reload. */
export interface Confirmation {
  plotId: PlotId;
  before: PlotInput;
  /** Stock change applied (item -> signed amount). Undo applies the opposite. */
  delta: Record<string, number>;
  memory: GuideMemory;
}

/** What the page stores and edits. */
export interface GuideState {
  inventory: Record<string, number>;
  plots: Record<PlotId, PlotInput>;
  settings: Settings;
  memory: GuideMemory;
  /** "How often do you check your greenhouse?" in real hours; null = daily time windows. */
  checkEvery: number | null;
  /** This visit's confirmations, by plot. Cleared when the next check-in starts. */
  confirmations: Record<PlotId, Confirmation>;
  /** The last "Import from Hypixel" lookup, for one-click "Import again" and "what changed since". */
  lastImport?: LastImport;
}

/** What the last Hypixel lookup found (tracked items only) and when. */
export interface LastImport {
  username: string;
  profileId: string;
  /** "Apple (Ironman)": shown next to the import time. */
  profileName: string;
  /** When the lookup ran (ms since epoch). */
  fetchedAt: number;
  /** When its counts were last applied as the Guide's totals (or already matched them). */
  appliedAt?: number;
  /** Tracked item -> count found (zero counts left out). */
  items: Record<string, number>;
}

export const STORAGE_VERSION = 3;

export function emptyFacts(): PlotFacts {
  return { missing: [], standing: [], devourerRefresh: false };
}

export function hasFacts(facts: PlotFacts | undefined): boolean {
  return !!facts && (facts.missing.length > 0 || facts.standing.length > 0 || facts.devourerRefresh);
}

/** Every plot on empty farmland and nothing owned: the page asks the player to enter their stock first. */
export function initialState(flow: FlowsFile, settings: Settings, inventory: Record<string, number> = {}): GuideState {
  const plots: Record<PlotId, PlotInput> = {};
  for (const plot of flow.plots) plots[plot.id] = { farm: HUB };
  return {
    inventory: Object.fromEntries(Object.entries(inventory).filter(([, n]) => Number.isFinite(n) && n > 0).map(([k, n]) => [k, Math.floor(n)])),
    plots,
    settings: { ...settings, activity: activityFor(DEFAULT_CHECK_EVERY, settings) },
    memory: { builtOnce: {} },
    checkEvery: DEFAULT_CHECK_EVERY,
    confirmations: {},
  };
}

export function toInput(state: GuideState): GuideInput {
  return { inventory: state.inventory, plots: state.plots, settings: state.settings, memory: state.memory };
}

/** Change settings and/or the check-in interval; the simulated schedule follows both. */
export function withSettings(state: GuideState, settings: Settings, checkEvery: number | null = state.checkEvery): GuideState {
  return { ...state, checkEvery, settings: { ...settings, activity: checkEvery === null ? settings.activity : activityFor(checkEvery, settings) } };
}

/** Is this goal entry covered, counting every 9 All-in Aloe Fragments as one Aloe (the game converts them)? */
function goalMet(g: ItemCount, inventory: Record<string, number>): boolean {
  const extra = g.item === "all_in_aloe" ? Math.floor((inventory[ALOE_FRAGMENT] ?? 0) / 9) : 0;
  return (inventory[g.item] ?? 0) + extra >= g.count;
}

/** The goal items owned (every entry, legendaries and the one-of-each set). */
export function goalOwned(catalog: Catalog, inventory: Record<string, number>): number {
  return catalog.goal.filter((g) => goalMet(g, inventory)).length;
}

/**
 * The goal split for display: the Rose Dragon legendaries (more than one of each is needed) and the
 * "one of every other mutation" set, each with how many entries are covered.
 */
export function goalProgress(catalog: Catalog, inventory: Record<string, number>): {
  legendaries: { owned: number; total: number; items: ItemCount[] };
  others: { owned: number; total: number; missing: ItemCount[] };
} {
  const legendaries = catalog.goal.filter((g) => g.count > 1);
  const others = catalog.goal.filter((g) => g.count <= 1);
  return {
    legendaries: { owned: legendaries.filter((g) => goalMet(g, inventory)).length, total: legendaries.length, items: legendaries },
    others: { owned: others.filter((g) => goalMet(g, inventory)).length, total: others.length, missing: others.filter((g) => !goalMet(g, inventory)) },
  };
}

/** How many Zombuds one harvest on this farm makes: Dead Plants (or empty cells) in a Zombud cell's ring. */
export function zombudYield(catalog: Catalog, plotId: PlotId, farmId: string): number {
  const farm = farmOf(catalog, plotId, farmId);
  const slots = farm.layout.slots.filter((s) => s.mutationId === "zombud");
  if (!slots.length) return 0;
  const counts = slots.map((s) => {
    let n = 0;
    for (let r = s.row - 1; r <= s.row + s.size; r++) {
      for (let c = s.col - 1; c <= s.col + s.size; c++) {
        if (r < 0 || c < 0 || r > 9 || c > 9 || (r >= s.row && r < s.row + s.size && c >= s.col && c < s.col + s.size)) continue;
        const at = farm.layout.plants.find((p) => r >= p.row && r < p.row + p.size && c >= p.col && c < p.col + p.size);
        if (!at || at.kindId === "dead_plant") n += 1;
      }
    }
    return n;
  });
  return Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
}

/** Extra player input on confirm that the projection can't know. */
export interface ConfirmExtras {
  /** Zombud plants harvested on this plot this visit. */
  zombudHarvests?: number;
  /** Zombuds (and Dead Plants used) per harvest on this farm: `zombudYield`. */
  zombudPerHarvest?: number;
}

function addDelta(delta: Record<string, number>, items: ItemCount[], sign: 1 | -1, scale = 1): void {
  for (const { item, count } of items) delta[item] = (delta[item] ?? 0) + sign * count * scale;
}

/** What is still true about the plot after the session, for the next check-in. */
function factsAfter(state: GuideState, outcome: PlotOutcome): PlotFacts | undefined {
  const missing: Cell[] = outcome.shortCells;
  // A farm that stays keeps its growing targets (their stage moves on, so the card asks to check).
  // Fully grown ones are harvested now, and a changed farm cleared its target cells.
  const previous = state.plots[outcome.plotId]?.facts;
  const standing: StandingPlant[] = outcome.from === outcome.to ? (previous?.standing ?? []).filter((s) => !s.fullyGrown) : [];
  const facts: PlotFacts = { missing, standing, devourerRefresh: false };
  return hasFacts(facts) ? facts : undefined;
}

/** Confirm one plot. */
export function confirmPlot(state: GuideState, outcome: PlotOutcome, extras: ConfirmExtras = {}): GuideState {
  const delta: Record<string, number> = {};
  addDelta(delta, outcome.selfFunded, 1);
  addDelta(delta, outcome.spent, -1);
  const harvests = Math.max(0, Math.floor(extras.zombudHarvests ?? 0));
  const perHarvest = Math.max(0, Math.floor(extras.zombudPerHarvest ?? 0));
  if (harvests > 0 && perHarvest > 0) {
    // Each harvest turns the ring's Dead Plants into one Zombud each (not yield-scaled), and the
    // layout then needs those Dead Plants placed again.
    addDelta(delta, [{ item: "zombud", count: perHarvest }], 1, harvests);
    addDelta(delta, [{ item: "dead_plant", count: perHarvest }], -1, harvests);
  }
  const inventory = { ...state.inventory };
  for (const [item, change] of Object.entries(delta)) {
    const had = inventory[item] ?? 0;
    const next = Math.max(0, had + change);
    delta[item] = next - had; // what was really applied, so Undo reverses exactly this
    if (next > 0) inventory[item] = next;
    else delete inventory[item];
  }
  const plot: PlotInput = { farm: outcome.to, acted: true, facts: factsAfter(state, outcome), factsFromEarlier: undefined };
  // The script's "built once" memory only advances on entries the player actually made.
  const memory = outcome.action === "enter" ? { builtOnce: { ...outcome.builtOnce } } : state.memory;
  const confirmation: Confirmation = { plotId: outcome.plotId, before: state.plots[outcome.plotId], delta, memory: state.memory };
  return { ...state, inventory, plots: { ...state.plots, [outcome.plotId]: plot }, memory, confirmations: { ...state.confirmations, [outcome.plotId]: confirmation } };
}

/** Skip a plot this visit (e.g. it is waiting for Dead Plants / Fermento the player hasn't farmed yet). */
export function skipPlot(state: GuideState, plotId: PlotId): GuideState {
  const before = state.plots[plotId];
  const confirmation: Confirmation = { plotId, before, delta: {}, memory: state.memory };
  return { ...state, plots: { ...state.plots, [plotId]: { ...before, acted: true } }, confirmations: { ...state.confirmations, [plotId]: confirmation } };
}

/** Undo a confirmation: the plot goes back and its stock change is reversed (later edits are kept). */
export function undoPlot(state: GuideState, plotId: PlotId): GuideState {
  const confirmation = state.confirmations[plotId];
  if (!confirmation) return state;
  const inventory = { ...state.inventory };
  for (const [item, change] of Object.entries(confirmation.delta)) {
    const next = (inventory[item] ?? 0) - change;
    if (next > 0) inventory[item] = next;
    else delete inventory[item];
  }
  const confirmations = { ...state.confirmations };
  delete confirmations[plotId];
  return { ...state, inventory, plots: { ...state.plots, [plotId]: confirmation.before }, memory: confirmation.memory, confirmations };
}

export function allActed(state: GuideState): boolean {
  return Object.values(state.plots).every((p) => p.acted);
}

/** "I'm back": a new visit. Farms stay; facts carried from last time are flagged to be checked. */
export function startNewCheckIn(state: GuideState): GuideState {
  const plots: Record<PlotId, PlotInput> = {};
  for (const [id, plot] of Object.entries(state.plots)) {
    plots[Number(id)] = { farm: plot.farm, facts: plot.facts, factsFromEarlier: plot.facts ? true : undefined };
  }
  return { ...state, plots, confirmations: {} };
}

/** The player corrected where a plot is: new farm, unknown facts, not acted. */
export function setFarm(state: GuideState, plotId: PlotId, farm: string): GuideState {
  const confirmations = { ...state.confirmations };
  delete confirmations[plotId];
  return { ...state, plots: { ...state.plots, [plotId]: { farm } }, confirmations };
}

export function setFacts(state: GuideState, plotId: PlotId, facts: PlotFacts | undefined): GuideState {
  const plot = state.plots[plotId];
  return { ...state, plots: { ...state.plots, [plotId]: { ...plot, facts: hasFacts(facts) ? facts : undefined, factsFromEarlier: undefined } } };
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

const isCell = (c: unknown): c is Cell => !!c && typeof c === "object" && Number.isInteger((c as Cell).row) && Number.isInteger((c as Cell).col);

function cleanFacts(raw: unknown): PlotFacts | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<PlotFacts>;
  const facts: PlotFacts = {
    missing: Array.isArray(r.missing) ? r.missing.filter(isCell).map((c) => ({ row: c.row, col: c.col })) : [],
    standing: Array.isArray(r.standing)
      ? r.standing
          .filter((s): s is StandingPlant => isCell(s) && typeof (s as StandingPlant).kind === "string")
          .map((s) => ({ row: s.row, col: s.col, kind: s.kind, stage: Number(s.stage) || 0, fullyGrown: s.fullyGrown === true }))
      : [],
    devourerRefresh: r.devourerRefresh === true,
  };
  return hasFacts(facts) ? facts : undefined;
}

/** Migrate whatever was stored to a usable state, dropping anything that no longer fits the flow. */
export function restoreState(raw: unknown, flow: FlowsFile, catalog: Catalog, defaults: Settings): GuideState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GuideState> & { version?: number };
  if (r.version !== 2 && r.version !== STORAGE_VERSION) return null; // the first Guide's shape is not migrated
  const base = initialState(flow, defaults, {});
  const inventory: Record<string, number> = {};
  for (const [item, amount] of Object.entries(r.inventory ?? {})) {
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) inventory[item] = Math.floor(amount);
  }
  const plots = { ...base.plots };
  for (const id of catalog.plots) {
    const saved = r.plots?.[id];
    if (saved && typeof saved.farm === "string" && catalog.farms[id].some((f) => f.id === saved.farm)) {
      plots[id] = { farm: saved.farm, facts: cleanFacts(saved.facts), acted: saved.acted === true, factsFromEarlier: saved.factsFromEarlier === true || undefined };
    }
  }
  const settings: Settings = r.settings
    ? { ...defaults, ...r.settings, playerStats: { ...defaults.playerStats, ...r.settings.playerStats }, config: defaults.config, policies: defaults.policies }
    : defaults;
  const checkEvery = r.version === STORAGE_VERSION ? (r.checkEvery === null ? null : typeof r.checkEvery === "number" && r.checkEvery > 0 ? r.checkEvery : DEFAULT_CHECK_EVERY) : DEFAULT_CHECK_EVERY;
  const builtOnce = r.memory?.builtOnce && typeof r.memory.builtOnce === "object" ? r.memory.builtOnce : {};
  const confirmations: Record<PlotId, Confirmation> = {};
  for (const [id, c] of Object.entries(r.confirmations ?? {})) {
    if (c && plots[Number(id)]?.acted && c.before && typeof c.before.farm === "string" && c.delta && typeof c.delta === "object") confirmations[Number(id)] = c;
  }
  const lastImport = cleanLastImport(r.lastImport);
  return withSettings({ inventory, plots, settings, memory: { builtOnce }, checkEvery, confirmations, ...(lastImport ? { lastImport } : {}) }, settings, checkEvery);
}

function cleanLastImport(raw: unknown): LastImport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<LastImport>;
  if (typeof r.username !== "string" || typeof r.profileId !== "string" || typeof r.fetchedAt !== "number" || !Number.isFinite(r.fetchedAt)) return undefined;
  const items: Record<string, number> = {};
  for (const [item, n] of Object.entries(r.items ?? {})) if (typeof n === "number" && Number.isFinite(n) && n > 0) items[item] = Math.floor(n);
  return {
    username: r.username,
    profileId: r.profileId,
    profileName: typeof r.profileName === "string" ? r.profileName : "",
    fetchedAt: r.fetchedAt,
    ...(typeof r.appliedAt === "number" && Number.isFinite(r.appliedAt) ? { appliedAt: r.appliedAt } : {}),
    items,
  };
}
