import type { Scenario, ScriptDef, ScriptHalt } from "../../../simulator";

/** Which script: the controller, or a plot's (by id). */
export type ScriptTarget = "controller" | number;

export function getScript(sc: Scenario, target: ScriptTarget): ScriptDef | undefined {
  if (target === "controller") return sc.script;
  return sc.plots.find((p) => p.id === target)?.script;
}

/** Set (or with empty source, remove) a script. Pure. */
export function setScript(sc: Scenario, target: ScriptTarget, def: ScriptDef): Scenario {
  const keep = def.source.trim().length > 0;
  const value: ScriptDef | undefined = keep ? (def.enabled === false ? { source: def.source, enabled: false } : { source: def.source }) : undefined;
  if (target === "controller") {
    const next = { ...sc };
    if (value) next.script = value;
    else delete next.script;
    return next;
  }
  return {
    ...sc,
    plots: sc.plots.map((p) => {
      if (p.id !== target) return p;
      const q = { ...p };
      if (value) q.script = value;
      else delete q.script;
      return q;
    }),
  };
}

/** "global" -> "Controller", "plot:2" -> "Plot 2". */
export const scriptLabel = (key: string): string => (key === "global" ? "Controller" : key === "shared" ? "shared" : key.replace("plot:", "Plot "));

/** Where a script halt happened, in words. */
export function haltText(h: ScriptHalt): string {
  const where = [scriptLabel(h.script), h.hook ? `in ${h.hook}` : null, h.line !== undefined ? `line ${h.line}:${h.col}` : null].filter(Boolean).join(", ");
  return h.kind === "pause" ? `Paused at cycle ${h.cycle} by ${where}: ${h.message}` : `Script error at cycle ${h.cycle} (${where}): ${h.message}`;
}

export const scriptTargetLabel = (t: ScriptTarget): string => (t === "controller" ? "Controller" : `Plot ${t}`);

/** Scripts in the scenario with code (for badges). */
export function scriptCount(sc: Scenario): number {
  return (sc.script?.source.trim() ? 1 : 0) + sc.plots.filter((p) => p.script?.source.trim()).length;
}
