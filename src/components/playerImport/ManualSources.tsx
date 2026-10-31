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
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { KitInput, KitLabel } from "../ui/kit";
import { Dropdown, MenuItem } from "../ui/Popover";
import { surface } from "../ui/surface";
import { MANUAL_SOURCE_INFO } from "./manualSourceInfo";

/**
 * "Not in the API" sources (MANUAL_SOURCES.md): one compact input per source, grouped Permanent /
 * Chips / Temporary, preset to the server's default (= max). Changing one recomputes the imported
 * values above it live (`applyManual`).
 */

const GROUP_LABEL: Record<ManualGroup, string> = { permanent: "Permanent", chips: "Chips", temporary: "Temporary" };

const SourceSelect: React.FC<{ source: ManualSource; value: ManualValue; onChange: (v: ManualValue) => void }> = ({ source, value, onChange }) => {
  const options = source.options ?? [];
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <Dropdown label={source.label} look="field" width={280} className="h-8 w-full justify-between pl-2.5 font-normal" button={<span className="truncate">{options[index]?.label ?? ""}</span>}>
      {(close) =>
        options.map((o, i) => (
          <MenuItem
            key={i}
            checked={i === index}
            onSelect={() => {
              onChange(o.value);
              close();
            }}
          >
            {o.label}
          </MenuItem>
        ))
      }
    </Dropdown>
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
      <KitInput
        type="number"
        inputMode="decimal"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        className="w-full tabular-nums"
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        aria-label={source.label}
      />
      {spec.unit && <span className="shrink-0 text-meta text-fg-meta">{spec.unit}</span>}
    </div>
  );
};

const SourceRow: React.FC<{ source: ManualSource; choices: ManualChoices; onChange: (id: string, v: ManualValue) => void }> = ({ source, choices, onChange }) => {
  const value = manualValue(source, choices);
  const atMax = value === source.default;
  const parts = [
    source.condition ? <span key="c">{source.condition}</span> : null,
    source.input === "number" ? (
      <span key="v" className={cn(!atMax && "text-warn")}>
        {describeAdd(manualAddAt(source, value))}
      </span>
    ) : !atMax ? (
      <span key="v" className="text-warn">
        below max
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    // Label above a full-width control: option labels ("Legendary · +37.5 Overbloom") stay readable in narrow columns.
    <li className="grid grid-cols-1 gap-1 px-2.5 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-body text-fg-body">
          <span className="truncate">{source.label}</span>
          {(source.hint || MANUAL_SOURCE_INFO[source.id]) && (
            <InfoHint title={source.label} width={300}>
              {source.hint && <p>{source.hint}</p>}
              {MANUAL_SOURCE_INFO[source.id]?.map((line, i) => (
                <p key={i} className="text-fg-muted">
                  {line}
                </p>
              ))}
            </InfoHint>
          )}
        </div>
        {parts.length > 0 && <div className="truncate text-meta text-fg-meta">{parts.flatMap((part, i) => (i ? [" · ", part] : [part]))}</div>}
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
    <div className={cn(surface.well, "rounded-container")} data-testid="manual-sources">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-2">
        <span className="text-body text-fg-body">
          Not in the API <span className="text-fg-meta">— set these</span>
        </span>
        {changed > 0 && <LinkButton onClick={onReset}>Reset to max</LinkButton>}
      </div>
      <div>
        {MANUAL_GROUPS.map((g) => {
          const rows = sources.filter((s) => s.group === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <KitLabel className="bg-surface-card px-2.5 py-1">{GROUP_LABEL[g]}</KitLabel>
              <ul className="divide-y divide-line">
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
