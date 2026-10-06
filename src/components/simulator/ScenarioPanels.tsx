import React, { useMemo, useRef, useState } from "react";
import { Copy, Download, FileJson, FolderInput, Layers, Pencil, Plus, Settings2, SlidersHorizontal, Trash2, Upload } from "lucide-react";
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
  SPAWN_POOL_FLOOR,
  UNMODELLED_RULES,
  type ActivitySchedule,
  type AloeSession,
  type ArmorSet,
  type ConfigGroup,
  type PlayerStats,
  type Scenario,
  type ScenarioIssue,
  type SimConfig,
} from "../../simulator";
import { InfoHint, Panel, SectionLabel, SegmentedControl, useToast } from "../ui";
import { CheckboxField, NumberField, NumberInput, SelectField } from "./controls";
import { formatDuration, nameOf } from "./format";
import { PolicyDefaultsEditor } from "./FlowEditor";
import { addPlot, duplicatePlot, exportFlows, importFlows, layoutSummary, nextPlotId, removePlot } from "./scenarioEdit";
import { buttonClass, inputClass } from "./styles";

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
}> = ({ scenario, onChange, onEditFlow, onLoadLayout, issues, warnings, error }) => {
  const { toast } = useToast();
  const [json, setJson] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);
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

  // Exports flows only: no player stats, schedule, seed, Actions defaults, config or inventory.
  const exportJson = () => {
    const text = JSON.stringify(exportFlows(scenario), null, 2);
    navigator.clipboard.writeText(text).catch(() => undefined);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "greenhouse-flows.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "Flows exported", description: "Downloaded and copied. Your player settings and inventory are not included.", variant: "success" });
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
        description: "Replaced your plots; your player settings and inventory are unchanged.",
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
                {p.flow.loop ? ", looping" : ""} · {layoutSummary(p.flow.steps[p.flow.startIndex]?.layout ?? { code: "" })}
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

      <div className="flex gap-2 mt-4">
        <button
          className={buttonClass.neutral}
          onClick={exportJson}
          title="Download (and copy) every plot's flow as JSON: steps, layouts, exits, loop, checked targets and policy overrides. Player stats, schedule, seed, Actions defaults, Advanced settings and inventory are left out."
        >
          <Download className="w-3.5 h-3.5" /> Export flows
        </button>
        <button className={buttonClass.neutral} onClick={toggleImport} aria-expanded={json !== null} title="Replace your plots with ones from an exported flows file">
          <Upload className="w-3.5 h-3.5" /> Import flows
        </button>
      </div>
      {json !== null && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] text-slate-500">Replaces your plots. Your player stats, schedule, Actions defaults, Advanced settings and inventory stay as they are.</p>
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

type NumericStat = { [K in keyof PlayerStats]: PlayerStats[K] extends number ? K : never }[keyof PlayerStats];

const STAT_FIELDS: { key: NumericStat; label: string; min: number; max: number; step?: number; hint?: string }[] = [
  { key: "cropGrowth", label: "Crop Growth", min: 0, max: 210 },
  { key: "speedAttribute", label: "Greenhouse Speed attribute", min: 0, max: 10 },
  { key: "growthUpgradeTier", label: "Growth Speed upgrade tier", min: 0, max: 9, hint: "Tier 9 jumps to +50%." },
  { key: "farmingFortune", label: "Farming Fortune", min: 0, max: 4000, hint: "Wiki theoretical max: 3059.2." },
  { key: "plantYieldUpgrade", label: "Plant Yield upgrade", min: 0, max: 0.2, step: 0.02, hint: "0 to 0.20 (+20%)." },
  { key: "evergreenChip", label: "Evergreen Chip", min: 0, max: 0.6, step: 0.02, hint: "0 to 0.60. Applies to all crop-bundle drops, base crops and mutation bundles alike." },
  { key: "mutationChanceBonus", label: "Bioanalysis accessory", min: 0, max: 0.15, step: 0.05, hint: "0 / 0.05 Talisman / 0.10 Ring / 0.15 Artifact. Multiplies the chance for a crop to mutate." },
  { key: "floraShard", label: "Flora attribute", min: 0, max: 10, hint: "Grants 1-10 Unique Crop Bonus; adds to the unique crops standing (10 max in total)." },
  { key: "miningFortune", label: "Mining Fortune", min: 0, max: 3000, hint: "Chloronite item count (caps at 4 from 2000)." },
  {
    key: "overbloom",
    label: "Overbloom",
    min: 0,
    max: 1000,
    hint: "Uncapped. Rare Crop chance x (1 + Overbloom/100): armor drops and mutation Ethereal Vine, not Harvest Bounty. Wiki maxima: 186 with a tool (201 with Crop Fever), 338 with Sun's Grasp (368).",
  },
];

const GROUP_LABEL: Record<ConfigGroup, string> = {
  verified: "Verified",
  unpublished: "Unpublished - reasoned defaults",
  model: "Model switches",
};

export const SettingsPanel: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  /** Cycle length of the current run, for the All-in Aloe preview; from the stats when absent. */
  cycleSecondsNow?: number;
}> = ({ scenario, onChange, cycleSecondsNow }) => {
  const [tab, setTab] = useState<SettingsTab>("player");
  const { settings } = scenario;
  const setSettings = (patch: Partial<Scenario["settings"]>) => onChange({ ...scenario, settings: { ...settings, ...patch } });
  const setConfig = (patch: Partial<SimConfig>) => setSettings({ config: { ...settings.config, ...patch } });
  const nonDefault = CONFIG_META.filter((m) => settings.config[m.key] !== DEFAULT_CONFIG[m.key]).length;

  return (
    <Panel title="Settings" icon={<Settings2 />}>
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
          {STAT_FIELDS.map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              title={f.hint}
              value={settings.playerStats[f.key]}
              min={f.min}
              max={f.max}
              step={f.step}
              onChange={(v) => setSettings({ playerStats: { ...settings.playerStats, [f.key]: v } })}
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
                        {m.ref && <span className="block text-slate-500 mt-1">OPEN_QUESTIONS {m.ref}</span>}
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
          <div>
            <SectionLabel>Not modelled</SectionLabel>
            <ul className="text-[11px] text-slate-500 space-y-0.5">
              {Object.entries(UNMODELLED_RULES).map(([k, why]) => (
                <li key={k}>
                  <span className="text-slate-400">{nameOf(k)}:</span> {why}
                </li>
              ))}
              <li>Effect relay order is a community-verified model (21/23 recorded grids), not a published formula.</li>
            </ul>
          </div>
          <button className={buttonClass.neutral} onClick={() => setConfig(structuredClone(DEFAULT_CONFIG))} disabled={!nonDefault}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> Restore defaults
          </button>
        </div>
      )}
    </Panel>
  );
};

const clockText = (hour: number) => {
  const m = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const gapText = (gap: number) => (Number.isFinite(gap) ? `${gap} cycle${gap === 1 ? "" : "s"}` : "never");

/** Consecutive sessions with the same gap and stage, shown as one row. */
interface SessionRun {
  first: AloeSession;
  last: AloeSession;
  count: number;
}

function groupSessions(sessions: AloeSession[]): SessionRun[] {
  const runs: SessionRun[] = [];
  for (const s of sessions) {
    const prev = runs[runs.length - 1];
    if (prev && prev.last.gapCycles === s.gapCycles && prev.last.stage === s.stage && s.cycle === prev.last.cycle + prev.last.gapCycles) {
      prev.last = s;
      prev.count += 1;
    } else runs.push({ first: s, last: s, count: 1 });
  }
  return runs;
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
  const sessions = useMemo(() => (activity.kind === "windows" ? aloeHarvestSchedule(settings, seconds, respawn) : []), [settings, activity.kind, seconds, respawn]);
  const online = settings.playerActions !== false && (activity.kind === "everyN" || activity.windows.length > 0);

  let body: React.ReactNode;
  if (!config.aloeAutoHarvest) {
    body = <p>Auto harvest is off (Advanced): always harvested at stage {config.aloeHarvestStage}.</p>;
  } else if (!online) {
    body = <p>Never online, so All-in Aloe is never harvested.</p>;
  } else if (activity.kind === "windows" && sessions.length === 0) {
    body = <p>No cycle ends inside your online times on the first day (cycles are {formatDuration(seconds)} long), so nothing is harvested then.</p>;
  } else if (activity.kind === "everyN") {
    const n = Math.max(1, Math.floor(activity.n));
    body = (
      <p>
        Online every {gapText(n)} ({formatDuration(n * seconds)}): harvested at <span className="text-emerald-300">stage {aloeHarvestStageFor(n, respawn)}</span> or higher.
      </p>
    );
  } else {
    body = (
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500 text-left">
            <th className="font-normal">Online at</th>
            <th className="font-normal">Next online in</th>
            <th className="font-normal text-right">Harvest at</th>
          </tr>
        </thead>
        <tbody>
          {groupSessions(sessions).map((r) => (
            <tr key={r.first.cycle}>
              <td>
                {clockText(r.first.hour)}
                {r.count > 1 && `-${clockText(r.last.hour)} (${r.count} sessions)`}
              </td>
              <td>
                {gapText(r.first.gapCycles)}
                {Number.isFinite(r.first.gapCycles) && r.first.gapCycles > 1 && <span className="text-slate-500"> ({formatDuration(r.first.gapCycles * seconds)})</span>}
              </td>
              <td className="text-right text-emerald-300">stage {r.first.stage}+</td>
            </tr>
          ))}
        </tbody>
      </table>
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
            Cycle length {formatDuration(seconds)}
            {liveCycleSeconds === undefined ? " (from your stats)" : " (current run)"}
            {activity.kind === "windows" && ", first day of the run"}.
          </p>
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
