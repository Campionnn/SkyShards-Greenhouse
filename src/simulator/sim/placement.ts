import { isFreePlacedItem, type SimConfig } from "../config";
import type { GameData } from "../data/types";
import { cellIndex, footprint, footprintFits, ringCells } from "../grid/cells";
import type { CycleCtx, ResolvedLayout, TickScratch } from "./context";
import { effort } from "./effort";
import { destroyPlant, isPrimedBlastberry } from "./explosion";
import { harvestPlant } from "./harvest";
import { closePlotDebts, credit, refundPlacement, spend } from "./inventory";
import { canBuy } from "./market";
import { buildOccupancy, DEAD_PLANT, insertPlant, isFootprintFree, isHarvestable, newPlant, removePlant, type Occupancy } from "./plants";
import type { PlantState, PlotState, SlotLabel } from "./state";
import { bump } from "./summary";
import { isProtected } from "../script/overrides";

/**
 * Player removal: harvest if harvestable, clear a Dead Plant (item back to inventory), pick a
 * mutation item placed since the last tick back up (item back, `gate.pickup`), else break it as a loss.
 */
export function removeByPlayer(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch, why: string): void {
  if (p.gate.pickup) {
    pickUp(plot, p, ctx);
    return;
  }
  if (isHarvestable(p)) {
    harvestPlant(plot, p, ctx, scratch);
    return;
  }
  effort(ctx.state, "remove");
  if (p.isDeadPlant) {
    removePlant(plot, p);
    credit(ctx.state, DEAD_PLANT, p.size * p.size);
    ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "cleared dead plant" });
    return;
  }
  destroyPlant(plot, p, ctx, why);
}

/**
 * Game rule: a mutation item placed from inventory can be broken and picked back up, at no loss,
 * until the next greenhouse tick. In that window it already gives its effects to its neighbours
 * (e.g. a Blastberry's Immunity and Improved Harvest Boost on an All-in Aloe or Magic Jellybean
 * harvested in the same session), and a placed Blastberry is not primed yet, so it doesn't explode.
 */
function pickUp(plot: PlotState, p: PlantState, ctx: CycleCtx): void {
  effort(ctx.state, "remove");
  removePlant(plot, p);
  refundPlacement(ctx.state, p.kindId, p.gate.pickup === "replacement", ctx.prices);
  ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "picked up (no tick since placed)" });
}

/**
 * Mark a placed plant as paid for from inventory this session (`gate.pickup`): breaking it before
 * the next tick returns the item. Mutation items only; free items (fire) cost nothing anyway.
 */
export function markPickup(p: PlantState, ctx: CycleCtx, replacement: boolean): void {
  if (p.origin === "placed" && !p.isDeadPlant && ctx.env.data.mutations[p.kindId]) p.gate.pickup = replacement ? "replacement" : "placed";
}


/**
 * - setup: starting layouts; free, never drawn from inventory.
 * - step: a later flow step laying out.
 * - replace: re-placing what decayed or was destroyed (counted as replacements).
 */
export type PlacementMode = "setup" | "step" | "replace";

/**
 * Place missing layout plants on free cells. Base crops and free placed items
 * (fire, `FREE_PLACED_ITEMS`) cost nothing; outside setup, other placed items are a required spend and a shortfall records debt
 * (cell stays empty, retried next session). With `config.allowMutationDebt`, a mutation item is placed anyway and its
 * stock goes below 0 (borrowed).
 */
export function placeLayoutPlants(plot: PlotState, layout: ResolvedLayout, ctx: CycleCtx, mode: PlacementMode): void {
  const replacement = mode === "replace";
  const occ = buildOccupancy(plot);
  for (const d of layout.plants) {
    const at = occ[cellIndex(d.row, d.col)];
    if (at && at.kindId === d.kindId && at.row === d.row && at.col === d.col && at.origin === d.origin) continue;
    if (!isFootprintFree(occ, d.row, d.col, d.size)) continue;
    const paidSetup = mode === "setup" && ctx.config.bootstrapDebt === true;
    let paid = false;
    if (d.origin === "placed" && (mode !== "setup" || paidSetup) && !isFreePlacedItem(d.kindId, ctx.config)) {
      // Mutation debt: mutation items only (not fermento or dead plants).
      const allowDebt = ctx.config.allowMutationDebt === true && !!ctx.env.data.mutations[d.kindId];
      // Bootstrap debt: the starting layouts are bought on credit (a loan per item).
      const req = { cycle: ctx.cycle, plotId: plot.id, row: d.row, col: d.col, action: `place ${d.kindId}`, replacement, allowDebt, openLoan: paidSetup };
      if (!spend(ctx.state, d.kindId, 1, req, ctx.prices, ctx.emit)) continue;
      paid = true;
    } else if (replacement) {
      ctx.state.summary.replacements += 1;
    } else if (mode === "setup" && d.origin === "placed" && !isFreePlacedItem(d.kindId, ctx.config) && ctx.state.summary.market) {
      // Normal profile: setup stays free, but count what building it would cost (sim/market.ts).
      bump(ctx.state.summary.market.built, d.kindId);
    }
    const p = newPlant(ctx.state, ctx.env.data, ctx.config, d.kindId, d.row, d.col, d.origin, ctx.cycle);
    if (paid && mode !== "setup") markPickup(p, ctx, replacement);
    insertPlant(plot, p);
    for (const idx of footprint(d.row, d.col, d.size)) occ[idx] = p;
    // Setup is built before the run; everything after is the player's work.
    if (mode !== "setup") effort(ctx.state, d.origin === "planted" ? "replant" : "place");
    ctx.emit(plot.id, { kind: "placed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, origin: p.origin, replacement });
  }
}

const matches = (p: PlantState, d: ResolvedLayout["plants"][number]) =>
  p.kindId === d.kindId && p.row === d.row && p.col === d.col && p.size === d.size && p.origin === d.origin;

/** Layout plants by anchor cell (a later plant wins a shared anchor, like `new Map(...)` over the list). Resolved layouts are immutable. */
const anchorMaps = new WeakMap<ResolvedLayout, Map<number, ResolvedLayout["plants"][number]>>();
function layoutAnchors(layout: ResolvedLayout): Map<number, ResolvedLayout["plants"][number]> {
  let m = anchorMaps.get(layout);
  if (!m) {
    m = new Map(layout.plants.map((d) => [cellIndex(d.row, d.col), d]));
    anchorMaps.set(layout, m);
  }
  return m;
}

/**
 * Hybrid flows (`spawnsFillLayoutInputs`): a spawn standing exactly where the
 * layout places the same mutation serves as that input, at any stage.
 */
export function layoutInputAt(p: PlantState, layout: ResolvedLayout, config: SimConfig): boolean {
  if (!config.spawnsFillLayoutInputs || p.origin !== "spawned" || p.isDeadPlant) return false;
  const anchors = layoutAnchors(layout);
  const anchored = anchors.get(cellIndex(p.row, p.col));
  if (anchored && anchored.kindId === p.kindId && anchored.size === p.size) return true;
  // With one layout plant per anchor (resolved layouts never overlap) the anchor lookup is the
  // whole answer; otherwise an earlier plant on the same anchor could still match.
  if (anchors.size === layout.plants.length) return false;
  return layout.plants.some((d) => d.kindId === p.kindId && d.row === p.row && d.col === p.col && d.size === p.size);
}

/**
 * Enter a step. Unless `fullClear`, keep: plants identical to the layout's
 * (kind, anchor, origin) with their timers, spawns serving as layout inputs,
 * and spawns entirely outside the layout's plant cells. Remove the rest, then place.
 */
export function applyStepLayout(
  plot: PlotState,
  layout: ResolvedLayout,
  ctx: CycleCtx,
  scratch: TickScratch,
  fullClear: boolean,
  mode: "setup" | "step" = "step"
): void {
  const keepIdentical = ctx.config.keepIdenticalOnStepChange && !fullClear;
  const desiredAt = layoutAnchors(layout);
  const desiredCells = new Set(layout.plants.flatMap((d) => footprint(d.row, d.col, d.size)));

  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p)) continue;
    const d = desiredAt.get(cellIndex(p.row, p.col));
    if (keepIdentical && d && matches(p, d)) continue;
    if (!fullClear && layoutInputAt(p, layout, ctx.config)) continue;
    const growingOutsideLayout = p.origin === "spawned" && !footprint(p.row, p.col, p.size).some((c) => desiredCells.has(c));
    if (!fullClear && growingOutsideLayout) continue;
    removeByPlayer(plot, p, ctx, scratch, "step change");
  }

  plot.slots = layout.slots.map((s) => ({ ...s }));
  plot.groundTiles = { ...layout.groundTiles };
  plot.groundOverrides = {}; // Chorus ground changes last only within a step
  plot.slotIneligibleCycles = {};
  plot.watchStatus = {};
  closePlotDebts(ctx.state, plot.id);
  // A later step (never setup) skips requirement inputs of targets already holding their mutation.
  const onlyNeeded = mode === "step" && ctx.policiesFor(plot.id).onlyReplaceForEmptyTargets === true;
  placeLayoutPlants(plot, onlyNeeded ? neededLayout(plot, layout, ctx.env.data, ctx.config) : layout, ctx, mode);
}

type LayoutPlant = ResolvedLayout["plants"][number];

/** A slot holds its labelled mutation (growing or fully grown), anchored on it. Same test as `targetsFilled`. */
function slotHoldsTarget(occ: Occupancy, s: SlotLabel): boolean {
  const q = occ[cellIndex(s.row, s.col)];
  return !!q && !q.isDeadPlant && q.kindId === s.mutationId && q.row === s.row && q.col === s.col;
}

/**
 * `onlyReplaceForEmptyTargets`: is this layout plant worth (re-)placing now? A paid placed item
 * (not base crops or free items like fire) that stands in the 8-way ring of one or more targets
 * whose mutation requires its kind is only needed while at least one of those targets is empty
 * (doesn't hold its mutation). Anything that feeds no target is always needed.
 */
export function layoutPlantNeeded(plot: PlotState, d: LayoutPlant, occ: Occupancy, data: GameData, config?: SimConfig): boolean {
  if (d.origin !== "placed" || isFreePlacedItem(d.kindId, config)) return true;
  const cells = footprint(d.row, d.col, d.size);
  let feeds = false;
  for (const s of plot.slots) {
    const m = data.mutations[s.mutationId];
    if (!m || !footprintFits(s.row, s.col, s.size) || !m.requirements.some((r) => r.crop === d.kindId)) continue;
    if (!ringCells(s.row, s.col, s.size).some((c) => cells.includes(c))) continue;
    if (!slotHoldsTarget(occ, s)) return true;
    feeds = true;
  }
  return !feeds;
}

/** The layout, minus the requirement inputs only full targets would use (`layoutPlantNeeded`). */
export function neededLayout(plot: PlotState, layout: ResolvedLayout, data: GameData, config?: SimConfig): ResolvedLayout {
  const occ = buildOccupancy(plot);
  return { ...layout, plants: layout.plants.filter((d) => layoutPlantNeeded(plot, d, occ, data, config)) };
}

/**
 * `placedUpkeep: "replaceBeforeDecay"`: swap each paid placed layout item that `due` says would
 * decay before the next session for a fresh one (new timer and minimum-mutation counters), so its
 * neighbours never lose it. Only when the item is in stock (or buyable on a normal profile): an
 * early swap never records debt or borrows; if it can't be covered the plant is left to decay and
 * `maintain` handles it as usual. Counts as a replacement. No RNG.
 */
export function replacePlacedBeforeDecay(
  plot: PlotState,
  layout: ResolvedLayout,
  ctx: CycleCtx,
  due: (p: PlantState) => boolean
): void {
  const kept = (p: PlantState) => !!ctx.state.scripts && isProtected(ctx.state, plot.id, p.id);
  for (const d of layout.plants) {
    if (d.origin !== "placed" || isFreePlacedItem(d.kindId, ctx.config)) continue;
    const p = buildOccupancy(plot)[cellIndex(d.row, d.col)];
    // A primed Blastberry would explode when broken: leave it to its own decay.
    // One placed this session (`gate.pickup`) is already fresh.
    if (!p || !matches(p, d) || kept(p) || isPrimedBlastberry(p) || p.gate.pickup || !due(p)) continue;
    if ((ctx.state.inventory[d.kindId] ?? 0) < 1 && !canBuy(ctx.state, d.kindId)) continue;
    const req = { cycle: ctx.cycle, plotId: plot.id, row: d.row, col: d.col, action: `replace ${d.kindId} before decay`, replacement: true };
    if (!spend(ctx.state, d.kindId, 1, req, ctx.prices, ctx.emit)) continue;
    removePlant(plot, p);
    effort(ctx.state, "replace");
    ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "replaced before decay" });
    const fresh = newPlant(ctx.state, ctx.env.data, ctx.config, d.kindId, d.row, d.col, "placed", ctx.cycle);
    markPickup(fresh, ctx, true);
    insertPlant(plot, fresh);
    ctx.emit(plot.id, { kind: "placed", plantId: fresh.id, kindId: fresh.kindId, row: fresh.row, col: fresh.col, origin: "placed", replacement: true });
  }
}

/**
 * Clear unwanted Dead Plants, remove spawns blocking layout cells (not layout inputs), re-place what's missing.
 * With `onlyReplaceForEmptyTargets`, requirement inputs whose targets are all full are neither
 * re-placed nor cleared of blocking spawns (`neededLayout`).
 */
export function maintainLayout(plot: PlotState, fullLayout: ResolvedLayout, ctx: CycleCtx, scratch: TickScratch, onlyForEmptyTargets = false): void {
  let layout = fullLayout;
  const desiredAt = layoutAnchors(fullLayout);
  // Plants a script protected (`plant.protect()`) are left alone; no scripts, none.
  const kept = (p: PlantState) => !!ctx.state.scripts && isProtected(ctx.state, plot.id, p.id);
  for (const p of [...plot.plants]) {
    if (!p.isDeadPlant || kept(p)) continue;
    const d = desiredAt.get(cellIndex(p.row, p.col));
    if (d && matches(p, d)) continue; // layout places a dead plant here
    removeByPlayer(plot, p, ctx, scratch, "cleared");
  }

  // After the Dead Plant pass, so a target a mutation decayed out of counts as empty.
  if (onlyForEmptyTargets) layout = neededLayout(plot, fullLayout, ctx.env.data, ctx.config);
  const occ = buildOccupancy(plot);
  for (const d of layout.plants) {
    for (const idx of footprint(d.row, d.col, d.size)) {
      const q = occ[idx];
      if (!q || matches(q, d) || q.origin !== "spawned" || !plot.plants.includes(q) || kept(q)) continue;
      if (layoutInputAt(q, fullLayout, ctx.config)) continue;
      removeByPlayer(plot, q, ctx, scratch, "blocking layout");
    }
  }
  placeLayoutPlants(plot, layout, ctx, "replace");
}
