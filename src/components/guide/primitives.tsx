/** Small building blocks shared by the Guide's panels. */
import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { CropImage } from "../shared/CropImage";

/** An item icon with a count: "[icon] 7× Dead Plant". */
export const ItemChip: React.FC<{ id: string; name: string; count?: number; tone?: "default" | "cost" | "gain" | "warn" | "muted"; compact?: boolean }> = ({
  id,
  name,
  count,
  tone = "default",
  compact = false,
}) => {
  const tones = {
    default: "border-slate-600/60 bg-slate-800/80 text-slate-200",
    cost: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    gain: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    warn: "border-red-500/50 bg-red-500/10 text-red-100",
    muted: "border-slate-700/60 bg-slate-800/40 text-slate-400",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border ${tones[tone]} ${compact ? "px-1 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-xs"}`} title={name}>
      <CropImage cropId={id} cropName={name} width={compact ? 14 : 18} height={compact ? 14 : 18} showFallback={false} />
      {count !== undefined && <span className="font-semibold tabular-nums">{count.toLocaleString("en-US")}×</span>}
      <span className="truncate">{name}</span>
    </span>
  );
};

/**
 * A native modal dialog: Escape closes it, focus is trapped by the browser, and the page behind
 * does not scroll while it is open.
 */
export const Dialog: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }> = ({
  open,
  onClose,
  title,
  children,
  footer,
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="guide-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="guide-root flex h-full max-h-[inherit] flex-col overflow-hidden rounded-none border-slate-700 bg-slate-900 shadow-2xl sm:rounded-xl sm:border">
          <header className="flex items-center justify-between gap-3 border-b border-slate-700/70 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            <button type="button" onClick={onClose} className="guide-press rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
          {footer && <footer className="guide-safe-bottom border-t border-slate-700/70 px-4 pt-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
};

/** A whole-number input that tolerates an empty box while typing. */
export const NumberField: React.FC<{
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}> = ({ value, onChange, label, min = 0, max, step = 1, className = "" }) => (
  <input
    type="number"
    inputMode="numeric"
    aria-label={label}
    min={min}
    max={max}
    step={step}
    value={Number.isFinite(value) && value !== 0 ? value : ""}
    placeholder="0"
    onChange={(event) => {
      const raw = event.target.value.trim();
      const next = raw === "" ? 0 : Number(raw);
      if (Number.isFinite(next) && next >= min && (max === undefined || next <= max)) onChange(next);
    }}
    className={`w-20 rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-right tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-violet-400 focus:outline-none ${className}`}
  />
);

