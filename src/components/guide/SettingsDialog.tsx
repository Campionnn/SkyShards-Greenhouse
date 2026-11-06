/**
 * How you play: the check-in interval (in real hours) plus the player numbers the forecast depends
 * on. The decisions themselves don't depend on these; only the forecast does. "Start over" asks for
 * a second click (never a browser popup).
 */
import React from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Settings } from "../../simulator/sim/state";
import { PRECISION_SEEDS, hoursPerCycle, hoursToCycles } from "../../guide";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { IconButton, KitButton, KitLabel, Segmented } from "../ui/kit";
import { PRECISIONS, scheduleText, type Precision } from "./format";
import { StatInput } from "../playerStats/StatInput";
import { STAT_FIELDS, type NumericStatKey } from "../playerStats/statFields";
import { ConfirmButton, NumberField } from "./primitives";

/** The stats the forecast reads, in display order (shared definitions: playerStats/statFields.ts). */
const GUIDE_STAT_KEYS: NumericStatKey[] = ["floraShard", "cropGrowth", "growthUpgradeTier", "plantYieldUpgrade", "mutationChanceBonus", "miningFortune", "farmingFortune", "evergreenChip"];

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
}> = (props) => (props.open ? <SettingsBody {...props} /> : null);

const SettingsBody: React.FC<React.ComponentProps<typeof SettingsDialog>> = ({ settings, checkEvery, precision, onChange, onPrecision, onReset, onClose }) => {
  const schedule = settings.activity;
  const cycleHours = hoursPerCycle(settings.playerStats);
  const setStat = (key: NumericStatKey, value: number) => onChange({ ...settings, playerStats: { ...settings.playerStats, [key]: value } }, checkEvery);
  const setWindows = (windows: { from: number; to: number }[]) => onChange({ ...settings, activity: { kind: "windows", windows } }, null);
  const cycles = checkEvery === null ? null : hoursToCycles(checkEvery, settings.playerStats);
  const kind: ScheduleKind = checkEvery !== null ? "hours" : "windows";

  return (
    <ModalDialog labelledBy="guide-settings-title" onClose={onClose} maxWidth="max-w-xl">
      <DialogFrame
        id="guide-settings-title"
        title="How you play"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <ConfirmButton onConfirm={onReset} title="Forget your inventory, plots and settings and start over">
              <RotateCcw /> Start over
            </ConfirmButton>
            <KitButton variant="primary" size="md" onClick={onClose}>
              Done
            </KitButton>
          </div>
        }
      >
        <section className="space-y-2">
          <KitLabel>When you're online</KitLabel>
          <Segmented<ScheduleKind>
            label="When you're online"
            value={kind}
            onChange={(k) => (k === "hours" ? onChange(settings, checkEvery ?? 8) : onChange({ ...settings, activity: { kind: "windows", windows: [{ from: 18, to: 23 }] } }, null))}
            options={[
              { value: "hours", label: "Every few hours" },
              { value: "windows", label: "At set times of day" },
            ]}
          />
          {checkEvery !== null ? (
            <div className="space-y-1">
              <label className="flex flex-wrap items-center justify-between gap-3 text-body text-fg-body">
                <span className="min-w-0">How often you check your greenhouse</span>
                <span className="flex shrink-0 items-center gap-1.5 text-fg-muted">
                  every
                  <NumberField label="Hours between check-ins" value={checkEvery} min={0.5} max={168} step={1} onChange={(h) => onChange(settings, h)} className="w-16" />
                  hours
                </span>
              </label>
              <p className="text-meta text-fg-meta">
                With your stats one growth cycle takes about {cycleHours.toFixed(1)} hours, so this is a visit every {cycles} cycle{cycles === 1 ? "" : "s"}. Only the forecast uses this.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {schedule.kind === "windows" &&
                schedule.windows.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-body text-fg-body">
                    Online from
                    <NumberField label={`Window ${i + 1} from`} value={w.from} max={24} step={0.5} onChange={(from) => setWindows(schedule.windows.map((x, j) => (j === i ? { ...x, from } : x)))} className="w-16" />
                    to
                    <NumberField label={`Window ${i + 1} to`} value={w.to} max={24} step={0.5} onChange={(to) => setWindows(schedule.windows.map((x, j) => (j === i ? { ...x, to } : x)))} className="w-16" />
                    <IconButton className="ml-auto" aria-label={`Remove window ${i + 1}`} onClick={() => setWindows(schedule.windows.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              <li>
                <KitButton onClick={() => setWindows([...(schedule.kind === "windows" ? schedule.windows : []), { from: 12, to: 14 }])}>
                  <Plus /> Add a window
                </KitButton>
              </li>
              <li className="text-meta text-fg-meta">Hours of the day, 0–24 ({scheduleText(checkEvery, schedule)}).</li>
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <KitLabel>Your stats</KitLabel>
          <div className="space-y-1.5">
            {GUIDE_STAT_KEYS.map((key) => (
              <StatInput key={key} def={STAT_FIELDS[key]} value={settings.playerStats[key]} commitOn="blur" onChange={(v) => setStat(key, v)} />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <KitLabel>Forecast precision</KitLabel>
          <Segmented<Precision>
            label="Forecast precision"
            value={precision}
            onChange={onPrecision}
            options={PRECISIONS.map((p) => ({ value: p, label: `${p[0].toUpperCase()}${p.slice(1)} · ${PRECISION_SEEDS[p].length} runs` }))}
          />
          <p className="text-meta text-fg-meta">More runs give steadier numbers but take longer.</p>
        </section>
      </DialogFrame>
    </ModalDialog>
  );
};
