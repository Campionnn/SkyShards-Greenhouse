import type { ScriptRuntime } from "../script/runtime";
import type { CycleCtx } from "./context";
import type { PlotId, SimulationState, TimedEvent } from "./state";

// Stop points: the moments inside a cycle the simulator page can step to (Step by: detail).
//
// The engine calls `ctx.probe` (from RunOptions.probe) right after each of these happens. Without a
// probe nothing is built or called: every call site is behind `if (ctx.probe)`, so a normal run does
// exactly what it did before, as fast. A probe only reads the working state (it may copy it) and
// never changes it, so a run with a probe gives the same states as one without (stops.test.ts).
//
// Stepping inside a cycle is a replay (sim/replay.ts): the cycle runs again from its start with a
// probe and the state is copied at the stop that is wanted. Time still only moves through run().

/** What kind of moment a stop is. The page lets the user pick which kinds to stop at. */
export type StopKind =
  /** A game-tick phase finished on one plot (TICK_PHASES). */
  | "tickPhase"
  /** A player-session phase finished on one plot (PLAYER_PHASES). */
  | "sessionPhase"
  /** One thing the player did through the built-in phases: a harvest, a break, a placement... */
  | "playerAction"
  /** One thing a script did: the same actions, taken by script code (or a phase it ran itself). */
  | "scriptAction"
  /** One script hook call finished (onTick, onSession, an event hook...). */
  | "scriptHook";

export const STOP_KINDS: readonly StopKind[] = ["tickPhase", "sessionPhase", "playerAction", "scriptAction", "scriptHook"];

/**
 * One stop. Action ids: harvest, break, destroy, clearDead, pickUp, place, plant, replant, replace,
 * water, wake, vacuum, discharge, feed, noctilume, clearRoot, fixGround, setGround, stepChange,
 * setLayout, sell, and `debug.<tool>` for the scripts' debug tools.
 */
export interface StopPoint {
  kind: StopKind;
  /** The plot it happened on; null for the whole cycle (controller hooks, selling surplus). */
  plotId: PlotId | null;
  /** The phase id, hook name or action id. */
  id: string;
  /** The plant kind acted on, and where it stood. */
  kindId?: string;
  row?: number;
  col?: number;
  /** A short extra: the step moved to, the ground set, the event an event hook got... */
  detail?: string;
  /** Script stops: which script (`ScriptKey`) and, for actions, the hook it ran in. */
  script?: string;
  hook?: string | null;
}

/** What a probe gets at a stop. Read only. */
export interface ProbeView {
  /** run()'s working state, mid-cycle. */
  state: SimulationState;
  /** This cycle's events so far. */
  events: readonly TimedEvent[];
  /** The live script runtime (its variables are only encoded into state at the end of the cycle). */
  scripts: ScriptRuntime | null;
}

/** RunOptions.probe: called at every stop. Must not change anything it is given. */
export type RunProbe = (stop: StopPoint, at: ProbeView) => void;

/** ctx.probe: the cycle's probe (run.ts binds the view). */
export type CycleProbe = (stop: StopPoint) => void;

/**
 * Report a physical action as a stop: a script action while script code runs (its own call, or a
 * phase it ran with plot.runPhase), else a player action. Call only behind `if (ctx.probe)`.
 */
export function probeAction(ctx: CycleCtx, plotId: PlotId | null, id: string, kindId?: string, row?: number, col?: number, detail?: string): void {
  const probe = ctx.probe;
  if (!probe) return;
  const who = ctx.scripts?.acting ?? null;
  const stop: StopPoint = { kind: who ? "scriptAction" : "playerAction", plotId, id };
  if (kindId !== undefined) stop.kindId = kindId;
  if (row !== undefined) stop.row = row;
  if (col !== undefined) stop.col = col;
  if (detail !== undefined) stop.detail = detail;
  if (who) {
    stop.script = who.script;
    stop.hook = who.hook;
  }
  probe(stop);
}
