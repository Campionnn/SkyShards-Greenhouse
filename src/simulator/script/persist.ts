// Encoding script values as plain JSON data (SimulationState.scripts) and back.
// Objects and arrays go into a heap and are referenced by index, so shared
// references and cycles survive. Faithful by construction: a decoded runtime
// behaves exactly like the live one, which keeps run() splittable.
//
// Both directions are iterative (explicit work lists, no recursion), so a script
// that builds a very deeply nested structure can't overflow the JavaScript stack.

import { Closure, HostFn, HostObject, isPlainObject, newObject, setOwn, type PlainObject } from "./values";
import type { EncodedValue, HeapEntry, ScriptKey } from "./types";

/** Thrown when a value can't be kept between cycles. */
export class PersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistError";
  }
}

/** Heap entries one save may write (arrays + objects). Bounds the state a script can grow. */
export const MAX_HEAP_ENTRIES = 200_000;

export interface EncodeEnv {
  /** The script whose top-level scope `closure` closes over, or null. */
  closureOwner(c: Closure): ScriptKey | null;
  /** Stable reference for an engine object or built-in function, or null if it can't be kept. */
  hostRef(v: HostObject | HostFn): string | null;
}

export interface DecodeEnv {
  closure(script: ScriptKey, funcId: number): Closure;
  host(ref: string): unknown;
}

const childPath = (path: string, k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`);

/**
 * Where a value sits, for error messages only: built lazily (a chain of parent links), since
 * almost every save succeeds and formatting a path per value dominated the encoder's time.
 */
type Path = string | { parent: Path; key: string | number };
const pathText = (p: Path): string => {
  const parts: (string | number)[] = [];
  let at: Path = p;
  while (typeof at !== "string") {
    parts.push(at.key);
    at = at.parent;
  }
  let out = at;
  for (let i = parts.length - 1; i >= 0; i--) {
    const k = parts[i];
    out = typeof k === "number" ? `${out}[${k}]` : childPath(out, k);
  }
  return out;
};

export class Encoder {
  readonly heap: HeapEntry[] = [];
  private readonly ids = new Map<object, number>();
  private readonly env: EncodeEnv;
  /** Containers whose children still have to be encoded. */
  private readonly pending: { v: unknown[] | PlainObject; entry: HeapEntry; path: Path }[] = [];
  constructor(env: EncodeEnv) {
    this.env = env;
  }

  /** Encode a value (and everything it reaches) into the heap. */
  encode(v: unknown, path: string): EncodedValue {
    const root = this.one(v, path, null);
    while (this.pending.length) {
      const { v: container, entry, path: at } = this.pending.pop()!;
      if ("a" in entry) {
        const arr = container as unknown[];
        for (let i = 0; i < arr.length; i++) entry.a.push(this.one(arr[i], at, i));
      } else {
        const obj = container as PlainObject;
        for (const k of Object.keys(obj)) entry.o.push([k, this.one(obj[k], at, k)]);
      }
    }
    return root;
  }

  /**
   * Encode one value; a new container gets a heap slot and is queued for its children. Its path is
   * `parent` plus `key` (`key` null: `parent` is the value's own path), only built when needed.
   */
  private one(v: unknown, parent: Path, key: string | number | null): EncodedValue {
    if (v === undefined) return { u: 1 };
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number") {
      if (Number.isNaN(v)) return { x: "NaN" };
      if (v === Infinity) return { x: "Infinity" };
      if (v === -Infinity) return { x: "-Infinity" };
      if (Object.is(v, -0)) return { x: "-0" };
      return v;
    }
    // Only arrays and plain objects are ever in `ids`, so a hit is always a container seen before.
    if (typeof v === "object") {
      const known = this.ids.get(v);
      if (known !== undefined) return { r: known };
    }
    const at: Path = key === null ? parent : { parent, key };
    if (v instanceof Closure) {
      const owner = this.env.closureOwner(v);
      if (owner === null) {
        throw new PersistError(
          `${pathText(at)} holds a function made inside another function. Only functions declared at the top level of a script can be kept between cycles.`
        );
      }
      return { f: v.func.id, s: owner };
    }
    if (v instanceof HostObject || v instanceof HostFn) {
      const ref = this.env.hostRef(v);
      if (ref === null) throw new PersistError(`${pathText(at)} holds ${v instanceof HostFn ? `the method ${v.name}` : v.describe()}, which can't be kept between cycles.`);
      return { h: ref };
    }
    if (typeof v !== "object") throw new PersistError(`${pathText(at)} holds a value that can't be kept between cycles.`);
    if (!Array.isArray(v) && !isPlainObject(v)) throw new PersistError(`${pathText(at)} holds a value that can't be kept between cycles.`);
    if (this.heap.length >= MAX_HEAP_ENTRIES) {
      throw new PersistError(`The scripts keep too many objects and arrays between cycles (more than ${MAX_HEAP_ENTRIES.toLocaleString("en-US")}); ${pathText(at)} is one too many.`);
    }
    const id = this.heap.length;
    this.ids.set(v, id);
    const entry: HeapEntry = Array.isArray(v) ? { a: [] } : { o: [] };
    this.heap.push(entry);
    this.pending.push({ v, entry, path: at });
    return { r: id };
  }
}

/**
 * Would `Encoder.encode` take every one of `roots` (into one heap) without a PersistError? The same
 * checks and the same heap-entry count, without building anything. Used between cycles of one run
 * call, where only the final encoding is ever read but an unkeepable value must still stop the run
 * on the cycle it appears (a false here means: do the real save, which reports it).
 */
export function isPersistable(roots: readonly unknown[], env: EncodeEnv): boolean {
  const seen = new Set<object>();
  const stack: object[] = [];
  /** One value: false = can't be kept. Containers seen for the first time go on the stack. */
  const visit = (v: unknown): boolean => {
    if (typeof v !== "object" && typeof v !== "function") return typeof v !== "symbol" && typeof v !== "bigint";
    if (v === null) return true;
    if (seen.has(v)) return true;
    if (Array.isArray(v) || isPlainObject(v)) {
      if (seen.size >= MAX_HEAP_ENTRIES) return false;
      seen.add(v);
      stack.push(v);
      return true;
    }
    if (v instanceof Closure) return env.closureOwner(v) !== null;
    if (v instanceof HostObject || v instanceof HostFn) return env.hostRef(v) !== null;
    return false;
  };
  for (const root of roots) {
    if (!visit(root)) return false;
    while (stack.length) {
      const c = stack.pop()!;
      if (Array.isArray(c)) {
        for (let i = 0; i < c.length; i++) {
          const x = c[i];
          if ((typeof x === "object" || typeof x === "function" || typeof x === "symbol" || typeof x === "bigint") && x !== null && !visit(x)) return false;
        }
      } else {
        // Script objects inherit nothing, so for-in walks exactly their own enumerable keys.
        const obj = c as PlainObject;
        for (const k in obj) {
          const x = obj[k];
          if ((typeof x === "object" || typeof x === "function" || typeof x === "symbol" || typeof x === "bigint") && x !== null && !visit(x)) return false;
        }
      }
    }
  }
  return true;
}

export class Decoder {
  private readonly heap: HeapEntry[];
  private readonly made: unknown[] = [];
  private readonly env: DecodeEnv;
  private readonly pending: number[] = [];
  constructor(heap: HeapEntry[], env: DecodeEnv) {
    this.heap = heap;
    this.env = env;
  }

  decode(e: EncodedValue): unknown {
    const root = this.one(e);
    while (this.pending.length) {
      const id = this.pending.pop()!;
      const entry = this.heap[id];
      const made = this.made[id];
      if ("a" in entry) for (const x of entry.a) (made as unknown[]).push(this.one(x));
      else for (const [k, x] of entry.o) setOwn(made as PlainObject, k, this.one(x));
    }
    return root;
  }

  private one(e: EncodedValue): unknown {
    if (e === null || typeof e !== "object") return e;
    if ("r" in e) {
      const id = e.r;
      if (id in this.made) return this.made[id];
      const entry = this.heap[id];
      if (!entry) throw new Error(`Broken script state (heap ${id})`);
      const made: unknown = "a" in entry ? [] : newObject();
      this.made[id] = made;
      this.pending.push(id);
      return made;
    }
    if ("u" in e) return undefined;
    if ("x" in e) return e.x === "NaN" ? NaN : e.x === "Infinity" ? Infinity : e.x === "-Infinity" ? -Infinity : -0;
    if ("f" in e) return this.env.closure(e.s, e.f);
    return this.env.host(e.h);
  }
}
