// Batch-solve "recipe" layouts and save a summary (scratch exploration).
// Usage: node vite-node tools/rose-dragon/recipes.ts <outfile> <timeLimit> <m:n[+m2:n2],...> [effectWeightsJson]
import { writeFileSync } from "node:fs";
import { solve } from "./solver";
import { encode, fromSolve, inputCost, render, targetCounts } from "./layouts";

const [out, tl, list, ew] = process.argv.slice(2);
const effectWeights = ew ? (JSON.parse(ew) as Record<string, number>) : undefined;
// "a:2+b:1" = one solve with several targets.
const jobs = list.split(",").map((s) => ({ key: s, targets: s.split("+").map((t) => ({ mutation: t.split(":")[0], count: Number(t.split(":")[1]) })) }));
const results: Record<string, unknown> = {};
let text = "";
const queue = [...jobs];
async function worker() {
  for (;;) {
    const j = queue.shift();
    if (!j) return;
    const key = j.key;
    try {
      const r = await solve({ targets: j.targets, timeLimit: Number(tl), effectWeights });
      const l = fromSolve(r);
      results[key] = { status: r.status, targets: targetCounts(l), cost: inputCost(l), code: encode(l) };
      text += `\n=== ${key} ${r.status} targets ${JSON.stringify(targetCounts(l))} cost ${JSON.stringify(inputCost(l))}\n${render(l)}\n`;
    } catch (e) {
      results[key] = { error: String(e) };
      text += `\n=== ${key} ERROR ${e}\n`;
    }
  }
}
await Promise.all([worker(), worker()]);
writeFileSync(out, JSON.stringify(results, null, 1));
writeFileSync(out.replace(/\.json$/, ".txt"), text);
console.log(text);
