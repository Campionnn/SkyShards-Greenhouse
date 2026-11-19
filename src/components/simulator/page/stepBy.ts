import { useCallback, useState } from "react";
import { GAME_TICK_PHASE_IDS, SESSION_PHASE_IDS, STOP_KINDS, type StopKind, type StopPoint } from "../../../simulator";
import type { StopFilter } from "../../../simulator/worker/stopFilter";
import { nameOf } from "../format";
import { scriptLabel } from "../script/scriptEdit";

// "Step by": whether Step / Back move a whole cycle or one stop point inside it (a phase, an
// action, a script hook; sim/stops.ts), and which stops (a StopFilter: kinds, then single phases,
// actions or hooks switched off, then plots). Remembered in this browser.

export interface StepBy {
  /** Step / Back go stop by stop inside the cycle. */
  detail: boolean;
  filter: StopFilter;
}

const KEY = "skyshards-simulator-step-by";
export const DEFAULT_FILTER: StopFilter = { kinds: ["sessionPhase", "playerAction", "scriptAction"] };
export const DEFAULT_STEP_BY: StepBy = { detail: false, filter: DEFAULT_FILTER };

/** Detail stepping that can actually stop somewhere. */
export const stepsInside = (s: StepBy): boolean => s.detail && s.filter.kinds.length > 0;

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A saved value made safe (unknown kinds dropped); older saves kept `kinds` at the top level. */
export function cleanStepBy(raw: unknown): StepBy {
  if (!raw || typeof raw !== "object") return DEFAULT_STEP_BY;
  const v = raw as { detail?: unknown; kinds?: unknown; filter?: Partial<StopFilter> };
  const f = v.filter && typeof v.filter === "object" ? v.filter : { kinds: v.kinds as StopKind[] | undefined };
  const kinds = Array.isArray(f.kinds) ? STOP_KINDS.filter((k) => f.kinds!.includes(k)) : DEFAULT_FILTER.kinds;
  const filter: StopFilter = { kinds };
  const off: NonNullable<StopFilter["off"]> = {};
  for (const k of STOP_KINDS) {
    const ids = asStrings(f.off?.[k]);
    if (ids.length) off[k] = ids;
  }
  if (Object.keys(off).length) filter.off = off;
  const plots = Array.isArray(f.plots) ? f.plots.filter((n): n is number => Number.isInteger(n)) : [];
  if (plots.length) filter.plots = plots;
  if (f.skipIdle === true) filter.skipIdle = true;
  return { detail: v.detail === true, filter };
}

export function useStepBy(): [StepBy, (next: StepBy) => void] {
  const [value, setValue] = useState<StepBy>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
      return raw ? cleanStepBy(JSON.parse(raw)) : DEFAULT_STEP_BY;
    } catch {
      return DEFAULT_STEP_BY;
    }
  });
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

// ---- What can be picked: categories and their sub-items, in the engine's order ----

export interface StopItem {
  id: string;
  label: string;
  /** Hover text. */
  title?: string;
}

export interface StopGroup {
  /** Group heading (actions and hooks); phases have one unnamed group. */
  label?: string;
  items: StopItem[];
}

export interface StopCategory {
  kind: StopKind;
  label: string;
  /** One line under the label. */
  hint: string;
  /** Phases are numbered: Step goes through them in this order. */
  ordered?: boolean;
  groups: StopGroup[];
}

const TICK_PHASE_LABEL: Record<string, string> = {
  destruction: "Destruction",
  effects: "Effects",
  growth: "Growth",
  soggybud: "Soggybud",
  water: "Water loss",
  spawn: "Spawn roll",
  decay: "Decay",
};

const SESSION_PHASE_LABEL: Record<string, string> = {
  session: "Arrive",
  water: "Water",
  gates: "Wake, vacuum, feed",
  roots: "Break roots",
  harvest: "Harvest",
  baseCrops: "Base crops",
  stepChange: "Step change",
  harvestAfterStepChange: "Harvest after step change",
  maintain: "Re-place layout",
  placedUpkeep: "Replace before decay",
  clearTargets: "Clear targets",
  fixGround: "Fix ground",
  waterNew: "Water new plants",
};

/** Action ids by group. `only` limits an id to player or script actions. */
const ACTION_GROUPS: { label: string; items: (StopItem & { only?: "playerAction" | "scriptAction" })[] }[] = [
  {
    label: "Harvest",
    items: [
      { id: "harvest", label: "Harvest", title: "A spawn or crop harvested (its Blastberry blast and re-mutation included)" },
      { id: "replant", label: "Replant", title: "A base crop harvested and replanted in one go" },
    ],
  },
  {
    label: "Break and clear",
    items: [
      { id: "break", label: "Break", title: "A plant broken without drops (blocking a target or the layout, a step change)" },
      { id: "destroy", label: "Destroy", title: "plant.destroy()", only: "scriptAction" },
      { id: "clearDead", label: "Clear Dead Plant" },
      { id: "pickUp", label: "Pick up", title: "An item placed this session picked back up (item returned)" },
      { id: "clearRoot", label: "Break root", title: "A Devourer root broken" },
    ],
  },
  {
    label: "Place",
    items: [
      { id: "place", label: "Place item", title: "A mutation item, fire or Fermento placed" },
      { id: "plant", label: "Plant crop", title: "A base crop planted from the layout" },
      { id: "replace", label: "Swap before decay", title: "A placed item swapped for a fresh one before it decays" },
    ],
  },
  {
    label: "Water and tend",
    items: [
      { id: "water", label: "Water" },
      { id: "wake", label: "Wake Snoozling" },
      { id: "vacuum", label: "Vacuum rat" },
      { id: "discharge", label: "Discharge Thunderling" },
      { id: "feed", label: "Feed Fleshtrap" },
      { id: "noctilume", label: "Noctilume time" },
    ],
  },
  {
    label: "Ground and layout",
    items: [
      { id: "fixGround", label: "Fix ground" },
      { id: "setGround", label: "Set ground", title: "plot.setGround()", only: "scriptAction" },
      { id: "setLayout", label: "Set layout", title: "plot.setLayout() / resetLayout()", only: "scriptAction" },
    ],
  },
  {
    label: "Flow and market",
    items: [
      { id: "stepChange", label: "Step change", title: "Moved to another step (after its rebuild)" },
      { id: "sell", label: "Sell surplus", title: "Normal profile: surplus mutation items sold on the Bazaar", only: "playerAction" },
      { id: "debug.*", label: "Debug tools", title: "debug.spawn, debug.setStage, debug.give…", only: "scriptAction" },
    ],
  },
];

const HOOK_GROUPS: StopGroup[] = [
  {
    label: "Every cycle",
    items: [
      { id: "onTick", label: "onTick" },
      { id: "onSession", label: "onSession" },
      { id: "afterSession", label: "afterSession" },
      { id: "onCycleEnd", label: "onCycleEnd" },
    ],
  },
  {
    label: "Events",
    items: ["onSpawn", "onFullyGrown", "onHarvest", "onDecay", "onDestroy", "onPlace", "onDryOut", "onStepChange", "onEvent"].map((id) => ({ id, label: id })),
  },
  { label: "Messages", items: [{ id: "onMessage", label: "onMessage" }] },
];

const actionGroups = (kind: "playerAction" | "scriptAction"): StopGroup[] =>
  ACTION_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => !i.only || i.only === kind).map(({ id, label, title }) => ({ id, label, title })) })).filter((g) => g.items.length);

export const STOP_CATEGORIES: StopCategory[] = [
  {
    kind: "tickPhase",
    label: "Game tick",
    hint: "Every cycle, plot by plot, before the player",
    ordered: true,
    groups: [{ items: GAME_TICK_PHASE_IDS.map(({ id, summary }) => ({ id, label: TICK_PHASE_LABEL[id] ?? id, title: summary })) }],
  },
  {
    kind: "sessionPhase",
    label: "Player session",
    hint: "Online cycles, plot by plot, after every game tick",
    ordered: true,
    groups: [{ items: SESSION_PHASE_IDS.map(({ id, summary }) => ({ id, label: SESSION_PHASE_LABEL[id] ?? id, title: summary })) }],
  },
  { kind: "playerAction", label: "Player actions", hint: "Each single thing the built-in phases do", groups: actionGroups("playerAction") },
  { kind: "scriptAction", label: "Script actions", hint: "Each single thing a script does", groups: actionGroups("scriptAction") },
  { kind: "scriptHook", label: "Script hooks", hint: "Each hook call, once it has finished", groups: HOOK_GROUPS },
];

export const categoryOf = (kind: StopKind): StopCategory => STOP_CATEGORIES.find((c) => c.kind === kind)!;
export const itemIds = (c: StopCategory): string[] => c.groups.flatMap((g) => g.items.map((i) => i.id));

/** How many of a category's items Step stops at (0 when the category is off). */
export function onCount(f: StopFilter, c: StopCategory): number {
  if (!f.kinds.includes(c.kind)) return 0;
  const off = f.off?.[c.kind] ?? [];
  return itemIds(c).filter((id) => !off.includes(id)).length;
}

/** A filter with one category switched on or off (switching on with nothing picked picks everything). */
export function withCategory(f: StopFilter, kind: StopKind, on: boolean): StopFilter {
  const kinds = STOP_KINDS.filter((k) => (k === kind ? on : f.kinds.includes(k)));
  const next: StopFilter = { ...f, kinds };
  if (on && onCount({ ...f, kinds }, categoryOf(kind)) === 0) next.off = withoutKey(f.off, kind);
  return next;
}

/** A filter with one item of a category switched on or off. Turning off the last item turns the category off. */
export function withItem(f: StopFilter, kind: StopKind, id: string, on: boolean): StopFilter {
  const c = categoryOf(kind);
  const wasOn = f.kinds.includes(kind);
  const current = wasOn ? (f.off?.[kind] ?? []) : itemIds(c);
  const offList = on ? current.filter((x) => x !== id) : [...new Set([...current, id])];
  if (offList.length >= itemIds(c).length) return { ...withCategory(f, kind, false), off: withoutKey(f.off, kind) };
  const kinds = STOP_KINDS.filter((k) => k === kind || f.kinds.includes(k));
  const off = { ...withoutKey(f.off, kind), ...(offList.length ? { [kind]: offList } : {}) };
  return { ...f, kinds, off: Object.keys(off).length ? off : undefined };
}

function withoutKey(off: StopFilter["off"], kind: StopKind): StopFilter["off"] {
  if (!off?.[kind]) return off;
  const { [kind]: _drop, ...rest } = off;
  void _drop;
  return Object.keys(rest).length ? rest : undefined;
}

/** Quick picks. */
export const STOP_PRESETS: { label: string; title: string; filter: StopFilter }[] = [
  { label: "Every phase", title: "Each game tick and session phase, in order", filter: { kinds: ["tickPhase", "sessionPhase"] } },
  { label: "Every action", title: "Each single player and script action", filter: { kinds: ["playerAction", "scriptAction"] } },
  { label: "Scripts", title: "Script actions and hooks only", filter: { kinds: ["scriptAction", "scriptHook"] } },
  { label: "Everything", title: "Every phase, action and hook", filter: { kinds: [...STOP_KINDS] } },
];

/** "Session phases, player actions (8 of 18) · Plot 1" for the Run menu and the stop bar. */
export function filterSummary(f: StopFilter): string {
  if (!f.kinds.length) return "Nothing picked";
  const parts = STOP_CATEGORIES.filter((c) => f.kinds.includes(c.kind)).map((c) => {
    const n = onCount(f, c);
    const all = itemIds(c).length;
    return n >= all ? c.label : `${c.label} (${n} of ${all})`;
  });
  const plots = f.plots?.length ? ` · Plot ${f.plots.join(", ")}` : "";
  return `${parts.join(", ")}${plots}${f.skipIdle ? " · skipping idle phases" : ""}`;
}

// ---- Describing a stop ----

const TICK_PHASE_TEXT: Record<string, string> = {
  destruction: "Destruction: Devourer roots and Chorus Fruit teleports",
  effects: "Effects recalculated",
  growth: "Growth: plants advance a stage",
  soggybud: "Soggybud draws water",
  water: "Water loss",
  spawn: "Spawn roll",
  decay: "Decay timers",
};

const SESSION_PHASE_TEXT: Record<string, string> = {
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
      return `Game tick: ${TICK_PHASE_TEXT[s.id] ?? s.id}`;
    case "sessionPhase":
      return `Session: ${SESSION_PHASE_TEXT[s.id] ?? s.id}`;
    case "playerAction":
      return actionText(s);
    case "scriptAction":
      return `${scriptLabel(s.script ?? "global")} script${s.hook ? ` (${s.hook})` : ""}: ${actionText(s).replace(/^./, (c) => c.toLowerCase())}`;
    case "scriptHook":
      return `${scriptLabel(s.script ?? "global")} script: ${s.id} done`;
  }
}
