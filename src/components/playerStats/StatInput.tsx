/**
 * One player-stat input, rendered from its shared definition (`statFields.ts`): a number field, a
 * select of game values, or a Garden Chip picked as rarity + level. Used by the simulator's Player
 * tab, the Guide's "How you play" dialog and the leaderboard's "Your stats" form.
 *
 * A stored value that isn't one of the choices (old saves, an import, a typed number) is kept and
 * shown as "Custom"; it only changes when the player picks something.
 */
import React, { useId, useRef, useState } from "react";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { Dropdown, MenuItem } from "../ui/Popover";
import { surface } from "../ui/surface";
import { NumberInput } from "../simulator/controls";
import { CHIP_RARITIES, CHIP_RARITY_LABEL, chipFromValue, chipValue, type ChipRarity, type ChipSpec, type StatFieldDef } from "./statFields";
import { CUSTOM, selectChoices, type Choice } from "./statChoices";

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

/** The kit's field look for number inputs (KitInput's recipe, kept here because NumberInput is a plain input). */
const numberField = cn(
  surface.well,
  "h-8 min-w-0 px-2.5 text-body tabular-nums text-fg placeholder:text-fg-meta transition-colors duration-(--duration-hover) enabled:hover:border-fg-meta focus-ring disabled:cursor-not-allowed disabled:opacity-40",
  "pointer-coarse:text-[16px]", // design-guard-ignore: iOS zooms into focused fields under 16px; not a type role
);

export const StatInput: React.FC<StatInputProps> = ({ def, value, onChange, variant = "row", disabled, className, commitOn = "change" }) => {
  const id = useId();
  const stacked = variant === "stacked";
  const v = Number.isFinite(value) ? value : 0;
  const width = stacked ? "w-full" : def.kind === "number" ? "w-24" : "w-48 max-w-[60%]";

  let control: React.ReactNode;
  if (def.kind === "number") {
    const props = {
      id,
      className: cn(numberField, width, !stacked && "text-right", "shrink-0"),
      min: def.min,
      max: def.max,
      step: def.step,
      disabled,
    };
    control = commitOn === "blur" ? <BlurNumberInput {...props} value={v} onChange={onChange} /> : <NumberInput {...props} value={v} onChange={onChange} />;
  } else if (def.kind === "select") {
    const { choices, current } = selectChoices(def.options, v);
    control = <FieldSelect label={def.label} choices={choices} current={current} onPick={(c) => c !== CUSTOM && onChange(Number(c))} disabled={disabled} className={cn(width, "shrink-0")} />;
  } else {
    control = <ChipPicker label={def.label} spec={def.chip} value={v} onChange={onChange} disabled={disabled} stacked={stacked} />;
  }

  const label = (
    <span className={cn("flex min-w-0 items-center gap-1", stacked ? "text-secondary text-fg-muted" : "text-body text-fg-body")}>
      {def.kind === "number" ? <label htmlFor={id}>{def.label}</label> : <span>{def.label}</span>}
      {def.hint && (
        <InfoHint title={def.label} width={260}>
          {def.hint}
        </InfoHint>
      )}
    </span>
  );

  return stacked ? (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {label}
      {control}
    </div>
  ) : (
    <div className={cn("flex items-center justify-between gap-3", className)}>
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

/** A select-like field: a Dropdown with the current choice on the trigger and a tick in the menu. */
const FieldSelect: React.FC<{ label: string; choices: Choice[]; current: string; onPick: (value: string) => void; disabled?: boolean; className?: string }> = ({
  label,
  choices,
  current,
  onPick,
  disabled,
  className,
}) => {
  const shown = choices.find((c) => c.value === current)?.label ?? "";
  return (
    <Dropdown
      label={label}
      look="field"
      disabled={disabled}
      width={240}
      className={cn("h-8 justify-between pl-2.5 font-normal", className)}
      button={
        <span className="truncate" data-selected-choice="true">
          {shown}
        </span>
      }
    >
      {(close) =>
        choices.map((c) => (
          <MenuItem
            key={c.value}
            checked={c.value === current}
            onSelect={() => {
              onPick(c.value);
              close();
            }}
          >
            {c.label}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
};

/** Garden Chip: rarity + level (0 = no chip), with the resulting bonus. */
const ChipPicker: React.FC<{ label: string; spec: ChipSpec; value: number; onChange: (v: number) => void; disabled?: boolean; stacked: boolean }> = ({
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

  const rarityChoices: Choice[] = [...(custom ? [{ value: CUSTOM, label: "Custom" }] : []), ...CHIP_RARITIES.map((r) => ({ value: r, label: CHIP_RARITY_LABEL[r] }))];
  const levelChoices: Choice[] = [
    ...(level === null ? [{ value: CUSTOM, label: "Custom" }] : []),
    ...Array.from({ length: spec.maxLevel[rarity] + 1 }, (_, l) => ({ value: String(l), label: l === 0 ? "No chip" : `Level ${l}` })),
  ];

  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", stacked && "w-full")}>
      <FieldSelect
        label={`${label} rarity`}
        choices={rarityChoices}
        current={custom ? CUSTOM : rarity}
        onPick={(r) => r !== CUSTOM && setRarity(r as ChipRarity)}
        disabled={disabled}
        className={stacked ? "min-w-0 flex-1" : "w-24"}
      />
      <FieldSelect
        label={`${label} level`}
        choices={levelChoices}
        current={level === null ? CUSTOM : String(level)}
        onPick={(l) => l !== CUSTOM && onChange(chipValue(spec, rarity, Number(l)))}
        disabled={disabled}
        className={stacked ? "min-w-0 flex-1" : "w-24"}
      />
      <span className="w-12 shrink-0 text-right text-body tabular-nums text-fg-body" aria-live="polite">
        {value > 0 ? spec.format(value) : "+0%"}
      </span>
    </span>
  );
};
