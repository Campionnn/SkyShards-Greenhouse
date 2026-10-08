// Tree-walking interpreter for the script language. Deterministic (no clock,
// no Math.random), bounded (a step budget per hook call and a call-depth
// limit), and every error carries the script line/column.

import type * as A from "./ast";
import { ScriptSyntaxError } from "./lexer";
import { parse } from "./parser";
import { arrayMethod, numberMethod, stringMethod } from "./stdlib";
import {
  Closure,
  ConversionLimitError,
  HostFn,
  HostObject,
  isCallable,
  isPlainObject,
  newObject,
  setOwn,
  strictEquals,
  toNum,
  toStr,
  typeOf,
  type CallInfo,
  type PlainObject,
} from "./values";

// ---- programs ----

export interface Program {
  source: string;
  body: A.Stmt[];
  /** Every function in the source by parse id (`Func.id`), to rebuild top-level closures after a restore. */
  funcs: A.Func[];
  /** Hook names declared with `function name() {}` at the top level. */
  topFunctions: string[];
}

const programCache = new Map<string, Program>();
const PROGRAM_CACHE_LIMIT = 64;

/** Parse once per source text (immutable AST, cached). Throws ScriptSyntaxError. */
export function compile(source: string): Program {
  const hit = programCache.get(source);
  if (hit) return hit;
  let body: A.Stmt[];
  const funcs: A.Func[] = [];
  try {
    body = parse(source);
    collectFuncs(body, funcs);
  } catch (err) {
    // Backstop: the parser limits nesting, but no input may crash the page or the worker.
    if (err instanceof RangeError) throw new ScriptSyntaxError("The code is nested too deeply or is too long", 1, 1);
    throw err;
  }
  funcs.sort((a, b) => a.id - b.id);
  const program: Program = {
    source,
    body,
    funcs,
    topFunctions: body.filter((s): s is A.FuncDecl => s.type === "FuncDecl").map((s) => s.name),
  };
  if (programCache.size >= PROGRAM_CACHE_LIMIT) programCache.delete(programCache.keys().next().value!);
  programCache.set(source, program);
  return program;
}

/** Parse a single expression (exit conditions). Cached like programs. */
export function compileExpression(source: string): A.Expr {
  const program = compile(source);
  const body = program.body.filter((s) => s.type !== "Empty");
  if (body.length !== 1 || body[0].type !== "Expr") {
    const at = body[1] ?? body[0] ?? { line: 1, col: 1 };
    throw new ScriptSyntaxError("A condition must be a single expression, like plot.count(\"rose\") >= 4", at.line, at.col);
  }
  return body[0].expr;
}

function collectFuncs(node: unknown, out: A.Func[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectFuncs(n, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "Func") out.push(node as A.Func);
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (v && typeof v === "object") collectFuncs(v, out);
  }
}

// ---- errors ----

/** A script error at a source position. `catchable`: a script `try/catch` may catch it. */
export class ScriptError extends Error {
  readonly line: number;
  readonly col: number;
  readonly catchable: boolean;
  /** The thrown value for `throw x`. */
  readonly thrown: unknown;
  /** Which script and hook (filled in by the runtime). */
  where: string | null = null;
  constructor(message: string, pos: A.Pos, catchable = true, thrown?: unknown) {
    super(message);
    this.name = "ScriptError";
    this.line = pos.line;
    this.col = pos.col;
    this.catchable = catchable;
    this.thrown = thrown;
  }
}

// ---- scopes ----

export type BindingKind = "let" | "const" | "var" | "func" | "param" | "builtin";

export interface Binding {
  value: unknown;
  kind: BindingKind;
}

export class Scope {
  readonly vars = new Map<string, Binding>();
  readonly parent: Scope | null;
  constructor(parent: Scope | null) {
    this.parent = parent;
  }
  lookup(name: string): Binding | undefined {
    const own = this.vars.get(name);
    if (own) return own;
    for (let s = this.parent; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
}

// ---- control flow signals ----

const BREAK = { signal: "break" } as const;
const CONTINUE = { signal: "continue" } as const;
class Ret {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}
type Signal = typeof BREAK | typeof CONTINUE | Ret | undefined;

/** Optional-chain short circuit marker; never escapes a Chain node. */
const SHORT = Symbol("short");

export const DEFAULT_BUDGET = 2_000_000;
export const MAX_CALL_DEPTH = 200;
const MAX_ARRAY_LENGTH = 1_000_000;

export interface InterpreterOptions {
  budget?: number;
  maxDepth?: number;
}

export class Interpreter {
  steps = 0;
  budget: number;
  private readonly maxDepth: number;
  private depth = 0;
  private pos: A.Pos = { line: 1, col: 1 };
  /** Running top-level code after a restore: skip declarations whose names are already bound. */
  private restoring: Scope | null = null;
  readonly info: CallInfo;

  constructor(opts: InterpreterOptions = {}) {
    this.budget = opts.budget ?? DEFAULT_BUDGET;
    this.maxDepth = opts.maxDepth ?? MAX_CALL_DEPTH;
    this.info = {
      call: (fn, args) => this.call(fn, args),
      fail: (message) => this.fail(message),
      charge: (n) => this.charge(n),
    };
  }

  /** Start a fresh step budget (one per hook call). */
  resetBudget(budget = this.budget): void {
    this.budget = budget;
    this.steps = 0;
  }

  fail(message: string, catchable = true): never {
    throw new ScriptError(message, this.pos, catchable);
  }

  /** Count `n` steps of host work (array methods etc.) against the budget. */
  charge(n: number): void {
    this.steps += n;
    if (this.steps > this.budget) this.overBudget();
  }

  private overBudget(): never {
    throw new ScriptError(
      `The script ran too long (more than ${this.budget.toLocaleString("en-US")} steps in one call). Is there an endless loop?`,
      this.pos,
      false
    );
  }

  private tick(node: A.Pos): void {
    this.pos = node;
    if (++this.steps > this.budget) this.overBudget();
  }

  // ---- entry points ----

  /** Hoist the program's top-level functions into `scope`. */
  hoist(program: Program, scope: Scope): void {
    for (const s of program.body) if (s.type === "FuncDecl") scope.vars.set(s.name, { value: new Closure(s.func, scope), kind: "func" });
  }

  /**
   * Run the program's top-level statements in `scope` (functions already hoisted).
   * `restoring`: declarations whose names are all bound already keep those values.
   */
  runTop(program: Program, scope: Scope, restoring = false): void {
    this.restoring = restoring ? scope : null;
    try {
      this.contained(() => {
        for (const s of program.body) {
          if (s.type === "FuncDecl") continue;
          const sig = this.exec(s, scope);
          if (sig) this.fail(sig === BREAK ? "`break` outside a loop" : "`continue` outside a loop");
        }
      });
    } finally {
      this.restoring = null;
    }
  }

  evaluate(expr: A.Expr, scope: Scope): unknown {
    return this.contained(() => this.eval(expr, scope));
  }

  /** Call a script or host function (an entry point for hooks, and for callbacks from host functions). */
  call(fn: unknown, args: unknown[]): unknown {
    return this.contained(() => {
      if (fn instanceof Closure) return this.callClosure(fn, args);
      if (fn instanceof HostFn) return this.callHost(fn, args);
      return this.fail(`${typeOf(fn) === "undefined" ? "undefined" : toStr(fn)} is not a function`);
    });
  }

  /**
   * Run interpreter work so that only ScriptErrors come out: a JS stack overflow or a
   * conversion limit hit anywhere inside becomes an uncatchable script error at the current
   * position. Scripts come from shared files; nothing they do may crash the engine.
   */
  private contained<T>(f: () => T): T {
    try {
      return f();
    } catch (err) {
      if (err instanceof ScriptError) throw err;
      if (isLimitError(err)) {
        const msg = err instanceof RangeError ? "The script went too deep (the call stack ran out). Is something nested or recursing too far?" : (err as Error).message;
        throw new ScriptError(msg, this.pos, false);
      }
      throw err;
    }
  }

  private callHost(fn: HostFn, args: unknown[]): unknown {
    const at = this.pos;
    // Engine functions look ids up in ordinary objects; an inherited name ("constructor",
    // "__proto__", "toString"...) would reach a real JS function or prototype there. No game
    // id is ever one of those names, so the engine never sees them (in any argument, or as a
    // key / string value one level inside an object argument such as a condition or policy).
    if (!fn.pure) for (const a of args) guardHostArg(a, (m) => this.fail(`${fn.name}: ${m}`));
    try {
      return fn.impl(args, this.info);
    } catch (err) {
      if (err instanceof ScriptError) throw err;
      // Engine or JS errors inside a host function become script errors here. Resource limits
      // (stack overflow, too-large conversions) can't be caught by the script.
      throw new ScriptError(`${fn.name}: ${err instanceof Error ? err.message : String(err)}`, at, !isLimitError(err));
    } finally {
      this.pos = at;
    }
  }

  private callClosure(fn: Closure, args: unknown[]): unknown {
    if (this.depth >= this.maxDepth) this.fail(`Too many nested calls (more than ${this.maxDepth}). Is a function calling itself forever?`, false);
    const at = this.pos;
    const f = fn.func;
    const scope = new Scope(fn.scope);
    this.depth++;
    try {
      f.params.forEach((p, i) => this.bind(p, args[i], scope, "param"));
      if (f.rest) this.bind(f.rest, args.slice(f.params.length), scope, "param");
      if (!Array.isArray(f.body)) return this.eval(f.body, scope);
      const sig = this.execBlock(f.body, scope);
      return sig instanceof Ret ? sig.value : undefined;
    } finally {
      this.depth--;
      this.pos = at;
    }
  }

  // ---- statements ----

  private execBlock(body: A.Stmt[], scope: Scope): Signal {
    for (const s of body) if (s.type === "FuncDecl") scope.vars.set(s.name, { value: new Closure(s.func, scope), kind: "func" });
    for (const s of body) {
      const sig = this.exec(s, scope);
      if (sig) return sig;
    }
    return undefined;
  }

  private exec(s: A.Stmt, scope: Scope): Signal {
    this.tick(s);
    switch (s.type) {
      case "Expr":
        this.eval(s.expr, scope);
        return undefined;
      case "VarDecl":
        this.execVarDecl(s, scope);
        return undefined;
      case "FuncDecl":
        return undefined; // hoisted
      case "Return":
        return new Ret(s.arg ? this.eval(s.arg, scope) : undefined);
      case "If":
        if (this.eval(s.test, scope)) return this.execNested(s.cons, scope);
        return s.alt ? this.execNested(s.alt, scope) : undefined;
      case "Block":
        return this.execBlock(s.body, new Scope(scope));
      case "While":
        while (this.eval(s.test, scope)) {
          const sig = this.execNested(s.body, scope);
          if (sig === BREAK) break;
          if (sig instanceof Ret) return sig;
          this.tick(s);
        }
        return undefined;
      case "DoWhile":
        do {
          const sig = this.execNested(s.body, scope);
          if (sig === BREAK) break;
          if (sig instanceof Ret) return sig;
          this.tick(s);
        } while (this.eval(s.test, scope));
        return undefined;
      case "For":
        return this.execFor(s, scope);
      case "ForEach":
        return this.execForEach(s, scope);
      case "Break":
        return BREAK;
      case "Continue":
        return CONTINUE;
      case "Switch":
        return this.execSwitch(s, scope);
      case "Throw": {
        const value = this.eval(s.arg, scope);
        this.pos = s;
        const message = isPlainObject(value) && typeof value.message === "string" ? value.message : toStr(value);
        throw new ScriptError(`Uncaught: ${message}`, s, true, value);
      }
      case "Try":
        return this.execTry(s, scope);
      case "Empty":
        return undefined;
    }
  }

  /** A statement body that may be a lone declaration: give it its own scope. */
  private execNested(s: A.Stmt, scope: Scope): Signal {
    if (s.type === "Block") return this.execBlock(s.body, new Scope(scope));
    return this.exec(s, s.type === "VarDecl" ? new Scope(scope) : scope);
  }

  private execVarDecl(s: A.VarDecl, scope: Scope): void {
    for (const d of s.decls) {
      if (this.restoring === scope) {
        const names = patternNames(d.target);
        if (names.length && names.every((n) => scope.vars.has(n))) continue;
      }
      const value = d.init ? this.eval(d.init, scope) : undefined;
      this.bind(d.target, value, scope, s.kind);
    }
  }

  private execFor(s: A.For, outer: Scope): Signal {
    const scope = new Scope(outer);
    if (s.init) {
      if (s.init.type === "VarDecl") this.execVarDecl(s.init, scope);
      else this.eval(s.init, scope);
    }
    const perIteration = s.init?.type === "VarDecl" && s.init.kind !== "var";
    let iterScope = scope;
    for (;;) {
      if (s.test && !this.eval(s.test, iterScope)) break;
      const sig = this.execNested(s.body, iterScope);
      if (sig === BREAK) break;
      if (sig instanceof Ret) return sig;
      if (perIteration) {
        // Fresh bindings per iteration, so closures capture each value (like JS `let`).
        const next = new Scope(outer);
        for (const [k, b] of iterScope.vars) next.vars.set(k, { ...b });
        iterScope = next;
      }
      if (s.update) this.eval(s.update, iterScope);
      this.tick(s);
    }
    return undefined;
  }

  private execForEach(s: A.ForEach, outer: Scope): Signal {
    const iter = this.eval(s.iter, outer);
    this.pos = s;
    let items: unknown[];
    if (s.of) {
      if (Array.isArray(iter)) items = iter;
      else if (typeof iter === "string") items = Array.from(iter);
      else return this.fail(`for...of needs an array or a string, not ${describeType(iter)}. For an object use keys(obj), values(obj) or entries(obj).`);
    } else {
      items = this.keysOf(iter);
    }
    // Arrays are walked live by index, like JS.
    const live = s.of && Array.isArray(iter);
    const n = live ? Infinity : items.length;
    for (let i = 0; live ? i < (iter as unknown[]).length : i < n; i++) {
      const scope = new Scope(outer);
      const value = items[i];
      if (s.kind) this.bind(s.target, value, scope, s.kind);
      else this.assignPattern(s.target, value, scope);
      const sig = this.execNested(s.body, scope);
      if (sig === BREAK) break;
      if (sig instanceof Ret) return sig;
      this.tick(s);
    }
    return undefined;
  }

  private execSwitch(s: A.Switch, outer: Scope): Signal {
    const v = this.eval(s.disc, outer);
    const scope = new Scope(outer);
    let start = s.cases.findIndex((c) => c.test !== null && strictEquals(this.eval(c.test, scope), v));
    if (start < 0) start = s.cases.findIndex((c) => c.test === null);
    if (start < 0) return undefined;
    for (let i = start; i < s.cases.length; i++) {
      const sig = this.execBlock(s.cases[i].body, scope);
      if (sig === BREAK) return undefined;
      if (sig) return sig;
    }
    return undefined;
  }

  private execTry(s: A.Try, scope: Scope): Signal {
    let result: Signal;
    try {
      result = this.execBlock(s.block, new Scope(scope));
    } catch (err) {
      if (!(err instanceof ScriptError) || !err.catchable || !s.handler) {
        if (s.finalizer) {
          const fin = this.execBlock(s.finalizer, new Scope(scope));
          if (fin) return fin;
        }
        throw err;
      }
      const handlerScope = new Scope(scope);
      if (s.param) {
        const value = err.thrown !== undefined ? err.thrown : errorObject(err);
        this.bind(s.param, value, handlerScope, "let");
      }
      try {
        result = this.execBlock(s.handler, handlerScope);
      } catch (inner) {
        if (s.finalizer) {
          const fin = this.execBlock(s.finalizer, new Scope(scope));
          if (fin) return fin;
        }
        throw inner;
      }
    }
    if (s.finalizer) {
      const fin = this.execBlock(s.finalizer, new Scope(scope));
      if (fin) return fin;
    }
    return result;
  }

  // ---- bindings ----

  /** Declare the names in `p` in `scope`. */
  private bind(p: A.Pattern, value: unknown, scope: Scope, kind: BindingKind): void {
    switch (p.type) {
      case "Ident": {
        const existing = scope.vars.get(p.name);
        if (existing && existing.kind !== "var" && existing.kind !== "param" && !(existing.kind === "func" && kind === "var")) {
          this.pos = p;
          this.fail(`"${p.name}" is already declared here`);
        }
        scope.vars.set(p.name, { value, kind });
        return;
      }
      case "DefaultPattern":
        this.bind(p.target, value === undefined ? this.eval(p.value, scope) : value, scope, kind);
        return;
      case "ArrayPattern":
        this.destructureArray(p, value, (t, v) => this.bind(t, v, scope, kind));
        return;
      case "ObjectPattern":
        this.destructureObject(p, value, scope, (t, v) => this.bind(t, v, scope, kind));
        return;
      case "Member":
        this.pos = p;
        this.fail("You can't declare a property; use a plain name");
    }
  }

  /** Assign to existing variables / properties named in `p`. */
  private assignPattern(p: A.Pattern, value: unknown, scope: Scope): void {
    switch (p.type) {
      case "Ident":
        this.setVar(p, value, scope);
        return;
      case "Member": {
        const obj = this.eval(p.object, scope);
        const key = p.computed ? propKey(this.eval(p.prop as A.Expr, scope)) : (p.prop as string);
        this.pos = p;
        this.setProp(obj, key, value);
        return;
      }
      case "DefaultPattern":
        this.assignPattern(p.target, value === undefined ? this.eval(p.value, scope) : value, scope);
        return;
      case "ArrayPattern":
        this.destructureArray(p, value, (t, v) => this.assignPattern(t, v, scope));
        return;
      case "ObjectPattern":
        this.destructureObject(p, value, scope, (t, v) => this.assignPattern(t, v, scope));
        return;
    }
  }

  private destructureArray(p: A.ArrayPattern, value: unknown, set: (t: A.Pattern, v: unknown) => void): void {
    this.pos = p;
    const arr = Array.isArray(value) ? value : typeof value === "string" ? Array.from(value) : this.fail(`Can't unpack ${describeType(value)} as an array`);
    p.elements.forEach((el, i) => {
      if (el) set(el, arr[i]);
    });
    if (p.rest) set(p.rest, arr.slice(p.elements.length));
  }

  private destructureObject(p: A.ObjectPattern, value: unknown, scope: Scope, set: (t: A.Pattern, v: unknown) => void): void {
    this.pos = p;
    if (value === null || value === undefined) this.fail(`Can't unpack ${describeType(value)}`);
    const used = new Set<string>();
    for (const prop of p.props) {
      const key = prop.computed ? propKey(this.eval(prop.key as A.Expr, scope)) : (prop.key as string);
      used.add(key);
      set(prop.value, this.getProp(value, key));
    }
    if (p.rest) {
      const rest = newObject();
      for (const k of this.keysOf(value)) if (!used.has(k)) setOwn(rest, k, this.getProp(value, k));
      set(p.rest, rest);
    }
  }

  private setVar(id: A.Ident, value: unknown, scope: Scope): void {
    const b = scope.lookup(id.name);
    this.pos = id;
    if (!b) this.fail(`"${id.name}" is not declared. Declare it first with let ${id.name} = ...`);
    if (b.kind === "const") this.fail(`"${id.name}" is a const and can't be changed. Declare it with let if it needs to change.`);
    if (b.kind === "func") this.fail(`"${id.name}" is a function declaration and can't be replaced`);
    if (b.kind === "builtin") this.fail(`"${id.name}" is built in and can't be replaced. Pick another name.`);
    b.value = value;
  }

  // ---- expressions ----

  private eval(e: A.Expr, scope: Scope): unknown {
    this.tick(e);
    switch (e.type) {
      case "Literal":
        return e.value;
      case "Template": {
        let s = e.quasis[0];
        for (let i = 0; i < e.exprs.length; i++) s += toStr(this.eval(e.exprs[i], scope)) + e.quasis[i + 1];
        this.checkString(s);
        return s;
      }
      case "Ident": {
        const b = scope.lookup(e.name);
        if (!b) {
          this.pos = e;
          return this.fail(`"${e.name}" is not defined`);
        }
        return b.value;
      }
      case "Array": {
        const out: unknown[] = [];
        for (const el of e.elements) {
          if (el.type === "Spread") this.append(out, this.spreadItems(this.eval(el.arg, scope)));
          else out.push(el.type === "Literal" && el.hole ? undefined : this.eval(el, scope));
        }
        return out;
      }
      case "Object": {
        const o = newObject();
        for (const pr of e.props) {
          if (pr.type === "Spread") {
            const src = this.eval(pr.arg, scope);
            if (src === null || src === undefined) continue;
            for (const k of this.keysOf(src)) setOwn(o, k, this.getProp(src, k));
            continue;
          }
          const key = pr.computed ? propKey(this.eval(pr.key as A.Expr, scope)) : (pr.key as string);
          setOwn(o, key, this.eval(pr.value, scope));
        }
        return o;
      }
      case "Func":
        return new Closure(e, scope);
      case "Unary":
        return this.evalUnary(e, scope);
      case "Update": {
        const old = toNum(this.read(e.target, scope));
        const next = e.op === "++" ? old + 1 : old - 1;
        this.write(e.target, next, scope);
        return e.prefix ? next : old;
      }
      case "Binary":
        return this.binary(e.op, this.eval(e.left, scope), this.eval(e.right, scope), e);
      case "Logical": {
        const l = this.eval(e.left, scope);
        if (e.op === "&&") return l ? this.eval(e.right, scope) : l;
        if (e.op === "||") return l ? l : this.eval(e.right, scope);
        return l === null || l === undefined ? this.eval(e.right, scope) : l;
      }
      case "Cond":
        return this.eval(e.test, scope) ? this.eval(e.cons, scope) : this.eval(e.alt, scope);
      case "Assign":
        return this.evalAssign(e, scope);
      case "Member":
      case "Call": {
        const v = this.evalChainPart(e, scope);
        return v === SHORT ? undefined : v;
      }
      case "Chain": {
        const v = this.evalChainPart(e.expr, scope);
        return v === SHORT ? undefined : v;
      }
    }
  }

  private evalUnary(e: A.Unary, scope: Scope): unknown {
    if (e.op === "typeof") {
      if (e.arg.type === "Ident" && !scope.lookup(e.arg.name)) return "undefined";
      return typeOf(this.eval(e.arg, scope));
    }
    if (e.op === "delete") {
      const m = e.arg as A.Member;
      const obj = this.eval(m.object, scope);
      const key = m.computed ? propKey(this.eval(m.prop as A.Expr, scope)) : (m.prop as string);
      this.pos = e;
      if (isPlainObject(obj)) return delete obj[key];
      return this.fail(`You can only delete properties of your own objects, not ${describeType(obj)}`);
    }
    const v = this.eval(e.arg, scope);
    if (e.op === "!") return !v;
    if (e.op === "-") return -toNum(v);
    return toNum(v);
  }

  private evalAssign(e: A.Assign, scope: Scope): unknown {
    if (e.op === "=") {
      const value = this.eval(e.value, scope);
      this.assignPattern(e.target, value, scope);
      return value;
    }
    const target = e.target as A.Ident | A.Member;
    // Evaluate the object / key once for compound assignment.
    let obj: unknown;
    let key = "";
    let current: unknown;
    if (target.type === "Member") {
      obj = this.eval(target.object, scope);
      key = target.computed ? propKey(this.eval(target.prop as A.Expr, scope)) : (target.prop as string);
      this.pos = target;
      current = this.getProp(obj, key);
    } else current = this.read(target, scope);
    const put = (v: unknown) => {
      if (target.type === "Member") {
        this.pos = target;
        this.setProp(obj, key, v);
      } else this.setVar(target, v, scope);
      return v;
    };
    switch (e.op) {
      case "&&=":
        return current ? put(this.eval(e.value, scope)) : current;
      case "||=":
        return current ? current : put(this.eval(e.value, scope));
      case "??=":
        return current === null || current === undefined ? put(this.eval(e.value, scope)) : current;
      default: {
        const op = e.op.slice(0, -1) as A.BinaryOp;
        return put(this.binary(op, current, this.eval(e.value, scope), e));
      }
    }
  }

  private read(t: A.Ident | A.Member, scope: Scope): unknown {
    if (t.type === "Ident") return this.eval(t, scope);
    const obj = this.eval(t.object, scope);
    const key = t.computed ? propKey(this.eval(t.prop as A.Expr, scope)) : (t.prop as string);
    this.pos = t;
    return this.getProp(obj, key);
  }

  private write(t: A.Ident | A.Member, value: unknown, scope: Scope): void {
    this.assignPattern(t, value, scope);
  }

  /** Member / call evaluation inside an optional chain; returns SHORT when a `?.` hit null/undefined. */
  private evalChainPart(e: A.Expr, scope: Scope): unknown {
    if (e.type === "Member") {
      const obj = this.evalChainPart(e.object, scope);
      if (obj === SHORT) return SHORT;
      if (e.optional && (obj === null || obj === undefined)) return SHORT;
      const key = e.computed ? propKey(this.eval(e.prop as A.Expr, scope)) : (e.prop as string);
      this.pos = e;
      return this.getProp(obj, key);
    }
    if (e.type === "Call") {
      let fn: unknown;
      let label: string;
      if (e.callee.type === "Member") {
        const m = e.callee;
        const obj = this.evalChainPart(m.object, scope);
        if (obj === SHORT) return SHORT;
        if (m.optional && (obj === null || obj === undefined)) return SHORT;
        const key = m.computed ? propKey(this.eval(m.prop as A.Expr, scope)) : (m.prop as string);
        this.pos = m;
        fn = this.getProp(obj, key);
        label = key;
      } else {
        fn = this.evalChainPart(e.callee, scope);
        if (fn === SHORT) return SHORT;
        label = e.callee.type === "Ident" ? e.callee.name : "this value";
      }
      if (e.optional && (fn === null || fn === undefined)) return SHORT;
      const args: unknown[] = [];
      for (const a of e.args) {
        if (a.type === "Spread") this.append(args, this.spreadItems(this.eval(a.arg, scope)));
        else args.push(this.eval(a, scope));
      }
      this.pos = e;
      if (!isCallable(fn)) return this.fail(`${label} is not a function (it is ${describeType(fn)})`);
      return this.call(fn, args);
    }
    if (e.type === "Chain") return this.evalChainPart(e.expr, scope);
    return this.eval(e, scope);
  }

  /** out.push(...items), counted against the budget and the array limit (no native spread of script arrays). */
  private append(out: unknown[], items: readonly unknown[]): void {
    this.checkLength(out.length + items.length);
    this.charge(items.length);
    for (let i = 0; i < items.length; i++) out.push(items[i]);
  }

  private spreadItems(v: unknown): unknown[] {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") return Array.from(v);
    return this.fail(`Only arrays and strings can be spread with ..., not ${describeType(v)}`);
  }

  // ---- property access ----

  getProp(obj: unknown, key: string): unknown {
    if (obj === null || obj === undefined) return this.fail(`Can't read "${key}" of ${obj === null ? "null" : "undefined"}`);
    if (typeof obj === "string") {
      if (key === "length") return obj.length;
      if (isIndex(key)) return obj[Number(key)];
      return stringMethod(obj, key);
    }
    if (typeof obj === "number") return numberMethod(obj, key);
    if (typeof obj === "boolean") return undefined;
    if (Array.isArray(obj)) {
      if (key === "length") return obj.length;
      if (isIndex(key)) return obj[Number(key)];
      return arrayMethod(obj, key);
    }
    if (obj instanceof HostObject) return obj.get(key);
    if (obj instanceof Closure) return key === "name" ? (obj.func.name ?? "") : undefined;
    if (obj instanceof HostFn) return key === "name" ? obj.name : undefined;
    const o = obj as PlainObject;
    return Object.hasOwn(o, key) ? o[key] : undefined;
  }

  setProp(obj: unknown, key: string, value: unknown): void {
    if (obj === null || obj === undefined) this.fail(`Can't set "${key}" of ${obj === null ? "null" : "undefined"}`);
    if (Array.isArray(obj)) {
      if (key === "length") {
        const n = toNum(value);
        if (!Number.isInteger(n) || n < 0) this.fail("An array length must be a whole number of 0 or more");
        this.checkLength(n);
        this.charge(Math.abs(n - obj.length));
        obj.length = n;
        return;
      }
      if (!isIndex(key)) this.fail(`Arrays only take number indexes, not "${key}". Use an object for named keys.`);
      const i = Number(key);
      this.checkLength(i + 1);
      if (i > obj.length) this.charge(i - obj.length);
      obj[i] = value;
      return;
    }
    if (obj instanceof HostObject) {
      obj.set(key, value, this.info);
      return;
    }
    if (isPlainObject(obj)) {
      setOwn(obj, key, value);
      return;
    }
    this.fail(`Can't set "${key}" on ${describeType(obj)}`);
  }

  keysOf(v: unknown): string[] {
    if (Array.isArray(v)) return v.map((_, i) => String(i));
    if (typeof v === "string") return Array.from(v, (_, i) => String(i));
    if (v instanceof HostObject) return v.keys();
    if (isPlainObject(v)) return Object.keys(v);
    if (v === null || v === undefined) return this.fail(`Can't list the keys of ${describeType(v)}`);
    return [];
  }

  private checkLength(n: number): void {
    if (n > MAX_ARRAY_LENGTH) this.fail(`Arrays are limited to ${MAX_ARRAY_LENGTH.toLocaleString("en-US")} items`, false);
  }

  private checkString(s: string): void {
    if (s.length > MAX_ARRAY_LENGTH) this.fail(`Strings are limited to ${MAX_ARRAY_LENGTH.toLocaleString("en-US")} characters`, false);
  }

  // ---- operators ----

  private binary(op: A.BinaryOp, l: unknown, r: unknown, at: A.Pos): unknown {
    switch (op) {
      case "+": {
        if (typeof l === "number" && typeof r === "number") return l + r;
        if (typeof l === "string" || typeof r === "string" || isObjectLike(l) || isObjectLike(r)) {
          const s = toStr(l) + toStr(r);
          this.pos = at;
          this.checkString(s);
          return s;
        }
        return toNum(l) + toNum(r);
      }
      case "-":
        return toNum(l) - toNum(r);
      case "*":
        return toNum(l) * toNum(r);
      case "/":
        return toNum(l) / toNum(r);
      case "%":
        return toNum(l) % toNum(r);
      case "**":
        return toNum(l) ** toNum(r);
      case "===":
        return strictEquals(l, r);
      case "!==":
        return !strictEquals(l, r);
      case "==":
        return looseEquals(l, r);
      case "!=":
        return !looseEquals(l, r);
      case "<":
      case ">":
      case "<=":
      case ">=": {
        if (typeof l === "string" && typeof r === "string") {
          return op === "<" ? l < r : op === ">" ? l > r : op === "<=" ? l <= r : l >= r;
        }
        const a = toNum(l);
        const b = toNum(r);
        return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
      }
      case "in":
        this.pos = at;
        if (Array.isArray(r)) return propKey(l) === "length" || (isIndex(propKey(l)) && Number(propKey(l)) < r.length);
        if (r instanceof HostObject) return r.has(propKey(l));
        if (isPlainObject(r)) return Object.hasOwn(r, propKey(l));
        return this.fail(`"in" needs an object or array on the right, not ${describeType(r)}`);
    }
  }
}

/** Names every plain JS object inherits; never valid engine ids. */
const INHERITED_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

/** Refuse inherited names as engine ids: in a string argument, or in the keys / values of an object or array argument (nested, bounded). */
function guardHostArg(v: unknown, fail: (message: string) => never, depth = 0): void {
  if (typeof v === "string") {
    if (INHERITED_NAMES.has(v)) fail(`"${v}" can't be used as a name here`);
    return;
  }
  if (depth >= 6 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length && i < 10_000; i++) guardHostArg(v[i], fail, depth + 1);
  } else if (isPlainObject(v)) {
    for (const k of Object.keys(v)) {
      if (INHERITED_NAMES.has(k)) fail(`"${k}" can't be used as a key here`);
      guardHostArg(v[k], fail, depth + 1);
    }
  }
}

/** A resource limit hit inside JS: stack overflow, invalid string/array length, or our conversion limit. */
function isLimitError(err: unknown): boolean {
  return err instanceof RangeError || err instanceof ConversionLimitError;
}

function isObjectLike(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}

function looseEquals(l: unknown, r: unknown): boolean {
  if (strictEquals(l, r)) return true;
  if ((l === null || l === undefined) && (r === null || r === undefined)) return true;
  if (l === null || l === undefined || r === null || r === undefined) return false;
  const prim = (v: unknown) => typeof v === "number" || typeof v === "string" || typeof v === "boolean";
  if (prim(l) && prim(r)) {
    if (typeof l === typeof r) return false;
    return toNum(l) === toNum(r);
  }
  return false;
}

function isIndex(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key);
}

export function propKey(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return toStr(v);
}

export function describeType(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "an array";
  if (v instanceof HostObject) return v.describe();
  if (typeof v === "string") return `the string ${JSON.stringify(v.length > 30 ? `${v.slice(0, 30)}...` : v)}`;
  if (typeof v === "number" || typeof v === "boolean") return `${typeof v} ${String(v)}`;
  if (isCallable(v)) return "a function";
  return "an object";
}

function errorObject(err: ScriptError): PlainObject {
  const o = newObject();
  o.message = err.message;
  o.line = err.line;
  o.col = err.col;
  return o;
}

/** Variable names a declaration pattern binds. */
export function patternNames(p: A.Pattern): string[] {
  switch (p.type) {
    case "Ident":
      return [p.name];
    case "DefaultPattern":
      return patternNames(p.target);
    case "ArrayPattern":
      return [...p.elements.flatMap((e) => (e ? patternNames(e) : [])), ...(p.rest ? patternNames(p.rest) : [])];
    case "ObjectPattern":
      return [...p.props.flatMap((pr) => patternNames(pr.value)), ...(p.rest ? [p.rest.name] : [])];
    case "Member":
      return [];
  }
}
