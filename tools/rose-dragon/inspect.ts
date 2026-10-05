// Checks a flows file: validation issues (as the simulator page reports them), step counts,
// and which jobs ran per starting inventory.
// Usage: node <vite-node> tools/rose-dragon/inspect.ts <flows.json> [inv,inv] [seed]
import { readFileSync } from "node:fs";
import { validateScenario } from "../../src/simulator/flow/validate";
import { importFlows } from "../../src/components/simulator/scenarioEdit";
import type { ScenarioPlot } from "../../src/simulator/sim/state";
import { engine, FREE_STOCK, makeScenario } from "./sim";
import { INVENTORIES } from "./inventories";

const [file, invList = "devGlassDone,aloeOnly", seedArg = "1"] = process.argv.slice(2);
const text = readFileSync(file, "utf8");
const plots = (JSON.parse(text) as { plots: ScenarioPlot[] }).plots;
const sc = importFlows(makeScenario([], {}, 1), text); // the same import path as the page
const issues = validateScenario(sc, engine.data);
console.log(`validation: ${issues.filter((i) => i.level === "error").length} errors, ${issues.filter((i) => i.level === "warning").length} warnings`);
for (const i of issues) console.log(`  ${i.level} ${i.path}: ${i.message}`);
for (const p of plots) console.log(`plot ${p.id}: ${p.flow.steps.length} steps`);

for (const inv of invList.split(",")) {
  let s = engine.initState(makeScenario(plots, { ...FREE_STOCK, ...INVENTORIES[inv] }, Number(seedArg))).state;
  while (s.cycle < 2500 && !s.flows.every((f) => plots.find((p) => p.id === f.plotId)!.flow.steps[f.stepIndex].id === "done")) s = engine.run(s, 3, { retainEvents: "none" }).state;
  const ran = new Set(s.flows.flatMap((f) => f.history.filter((h) => !h.skipped).map((h) => h.stepId)));
  console.log(`\n${inv}: ${s.cycle} cycles, jobs run: ${[...ran].filter((x) => x !== "hub" && x !== "done").sort().join(", ")}`);
  const made = Object.entries(s.summary.harvested).filter(([k]) => engine.data.mutations[k] && ["epic", "legendary"].includes(engine.data.mutations[k].rarity));
  console.log(`  epics/legendaries harvested: ${JSON.stringify(Object.fromEntries(made))}`);
}
