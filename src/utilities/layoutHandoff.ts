/**
 * Passing layouts from the Calculator and Designer to the Simulator without
 * share links. "Simulate" navigates to /simulator with the layout in router
 * state; the Simulator's picker also reads the Designer layout, the last
 * Calculator result and saved layouts from localStorage.
 */

import { encodeDesign, type GroundTile } from "./designEncoding";

type SizedCell = { cropId: string; position: [number, number]; size: number };
type Cell = { cropId: string; position: [number, number] };

export type HandoffSource = "calculator" | "designer" | "saved" | "link";

const SOURCES: readonly HandoffSource[] = ["calculator", "designer", "saved", "link"];

export const SOURCE_LABEL: Record<HandoffSource, string> = {
  calculator: "From the Calculator",
  designer: "From the Designer",
  saved: "Saved layout",
  link: "From a share link",
};

/** A layout sent to the Simulator, as a share code. */
export interface IncomingLayout {
  code: string;
  /** Short human name, used as the step label. */
  name: string;
  from: HandoffSource;
}

/** Router state for `navigate("/simulator", { state })`. */
export interface SimulatorHandoffState {
  incomingLayout: IncomingLayout;
}

export function simulatorHandoffState(incomingLayout: IncomingLayout): SimulatorHandoffState {
  return { incomingLayout };
}

/** Pull a well-formed incoming layout out of an unknown router state. */
export function readIncomingLayout(state: unknown): IncomingLayout | null {
  if (!state || typeof state !== "object") return null;
  const inc = (state as Partial<SimulatorHandoffState>).incomingLayout;
  if (!inc || typeof inc.code !== "string" || !inc.code) return null;
  return {
    code: inc.code,
    name: typeof inc.name === "string" && inc.name ? inc.name : "Layout",
    from: SOURCES.includes(inc.from as HandoffSource) ? (inc.from as HandoffSource) : "link",
  };
}

/** Packages a layout for the Simulator, named after its most common targets or `fallbackName`. */
export function makeIncomingLayout(
  layout: { inputs: Cell[]; targets: Cell[]; groundTiles?: GroundTile[] },
  from: HandoffSource,
  nameOf: (id: string) => string,
  fallbackName: string
): IncomingLayout {
  const strip = (cells: Cell[]) => cells.map((c) => ({ cropId: c.cropId, position: c.position }));
  return {
    code: encodeDesign(strip(layout.inputs), strip(layout.targets), layout.groundTiles ?? []),
    name: summarizeTargets(layout.targets, nameOf) ?? fallbackName,
    from,
  };
}

/** "Chloronite x4, Gloomgourd x2 +1 more", or null when there are no targets. */
export function summarizeTargets(targets: { cropId: string }[], nameOf: (id: string) => string, max = 2): string | null {
  if (!targets.length) return null;
  const counts = new Map<string, number>();
  for (const t of targets) counts.set(t.cropId, (counts.get(t.cropId) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, max).map(([id, n]) => `${nameOf(id)} x${n}`);
  const rest = sorted.length - max;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

const overlaps = (a: { position: [number, number]; size: number }, b: { position: [number, number]; size: number }) => {
  const [ar, ac] = a.position;
  const [br, bc] = b.position;
  return !(ar + a.size <= br || br + b.size <= ar || ac + a.size <= bc || bc + b.size <= ac);
};

/**
 * The Calculator's full layout: locked placements plus solver crops not on a
 * lock as inputs, and solver mutations as targets.
 */
export function solverResultCells(
  result: { placements?: { crop: string; position: [number, number]; size: number }[]; mutations?: { mutation: string; position: [number, number]; size: number }[] } | null,
  locked: { crop: string; position: [number, number]; size: number }[]
): { inputs: SizedCell[]; targets: SizedCell[] } {
  const inputs: SizedCell[] = locked.map((l) => ({ cropId: l.crop, position: l.position, size: l.size }));
  const targets: SizedCell[] = [];
  for (const p of result?.placements ?? []) {
    if (locked.some((l) => overlaps(l, p))) continue;
    inputs.push({ cropId: p.crop, position: p.position, size: p.size });
  }
  for (const m of result?.mutations ?? []) targets.push({ cropId: m.mutation, position: m.position, size: m.size });
  return { inputs, targets };
}

/** The last finished Calculator result, kept so the Simulator can load it later. */
export interface StoredSolverLayout {
  code: string;
  name: string;
  savedAt: number;
}
