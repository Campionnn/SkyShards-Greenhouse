// Prints a flows file as readable text (what a user sees in the Flow editor).
// Usage: node <vite-node> tools/rose-dragon/describe.ts <flows.json> [--layouts]
import { readFileSync } from "node:fs";
import { describeConditions } from "../../src/simulator/flow/triggers";
import type { ScenarioPlot } from "../../src/simulator/sim/state";
import { decode, render, inputCost } from "./layouts";

const [file] = process.argv.slice(2);
const showLayouts = process.argv.includes("--layouts");
const plots = (JSON.parse(readFileSync(file, "utf8")) as { plots: ScenarioPlot[] }).plots;
for (const p of plots) {
  const name = (id: string) => p.flow.steps.find((s) => s.id === id)?.label ?? id;
  console.log(`\n================ PLOT ${p.id} (${p.flow.steps.length} steps)`);
  for (const s of p.flow.steps) {
    const l = "code" in s.layout ? decode(s.layout.code) : null;
    console.log(`\n[${s.id}] ${s.label}${l ? `  places ${JSON.stringify(inputCost(l))}` : ""}`);
    if (showLayouts && l && l.inputs.length + l.targets.length > 0) console.log(render(l).replace(/^/gm, "    "));
    for (const e of s.exits) console.log(`   -> ${e.to ? name(e.to) : "(next)"}${e.checkOnEntry ? " [also on arrival]" : ""}\n        when ${describeConditions(e.when, e.match, name)}`);
  }
}
