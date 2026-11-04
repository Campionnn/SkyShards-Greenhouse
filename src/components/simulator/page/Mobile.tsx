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
    className="focus-ring inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-control bg-surface-control px-2.5 text-body font-semibold text-fg transition-colors duration-(--duration-hover) active:bg-surface-hover [&>svg]:size-3.5 [&>svg]:text-fg-meta"
  >
    {icon}
    {children}
  </button>
);

export const MobileChips: React.FC<{ scenario: Scenario; onOpenSettings: (tab: DrawerTab) => void; onOpenLeaderboard?: () => void }> = ({ scenario, onOpenSettings, onOpenLeaderboard }) => {
  const s = scenario.settings;
  const a = s.activity;
  const online = s.playerActions === false ? "actions off" : a.kind === "everyN" ? (a.n === 1 ? "every cycle" : `every ${a.n} cycles`) : "times of day";
  const cycle = cycleSeconds(s.playerStats, effectiveUniqueCrops(0, s.playerStats.floraShard ?? 0));
  return (
    // Bleed only as far as the page padding (px-1 on phones), or the row widens the page by 4px.
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none md:hidden">
      <Chip icon={<Clock />} onClick={() => onOpenSettings("schedule")}>
        {online}
      </Chip>
      <Chip icon={<UserRound />} onClick={() => onOpenSettings("player")}>
        {formatDuration(cycle)}
      </Chip>
      <Chip icon={<Trophy />} onClick={() => (onOpenLeaderboard ? onOpenLeaderboard() : onOpenSettings("advanced"))}>
        Leaderboard
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
    "focus-ring inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 text-body font-medium transition-[background-color,scale] duration-(--duration-hover) ease-snappy active:scale-97 disabled:opacity-40";
  return (
    // Docks on top of Mediavine's adhesion ad (`--ad-bottom`, useBottomAdInset) instead of under
    // it; the ad already covers the home-indicator area, so the safe-area padding shrinks by it.
    <div
      className="fixed inset-x-0 z-(--z-bar) flex gap-2 border-t border-line bg-surface-page/95 px-3 pt-2.5 backdrop-blur-xl md:hidden"
      style={{ bottom: "var(--ad-bottom, 0px)", paddingBottom: "max(10px, calc(10px + env(safe-area-inset-bottom, 0px) - var(--ad-bottom, 0px)))" }}
    >
      <button type="button" aria-label="Reset to cycle 0" onClick={onReset} disabled={running} className={`${btn} w-11 rounded-container border border-line-strong bg-surface-control text-fg-body`}>
        <RotateCcw className="size-4" />
      </button>
      <div className="flex flex-[1.2] rounded-container border border-line-strong bg-surface-control">
        <button type="button" onClick={onStepBack} disabled={!ready || !view.history.canStepBack} className={`${btn} flex-1 rounded-l-container text-fg-body`}>
          <ChevronLeft className="size-4" /> Back
        </button>
        <button type="button" onClick={onStep} disabled={!ready} className={`${btn} flex-1 rounded-r-container border-l border-line-strong text-fg-body`}>
          Step <ChevronRight className="size-4" />
        </button>
      </div>
      {running ? (
        <button type="button" onClick={onStop} className={`${btn} flex-1 rounded-container bg-problem/15 font-semibold text-problem ring-1 ring-inset ring-problem/35`}>
          <Square className="size-3.5" /> Stop
        </button>
      ) : (
        <button type="button" onClick={() => onRun(200)} disabled={!ready} className={`${btn} flex-1 rounded-container bg-go font-semibold text-on-go`}>
          <Play className="size-3.5 fill-current" /> Run 200
        </button>
      )}
    </div>
  );
};
