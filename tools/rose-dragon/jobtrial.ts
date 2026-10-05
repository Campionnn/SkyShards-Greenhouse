// Scratch: solve a job layout (cols 0-7 + the unique-crop strip in col 9), then simulate it
// standalone with plenty of inputs until `want` items are produced.
// Usage: node vite-node tools/rose-dragon/jobtrial.ts '<json>'
//   { targets:[{mutation,count}], want:{item:n}, ew?:{}, seeds?:[], max?, show?, cols?:8, strip?:true, tl?:15 }
import { solve, rect } from "./solver";
import { encode, fromSolve, inputCost, merge, render, type Layout } from "./layouts";
import { makeScenario, runUntil, FREE_STOCK } from "./sim";

export const STRIP: Layout = {
  inputs: ["potato", "pumpkin", "cactus", "carrot", "melon", "sugar_cane", "wheat", "cocoa_beans", "nether_wart", "red_mushroom"].map((cropId, r) => ({ cropId, position: [r, 9] as [number, number] })),
  targets: [],
};

const a = JSON.parse(process.argv[2]);
const res = await solve({ cells: rect(0, 0, 9, (a.cols ?? 8) - 1), targets: a.targets, effectWeights: a.ew, timeLimit: a.tl ?? 15 });
const base = fromSolve(res);
const l = a.strip === false ? base : merge(base, STRIP);
const code = encode(l);
if (a.show !== false) console.log(res.status, JSON.stringify(inputCost(base)), "\n" + render(l));
const cost = inputCost(base);
const inv: Record<string, number> = { ...FREE_STOCK };
for (const [k, v] of Object.entries(cost)) inv[k] = (inv[k] ?? 0) + v * 10;
let tot = 0;
const seeds: number[] = a.seeds ?? [1, 2, 3, 4, 5, 6];
for (const seed of seeds) {
  const sc = makeScenario([{ id: 1, flow: { steps: [{ id: "s", label: "s", layout: { code }, exits: [] }], loop: false, startIndex: 0 } }], inv, seed);
  const r = runUntil(sc, { maxCycles: a.max ?? 300, chunk: 1, stop: (s) => Object.entries(a.want as Record<string, number>).every(([k, n]) => (s.inventory[k] ?? 0) - (inv[k] ?? 0) >= n) });
  tot += r.cycles;
  const used = Object.fromEntries(Object.keys(cost).map((k) => [k, (inv[k] ?? 0) - (r.state.inventory[k] ?? 0)]));
  console.log(`seed ${seed}: ${r.cycles}c got ${JSON.stringify(Object.fromEntries(Object.keys(a.want).map((k) => [k, (r.state.inventory[k] ?? 0) - (inv[k] ?? 0)])))} used ${JSON.stringify(used)} uniq ${r.state.uniqueCropCount}`);
}
console.log("avg", (tot / seeds.length).toFixed(1), "code", code);
