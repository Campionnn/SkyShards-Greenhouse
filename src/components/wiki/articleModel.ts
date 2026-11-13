// The wiki article's model (research/wiki-v2, the G3 mockup ported): item lookups, the recipe, the static
// requirement picture, the facts, the crafting tree outline, and the two-column balance. Pure helpers and
// one hook; components live in the .tsx files beside it. Shared with the page chrome (WikiPage / nav).
//
// Every helper that only reads data.json takes a `DataSource`: the WikiData from useWikiData() /
// useWikiLookups(), or the raw GreenhouseDataJSON. usedInOf needs the usedIn map, so it takes a WikiLookup.
import { useLayoutEffect, useState } from "react";
import type { CropDataJSON, GreenhouseDataJSON, MutationDataJSON } from "../../services/greenhouseDataService";
import { getRecipeSource } from "../../wiki/recipes";
import type { WikiEntry } from "../../wiki/slugs";
import { getRarityTextColor } from "../../utilities/rarity";
import { requirementLayout as layoutOf, type RequirementLayout } from "../../utilities/requirementLayout";

export type { RequirementLayout, RingCell, BigPiece } from "../../utilities/requirementLayout";
export { ringCells } from "../../utilities/requirementLayout";

/** An item's footprint (1 for ids that aren't items). */
const sizeIn = (data: GreenhouseDataJSON) => (id: string) => data.mutations[id]?.size ?? data.crops[id]?.size ?? 1;

/** data.json, or anything that carries it (WikiData). */
export type DataSource = GreenhouseDataJSON | { data: GreenhouseDataJSON };
/** data.json plus the "used in" map (WikiData has both). */
export interface WikiLookup {
  data: GreenhouseDataJSON;
  usedIn: Map<string, string[]>;
}

const dataOf = (src: DataSource): GreenhouseDataJSON => ("data" in src ? src.data : src);

/** A crop or a mutation, flattened: the shared fields, plus `mutation` (null for crops) and the crop `notes`. */
export type Item = Omit<CropDataJSON, "notes"> & { id: string; mutation: MutationDataJSON | null; notes: string | null };

export function itemOf(src: DataSource, id: string): Item | null {
  const data = dataOf(src);
  const m = data.mutations[id];
  const c = data.crops[id];
  if (m) return { ...m, id, mutation: m, notes: null };
  if (c) return { ...c, id, mutation: null, notes: c.notes ?? null };
  return null;
}

/** A crop or a mutation (wheat's `seeds` drop is not: no page, no link). */
export const isItem = (src: DataSource, id: string) => !!(dataOf(src).mutations[id] || dataOf(src).crops[id]);

/** Display name: the data name, or the humanised id for things that are not items (`seeds` → "Seeds"). */
export function nameOf(src: DataSource, id: string): string {
  const data = dataOf(src);
  return data.mutations[id]?.name ?? data.crops[id]?.name ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mutation rarity, or null for base crops (and non-items). */
export const rarityOf = (src: DataSource, id: string): string | null => dataOf(src).mutations[id]?.rarity ?? null;

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "soul_sand" → "Soul Sand". */
export const groundName = (g: string) => g.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Rarity colour, the rule (decisions.md G3): ONLY the item's own title (the page h1, the dialog h2). Every
 * other item name is neutral; the rarity is said by group headings or the link's tooltip (`kindOf`). Base
 * crops are never coloured.
 */
export const rarityClass = (rarity: string | null) => (rarity ? getRarityTextColor(rarity) : "text-fg");

/** "Uncommon mutation" / "Base crop": an item link's tooltip, and the title row's pill. */
export function kindOf(src: DataSource, id: string): string {
  const r = rarityOf(src, id);
  return r ? `${capitalise(r)} mutation` : dataOf(src).crops[id] ? "Base crop" : "Item";
}

// ---- Groups (shared with the nav) ---------------------------------------------------------------------

/** Index group of an entry: "base-crops", or the mutation's rarity ("rare"); also the /wiki#<key> anchor. */
export const groupKeyOf = (e: Pick<WikiEntry, "type" | "rarity">) => (e.type === "crop" ? "base-crops" : (e.rarity ?? "other"));
export const groupTitleOf = (key: string) => (key === "base-crops" ? "Base crops" : capitalise(key));

// ---- The recipe -----------------------------------------------------------------------------------------

export interface Need {
  id: string;
  /**
   * How many plants it takes; null: a special ingredient (Shellfruit's Turtlellini and Blastberry), not
   * placed around it. Differs from `cells` for a multi-cell ingredient: Plantboy Advance needs 6 ring cells
   * of Snoozling, which 2 Snoozlings (3×3) cover.
   */
  count: number | null;
  /** How many of the cells around it it must fill (data.json's count; the game counts cells). */
  cells: number | null;
}

export interface Recipe {
  needs: Need[];
  /** The special rule in words (Lonelily, Godseed, Jerryflower, Shellfruit), else null. */
  note: string | null;
  /** data.json's `special` key, else null. */
  special: string | null;
}

export function recipeOf(src: DataSource, id: string): Recipe {
  const data = dataOf(src);
  const m = data.mutations[id];
  if (!m) return { needs: [], note: null, special: null };
  const source = getRecipeSource(data, id);
  const raw: Need[] = m.requirements.map((r) => ({ id: r.crop, count: r.count, cells: r.count }));
  const plants = raw.length ? requirementLayout(data, m.size, raw).plants : {};
  const needs: Need[] = raw.map((n) => ({ ...n, count: plants[n.id] ?? n.cells }));
  for (const extra of source.ingredients) if (!needs.some((n) => n.id === extra)) needs.push({ id: extra, count: null, cells: null });
  return { needs, note: source.note, special: m.special ?? null };
}

/** "×2" for plants; for a multi-cell ingredient also the cells they fill, for a tooltip. */
export function needTitle(src: DataSource, n: Need, around = "around it"): string {
  const name = nameOf(src, n.id);
  return n.cells != null && n.count !== n.cells ? `${n.count} ${name}, covering ${n.cells} of the cells ${around}` : `${n.count} ${name} ${around}`;
}

/** A short form of the special rule (index cards). */
export function specialShort(special: string | null): string | null {
  switch (special) {
    case "requires_zero_adjacent":
      return "Nothing around it";
    case "all_positive_crop_effects":
      return "All its effects from neighbours";
    case "grow_the_jerryseed":
      return "Grown from a Jerryseed";
    case "explode_turtlellini_with_blastberry":
      return "Exploded by Blastberry";
    default:
      return special ? "Special" : null;
  }
}

export interface UsedIn {
  id: string;
  /** How many of this item that mutation needs; null for a special ingredient. */
  count: number | null;
}

/** The mutations that need `id`, sorted by name (buildUsedInMap), each with how many of it they need. */
export function usedInOf(w: WikiLookup, id: string): UsedIn[] {
  return (w.usedIn.get(id) ?? []).map((m) => ({ id: m, count: recipeOf(w, m).needs.find((n) => n.id === id)?.count ?? null }));
}

// ---- The static requirement picture ---------------------------------------------------------------------

/** The picture's geometry (src/utilities/requirementLayout), with sizes from data.json. */
export function requirementLayout(src: DataSource, targetSize: number, needs: Need[]): RequirementLayout {
  return layoutOf(sizeIn(dataOf(src)), targetSize, needs);
}

/**
 * "Chloronite with 6 Coalroot and 2 Thornshade around it"; a multi-cell ingredient says its plants and the
 * cells they cover ("2 Snoozling covering 6 cells"): the picture's accessible name.
 */
export function ringSentence(src: DataSource, id: string, needs: Need[]): string {
  const list = needs
    .filter((n) => n.count !== null)
    .map((n) => (n.cells != null && n.cells !== n.count ? `${n.count} ${nameOf(src, n.id)} covering ${n.cells} cells` : `${n.count} ${nameOf(src, n.id)}`));
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : (list[0] ?? "nothing");
  return `${nameOf(src, id)} with ${joined} around it`;
}

/**
 * What the picture shows: a ring of ingredients; an empty ring (Lonelily: nothing may stand around it); an
 * "any" ring (Godseed: any crops, as long as together they give all its effects); or none (crops,
 * Jerryflower, Shellfruit: no layout to draw).
 */
export function pictureKind(src: DataSource, id: string): "ring" | "empty-ring" | "any-ring" | null {
  const m = dataOf(src).mutations[id];
  if (!m) return null;
  if (m.requirements.length) return "ring";
  if (m.special === "requires_zero_adjacent") return "empty-ring";
  if (m.special === "all_positive_crop_effects") return "any-ring";
  return null;
}

export function pictureCaption(src: DataSource, id: string): string | null {
  const m = dataOf(src).mutations[id];
  const kind = pictureKind(src, id);
  if (!m || !kind) return null;
  const ring = 4 * m.size + 4;
  if (kind === "empty-ring") return `All ${ring} cells around it empty`;
  if (kind === "any-ring") return `Any crops around it that give all ${m.positive_buffs.length} of its effects`;
  const filled = m.requirements.reduce((s, r) => s + r.count, 0);
  return filled >= ring ? `Fills all ${ring} cells around it` : `${filled} of the ${ring} cells around it`;
}

// ---- Facts ------------------------------------------------------------------------------------------------

export const DECAY_RULE =
  "It can only decay once its timer has run out and it has helped create this many mutations; until then the timer extends by 24h. Fully grown plants of the same kind on a plot share the count.";

export const WATER_RULE =
  "Requires water while growing. A plant that dries out halts: it stops growing, gives no effects and doesn't count for mutations or unique crops until it is watered. It no longer dies. Water Retain crops nearby help.";

export interface FactRow {
  key: "size" | "ground" | "water" | "growth" | "decay" | "min";
  label: string;
  value: string;
  /** Ground texture beside the value. */
  ground?: string;
  /** The ? hint (water rule, decay rule). */
  hint?: { title: string; text: string };
  title?: string;
}

/**
 * The fact grid's rows (the approved labels): Size, Ground, Water (mutations: Needed / Not needed), Growth
 * ("Instant" for 0 stages; hidden when the data has none: fire, dead plant, fermento), Decay ("Never" for
 * 0), Min. mutations (Infinite / None / n; the decay rule as its ? hint only when it applies: decay > 0 and
 * a numeric minimum, W34).
 */
export function factsOf(item: Item): FactRow[] {
  const rows: FactRow[] = [
    { key: "size", label: "Size", value: `${item.size}×${item.size}` },
    { key: "ground", label: "Ground", value: groundName(item.ground), ground: item.ground },
  ];
  if (item.mutation)
    rows.push(
      item.mutation.requires_watering
        ? { key: "water", label: "Water", value: "Needed", hint: { title: "Water", text: WATER_RULE } }
        : { key: "water", label: "Water", value: "Not needed", title: "Does not need water to grow" },
    );
  if (item.growth_stages !== null)
    rows.push(
      item.growth_stages === 0
        ? { key: "growth", label: "Growth", value: "Instant", title: "Spawns fully grown (0 growth stages)" }
        : { key: "growth", label: "Growth", value: `${item.growth_stages} stage${item.growth_stages === 1 ? "" : "s"}` },
    );
  if (item.decay !== undefined) rows.push({ key: "decay", label: "Decay", value: item.decay > 0 ? `${item.decay} day${item.decay === 1 ? "" : "s"}` : "Never" });
  const min = item.minimum_mutations;
  if (min !== undefined) {
    const value = min === "infinite" ? "Infinite" : min === null ? "None" : String(min);
    const applies = (item.decay ?? 0) > 0 && typeof min === "number";
    rows.push({ key: "min", label: "Min. mutations", value, hint: applies ? { title: "Decay and min. mutations", text: DECAY_RULE } : undefined });
  }
  return rows;
}

// ---- The crafting tree ---------------------------------------------------------------------------------------

export interface TreeNode {
  /** Unique path ("devourer/zombud/fleshtrap"): the key and the fold handle. */
  path: string;
  id: string;
  /** 0 = a direct ingredient (level 1). */
  depth: number;
  count: number | null;
  /** It has ingredients of its own. */
  expandable: boolean;
  /** Its ingredients were already listed higher up: "see above" points at that node's path. */
  seeAbove: string | null;
  /** A cycle back to an ancestor (cut). */
  cycle: boolean;
  /** Its ingredients, listed here (empty for a repeat, a cycle or a base crop). */
  children: TreeNode[];
}

/**
 * Every ingredient below `root`, depth first, each mutation expanded the first time it appears; a repeat
 * says "see above" (with the path of its first appearance) instead of repeating its whole subtree.
 */
export function treeOutline(src: DataSource, root: string): TreeNode[] {
  const firstAt = new Map<string, string>();
  const walk = (id: string, path: string, depth: number, ancestors: Set<string>): TreeNode[] =>
    recipeOf(src, id).needs.map((need) => {
      const childPath = `${path}/${need.id}`;
      const expandable = recipeOf(src, need.id).needs.length > 0;
      const cycle = ancestors.has(need.id);
      const seen = expandable && !cycle ? (firstAt.get(need.id) ?? null) : null;
      const node: TreeNode = { path: childPath, id: need.id, depth, count: need.count, expandable, seeAbove: seen, cycle, children: [] };
      if (expandable && !cycle && !seen) {
        firstAt.set(need.id, childPath);
        node.children = walk(need.id, childPath, depth + 1, new Set(ancestors).add(need.id));
      }
      return node;
    });
  return walk(root, root, 0, new Set([root]));
}

/** Every node, depth first. */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** A node that can fold: it lists its own ingredients here (not a repeat, not a cycle). */
export const canFold = (n: TreeNode) => n.children.length > 0;

/** The default view: levels 1 and 2 shown, everything deeper folded (decisions.md G2). */
export const foldedByDefault = (nodes: TreeNode[]) => new Set(flattenTree(nodes).filter((n) => n.depth >= 1 && canFold(n)).map((n) => n.path));

// ---- Details: which sections, and two balanced columns ------------------------------------------------------------

/** Long tables show this many rows until "Show all N rows". */
export const TABLE_LIMIT = 8;

export type DetailKey = "growing" | "harvest" | "notes" | "effects" | "drops" | "tree";

/**
 * The detail sections an item has, in reading order. Empty ones are left out (no Effects on fire or
 * jerryflower, no Base yield on fire); a mutation without drops keeps Drops ("Drops nothing when harvested"
 * is the answer there). The tree only when it goes deeper than the band (an ingredient with its own recipe).
 */
export function detailKeys(src: DataSource, item: Item): DetailKey[] {
  const m = item.mutation;
  const keys: DetailKey[] = [];
  if (m?.growing_info) keys.push("growing");
  if (m?.harvest_info) keys.push("harvest");
  if (item.notes) keys.push("notes");
  if (item.positive_buffs.length + item.negative_buffs.length) keys.push("effects");
  if (m || Object.keys(item.drops ?? {}).length) keys.push("drops");
  if (recipeOf(src, item.id).needs.some((n) => recipeOf(src, n.id).needs.length > 0)) keys.push("tree");
  return keys;
}

/** Rough height (px) of each section in a column `col` px wide: prose lines, table rows, list rows, visible tree rows. */
export function estimateHeights(item: Item, col: number, tree: TreeNode[], folded: Set<string>): Record<DetailKey, number> {
  const head = 44;
  const prose = (text: string) => Math.ceil((text.length * 6.4) / Math.min(col, 600)) * 21;
  const m = item.mutation;
  const t = m?.harvest_table;
  const tableRows = t ? (t.rows.length > TABLE_LIMIT + 2 ? TABLE_LIMIT + 1.2 : t.rows.length) : 0;
  const effects = item.positive_buffs.length + item.negative_buffs.length;
  const groups = Number(item.positive_buffs.length > 0) + Number(item.negative_buffs.length > 0);
  const drops = Object.keys(item.drops ?? {}).length;
  const dropRows = drops > 6 && col >= 416 ? Math.ceil(drops / 2) : Math.max(1, drops);
  const visible = flattenTree(tree).filter((n) => ![...folded].some((f) => n.path.startsWith(`${f}/`))).length;
  return {
    growing: head + prose(m?.growing_info ?? ""),
    harvest: head + prose(m?.harvest_info ?? "") + (t ? 12 + 22 + 26 + tableRows * 27 : 0),
    notes: head + prose(item.notes ?? ""),
    effects: head + groups * 22 + effects * 44 + Math.max(0, groups - 1) * 12,
    drops: head + dropRows * 33,
    tree: head + 30 + visible * 28,
  };
}

/**
 * Split the sections into two columns, each keeping the reading order, so the taller column is as short as
 * possible (no hole under the shorter one), Drops kept high (it's part of the answer), and the first section
 * always top-left so the page reads from there. Tries every split (≤ 6 sections: 64 ways).
 */
export function balanceColumns(keys: DetailKey[], h: Record<DetailKey, number>): [DetailKey[], DetailKey[]] {
  const gap = 24;
  let best: { cost: number; l: DetailKey[]; r: DetailKey[] } | null = null;
  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const l = keys.filter((_, i) => !(mask & (1 << i)));
    const r = keys.filter((_, i) => mask & (1 << i));
    const sum = (ks: DetailKey[]) => ks.reduce((s, k) => s + h[k], 0) + Math.max(0, ks.length - 1) * gap;
    const col = l.includes("drops") ? l : r;
    const at = col.indexOf("drops");
    const aboveDrops = at > 0 ? sum(col.slice(0, at)) + gap : 0;
    const cost = Math.max(sum(l), sum(r)) + 0.35 * aboveDrops + (r.includes("drops") ? 0 : 1) + (l.length === 0 || r.length === 0 || l[0] !== keys[0] ? 1e6 : 0);
    if (!best || cost < best.cost) best = { cost, l, r };
  }
  return best ? [best.l, best.r] : [keys, []];
}

// ---- Hooks -----------------------------------------------------------------------------------------------------

/** An element's own width (the two-column choice; everything else adapts with container queries). */
export function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = () => setW(el.clientWidth);
    u();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(u);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
