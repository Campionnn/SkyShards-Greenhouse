/**
 * How you play: the check-in interval (in real hours) plus the player numbers the forecast depends
 * on. The decisions themselves don't depend on these; only the forecast does.
 */
import React from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Settings } from "../../simulator/sim/state";
import { PRECISION_SEEDS, hoursPerCycle, hoursToCycles } from "../../guide";
import { SectionLabel, SegmentedControl } from "../ui/Panel";
import { PRECISIONS, buttonClass, scheduleText, type Precision } from "./format";
import { StatInput } from "../playerStats/StatInput";
import { STAT_FIELDS, type NumericStatKey } from "../playerStats/statFields";
import { ConfirmButton, Dialog, NumberField } from "./primitives";

/** The stats the forecast reads, in display order (shared definitions: playerStats/statFields.ts). */
const GUIDE_STAT_KEYS: NumericStatKey[] = [
  "floraShard",
  "cropGrowth",
  "growthUpgradeTier",
  "plantYieldUpgrade",
  "mutationChanceBonus",
  "miningFortune",
  "farmingFortune",
  "evergreenChip",
];

type ScheduleKind = "hours" | "windows";

export const SettingsDialog: React.FC<{
  open: boolean;
  settings: Settings;
  checkEvery: number | null;
  precision: Precision;
  onChange: (settings: Settings, checkEvery: number | null) => void;
  onPrecision: (precision: Precision) => void;
  onReset: () => void;
  onClose: () => void;
}> = ({ open, settings, checkEvery, precision, onChange, onPrecision, onReset, onClose }) => {
  const schedule = settings.activity;
  const cycleHours = hoursPerCycle(settings.playerStats);
  const setStat = (key: NumericStatKey, value: number) => onChange({ ...settings, playerStats: { ...settings.playerStats, [key]: value } }, checkEvery);
  const setWindows = (windows: { from: number; to: number }[]) => onChange({ ...settings, activity: { kind: "windows", windows } }, null);
  const cycles = checkEvery === null ? null : hoursToCycles(checkEvery, settings.playerStats);
  const kind: ScheduleKind = checkEvery !== null ? "hours" : "windows";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="How you play"
      size="md"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ConfirmButton onConfirm={onReset} title="Forget your inventory, plots and settings and start over">
            <RotateCcw className="h-4 w-4" /> Start over
          </ConfirmButton>
          <button type="button" className={buttonClass.primary} onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <SectionLabel>When you're online</SectionLabel>
          <SegmentedControl<ScheduleKind>
            size="xs"
            className="mb-3"
            value={kind}
            onChange={(k) => (k === "hours" ? onChange(settings, checkEvery ?? 8) : onChange({ ...settings, activity: { kind: "windows", windows: [{ from: 18, to: 23 }] } }, null))}
            options={[
              { value: "hours", label: "Every few hours" },
              { value: "windows", label: "At set times of day" },
            ]}
          />

          {checkEvery !== null ? (
            <div className="space-y-1.5">
              <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
                <span className="min-w-0">How often you check your greenhouse</span>
                <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
                  every
                  <NumberField label="Hours between check-ins" value={checkEvery} min={0.5} max={168} step={1} onChange={(h) => onChange(settings, h)} className="w-16" />
                  hours
                </span>
              </label>
              <p className="text-[11px] text-slate-500">
                With your stats one growth cycle takes about {cycleHours.toFixed(1)} hours, so this is a visit every {cycles} cycle{cycles === 1 ? "" : "s"}. Only the forecast
                uses this.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {schedule.kind === "windows" &&
                schedule.windows.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    Online from
                    <NumberField label={`Window ${i + 1} from`} value={w.from} max={24} step={0.5} onChange={(from) => setWindows(schedule.windows.map((x, j) => (j === i ? { ...x, from } : x)))} className="w-16" />
                    to
                    <NumberField label={`Window ${i + 1} to`} value={w.to} max={24} step={0.5} onChange={(to) => setWindows(schedule.windows.map((x, j) => (j === i ? { ...x, to } : x)))} className="w-16" />
                    <button type="button" className={`${buttonClass.ghost} ml-auto`} onClick={() => setWindows(schedule.windows.filter((_, j) => j !== i))} aria-label={`Remove window ${i + 1}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              <li>
                <button type="button" className={buttonClass.neutral} onClick={() => setWindows([...(schedule.kind === "windows" ? schedule.windows : []), { from: 12, to: 14 }])}>
                  <Plus className="h-3.5 w-3.5" /> Add a window
                </button>
              </li>
              <li className="text-[11px] text-slate-500">Hours of the day, 0–24 ({scheduleText(checkEvery, schedule)}).</li>
            </ul>
          )}
        </section>

        <section>
          <SectionLabel>Your stats</SectionLabel>
          <div className="space-y-1.5">
            {GUIDE_STAT_KEYS.map((key) => (
              <StatInput key={key} def={STAT_FIELDS[key]} value={settings.playerStats[key]} commitOn="blur" onChange={(v) => setStat(key, v)} />
            ))}
          </div>
        </section>

        <section>
          <SectionLabel>Forecast precision</SectionLabel>
          <SegmentedControl<Precision>
            size="xs"
            value={precision}
            onChange={onPrecision}
            options={PRECISIONS.map((p) => ({ value: p, label: `${p[0].toUpperCase()}${p.slice(1)} · ${PRECISION_SEEDS[p].length} runs` }))}
          />
          <p className="mt-1.5 text-[11px] text-slate-500">More runs give steadier numbers but take longer.</p>
        </section>
      </div>
    </Dialog>
  );
};
