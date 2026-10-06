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
import { cheapestCarve, clearTargetCells, encode, fromAscii, fromSolve, inputCost, merge, targetCounts, type Layout } from "./layouts";
import { rect, solve } from "./solver";

/** Plot 2 keeps one of each unique crop group in column 9 for the Unique Crop Bonus. */
export const STRIP_PLOT = 2;
export const STRIP: Layout = {
  inputs: ["potato", "pumpkin", "cactus", "carrot", "melon", "sugar_cane", "wheat", "cocoa_beans", "nether_wart", "red_mushroom"].map(
    (cropId, r) => ({ cropId, position: [r, 9] as [number, number] })
  ),
  targets: [],
};
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
  /** Expandable jobs (`startWith`): the starter sub-layout per plot. */
  starter?: Partial<Record<1 | 2 | 3, { layout: Layout; code: string }>>;
}

/** Starter sub-layouts for an expandable job (Plot 2 keeps its unique-crop strip). */
export function withStarter(b: BuiltJob): BuiltJob {
  if (!b.def.startWith) return b;
  const starter: BuiltJob["starter"] = {};
  for (const plot of b.def.plots) {
    const layout = cheapestCarve(b.layouts[plot]!.layout, b.def.startWith, (p) => plot === STRIP_PLOT && p.position[1] === 9);
    starter[plot] = { layout, code: encode(layout) };
  }
  return { ...b, starter };
}

async function layoutFor(def: JobDef, plot: 1 | 2 | 3): Promise<Layout> {
  let layout: Layout;
  if (def.ascii) layout = fromAscii(def.ascii.rows, def.ascii.legend);
  else {
    const cells = plot === STRIP_PLOT ? rect(0, 0, 9, 8) : undefined;
    const r = await solve({ cells, targets: def.targets!, timeLimit: def.timeLimit ?? 300 });
    if (!["OPTIMAL", "FEASIBLE"].includes(r.status)) {
      throw new Error(`Plot ${plot}/${def.id}: local solver returned ${r.status}, not a usable layout`);
    }
    layout = fromSolve(r);
    const actual = targetCounts(layout);
    for (const { mutation, count } of def.targets!) {
      if (actual[mutation] !== count) {
        throw new Error(`Plot ${plot}/${def.id}: expected ${count} ${mutation} targets, got ${actual[mutation] ?? 0}`);
      }
    }
  }
  if (plot === STRIP_PLOT) {
    layout = { inputs: layout.inputs.filter((p) => p.position[1] < 9), targets: layout.targets.filter((p) => p.position[1] < 9), ground: (layout.ground ?? []).filter((g) => g.position[1] < 9) };
    layout = merge(layout, STRIP);
  }
  // Keep only solver-selected requirements and effect sources. Empty cells are
  // opportunities for useful mutation targets, never cosmetic crop padding.
  return layout;
}

export async function buildJobs(jobs: JobDef[] = JOBS): Promise<BuiltJob[]> {
  const built: BuiltJob[] = [];
  for (const def of jobs) {
    const layouts: BuiltJob["layouts"] = {};
    let cost: Record<string, number> = {};
    for (const plot of def.plots) {
      const layout = await layoutFor(def, plot);
      layouts[plot] = { layout, code: encode(layout) };
      const c = inputCost(layout);
      // Marks use the largest version of the layout, not duplicate plot copies.
      for (const [k, v] of Object.entries(c)) cost[k] = Math.max(cost[k] ?? 0, v);
    }
    cost = Object.fromEntries(Object.entries(cost).sort());
    built.push(withStarter({ def, layouts, cost, produces: def.produces ?? def.targets!.map((t) => t.mutation) }));
  }
  return built;
}

export interface Marks {
  low: Record<string, number>;
  high: Record<string, number>;
}

/** low = the most any one consumer layout places; high = HIGH_FACTOR x all consumers together (+ extra). */
/** Cost per job family (full job + its focus variants): one consumer, componentwise max. */
function familyCosts(built: BuiltJob[]): Record<string, number>[] {
  const fam = new Map<string, Record<string, number>>();
  for (const b of built) {
    const id = b.def.focusOf ?? b.def.id;
    const c = fam.get(id) ?? {};
    for (const [k, n] of Object.entries(b.cost)) c[k] = Math.max(c[k] ?? 0, n);
    fam.set(id, c);
  }
  return [...fam.values()];
}

export function computeMarks(built: BuiltJob[], highFactor = HIGH_FACTOR): Marks {
  const low: Record<string, number> = {};
  const sum: Record<string, number> = {};
  for (const cost of familyCosts(built)) {
    for (const [item, n] of Object.entries(cost)) {
      if (FREE_ITEMS.has(item)) continue;
      low[item] = Math.max(low[item] ?? 0, n);
      sum[item] = (sum[item] ?? 0) + n;
    }
  }
  const high: Record<string, number> = {};
  for (const item of Object.keys(sum)) high[item] = Math.max(low[item], Math.ceil(sum[item] * highFactor));
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

/** Actual plot cost for dispatch; global maximum costs are only for demand marks. */
function inStock(b: BuiltJob, plot: 1 | 2 | 3): Condition[] {
  return costIn(b.layouts[plot]!.layout);
}
function costIn(l: Layout): Condition[] {
  return Object.entries(inputCost(l)).map(([item, n]) => ({ kind: "inventoryAtLeast", item, qty: n }));
}
const targetCountText = (l: Layout) => Object.entries(targetCounts(l)).map(([m, n]) => `${n} ${m}`).join(", ");

/**
 * Wanted and every farm-made input in stock, but short of a bought item (Fermento,
 * Dead Plant): the player has to add those to the inventory. Null if it uses none.
 */
function blockedOnSupplies(b: BuiltJob, plot: 1 | 2 | 3, c: Ctx): Condition | null {
  const cost = inputCost(b.layouts[plot]!.layout);
  const bought = Object.entries(cost).filter(([item]) => FREE_ITEMS.has(item));
  if (!bought.length) return null;
  const made = Object.entries(cost)
    .filter(([item]) => !FREE_ITEMS.has(item))
    .map(([item, n]): Condition => ({ kind: "inventoryAtLeast", item, qty: n }));
  const short = anyOf(bought.map(([item, n]): Condition => ({ kind: "inventoryBelow", item, qty: n })));
  return allOf([wanted(b, c), ...made, short]);
}

/** Suggested purchased-supply buffer; not a guarantee for every seed/settings. */
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
  // Pending exits may have been latched while offline, before another plot spent stock.
  // Recheck BEFORE placement, not just after the engine has attempted to spend inputs.
  const short: StepExit = { to: "hub", when: [{ kind: "layoutShort" }], checkOnEntry: true };
  switch (b.def.special) {
    case "noReplaceWhileGrowing": {
      const target = b.def.targets![0].mutation;
      const noTarget: Condition = { kind: "highestStageBelow", mutationId: target, stage: 0 };
      // One step keeps every surviving input (and its effects) while roots grow.
      // A separate grow-layout transition would either refill eaten paid inputs,
      // or destroy omitted survivors. Refresh this layout only AFTER harvest/decay.
      // The current exact 4+4 ring cannot spawn again once a paid input decays,
      // so an offline-latched refresh cannot interrupt a newly spawned Devourer.
      return [{
        id,
        label: `${label}: keep inputs while growing`,
        layout: { code },
        policies: { replaceDecayed: false },
        exits: [
          done,
          { ...short, when: [...short.when, noTarget] },
          { to: id, when: [noTarget, anyOf([
            { kind: "mutationHarvested", mutationId: target, count: 1 },
            { kind: "plantDecayed", kindId: target },
            ...Object.keys(inputCost(layout)).map((kindId): Condition => ({ kind: "plantDecayed", kindId })),
          ])] },
        ],
      }];
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
          exits: [done, short, { to: `${id}-pick`, when: [{ kind: "targetsFilled", count: 0 }, { kind: "lowestStageAtLeast", mutationId: "magic_jellybean", stage: b.def.breakStage ?? 36 }] }],
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
    default: {
      const farm: FlowStep = { id, label, layout: { code }, exits: [done, short, ...preempt] };
      if (b.def.pickStages) {
        // Break the target early (step change harvests it), keep every input, resume.
        const target = b.def.targets![0].mutation;
        const stages = b.def.pickStages;
        const due = anyOf(stages.map((stage, n): Condition => allOf([
          ...(n > 0 ? [{ kind: "inventoryAtLeast", item: target, qty: n } as Condition] : []),
          ...(n < stages.length - 1 ? [{ kind: "inventoryBelow", item: target, qty: n + 1 } as Condition] : []),
          { kind: "highestStageAtLeast", mutationId: target, stage },
        ])));
        farm.exits.push({ to: `${id}-pick`, when: [due] });
        const pick: Layout = { inputs: [...layout.inputs, ...layout.targets.map((t) => ({ cropId: "sugar_cane", position: t.position }))], targets: [], ground: layout.ground };
        // A break latched while offline is applied at the next session without a recheck.
        // If the target reset to stage 1 meanwhile, skip the pick (checked on arrival) so
        // a worthless stage-1 plant is not broken.
        const reset: StepExit = { to: id, when: [{ kind: "highestStageBelow", mutationId: target, stage: Math.min(...stages) }], checkOnEntry: true };
        return [farm, { id: `${id}-pick`, label: `${label}: break it early (${stages.map((s, n) => `stage ${s} with ${n} owned`).join(", ")})`, layout: { code: encode(pick) }, exits: [reset, { to: id, when: [{ kind: "cycles", n: 1 }] }], watch: [] }];
      }
      if (!b.def.scrubOnEntry) return [farm];
      // Target labels don't clear inherited plants (Jellybeans otherwise wait 120
      // stages). Clear their complete footprints ONCE on entry, preserving paid
      // input anchors. Never scrub repeatedly while legitimate targets grow.
      return [
        { id: `${id}-prepare`, label: `${label}: clear inherited target blockers`, layout: { code: encode(clearTargetCells(layout)) }, exits: [done, short, { to: id, when: [{ kind: "cycles", n: 1 }] }], watch: [] },
        farm,
      ];
    }
  }
}

export function buildPlots(built: BuiltJob[], priorities: Record<1 | 2 | 3, string[]> = PLOT_PRIORITY, highFactor = HIGH_FACTOR): ScenarioPlot[] {
  const c: Ctx = { marks: computeMarks(built, highFactor), down: downstream(built) };
  const byId = new Map(built.map((b) => [b.def.id, b]));
  const allOwned = Object.keys(GOAL).map(owned);
  return ([1, 2, 3] as const).map((plot) => {
    const listed = priorities[plot].map((id) => byId.get(id)!).filter((b) => b && b.def.plots.includes(plot) && !b.def.focusOf);
    const focusOf = (b: BuiltJob) => built.filter((v) => v.def.focusOf === b.def.id && v.def.plots.includes(plot));
    // Each full job is followed by its focus variants (their own steps).
    const order = listed.flatMap((b) => [b, ...focusOf(b)]);
    const entry = (b: BuiltJob): string => (b.def.scrubOnEntry ? `${b.def.id}-prepare` : b.def.id);
    const startOf = (b: BuiltJob): StepExit => ({ to: entry(b), when: [wanted(b, c), ...inStock(b, plot)], checkOnEntry: true });
    // Hub exits: [focused variants] -> full job -> [fallback variants]. A variant is
    // "focused" when only its products are wanted (the family's other products are at
    // their low marks or obsolete): the smaller layout then makes exactly what is short
    // without paying for the full layout. Fallback: the full layout can't be stocked.
    const start = listed.flatMap((b): StepExit[] => {
      const vs = focusOf(b);
      const focused = vs.map((v): StepExit => {
        const others = b.produces.filter((p) => !v.produces.includes(p));
        const fine = others.map((p): Condition => {
          const atLow: Condition = { kind: "inventoryAtLeast", item: p, qty: c.marks.low[p] ?? 1 };
          const obs = obsolete(p, c);
          return obs && !(p in GOAL) ? anyOf([atLow, obs]) : atLow;
        });
        return { ...startOf(v), when: [...startOf(v).when, ...fine] };
      });
      // Expandable: start small when only the starter is affordable.
      const starter = b.starter?.[plot] ? [{ to: `${b.def.id}-start`, when: [wanted(b, c), ...costIn(b.starter[plot]!.layout)], checkOnEntry: true }] : [];
      return [...focused, startOf(b), ...starter, ...vs.filter((v) => v.def.fallback !== false).map(startOf)];
    });
    const blocked = order.map((b) => blockedOnSupplies(b, plot, c)).filter((x): x is Condition => x !== null);
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
      ...order.flatMap((b) => {
        // Filler preemption: any hub exit to an earlier job family.
        const earlier = new Set(listed.slice(0, listed.findIndex((x) => x.def.id === (b.def.focusOf ?? b.def.id))).flatMap((x) => [x, ...focusOf(x)].map(entry)));
        const head = b.def.focusOf ? byId.get(b.def.focusOf)! : b;
        const earlierStarts = start.filter((e) => earlier.has(e.to!)).map(({ checkOnEntry: _, ...e }) => ({ ...e, to: "hub" }));
        if (b.def.filler) return jobSteps(b, plot, c, earlierStarts);
        if (b.starter?.[plot]) {
          // Starter: the cheapest sub-layout. Upgrade in place once the difference to the
          // full layout is in stock; identical placed inputs and growing targets survive.
          const s = b.starter[plot]!;
          const full = inputCost(b.layouts[plot]!.layout);
          const have = inputCost(s.layout);
          const extra = Object.entries(full).map(([item, n]) => [item, n - (have[item] ?? 0)] as const).filter(([, n]) => n > 0);
          const upgrade: StepExit = { to: b.def.id, when: extra.map(([item, n]): Condition => ({ kind: "inventoryAtLeast", item, qty: n })) };
          const starterStep: FlowStep = {
            id: `${b.def.id}-start`,
            label: `${b.def.label}: starter (${targetCountText(s.layout)}); expands when the rest is in stock`,
            layout: { code: s.code },
            exits: [
              { to: "hub", when: satisfied(b, c), checkOnEntry: true },
              { to: "hub", when: [{ kind: "layoutShort" }], checkOnEntry: true },
              upgrade,
            ],
          };
          return [starterStep, ...jobSteps(b, plot, c, [])];
        }
        if (head.def.yieldWhenLow) {
          // Hand over once every product of this layout is at its low mark (or obsolete).
          const atLow = b.produces.map((p): Condition => {
            const ok: Condition = { kind: "inventoryAtLeast", item: p, qty: c.marks.low[p] ?? 1 };
            const obs = obsolete(p, c);
            return obs && !(p in GOAL) ? anyOf([ok, obs]) : ok;
          });
          return jobSteps(b, plot, c, earlierStarts.map((e) => ({ ...e, when: [...atLow, ...e.when] })));
        }
        return jobSteps(b, plot, c, []);
      }),
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
