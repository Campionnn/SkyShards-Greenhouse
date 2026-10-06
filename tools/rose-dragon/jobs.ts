/**
 * THE ROSE DRAGON FLOW DEFINITION (source of truth; `generate.ts` turns it into
 * rose-dragon.flows.json). Each job is a farm: a layout (solved by the local solver
 * from `targets`, or hand-drawn) and the items it is for. A job may be offered on
 * several plots; each plot's "Choose next farm" hub picks, in that plot's priority
 * order, the first job that is WANTED and whose inputs are IN STOCK:
 *
 *   wanted     some product is below its low mark (and a legendary it leads to is not owned yet)
 *   in stock   every input the layout places is in the inventory
 *   satisfied  every product is at its high mark (or every legendary it leads to is owned)
 *              -> the plot goes back to the hub
 *
 * Marks per item (generate.ts `computeMarks`): low = the most any single consumer layout
 * places, high = 1.5 x what every consumer layout places together (+ `extra`). Legendaries: 2.
 */
import type { PolicyOverrides } from "../../src/simulator/flow/types";

export type Special =
  /** Re-place inputs only while no target is growing (Devourer roots destroy them). */
  | "noReplaceWhileGrowing"
  /** Break the Magic Jellybeans at stage `breakStage` instead of waiting for 120. */
  | "jellyBreak"
  /** Place Blastberries + Turtlellini, then clear the plot: the blasts turn the Turtlellini into Shellfruit. */
  | "shellfruitBlast";

export interface JobDef {
  id: string;
  label: string;
  /** Plots offering this job. Plot 2 keeps the unique-crop strip in column 9. */
  plots: (1 | 2 | 3)[];
  targets?: { mutation: string; count: number }[];
  ascii?: { rows: string[]; legend: Record<string, string> };
  /** Items this job exists for (default: its target mutations). */
  produces?: string[];
  special?: Special;
  breakStage?: number;
  timeLimit?: number;
  policies?: PolicyOverrides;
  /** Filler job: left as soon as a farm earlier in the plot's priority list is wanted and in stock. */
  filler?: boolean;
  /** Added to the high mark of these items. */
  extra?: Record<string, number>;
  /**
   * Focus variant of the full job with this id: a smaller layout for a subset of the
   * family's products. The hub prefers it when only its products are short (the other
   * family products are at their low marks), and falls back to it when the full layout
   * is not in stock. A family counts as ONE consumer for demand marks.
   */
  focusOf?: string;
  /** Focus variant only: also use it when the full layout is wanted but not in stock (default true). */
  fallback?: boolean;
  /**
   * Break the (single legendary) target early via a picking step, by how many are already owned:
   * pickStages[n] = growth stage to break at while n are owned. The inputs stay standing
   * and the farm resumes; it leaves once the goal count is owned. (All-in Aloe resets to
   * stage 1 with growing risk past stage 4; the goal needs only a few fragments.)
   */
  pickStages?: number[];
  /**
   * Committed batch, but hand the plot to an earlier farm in the plot's priority list
   * (wanted and in stock) once every product is at its low mark.
   */
  yieldWhenLow?: boolean;
  /**
   * Expandable layout: a starter step uses only the first `startWith` targets (row-major)
   * and the inputs touching their rings. It upgrades in place to the full layout once the
   * extra inputs are in stock; placed inputs and growing targets are kept (identical
   * plants survive the step change), so only the difference is spent.
   */
  startWith?: number;
  /**
   * Enter through a scrub step (base crops on the target cells) that breaks anything
   * inherited on them. Costs one session on every visit and shows base crops on the target
   * cells meanwhile. Normally unnecessary: the simulator's default `clearTargetBlockers`
   * player action breaks other spawns standing on target cells in the entry session.
   */
  scrubOnEntry?: boolean;
}

export const GOAL: Record<string, number> = { all_in_aloe: 2, devourer: 2, glasscorn: 2, phantomleaf: 2, timestalk: 2 };

/** Lowest tier first. A plot's hub tries its jobs in `PLOT_PRIORITY` order. */
export const JOBS: JobDef[] = [
  // Committed batch: runs until every product reaches its high mark (no early handover),
  // so the plot does not leave and come back to Commons as often.
  { id: "commons", label: "Commons farm", plots: [1, 2, 3], targets: [
    { mutation: "ashwreath", count: 6 }, { mutation: "choconut", count: 8 }, { mutation: "dustgrain", count: 4 },
    { mutation: "gloomgourd", count: 4 }, { mutation: "scourroot", count: 6 }, { mutation: "shadevine", count: 4 },
    { mutation: "veilshroom", count: 6 }, { mutation: "witherbloom", count: 6 }] },
  // Focus layouts: whole-plot farms for the products that bind their family. The hub
  // picks one when only its products are below their low marks (see generate.ts).
  { id: "commons-choconut", focusOf: "commons", label: "Choconut + Ashwreath focus (no bought inputs)", plots: [1, 2, 3], targets: [
    { mutation: "choconut", count: 12 }, { mutation: "ashwreath", count: 6 }] },
  { id: "uncommons-dusk", focusOf: "uncommons", label: "Duskbloom + Chocoberry focus", plots: [1, 2, 3], targets: [
    { mutation: "duskbloom", count: 8 }, { mutation: "chocoberry", count: 4 }] },
  { id: "lonelily", label: "Lonelily field (empty farmland)", plots: [2], ascii: { rows: Array(10).fill("ffffffffff"), legend: { f: "~farmland" } }, produces: ["lonelily"] },
  { id: "uncommons", label: "Uncommons farm", plots: [1, 2, 3], yieldWhenLow: true, targets: [
    { mutation: "chocoberry", count: 2 }, { mutation: "cindershade", count: 2 }, { mutation: "coalroot", count: 2 },
    { mutation: "creambloom", count: 2 }, { mutation: "duskbloom", count: 2 }, { mutation: "thornshade", count: 2 }] },
  { id: "rares", label: "Chloronite + Do-not-eat Shroom", plots: [2, 3], targets: [
    { mutation: "chloronite", count: 3 }, { mutation: "do_not_eat_shroom", count: 3 }] },
  // One owner, one committed batch: no competing half-finished Soggybud farms.
  // Spare base crops supply neighbouring water; the player cannot water Soggybud directly.
  { id: "soggybud", label: "Soggybud (Plot 3 batch)", plots: [3], targets: [{ mutation: "soggybud", count: 12 }] },
  { id: "jelly", label: "Magic Jellybean", plots: [3, 2], targets: [{ mutation: "magic_jellybean", count: 4 }], special: "jellyBreak", breakStage: 36 },
  { id: "blast-cheese", label: "Blastberry + Cheesebite + Turtlellini", plots: [3, 1], targets: [
    { mutation: "blastberry", count: 2 }, { mutation: "cheesebite", count: 2 }, { mutation: "turtlellini", count: 2 }] },
  { id: "noct-flesh", label: "Noctilume + Fleshtrap", plots: [2], targets: [{ mutation: "noctilume", count: 2 }, { mutation: "fleshtrap", count: 1 }] },
  { id: "snoozling", label: "Snoozling", plots: [1], targets: [{ mutation: "snoozling", count: 4 }] },
  { id: "thunder", label: "Thunderling", plots: [2], targets: [{ mutation: "thunderling", count: 4 }] },
  { id: "zombud", label: "Zombud", plots: [2], targets: [{ mutation: "zombud", count: 2 }] },
  { id: "puffer", label: "Puffercloud", plots: [1], targets: [{ mutation: "puffercloud", count: 2 }] },
  { id: "petal", label: "Stoplight Petal", plots: [1], targets: [{ mutation: "stoplight_petal", count: 2 }] },
  { id: "plantboy", label: "PlantBoy Advance", plots: [1], targets: [{ mutation: "plantboy_advance", count: 1 }] },
  { id: "startlevine", label: "Startlevine", plots: [3, 1], targets: [{ mutation: "startlevine", count: 2 }] },
  { id: "chorus", label: "Chorus Fruit", plots: [3, 2], targets: [{ mutation: "chorus_fruit", count: 2 }] },
  { id: "shellfruit", label: "Shellfruit (blast Turtlellini)", plots: [3], special: "shellfruitBlast", produces: ["shellfruit"],
    ascii: { rows: [".T.T.", "BTBTB", ".T.T."], legend: { T: "turtlellini", B: "blastberry" } } },
  { id: "devourer", label: "Devourer", plots: [2], targets: [{ mutation: "devourer", count: 1 }], special: "noReplaceWhileGrowing" },
  { id: "glasscorn", label: "Glasscorn", plots: [3, 1], targets: [{ mutation: "glasscorn", count: 1 }] },
  { id: "pt", label: "Phantomleaf + Timestalk", plots: [3, 1], targets: [{ mutation: "phantomleaf", count: 1 }, { mutation: "timestalk", count: 1 }] },
  // Break the Aloe at stage 10 (none owned) / 8 (one owned): each stage past 4 risks a
  // reset to 1, and the goal needs only 18 fragments. Inputs stay; the farm resumes.
  { id: "aloe", label: "All-in Aloe", plots: [3, 2], targets: [{ mutation: "all_in_aloe", count: 1 }], pickStages: [10, 8] },
];

/** Hub order per plot: most advanced first, so a plot works on the highest farm it can. */
export const PLOT_PRIORITY: Record<1 | 2 | 3, string[]> = {
  1: ["glasscorn", "pt", "plantboy", "petal", "puffer", "snoozling", "startlevine", "blast-cheese", "uncommons", "commons"],
  2: ["devourer", "aloe", "zombud", "thunder", "noct-flesh", "chorus", "lonelily", "rares", "jelly", "uncommons", "commons"],
  3: ["aloe", "pt", "glasscorn", "shellfruit", "chorus", "startlevine", "blast-cheese", "jelly", "rares", "soggybud", "uncommons", "commons"],
};
