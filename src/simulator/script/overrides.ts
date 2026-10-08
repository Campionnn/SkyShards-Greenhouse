// Read-only helpers the engine uses to honour what scripts set for a plot
// (state.scripts.plots). They read state only, so the engine never needs the
// script runtime to respect a script's choices. Absent scripts = no overrides.

import type { Scenario, SimulationState } from "../sim/state";
import type { Condition } from "../flow/types";
import type { ScriptDef, ScriptPlotState } from "./types";

export function scriptPlot(state: SimulationState, plotId: number): ScriptPlotState | undefined {
  return state.scripts?.plots[String(plotId)];
}

/** A built-in session phase a script switched off for this plot. */
export function phaseDisabled(state: SimulationState, plotId: number, phaseId: string): boolean {
  return !!scriptPlot(state, plotId)?.disabled?.includes(phaseId);
}

/** Built-in harvest / upkeep / clearing leave this plant alone (`plant.protect()`). */
export function isProtected(state: SimulationState, plotId: number, plantId: number): boolean {
  return !!scriptPlot(state, plotId)?.protected?.includes(plantId);
}

/** `plot.hold()`: the built-in exits are not checked. */
export function exitsHeld(state: SimulationState, plotId: number): boolean {
  return scriptPlot(state, plotId)?.hold === true;
}

const runs = (s: ScriptDef | undefined): boolean => !!s && s.enabled !== false && s.source.trim().length > 0;

/** Does any exit condition (nested groups included) use a script expression? */
export function conditionsUseScript(list: readonly Condition[]): boolean {
  return list.some((c) => (c.kind === "group" ? conditionsUseScript(c.of) : c.kind === "script"));
}

/** The scenario runs scripts: an enabled script with code, or a script exit condition. */
export function scenarioUsesScripts(sc: Scenario): boolean {
  if (runs(sc.script)) return true;
  return sc.plots.some((p) => runs(p.script) || p.flow.steps.some((s) => s.exits.some((e) => conditionsUseScript(e.when))));
}

/** Enabled scripts with code, in run order: the controller, then plots in plot order. */
export function enabledScripts(sc: Scenario): { key: string; plotId: number | null; source: string }[] {
  const out: { key: string; plotId: number | null; source: string }[] = [];
  if (runs(sc.script)) out.push({ key: "global", plotId: null, source: sc.script!.source });
  for (const id of sc.settings.config.plotOrder) {
    const p = sc.plots.find((q) => q.id === id);
    if (p && runs(p.script)) out.push({ key: `plot:${id}`, plotId: id, source: p.script!.source });
  }
  return out;
}
