import type { FlowStep, Scenario, ScenarioPlot, StepExit, StepUi } from "../../../simulator";

// Pure helpers behind the graph flow editor. No React here: everything is unit tested in
// model.test.ts.
//
// Explicit exits: the flow editor shows every exit with its real target, so it rewrites
// "the following step" exits (`to` omitted) as `to: <id>`. The engine treats the two the same
// EXCEPT on the last step of a non-looping flow, where an omitted `to` means "finish: hold this
// step" (the runner marks the flow finished). That exit stays `to`-less and is shown as a
// "Finish" exit; it can only exist on the last step, and the editor keeps that step last.

/** Where an exit goes, resolved for display. */
export type ExitTarget = { kind: "step"; index: number; id: string } | { kind: "finish" } | { kind: "missing"; id: string };

export function exitTarget(plot: ScenarioPlot, stepIndex: number, exit: StepExit): ExitTarget {
  const { steps, loop } = plot.flow;
  if (exit.to !== undefined) {
    const i = steps.findIndex((s) => s.id === exit.to);
    return i < 0 ? { kind: "missing", id: exit.to } : { kind: "step", index: i, id: exit.to };
  }
  if (stepIndex < steps.length - 1) return { kind: "step", index: stepIndex + 1, id: steps[stepIndex + 1].id };
  if (loop) return { kind: "step", index: 0, id: steps[0].id };
  return { kind: "finish" };
}

/** True for the one exit kind that must stay implicit: a finish on the final step of a non-looping flow. */
export function isFinishExit(plot: ScenarioPlot, stepIndex: number, exit: StepExit): boolean {
  return exitTarget(plot, stepIndex, exit).kind === "finish";
}

/**
 * The same flow with every "following step" exit written out (`to: <id>`). Behaviour is
 * identical: the runner resolves both to the same index. Finish exits stay as they are.
 * Returns the same object when nothing changes.
 */
export function explicitExits(plot: ScenarioPlot): ScenarioPlot {
  let changed = false;
  const steps = plot.flow.steps.map((s, i) => {
    let stepChanged = false;
    const exits = s.exits.map((e) => {
      if (e.to !== undefined) return e;
      const t = exitTarget(plot, i, e);
      if (t.kind !== "step") return e;
      stepChanged = true;
      return { ...e, to: t.id };
    });
    if (!stepChanged) return s;
    changed = true;
    return { ...s, exits };
  });
  return changed ? { ...plot, flow: { ...plot.flow, steps } } : plot;
}

/** Whether the plot has a finish exit (it pins the last step in place). */
export function hasFinishExit(plot: ScenarioPlot): boolean {
  const last = plot.flow.steps.length - 1;
  return !plot.flow.loop && plot.flow.steps[last]?.exits.some((e) => e.to === undefined) === true;
}

/**
 * Turning loop on or off. With explicit exits, nothing but the finish exit depends on the flag:
 * looping turns a finish exit into "go to step 1"; not looping keeps every target as it is.
 */
export function setLoop(plot: ScenarioPlot, loop: boolean): ScenarioPlot {
  if (plot.flow.loop === loop) return plot;
  // Resolve targets as they read under the new setting: a finish exit becomes "go to step 1".
  const fixed = explicitExits(loop ? { ...plot, flow: { ...plot.flow, loop } } : plot);
  return { ...fixed, flow: { ...fixed.flow, loop } };
}

/**
 * Moves a step in the flow's order without changing where any exit goes (exits are explicit).
 * The start step follows its step. Refuses (returns the plot unchanged) to move the last step
 * of a flow with a finish exit, or another step past it.
 */
export function moveStep(plot: ScenarioPlot, from: number, to: number): ScenarioPlot {
  const n = plot.flow.steps.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return plot;
  const p = explicitExits(plot);
  if (hasFinishExit(p) && (from === n - 1 || to === n - 1)) return plot;
  const steps = [...p.flow.steps];
  const startId = steps[p.flow.startIndex]?.id;
  const [s] = steps.splice(from, 1);
  steps.splice(to, 0, s);
  return { ...p, flow: { ...p.flow, steps, startIndex: Math.max(0, steps.findIndex((x) => x.id === startId)) } };
}

/** Inserts a step after `after` (or at the end); before a pinned final step it goes right before it. */
export function insertStep(plot: ScenarioPlot, step: FlowStep, after?: number): { plot: ScenarioPlot; index: number } {
  const p = explicitExits(plot);
  const steps = [...p.flow.steps];
  let at = after === undefined ? steps.length : after + 1;
  if (hasFinishExit(p) && at >= steps.length) at = steps.length - 1;
  steps.splice(at, 0, step);
  const startId = p.flow.steps[p.flow.startIndex]?.id;
  return { plot: { ...p, flow: { ...p.flow, steps, startIndex: Math.max(0, steps.findIndex((x) => x.id === startId)) } }, index: at };
}

// ---- Editor-only data ---------------------------------------------------------------------------

/** A step without its editor-only `ui`. */
export function stepWithoutUi(s: FlowStep): FlowStep {
  if (!("ui" in s)) return s;
  const { ui: _ui, ...rest } = s;
  void _ui;
  return rest;
}

/**
 * The scenario the engine sees: editor-only data removed, so moving nodes, notes and frames
 * never restarts a run (the page compares this, not the raw scenario). Keeps object identity
 * for plots that have no editor data.
 */
export function withoutEditorUi(sc: Scenario): Scenario {
  let changed = false;
  const plots = sc.plots.map((p) => {
    if (!p.flow.steps.some((s) => "ui" in s)) return p;
    changed = true;
    return { ...p, flow: { ...p.flow, steps: p.flow.steps.map(stepWithoutUi) } };
  });
  return changed ? { ...sc, plots } : sc;
}

/**
 * A stable string of what the engine does with a scenario, for "should the run restart".
 * Editor data is ignored, and implicit / explicit "next step" exits count as the same (they
 * behave identically), so opening the editor and moving nodes never restarts a run.
 */
export function engineKey(sc: Scenario): string {
  const bare = withoutEditorUi(sc);
  return JSON.stringify({ ...bare, plots: bare.plots.map(explicitExits) });
}

/** Sets (merges) a step's editor data; `undefined` fields are removed. Drops `ui` when it would be empty. */
export function withStepUi(s: FlowStep, patch: Partial<StepUi>): FlowStep {
  const next: Record<string, unknown> = { ...(s.ui ?? {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
  if (typeof next.x !== "number" || typeof next.y !== "number") {
    const { ui: _ui, ...rest } = s;
    void _ui;
    return rest;
  }
  return { ...s, ui: next as unknown as StepUi };
}

/** Rounds positions so saved flows stay small and diffs stay readable. */
export const snap = (v: number) => Math.round(v);

/** Every step has a position. */
export function hasPositions(plot: ScenarioPlot): boolean {
  return plot.flow.steps.every((s) => typeof s.ui?.x === "number" && typeof s.ui?.y === "number");
}

/** Reads a step's editor data from untrusted JSON: only known, well-typed fields survive. */
export function cleanStepUi(raw: unknown): StepUi | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6;
  if (!num(r.x) || !num(r.y)) return undefined;
  const out: StepUi = { x: snap(r.x as number), y: snap(r.y as number) };
  if (typeof r.note === "string" && r.note.trim()) out.note = r.note.slice(0, 2000);
  if (typeof r.frame === "string" && r.frame.trim()) out.frame = r.frame.slice(0, 80);
  if (typeof r.frameColor === "string" && (FRAME_COLORS as readonly string[]).includes(r.frameColor)) out.frameColor = r.frameColor as StepUi["frameColor"];
  return out;
}

export const FRAME_COLORS = ["slate", "emerald", "sky", "violet", "amber", "rose"] as const;
