import { createContext, useContext } from "react";
import type { FlowStep, Scenario, ScenarioPlot, StepLayout } from "../../../simulator";

// The contract between the flow editor's parts: the shell (FlowGraphEditor) owns state and
// history and provides this; the canvas, inspector, rail and list view only read it and call it.

export interface AddStepRequest {
  /** Insert after this step index in flow order (default: at the end, before a pinned final step). */
  after?: number;
  /** Wire this exit to the new step: [stepIndex, exitIndex], or [stepIndex] to add a new exit to it. */
  from?: [number, number?];
  /** Canvas position for the new node (flow coordinates). */
  at?: { x: number; y: number };
  /** What the step starts as. Default: an empty layout. */
  layout?: StepLayout;
  label?: string;
  /** Copy this step (layout, exits, actions, watch, note). */
  duplicateOf?: number;
}

export interface AddMenuRequest extends Omit<AddStepRequest, "layout" | "label" | "duplicateOf"> {
  /** Screen position (client px) to open the menu at. */
  screen: { x: number; y: number };
}

export type InspectorTab = "exits" | "targets" | "actions" | "notes";

export interface FlowEditorApi {
  scenario: Scenario;
  /**
   * The plot as displayed: explicit exit targets and a position for every step. Always read
   * this, never `scenario.plots`. Exits are explicit (`to` set) except a finish exit on the
   * final step of a non-looping flow.
   */
  plot: ScenarioPlot;
  plotId: number;
  /** Selected step index, or null (then the inspector shows the plot settings). */
  selected: number | null;
  select: (index: number | null) => void;
  /** Inspector tab, and which exit card is open in it. */
  tab: InspectorTab;
  setTab: (t: InspectorTab) => void;
  openExit: number;
  setOpenExit: (i: number) => void;
  /** The hovered exit row / card / wire, highlighted everywhere: [stepIndex, exitIndex]. */
  hotExit: [number, number] | null;
  setHotExit: (e: [number, number] | null) => void;
  /**
   * Change the plot. `fn` receives a fresh deep copy of the displayed plot and returns the next
   * one. `uiOnly`: only editor data changed (positions, notes, frames), which never restarts
   * the simulation and coalesces with the previous ui-only change for undo (`mergeKey`).
   */
  edit: (fn: (p: ScenarioPlot) => ScenarioPlot, opts?: { uiOnly?: boolean; mergeKey?: string }) => void;
  /** Edit one step (index into plot.flow.steps). */
  editStep: (index: number, fn: (s: FlowStep) => FlowStep, opts?: { uiOnly?: boolean; mergeKey?: string }) => void;
  addStep: (req: AddStepRequest) => number;
  deleteStep: (index: number) => void;
  duplicateStep: (index: number) => void;
  /** Opens the add-step menu (layout sources, empty, duplicate) at a screen position. */
  openAddMenu: (req: AddMenuRequest) => void;
  /** Opens the full-screen layout workspace for a step. */
  openLayout: (index: number) => void;
  /** Pans/zooms the canvas to a step (from the rail, search, list). */
  focusStep: (index: number) => void;
  /** Registered by the canvas so the shell can call focusStep / frame all. */
  registerCanvas: (c: CanvasHandle | null) => void;
  /** Plot script attached (steps entered by plot.goto are drawn in a "script" frame). */
  scripted: boolean;
  /** Draw every wire in a busy flow, not just the selected step's. */
  showAllWires: boolean;
  setShowAllWires: (v: boolean) => void;
}

export interface CanvasHandle {
  focusStep: (index: number) => void;
  frameAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export const FlowEditorContext = createContext<FlowEditorApi | null>(null);

export function useFlowEditor(): FlowEditorApi {
  const api = useContext(FlowEditorContext);
  if (!api) throw new Error("useFlowEditor outside FlowGraphEditor");
  return api;
}

/** A flow with this many exits or more draws only the selected step's wires (plus a toggle). */
export const BUSY_WIRES = 14;
