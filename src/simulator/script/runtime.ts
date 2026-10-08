// The script runtime: runs the scenario's scripts inside run()'s cycle loop.
//
// Lifecycle (one runtime per run() call, and one for initState):
//   ScriptRuntime.create(state, env)  compile, hoist, restore variables from state.scripts
//   setCycle(ctx, scratches)          every cycle
//   callHook / flush / conditions     at fixed points of the cycle (run.ts, player.ts, runner.ts)
//   save()                            encode the variables back into state.scripts (every cycle)
//
// Determinism: scripts see only the simulation; random() draws from
// state.scripts.rng (a stream separate from the game's dice); everything a script
// keeps lives in state. A runtime rebuilt from state behaves exactly like the live
// one, so run() stays pure and splittable: run(s, 100) === run(run(s, 50), 50).
//
// Errors never leave the engine half-way through a phase: a failing hook call or
// condition is stopped at its boundary and recorded in state.scripts.halt; the cycle
// completes and run() stops after it. After an error, no more script code runs that cycle.

import { cellKey, footprintFits, GRID_SIZE, inBounds } from "../grid/cells";
import { isFreePlacedItem, MAX_WATER } from "../config";
import { isHarvestableCrop, kindDef } from "../data/load";
import { dueTarget, transition } from "../flow/runner";
import { collectedOf, conditionHolds, stepVisits, type TriggerView } from "../flow/triggers";
import type { Condition, PolicyOverrides, StepLayout } from "../flow/types";
import { hourOfDay } from "../growth/clock";
import { intInclusive, nextFloat, seedRng } from "../rng";
import { sanityCheck } from "../analysis/sanityCheck";
import { newScratch, type CycleCtx, type Env, type TickScratch } from "../sim/context";
import { wouldDecayWithin } from "../sim/decay";
import { destroyPlant } from "../sim/explosion";
import { harvestPlant } from "../sim/harvest";
import { spend } from "../sim/inventory";
import { applyStepLayout, removeByPlayer } from "../sim/placement";
import { runSessionPhase } from "../sim/player";
import { buildOccupancy, DEAD_PLANT, insertPlant, isDry, isFootprintFree, isFullyGrown, isHarvestable, isRoot, newPlant } from "../sim/plants";
import type { PlantState, PlotState, SimulationState, TickEvent } from "../sim/state";
import type * as A from "./ast";
import { EVENT_HOOKS, SCRIPT_PHASES } from "./docs";
import { compile, compileExpression, Interpreter, ScriptError, Scope, type Program } from "./interpreter";
import { ScriptSyntaxError } from "./lexer";
import { enabledScripts } from "./overrides";
import { Decoder, Encoder, PersistError } from "./persist";
import { coreGlobals } from "./stdlib";
import {
  GLOBAL_SCRIPT,
  MAX_LOG_LINES,
  MAX_METRIC_SAMPLES,
  plotScriptKey,
  type EncodedValue,
  type ScriptHalt,
  type ScriptKey,
  type ScriptPlotState,
  type ScriptsState,
  type ScriptVarKind,
} from "./types";
import { Closure, display, fromData, HostFn, HostObject, isPlainObject, newObject, own, plain, setOwn, toNum, toStr, type CallInfo, type PlainObject } from "./values";

/** Steps one hook call may take. */
export const HOOK_BUDGET = 2_000_000;
/** Steps one exit condition may take. */
export const CONDITION_BUDGET = 200_000;
/** Different metric names (each keeps a bounded history in state). */
const MAX_METRICS = 100;
/** Message deliveries per cycle (stops two scripts answering each other forever). */
const MAX_MESSAGES_PER_CYCLE = 1000;
const KNOWN_GROUND = ["farmland", "sand", "soul_sand", "mycelium", "netherrack", "end_stone"];

export function emptyScriptsState(seed: number): ScriptsState {
  // A stream of its own: scripts calling random() never shift the game's dice.
  return { heap: [], scopes: {}, shared: { u: 1 }, rng: seedRng((Math.trunc(seed) ^ 0x5c41b7) >>> 0), plots: {}, logs: [], metrics: {}, halt: null };
}

interface ScriptInstance {
  key: ScriptKey;
  plotId: number | null;
  program: Program;
  scope: Scope;
  /** Top-level variable names the program declares, and how (persisted). */
  declared: Map<string, ScriptVarKind>;
}

/**
 * What the running code may do:
 * - act: physical actions (break, place, goto...) work: the player is online.
 * - condition: an exit condition: nothing may change.
 */
interface CallMode {
  act: boolean;
  condition: boolean;
}

export class ScriptRuntime {
  readonly state: SimulationState;
  readonly env: Env;
  private ctx: CycleCtx | null = null;
  private scratches = new Map<number, TickScratch>();
  private readonly interp = new Interpreter({ budget: HOOK_BUDGET });
  private readonly scripts: ScriptInstance[] = [];
  private readonly byKey = new Map<ScriptKey, ScriptInstance>();
  /** Built-ins every script sees. */
  private readonly root = new Scope(null);
  private shared: PlainObject = newObject();
  private mode: CallMode = { act: false, condition: false };
  private current: ScriptInstance | null = null;
  private currentHook: string | null = null;
  /** Engine events since the last flush. */
  private queue: { plotId: number; event: TickEvent }[] = [];
  private flushing = false;
  private messages: { to: ScriptKey; msg: unknown; from: unknown }[] = [];
  private messagesThisCycle = 0;
  /** Some script defines onEvent or an event hook: only then are events queued. */
  private readonly wantsEvents: boolean;
  private readonly plotObjects = new Map<number, PlotHost>();
  private readonly plantObjects = new Map<string, PlantHost>();
  private readonly conditionScopes = new Map<number, Scope>();
  /** The view an exit condition is checked against (on-arrival checks look at the next step's targets). */
  private conditionView: TriggerView | null = null;

  private constructor(state: SimulationState, env: Env) {
    this.state = state;
    this.env = env;
    state.scripts ??= emptyScriptsState(state.scenario.settings.seed);
    this.installGlobals();
    for (const s of enabledScripts(state.scenario)) {
      let program: Program;
      try {
        program = compile(s.source);
      } catch (err) {
        // Validation reports syntax errors before a run starts; this is a fallback.
        if (!(err instanceof ScriptSyntaxError)) throw err;
        this.recordHalt({ kind: "error", cycle: state.cycle, script: s.key, hook: "syntax", message: `Syntax error: ${err.message}`, line: err.line, col: err.col });
        continue;
      }
      const scope = new Scope(this.root);
      if (s.plotId !== null) scope.vars.set("plot", { value: this.plotHost(s.plotId), kind: "builtin" });
      const declared = new Map<string, ScriptVarKind>();
      for (const st of program.body) {
        if (st.type !== "VarDecl") continue;
        for (const d of st.decls) for (const n of namesOf(d.target)) declared.set(n, st.kind);
      }
      const inst: ScriptInstance = { key: s.key, plotId: s.plotId, program, scope, declared };
      this.scripts.push(inst);
      this.byKey.set(s.key, inst);
      this.interp.hoist(program, scope);
    }
    const eventHooks = ["onEvent", ...Object.values(EVENT_HOOKS)];
    this.wantsEvents = this.scripts.some((s) => s.program.topFunctions.some((f) => eventHooks.includes(f)));
    this.restoreVariables();
  }

  /** A runtime over `state` (variables restored from state.scripts). */
  static create(state: SimulationState, env: Env): ScriptRuntime {
    return new ScriptRuntime(state, env);
  }

  get scriptsState(): ScriptsState {
    return this.state.scripts!;
  }

  /** Point the runtime at a new cycle. */
  setCycle(ctx: CycleCtx, scratches: Map<number, TickScratch>): void {
    this.ctx = ctx;
    this.scratches = scratches;
    this.messagesThisCycle = 0;
  }

  get cycleCtx(): CycleCtx {
    if (!this.ctx) throw new Error("Script runtime used outside a cycle");
    return this.ctx;
  }

  private get errored(): boolean {
    return this.scriptsState.halt?.kind === "error";
  }

  // ---- persistence ----

  private restoreVariables(): void {
    const ss = this.scriptsState;
    const decoder = new Decoder(ss.heap, {
      closure: (key, funcId) => {
        const inst = this.byKey.get(key);
        const func = inst?.program.funcs[funcId];
        if (!inst || !func) throw new Error(`Broken script state (function ${funcId} of ${key})`);
        return new Closure(func, inst.scope); // only top-level functions are ever stored
      },
      host: (ref) => this.hostFromRef(ref),
    });
    const shared = decoder.decode(ss.shared);
    this.shared = isPlainObject(shared) ? shared : newObject();
    this.root.vars.set("shared", { value: this.shared, kind: "builtin" });
    for (const inst of this.scripts) {
      const saved = ss.scopes[inst.key];
      if (!saved) continue;
      for (const [name, [, value]] of Object.entries(saved)) {
        const kind = inst.declared.get(name);
        if (kind) inst.scope.vars.set(name, { value: decoder.decode(value), kind });
      }
    }
  }

  /** Encode every script's top-level variables and `shared` into state.scripts. */
  save(): void {
    const ss = this.scriptsState;
    const enc = new Encoder({
      closureOwner: (c) => this.scripts.find((s) => s.scope === c.scope)?.key ?? null,
      hostRef: (v) => (v instanceof HostObject ? v.ref() : null),
    });
    const keep = (value: unknown, path: string, key: ScriptKey): EncodedValue => {
      try {
        return enc.encode(value, path);
      } catch (err) {
        if (!(err instanceof PersistError)) throw err;
        this.recordHalt({ kind: "error", cycle: this.ctx?.cycle ?? this.state.cycle, script: key, hook: "saving variables", message: err.message });
        return { u: 1 };
      }
    };
    const shared = keep(this.shared, "shared", GLOBAL_SCRIPT);
    const scopes: ScriptsState["scopes"] = {};
    for (const inst of this.scripts) {
      const out: Record<string, [ScriptVarKind, EncodedValue]> = {};
      for (const [name, kind] of inst.declared) {
        const b = inst.scope.vars.get(name);
        if (b) out[name] = [kind, keep(b.value, name, inst.key)];
      }
      scopes[inst.key] = out;
    }
    ss.heap = enc.heap;
    ss.shared = shared;
    ss.scopes = scopes;
    // Forget protections of plants that are gone.
    for (const [id, sp] of Object.entries(ss.plots)) {
      if (!sp.protected) continue;
      const plot = this.state.plots.find((p) => String(p.id) === id);
      const alive = sp.protected.filter((pid) => plot?.plants.some((p) => p.id === pid));
      if (alive.length) sp.protected = alive;
      else delete sp.protected;
    }
  }

  // ---- running code ----

  /** Run every script's top-level statements (setup only). */
  runTopLevel(): void {
    // The starting layouts' events aren't delivered (onStart sees the built plots), and events
    // from top-level code wait until every script's variables exist.
    this.queue = [];
    this.flushing = true;
    try {
      for (const inst of this.scripts) this.guarded(inst, "top level", { act: true, condition: false }, () => this.interp.runTop(inst.program, inst.scope));
    } finally {
      this.flushing = false;
    }
    this.flush();
  }

  /**
   * Call `hook` in every script that defines it, in order (controller first, then plots in plot
   * order). `only`: "controller", a plot id (that plot's script only), or every script.
   */
  callHook(hook: string, args: unknown[] = [], only?: "controller" | number): void {
    for (const inst of this.scripts) {
      if (only === "controller" && inst.plotId !== null) continue;
      if (typeof only === "number" && inst.plotId !== only) continue;
      this.callIn(inst, hook, args);
    }
  }

  private callIn(inst: ScriptInstance, hook: string, args: unknown[]): void {
    const fn = inst.scope.vars.get(hook)?.value;
    if (!(fn instanceof Closure)) return;
    this.guarded(inst, hook, { act: this.ctx?.active ?? false, condition: false }, () => this.interp.call(fn, args));
  }

  /** Run script code; a script error stops just this call and is recorded as the run's halt. */
  private guarded(inst: ScriptInstance, hook: string, mode: CallMode, body: () => void): void {
    if (this.errored) return;
    const outer = this.current !== null;
    const prev = { current: this.current, hook: this.currentHook, mode: this.mode };
    this.current = inst;
    this.currentHook = hook;
    this.mode = mode;
    if (!outer) this.interp.resetBudget(HOOK_BUDGET);
    try {
      body();
    } catch (err) {
      if (!(err instanceof ScriptError)) throw err;
      if (outer) throw err; // the outermost call records it
      this.recordHalt(this.haltFor(err, inst.key, hook));
    } finally {
      this.current = prev.current;
      this.currentHook = prev.hook;
      this.mode = prev.mode;
    }
    if (!outer) this.flush();
  }

  private haltFor(err: ScriptError, script: ScriptKey, hook: string): ScriptHalt {
    return { kind: "error", cycle: this.ctx?.cycle ?? this.state.cycle, script, hook, message: err.message, line: err.line, col: err.col };
  }

  /** The first error wins; an error replaces a pause. */
  private recordHalt(h: ScriptHalt): void {
    const ss = this.scriptsState;
    if (ss.halt?.kind === "error") return;
    if (ss.halt && h.kind === "pause") return;
    ss.halt = h;
    if (h.kind === "error") {
      const where = h.line !== undefined ? ` (line ${h.line}:${h.col})` : "";
      this.log("error", `${h.message}${where}`, h.script);
    }
  }

  // ---- events and messages ----

  /** An engine event (ctx.emit). Delivered to the event hooks at the next flush. */
  onEvent(plotId: number, event: TickEvent): void {
    if (this.wantsEvents) this.queue.push({ plotId, event });
  }

  /** Deliver queued events and messages. Called after each phase, and after each hook call. */
  flush(): void {
    if (this.flushing || this.current) return;
    this.flushing = true;
    try {
      while (this.queue.length || this.messages.length) {
        if (this.errored) {
          this.queue = [];
          this.messages = [];
          break;
        }
        if (this.queue.length) {
          const { plotId, event } = this.queue.shift()!;
          const hook = EVENT_HOOKS[event.kind];
          let e: PlainObject | null = null;
          for (const inst of this.scripts) {
            if (inst.plotId !== null && inst.plotId !== plotId) continue;
            for (const name of hook ? [hook, "onEvent"] : ["onEvent"]) {
              if (!(inst.scope.vars.get(name)?.value instanceof Closure)) continue;
              e ??= this.eventObject(plotId, event);
              this.callIn(inst, name, [e]);
            }
          }
          continue;
        }
        const m = this.messages.shift()!;
        const inst = this.byKey.get(m.to);
        if (inst) this.callIn(inst, "onMessage", [m.msg, m.from]);
      }
    } finally {
      this.flushing = false;
    }
  }

  private eventObject(plotId: number, e: TickEvent): PlainObject {
    const o = newObject();
    o.type = e.kind;
    o.plot = this.plotHost(plotId);
    for (const [k, v] of Object.entries(e)) {
      if (k === "kind") continue;
      if (k === "kindId" || k === "mutationId") o.kind = v;
      else setOwn(o, k, fromData(v));
    }
    if ("plantId" in e) o.plant = this.plantHost(plotId, e.plantId);
    return o;
  }

  // ---- exit conditions ----

  /**
   * Evaluate a script exit condition for a plot, read-only, in the plot script's scope (its
   * variables and functions) or, without one, a scope with the built-ins and `plot`.
   * A script error halts the run; the condition then reads false.
   */
  evaluateCondition(plotId: number, source: string, view: TriggerView): boolean {
    if (this.errored) return false;
    const key = plotScriptKey(plotId);
    let expr: A.Expr;
    try {
      expr = compileExpression(source);
    } catch (err) {
      if (!(err instanceof ScriptSyntaxError)) throw err;
      this.recordHalt({ kind: "error", cycle: this.ctx?.cycle ?? this.state.cycle, script: key, hook: "condition", message: `Syntax error in an exit condition: ${err.message}`, line: err.line, col: err.col });
      return false;
    }
    const inst = this.byKey.get(key);
    const scope = inst?.scope ?? this.conditionScope(plotId);
    const prev = { current: this.current, hook: this.currentHook, mode: this.mode, budget: this.interp.budget, steps: this.interp.steps, view: this.conditionView };
    this.current = inst ?? { key, plotId, program: compile(""), scope, declared: new Map() };
    this.currentHook = "condition";
    this.mode = { act: false, condition: true };
    this.conditionView = view;
    this.interp.resetBudget(CONDITION_BUDGET);
    try {
      return !!this.interp.evaluate(expr, scope);
    } catch (err) {
      if (!(err instanceof ScriptError)) throw err;
      const halt = this.haltFor(err, key, "condition");
      halt.message = `Exit condition \`${source.length > 60 ? `${source.slice(0, 60)}...` : source}\`: ${err.message}`;
      if (!inst) delete halt.line;
      if (!inst) delete halt.col;
      // Errors inside a script called from the condition keep their position; restore after.
      this.current = prev.current;
      this.recordHalt(halt);
      return false;
    } finally {
      this.current = prev.current;
      this.currentHook = prev.hook;
      this.mode = prev.mode;
      this.conditionView = prev.view;
      this.interp.budget = prev.budget;
      this.interp.steps = prev.steps;
    }
  }

  private conditionScope(plotId: number): Scope {
    let s = this.conditionScopes.get(plotId);
    if (!s) {
      s = new Scope(this.root);
      s.vars.set("plot", { value: this.plotHost(plotId), kind: "builtin" });
      this.conditionScopes.set(plotId, s);
    }
    return s;
  }

  // ---- output ----

  private log(level: "log" | "warn" | "error", text: string, script?: ScriptKey): void {
    const ss = this.scriptsState;
    ss.logs.push({
      cycle: this.ctx?.cycle ?? this.state.cycle,
      script: script ?? this.current?.key ?? GLOBAL_SCRIPT,
      level,
      text: text.length > 2000 ? `${text.slice(0, 2000)}...` : text,
    });
    if (ss.logs.length > MAX_LOG_LINES) ss.logs.splice(0, ss.logs.length - MAX_LOG_LINES);
  }

  private metric(name: string, value: number, info: CallInfo): void {
    const ss = this.scriptsState;
    const cycle = this.ctx?.cycle ?? this.state.cycle;
    let m = own(ss.metrics, name);
    if (!m) {
      if (Object.keys(ss.metrics).length >= MAX_METRICS) info.fail(`Too many metrics (more than ${MAX_METRICS} names)`);
      m = ss.metrics[name] = { value, cycle, history: [] };
    }
    m.value = value;
    m.cycle = cycle;
    const last = m.history[m.history.length - 1];
    if (last && last[0] === cycle) last[1] = value;
    else m.history.push([cycle, value]);
    // Thin by half once full, so the whole run stays visible.
    if (m.history.length > MAX_METRIC_SAMPLES) m.history = m.history.filter((_, i) => i % 2 === 0 || i === m.history.length - 1);
  }

  // ---- globals ----

  private installGlobals(): void {
    const set = (name: string, value: unknown) => this.root.vars.set(name, { value, kind: "builtin" });
    const live = (name: string, get: () => unknown) => this.root.vars.set(name, new LiveBinding(get));
    const fn = (name: string, impl: (args: unknown[], info: CallInfo) => unknown) => new HostFn(name, impl);
    /** Takes any script value and never looks it up in an engine record (output, messages, dice). */
    const valueFn = (name: string, impl: (args: unknown[], info: CallInfo) => unknown) => new HostFn(name, impl, true);
    for (const [k, v] of Object.entries(coreGlobals())) set(k, v);

    set("log", valueFn("log", (a) => this.log("log", a.map((x) => display(x)).join(" "))));
    set("warn", valueFn("warn", (a) => this.log("warn", a.map((x) => display(x)).join(" "))));
    set("pause", valueFn("pause", (a, info) => {
      this.notInCondition(info, "pause()");
      this.recordHalt({
        kind: "pause",
        cycle: this.ctx?.cycle ?? this.state.cycle,
        script: this.current?.key ?? GLOBAL_SCRIPT,
        hook: this.currentHook,
        message: a.length ? display(a[0]) : "Paused by a script",
      });
      return true;
    }));
    set("fail", valueFn("fail", (a, info) => info.fail(a.length ? display(a[0]) : "Stopped by fail()")));
    set("metric", fn("metric", (a, info) => {
      this.notInCondition(info, "metric()");
      if (typeof a[0] !== "string" || !a[0]) info.fail('metric needs a name: metric("roses", plot.count("rose"))');
      const v = toNum(a[1]);
      if (!Number.isFinite(v)) info.fail(`metric "${a[0] as string}" needs a finite number`);
      this.metric(a[0] as string, v, info);
      return v;
    }));
    set("send", fn("send", (a, info) => {
      this.notInCondition(info, "send()");
      const to = a[0] === "controller" || a[0] === "global" ? GLOBAL_SCRIPT : plotScriptKey(toNum(a[0]));
      if (!this.byKey.has(to)) return false;
      if (++this.messagesThisCycle > MAX_MESSAGES_PER_CYCLE) info.fail(`More than ${MAX_MESSAGES_PER_CYCLE} messages in one cycle. Are two scripts answering each other forever?`);
      this.messages.push({ to, msg: a[1], from: this.current?.plotId ?? "controller" });
      return true;
    }));
    const rng = () => this.scriptsState.rng;
    set("random", valueFn("random", () => nextFloat(rng())));
    set("randomInt", valueFn("randomInt", (a, info) => {
      const lo = Math.ceil(toNum(a[0]));
      const hi = Math.floor(toNum(a[1]));
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) info.fail("randomInt(min, max) needs whole numbers with min <= max");
      return intInclusive(rng(), lo, hi);
    }));
    set("chance", valueFn("chance", (a) => {
      const p = toNum(a[0]);
      if (!(p > 0)) return false;
      if (p >= 1) return true;
      return nextFloat(rng()) < p;
    }));
    set("collected", fn("collected", (a) => collectedOf(this.state, toStr(a[0]))));
    set("getPlot", fn("getPlot", (a) => {
      const id = toNum(a[0]);
      return this.state.plots.some((p) => p.id === id) ? this.plotHost(id) : null;
    }));
    set("info", fn("info", (a) => this.kindInfo(toStr(a[0]))));
    set("price", fn("price", (a) => this.cycleCtx.prices.price(toStr(a[0]))));
    set("MUTATIONS", [...this.env.data.mutationIds]);
    set("CROPS", [...this.env.data.cropIds]);
    set("inventory", new InventoryHost(this));

    live("online", () => this.ctx?.active ?? false);
    live("cycle", () => this.ctx?.cycle ?? this.state.cycle);
    live("cycleSeconds", () => this.ctx?.cycleSeconds ?? this.state.lastCycleSeconds);
    live("elapsed", () => this.ctx?.firesAt ?? this.state.elapsedSeconds);
    live("day", () => Math.floor((this.ctx?.firesAt ?? this.state.elapsedSeconds) / 86400));
    live("hour", () => hourOfDay(this.state.scenario.settings.playerStats.startTimeOfDay, this.ctx?.firesAt ?? this.state.elapsedSeconds));
    live("plots", () => this.orderedPlots().map((p) => this.plotHost(p.id)));
    live("summary", () => fromData(this.state.summary));
    live("stats", () => fromData(this.state.scenario.settings.playerStats));
    live("config", () => fromData(this.state.scenario.settings.config));
  }

  private orderedPlots(): PlotState[] {
    const out: PlotState[] = [];
    for (const id of this.state.scenario.settings.config.plotOrder) {
      const p = this.state.plots.find((q) => q.id === id);
      if (p) out.push(p);
    }
    for (const p of this.state.plots) if (!out.includes(p)) out.push(p);
    return out;
  }

  private kindInfo(id: string): unknown {
    const def = kindDef(this.env.data, id);
    if (!def) return null;
    const o = plain({
      id: def.id,
      name: def.name,
      type: def.kind,
      size: def.size,
      ground: def.ground,
      growthStages: def.growthStages,
      decayDays: def.decayDays,
      minimumMutations: def.minimumMutations,
      effects: [...def.positiveBuffs],
      negativeEffects: [...def.negativeBuffs],
      drops: fromData(def.drops),
    });
    if (def.kind === "mutation") {
      o.rarity = def.rarity;
      o.spawnWeight = def.spawnWeight;
      o.requiresWatering = def.requiresWatering;
      o.special = def.special;
      o.requirements = def.requirements.map((r) => plain({ kind: r.crop, count: r.count }));
    } else {
      o.sellPrice = def.sellPrice;
    }
    return o;
  }

  // ---- host objects ----

  plotHost(id: number): PlotHost {
    let h = this.plotObjects.get(id);
    if (!h) this.plotObjects.set(id, (h = new PlotHost(this, id)));
    return h;
  }

  plantHost(plotId: number, plantId: number): PlantHost {
    const key = `${plotId}:${plantId}`;
    let h = this.plantObjects.get(key);
    if (!h) this.plantObjects.set(key, (h = new PlantHost(this, plotId, plantId)));
    return h;
  }

  private hostFromRef(ref: string): unknown {
    if (ref === "inventory") return this.root.vars.get("inventory")!.value;
    const [kind, a, b] = ref.split(":");
    if (kind === "plot") return this.plotHost(Number(a));
    if (kind === "plant") return this.plantHost(Number(a), Number(b));
    throw new Error(`Broken script state (${ref})`);
  }

  plotState(id: number): PlotState | undefined {
    return this.state.plots.find((p) => p.id === id);
  }

  scriptPlot(id: number): ScriptPlotState {
    return (this.scriptsState.plots[String(id)] ??= {});
  }

  /** Physical actions: refused in conditions (error), do nothing offline (false). */
  canAct(info: CallInfo, what: string): boolean {
    this.notInCondition(info, what);
    return this.mode.act;
  }

  /** Settings a script changes (hold, disable, policies, protect): any time, but never in a condition. */
  notInCondition(info: CallInfo, what: string): void {
    if (this.mode.condition) info.fail(`${what} can't be used in an exit condition: conditions only read`);
  }

  scratchFor(plotId: number): TickScratch {
    let s = this.scratches.get(plotId);
    if (!s) this.scratches.set(plotId, (s = newScratch()));
    return s;
  }

  triggerView(plotId: number): TriggerView {
    if (this.conditionView && this.conditionView.plot.id === plotId) return this.conditionView;
    const ctx = this.cycleCtx;
    return {
      plot: this.plotState(plotId)!,
      runner: ctx.flowFor(plotId).runner,
      inventory: this.state.inventory,
      cycleSeconds: ctx.cycleSeconds,
      collected: (item) => collectedOf(this.state, item),
      layout: ctx.layoutFor(plotId),
    };
  }

  checkCondition(plotId: number, cond: unknown, info: CallInfo): boolean {
    const raw = toPlainData(cond);
    if (!isConditionLike(raw)) return info.fail('plot.check needs a condition like { kind: "targetsFilled", count: 0 }');
    if (containsScript(raw)) info.fail("plot.check can't run a script condition; write the expression directly");
    try {
      return conditionHolds(raw, this.triggerView(plotId));
    } catch (err) {
      return info.fail(`That condition can't be checked: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** A built-in whose value is computed when read (online, cycle, plots...). Never assignable. */
class LiveBinding {
  readonly kind = "builtin" as const;
  private readonly getter: () => unknown;
  constructor(getter: () => unknown) {
    this.getter = getter;
  }
  get value(): unknown {
    return this.getter();
  }
}

function namesOf(p: A.Pattern): string[] {
  switch (p.type) {
    case "Ident":
      return [p.name];
    case "DefaultPattern":
      return namesOf(p.target);
    case "ArrayPattern":
      return [...p.elements.flatMap((e) => (e ? namesOf(e) : [])), ...(p.rest ? namesOf(p.rest) : [])];
    case "ObjectPattern":
      return [...p.props.flatMap((pr) => namesOf(pr.value)), ...(p.rest ? [p.rest.name] : [])];
    default:
      return [];
  }
}

/** Script value -> plain data (conditions, policies and layouts given by scripts). */
function toPlainData(v: unknown, depth = 0): unknown {
  if (depth > 50) return null;
  if (Array.isArray(v)) return v.map((x) => toPlainData(x, depth + 1));
  if (isPlainObject(v)) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = toPlainData(v[k], depth + 1);
    return o;
  }
  if (v instanceof HostObject || v instanceof HostFn || v instanceof Closure) return undefined;
  return v;
}

function isConditionLike(v: unknown): v is Condition {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { kind?: unknown }).kind === "string";
}

function containsScript(c: Condition): boolean {
  return c.kind === "script" || (c.kind === "group" && Array.isArray(c.of) && c.of.some(containsScript));
}

const num = (v: unknown, info: CallInfo, what: string): number => {
  const n = toNum(v);
  if (!Number.isFinite(n)) info.fail(`${what} must be a number`);
  return n;
};

function cellArg(info: CallInfo, r: unknown, c: unknown): [number, number] {
  const row = toNum(r);
  const col = toNum(c);
  if (!Number.isInteger(row) || !Number.isInteger(col) || !inBounds(row, col)) {
    info.fail(`(${toStr(r)}, ${toStr(c)}) is not a cell on the plot: rows and columns go from 0 to ${GRID_SIZE - 1}`);
  }
  return [row, col];
}

// ---- inventory ----

class InventoryHost extends HostObject {
  private readonly rt: ScriptRuntime;
  constructor(rt: ScriptRuntime) {
    super();
    this.rt = rt;
  }
  ref(): string {
    return "inventory";
  }
  get(key: string): unknown {
    const inv = this.rt.state.inventory;
    if (key === "get") return new HostFn("get", (a) => own(inv, toStr(a[0])) ?? 0);
    if (key === "has") return new HostFn("has", (a) => (own(inv, toStr(a[0])) ?? 0) >= (a[1] === undefined ? 1 : toNum(a[1])));
    if (key === "items") return new HostFn("items", () => fromData(Object.fromEntries(Object.entries(inv).filter(([, n]) => n !== 0))));
    return own(inv, key) ?? 0;
  }
  keys(): string[] {
    const inv = this.rt.state.inventory;
    return Object.keys(inv).filter((k) => inv[k] !== 0);
  }
  has(key: string): boolean {
    return (own(this.rt.state.inventory, key) ?? 0) !== 0;
  }
  describe(): string {
    return "the inventory";
  }
}

// ---- plot ----

const PLOT_KEYS = ["id", "plants", "targets", "layout", "step", "steps", "cyclesInStep", "pending", "finished", "policies", "disabled", "held"];

const isPhase = (id: string): boolean => (SCRIPT_PHASES as readonly string[]).includes(id);

class PlotHost extends HostObject {
  private readonly rt: ScriptRuntime;
  readonly id: number;
  constructor(rt: ScriptRuntime, id: number) {
    super();
    this.rt = rt;
    this.id = id;
  }
  ref(): string {
    return `plot:${this.id}`;
  }
  describe(): string {
    return `Plot ${this.id}`;
  }
  keys(): string[] {
    return PLOT_KEYS;
  }
  private get plot(): PlotState {
    const p = this.rt.plotState(this.id);
    if (!p) throw new Error(`Plot ${this.id} doesn't exist`);
    return p;
  }
  private get ctx(): CycleCtx {
    return this.rt.cycleCtx;
  }
  private plants(filter?: (p: PlantState) => boolean): PlantHost[] {
    return this.plot.plants.filter((p) => !filter || filter(p)).map((p) => this.rt.plantHost(this.id, p.id));
  }
  /** Plants of a kind; Dead Plants only when asking for "dead_plant". No kind: everything. */
  private ofKind(kind: unknown): (p: PlantState) => boolean {
    if (kind === undefined || kind === null) return () => true;
    const k = toStr(kind);
    return (p) => p.kindId === k && (k === DEAD_PLANT || !p.isDeadPlant);
  }
  private stepInfo(index: number): PlainObject {
    const step = this.ctx.flowFor(this.id).def.flow.steps[index];
    return plain({ id: step.id, label: step.label?.trim() || `Step ${index + 1}`, number: index + 1, index });
  }
  private findStep(target: unknown, info: CallInfo): number {
    const steps = this.ctx.flowFor(this.id).def.flow.steps;
    if (typeof target === "number") {
      if (!Number.isInteger(target) || target < 1 || target > steps.length) info.fail(`Plot ${this.id} has no step number ${target} (it has ${steps.length})`);
      return target - 1;
    }
    const s = toStr(target);
    let i = steps.findIndex((st) => st.id === s);
    if (i < 0) i = steps.findIndex((st) => (st.label ?? "").trim().toLowerCase() === s.trim().toLowerCase());
    if (i < 0) info.fail(`Plot ${this.id} has no step "${s}". Use a step id, label or number.`);
    return i;
  }
  private filledTargets(): number {
    const occ = buildOccupancy(this.plot);
    return this.plot.slots.filter((s) => {
      const q = occ[s.row * GRID_SIZE + s.col];
      return !!q && !q.isDeadPlant && q.kindId === s.mutationId && q.row === s.row && q.col === s.col;
    }).length;
  }

  get(key: string): unknown {
    const rt = this.rt;
    const fn = (name: string, impl: (args: unknown[], info: CallInfo) => unknown) => new HostFn(`plot.${name}`, impl);
    switch (key) {
      case "id":
        return this.id;
      case "plants":
        return this.plants();
      case "all":
        return fn(key, (a) => this.plants(this.ofKind(a[0])));
      case "spawns":
        return fn(key, (a) => {
          const k = this.ofKind(a[0]);
          return this.plants((p) => p.origin === "spawned" && !p.isDeadPlant && k(p));
        });
      case "count":
        return fn(key, (a) => this.plot.plants.filter(this.ofKind(a[0])).length);
      case "at":
        return fn(key, (a, info) => {
          const [r, c] = cellArg(info, a[0], a[1]);
          const q = buildOccupancy(this.plot)[r * GRID_SIZE + c];
          return q ? rt.plantHost(this.id, q.id) : null;
        });
      case "isEmpty":
        return fn(key, (a, info) => {
          const [r, c] = cellArg(info, a[0], a[1]);
          return !buildOccupancy(this.plot)[r * GRID_SIZE + c];
        });
      case "ground":
        return fn(key, (a, info) => {
          const [r, c] = cellArg(info, a[0], a[1]);
          const k = cellKey(r, c);
          return own(this.plot.groundOverrides, k) ?? own(this.plot.groundTiles, k) ?? "air";
        });
      case "targets": {
        const occ = buildOccupancy(this.plot);
        return this.plot.slots.map((s) => {
          const q = occ[s.row * GRID_SIZE + s.col];
          return plain({
            mutation: s.mutationId,
            row: s.row,
            col: s.col,
            size: s.size,
            filled: !!q && !q.isDeadPlant && q.kindId === s.mutationId && q.row === s.row && q.col === s.col,
            plant: q ? rt.plantHost(this.id, q.id) : null,
            status: this.plot.watchStatus[cellKey(s.row, s.col)] ?? null,
          });
        });
      }
      case "layout": {
        const l = this.ctx.layoutFor(this.id);
        return plain({
          plants: l.plants.map((p) => plain({ kind: p.kindId, row: p.row, col: p.col, size: p.size, origin: p.origin })),
          targets: l.slots.map((s) => plain({ mutation: s.mutationId, row: s.row, col: s.col, size: s.size })),
        });
      }
      case "spawnChances":
        return fn(key, (a, info) => {
          const [r, c] = cellArg(info, a[0], a[1]);
          info.charge(2000);
          return sanityCheck(rt.state, rt.env.data, this.id, r, c).canSpawn.map((e) => plain({ mutation: e.mutationId, chance: e.chance }));
        });
      case "policies":
        return fromData(this.ctx.policiesFor(this.id));
      case "disabled":
        return [...(rt.scriptsState.plots[String(this.id)]?.disabled ?? [])];
      case "held":
        return rt.scriptsState.plots[String(this.id)]?.hold === true;

      // ---- flow and conditions ----
      case "step":
        return this.stepInfo(this.ctx.flowFor(this.id).runner.stepIndex);
      case "steps":
        return this.ctx.flowFor(this.id).def.flow.steps.map((_, i) => this.stepInfo(i));
      case "cyclesInStep":
        return this.ctx.flowFor(this.id).runner.cyclesInStep;
      case "pending": {
        const { def, runner } = this.ctx.flowFor(this.id);
        if (!runner.pendingTransition) return null;
        return def.flow.steps[runner.pendingTarget ?? (runner.stepIndex + 1) % def.flow.steps.length]?.id ?? null;
      }
      case "finished":
        return this.ctx.flowFor(this.id).runner.finished;
      case "stepVisits":
        return fn(key, (a) => stepVisits(this.ctx.flowFor(this.id).runner, a[0] === undefined ? undefined : toStr(a[0])));
      case "spawnedInStep":
        return fn(key, (a) => own(this.ctx.flowFor(this.id).runner.spawnedInStep, toStr(a[0])) ?? 0);
      case "harvestedInStep":
        return fn(key, (a) => own(this.ctx.flowFor(this.id).runner.harvestedInStep, toStr(a[0])) ?? 0);
      case "decayedInStep":
        return fn(key, (a) => own(this.ctx.flowFor(this.id).runner.decayedInStep, toStr(a[0])) ?? 0);
      case "fullyGrownCount":
        return fn(key, (a) => this.plot.plants.filter((p) => p.kindId === toStr(a[0]) && p.origin === "spawned" && isFullyGrown(p)).length);
      case "lowestStage":
      case "highestStage":
        return fn(key, (a) => {
          const stages = this.plot.plants.filter((p) => p.kindId === toStr(a[0]) && !p.isDeadPlant).map((p) => p.stage);
          if (!stages.length) return null;
          return stages.reduce((m, s) => (key === "lowestStage" ? Math.min(m, s) : Math.max(m, s)));
        });
      case "targetsFilled":
        return fn(key, () => this.filledTargets());
      case "allFullyGrown":
      case "noneFullyGrown":
      case "layoutShort":
        return fn(key, (_a, info) => rt.checkCondition(this.id, { kind: key }, info));
      case "decayImminent":
        return fn(key, (a, info) => rt.checkCondition(this.id, { kind: "decayImminent", withinCycles: num(a[0], info, "withinCycles") }, info));
      case "check":
        return fn(key, (a, info) => rt.checkCondition(this.id, a[0], info));
      case "exitDue":
        return fn(key, () => {
          const { def, runner } = this.ctx.flowFor(this.id);
          // On a copy: dueTarget may mark a finished flow.
          const to = dueTarget(this.plot, def, { ...runner }, this.ctx);
          return to === null ? null : def.flow.steps[to].id;
        });
      case "goto":
        return fn(key, (a, info) => this.changeStep(() => this.findStep(a[0], info), info, "plot.goto"));
      case "next":
        return fn(key, (_a, info) =>
          this.changeStep(() => {
            const { def, runner } = this.ctx.flowFor(this.id);
            return (runner.stepIndex + 1) % def.flow.steps.length;
          }, info, "plot.next")
        );
      case "restart":
        return fn(key, (_a, info) => this.changeStep(() => this.ctx.flowFor(this.id).runner.stepIndex, info, "plot.restart"));
      case "hold":
        return fn(key, (a, info) => {
          rt.notInCondition(info, "plot.hold");
          const on = a.length === 0 || !!a[0];
          const sp = rt.scriptPlot(this.id);
          if (on) sp.hold = true;
          else delete sp.hold;
          return on;
        });
      case "cancelPending":
        return fn(key, (_a, info) => {
          rt.notInCondition(info, "plot.cancelPending");
          const { runner } = this.ctx.flowFor(this.id);
          const had = runner.pendingTransition;
          runner.pendingTransition = false;
          delete runner.pendingTarget;
          return had;
        });

      // ---- actions ----
      case "place":
        return fn(key, (a, info) => this.place(toStr(a[0]), a[1], a[2], info));
      case "breakAt":
        return fn(key, (a, info) => {
          const [r, c] = cellArg(info, a[0], a[1]);
          if (!rt.canAct(info, "plot.breakAt")) return false;
          const q = buildOccupancy(this.plot)[r * GRID_SIZE + c];
          if (!q) return false;
          removeByPlayer(this.plot, q, this.ctx, rt.scratchFor(this.id), "broken by script");
          return true;
        });
      case "harvestAll":
        return fn(key, (a, info) => {
          if (!rt.canAct(info, "plot.harvestAll")) return 0;
          const k = this.ofKind(a[0]);
          let n = 0;
          for (const p of [...this.plot.plants]) {
            if (!this.plot.plants.includes(p) || !k(p) || p.origin === "placed" || !isHarvestable(p)) continue;
            harvestPlant(this.plot, p, this.ctx, rt.scratchFor(this.id));
            n++;
          }
          return n;
        });
      case "breakAll":
        return fn(key, (a, info) => {
          if (a[0] === undefined) info.fail('plot.breakAll needs a kind, like plot.breakAll("dead_plant")');
          if (!rt.canAct(info, "plot.breakAll")) return 0;
          const k = this.ofKind(a[0]);
          let n = 0;
          for (const p of [...this.plot.plants]) {
            if (!this.plot.plants.includes(p) || !k(p)) continue;
            removeByPlayer(this.plot, p, this.ctx, rt.scratchFor(this.id), "broken by script");
            n++;
          }
          return n;
        });
      case "water":
        return fn(key, (_a, info) => {
          if (!rt.canAct(info, "plot.water")) return false;
          for (const p of this.plot.plants) if (p.kindId !== "soggybud") p.water = MAX_WATER;
          return true;
        });
      case "setGround":
        return fn(key, (a, info) => {
          const [r, c] = cellArg(info, a[0], a[1]);
          const g = toStr(a[2]);
          if (!KNOWN_GROUND.includes(g)) info.fail(`"${g}" isn't a ground block. Use one of: ${KNOWN_GROUND.join(", ")}`);
          if (!rt.canAct(info, "plot.setGround")) return false;
          const k = cellKey(r, c);
          if (this.plot.groundTiles[k] === g) delete this.plot.groundOverrides[k];
          else this.plot.groundOverrides[k] = g;
          return true;
        });
      case "runPhase":
        return fn(key, (a, info) => {
          const id = toStr(a[0]);
          if (!isPhase(id)) info.fail(`"${id}" isn't a session phase. Use one of: ${SCRIPT_PHASES.join(", ")}`);
          if (!rt.canAct(info, "plot.runPhase")) return false;
          runSessionPhase(this.plot, this.ctx, rt.scratchFor(this.id), id);
          return true;
        });
      case "disable":
      case "enable":
        return fn(key, (a, info) => {
          const ids = a.map(toStr);
          for (const id of ids) if (!isPhase(id)) info.fail(`"${id}" isn't a session phase. Use one of: ${SCRIPT_PHASES.join(", ")}`);
          rt.notInCondition(info, `plot.${key}`);
          const sp = rt.scriptPlot(this.id);
          const set = new Set(sp.disabled ?? []);
          if (key === "disable") for (const id of ids) set.add(id);
          else if (ids.length === 0) set.clear();
          else for (const id of ids) set.delete(id);
          const list = SCRIPT_PHASES.filter((p) => set.has(p));
          if (list.length) sp.disabled = list;
          else delete sp.disabled;
          return true;
        });
      case "setPolicy":
        return fn(key, (a, info) => {
          rt.notInCondition(info, "plot.setPolicy");
          const patch = toPlainData(a[0]);
          if (!patch || typeof patch !== "object" || Array.isArray(patch)) info.fail('plot.setPolicy needs an object, like { spawnedHarvest: "never" }');
          checkPolicyPatch(patch as Record<string, unknown>, info);
          const sp = rt.scriptPlot(this.id);
          sp.policies = mergeOverrides(sp.policies, patch as PolicyOverrides);
          return true;
        });
      case "resetPolicies":
        return fn(key, (_a, info) => {
          rt.notInCondition(info, "plot.resetPolicies");
          delete rt.scriptPlot(this.id).policies;
          return true;
        });
      case "setLayout":
        return fn(key, (a, info) => {
          const layout = this.layoutArg(a[0], info);
          if (!rt.canAct(info, "plot.setLayout")) return false;
          rt.scriptPlot(this.id).layout = layout;
          applyStepLayout(this.plot, this.ctx.layoutFor(this.id), this.ctx, rt.scratchFor(this.id), false);
          return true;
        });
      case "resetLayout":
        return fn(key, (_a, info) => {
          if (!rt.canAct(info, "plot.resetLayout")) return false;
          const sp = rt.scriptPlot(this.id);
          if (!sp.layout) return false;
          delete sp.layout;
          applyStepLayout(this.plot, this.ctx.layoutFor(this.id), this.ctx, rt.scratchFor(this.id), false);
          return true;
        });
    }
    return undefined;
  }

  /** Change step now when online; offline it waits for the next session, like a built-in exit. */
  private changeStep(target: () => number, info: CallInfo, what: string): boolean {
    this.rt.notInCondition(info, what);
    const toIndex = target();
    const { def, runner } = this.ctx.flowFor(this.id);
    if (!this.ctx.active) {
      runner.pendingTransition = true;
      runner.pendingTarget = toIndex;
      return false;
    }
    const scratch = this.rt.scratchFor(this.id);
    transition(this.plot, def, runner, this.ctx, scratch, toIndex);
    scratch.stepChanged = true;
    // Like the built-in step change: spawns the new layout doesn't use are harvested now.
    runSessionPhase(this.plot, this.ctx, scratch, "harvestAfterStepChange");
    return true;
  }

  private layoutArg(v: unknown, info: CallInfo): StepLayout {
    const steps = this.ctx.flowFor(this.id).def.flow.steps;
    const isStep = typeof v === "number" || (typeof v === "string" && steps.some((s) => s.id === v || (s.label ?? "").trim().toLowerCase() === v.trim().toLowerCase()));
    if (isStep) return structuredClone(steps[this.findStep(v, info)].layout);
    let layout: StepLayout;
    if (typeof v === "string") layout = { code: v.trim() };
    else {
      const raw = toPlainData(v) as { plants?: unknown; targets?: unknown; ground?: unknown } | null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return info.fail("plot.setLayout needs a share code, a step, or { plants: [...], targets: [...] }");
      const list = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]).filter((e) => e && typeof e === "object") : []);
      layout = {
        plants: list(raw.plants).map((p) => ({ kindId: toStr(p.kind ?? p.kindId), row: toNum(p.row), col: toNum(p.col) })),
        slots: list(raw.targets).map((s) => ({ mutationId: toStr(s.mutation ?? s.mutationId), row: toNum(s.row), col: toNum(s.col) })),
        groundTiles: list(raw.ground).map((g) => ({ ground: toStr(g.ground), row: toNum(g.row), col: toNum(g.col) })),
      };
    }
    try {
      this.rt.env.resolveLayout(layout);
    } catch (err) {
      const why = err instanceof Error ? err.message.replace(/^Invalid layout:\n- /, "").replace(/\n- /g, "; ") : String(err);
      info.fail(`That layout can't be used: ${why}`);
    }
    return layout;
  }

  private place(kind: string, r: unknown, c: unknown, info: CallInfo): boolean {
    const rt = this.rt;
    const data = rt.env.data;
    const def = kindDef(data, kind);
    if (!def) info.fail(`"${kind}" isn't a crop or mutation`);
    const [row, col] = cellArg(info, r, c);
    if (!footprintFits(row, col, def!.size)) info.fail(`${def!.name} (${def!.size}x${def!.size}) doesn't fit at (${row}, ${col})`);
    if (!rt.canAct(info, "plot.place")) return false;
    const ctx = this.ctx;
    const plot = this.plot;
    if (!isFootprintFree(buildOccupancy(plot), row, col, def!.size)) return false;
    const origin = isHarvestableCrop(data, kind) ? "planted" : "placed";
    if (origin === "placed" && !isFreePlacedItem(kind)) {
      const allowDebt = ctx.config.allowMutationDebt === true && !!data.mutations[kind];
      const req = { cycle: ctx.cycle, plotId: plot.id, row, col, action: `place ${kind} (script)`, replacement: false, allowDebt };
      if (!spend(ctx.state, kind, 1, req, ctx.prices, ctx.emit)) return false;
    }
    const p = newPlant(ctx.state, data, ctx.config, kind, row, col, origin, ctx.cycle);
    insertPlant(plot, p);
    ctx.emit(plot.id, { kind: "placed", plantId: p.id, kindId: p.kindId, row, col, origin, replacement: false });
    return true;
  }
}

const POLICY_CHOICES: Record<string, string[]> = {
  spawnedHarvest: ["whenFullyGrown", "beforeDecay", "never"],
  layoutInputSpawns: ["keep", "harvest"],
  baseCropUpkeep: ["leaveUntilDecay", "harvestWhenGrown", "harvestBeforeDecay"],
  watering: ["toMax", "never"],
};
const POLICY_FLAGS = ["replaceDecayed", "fixGround", "clearTargetBlockers"];
const GATE_FLAGS = ["wakeSnoozling", "vacuumRat", "dischargeThunderling", "noctilumeTime", "feedFleshtrap", "clearRoots"];

function checkPolicyPatch(patch: Record<string, unknown>, info: CallInfo): void {
  for (const [k, v] of Object.entries(patch)) {
    if (POLICY_CHOICES[k]) {
      if (!POLICY_CHOICES[k].includes(v as string)) info.fail(`${k} must be one of: ${POLICY_CHOICES[k].join(", ")}`);
    } else if (POLICY_FLAGS.includes(k)) {
      if (typeof v !== "boolean") info.fail(`${k} must be true or false`);
    } else if (k === "gateInteractions") {
      if (!v || typeof v !== "object" || Array.isArray(v)) info.fail("gateInteractions must be an object");
      for (const [g, b] of Object.entries(v as object)) {
        if (!GATE_FLAGS.includes(g)) info.fail(`Unknown gate interaction "${g}". Use: ${GATE_FLAGS.join(", ")}`);
        if (typeof b !== "boolean") info.fail(`gateInteractions.${g} must be true or false`);
      }
    } else {
      info.fail(`Unknown policy "${k}". Use: ${[...Object.keys(POLICY_CHOICES), ...POLICY_FLAGS, "gateInteractions"].join(", ")}`);
    }
  }
}

function mergeOverrides(base: PolicyOverrides | undefined, patch: PolicyOverrides): PolicyOverrides {
  const { gateInteractions, ...rest } = patch;
  const out: PolicyOverrides = { ...(base ?? {}), ...rest };
  if (gateInteractions || base?.gateInteractions) out.gateInteractions = { ...(base?.gateInteractions ?? {}), ...(gateInteractions ?? {}) };
  return out;
}

// ---- plant ----

const PLANT_KEYS = [
  "id", "kind", "name", "row", "col", "size", "origin", "stage", "growthStages", "readyStage", "fullyGrown", "harvestable", "water", "dry",
  "dead", "rival", "decaySeconds", "decayCycles", "timesMutated", "mutatesRemaining", "effects", "lockedEffects", "alive", "protected",
];
const PLANT_ACTIONS = ["break", "harvest", "destroy", "waterIt", "wake", "vacuum", "discharge", "feed", "protect", "willDecayWithin"];

class PlantHost extends HostObject {
  private readonly rt: ScriptRuntime;
  private readonly plotId: number;
  private readonly plantId: number;
  constructor(rt: ScriptRuntime, plotId: number, plantId: number) {
    super();
    this.rt = rt;
    this.plotId = plotId;
    this.plantId = plantId;
  }
  ref(): string {
    return `plant:${this.plotId}:${this.plantId}`;
  }
  private find(): PlantState | undefined {
    return this.rt.plotState(this.plotId)?.plants.find((p) => p.id === this.plantId);
  }
  private nameOf(p: PlantState): string {
    return kindDef(this.rt.env.data, p.kindId)?.name ?? (isRoot(p) ? "Devourer Root" : p.kindId);
  }
  describe(): string {
    const p = this.find();
    return p ? `${this.nameOf(p)} at (${p.row}, ${p.col}) on Plot ${this.plotId}` : `a plant that is gone (#${this.plantId} on Plot ${this.plotId})`;
  }
  keys(): string[] {
    return PLANT_KEYS;
  }
  get(key: string): unknown {
    const rt = this.rt;
    const p = this.find();
    const fn = (name: string, impl: (args: unknown[], info: CallInfo) => unknown) => new HostFn(`plant.${name}`, impl);
    if (key === "alive") return !!p;
    if (key === "id") return this.plantId;
    if (key === "plot") return rt.plotHost(this.plotId);
    if (!p) return PLANT_ACTIONS.includes(key) ? fn(key, () => false) : undefined;
    switch (key) {
      case "kind":
        return p.kindId;
      case "name":
        return this.nameOf(p);
      case "row":
        return p.row;
      case "col":
        return p.col;
      case "size":
        return p.size;
      case "origin":
        return p.origin;
      case "spawned":
      case "planted":
      case "placed":
        return p.origin === key;
      case "stage":
        return p.stage;
      case "growthStages":
        return p.growthStages;
      case "readyStage":
        return p.readyStage;
      case "fullyGrown":
        return isFullyGrown(p);
      case "harvestable":
        return isHarvestable(p);
      case "water":
        return p.water;
      case "dry":
        return isDry(p);
      case "dead":
        return p.isDeadPlant;
      case "root":
        return isRoot(p);
      case "rival":
        return p.isRival;
      case "decaySeconds":
        return p.decaySecondsRemaining;
      case "decayCycles": {
        if (p.decaySecondsRemaining === null) return null;
        const secs = rt.cycleCtx.cycleSeconds;
        return Math.max(0, Math.ceil(p.decaySecondsRemaining / secs - 1e-9));
      }
      case "timesMutated":
        return p.timesMutated;
      case "mutatesRemaining":
        return p.mutatesRemaining;
      case "effects":
        return [...p.held];
      case "lockedEffects":
        return p.lockedEffects ? [...p.lockedEffects] : null;
      case "asleep":
        return !!p.gate.asleep;
      case "ratAlive":
        return !!p.gate.ratAlive;
      case "charge":
        return p.gate.charge ?? null;
      case "hunger":
        return p.gate.hunger ?? null;
      case "primed":
        return !!p.gate.primed;
      case "target":
        return rt.plotState(this.plotId)!.slots.find((s) => s.row === p.row && s.col === p.col)?.mutationId ?? null;
      case "protected":
        return !!rt.scriptsState.plots[String(this.plotId)]?.protected?.includes(p.id);
      case "willDecayWithin":
        return fn(key, (a, info) => wouldDecayWithin(rt.plotState(this.plotId)!, p, num(a[0], info, "cycles") * rt.cycleCtx.cycleSeconds));
      case "break":
        return fn(key, (_a, info) => this.act(info, key, (plot, q) => removeByPlayer(plot, q, rt.cycleCtx, rt.scratchFor(this.plotId), "broken by script")));
      case "harvest":
        return fn(key, (_a, info) => {
          if (!rt.canAct(info, "plant.harvest") || !isHarvestable(p) || p.origin === "placed") return false;
          return this.act(info, key, (plot, q) => harvestPlant(plot, q, rt.cycleCtx, rt.scratchFor(this.plotId)));
        });
      case "destroy":
        return fn(key, (_a, info) => this.act(info, key, (plot, q) => destroyPlant(plot, q, rt.cycleCtx, "destroyed by script")));
      case "waterIt":
        return fn(key, (a, info) => {
          const add = a[0] === undefined ? null : num(a[0], info, "amount");
          return this.act(info, key, (_plot, q) => {
            if (q.kindId === "soggybud") return; // can't be watered
            q.water = add === null ? MAX_WATER : Math.min(MAX_WATER, q.water + add);
          });
        });
      case "wake":
        return fn(key, (_a, info) => this.act(info, key, (_plot, q) => void (q.gate.asleep = false)));
      case "vacuum":
        return fn(key, (_a, info) => this.act(info, key, (_plot, q) => void (q.gate.ratAlive = false)));
      case "discharge":
        return fn(key, (_a, info) => this.act(info, key, (_plot, q) => void (q.gate.charge !== undefined && (q.gate.charge = 0))));
      case "feed":
        return fn(key, (_a, info) =>
          this.act(info, key, (_plot, q) => {
            if (q.kindId === "fleshtrap" && q.origin === "spawned") q.gate.hunger = (q.gate.hunger ?? 0) + rt.cycleCtx.config.fleshtrapFeedHunger;
          })
        );
      case "protect":
        return fn(key, (a, info) => {
          rt.notInCondition(info, "plant.protect");
          const on = a.length === 0 || !!a[0];
          const sp = rt.scriptPlot(this.plotId);
          const set = new Set(sp.protected ?? []);
          if (on) set.add(p.id);
          else set.delete(p.id);
          if (set.size) sp.protected = [...set].sort((x, y) => x - y);
          else delete sp.protected;
          return on;
        });
    }
    return undefined;
  }
  private act(info: CallInfo, what: string, body: (plot: PlotState, p: PlantState) => void): boolean {
    if (!this.rt.canAct(info, `plant.${what}`)) return false;
    const plot = this.rt.plotState(this.plotId)!;
    const p = plot.plants.find((q) => q.id === this.plantId);
    if (!p) return false;
    body(plot, p);
    return true;
  }
}
