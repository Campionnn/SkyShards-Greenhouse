/**
 * Builds the Rose Dragon flows file from jobs.ts. See tools/rose-dragon/README.md.
 *
 * Every plot gets the same shape:
 *   hub            "Choose next farm": idle layout (empty farmland). Exits, in the plot's
 *                  priority order and all checked on arrival: Done when every legendary is
 *                  owned; else job J when J is wanted and its inputs are in stock. If none
 *                  holds, the hub is built and the plot idles (Lonelilies spawn on it) until
 *                  something becomes possible.
 *   <job>          the job's layout. Exit: satisfied -> hub (checked on arrival too).
 *   (+ helper steps for special jobs: Devourer, Jellybean picking, Shellfruit blasting)
 *   done           held once every Rose Dragon legendary is owned.
 */
import { writeFileSync } from "node:fs";
import type { Condition, FlowStep, StepExit } from "../../src/simulator/flow/types";
import type { ScenarioPlot } from "../../src/simulator/sim/state";
import { GOAL, JOBS, PLOT_PRIORITY, type JobDef } from "./jobs";
import { encode, fromAscii, fromSolve, inputCost, merge, type Layout } from "./layouts";
import { rect, solve } from "./solver";

/** Plot 2 keeps one of each unique crop group in column 9 for the Unique Crop Bonus. */
export const STRIP_PLOT = 2;
export const STRIP: Layout = {
  inputs: ["potato", "pumpkin", "cactus", "carrot", "melon", "sugar_cane", "wheat", "cocoa_beans", "nether_wart", "red_mushroom"].map(
    (cropId, r) => ({ cropId, position: [r, 9] as [number, number] })
  ),
  targets: [],
};
const YIELD_WEIGHTS = { improved_harvest_boost: 0.3, harvest_boost: 0.2, harvest_loss: -0.2, immunity: 0.02 };
/** Never counted as needed: assumed bought / free. */
const FREE_ITEMS = new Set(["fermento", "dead_plant"]);
/** high mark = HIGH_FACTOR x what all consumer layouts place together. */
const HIGH_FACTOR = 1.5;

export interface BuiltJob {
  def: JobDef;
  /** Layout per plot (plot 2 is solved without column 9). */
  layouts: Partial<Record<1 | 2 | 3, { layout: Layout; code: string }>>;
  cost: Record<string, number>;
  produces: string[];
}

async function layoutFor(def: JobDef, plot: 1 | 2 | 3): Promise<Layout> {
  let layout: Layout;
  if (def.ascii) layout = fromAscii(def.ascii.rows, def.ascii.legend);
  else {
    const cells = plot === STRIP_PLOT ? rect(0, 0, 9, 8) : undefined;
    const r = await solve({ cells, targets: def.targets!, timeLimit: def.timeLimit ?? 20, effectWeights: def.yieldEffects ? YIELD_WEIGHTS : undefined });
    layout = fromSolve(r);
  }
  if (plot === STRIP_PLOT) {
    layout = { inputs: layout.inputs.filter((p) => p.position[1] < 9), targets: layout.targets.filter((p) => p.position[1] < 9), ground: (layout.ground ?? []).filter((g) => g.position[1] < 9) };
    layout = merge(layout, STRIP);
  }
  return layout;
}

export async function buildJobs(jobs: JobDef[] = JOBS): Promise<BuiltJob[]> {
  return Promise.all(
    jobs.map(async (def) => {
      const layouts: BuiltJob["layouts"] = {};
      let cost: Record<string, number> = {};
      for (const plot of def.plots) {
        const layout = await layoutFor(def, plot);
        layouts[plot] = { layout, code: encode(layout) };
        const c = inputCost(layout);
        // marks use the largest version of the layout
        for (const [k, v] of Object.entries(c)) cost[k] = Math.max(cost[k] ?? 0, v);
      }
      cost = Object.fromEntries(Object.entries(cost).sort());
      return { def, layouts, cost, produces: def.produces ?? def.targets!.map((t) => t.mutation) };
    })
  );
}

export interface Marks {
  low: Record<string, number>;
  high: Record<string, number>;
}

/** low = the most any one consumer layout places; high = HIGH_FACTOR x all consumers together (+ extra). */
export function computeMarks(built: BuiltJob[]): Marks {
  const low: Record<string, number> = {};
  const sum: Record<string, number> = {};
  for (const b of built) {
    for (const [item, n] of Object.entries(b.cost)) {
      if (FREE_ITEMS.has(item)) continue;
      low[item] = Math.max(low[item] ?? 0, n);
      sum[item] = (sum[item] ?? 0) + n;
    }
  }
  const high: Record<string, number> = {};
  for (const item of Object.keys(sum)) high[item] = Math.max(low[item], Math.ceil(sum[item] * HIGH_FACTOR));
  for (const b of built) for (const [item, n] of Object.entries(b.def.extra ?? {})) high[item] = (high[item] ?? 0) + n;
  for (const [l, n] of Object.entries(GOAL)) {
    low[l] = n;
    high[l] = n;
  }
  return { low, high };
}

/** Legendaries each item leads to through the jobs that consume it. */
export function downstream(built: BuiltJob[]): Record<string, string[]> {
  const memo: Record<string, string[]> = {};
  const visit = (item: string, stack: Set<string>): string[] => {
    if (item in GOAL) return [item];
    if (memo[item]) return memo[item];
    if (stack.has(item)) return [];
    stack.add(item);
    const out = new Set<string>();
    for (const b of built) if (b.cost[item]) for (const p of b.produces) for (const l of visit(p, stack)) out.add(l);
    stack.delete(item);
    return (memo[item] = [...out].sort());
  };
  const items = new Set(built.flatMap((b) => [...Object.keys(b.cost), ...b.produces]));
  return Object.fromEntries([...items].map((i) => [i, visit(i, new Set())]));
}

const owned = (l: string): Condition => ({ kind: "inventoryAtLeast", item: l, qty: GOAL[l] });
const allOf = (of: Condition[]): Condition => (of.length === 1 ? of[0] : { kind: "group", match: "all", of });
const anyOf = (of: Condition[]): Condition => (of.length === 1 ? of[0] : { kind: "group", match: "any", of });

interface Ctx {
  marks: Marks;
  down: Record<string, string[]>;
}

/**
 * Legendaries an item leads to, or [] when it leads to all of them: the hub checks "Done"
 * first, so "some legendary is still missing" always holds when the job exits are read.
 */
function relevantLegs(item: string, c: Ctx): string[] {
  const legs = c.down[item] ?? [];
  return legs.length === Object.keys(GOAL).length ? [] : legs;
}

/** Product no longer useful: every legendary it leads to is owned. */
function obsolete(item: string, c: Ctx): Condition | null {
  if (item in GOAL) return owned(item);
  const legs = relevantLegs(item, c);
  return legs.length ? allOf(legs.map(owned)) : null;
}

/** Job worth starting: some product is below its low mark and still useful. */
function wanted(b: BuiltJob, c: Ctx): Condition {
  return anyOf(
    b.produces.map((p) => {
      const below: Condition = { kind: "inventoryBelow", item: p, qty: c.marks.low[p] ?? 1 };
      if (p in GOAL) return below;
      const legs = relevantLegs(p, c);
      // useful while some legendary it leads to is still missing
      return legs.length ? allOf([below, anyOf(legs.map((l) => ({ kind: "inventoryBelow", item: l, qty: GOAL[l] })))]) : below;
    })
  );
}

/** Job finished: every product at its high mark or no longer useful. */
function satisfied(b: BuiltJob, c: Ctx): Condition[] {
  return b.produces.map((p) => {
    const enough: Condition = { kind: "inventoryAtLeast", item: p, qty: c.marks.high[p] ?? 1 };
    const obs = obsolete(p, c);
    return obs && !(p in GOAL) ? anyOf([enough, obs]) : enough;
  });
}

function inStock(b: BuiltJob): Condition[] {
  return Object.entries(b.cost).map(([item, n]) => ({ kind: "inventoryAtLeast", item, qty: n }));
}

/**
 * Wanted and every farm-made input in stock, but short of a bought item (Fermento,
 * Dead Plant): the player has to add those to the inventory. Null if it uses none.
 */
function blockedOnSupplies(b: BuiltJob, c: Ctx): Condition | null {
  const bought = Object.entries(b.cost).filter(([item]) => FREE_ITEMS.has(item));
  if (!bought.length) return null;
  const made = Object.entries(b.cost)
    .filter(([item]) => !FREE_ITEMS.has(item))
    .map(([item, n]): Condition => ({ kind: "inventoryAtLeast", item, qty: n }));
  const short = anyOf(bought.map(([item, n]): Condition => ({ kind: "inventoryBelow", item, qty: n })));
  return allOf([wanted(b, c), ...made, short]);
}

/** What to add to the starting inventory (measured: 63-160 Dead Plants and 10-30 Fermento per run from empty). */
export const SUPPLIES_ADVICE = "add Dead Plant x250 and Fermento x50 to the inventory";

const IDLE: Record<1 | 2 | 3, Layout> = {
  1: fromAscii(Array(10).fill("ffffffffff"), { f: "~farmland" }),
  2: merge(fromAscii(Array(10).fill("fffffffff."), { f: "~farmland" }), STRIP),
  3: fromAscii(Array(10).fill("ffffffffff"), { f: "~farmland" }),
};

/** The steps one job adds on one plot (its main step id is the job id). */
function jobSteps(b: BuiltJob, plot: 1 | 2 | 3, c: Ctx, preempt: StepExit[]): FlowStep[] {
  const { code, layout } = b.layouts[plot]!;
  const id = b.def.id;
  const label = b.def.label;
  const done: StepExit = { to: "hub", when: satisfied(b, c), checkOnEntry: true };
  switch (b.def.special) {
    case "noReplaceWhileGrowing": {
      const target = b.def.targets![0].mutation;
      return [
        {
          id,
          label: `${label}: waiting for a spawn`,
          layout: { code },
          exits: [
            done,
            { to: `${id}-grow`, when: [{ kind: "targetsFilled", count: 1 }] },
            // roots ate inputs the inventory can't replace: go make more
            { to: "hub", when: [{ kind: "layoutShort" }] },
          ],
        },
        {
          id: `${id}-grow`,
          label: `${label}: growing (don't re-place eaten inputs)`,
          layout: { code },
          policies: { replaceDecayed: false },
          exits: [done, { to: id, when: [{ kind: "highestStageBelow", mutationId: target, stage: 1 }] }],
        },
      ];
    }
    case "jellyBreak": {
      // Picking step: the same layout with Sugar Cane on the target cells, so the step
      // change breaks (harvests) the Jellybeans standing there; the inputs are kept.
      const pick: Layout = { inputs: [...layout.inputs, ...layout.targets.map((t) => ({ cropId: "sugar_cane", position: t.position }))], targets: [], ground: layout.ground };
      return [
        {
          id,
          label,
          layout: { code },
          exits: [done, { to: `${id}-pick`, when: [{ kind: "targetsFilled", count: 0 }, { kind: "lowestStageAtLeast", mutationId: "magic_jellybean", stage: b.def.breakStage ?? 36 }] }],
        },
        { id: `${id}-pick`, label: `${label}: break the Jellybeans (stage ${b.def.breakStage ?? 36}+)`, layout: { code: encode(pick) }, exits: [{ to: "hub", when: [{ kind: "cycles", n: 1 }] }], watch: [] },
      ];
    }
    case "shellfruitBlast":
      return [
        { id, label: `${label}: place them`, layout: { code }, exits: [{ to: `${id}-pop`, when: [{ kind: "cycles", n: 1 }] }], watch: [] },
        {
          id: `${id}-pop`,
          label: `${label}: break the Blastberries (Turtlellini hit twice become Shellfruit)`,
          layout: { code: encode(IDLE[plot]) },
          fullClear: true,
          exits: [{ to: "hub", when: [{ kind: "cycles", n: 1 }] }],
          watch: [],
        },
      ];
    default:
      // layoutShort: inputs decayed or got destroyed and the inventory can't replace them.
      // A filler is also left for any farm above it in the plot's list that can start now.
      return [{ id, label, layout: { code }, exits: [done, ...preempt, { to: "hub", when: [{ kind: "layoutShort" }] }] }];
  }
}

export function buildPlots(built: BuiltJob[]): ScenarioPlot[] {
  const c: Ctx = { marks: computeMarks(built), down: downstream(built) };
  const byId = new Map(built.map((b) => [b.def.id, b]));
  const allOwned = Object.keys(GOAL).map(owned);
  return ([1, 2, 3] as const).map((plot) => {
    const order = PLOT_PRIORITY[plot].map((id) => byId.get(id)!).filter((b) => b && b.def.plots.includes(plot));
    const start = order.map((b): StepExit => ({ to: b.def.id, when: [wanted(b, c), ...inStock(b)], checkOnEntry: true }));
    const blocked = order.map((b) => blockedOnSupplies(b, c)).filter((x): x is Condition => x !== null);
    const hub: FlowStep = {
      id: "hub",
      label: "Choose next farm (idle: waiting for another plot's items; empty farmland grows Lonelilies)",
      layout: { code: encode(IDLE[plot]) },
      exits: [
        { to: "done", when: allOwned, checkOnEntry: true },
        ...start,
        // nothing can start, and something only lacks bought items: tell the player
        ...(blocked.length ? [{ to: "supplies", when: [anyOf(blocked)], checkOnEntry: true }] : []),
      ],
      watch: [],
    };
    const supplies: FlowStep = {
      id: "supplies",
      label: `OUT OF FERMENTO / DEAD PLANTS: ${SUPPLIES_ADVICE} (bazaar)`,
      layout: { code: encode(IDLE[plot]) },
      // back to choosing as soon as any farm can start
      exits: start.map(({ checkOnEntry: _, ...e }) => ({ ...e, to: "hub" })),
      watch: [],
    };
    const finished: StepExit = { to: "done", when: allOwned };
    const steps: FlowStep[] = [
      hub,
      ...(blocked.length ? [supplies] : []),
      ...order.flatMap((b, i) => jobSteps(b, plot, c, b.def.filler ? start.slice(0, i).map(({ checkOnEntry: _, ...e }) => e) : [])),
    ];
    // Every farm stops as soon as the Rose Dragon legendaries are all owned.
    for (const s of steps) if (s.id !== "hub") s.exits.unshift(finished);
    steps.push({ id: "done", label: "Done: every Rose Dragon legendary owned", layout: { code: encode(IDLE[plot]) }, exits: [{ when: allOwned }], watch: [] });
    return { id: plot, flow: { steps, loop: false, startIndex: 0 } };
  });
}

export async function generate() {
  const built = await buildJobs();
  return { plots: buildPlots(built), built, marks: computeMarks(built), down: downstream(built) };
}

export async function writeFlows(out: string): Promise<void> {
  const { plots, built, marks } = await generate();
  writeFileSync(out, JSON.stringify({ kind: "skyshards-greenhouse-flows", version: 1, plots }, null, 2) + "\n");
  for (const b of built) console.log(`${b.def.id.padEnd(14)} plots ${b.def.plots.join(",")} cost ${JSON.stringify(b.cost)}`);
  console.log("low ", JSON.stringify(marks.low));
  console.log("high", JSON.stringify(marks.high));
  console.log("wrote", out);
}
