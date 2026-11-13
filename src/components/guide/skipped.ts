/**
 * Which plots the player skipped this visit, and what each still needs ("7 Dead Plant").
 *
 * `skipPlot` (guide/checkin.ts) records a skip like a confirmation with no stock change, so the saved
 * state alone can't tell "skipped" from "kept a farm that placed nothing". The card needs to (a
 * skipped plot must not say it was done), so the page remembers skips here, per flow version, and
 * only trusts an entry while that plot still has a confirmation (Undo, Wrong farm?, Start over and
 * Next check-in all drop it).
 */
const key = (variant: string) => `skyshards-guide-skipped${variant === "two" ? "-2plots" : ""}`;

export type SkippedPlots = Record<number, string>;

export function loadSkipped(variant: string): SkippedPlots {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key(variant));
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return {};
    const out: SkippedPlots = {};
    for (const [id, need] of Object.entries(value)) if (Number.isInteger(Number(id)) && typeof need === "string") out[Number(id)] = need;
    return out;
  } catch {
    return {};
  }
}

export function saveSkipped(variant: string, skipped: SkippedPlots): void {
  try {
    if (Object.keys(skipped).length) localStorage.setItem(key(variant), JSON.stringify(skipped));
    else localStorage.removeItem(key(variant));
  } catch {
    // Storage full or blocked: the skip still works, the card just reads as done after a reload.
  }
}

/** Only the skips that still stand: the plot has a confirmation and is acted this visit. */
export function liveSkipped(skipped: SkippedPlots, confirmed: (plotId: number) => boolean): SkippedPlots {
  const out: SkippedPlots = {};
  for (const [id, need] of Object.entries(skipped)) if (confirmed(Number(id))) out[Number(id)] = need;
  return out;
}
