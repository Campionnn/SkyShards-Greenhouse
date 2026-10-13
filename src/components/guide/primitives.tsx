/** Small building blocks shared by the Guide's panels. */
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CropImage } from "../shared/CropImage";
import { inputClass } from "./format";

/** An item icon with a count: "[icon] 7× Dead Plant". */
export const ItemChip: React.FC<{ id: string; name: string; count?: number; tone?: "default" | "cost" | "gain" | "warn" | "muted"; compact?: boolean }> = ({
  id,
  name,
  count,
  tone = "default",
  compact = false,
}) => {
  const tones = {
    default: "border-slate-600/40 bg-slate-700/40 text-slate-200",
    cost: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    gain: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    warn: "border-red-500/30 bg-red-500/10 text-red-200",
    muted: "border-slate-600/30 bg-slate-800/40 text-slate-400",
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
 * A native modal dialog in the app's modal style (Save / Load layout, Export flows): Escape closes
 * it, focus stays inside, and the page behind does not scroll while it is open.
 */
export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Narrow dialogs (settings) vs wide ones (inventory, farm gallery). */
  size?: "md" | "lg";
}> = ({ open, onClose, title, children, footer, size = "lg" }) => {
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
      className={`guide-dialog ${size === "md" ? "guide-dialog-md" : ""}`}
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
        <div className="guide-root flex h-full max-h-[inherit] flex-col overflow-hidden border-slate-700 bg-slate-900 text-slate-200 shadow-2xl sm:rounded-xl sm:border">
          <header className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-6 sm:py-4">
            <h2 className="text-base font-semibold text-slate-100 sm:text-lg">{title}</h2>
            <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">{children}</div>
          {footer && <footer className="guide-safe-bottom border-t border-slate-700 px-4 pt-3 sm:px-6">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
};

/**
 * A number input that keeps what the player types and only commits a valid number when they leave
 * the field or press Enter, so typing "24" never passes through "2", and a lone "-" or "" doesn't
 * zero the value. With `live`, valid values are also committed while typing (inventory amounts).
 */
export const NumberField: React.FC<{
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Commit every valid keystroke, not just on blur. */
  live?: boolean;
  /** Round to a whole number on commit. */
  integer?: boolean;
  className?: string;
}> = ({ value, onChange, label, min = 0, max, step = 1, live = false, integer = false, className = "" }) => {
  const shown = Number.isFinite(value) && value !== 0 ? String(value) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (raw: string): number | null => {
    const text = raw.trim();
    if (text === "") return 0;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    const v = integer ? Math.floor(n) : n;
    return Math.min(max ?? Infinity, Math.max(min, v));
  };
  const commit = () => {
    if (draft === null) return;
    const v = parse(draft);
    setDraft(null);
    if (v !== null && v !== value) onChange(v);
  };
  return (
    <input
      type="text"
      inputMode={integer || step >= 1 ? "numeric" : "decimal"}
      aria-label={label}
      value={draft ?? shown}
      placeholder="0"
      onFocus={(e) => e.target.select()}
      onChange={(event) => {
        const raw = event.target.value;
        if (!/^\s*-?\d*([.,]\d*)?\s*$/.test(raw)) return;
        setDraft(raw.replace(",", "."));
        if (live) {
          const v = parse(raw.replace(",", "."));
          if (v !== null && raw.trim() !== "" && raw.trim() !== "-") onChange(v);
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const base = parse(draft ?? shown) ?? value;
          const next = Math.min(max ?? Infinity, Math.max(min, Math.round((base + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000));
          setDraft(null);
          onChange(next);
        }
      }}
      className={`${inputClass} w-20 text-right tabular-nums ${className}`}
    />
  );
};

/**
 * A destructive button that asks for a second click instead of a browser popup, like the
 * Designer's "Clear all" and the saved-layout delete: the first click arms it ("Click again to
 * confirm"), leaving the button or waiting a few seconds disarms it.
 */
export const ConfirmButton: React.FC<{ onConfirm: () => void; children: React.ReactNode; confirmLabel?: React.ReactNode; title?: string; className?: string }> = ({
  onConfirm,
  children,
  confirmLabel = "Click again to confirm",
  title,
  className = "",
}) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
      title={armed ? "Click again to confirm" : title}
      aria-live="polite"
      className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
        armed ? "border-red-500 bg-red-500/80 text-white hover:bg-red-500" : "border-slate-600/50 bg-slate-800/60 text-slate-300 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
      } ${className}`}
    >
      {armed ? confirmLabel : children}
    </button>
  );
};
