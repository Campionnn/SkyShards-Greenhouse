// Experiment: run one static layout on plot 1 until the inventory holds `want` of an item.
// Usage: node vite-node tools/rose-dragon/trial.ts '<json>'
//   { code | recipe:"m:n", want:{item:n}, inv:{...}, seeds:[...], max:600, policies:{} }
import { readFileSync } from "node:fs";
import { makeScenario, runUntil, FREE_STOCK } from "./sim";
import { decode, render } from "./layouts";

const a = JSON.parse(process.argv[2]);
let code: string = a.code;
if (a.recipe) code = (JSON.parse(readFileSync(a.file ?? "tmp-rose/recipes-hi.json", "utf8")) as Record<string, { code: string }>)[a.recipe].code;
if (a.show) console.log(render(decode(code)));
const want: Record<string, number> = a.want;
const rows: string[] = [];
let tot = 0;
for (const seed of a.seeds ?? [1, 2, 3, 4, 5, 6, 7, 8]) {
  const sc = makeScenario(
    [{ id: 1, flow: { steps: [{ id: "s", label: "s", layout: { code }, exits: [], policies: a.stepPolicies }], loop: false, startIndex: 0 } }],
    { ...FREE_STOCK, ...(a.inv ?? {}) },
    seed,
    a.policies ?? {}
  );
  const r = runUntil(sc, { maxCycles: a.max ?? 600, chunk: 1, stop: (s) => Object.entries(want).every(([k, n]) => (s.inventory[k] ?? 0) - (a.inv?.[k] ?? 0) >= n) });
  tot += r.cycles;
  const placed = r.state.summary.placedItems;
  const destroyed = r.state.summary.destroyed;
  rows.push(`seed ${seed}: ${r.cycles} cycles (${r.days}d) placed ${JSON.stringify(placed)} destroyed ${JSON.stringify(destroyed)} harvested ${JSON.stringify(Object.fromEntries(Object.entries(r.state.summary.harvested).filter(([k]) => !!want[k] || k in (a.watch ?? {}))))}`);
}
console.log(rows.join("\n"));
console.log("avg cycles", (tot / rows.length).toFixed(1));
