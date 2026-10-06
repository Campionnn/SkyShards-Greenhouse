/**
 * Real-engine Rose Dragon CLI. Import reusable runners from test-harness.ts.
 * --strict-debt fails on shortages; --json <path> saves machine-readable results.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { ScenarioPlot } from "../../src/simulator/sim/state";
import { FREE_STOCK } from "./sim";
import { INVENTORIES } from "./inventories";
import { runOne, type Result } from "./test-harness";

function parseSeeds(s: string): number[] {
  return s.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
}

function main(args = process.argv.slice(2)): void {
  const opt = (name: string, def: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const file = args[0] && !args[0].startsWith("--") ? args[0] : "rose-dragon.flows.json";
  const plots = (JSON.parse(readFileSync(file, "utf8")) as { plots: ScenarioPlot[] }).plots;
  const seeds = parseSeeds(opt("seeds", "1-4"));
  // --random N adds random1..randomN (alone unless --inv is given too).
  const random = Number(opt("random", "0"));
  const invs = [
    ...(args.includes("--inv") || !random ? opt("inv", Object.keys(INVENTORIES).join(",")).split(",") : []),
    ...Array.from({ length: random }, (_, i) => `random${i + 1}`),
  ];
  const max = Number(opt("max", "3000"));
  const verbose = args.includes("--verbose");
  const strictDebt = args.includes("--strict-debt");
  const passed = (r: Result) => r.ok && r.finished && (!strictDebt || r.debt === 0);
  let fails = 0;
  const reports: Omit<Result, "state">[] = [];
  for (const inv of invs) {
    const rs: Result[] = [];
    for (const seed of seeds) {
      const r = runOne(plots, inv, seed, max);
      rs.push(r);
      const { state: _, ...report } = r;
      reports.push(report);
      if (!passed(r)) fails++;
      console.log(
        `${passed(r) ? "OK  " : "FAIL"} ${inv.padEnd(13)} seed ${String(seed).padStart(3)} ${String(r.cycles).padStart(5)}c ${String(r.days).padStart(6)}d busy ${JSON.stringify(r.busy)}` +
          (r.ok ? "" : ` missing ${JSON.stringify(r.missing)}`) +
          (r.stuckOn ? ` stuck ${JSON.stringify(r.stuckOn)}` : "") +
          (r.debt ? ` debt ${r.debt}` : "")
      );
      if (verbose || !passed(r)) {
        for (const [p, s] of Object.entries(r.steps)) console.log(`     P${p}: ${s}`);
        if (!r.ok || !r.finished) {
          const inv2 = Object.entries(r.state.inventory).filter(([k, v]) => v > 0 && !(k in FREE_STOCK) && !/^(wheat|potato|carrot|pumpkin|melon|cocoa|sugar|cactus|nether|red_|brown_|moonflower|sunflower|wild_rose|seeds|ethereal)/.test(k));
          console.log(`     inv ${JSON.stringify(Object.fromEntries(inv2))}`);
        }
      }
    }
    const avg = rs.reduce((a, r) => a + r.days, 0) / rs.length;
    console.log(`  -> ${inv}: avg ${avg.toFixed(1)} days, ${rs.filter(passed).length}/${rs.length} ok`);
  }
  if (args.includes("--json")) writeFileSync(opt("json", ""), JSON.stringify(reports, null, 2) + "\n");
  console.log(fails ? `${fails} FAILED` : "ALL OK");
  if (fails) process.exitCode = 1;
}

main();
