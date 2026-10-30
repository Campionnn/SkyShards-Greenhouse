// Surface classes of the redesigned simulator UI (see kit.tsx and docs/simulator/UI-CONVENTIONS.md):
// panel = docked side panels, card = a block inside a panel, well = inputs and recessed areas,
// raised = anything floating (menus, popovers, canvas nodes).
export const surface = {
  panel: "bg-slate-900 border-slate-700/60",
  card: "rounded-xl bg-slate-800/40 border border-slate-700/50",
  well: "rounded-lg bg-slate-950/50 border border-slate-700/60",
  raised: "rounded-xl bg-slate-900/95 border border-slate-600/40 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.9)] backdrop-blur-md",
} as const;
