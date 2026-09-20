import React from "react";

interface PanelProps {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

/**
 * The one card style used by every side panel on the calculator and
 * designer pages: dark translucent surface, thin border, 16px padding, a
 * header row with an emerald icon, a title and optional right-aligned
 * actions, and an optional muted description line.
 */
export const Panel: React.FC<PanelProps> = ({
  title,
  icon,
  actions,
  description,
  className = "",
  bodyClassName = "",
  children,
}) => (
  <section className={`bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 flex flex-col min-h-0 ${className}`}>
    {(title || actions) && (
      <header className="flex items-center gap-2 mb-3 flex-shrink-0 min-h-[24px]">
        {icon && (
          <span className="text-emerald-400 flex-shrink-0 [&>svg]:w-4 [&>svg]:h-4 flex items-center">{icon}</span>
        )}
        {title && <h3 className="text-sm font-medium text-slate-200 truncate">{title}</h3>}
        {actions && <div className="ml-auto flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </header>
    )}
    {description && <p className="text-xs text-slate-400 mb-3 flex-shrink-0">{description}</p>}
    <div className={`min-h-0 ${bodyClassName}`}>{children}</div>
  </section>
);

/** Small uppercase label used above sub-sections inside a panel. */
export const SectionLabel: React.FC<{ children: React.ReactNode; className?: string; actions?: React.ReactNode }> = ({
  children,
  className = "",
  actions,
}) => (
  <div className={`flex items-center justify-between mb-2 ${className}`}>
    <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">{children}</h4>
    {actions}
  </div>
);

export type SegmentTone = "emerald" | "purple" | "blue";

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  tone?: SegmentTone;
  title?: string;
}

const TONE_ACTIVE: Record<SegmentTone, string> = {
  emerald: "bg-emerald-500/25 text-emerald-300 border-emerald-500/40",
  purple: "bg-purple-500/25 text-purple-300 border-purple-500/40",
  blue: "bg-blue-500/25 text-blue-300 border-blue-500/40",
};

/** Two-or-more-way toggle with one active segment (Inputs/Targets, Target/Maximize...). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className = "",
  size = "sm",
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  className?: string;
  size?: "xs" | "sm";
}) {
  const pad = size === "xs" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
  return (
    <div className={`flex gap-1 ${className}`} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        const tone = opt.tone ?? "emerald";
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`flex-1 ${pad} rounded-md border font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              active
                ? TONE_ACTIVE[tone]
                : "bg-slate-700/30 text-slate-400 border-slate-600/30 hover:bg-slate-700/60 hover:text-slate-200"
            }`}
          >
            {opt.icon && <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 flex items-center">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
