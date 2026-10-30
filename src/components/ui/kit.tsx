import React, { useLayoutEffect, useRef, useState } from "react";

// The design system's primitives (docs/design-system/: README, foundations, components). Every
// page uses these instead of styling controls inline; add a missing primitive here (with a /design
// gallery entry) rather than a one-off.
//
// - Surfaces come from `surface` (./surface.ts): panel, card, well, raised.
// - Text: 13px body, 12px secondary (slate-400), 11px meta (slate-500), uppercase 10.5px labels.
// - One accent (emerald) for primary / selected / go; yellow-400 coin totals, amber warnings,
//   red problems only, sky scripts, violet restart (flow editor).
// - Radii: 12px cards and floating surfaces, 8px controls.
// - Press feedback: scale(0.97) on :active. Hover colour changes are 150ms.

const press = "transition-[background-color,border-color,color,transform] duration-150 ease-snappy active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none cursor-pointer";

export type ButtonVariant = "primary" | "accent" | "neutral" | "ghost" | "danger" | "dashed";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-emerald-500 border border-emerald-500 text-emerald-950 font-semibold hover:bg-emerald-400",
  accent: "bg-emerald-500/10 border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20",
  neutral: "bg-slate-800/60 border border-slate-600/40 text-slate-200 hover:bg-slate-700/70",
  ghost: "border border-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-700/50",
  danger: "bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20",
  dashed: "border border-dashed border-slate-600/60 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300",
};

const SIZE = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-lg [&>svg]:w-3.5 [&>svg]:h-3.5",
  md: "h-8 px-3 text-[13px] gap-2 rounded-lg [&>svg]:w-4 [&>svg]:h-4",
} as const;

export interface KitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof SIZE;
}

export const KitButton = React.forwardRef<HTMLButtonElement, KitButtonProps>(({ variant = "neutral", size = "sm", className = "", type = "button", ...rest }, ref) => (
  <button ref={ref} type={type} className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium ${press} ${VARIANT[variant]} ${SIZE[size]} ${className}`} {...rest} />
));
KitButton.displayName = "KitButton";

/** A square icon button. Always give it an aria-label (it is also its tooltip). */
export const IconButton = React.forwardRef<HTMLButtonElement, KitButtonProps & { "aria-label": string }>(({ variant = "ghost", size = "sm", className = "", type = "button", title, ...rest }, ref) => (
  <button
    ref={ref}
    type={type}
    title={title ?? rest["aria-label"]}
    className={`inline-flex shrink-0 items-center justify-center rounded-lg ${press} ${VARIANT[variant]} ${size === "sm" ? "w-7 h-7 [&>svg]:w-3.5 [&>svg]:h-3.5" : "w-8 h-8 [&>svg]:w-4 [&>svg]:h-4"} ${className}`}
    {...rest}
  />
));
IconButton.displayName = "IconButton";

/** A keyboard key hint. */
export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <kbd className={`inline-flex items-center rounded border border-slate-600/50 bg-slate-950/70 px-1.5 font-mono text-[10.5px] leading-[18px] text-slate-400 ${className}`}>{children}</kbd>
);

/** Uppercase section label. */
export const KitLabel: React.FC<{ children: React.ReactNode; className?: string; actions?: React.ReactNode }> = ({ children, className = "", actions }) => (
  <div className={`flex items-center justify-between gap-2 ${className}`}>
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">{children}</span>
    {actions}
  </div>
);

export type Tone = "neutral" | "emerald" | "amber" | "violet" | "sky" | "red";

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-400/10 text-slate-400",
  emerald: "bg-emerald-500/15 text-emerald-300",
  amber: "bg-amber-400/10 text-amber-300",
  violet: "bg-violet-500/15 text-violet-300",
  sky: "bg-sky-400/10 text-sky-300",
  red: "bg-red-500/15 text-red-300",
};

/** A small status chip ("START", "2 overrides", "1 in"). */
export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string; title?: string; strong?: boolean }> = ({ tone = "neutral", children, className = "", title, strong }) => (
  <span
    title={title}
    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[11px] [&>svg]:w-3 [&>svg]:h-3 ${strong ? "font-bold tracking-[0.05em] text-[10px]" : "font-medium"} ${TONE[tone]} ${className}`}
  >
    {children}
  </span>
);

/** On/off switch. `tone` colours the "on" track. */
export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; tone?: "emerald" | "amber"; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  tone = "emerald",
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-snappy disabled:opacity-40 ${
      checked ? (tone === "amber" ? "bg-amber-600" : "bg-emerald-500") : "bg-slate-600"
    }`}
  >
    <span className={`absolute left-[2px] h-[14px] w-[14px] rounded-full bg-slate-100 shadow transition-transform duration-200 ease-snappy ${checked ? "translate-x-[12px]" : ""}`} />
  </button>
);

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

/** Compact segmented toggle (ALL / ANY, Total / Per day). The thumb slides between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div ref={ref} role="group" aria-label={label} className={`relative inline-flex rounded-lg border border-slate-700/60 bg-slate-950/50 p-0.5 ${className}`}>
      {thumb && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-md bg-slate-700/80 shadow-sm transition-[transform,width] duration-200 ease-snappy"
          style={{ width: thumb.w, transform: `translateX(${thumb.x - 2}px)`, left: 2 }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`relative z-10 cursor-pointer rounded-md px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors duration-150 ${o.value === value ? "text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number | null;
}

/**
 * Underlined tabs; the ink bar slides to the selected tab. `scroll`: the row scrolls sideways
 * when it doesn't fit (no scrollbar); the ink then sits inside the bar, since anything hanging
 * below it would make the bar scroll vertically too.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className = "",
  scroll = false,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  className?: string;
  scroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (el) setInk({ x: el.offsetLeft + 8, w: el.offsetWidth - 16 });
  }, [value, items]);
  return (
    <div ref={ref} role="tablist" className={`relative flex gap-0.5 border-b border-slate-700/60 ${scroll ? "overflow-x-auto overflow-y-hidden scrollbar-none" : ""} ${className}`}>
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={`flex cursor-pointer items-center gap-1.5 ${scroll ? "shrink-0 whitespace-nowrap" : ""} px-2.5 pt-2 pb-2.5 text-[12.5px] font-medium transition-colors duration-150 ${t.value === value ? "text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
        >
          {t.label}
          {t.count ? <span className="rounded bg-slate-400/10 px-1.5 text-[10.5px] tabular-nums text-slate-400">{t.count}</span> : null}
        </button>
      ))}
      {ink && <span aria-hidden className={`absolute ${scroll ? "bottom-0" : "-bottom-px"} left-0 h-0.5 rounded-full bg-emerald-400 transition-[transform,width] duration-200 ease-snappy`} style={{ width: ink.w, transform: `translateX(${ink.x}px)` }} />}
    </div>
  );
}

/** A labelled "OTHERWISE" / "OR" divider between list entries. */
export const Divider: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`flex items-center gap-2 text-[10.5px] font-bold tracking-[0.07em] text-slate-500 ${className}`}>
    <span className="h-px flex-1 bg-slate-700/60" />
    {children}
    <span className="h-px flex-1 bg-slate-700/60" />
  </div>
);

/** Text input in the kit style. */
export const KitInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className = "", ...rest }, ref) => (
  <input
    ref={ref}
    className={`h-8 min-w-0 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 transition-colors duration-150 focus:border-emerald-500/60 focus:outline-none ${className}`}
    {...rest}
  />
));
KitInput.displayName = "KitInput";

export const KitTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className = "", ...rest }, ref) => (
  <textarea
    ref={ref}
    className={`min-w-0 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2.5 py-2 text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-600 transition-colors duration-150 focus:border-emerald-500/60 focus:outline-none ${className}`}
    {...rest}
  />
));
KitTextarea.displayName = "KitTextarea";
