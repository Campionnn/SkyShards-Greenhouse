// Scratch: ask the solver for candidate layouts and print their costs.
// Usage: node vite-node tools/rose-dragon/explore.ts '<json array of requests>'
import { solve, type SolveRequest } from "./solver";
import { encode, fromSolve, inputCost, render, targetCounts } from "./layouts";

import { readFileSync } from "node:fs";
const arg = process.argv[2];
const reqs = JSON.parse(arg.startsWith("[") ? arg : readFileSync(arg, "utf8")) as (SolveRequest & { name: string })[];
const results = await Promise.all(
  reqs.map(async (r) => {
    try {
      return { r, res: await solve(r) };
    } catch (e) {
      return { r, err: String(e) };
    }
  })
);
for (const { r, res, err } of results as { r: SolveRequest & { name: string }; res?: Awaited<ReturnType<typeof solve>>; err?: string }[]) {
  console.log(`\n=== ${r.name}`);
  if (err || !res) {
    console.log("ERROR", err);
    continue;
  }
  const l = fromSolve(res);
  console.log(res.status, "targets", JSON.stringify(targetCounts(l)), "cost", JSON.stringify(inputCost(l)));
  console.log(render(l));
  console.log("code", encode(l));
}
