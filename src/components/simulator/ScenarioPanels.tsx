import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Eye, FileJson, FolderInput, Layers, Pencil, Plus, Settings2, SlidersHorizontal, Trash2, Trophy, Upload } from "lucide-react";
import { applyRules, ruleDifferences, type RuleKind } from "../../leaderboard/rules";
import { profileRuleKind, ruleDifferenceLines } from "../../leaderboard/view";
import { useProfileMode } from "../../hooks/useProfileMode";
import { EVERY, nearestEvery } from "../../leaderboard/tiers";
import {
  aloeHarvestSchedule,
  aloeHarvestStageFor,
  ARMOR_SET_LABEL,
  ARMOR_SETS,
  CONFIG_META,
  cycleSeconds,
  DEFAULT_CONFIG,
  defaultGameData,
  effectiveUniqueCrops,
  MAX_PLOTS,
  normalizeForcedEffects,
  SPAWN_POOL_FLOOR,
  withForcedEffects,
  UNMODELLED_RULES,
  type ActivitySchedule,
  type AloeSession,
  type ArmorSet,
  type ConfigGroup,
  type Scenario,
  type ScenarioIssue,
  type SimConfig,
} from "../../simulator";
import { InfoHint, Panel, SectionLabel, SegmentedControl, useToast } from "../ui";
import { PlayerImportBox } from "../playerImport/PlayerImportBox";
import { StatInput } from "../playerStats/StatInput";
import { STAT_FIELDS, type NumericStatKey } from "../playerStats/statFields";
import { CheckboxField, IdSelect, NumberField, NumberInput, SelectField } from "./controls";
import { CropFortuneSummary } from "./CropFortuneEditor";
import { formatDuration, nameOf } from "./format";
import { PolicyDefaultsEditor } from "./FlowEditor";
import { FlowExportDialog } from "./FlowExportDialog";
// Lazy: the dialog brings react-markdown, which the simulator doesn't need until it opens.
const SubmitFlowDialog = React.lazy(() => import("./SubmitFlowDialog").then((m) => ({ default: m.SubmitFlowDialog })));
import { addPlot, duplicatePlot, exportFlows, importFlows, layoutSummary, nextPlotId, removePlot, type FlowExportOptions } from "./scenarioEdit";
import { buttonClass, inputClass } from "./styles";
import { consumeSubmitReopen } from "./submitDraft";

// ---- Scenario: share links, plots, import/export ---------------------------

/** One validation issue: where it is (e.g. "Plot 1 › Step 3 › Leave when") above what's wrong. */
const IssueLine: React.FC<{ issue: ScenarioIssue }> = ({ issue }) => (
  <div>
    <div className="font-medium">{issue.path}</div>
    <div className="opacity-90">{issue.message}</div>
  </div>
);

export const ScenarioPanel: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  onEditFlow: (plotId: number) => void;
  /** Open the layout picker (Calculator result, Designer layout, saved layouts, share links). */
  onLoadLayout?: () => void;
  issues: ScenarioIssue[];
  warnings: ScenarioIssue[];
  error: string | null;
  /** Show "from nothing" in the simulator (the submit dialog's local test offers it). */
  onWatchFromNothing?: (every: number) => void;
}> = ({ scenario, onChange, onEditFlow, onLoadLayout, issues, warnings, error, onWatchFromNothing }) => {
  const { toast } = useToast();
  const [json, setJson] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Back from the Discord login the dialog started: open it again (its fields come from the draft).
  useEffect(() => {
    if (consumeSubmitReopen()) setSubmitting(true);
  }, []);
  const fileReadId = useRef(0);

  const toggleImport = () => {
    fileReadId.current += 1; // Ignore a pending read if the import panel is closed.
    setReadingFile(false);
    setFileName(null);
    setJson(json === null ? "" : null);
  };

  const selectJsonFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ""; // Allow choosing the same file again, including after a failed read.
    if (!file) return;
    const readId = ++fileReadId.current;
    setReadingFile(true);
    setFileName(null);
    try {
      const text = await file.text();
      if (readId !== fileReadId.current) return;
      setJson(text.replace(/^\uFEFF/, ""));
      setFileName(file.name);
    } catch {
      if (readId !== fileReadId.current) return;
      toast({ title: "Could not read file", description: "Try selecting the JSON file again, or paste its contents below.", variant: "error" });
    } finally {
      if (readId === fileReadId.current) setReadingFile(false);
    }
  };

  const exportJson = async (options: FlowExportOptions) => {
    const text = JSON.stringify(exportFlows(scenario, options), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "greenhouse-flows.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setExporting(false);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Download still works when clipboard access is unavailable or denied.
    }
    toast({
      title: "Flows exported",
      description: `${copied ? "Downloaded and copied." : "Downloaded."} ${Object.values(options).some(Boolean) ? "Includes your selected setup sections." : "Only flows are included; settings and starting inventory are left out."}`,
      variant: "success",
    });
  };

  const importJson = () => {
    try {
      const next = importFlows(scenario, json ?? "");
      const before = scenario;
      onChange(next);
      setJson(null);
      setFileName(null);
      toast({
        id: "simulator-flows-imported",
        title: `Imported ${next.plots.length} plot${next.plots.length > 1 ? "s" : ""}`,
        description: next.settings !== before.settings || next.startingInventory !== before.startingInventory
          ? "Replaced your plots and applied the included setup. Omitted settings are unchanged."
          : "Replaced your plots; your player settings and inventory are unchanged.",
        variant: "success",
        duration: 6000,
        action: { label: "Undo", onClick: () => onChange(before) },
      });
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  };

  const duplicate = (plotId: number) => {
    const id = nextPlotId(scenario);
    if (id === null) return;
    const before = scenario;
    onChange(duplicatePlot(scenario, plotId));
    toast({
      id: "simulator-plot-duplicated",
      title: `Duplicated Plot ${plotId} as Plot ${id}`,
      description: "Same steps, layouts, exits, checked targets and policy overrides.",
      variant: "success",
      duration: 6000,
      action: { label: "Undo", onClick: () => onChange(before) },
    });
  };

  const errors = issues.filter((i) => i.level === "error");
  return (
    <Panel title="Scenario" icon={<Layers />} description="Up to 3 plots, each with its own flow, sharing one inventory and one clock.">
      <SectionLabel>Plots</SectionLabel>
      <div className="space-y-1.5">
        {scenario.plots.map((p) => (
          <div key={p.id} className="flex items-center gap-2 bg-slate-700/30 rounded-md px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-200">Plot {p.id}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {p.flow.steps.length} step{p.flow.steps.length > 1 ? "s" : ""}
                {p.flow.loop ? ", looping" : ""}
                {p.script?.source.trim() ? (p.script.enabled === false ? ", script off" : ", scripted") : ""} ·{" "}
                {layoutSummary(p.flow.steps[p.flow.startIndex]?.layout ?? { code: "" })}
              </div>
            </div>
            <button className={buttonClass.icon} onClick={() => onEditFlow(p.id)} title="Edit flow">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              className={buttonClass.icon}
              onClick={() => duplicate(p.id)}
              disabled={scenario.plots.length >= MAX_PLOTS}
              title={scenario.plots.length >= MAX_PLOTS ? "All three plots are in use" : "Duplicate this plot with its whole flow"}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button className={buttonClass.icon} onClick={() => onChange(removePlot(scenario, p.id))} disabled={scenario.plots.length <= 1} title="Remove plot">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {onLoadLayout && (
            <button className={buttonClass.primary} onClick={onLoadLayout} title="From the Calculator, the Designer, your saved layouts or a share link">
              <FolderInput className="w-3.5 h-3.5" /> Load layout...
            </button>
          )}
          <button className={buttonClass.neutral} onClick={() => onChange(addPlot(scenario))} disabled={scenario.plots.length >= MAX_PLOTS}>
            <Plus className="w-3.5 h-3.5" /> Empty plot
          </button>
        </div>
      </div>

      {(errors.length > 0 || error) && (
        <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-2 py-1.5 text-xs text-red-200 space-y-1.5">
          {errors.length ? errors.map((i, k) => <IssueLine key={k} issue={i} />) : <div>{error}</div>}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-xs text-amber-200 space-y-1.5">
          {warnings.map((i, k) => (
            <IssueLine key={k} issue={i} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <button
          className={buttonClass.neutral}
          onClick={() => setExporting(true)}
          aria-haspopup="dialog"
          title="Choose what to include, then download and copy your flows as JSON."
        >
          <Download className="w-3.5 h-3.5" /> Export flows
        </button>
        <button className={buttonClass.neutral} onClick={toggleImport} aria-expanded={json !== null} title="Replace your plots and apply any setup sections included in an exported flows file">
          <Upload className="w-3.5 h-3.5" /> Import flows
        </button>
        <button
          className={buttonClass.neutral}
          onClick={() => setSubmitting(true)}
          aria-haspopup="dialog"
          title="Put these flows on the public leaderboard (log in with Discord)"
        >
          <Trophy className="w-3.5 h-3.5 text-amber-300" /> Submit to leaderboard
        </button>
      </div>
      {exporting && <FlowExportDialog onClose={() => setExporting(false)} onExport={exportJson} />}
      {submitting && (
        <React.Suspense fallback={null}>
          <SubmitFlowDialog scenario={scenario} onChange={onChange} onClose={() => setSubmitting(false)} onWatchFromNothing={onWatchFromNothing} />
        </React.Suspense>
      )}
      {json !== null && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] text-slate-500">Replaces your plots and any setup sections included in the export. Settings and starting inventory left out of the file stay as they are.</p>
          <label className="block space-y-1 text-xs text-slate-300">
            <span>Select a JSON file</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={selectJsonFile}
              disabled={readingFile}
              className={`${inputClass} w-full file:mr-3 file:rounded file:border-0 file:bg-slate-600 file:px-2 file:py-1 file:text-xs file:text-slate-100 file:cursor-pointer`}
            />
          </label>
          <p className="text-[11px] text-slate-400 break-words" role="status">
            {readingFile ? "Reading file..." : fileName ? `Loaded ${fileName}. Click Load JSON to import.` : "Or paste exported flows JSON below."}
          </p>
          <textarea
            className={`${inputClass} w-full h-24 font-mono`}
            aria-label="Flows JSON"
            placeholder="Paste exported flows JSON"
            value={json}
            disabled={readingFile}
            onChange={(e) => { setJson(e.target.value); setFileName(null); }}
          />
          <button className={buttonClass.primary} onClick={importJson} disabled={readingFile || !json.trim()}>
            <FileJson className="w-3.5 h-3.5" /> Load JSON
          </button>
        </div>
      )}
    </Panel>
  );
};

// ---- Settings: player, schedule, policies, inventory, advanced -------------

type SettingsTab = "player" | "schedule" | "policies" | "advanced";

/** Player tab stats, in display order (definitions shared with the Guide and leaderboard: playerStats/statFields.ts). */
const PLAYER_STAT_KEYS: NumericStatKey[] = [
  "cropGrowth",
  "speedAttribute",
  "growthUpgradeTier",
  "farmingFortune",
  "plantYieldUpgrade",
  "evergreenChip",
  "mutationChanceBonus",
  "floraShard",
  "miningFortune",
  "overbloom",
];

// ---- Debug: forced effects ---------------------------------------------------

const GAME_DATA = defaultGameData();
const FORCE_KINDS = [...GAME_DATA.mutationIds, ...GAME_DATA.cropIds];
const FORCE_EFFECTS = Object.keys(GAME_DATA.effects);

/** Debug override: pick a plant and the effects every plant of that kind always holds. */
const ForcedEffectsEditor: React.FC<{
  value: Record<string, string[]> | undefined;
  onChange: (v: Record<string, string[]> | undefined) => void;
}> = ({ value, onChange }) => {
  const [kind, setKind] = useState(FORCE_KINDS.includes("all_in_aloe") ? "all_in_aloe" : FORCE_KINDS[0]);
  const entries = Object.entries(value ?? {});
  const set = (k: string, effects: string[]) => onChange(normalizeForcedEffects({ ...(value ?? {}), [k]: effects }));
  const toggle = (k: string, e: string) => {
    const cur = value?.[k] ?? [];
    set(k, cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]);
  };
  return (
    <div>
      <SectionLabel>
        <span className={`flex items-center gap-1 ${value ? "text-amber-200" : ""}`}>
          Debug: forced effects
          <InfoHint title="Forced effects" width={280}>
            For debugging and testing. Every plant of the chosen kind always holds the ticked effects, on top of whatever its neighbours give it. Forced
            effects are held only: the plant does not give or relay them. They count for yield, latching at full growth, water retain/drain and Godseed
            eligibility, like any held effect. Saved with the scenario's advanced settings.
          </InfoHint>
        </span>
      </SectionLabel>
      <div className="flex items-center gap-2 mb-1.5">
        <IdSelect value={kind} onChange={setKind} ids={FORCE_KINDS} className="flex-1 min-w-0" />
        <button className={buttonClass.neutral} onClick={() => set(kind, value?.[kind]?.length ? value[kind] : ["immunity"])} disabled={!!value?.[kind]?.length}>
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {entries.length === 0 && <div className="text-[11px] text-slate-500">None. Pick a plant and add it.</div>}
      <div className="space-y-2">
        {entries.map(([k, effects]) => (
          <div key={k} className="rounded border border-amber-500/30 p-1.5">
            <div className="flex items-center justify-between text-xs text-amber-200 mb-1">
              <span>{nameOf(k)}</span>
              <button className="text-slate-400 hover:text-red-300" title="Remove" onClick={() => set(k, [])}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {FORCE_EFFECTS.map((e) => (
                <CheckboxField key={e} label={GAME_DATA.effects[e]?.name ?? e} checked={effects.includes(e)} onChange={() => toggle(k, e)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Advanced settings' labels (for the rules notes). */
const CONFIG_LABELS: Record<string, string> = Object.fromEntries(CONFIG_META.map((m) => [m.key, m.label]));

/** The settings with the profile a rule kind implies (normal = "normal", ironman = none). */
function withRuleKindProfile(settings: Scenario["settings"], kind: RuleKind): Scenario["settings"] {
  const out = { ...settings };
  if (kind === "normal") out.profile = "normal";
  else delete out.profile;
  return out;
}

const GROUP_LABEL: Record<ConfigGroup, string> = {
  verified: "Verified",
  unpublished: "Unpublished - reasoned defaults",
  model: "Model switches",
};

/**
 * The leaderboard rules box (Settings): one set of rules, the board the site's Ironman / Normal
 * switch is on (`profileRuleKind`), applied to the user's own scenario; and "Watch from nothing",
 * which shows the Ironman board's main number (the builder, then the flow) as a preview without
 * touching the scenario.
 */
export const LeaderboardRulesBox: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  onWatchFromNothing?: (every: number) => void;
  /** A from-nothing preview is open or being prepared. */
  watching?: boolean;
}> = ({ scenario, onChange, onWatchFromNothing, watching = false }) => {
  const { settings } = scenario;
  const [siteProfile] = useProfileMode();
  const kind = profileRuleKind(siteProfile);
  const [rulesEvery, setRulesEvery] = useState<number>(settings.activity.kind === "everyN" ? nearestEvery(settings.activity.n) : 1);
  // The profile is site-wide (the page applies it from localStorage), so diff with the board's profile set.
  const differences = ruleDifferenceLines(ruleDifferences({ ...scenario, settings: withRuleKindProfile(settings, kind) }, kind), CONFIG_LABELS);
  const apply = () => {
    const ruled = applyRules(scenario, kind, rulesEvery, Math.floor(Math.random() * 2 ** 31));
    // The profile is site-wide (the page applies it from localStorage), so leave the scenario's own value alone.
    const next: Scenario = { ...ruled, settings: { ...ruled.settings } };
    if (settings.profile) next.settings.profile = settings.profile;
    else delete next.settings.profile;
    onChange(next);
  };
  const board = kind === "normal" ? "Normal" : "Ironman";
  return (
    <div className="mb-3 rounded border border-slate-700/60 bg-slate-800/40 p-2" data-testid="leaderboard-rules">
      <div className="flex items-center gap-1 text-xs text-slate-300 mb-1.5">
        <Trophy className="w-3.5 h-3.5 text-amber-300" /> Leaderboard rules · {board}
        <InfoHint title="Leaderboard rules" width={320}>
          <p>
            The server measures every flow with wiki-maximum player stats, default advanced settings, an empty starting inventory and the player online every N
            cycles, on both boards. This box follows the Ironman / Normal switch at the top of the page.
          </p>
          <p>
            <b>Ironman</b>: a mutation item may be placed before you own it, so you see the flow as it runs once you have its starting items (what it needs is
            listed). The board's main number is <b>from nothing</b>: the site's builder makes those starting items first; <b>Watch from nothing</b> shows both
            parts without changing your flows. Ironman runs get unlimited Dead Plants and Fermento.
          </p>
          <p>
            <b>Normal</b>: the normal profile, buying shortfalls on the Bazaar. Applying uses your own random seed; the server uses secret seeds of its own.
          </p>
        </InfoHint>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SelectField<string> label="Online every" value={String(rulesEvery)} options={EVERY.map((n) => ({ value: String(n), label: `${n} cycle${n === 1 ? "" : "s"}` }))} onChange={(v) => setRulesEvery(Number(v))} />
        <button className={buttonClass.neutral} onClick={apply} title={differences.length ? `Changes: ${differences.join("; ")}` : "Already under the rules; re-rolls the seed"}>
          <Trophy className="w-3.5 h-3.5" /> Apply the {board} rules
        </button>
        {kind !== "normal" && onWatchFromNothing && (
          <button
            className={buttonClass.neutral}
            onClick={() => onWatchFromNothing(rulesEvery)}
            disabled={watching}
            title="Watch the site's builder make this flow's starting items, then the flow run from exactly those. Your flows stay as they are."
          >
            <Eye className="w-3.5 h-3.5" /> Watch from nothing
          </button>
        )}
      </div>
      {differences.length > 0 ? (
        <div className="mt-1.5 text-[11px] text-amber-200/90">Not under the {board} rules yet: {differences.join("; ")}.</div>
      ) : (
        <div className="mt-1.5 text-[11px] text-emerald-300/90">Your settings match the {board} rules.</div>
      )}
    </div>
  );
};

export const SettingsPanel: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  /** Cycle length of the current run, for the All-in Aloe preview; from the stats when absent. */
  cycleSecondsNow?: number;
  /** Open the "from nothing" preview (the builder, then the flow), online every N cycles. */
  onWatchFromNothing?: (every: number) => void;
  watching?: boolean;
}> = ({ scenario, onChange, cycleSecondsNow, onWatchFromNothing, watching }) => {
  const [tab, setTab] = useState<SettingsTab>("player");
  const { settings } = scenario;
  const setSettings = (patch: Partial<Scenario["settings"]>) => onChange({ ...scenario, settings: { ...settings, ...patch } });
  const setConfig = (patch: Partial<SimConfig>) => setSettings({ config: { ...settings.config, ...patch } });
  const nonDefault =
    CONFIG_META.filter((m) => settings.config[m.key] !== DEFAULT_CONFIG[m.key]).length +
    (settings.config.forcedEffects ? 1 : 0) +
    (settings.config.freePlacedItems?.length ? 1 : 0) +
    (settings.config.setupFromStock === true ? 1 : 0) +
    (settings.config.leaderboardRules === true ? 1 : 0);
  return (
    <Panel title="Settings" icon={<Settings2 />}>
      <LeaderboardRulesBox scenario={scenario} onChange={onChange} onWatchFromNothing={onWatchFromNothing} watching={watching} />
      <div className="mb-3">
        <CheckboxField
          label={
            <span className="flex items-center gap-1">
              Player actions
              <InfoHint title="Player actions" width={260}>
                Master switch. Off: the player never comes online, whatever the Online schedule says - no harvesting, watering, upkeep, re-placing, ground fixing, gate
                interactions or step changes. The greenhouse only grows, spawns and decays on its own.
              </InfoHint>
            </span>
          }
          checked={settings.playerActions !== false}
          onChange={(playerActions) => setSettings({ playerActions })}
        />
      </div>
      <SegmentedControl
        size="xs"
        className="mb-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: "player", label: "Player" },
          { value: "schedule", label: "Online" },
          { value: "policies", label: "Actions" },
          { value: "advanced", label: nonDefault ? `Advanced (${nonDefault})` : "Advanced" },
        ]}
      />

      {tab === "player" && (
        <div className="space-y-1.5">
          <PlayerImportBox compact className="mb-2" onImport={(patch) => setSettings({ playerStats: { ...settings.playerStats, ...patch } })} />
          {PLAYER_STAT_KEYS.map((key) => (
            <StatInput
              key={key}
              def={STAT_FIELDS[key]}
              value={settings.playerStats[key]}
              onChange={(v) => setSettings({ playerStats: { ...settings.playerStats, [key]: v } })}
            />
          ))}
          <SelectField<ArmorSet>
            label={
              <span className="flex items-center gap-1">
                Farming armor (4/4)
                <InfoHint title="Farming armor" width={280}>
                  In the Greenhouse, every harvested crop or mutation rolls the set's Rare Crops: Tater: Cropie 20%. Cropie: Squash 12%. Squash: Fermento 2.8%.
                  Fermento and Helianthus combine all the lower tiers and add Helianthus 1.6%. Chances x (1 + Overbloom/100).
                </InfoHint>
              </span>
            }
            value={settings.playerStats.armorSet ?? "none"}
            options={ARMOR_SETS.map((s) => ({ value: s, label: ARMOR_SET_LABEL[s] }))}
            onChange={(armorSet) => setSettings({ playerStats: { ...settings.playerStats, armorSet } })}
          />
          <CropFortuneSummary stats={settings.playerStats} onChange={(playerStats) => setSettings({ playerStats })} />
        </div>
      )}

      {tab === "schedule" && (
        <>
          <ScheduleEditor value={settings.activity} startTime={settings.playerStats.startTimeOfDay} onChange={(activity, startTimeOfDay) => setSettings({ activity, playerStats: { ...settings.playerStats, startTimeOfDay } })} />
          <AloeHarvestPreview settings={settings} liveCycleSeconds={cycleSecondsNow} />
        </>
      )}

      {tab === "policies" && <PolicyDefaultsEditor value={settings.policies} onChange={(policies) => setSettings({ policies })} />}

      {tab === "advanced" && (
        <div className="space-y-3">
          {(["model", "unpublished", "verified"] as ConfigGroup[]).map((group) => (
            <div key={group}>
              <SectionLabel>{GROUP_LABEL[group]}</SectionLabel>
              <div className="space-y-1.5">
                {CONFIG_META.filter((m) => m.group === group).map((m) => {
                  const value = settings.config[m.key];
                  const changed = value !== DEFAULT_CONFIG[m.key];
                  const label = (
                    <span className={`flex items-center gap-1 ${changed ? "text-amber-200" : ""}`}>
                      {m.label}
                      <InfoHint title={m.label} width={260}>
                        {m.description}
                      </InfoHint>
                    </span>
                  );
                  if (m.input.type === "boolean")
                    return <CheckboxField key={m.key} label={label} checked={value as boolean} onChange={(v) => setConfig({ [m.key]: v } as Partial<SimConfig>)} />;
                  if (m.input.type === "select")
                    return (
                      <SelectField
                        key={m.key}
                        label={label}
                        value={value as string}
                        options={m.input.options.map((o) => ({ value: o, label: o }))}
                        onChange={(v) => setConfig({ [m.key]: v } as Partial<SimConfig>)}
                      />
                    );
                  return (
                    <NumberField
                      key={m.key}
                      label={label}
                      value={value as number}
                      min={m.input.min}
                      max={m.input.max}
                      step={m.input.step}
                      onChange={(v) => setConfig({ [m.key]: v } as Partial<SimConfig>)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <ForcedEffectsEditor
            value={settings.config.forcedEffects}
            onChange={(forcedEffects) => setSettings({ config: withForcedEffects(settings.config, forcedEffects) })}
          />
          {!!settings.config.freePlacedItems?.length && (
            <div className="rounded border border-amber-500/30 p-2 text-[11px] text-amber-200/90">
              <span className="font-medium">Unlimited supplies (leaderboard ironman rules):</span> {settings.config.freePlacedItems.map(nameOf).join(", ")} are placed
              without using inventory, like fire.{" "}
              <button
                className="underline hover:text-amber-100"
                onClick={() => {
                  const config = { ...settings.config };
                  delete config.freePlacedItems;
                  setSettings({ config });
                }}
              >
                Turn off
              </button>
            </div>
          )}
          {settings.config.setupFromStock === true && (
            <div className="rounded border border-amber-500/30 p-2 text-[11px] text-amber-200/90" data-testid="setup-from-stock-note">
              <span className="font-medium">Starting layouts paid from stock (leaderboard "from nothing" rules):</span> the first layouts spend the starting inventory; an item it
              doesn't hold leaves its cell empty until the flow grows one.{" "}
              <button
                className="underline hover:text-amber-100"
                onClick={() => {
                  const config = { ...settings.config };
                  delete config.setupFromStock;
                  setSettings({ config });
                }}
              >
                Turn off
              </button>
            </div>
          )}
          {settings.config.leaderboardRules === true && (
            <div className="rounded border border-amber-500/30 p-2 text-[11px] text-amber-200/90" data-testid="leaderboard-rules-note">
              <span className="font-medium">Leaderboard rules:</span> the debug script APIs (forceEffects and friends) are off, and the credit settings are hidden from scripts.{" "}
              <button
                className="underline hover:text-amber-100"
                onClick={() => {
                  const config = { ...settings.config };
                  delete config.leaderboardRules;
                  setSettings({ config });
                }}
              >
                Turn off
              </button>
            </div>
          )}
          <div>
            <SectionLabel>Not modelled</SectionLabel>
            <ul className="text-[11px] text-slate-500 space-y-0.5">
              {Object.entries(UNMODELLED_RULES).map(([k, why]) => (
                <li key={k}>
                  <span className="text-slate-400">{nameOf(k)}:</span> {why}
                </li>
              ))}
              <li>Effect Spread (since the Oct 13 2026 fix) is modelled as relays sharing everything until nothing changes, in every direction; checked against recorded in-game grids, not a published formula.</li>
            </ul>
          </div>
          <button className={buttonClass.neutral} onClick={() => setSettings({ config: structuredClone(DEFAULT_CONFIG) })} disabled={!nonDefault}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> Restore defaults
          </button>
        </div>
      )}
    </Panel>
  );
};

const gapText = (gap: number) => (Number.isFinite(gap) ? `${gap} cycle${gap === 1 ? "" : "s"}` : "never");

/** How many days of online sessions the "Times of day" preview looks at. Cycles drift against the clock, so one day isn't representative. */
const PREVIEW_DAYS = 7;

/** All sessions that harvest at the same stage, with the range of "next online in" gaps that lead to it. */
interface StageRow {
  stage: number;
  minGap: number;
  maxGap: number;
}

/** One row per harvest stage, highest stage (shortest gap) first. */
function rowsByStage(sessions: AloeSession[]): StageRow[] {
  const byStage = new Map<number, StageRow>();
  for (const s of sessions) {
    const row = byStage.get(s.stage);
    if (!row) byStage.set(s.stage, { stage: s.stage, minGap: s.gapCycles, maxGap: s.gapCycles });
    else {
      row.minGap = Math.min(row.minGap, s.gapCycles);
      row.maxGap = Math.max(row.maxGap, s.gapCycles);
    }
  }
  return [...byStage.values()].sort((a, b) => b.stage - a.stage);
}

/** "1 cycle", "8 cycles (20h)", "8-9 cycles (20h-22h 30m)". */
function gapRangeText(row: StageRow, seconds: number): React.ReactNode {
  if (!Number.isFinite(row.minGap)) return "never";
  const cycles = row.minGap === row.maxGap ? gapText(row.minGap) : `${row.minGap}-${Number.isFinite(row.maxGap) ? row.maxGap : "∞"} cycles`;
  if (row.maxGap <= 1) return cycles;
  const time =
    row.minGap === row.maxGap || !Number.isFinite(row.maxGap)
      ? formatDuration(row.minGap * seconds)
      : `${formatDuration(row.minGap * seconds)}-${formatDuration(row.maxGap * seconds)}`;
  return (
    <>
      {cycles} <span className="text-slate-500">({time})</span>
    </>
  );
}

/**
 * When the player harvests All-in Aloe under the current online schedule. Display only:
 * cycle length from the player stats (Flora only, no standing crops) or the live run, and the
 * default respawn chance (spawn weight + Bioanalysis); the engine uses each aloe cell's live chance.
 */
export const AloeHarvestPreview: React.FC<{ settings: Scenario["settings"]; liveCycleSeconds?: number }> = ({ settings, liveCycleSeconds }) => {
  const { config, playerStats } = settings;
  // Default respawn: the aloe's spawn weight with the player's Bioanalysis, against the pool floor.
  const weight = (defaultGameData().mutations.all_in_aloe?.spawnWeight ?? SPAWN_POOL_FLOOR) * (1 + playerStats.mutationChanceBonus);
  const respawn = weight / Math.max(SPAWN_POOL_FLOOR, weight);
  const seconds = liveCycleSeconds ?? cycleSeconds(playerStats, effectiveUniqueCrops(0, playerStats.floraShard));
  const { activity } = settings;
  const sessions = useMemo(
    () => (activity.kind === "windows" ? aloeHarvestSchedule(settings, seconds, respawn, PREVIEW_DAYS * 86400) : []),
    [settings, activity.kind, seconds, respawn]
  );
  const online = settings.playerActions !== false && (activity.kind === "everyN" || activity.windows.length > 0);

  let body: React.ReactNode;
  if (!config.aloeAutoHarvest) {
    body = <p>Auto harvest is off (Advanced): always harvested at stage {config.aloeHarvestStage}.</p>;
  } else if (!online) {
    body = <p>Never online, so All-in Aloe is never harvested.</p>;
  } else if (activity.kind === "windows" && sessions.length === 0) {
    body = <p>No cycle ends inside your online times in the first week (cycles are {formatDuration(seconds)} long), so nothing is harvested then.</p>;
  } else if (activity.kind === "everyN") {
    const n = Math.max(1, Math.floor(activity.n));
    body = (
      <p>
        Online every {gapText(n)} ({formatDuration(n * seconds)}): harvested at <span className="text-emerald-300">stage {aloeHarvestStageFor(n, respawn)}</span> or higher.
      </p>
    );
  } else {
    body = (
      <>
        <p>Each time you're online, the harvest stage depends on how long until you're next online:</p>
        <table className="text-[11px]">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="font-normal pr-3">Harvest at</th>
              <th className="font-normal">Next online in</th>
            </tr>
          </thead>
          <tbody>
            {rowsByStage(sessions).map((r) => (
              <tr key={r.stage}>
                <td className="pr-3 text-emerald-300 whitespace-nowrap">stage {r.stage}+</td>
                <td>{gapRangeText(r, seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1.5 text-[11px] text-slate-400" data-testid="aloe-harvest-preview">
      <SectionLabel>
        <span className="flex items-center gap-1">
          All-in Aloe harvests
          <InfoHint title="All-in Aloe auto harvest" width={300}>
            Each session the player harvests All-in Aloe at the stage that makes the most aloe per cycle for the time until they are next online: 14 when
            checking every cycle, lower before a long time offline (an aloe left growing may reset to stage 1 first).
          </InfoHint>
        </span>
      </SectionLabel>
      {body}
      {config.aloeAutoHarvest && online && (
        <>
          <p className="text-slate-500">
            Cycle length {formatDuration(seconds)} {liveCycleSeconds === undefined ? "(from your stats)" : "(current run)"}.
          </p>
          {activity.kind === "windows" && (
            <p className="text-slate-500">
              Cycles don't line up with the clock, so the exact times you check drift from day to day. This covers every check in the first {PREVIEW_DAYS} days.
            </p>
          )}
        </>
      )}
    </div>
  );
};

const ScheduleEditor: React.FC<{
  value: ActivitySchedule;
  startTime: number;
  onChange: (schedule: ActivitySchedule, startTimeOfDay: number) => void;
}> = ({ value, startTime, onChange }) => (
  <div className="space-y-2">
    <p className="text-[11px] text-slate-500">
      Harvesting, watering, upkeep, re-placing, ground fixing, step changes and gate interactions (waking Snoozling, vacuuming rats, Noctilume) only happen while you are online.
    </p>
    <SegmentedControl
      size="xs"
      value={value.kind}
      onChange={(kind) => onChange(kind === "everyN" ? { kind, n: 1, offset: 0 } : { kind, windows: [{ from: 18, to: 23 }] }, startTime)}
      options={[
        { value: "everyN", label: "Every N cycles" },
        { value: "windows", label: "Times of day" },
      ]}
    />
    {value.kind === "everyN" ? (
      <>
        <NumberField label="Online every N cycles" value={value.n} min={1} onChange={(n) => onChange({ ...value, n: Math.max(1, Math.floor(n)) }, startTime)} />
        <NumberField label="Offset (first online cycle)" value={value.offset} min={0} onChange={(offset) => onChange({ ...value, offset: Math.max(0, Math.floor(offset)) }, startTime)} />
      </>
    ) : (
      <>
        <NumberField label="Clock at cycle 0 (hour)" value={startTime} min={0} max={23.99} step={0.5} onChange={(h) => onChange(value, h)} />
        {value.windows.map((w, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-slate-300">
            online
            <NumberInput min={0} max={24} step={0.5} className={`${inputClass} w-16`} value={w.from} onChange={(v) => onChange({ ...value, windows: value.windows.map((x, j) => (j === i ? { ...x, from: v } : x)) }, startTime)} />
            to
            <NumberInput min={0} max={24} step={0.5} className={`${inputClass} w-16`} value={w.to} onChange={(v) => onChange({ ...value, windows: value.windows.map((x, j) => (j === i ? { ...x, to: v } : x)) }, startTime)} />
            <button className={buttonClass.icon} onClick={() => onChange({ ...value, windows: value.windows.filter((_, j) => j !== i) }, startTime)}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button className={buttonClass.neutral} onClick={() => onChange({ ...value, windows: [...value.windows, { from: 7, to: 8 }] }, startTime)}>
          <Plus className="w-3.5 h-3.5" /> Window
        </button>
      </>
    )}
  </div>
);
