import React from "react";
import { ChevronDown } from "lucide-react";
import { InfoHint } from "../../ui";
import { surface } from "../../ui/surface";

// The simulator page's result card: `surface.card` with 16px padding and a one-line header
// (13px semibold title, a "?" InfoHint for the explanation, 12px slate-500 meta, actions on the
// right). Conventions: docs/simulator/UI-CONVENTIONS.md and docs/plans/simulator-page-revamp.md:
// no icons in titles, no eyebrow labels, explanations live in the hint, subtitles only for data.

export interface ResultCardProps {
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

export const ResultCard: React.FC<ResultCardProps> = ({ title, hint, hintTitle, hintWidth = 300, meta, actions, className = "", bodyClassName = "", label, children }) => (
  <section className={`${surface.card} min-w-0 p-4 ${className}`} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
    <header className={`flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1.5 ${children ? "mb-3" : ""}`}>
      <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
      {hint && (
        <InfoHint title={hintTitle ?? (typeof title === "string" ? title : undefined)} width={hintWidth}>
          {hint}
        </InfoHint>
      )}
      {meta !== undefined && meta !== null && meta !== false && <span className="min-w-0 text-[12px] tabular-nums text-slate-500">{meta}</span>}
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">{actions}</div>}
    </header>
    {children !== undefined && <div className={`min-w-0 ${bodyClassName}`}>{children}</div>}
  </section>
);

/**
 * A card that opens and closes (a native <details>, collapsed by default): the whole header is
 * the toggle. For secondary lists (placed items, losses) whose meta line already says enough.
 */
export const DisclosureCard: React.FC<Omit<ResultCardProps, "actions" | "hint" | "hintTitle" | "hintWidth"> & { defaultOpen?: boolean }> = ({
  title,
  meta,
  className = "",
  bodyClassName = "",
  defaultOpen,
  children,
}) => (
  <details className={`group ${surface.card} min-w-0 ${className}`} open={defaultOpen}>
    <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-4 transition-colors duration-150 hover:bg-slate-700/20 focus-visible:outline-2 focus-visible:outline-emerald-400/70 [&::-webkit-details-marker]:hidden">
      <span className="text-[13px] font-semibold text-slate-100">{title}</span>
      {meta !== undefined && meta !== null && meta !== false && <span className="min-w-0 text-[12px] tabular-nums text-slate-500">{meta}</span>}
      <ChevronDown aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-200 ease-snappy group-open:rotate-180" />
    </summary>
    <div className={`min-w-0 px-4 pb-4 ${bodyClassName}`}>{children}</div>
  </details>
);

/** A quiet text button ("Per plot", "Expand all", "Set online to every 2"): underlined, slate. */
export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = "", type = "button", ...rest }) => (
  <button
    type={type}
    className={`cursor-pointer text-[12px] text-slate-300 underline decoration-slate-600 underline-offset-[3px] transition-colors duration-150 hover:text-slate-100 hover:decoration-slate-400 disabled:cursor-default disabled:opacity-40 ${className}`}
    {...rest}
  />
);

/** "label value" facts under a card ("Cycle 1h 45m · 13.7 cycles/day"). */
export const Fact: React.FC<{ label?: React.ReactNode; value: React.ReactNode; suffix?: React.ReactNode; title?: string; tone?: "bad" }> = ({ label, value, suffix, title, tone }) => (
  <span className="whitespace-nowrap text-[12px] text-slate-500" title={title}>
    {label && <>{label} </>}
    <b className={`font-semibold tabular-nums ${tone === "bad" ? "text-red-300" : "text-slate-200"}`}>{value}</b>
    {suffix && <> {suffix}</>}
  </span>
);
