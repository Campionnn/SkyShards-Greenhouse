/** Non-component helpers shared by the Guide's panels. */
import type { Settings } from "../../simulator/sim/state";
import type { PRECISION_SEEDS } from "../../guide";

/** "1d 4h", "3h", "45m". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins && hours < 3 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function timeAgo(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const base =
  "focus-ring inline-flex cursor-pointer items-center justify-center gap-1.5 transition-colors duration-(--duration-hover) disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:size-4";

/**
 * @deprecated Use KitButton (ui/kit). Kept, on the design tokens, so the Guide's dialogs keep
 * compiling until they move to the kit; importing it trips the design guard's legacy-import rule.
 */
export const buttonClass = {
  primary: `${base} min-h-9 rounded-control border border-go bg-go px-3 py-2 text-body font-semibold text-on-go hover:bg-go-hover`,
  secondary: `${base} min-h-9 rounded-control border border-line-strong bg-surface-control px-3 py-2 text-body text-fg-body hover:bg-surface-hover`,
  neutral: `${base} rounded-control border border-line-strong bg-surface-control px-3 py-1.5 text-secondary font-medium text-fg-body hover:bg-surface-hover`,
  ghost: `${base} min-h-8 rounded-control px-2 py-1 text-secondary text-fg-muted hover:bg-surface-hover hover:text-fg`,
};

/** @deprecated Use KitInput (ui/kit). On the design tokens until the Guide's dialogs move to the kit. */
export const inputClass =
  "focus-ring min-w-0 rounded-control border border-line-control bg-surface-well px-2 py-1 text-secondary text-fg placeholder:text-fg-meta";

export type Precision = keyof typeof PRECISION_SEEDS;
export const PRECISIONS: Precision[] = ["quick", "normal", "thorough"];

/** "every 12 hours" / "2 daily windows". */
export function scheduleText(checkEvery: number | null, activity: Settings["activity"]): string {
  if (checkEvery !== null) return `every ${Number.isInteger(checkEvery) ? checkEvery : checkEvery.toFixed(1)} hour${checkEvery === 1 ? "" : "s"}`;
  const n = activity.kind === "windows" ? activity.windows.length : 0;
  return `${n} daily window${n === 1 ? "" : "s"}`;
}

/**
 * The hint beside a plot card's confirm button: do it in the game first, press every plot's button,
 * and what pressing takes off the stock.
 */
export function confirmHintText(visitPlotCount: number, spentWord: string): string {
  return [
    "Do it in the game first, then press.",
    visitPlotCount > 1 ? `Each plot has its own button: press all ${visitPlotCount} to finish this visit.` : "",
    spentWord ? `Pressing takes ${spentWord} off what you own.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The confirm button's full accessible name: "Did it: Plot 2 is on Commons farm", "Done with Plot 1". */
export function confirmLabel(verb: string, plotId: number, farmName: string): { text: string; aria: string } {
  return verb === "stay" || verb === "wait" ? { text: "Done", aria: `Done with Plot ${plotId}` } : { text: "Did it", aria: `Did it: Plot ${plotId} is on ${farmName}` };
}
