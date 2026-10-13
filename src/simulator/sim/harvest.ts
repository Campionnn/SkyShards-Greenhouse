import { HARVEST_BOUNTY_ROLLS } from "../config";
import { effectiveList, ensureEffects } from "../effects/adapter";
import { bountyFromRoll, ETHEREAL_VINE_BY_RARITY } from "../economy/bounty";
import { valueOf } from "../economy/prices";
import { armorRareCrops, GREENHOUSE_RARE_CROP_CHANCE, overbloomMultiplier, rollRareCount } from "../economy/rareCrops";
import { chloroniteDropCount, farmingFortuneMultiplier, greenhouseYieldSum, harvestYield, jellybeanMultiplier, yieldScaledCount } from "../economy/yield";
import { chance, nextFloat } from "../rng";
import { ALOE_FRAGMENT, aloeRow, FRAGMENTS_PER_ALOE } from "../growth/aloe";
import { uniqueCropYieldBonus } from "../growth/clock";
import type { CycleCtx, TickScratch } from "./context";
import { explode, isPrimedBlastberry } from "./explosion";
import { convertAloeFragments, credit } from "./inventory";
import { JELLYBEAN, removePlant, yieldEffectsLocked } from "./plants";
import { bump, perPlot } from "./summary";
import { ZOMBUD, zombudHarvest } from "./zombud";
import type { PlantState, PlotState } from "./state";

function scaleDrops(drops: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item, qty] of Object.entries(drops)) out[item] = qty * factor;
  return out;
}

/**
 * Harvest and remove one plant. Drops go to the shared inventory and are
 * booked as revenue at NPC price. Yield uses the effects latched when it
 * became fully grown. A spawned mutation also drops its own item. Harvest
 * minigames (PlantBoy Advance, Stoplight Petal, Phantomleaf) are not modelled:
 * the player is perfect and a failed attempt can be retried on the spot, so
 * they harvest like any other spawn.
 */
export function harvestPlant(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch): void {
  const { data } = ctx.env;
  const rng = ctx.state.rng;
  const isMutation = !!data.mutations[p.kindId];

  const locked = yieldEffectsLocked(p) ? p.lockedEffects : null;
  // Unlocked: the effects it holds right now, after whatever the player did earlier this session.
  if (!locked) ensureEffects(plot, scratch);
  const effective = new Set(locked ?? effectiveList(p.held));
  const sum = greenhouseYieldSum(effective, ctx.stats.plantYieldUpgrade, uniqueCropYieldBonus(ctx.uniqueCropCount));
  const def = isMutation ? data.mutations[p.kindId] : data.crops[p.kindId];
  // Jellybean: data.json bundle is the stage-12 (x1) amount; the stage multiplier scales bundle and item count.
  const jellyMult = p.kindId === JELLYBEAN && p.origin === "spawned" ? jellybeanMultiplier(p.stage) : 1;
  // All-in Aloe: data.json bundle is the x1 amount; the stage multiplier scales it like the fragments (0 below stage 4).
  const aloeMult = p.kindId === "all_in_aloe" && p.origin === "spawned" ? aloeRow(p.stage).multiplier : 1;
  const bundleMult = jellyMult * aloeMult;
  const baseDrops = bundleMult === 1 ? def.drops : scaleDrops(def.drops, bundleMult);
  const drops = harvestYield(baseDrops, farmingFortuneMultiplier(ctx.stats.farmingFortune), sum, ctx.stats.evergreenChip);
  // Patch fix: Plant Yield bonuses no longer apply to mutation items or Ethereal Vine.
  // `legacyMutationYield` restores the old behaviour (yield sum scales them too).
  const itemSum = ctx.config.legacyMutationYield ? sum : 1;

  // Mutation item count = base count (1, or Chloronite/Jellybean/Aloe specifics),
  // never Farming Fortune / Evergreen. Only the legacy setting scales it by the
  // greenhouse yield sum. Whole part guaranteed, fraction rolled once for one more
  // (no roll when the count is whole).
  let mutationItems = 0;
  // Zombud / Timestalk: the crop bundle drops once; the fight gives only the items below.
  if (p.kindId === ZOMBUD && p.origin === "spawned") {
    // 1 per adjacent Dead Plant, no yield scaling (sim/zombud.ts).
    const items = zombudHarvest(plot, p, ctx);
    if (items > 0) drops[p.kindId] = (drops[p.kindId] ?? 0) + items;
    mutationItems = items;
  } else if (p.kindId === "timestalk" && p.origin === "spawned") {
    // Exactly 1, no yield scaling.
    drops[p.kindId] = (drops[p.kindId] ?? 0) + 1;
    mutationItems = 1;
  } else if (p.kindId === "all_in_aloe" && p.origin === "spawned") {
    const baseFragments = aloeRow(p.stage).multiplier;
    const { whole, frac } = yieldScaledCount(baseFragments, itemSum);
    const totalFragments = whole + (frac > 1e-9 && chance(rng, frac) ? 1 : 0);
    const aloes = Math.floor(totalFragments / FRAGMENTS_PER_ALOE);
    const fragments = totalFragments % FRAGMENTS_PER_ALOE;
    if (aloes > 0) drops[p.kindId] = (drops[p.kindId] ?? 0) + aloes;
    if (fragments > 0) drops[ALOE_FRAGMENT] = (drops[ALOE_FRAGMENT] ?? 0) + fragments;
    mutationItems = aloes;
  } else if (isMutation && p.origin === "spawned") {
    let base = 1;
    if (p.kindId === JELLYBEAN) base = jellyMult;
    if (p.kindId === "chloronite") base = chloroniteDropCount(ctx.stats.miningFortune);
    const { whole, frac } = yieldScaledCount(base, itemSum);
    const items = whole + (frac > 1e-9 && chance(rng, frac) ? 1 : 0);
    if (items > 0) drops[p.kindId] = (drops[p.kindId] ?? 0) + items;
    mutationItems = items;
  }

  // Harvest Bounty (bonus_drops): own table, not boosted by Overbloom.
  const rareDrops: Record<string, number> = {};
  if (effective.has("bonus_drops")) {
    for (let i = 0; i < HARVEST_BOUNTY_ROLLS; i++) {
      const item = bountyFromRoll(nextFloat(rng));
      if (item) bump(rareDrops, item);
    }
  }
  // Rare crops: Ethereal Vine (spawned mutations), then armor-set drops, one roll
  // each, chance boosted by Overbloom. Used as rolled; only the legacy setting
  // yield-scales the Ethereal Vine count like a mutation item. Roll order matters for RNG.
  const rareCrops: Record<string, number> = {};
  const bloom = overbloomMultiplier(ctx.stats.overbloom);
  const cap = ctx.config.capRareCropChance;
  const rollRare = (item: string, baseChance: number, applyYieldScaling: boolean) => {
    const dropped = rollRareCount(rng, baseChance * bloom, cap);
    if (dropped <= 0) return;
    if (!applyYieldScaling) {
      bump(rareCrops, item, dropped);
      return;
    }
    const { whole, frac } = yieldScaledCount(dropped, itemSum);
    const n = whole + (frac > 1e-9 && chance(rng, frac) ? 1 : 0);
    if (n > 0) bump(rareCrops, item, n);
  };
  if (isMutation && p.origin === "spawned") rollRare("ethereal_vine", ETHEREAL_VINE_BY_RARITY[data.mutations[p.kindId].rarity], !!ctx.config.legacyMutationYield);
  for (const item of armorRareCrops(ctx.stats.armorSet, ctx.config.armorRareCropBug)) rollRare(item, GREENHOUSE_RARE_CROP_CHANCE[item], false);
  for (const [item, qty] of Object.entries(rareDrops)) drops[item] = (drops[item] ?? 0) + qty;
  for (const [item, qty] of Object.entries(rareCrops)) drops[item] = (drops[item] ?? 0) + qty;

  for (const [item, qty] of Object.entries(drops)) credit(ctx.state, item, qty);
  const converted = convertAloeFragments(ctx.state);
  if (converted > 0) ctx.emit(plot.id, { kind: "converted", from: ALOE_FRAGMENT, to: "all_in_aloe", count: converted });

  const coinValue = valueOf(drops, ctx.prices);
  const rareValue = valueOf(rareDrops, ctx.prices);
  const rareCropValue = valueOf(rareCrops, ctx.prices);
  const itemValue = mutationItems > 0 ? mutationItems * ctx.prices.price(p.kindId) : 0;
  const summary = ctx.state.summary;
  summary.revenue.rareDrops += rareValue;
  summary.revenue.rareCrops += rareCropValue;
  summary.revenue.mutationItems += itemValue;
  summary.revenue.crops += coinValue - rareValue - rareCropValue - itemValue;
  for (const [item, qty] of Object.entries(rareCrops)) bump(summary.rareCrops, item, qty);
  bump(summary.harvested, p.kindId);
  const pp = perPlot(summary, plot.id);
  pp.harvested += 1;
  pp.revenue += coinValue;
  if (p.isRival) summary.rivals.cleared += 1;

  ctx.emit(plot.id, {
    kind: "harvested",
    plantId: p.id,
    kindId: p.kindId,
    row: p.row,
    col: p.col,
    origin: p.origin,
    drops,
    coinValue,
    rival: p.isRival,
  });
  const primed = isPrimedBlastberry(p);
  removePlant(plot, p);
  if (primed) explode(plot, p, ctx); // drops are kept
}
