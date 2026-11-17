// Flows saved in this browser (localStorage), like the Designer's saved layouts. Each entry is a full
// flows file (exportFlows with every optional section), so loading one restores plots, flows,
// scripts, settings, player stats, schedule and starting inventory, and goes through importFlows'
// validation and migrateScenario like an imported file.
import type { Scenario } from "../../simulator";
import { exportFlows, importFlows, type FlowsFile } from "./scenarioEdit";

export const SAVED_FLOWS_KEY = "skyshards-simulator-saved-flows";
export const MAX_FLOW_NAME = 50;

export interface SavedFlow {
  id: string;
  name: string;
  savedAt: number;
  modifiedAt: number;
  file: FlowsFile;
}

const ALL_SECTIONS = { startingInventory: true, playerSettings: true, onlineSchedule: true, actionDefaults: true, advancedSettings: true, seed: true };

const isSaved = (v: unknown): v is SavedFlow => {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.id === "string" && typeof s.name === "string" && typeof s.savedAt === "number" && typeof s.modifiedAt === "number" && !!s.file && typeof s.file === "object";
};

/** Saved flows; malformed entries are skipped, and a missing or broken store reads as empty. */
export function loadSavedFlows(): SavedFlow[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SAVED_FLOWS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
  } catch {
    return [];
  }
}

/** Writes the list; false when the browser refuses (storage full or unavailable). */
export function writeSavedFlows(list: SavedFlow[]): boolean {
  try {
    localStorage.setItem(SAVED_FLOWS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const newId = () => `flows_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Saves the scenario under `name`; an existing entry with the same name is overwritten (keeping its
 * id and savedAt). Returns the new list, or null when the browser refused the write.
 */
export function saveFlow(list: SavedFlow[], scenario: Scenario, name: string, now = Date.now()): SavedFlow[] | null {
  const file = exportFlows(scenario, ALL_SECTIONS);
  const existing = list.find((s) => s.name === name);
  const next = existing
    ? list.map((s) => (s === existing ? { ...s, file, modifiedAt: now } : s))
    : [...list, { id: newId(), name, savedAt: now, modifiedAt: now, file }];
  return writeSavedFlows(next) ? next : null;
}

/** The scenario a saved entry restores onto the current one (throws a readable message if unusable). */
export function scenarioFromSaved(current: Scenario, saved: SavedFlow): Scenario {
  return importFlows(current, JSON.stringify(saved.file));
}

/** "2 plots · 5 steps", for the list. */
export function savedFlowSummary(saved: SavedFlow): string {
  const plots = Array.isArray(saved.file.plots) ? saved.file.plots : [];
  const steps = plots.reduce((n, p) => n + (p?.flow?.steps?.length ?? 0), 0);
  const scripted = plots.some((p) => p?.script?.source?.trim()) || !!saved.file.script?.source?.trim();
  return `${plots.length} plot${plots.length === 1 ? "" : "s"} · ${steps} step${steps === 1 ? "" : "s"}${scripted ? " · scripted" : ""}`;
}

/** A suggested name for a new save: "Flows 3" (the first free number). */
export function suggestFlowName(list: SavedFlow[]): string {
  const names = new Set(list.map((s) => s.name));
  let i = list.length + 1;
  while (names.has(`Flows ${i}`)) i++;
  return `Flows ${i}`;
}
