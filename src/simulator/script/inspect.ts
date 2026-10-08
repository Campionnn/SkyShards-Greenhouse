// Read-only view of the script variables kept in a state, for the variable
// inspector. Decodes state.scripts without running any script code.

import type { SimulationState } from "../sim/state";
import type { EncodedValue, HeapEntry } from "./types";

export interface InspectedVariable {
  /** "shared" or the script key ("global", "plot:1"). */
  script: string;
  name: string;
  kind: "let" | "const" | "var" | "shared";
  /** One-line rendering. */
  text: string;
  /** Plain JSON-able tree for expanding (functions/engine objects become strings). */
  value: unknown;
}

const MAX_DEPTH = 6;
const MAX_ITEMS = 200;

function render(e: EncodedValue, heap: HeapEntry[], seen: Set<number>, depth: number): unknown {
  if (e === null || typeof e !== "object") return e;
  if ("u" in e) return undefined;
  if ("x" in e) return e.x === "-0" ? 0 : e.x;
  if ("f" in e) return `[function in ${e.s}]`;
  if ("h" in e) {
    const [kind, a, b] = e.h.split(":");
    if (kind === "plot") return `[Plot ${a}]`;
    if (kind === "plant") return `[plant #${b} on Plot ${a}]`;
    return `[${e.h}]`;
  }
  if (seen.has(e.r)) return "[circular]";
  if (depth > MAX_DEPTH) return "[...]";
  const entry = heap[e.r];
  if (!entry) return "[?]";
  seen.add(e.r);
  try {
    if ("a" in entry) {
      const out = entry.a.slice(0, MAX_ITEMS).map((x) => render(x, heap, seen, depth + 1));
      if (entry.a.length > MAX_ITEMS) out.push(`... ${entry.a.length - MAX_ITEMS} more`);
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of entry.o.slice(0, MAX_ITEMS)) out[k] = render(x, heap, seen, depth + 1);
    if (entry.o.length > MAX_ITEMS) out["..."] = `${entry.o.length - MAX_ITEMS} more`;
    return out;
  } finally {
    seen.delete(e.r);
  }
}

export function oneLine(v: unknown, max = 120): string {
  let s: string;
  if (v === undefined) s = "undefined";
  else if (typeof v === "string") s = v.startsWith("[") && v.endsWith("]") ? v : JSON.stringify(v);
  else {
    try {
      s = JSON.stringify(v) ?? String(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Every top-level variable of every script, then `shared`'s keys. */
export function inspectScriptVariables(state: SimulationState): InspectedVariable[] {
  const ss = state.scripts;
  if (!ss) return [];
  const out: InspectedVariable[] = [];
  for (const [script, vars] of Object.entries(ss.scopes)) {
    for (const [name, [kind, value]] of Object.entries(vars)) {
      const v = render(value, ss.heap, new Set(), 0);
      out.push({ script, name, kind, text: oneLine(v), value: v });
    }
  }
  const shared = render(ss.shared, ss.heap, new Set(), 0);
  if (shared && typeof shared === "object" && !Array.isArray(shared)) {
    for (const [name, v] of Object.entries(shared)) out.push({ script: "shared", name, kind: "shared", text: oneLine(v), value: v });
  }
  return out;
}
