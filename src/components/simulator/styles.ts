// Class strings shared by the simulator panels, in the app's slate/emerald style.

export const inputClass =
  "bg-slate-900/60 border border-slate-600/40 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60 min-w-0";

export const buttonClass = {
  primary:
    "px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5",
  neutral:
    "px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700/40 hover:bg-slate-700/70 text-slate-300 border border-slate-600/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5",
  danger:
    "px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5",
  icon: "p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed",
};
