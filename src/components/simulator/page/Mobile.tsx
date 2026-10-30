import React from "react";
import { ChevronLeft, ChevronRight, Clock, Play, RotateCcw, SlidersHorizontal, Square, Trophy, UserRound } from "lucide-react";
import type { SimulationView } from "../../../hooks/useSimulation";
import { cycleSeconds, effectiveUniqueCrops, type Scenario } from "../../../simulator";
import { formatDuration } from "../format";
import type { DrawerTab } from "./SettingsDrawer";

// Phones: the frequent settings as a scrolling chip row that opens the drawer at the right tab, and
// the run controls in a bottom bar where the thumb is. Hidden from md up.

const Chip: React.FC<{ icon: React.ReactNode; onClick: () => void; children: React.ReactNode }> = ({ icon, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-400/[0.07] px-2.5 text-[12.5px] font-semibold text-slate-100 transition-colors duration-150 active:bg-slate-400/15 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-slate-500"
  >
    {icon}
    {children}
  </button>
);

export const MobileChips: React.FC<{ scenario: Scenario; onOpenSettings: (tab: DrawerTab) => void }> = ({ scenario, onOpenSettings }) => {
  const s = scenario.settings;
  const a = s.activity;
  const online = s.playerActions === false ? "actions off" : a.kind === "everyN" ? (a.n === 1 ? "every cycle" : `every ${a.n} cycles`) : "times of day";
  const cycle = cycleSeconds(s.playerStats, effectiveUniqueCrops(0, s.playerStats.floraShard ?? 0));
  return (
    <div className="-mx-2 flex gap-1.5 overflow-x-auto px-2 pb-1 scrollbar-none md:hidden">
      <Chip icon={<Clock />} onClick={() => onOpenSettings("schedule")}>
        {online}
      </Chip>
      <Chip icon={<UserRound />} onClick={() => onOpenSettings("player")}>
        {formatDuration(cycle)}
      </Chip>
      <Chip icon={<Trophy />} onClick={() => onOpenSettings("advanced")}>
        Rules
      </Chip>
      <Chip icon={<SlidersHorizontal />} onClick={() => onOpenSettings("player")}>
        Settings
      </Chip>
    </div>
  );
};

export const MobileRunBar: React.FC<{
  view: SimulationView;
  onRun: (n: number) => void;
  onStep: () => void;
  onStepBack: () => void;
  onStop: () => void;
  onReset: () => void;
}> = ({ view, onRun, onStep, onStepBack, onStop, onReset }) => {
  const running = view.status === "running";
  const ready = view.status === "ready";
  const btn =
    "inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 text-[13px] font-medium transition-[background-color,transform] duration-150 ease-snappy active:scale-[0.97] disabled:opacity-40";
  return (
    // Docks on top of Mediavine's adhesion ad (`--ad-bottom`, useBottomAdInset) instead of under
    // it; the ad already covers the home-indicator area, so the safe-area padding shrinks by it.
    <div
      className="fixed inset-x-0 z-40 flex gap-2 border-t border-slate-700/50 bg-[#0b1120]/95 px-3 pt-2.5 backdrop-blur-xl md:hidden"
      style={{ bottom: "var(--ad-bottom, 0px)", paddingBottom: "max(10px, calc(10px + env(safe-area-inset-bottom, 0px) - var(--ad-bottom, 0px)))" }}
    >
      <button type="button" aria-label="Reset to cycle 0" onClick={onReset} disabled={running} className={`${btn} w-11 rounded-xl border border-slate-600/40 bg-slate-800/60 text-slate-300`}>
        <RotateCcw className="h-4 w-4" />
      </button>
      <div className="flex flex-[1.2] overflow-hidden rounded-xl border border-slate-600/40 bg-slate-800/60">
        <button type="button" onClick={onStepBack} disabled={!ready || !view.history.canStepBack} className={`${btn} flex-1 text-slate-200`}>
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <button type="button" onClick={onStep} disabled={!ready} className={`${btn} flex-1 border-l border-slate-600/40 text-slate-200`}>
          Step <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {running ? (
        <button type="button" onClick={onStop} className={`${btn} flex-1 rounded-xl bg-red-500/15 font-semibold text-red-300 ring-1 ring-inset ring-red-500/35`}>
          <Square className="h-3.5 w-3.5" /> Stop
        </button>
      ) : (
        <button type="button" onClick={() => onRun(200)} disabled={!ready} className={`${btn} flex-1 rounded-xl bg-emerald-500 font-semibold text-emerald-950`}>
          <Play className="h-3.5 w-3.5 fill-current" /> Run 200
        </button>
      )}
    </div>
  );
};
