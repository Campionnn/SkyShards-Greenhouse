import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as publicApi from "./index";

// Structural guards, in the spirit of SkyShards-API tools/check_docs.py. The
// simulator EVALUATES one scenario: it never generates, ranks, compares or
// repairs layouts, and time only moves through run().

const ROOT = __dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? [full, ...walk(full)] : [full];
  });
}

const entries = walk(ROOT).map((f) => relative(ROOT, f).replace(/\\/g, "/"));
const sources = entries.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Source without comments, so documentation may name what the code must not do. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("scope guard", () => {
  it("has no solver / optimiser / generator / ranking / scoring module", () => {
    const banned = /solver|optimi[sz]|generat|rank|leaderboard|best.?of|score/i;
    expect(entries.filter((f) => banned.test(f))).toEqual([]);
  });

  it("tickPlot is called only by run.ts - there is no second stepping path", () => {
    const importers = sources.filter((f) => f !== "sim/tick.ts" && /\btickPlot\b/.test(read(f)));
    expect(importers).toEqual(["sim/run.ts"]);
  });

  it("the public API exposes run through the engine, and no tick or step function", () => {
    const names = Object.keys(publicApi);
    expect(names).toContain("createEngine");
    expect(names.filter((n) => /^tick|^step/i.test(n))).toEqual([]);
    expect(typeof publicApi.createEngine().run).toBe("function");
  });

  it("uses no ambient randomness or wall-clock time in the engine", () => {
    const offenders = sources.filter((f) => !f.startsWith("worker/") && /Math\.random|Date\.now|new Date\(/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("never iterates the inventory or ledger in Map/Set insertion order", () => {
    // State is plain data; a Map or Set inside SimulationState would break structuredClone/JSON equality.
    expect(read("sim/state.ts")).not.toMatch(/\b(Map|Set)</);
  });
});
