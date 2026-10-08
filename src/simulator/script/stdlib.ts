// Built-in methods (arrays, strings, numbers) and global helpers (Math, keys,
// JSON...). Deterministic: no Math.random (scripts use `random()`, which draws
// from the simulation's seeded RNG), no clock. Host work is charged to the
// step budget so a huge sort or map can't hang the tab.

import {
  Closure,
  display,
  HostFn,
  HostNamespace,
  HostObject,
  isCallable,
  isPlainObject,
  newObject,
  plain,
  setOwn,
  strictEquals,
  toNum,
  toStr,
  type CallInfo,
  type PlainObject,
} from "./values";

/** Built-ins work on script values only, so they are `pure` (their arguments aren't screened). */
const fn = (name: string, impl: (args: unknown[], info: CallInfo) => unknown) => new HostFn(name, impl, true);

/** A method table without a prototype, so `arr.constructor` or `s.__proto__` find nothing. */
function table<T>(methods: { [name: string]: T }): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, methods);
}

function callback(v: unknown, info: CallInfo, what: string): (...a: unknown[]) => unknown {
  if (!isCallable(v)) info.fail(`${what} needs a function, like x => x.stage`);
  return (...a) => info.call(v, a);
}

const int = (v: unknown, fallback: number) => {
  const n = toNum(v);
  return Number.isNaN(n) ? fallback : Math.trunc(n);
};

function relIndex(v: unknown, len: number, fallback: number): number {
  if (v === undefined) return fallback;
  const n = int(v, 0);
  return n < 0 ? Math.max(0, len + n) : Math.min(n, len);
}

function sameValueZero(a: unknown, b: unknown): boolean {
  return strictEquals(a, b) || (Number.isNaN(a) && Number.isNaN(b));
}

/** Default sort order: like JS, by string form, undefined last. */
function defaultCompare(a: unknown, b: unknown): number {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  const x = toStr(a);
  const y = toStr(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function sortArray(arr: unknown[], cmp: unknown, info: CallInfo): unknown[] {
  info.charge(arr.length * Math.max(1, Math.ceil(Math.log2(arr.length + 1))));
  if (cmp === undefined) return arr.sort(defaultCompare);
  const f = callback(cmp, info, "sort");
  return arr.sort((a, b) => {
    const r = toNum(f(a, b));
    return Number.isNaN(r) ? 0 : r;
  });
}

/** Methods on arrays. Returns undefined for unknown names (reading a missing property). */
export function arrayMethod(arr: unknown[], name: string): HostFn | undefined {
  const m = ARRAY_METHODS[name];
  return m ? fn(name, (args, info) => m(arr, args, info)) : undefined;
}

type ArrayImpl = (arr: unknown[], args: unknown[], info: CallInfo) => unknown;

const iterate = (arr: unknown[], args: unknown[], info: CallInfo, what: string) => {
  const f = callback(args[0], info, what);
  info.charge(arr.length);
  return f;
};

const ARRAY_METHODS: Record<string, ArrayImpl> = table<ArrayImpl>({
  push: (arr, args, info) => {
    if (arr.length + args.length > 1_000_000) info.fail("Arrays are limited to 1,000,000 items");
    for (const a of args) arr.push(a);
    return arr.length;
  },
  pop: (arr) => arr.pop(),
  shift: (arr, _a, info) => {
    info.charge(arr.length);
    return arr.shift();
  },
  unshift: (arr, args, info) => {
    info.charge(arr.length);
    if (arr.length + args.length > 1_000_000) info.fail("Arrays are limited to 1,000,000 items");
    const rest = arr.splice(0);
    for (const x of args) arr.push(x);
    for (const x of rest) arr.push(x);
    return arr.length;
  },
  slice: (arr, args, info) => {
    const out = arr.slice(relIndex(args[0], arr.length, 0), relIndex(args[1], arr.length, arr.length));
    info.charge(out.length);
    return out;
  },
  splice: (arr, args, info) => {
    info.charge(arr.length + args.length);
    const start = relIndex(args[0], arr.length, 0);
    const count = args.length < 2 ? arr.length - start : Math.max(0, int(args[1], 0));
    const removed = arr.splice(start, count);
    const insert = args.slice(2);
    if (arr.length + insert.length > 1_000_000) info.fail("Arrays are limited to 1,000,000 items");
    // Insert without spreading (a native spread of a big array overflows the stack).
    const tail = arr.splice(start);
    for (const x of insert) arr.push(x);
    for (const x of tail) arr.push(x);
    return removed;
  },
  concat: (arr, args, info) => {
    const parts = args.map((a) => (Array.isArray(a) ? a : [a]));
    if (parts.reduce((n, p) => n + p.length, arr.length) > 1_000_000) info.fail("Arrays are limited to 1,000,000 items");
    const out = arr.slice();
    for (const p of parts) for (const x of p) out.push(x);
    info.charge(out.length);
    return out;
  },
  join: (arr, args, info) => {
    info.charge(arr.length);
    return arr.map((x) => (x === null || x === undefined ? "" : toStr(x))).join(args[0] === undefined ? "," : toStr(args[0]));
  },
  reverse: (arr, _a, info) => {
    info.charge(arr.length);
    return arr.reverse();
  },
  indexOf: (arr, args, info) => {
    info.charge(arr.length);
    for (let i = relIndex(args[1], arr.length, 0); i < arr.length; i++) if (strictEquals(arr[i], args[0])) return i;
    return -1;
  },
  lastIndexOf: (arr, args, info) => {
    info.charge(arr.length);
    for (let i = arr.length - 1; i >= 0; i--) if (strictEquals(arr[i], args[0])) return i;
    return -1;
  },
  includes: (arr, args, info) => {
    info.charge(arr.length);
    return arr.some((x) => sameValueZero(x, args[0]));
  },
  at: (arr, args) => {
    const i = int(args[0], 0);
    return arr[i < 0 ? arr.length + i : i];
  },
  map: (arr, args, info) => {
    const f = iterate(arr, args, info, "map");
    return arr.map((x, i) => f(x, i, arr));
  },
  filter: (arr, args, info) => {
    const f = iterate(arr, args, info, "filter");
    return arr.filter((x, i) => !!f(x, i, arr));
  },
  forEach: (arr, args, info) => {
    const f = iterate(arr, args, info, "forEach");
    arr.forEach((x, i) => f(x, i, arr));
    return undefined;
  },
  find: (arr, args, info) => {
    const f = iterate(arr, args, info, "find");
    return arr.find((x, i) => !!f(x, i, arr));
  },
  findIndex: (arr, args, info) => {
    const f = iterate(arr, args, info, "findIndex");
    return arr.findIndex((x, i) => !!f(x, i, arr));
  },
  findLast: (arr, args, info) => {
    const f = iterate(arr, args, info, "findLast");
    for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i], i, arr)) return arr[i];
    return undefined;
  },
  some: (arr, args, info) => {
    const f = iterate(arr, args, info, "some");
    return arr.some((x, i) => !!f(x, i, arr));
  },
  every: (arr, args, info) => {
    const f = iterate(arr, args, info, "every");
    return arr.every((x, i) => !!f(x, i, arr));
  },
  reduce: (arr, args, info) => {
    const f = iterate(arr, args, info, "reduce");
    if (args.length < 2) {
      if (arr.length === 0) info.fail("reduce of an empty array needs a starting value: arr.reduce(f, 0)");
      return arr.reduce((acc, x, i) => f(acc, x, i, arr));
    }
    return arr.reduce((acc, x, i) => f(acc, x, i, arr), args[1]);
  },
  sort: (arr, args, info) => sortArray(arr, args[0], info),
  flat: (arr, args, info) => {
    info.charge(arr.length);
    const depth = args[0] === undefined ? 1 : int(args[0], 1);
    const out = arr.flat(Math.max(0, Math.min(depth, 20)));
    info.charge(out.length);
    return out;
  },
  flatMap: (arr, args, info) => {
    const f = iterate(arr, args, info, "flatMap");
    return arr.flatMap((x, i) => {
      const r = f(x, i, arr);
      return Array.isArray(r) ? r : [r];
    });
  },
  fill: (arr, args, info) => {
    info.charge(arr.length);
    return arr.fill(args[0], relIndex(args[1], arr.length, 0), relIndex(args[2], arr.length, arr.length));
  },
  // Extras that read well in greenhouse scripts.
  sum: (arr, args, info) => {
    info.charge(arr.length);
    const f = args[0] === undefined ? (x: unknown) => x : callback(args[0], info, "sum");
    return arr.reduce<number>((acc, x) => acc + toNum(f(x)), 0);
  },
  count: (arr, args, info) => {
    const f = iterate(arr, args, info, "count");
    return arr.filter((x, i) => !!f(x, i, arr)).length;
  },
  min: (arr, args, info) => extreme(arr, args, info, -1),
  max: (arr, args, info) => extreme(arr, args, info, 1),
  first: (arr) => arr[0],
  last: (arr) => arr[arr.length - 1],
});

/** Smallest / largest value (or the item with the smallest / largest `by(item)`). Empty: undefined. */
function extreme(arr: unknown[], args: unknown[], info: CallInfo, sign: 1 | -1): unknown {
  info.charge(arr.length);
  if (arr.length === 0) return undefined;
  if (args[0] === undefined) {
    let best = toNum(arr[0]);
    for (const x of arr) best = sign > 0 ? Math.max(best, toNum(x)) : Math.min(best, toNum(x));
    return best;
  }
  const f = callback(args[0], info, sign > 0 ? "max" : "min");
  let bestItem = arr[0];
  let bestKey = toNum(f(arr[0]));
  for (let i = 1; i < arr.length; i++) {
    const k = toNum(f(arr[i]));
    if (sign > 0 ? k > bestKey : k < bestKey) {
      bestKey = k;
      bestItem = arr[i];
    }
  }
  return bestItem;
}

export function stringMethod(s: string, name: string): HostFn | undefined {
  const m = STRING_METHODS[name];
  return m ? fn(name, (args, info) => m(s, args, info)) : undefined;
}

type StringImpl = (s: string, args: unknown[], info: CallInfo) => unknown;

const str = (v: unknown) => (v === undefined ? "undefined" : toStr(v));

const STRING_METHODS: Record<string, StringImpl> = table<StringImpl>({
  toUpperCase: (s) => s.toUpperCase(),
  toLowerCase: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
  trimStart: (s) => s.trimStart(),
  trimEnd: (s) => s.trimEnd(),
  includes: (s, a) => s.includes(str(a[0])),
  startsWith: (s, a) => s.startsWith(str(a[0])),
  endsWith: (s, a) => s.endsWith(str(a[0])),
  indexOf: (s, a) => s.indexOf(str(a[0])),
  lastIndexOf: (s, a) => s.lastIndexOf(str(a[0])),
  slice: (s, a) => s.slice(a[0] === undefined ? 0 : int(a[0], 0), a[1] === undefined ? undefined : int(a[1], 0)),
  substring: (s, a) => s.substring(int(a[0], 0), a[1] === undefined ? undefined : int(a[1], 0)),
  split: (s, a, info) => {
    const out = a[0] === undefined ? [s] : s.split(str(a[0]));
    info.charge(out.length);
    return out;
  },
  replace: (s, a) => s.replace(str(a[0]), () => str(a[1])),
  replaceAll: (s, a) => s.split(str(a[0])).join(str(a[1])),
  repeat: (s, a, info) => {
    const n = Math.max(0, int(a[0], 0));
    if (s.length * n > 1_000_000) info.fail("Strings are limited to 1,000,000 characters");
    return s.repeat(n);
  },
  padStart: (s, a) => s.padStart(Math.min(10_000, int(a[0], 0)), a[1] === undefined ? " " : str(a[1])),
  padEnd: (s, a) => s.padEnd(Math.min(10_000, int(a[0], 0)), a[1] === undefined ? " " : str(a[1])),
  charAt: (s, a) => s.charAt(int(a[0], 0)),
  at: (s, a) => s.at(int(a[0], 0)),
  toString: (s: string) => s,
});

export function numberMethod(n: number, name: string): HostFn | undefined {
  switch (name) {
    case "toFixed":
      return fn(name, (a) => n.toFixed(Math.max(0, Math.min(20, int(a[0], 0)))));
    case "toString":
      return fn(name, (a) => n.toString(a[0] === undefined ? 10 : Math.max(2, Math.min(36, int(a[0], 10)))));
    case "toPrecision":
      return fn(name, (a) => (a[0] === undefined ? String(n) : n.toPrecision(Math.max(1, Math.min(21, int(a[0], 1))))));
    default:
      return undefined;
  }
}

// ---- globals ----

const MATH = new HostNamespace("Math", {
  PI: Math.PI,
  E: Math.E,
  floor: fn("floor", (a) => Math.floor(toNum(a[0]))),
  ceil: fn("ceil", (a) => Math.ceil(toNum(a[0]))),
  round: fn("round", (a) => Math.round(toNum(a[0]))),
  trunc: fn("trunc", (a) => Math.trunc(toNum(a[0]))),
  abs: fn("abs", (a) => Math.abs(toNum(a[0]))),
  sign: fn("sign", (a) => Math.sign(toNum(a[0]))),
  sqrt: fn("sqrt", (a) => Math.sqrt(toNum(a[0]))),
  cbrt: fn("cbrt", (a) => Math.cbrt(toNum(a[0]))),
  pow: fn("pow", (a) => toNum(a[0]) ** toNum(a[1])),
  exp: fn("exp", (a) => Math.exp(toNum(a[0]))),
  log: fn("log", (a) => Math.log(toNum(a[0]))),
  log2: fn("log2", (a) => Math.log2(toNum(a[0]))),
  log10: fn("log10", (a) => Math.log10(toNum(a[0]))),
  sin: fn("sin", (a) => Math.sin(toNum(a[0]))),
  cos: fn("cos", (a) => Math.cos(toNum(a[0]))),
  tan: fn("tan", (a) => Math.tan(toNum(a[0]))),
  atan2: fn("atan2", (a) => Math.atan2(toNum(a[0]), toNum(a[1]))),
  hypot: fn("hypot", (a, info) => {
    info.charge(a.length);
    return Math.sqrt(a.reduce<number>((s, x) => s + toNum(x) ** 2, 0));
  }),
  min: fn("min", (a, info) => numFold(flatNums(a), info, Math.min, Infinity)),
  max: fn("max", (a, info) => numFold(flatNums(a), info, Math.max, -Infinity)),
  clamp: fn("clamp", (a) => Math.min(toNum(a[2]), Math.max(toNum(a[1]), toNum(a[0])))),
  random: fn("random", (_a, info) => info.fail("Use random() instead: it uses the simulation's seed, so runs stay repeatable")),
});

/** Math.min / Math.max without a native spread (big arrays would overflow the stack). */
function numFold(xs: number[], info: CallInfo, f: (a: number, b: number) => number, start: number): number {
  info.charge(xs.length);
  let acc = start;
  for (const x of xs) acc = f(acc, x);
  return acc;
}

/** Math.min/max also accept a single array. */
function flatNums(a: unknown[]): number[] {
  return (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(toNum);
}

function deepCopy(v: unknown, info: CallInfo, depth = 0): unknown {
  if (depth > 100) info.fail("The value is nested too deeply (or refers to itself)");
  info.charge(1);
  if (Array.isArray(v)) return v.map((x) => deepCopy(x, info, depth + 1));
  if (isPlainObject(v)) {
    const o = newObject();
    for (const k of Object.keys(v)) setOwn(o, k, deepCopy(v[k], info, depth + 1));
    return o;
  }
  return v;
}

function toJson(v: unknown, info: CallInfo, depth = 0): unknown {
  if (depth > 100) info.fail("The value is nested too deeply (or refers to itself)");
  info.charge(1);
  if (Array.isArray(v)) return v.map((x) => toJson(x, info, depth + 1) ?? null);
  if (isPlainObject(v)) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      const j = toJson(v[k], info, depth + 1);
      if (j !== undefined) o[k] = j;
    }
    return o;
  }
  if (v instanceof HostObject || v instanceof Closure || v instanceof HostFn) return undefined;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}

function fromJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v && typeof v === "object") {
    const o = newObject();
    for (const [k, x] of Object.entries(v)) setOwn(o, k, fromJson(x));
    return o;
  }
  return v;
}

const JSON_NS = new HostNamespace("JSON", {
  stringify: fn("stringify", (a, info) => {
    const indent = a[2] === undefined ? undefined : typeof a[2] === "number" ? Math.min(10, a[2]) : toStr(a[2]).slice(0, 10);
    return JSON.stringify(toJson(a[0], info), null, indent);
  }),
  parse: fn("parse", (a, info) => {
    try {
      return fromJson(JSON.parse(toStr(a[0])));
    } catch {
      return info.fail("JSON.parse: that isn't valid JSON");
    }
  }),
});

function keysOf(v: unknown, info: CallInfo): string[] {
  if (Array.isArray(v)) return v.map((_, i) => String(i));
  if (v instanceof HostObject) return v.keys();
  if (isPlainObject(v)) return Object.keys(v);
  return info.fail("keys / values / entries need an object or array");
}

function getKey(v: unknown, k: string): unknown {
  if (Array.isArray(v)) return v[Number(k)];
  if (v instanceof HostObject) return v.get(k);
  return (v as PlainObject)[k];
}

/** Built-in globals that need no simulation (the simulation adds `plot`, `plots`, `inventory`, ...). */
export function coreGlobals(): Record<string, unknown> {
  return {
    Math: MATH,
    JSON: JSON_NS,
    Infinity,
    NaN,
    keys: fn("keys", (a, info) => keysOf(a[0], info)),
    values: fn("values", (a, info) => keysOf(a[0], info).map((k) => getKey(a[0], k))),
    entries: fn("entries", (a, info) => keysOf(a[0], info).map((k) => [k, getKey(a[0], k)])),
    fromEntries: fn("fromEntries", (a, info) => {
      if (!Array.isArray(a[0])) info.fail("fromEntries needs an array of [key, value] pairs");
      const o = newObject();
      for (const pair of a[0] as unknown[]) {
        if (!Array.isArray(pair)) info.fail("fromEntries needs an array of [key, value] pairs");
        setOwn(o, toStr((pair as unknown[])[0]), (pair as unknown[])[1]);
      }
      return o;
    }),
    assign: fn("assign", (a, info) => {
      const target = a[0];
      if (!isPlainObject(target)) info.fail("assign needs one of your objects as its first argument");
      for (const src of a.slice(1)) {
        if (src === null || src === undefined) continue;
        for (const k of keysOf(src, info)) setOwn(target as PlainObject, k, getKey(src, k));
      }
      return target;
    }),
    isArray: fn("isArray", (a) => Array.isArray(a[0])),
    isNumber: fn("isNumber", (a) => typeof a[0] === "number" && !Number.isNaN(a[0])),
    isString: fn("isString", (a) => typeof a[0] === "string"),
    isFunction: fn("isFunction", (a) => isCallable(a[0])),
    isNaN: fn("isNaN", (a) => Number.isNaN(toNum(a[0]))),
    isFinite: fn("isFinite", (a) => Number.isFinite(toNum(a[0]))),
    Number: fn("Number", (a) => (a.length ? toNum(a[0]) : 0)),
    String: fn("String", (a) => (a.length ? toStr(a[0]) : "")),
    Boolean: fn("Boolean", (a) => !!a[0]),
    parseInt: fn("parseInt", (a) => parseInt(toStr(a[0]), a[1] === undefined ? 10 : int(a[1], 10))),
    parseFloat: fn("parseFloat", (a) => parseFloat(toStr(a[0]))),
    range: fn("range", (a, info) => {
      // range(n) = 0..n-1; range(a, b) = a..b-1; range(a, b, step).
      const [from, to] = a.length >= 2 ? [toNum(a[0]), toNum(a[1])] : [0, toNum(a[0])];
      const step = a[2] === undefined ? 1 : toNum(a[2]);
      if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step === 0) info.fail("range needs finite numbers and a non-zero step");
      const n = Math.max(0, Math.ceil((to - from) / step));
      if (n > 1_000_000) info.fail("Arrays are limited to 1,000,000 items");
      info.charge(n);
      return Array.from({ length: n }, (_, i) => from + i * step);
    }),
    copy: fn("copy", (a, info) => deepCopy(a[0], info)),
    str: fn("str", (a) => display(a[0])),
    object: fn("object", () => newObject()),
  };
}

export { plain };
