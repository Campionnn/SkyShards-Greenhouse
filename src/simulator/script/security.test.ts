// Security: scripts come from shared flows files, so script code must never reach real
// JavaScript (functions, prototypes, globals), pollute prototypes, or lock up the page.

import { describe, expect, it } from "vitest";
import { importFlows } from "../../components/simulator/scenarioEdit";
import { validateScenario } from "../flow/validate";
import { engine, flow, layout, scenario, start, step } from "../testHelpers";
import { diagnoseScript } from "./check";
import { inspectScriptVariables } from "./inspect";
import { compile, Interpreter, Scope } from "./interpreter";
import { coreGlobals } from "./stdlib";
import { HostFn } from "./values";

function run(src: string): unknown[] {
  const out: unknown[] = [];
  const interp = new Interpreter({ budget: 1_000_000 });
  const root = new Scope(null);
  for (const [k, v] of Object.entries(coreGlobals())) root.vars.set(k, { value: v, kind: "builtin" });
  root.vars.set("out", { value: new HostFn("out", (a) => void out.push(...a), true), kind: "builtin" });
  root.vars.set("log", { value: new HostFn("log", () => undefined, true), kind: "builtin" });
  const scope = new Scope(root);
  const program = compile(src);
  interp.hoist(program, scope);
  interp.runTop(program, scope);
  return out;
}

/** Run a plot script through the real engine; returns the state's script halt (or null). */
function engineRun(source: string, cycles = 2) {
  const sc = scenario([flow([step("a", layout([["wheat", 4, 4]]))])]);
  sc.plots[0].script = { source };
  const r = engine.run(start(sc), cycles);
  return r.state;
}

const protoKeys = () => [Object.getOwnPropertyNames(Object.prototype).sort().join(), Object.getOwnPropertyNames(Array.prototype).sort().join()];

describe("script sandbox", () => {
  const before = protoKeys();

  it("can't reach constructors, prototypes or native functions", () => {
    const payloads = [
      `"".constructor`, `""["constructor"]`, `[].constructor`, `[]["constructor"]`, `(0).constructor`, `true.constructor`,
      `(() => 1).constructor`, `(function () {}).constructor`, `log.constructor`, `Math.floor.constructor`, `Math.constructor`,
      `({}).__proto__`, `({})["__proto__"]`, `({}).constructor`, `({}).toString`, `({}).hasOwnProperty`, `[].__proto__`,
      `[].map.constructor`, `[].map.call`, `[].map.apply`, `[].map.bind`, `"".toString.constructor`, `JSON.constructor`,
      `JSON.parse("{}").constructor`, `JSON.parse("[]").constructor`, `range(1).constructor`, `keys({}).constructor`,
      `"".split.constructor`, `"".at.call`,
    ];
    for (const p of payloads) {
      const [v] = run(`out(${p})`);
      expect(v === undefined || typeof v === "string", p).toBe(true);
      // Nothing returned is a real JS function.
      expect(typeof v === "function", p).toBe(false);
    }
  });

  it("real globals don't exist in scripts", () => {
    for (const name of ["globalThis", "self", "window", "document", "fetch", "postMessage", "importScripts", "eval", "Function", "Object", "Array", "Reflect", "Proxy", "process", "require", "XMLHttpRequest", "WebSocket", "localStorage", "setTimeout", "Date"]) {
      expect(() => run(`out(${name})`), name).toThrow(/not defined/);
      expect(run(`out(typeof ${name})`), name).toEqual(["undefined"]);
    }
    expect(() => compile("this.x")).toThrow();
    expect(() => compile("new Function('return 1')")).toThrow();
    expect(() => compile("import('x')")).toThrow();
  });

  it("calling what looks like a function never runs native code", () => {
    expect(() => run(`"".constructor("return 1")()`)).toThrow();
    expect(() => run(`(() => 1).constructor("return globalThis")()`)).toThrow();
    expect(() => run(`[].map.constructor("return 1")()`)).toThrow();
  });

  it("can't pollute prototypes", () => {
    run(`const o = {}; o.__proto__ = { polluted: 1 }; o["__proto__"].polluted2 = 2`);
    run(`const p = JSON.parse('{"__proto__": {"polluted": 1}}'); p.__proto__.x = 1`);
    run(`const a = []; a.__proto__ = 1`.replace("a.__proto__ = 1", "try { a.__proto__ = 1 } catch (e) {}"));
    run(`const o = assign({}, JSON.parse('{"__proto__": {"polluted": 1}}')); const c = copy(o); const e = fromEntries([["__proto__", {polluted: 1}]])`);
    run(`const o = { ...JSON.parse('{"__proto__": {"polluted": 1}}') }; const { __proto__: q, ...rest } = o`);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(protoKeys()).toEqual(before);
  });

  it("engine objects expose no internals", () => {
    const s = engineRun(`
      let leaks = [];
      function onTick() {
        const vals = { a: plot.constructor, b: plot.__proto__, c: inventory.constructor, d: inventory.__proto__, e: inventory.toString,
          f: inventory.hasOwnProperty, g: plot.get, h: plot.rt, i: plot.state, j: plot.plot, k: plot.plants.constructor, l: summary.__proto__,
          m: stats.constructor, n: config.constructor, o: plot.policies.constructor, p: Math.constructor, q: JSON.__proto__ };
        for (const k of keys(vals)) if (vals[k] !== undefined && vals[k] !== 0) leaks.push(k);
        const p = plot.at(4, 4);
        const pv = { p1: p.constructor, p2: p.__proto__, p3: p.rt, p4: p.find, p5: p.state };
        for (const k of keys(pv)) if (pv[k] !== undefined) leaks.push(k);
      }`, 1);
    expect(s.scripts?.halt ?? null).toBeNull();
    expect(inspectScriptVariables(s).find((v) => v.name === "leaks")?.value).toEqual([]);
  });

  it("engine functions refuse inherited names as ids, so they can't reach JS objects", () => {
    const tries = [
      `info("constructor")`, `price("__proto__")`, `collected("constructor")`, `inventory.get("constructor")`, `inventory.has("__proto__")`,
      `plot.place("toString", 0, 0)`, `plot.setPolicy({ constructor: "never" })`, `plot.check({ kind: "inventoryAtLeast", item: "constructor", qty: 0 })`,
      `plot.check({ kind: "group", match: "all", of: [{ kind: "fullyGrown", mutationId: "__proto__" }] })`, `metric("__proto__", 1)`,
      `plot.spawnedInStep("constructor")`, `plot.setLayout({ plants: [{ kind: "constructor", row: 0, col: 0 }] })`, `plot.all("valueOf")`,
    ];
    const s = engineRun(`let out = []; function onSession() { if (cycle > 0) return; ${tries.map((t) => `try { out.push(str(${t})) } catch (e) { out.push(e.message) }`).join("\n")} }`, 1);
    const out = inspectScriptVariables(s).find((v) => v.name === "out")?.value as string[];
    expect(out).toHaveLength(tries.length);
    for (const [i, line] of out.entries()) expect(line, tries[i]).toMatch(/can't be used as a/);
    expect(JSON.stringify(s.scripts!.metrics)).toBe("{}");
  });

  it("copies of engine data can't change the engine", () => {
    const s = engineRun(`function onTick() { stats.farmingFortune = 1e9; config.waterLossMin = -1e9; summary.profit = 1e12; plot.policies.watering = "never" }`, 3);
    expect(s.scenario.settings.playerStats.farmingFortune).not.toBe(1e9);
    expect(s.scenario.settings.config.waterLossMin).not.toBe(-1e9);
    expect(s.summary.profit).not.toBe(1e12);
  });

  it("imported files with __proto__ keys don't pollute anything", () => {
    const base = scenario([flow([step("a", layout([["wheat", 4, 4]]))])]);
    const file = `{"kind":"skyshards-greenhouse-flows","version":1,"__proto__":{"polluted":1},"plots":[{"id":1,"__proto__":{"polluted":2},"script":{"source":"let x = 1","__proto__":{"polluted":3}},"flow":{"loop":false,"startIndex":0,"steps":[{"id":"a","layout":{"plants":[],"slots":[]},"exits":[]}]}}],"script":{"source":"shared.y = 1"}}`;
    const sc = importFlows(base, file);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const s = engine.run(start(sc), 2).state;
    expect(s.scripts?.halt ?? null).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("an imported scenario can't smuggle in script state", () => {
    // State is always built by initState; a `scripts` key in the scenario is ignored.
    const base = scenario([flow([step("a", layout([["wheat", 4, 4]]))])]);
    const evil = { ...base, scripts: { heap: [{ o: [["x", { h: "constructor" }]] }] } } as unknown as typeof base;
    const s = start(evil);
    expect(s.scripts).toBeUndefined();
  });
});

describe("script denial of service", () => {
  it("deeply nested code is a syntax error, not a crash", () => {
    for (const src of ["(".repeat(100_000) + "1" + ")".repeat(100_000), "[".repeat(100_000), "{".repeat(100_000), "-".repeat(100_000) + "1", "a" + ".b".repeat(100_000), "f" + "()".repeat(100_000), "x = ".repeat(50_000) + "1", "if (1) ".repeat(50_000) + "1"]) {
      const t = performance.now();
      const diags = diagnoseScript(src, "plot");
      expect(diags[0]?.level).toBe("error");
      expect(performance.now() - t).toBeLessThan(3000);
    }
    // Validation (runs on the page) reports it instead of throwing.
    const sc = scenario([flow([step("a", layout([["wheat", 4, 4]]))])]);
    sc.plots[0].script = { source: "(".repeat(100_000) };
    expect(validateScenario(sc, engine.data).some((i) => i.level === "error")).toBe(true);
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "[".repeat(100_000) }] }];
    expect(validateScenario(sc, engine.data).some((i) => i.level === "error")).toBe(true);
  });

  it("deep data structures don't crash host helpers or saving", () => {
    const s = engineRun(`
      let deep = [];
      function onTick() {
        let x = deep;
        for (let i = 0; i < 20000; i++) { const y = []; x.push(y); x = y }
        try { copy(deep) } catch (e) {}
        try { JSON.stringify(deep) } catch (e) {}
        try { str(deep) } catch (e) {}
        try { log(deep) } catch (e) {}
      }`, 2);
    // Either it ran or it stopped with a script error; the engine itself survived.
    expect(s.cycle).toBeGreaterThan(0);
  });

  it("huge allocations are refused", () => {
    expect(() => run(`let s = "x".repeat(1000); for (let i = 0; i < 30; i++) s = s + s`)).toThrow(/limited/);
    expect(() => run(`"x".repeat(1e9)`)).toThrow(/limited/);
    expect(() => run(`"x".padStart(1e9)`)).not.toThrow(); // capped at 10,000
    expect(() => run(`range(1e9)`)).toThrow(/limited/);
    expect(() => run(`const a = []; a[1e9] = 1`)).toThrow(/limited/);
    expect(() => run(`const a = []; a.length = 1e9`)).toThrow(/limited/);
    expect(() => run(`let a = range(1000); for (let i = 0; i < 20; i++) a = [...a, ...a]`)).toThrow(/limited|too long/);
    expect(() => run(`let a = ["x".repeat(100000)]; for (let i = 0; i < 20; i++) a = a.concat(a); a.join("")`)).toThrow(/limited|too long/);
  });

  it("big spreads and native helpers don't overflow the stack", () => {
    for (const src of [
      "const a = range(500000); const b = [...a]",
      "const a = range(500000); const b = []; b.push(...a)",
      "const a = range(500000); Math.max(...a); Math.min(a); Math.hypot(...range(1000))",
      "const a = range(500000); [].concat(a, a); a.splice(1, 0, ...range(1000)); a.unshift(...range(1000))",
      "function f(...xs) { return xs.length } f(...range(500000))",
    ]) {
      try {
        run(src);
      } catch (e) {
        // A refusal is fine; a crash is not.
        expect((e as Error).name, src).toBe("ScriptError");
      }
    }
  });

  it("a script error deep in the engine never escapes run()", () => {
    for (const source of [
      "let d = []; function onTick() { let x = d; for (let i = 0; i < 100000; i++) { const y = [x]; x = y } d = x; str(`${d}`) }",
      "function onTick() { const a = []; let x = a; for (let i = 0; i < 5000; i++) { x.push([]); x = x[0] } `${a}` }",
      "function f(n) { return n ? [f(n - 1)] : 0 } function onTick() { f(150) + '' }",
    ]) {
      const s = engineRun(source, 2);
      expect(s.cycle, source).toBeGreaterThan(0);
    }
  });

  it("endless work always ends", () => {
    for (const src of [
      "while (true) {}",
      "for (;;) {}",
      "function f() { f() } f()",
      "const a = range(100000); while (true) a.map(x => x)",
      "const a = range(1000000); for (let i = 0; i < 1e6; i++) a.sort((x, y) => y - x)",
      "while (true) { try { while (true) {} } catch (e) {} }",
      "while (true) { try {} finally { continue } }",
    ]) {
      expect(() => run(src), src).toThrow();
    }
  });
});
