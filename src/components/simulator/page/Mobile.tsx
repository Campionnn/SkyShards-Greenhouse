import React, { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Clock, Play, RotateCcw, Share2, SlidersHorizontal, Square, Trophy, Undo2, UserRound } from "lucide-react";
import type { SimulationView } from "../../../hooks/useSimulation";
import { ruleDifferences } from "../../../leaderboard/rules";
import { profileRuleKind } from "../../../leaderboard/view";
import { cycleSeconds, effectiveUniqueCrops, type ProfileMode, type Scenario } from "../../../simulator";
import { cn } from "../../ui/cn";
import { Segmented } from "../../ui/kit";
import { MenuItem, MenuSeparator, Popover } from "../../ui/Popover";
import { formatDuration } from "../format";
import { ProblemList, RunOptions, type PageProblem } from "./CommandBar";
import { undoTitle } from "./pageHelpers";
import type { DrawerTab } from "./SettingsDrawer";

// Phones: the desktop command bar as two rows that always fit the width (problems, the profile
// switch and Share; then the frequent settings as tiles), and the run controls in a bottom bar where
// the thumb is. Everything the bar offers is reachable here, and nothing scrolls sideways out of
// view. Hidden from md up.

/** A settings tile: a small label over the current value (the desktop bar's property chips). */
const Tile: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: "go"; children: string }> = ({ icon, label, onClick, disabled, tone, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={`${label}: ${children}`}
    className="focus-ring flex h-12 min-w-0 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-control border border-line-strong bg-surface-control px-2.5 text-left transition-colors duration-(--duration-hover) active:bg-surface-hover disabled:cursor-default disabled:opacity-50"
  >
    <span className="flex max-w-full items-center gap-1 text-meta text-fg-meta [&>svg]:size-3 [&>svg]:shrink-0">
      {icon}
      <span className="truncate">{label}</span>
    </span>
    <span className={cn("max-w-full truncate text-body font-semibold tabular-nums", tone === "go" ? "text-go-fg" : "text-fg")}>{children}</span>
  </button>
);

const Chip = React.forwardRef<HTMLButtonElement, { icon: React.ReactNode; onClick: () => void; children: React.ReactNode; open?: boolean; className?: string; label?: string }>(
  ({ icon, onClick, children, open, className, label }, ref) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "focus-ring inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-control bg-surface-control px-2.5 text-body font-semibold text-fg transition-colors duration-(--duration-hover) active:bg-surface-hover [&>svg]:size-3.5 [&>svg]:text-fg-meta",
        open && "bg-select/10 [&>svg]:text-select-fg",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  ),
);
Chip.displayName = "Chip";

export const MobileChips: React.FC<{
  scenario: Scenario;
  profile: ProfileMode;
  onProfileChange: (p: ProfileMode) => void;
  /** Open the drawer; without a tab it keeps the last one. */
  onOpenSettings: (tab?: DrawerTab) => void;
  onOpenLeaderboard?: () => void;
  changedSettings: number;
  problems: PageProblem[];
  /** Export / Import / Submit / Start over (the bar's Share menu). */
  shareMenu: (close: () => void) => React.ReactNode;
  /** A from-nothing preview: settings are read-only. */
  preview?: boolean;
}> = ({ scenario, profile, onProfileChange, onOpenSettings, onOpenLeaderboard, changedSettings, problems, shareMenu, preview }) => {
  const [pop, setPop] = useState<null | "problems" | "share">(null);
  const problemsRef = useRef<HTMLButtonElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const close = () => setPop(null);
  const s = scenario.settings;
  const a = s.activity;
  const online = s.playerActions === false ? "actions off" : a.kind === "everyN" ? (a.n === 1 ? "every cycle" : `every ${a.n}`) : "times of day";
  const cycle = cycleSeconds(s.playerStats, effectiveUniqueCrops(0, s.playerStats.floraShard ?? 0));
  const errors = problems.filter((p) => p.level !== "warning").length;
  // Leaderboard rules for the board the profile is on (the desktop Rules chip's "rules on ✓ / off").
  const kind = profileRuleKind(profile);
  const withProfile: Scenario = { ...scenario, settings: { ...s } };
  if (kind === "normal") withProfile.settings.profile = "normal";
  else delete withProfile.settings.profile;
  const rulesOn = ruleDifferences(withProfile, kind).length === 0;
  const tiles = onOpenLeaderboard ? 4 : 3;
  return (
    // Two rows that always fit the screen: nothing scrolls sideways, so nothing hides past the edge.
    <div className="space-y-1.5 md:hidden">
      <div className="flex items-center gap-1.5">
        {/* Problems first: they are what needs attention. */}
        {problems.length > 0 && (
          <Chip
            ref={problemsRef}
            icon={<AlertTriangle />}
            open={pop === "problems"}
            onClick={() => setPop((p) => (p === "problems" ? null : "problems"))}
            label={`${problems.length} ${problems.length === 1 ? "problem" : "problems"}`}
            className={cn("h-11 ring-1 ring-inset", errors ? "bg-problem/10 text-problem ring-problem/30 [&>svg]:text-problem" : "bg-warn/10 text-warn ring-warn/25 [&>svg]:text-warn")}
          >
            {problems.length}
          </Chip>
        )}
        {/* The profile switch (the desktop bar's Ironman / Normal), taking the rest of the row. */}
        <Segmented<ProfileMode>
          label="Profile"
          value={profile}
          onChange={onProfileChange}
          className="h-11 min-w-0 flex-1 [&>button]:flex-1 [&>button]:text-body"
          options={[
            { value: "ironman", label: "Ironman", title: "No Bazaar: every item comes from your own harvests" },
            { value: "normal", label: "Normal", title: "Buys what a layout is short of and sells surplus on the Bazaar" },
          ]}
        />
        <Chip
          ref={shareRef}
          icon={<Share2 />}
          open={pop === "share"}
          onClick={() => setPop((p) => (p === "share" ? null : "share"))}
          className={cn("h-11 border", pop === "share" ? "border-select/60" : "border-line-strong")}
        >
          Share
        </Chip>
      </div>
      {/* The settings as equal tiles: 2 × 2 on phones (4 across cut the values off), one row on wider
          screens. A from-nothing preview has its own set-up, so Online and Player are read-only
          there, like the desktop chips. */}
      <div className={cn("grid gap-1.5", tiles === 4 ? "grid-cols-2 min-[540px]:grid-cols-4" : "grid-cols-3")}>
        <Tile icon={<Clock />} label="Online" onClick={() => onOpenSettings("schedule")} disabled={preview}>
          {online}
        </Tile>
        <Tile icon={<UserRound />} label="Player" onClick={() => onOpenSettings("player")} disabled={preview}>
          {formatDuration(cycle)}
        </Tile>
        <Tile icon={<SlidersHorizontal />} label="Settings" onClick={() => onOpenSettings()}>
          {changedSettings > 0 ? `${changedSettings} changed` : "defaults"}
        </Tile>
        {onOpenLeaderboard && (
          <Tile icon={<Trophy />} label="Leaderboard" onClick={onOpenLeaderboard} tone={rulesOn ? "go" : undefined}>
            {rulesOn ? "rules on ✓" : "rules off"}
          </Tile>
        )}
      </div>

      <Popover anchor={problemsRef.current} open={pop === "problems"} onClose={close} label="Problems" width={360}>
        <ProblemList problems={problems} close={close} />
      </Popover>
      <Popover anchor={shareRef.current} open={pop === "share"} onClose={close} label="Share" role="menu" width={260} align="end">
        {shareMenu(close)}
      </Popover>
    </div>
  );
};

/** A run length short enough for the phone's Run button: 2000, 50k, 100k. */
const shortCount = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

export const MobileRunBar: React.FC<{
  view: SimulationView;
  onRun: (n: number) => void;
  onStep: () => void;
  onStepBack: () => void;
  onUndo: () => void;
  onStop: () => void;
  onReset: () => void;
  seed: number;
  onSeedChange: (seed: number) => void;
}> = ({ view, onRun, onStep, onStepBack, onUndo, onStop, onReset, seed, onSeedChange }) => {
  const running = view.status === "running";
  const ready = view.status === "ready";
  const [n, setN] = useState(200);
  const [menu, setMenu] = useState(false);
  const runRef = useRef<HTMLDivElement>(null);
  const btn =
    "focus-ring inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 text-body font-medium transition-[background-color,scale] duration-(--duration-hover) ease-snappy active:scale-97 disabled:opacity-40";
  const close = () => setMenu(false);
  const canUndo = ready && !!view.history.lastAction;
  return (
    // Docks on top of Mediavine's adhesion ad (`--ad-bottom`, useBottomAdInset) instead of under
    // it; the ad already covers the home-indicator area, so the safe-area padding shrinks by it.
    // Reset | Undo | ‹ › | Run N ▾ — the ▾ (run length, seed) sits on Run like the desktop's.
    <div
      className="fixed inset-x-0 z-(--z-bar) flex gap-2 border-t border-line bg-surface-page/95 px-3 pt-2.5 backdrop-blur-xl md:hidden"
      style={{ bottom: "var(--ad-bottom, 0px)", paddingBottom: "max(10px, calc(10px + env(safe-area-inset-bottom, 0px) - var(--ad-bottom, 0px)))" }}
    >
      <button type="button" aria-label="Reset to cycle 0" title="Reset to cycle 0" onClick={onReset} disabled={running || view.status === "loading"} className={`${btn} w-11 shrink-0 rounded-container border border-line-strong bg-surface-control text-fg-body`}>
        <RotateCcw className="size-4" />
      </button>
      {/* The narrowest phones keep Undo in the Run ▾ menu only. */}
      <button type="button" aria-label="Undo" title={undoTitle(view.history.lastAction)} onClick={onUndo} disabled={!canUndo} className={`${btn} w-11 shrink-0 rounded-container border border-line-strong bg-surface-control text-fg-body max-[359px]:hidden`}>
        <Undo2 className="size-4" />
      </button>
      <div className="flex shrink-0 rounded-container border border-line-strong bg-surface-control">
        <button type="button" onClick={onStepBack} disabled={!ready || !view.history.canStepBack} aria-label="Back one cycle" title="Back one cycle" className={`${btn} w-11 rounded-l-container text-fg-body`}>
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" onClick={onStep} disabled={!ready} aria-label="Step one cycle" title="Step one cycle" className={`${btn} w-11 rounded-r-container border-l border-line-strong text-fg-body`}>
          <ChevronRight className="size-5" />
        </button>
      </div>
      {running ? (
        <button type="button" onClick={onStop} className={`${btn} min-w-0 flex-1 rounded-container bg-problem/15 font-semibold text-problem ring-1 ring-inset ring-problem/35`}>
          <Square className="size-3.5" /> Stop
        </button>
      ) : (
        <div ref={runRef} className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onRun(n)}
            disabled={!ready}
            aria-label={`Run ${n.toLocaleString("en-US")} cycles`}
            className={`${btn} min-w-0 flex-1 whitespace-nowrap rounded-l-container bg-go px-2 font-semibold tabular-nums text-on-go`}
          >
            <Play className="size-3.5 shrink-0 fill-current" /> Run {shortCount(n)}
          </button>
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            aria-label="Run length, seed and undo"
            title="Run length, seed and undo"
            className={cn(`${btn} w-10 shrink-0 rounded-r-container border-l border-on-go/25 text-on-go`, menu ? "bg-go" : "bg-go-strong")}
          >
            <ChevronDown className={cn("size-4 transition-transform duration-(--duration-hover) ease-snappy", menu && "rotate-180")} />
          </button>
        </div>
      )}

      <Popover anchor={runRef.current} open={menu && !running} onClose={close} label="Run options" width={320} align="end">
        <RunOptions n={n} setN={setN} seed={seed} onSeedChange={onSeedChange} running={running} close={close} custom />
        <MenuSeparator />
        <MenuItem icon={<Undo2 />} disabled={!canUndo} onSelect={() => (close(), onUndo())} hint={view.history.lastAction ? undoTitle(view.history.lastAction).replace(/ \(Ctrl Z\)$/, "") : undefined}>
          Undo
        </MenuItem>
      </Popover>
    </div>
  );
};
