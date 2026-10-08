// Static checks for scripts (scenario validation and the editor's lint): syntax
// errors, misspelled hooks, top-level code that would run every cycle by mistake.

import type { ScenarioIssue } from "../flow/validate";
import { HOOKS, HOOK_NAMES } from "./docs";
import type * as A from "./ast";
import { compile, compileExpression, patternNames } from "./interpreter";
import { ScriptSyntaxError } from "./lexer";

export interface ScriptDiagnostic {
  level: "error" | "warning";
  message: string;
  line: number;
  col: number;
}

/** Edit distance, for "did you mean" on hook names. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Diagnostics for a whole script. `kind`: a plot's script or the controller (no `plot` there). */
export function diagnoseScript(source: string, kind: "plot" | "controller"): ScriptDiagnostic[] {
  const out: ScriptDiagnostic[] = [];
  let program;
  try {
    program = compile(source);
  } catch (err) {
    if (err instanceof ScriptSyntaxError) return [{ level: "error", message: err.message, line: err.line, col: err.col }];
    throw err;
  }
  for (const s of program.body) {
    if (s.type !== "FuncDecl") continue;
    if (HOOK_NAMES.includes(s.name)) {
      const hook = HOOKS.find((h) => h.name === s.name)!;
      if (hook.scope === "plot" && kind === "controller") {
        out.push({ level: "warning", message: `${s.name} only runs in plot scripts.`, line: s.line, col: s.col });
      }
      continue;
    }
    // Looks like a misspelled hook (on*/after*): it would never be called.
    if (/^(on|after)[A-Z]/.test(s.name)) {
      const near = HOOK_NAMES.map((h) => [h, distance(h.toLowerCase(), s.name.toLowerCase())] as const).sort((x, y) => x[1] - y[1])[0];
      const hint = near && near[1] <= 3 ? ` Did you mean ${near[0]}?` : ` Hooks: ${HOOK_NAMES.join(", ")}.`;
      out.push({ level: "warning", message: `${s.name} isn't a hook, so it never runs by itself.${hint}`, line: s.line, col: s.col });
    }
  }
  if (kind === "controller") {
    const free = freeUse(program.body, "plot");
    if (free) out.push({ level: "warning", message: "The controller script has no `plot`. Use plots, getPlot(id) or a loop: for (const plot of plots) { ... }", line: free.line, col: free.col });
  }
  return out;
}

/** First use of `name` that no enclosing declaration binds (rough scope walk), or null. */
function freeUse(body: A.Stmt[], name: string): A.Pos | null {
  const declares = (stmts: A.Stmt[]) =>
    stmts.some((s) => (s.type === "VarDecl" && s.decls.some((d) => patternNames(d.target).includes(name))) || (s.type === "FuncDecl" && s.name === name));
  const visit = (node: unknown, bound: boolean): A.Pos | null => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      const b = bound || declares(node.filter((n): n is A.Stmt => !!n && typeof n === "object" && "type" in n));
      for (const n of node) {
        const hit = visit(n, b);
        if (hit) return hit;
      }
      return null;
    }
    const n = node as A.Node;
    if (n.type === "Ident") return !bound && n.name === name ? n : null;
    if (n.type === "Func") {
      const b = bound || n.params.some((p) => patternNames(p).includes(name)) || (!!n.rest && patternNames(n.rest).includes(name));
      return visit(n.body, b);
    }
    if (n.type === "ForEach") return visit(n.iter, bound) ?? visit(n.body, bound || patternNames(n.target).includes(name));
    if (n.type === "Member") return visit(n.object, bound) ?? (n.computed ? visit(n.prop, bound) : null);
    if (n.type === "Prop") return (n.computed ? visit(n.key, bound) : null) ?? visit(n.value, bound);
    for (const [k, v] of Object.entries(n)) {
      if (k === "line" || k === "col" || k === "type") continue;
      const hit = visit(v, bound);
      if (hit) return hit;
    }
    return null;
  };
  return visit(body, false);
}

/** An error message for a broken exit-condition expression, or null. */
export function checkScriptExpression(expr: string): string | null {
  if (!expr.trim()) return "The script condition is empty. Write an expression, like plot.count(\"chorus_fruit\") >= 4.";
  try {
    compileExpression(expr);
    return null;
  } catch (err) {
    if (err instanceof ScriptSyntaxError) return `The script condition has a syntax error at column ${err.col}: ${err.message}`;
    throw err;
  }
}

/** Scenario validation: syntax errors stop the run; hook warnings are shown. */
export function checkScript(source: string, enabled: boolean | undefined, path: string, kind: "plot" | "controller", issues: ScenarioIssue[]): void {
  if (enabled === false || !source.trim()) return;
  for (const d of diagnoseScript(source, kind)) {
    issues.push({ level: d.level, path, message: `Line ${d.line}: ${d.message}` });
  }
}
