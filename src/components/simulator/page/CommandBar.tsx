import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Clock, Dices, Eye, Play, RotateCcw, Share2, SlidersHorizontal, Square, Trophy, Undo2, UserRound } from "lucide-react";
import type { SimulationView } from "../../../hooks/useSimulation";
import { applyRules, ruleDifferences, type RuleKind } from "../../../leaderboard/rules";
import { EVERY, nearestEvery } from "../../../leaderboard/tiers";
import { profileRuleKind, ruleDifferenceLines } from "../../../leaderboard/view";
import { CONFIG_META, cycleSeconds, effectiveUniqueCrops, type ProfileMode, type Scenario } from "../../../simulator";
import { PlayerImportBox } from "../../playerImport/PlayerImportBox";
import { StatInput } from "../../playerStats/StatInput";
import { STAT_FIELDS } from "../../playerStats/statFields";
import { cn } from "../../ui/cn";
import { Kbd, KitButton, KitLabel, Segmented, Switch } from "../../ui/kit";
import { Dropdown, MenuItem, MenuLabel, MenuSeparator, Popover } from "../../ui/Popover";
import { NumberInput } from "../controls";
import { formatDuration } from "../format";
import { modalOpen, ownsKeys, RUN_SHORTCUTS, runShortcutFor } from "../runShortcuts";
import { ScheduleEditor } from "../ScenarioPanels";
import { RUN_PRESETS, undoTitle } from "./pageHelpers";

// The simulator's sticky command bar: the profile switch, the settings people change all the time
// (as property chips with popovers), the problems pill, and the run cluster. The rest of the
// settings live in the drawer. Conventions: docs/design-system/ (patterns.md "Tool page").

const MAX_CYCLES = 100000;

/** A quiet underlined text action inside popovers ("All player stats →"). */
const LINK = "focus-ring cursor-pointer rounded-inner text-secondary font-medium text-fg-body underline decoration-fg-meta underline-offset-[3px] hover:text-fg hover:decoration-fg-muted";

export interface PageProblem {
  level: "error" | "warning" | "unsustainable";
  where: string;
  message: string;
  /** What the jump link does. */
  action?: { label: string; run: () => void };
}

export interface CommandBarProps {
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  view: SimulationView;
  profile: ProfileMode;
  onProfileChange: (p: ProfileMode) => void;
  /** Run / Step / Back / Undo / Stop / Reset, as useSimulation gives them. */
  onRun: (n: number) => void;
  onStep: () => void;
  onStepBack: () => void;
  onUndo: () => void;
  onStop: () => void;
  onReset: () => void;
  /** Seed shown in the Run menu (a from-nothing preview has its own). */
  seed: number;
  onSeedChange: (seed: number) => void;
  /** Settings that differ from the defaults, shown on the Settings chip. */
  changedSettings: number;
  onOpenSettings: (tab?: string) => void;
  problems: PageProblem[];
  /** Export / Import / Submit. */
  shareMenu: (close: () => void) => React.ReactNode;
  onWatchFromNothing?: (every: number) => void;
  watching?: boolean;
  /** Open the Leaderboard tab (rules, local test, submit). */
  onOpenLeaderboard?: () => void;
  /** A from-nothing preview: settings chips are read-only (the preview has its own scenario). */
  preview?: boolean;
}

/** A borderless "label value" chip that opens a popover. */
const PropChip = React.forwardRef<HTMLButtonElement, { icon: React.ReactNode; label: string; keepLabel?: boolean; open: boolean; onClick: () => void; title?: string; children: React.ReactNode; disabled?: boolean; shrinks?: boolean }>(
  ({ icon, label, keepLabel, open, onClick, title, children, disabled, shrinks }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring inline-flex h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-control border px-2 text-body transition-colors duration-(--duration-hover) disabled:cursor-default disabled:opacity-50 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-fg-meta",
        // 860–1100px bar (1366 with the ad rails): the word label says what the icon says, so the icon goes and the label stays.
        "@min-[860px]:@max-[1100px]:[&>svg]:hidden",
        shrinks ? "min-w-[64px] shrink" : "shrink-0",
        // Open: the selection colour (this chip's popover is the thing you are in). Closed: a control surface, so it reads as clickable.
        open ? "border-select/60 bg-select/10 [&>svg]:text-select-fg" : "border-line-strong bg-surface-control hover:bg-surface-hover disabled:hover:bg-surface-control",
      )}
    >
      {icon}
      {/* The label stays down to an ~860px bar (1366 with the ad rails); below that the icon and value carry it. */}
      <span className={cn("shrink-0 text-secondary text-fg-meta", keepLabel ? "@max-[860px]:hidden" : "@max-[860px]:hidden @min-[1100px]:@max-[1330px]:hidden")}>{label}</span>
      <span className={cn("font-semibold text-fg", shrinks && "min-w-0 truncate")}>{children}</span>
    </button>
  )
);
PropChip.displayName = "PropChip";

const Sep: React.FC<{ className?: string }> = ({ className }) => <span aria-hidden className={cn("mx-1 h-[22px] w-px shrink-0 bg-line-strong @max-[1100px]:hidden", className)} />;

function everyLabel(sc: Scenario): string {
  if (sc.settings.playerActions === false) return "never (actions off)";
  const a = sc.settings.activity;
  if (a.kind === "everyN") return a.n === 1 ? "every cycle" : `every ${a.n} cycles`;
  return a.windows.length ? a.windows.map((w) => `${w.from}–${w.to}h`).join(", ") : "never";
}

export const CommandBar: React.FC<CommandBarProps> = (props) => {
  const { scenario, onChange, view, profile, onProfileChange, onRun, onStep, onStepBack, onUndo, onStop, onReset, seed, onSeedChange, changedSettings, onOpenSettings, problems, shareMenu, preview } = props;
  const [pop, setPop] = useState<null | "online" | "player" | "rules" | "problems" | "run" | "share">(null);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  const reg = (k: string) => (el: HTMLElement | null) => void (anchors.current[k] = el);
  const toggle = (k: NonNullable<typeof pop>) => setPop((p) => (p === k ? null : k));
  const close = () => setPop(null);
  const [n, setN] = useState(200);
  const running = view.status === "running";
  const ready = view.status === "ready";
  const { settings } = scenario;
  const setSettings = (patch: Partial<Scenario["settings"]>) => onChange({ ...scenario, settings: { ...settings, ...patch } });
  const setStats = (patch: Partial<Scenario["settings"]["playerStats"]>) => setSettings({ playerStats: { ...settings.playerStats, ...patch } });

  // Keyboard shortcuts (Space / arrows / Esc / Ctrl Z), bound once and fed through a ref.
  const latest = useRef({ view, n, onRun, onStep, onStepBack, onUndo, onStop });
  useEffect(() => {
    latest.current = { view, n, onRun, onStep, onStepBack, onUndo, onStop };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = runShortcutFor(e);
      if (!action || ownsKeys(e.target, action) || modalOpen()) return;
      const { view, n, onRun, onStep, onStepBack, onUndo, onStop } = latest.current;
      const isReady = view.status === "ready";
      const isRunning = view.status === "running";
      if (e.repeat && action !== "step" && action !== "back") {
        e.preventDefault();
        return;
      }
      if (action === "stop" && !isRunning) return;
      e.preventDefault();
      if (action === "step" && isReady) onStep();
      else if (action === "back" && isReady && view.history.canStepBack) onStepBack();
      else if (action === "run" && isReady) onRun(n);
      else if (action === "toggleRun") {
        if (isRunning) onStop();
        else if (isReady) onRun(n);
      }
      else if (action === "stop") onStop();
      else if (action === "undo" && isReady && view.history.lastAction) onUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runN = (count: number) => {
    const c = Math.max(1, Math.min(MAX_CYCLES, Math.floor(count) || 1));
    setN(c);
    onRun(c);
  };

  // Leaderboard rules: the board the site profile is on.
  const kind: RuleKind = profileRuleKind(profile);
  const board = kind === "normal" ? "Normal" : "Ironman";
  const labels = Object.fromEntries(CONFIG_META.map((m) => [m.key, m.label]));
  const withProfile = { ...scenario, settings: { ...settings, ...(kind === "normal" ? { profile: "normal" as const } : {}) } };
  if (kind !== "normal") delete withProfile.settings.profile;
  const differences = ruleDifferenceLines(ruleDifferences(withProfile, kind), labels);
  const rulesOn = differences.length === 0;
  const [rulesEvery, setRulesEvery] = useState<number>(settings.activity.kind === "everyN" ? nearestEvery(settings.activity.n) : 1);
  const applyBoardRules = () => {
    const ruled = applyRules(scenario, kind, rulesEvery, Math.floor(Math.random() * 2 ** 31));
    const next: Scenario = { ...ruled, settings: { ...ruled.settings } };
    if (settings.profile) next.settings.profile = settings.profile;
    else delete next.settings.profile;
    onChange(next);
  };

  const cycle = cycleSeconds(settings.playerStats, effectiveUniqueCrops(0, settings.playerStats.floraShard ?? 0));
  const ff = settings.playerStats.farmingFortune;
  const errors = problems.filter((p) => p.level !== "warning").length;

  return (
    <div className="flex h-[52px] items-center gap-1 px-1 sm:px-2 max-md:hidden">
      {/* Left: shrinks (chip values truncate) so the right-hand cluster can never be pushed past the edge. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      <span className="mr-2 shrink-0 text-body font-semibold text-fg @max-[1100px]:hidden">Simulator</span>
      <Segmented<ProfileMode>
        label="Profile"
        value={profile}
        onChange={onProfileChange}
        options={[
          { value: "ironman", label: "Ironman", title: "No Bazaar: every item comes from your own harvests" },
          { value: "normal", label: "Normal", title: "Buys what a layout is short of and sells surplus on the Bazaar" },
        ]}
      />
      <Sep />

      {/* Frequent settings */}
      <div className="flex min-w-0 shrink items-center gap-1 max-md:hidden">
        <PropChip ref={reg("online")} icon={<Clock />} label="Online" shrinks open={pop === "online"} onClick={() => toggle("online")} disabled={preview} title={`When the player is online: ${everyLabel(scenario)}`}>
          {everyLabel(scenario)}
        </PropChip>
        <PropChip ref={reg("player")} icon={<UserRound />} label="Player" keepLabel open={pop === "player"} onClick={() => toggle("player")} disabled={preview} title="Player stats: cycle length and fortune">
          {formatDuration(cycle)}
          <span className="font-medium text-fg-muted @max-[1500px]:hidden"> · {ff.toLocaleString("en-US")} FF</span>
        </PropChip>
        <PropChip ref={reg("rules")} icon={<Trophy />} label="Rules" open={pop === "rules"} onClick={() => toggle("rules")} disabled={preview} title={`Leaderboard rules (${board} board)`}>
          <span className={rulesOn ? "text-go-fg" : "text-fg-muted"}>{rulesOn ? "rules on ✓" : "off"}</span>
        </PropChip>
      </div>
      <Sep className="max-md:hidden" />
      <button
        type="button"
        onClick={() => onOpenSettings()}
        title="All settings"
        aria-label={changedSettings > 0 ? `Settings, ${changedSettings} changed` : "Settings"}
        className="focus-ring inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-control border border-line-strong bg-surface-control px-2 text-body font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover max-md:hidden"
      >
        {/* Narrow bars: icon only, so the property chips keep their labels. */}
        <SlidersHorizontal className="size-3.5 text-fg-meta" /> <span className="@max-[1100px]:hidden">Settings</span>
        {changedSettings > 0 && <span className="text-secondary font-normal text-fg-meta @max-[1330px]:hidden">· {changedSettings} changed</span>}
      </button>

      </div>

      {/* Right: fixed width, never shrinks. */}
      <div className="flex shrink-0 items-center gap-1">
      {problems.length > 0 && (
        <button
          ref={reg("problems")}
          type="button"
          onClick={() => toggle("problems")}
          aria-expanded={pop === "problems"}
          className={cn(
            "focus-ring mr-1 inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-secondary font-semibold ring-1 ring-inset transition-colors duration-(--duration-hover)",
            errors ? "bg-problem/10 text-problem ring-problem/30 hover:bg-problem/15" : "bg-warn/10 text-warn ring-warn/25 hover:bg-warn/15",
          )}
        >
          <AlertTriangle className="size-3.5" />
          {problems.length}
          <span className="@max-[1440px]:hidden">{problems.length === 1 ? "problem" : "problems"}</span>
        </button>
      )}
      <Sep />

      {/* Run cluster */}
      {!running && (
        <div className="inline-flex shrink-0 overflow-hidden rounded-control border border-line-strong bg-surface-control max-md:hidden" role="group" aria-label="Step">
          <button
            type="button"
            onClick={onStepBack}
            disabled={!ready || !view.history.canStepBack}
            title="Back one cycle (← or ,)"
            className="focus-ring-inset inline-flex h-7 cursor-pointer items-center gap-1 px-2.5 text-body font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-3.5" />
            <span className="@max-[1100px]:hidden">Back</span>
          </button>
          <button
            type="button"
            onClick={onStep}
            disabled={!ready}
            title="Step one cycle (→ or .)"
            className="focus-ring-inset inline-flex h-7 cursor-pointer items-center gap-1 border-l border-line-strong px-2.5 text-body font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="@max-[1100px]:hidden">Step</span>
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
      <RunButton ref={reg("run")} running={running} ready={ready} n={n} setN={setN} onRun={runN} onStop={onStop} menuOpen={pop === "run"} onMenu={() => toggle("run")} />
      <KitButton variant="ghost" className="w-[30px] !px-0" onClick={onUndo} disabled={!ready || !view.history.lastAction} aria-label="Undo" title={undoTitle(view.history.lastAction)}>
        <Undo2 />
      </KitButton>
      <KitButton variant="ghost" onClick={onReset} disabled={running || view.status === "loading"} aria-label="Reset" title="Reset to cycle 0 (keeps your scenario)">
        <RotateCcw />
        <span className="@max-[1280px]:hidden">Reset</span>
      </KitButton>
      <Sep />
      <KitButton ref={reg("share")} variant="ghost" onClick={() => toggle("share")} aria-expanded={pop === "share"} title="Export or import flows, submit to the leaderboard, or start over" className="max-md:hidden">
        <Share2 />
        <span className="@max-[1280px]:hidden">Share</span>
      </KitButton>
      </div>

      {/* Popovers */}
      <Popover anchor={anchors.current.online ?? null} open={pop === "online"} onClose={close} label="When you're online" width={360}>
        <div className="p-3">
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-body font-semibold text-fg">Act while online</div>
              <div className="text-secondary text-fg-meta">Harvest, water, re-place, fix ground and change steps</div>
            </div>
            <Switch checked={settings.playerActions !== false} onChange={(playerActions) => setSettings({ playerActions })} label="Player actions" />
          </div>
          {settings.activity.kind === "everyN" && (
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {[1, 2, 4, 8].map((k) => {
                const on = settings.activity.kind === "everyN" && settings.activity.n === k;
                const hours = (cycle * k) / 3600;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSettings({ activity: { kind: "everyN", n: k, offset: 0 } })}
                    aria-pressed={on}
                    className={cn(
                      "focus-ring flex h-11 cursor-pointer flex-col items-center justify-center rounded-control border leading-tight transition-colors duration-(--duration-hover)",
                      on ? "border-select/60 bg-select/10 text-select-fg" : "border-line-strong bg-surface-well text-fg-body hover:border-line-control",
                    )}
                  >
                    <span className="text-body font-semibold tabular-nums">{k}</span>
                    <span className="text-meta text-fg-meta">{k === 1 ? "cycle" : `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`}</span>
                  </button>
                );
              })}
            </div>
          )}
          <ScheduleEditor
            value={settings.activity}
            startTime={settings.playerStats.startTimeOfDay}
            onChange={(activity, startTimeOfDay) => setSettings({ activity, playerStats: { ...settings.playerStats, startTimeOfDay } })}
          />
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5 text-secondary text-fg-meta">
            Compare every frequency under <span className="text-fg-body">Overview › Profit by online frequency</span>.
          </div>
        </div>
      </Popover>

      <Popover anchor={anchors.current.player ?? null} open={pop === "player"} onClose={close} label="Player stats" width={380}>
        <div className="space-y-1 p-3">
          <PlayerImportBox compact className="mb-2" onImport={(patch) => setStats(patch)} />
          <KitLabel className="pt-1">Growth speed · {formatDuration(cycle)} a cycle</KitLabel>
          {(["cropGrowth", "growthUpgradeTier", "speedAttribute", "floraShard"] as const).map((key) => (
            <StatInput key={key} def={STAT_FIELDS[key]} value={settings.playerStats[key]} onChange={(v) => setStats({ [key]: v })} />
          ))}
          <KitLabel className="pt-2">Yield</KitLabel>
          <StatInput def={STAT_FIELDS.farmingFortune} value={settings.playerStats.farmingFortune} onChange={(v) => setStats({ farmingFortune: v })} />
          <div className="mt-2 border-t border-line pt-2.5">
            <button
              type="button"
              className={LINK}
              onClick={() => {
                close();
                onOpenSettings("player");
              }}
            >
              All player stats →
            </button>
          </div>
        </div>
      </Popover>

      <Popover anchor={anchors.current.rules ?? null} open={pop === "rules"} onClose={close} label="Leaderboard rules" width={360}>
        <div className="p-3" data-testid="leaderboard-rules">
          <div className="text-body font-semibold text-fg">Leaderboard rules · {board}</div>
          <p className="mb-3 mt-0.5 text-secondary text-fg-meta">
            Run under the leaderboard&apos;s own set-up (max stats, default settings, empty start) so your numbers match the {board} board.
          </p>
          <div className="mb-2 flex items-center justify-between gap-2 text-body text-fg-muted">
            Online every
            <Dropdown label="Online every" button={<span className="tabular-nums">{`${rulesEvery} cycle${rulesEvery === 1 ? "" : "s"}`}</span>} width={160} align="end">
              {(closeMenu) =>
                EVERY.map((k) => (
                  <MenuItem
                    key={k}
                    checked={k === rulesEvery}
                    onSelect={() => {
                      setRulesEvery(k);
                      closeMenu();
                    }}
                  >
                    {k} cycle{k === 1 ? "" : "s"}
                  </MenuItem>
                ))
              }
            </Dropdown>
          </div>
          <div className="flex gap-1.5">
            <KitButton className="flex-1" onClick={applyBoardRules} title={differences.length ? `Changes: ${differences.join("; ")}` : "Already under the rules; re-rolls the seed"}>
              <Trophy /> Apply {board} rules
            </KitButton>
            {kind !== "normal" && props.onWatchFromNothing && (
              <KitButton
                className="flex-1"
                disabled={props.watching}
                onClick={() => {
                  close();
                  props.onWatchFromNothing!(rulesEvery);
                }}
                title="Watch the site's builder make this flow's starting items, then the flow run from them. Your flows stay as they are."
              >
                <Eye /> Watch from nothing
              </KitButton>
            )}
          </div>
          <div className={cn("mt-3 border-t border-line pt-2.5 text-secondary", rulesOn ? "text-go-fg" : "text-fg-muted")}>
            {rulesOn ? `Your settings match the ${board} rules.` : `Not under the ${board} rules yet: ${differences.join("; ")}.`}
          </div>
          {props.onOpenLeaderboard && (
            <button
              type="button"
              onClick={() => {
                close();
                props.onOpenLeaderboard!();
              }}
              className={cn("mt-2", LINK)}
            >
              Test and submit in the Leaderboard tab →
            </button>
          )}
        </div>
      </Popover>

      <Popover anchor={anchors.current.problems ?? null} open={pop === "problems"} onClose={close} label="Problems" width={420} align="end">
        <ProblemList problems={problems} close={close} />
      </Popover>

      <Popover anchor={anchors.current.run ?? null} open={pop === "run"} onClose={close} label="Run options" width={360} align="end">
        <RunOptions n={n} setN={setN} seed={seed} onSeedChange={onSeedChange} running={running} close={close} />
        <MenuSeparator />
        <MenuLabel>Keyboard</MenuLabel>
        <ul className="space-y-1 px-2 pb-1.5">
          {RUN_SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-start gap-2 text-secondary text-fg-muted">
              {/* Fixed key column that never wraps ("Ctrl/⌘ + Z" broke over two lines); the action text wraps beside it. */}
              <Kbd className="w-[5.5rem] shrink-0 justify-center whitespace-nowrap">{s.keys}</Kbd>
              <span className="min-w-0">{s.action}</span>
            </li>
          ))}
        </ul>
      </Popover>

      <Popover anchor={anchors.current.share ?? null} open={pop === "share"} onClose={close} label="Share" role="menu" width={240} align="end">
        {shareMenu(close)}
      </Popover>
    </div>
  );
};

/** The Problems popover's list (the bar's pill and the phone's chip). */
export const ProblemList: React.FC<{ problems: PageProblem[]; close: () => void }> = ({ problems, close }) => (
  <ul className="max-h-[420px] space-y-0.5 overflow-y-auto scrollbar-dark">
    {problems.map((p, i) => (
      <li key={i} className="flex gap-2.5 rounded-control px-2.5 py-2">
        <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", p.level === "warning" ? "text-warn" : "text-problem")} />
        <div className="min-w-0 flex-1">
          <div className="text-secondary text-fg-meta">{p.where}</div>
          <div className="text-body text-fg-body">{p.message}</div>
        </div>
        {p.action && (
          <button
            type="button"
            onClick={() => {
              close();
              p.action!.run();
            }}
            className={cn("shrink-0 self-center whitespace-nowrap", LINK)}
          >
            {p.action.label} →
          </button>
        )}
      </li>
    ))}
  </ul>
);

/** The Run menu's length presets and seed (the bar's ▾ and the phone's ▾). */
export const RunOptions: React.FC<{ n: number; setN: (n: number) => void; seed: number; onSeedChange: (seed: number) => void; running: boolean; close: () => void; custom?: boolean }> = ({
  n,
  setN,
  seed,
  onSeedChange,
  running,
  close,
  custom,
}) => (
  <>
    <MenuLabel>Run length</MenuLabel>
    <div className="flex gap-1 px-1 pb-1.5">
      {RUN_PRESETS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            setN(k);
            close();
          }}
          aria-pressed={n === k}
          className={cn(
            "focus-ring flex-1 cursor-pointer rounded-inner border text-secondary tabular-nums transition-colors duration-(--duration-hover)",
            // Phones: 44px targets.
            custom ? "h-11" : "h-7",
            n === k ? "border-select/60 bg-select/10 text-select-fg" : "border-line-strong bg-surface-well text-fg-body hover:border-line-control",
          )}
        >
          {k}
        </button>
      ))}
    </div>
    {custom && (
      <label className="flex items-center justify-between gap-2 px-2 py-1.5 text-body text-fg-body">
        Cycles
        <NumberInput
          integer
          min={1}
          max={MAX_CYCLES}
          value={n}
          onChange={(v) => setN(Math.max(1, Math.min(MAX_CYCLES, Math.floor(v) || 1)))}
          aria-label="Cycles to run"
          className="focus-ring h-11 w-28 rounded-control border border-line-control bg-surface-well px-2 text-right text-body tabular-nums text-fg"
        />
      </label>
    )}
    <MenuSeparator />
    <label className="flex items-center justify-between gap-2 px-2 py-1.5 text-body text-fg-body" title="Changing the seed restarts the simulation">
      <span className="flex items-center gap-2">
        <Dices className="size-3.5 text-fg-muted" /> Seed
      </span>
      <NumberInput
        integer
        value={seed}
        onChange={onSeedChange}
        disabled={running}
        className={cn("focus-ring w-28 rounded-control border border-line-control bg-surface-well px-2 text-right text-body tabular-nums text-fg hover:border-fg-meta", custom ? "h-11" : "h-7")}
      />
    </label>
  </>
);

/** Run with an inline cycle count (Enter runs it) and the options menu; Stop while running. */
const RunButton = React.forwardRef<
  HTMLButtonElement,
  { running: boolean; ready: boolean; n: number; setN: (n: number) => void; onRun: (n: number) => void; onStop: () => void; menuOpen: boolean; onMenu: () => void }
>(({ running, ready, n, setN, onRun, onStop, menuOpen, onMenu }, ref) => {
  if (running) {
    return (
      <button
        type="button"
        onClick={onStop}
        title="Stop (Space or Esc)"
        className="focus-ring inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-control bg-problem/15 px-3 text-body font-semibold text-problem ring-1 ring-inset ring-problem/35 transition-colors duration-(--duration-hover) hover:bg-problem/20 max-md:hidden"
      >
        <Square className="size-3" /> Stop
      </button>
    );
  }
  return (
    // No overflow-hidden: each segment rounds its own outer corners so their focus rings are not clipped.
    <div className="inline-flex h-[30px] shrink-0 max-md:hidden">
      <button
        type="button"
        onClick={() => onRun(n)}
        disabled={!ready}
        title="Run (Space)"
        className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-l-control bg-go pl-3 pr-2 text-body font-semibold text-on-go transition-[background-color,scale] duration-(--duration-hover) ease-snappy hover:bg-go-hover active:scale-97 disabled:cursor-default disabled:opacity-60"
      >
        <Play className="size-3 fill-current" /> Run
      </button>
      <label className="flex items-center border-l border-on-go/25 bg-go-strong px-1" title="Cycles to run. Type a number and press Enter to run it.">
        <NumberInput
          integer
          min={1}
          max={MAX_CYCLES}
          value={n}
          onChange={setN}
          aria-label="Cycles to run"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRun((e.currentTarget as HTMLInputElement).valueAsNumber || Number((e.currentTarget as HTMLInputElement).value) || n);
            }
          }}
          className="focus-ring h-6 w-[60px] rounded-inner border-0 bg-on-go/35 px-1.5 text-right text-body font-semibold tabular-nums text-fg focus:bg-on-go/60"
        />
      </label>
      <button
        ref={ref}
        type="button"
        onClick={onMenu}
        aria-expanded={menuOpen}
        aria-label="Run options: length presets, seed, shortcuts"
        className="focus-ring grid w-6 cursor-pointer place-items-center rounded-r-control border-l border-on-go/25 bg-go-strong text-on-go transition-colors duration-(--duration-hover) hover:bg-go"
      >
        <ChevronDown className="size-3.5" />
      </button>
    </div>
  );
});
RunButton.displayName = "RunButton";

/** Share menu items (the page passes its handlers). */
export const ShareMenuItems: React.FC<{
  onExport: () => void;
  onImport: () => void;
  onSubmit: () => void;
  /** Wipe everything back to a fresh simulator (with an Undo toast). */
  onStartOver?: () => void;
  close: () => void;
  icons: { dl: React.ReactNode; ul: React.ReactNode; trophy: React.ReactNode; startOver?: React.ReactNode };
}> = ({ onExport, onImport, onSubmit, onStartOver, close, icons }) => (
  <>
    <MenuLabel>Scenario</MenuLabel>
    <MenuItem icon={icons.dl} onSelect={() => (close(), onExport())} hint="Download and copy your flows as JSON">
      Export flows…
    </MenuItem>
    <MenuItem icon={icons.ul} onSelect={() => (close(), onImport())} hint="Replace your plots from a file">
      Import flows…
    </MenuItem>
    <MenuSeparator />
    <MenuItem icon={icons.trophy} onSelect={() => (close(), onSubmit())} hint="Put these flows on the public leaderboard">
      Submit to leaderboard…
    </MenuItem>
    {onStartOver && (
      <>
        <MenuSeparator />
        <MenuItem icon={icons.startOver} tone="danger" onSelect={() => (close(), onStartOver())} hint="Remove every plot and restore all settings to their defaults">
          Start over
        </MenuItem>
      </>
    )}
  </>
);

