import React, { useId } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./cn";
import { surface } from "./surface";
import { useSlidingIndicator } from "./useSlidingIndicator";

// The design system's primitives (docs/design-system/: README, foundations, components). Every
// page uses these instead of styling controls inline; add a missing primitive here (with a /design
// gallery entry) rather than a one-off.
//
// Everything here is built on the semantic tokens in index.css @theme, never on raw palette classes:
// - Surfaces: `surface` (./surface.ts) or bg-surface-*; lines border-line / -strong / -control.
// - Text roles: text-body 13 · text-secondary 12 · text-meta 11 · text-label 11 uppercase ·
//   text-title 15 · text-hero 22; colours text-fg / -body / -muted / -meta.
// - Role colours: go (primary / selected), coin, warn, problem, script, restart. One meaning each.
// - Radii: rounded-container (cards, floating), rounded-control (controls), rounded-inner (inside).
// - One focus ring (`focus-ring`), invisible `hit-area` growth for small controls (44px on touch).
// - Motion: colours 150ms on hover; press scale(0.97); indicators slide with transform only.

const press =
  "focus-ring transition-[background-color,border-color,color,scale,transform] duration-(--duration-hover) ease-snappy active:scale-97 disabled:pointer-events-none disabled:opacity-40 cursor-pointer";

export type ButtonVariant = "primary" | "accent" | "neutral" | "ghost" | "danger" | "dashed";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-go bg-go font-semibold text-on-go hover:bg-go-hover",
  accent: "border border-go/35 bg-go/10 text-go-fg hover:bg-go/20",
  neutral: "border border-line-strong bg-surface-control text-fg-body hover:bg-surface-hover",
  ghost: "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg",
  danger: "border border-problem/30 bg-problem/10 text-problem hover:bg-problem/20",
  dashed: "border border-dashed border-line-control text-fg-muted hover:border-go/50 hover:text-go-fg",
};

/** `touch` is the 44px phone size; sm and md also grow their hit area to 44px on touch screens. */
export type ButtonSize = "sm" | "md" | "touch";

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 rounded-control px-2.5 text-secondary [&>svg]:size-3.5 [&>[data-kit-content]>svg]:size-3.5",
  md: "h-8 gap-2 rounded-control px-3 text-body [&>svg]:size-4 [&>[data-kit-content]>svg]:size-4",
  touch: "h-11 gap-2 rounded-control px-4 text-body [&>svg]:size-4 [&>[data-kit-content]>svg]:size-4",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "size-7 [&>svg]:size-3.5",
  md: "size-8 [&>svg]:size-4",
  touch: "size-11 [&>svg]:size-4",
};

export interface KitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Busy: shows a spinner in place of the content (the button keeps its width), sets aria-busy and
   *  ignores clicks. The button stays focusable so keyboard focus is not lost while it works. */
  loading?: boolean;
}

const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  // Reduced motion: the spinner pulses (opacity) instead of rotating.
  <LoaderCircle aria-hidden data-kit-spinner className={cn("animate-spin motion-reduce:animate-pulse", className)} />
);

/** Swallows activation while a button is loading (it stays focusable, unlike `disabled`). */
function busyClick(loading: boolean | undefined, onClick: React.MouseEventHandler<HTMLButtonElement> | undefined) {
  return loading
    ? (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
      }
    : onClick;
}

export const KitButton = React.forwardRef<HTMLButtonElement, KitButtonProps>(
  ({ variant = "neutral", size = "sm", loading, className, type = "button", onClick, children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      {...rest}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest["aria-disabled"]}
      onClick={busyClick(loading, onClick)}
      className={cn(
        "hit-area inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium",
        press,
        VARIANT[variant],
        SIZE[size],
        loading && "cursor-progress",
        className,
      )}
    >
      {loading ? (
        <>
          {/* The content stays laid out (invisible) so the button keeps its width. */}
          <span data-kit-content className="invisible inline-flex items-center gap-[inherit]">
            {children}
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <Spinner className={size === "sm" ? "size-3.5" : "size-4"} />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  ),
);
KitButton.displayName = "KitButton";

/** A square icon button. Always give it an aria-label (it is also its tooltip). */
export const IconButton = React.forwardRef<HTMLButtonElement, KitButtonProps & { "aria-label": string }>(
  ({ variant = "ghost", size = "sm", loading, className, type = "button", title, onClick, children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      title={title ?? rest["aria-label"]}
      {...rest}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest["aria-disabled"]}
      onClick={busyClick(loading, onClick)}
      className={cn("hit-area inline-flex shrink-0 items-center justify-center rounded-control", press, VARIANT[variant], ICON_SIZE[size], loading && "cursor-progress", className)}
    >
      {loading ? <Spinner /> : children}
    </button>
  ),
);
IconButton.displayName = "IconButton";

/** A keyboard key hint. */
export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <kbd className={cn("inline-flex items-center rounded-inner border border-line-strong bg-surface-well px-1.5 font-mono text-meta text-fg-muted", className)}>{children}</kbd>
);

/** Uppercase section label. */
export const KitLabel: React.FC<{ children: React.ReactNode; className?: string; actions?: React.ReactNode }> = ({ children, className, actions }) => (
  <div className={cn("flex items-center justify-between gap-2", className)}>
    <span className="text-label uppercase text-fg-meta">{children}</span>
    {actions}
  </div>
);

/** Pill tones. The colour names are kept for existing callers; the role names say what they mean. */
export type Tone = "neutral" | "emerald" | "amber" | "violet" | "sky" | "red" | "go" | "warn" | "restart" | "script" | "problem";

const TONE: Record<Tone, string> = {
  neutral: "bg-fg-muted/10 text-fg-muted",
  go: "bg-go/15 text-go-fg",
  emerald: "bg-go/15 text-go-fg",
  warn: "bg-warn/10 text-warn",
  amber: "bg-warn/10 text-warn",
  restart: "bg-restart/15 text-restart",
  violet: "bg-restart/15 text-restart",
  script: "bg-script/10 text-script",
  sky: "bg-script/10 text-script",
  problem: "bg-problem/15 text-problem",
  red: "bg-problem/15 text-problem",
};

/** A small status chip ("START", "2 overrides", "1 in"). `strong`: an uppercase label-style chip. */
export const Pill: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string; title?: string; strong?: boolean }> = ({
  tone = "neutral",
  children,
  className,
  title,
  strong,
}) => (
  <span
    title={title}
    className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-inner px-1.5 py-px [&>svg]:size-3",
      strong ? "text-label uppercase" : "text-meta font-medium",
      TONE[tone],
      className,
    )}
  >
    {children}
  </span>
);

/**
 * On/off switch. `tone` colours the "on" track. `label` is its accessible name; pass `showLabel`
 * (renders `label`) or `children` (renders them) to show a visible label beside it, which also
 * becomes clickable. `labelSide` puts that text before or after the switch.
 */
export const Switch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tone?: "emerald" | "amber" | "go" | "warn";
  disabled?: boolean;
  showLabel?: boolean;
  children?: React.ReactNode;
  labelSide?: "start" | "end";
  className?: string;
}> = ({ checked, onChange, label, tone = "emerald", disabled, showLabel, children, labelSide = "end", className }) => {
  const id = useId();
  const visible = children ?? (showLabel ? label : null);
  const warn = tone === "amber" || tone === "warn";
  const track = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={visible == null ? label : undefined}
      aria-labelledby={visible == null ? undefined : `${id}-label`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "hit-area focus-ring inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-(--duration-ink) ease-snappy disabled:cursor-default disabled:opacity-40",
        // Off: the control-boundary colour as the track. On: the role colour (warn is a light
        // amber, so it is tinted down to keep the white thumb readable on it).
        checked ? (warn ? "bg-warn/70 enabled:hover:bg-warn/85" : "bg-go enabled:hover:bg-go-hover") : "bg-line-control enabled:hover:bg-fg-meta",
        visible == null && className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-[2px] size-[14px] rounded-full bg-fg shadow transition-transform duration-(--duration-ink) ease-snappy",
          checked && "translate-x-[12px]",
        )}
      />
    </button>
  );
  if (visible == null) return track;
  const text = (
    <span id={`${id}-label`} className={cn("text-body text-fg-body", disabled && "opacity-40")}>
      {visible}
    </span>
  );
  return (
    <label className={cn("inline-flex items-center gap-2", disabled ? "cursor-default" : "cursor-pointer", className)}>
      {labelSide === "start" && text}
      {track}
      {labelSide === "end" && text}
    </label>
  );
};



export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Compact segmented toggle (ALL / ANY, Total / Per day). The thumb slides between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  label: string;
  className?: string;
  /** Disables every option (an option can also be disabled on its own). */
  disabled?: boolean;
}) {
  const { box, bar, style } = useSlidingIndicator('[aria-pressed="true"]', 0, [value, options.length]);
  return (
    <div ref={box} role="group" aria-label={label} aria-disabled={disabled || undefined} className={cn("relative inline-flex p-0.5", surface.well, disabled && "opacity-40", className)}>
      {style && (
        <span
          ref={bar}
          aria-hidden
          // The thumb is the hover fill: one step lighter than the well.
          // Forced colours drop backgrounds, so the selected option gets the system highlight there.
          className="absolute top-0.5 bottom-0.5 left-0 rounded-inner bg-surface-hover forced-colors:bg-[Highlight]"
          style={style}
        />
      )}
      {options.map((o) => {
        const on = o.value === value;
        const off = disabled || o.disabled;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.title}
            disabled={off}
            onClick={() => onChange(o.value)}
            className={cn(
              "hit-area focus-ring z-10 cursor-pointer rounded-inner px-2.5 py-0.5 text-secondary font-semibold transition-colors duration-(--duration-hover) disabled:cursor-default",
              on ? "text-fg forced-colors:text-[HighlightText]" : "text-fg-meta hover:text-fg-body",
              o.disabled && !disabled && "opacity-40 hover:text-fg-meta",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number | null;
  disabled?: boolean;
}

const tabId = (prefix: string, value: string) => `${prefix}-tab-${value}`;
const panelId = (prefix: string, value: string) => `${prefix}-panel-${value}`;

/**
 * Underlined tabs; the ink bar slides to the selected tab. `scroll`: the row scrolls sideways
 * when it doesn't fit (no scrollbar); the ink then sits inside the bar, since anything hanging
 * below it would make the bar scroll vertically too.
 *
 * Keyboard (WAI-ARIA tabs): one Tab stop (the selected tab); Arrow Left/Right, Home and End move
 * and select. Pass `idPrefix` to wire the tabs to their panels: wrap each panel in
 * `<TabPanel idPrefix={…} value={…}>` (same prefix), which gets the matching id and aria-labelledby.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  scroll = false,
  idPrefix,
  disabled,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  className?: string;
  scroll?: boolean;
  /** Gives each tab an id and aria-controls pointing at `<TabPanel idPrefix value>`. */
  idPrefix?: string;
  /** Disables the whole row. */
  disabled?: boolean;
  /** Accessible name of the tab list. */
  label?: string;
}) {
  const { box, bar, style } = useSlidingIndicator('[aria-selected="true"]', 8, [value, items]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const enabled = items.filter((t) => !t.disabled && !disabled);
    if (!enabled.length) return;
    e.preventDefault();
    const at = enabled.findIndex((t) => t.value === value);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? enabled.length - 1 : e.key === "ArrowRight" ? (at + 1) % enabled.length : (at - 1 + enabled.length) % enabled.length;
    const target = enabled[next];
    box.current?.querySelector<HTMLButtonElement>(`[data-tab-value="${CSS.escape(target.value)}"]`)?.focus();
    if (target.value !== value) onChange(target.value);
  };

  return (
    <div
      ref={box}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("relative flex gap-0.5 border-b border-line", scroll && "overflow-x-auto overflow-y-hidden scrollbar-none", className)}
    >
      {items.map((t) => {
        const on = t.value === value;
        const off = disabled || t.disabled;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={idPrefix ? tabId(idPrefix, t.value) : undefined}
            aria-controls={idPrefix ? panelId(idPrefix, t.value) : undefined}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={off}
            data-tab-value={t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              // Inset ring: an outside ring would be clipped by the scrolling row.
              "focus-ring-inset flex cursor-pointer items-center gap-1.5 rounded-inner px-2.5 pt-2 pb-2.5 text-body font-medium transition-colors duration-(--duration-hover) disabled:cursor-default disabled:opacity-40",
              scroll && "shrink-0 whitespace-nowrap",
              on ? "text-fg" : "text-fg-meta hover:text-fg-body disabled:hover:text-fg-meta",
            )}
          >
            {t.label}
            {t.count ? <span className="rounded-inner bg-fg-muted/10 px-1.5 text-meta tabular-nums text-fg-muted">{t.count}</span> : null}
          </button>
        );
      })}
      {style && (
        <span
          ref={bar}
          aria-hidden
          className={cn("absolute left-0 h-0.5 rounded-full bg-select forced-colors:bg-[Highlight]", scroll ? "bottom-0" : "-bottom-px")}
          style={style}
        />
      )}
    </div>
  );
}

/** The panel for one tab of `<Tabs idPrefix>`: role=tabpanel, labelled by its tab, focusable. */
export const TabPanel: React.FC<{ idPrefix: string; value: string; className?: string; children?: React.ReactNode }> = ({ idPrefix, value, className, children }) => (
  <div role="tabpanel" id={panelId(idPrefix, value)} aria-labelledby={tabId(idPrefix, value)} tabIndex={0} className={cn("focus-ring rounded-inner", className)}>
    {children}
  </div>
);

/** A labelled "OTHERWISE" / "OR" divider between list entries. */
export const Divider: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("flex items-center gap-2 text-label uppercase text-fg-meta", className)}>
    <span className="h-px flex-1 bg-line" />
    {children}
    <span className="h-px flex-1 bg-line" />
  </div>
);

// Inputs: the well surface, a hover step on the boundary, the one focus ring, a problem border when
// invalid (aria-invalid, so callers that set it themselves get it too).
const field = cn(
  surface.well,
  "min-w-0 px-2.5 text-body text-fg placeholder:text-fg-meta transition-colors duration-(--duration-hover)",
  "enabled:hover:border-fg-meta focus-ring aria-invalid:border-problem aria-invalid:enabled:hover:border-problem",
  "disabled:cursor-not-allowed disabled:opacity-40",
  // iOS zooms into any focused field under 16px: phones get 16px text.
  "pointer-coarse:text-[16px]", // design-guard-ignore: iOS zooms into focused fields under 16px; not a type role
);

export interface KitFieldProps {
  /** Marks the value as wrong: aria-invalid plus a problem-coloured border. Say why in text nearby. */
  invalid?: boolean;
}

/** Text input in the kit style. */
export const KitInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & KitFieldProps>(({ className, invalid, ...rest }, ref) => (
  <input ref={ref} {...rest} aria-invalid={invalid || rest["aria-invalid"] || undefined} className={cn("h-8", field, className)} />
));
KitInput.displayName = "KitInput";

export const KitTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & KitFieldProps>(({ className, invalid, ...rest }, ref) => (
  <textarea ref={ref} {...rest} aria-invalid={invalid || rest["aria-invalid"] || undefined} className={cn("py-2", field, className)} />
));
KitTextarea.displayName = "KitTextarea";
