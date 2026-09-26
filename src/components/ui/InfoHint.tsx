import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Portal } from "./Portal";

interface InfoHintProps {
  /** Popover heading. */
  title?: React.ReactNode;
  /** Popover body. */
  children: React.ReactNode;
  /** Custom trigger; defaults to a small "?" icon. */
  trigger?: React.ReactNode;
  className?: string;
  /** Popover width in px. */
  width?: number;
  label?: string;
}

/**
 * Explanation popover: opens on hover (desktop) or tap (touch / keyboard),
 * rendered in a portal so sticky columns and overflow never clip it.
 */
export const InfoHint: React.FC<InfoHintProps> = ({
  title,
  children,
  trigger,
  className = "",
  width = 300,
  label = "More info",
}) => {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const id = useId();

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    const p = popRef.current?.getBoundingClientRect();
    if (!t) return;
    const pad = 8;
    const h = p?.height ?? 0;
    const w = Math.min(width, window.innerWidth - pad * 2);
    let top = t.bottom + 6;
    if (top + h > window.innerHeight - pad && t.top - h - 6 > pad) top = t.top - h - 6;
    let left = t.left + t.width / 2 - w / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    setPos({ top, left });
  }, [width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const update = () => place();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popRef.current?.contains(target)) {
        setPinned(false);
        setHover(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setHover(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const enter = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setHover(true);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setHover(false), 120);
  };

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPinned((p) => !p);
          }
        }}
        className={`inline-flex items-center cursor-help text-slate-500 hover:text-slate-300 focus:outline-none focus-visible:text-slate-200 ${className}`}
      >
        {trigger ?? <HelpCircle className="w-3.5 h-3.5" />}
      </span>
      {open && (
        <Portal>
          <div
            ref={popRef}
            id={id}
            role="tooltip"
            onMouseEnter={enter}
            onMouseLeave={leave}
            className="fixed z-[9999] bg-slate-800 border border-slate-600 rounded-md shadow-xl p-3 text-left"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: Math.min(width, typeof window !== "undefined" ? window.innerWidth - 16 : width),
            }}
          >
            {title && <div className="font-medium text-sm text-white mb-1.5">{title}</div>}
            <div className="text-slate-300 text-xs leading-relaxed space-y-2">{children}</div>
          </div>
        </Portal>
      )}
    </>
  );
};
