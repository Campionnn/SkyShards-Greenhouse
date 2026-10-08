import { describe, expect, it } from "vitest";
import { compile, compileExpression, Interpreter, ScriptError, Scope } from "./interpreter";
import { ScriptSyntaxError } from "./lexer";
import { coreGlobals } from "./stdlib";
import { display, HostFn } from "./values";

/** Run a program and return what it passed to out(...), in order. */
function run(src: string, budget?: number): unknown[] {
  const out: unknown[] = [];
  const interp = new Interpreter({ budget });
  const root = new Scope(null);
  for (const [k, v] of Object.entries(coreGlobals())) root.vars.set(k, { value: v, kind: "builtin" });
  root.vars.set("out", { value: new HostFn("out", (a) => void out.push(...a), true), kind: "builtin" });
  const scope = new Scope(root);
  const program = compile(src);
  interp.hoist(program, scope);
  interp.runTop(program, scope);
  return out;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("script language", () => {
  it("arithmetic, precedence and strings", () => {
    expect(run("out(1 + 2 * 3, (1 + 2) * 3, 2 ** 3 ** 2, 7 % 3, -2 ** 2 === undefined)")).toEqual([7, 9, 512, 1, false]);
    expect(run('out("a" + 1, `x${1 + 1}y`, "abc".toUpperCase(), "a,b".split(","))')).toEqual(["a1", "x2y", "ABC", ["a", "b"]]);
  });

  it("let / const / var, blocks and closures", () => {
    expect(run("let a = 1; { let a = 2; out(a) } out(a); const f = (x) => x + a; out(f(10))")).toEqual([2, 1, 11]);
    expect(() => run("const x = 1; x = 2")).toThrow(/const/);
    expect(() => run("y = 2")).toThrow(/not declared/);
    expect(() => run("out(nope)")).toThrow(/not defined/);
  });

  it("functions: hoisting, defaults, rest, recursion", () => {
    expect(run("out(fib(10)); function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }")).toEqual([55]);
    expect(run("function f(a, b = a * 2, ...rest) { return [a, b, rest] } out(f(1), f(1, 5, 6, 7))")).toEqual([[1, 2, []], [1, 5, [6, 7]]]);
  });

  it("loops: for, for-of, for-in, while, do-while, break / continue", () => {
    expect(run("let s = 0; for (let i = 0; i < 10; i++) { if (i === 3) continue; if (i === 6) break; s += i } out(s)")).toEqual([12]);
    expect(run("let s = []; for (const [k, v] of entries({a: 1, b: 2})) s.push(k + v); out(s)")).toEqual([["a1", "b2"]]);
    expect(run("let s = []; for (const k in {x: 1, y: 2}) s.push(k); out(s)")).toEqual([["x", "y"]]);
    expect(run("let i = 0; while (i < 5) i++; do { i += 10 } while (i < 30); out(i)")).toEqual([35]);
    // Per-iteration let bindings.
    expect(run("const fs = []; for (let i = 0; i < 3; i++) fs.push(() => i); out(fs.map(f => f()))")).toEqual([[0, 1, 2]]);
  });

  it("objects, arrays, destructuring, spread, optional chaining, ??", () => {
    expect(json(run("const o = { a: 1, b: { c: 2 } }; const { a, b: { c }, d = 4 } = o; out(a, c, d, { ...o, a: 9 }.a)"))).toEqual([1, 2, 4, 9]);
    expect(run("const [x, , y = 3, ...z] = [1, 2, undefined, 4, 5]; out(x, y, z)")).toEqual([1, 3, [4, 5]]);
    expect(run("const o = null; out(o?.a, o?.a.b.c, o ?? 'def', 0 ?? 1, o?.f())")).toEqual([undefined, undefined, "def", 0, undefined]);
    expect(run("let a = 1, b = 2; [a, b] = [b, a]; out(a, b)")).toEqual([2, 1]);
    expect(run("const o = {}; o.n ??= 5; o.n ||= 7; o.n &&= o.n + 1; out(o.n)")).toEqual([6]);
  });

  it("array helpers", () => {
    expect(run("const a = [3, 1, 2]; out(a.sum(), a.max(), a.min(), a.count(x => x > 1), [...a].sort(), a.includes(2), a.first(), a.last())")).toEqual([
      6, 3, 1, 2, [1, 2, 3], true, 3, 2,
    ]);
    expect(run("out([{s: 2}, {s: 5}].max(p => p.s).s, range(3), range(1, 7, 2), [[1], [2, [3]]].flat())")).toEqual([5, [0, 1, 2], [1, 3, 5], [1, 2, [3]]]);
    expect(run("out([1, 2, 3].reduce((a, b) => a + b, 0), [1, 2, 3].filter(x => x % 2).map(x => x * 10))")).toEqual([6, [10, 30]]);
  });

  it("switch, try / catch / finally, throw", () => {
    expect(run("function f(x) { switch (x) { case 1: return 'one'; case 2: case 3: return 'few'; default: return 'many' } } out(f(1), f(3), f(9))")).toEqual([
      "one", "few", "many",
    ]);
    expect(run("try { throw { message: 'boom', n: 1 } } catch (e) { out(e.n) } finally { out('done') }")).toEqual([1, "done"]);
    expect(run("try { null.x } catch (e) { out(e.message) }")[0]).toMatch(/null/);
  });

  it("automatic semicolons", () => {
    expect(run("let a = 1\nlet b = 2\nout(a + b)\n")).toEqual([3]);
    expect(run("let i = 0\ni\n++i\nout(i)")).toEqual([1]);
  });

  it("errors carry line and column", () => {
    try {
      run("let a = 1;\nlet b = a.x.y;");
      expect.fail();
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptError);
      expect((e as ScriptError).line).toBe(2);
    }
    try {
      compile("let a = ;\n");
      expect.fail();
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptSyntaxError);
      expect((e as ScriptSyntaxError).line).toBe(1);
      expect((e as ScriptSyntaxError).col).toBe(9);
    }
  });

  it("unsupported features fail with a helpful message", () => {
    expect(() => compile("class A {}")).toThrow(/Classes/);
    expect(() => compile("const d = new Date()")).toThrow(/new/);
    expect(() => compile("this.x = 1")).toThrow(/this/);
    expect(() => run("Math.random()")).toThrow(/random\(\)/);
  });

  it("endless loops hit the step budget and can't be caught", () => {
    expect(() => run("while (true) {}", 10_000)).toThrow(/ran too long/);
    expect(() => run("try { while (true) {} } catch (e) { out('caught') }", 10_000)).toThrow(/ran too long/);
    expect(() => run("function f() { return f() } f()")).toThrow(/nested calls/);
  });

  it("objects have no prototype leaks", () => {
    expect(run("const o = {}; out(o.constructor, o.toString, [].constructor, ''.constructor, 'x' in o, 'toString' in o)")).toEqual([
      undefined, undefined, undefined, undefined, false, false,
    ]);
    expect(run("const o = {}; o['__proto__'] = 5; out(o.__proto__, keys(o))")).toEqual([5, ["__proto__"]]);
  });

  it("expressions for exit conditions", () => {
    expect(() => compileExpression("a; b")).toThrow(/single expression/);
    expect(compileExpression("x >= 3 && y").type).toBe("Logical");
  });

  it("display renders values readably", () => {
    expect(display({ a: [1, "x"], b: null })).toBe('{ a: [1, "x"], b: null }');
  });
});
