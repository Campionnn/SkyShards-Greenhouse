import React from "react";
import { nameOf } from "./format";
import { inputClass } from "./styles";

// Small form controls shared by the simulator panels, in the app's slate/emerald style.

type NumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Round committed values to whole numbers. */
  integer?: boolean;
};

const clampNum = (v: number, min?: number, max?: number, integer?: boolean) => {
  let n = integer ? Math.round(v) : v;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
};

/**
 * A number input that keeps what you type as a local draft, so the field can be emptied or hold
 * an out-of-range intermediate value (e.g. clearing "1" to type "500"). In-range values commit as
 * you type; on blur (or Enter) the draft is clamped to [min, max] or reverted if it's not a number.
 */
export const NumberInput: React.FC<NumberInputProps> = ({ value, onChange, min, max, integer, onBlur, onKeyDown, ...rest }) => {
  const [draft, setDraft] = React.useState(() => String(value));
  const [lastValue, setLastValue] = React.useState(value);
  // Follow outside changes to `value` without clobbering an in-progress edit that parses to it.
  if (!Object.is(value, lastValue)) {
    setLastValue(value);
    if (Number(draft) !== value || draft.trim() === "") setDraft(String(value));
  }

  const commit = () => {
    const parsed = draft.trim() === "" ? NaN : Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const n = clampNum(parsed, min, max, integer);
    setDraft(String(n));
    if (n !== value) onChange(n);
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const parsed = text.trim() === "" ? NaN : Number(text);
        if (Number.isFinite(parsed) && clampNum(parsed, min, max, integer) === parsed && parsed !== value) onChange(parsed);
      }}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        onKeyDown?.(e);
      }}
    />
  );
};

export const NumberField: React.FC<{
  label?: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  title?: string;
}> = ({ label, value, onChange, min, max, step, className = "", title }) => (
  <label className={`flex items-center justify-between gap-3 text-xs text-slate-300 ${className}`} title={title}>
    {label && <span className="min-w-0">{label}</span>}
    <NumberInput
      className={`${inputClass} w-24 text-right flex-shrink-0`}
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
    />
  </label>
);

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label?: React.ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 text-xs text-slate-300 ${className}`}>
      {label && <span className="min-w-0">{label}</span>}
      <select className={`${inputClass} w-48 max-w-[60%] flex-shrink-0`} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const CheckboxField: React.FC<{ label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }> = ({
  label,
  checked,
  onChange,
  title,
}) => (
  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer" title={title}>
    <input type="checkbox" className="accent-emerald-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

/** A select over item / plant ids, labelled by display name. */
export const IdSelect: React.FC<{ value: string; onChange: (v: string) => void; ids: readonly string[]; className?: string }> = ({
  value,
  onChange,
  ids,
  className = "",
}) => (
  <select className={`${inputClass} ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
    {ids.map((id) => (
      <option key={id} value={id}>
        {nameOf(id)}
      </option>
    ))}
  </select>
);

export const Stat: React.FC<{ label: React.ReactNode; value: React.ReactNode; tone?: "good" | "bad" | "muted"; title?: string }> = ({
  label,
  value,
  tone,
  title,
}) => (
  <div className="flex items-center justify-between text-xs py-0.5" title={title}>
    <span className="text-slate-400">{label}</span>
    <span className={tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : tone === "muted" ? "text-slate-500" : "text-slate-200"}>
      {value}
    </span>
  </div>
);
