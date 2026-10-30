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
import { Kbd, KitButton, KitLabel, Segmented, Switch } from "../../ui/kit";
import { MenuItem, MenuLabel, MenuSeparator, Popover } from "../../ui/Popover";
import { NumberInput } from "../controls";
import { formatDuration } from "../format";
import { modalOpen, ownsKeys, RUN_SHORTCUTS, runShortcutFor } from "../runShortcuts";
import { ScheduleEditor } from "../ScenarioPanels";
import { RUN_PRESETS, undoTitle } from "./pageHelpers";

// The simulator's sticky command bar: the profile switch, the settings people change all the time
// (as property chips with popovers), the problems pill, and the run cluster. The rest of the
// settings live in the drawer. Conventions: docs/simulator/UI-CONVENTIONS.md.

const MAX_CYCLES = 100000;

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
const PropChip = React.forwardRef<HTMLButtonElement, { icon: React.ReactNode; label: string; keepLabel?: boolean; open: boolean; onClick: () => void; title?: string; children: React.ReactNode; disabled?: boolean }>(
  ({ icon, label, keepLabel, open, onClick, title, children, disabled }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] transition-colors duration-150 disabled:cursor-default disabled:opacity-50 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-slate-500 ${
        open ? "bg-slate-400/10" : "hover:bg-slate-400/10"
      }`}
    >
      {icon}
      <span className={`text-[12px] text-slate-500 ${keepLabel ? "@max-[1100px]:hidden" : "@max-[1330px]:hidden"}`}>{label}</span>
      <span className="font-semibold text-slate-100">{children}</span>
    </button>
  )
);
PropChip.displayName = "PropChip";

const Sep: React.FC<{ className?: string }> = ({ className = "" }) => <span aria-hidden className={`mx-1 h-[22px] w-px shrink-0 bg-slate-700/70 @max-[1100px]:hidden ${className}`} />;

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
      <span className="mr-2 text-[13px] font-semibold text-slate-100 @max-[1100px]:hidden">Simulator</span>
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
      <div className="flex items-center gap-0.5 max-md:hidden">
        <PropChip ref={reg("online")} icon={<Clock />} label="Online" open={pop === "online"} onClick={() => toggle("online")} disabled={preview} title="When the player is online">
          {everyLabel(scenario)}
        </PropChip>
        <PropChip ref={reg("player")} icon={<UserRound />} label="Player" keepLabel open={pop === "player"} onClick={() => toggle("player")} disabled={preview} title="Player stats: cycle length and fortune">
          {formatDuration(cycle)}
          <span className="font-medium text-slate-400 @max-[1500px]:hidden"> · {ff.toLocaleString("en-US")} FF</span>
        </PropChip>
        <PropChip ref={reg("rules")} icon={<Trophy />} label="Rules" open={pop === "rules"} onClick={() => toggle("rules")} disabled={preview} title={`Leaderboard rules (${board} board)`}>
          <span className={rulesOn ? "text-emerald-300" : "text-slate-400"}>{rulesOn ? "rules on ✓" : "off"}</span>
        </PropChip>
      </div>
      <Sep className="max-md:hidden" />
      <button
        type="button"
        onClick={() => onOpenSettings()}
        className="inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-400/10 max-md:hidden"
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" /> Settings
        {changedSettings > 0 && <span className="text-[12px] font-normal text-slate-500 @max-[1330px]:hidden">· {changedSettings} changed</span>}
      </button>

      <span className="flex-1" />

      {problems.length > 0 && (
        <button
          ref={reg("problems")}
          type="button"
          onClick={() => toggle("problems")}
          aria-expanded={pop === "problems"}
          className={`mr-1 inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold ring-1 ring-inset transition-colors duration-150 ${
            errors ? "bg-red-500/10 text-red-300 ring-red-500/30 hover:bg-red-500/15" : "bg-amber-400/10 text-amber-200 ring-amber-400/25 hover:bg-amber-400/15"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {problems.length}
          <span className="@max-[1330px]:hidden">{problems.length === 1 ? "problem" : "problems"}</span>
        </button>
      )}
      <Sep />

      {/* Run cluster */}
      {!running && (
        <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-slate-600/40 bg-slate-800/60 max-md:hidden" role="group" aria-label="Step">
          <button
            type="button"
            onClick={onStepBack}
            disabled={!ready || !view.history.canStepBack}
            title="Back one cycle (← or ,)"
            className="inline-flex h-7 cursor-pointer items-center gap-1 px-2.5 text-[12.5px] font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700/70 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="@max-[1100px]:hidden">Back</span>
          </button>
          <button
            type="button"
            onClick={onStep}
            disabled={!ready}
            title="Step one cycle (→ or .)"
            className="inline-flex h-7 cursor-pointer items-center gap-1 border-l border-slate-600/40 px-2.5 text-[12.5px] font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700/70 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span className="@max-[1100px]:hidden">Step</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <RunButton ref={reg("run")} running={running} ready={ready} n={n} setN={setN} onRun={runN} onStop={onStop} menuOpen={pop === "run"} onMenu={() => toggle("run")} />
      <KitButton variant="ghost" className="w-[30px] !px-0" onClick={onUndo} disabled={!ready || !view.history.lastAction} aria-label="Undo" title={undoTitle(view.history.lastAction)}>
        <Undo2 />
      </KitButton>
      <KitButton variant="ghost" onClick={onReset} disabled={running || view.status === "loading"} title="Reset to cycle 0 (keeps your scenario)">
        <RotateCcw />
        <span className="@max-[1100px]:hidden">Reset</span>
      </KitButton>
      <Sep />
      {props.onOpenLeaderboard && !preview && (
        <button
          type="button"
          onClick={props.onOpenLeaderboard}
          title="Test and submit this flow to the public leaderboard"
          className="inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-yellow-400/35 bg-yellow-400/[0.08] px-2.5 text-[12.5px] font-semibold text-yellow-200 transition-[background-color,border-color,transform] duration-150 ease-snappy hover:border-yellow-400/55 hover:bg-yellow-400/[0.14] active:scale-[0.97] max-md:hidden [&>svg]:h-3.5 [&>svg]:w-3.5"
        >
          <Trophy />
          <span>Submit</span>
        </button>
      )}
      <KitButton ref={reg("share")} variant="ghost" onClick={() => toggle("share")} aria-expanded={pop === "share"} title="Export or import flows, or submit to the leaderboard" className="max-md:hidden">
        <Share2 />
        <span className="@max-[1100px]:hidden">Share</span>
      </KitButton>

      {/* Popovers */}
      <Popover anchor={anchors.current.online ?? null} open={pop === "online"} onClose={close} label="When you're online" width={360}>
        <div className="p-3">
          <div className="mb-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-slate-100">Act while online</div>
              <div className="text-[12px] text-slate-500">Harvest, water, re-place, fix ground and change steps</div>
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
                    className={`flex h-11 cursor-pointer flex-col items-center justify-center rounded-lg border leading-tight transition-colors duration-150 ${
                      on ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200" : "border-slate-600/40 bg-slate-950/50 text-slate-200 hover:border-slate-500/60"
                    }`}
                  >
                    <span className="text-[13px] font-semibold tabular-nums">{k}</span>
                    <span className="text-[10.5px] text-slate-500">{k === 1 ? "cycle" : `~${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`}</span>
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
          <div className="mt-3 flex items-center gap-2 border-t border-slate-700/60 pt-2.5 text-[12px] text-slate-500">
            Compare every frequency under <span className="text-slate-300">Overview › Profit by online frequency</span>.
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
          <div className="mt-2 border-t border-slate-700/60 pt-2.5">
            <button
              type="button"
              className="cursor-pointer text-[12px] font-medium text-slate-300 underline decoration-slate-500/50 underline-offset-[3px] hover:decoration-slate-300"
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
          <div className="text-[13px] font-semibold text-slate-100">Leaderboard rules · {board}</div>
          <p className="mb-3 mt-0.5 text-[12px] text-slate-500">
            Run under the leaderboard&apos;s own set-up (max stats, default settings, empty start) so your numbers match the {board} board.
          </p>
          <label className="mb-2 flex items-center justify-between gap-2 text-[12.5px] text-slate-400">
            Online every
            <select
              className="h-7 rounded-lg border border-slate-600/40 bg-slate-950/50 px-2 text-[12.5px] text-slate-100"
              value={rulesEvery}
              onChange={(e) => setRulesEvery(Number(e.target.value))}
            >
              {EVERY.map((k) => (
                <option key={k} value={k}>
                  {k} cycle{k === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
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
          <div className={`mt-3 border-t border-slate-700/60 pt-2.5 text-[12px] ${rulesOn ? "text-emerald-300/90" : "text-slate-400"}`}>
            {rulesOn ? `Your settings match the ${board} rules.` : `Not under the ${board} rules yet: ${differences.join("; ")}.`}
          </div>
          {props.onOpenLeaderboard && (
            <button
              type="button"
              onClick={() => {
                close();
                props.onOpenLeaderboard!();
              }}
              className="mt-2 cursor-pointer text-[12px] font-medium text-slate-300 underline decoration-slate-500/50 underline-offset-[3px] hover:decoration-slate-300"
            >
              Test and submit in the Leaderboard tab →
            </button>
          )}
        </div>
      </Popover>

      <Popover anchor={anchors.current.problems ?? null} open={pop === "problems"} onClose={close} label="Problems" width={420} align="end">
        <ul className="max-h-[420px] space-y-0.5 overflow-y-auto scrollbar-dark">
          {problems.map((p, i) => (
            <li key={i} className="flex gap-2.5 rounded-lg px-2.5 py-2">
              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${p.level === "warning" ? "text-amber-300" : "text-red-400"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] text-slate-500">{p.where}</div>
                <div className="text-[12.5px] text-slate-200">{p.message}</div>
              </div>
              {p.action && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    p.action!.run();
                  }}
                  className="shrink-0 cursor-pointer self-center whitespace-nowrap text-[12px] font-medium text-slate-300 underline decoration-slate-500/50 underline-offset-[3px] hover:decoration-slate-300"
                >
                  {p.action.label} →
                </button>
              )}
            </li>
          ))}
        </ul>
      </Popover>

      <Popover anchor={anchors.current.run ?? null} open={pop === "run"} onClose={close} label="Run options" width={250} align="end">
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
              className={`h-7 flex-1 cursor-pointer rounded-md border text-[12px] tabular-nums transition-colors duration-150 ${
                n === k ? "border-emerald-500/60 text-emerald-200" : "border-slate-600/40 bg-slate-950/50 text-slate-300 hover:border-slate-500/60"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <MenuSeparator />
        <label className="flex items-center justify-between gap-2 px-2 py-1.5 text-[12.5px] text-slate-300" title="Changing the seed restarts the simulation">
          <span className="flex items-center gap-2">
            <Dices className="h-3.5 w-3.5 text-slate-400" /> Seed
          </span>
          <NumberInput
            integer
            value={seed}
            onChange={onSeedChange}
            disabled={running}
            className="h-7 w-28 rounded-lg border border-slate-600/40 bg-slate-950/50 px-2 text-right text-[12.5px] tabular-nums text-slate-100 focus:border-emerald-500/60 focus:outline-none"
          />
        </label>
        <MenuSeparator />
        <MenuLabel>Keyboard</MenuLabel>
        <ul className="space-y-1 px-2 pb-1.5">
          {RUN_SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center gap-2 text-[11.5px] text-slate-400">
              <Kbd className="min-w-[4.5rem] justify-center">{s.keys}</Kbd>
              {s.action}
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
        className="inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-red-500/15 px-3 text-[12.5px] font-semibold text-red-300 ring-1 ring-inset ring-red-500/35 transition-colors duration-150 hover:bg-red-500/20 max-md:hidden"
      >
        <Square className="h-3 w-3" /> Stop
      </button>
    );
  }
  return (
    <div className="inline-flex h-[30px] shrink-0 overflow-hidden rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] max-md:hidden">
      <button
        type="button"
        onClick={() => onRun(n)}
        disabled={!ready}
        title="Run (Space)"
        className="inline-flex cursor-pointer items-center gap-1.5 bg-emerald-500 pl-3 pr-2 text-[12.5px] font-semibold text-emerald-950 transition-[background-color,transform] duration-150 ease-snappy hover:bg-emerald-400 active:scale-[0.97] disabled:cursor-default disabled:opacity-60"
      >
        <Play className="h-3 w-3 fill-current" /> Run
      </button>
      <label className="flex items-center border-l border-emerald-950/25 bg-emerald-600 px-1" title="Cycles to run. Type a number and press Enter to run it.">
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
          className="h-6 w-[60px] rounded-md border-0 bg-emerald-950/35 px-1.5 text-right text-[12.5px] font-semibold tabular-nums text-emerald-50 outline-none focus:bg-emerald-950/60 focus:ring-[1.5px] focus:ring-emerald-200"
        />
      </label>
      <button
        ref={ref}
        type="button"
        onClick={onMenu}
        aria-expanded={menuOpen}
        aria-label="Run options: length presets, seed, shortcuts"
        className="grid w-6 cursor-pointer place-items-center border-l border-emerald-950/25 bg-emerald-600 text-emerald-950 transition-colors duration-150 hover:bg-emerald-500"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
RunButton.displayName = "RunButton";

/** Share menu items (the page passes its handlers). */
export const ShareMenuItems: React.FC<{ onExport: () => void; onImport: () => void; onSubmit: () => void; close: () => void; icons: { dl: React.ReactNode; ul: React.ReactNode; trophy: React.ReactNode } }> = ({ onExport, onImport, onSubmit, close, icons }) => (
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
  </>
);

