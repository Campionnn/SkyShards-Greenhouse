import React, { useState } from "react";
import {
  describeAdd,
  MANUAL_GROUPS,
  manualAddAt,
  manualValue,
  type ManualChoices,
  type ManualGroup,
  type ManualSource,
  type ManualValue,
} from "../../services/playerImport";
import { InfoHint } from "../ui";

/**
 * "Not in the API" sources (MANUAL_SOURCES.md): one compact input per source, grouped Permanent /
 * Chips / Temporary, preset to the server's default (= max). Changing one recomputes the imported
 * values above it live (`applyManual`).
 */

const GROUP_LABEL: Record<ManualGroup, string> = { permanent: "Permanent", chips: "Chips", temporary: "Temporary" };

const control =
  "w-full min-w-0 bg-slate-900/70 border border-slate-600/40 rounded-md px-1.5 py-1 text-xs text-slate-100 tabular-nums focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors";

const SourceSelect: React.FC<{ source: ManualSource; value: ManualValue; onChange: (v: ManualValue) => void }> = ({ source, value, onChange }) => {
  const options = source.options ?? [];
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <select className={control} value={index} onChange={(e) => onChange(options[Number(e.target.value)].value)} aria-label={source.label}>
      {options.map((o, i) => (
        <option key={i} value={i}>
          {o.label}
        </option>
      ))}
    </select>
  );
};

const SourceNumber: React.FC<{ source: ManualSource; value: number; onChange: (v: number) => void }> = ({ source, value, onChange }) => {
  const spec = source.number!;
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(Math.max(spec.min, Math.min(spec.max, n)));
    setText(null);
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="decimal"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        className={control}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        aria-label={source.label}
      />
      {spec.unit && <span className="shrink-0 text-[11px] text-slate-500">{spec.unit}</span>}
    </div>
  );
};

const SourceRow: React.FC<{ source: ManualSource; choices: ManualChoices; onChange: (id: string, v: ManualValue) => void }> = ({ source, choices, onChange }) => {
  const value = manualValue(source, choices);
  const atMax = value === source.default;
  return (
    // Label above a full-width control: option labels ("Legendary · +37.5 Overbloom") stay readable in narrow columns.
    <li className="grid grid-cols-1 gap-1 px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-xs text-slate-300">
          <span className="truncate">{source.label}</span>
          {source.hint && (
            <InfoHint title={source.label} width={260}>
              {source.hint}
            </InfoHint>
          )}
        </div>
        <div className="truncate text-[10px] leading-tight text-slate-500">
          {[
            source.condition ? <span key="c">{source.condition}</span> : null,
            source.input === "number" ? (
              <span key="v" className={atMax ? "" : "text-amber-300/80"}>
                {describeAdd(manualAddAt(source, value))}
              </span>
            ) : !atMax ? (
              <span key="v" className="text-amber-300/80">
                below max
              </span>
            ) : null,
          ]
            .filter(Boolean)
            .flatMap((part, i) => (i ? [" · ", part] : [part]))}
        </div>
      </div>
      {source.input === "select" ? (
        <SourceSelect source={source} value={value} onChange={(v) => onChange(source.id, v)} />
      ) : (
        <SourceNumber source={source} value={Number(value)} onChange={(v) => onChange(source.id, v)} />
      )}
    </li>
  );
};

export const ManualSources: React.FC<{
  sources: readonly ManualSource[];
  choices: ManualChoices;
  onChange: (id: string, value: ManualValue) => void;
  onReset: () => void;
}> = ({ sources, choices, onChange, onReset }) => {
  if (!sources.length) return null;
  const changed = sources.filter((s) => manualValue(s, choices) !== s.default).length;
  return (
    <div className="rounded-md border border-slate-700/50 bg-slate-900/40" data-testid="manual-sources">
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/50 px-2.5 py-1.5">
        <span className="text-xs text-slate-300">
          Not in the API <span className="text-slate-500">— set these</span>
        </span>
        {changed > 0 && (
          <button type="button" onClick={onReset} className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline">
            Reset to max
          </button>
        )}
      </div>
      <div>
        {MANUAL_GROUPS.map((g) => {
          const rows = sources.filter((s) => s.group === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="bg-slate-800/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">{GROUP_LABEL[g]}</div>
              <ul className="divide-y divide-slate-700/30">
                {rows.map((s) => (
                  <SourceRow key={s.id} source={s} choices={choices} onChange={onChange} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};
