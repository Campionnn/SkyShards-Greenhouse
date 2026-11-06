/** Small building blocks shared by the Guide's panels. */
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CropImage } from "../shared/CropImage";
import { cn } from "../ui/cn";
import { IconButton, KitButton } from "../ui/kit";
import { PortalHost } from "../ui/Portal";

const CHIP_TONE = {
  default: "border-line-strong bg-surface-control text-fg-body",
  cost: "border-coin/30 bg-coin/10 text-fg",
  gain: "border-go/30 bg-go/10 text-fg",
  warn: "border-problem/30 bg-problem/10 text-fg",
  muted: "border-line bg-surface-well text-fg-muted",
} as const;

/** An item icon with a count: "[icon] 7× Dead Plant". */
export const ItemChip: React.FC<{ id: string; name: string; count?: number; tone?: keyof typeof CHIP_TONE; compact?: boolean; className?: string }> = ({
  id,
  name,
  count,
  tone = "default",
  compact = false,
  className,
}) => (
  <span
    className={cn("inline-flex min-w-0 items-center gap-1 rounded-inner border", CHIP_TONE[tone], compact ? "px-1 py-px text-meta" : "px-1.5 py-0.5 text-secondary", className)}
    title={name}
  >
    <CropImage cropId={id} cropName={name} width={compact ? 14 : 18} height={compact ? 14 : 18} showFallback={false} />
    {count !== undefined && <span className="font-semibold tabular-nums">{count.toLocaleString("en-US")}×</span>}
    <span className="truncate">{name}</span>
  </span>
);

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
  // Tooltips inside (FarmPicture cells, stat hints) portal into the dialog: it is in the top layer.
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    setHost(dialog);
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
      className={cn("guide-dialog", size === "md" && "guide-dialog-md")}
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
        <PortalHost container={host}>
          <div className="guide-root kit-fade-in flex h-full max-h-[inherit] flex-col overflow-hidden border-line-strong bg-surface-panel text-body text-fg-body shadow-raised sm:rounded-container sm:border">
            <header className="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-4 sm:pl-6">
              <h2 className="text-title text-fg">{title}</h2>
              <IconButton size="md" onClick={onClose} aria-label="Close" title="Close (Esc)">
                <X />
              </IconButton>
            </header>
            <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">{children}</div>
            {footer && <footer className="guide-safe-bottom border-t border-line px-4 pt-3 sm:px-6">{footer}</footer>}
          </div>
        </PortalHost>
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
}> = ({ value, onChange, label, min = 0, max, step = 1, live = false, integer = false, className }) => {
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
      className={cn(
        "focus-ring h-8 w-20 min-w-0 rounded-control border border-line-control bg-surface-well px-2.5 text-right text-body tabular-nums text-fg placeholder:text-fg-meta transition-colors duration-(--duration-hover) hover:border-fg-meta",
        className,
      )}
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
  className,
}) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  // The kit's danger button; armed, its border firms up and the label asks for the second click.
  return (
    <KitButton
      variant="danger"
      size="md"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
      title={armed ? "Click again to confirm" : title}
      aria-live="polite"
      className={cn(armed && "border-problem", className)}
    >
      {armed ? confirmLabel : children}
    </KitButton>
  );
};
