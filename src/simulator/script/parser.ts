// Recursive-descent parser for the script language (a JavaScript subset).
// Supported: let/const/var, functions and arrows (default + rest params,
// destructuring), if/else, while, do-while, for, for-of, for-in, switch,
// break/continue, try/catch/finally, throw, template strings, spread, optional
// chaining, ?? and logical assignment. Not supported: classes, `this`, `new`,
// generators, async, regex literals, labels, getters/setters.

import type * as A from "./ast";
import { ScriptSyntaxError, tokenize, type Token } from "./lexer";

const RESERVED = new Set([
  "let", "const", "var", "function", "return", "if", "else", "while", "do", "for", "in", "break", "continue",
  "true", "false", "null", "undefined", "switch", "case", "default", "throw", "try", "catch", "finally", "typeof", "delete",
  "new", "class", "this", "import", "export", "await", "async", "yield", "with", "void", "instanceof", "super", "debugger",
]);

const UNSUPPORTED: Record<string, string> = {
  new: "`new` isn't supported. Use plain objects and arrays ({...}, [...]).",
  class: "Classes aren't supported. Use plain objects and functions.",
  this: "`this` isn't supported. Pass the object you need as a parameter.",
  import: "Scripts can't import modules; everything is already available.",
  export: "Scripts don't export anything; define hook functions like `function onSession() {}` instead.",
  await: "Scripts are synchronous; there is nothing to await.",
  async: "Scripts are synchronous; async functions aren't supported.",
  yield: "Generators aren't supported.",
  with: "`with` isn't supported.",
  void: "`void` isn't supported. Use `undefined`.",
  instanceof: "`instanceof` isn't supported. Use `typeof` or `isArray(x)`.",
  super: "Classes aren't supported.",
  debugger: "Use `log(...)` to inspect values.",
};

const BINARY_PREC: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "==": 4, "!=": 4, "===": 4, "!==": 4,
  "<": 5, ">": 5, "<=": 5, ">=": 5, in: 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
  "**": 8,
};

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "&&=", "||=", "??="]);

/**
 * Deepest nesting the parser accepts (blocks, parentheses, arrays, unary chains, a.b.c chains...).
 * Scripts come from shared files: without a limit, deeply nested input would overflow the
 * JavaScript stack in the parser (on the page) and in every tree walker after it.
 */
export const MAX_NESTING = 200;
/** Binary operators in a row (a + b + c ...). Parsed iteratively, but evaluated recursively. */
const MAX_CHAIN = 1000;

export function parse(src: string): A.Stmt[] {
  return new Parser(tokenize(src)).program();
}

class Parser {
  private pos = 0;
  /** Inside a for-statement head, where `in` starts a for-in loop. */
  private noIn = false;
  private fnDepth = 0;
  private loopDepth = 0;
  private switchDepth = 0;
  private funcId = 0;
  private depth = 0;
  private readonly toks: Token[];

  constructor(toks: Token[]) {
    this.toks = toks;
  }

  /** Run a recursive parse step one nesting level deeper; too deep is a syntax error. */
  private nested<T>(f: () => T): T {
    if (++this.depth > MAX_NESTING) {
      this.depth = 0; // the error ends parsing
      this.fail(`The code is nested too deeply (more than ${MAX_NESTING} levels)`);
    }
    try {
      return f();
    } finally {
      this.depth--;
    }
  }

  // ---- token helpers ----

  private get t(): Token {
    return this.toks[this.pos];
  }
  private peek(n = 1): Token {
    return this.toks[Math.min(this.pos + n, this.toks.length - 1)];
  }
  private next(): Token {
    const tok = this.toks[this.pos];
    if (this.pos < this.toks.length - 1) this.pos++;
    return tok;
  }
  private is(value: string, tok: Token = this.t): boolean {
    return (tok.type === "punct" || tok.type === "name") && tok.value === value;
  }
  private eat(value: string): boolean {
    if (this.is(value)) {
      this.next();
      return true;
    }
    return false;
  }
  private fail(msg: string, tok: Token = this.t): never {
    throw new ScriptSyntaxError(msg, tok.line, tok.col);
  }
  private describe(tok: Token): string {
    if (tok.type === "eof") return "the end of the script";
    if (tok.type === "str") return "a string";
    if (tok.type === "tpl") return "a template string";
    if (tok.type === "num") return `number ${tok.value}`;
    return `"${tok.value}"`;
  }
  private expect(value: string, what?: string): Token {
    if (!this.is(value)) this.fail(`Expected ${what ?? `"${value}"`} but found ${this.describe(this.t)}`);
    return this.next();
  }
  private pos0(tok: Token = this.t): A.Pos {
    return { line: tok.line, col: tok.col };
  }
  private semicolon(): void {
    if (this.eat(";")) return;
    if (this.is("}") || this.t.type === "eof" || this.t.nl) return;
    this.fail(`Expected ";" or a new line but found ${this.describe(this.t)}`);
  }
  private ident(what = "a name"): string {
    const tok = this.t;
    if (tok.type !== "name") this.fail(`Expected ${what} but found ${this.describe(tok)}`);
    if (UNSUPPORTED[tok.value]) this.fail(UNSUPPORTED[tok.value]);
    if (RESERVED.has(tok.value)) this.fail(`"${tok.value}" is a reserved word and can't be used as a name`);
    this.next();
    return tok.value;
  }

  // ---- statements ----

  program(): A.Stmt[] {
    const body: A.Stmt[] = [];
    while (this.t.type !== "eof") body.push(this.statement());
    return body;
  }

  private block(): A.Stmt[] {
    this.expect("{");
    const body: A.Stmt[] = [];
    while (!this.is("}")) {
      if (this.t.type === "eof") this.fail('Missing "}" to close a block');
      body.push(this.statement());
    }
    this.next();
    return body;
  }

  private statement(): A.Stmt {
    return this.nested(() => this.statementInner());
  }

  private statementInner(): A.Stmt {
    const tok = this.t;
    const p = this.pos0();
    if (tok.type === "punct") {
      if (tok.value === "{") return { type: "Block", body: this.block(), ...p };
      if (tok.value === ";") {
        this.next();
        return { type: "Empty", ...p };
      }
    }
    if (tok.type === "name") {
      if (UNSUPPORTED[tok.value] && tok.value !== "async") this.fail(UNSUPPORTED[tok.value]);
      switch (tok.value) {
        case "let":
        case "const":
        case "var": {
          const d = this.varDecl();
          this.semicolon();
          return d;
        }
        case "function": {
          this.next();
          const name = this.ident("a function name");
          const func = this.funcRest(name, p);
          return { type: "FuncDecl", name, func, ...p };
        }
        case "return": {
          if (this.fnDepth === 0) this.fail("`return` only works inside a function");
          this.next();
          const arg = this.is(";") || this.is("}") || this.t.type === "eof" || this.t.nl ? null : this.expression();
          this.semicolon();
          return { type: "Return", arg, ...p };
        }
        case "if": {
          this.next();
          this.expect("(");
          const test = this.expression();
          this.expect(")");
          const cons = this.statement();
          const alt = this.eat("else") ? this.statement() : null;
          return { type: "If", test, cons, alt, ...p };
        }
        case "while": {
          this.next();
          this.expect("(");
          const test = this.expression();
          this.expect(")");
          const body = this.loopBody();
          return { type: "While", test, body, ...p };
        }
        case "do": {
          this.next();
          const body = this.loopBody();
          this.expect("while");
          this.expect("(");
          const test = this.expression();
          this.expect(")");
          this.eat(";");
          return { type: "DoWhile", body, test, ...p };
        }
        case "for":
          return this.forStatement();
        case "break":
        case "continue": {
          this.next();
          if (tok.value === "continue" ? this.loopDepth === 0 : this.loopDepth === 0 && this.switchDepth === 0) {
            this.fail(`\`${tok.value}\` only works inside a loop${tok.value === "break" ? " or switch" : ""}`, tok);
          }
          this.semicolon();
          return { type: tok.value === "break" ? "Break" : "Continue", ...p };
        }
        case "switch":
          return this.switchStatement();
        case "throw": {
          this.next();
          if (this.t.nl) this.fail("Put the value to throw on the same line as `throw`");
          const arg = this.expression();
          this.semicolon();
          return { type: "Throw", arg, ...p };
        }
        case "try": {
          this.next();
          const block = this.block();
          let param: A.Pattern | null = null;
          let handler: A.Stmt[] | null = null;
          let finalizer: A.Stmt[] | null = null;
          if (this.eat("catch")) {
            if (this.eat("(")) {
              param = this.bindingTarget();
              this.expect(")");
            }
            handler = this.block();
          }
          if (this.eat("finally")) finalizer = this.block();
          if (!handler && !finalizer) this.fail("`try` needs a `catch` or `finally` block");
          return { type: "Try", block, param, handler, finalizer, ...p };
        }
      }
    }
    const expr = this.expression();
    this.semicolon();
    return { type: "Expr", expr, ...p };
  }

  private loopBody(): A.Stmt {
    this.loopDepth++;
    try {
      return this.statement();
    } finally {
      this.loopDepth--;
    }
  }

  private varDecl(): A.VarDecl {
    const p = this.pos0();
    const kind = this.next().value as A.DeclKind;
    const decls: A.VarDecl["decls"] = [];
    do {
      const target = this.bindingTarget();
      let init: A.Expr | null = null;
      if (this.eat("=")) init = this.assign();
      else if (kind === "const" && !(this.is("of") || this.is("in"))) this.fail("A `const` needs a value: const x = ...");
      decls.push({ target, init });
    } while (this.eat(","));
    return { type: "VarDecl", kind, decls, ...p };
  }

  private forStatement(): A.Stmt {
    const p = this.pos0();
    this.next();
    this.expect("(");
    let init: A.VarDecl | A.Expr | null = null;
    const saved = this.noIn;
    this.noIn = true;
    try {
      if (this.is("let") || this.is("const") || this.is("var")) {
        const declTok = this.t;
        const kind = declTok.value as A.DeclKind;
        if (this.peek().type !== "eof") {
          // Look for `for (let x of ...)`.
          const start = this.pos;
          this.next();
          const target = this.bindingTarget();
          if (this.is("of") || this.is("in")) {
            const of = this.next().value === "of";
            this.noIn = false;
            const iter = of ? this.assign() : this.expression();
            this.expect(")");
            const body = this.loopBody();
            return { type: "ForEach", kind, target, of, iter, body, ...p };
          }
          this.pos = start;
        }
        init = this.varDecl();
      } else if (!this.is(";")) {
        const expr = this.expression();
        if (this.is("of") || this.is("in")) {
          const of = this.next().value === "of";
          this.noIn = false;
          const target = this.toPattern(expr);
          const iter = of ? this.assign() : this.expression();
          this.expect(")");
          const body = this.loopBody();
          return { type: "ForEach", kind: null, target, of, iter, body, ...p };
        }
        init = expr;
      }
    } finally {
      this.noIn = saved;
    }
    this.expect(";");
    const test = this.is(";") ? null : this.expression();
    this.expect(";");
    const update = this.is(")") ? null : this.expression();
    this.expect(")");
    const body = this.loopBody();
    return { type: "For", init, test, update, body, ...p };
  }

  private switchStatement(): A.Stmt {
    const p = this.pos0();
    this.next();
    this.expect("(");
    const disc = this.expression();
    this.expect(")");
    this.expect("{");
    const cases: A.Switch["cases"] = [];
    let sawDefault = false;
    this.switchDepth++;
    try {
      while (!this.eat("}")) {
        let test: A.Expr | null = null;
        if (this.eat("case")) test = this.expression();
        else if (this.is("default")) {
          if (sawDefault) this.fail("A switch can only have one `default`");
          sawDefault = true;
          this.next();
        } else this.fail(`Expected "case", "default" or "}" but found ${this.describe(this.t)}`);
        this.expect(":");
        const body: A.Stmt[] = [];
        while (!this.is("case") && !this.is("default") && !this.is("}")) {
          if (this.t.type === "eof") this.fail('Missing "}" to close the switch');
          body.push(this.statement());
        }
        cases.push({ test, body });
      }
    } finally {
      this.switchDepth--;
    }
    return { type: "Switch", disc, cases, ...p };
  }

  // ---- functions and patterns ----

  /** After `function name`: params and body. */
  private funcRest(name: string | null, p: A.Pos): A.Func {
    this.expect("(");
    const { params, rest } = this.paramList();
    const body = this.funcBody();
    return { type: "Func", id: this.funcId++, name, params, rest, body, arrow: false, ...p };
  }

  /** After "(": parameters through ")". */
  private paramList(): { params: A.Pattern[]; rest: A.Pattern | null } {
    const params: A.Pattern[] = [];
    let rest: A.Pattern | null = null;
    while (!this.is(")")) {
      if (this.eat("...")) {
        rest = this.bindingTarget();
        if (!this.is(")")) this.fail("A rest parameter (...name) must come last");
        break;
      }
      params.push(this.bindingElement());
      if (!this.is(")")) this.expect(",", '"," or ")"');
    }
    this.expect(")");
    return { params, rest };
  }

  private funcBody(): A.Stmt[] {
    const loops = this.loopDepth;
    const switches = this.switchDepth;
    this.loopDepth = 0;
    this.switchDepth = 0;
    this.fnDepth++;
    try {
      return this.block();
    } finally {
      this.fnDepth--;
      this.loopDepth = loops;
      this.switchDepth = switches;
    }
  }

  /** A declaration target with an optional `= default`. */
  private bindingElement(): A.Pattern {
    const p = this.pos0();
    const target = this.bindingTarget();
    if (this.eat("=")) return { type: "DefaultPattern", target, value: this.assign(), ...p };
    return target;
  }

  private bindingTarget(): A.Pattern {
    return this.nested(() => this.bindingTargetInner());
  }

  private bindingTargetInner(): A.Pattern {
    const p = this.pos0();
    if (this.eat("[")) {
      const elements: (A.Pattern | null)[] = [];
      let rest: A.Pattern | null = null;
      while (!this.is("]")) {
        if (this.is(",")) {
          this.next();
          elements.push(null);
          continue;
        }
        if (this.eat("...")) {
          rest = this.bindingTarget();
          break;
        }
        elements.push(this.bindingElement());
        if (!this.is("]")) this.expect(",", '"," or "]"');
      }
      this.expect("]");
      return { type: "ArrayPattern", elements, rest, ...p };
    }
    if (this.eat("{")) {
      const props: A.ObjectPattern["props"] = [];
      let rest: A.Ident | null = null;
      while (!this.is("}")) {
        if (this.eat("...")) {
          const rp = this.pos0();
          rest = { type: "Ident", name: this.ident(), ...rp };
          break;
        }
        const kp = this.pos0();
        let key: string | A.Expr;
        let computed = false;
        if (this.eat("[")) {
          key = this.assign();
          computed = true;
          this.expect("]");
        } else key = this.propertyName();
        let value: A.Pattern;
        if (this.eat(":")) value = this.bindingElement();
        else {
          if (computed) this.fail('A computed key needs ": name"');
          if (RESERVED.has(key as string)) this.fail(`"${key}" is a reserved word and can't be used as a name`);
          value = { type: "Ident", name: key as string, ...kp };
          if (this.eat("=")) value = { type: "DefaultPattern", target: value, value: this.assign(), ...kp };
        }
        props.push({ key, computed, value });
        if (!this.is("}")) this.expect(",", '"," or "}"');
      }
      this.expect("}");
      return { type: "ObjectPattern", props, rest, ...p };
    }
    return { type: "Ident", name: this.ident(), ...p };
  }

  /** Turn an already parsed expression into an assignment target. */
  private toPattern(e: A.Expr | A.Spread): A.Pattern {
    switch (e.type) {
      case "Ident":
        return e;
      case "Member":
        if (e.optional) break;
        return e;
      case "Array": {
        const elements: (A.Pattern | null)[] = [];
        let rest: A.Pattern | null = null;
        e.elements.forEach((el, i) => {
          if (el.type === "Spread") {
            if (i !== e.elements.length - 1) this.fail("A rest element (...x) must come last", this.tokAt(el));
            rest = this.toPattern(el.arg);
          } else elements.push(el.type === "Literal" && el.hole ? null : this.toPattern(el));
        });
        return { type: "ArrayPattern", elements, rest, line: e.line, col: e.col };
      }
      case "Object": {
        const props: A.ObjectPattern["props"] = [];
        let rest: A.Ident | null = null;
        for (const pr of e.props) {
          if (pr.type === "Spread") {
            if (pr.arg.type !== "Ident") this.fail("Only a name can follow ... here", this.tokAt(pr));
            rest = pr.arg;
            continue;
          }
          props.push({ key: pr.key, computed: pr.computed, value: this.toPattern(pr.value) });
        }
        return { type: "ObjectPattern", props, rest, line: e.line, col: e.col };
      }
      case "Assign":
        if (e.op === "=") return { type: "DefaultPattern", target: e.target, value: e.value, line: e.line, col: e.col };
        break;
    }
    this.fail("You can't assign to this", this.tokAt(e));
  }

  private tokAt(n: A.Pos): Token {
    return { type: "punct", value: "", line: n.line, col: n.col, nl: false };
  }

  private propertyName(): string {
    const tok = this.t;
    if (tok.type === "name" || tok.type === "str") {
      this.next();
      return tok.value;
    }
    if (tok.type === "num") {
      this.next();
      return String(tok.num);
    }
    return this.fail(`Expected a property name but found ${this.describe(tok)}`);
  }

  // ---- expressions ----

  expression(): A.Expr {
    // Comma expressions aren't supported; a single assignment-expression.
    return this.assign();
  }

  private assign(): A.Expr {
    return this.nested(() => this.assignInner());
  }

  private assignInner(): A.Expr {
    const arrow = this.tryArrow();
    if (arrow) return arrow;
    const p = this.pos0();
    const left = this.conditional();
    const op = this.t;
    if (op.type === "punct" && ASSIGN_OPS.has(op.value)) {
      this.next();
      const target = op.value === "=" ? this.toPattern(left) : this.simpleTarget(left);
      const value = this.assign();
      return { type: "Assign", op: op.value as A.AssignOp, target, value, ...p };
    }
    return left;
  }

  private simpleTarget(e: A.Expr): A.Ident | A.Member {
    if (e.type === "Ident" || (e.type === "Member" && !e.optional)) return e;
    return this.fail("You can only change a variable or a property here", this.tokAt(e));
  }

  /** Arrow functions: `x => ...` or `(a, b) => ...`. Decided by lookahead. */
  private tryArrow(): A.Expr | null {
    const tok = this.t;
    const p = this.pos0();
    if (tok.type === "name" && this.is("=>", this.peek()) && !RESERVED.has(tok.value)) {
      this.next();
      if (this.peek(0).nl) this.fail("Put => on the same line as its parameters");
      this.next();
      return this.arrowBody([{ type: "Ident", name: tok.value, ...p }], null, p);
    }
    if (!this.is("(")) return null;
    // Find the matching ")" and check for "=>".
    let depth = 0;
    let j = this.pos;
    for (; j < this.toks.length; j++) {
      const k = this.toks[j];
      if (k.type === "eof") return null;
      if (k.type === "punct" && (k.value === "(" || k.value === "[" || k.value === "{")) depth++;
      if (k.type === "punct" && (k.value === ")" || k.value === "]" || k.value === "}")) {
        depth--;
        if (depth === 0) break;
      }
    }
    const after = this.toks[j + 1];
    if (!after || !this.is("=>", after)) return null;
    this.next(); // (
    const { params, rest } = this.paramList();
    if (this.t.nl) this.fail("Put => on the same line as its parameters");
    this.expect("=>");
    return this.arrowBody(params, rest, p);
  }

  private arrowBody(params: A.Pattern[], rest: A.Pattern | null, p: A.Pos): A.Func {
    if (this.is("{")) return { type: "Func", id: this.funcId++, name: null, params, rest, body: this.funcBody(), arrow: true, ...p };
    const saved = this.noIn;
    this.noIn = false;
    this.fnDepth++;
    try {
      return { type: "Func", id: this.funcId++, name: null, params, rest, body: this.assign(), arrow: true, ...p };
    } finally {
      this.fnDepth--;
      this.noIn = saved;
    }
  }

  private conditional(): A.Expr {
    const p = this.pos0();
    const test = this.binary(1);
    if (!this.eat("?")) return test;
    const saved = this.noIn;
    this.noIn = false;
    const cons = this.assign();
    this.noIn = saved;
    this.expect(":", '":" of a ? : expression');
    const alt = this.assign();
    return { type: "Cond", test, cons, alt, ...p };
  }

  private binary(minPrec: number): A.Expr {
    let left = this.unary();
    // a + b + c + ... nests left; long chains are as deep as their length for the tree walkers.
    for (let terms = 0; ; terms++) {
      if (terms > MAX_CHAIN) this.fail(`This expression is too long (more than ${MAX_CHAIN} operators in a row)`);
      const tok = this.t;
      if (tok.type !== "punct" && !(tok.type === "name" && tok.value === "in")) break;
      if (tok.value === "in" && this.noIn) break;
      const prec = BINARY_PREC[tok.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      // ** is right-associative.
      const right = this.binary(tok.value === "**" ? prec : prec + 1);
      const pos = { line: left.line, col: left.col };
      if (tok.value === "&&" || tok.value === "||" || tok.value === "??") {
        left = { type: "Logical", op: tok.value, left, right, ...pos };
      } else {
        left = { type: "Binary", op: tok.value as A.BinaryOp, left, right, ...pos };
      }
    }
    return left;
  }

  private unary(): A.Expr {
    return this.nested(() => this.unaryInner());
  }

  private unaryInner(): A.Expr {
    const tok = this.t;
    const p = this.pos0();
    if (tok.type === "punct" && (tok.value === "!" || tok.value === "-" || tok.value === "+")) {
      this.next();
      return { type: "Unary", op: tok.value, arg: this.unary(), ...p };
    }
    if (tok.type === "name" && (tok.value === "typeof" || tok.value === "delete")) {
      this.next();
      const arg = this.unary();
      if (tok.value === "delete" && arg.type !== "Member") this.fail("`delete` needs a property, like delete obj.key", tok);
      return { type: "Unary", op: tok.value, arg, ...p };
    }
    if (tok.type === "punct" && (tok.value === "++" || tok.value === "--")) {
      this.next();
      const target = this.simpleTarget(this.unary());
      return { type: "Update", op: tok.value, prefix: true, target, ...p };
    }
    return this.postfix();
  }

  private postfix(): A.Expr {
    const p = this.pos0();
    const expr = this.callMember();
    const tok = this.t;
    if (tok.type === "punct" && (tok.value === "++" || tok.value === "--") && !tok.nl) {
      this.next();
      return { type: "Update", op: tok.value, prefix: false, target: this.simpleTarget(expr), ...p };
    }
    return expr;
  }

  private callMember(): A.Expr {
    let expr = this.primary();
    let chained = false;
    // A long a.b.c / f()() chain is as deep as its length for every tree walker after the parser.
    let links = 0;
    for (;; links++) {
      if (links > MAX_NESTING) this.fail(`This chain of calls and properties is too long (more than ${MAX_NESTING})`);
      const tok = this.t;
      const pos = { line: expr.line, col: expr.col };
      if (this.is(".")) {
        this.next();
        const name = this.t;
        if (name.type !== "name") this.fail(`Expected a property name after "." but found ${this.describe(name)}`);
        this.next();
        expr = { type: "Member", object: expr, prop: name.value, computed: false, optional: false, ...pos };
      } else if (this.is("?.")) {
        this.next();
        chained = true;
        if (this.eat("(")) {
          expr = { type: "Call", callee: expr, args: this.args(), optional: true, ...pos };
        } else if (this.eat("[")) {
          const prop = this.expression();
          this.expect("]");
          expr = { type: "Member", object: expr, prop, computed: true, optional: true, ...pos };
        } else {
          const name = this.t;
          if (name.type !== "name") this.fail(`Expected a property name after "?." but found ${this.describe(name)}`);
          this.next();
          expr = { type: "Member", object: expr, prop: name.value, computed: false, optional: true, ...pos };
        }
      } else if (this.is("[")) {
        this.next();
        const saved = this.noIn;
        this.noIn = false;
        const prop = this.expression();
        this.noIn = saved;
        this.expect("]");
        expr = { type: "Member", object: expr, prop, computed: true, optional: false, ...pos };
      } else if (this.is("(")) {
        this.next();
        expr = { type: "Call", callee: expr, args: this.args(), optional: false, ...pos };
      } else if (tok.type === "tpl" && tok.tplHead) {
        this.fail("Tagged templates aren't supported");
      } else break;
    }
    return chained ? { type: "Chain", expr, line: expr.line, col: expr.col } : expr;
  }

  /** After "(": call arguments through ")". */
  private args(): (A.Expr | A.Spread)[] {
    const saved = this.noIn;
    this.noIn = false;
    const out: (A.Expr | A.Spread)[] = [];
    while (!this.is(")")) {
      const p = this.pos0();
      if (this.eat("...")) out.push({ type: "Spread", arg: this.assign(), ...p });
      else out.push(this.assign());
      if (!this.is(")")) this.expect(",", '"," or ")"');
    }
    this.next();
    this.noIn = saved;
    return out;
  }

  private primary(): A.Expr {
    const tok = this.t;
    const p = this.pos0();
    switch (tok.type) {
      case "num":
        this.next();
        return { type: "Literal", value: tok.num!, ...p };
      case "str":
        this.next();
        return { type: "Literal", value: tok.value, ...p };
      case "tpl":
        return this.template();
      case "name": {
        switch (tok.value) {
          case "true":
          case "false":
            this.next();
            return { type: "Literal", value: tok.value === "true", ...p };
          case "null":
            this.next();
            return { type: "Literal", value: null, ...p };
          case "undefined":
            this.next();
            return { type: "Literal", value: undefined, ...p };
          case "function": {
            this.next();
            const name = this.t.type === "name" && !this.is("(") ? this.ident("a function name") : null;
            return this.funcRest(name, p);
          }
        }
        if (UNSUPPORTED[tok.value]) this.fail(UNSUPPORTED[tok.value]);
        return { type: "Ident", name: this.ident(), ...p };
      }
      case "punct":
        if (tok.value === "(") {
          this.next();
          const saved = this.noIn;
          this.noIn = false;
          const e = this.expression();
          this.noIn = saved;
          this.expect(")");
          return e;
        }
        if (tok.value === "[") return this.arrayLiteral();
        if (tok.value === "{") return this.objectLiteral();
        break;
    }
    return this.fail(tok.type === "eof" ? "The script ends in the middle of an expression" : `Unexpected ${this.describe(tok)}`);
  }

  private template(): A.Template {
    const p = this.pos0();
    const quasis: string[] = [];
    const exprs: A.Expr[] = [];
    let tok = this.next();
    quasis.push(tok.value);
    const saved = this.noIn;
    this.noIn = false;
    while (!tok.tplTail) {
      exprs.push(this.expression());
      tok = this.t;
      if (tok.type !== "tpl" || tok.tplHead) this.fail('Expected "}" to close ${ in a template string');
      this.next();
      quasis.push(tok.value);
    }
    this.noIn = saved;
    return { type: "Template", quasis, exprs, ...p };
  }

  private arrayLiteral(): A.ArrayLit {
    const p = this.pos0();
    this.next();
    const saved = this.noIn;
    this.noIn = false;
    const elements: (A.Expr | A.Spread)[] = [];
    while (!this.is("]")) {
      const ep = this.pos0();
      if (this.is(",")) {
        // A hole: `[a, , b]`.
        this.next();
        elements.push({ type: "Literal", value: undefined, hole: true, ...ep });
        continue;
      }
      if (this.eat("...")) elements.push({ type: "Spread", arg: this.assign(), ...ep });
      else elements.push(this.assign());
      if (!this.is("]")) this.expect(",", '"," or "]"');
    }
    this.next();
    this.noIn = saved;
    return { type: "Array", elements, ...p };
  }

  private objectLiteral(): A.ObjectLit {
    const p = this.pos0();
    this.next();
    const saved = this.noIn;
    this.noIn = false;
    const props: (A.Prop | A.Spread)[] = [];
    while (!this.is("}")) {
      const kp = this.pos0();
      if (this.eat("...")) {
        props.push({ type: "Spread", arg: this.assign(), ...kp });
      } else {
        let key: string | A.Expr;
        let computed = false;
        const keyTok = this.t;
        if (this.eat("[")) {
          key = this.assign();
          computed = true;
          this.expect("]");
        } else key = this.propertyName();
        if (this.is("(")) {
          // Method shorthand: { name(a) { ... } }
          const func = this.funcRest(typeof key === "string" ? key : null, kp);
          props.push({ type: "Prop", key, computed, value: func, shorthand: false, ...kp });
        } else if (this.eat(":")) {
          props.push({ type: "Prop", key, computed, value: this.assign(), shorthand: false, ...kp });
        } else {
          if (computed || keyTok.type !== "name") this.fail('Expected ":" after the property name', this.t);
          if (RESERVED.has(key as string) && key !== "undefined") this.fail(`"${key}" is a reserved word and can't be used as a name`, keyTok);
          let value: A.Expr = { type: "Ident", name: key as string, ...kp };
          // `{ a = 1 }` only makes sense as a pattern; keep it as an assignment for toPattern.
          if (this.is("=")) {
            this.next();
            value = { type: "Assign", op: "=", target: value, value: this.assign(), ...kp };
          }
          props.push({ type: "Prop", key, computed: false, value, shorthand: true, ...kp });
        }
      }
      if (!this.is("}")) this.expect(",", '"," or "}"');
    }
    this.next();
    this.noIn = saved;
    return { type: "Object", props, ...p };
  }
}
