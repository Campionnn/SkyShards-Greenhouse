/**
 * One player-stat input, rendered from its shared definition (`statFields.ts`): a number field, a
 * select of game values, or a Garden Chip picked as rarity + level. Used by the simulator's Player
 * tab, the Guide's "How you play" dialog and the leaderboard's "Your stats" panel.
 *
 * A stored value that isn't one of the choices (old saves, an import, a typed number) is kept and
 * shown as "Custom"; it only changes when the player picks something.
 */
import React, { useId, useRef, useState } from "react";
import { InfoHint } from "../ui/InfoHint";
import { NumberInput } from "../simulator/controls";
import { inputClass } from "../simulator/styles";
import { CHIP_RARITIES, CHIP_RARITY_LABEL, chipFromValue, chipValue, type ChipRarity, type ChipSpec, type StatFieldDef, type StatOption } from "./statFields";

export type StatInputVariant = "row" | "stacked";

export interface StatInputProps {
  def: StatFieldDef;
  /** In engine units (`PlayerStats`), e.g. 0.1 for a Ring of Bioanalysis. */
  value: number;
  onChange: (value: number) => void;
  /** row: label left, control right (simulator, Guide). stacked: label above a full-width control (leaderboard). */
  variant?: StatInputVariant;
  disabled?: boolean;
  className?: string;
  /**
   * Number fields only: "change" (default) commits valid in-range values while typing; "blur"
   * commits only on blur or Enter (the Guide, where every change restarts the forecast).
   */
  commitOn?: "change" | "blur";
}

const CUSTOM = "custom";
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const shortNumber = (v: number) => String(Number(v.toFixed(4)));

export const StatInput: React.FC<StatInputProps> = ({ def, value, onChange, variant = "row", disabled, className = "", commitOn = "change" }) => {
  const id = useId();
  const stacked = variant === "stacked";
  const v = Number.isFinite(value) ? value : 0;
  const width = stacked ? "w-full" : def.kind === "number" ? "w-24" : "w-48 max-w-[60%]";

  let control: React.ReactNode;
  if (def.kind === "number") {
    const props = {
      id,
      className: `${inputClass} ${width} ${stacked ? "" : "text-right"} flex-shrink-0`,
      min: def.min,
      max: def.max,
      step: def.step,
      disabled,
    };
    control = commitOn === "blur" ? <BlurNumberInput {...props} value={v} onChange={onChange} /> : <NumberInput {...props} value={v} onChange={onChange} />;
  } else if (def.kind === "select") {
    control = <OptionSelect id={id} options={def.options} value={v} onChange={onChange} disabled={disabled} className={`${width} flex-shrink-0`} />;
  } else {
    control = <ChipPicker id={id} label={def.label} spec={def.chip} value={v} onChange={onChange} disabled={disabled} stacked={stacked} />;
  }

  const label = (
    <span className={`flex items-center gap-1 min-w-0 ${stacked ? "text-slate-400" : ""}`}>
      <label htmlFor={id}>{def.label}</label>
      {def.hint && (
        <InfoHint title={def.label} width={260}>
          {def.hint}
        </InfoHint>
      )}
    </span>
  );

  return stacked ? (
    <div className={`block min-w-0 text-xs text-slate-300 ${className}`}>
      <div className="mb-1">{label}</div>
      {control}
    </div>
  ) : (
    <div className={`flex items-center justify-between gap-3 text-xs text-slate-300 ${className}`}>
      {label}
      {control}
    </div>
  );
};

/**
 * `NumberInput` that reports only on blur / Enter: keystrokes update a local value, which the
 * blur or Enter hands on (after `NumberInput` has clamped it).
 */
const BlurNumberInput: React.FC<React.ComponentProps<typeof NumberInput>> = ({ value, onChange, onBlur, onKeyDown, ...rest }) => {
  const [local, setLocal] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const latest = useRef(value);
  // Follow outside changes (an import, a reset).
  if (!Object.is(value, lastValue)) {
    setLastValue(value);
    setLocal(value);
    latest.current = value;
  }
  const flush = () => {
    if (!Object.is(latest.current, value)) onChange(latest.current);
  };
  return (
    <NumberInput
      {...rest}
      value={local}
      onChange={(n) => {
        latest.current = n;
        setLocal(n);
      }}
      onBlur={(e) => {
        flush();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") flush();
        onKeyDown?.(e);
      }}
    />
  );
};

/** A select of fixed values; a value that matches none gets a "Custom (x)" entry so it isn't silently changed. */
const OptionSelect: React.FC<{ id: string; options: StatOption[]; value: number; onChange: (v: number) => void; disabled?: boolean; className: string }> = ({
  id,
  options,
  value,
  onChange,
  disabled,
  className,
}) => {
  const match = options.find((o) => same(o.value, value));
  return (
    <select
      id={id}
      className={`${inputClass} ${className}`}
      value={match ? String(match.value) : CUSTOM}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value !== CUSTOM) onChange(Number(e.target.value));
      }}
    >
      {!match && <option value={CUSTOM}>Custom ({shortNumber(value)})</option>}
      {options.map((o) => (
        <option key={o.value} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
};

/** Garden Chip: rarity + level (0 = no chip), with the resulting bonus. */
const ChipPicker: React.FC<{ id: string; label: string; spec: ChipSpec; value: number; onChange: (v: number) => void; disabled?: boolean; stacked: boolean }> = ({
  id,
  label,
  spec,
  value,
  onChange,
  disabled,
  stacked,
}) => {
  const found = chipFromValue(spec, value);
  // At level 0 the value can't say which rarity the player picked: remember it locally.
  const [pickedRarity, setPickedRarity] = useState<ChipRarity>(found && value > 0 ? found.rarity : "legendary");
  const custom = found === null;
  const rarity: ChipRarity = found && value > 0 ? found.rarity : pickedRarity;
  const level = found ? found.level : null;

  const setRarity = (r: ChipRarity) => {
    setPickedRarity(r);
    // Keep the level (or the nearest one a custom value implies), capped at the new rarity's max.
    const l = level ?? Math.round(value / spec.perLevel[r]);
    onChange(chipValue(spec, r, Math.min(spec.maxLevel[r], l)));
  };

  return (
    <span className={`flex items-center gap-1.5 flex-shrink-0 ${stacked ? "w-full" : ""}`}>
      <select
        id={id}
        aria-label={`${label} rarity`}
        className={`${inputClass} ${stacked ? "flex-1" : "w-24"}`}
        value={custom ? CUSTOM : rarity}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== CUSTOM) setRarity(e.target.value as ChipRarity);
        }}
      >
        {custom && <option value={CUSTOM}>Custom</option>}
        {CHIP_RARITIES.map((r) => (
          <option key={r} value={r}>
            {CHIP_RARITY_LABEL[r]}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} level`}
        className={`${inputClass} ${stacked ? "flex-1" : "w-24"}`}
        value={level === null ? CUSTOM : String(level)}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== CUSTOM) onChange(chipValue(spec, rarity, Number(e.target.value)));
        }}
      >
        {level === null && <option value={CUSTOM}>Custom</option>}
        {Array.from({ length: spec.maxLevel[rarity] + 1 }, (_, l) => (
          <option key={l} value={String(l)}>
            {l === 0 ? "No chip" : `Level ${l}`}
          </option>
        ))}
      </select>
      <span className="w-12 text-right tabular-nums text-emerald-300" aria-live="polite">
        {value > 0 ? spec.format(value) : "+0%"}
      </span>
    </span>
  );
};
