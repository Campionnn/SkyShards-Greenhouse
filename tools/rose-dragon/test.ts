/**
 * Test harness: run a flows file from the beginning with various starting inventories
 * and seeds until every plot holds "done" (or a cycle cap), then check the Rose Dragon
 * legendaries are owned.
 *
 *   node <vite-node> tools/rose-dragon/test.ts [flows.json] [--seeds 1-8] [--inv empty,mid,...] [--random N] [--max 3000] [--verbose]
 */
import { readFileSync } from "node:fs";
import type { ScenarioPlot, SimulationState } from "../../src/simulator/sim/state";
import { engine, FREE_STOCK, makeScenario, LEGENDARY_GOAL } from "./sim";
import { INVENTORIES, randomInventory } from "./inventories";

/** A named inventory, or "random<N>". */
export function inventoryOf(name: string): Record<string, number> {
  const m = /^random(\d+)$/.exec(name);
  if (m) return randomInventory(Number(m[1]));
  if (!INVENTORIES[name]) throw new Error(`unknown inventory ${name}`);
  return INVENTORIES[name];
}

export interface Result {
  inv: string;
  seed: number;
  cycles: number;
  days: number;
  ok: boolean;
  finished: boolean;
  missing: Record<string, number>;
  /** Per plot: share of cycles spent building a real layout (not waiting / done). */
  busy: Record<number, number>;
  steps: Record<number, string>;
  stuckOn?: Record<number, string>;
  debt: number;
  state: SimulationState;
}

export function runOne(plots: ScenarioPlot[], invName: string, seed: number, max: number): Result {
  const inv = { ...FREE_STOCK, ...inventoryOf(invName) };
  const sc = makeScenario(plots, inv, seed);
  let state = engine.initState(sc).state;
  const done = (s: SimulationState) => s.flows.every((f) => f.finished || plots.find((p) => p.id === f.plotId)!.flow.steps[f.stepIndex].id === "done");
  while (state.cycle < max && !done(state)) state = engine.run(state, 3, { retainEvents: "none" }).state;
  const missing: Record<string, number> = {};
  for (const [k, n] of Object.entries(LEGENDARY_GOAL)) if ((state.inventory[k] ?? 0) < n) missing[k] = n - (state.inventory[k] ?? 0);
  const busy: Record<number, number> = {};
  const steps: Record<number, string> = {};
  for (const f of state.flows) {
    let b = 0;
    for (const h of f.history) {
      const len = (h.endCycle ?? state.cycle) - h.startCycle;
      if (h.stepId !== "hub" && h.stepId !== "done") b += len;
    }
    busy[f.plotId] = state.cycle ? +(b / state.cycle).toFixed(2) : 0;
    steps[f.plotId] = f.history
      .filter((h) => !h.skipped)
      .map((h) => `${h.stepId}:${(h.endCycle ?? state.cycle) - h.startCycle}`)
      .join(" > ");
  }
  const res: Result = {
    inv: invName,
    seed,
    cycles: state.cycle,
    days: +(state.elapsedSeconds / 86400).toFixed(1),
    ok: Object.keys(missing).length === 0,
    finished: done(state),
    missing,
    busy,
    steps,
    debt: state.summary.debtEvents,
    state,
  };
  if (!res.finished) {
    res.stuckOn = Object.fromEntries(state.flows.map((f) => [f.plotId, plots.find((p) => p.id === f.plotId)!.flow.steps[f.stepIndex].id]));
  }
  return res;
}

function parseSeeds(s: string): number[] {
  return s.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
}

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = args[0] && !args[0].startsWith("--") ? args[0] : "rose-dragon.flows.json";
const plots = (JSON.parse(readFileSync(file, "utf8")) as { plots: ScenarioPlot[] }).plots;
const seeds = parseSeeds(opt("seeds", "1-4"));
// --random N adds random1..randomN (alone unless --inv is given too)
const random = Number(opt("random", "0"));
const invs = [
  ...(args.includes("--inv") || !random ? opt("inv", Object.keys(INVENTORIES).join(",")).split(",") : []),
  ...Array.from({ length: random }, (_, i) => `random${i + 1}`),
];
const max = Number(opt("max", "3000"));
const verbose = args.includes("--verbose");

let fails = 0;
for (const inv of invs) {
  const rs: Result[] = [];
  for (const seed of seeds) {
    const r = runOne(plots, inv, seed, max);
    rs.push(r);
    if (!r.ok || !r.finished) fails++;
    const flag = r.ok && r.finished ? "OK  " : "FAIL";
    console.log(
      `${flag} ${inv.padEnd(13)} seed ${String(seed).padStart(3)} ${String(r.cycles).padStart(5)}c ${String(r.days).padStart(6)}d busy ${JSON.stringify(r.busy)}` +
        (r.ok ? "" : ` missing ${JSON.stringify(r.missing)}`) +
        (r.stuckOn ? ` stuck ${JSON.stringify(r.stuckOn)}` : "") +
        (r.debt ? ` debt ${r.debt}` : "")
    );
    if (verbose || !r.ok || !r.finished) {
      for (const [p, s] of Object.entries(r.steps)) console.log(`     P${p}: ${s}`);
      if (!r.ok || !r.finished) {
        const inv2 = Object.entries(r.state.inventory).filter(([k, v]) => v > 0 && !(k in FREE_STOCK) && !/^(wheat|potato|carrot|pumpkin|melon|cocoa|sugar|cactus|nether|red_|brown_|moonflower|sunflower|wild_rose|seeds|ethereal)/.test(k));
        console.log(`     inv ${JSON.stringify(Object.fromEntries(inv2))}`);
      }
    }
  }
  const avg = rs.reduce((a, r) => a + r.days, 0) / rs.length;
  console.log(`  -> ${inv}: avg ${avg.toFixed(1)} days, ${rs.filter((r) => r.ok && r.finished).length}/${rs.length} ok`);
}
console.log(fails ? `${fails} FAILED` : "ALL OK");
