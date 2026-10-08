// Runtime values of the script language. Primitives, arrays and plain objects
// are ordinary JS values (plain objects are null-prototype, so no inherited
// keys); functions and engine objects are tagged classes.

import type { Func } from "./ast";
import type { Scope } from "./interpreter";

/** A script function: its AST plus the scope it closes over. */
export class Closure {
  readonly func: Func;
  readonly scope: Scope;
  constructor(func: Func, scope: Scope) {
    this.func = func;
    this.scope = scope;
  }
}

/** What a host function gets besides its arguments. */
export interface CallInfo {
  /** Call a script or host function value (callbacks such as `filter`). */
  call(fn: unknown, args: unknown[]): unknown;
  /** Throw a script error at the call site. */
  fail(message: string): never;
  /** Count `n` steps of host work against the step budget. */
  charge(n: number): void;
}

/** A function implemented by the engine (`log`, `Math.floor`, `plot.place`, array methods...). */
export class HostFn {
  readonly name: string;
  readonly impl: (args: unknown[], info: CallInfo) => unknown;
  /**
   * Works on script values only (array/string methods, Math, JSON, keys...), never on engine
   * records by id, so its arguments aren't screened for inherited names (see `callHost`).
   */
  readonly pure: boolean;
  constructor(name: string, impl: (args: unknown[], info: CallInfo) => unknown, pure = false) {
    this.name = name;
    this.impl = impl;
    this.pure = pure;
  }
}

/**
 * An engine object exposed to scripts (a plot, a plant, `inventory`, `Math`).
 * Reads go through `get`; it is never stored between cycles as-is (see persist.ts).
 */
export abstract class HostObject {
  abstract get(key: string): unknown;
  /**
   * Stable identity ("plot:1", "plant:1:42"): two host objects with the same ref
   * are equal (===), and it is how the value is kept between cycles. null: not storable.
   */
  ref(): string | null {
    return null;
  }
  /** Keys shown by `keys()`, `for...in` and `{...spread}`. */
  keys(): string[] {
    return [];
  }
  set(key: string, _value: unknown, info: CallInfo): void {
    info.fail(`You can't change "${key}" on ${this.describe()}`);
  }
  has(key: string): boolean {
    return this.keys().includes(key);
  }
  abstract describe(): string;
}

/** A HostObject backed by a fixed table of values (namespaces such as `Math`). */
export class HostNamespace extends HostObject {
  private readonly label: string;
  private readonly members: Record<string, unknown>;
  constructor(label: string, members: Record<string, unknown>) {
    super();
    this.label = label;
    this.members = members;
  }
  get(key: string): unknown {
    return Object.hasOwn(this.members, key) ? this.members[key] : undefined;
  }
  keys(): string[] {
    return Object.keys(this.members);
  }
  describe(): string {
    return this.label;
  }
}

export type PlainObject = Record<string, unknown>;

/** Names every plain JS object inherits (`constructor`, `__proto__`, `toString`...). */
const INHERITED = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * An id a script passes to the engine (item, kind, mutation, metric name...). The engine looks
 * ids up in ordinary objects, so an inherited name such as "constructor" or "__proto__" would
 * read a real JS function or prototype; those names are never valid ids, so they are refused.
 */
export function safeId(v: unknown, fail: (message: string) => never, what = "name"): string {
  const s = toStr(v);
  if (INHERITED.has(s)) fail(`"${s}" can't be used as a ${what}`);
  return s;
}

/**
 * Own-property read of an engine record by a key a script chose. Never use `rec[key]` with a
 * script key: "constructor" / "__proto__" / "toString" would hand the script real JS objects.
 */
export function own<T>(rec: Readonly<Record<string, T>> | undefined | null, key: string): T | undefined {
  return rec && Object.hasOwn(rec, key) ? rec[key] : undefined;
}

export function newObject(): PlainObject {
  return Object.create(null) as PlainObject;
}

/** A null-prototype copy of a host-made record, so scripts can read and change it like their own objects. */
export function plain(src: Record<string, unknown>): PlainObject {
  const o = newObject();
  for (const [k, v] of Object.entries(src)) o[k] = v;
  return o;
}

export function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof HostObject) && !(v instanceof Closure) && !(v instanceof HostFn);
}

export function isCallable(v: unknown): v is Closure | HostFn {
  return v instanceof Closure || v instanceof HostFn;
}

/** Own property write that is safe for the key "__proto__". */
export function setOwn(o: PlainObject, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(o, key, { value, writable: true, enumerable: true, configurable: true });
  else o[key] = value;
}

export function typeOf(v: unknown): string {
  if (v === null) return "object";
  if (v instanceof Closure || v instanceof HostFn) return "function";
  const t = typeof v;
  return t === "bigint" || t === "symbol" ? "object" : t;
}

/** `===`: like JS, except engine objects compare by identity ref (the same plant is always ===). */
export function strictEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // A function restored from saved state is the same function.
  if (a instanceof Closure && b instanceof Closure) return a.func === b.func && a.scope === b.scope;
  if (a instanceof HostObject && b instanceof HostObject) {
    const ra = a.ref();
    return ra !== null && ra === b.ref();
  }
  return false;
}

/** Deep copy of plain engine data (JSON-like) into script values (null-prototype objects). */
export function fromData(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromData);
  if (v && typeof v === "object") {
    const o = newObject();
    for (const [k, x] of Object.entries(v)) setOwn(o, k, fromData(x));
    return o;
  }
  return v;
}

/** Thrown when converting a value would build an unreasonably large string. */
export class ConversionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionLimitError";
  }
}

/** Longest string a conversion may build (also the script string limit). */
export const MAX_STRING = 1_000_000;
/** Nested arrays a string conversion follows (JS joins them; a script can nest them very deep). */
const MAX_TO_STR_DEPTH = 100;

/**
 * JS string conversion (template strings and `+`). Like JS, arrays join with commas and an
 * array inside itself reads as "" (cycle). Bounded: too deep or too long throws, so a script
 * can't overflow the stack or build a huge string through a conversion.
 */
export function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return scalarStr(v);
  const out = arrayStr(v, 0, new Set(), { len: 0 });
  return out;
}

function scalarStr(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof HostObject) return v.describe();
  if (v instanceof Closure) return `function ${v.func.name ?? "(anonymous)"}`;
  if (v instanceof HostFn) return `function ${v.name}`;
  return "[object Object]";
}

function arrayStr(arr: unknown[], depth: number, seen: Set<unknown>, budget: { len: number }): string {
  if (depth > MAX_TO_STR_DEPTH) throw new ConversionLimitError(`Can't turn this array into text: it is nested more than ${MAX_TO_STR_DEPTH} levels deep`);
  if (seen.has(arr)) return ""; // like JS: an array that contains itself joins as ""
  seen.add(arr);
  const parts: string[] = [];
  for (const x of arr) {
    const s = x === null || x === undefined ? "" : Array.isArray(x) ? arrayStr(x, depth + 1, seen, budget) : scalarStr(x);
    budget.len += s.length + 1;
    if (budget.len > MAX_STRING) throw new ConversionLimitError(`Strings are limited to ${MAX_STRING.toLocaleString("en-US")} characters`);
    parts.push(s);
  }
  seen.delete(arr);
  return parts.join(",");
}

export function toNum(v: unknown): number {
  // Arrays: [] is 0, [x] is x (nested single-item arrays unwrap), anything else NaN.
  for (let depth = 0; Array.isArray(v); depth++) {
    if (v.length === 0) return 0;
    if (v.length > 1 || depth > MAX_TO_STR_DEPTH) return NaN;
    v = v[0];
  }
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v === undefined) return NaN;
  if (typeof v === "string") return Number(v);
  return NaN;
}

/** Readable rendering for `log` and the variable inspector: JSON-like, bounded. */
export function display(v: unknown, depth = 0, seen: Set<unknown> = new Set()): string {
  if (typeof v === "string") return depth === 0 ? v : JSON.stringify(v);
  if (v === undefined || v === null || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof HostObject || v instanceof Closure || v instanceof HostFn) return toStr(v);
  if (seen.has(v)) return "[circular]";
  if (depth > 4) return Array.isArray(v) ? "[...]" : "{...}";
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const shown = v.slice(0, 50).map((x) => display(x, depth + 1, seen));
      if (v.length > 50) shown.push(`... ${v.length - 50} more`);
      return `[${shown.join(", ")}]`;
    }
    const entries = Object.keys(v as object);
    const shown = entries.slice(0, 50).map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${display((v as PlainObject)[k], depth + 1, seen)}`);
    if (entries.length > 50) shown.push(`... ${entries.length - 50} more`);
    return shown.length ? `{ ${shown.join(", ")} }` : "{}";
  } finally {
    seen.delete(v);
  }
}
