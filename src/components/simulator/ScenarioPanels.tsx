import React, { useMemo, useState } from "react";
import { Plus, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
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
  normalizeForcedEffects,
  SPAWN_POOL_FLOOR,
  withForcedEffects,
  UNMODELLED_RULES,
  type ActivitySchedule,
  type AloeSession,
  type ArmorSet,
  type ConfigGroup,
  type Scenario,
  type SimConfig,
} from "../../simulator";
import { InfoHint, Panel, SectionLabel, SegmentedControl } from "../ui";
import { PlayerImportBox } from "../playerImport/PlayerImportBox";
import { StatInput } from "../playerStats/StatInput";
import { STAT_FIELDS, type NumericStatKey } from "../playerStats/statFields";
import { CheckboxField, IdSelect, NumberField, NumberInput, SelectField } from "./controls";
import { CropFortuneSummary } from "./CropFortuneEditor";
import { formatDuration, nameOf } from "./format";
import { PolicyDefaultsEditor } from "./policyFields";
import { buttonClass, inputClass } from "./styles";

// ---- Settings: player, schedule, policies, inventory, advanced -------------

type SettingsTab = "player" | "schedule" | "policies" | "advanced";

const GROUP_LABEL: Record<ConfigGroup, string> = {
  verified: "Verified",
  unpublished: "Unpublished - reasoned defaults",
  model: "Model switches",
};

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


export const SettingsPanel: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  /** Cycle length of the current run, for the All-in Aloe preview; from the stats when absent. */
  cycleSecondsNow?: number;
  /** Drawer mode: no panel chrome and no tab strip (the drawer owns the tabs); the page passes the tab. */
  bare?: boolean;
  tab?: SettingsTab;
}> = ({ scenario, onChange, cycleSecondsNow, bare = false, tab: controlledTab }) => {
  const [ownTab, setTab] = useState<SettingsTab>("player");
  const tab = controlledTab ?? ownTab;
  const { settings } = scenario;
  const setSettings = (patch: Partial<Scenario["settings"]>) => onChange({ ...scenario, settings: { ...settings, ...patch } });
  const setConfig = (patch: Partial<SimConfig>) => setSettings({ config: { ...settings.config, ...patch } });
  const nonDefault =
    CONFIG_META.filter((m) => settings.config[m.key] !== DEFAULT_CONFIG[m.key]).length +
    (settings.config.forcedEffects ? 1 : 0) +
    (settings.config.freePlacedItems?.length ? 1 : 0) +
    (settings.config.setupFromStock === true ? 1 : 0) +
    (settings.config.leaderboardRules === true ? 1 : 0);
  const body = (
    <>
      <div className={bare && tab !== "schedule" ? "hidden" : "mb-3"}>
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
      {!bare && (
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
      )}

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
    </>
  );
  return bare ? <div className="space-y-3">{body}</div> : <Panel title="Settings" icon={<Settings2 />}>{body}</Panel>;
};

export type { SettingsTab };

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

export const ScheduleEditor: React.FC<{
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
