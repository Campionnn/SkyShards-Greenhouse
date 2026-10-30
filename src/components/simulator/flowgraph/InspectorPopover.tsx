import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Portal } from "../../ui";
import { surface } from "../../ui/surface";

// Floating pieces of the inspector: an anchored popover (rendered into <body> so the inspector's
// scroll area never clips it), menus inside it and a dropdown button that owns one. Popovers scale
// in from their trigger (kit-pop-in, transform-origin at the anchor) and close on Escape, outside
// press or choosing an item. Nothing here touches window/document during render (SSR-safe).

export interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** Accessible name of the popover. */
  label: string;
  align?: "start" | "end";
  width?: number;
  /** Height the content may grow to below its top (an item list that opens under a search box). */
  reserve?: number;
  role?: "menu" | "dialog";
  /** No surface of its own (the content brings one). */
  bare?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = (props) => (props.open && props.anchor ? <PopoverBody {...props} anchor={props.anchor} /> : null);

const MARGIN = 8;
const MENU_MAX = 420;
const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';

const PopoverBody: React.FC<PopoverProps & { anchor: HTMLElement }> = ({ anchor, onClose, label, align = "start", width, reserve, role = "dialog", bare, className = "", children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string; maxHeight?: number } | null>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

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
  }, [anchor, align, reserve, role]);

  useLayoutEffect(() => place(), [place]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      // One Escape closes the popover, even when its content (an item search) also handled it.
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
      anchor.focus();
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

  // Menus: focus the chosen item (or the first) so arrows work at once.
  useEffect(() => {
    if (role !== "menu") return;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>(`${ITEM_SELECTOR}[aria-checked="true"]`) ?? el?.querySelector<HTMLElement>(ITEM_SELECTOR);
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: "nearest" });
  }, [role]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (role !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <Portal>
      <div
        ref={ref}
        role={role}
        aria-label={label}
        onKeyDown={onKeyDown}
        // React events bubble through portals to the trigger's ancestors (an exit card's header);
        // a click inside the popover belongs to the popover only.
        onClick={(e) => e.stopPropagation()}
        className={`kit-pop-in fixed z-[70] ${bare ? "" : `${surface.raised} p-1`} ${className}`}
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
    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors duration-150 hover:bg-slate-400/10 focus-visible:bg-slate-400/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
      tone === "danger" ? "text-red-300" : "text-slate-200"
    }`}
  >
    {icon !== undefined && <span className="grid h-5 w-5 shrink-0 place-items-center text-slate-400 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
    <span className="min-w-0 flex-1">
      <span className="block truncate">{children}</span>
      {hint && <span className="block text-[11px] leading-snug text-slate-500">{hint}</span>}
    </span>
    {checked && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
  </button>
);

export const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500 first:pt-1">{children}</div>
);

export const MenuSeparator: React.FC = () => <div className="mx-1 my-1 h-px bg-slate-700/60" />;

const DROPDOWN_LOOK = {
  /** A recessed select-like field ("Go to [step ▾]"). */
  field:
    "inline-flex h-[26px] min-w-0 max-w-full items-center gap-1.5 rounded-[7px] border border-slate-600/40 bg-slate-950/50 pl-1.5 pr-2 text-[12.5px] font-medium text-slate-100 transition-colors duration-150 hover:border-slate-500/60 hover:bg-slate-900",
  /** An inline token inside a condition sentence. */
  token:
    "inline-flex h-[22px] max-w-full items-center gap-1 rounded-[5px] bg-slate-700/60 px-1.5 align-middle font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)] transition-colors duration-150 hover:bg-slate-600/70",
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
}> = ({ label, button, look = "field", chevron = true, title, width = 260, align = "start", className = "", menuClassName = "", disabled, children }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`cursor-pointer disabled:cursor-default disabled:opacity-50 ${DROPDOWN_LOOK[look]} ${className}`}
      >
        {button}
        {chevron && <ChevronDown className={`h-3 w-3 shrink-0 text-slate-500 transition-transform duration-200 ease-snappy ${open ? "rotate-180" : ""}`} />}
      </button>
      <Popover anchor={anchor} open={open} onClose={close} label={label} role="menu" width={width} align={align} className={`overflow-y-auto overscroll-contain scrollbar-dark ${menuClassName}`}>
        {children(close)}
      </Popover>
    </>
  );
};
