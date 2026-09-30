import React, { useState } from "react";
import { Download, FileJson, FolderInput, Layers, Pencil, Plus, RotateCcw, Settings2, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import {
  ARMOR_SET_LABEL,
  ARMOR_SETS,
  CONFIG_META,
  DEFAULT_CONFIG,
  MAX_PLOTS,
  UNMODELLED_RULES,
  type ActivitySchedule,
  type ArmorSet,
  type ConfigGroup,
  type PlayerStats,
  type Scenario,
  type ScenarioIssue,
  type SimConfig,
} from "../../simulator";
import { InfoHint, Panel, SectionLabel, SegmentedControl, useToast } from "../ui";
import { CheckboxField, NumberField, NumberInput, SelectField } from "./controls";
import { nameOf, priceableItems } from "./format";
import { PolicyDefaultsEditor } from "./RotationEditor";
import { addPlot, exportRotations, importRotations, layoutSummary, removePlot } from "./scenarioEdit";
import { buttonClass, inputClass } from "./styles";

// ---- Scenario: share links, plots, import/export ---------------------------

export const ScenarioPanel: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  onEditRotation: (plotId: number) => void;
  /** Open the layout picker (Calculator result, Designer layout, saved layouts, share links). */
  onLoadLayout?: () => void;
  issues: ScenarioIssue[];
  warnings: ScenarioIssue[];
  error: string | null;
}> = ({ scenario, onChange, onEditRotation, onLoadLayout, issues, warnings, error }) => {
  const { toast } = useToast();
  const [json, setJson] = useState<string | null>(null);

  // Rotations only: player stats, schedule, seed, Actions defaults, config and inventory stay out.
  const exportJson = () => {
    const text = JSON.stringify(exportRotations(scenario), null, 2);
    navigator.clipboard.writeText(text).catch(() => undefined);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "greenhouse-rotations.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "Rotations exported", description: "Downloaded and copied. Your player settings and inventory are not included.", variant: "success" });
  };

  const importJson = () => {
    try {
      const next = importRotations(scenario, json ?? "");
      const before = scenario;
      onChange(next);
      setJson(null);
      toast({
        id: "simulator-rotations-imported",
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

  const errors = issues.filter((i) => i.level === "error");
  return (
    <Panel title="Scenario" icon={<Layers />} description="Up to 3 plots, each with its own rotation, sharing one inventory and one clock.">
      <SectionLabel>Plots</SectionLabel>
      <div className="space-y-1.5">
        {scenario.plots.map((p) => (
          <div key={p.id} className="flex items-center gap-2 bg-slate-700/30 rounded-md px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-200">Plot {p.id}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {p.flow.stages.length} stage{p.flow.stages.length > 1 ? "s" : ""}
                {p.flow.loop ? ", looping" : ""} · {layoutSummary(p.flow.stages[p.flow.startIndex]?.layout ?? { code: "" })}
              </div>
            </div>
            <button className={buttonClass.icon} onClick={() => onEditRotation(p.id)} title="Edit rotation">
              <Pencil className="w-3.5 h-3.5" />
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
        <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-2 py-1.5 text-xs text-red-200 space-y-0.5">
          {errors.length ? errors.map((i, k) => <div key={k}>{i.path}: {i.message}</div>) : <div>{error}</div>}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-xs text-amber-200 space-y-0.5">
          {warnings.map((i, k) => (
            <div key={k}>
              {i.path}: {i.message}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button
          className={buttonClass.neutral}
          onClick={exportJson}
          title="Download (and copy) every plot's rotation as JSON: stages, layouts, exits, loop, checked targets and policy overrides. Player stats, schedule, seed, Actions defaults, Advanced settings and inventory are left out."
        >
          <Download className="w-3.5 h-3.5" /> Export rotations
        </button>
        <button className={buttonClass.neutral} onClick={() => setJson(json === null ? "" : null)} title="Replace your plots with ones from an exported rotations file">
          <Upload className="w-3.5 h-3.5" /> Import rotations
        </button>
      </div>
      {json !== null && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] text-slate-500">Replaces your plots. Your player stats, schedule, Actions defaults, Advanced settings and inventory stay as they are.</p>
          <textarea className={`${inputClass} w-full h-24 font-mono`} placeholder="Paste exported rotations JSON" value={json} onChange={(e) => setJson(e.target.value)} />
          <button className={buttonClass.primary} onClick={importJson}>
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

export const SettingsPanel: React.FC<{ scenario: Scenario; onChange: (sc: Scenario) => void }> = ({ scenario, onChange }) => {
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
                interactions or stage changes. The greenhouse only grows, spawns and decays on its own.
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

      {tab === "schedule" && <ScheduleEditor value={settings.activity} startTime={settings.playerStats.startTimeOfDay} onChange={(activity, startTimeOfDay) => setSettings({ activity, playerStats: { ...settings.playerStats, startTimeOfDay } })} />}

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
            <SectionLabel>NPC prices (coins)</SectionLabel>
            <p className="text-[11px] text-slate-500 mb-1.5">Wiki NPC sell prices. Edited values are highlighted; mutation items are Bazaar-only (0). Evergreen and Synthesis Chips default to 50,000.</p>
            <div className="space-y-1.5">
              {priceableItems().map(({ id, price }) => {
                const override = settings.config.rareDropValues[id];
                const changed = typeof override === "number" && override !== price;
                return (
                  <div key={id} className="flex items-center gap-1">
                    <NumberField
                      className="flex-1"
                      label={<span className={changed ? "text-amber-200" : ""}>{nameOf(id)}</span>}
                      title={`Wiki: ${price.toLocaleString()}`}
                      value={override ?? price}
                      min={0}
                      onChange={(v) => setConfig({ rareDropValues: { ...settings.config.rareDropValues, [id]: v } })}
                    />
                    <button
                      className={buttonClass.icon}
                      title="Back to the wiki price"
                      disabled={override === undefined}
                      onClick={() => {
                        const next = { ...settings.config.rareDropValues };
                        delete next[id];
                        setConfig({ rareDropValues: next });
                      }}
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
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

const ScheduleEditor: React.FC<{
  value: ActivitySchedule;
  startTime: number;
  onChange: (schedule: ActivitySchedule, startTimeOfDay: number) => void;
}> = ({ value, startTime, onChange }) => (
  <div className="space-y-2">
    <p className="text-[11px] text-slate-500">
      Harvesting, watering, upkeep, re-placing, ground fixing, stage changes and gate interactions (waking Snoozling, vacuuming rats, Noctilume) only happen while you are online.
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
