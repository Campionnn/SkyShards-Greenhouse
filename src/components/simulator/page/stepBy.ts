import { useCallback, useState } from "react";
import { STOP_KINDS, type StopKind, type StopPoint } from "../../../simulator";
import { nameOf } from "../format";
import { scriptLabel } from "../script/scriptEdit";

// "Step by": whether Step / Back move a whole cycle or one stop point inside it (a phase, an
// action, a script hook; sim/stops.ts), and which kinds of stop. Remembered in this browser.

export interface StepBy {
  /** Step / Back go stop by stop inside the cycle. */
  detail: boolean;
  /** The kinds of stop to step to. */
  kinds: StopKind[];
}

const KEY = "skyshards-simulator-step-by";
export const DEFAULT_STEP_BY: StepBy = { detail: false, kinds: ["sessionPhase", "playerAction", "scriptAction"] };

export const STOP_KIND_INFO: Record<StopKind, { label: string; hint: string }> = {
  tickPhase: { label: "Game tick phases", hint: "Destruction, growth, water loss, spawn roll and decay, on each plot" },
  sessionPhase: { label: "Player session phases", hint: "Water, harvest, step change, re-place… on each plot, on online cycles" },
  playerAction: { label: "Player actions", hint: "Each harvest, break, placement or watering the built-in phases do" },
  scriptAction: { label: "Script actions", hint: "Each harvest, break, placement or step change a script makes" },
  scriptHook: { label: "Script hooks", hint: "Each script hook call (onTick, onSession, event hooks…) as it finishes" },
};

function load(): StepBy {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_STEP_BY;
    const v = JSON.parse(raw) as Partial<StepBy>;
    const kinds = Array.isArray(v.kinds) ? STOP_KINDS.filter((k) => v.kinds!.includes(k)) : DEFAULT_STEP_BY.kinds;
    return { detail: v.detail === true, kinds };
  } catch {
    return DEFAULT_STEP_BY;
  }
}

export function useStepBy(): [StepBy, (next: StepBy) => void] {
  const [value, setValue] = useState<StepBy>(load);
  const set = useCallback((next: StepBy) => {
    setValue(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private mode: just not remembered
    }
  }, []);
  return [value, set];
}

/** Detail stepping that can actually stop somewhere. */
export const stepsInside = (s: StepBy): boolean => s.detail && s.kinds.length > 0;

const TICK_PHASE: Record<string, string> = {
  destruction: "Destruction: Devourer roots and Chorus Fruit teleports",
  effects: "Effects recalculated",
  growth: "Growth: plants advance a stage",
  soggybud: "Soggybud draws water",
  water: "Water loss",
  spawn: "Spawn roll",
  decay: "Decay timers",
};

const SESSION_PHASE: Record<string, string> = {
  session: "Player arrives",
  water: "Water",
  gates: "Wake, vacuum, discharge, feed",
  roots: "Break Devourer roots",
  harvest: "Harvest spawns",
  baseCrops: "Harvest and replant base crops",
  stepChange: "Check exits / change step",
  harvestAfterStepChange: "Harvest after the step change",
  maintain: "Re-place the layout",
  placedUpkeep: "Replace placed items before they decay",
  clearTargets: "Clear target cells",
  fixGround: "Fix target ground",
  waterNew: "Water what was just placed",
};

const at = (s: StopPoint) => (s.row !== undefined && s.col !== undefined ? ` at (${s.row},${s.col})` : "");
const what = (s: StopPoint) => (s.kindId ? nameOf(s.kindId) : "");

/** One action as a short sentence: "Harvested Chloronite at (5,5)". */
function actionText(s: StopPoint): string {
  const k = what(s);
  switch (s.id) {
    case "harvest":
      return `Harvested ${k}${at(s)}`;
    case "break":
      return `Broke ${k}${at(s)}${s.detail ? ` (${s.detail})` : ""}`;
    case "destroy":
      return `Destroyed ${k}${at(s)}`;
    case "clearDead":
      return `Cleared a Dead Plant${at(s)}`;
    case "pickUp":
      return `Picked ${k} back up${at(s)}`;
    case "place":
      return `Placed ${k}${at(s)}`;
    case "plant":
      return `Planted ${k}${at(s)}`;
    case "replant":
      return `Harvested and replanted ${k}${at(s)}`;
    case "replace":
      return `Swapped ${k}${at(s)} for a fresh one before it decays`;
    case "water":
      return s.kindId ? `Watered ${k}${at(s)}` : "Watered the plot";
    case "wake":
      return `Woke ${k}${at(s)}`;
    case "vacuum":
      return `Vacuumed the rat on ${k}${at(s)}`;
    case "discharge":
      return `Discharged ${k}${at(s)}`;
    case "feed":
      return `Fed ${k}${at(s)}`;
    case "noctilume":
      return "Changed the time for Noctilume";
    case "clearRoot":
      return `Broke a Devourer root${at(s)}`;
    case "fixGround":
      return `Fixed the ground${at(s)}${s.detail ? ` to ${nameOf(s.detail)}` : ""}`;
    case "setGround":
      return `Set the ground${at(s)}${s.detail ? ` to ${nameOf(s.detail)}` : ""}`;
    case "stepChange":
      return `Changed step${s.detail ? ` to ${s.detail}` : ""}`;
    case "setLayout":
      return s.detail ? `Changed the layout ${s.detail}` : "Changed the layout";
    case "sell":
      return "Sold surplus mutation items on the Bazaar";
    default:
      return s.id.startsWith("debug.") ? `Used ${s.id}()${s.kindId ? ` on ${k}` : ""}` : `${s.id}${at(s)}`;
  }
}

/** Where a stop happened: "Plot 2" or "All plots". */
export const stopPlace = (s: StopPoint): string => (s.plotId === null ? "All plots" : `Plot ${s.plotId}`);

/** The stop as a sentence for the status line and the stop bar. */
export function describeStop(s: StopPoint): string {
  switch (s.kind) {
    case "tickPhase":
      return `Game tick: ${TICK_PHASE[s.id] ?? s.id}`;
    case "sessionPhase":
      return `Session: ${SESSION_PHASE[s.id] ?? s.id}`;
    case "playerAction":
      return actionText(s);
    case "scriptAction":
      return `${scriptLabel(s.script ?? "global")} script${s.hook ? ` (${s.hook})` : ""}: ${actionText(s).replace(/^./, (c) => c.toLowerCase())}`;
    case "scriptHook":
      return `${scriptLabel(s.script ?? "global")} script: ${s.id} done`;
  }
}
