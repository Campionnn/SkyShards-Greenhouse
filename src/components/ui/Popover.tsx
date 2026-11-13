import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { floatingLayers, focusablesIn, focusMenuItem, focusNextAfter, insideLayerAbove, MENU_ITEM, menuNavigate, menuRowClass } from "./contextMenuContext";
import { placeBeside } from "./hintPosition";
import { Portal } from "./Portal";
import { surface } from "./surface";

// Shared floating pieces (flow editor inspector, simulator page chips and menus): an anchored popover (rendered into <body> so the inspector's
// scroll area never clips it), menus inside it and a dropdown button that owns one. Popovers scale
// in from their trigger (kit-pop-in, transform-origin at the anchor) and close on Escape, outside
// press or choosing an item. Nothing here touches window/document during render (SSR-safe).
//
// Keyboard (docs/design-system/components.md "Popover"):
// - role="menu": once the panel is placed, focus goes to the checked item (or the first; the last
//   when opened with ArrowUp). Arrows / Home / End move with a roving tabindex, a letter jumps to the
//   next item starting with it, Enter / Space choose, Tab closes and moves on from the trigger,
//   Escape closes and focuses the trigger.
// - role="dialog": focus moves into the content (its first control when opened from the keyboard;
//   the panel itself when opened with a pointer, so a phone keyboard doesn't pop up), Tab cycles
//   inside the popover, Escape closes and focuses the trigger.
// - Closing while focus is inside puts it back on the trigger. Escape and outside presses belong to
//   the topmost floating layer, so a menu opened inside a popover closes on its own.
// - A control marked `data-autofocus` in the content takes the first focus (Share: the link field),
//   unless `initialFocus` says otherwise. (`autoFocus` can't work: the panel is hidden until placed.)
//
// side="right" (a rail's popovers): the panel opens beside the anchor, or beside `beside` (the whole
// rail) when given, its top level with the anchor but clamped so the bottom stays in the window, at
// most the window's height less the margins (the body scrolls). Without room beside it (a phone) it
// opens under the anchor, clamped the same way. It re-places when its content grows.

export interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** Accessible name of the popover. */
  label: string;
  /** "bottom" (default): under the anchor, flipping above. "right": beside the anchor / `beside`. */
  side?: "bottom" | "right";
  /** side="right": open beside this element (a rail) instead of the anchor, so it clears all of it. */
  beside?: HTMLElement | null;
  align?: "start" | "end";
  width?: number;
  /** Height the content may grow to below its top (an item list that opens under a search box). */
  reserve?: number;
  role?: "menu" | "dialog";
  /** No surface of its own (the content brings one). */
  bare?: boolean;
  /** Where focus goes once the popover is shown. Default "auto" (see above); "none" leaves it to the content. */
  initialFocus?: "auto" | "first" | "last" | "none";
  className?: string;
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = (props) => {
  useEffect(trackInput, []);
  return props.open && props.anchor ? <PopoverBody {...props} anchor={props.anchor} /> : null;
};

/**
 * Whether `node` is inside a modal <dialog> that doesn't contain the popover: one opened from the
 * popover's content (the Player popover's "Import from Hypixel"). The dialog is portaled to <body>,
 * so a press in it looks "outside" — closing the popover would unmount the dialog with it.
 */
const inDialogAbove = (popover: HTMLElement | null, node: Node | null) => {
  const dialog = node instanceof Element ? node.closest("dialog[open]") : node?.parentElement?.closest("dialog[open]");
  return !!dialog && !!popover && !dialog.contains(popover);
};

const MARGIN = 8;
const MENU_MAX = 420;

// Was the popover opened with the keyboard? `:focus-visible` on the trigger is not enough: it stays
// true when a keyboard-focused trigger is then clicked. So remember the last kind of input instead.
let lastInput: "key" | "pointer" = "pointer";
let tracking = false;
function trackInput() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener("keydown", () => (lastInput = "key"), true);
  document.addEventListener("pointerdown", () => (lastInput = "pointer"), true);
}

const PopoverBody: React.FC<PopoverProps & { anchor: HTMLElement }> = ({
  anchor,
  onClose,
  label,
  side = "bottom",
  beside,
  align = "start",
  width,
  reserve,
  role = "dialog",
  bare,
  initialFocus = "auto",
  className,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const toSide = side === "right";
  const [pos, setPos] = useState<{ top: number; left: number; origin: string; maxHeight?: number } | null>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  const typeahead = useRef({ text: "", at: 0 });
  // Read once, at open: was it opened from the keyboard?
  const [fromKeyboard] = useState(() => lastInput === "key");

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    // Natural height (not the capped one from a previous placement); menus stop at MENU_MAX.
    const natural = Math.min(el.scrollHeight + 2, role === "menu" ? MENU_MAX : Infinity);
    const h = Math.max(natural, reserve ?? 0);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (toSide) {
      const right = placeBeside(r, (beside ?? anchor).getBoundingClientRect(), { width: w, height: natural }, vw, vh, MARGIN);
      if (right) return setPos(right);
      // No room beside (a phone): under the anchor, clamped so the bottom stays on screen.
      const maxHeight = Math.max(0, vh - MARGIN * 2);
      const left = Math.min(Math.max(MARGIN, r.left), vw - w - MARGIN);
      const top = Math.max(MARGIN, Math.min(r.bottom + 4, vh - MARGIN - Math.min(natural, maxHeight)));
      return setPos({ top, left, maxHeight, origin: `${Math.round(Math.min(Math.max(r.left + r.width / 2 - left, 0), w))}px 0px` });
    }
    let left = align === "end" ? r.right - w : r.left;
    left = Math.min(Math.max(MARGIN, left), vw - w - MARGIN);
    const below = vh - MARGIN - (r.bottom + 4);
    const aboveRoom = r.top - 4 - MARGIN;
    // `reserve`: the content (a search box) covers the trigger and grows downwards.
    let top = reserve ? r.top - 5 : r.bottom + 4;
    let above = false;
    let maxHeight: number | undefined;
    if (reserve) top = Math.max(MARGIN, Math.min(top, vh - MARGIN - h));
    else if (h > below) {
      if (h <= aboveRoom || aboveRoom > below) {
        // Flip above the trigger; cap the height when even that side is short.
        above = true;
        maxHeight = h > aboveRoom ? aboveRoom : undefined;
        top = r.top - 4 - Math.min(h, aboveRoom);
      } else maxHeight = below;
    }
    const ox = Math.min(Math.max(r.left + Math.min(r.width / 2, 24) - left, 0), w);
    setPos({ top, left, maxHeight, origin: `${Math.round(ox)}px ${above ? "100%" : "0px"}` });
  }, [anchor, beside, toSide, align, reserve, role]);

  useLayoutEffect(() => place(), [place]);

  // side="right" content changes height (an export preview renders): keep the bottom on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!toSide || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [toSide, place]);

  // One stack of floating layers; closing with focus inside returns it to the trigger. Layout
  // effect cleanup runs before React removes the panel, so focus is still readable here.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    floatingLayers.push(el);
    return () => {
      floatingLayers.splice(floatingLayers.indexOf(el), 1);
      if (el.contains(document.activeElement) && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const el = ref.current;
      if (!el || el.contains(t) || anchor.contains(t) || insideLayerAbove(el, t) || inDialogAbove(el, t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      // One Escape closes the top popover, even when its content (an item search) also handled it.
      // A modal opened from inside this popover owns its own Escape.
      if (e.key !== "Escape" || floatingLayers[floatingLayers.length - 1] !== ref.current || inDialogAbove(ref.current, e.target as Node)) return;
      e.preventDefault();
      anchor.focus({ preventScroll: true });
      closeRef.current();
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [anchor, place]);

  // Move focus in once the panel is placed: before that it is visibility: hidden and can't take focus.
  const placed = pos !== null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!placed || !el || initialFocus === "none") return;
    if (role === "menu") {
      const items = [...el.querySelectorAll<HTMLElement>(MENU_ITEM)];
      const checked = items.findIndex((it) => it.getAttribute("aria-checked") === "true");
      if (items.length) focusMenuItem(items, initialFocus === "last" ? items.length - 1 : checked >= 0 && initialFocus !== "first" ? checked : 0);
      else el.focus({ preventScroll: true });
      return;
    }
    // Content that already moved focus inside (an autofocused search box) keeps it.
    if (el.contains(document.activeElement)) return;
    const marked = initialFocus === "auto" ? el.querySelector<HTMLElement>("[data-autofocus]") : null;
    if (marked) return void marked.focus({ preventScroll: true });
    const controls = focusablesIn(el);
    const pick = initialFocus === "first" || (initialFocus === "auto" && fromKeyboard) ? controls[0] : initialFocus === "last" ? controls[controls.length - 1] : null;
    (pick ?? el).focus({ preventScroll: true });
    // Only once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = ref.current;
    // React bubbles keys from a nested popover (another portal) through here: not ours.
    if (!el || !el.contains(e.target as Node)) return;
    if (role === "menu") {
      if (e.key === "Tab") {
        e.preventDefault();
        focusNextAfter(anchor, e.shiftKey);
        closeRef.current();
        return;
      }
      menuNavigate(e, el, typeahead.current);
      return;
    }
    if (e.key !== "Tab") return;
    // Dialog: Tab cycles inside the popover (it is not modal; Escape or an outside press leaves).
    const controls = focusablesIn(el);
    if (!controls.length) {
      e.preventDefault();
      return;
    }
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) {
      e.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!e.shiftKey && (at === -1 || at === controls.length - 1)) {
      e.preventDefault();
      controls[0].focus();
    }
  };

  return (
    <Portal>
      <div
        ref={ref}
        role={role}
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // React events bubble through portals to the trigger's ancestors (an exit card's header);
        // a click inside the popover belongs to the popover only.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "kit-pop-in fixed outline-none",
          role === "menu" ? "z-(--z-menu)" : "z-(--z-popover)",
          !bare && `${surface.raised} p-1`,
          toSide && "scrollbar-dark overflow-y-auto overscroll-contain",
          className,
        )}
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          width: width === undefined ? undefined : `min(${width}px, calc(100vw - ${MARGIN * 2}px))`,
          maxHeight: pos?.maxHeight ?? (role === "menu" ? MENU_MAX : undefined),
          transformOrigin: pos?.origin,
          visibility: pos ? undefined : "hidden",
        }}
      >
        {children}
      </div>
    </Portal>
  );
};

/** One entry of a menu. `checked` makes it a radio item with a tick. */
export const MenuItem: React.FC<{
  onSelect: () => void;
  checked?: boolean;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "danger";
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}> = ({ onSelect, checked, icon, hint, tone, disabled, title, children }) => (
  <button
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemradio"}
    aria-checked={checked}
    disabled={disabled}
    title={title}
    onClick={onSelect}
    className={menuRowClass(tone === "danger")}
  >
    {icon !== undefined && <span className="grid h-5 w-5 shrink-0 place-items-center text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
    <span className="min-w-0 flex-1">
      <span className="block truncate">{children}</span>
      {hint && <span className="block text-meta text-fg-meta">{hint}</span>}
    </span>
    {checked && <Check className="h-3.5 w-3.5 shrink-0 text-select-fg" />}
  </button>
);

export const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2 pt-2 pb-1 text-label uppercase text-fg-meta first:pt-1">{children}</div>
);

export const MenuSeparator: React.FC = () => <div role="separator" className="mx-1 my-1 h-px bg-line" />;

const DROPDOWN_LOOK = {
  /** A recessed select-like field ("Go to [step ▾]"). 26px tall to sit in a 28px row. */
  field:
    "inline-flex h-[26px] min-w-0 max-w-full items-center gap-1.5 rounded-control border border-line-control bg-surface-well pl-1.5 pr-2 text-body font-medium text-fg transition-colors duration-(--duration-hover) hover:bg-surface-panel",
  /** An inline token inside a condition sentence (22px: one line of a 13px sentence). */
  token:
    "inline-flex h-[22px] max-w-full items-center gap-1 rounded-inner bg-surface-hover px-1.5 align-middle font-medium text-fg ring-1 ring-line-strong ring-inset transition-colors duration-(--duration-hover) hover:ring-line-control",
  /** Caller styles the whole button (e.g. a list row). */
  plain: "",
} as const;

/** A button that opens a menu under it. `children` renders the menu; call `close` after choosing. */
export const Dropdown: React.FC<{
  label: string;
  button: React.ReactNode;
  look?: keyof typeof DROPDOWN_LOOK;
  chevron?: boolean;
  title?: string;
  width?: number;
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}> = ({ label, button, look = "field", chevron = true, title, width = 260, align = "start", className, menuClassName, disabled, children }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<false | "auto" | "last">(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => (o ? false : "auto"))}
        onKeyDown={(e) => {
          // A menu button also opens with the arrows (ArrowUp lands on the last item).
          if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          setOpen(e.key === "ArrowUp" ? "last" : "auto");
        }}
        className={cn("cursor-pointer focus-ring disabled:cursor-default disabled:opacity-50", DROPDOWN_LOOK[look], className)}
      >
        {button}
        {chevron && <ChevronDown className={cn("h-3 w-3 shrink-0 text-fg-meta transition-transform duration-(--duration-ink) ease-snappy", open && "rotate-180")} />}
      </button>
      <Popover
        anchor={anchor}
        open={!!open}
        onClose={close}
        label={label}
        role="menu"
        width={width}
        align={align}
        initialFocus={open === "last" ? "last" : "auto"}
        className={cn("overflow-y-auto overscroll-contain scrollbar-dark", menuClassName)}
      >
        {children(close)}
      </Popover>
    </>
  );
};
