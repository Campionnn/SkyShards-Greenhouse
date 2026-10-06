/** Solver-free paired end-to-end comparison, including real paid input consumption.
 * node <vite-node> tools/rose-dragon/benchmark.ts before.json after.json --seeds 1-10 --json comparison.json
 * This deliberately does not report occupancy as a productivity measure.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { ScenarioPlot } from "../../src/simulator/sim/state";
import { INVENTORIES } from "./inventories";
import { engine } from "./sim";
import { runOne } from "./test-harness";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const files = args.slice(0, 2);
if (files.length !== 2 || files.some((p) => p.startsWith("--"))) throw new Error("Supply before and after flow paths");
const seeds = option("seeds", "1-10").split(",").flatMap((part) => {
  const [first, last = first] = part.split("-").map(Number);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) throw new Error(`Invalid seed range ${part}`);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
});
const inventories = option("inv", Object.keys(INVENTORIES).join(",")).split(",");
const max = Number(option("max", "3000"));
const results = files.map((file) => {
  const { plots } = JSON.parse(readFileSync(file, "utf8")) as { plots: ScenarioPlot[] };
  const runs = inventories.flatMap((inv) => seeds.map((seed) => {
    const { state, ...report } = runOne(plots, inv, seed, max);
    const consumption = Object.fromEntries(Object.entries(state.ledger).filter(([, row]) => row.consumed > 0).map(([id, row]) => [id, row.consumed]));
    const mutationItems = Object.entries(consumption).filter(([id]) => !!engine.data.mutations[id]).reduce((sum, [, n]) => sum + n, 0);
    return { ...report, mutationItems, consumption, deadPlants: consumption.dead_plant ?? 0, fermento: consumption.fermento ?? 0 };
  }));
  return { file, runs };
});
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const summaries = inventories.map((inv) => {
  const variants = results.map(({ file, runs }) => {
    const rr = runs.filter((r) => r.inv === inv);
    return { file, count: rr.length, pass: rr.every((r) => r.ok && r.finished && r.debt === 0), cycles: mean(rr.map((r) => r.cycles)), days: mean(rr.map((r) => r.days)), mutationItems: mean(rr.map((r) => r.mutationItems)), maxDeadPlants: Math.max(...rr.map((r) => r.deadPlants)), maxFermento: Math.max(...rr.map((r) => r.fermento)) };
  });
  const [before, after] = variants;
  return { inv, variants, cycleChangePct: (after.cycles / before.cycles - 1) * 100, mutationChangePct: before.mutationItems ? (after.mutationItems / before.mutationItems - 1) * 100 : null };
});
console.log("inventory       before days  after days  time change  before paid  after paid  all pass");
for (const { inv, variants: [before, after], cycleChangePct } of summaries) {
  console.log(`${inv.padEnd(15)} ${before.days.toFixed(2).padStart(11)} ${after.days.toFixed(2).padStart(11)} ${(cycleChangePct.toFixed(1) + "%").padStart(12)} ${before.mutationItems.toFixed(1).padStart(12)} ${after.mutationItems.toFixed(1).padStart(11)} ${before.pass && after.pass}`);
}
if (args.includes("--json")) writeFileSync(option("json", ""), JSON.stringify({ seeds, inventories, summaries, results }, null, 2) + "\n");
if (summaries.some((s) => s.variants.some((v) => !v.pass))) process.exitCode = 1;
