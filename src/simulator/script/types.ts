import type { PolicyOverrides, StepLayout } from "../flow/types";
import type { RngState } from "../rng";

/** A script attached to the scenario (the controller) or to one plot. Persisted with the scenario and in flow files. */
export interface ScriptDef {
  source: string;
  /** Missing = on. A disabled script is kept but never runs. */
  enabled?: boolean;
}

/** "global" for the scenario's controller script, "plot:N" for plot N's script. */
export type ScriptKey = string;

export const GLOBAL_SCRIPT: ScriptKey = "global";
export const plotScriptKey = (plotId: number): ScriptKey => `plot:${plotId}`;

/**
 * A script value as plain data. Objects and arrays live in the heap and are
 * referenced by index, so shared references and cycles survive between cycles.
 * - `{r}`: heap entry
 * - `{u: 1}`: undefined; `{x}`: a number JSON can't hold
 * - `{f, s}`: function `f` (parse id) declared at the top level of script `s`
 * - `{h}`: an engine object (plot, plant, inventory, ...)
 */
export type EncodedValue =
  | null
  | boolean
  | number
  | string
  | { r: number }
  | { u: 1 }
  | { x: "NaN" | "Infinity" | "-Infinity" | "-0" }
  | { f: number; s: ScriptKey }
  | { h: string };

export type HeapEntry = { a: EncodedValue[] } | { o: [string, EncodedValue][] };

export type ScriptVarKind = "let" | "const" | "var";

/** Runtime overrides a script set for one plot. Every field optional; persisted in state. */
export interface ScriptPlotState {
  /** Player phases switched off (`plot.disable("harvest")`). */
  disabled?: string[];
  /** Policy overrides on top of scenario, plot and step policies (`plot.setPolicy`). */
  policies?: PolicyOverrides;
  /** Layout replacing the current step's layout until the next step change (`plot.setLayout`). */
  layout?: StepLayout;
  /** Built-in exits are not checked while held (`plot.hold()`). */
  hold?: boolean;
  /** Plant ids the built-in harvest / base-crop / clear-target phases leave alone (`plant.protect()`). */
  protected?: number[];
}

export interface ScriptLogLine {
  cycle: number;
  /** "global" or "plot:N". */
  script: ScriptKey;
  level: "log" | "warn" | "error";
  text: string;
}

/** Why scripts stopped the run at the end of a cycle. */
export interface ScriptHalt {
  kind: "error" | "pause";
  cycle: number;
  script: ScriptKey;
  /** Hook that was running, or "condition" / "top level". */
  hook: string | null;
  message: string;
  line?: number;
  col?: number;
}

export interface ScriptMetric {
  value: number;
  cycle: number;
  /** [cycle, value] samples, oldest first, thinned to stay bounded. */
  history: [number, number][];
}

/** Everything the scripts keep between cycles. Plain data (lives in SimulationState). */
export interface ScriptsState {
  heap: HeapEntry[];
  /** Script key -> top-level variable -> [kind, value]. */
  scopes: Record<ScriptKey, Record<string, [ScriptVarKind, EncodedValue]>>;
  /** The `shared` object every script sees. */
  shared: EncodedValue;
  /** Separate stream for random() / chance(), so scripts don't shift the game's dice. */
  rng: RngState;
  /** Plot id -> overrides. */
  plots: Record<string, ScriptPlotState>;
  /** Recent log lines, oldest first (bounded). */
  logs: ScriptLogLine[];
  metrics: Record<string, ScriptMetric>;
  /** Set when a script errored or called pause(); the run stops after that cycle. Cleared by the next run. */
  halt: ScriptHalt | null;
}

export const MAX_LOG_LINES = 300;
export const MAX_METRIC_SAMPLES = 400;
