import type { ItemId } from "../../simulator/data/types";
import { derivedSeed } from "../../simulator/rng";
import type { Scenario } from "../../simulator/sim/state";
import { parseSubmission, ruleScenario, type Submission } from "../rules";
import type { TierId } from "../tiers";
import builderFile from "./builder.flows.json";

/**
 * The starting-items builder (docs/plans/leaderboard-v3.md §3.2): a frozen copy of the site's
 * Rose Dragon flow (`builder.flows.json`, see README.md for its commit) whose goal is swapped for
 * a flow's starting items (its kit). The "from nothing" score runs it from an empty inventory
 * until it owns the kit, then runs the flow with exactly the kit (verify.ts runIronman).
 *
 * Frozen on purpose: the live flow keeps being tuned, and every change here changes
 * ENGINE_VERSION and re-verifies every entry.
 */

/** Where the frozen copy came from. */
export const BUILDER_SOURCE = {
  file: "public/greenhouse/flows/rose-dragon.flows.json",
  /** The commit that last changed that file when it was copied (git log -1 -- <file>). */
  commit: "5b8e3de3134b80f72d9d99293b5cee58915d8669",
} as const;

/** A flow's starting items: whole units per mutation item. */
export type Kit = Record<ItemId, number>;

/** `kit[item] = ceil(startItems[item])` (finite, positive values only), in a stable (sorted) key order. */
export function kitOf(startItems: Readonly<Record<ItemId, number>> | null | undefined): Kit {
  const kit: Kit = {};
  if (!startItems) return kit;
  for (const item of Object.keys(startItems).sort()) {
    const n = startItems[item];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) continue;
    const whole = Math.ceil(n - 1e-9);
    if (whole > 0) kit[item] = whole;
  }
  return kit;
}

export const kitEmpty = (kit: Readonly<Kit>): boolean => Object.keys(kit).length === 0;

/** Whether an inventory holds the whole kit. */
export function ownsKit(inventory: Readonly<Record<ItemId, number>>, kit: Readonly<Kit>): boolean {
  for (const item in kit) if ((inventory[item] ?? 0) < kit[item]) return false;
  return true;
}

/** Families the builder may farm on several plots at once (KNOBS.single without "jelly"). */
const DROP_SINGLE = "jelly";

// The two generated lines of every plot script the builder rewrites (each a single line of JSON).
const D_LINE = /^const D = (\{.*\});$/m;
const KNOBS_LINE = /^const KNOBS = (\{.*\});$/m;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** The `D` and `KNOBS` objects of one builder script; throws when a line is missing or isn't JSON. */
export function readBuilderLines(source: string): { D: Json; KNOBS: Json } {
  const d = D_LINE.exec(source);
  const k = KNOBS_LINE.exec(source);
  if (!d) throw new Error("builder script: no `const D = {...};` line");
  if (!k) throw new Error("builder script: no `const KNOBS = {...};` line");
  const D = JSON.parse(d[1]) as unknown;
  const KNOBS = JSON.parse(k[1]) as unknown;
  if (!isRecord(D) || !isRecord(D.goal) || !isRecord(D.legendaries) || !isRecord(D.low) || !isRecord(D.high)) throw new Error("builder script: `D` lacks goal / legendaries / low / high");
  if (!isRecord(KNOBS) || !Array.isArray(KNOBS.single)) throw new Error("builder script: `KNOBS` lacks single");
  return { D, KNOBS };
}

/**
 * One builder plot script with its goal swapped for `kit`:
 * - `D.goal` = the kit; `D.legendaries` = the kit's legendaries (with the kit's counts);
 * - `D.low[item]` / `D.high[item]` raised to at least the kit (without it the builder stops
 *   farming an item below the kit and some runs never finish);
 * - `KNOBS.single` without "jelly" (Jellybeans may farm on several plots: a big Jellybean kit
 *   takes half the time).
 * Everything else in the script is untouched.
 */
export function rewriteBuilderScript(source: string, kit: Readonly<Kit>): string {
  const { D, KNOBS } = readBuilderLines(source);
  const legendaries = D.legendaries as Record<string, number>;
  const low = { ...(D.low as Record<string, number>) };
  const high = { ...(D.high as Record<string, number>) };
  const goal: Record<string, number> = {};
  const legends: Record<string, number> = {};
  for (const item of Object.keys(kit)) {
    const n = kit[item];
    goal[item] = n;
    if (legendaries[item] !== undefined) legends[item] = n;
    low[item] = Math.max(low[item] ?? 1, n);
    high[item] = Math.max(high[item] ?? 1, n);
  }
  const nextD = { ...D, goal, legendaries: legends, low, high };
  const nextKnobs = { ...KNOBS, single: (KNOBS.single as unknown[]).filter((f) => f !== DROP_SINGLE) };
  // Function replacers: the JSON must never be read as a replacement pattern ("$&" and friends).
  return source.replace(D_LINE, () => `const D = ${JSON.stringify(nextD)};`).replace(KNOBS_LINE, () => `const KNOBS = ${JSON.stringify(nextKnobs)};`);
}

let frozen: Submission | null = null;

/** The frozen flow as a submission (a fresh copy every call). */
export function builderSubmission(): Submission {
  if (!frozen) {
    const parsed = parseSubmission(builderFile as unknown);
    if (!parsed.submission) throw new Error(`builder.flows.json: ${parsed.errors.join("; ")}`);
    frozen = parsed.submission;
  }
  return structuredClone(frozen);
}

/** The builder for one kit: every plot script rewritten (rewriteBuilderScript). */
export function builderFor(kit: Readonly<Kit>): Submission {
  const sub = builderSubmission();
  for (const p of sub.plots) {
    if (!p.script) throw new Error(`builder plot ${p.id} has no script`);
    p.script = { source: rewriteBuilderScript(p.script.source, kit) };
  }
  return sub;
}

/**
 * The builder checks the stock before entering a farm; under the rules Dead Plants and Fermento
 * are unlimited anyway, so its stock of them is too.
 */
export const BUILDER_SUPPLIES: Readonly<Record<ItemId, number>> = { dead_plant: 1e9, fermento: 1e9 };

/** The builder's seed for a run's seed: deterministic, and independent of the flow's stream. */
export const builderSeed = (seed: number): number => derivedSeed(seed, "builder");

/**
 * The builder's scenario: the strict rules (from nothing, nothing borrowed) at the run's tier and
 * frequency, its own seed (`builderSeed`), unlimited supplies in stock.
 */
export function builderScenario(kit: Readonly<Kit>, spec: { tier: TierId; every: number; seed: number }): Scenario {
  return ruleScenario(builderFor(kit), { rules: "strict", tier: spec.tier, every: spec.every, seed: builderSeed(spec.seed) }, BUILDER_SUPPLIES);
}
