import { isFreePlacedItem } from "../simulator/config";
import type { GameData, ItemId } from "../simulator/data/types";
import { createLayoutResolver } from "../simulator/flow/layout";
import { layoutMissing } from "../simulator/flow/triggers";
import type { ResolvedLayout } from "../simulator/sim/context";
import { canBuy } from "../simulator/sim/market";
import type { EffortKind, EffortSummary, SimulationState } from "../simulator/sim/state";
import { uptimeRatio } from "../simulator/sim/summary";
import type { StepLayout } from "../simulator/flow/types";
import { CUT_STEP, TRAIL_MIN, TRAIL_SHARE } from "./rules";

/**
 * What the server stores per verification run (docs/plans/flow-leaderboard.md §3.3,
 * docs/plans/leaderboard-boards-v2.md §4): item counts per simulated day, never coins, so the
 * page can price them with any valuation.
 *
 * A run simulates the author's length C plus the secret end window: `endCycles(C)` cycles. The
 * per-day maps are window means: the mean of counts(t) / days(t) over the cut points t = C,
 * C + CUT_STEP, ... up to the end. `RunRecorder` watches the run cycle by cycle (`engine.run`'s
 * `onCycle`) and builds the result; `cellResult` picks a cell's median seed.
 */

export type PerDay = Record<ItemId, number>;

export interface EffortResult {
  sessions: number;
  /** Weighted effort per session (average). */
  avg: number;
  /** The heaviest session. */
  peak: number;
  /** Raw action counts per session, by kind. */
  byKind: Partial<Record<EffortKind, number>>;
}

/** Average layout cells left empty for lack of stock, for one (plot, step, item). */
export interface StarvedCells {
  plot: number;
  /** The step's id (the flow's labels are in the payload). */
  step: string;
  item: ItemId;
  /** Cells, averaged over every cycle of the run. */
  cells: number;
}

/** How the run got going, for "layout complete after ~N days · then X/day". */
export interface RampInfo {
  /**
   * The cycle the layouts were complete from: the first cycle with no cell empty for lack of
   * stock after which such cells average under RAMP_STARVED_MAX for the rest of the run. 0 = from
   * the start; null = not before the scored window (the flow stays short of something).
   */
  complete: number | null;
  /** Per day over the second half of the run, [end / 2, end]. */
  produced: PerDay;
  bought: PerDay;
}

/** The rates over the run's last TRAIL_SHARE, for the "still producing" check. */
export interface TrailRates {
  /** The cycle the trailing part starts at. */
  from: number;
  produced: PerDay;
  consumed: PerDay;
  bought: PerDay;
  shortfall: PerDay;
  bySource: Record<string, PerDay>;
}

export interface RunResult {
  /** Cycles simulated (the scored length plus the end window). */
  cycles: number;
  /** Simulated days at the end of the run. */
  days: number;
  /** The scored window: cut points every CUT_STEP cycles from `from` to `to`. Missing on old results. */
  window?: { from: number; to: number; cuts: number };
  /** Every unit credited to the inventory (harvests, cleared Dead Plants, converted aloes), per day. */
  produced: PerDay;
  /** Units spent placing, per day (ironman: the supplies you must farm yourself). */
  consumed: PerDay;
  /** Normal board only: units bought because a placement was short, per day. */
  bought: PerDay;
  /** Normal board only: items the free setup placed, once (what building the starting layouts costs). */
  built: Record<ItemId, number>;
  /** Units a required spend could not get, per day (ironman shortfalls). */
  shortfall: PerDay;
  uptime: number;
  sustainable: boolean;
  effort: EffortResult;
  /** A script halted the run (error or pause) before it finished. */
  halted: boolean;
  /** Harvest drops per day by the plant kind that dropped them: kind -> item -> per day. */
  bySource?: Record<string, PerDay>;
  /** Share of the run each plot spent in each step: plot id -> step id -> fraction (sums to ~1). */
  stepTime?: Record<string, Record<string, number>>;
  /** Seed results only: the rates over the run's last TRAIL_SHARE (dropped from stored cells). */
  trail?: TrailRates;
  /**
   * Borrow runs: per mutation item, the starting items a player needs: the most units owed at
   * once, not counting what the daily `upkeep` added (an owed amount that grows every day is
   * upkeep, not a stock to start with). Without upkeep it is `-min(ledger.minStock, 0)`; with it,
   * the most owed at any cycle minus `upkeep` × the days elapsed then. Catches items borrowed and
   * given back within a session.
   */
  startItems?: Record<ItemId, number>;
  /** Borrow runs: `startItems` that were only ever owed inside a session (returned each session). */
  sessionOnly?: ItemId[];
  /** Borrow runs: units still owed at the end and never given back, once (the end debt minus the `upkeep` part). */
  usedUp?: Record<ItemId, number>;
  /** Borrow runs: per day, how much the owed amount grew over the second half of the run (positive only). */
  upkeep?: Record<ItemId, number>;
  /** Layout cells left empty for lack of stock, the largest first (at most 8). */
  starved?: StarvedCells[];
  /**
   * Runs that can't borrow (strict): the run never got going. Some plot had at least
   * CANT_START_CELLS layout cells empty on average for items the run never produced at all: what
   * the flow places but nothing in it grows. Missing when it started (and on borrowing runs).
   */
  cantStart?: { plot: number; cells: number; items: ItemId[] };
  ramp?: RampInfo;
  /** Cells only: most seeds slowed down, so the cell holds its median seed's trailing rates. */
  slowing?: true;
  /**
   * "From nothing" results (Leaderboard v3, verify.ts runIronman): how the starting items were
   * made before the flow started. The result's counts cover the whole timeline (the builder's
   * crops included).
   */
  prep?: PrepInfo;
}

/** The "from nothing" timeline's first part: the builder making the flow's starting items (docs/plans/leaderboard-v3.md §3). */
export interface PrepInfo {
  /** The starting items, whole units: ceil(startItems) of the same seed's borrow run. */
  kit: Record<ItemId, number>;
  /** T*: the cycle the flow started (a multiple of CUT_STEP); 0 without a kit; the author's length C when not done. */
  cycles: number;
  /** Simulated days at `cycles`. */
  days: number;
  /** Simulated days when the builder first owned the kit (before the CUT_STEP padding to T*); missing when not done or without a kit. */
  madeDays?: number;
  /** The builder owned the kit by the first scored cut (the author's length). */
  done: boolean;
  /** The flow part came from the borrow run's snapshots (stitched) or from its own strict run from the kit (real). */
  mode: "stitched" | "real";
  /**
   * Leaderboard v3.1: which result this seed scores. "timeline" = the builder's days and crops, then
   * the flow; "flow" = the flow alone (the builder out-earned it, so its crops don't count); "kit" =
   * capped at the "with the starting items" result.
   */
  credit?: "timeline" | "flow" | "kit";
  /** Leaderboard v3.1: the seed slows down: its trail is under TRAIL_MIN × the flow's own rate (decides `seedSlowing`). */
  slow?: boolean;
  /** Not done: how much of each kit item the builder held at the author's length. */
  have?: Record<ItemId, number>;
  /** Cells only (the API): the fastest and slowest seeds' `madeDays`. */
  madeRange?: [number, number];
  /** Cells only (the API): seeds whose builder made the kit, of all seeds. */
  doneSeeds?: [number, number];
}

const perDay = (counts: Readonly<Record<string, number>>, days: number): PerDay => {
  const out: PerDay = {};
  for (const [item, n] of Object.entries(counts)) if (n > 0 && days > 0) out[item] = n / days;
  return out;
};

export function effortResult(e: EffortSummary | undefined): EffortResult {
  if (!e || e.sessions === 0) return { sessions: 0, avg: 0, peak: 0, byKind: {} };
  const byKind: Partial<Record<EffortKind, number>> = {};
  for (const [k, n] of Object.entries(e.counts)) if (n) byKind[k as EffortKind] = n / e.sessions;
  return { sessions: e.sessions, avg: e.total / e.sessions, peak: e.peak, byKind };
}

/** Share of the run's time each plot spent in each flow step, from the runners' history. */
export function stepTimeOf(state: SimulationState): Record<string, Record<string, number>> {
  const total = state.elapsedSeconds;
  const out: Record<string, Record<string, number>> = {};
  if (!(total > 0)) return out;
  for (const runner of state.flows) {
    const shares: Record<string, number> = {};
    for (const h of runner.history) {
      if (h.skipped) continue;
      const start = h.startSeconds ?? 0;
      const end = h.endSeconds ?? total;
      const t = Math.max(0, Math.min(total, end) - start);
      if (t > 0) shares[h.stepId] = (shares[h.stepId] ?? 0) + t / total;
    }
    out[String(runner.plotId)] = shares;
  }
  return out;
}

// ---- Recording a run -------------------------------------------------------------------------

/** A run's cumulative counts at one cycle (what the window mean and the trail are computed from). */
export interface CountSnapshot {
  cycle: number;
  seconds: number;
  produced: Record<ItemId, number>;
  consumed: Record<ItemId, number>;
  bought: Record<ItemId, number>;
  shortfall: Record<ItemId, number>;
  bySource: Record<string, Record<ItemId, number>>;
}

/** Cumulative counts at one cycle, with what the run owed. */
interface Snapshot extends CountSnapshot {
  /** Mutation items owed (stock below 0), units. */
  owed: Record<ItemId, number>;
}

/** The per-day rate of a quantity between two snapshots (positive only). */
function rateBetween(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, days: number): PerDay {
  const out: PerDay = {};
  if (!(days > 0)) return out;
  for (const [item, n] of Object.entries(b)) {
    const v = (n - (a[item] ?? 0)) / days;
    if (v > 0) out[item] = v;
  }
  return out;
}

function nestedRateBetween(a: Snapshot["bySource"], b: Snapshot["bySource"], days: number): Record<string, PerDay> {
  const out: Record<string, PerDay> = {};
  for (const [k, items] of Object.entries(b)) {
    const r = rateBetween(a[k] ?? {}, items, days);
    if (Object.keys(r).length) out[k] = r;
  }
  return out;
}

/** A state's cumulative counts (ledger produced / consumed / shortfall, bought, bySource). Reads only. */
export function countSnapshot(state: SimulationState): CountSnapshot {
  const produced: Record<ItemId, number> = {};
  const consumed: Record<ItemId, number> = {};
  const shortfall: Record<ItemId, number> = {};
  for (const [item, row] of Object.entries(state.ledger)) {
    if (row.produced > 0) produced[item] = row.produced;
    if (row.consumed > 0) consumed[item] = row.consumed;
    if (row.shortfall > 0) shortfall[item] = row.shortfall;
  }
  const bySource: CountSnapshot["bySource"] = {};
  for (const [k, items] of Object.entries(state.summary.bySource ?? {})) bySource[k] = { ...items };
  return { cycle: state.cycle, seconds: state.elapsedSeconds, produced, consumed, bought: { ...(state.summary.market?.bought ?? {}) }, shortfall, bySource };
}

/** The first cycle of a run's trailing TRAIL_SHARE, for a run that ends at `to`. */
export const trailStart = (to: number): number => Math.floor(to * (1 - TRAIL_SHARE) + 1e-9);

/** Sums over the cut points of counts(t) / days(t). */
interface CutSums {
  produced: PerDay;
  consumed: PerDay;
  bought: PerDay;
  shortfall: PerDay;
  bySource: Record<string, PerDay>;
}

const emptySums = (): CutSums => ({ produced: {}, consumed: {}, bought: {}, shortfall: {}, bySource: {} });

/** Add one cut's counts per day to the sums; false (nothing added) when no time has passed. */
function addCutTo(sums: CutSums, s: CountSnapshot): boolean {
  const days = s.seconds / 86400;
  if (!(days > 0)) return false;
  const add = (into: PerDay, from: Readonly<Record<string, number>>) => {
    for (const [item, n] of Object.entries(from)) if (n > 0) into[item] = (into[item] ?? 0) + n / days;
  };
  add(sums.produced, s.produced);
  add(sums.consumed, s.consumed);
  add(sums.bought, s.bought);
  add(sums.shortfall, s.shortfall);
  for (const [k, items] of Object.entries(s.bySource)) add((sums.bySource[k] ??= {}), items);
  return true;
}

function meanOf(sums: Readonly<PerDay>, cuts: number): PerDay {
  const out: PerDay = {};
  for (const [k, v] of Object.entries(sums)) if (v > 0) out[k] = v / cuts;
  return out;
}

/** The window means of the cut sums. */
function windowMeans(sums: CutSums, cuts: number): Pick<RunResult, "produced" | "consumed" | "bought" | "shortfall"> & { bySource: Record<string, PerDay> } {
  return {
    produced: meanOf(sums.produced, cuts),
    consumed: meanOf(sums.consumed, cuts),
    bought: meanOf(sums.bought, cuts),
    shortfall: meanOf(sums.shortfall, cuts),
    bySource: Object.fromEntries(Object.entries(sums.bySource).map(([k, m]) => [k, meanOf(m, cuts)])),
  };
}

/** `a + b` per item (either may be missing items). */
function addCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** One cumulative snapshot of a two-part timeline: the first part's counts at its end plus the second part's at `s`, at timeline cycle `cycle`. */
export function joinSnapshots(first: CountSnapshot, s: CountSnapshot, cycle: number): CountSnapshot {
  const bySource: CountSnapshot["bySource"] = {};
  for (const k of new Set([...Object.keys(first.bySource), ...Object.keys(s.bySource)])) bySource[k] = addCounts(first.bySource[k] ?? {}, s.bySource[k] ?? {});
  return {
    cycle,
    seconds: first.seconds + s.seconds,
    produced: addCounts(first.produced, s.produced),
    consumed: addCounts(first.consumed, s.consumed),
    bought: addCounts(first.bought, s.bought),
    shortfall: addCounts(first.shortfall, s.shortfall),
    bySource,
  };
}

/** What a timeline result keeps of its flow part (or, without one, its builder part). */
export type TimelineRest = Omit<RunResult, "cycles" | "days" | "window" | "produced" | "consumed" | "bought" | "shortfall" | "bySource" | "trail" | "prep">;

/**
 * The "from nothing" timeline's result (docs/plans/leaderboard-v3.md §3.3): the builder ran for
 * `prep.cycles` = T* cycles (`prepEnd` = its counts then), then the flow from its own cycle 0. The
 * per-day maps are the v2 window mean over the timeline's cuts C, C + CUT_STEP, ..., `to`:
 * counts(t) = prep + flow(t − T*), days(t) = prep days + flow days(t − T*). `trail` covers the
 * timeline's last TRAIL_SHARE. `flowAt(n)` returns the flow's cumulative counts at its own cycle n;
 * the cycles read are exactly those ≡ C (mod CUT_STEP) in [max(0, C − T*), to − T*] plus the
 * trail's start and the end (`timelineCycles`).
 *
 * With `prep.done` false there is no flow part: the builder alone is the timeline, and `prepAt(t)`
 * gives its counts at timeline cycle t (only the same cut, trail and end cycles are read).
 *
 * Everything that isn't a count (`rest`: effort, starved, ramp, uptime, startItems, ...) is taken
 * as given; the caller decides whose it is.
 */
export function stitch(args: {
  from: number;
  to: number;
  prep: PrepInfo;
  prepEnd: CountSnapshot | null;
  flowAt: ((cycle: number) => CountSnapshot | undefined) | null;
  prepAt?: (cycle: number) => CountSnapshot | undefined;
  rest: TimelineRest;
}): RunResult {
  const { from, to, prep } = args;
  const T = prep.done ? prep.cycles : to;
  const at = (t: number): CountSnapshot | undefined => {
    if (!prep.done || t < T) return args.prepAt?.(t);
    if (!args.flowAt) return undefined;
    const s = args.flowAt(t - T);
    if (!s) return undefined;
    return args.prepEnd ? joinSnapshots(args.prepEnd, s, t) : { ...s, cycle: t };
  };
  const sums = emptySums();
  let cuts = 0;
  for (let t = from; t <= to; t += CUT_STEP) {
    const s = at(t);
    if (!s) throw new Error(`stitch: no counts at timeline cycle ${t}`);
    if (addCutTo(sums, s)) cuts += 1;
  }
  const end = at(to);
  const trailAt = at(trailStart(to));
  if (!end || !trailAt) throw new Error("stitch: no counts at the end or the trail's start");
  const days = end.seconds / 86400;
  const means = cuts > 0 ? windowMeans(sums, cuts) : { produced: perDay(end.produced, days), consumed: perDay(end.consumed, days), bought: perDay(end.bought, days), shortfall: perDay(end.shortfall, days), bySource: Object.fromEntries(Object.entries(end.bySource).map(([k, m]) => [k, perDay(m, days)])) };
  const d = (end.seconds - trailAt.seconds) / 86400;
  return {
    ...args.rest,
    cycles: to,
    days,
    window: { from, to, cuts },
    ...means,
    trail: {
      from: trailAt.cycle,
      produced: rateBetween(trailAt.produced, end.produced, d),
      consumed: rateBetween(trailAt.consumed, end.consumed, d),
      bought: rateBetween(trailAt.bought, end.bought, d),
      shortfall: rateBetween(trailAt.shortfall, end.shortfall, d),
      bySource: nestedRateBetween(trailAt.bySource, end.bySource, d),
    },
    prep: { ...prep, kit: { ...prep.kit } },
  };
}

/** The flow-own cycles a stitched timeline reads (see `stitch`), for a flow started at T*. */
export function timelineCycles(from: number, to: number, T: number): Set<number> {
  const out = new Set<number>();
  for (let t = from; t <= to; t += CUT_STEP) if (t >= T) out.add(t - T);
  const trail = trailStart(to);
  if (trail >= T) out.add(trail - T);
  out.add(to - T);
  return out;
}

const resolvers = new WeakMap<GameData, (layout: StepLayout) => ResolvedLayout>();
function resolverFor(data: GameData) {
  let r = resolvers.get(data);
  if (!r) resolvers.set(data, (r = createLayoutResolver(data)));
  return r;
}

const MAX_STARVED = 8;
/** Starved cells the rest of a run may average and still count its layouts as complete. */
export const RAMP_STARVED_MAX = 0.5;
/** Average empty cells on one plot, of items the run never produced, that mark a run that never got going. */
export const CANT_START_CELLS = 5;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface RecorderPlan {
  /** First cut point: the author's length C. */
  from: number;
  /** The run's last cycle: `endCycles(C)`. */
  to: number;
  /**
   * Snapshot mode (Leaderboard v3): also keep the cumulative counts at every observed cycle this
   * returns true for (`snapshots()`), e.g. the cycles a stitched "from nothing" timeline reads.
   * Doesn't change the result.
   */
  snapshotAt?: (cycle: number) => boolean;
}

/**
 * Watches one verification run and builds its `RunResult`. Call `observe` with the state right
 * after setup and after every cycle (`engine.run(..., { onCycle })`); it only reads the state.
 */
export class RunRecorder {
  private readonly data: GameData;
  private readonly plan: RecorderPlan;
  private readonly snapshotAt: ((cycle: number) => boolean) | undefined;
  /** Snapshot mode: cycle -> the counts then. */
  private readonly kept = new Map<number, CountSnapshot>();
  private readonly trailFrom: number;
  private readonly midAt: number;
  private cuts = 0;
  /** Sum over the cut points of counts(t) / days(t). */
  private readonly sums: CutSums = emptySums();
  private trailSnap: Snapshot | null = null;
  private mid: Snapshot | null = null;
  /** "plot|step|item" -> cell-cycles starved. */
  private readonly starvedCells = new Map<string, { plot: number; step: string; item: ItemId; n: number }>();
  private starvedCycles = 0;
  /** Starved cells at each observed cycle (index = cycle). */
  private readonly starvedSeries: number[] = [];
  /** Mutation items whose stock was below 0 at the end of some cycle (owed beyond a session). */
  private readonly owedAcross = new Set<ItemId>();
  /** Per owed item: the lowest stock seen so far (to catch a new in-session peak at its cycle). */
  private readonly lowest = new Map<ItemId, number>();
  /** Per owed item: [days elapsed, most owed during that cycle] for every cycle it was owed. */
  private readonly owedSeries = new Map<ItemId, [number, number][]>();

  constructor(data: GameData, plan: RecorderPlan) {
    this.data = data;
    this.plan = { from: Math.max(0, Math.floor(plan.from)), to: Math.max(0, Math.floor(plan.to)) };
    this.snapshotAt = plan.snapshotAt;
    this.trailFrom = trailStart(this.plan.to);
    this.midAt = Math.floor(this.plan.to / 2);
  }

  /** Snapshot mode: the counts kept so far, by cycle. */
  snapshots(): ReadonlyMap<number, CountSnapshot> {
    return this.kept;
  }

  private snapshot(state: SimulationState): Snapshot {
    const owed: Record<ItemId, number> = {};
    for (const [item, n] of Object.entries(state.inventory)) if (n < 0 && this.data.mutations[item]) owed[item] = -n;
    return { ...countSnapshot(state), owed };
  }

  private addCut(s: CountSnapshot): void {
    if (addCutTo(this.sums, s)) this.cuts += 1;
  }

  /** Layout cells empty for lack of stock right now, per (plot, step, item). */
  private starvedNow(state: SimulationState): number {
    const config = state.scenario.settings.config;
    const resolve = resolverFor(this.data);
    let total = 0;
    for (const plot of state.plots) {
      const runner = state.flows.find((r) => r.plotId === plot.id);
      const def = state.scenario.plots.find((p) => p.id === plot.id);
      const step = runner && def ? def.flow.steps[runner.stepIndex] : undefined;
      if (!step) continue;
      let layout: ResolvedLayout;
      try {
        layout = resolve(state.scripts?.plots[String(plot.id)]?.layout ?? step.layout);
      } catch {
        continue;
      }
      for (const [item, n] of Object.entries(layoutMissing(plot, layout, (k) => isFreePlacedItem(k, config)))) {
        // Items the run could get anyway: bought (normal), borrowed (debt allowed, or an open setup loan).
        if (canBuy(state, item)) continue;
        if (config.allowMutationDebt === true && this.data.mutations[item]) continue;
        if (state.ledger[item]?.loanOpen) continue;
        const short = n - Math.max(0, state.inventory[item] ?? 0);
        if (short <= 0) continue;
        total += short;
        const key = `${plot.id}|${step.id}|${item}`;
        const e = this.starvedCells.get(key);
        if (e) e.n += short;
        else this.starvedCells.set(key, { plot: plot.id, step: step.id, item, n: short });
      }
    }
    return total;
  }

  observe(state: SimulationState): void {
    const c = state.cycle;
    if (this.snapshotAt?.(c)) this.kept.set(c, countSnapshot(state));
    if (c >= this.plan.from && c <= this.plan.to && (c - this.plan.from) % CUT_STEP === 0) this.addCut(this.snapshot(state));
    if (c === this.trailFrom) this.trailSnap = this.snapshot(state);
    if (c === this.midAt) this.mid = this.snapshot(state);
    for (const [item, n] of Object.entries(state.inventory)) if (n < 0) this.owedAcross.add(item);
    this.trackOwed(state);
    const starved = this.starvedNow(state);
    this.starvedCycles += 1;
    this.starvedSeries[c] = starved;
  }

  /**
   * Borrowing runs: per mutation item, the most owed during this cycle: the end-of-cycle debt, or
   * a new low of `ledger.minStock` reached inside the session (a borrow given back before the
   * cycle ended). Only cycles with something owed are kept.
   */
  private trackOwed(state: SimulationState): void {
    const config = state.scenario.settings.config;
    if (config.allowMutationDebt !== true && config.bootstrapDebt !== true) return;
    const days = state.elapsedSeconds / 86400;
    for (const [item, row] of Object.entries(state.ledger)) {
      if (!this.data.mutations[item] || row.minStock >= 0) continue;
      const before = this.lowest.get(item) ?? 0;
      let peak = Math.max(0, -(state.inventory[item] ?? 0));
      if (row.minStock < before) {
        peak = Math.max(peak, -row.minStock);
        this.lowest.set(item, row.minStock);
      }
      if (peak <= 0) continue;
      const series = this.owedSeries.get(item);
      if (series) series.push([days, peak]);
      else this.owedSeries.set(item, [[days, peak]]);
    }
  }

  /** See `RampInfo.complete`. Null unless every cycle was observed. */
  private completeCycle(): number | null {
    const s = this.starvedSeries;
    if (this.starvedCycles !== s.length) return null;
    let suffix = 0;
    let best: number | null = null;
    for (let t = s.length - 1; t >= 0; t--) {
      const v = s[t] ?? 0;
      suffix += v;
      if (v === 0 && suffix / (s.length - t) < RAMP_STARVED_MAX) best = t;
    }
    return best !== null && best <= this.plan.from ? best : null;
  }

  /** The run's result at its final state. */
  result(state: SimulationState, sustainable: boolean): RunResult {
    const end = this.snapshot(state);
    const days = state.elapsedSeconds / 86400;
    const reached = state.cycle >= this.plan.to;
    let produced: PerDay, consumed: PerDay, bought: PerDay, shortfall: PerDay, bySource: Record<string, PerDay>;
    if (this.cuts > 0) {
      ({ produced, consumed, bought, shortfall, bySource } = windowMeans(this.sums, this.cuts));
    } else {
      // The run stopped before the window (a failed seed): totals per day at the end.
      produced = perDay(end.produced, days);
      consumed = perDay(end.consumed, days);
      bought = perDay(end.bought, days);
      shortfall = perDay(end.shortfall, days);
      bySource = Object.fromEntries(Object.entries(end.bySource).map(([k, m]) => [k, perDay(m, days)]));
    }
    const market = state.summary.market;
    const out: RunResult = {
      cycles: state.cycle,
      days,
      window: { from: this.plan.from, to: this.plan.to, cuts: this.cuts },
      produced,
      consumed,
      bought,
      built: market ? { ...market.built } : {},
      shortfall,
      uptime: uptimeRatio(state.summary.uptime),
      sustainable,
      effort: effortResult(state.summary.effort),
      halted: !!state.scripts?.halt,
      bySource,
      stepTime: stepTimeOf(state),
    };
    if (reached && this.trailSnap) {
      const t = this.trailSnap;
      const d = (end.seconds - t.seconds) / 86400;
      out.trail = {
        from: t.cycle,
        produced: rateBetween(t.produced, end.produced, d),
        consumed: rateBetween(t.consumed, end.consumed, d),
        bought: rateBetween(t.bought, end.bought, d),
        shortfall: rateBetween(t.shortfall, end.shortfall, d),
        bySource: nestedRateBetween(t.bySource, end.bySource, d),
      };
    }
    const config = state.scenario.settings.config;
    if (config.allowMutationDebt === true || config.bootstrapDebt === true) {
      const upkeep: Record<ItemId, number> = {};
      if (reached && this.mid) {
        const d = (end.seconds - this.mid.seconds) / 86400;
        for (const [item, n] of Object.entries(end.owed)) {
          const g = d > 0 ? (n - (this.mid.owed[item] ?? 0)) / d : 0;
          if (g > 0) upkeep[item] = g;
        }
      }
      // What the player needs to start with, and what is never given back, without the debt the
      // upkeep keeps adding: an item owed more every day is upkeep, not a starting stock.
      const startItems: Record<ItemId, number> = {};
      for (const [item, row] of Object.entries(state.ledger)) {
        if (!this.data.mutations[item] || row.minStock >= 0) continue;
        const most = -row.minStock;
        const u = upkeep[item] ?? 0;
        let need = most;
        if (u > 0) {
          need = 0;
          for (const [d, peak] of this.owedSeries.get(item) ?? []) need = Math.max(need, peak - u * d);
          need = round3(Math.min(most, need));
        }
        if (need > 0) startItems[item] = need;
      }
      const usedUp: Record<ItemId, number> = {};
      for (const [item, n] of Object.entries(end.owed)) {
        const once = round3(Math.min(n, n - (upkeep[item] ?? 0) * days));
        if (once > 0) usedUp[item] = once;
      }
      out.startItems = startItems;
      out.sessionOnly = Object.keys(startItems).filter((item) => !this.owedAcross.has(item)).sort();
      out.usedUp = usedUp;
      out.upkeep = upkeep;
    }
    const cycles = Math.max(1, this.starvedCycles);
    const allStarved = [...this.starvedCells.values()]
      .map((e) => ({ plot: e.plot, step: e.step, item: e.item, cells: round3(e.n / cycles) }))
      .filter((e) => e.cells > 0)
      .sort((a, b) => b.cells - a.cells || a.plot - b.plot || a.step.localeCompare(b.step) || a.item.localeCompare(b.item));
    out.starved = allStarved.slice(0, MAX_STARVED);
    // Never got going: on some plot, cells empty for items the run never produced at all.
    const neverGrown = new Map<number, { cells: number; items: Set<ItemId> }>();
    for (const e of allStarved) {
      if ((end.produced[e.item] ?? 0) > 0) continue;
      const p = neverGrown.get(e.plot) ?? { cells: 0, items: new Set<ItemId>() };
      p.cells += e.cells;
      p.items.add(e.item);
      neverGrown.set(e.plot, p);
    }
    let worst: { plot: number; cells: number; items: ItemId[] } | null = null;
    for (const [plot, p] of neverGrown) {
      if (p.cells >= CANT_START_CELLS && (!worst || p.cells > worst.cells || (p.cells === worst.cells && plot < worst.plot))) worst = { plot, cells: round3(p.cells), items: [...p.items].sort() };
    }
    if (worst) out.cantStart = worst;
    const complete = this.completeCycle();
    if (this.mid && this.mid.cycle < end.cycle) {
      const d = (end.seconds - this.mid.seconds) / 86400;
      out.ramp = { complete, produced: rateBetween(this.mid.produced, end.produced, d), bought: rateBetween(this.mid.bought, end.bought, d) };
    } else {
      out.ramp = { complete, produced: {}, bought: {} };
    }
    return out;
  }
}

/** Summarise a finished state without a recorder (one cut at the end, no window): totals per day. */
export function runResult(state: SimulationState, sustainable: boolean, data: GameData): RunResult {
  const rec = new RunRecorder(data, { from: state.cycle, to: state.cycle });
  rec.observe(state);
  return rec.result(state, sustainable);
}

// ---- A cell from its seeds -----------------------------------------------------------------------

/** The median of a list of numbers (the lower middle value for an even count). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** A seed's result with its trailing rates in place of the window means (no `trail`). */
export function trailResult(r: RunResult): RunResult {
  const { trail, ...rest } = r;
  if (!trail) return rest;
  return { ...rest, produced: trail.produced, consumed: trail.consumed, bought: trail.bought, shortfall: trail.shortfall, bySource: trail.bySource };
}

/**
 * "Still producing" failed: the trailing rate is below TRAIL_MIN × the window-mean rate. A "from
 * nothing" result carries its own verdict (`prep.slow`, Leaderboard v3.1): its trail against the
 * flow's own rate, so the builder's crops can neither hide nor fake a slowdown. Mirrors
 * SkyShards-API `stats.seed_slowing`.
 */
export function seedSlowing(r: RunResult, value: (r: RunResult) => number): boolean {
  if (!r.trail) return false;
  if (typeof r.prep?.slow === "boolean") return r.prep.slow;
  const v = value(r);
  return v > 0 && value(trailResult(r)) < TRAIL_MIN * v;
}

/**
 * A cell from all its seeds (each must have succeeded): the counts of the median seed by the
 * board's reference valuation, never a per-item mix of seeds. When most seeds slow down at the end
 * the cell is the median seed by its trailing value, holding its trailing rates (`slowing`).
 * Ties go to the earlier seed. Mirrors SkyShards-API `stats.median_cell`.
 */
export function cellResult(results: readonly RunResult[], value: (r: RunResult) => number): RunResult {
  if (results.length === 0) throw new Error("cellResult: no results");
  const slowing = results.filter((r) => seedSlowing(r, value)).length * 2 > results.length;
  const scored = results.map((r, i) => {
    const res = slowing ? trailResult(r) : r;
    return { res, v: value(res), i };
  });
  scored.sort((a, b) => a.v - b.v || a.i - b.i);
  const chosen = scored[Math.floor((scored.length - 1) / 2)].res;
  const { trail: _trail, ...cell } = chosen;
  void _trail;
  return slowing ? { ...cell, slowing: true } : cell;
}

/** best / median of a valuation over seeds (the outlier check); 1 when all equal, Infinity when the median is 0 and some seed is not. */
export function spreadRatio(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const best = Math.max(...values);
  const mid = median(values);
  if (best <= 0) return 1;
  if (mid <= 0) return Infinity;
  return best / mid;
}
