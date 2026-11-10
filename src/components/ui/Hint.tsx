import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { placeTooltip, type TooltipSide } from "./hintPosition";
import { Kbd } from "./kit";
import { Portal } from "./Portal";

// KitTooltip: the name of a control, its shortcut as Kbd chips and one optional line of hint, on
// hover and keyboard focus (docs/design-system/components.md "KitTooltip"). For an explanation use
// InfoHint; for a plain name a native `title` is still fine. The legacy ui/Tooltip.tsx is separate.
//
// - Hover (mouse / pen) opens it after OPEN_DELAY; moving along a row of tooltips opens the next
//   one at once. Keyboard focus (:focus-visible) opens it at once. Touch never opens it.
// - Pointer leave, a press anywhere, blur and Escape close it. Escape is not consumed: the same
//   key still stops placing, closes the popover or the dialog underneath.
// - It never takes focus (pointer-events none, not focusable); the trigger gets aria-describedby
//   while it shows. A trigger with aria-expanded="true" (its popover is open) shows none.
// - The wrapper span owns the events, so a disabled button (no pointer events) still explains
//   itself. Give the wrapper the layout classes the button had (`className`, e.g. "w-full").
// - The trigger's native `title` is dropped on first hover (it would show a second tooltip).
// - Portal: into the nearest modal <dialog> (top layer), else PortalHost / <body>. z-(--z-tooltip).
// - Scales in from the trigger (kit-pop-in; reduced motion: a fade); no animation when it opens
//   at once along a row.

export interface KitTooltipProps {
  /** The control's name ("Undo"). */
  label: string;
  /** Shortcut keys, each a Kbd chip: ["Ctrl", "Z"]. */
  kbd?: string[];
  /** One meta line under the name ("Something would leave the grid"). */
  hint?: React.ReactNode;
  /** Preferred side; it flips when there is no room. Default "bottom". */
  side?: TooltipSide;
  /** Show nothing (e.g. while the trigger's own menu is open). */
  disabled?: boolean;
  /** Classes for the wrapper span (it is inline-flex min-w-0). */
  className?: string;
  /** The trigger. */
  children: React.ReactNode;
}

/** Hover intent before a tooltip opens. */
const OPEN_DELAY = 300;
/** A tooltip opened within this long after another closed opens at once, without animating. */
const INSTANT_WINDOW = 400;
let lastClosedAt = 0;

const ORIGIN: Record<TooltipSide | "left", string> = { bottom: "50% 0%", top: "50% 100%", right: "0% 50%", left: "100% 50%" };

const isFocusVisible = (el: Element) => {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
};

export const KitTooltip: React.FC<KitTooltipProps> = ({ label, kbd, hint, side = "bottom", disabled, className, children }) => {
  const box = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const id = useId();
  // `host`: the modal dialog the trigger sits in, read when it opens.
  const [shown, setShown] = useState<{ instant: boolean; host: Element | null } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: TooltipSide | "left" } | null>(null);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const show = useCallback(
    (instant: boolean) => {
      const el = box.current;
      if (!el || disabled) return;
      if (el.firstElementChild?.getAttribute("aria-expanded") === "true") return;
      setShown({ instant, host: el.closest("dialog") });
    },
    [disabled],
  );
  // Whether it is showing, readable inside event handlers of the same tick.
  const open = useRef(false);
  useLayoutEffect(() => {
    open.current = !!shown;
  });
  const hide = useCallback(() => {
    clear();
    // Remember when it closed (now, not after a render: leaving one trigger and entering the next
    // is one pointer move), so the next tooltip along a row opens at once.
    if (open.current) lastClosedAt = Date.now();
    open.current = false;
    setShown(null);
    setPos(null);
  }, []);

  // Turned off while open (its menu opened): close.
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  const place = useCallback(() => {
    const el = box.current;
    const tip = tipRef.current;
    if (!el || !tip) return;
    setPos(placeTooltip(el.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight }, side, window.innerWidth, window.innerHeight));
  }, [side]);

  useLayoutEffect(() => {
    if (shown) place();
  }, [shown, place]);

  // The trigger (the wrapper's first element) is described by the tooltip while it shows.
  const shownNow = !!shown;
  useLayoutEffect(() => {
    const t = (box.current?.firstElementChild as HTMLElement | null) ?? box.current;
    if (!shownNow || !t) return;
    const before = t.getAttribute("aria-describedby");
    t.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      const rest = (t.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== id);
      if (rest.length) t.setAttribute("aria-describedby", rest.join(" "));
      else t.removeAttribute("aria-describedby");
    };
  }, [shownNow, id]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onDown = () => hide();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shown, hide, place]);

  return (
    <span
      ref={box}
      className={cn("inline-flex min-w-0", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch" || open.current) return;
        clear();
        // A native title (IconButton sets one from its aria-label) would pop up a second tooltip after a
        // second of hover: drop it. React only rewrites it if the prop changes; this tooltip says more.
        box.current?.firstElementChild?.removeAttribute("title");
        if (Date.now() - lastClosedAt < INSTANT_WINDOW) show(true);
        else timer.current = window.setTimeout(() => show(false), OPEN_DELAY);
      }}
      onPointerLeave={hide}
      onFocus={(e) => {
        if (isFocusVisible(e.target)) show(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
      }}
    >
      {children}
      {shown && (
        <Portal container={shown.host}>
          <span
            ref={tipRef}
            role="tooltip"
            id={id}
            className={cn(
              "pointer-events-none fixed z-(--z-tooltip) block max-w-64 rounded-control border border-line-strong bg-surface-raised px-2.5 py-1.5 text-left shadow-raised",
              !shown.instant && "kit-pop-in",
            )}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, transformOrigin: pos ? ORIGIN[pos.side] : undefined, visibility: pos ? undefined : "hidden" }}
          >
            <span className="flex items-center gap-2 text-secondary font-medium text-fg">
              <span className="min-w-0">{label}</span>
              {kbd && kbd.length > 0 && (
                <span className="flex shrink-0 items-center gap-0.5">
                  {kbd.map((k, i) => (
                    <Kbd key={`${k}-${i}`}>{k}</Kbd>
                  ))}
                </span>
              )}
            </span>
            {hint && <span className="mt-0.5 block text-meta text-fg-meta">{hint}</span>}
          </span>
        </Portal>
      )}
    </span>
  );
};
