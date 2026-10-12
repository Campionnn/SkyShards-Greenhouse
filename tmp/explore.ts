import { readFileSync } from "node:fs";
import { defaultSettings } from "../src/simulator";
import { buildPlan, createGuideEnv, decideAll, emptyCheckIn, flowItems, parseFlows, runForecast, summarise } from "../src/guide";
const env = createGuideEnv();
const flow = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const ci = emptyCheckIn(flow, defaultSettings(), { dead_plant: 250, fermento: 50 });
const d = decideAll(flow, ci, env);
console.log(JSON.stringify(d.map(x => ({...x, inventoryAfter: Object.fromEntries(Object.entries(x.inventoryAfter).filter(([k,v]) => v !== (ci.inventory[k] ?? 0)))})), null, 1));
for (const plot of flow.plots) for (const s of plot.flow.steps.slice(0,4)) {
  const r = env.env.resolveLayout(s.layout);
  const c = (arr) => { const m = {}; for (const p of arr) m[p.kindId ?? p.mutationId] = (m[p.kindId ?? p.mutationId] ?? 0) + 1; return m; };
  console.log(plot.id, s.id, JSON.stringify(c(r.plants.filter(p=>p.origin==="placed"))), JSON.stringify(c(r.plants.filter(p=>p.origin==="planted"))), JSON.stringify(c(r.slots)), s.exits?.length);
}
const runs = runForecast(flow, ci, env, { seeds: [1,2,3] });
const plan = buildPlan(runs, () => 14400);
console.log(plan.steps.slice(0, 8));
console.log(summarise(runs));
console.log(flowItems(flow, env.engine).length);
const s = env.engine.data.mutations["choconut"]; console.log(s?.rarity, s?.name);
