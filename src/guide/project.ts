/**
 * The zero-time login projection behind every Guide decision.
 *
 * A check-in becomes a real scenario: each plot starts on the farm the player reported and the
 * inventory is what they own. The plots are then decided **in login order**, each one by its own
 * shipped `onStart` hook (`if (complete()) return finish(); tend(plot);`), against the shared stock
 * the plots before it left behind. That is exactly what a real login does, so the three answers form
 * one coherent plan: Plot 2 never assumes stock that Plot 1 already spent.
 *
 * Bootstrap, without touching the script source:
 * 1. `engine.initState` runs on the scenario **with the scripts detached**, so it only lays out the
 *    starting farms (setup is free and never draws on the inventory) and takes no decision.
 * 2. The shipped scripts are attached, a fresh script state is created (optionally carrying the
 *    flow's `shared.builtOnce` memory from earlier check-ins), and their top-level code runs.
 *    This is the same order as an ordinary `initState`, minus its all-plots `onStart`.
 * 3. The player's observable facts are applied to the plots.
 * 4. Each undecided plot's `onStart` runs through the existing script runtime at cycle 0.
 *
 * Time never advances here; everything after the projection goes through `engine.run`.
 */
import { isFreePlacedItem, MAX_WATER } from "../simulator/config";
import { recomputeEffects, effectiveList } from "../simulator/effects/adapter";
import { createLayoutResolver } from "../simulator/flow/layout";
import { cycleSeconds, effectiveUniqueCrops } from "../simulator/growth/clock";
import { inspectScriptVariables } from "../simulator/script/inspect";
import { emptyScriptsState, ScriptRuntime } from "../simulator/script/runtime";
import type { EncodedValue, HeapEntry } from "../simulator/script/types";
import { makeCycleCtx } from "../simulator/sim/cycle";
import { newScratch } from "../simulator/sim/context";
import { uniqueCropsAcross } from "../simulator/sim/init";
import { newPlant } from "../simulator/sim/plants";
import type { Scenario, SimulationState, TimedEvent } from "../simulator/sim/state";
import { createEngine, type Engine } from "../simulator";
import type { FlowsFile } from "./flow";
import { SUPPLY_ITEMS, HUB, SUPPLIES } from "./flow";
import type { Cell, GuideInput, ItemCount, PlacedCell, PlotAction, PlotOutcome, PlotId, WaitFor } from "./types";

export interface GuideEnv {
  engine: Engine;
  env: { data: Engine["data"]; resolveLayout: ReturnType<typeof createLayoutResolver> };
}

/** The shared engine + layout resolver the Guide uses for every projection and run. */
export function createGuideEnv(engine: Engine = createEngine()): GuideEnv {
  return { engine, env: { data: engine.data, resolveLayout: createLayoutResolver(engine.data) } };
}

/** Plot ids in the order the engine processes them (and the player walks them). */
export function plotOrder(flow: FlowsFile, input: GuideInput): PlotId[] {
  const ids = flow.plots.map((p) => p.id);
  const order = input.settings.config.plotOrder.filter((id) => ids.includes(id));
  return [...order, ...ids.filter((id) => !order.includes(id))];
}

function scenarioFor(flow: FlowsFile, input: GuideInput): Scenario {
  const plots = structuredClone(flow.plots);
  for (const plot of plots) {
    const farm = input.plots[plot.id]?.farm ?? HUB;
    const index = plot.flow.steps.findIndex((s) => s.id === farm);
    if (index < 0) throw new Error(`Plot ${plot.id} has no farm called "${farm}".`);
    plot.flow.startIndex = index;
    delete plot.script; // detached for setup; attached again before any hook runs
  }
  const inventory: Record<string, number> = {};
  for (const [item, amount] of Object.entries(input.inventory)) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${item} has an impossible amount (${amount}).`);
    if (amount > 0) inventory[item] = Math.floor(amount);
  }
  return { plots, startingInventory: inventory, settings: structuredClone(input.settings) };
}

/** `shared = { builtOnce: {...} }` in the script persistence format, so top-level code finds it. */
function sharedWithMemory(builtOnce: Record<string, number>): { heap: HeapEntry[]; shared: EncodedValue } {
  const entries = Object.entries(builtOnce).filter(([, n]) => Number.isFinite(n) && n > 0);
  if (!entries.length) return { heap: [], shared: { u: 1 } };
  return {
    heap: [{ o: [["builtOnce", { r: 1 }]] }, { o: entries.map(([k, n]) => [k, n] as [string, EncodedValue]) }],
    shared: { r: 0 },
  };
}

const sameCell = (a: Cell, b: Cell) => a.row === b.row && a.col === b.col;

/** Apply the player's observable facts to a freshly built state. */
function applyFacts(state: SimulationState, input: GuideInput, guideEnv: GuideEnv): void {
  const { data } = guideEnv.env;
  for (const plot of state.plots) {
    // A placed Blastberry primes at the first tick after it is placed. A farm the player is
    // reporting on was built at an earlier visit, so its Blastberries are primed by now. (The old
    // "tap each primed Blastberry" fact left the Shellfruit farm stuck when nobody tapped.)
    for (const plant of plot.plants) if (plant.kindId === "blastberry") plant.gate.primed = true;
    const facts = input.plots[plot.id]?.facts;
    if (!facts) continue;
    // 1. Paid inputs the player says are gone.
    if (facts.missing.length) plot.plants = plot.plants.filter((p) => !facts.missing.some((c) => sameCell(c, p)));
    // 2. Targets standing on the plot. The player waters what they keep; effect history is not an input.
    for (const standing of facts.standing) {
      if (!data.mutations[standing.kind]) throw new Error(`Plot ${plot.id} reports an unknown plant "${standing.kind}".`);
      plot.plants = plot.plants.filter((p) => !sameCell(p, standing));
      const plant = newPlant(state, data, input.settings.config, standing.kind, standing.row, standing.col, "spawned", 0);
      plant.stage = Math.max(0, Math.floor(standing.stage));
      plant.water = MAX_WATER;
      plot.plants.push(plant);
    }
    plot.plants.sort((a, b) => a.row - b.row || a.col - b.col || a.id - b.id);
    // 3. Effects from the layout in front of the player: a fully grown plant latches what its
    //    current neighbours give it.
    recomputeEffects(plot);
    for (const standing of facts.standing) {
      if (!standing.fullyGrown) continue;
      const plant = plot.plants.find((p) => sameCell(p, standing) && p.kindId === standing.kind);
      if (!plant) continue;
      plant.lockedEffects = effectiveList(plant.held);
      plant.fullyGrownAtCycle = 0;
    }
    // 4. A Devourer farm harvested or decayed since it was built needs its refresh exit.
    if (facts.devourerRefresh) {
      const runner = state.flows.find((r) => r.plotId === plot.id);
      if (runner) runner.harvestedInStep = { ...(runner.harvestedInStep ?? {}), devourer: 1 };
    }
  }
}

/** The `guide` record the generated scripts keep for each plot (tools/rose-dragon/scripted.ts). */
interface GuideRecord {
  action?: string;
  why?: string;
  waitFor?: WaitFor[];
}

function sharedValue(state: SimulationState, name: string): unknown {
  return inspectScriptVariables(state).find((v) => v.script === "shared" && v.name === name)?.value;
}

function guideRecord(state: SimulationState, plotId: PlotId): GuideRecord | null {
  const map = sharedValue(state, "guide");
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const raw = (map as Record<string, unknown>)[String(plotId)];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    action: typeof r.action === "string" ? r.action : undefined,
    why: typeof r.why === "string" ? r.why : undefined,
    waitFor: Array.isArray(r.waitFor)
      ? (r.waitFor as unknown[]).filter((w): w is WaitFor => !!w && typeof w === "object" && typeof (w as WaitFor).item === "string")
      : [],
  };
}

function builtOnceOf(state: SimulationState): Record<string, number> {
  const value = sharedValue(state, "builtOnce");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number"));
}

function farmOf(state: SimulationState, plotId: PlotId): string {
  const plot = state.scenario.plots.find((p) => p.id === plotId);
  const runner = state.flows.find((r) => r.plotId === plotId);
  if (!plot || !runner) throw new Error(`The projected state has no plot ${plotId}.`);
  return plot.flow.steps[runner.stepIndex].id;
}

function tally(ids: string[]): ItemCount[] {
  const map = new Map<string, number>();
  for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
  return [...map].map(([item, count]) => ({ item, count }));
}

/** Paid layout inputs not standing where the current layout puts them. */
function shortOf(state: SimulationState, plotId: PlotId, guideEnv: GuideEnv): { short: ItemCount[]; cells: Cell[] } {
  const plot = state.plots.find((p) => p.id === plotId)!;
  const def = state.scenario.plots.find((p) => p.id === plotId)!;
  const runner = state.flows.find((r) => r.plotId === plotId)!;
  const layout = guideEnv.env.resolveLayout(def.flow.steps[runner.stepIndex].layout);
  const missing = layout.plants.filter(
    (d) => d.origin === "placed" && !isFreePlacedItem(d.kindId) && !plot.plants.some((p) => p.kindId === d.kindId && sameCell(p, d))
  );
  return { short: tally(missing.map((d) => d.kindId)), cells: missing.map((d) => ({ row: d.row, col: d.col })) };
}

/** Reported fully grown targets still standing after the session: the player harvests these now. */
function harvestReadyOf(state: SimulationState, plotId: PlotId, input: GuideInput): ItemCount[] {
  const plot = state.plots.find((p) => p.id === plotId)!;
  const ready = (input.plots[plotId]?.facts?.standing ?? []).filter(
    (s) => s.fullyGrown && plot.plants.some((p) => p.kindId === s.kind && sameCell(p, s) && p.origin === "spawned")
  );
  return tally(ready.map((s) => s.kind));
}

/**
 * Items a session both harvested and placed again. Each harvested plant gives at least one of its
 * own item, so up to that many placements are paid by the harvest itself, not by the stock.
 * Confirming credits these; the player then only adds the extra drops.
 */
function selfFundedOf(harvested: ItemCount[], spent: ItemCount[]): ItemCount[] {
  const out: ItemCount[] = [];
  for (const h of harvested) {
    const funded = Math.min(h.count, spent.find((s) => s.item === h.item)?.count ?? 0);
    if (funded > 0) out.push({ item: h.item, count: funded });
  }
  return out;
}

/**
 * When the script parks a plot on the supplies step: the farm more Dead Plants / Fermento would start and the
 * exact shortfall. Re-runs this plot's hook on a copy with plenty of supplies and diffs the stock.
 */
function supplyBlockOf(flow: FlowsFile, input: GuideInput, plotId: PlotId, before: Record<string, number>, farmsSoFar: Record<PlotId, string>, guideEnv: GuideEnv): PlotOutcome["supplyBlock"] {
  const plenty: Record<string, number> = { ...before };
  for (const item of SUPPLY_ITEMS) plenty[item] = (plenty[item] ?? 0) + 100_000;
  // Only this plot decides; the others keep the farms they have at this point of the login.
  const acted: GuideInput["plots"] = {};
  for (const [id, p] of Object.entries(input.plots)) acted[Number(id)] = { ...p, farm: farmsSoFar[Number(id)] ?? p.farm, acted: Number(id) !== plotId };
  const { outcomes } = projectLogin(flow, { ...input, inventory: plenty, plots: acted }, guideEnv, false);
  const outcome = outcomes.find((o) => o.plotId === plotId);
  if (!outcome || outcome.to === SUPPLIES || outcome.to === HUB) return undefined;
  const need = outcome.spent
    .filter((s) => (SUPPLY_ITEMS as readonly string[]).includes(s.item))
    .map((s) => ({ item: s.item, count: Math.max(0, s.count - (before[s.item] ?? 0)) }))
    .filter((s) => s.count > 0);
  return { farm: outcome.to, need };
}

function actionOf(record: GuideRecord | null, from: string, to: string): PlotAction {
  const a = record?.action;
  if (a === "enter" || a === "stay" || a === "refresh" || a === "done") {
    // A recorded "enter" that ended on the same farm is a stay (the script re-entered nothing).
    if (a === "enter" && from === to) return "stay";
    return a;
  }
  return from === to ? "stay" : "enter";
}

export interface LoginResult {
  state: SimulationState;
  outcomes: PlotOutcome[];
  halt: string | null;
}

/**
 * Project one login: every plot that has not acted yet is decided in login order, sharing stock.
 * Returns the state after the login (the forecast continues from it) and one outcome per decided plot.
 */
export function projectLogin(flow: FlowsFile, input: GuideInput, guideEnv: GuideEnv, explainSupplies = true): LoginResult {
  const { engine, env } = guideEnv;
  const { state } = engine.initState(scenarioFor(flow, input));

  // Attach the shipped scripts and run their top-level code, with the carried memory in `shared`.
  for (const plot of state.scenario.plots) {
    const original = flow.plots.find((p) => p.id === plot.id)?.script;
    if (original) plot.script = structuredClone(original);
  }
  if (flow.script) state.scenario.script = structuredClone(flow.script);
  state.scripts = { ...emptyScriptsState(input.settings.seed), ...sharedWithMemory(input.memory?.builtOnce ?? {}) };

  applyFacts(state, input, guideEnv);
  state.uniqueCropsStanding = uniqueCropsAcross(state, env);
  state.uniqueCropCount = effectiveUniqueCrops(state.uniqueCropsStanding, input.settings.playerStats.floraShard);
  state.lastCycleSeconds = cycleSeconds(input.settings.playerStats, state.uniqueCropCount);

  const runtime = ScriptRuntime.create(state, env);
  const events: TimedEvent[] = [];
  const ctx = makeCycleCtx(
    env,
    state,
    { cycle: 0, active: true, cycleSeconds: state.lastCycleSeconds, firesAt: 0, uniqueCropCount: state.uniqueCropCount },
    events,
    runtime
  );
  runtime.setCycle(ctx, new Map(state.plots.map((p) => [p.id, newScratch()])));
  runtime.runTopLevel();

  const outcomes: PlotOutcome[] = [];
  for (const plotId of plotOrder(flow, input)) {
    if (input.plots[plotId]?.acted) continue;
    const from = farmOf(state, plotId);
    const before = { ...state.inventory };
    const mark = events.length;
    runtime.callHook("onStart", [], plotId);
    runtime.save();
    if (state.scripts?.halt) break;
    const mine = events.slice(mark).filter((e) => e.plotId === plotId);
    const placed = mine.filter((e): e is Extract<TimedEvent, { kind: "placed" }> => e.kind === "placed");
    const spent = placed.filter((e) => e.origin === "placed" && !isFreePlacedItem(e.kindId)).map((e) => e.kindId);
    const harvested = mine
      .filter((e): e is Extract<TimedEvent, { kind: "harvested" }> => e.kind === "harvested" && e.origin === "spawned")
      .map((e) => e.kindId);
    const to = farmOf(state, plotId);
    const record = guideRecord(state, plotId);
    const spentItems = tally(spent);
    const harvestedItems = tally(harvested);
    const { short, cells } = shortOf(state, plotId, guideEnv);
    const farmsSoFar: Record<PlotId, string> = {};
    for (const o of outcomes) farmsSoFar[o.plotId] = o.to;
    outcomes.push({
      plotId,
      from,
      to,
      action: actionOf(record, from, to),
      why: record?.why ?? "",
      waitFor: record?.waitFor ?? [],
      short,
      shortCells: cells,
      spent: spentItems,
      placedCells: placed.map((e): PlacedCell => ({ row: e.row, col: e.col, kind: e.kindId, paid: e.origin === "placed" && !isFreePlacedItem(e.kindId) })),
      harvested: harvestedItems,
      selfFunded: selfFundedOf(harvestedItems, spentItems),
      harvestReady: harvestReadyOf(state, plotId, input),
      inventoryBefore: before,
      inventoryAfter: { ...state.inventory },
      builtOnce: builtOnceOf(state),
      supplyBlock: explainSupplies && (to === SUPPLIES || to === HUB) ? supplyBlockOf(flow, input, plotId, before, farmsSoFar, guideEnv) : undefined,
    });
  }
  runtime.save();
  const halt = state.scripts?.halt ? JSON.stringify(state.scripts.halt) : null;
  return { state, outcomes, halt };
}

/** The decisions for this login. Throws when a script halted (that is a bug, not advice). */
export function decideLogin(flow: FlowsFile, input: GuideInput, guideEnv: GuideEnv): PlotOutcome[] {
  const { outcomes, halt } = projectLogin(flow, input, guideEnv);
  if (halt) throw new Error(`The flow's script stopped while deciding: ${halt}`);
  return outcomes;
}
