import { readFileSync } from "node:fs";
import { importFlows } from "../../src/components/simulator/scenarioEdit";
import { defaultSettings } from "../../src/simulator/scenario";
import { engine } from "./sim";
const text = readFileSync("rose-dragon.flows.json", "utf8");
const inventories: Record<string, number>[] = [{}, { dead_plant: 250, fermento: 50 }];
for (const startingInventory of inventories) {
  const sc = importFlows({ plots: [], startingInventory, settings: defaultSettings() }, text);
  let s = engine.initState(sc).state;
  s = engine.run(s, 60, { retainEvents: "none" }).state;
  const ids = s.flows.map(f => sc.plots.find(p => p.id === f.plotId)!.flow.steps[f.stepIndex].id);
  if (!Object.keys(startingInventory).length && !ids.every(id => id === "supplies")) throw new Error(`Missing warning: ${ids}`);
  if (Object.keys(startingInventory).length && !s.flows.some(f => f.history.some(h => h.stepId === "commons" && !h.skipped))) throw new Error("Supplied flow did not start");
  console.log(JSON.stringify(startingInventory), ids.join(", "), "PASS");
}
