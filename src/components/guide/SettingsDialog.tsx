/**
 * How you play: the check-in interval (in hours) plus the player numbers the forecast depends on.
 * The decisions themselves don't depend on these; only the forecast does.
 */
import React from "react";
import type { Settings } from "../../simulator/sim/state";
import { HOURS_PER_CYCLE, PRECISION_SEEDS, hoursToCycles, scheduleHours } from "../../guide";
import { PRECISIONS, buttonClass, scheduleText, type Precision } from "./format";
import { Dialog, NumberField } from "./primitives";


const STAT_FIELDS: { key: keyof Settings["playerStats"]; label: string; step?: number; max?: number }[] = [
  { key: "floraShard", label: "Flora shard (0–10)", max: 10 },
  { key: "cropGrowth", label: "Crop Growth Speed", step: 25 },
  { key: "growthUpgradeTier", label: "Growth Speed upgrade tier (0–9)", max: 9 },
  { key: "plantYieldUpgrade", label: "Plant Yield upgrade (0–0.20)", step: 0.05, max: 0.2 },
  { key: "mutationChanceBonus", label: "Bioanalysis (0 / 0.05 / 0.10 / 0.15)", step: 0.05, max: 0.15 },
  { key: "miningFortune", label: "Mining Fortune", step: 25 },
  { key: "farmingFortune", label: "Farming Fortune", step: 25 },
  { key: "evergreenChip", label: "Evergreen Chip (0–0.60)", step: 0.05, max: 0.6 },
];


export const SettingsDialog: React.FC<{
  open: boolean;
  settings: Settings;
  precision: Precision;
  onChange: (settings: Settings) => void;
  onPrecision: (precision: Precision) => void;
  onReset: () => void;
  onClose: () => void;
}> = ({ open, settings, precision, onChange, onPrecision, onReset, onClose }) => {
  const schedule = settings.activity;
  const hours = scheduleHours(schedule);
  const setStat = (key: keyof Settings["playerStats"], value: number) => onChange({ ...settings, playerStats: { ...settings.playerStats, [key]: value } });
  const setWindows = (windows: { from: number; to: number }[]) => onChange({ ...settings, activity: { kind: "windows", windows } });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="How you play"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className={`${buttonClass.ghost} text-red-300`}
            onClick={() => {
              if (typeof window === "undefined" || window.confirm("Forget your inventory, plots and settings and start over?")) onReset();
            }}
          >
            Start over
          </button>
          <button type="button" className={buttonClass.primary} onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <section className="space-y-2">
          <label className="flex flex-wrap items-center gap-3 text-slate-200">
            <span className="flex-1">
              How often do you check your greenhouse?
              <span className="block text-xs text-slate-500">One growth cycle is about {HOURS_PER_CYCLE} hours before speed bonuses. Only the forecast uses this.</span>
            </span>
            <span className="flex items-center gap-2 text-slate-400">
              every
              <NumberField
                label="Hours between check-ins"
                value={Math.round(hours)}
                min={0}
                onChange={(h) => {
                  if (h > 0) onChange({ ...settings, activity: { kind: "everyN", n: hoursToCycles(h), offset: 0 } });
                }}
              />
              hours
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            Schedule:
            {(["everyN", "windows"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={schedule.kind === kind}
                className={`guide-press rounded-md px-2 py-1 ${schedule.kind === kind ? "bg-violet-600/30 text-violet-100" : "bg-slate-800 text-slate-400"}`}
                onClick={() =>
                  onChange({ ...settings, activity: kind === "everyN" ? { kind, n: hoursToCycles(hours), offset: 0 } : { kind, windows: [{ from: 18, to: 23 }] } })
                }
              >
                {kind === "everyN" ? "Every N hours" : "Times of day"}
              </button>
            ))}
            <span className="text-slate-500">({scheduleText(schedule)})</span>
          </div>
          {schedule.kind === "windows" && (
            <ul className="space-y-1.5">
              {schedule.windows.map((w, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  Online from
                  <NumberField label={`Window ${i + 1} from`} value={w.from} max={24} step={0.5} onChange={(from) => setWindows(schedule.windows.map((x, j) => (j === i ? { ...x, from } : x)))} />
                  to
                  <NumberField label={`Window ${i + 1} to`} value={w.to} max={24} step={0.5} onChange={(to) => setWindows(schedule.windows.map((x, j) => (j === i ? { ...x, to } : x)))} />
                  <button type="button" className={buttonClass.ghost} onClick={() => setWindows(schedule.windows.filter((_, j) => j !== i))} aria-label={`Remove window ${i + 1}`}>
                    Remove
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className={buttonClass.ghost} onClick={() => setWindows([...schedule.windows, { from: 12, to: 14 }])}>
                  + Add a window
                </button>
              </li>
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your stats</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {STAT_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-2 rounded-md bg-slate-800/60 px-2 py-1.5 text-xs text-slate-300">
                {f.label}
                <NumberField label={f.label} value={Number(settings.playerStats[f.key]) || 0} step={f.step ?? 1} max={f.max} onChange={(v) => setStat(f.key, v)} />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Forecast precision</h3>
          <div className="inline-flex rounded-lg border border-slate-700 p-0.5" role="radiogroup" aria-label="Forecast precision">
            {PRECISIONS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={precision === p}
                onClick={() => onPrecision(p)}
                className={`guide-press rounded-md px-3 py-1 text-xs capitalize ${precision === p ? "bg-slate-700 text-slate-100" : "text-slate-400"}`}
              >
                {p} · {PRECISION_SEEDS[p].length} runs
              </button>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
};
