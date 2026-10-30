import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContextMenuContext, type ContextMenuEntry, type OpenContextMenu } from "./contextMenuContext";
import { Portal } from "./Portal";
import { surface } from "./surface";

// Right-click menus. Wrap a surface in <ContextMenuProvider> once; any element then calls
// `openContextMenu(event, items)` from its onContextMenu. The browser's own menu is suppressed only
// where we show ours (text inputs keep theirs for copy/paste). Items reuse the Popover menu look:
// keyboard arrows, Enter, Escape, closes on outside press, scroll or resize.

const ITEM = '[role="menuitem"]:not([disabled])';

export const ContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const open = useCallback<OpenContextMenu>((e, items) => {
    const real = items.filter((i) => !("separator" in i));
    if (!real.length) return;
    e.preventDefault();
    e.stopPropagation?.();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {menu && <MenuBody {...menu} onClose={() => setMenu(null)} />}
    </ContextMenuContext.Provider>
  );
};

const MenuBody: React.FC<{ x: number; y: number; items: ContextMenuEntry[]; onClose: () => void }> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = x + w + 8 > window.innerWidth;
    const flipY = y + h + 8 > window.innerHeight;
    setPos({ left: Math.max(8, flipX ? x - w : x), top: Math.max(8, flipY ? y - h : y), origin: `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}` });
    el.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const shut = () => close.current();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) shut();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        shut();
      }
    };
    // A right-click elsewhere replaces this menu (the new one opens from that element's handler).
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", shut);
    window.addEventListener("wheel", shut, { passive: true });
    window.addEventListener("blur", shut);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("wheel", shut);
      window.removeEventListener("blur", shut);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const list = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    if (!list.length) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
    list[next].focus();
  };

  return (
    <Portal>
      <div
        ref={ref}
        role="menu"
        aria-label="Context menu"
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        className={`kit-pop-in fixed z-[90] min-w-[200px] max-w-[300px] p-1 ${surface.raised}`}
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, transformOrigin: pos?.origin, visibility: pos ? undefined : "hidden" }}
      >
        {items.map((it, i) => {
          if ("separator" in it) return <div key={i} className="mx-1 my-1 h-px bg-slate-700/60" />;
          if ("heading" in it)
            return (
              <div key={i} className="truncate px-2 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                {it.heading}
              </div>
            );
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                onClose();
                it.onSelect();
              }}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] outline-none transition-colors duration-100 hover:bg-slate-400/10 focus-visible:bg-slate-400/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
                it.tone === "danger" ? "text-red-300" : "text-slate-200"
              }`}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center text-slate-400 [&>svg]:h-3.5 [&>svg]:w-3.5">{it.icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className="shrink-0 font-mono text-[10.5px] text-slate-500">{it.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </Portal>
  );
};
