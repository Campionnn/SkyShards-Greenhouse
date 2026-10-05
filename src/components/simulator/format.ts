import {
  defaultGameData,
  describeDebt,
  describeSpotFailure,
  describeCondition,
  describeConditions,
  describeTrigger,
  isHarvestableCrop,
  npcPriceSource,
  RARE_CROP_ITEMS,
  RARE_DROP_ITEMS,
  type KindDef,
  type SpotReport,
  type TimedEvent,
} from "../../simulator";
import { sortByRarity } from "../../utilities/rarity";

const data = defaultGameData();

/** Names for ids that are not in data.json. */
const EXTRA_NAMES: Record<string, string> = {
  all_in_aloe_fragment: "All-in Aloe Fragment",
  devourer_root: "Devourer Root",
};

/** Display name for any item or plant id. */
export function nameOf(id: string): string {
  return (
    data.crops[id]?.name ??
    data.mutations[id]?.name ??
    EXTRA_NAMES[id] ??
    id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Icon id for a standing plant: a Turtlellini that took a Blastberry hit shows cracked. */
export function plantIconOf(p: { kindId: string; gate: { exploded?: number } }): string {
  return p.kindId === "turtlellini" && (p.gate.exploded ?? 0) >= 1 ? "cracked_turtlellini" : p.kindId;
}

/** The crop or mutation definition for an id, if it is one. */
export function kindData(id: string): KindDef | undefined {
  return data.crops[id] ?? data.mutations[id];
}

export function groundOf(id: string): string {
  return data.crops[id]?.ground ?? data.mutations[id]?.ground ?? "farmland";
}

export function isMutationId(id: string): boolean {
  return !!data.mutations[id];
}

export function rarityOf(id: string): string | undefined {
  return data.mutations[id]?.rarity;
}

/** 64.9M, 216k, 1,234. */
export function formatCoins(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(0)}k`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString();
}

/** A per-day rate: whole numbers when large, 2 significant decimals when small (0.43, 0.012). */
export function formatRate(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  if (n <= 0) return "0";
  return n.toPrecision(2);
}

/** Simulated seconds as "3d 4h" / "5h 12m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export { describeCondition, describeConditions, describeTrigger };
export const debtText = (d: Parameters<typeof describeDebt>[0]) => describeDebt(d, nameOf);
export const spotFailureText = (s: SpotReport) => describeSpotFailure(s, nameOf);

/** A remaining-mutations count as text: "∞", "none", or the number. */
export function formatRemaining(r: number | "infinite" | null): string {
  if (r === "infinite") return "∞";
  if (r === null) return "none";
  return formatCount(r);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Why a decay timer was extended, for `decayExtended`. */
function describeRemaining(own: number | "infinite" | null, combined: number | "infinite" | null): string {
  if (combined !== null) {
    if (combined === "infinite") return "its kind's shared pool never runs out";
    return `its kind still has ${formatCount(combined)} ${plural(combined, "mutation", "mutations")} left to help create (shared pool)`;
  }
  if (own === "infinite") return "it never runs out of mutations to help create";
  if (typeof own === "number") return `it has ${formatCount(own)} ${plural(own, "mutation", "mutations")} left to help create`;
  return "its minimum is not met";
}

/** One sentence per event, for the recent-events log. The switch is exhaustive: a new event kind fails the typecheck here. */
export function describeEvent(e: TimedEvent): string {
  const at = "row" in e ? ` at (${e.row},${e.col})` : "";
  switch (e.kind) {
    case "spawned":
      return `${nameOf(e.mutationId)} spawned${at}${e.rival ? ` - a rival in the ${nameOf(e.slotTarget ?? "")} slot` : ""}`;
    case "harvested": {
      const items = Object.entries(e.drops)
        .map(([item, qty]) => `${formatCount(qty)} ${nameOf(item)}`)
        .join(", ");
      return `Harvested ${nameOf(e.kindId)}${at}: ${items || "nothing"} (${formatCoins(e.coinValue)} coins)`;
    }
    case "decayed": {
      // A decaying dead plant leaves nothing; the player re-places the layout's own from stock.
      if (e.kindId === "dead_plant") return `${nameOf(e.kindId)} decayed${at}`;
      // A decaying spawned Zombud turns its ring's dead plants into mobs.
      const mobs = e.drops ? Object.values(e.drops).reduce((a, b) => a + b, 0) : 0;
      if (mobs > 0) {
        return `${nameOf(e.kindId)} decayed${at} and left a Dead Plant; ${formatCount(mobs)} adjacent Dead ${plural(mobs, "Plant", "Plants")} became Zombud mobs (${formatCount(mobs)} ${nameOf(e.kindId)}, ${formatCoins(e.coinValue ?? 0)} coins)`;
      }
      return `${nameOf(e.kindId)} decayed${at} and left a Dead Plant`;
    }
    case "decayExtended":
      return `${nameOf(e.kindId)}'s decay timer ran out${at} but ${describeRemaining(e.mutatesRemaining, e.combined)} - extended 24h`;
    case "driedOut":
      return `${nameOf(e.kindId)} dried out${at}: halted until watered (no growth, no effects given, not counted for mutations or unique crops)`;
    case "destroyed":
      return `${nameOf(e.kindId)} destroyed${at} by ${e.by}`;
    case "placed":
      return `${e.replacement ? "Re-placed" : "Placed"} ${nameOf(e.kindId)}${at}${e.origin === "placed" && e.replacement ? " from inventory" : ""}`;
    case "removed":
      return `${e.reason === "cleared dead plant" ? "Cleared a Dead Plant" : e.reason === "cleared root" ? "Broke a Devourer root" : `Removed ${nameOf(e.kindId)}`}${at}`;
    case "groundFixed":
      return `Fixed the ground${at} for ${nameOf(e.mutationId)}: ${e.from ? nameOf(e.from) : "air"} -> ${nameOf(e.to)}`;
    case "teleported":
      return `${nameOf(e.kindId)} teleported (${e.fromRow},${e.fromCol}) -> (${e.row},${e.col}), End Stone left behind`;
    case "debt":
      return `Short of ${nameOf(e.item)}${at}: needed ${e.needed}, had ${e.available}`;
    case "borrowed":
      return `Placed ${nameOf(e.item)}${at} on mutation debt: borrowed ${formatCount(e.qty)}, stock now ${formatCount(e.stock)}`;
    case "stepChanged":
      return `Step "${e.fromStep}" -> "${e.toStep}"${e.skipped?.length ? ` (skipped ${e.skipped.map((s) => `"${s}"`).join(", ")}: exits already met)` : ""}`;
    case "fullyGrown":
      return `${nameOf(e.kindId)} fully grown${at}`;
    case "growthBlocked":
      return `${nameOf(e.kindId)} not growing: ${e.gate}`;
    case "growthSkipped":
      return `${nameOf(e.kindId)} skipped a stage (${e.reason})`;
    case "advanced":
      return `${nameOf(e.kindId)} reached stage ${e.stage}`;
    case "playerSession":
      return "Player online";
    case "reset":
      return `${nameOf(e.kindId)}${at} reset from stage ${e.fromStage} to stage 1`;
    case "exploded":
      return `Blastberry exploded${at}`;
    case "rootSpread":
      return `A Devourer root grew into (${e.row},${e.col})`;
    case "converted":
      return `${e.count * 9} ${nameOf(e.from)}s combined into ${e.count} ${nameOf(e.to)}`;
  }
}

/** Every item a trigger or the inventory can name. */
export function allItemIds(): string[] {
  // All-in Aloe Fragments are not offered: they only ever turn into All-in Aloe (9 at a time).
  const extra = [...RARE_CROP_ITEMS, ...RARE_DROP_ITEMS].filter((i) => !data.crops[i] && !data.mutations[i]);
  return [...data.cropIds, ...MUTATION_IDS_BY_RARITY, "seeds", ...new Set(extra)];
}

export type ItemCategory = "mutation" | "crop" | "rareCrop" | "other";

/**
 * Inventory group: mutations; base crops and seeds; Rare Crops (armor bonus drops and Ethereal
 * Vine, Overbloom-boosted); other (Harvest Bounty drops, Dead Plants, fire, fragments).
 */
export function itemCategory(id: string): ItemCategory {
  if (data.mutations[id]) return "mutation";
  if (RARE_CROP_ITEMS.includes(id)) return "rareCrop";
  if (id === "seeds" || isHarvestableCrop(data, id)) return "crop";
  return "other";
}

/** NPC price of an item (wiki NPC sell price; mutation items 0). */
export function npcPriceFor(): (id: string) => number {
  const src = npcPriceSource(data);
  return (id) => src.price(id);
}

// Display lists only: grouped by rarity. The engine keeps data.mutationIds in data.json order
// (spawn-roll order), which appends Turtellini and Zombud after the epics.
const MUTATION_IDS_BY_RARITY = sortByRarity(data.mutationIds, (id) => data.mutations[id].rarity);

export const ALL_MUTATION_IDS = MUTATION_IDS_BY_RARITY;
export const ALL_KIND_IDS = [...data.cropIds, ...MUTATION_IDS_BY_RARITY];
