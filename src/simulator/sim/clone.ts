/**
 * Deep copy of plain data (objects, arrays, primitives): what `run` and `addItems` clone their
 * input with. `SimulationState` is plain data (no Map, Set, class, Date or cycle), so this gives
 * the same result as `structuredClone` at a fraction of the cost. Keys holding `undefined` are
 * kept, like `structuredClone`; a shared sub-object becomes separate copies (JSON can't tell).
 *
 * V8 details that matter for speed of the whole run, not just the copy:
 * - Objects are copied with spread, which keeps the source's hidden class. Adding the keys one
 *   by one with computed names would turn every object with more than 16 properties (each plant,
 *   the state, the summary) into a slow dictionary-mode object.
 * - Arrays are built with push: a pre-sized `new Array(n)` is "holey" and slower to work with.
 */
/**
 * `run`'s working copy of its input state: a deep copy, except two parts shared with the input:
 * - `scenario`: the run's input, which the engine only ever reads (a run never changes its own
 *   scenario; layouts, steps and policies are looked up, not edited). The largest part of a
 *   scripted flow's state, and the same object across every call of a long run.
 * - the scripts' encoded variables (`scripts.heap`, `scopes`, `shared`): immutable once written
 *   (`ScriptRuntime.save` replaces all three with fresh ones).
 * Nothing changes either in place, so sharing them can't let a run touch its input. A caller that
 * edits a state's scenario before running it again must replace it (or the whole state) rather
 * than change it in place. Key order is kept (JSON stays identical).
 */
export function cloneState<T extends { scripts?: object }>(state: T): T {
  const out: Record<string, unknown> = { ...(state as Record<string, unknown>) };
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const v = out[key];
    if (typeof v !== "object" || v === null || key === "scenario") continue;
    if (key !== "scripts") {
      out[key] = clonePlain(v);
      continue;
    }
    const scripts: Record<string, unknown> = { ...(v as Record<string, unknown>) };
    for (const k of Object.keys(scripts)) {
      if (k === "heap" || k === "scopes" || k === "shared") continue;
      const x = scripts[k];
      if (typeof x === "object" && x !== null) scripts[k] = clonePlain(x);
    }
    out[key] = scripts;
  }
  return out as T;
}

export function clonePlain<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) out.push(clonePlain(value[i]));
    return out as T;
  }
  // Spread defines own properties, so an own "__proto__" key stays a key here, and assigning to
  // it below updates that own property (it shadows the inherited setter).
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const keys = Object.keys(out);
  for (let i = 0; i < keys.length; i++) {
    const v = out[keys[i]];
    if (typeof v === "object" && v !== null) out[keys[i]] = clonePlain(v);
  }
  return out as T;
}
