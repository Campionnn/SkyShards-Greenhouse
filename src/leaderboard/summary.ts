import type { GameData, ItemId } from "../simulator/data/types";
import { layoutSpecOf } from "../simulator/flow/layout";
import type { StepLayout } from "../simulator/flow/types";
import { isHarvestableCrop } from "../simulator/data/load";
import type { Submission } from "./rules";

/**
 * A small, static description of a submission for the ranking list (docs/plans/flow-leaderboard.md
 * §7.1): what each plot grows and places, how many steps, whether it is scripted, and a thumbnail
 * layout. The verifier CLI computes it in `check` mode, the API stores it with the entry and the list
 * sends it with every row, so the page can show a layout and mutation chips without the payload.
 * Pure; reads the layouts only (no simulation).
 */

export interface PlotSummary {
  id: number;
  steps: number;
  loop: boolean;
  scripted: boolean;
  /** The share code of the plot's start step (null when that layout is not a share code). */
  thumb: string | null;
  /** Target mutations over every step, by target cells. */
  targets: Record<ItemId, number>;
  /** Paid placed items over every step's layout, by the most any one step places. */
  placed: Record<ItemId, number>;
  /** Base crops planted in the start step, by cells. */
  crops: Record<ItemId, number>;
}

export interface FlowSummary {
  plots: PlotSummary[];
  /** Every target mutation over all plots and steps, most target cells first. */
  targets: ItemId[];
  /** Distinct mutation items any layout places (inputs the player supplies or grows). */
  inputs: ItemId[];
  steps: number;
  scripted: boolean;
}

const bump = (rec: Record<string, number>, k: string, n = 1) => {
  rec[k] = (rec[k] ?? 0) + n;
};

function specOf(layout: StepLayout, data: GameData) {
  try {
    return layoutSpecOf(layout, data).layout;
  } catch {
    return { plants: [], slots: [] };
  }
}

const FREE = new Set(["fire"]);

export function summarizeSubmission(s: Submission, data: GameData): FlowSummary {
  const totalTargets: Record<string, number> = {};
  const inputs = new Set<string>();
  const plots: PlotSummary[] = s.plots.map((p) => {
    const targets: Record<string, number> = {};
    const placed: Record<string, number> = {};
    const crops: Record<string, number> = {};
    const steps = p.flow.steps;
    const start = steps[p.flow.startIndex] ?? steps[0];
    steps.forEach((step) => {
      const spec = specOf(step.layout, data);
      const here: Record<string, number> = {};
      for (const slot of spec.slots) {
        if (!data.mutations[slot.mutationId]) continue;
        bump(targets, slot.mutationId);
        bump(totalTargets, slot.mutationId);
      }
      for (const plant of spec.plants) {
        if (isHarvestableCrop(data, plant.kindId)) {
          if (step === start) bump(crops, plant.kindId);
          continue;
        }
        if (FREE.has(plant.kindId)) continue;
        bump(here, plant.kindId);
        if (data.mutations[plant.kindId]) inputs.add(plant.kindId);
      }
      for (const [k, n] of Object.entries(here)) placed[k] = Math.max(placed[k] ?? 0, n);
    });
    const thumb = start && "code" in start.layout && typeof start.layout.code === "string" ? start.layout.code : null;
    return { id: p.id, steps: steps.length, loop: !!p.flow.loop, scripted: !!p.script?.source.trim(), thumb, targets, placed, crops };
  });
  const targets = Object.entries(totalTargets)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
  return {
    plots,
    targets,
    inputs: [...inputs].sort(),
    steps: plots.reduce((n, p) => n + p.steps, 0),
    scripted: !!s.script?.source.trim() || plots.some((p) => p.scripted),
  };
}
