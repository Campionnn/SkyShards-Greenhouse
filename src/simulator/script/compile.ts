// Compiles script functions (and exit-condition expressions) to JavaScript: a faster equivalent of
// the tree-walking interpreter in interpreter.ts. Each script function is compiled once (cached by
// its AST node, and ASTs are cached by source), the first time it is called.
//
// Equivalence is the contract. The generated code does exactly what `Interpreter.exec` / `eval`
// would do for the same node, in the same order: the same steps charged at the same points (so
// ScriptsState.steps and the leaderboard's step cap don't move), the same `pos` updates (so errors
// keep their line/col), the same scopes and bindings (closures capture the same Scope objects, which
// persistence and `===` observe), and the same calls into the interpreter's helpers for everything
// that touches values (getProp, setProp, call, bind, binary...). Anything not handled here is handed
// back to the interpreter node by node (`I.eval` / `I.exec`), which is exact by definition. The
// interpreter-vs-compiled differential tests pin this (compile.test.ts).
//
// Sandbox: no script text ever reaches the generated source. Every name, string, number and AST
// node is a constant (`k12`, read from an array), so script identifiers never become JavaScript
// identifiers and nothing a script writes can be parsed as code; name resolution stays in Scope.
// The source is built only from the fixed templates below, temporaries (`t3`) and labels (`L4`).

import type * as A from "./ast";

/** Static facts about the AST the generator needs (from interpreter.ts, so both agree). */
export interface CodegenStatics {
  /** Does this block get a scope of its own (`blockScope`)? */
  blockIsScoped(body: readonly A.Stmt[]): boolean;
  /** Does this node create functions anywhere inside (`createsFunctions`)? */
  createsFunctions(node: object): boolean;
  /** Array / string methods by name (the stdlib tables), for direct calls. */
  arrayMethod(name: string): unknown;
  stringMethod(name: string): unknown;
}

export interface Generated {
  /** Body of `new Function("H", "K", source)`, which returns the compiled function. */
  source: string;
  /** The constants the source reads as `K[i]`. */
  consts: unknown[];
}

interface LoopCtx {
  /** Label to `break` for a script `break` / `continue` (null: not in a compiled loop). */
  brk: string | null;
  cont: string | null;
}

const NO_LOOP: LoopCtx = { brk: null, cont: null };

class Gen {
  private readonly out: string[] = [];
  readonly consts: unknown[] = [];
  private readonly constIds = new Map<unknown, number>();
  private n = 0;
  private readonly st: CodegenStatics;
  constructor(st: CodegenStatics) {
    this.st = st;
  }

  source(): string {
    const head = this.consts.map((_, i) => `k${i} = K[${i}]`);
    return `"use strict";\nconst ${head.length ? head.join(", ") : "k_ = 0"};\nreturn function (I, S0, args) {\n${this.out.join("\n")}\n};`;
  }

  // ---- building blocks ----

  /** A constant (AST node, name, string or number) by reference. */
  private k(v: unknown): string {
    // A Map key can't tell -0 from 0: keep -0 a constant of its own.
    let i = Object.is(v, -0) ? undefined : this.constIds.get(v);
    if (i === undefined) {
      i = this.consts.length;
      this.consts.push(v);
      this.constIds.set(v, i);
    }
    return `k${i}`;
  }

  private t(): string {
    return `t${this.n++}`;
  }

  private label(): string {
    return `L${this.n++}`;
  }

  private emit(s: string): void {
    this.out.push(s);
  }

  /** `Interpreter.tick(node)`. */
  private tick(node: A.Pos): void {
    this.emit(`I.pos = ${this.k(node)}; if (++I.steps > I.budget) I.overBudget();`);
  }

  private lit(v: A.Literal["value"]): string {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    return this.k(v);
  }

  // ---- functions ----

  /** `callClosure` after the scope is made: bind the parameters, run the body. */
  func(f: A.Func): void {
    const S = "S0";
    for (let i = 0; i < f.params.length; i++) {
      const p = f.params[i];
      // `bind` of a plain name into the fresh call scope: the only binding that can already be there
      // is an earlier parameter of the same name, which `bind` allows; so it is just the set.
      if (p.type === "Ident") this.emit(`${S}.vars.set(${this.k(p.name)}, { value: args[${i}], kind: "param" });`);
      else this.emit(`I.bind(${this.k(p)}, args[${i}], ${S}, "param");`);
    }
    if (f.rest) this.emit(`I.bind(${this.k(f.rest)}, args.slice(${f.params.length}), ${S}, "param");`);
    if (!Array.isArray(f.body)) {
      const v = this.ex(f.body, S);
      this.emit(`return ${v};`);
      return;
    }
    // execBlock(f.body, scope): hoists into the function scope itself.
    this.block(f.body, S, NO_LOOP, false);
    this.emit("return undefined;");
  }

  /** `evaluate(expr, scope)` without the containment (the caller keeps it). */
  expression(e: A.Expr): void {
    const v = this.ex(e, "S0");
    this.emit(`return ${v};`);
  }

  // ---- statements ----

  /** `execBlock(body, scope)`, in a fresh scope when `scoped`. */
  private block(body: readonly A.Stmt[], S: string, ctx: LoopCtx, scoped: boolean): void {
    this.emit("{");
    let B = S;
    if (scoped) {
      B = this.t();
      this.emit(`const ${B} = new H.Scope(${S});`);
    }
    for (const s of body) {
      if (s.type === "FuncDecl") this.emit(`${B}.vars.set(${this.k(s.name)}, { value: new H.Closure(${this.k(s.func)}, ${B}), kind: "func" });`);
    }
    for (const s of body) this.stmt(s, B, ctx);
    this.emit("}");
  }

  /** `execNested(s, scope)`. */
  private nested(s: A.Stmt, S: string, ctx: LoopCtx): void {
    if (s.type === "Block") {
      this.block(s.body, S, ctx, this.st.blockIsScoped(s.body));
      return;
    }
    if (s.type === "VarDecl") {
      this.emit("{");
      const N = this.t();
      this.emit(`const ${N} = new H.Scope(${S});`);
      this.stmt(s, N, ctx);
      this.emit("}");
      return;
    }
    this.stmt(s, S, ctx);
  }

  /** A statement the interpreter runs (`I.exec` ticks it), passing its signal on. */
  private fallbackStmt(s: A.Stmt, S: string, ctx: LoopCtx): void {
    const sg = this.t();
    this.emit(`const ${sg} = I.exec(${this.k(s)}, ${S});`);
    const brk = ctx.brk ? `break ${ctx.brk};` : "return undefined;";
    const cont = ctx.cont ? `break ${ctx.cont};` : "return undefined;";
    this.emit(`if (${sg} !== undefined) { if (${sg} === H.BREAK) ${brk} else if (${sg} === H.CONTINUE) ${cont} else return ${sg}.value; }`);
  }

  /** `exec(s, scope)`. */
  private stmt(s: A.Stmt, S: string, ctx: LoopCtx): void {
    switch (s.type) {
      case "Switch":
      case "Try":
      case "Throw":
        this.fallbackStmt(s, S, ctx);
        return;
      default:
        break;
    }
    this.tick(s);
    switch (s.type) {
      case "Expr":
        this.ex(s.expr, S);
        return;
      case "VarDecl":
        this.varDecl(s, S);
        return;
      case "FuncDecl":
      case "Empty":
        return;
      case "Return": {
        const v = s.arg ? this.ex(s.arg, S) : "undefined";
        this.emit(`return ${v};`);
        return;
      }
      case "If": {
        const c = this.ex(s.test, S);
        this.emit(`if (${c}) {`);
        this.nested(s.cons, S, ctx);
        if (s.alt) {
          this.emit("} else {");
          this.nested(s.alt, S, ctx);
        }
        this.emit("}");
        return;
      }
      case "Block":
        this.block(s.body, S, ctx, this.st.blockIsScoped(s.body));
        return;
      case "While": {
        const lb = this.label();
        const lc = this.label();
        this.emit(`${lb}: for (;;) {`);
        const c = this.ex(s.test, S);
        this.emit(`if (!${c}) break; ${lc}: {`);
        this.nested(s.body, S, { brk: lb, cont: lc });
        this.emit("}");
        this.tick(s);
        this.emit("}");
        return;
      }
      case "DoWhile": {
        const lb = this.label();
        const lc = this.label();
        this.emit(`${lb}: for (;;) { ${lc}: {`);
        this.nested(s.body, S, { brk: lb, cont: lc });
        this.emit("}");
        this.tick(s);
        const c = this.ex(s.test, S);
        this.emit(`if (!${c}) break; }`);
        return;
      }
      case "For":
        this.forStmt(s, S);
        return;
      case "ForEach":
        this.forEach(s, S);
        return;
      case "Break":
        this.emit(ctx.brk ? `break ${ctx.brk};` : "return undefined;");
        return;
      case "Continue":
        this.emit(ctx.cont ? `break ${ctx.cont};` : "return undefined;");
        return;
    }
  }

  /** `execVarDecl` (inside functions, where `restoring` never matches the scope). */
  private varDecl(s: A.VarDecl, S: string): void {
    for (const d of s.decls) {
      const v = d.init ? this.ex(d.init, S) : "undefined";
      this.emit(`I.bind(${this.k(d.target)}, ${v}, ${S}, ${this.k(s.kind)});`);
    }
  }

  private forStmt(s: A.For, outer: string): void {
    this.emit("{");
    const F = this.t();
    this.emit(`const ${F} = new H.Scope(${outer});`);
    if (s.init) {
      if (s.init.type === "VarDecl") this.varDecl(s.init, F);
      else this.ex(s.init, F);
    }
    const perIteration = s.init?.type === "VarDecl" && s.init.kind !== "var" && this.st.createsFunctions(s);
    const It = this.t();
    this.emit(`let ${It} = ${F};`);
    const lb = this.label();
    const lc = this.label();
    this.emit(`${lb}: for (;;) {`);
    if (s.test) {
      const c = this.ex(s.test, It);
      this.emit(`if (!${c}) break;`);
    }
    this.emit(`${lc}: {`);
    this.nested(s.body, It, { brk: lb, cont: lc });
    this.emit("}");
    if (perIteration) this.emit(`${It} = I.nextIteration(${It}, ${outer});`);
    if (s.update) this.ex(s.update, It);
    this.tick(s);
    this.emit("}");
    this.emit("}");
  }

  private forEach(s: A.ForEach, outer: string): void {
    this.emit("{");
    const it = this.ex(s.iter, outer);
    const items = this.t();
    const n = this.t();
    const i = this.t();
    this.emit(`I.pos = ${this.k(s)};`);
    if (s.of) {
      // Arrays are walked live by index, like JS.
      this.emit(`const ${items} = I.forOfItems(${it}); const ${n} = ${items} === ${it} ? -1 : ${items}.length;`);
    } else {
      this.emit(`const ${items} = I.keysOf(${it}); const ${n} = ${items}.length;`);
    }
    const lb = this.label();
    const lc = this.label();
    const cond = s.of ? `${i} < (${n} < 0 ? ${it}.length : ${n})` : `${i} < ${n}`;
    this.emit(`${lb}: for (let ${i} = 0; ${cond}; ${i}++) {`);
    const X = this.t();
    this.emit(`const ${X} = new H.Scope(${outer});`);
    const v = `${items}[${i}]`;
    if (s.kind) this.emit(`I.bind(${this.k(s.target)}, ${v}, ${X}, ${this.k(s.kind)});`);
    else this.assign(s.target, v, X);
    this.emit(`${lc}: {`);
    this.nested(s.body, X, { brk: lb, cont: lc });
    this.emit("}");
    this.tick(s);
    this.emit("}");
    this.emit("}");
  }

  /** `assignPattern(p, value, scope)`. `v` must be a temporary or constant (it is read once). */
  private assign(p: A.Pattern, v: string, S: string): void {
    if (p.type === "Ident") {
      this.emit(`I.setVar(${this.k(p)}, ${v}, ${S});`);
      return;
    }
    if (p.type === "Member") {
      const val = this.t();
      this.emit(`const ${val} = ${v};`);
      const obj = this.ex(p.object, S);
      const key = p.computed ? this.propKey(p.prop as A.Expr, S) : this.k(p.prop);
      this.emit(`I.pos = ${this.k(p)}; I.setProp(${obj}, ${key}, ${val});`);
      return;
    }
    this.emit(`I.assignPattern(${this.k(p)}, ${v}, ${S});`);
  }

  // ---- expressions ----

  /** `propKey(eval(e))`. */
  private propKey(e: A.Expr, S: string): string {
    const v = this.ex(e, S);
    const t = this.t();
    this.emit(`const ${t} = H.propKey(${v});`);
    return t;
  }

  /** `eval(e, scope)`: emits the work, returns a name holding the value. */
  private ex(e: A.Expr, S: string): string {
    switch (e.type) {
      case "Member":
      case "Call":
      case "Chain":
        return this.chainRoot(e, S);
      default:
        break;
    }
    this.tick(e);
    const t = this.t();
    switch (e.type) {
      case "Literal":
        return this.lit(e.value);
      case "Ident": {
        const b = this.t();
        this.emit(`const ${b} = ${S}.lookup(${this.k(e.name)}); if (${b} === undefined) I.notDefined(${this.k(e)}); const ${t} = ${b}.value;`);
        return t;
      }
      case "Template": {
        this.emit(`let ${t} = ${this.k(e.quasis[0])};`);
        for (let i = 0; i < e.exprs.length; i++) {
          const v = this.ex(e.exprs[i], S);
          this.emit(`${t} += H.toStr(${v}) + ${this.k(e.quasis[i + 1])};`);
        }
        this.emit(`I.checkString(${t});`);
        return t;
      }
      case "Array": {
        this.emit(`const ${t} = [];`);
        for (const el of e.elements) {
          if (el.type === "Spread") {
            const v = this.ex(el.arg, S);
            this.emit(`I.append(${t}, I.spreadItems(${v}));`);
          } else if (el.type === "Literal" && el.hole) {
            this.emit(`${t}.push(undefined);`);
          } else {
            const v = this.ex(el, S);
            this.emit(`${t}.push(${v});`);
          }
        }
        return t;
      }
      case "Object": {
        this.emit(`const ${t} = H.newObject();`);
        for (const pr of e.props) {
          if (pr.type === "Spread") {
            const src = this.ex(pr.arg, S);
            this.emit(`if (${src} !== null && ${src} !== undefined) for (const k of I.keysOf(${src})) H.setOwn(${t}, k, I.getProp(${src}, k));`);
            continue;
          }
          const key = pr.computed ? this.propKey(pr.key as A.Expr, S) : this.k(pr.key);
          const v = this.ex(pr.value, S);
          this.emit(`H.setOwn(${t}, ${key}, ${v});`);
        }
        return t;
      }
      case "Func":
        this.emit(`const ${t} = new H.Closure(${this.k(e)}, ${S});`);
        return t;
      case "Unary":
        return this.unary(e, S, t);
      case "Update":
        return this.update(e, S, t);
      case "Binary": {
        const l = this.ex(e.left, S);
        const r = this.ex(e.right, S);
        this.emit(`const ${t} = ${this.binary(e.op, l, r, e)};`);
        return t;
      }
      case "Logical": {
        const l = this.ex(e.left, S);
        this.emit(`let ${t};`);
        const test = e.op === "&&" ? l : e.op === "||" ? `!${l}` : `${l} === null || ${l} === undefined`;
        this.emit(`if (${test}) {`);
        const r = this.ex(e.right, S);
        this.emit(`${t} = ${r}; } else ${t} = ${l};`);
        return t;
      }
      case "Cond": {
        const c = this.ex(e.test, S);
        this.emit(`let ${t}; if (${c}) {`);
        const a = this.ex(e.cons, S);
        this.emit(`${t} = ${a}; } else {`);
        const b = this.ex(e.alt, S);
        this.emit(`${t} = ${b}; }`);
        return t;
      }
      case "Assign":
        return this.assignExpr(e, S, t);
    }
  }

  /** `binary(op, l, r, at)`, with the number fast paths `binary` itself takes first. */
  private binary(op: A.BinaryOp, l: string, r: string, at: A.Pos): string {
    const slow = `I.binary(${this.k(op)}, ${l}, ${r}, ${this.k(at)})`;
    const nums = `typeof ${l} === "number" && typeof ${r} === "number"`;
    switch (op) {
      case "+":
        return `${nums} ? ${l} + ${r} : ${slow}`;
      case "-":
        return `${nums} ? ${l} - ${r} : ${slow}`;
      case "*":
        return `${nums} ? ${l} * ${r} : ${slow}`;
      case "/":
        return `${nums} ? ${l} / ${r} : ${slow}`;
      case "<":
        return `${nums} ? ${l} < ${r} : ${slow}`;
      case ">":
        return `${nums} ? ${l} > ${r} : ${slow}`;
      case "<=":
        return `${nums} ? ${l} <= ${r} : ${slow}`;
      case ">=":
        return `${nums} ? ${l} >= ${r} : ${slow}`;
      case "===":
        return `${l} === ${r} || H.strictEquals(${l}, ${r})`;
      case "!==":
        return `!(${l} === ${r} || H.strictEquals(${l}, ${r}))`;
      default:
        return slow;
    }
  }

  private unary(e: A.Unary, S: string, t: string): string {
    if (e.op === "delete") {
      this.emit(`const ${t} = I.evalUnary(${this.k(e)}, ${S});`);
      return t;
    }
    if (e.op === "typeof") {
      if (e.arg.type === "Ident") {
        this.emit(`let ${t}; if (!${S}.lookup(${this.k(e.arg.name)})) ${t} = "undefined"; else {`);
        const v = this.ex(e.arg, S);
        this.emit(`${t} = H.typeOf(${v}); }`);
        return t;
      }
      const v = this.ex(e.arg, S);
      this.emit(`const ${t} = H.typeOf(${v});`);
      return t;
    }
    const v = this.ex(e.arg, S);
    this.emit(`const ${t} = ${e.op === "!" ? `!${v}` : e.op === "-" ? `-H.toNum(${v})` : `H.toNum(${v})`};`);
    return t;
  }

  /** `read(target)`: the current value of an Ident or Member. */
  private read(target: A.Ident | A.Member, S: string): string {
    if (target.type === "Ident") return this.ex(target, S);
    const obj = this.ex(target.object, S);
    const key = target.computed ? this.propKey(target.prop as A.Expr, S) : this.k(target.prop);
    const t = this.t();
    this.emit(`I.pos = ${this.k(target)}; const ${t} = I.getProp(${obj}, ${key});`);
    return t;
  }

  private update(e: A.Update, S: string, t: string): string {
    const cur = this.read(e.target, S);
    const old = this.t();
    const next = this.t();
    this.emit(`const ${old} = H.toNum(${cur}); const ${next} = ${old} ${e.op === "++" ? "+" : "-"} 1;`);
    // write(): assignPattern, which evaluates a member's object and key again.
    this.assign(e.target, next, S);
    this.emit(`const ${t} = ${e.prefix ? next : old};`);
    return t;
  }

  private assignExpr(e: A.Assign, S: string, t: string): string {
    if (e.op === "=") {
      const v = this.ex(e.value, S);
      this.assign(e.target, v, S);
      this.emit(`const ${t} = ${v};`);
      return t;
    }
    if (e.target.type !== "Ident" && e.target.type !== "Member") {
      this.emit(`const ${t} = I.evalAssign(${this.k(e)}, ${S});`);
      return t;
    }
    const target = e.target;
    // Compound: the object and key are evaluated once.
    let obj = "";
    let key = "";
    let cur: string;
    if (target.type === "Member") {
      obj = this.ex(target.object, S);
      key = target.computed ? this.propKey(target.prop as A.Expr, S) : this.k(target.prop);
      cur = this.t();
      this.emit(`I.pos = ${this.k(target)}; const ${cur} = I.getProp(${obj}, ${key});`);
    } else cur = this.ex(target, S);
    const put = (v: string): void => {
      if (target.type === "Member") this.emit(`I.pos = ${this.k(target)}; I.setProp(${obj}, ${key}, ${v});`);
      else this.emit(`I.setVar(${this.k(target)}, ${v}, ${S});`);
    };
    this.emit(`let ${t};`);
    if (e.op === "&&=" || e.op === "||=" || e.op === "??=") {
      const test = e.op === "&&=" ? cur : e.op === "||=" ? `!${cur}` : `${cur} === null || ${cur} === undefined`;
      this.emit(`if (${test}) {`);
      const v = this.ex(e.value, S);
      put(v);
      this.emit(`${t} = ${v}; } else ${t} = ${cur};`);
      return t;
    }
    const v = this.ex(e.value, S);
    const op = e.op.slice(0, -1) as A.BinaryOp;
    this.emit(`${t} = I.binary(${this.k(op)}, ${cur}, ${v}, ${this.k(e)});`);
    put(t);
    return t;
  }

  // ---- member / call chains ----

  /**
   * `eval` of a Member / Call / Chain: `evalChainPart`, where a `?.` that meets null/undefined ends
   * the whole chain with undefined (the interpreter's SHORT): here a `break` out of the chain's block.
   */
  private chainRoot(e: A.Member | A.Call | A.Chain, S: string): string {
    this.tick(e);
    const R = this.t();
    const L = this.label();
    this.emit(`let ${R}; ${L}: {`);
    const v = this.part(e, S, L, R);
    this.emit(`${R} = ${v}; }`);
    return R;
  }

  private short(v: string, L: string, R: string): void {
    this.emit(`if (${v} === null || ${v} === undefined) { ${R} = undefined; break ${L}; }`);
  }

  /** `evalChainPart(e, scope)`. */
  private part(e: A.Expr, S: string, L: string, R: string): string {
    if (e.type === "Member") {
      const obj = this.part(e.object, S, L, R);
      if (e.optional) this.short(obj, L, R);
      const key = e.computed ? this.propKey(e.prop as A.Expr, S) : this.k(e.prop);
      const t = this.t();
      this.emit(`I.pos = ${this.k(e)}; const ${t} = I.getProp(${obj}, ${key});`);
      return t;
    }
    if (e.type === "Chain") return this.part(e.expr, S, L, R);
    if (e.type !== "Call") return this.ex(e, S);

    const fn = this.t();
    let label: string;
    /** Direct stdlib method: the method's table entry, when the receiver is an array / a string. */
    let direct: { impl: string; recv: string; name: string } | null = null;
    const c = e.callee;
    if (c.type === "Member") {
      const obj = this.part(c.object, S, L, R);
      if (c.optional) this.short(obj, L, R);
      const key = c.computed ? this.propKey(c.prop as A.Expr, S) : this.k(c.prop);
      label = key;
      this.emit(`I.pos = ${this.k(c)};`);
      const name = c.computed ? null : (c.prop as string);
      const am = name !== null ? this.st.arrayMethod(name) : undefined;
      const sm = name !== null ? this.st.stringMethod(name) : undefined;
      if (am !== undefined || sm !== undefined) {
        // getProp would make a fresh HostFn around the table entry and call() would run it; calling
        // the entry the same way (I.callMethod) skips that allocation. Unobservable: the HostFn never
        // reaches the script.
        const impl = this.t();
        const tests: string[] = [];
        if (am !== undefined) tests.push(`Array.isArray(${obj}) ? ${this.k(am)}`);
        if (sm !== undefined) tests.push(`typeof ${obj} === "string" ? ${this.k(sm)}`);
        this.emit(`const ${impl} = ${tests.join(" : ")} : undefined;`);
        this.emit(`const ${fn} = ${impl} !== undefined ? ${impl} : I.getProp(${obj}, ${key});`);
        direct = { impl, recv: obj, name: this.k(name) };
      } else {
        this.emit(`const ${fn} = I.getProp(${obj}, ${key});`);
      }
    } else {
      const v = this.part(c, S, L, R);
      this.emit(`const ${fn} = ${v};`);
      label = c.type === "Ident" ? this.k(c.name) : this.k("this value");
    }
    if (e.optional) this.short(fn, L, R);
    const args = this.t();
    if (e.args.some((a) => a.type === "Spread")) {
      this.emit(`const ${args} = [];`);
      for (const a of e.args) {
        if (a.type === "Spread") {
          const v = this.ex(a.arg, S);
          this.emit(`I.append(${args}, I.spreadItems(${v}));`);
        } else {
          const v = this.ex(a, S);
          this.emit(`${args}.push(${v});`);
        }
      }
    } else {
      const vs = e.args.map((a) => this.ex(a as A.Expr, S));
      this.emit(`const ${args} = [${vs.join(", ")}];`);
    }
    const t = this.t();
    this.emit(`I.pos = ${this.k(e)}; let ${t};`);
    const generic = `if (!H.isCallable(${fn})) I.notFunction(${label}, ${fn}); ${t} = I.call(${fn}, ${args});`;
    if (direct) this.emit(`if (${direct.impl} !== undefined) ${t} = I.callMethod(${direct.impl}, ${direct.name}, ${direct.recv}, ${args}); else { ${generic} }`);
    else this.emit(generic);
    return t;
  }
}

/** JavaScript for one script function: `(I, S0, args) => value`, S0 being its fresh call scope. */
export function generateFunction(f: A.Func, st: CodegenStatics): Generated {
  const g = new Gen(st);
  g.func(f);
  return { source: g.source(), consts: g.consts };
}

/** JavaScript for one expression (an exit condition): `(I, S0) => value`. */
export function generateExpression(e: A.Expr, st: CodegenStatics): Generated {
  const g = new Gen(st);
  g.expression(e);
  return { source: g.source(), consts: g.consts };
}
