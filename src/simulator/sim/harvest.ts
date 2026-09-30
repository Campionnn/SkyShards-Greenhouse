import { effectiveList } from "../effects/adapter";
import { bountyFromRoll, ETHEREAL_VINE_BY_RARITY } from "../economy/bounty";
import { valueOf } from "../economy/prices";
import { armorRareCrops, GREENHOUSE_RARE_CROP_CHANCE, overbloomMultiplier, rollRareCount } from "../economy/rareCrops";
import { chloroniteDropCount, farmingFortuneMultiplier, greenhouseYieldSum, harvestYield, jellybeanMultiplier, yieldScaledCount } from "../economy/yield";
import { chance, nextFloat } from "../rng";
import { ALOE_FRAGMENT, aloeRow, FRAGMENTS_PER_ALOE } from "../stage/aloe";
import { uniqueCropYieldBonus } from "../stage/clock";
import type { CycleCtx, TickScratch } from "./context";
import { explode, isPrimedBlastberry } from "./explosion";
import { convertAloeFragments, credit } from "./inventory";
import { JELLYBEAN, removePlant, spawnStageOf } from "./plants";
import { bump, perPlot } from "./summary";
import { ZOMBUD, zombudHarvest } from "./zombud";
import type { PlantState, PlotState } from "./state";

const MINIGAMES: Record<string, "setback" | "destroy"> = {
  plantboy_advance: "setback",
  stoplight_petal: "destroy",
  phantomleaf: "destroy",
};

export type HarvestOutcome = "harvested" | "minigameSetback" | "minigameDestroyed";

function scaleDrops(drops: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item, qty] of Object.entries(drops)) out[item] = qty * factor;
  return out;
}

/**
 * Harvest one plant: drops go to the shared inventory and are valued at NPC
 * price (booked as revenue now). A spawned mutation also drops its own item.
 * Yield uses the effects LATCHED when the plant became fully grown. The plant
 * is removed from the plot; base-crop upkeep replants it straight after.
 */
export function harvestPlant(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch): HarvestOutcome {
  const { data } = ctx.env;
  const rng = ctx.state.rng;
  const isMutation = !!data.mutations[p.kindId];

  // Player minigames: assumed won unless perfectPlay is off.
  const game = p.origin === "spawned" ? MINIGAMES[p.kindId] : undefined;
  if (game && !ctx.config.perfectPlay && chance(rng, ctx.config.minigameFailChance)) {
    if (game === "setback") {
      p.stage = Math.max(spawnStageOf(p.growthStages), p.stage - 3); // never below the stage it spawned at
      p.lockedEffects = null;
      p.fullyGrownAtCycle = null;
      // Its spawn timer keeps running: a setback is not a fresh spawn.
      return "minigameSetback";
    }
    removePlant(plot, p);
    bump(ctx.state.summary.destroyed, p.kindId);
    perPlot(ctx.state.summary, plot.id).destroyed += 1;
    if (p.isRival) ctx.state.summary.rivals.cleared += 1;
    ctx.emit(plot.id, { kind: "destroyed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, by: "minigame" });
    return "minigameDestroyed";
  }

  const effective = new Set(p.lockedEffects ?? effectiveList(p.held));
  const sum = greenhouseYieldSum(effective, ctx.stats.plantYieldUpgrade, uniqueCropYieldBonus(ctx.uniqueCropCount));
  const def = isMutation ? data.mutations[p.kindId] : data.crops[p.kindId];
  // Magic Jellybean: data.json's crop bundle is the stage-12 (x1) amount; the
  // stage multiplier scales the bundle as well as its own item count.
  const jellyMult = p.kindId === JELLYBEAN && p.origin === "spawned" ? jellybeanMultiplier(p.stage, ctx.config.magicJellybeanMultiplierCap) : 1;
  const baseDrops = jellyMult === 1 ? def.drops : scaleDrops(def.drops, jellyMult);
  const drops = harvestYield(baseDrops, farmingFortuneMultiplier(ctx.stats.farmingFortune), sum, ctx.stats.evergreenChip);

  // The mutation's OWN item count is scaled by the greenhouse yield sum only
  // (not Farming Fortune or Evergreen, which are crop-bundle-only): the whole
  // part is guaranteed and the fractional remainder is a single roll for one
  // more. This applies on top of each mutation's own base count (Chloronite's
  // Mining Fortune ladder, Magic Jellybean's stage multiplier, All-in Aloe's
  // fragment table); a "plain" mutation's base count is 1.
  let mutationItems = 0;
  // Zombud / Timestalk: the crop bundle above drops ONCE, on breaking the fully
  // grown mutation; the fight only gives the mutation items below. So a Zombud
  // never gives its bundle more than once, however many mobs spawn.
  if (p.kindId === ZOMBUD && p.origin === "spawned") {
    // 1 Zombud per adjacent Dead Plant (each becomes a mob; fight assumed won),
    // no yield scaling. The player fills empty ring cells first (sim/zombud.ts).
    const items = zombudHarvest(plot, p, ctx);
    if (items > 0) drops[p.kindId] = (drops[p.kindId] ?? 0) + items;
    mutationItems = items;
  } else if (p.kindId === "timestalk" && p.origin === "spawned") {
    // Exactly 1 per harvest (clone fight assumed won), no yield scaling.
    drops[p.kindId] = (drops[p.kindId] ?? 0) + 1;
    mutationItems = 1;
  } else if (p.kindId === "all_in_aloe" && p.origin === "spawned") {
    const baseFragments = aloeRow(p.stage).multiplier;
    const { whole, frac } = yieldScaledCount(baseFragments, sum);
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
    const { whole, frac } = yieldScaledCount(base, sum);
    const items = whole + (frac > 1e-9 && chance(rng, frac) ? 1 : 0);
    if (items > 0) drops[p.kindId] = (drops[p.kindId] ?? 0) + items;
    mutationItems = items;
  }

  // Harvest Bounty (Bonus Drops): its own table, NOT boosted by Overbloom.
  const rareDrops: Record<string, number> = {};
  if (effective.has("bonus_drops")) {
    for (let i = 0; i < ctx.config.bountyRollsPerHarvest; i++) {
      const item = bountyFromRoll(nextFloat(rng));
      if (item) bump(rareDrops, item);
    }
  }
  // Rare Crops: the mutation's own Ethereal Vine chance, then the armor set's
  // tiered-bonus drops (one roll each, every harvest). Overbloom boosts the
  // chance for both. The greenhouse yield sum (Plant Yield upgrade +
  // unique-crop bonus + Harvest Boost/Loss) then additionally scales ONLY the
  // Ethereal Vine count that dropped, exactly like a mutation's own item:
  // whole part guaranteed, fraction rolled for one more. Armor drops
  // (Cropie/Squash/Fermento/Helianthus) are not yield-scaled: the rolled
  // count is used as-is.
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
    const { whole, frac } = yieldScaledCount(dropped, sum);
    const n = whole + (frac > 1e-9 && chance(rng, frac) ? 1 : 0);
    if (n > 0) bump(rareCrops, item, n);
  };
  if (isMutation && p.origin === "spawned") rollRare("ethereal_vine", ETHEREAL_VINE_BY_RARITY[data.mutations[p.kindId].rarity], true);
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
  if (primed) explode(plot, p, ctx); // harvesting breaks it: the item and crops still drop
  void scratch;
  return "harvested";
}
