import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "./cn";
import { Portal } from "./Portal";
import { surface } from "./surface";

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
  /** Accessible name of the trigger. */
  label?: string;
}

/** Hover intent: how long the pointer must rest on the trigger before the hint opens. */
const OPEN_DELAY = 200;
/** Grace period for moving the pointer from the trigger into the hint (or back). */
const CLOSE_DELAY = 150;
/** A hint opened within this long after another closed opens at once, without animating. */
const INSTANT_WINDOW = 400;
let lastClosedAt = 0;

/**
 * Explanation popover (a "toggletip"): opens after a short hover on a fine pointer, toggles on
 * click / tap / Enter / Space, closes on Escape, outside press or leaving the trigger. Rendered in a
 * portal so sticky columns and overflow never clip it; inside a modal <dialog> it renders there.
 */
export const InfoHint: React.FC<InfoHintProps> = ({ title, children, trigger, className, width = 300, label = "More info" }) => {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [instant, setInstant] = useState(false);
  const open = hover || pinned;
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const id = useId();

  const clearTimers = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const close = useCallback(() => {
    setPinned(false);
    setHover(false);
  }, []);

  // Remember when the last hint closed, so moving along a row of hints doesn't wait each time.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) lastClosedAt = Date.now();
    wasOpen.current = open;
  }, [open]);

  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect();
    const p = popRef.current?.getBoundingClientRect();
    if (!t) return;
    const pad = 8;
    const gap = 6;
    const h = p?.height ?? 0;
    const w = Math.min(width, window.innerWidth - pad * 2);
    let top = t.bottom + gap;
    const above = top + h > window.innerHeight - pad && t.top - h - gap > pad;
    if (above) top = t.top - h - gap;
    let left = t.left + t.width / 2 - w / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    // Scale in from the trigger, not from the hint's centre.
    const originX = Math.round(t.left + t.width / 2 - left);
    setPos({ top, left, origin: `${originX}px ${above ? "100%" : "0"}` });
  }, [width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const update = () => place();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popRef.current?.contains(target)) close();
    };
    // Capture phase, and preventDefault, so an Escape that closes this hint doesn't also close the
    // drawer, popover or dialog it sits in (those ignore already-handled keys).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, place, close]);

  // Inside a modal <dialog> (top layer) the popover must render in that dialog, not <body>.
  // Dialogs provide themselves through PortalHost; this also covers one that doesn't.
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setHost(triggerRef.current?.closest("dialog") ?? null);
  }, []);

  // Hover only for mouse / pen: a touch "hover" would open the hint and the tap would close it again.
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (open) return;
    if (Date.now() - lastClosedAt < INSTANT_WINDOW) {
      setInstant(true);
      setHover(true);
      return;
    }
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      setInstant(false);
      setHover(true);
    }, OPEN_DELAY);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHover(false), CLOSE_DELAY);
  };
  // Click / Enter pins the hint (a hover-opened one stays put); a second press closes it.
  const toggle = () => {
    clearTimers();
    if (pinned) close();
    else {
      if (!open) setInstant(false);
      setPinned(true);
    }
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
        onPointerEnter={enter}
        onPointerLeave={leave}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }
        }}
        onBlur={(e) => {
          if (!popRef.current?.contains(e.relatedTarget as Node | null)) setPinned(false);
        }}
        className={cn(
          "hit-area focus-ring inline-flex shrink-0 cursor-help items-center rounded-full text-fg-meta transition-colors duration-(--duration-hover) hover:text-fg-body aria-expanded:text-fg-body",
          className
        )}
      >
        {trigger ?? <HelpCircle className="h-3.5 w-3.5" aria-hidden />}
      </span>
      {open && (
        <Portal container={host}>
          <div
            ref={popRef}
            id={id}
            role="tooltip"
            // Focusable (not tabbable) so clicking into the hint, e.g. to select text, keeps it open.
            tabIndex={-1}
            onPointerEnter={enter}
            onPointerLeave={leave}
            className={cn(surface.raised, "fixed z-(--z-tooltip) p-3 text-left outline-none", !instant && "kit-pop-in")}
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              transformOrigin: pos?.origin,
              width: Math.min(width, typeof window !== "undefined" ? window.innerWidth - 16 : width),
            }}
          >
            {title && <div className="mb-1 text-body font-semibold text-fg">{title}</div>}
            <div className="space-y-2 text-secondary text-fg-muted">{children}</div>
          </div>
        </Portal>
      )}
    </>
  );
};
