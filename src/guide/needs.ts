/**
 * "How much of each mutation does the whole flow need?", read from the plot script's own build plan.
 *
 * The generated script embeds its plan as `const D = {...};`: per farm family the average yield per
 * build and the inputs one build uses, plus a consumer-first order (`topo`). The script's
 * `computeNet` walks that order to decide what is still needed; this is the same walk, run twice:
 *
 * - from an empty start with nothing running: the **total** the flow uses of each item (inputs
 *   for later farms plus the goal's own count);
 * - from the player's stock and running farms: what is **still to make**.
 *
 * Owning an item further down the chain lowers what is needed above it, so a player who already
 * owns enough of everything made from Gloomgourd has Gloomgourd covered even with none in stock.
 * Yields are averages, so totals are estimates ("~50").
 */
import { ALOE_FRAGMENT, type FlowsFile } from "./flow";

/** The parts of the script's embedded data the estimate needs. */
export interface ScriptPlan {
  goal: Record<string, number>;
  legendaries: Record<string, number>;
  /** The stock mark a farm works up to before it hands the plot on. */
  high: Record<string, number>;
  /** Farm family -> average yield per build and inputs per build. */
  plan: Record<string, { yield: Record<string, number>; use: Record<string, number> }>;
  /** Farm families, consumers first. */
  topo: string[];
  /** Step id -> its family (a combined farm lists its members). */
  jobs: Record<string, { family: string; members?: string[]; focusOf?: string }>;
  /** KNOBS.margin: non-legendary yields are divided by it. */
  margin: number;
  /** KNOBS.creditRunning: a farm already standing counts as one paid build. */
  creditRunning: boolean;
}

const lineJson = (source: string, name: string): unknown => {
  const match = new RegExp(`^const ${name} = (\\{.*\\});\\s*$`, "m").exec(source);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Read the build plan out of the first plot script; null when the flow has none (the panel then hides). */
export function scriptPlan(flow: FlowsFile): ScriptPlan | null {
  const source = flow.plots.find((p) => p.script?.source)?.script?.source ?? flow.script?.source ?? "";
  const d = lineJson(source, "D");
  if (!isRecord(d) || !isRecord(d.goal) || !isRecord(d.plan) || !Array.isArray(d.topo) || !isRecord(d.jobs)) return null;
  const knobs = lineJson(source, "KNOBS");
  const k = isRecord(knobs) ? knobs : {};
  return {
    goal: d.goal as ScriptPlan["goal"],
    legendaries: (isRecord(d.legendaries) ? d.legendaries : {}) as ScriptPlan["legendaries"],
    high: (isRecord(d.high) ? d.high : {}) as ScriptPlan["high"],
    plan: d.plan as ScriptPlan["plan"],
    topo: (d.topo as unknown[]).filter((t): t is string => typeof t === "string"),
    jobs: d.jobs as ScriptPlan["jobs"],
    margin: typeof k.margin === "number" && k.margin > 0 ? k.margin : 1,
    creditRunning: k.creditRunning === true,
  };
}

/** One item's place in the whole flow. */
export interface FlowNeed {
  item: string;
  /** Estimated total the flow uses from an empty start (inputs plus the goal's count). */
  total: number;
  /** Still to make, given what the player owns and the farms standing now. */
  remaining: number;
  /** `total - remaining`: covered by stock, or by owning what it would have been made into. */
  covered: number;
  have: number;
}

export interface FlowNeeds {
  items: Record<string, FlowNeed>;
  /** The script's stock marks (`high`), for "this farm stays until you have N". */
  high: Record<string, number>;
}

/** Gross demand per item after walking every consumer: the script's `computeNet`. */
function grossDemand(plan: ScriptPlan, inv: (item: string) => number, running: Record<string, number>): Record<string, number> {
  const gross: Record<string, number> = { ...plan.goal };
  for (const family of plan.topo) {
    const step = plan.plan[family];
    if (!step) continue;
    let builds = 0;
    for (const [item, perBuild] of Object.entries(step.yield)) {
      const n = Math.max(0, (gross[item] ?? 0) - inv(item));
      if (n <= 0) continue;
      const per = plan.legendaries[item] !== undefined ? perBuild : perBuild / plan.margin;
      builds = Math.max(builds, Math.ceil(n / Math.max(0.1, per)));
    }
    const paid = Math.min(builds, running[family] ?? 0);
    for (const [item, use] of Object.entries(step.use)) gross[item] = (gross[item] ?? 0) + (builds - paid) * use;
  }
  return gross;
}

/**
 * Every item the flow makes or needs, with its total and what is left.
 * `farms` are the step ids the plots stand on now (a standing farm has paid for one build).
 */
export function flowNeeds(plan: ScriptPlan, inventory: Readonly<Record<string, number>>, farms: readonly string[] = []): FlowNeeds {
  const have = (item: string) => {
    const own = Math.max(0, inventory[item] ?? 0);
    // Every 9 fragments are one All-in Aloe, as the goal counts them.
    return item === "all_in_aloe" ? own + Math.floor(Math.max(0, inventory[ALOE_FRAGMENT] ?? 0) / 9) : own;
  };
  const running: Record<string, number> = {};
  if (plan.creditRunning) {
    for (const id of farms) {
      const job = plan.jobs[id];
      if (!job || job.focusOf) continue;
      for (const family of job.members ?? [job.family]) running[family] = (running[family] ?? 0) + 1;
    }
  }
  const total = grossDemand(plan, () => 0, {});
  const now = grossDemand(plan, have, running);
  const items: Record<string, FlowNeed> = {};
  for (const [item, gross] of Object.entries(total)) {
    const t = Math.ceil(gross - 1e-9);
    if (t <= 0) continue;
    const remaining = Math.min(t, Math.max(0, Math.ceil((now[item] ?? 0) - have(item) - 1e-9)));
    items[item] = { item, total: t, remaining, covered: t - remaining, have: have(item) };
  }
  return { items, high: { ...plan.high } };
}

/** Overall progress: items fully covered, and covered/total summed over every item. */
export function needsTotals(needs: FlowNeeds): { items: number; done: number; covered: number; total: number } {
  const rows = Object.values(needs.items);
  return {
    items: rows.length,
    done: rows.filter((r) => r.remaining === 0).length,
    covered: rows.reduce((s, r) => s + r.covered, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
  };
}
