/** Non-component helpers shared by the Guide's panels. */
import type { Settings } from "../../simulator/sim/state";
import { HOURS_PER_CYCLE, type PRECISION_SEEDS } from "../../guide";

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

export const buttonClass = {
  primary:
    "guide-press inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40",
  secondary:
    "guide-press inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40",
  ghost: "guide-press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100",
};

export type Precision = keyof typeof PRECISION_SEEDS;
export const PRECISIONS: Precision[] = ["quick", "normal", "thorough"];

/** "every 12 hours" / "2 daily windows". */
export function scheduleText(activity: Settings["activity"]): string {
  if (activity.kind === "everyN") return `every ${activity.n * HOURS_PER_CYCLE} hours`;
  return `${activity.windows.length} daily window${activity.windows.length === 1 ? "" : "s"}`;
}

/** Copy of a record without one key. */
export function without<T>(record: Record<number, T>, key: number): Record<number, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
