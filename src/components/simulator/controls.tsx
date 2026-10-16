import React from "react";
import { nameOf } from "./format";
import { inputClass } from "./styles";

// Form controls shared by the simulator panels.

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
 * Number input with a local draft, so the field can be empty or out of range mid-edit
 * (clearing "1" to type "500"). In-range values commit while typing; blur or Enter clamps
 * to [min, max], or reverts a non-number.
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

/**
 * A faint dotted leader that fills the rest of a row's label cell, so the eye can follow a name
 * across to its numbers. Put it last inside a `flex items-center` label; it takes the leftover
 * width, is vertically centred on the row, and disappears when the label fills the cell.
 */
export const Leader: React.FC<{ className?: string }> = ({ className = "" }) => (
  <span
    aria-hidden
    className={`flex-1 min-w-3 h-px self-center ${className}`}
    // Whole-pixel square dots, so every dot renders in the same shade (the old round, half-clipped
    // dots anti-aliased differently depending on where the element landed). `fixed` anchors the
    // pattern to the viewport instead of each leader, so two leaders in one row (the label's and the
    // one in front of a number) join without a stray pair of dots, and rows line up with each other.
    style={{
      backgroundImage: "linear-gradient(90deg, rgb(100 116 139 / 0.55) 1px, transparent 1px)",
      backgroundSize: "4px 1px",
      backgroundRepeat: "repeat",
      backgroundAttachment: "fixed",
    }}
  />
);

/**
 * A right-aligned figure with its own leader in front, for the first figure after a label. The
 * label's leader stops at its cell edge; this one carries the dots on to the number, however much
 * narrower than its column the number is.
 */
export const LeadValue: React.FC<{ className?: string; title?: string; children: React.ReactNode }> = ({ className = "", title, children }) => (
  <span className={`flex items-center justify-end gap-1.5 ${className}`} title={title}>
    <Leader />
    {children}
  </span>
);

export const Stat: React.FC<{ label: React.ReactNode; value: React.ReactNode; tone?: "good" | "bad" | "muted"; title?: string }> = ({
  label,
  value,
  tone,
  title,
}) => (
  <div className="flex items-center gap-2 text-xs py-0.5" title={title}>
    <span className="text-slate-400">{label}</span>
    <Leader />
    <span className={tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : tone === "muted" ? "text-slate-500" : "text-slate-200"}>
      {value}
    </span>
  </div>
);
