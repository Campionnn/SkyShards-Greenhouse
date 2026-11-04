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

const base = "inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The app's button styles: solid emerald for the one main action (as the Designer's Load / Save),
 * slate for the alternative, and the Simulator's small toolbar and text buttons.
 */
export const buttonClass = {
  primary: `${base} min-h-9 rounded-lg px-3 py-2 text-sm font-medium text-white bg-emerald-500/80 hover:bg-emerald-500`,
  secondary: `${base} min-h-9 rounded-lg border border-slate-600/50 bg-slate-700/60 px-3 py-2 text-sm text-slate-300 hover:bg-slate-600/60 hover:text-slate-100`,
  neutral: `${base} rounded-md border border-slate-600/30 bg-slate-700/40 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700/70`,
  ghost: `${base} min-h-8 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-700/60 hover:text-slate-200`,
};

/** The app's text input (Simulator `inputClass`). */
export const inputClass =
  "rounded-md border border-slate-600/40 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none min-w-0";

export type Precision = keyof typeof PRECISION_SEEDS;
export const PRECISIONS: Precision[] = ["quick", "normal", "thorough"];

/** "every 12 hours" / "2 daily windows". */
export function scheduleText(checkEvery: number | null, activity: Settings["activity"]): string {
  if (checkEvery !== null) return `every ${Number.isInteger(checkEvery) ? checkEvery : checkEvery.toFixed(1)} hour${checkEvery === 1 ? "" : "s"}`;
  const n = activity.kind === "windows" ? activity.windows.length : 0;
  return `${n} daily window${n === 1 ? "" : "s"}`;
}
