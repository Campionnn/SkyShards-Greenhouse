import React from "react";
import { nameOf } from "./format";
import { inputClass } from "./styles";

// Small form controls shared by the simulator panels, in the app's slate/emerald style.

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
    <input
      type="number"
      className={`${inputClass} w-24 text-right flex-shrink-0`}
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (!Number.isNaN(v)) onChange(v);
      }}
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
