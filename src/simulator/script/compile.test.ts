// Compiled script code (compile.ts) must behave exactly like the tree-walking interpreter: the same
// values, the same steps charged (the leaderboard's machine-independent step cap reads them), the
// same errors at the same line/col, the same scopes. Every case runs both ways and is compared.

import { afterEach, describe, expect, it } from "vitest";
import { engine, flow, layout, scenario, start, step } from "../testHelpers";
import { SCRIPT_EXAMPLES } from "./examples";
import { compile, compiledCodeFailures, Interpreter, ScriptError, Scope, setCompiledScripts } from "./interpreter";
import { coreGlobals } from "./stdlib";
import { display, HostFn } from "./values";

interface Outcome {
  out: string[];
  steps: number;
  error: { message: string; line: number; col: number; catchable: boolean } | null;
}

function runOnce(src: string, compiled: boolean, budget = 200_000): Outcome {
  setCompiledScripts(compiled);
  const out: string[] = [];
  const interp = new Interpreter({ budget });
  const root = new Scope(null);
  for (const [k, v] of Object.entries(coreGlobals())) root.vars.set(k, { value: v, kind: "builtin" });
  root.vars.set("out", { value: new HostFn("out", (a) => void out.push(...a.map((x) => display(x))), true), kind: "builtin" });
  const scope = new Scope(root);
  let error: Outcome["error"] = null;
  try {
    const program = compile(src);
    interp.hoist(program, scope);
    interp.runTop(program, scope);
    // Call every top-level function too (top-level code itself is always interpreted).
    for (const name of program.topFunctions) interp.call(scope.vars.get(name)!.value, [3, "x", [1, 2]]);
  } catch (e) {
    if (!(e instanceof ScriptError)) throw e;
    error = { message: e.message, line: e.line, col: e.col, catchable: e.catchable };
  }
  return { out, steps: interp.steps, error };
}

function same(src: string, budget?: number): Outcome {
  const a = runOnce(src, false, budget);
  const b = runOnce(src, true, budget);
  expect(b, src).toEqual(a);
  return a;
}

/** Wrap code in a function so it runs compiled (top-level statements are always interpreted). */
const fn = (body: string) => `function main(a, b, c) {\n${body}\n}`;

const BODIES = [
  // operators and conversions
  `out(1 + 2 * 3, (1 + 2) * 3, 2 ** 3 ** 2, 7 % 3, -2 ** 2 === undefined, "a" + 1, 1 + "2", [1] + 1, null + 1, undefined + 1, true + true)`,
  `out(1 < 2, "a" < "b", "10" < "9", 10 < "9", null >= 0, undefined < 1, [2] > 1, -0 === 0, NaN === NaN, 1 == "1", null == undefined, 0 == false, "" != 0)`,
  `out(typeof a, typeof nope, typeof null, typeof main, typeof out, typeof [], -"3", +"x", !0, !!"", 5 / 0, -5 % 3, "x" in { x: 1 }, 1 in [1, 2], "length" in [])`,
  `let x = 5; x += 2; x -= 1; x *= 3; x /= 2; x %= 5; x **= 2; out(x); let s = "a"; s += 1; out(s); let n = null; n ??= 4; n ||= 9; n &&= n + 1; out(n)`,
  `let i = 0; out(i++, i, ++i, i--, --i, i); const o = { k: 1, arr: [1, 2] }; o.k++; ++o.k; o.arr[1]--; o["k"] += 10; out(o.k, o.arr)`,
  `out(\`t\${1 + 1}u\${"v"}\${[1, 2]}\${{}}\`, \`\`, \`\${null}\${undefined}\`)`,
  // control flow
  `let s = 0; for (let i = 0; i < 10; i++) { if (i === 3) continue; if (i === 6) break; s += i } out(s)`,
  `let s = []; for (const [k, v] of entries({ a: 1, b: 2 })) s.push(k + v); for (const k in { x: 1, y: 2 }) s.push(k); for (const ch of "hi") s.push(ch); out(s)`,
  `let i = 0; while (i < 5) i++; do { i += 10 } while (i < 30); out(i); while (true) { i++; if (i > 40) break; else continue }; out(i)`,
  `const fs = []; for (let i = 0; i < 3; i++) fs.push(() => i); out(fs.map(f => f())); const gs = []; for (var j = 0; j < 3; j++) gs.push(() => j); out(gs.map(g => g()))`,
  `const arr = [1, 2, 3]; const seen = []; for (const x of arr) { seen.push(x); if (x === 1) arr.push(4) } out(seen)`,
  `outer: for (const x of [1, 2]) { for (const y of [1, 2]) { if (y === 2) break; out(x, y) } }`.replace("outer: ", ""),
  `function f(x) { switch (x) { case 1: return "one"; case 2: case 3: return "few"; default: return "many" } } out(f(1), f(3), f(9)); for (const v of [1, 2, 3]) { switch (v) { case 2: continue; default: out(v) } }`,
  `try { throw { message: "boom", n: 1 } } catch (e) { out(e.n) } finally { out("done") } try { null.x } catch (e) { out(e.message, e.line) } for (let i = 0; i < 3; i++) { try { if (i === 1) continue; out(i) } finally { out("f" + i) } }`,
  `function g() { try { return 1 } finally { out("fin") } } out(g()); function h() { for (;;) { try { return 2 } catch (e) {} } } out(h())`,
  `if (a > 2) out("big"); else if (a > 1) out("mid"); else out("small"); if (b) { let b = 9; out(b) } out(b)`,
  `{ let q = 1; { let q = 2; out(q) } out(q) } { out(typeof q) }`,
  `for (const x of [1, 2, 3]) { const y = x * 2; if (y > 4) break; out(y) }`,
  `let k = 0; for (;;) { if (++k > 3) break } out(k); for (let i = 0, j = 10; i < j; i += 3) out(i, j--)`,
  // functions, closures, scopes, destructuring
  `function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) } out(fib(12))`,
  `function f(p, q = p * 2, ...rest) { return [p, q, rest] } out(f(1), f(1, 5, 6, 7), f())`,
  `function f(p, p2) { return p + p2 } out(f(...[1, 2]), Math.max(...[1, 5, 3]), [..."ab", ...[1]])`,
  `const mk = (n) => () => n++; const c1 = mk(1); c1(); out(c1(), mk(5)())`,
  `const o = { a: 1, b: { c: 2 } }; const { a: aa, b: { c }, d = 4, ...rest } = o; out(aa, c, d, rest, { ...o, a: 9 }.a)`,
  `const [x, , y = 3, ...z] = [1, 2, undefined, 4, 5]; out(x, y, z); let p = 1, q = 2; [p, q] = [q, p]; out(p, q); ({ p, q } = { p: 7, q: 8 }); out(p, q)`,
  `function f({ u, v = 2 }, [w]) { return u + v + w } out(f({ u: 1 }, [3]))`,
  `const o = { f: (x) => x * 2, n: null }; out(o.f(3), o.n?.x, o.n?.x.y.z, o.nope?.(), o?.f(1), (o.n ?? "def"))`,
  `const o = { arr: [{ v: 1 }, { v: 2 }] }; out(o.arr[1].v, o["arr"].length, o.arr.map(e => e.v).filter(v => v > 1), "abc".toUpperCase().split(""))`,
  `const o = {}; o.x = 1; o["y z"] = 2; o.__proto__ = 5; delete o.x; out(keys(o), o.__proto__, "x" in o)`,
  `const a = [3, 1, 2]; out(a.sum(), a.max(), a.min(), a.count(x => x > 1), [...a].sort(), a.includes(2), a.first(), a.last(), a.indexOf(1), a.join("-"), a.slice(1), a.reduce((s, v) => s + v, 0))`,
  `const a = []; a.push(1, 2); a.unshift(0); a.splice(1, 1, 9, 8); a.fill(7, 3); a.length = 2; a[4] = 1; out(a, a.length, a.at(-1), [[1], [2, [3]]].flat())`,
  `out("abc".length, "abc"[1], "abc".at(-1), "a-b".replace("-", "+"), " x ".trim(), "ab".repeat(2), "abc".slice(1), "x".padStart(3, "0"), (1.5).toFixed(2), (255).toString(16))`,
  `const f = function named() { return 1 }; out(f.name, (() => 1).name, main.name, out.name, [].push.name)`,
  `out(range(3), range(1, 7, 2), copy({ a: [1] }), JSON.stringify({ a: [1, { b: 2 }] }), JSON.parse("[1,2]"), str({ a: 1 }), isArray([]), Number("3"), String(4), fromEntries([["a", 1]]))`,
  `const o = {}; for (let i = 0; i < 20; i++) o["k" + i] = i; let s = 0; for (const k in o) s += o[k]; out(s, keys(o).length)`,
  // errors (positions, messages, catchability)
  `let q = 1;\nq.x.y`,
  `undefinedName + 1`,
  `const c = 1;\nc = 2`,
  `nope = 3`,
  `let a1 = 1; let a1 = 2`,
  `null.f()`,
  `(5)()`,
  `const o = {}; o.f()`,
  `for (const x of 5) {}`,
  `throw "plain"`,
  `throw { message: "obj" }`,
  `[].reduce((s, v) => s)`,
  `"x".repeat(1e9)`,
  `const z = []; z[1e9] = 1`,
  `[1, 2].map(5)`,
  `Math.random()`,
  `main()`,
  `function r(n) { return r(n + 1) } r(0)`,
  `while (true) {}`,
  `try { while (true) {} } catch (e) { out("caught") }`,
  `for (const x of range(10)) { try { [].reduce((s, v) => s) } catch (e) { out(e.message.slice(0, 10), e.line, e.col) } }`,
  `const o = { a: 1 }; o.a.b = 2`,
  `[1].foo = 2`,
  `let t = 0; t.x = 1`,
  `const { u } = null`,
  `const [v1] = 5`,
  `delete main.x`,
  `a.b.c.d`,
];

describe("compiled scripts behave exactly like the interpreter", () => {
  afterEach(() => setCompiledScripts(true));

  it("values, steps, errors and positions", () => {
    for (const body of BODIES) same(fn(body));
    expect(compiledCodeFailures()).toBe(0);
  });

  it("step budget: running out lands at the same step and position", () => {
    for (const body of ["let s = 0; for (let i = 0; i < 1e6; i++) s += i", "const xs = range(5000); xs.map(x => xs.filter(y => y < x).length)", "while (true) { out(1) }"]) {
      for (const budget of [1_000, 12_345, 50_000]) {
        const o = same(fn(body), budget);
        expect(o.error?.message, body).toMatch(/ran too long/);
      }
    }
  });

  it("call depth limit", () => {
    const o = same(fn("function deep(n) { return n > 0 ? 1 + deep(n - 1) : 0 } out(deep(150)); deep(500)"), 1e7);
    expect(o.error?.message).toMatch(/nested calls/);
  });

  it("the bundled examples, through the engine", () => {
    for (const ex of SCRIPT_EXAMPLES) {
      const sc = scenario([flow([step("a", layout([["wheat", 4, 4], ["wheat", 4, 6], ["wheat", 6, 4], ["wheat", 6, 6]], [["chloronite", 5, 5]]))]), flow([step("a", layout([["wheat", 4, 4]]))])], {
        inventory: { chloronite: 30, magic_jellybean: 2 },
      });
      if (ex.target === "controller") sc.script = { source: ex.source };
      else sc.plots[0].script = { source: ex.source };
      setCompiledScripts(false);
      const a = JSON.stringify(engine.run(start(sc), 150, { ignorePauses: true }).state);
      setCompiledScripts(true);
      const b = JSON.stringify(engine.run(start(sc), 150, { ignorePauses: true }).state);
      expect(b, ex.id).toBe(a);
    }
  });

  it("exit conditions and errors inside hooks", () => {
    const sc = scenario([flow([step("a", layout([["wheat", 4, 4]]), [{ kind: "script", expr: "cycle > 5 && plot.count('wheat') >= 1" }]), step("b", layout([["wheat", 4, 4]]))])]);
    sc.plots[0].script = { source: "let n = 0; function onTick() { n++; if (n === 9) { const o = null; o.boom } }" };
    setCompiledScripts(false);
    const a = JSON.stringify(engine.run(start(sc), 20).state);
    setCompiledScripts(true);
    const b = JSON.stringify(engine.run(start(sc), 20).state);
    expect(b).toBe(a);
    expect(JSON.parse(b).scripts.halt.message).toMatch(/null/);
  });
});
