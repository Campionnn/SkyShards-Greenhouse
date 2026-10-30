import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { InfoHint } from "./InfoHint";
import { surface } from "./surface";

// The result card: `surface.card` with 16px padding and a one-line header (text-body semibold
// title, a "?" InfoHint for the explanation, text-secondary meta, actions on the right).
// Conventions: docs/design-system/ (components.md "Card"): no icons in titles, no eyebrow labels,
// explanations live in the hint, subtitles only carry data.

export interface CardProps {
  title: React.ReactNode;
  /** The explanation (opens from the "?" next to the title). */
  hint?: React.ReactNode;
  /** Heading of the hint popover (default: the title, when it is a string). */
  hintTitle?: React.ReactNode;
  hintWidth?: number;
  /** Data next to the title ("3 seeds · 2000 cycles", "16 · first at cycle 54"). */
  meta?: React.ReactNode;
  /** Controls on the right (a Segmented, a button). */
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name when the title is not plain text. */
  label?: string;
  children?: React.ReactNode;
}

const hasMeta = (meta: React.ReactNode) => meta !== undefined && meta !== null && meta !== false;

export const Card: React.FC<CardProps> = ({ title, hint, hintTitle, hintWidth = 300, meta, actions, className, bodyClassName, label, children }) => (
  <section className={cn(surface.card, "min-w-0 p-4", className)} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
    <header className={cn("flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1.5", children ? "mb-3" : null)}>
      <h3 className="text-body font-semibold text-fg">{title}</h3>
      {hint && (
        <InfoHint title={hintTitle ?? (typeof title === "string" ? title : undefined)} width={hintWidth}>
          {hint}
        </InfoHint>
      )}
      {hasMeta(meta) && <span className="min-w-0 text-secondary tabular-nums text-fg-meta">{meta}</span>}
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
    </header>
    {children !== undefined && <div className={cn("min-w-0", bodyClassName)}>{children}</div>}
  </section>
);

/**
 * A card that opens and closes (a native <details>, collapsed by default): the whole header is
 * the toggle. For secondary lists (placed items, losses) whose meta line already says enough.
 */
export const DisclosureCard: React.FC<Omit<CardProps, "actions" | "hint" | "hintTitle" | "hintWidth"> & { defaultOpen?: boolean }> = ({
  title,
  meta,
  className,
  bodyClassName,
  defaultOpen,
  children,
}) => (
  <details className={cn("group", surface.card, "min-w-0", className)} open={defaultOpen}>
    <summary className="focus-ring flex min-h-[60px] cursor-pointer list-none items-center gap-2 rounded-container px-4 py-4 transition-colors duration-(--duration-hover) hover:bg-surface-hover/40 [&::-webkit-details-marker]:hidden">
      <span className="text-body font-semibold text-fg">{title}</span>
      {hasMeta(meta) && <span className="min-w-0 text-secondary tabular-nums text-fg-meta">{meta}</span>}
      <ChevronDown aria-hidden className="ml-auto size-3.5 shrink-0 text-fg-meta transition-transform duration-(--duration-ink) ease-snappy group-open:rotate-180" />
    </summary>
    <div className={cn("min-w-0 px-4 pb-4", bodyClassName)}>{children}</div>
  </details>
);

/** A quiet text button ("Per plot", "Expand all", "Set online to every 2"): underlined, muted. */
export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, type = "button", ...rest }) => (
  <button
    type={type}
    className={cn(
      "hit-area focus-ring cursor-pointer rounded-inner text-secondary text-fg-body underline decoration-fg-meta underline-offset-[3px] transition-colors duration-(--duration-hover)",
      "enabled:hover:text-fg enabled:hover:decoration-fg-muted active:text-fg-muted disabled:cursor-default disabled:opacity-40",
      className,
    )}
    {...rest}
  />
);

/** "label value" facts under a card ("Cycle 1h 45m · 13.7 cycles/day"). */
export const Fact: React.FC<{ label?: React.ReactNode; value: React.ReactNode; suffix?: React.ReactNode; title?: string; tone?: "bad" }> = ({ label, value, suffix, title, tone }) => (
  <span className="whitespace-nowrap text-secondary text-fg-meta" title={title}>
    {label && <>{label} </>}
    <b className={cn("font-semibold tabular-nums", tone === "bad" ? "text-problem" : "text-fg-body")}>{value}</b>
    {suffix && <> {suffix}</>}
  </span>
);
