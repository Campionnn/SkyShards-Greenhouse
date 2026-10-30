import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn";
import {
  ContextMenuContext,
  floatingLayers,
  focusMenuItem,
  MENU_ITEM,
  menuNavigate,
  menuRowClass,
  type ContextMenuEntry,
  type OpenContextMenu,
} from "./contextMenuContext";
import { Portal } from "./Portal";
import { surface } from "./surface";

// Right-click menus. Wrap a surface in <ContextMenuProvider> once; any element then calls
// `openContextMenu(event, items)` from its onContextMenu. The browser's own menu is suppressed only
// where we show ours (text inputs keep theirs for copy/paste). Items reuse the Popover menu look:
// the first item takes focus, arrows / Home / End / a letter move, Enter or Space choose, Tab and
// Escape close (focus goes back where it was), outside press, scroll or resize close.
//
// Keyboard path, free for every caller: Shift+F10 or the Menu key on a focused element sends it a
// `contextmenu` event, so the same onContextMenu handler runs; the menu then opens under that
// element instead of at the pointer.

type Where = { x: number; y: number; rect?: DOMRect };

/** Set while a keyboard-made contextmenu event is being dispatched: whichever provider's open() runs takes it. */
let keyboardOpen: { el: HTMLElement; until: number } | null = null;
/** Until when the browser's own keyboard contextmenu (same keypress) is dropped. */
let swallowNative = 0;
const KEYBOARD_EVENT = "__kitKeyboardContextMenu";

const rectOf = (a: Element | DOMRectReadOnly) => (a instanceof Element ? a.getBoundingClientRect() : DOMRect.fromRect(a));

export const ContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [menu, setMenu] = useState<{ at: Where; items: ContextMenuEntry[]; returnTo: HTMLElement | null; key: number } | null>(null);
  const seq = useRef(0);
  const open = useCallback<OpenContextMenu>((e, items) => {
    const real = items.filter((i) => !("separator" in i) && !("heading" in i));
    if (!real.length) return;
    e.preventDefault();
    e.stopPropagation?.();
    const kb = keyboardOpen && keyboardOpen.until > Date.now() ? keyboardOpen : null;
    if (kb) keyboardOpen = null;
    const anchorRect = e.anchor ? rectOf(e.anchor) : kb ? kb.el.getBoundingClientRect() : undefined;
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    // Where focus goes when the menu closes: the element it was opened from with the keyboard, else
    // whatever had focus before (the menu borrows focus; it never strands it on <body>).
    const returnTo = kb?.el ?? active;
    setMenu({
      at: anchorRect ? { x: anchorRect.left, y: anchorRect.bottom + 4, rect: anchorRect } : { x: e.clientX, y: e.clientY },
      items,
      returnTo,
      key: ++seq.current,
    });
  }, []);

  // Shift+F10 / the Menu key → a contextmenu event on the focused element. Capture, and once per
  // keypress even with nested providers (the flow editor sits inside the simulator page's).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) || e.defaultPrevented || (e as KeyboardEvent & Record<string, boolean>)[KEYBOARD_EVENT]) return;
      (e as KeyboardEvent & Record<string, boolean>)[KEYBOARD_EVENT] = true;
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      // Text fields keep the browser's menu (copy / paste).
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) return;
      const r = el.getBoundingClientRect();
      keyboardOpen = { el, until: Date.now() + 400 };
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, clientX: r.left + Math.min(r.width / 2, 24), clientY: r.bottom, button: 2 });
      Object.defineProperty(ev, KEYBOARD_EVENT, { value: true });
      el.dispatchEvent(ev);
      const opened = keyboardOpen === null;
      keyboardOpen = null;
      if (opened) {
        e.preventDefault();
        swallowNative = Date.now() + 600;
      }
    };
    // The browser may still send its own contextmenu for the same key (Windows, on key up): it
    // would replace ours, so drop it.
    const onNative = (e: MouseEvent) => {
      if ((e as MouseEvent & Record<string, boolean>)[KEYBOARD_EVENT] || Date.now() > swallowNative || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", onNative, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", onNative, true);
    };
  }, []);

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {menu && <MenuBody key={menu.key} at={menu.at} items={menu.items} returnTo={menu.returnTo} onClose={() => setMenu(null)} />}
    </ContextMenuContext.Provider>
  );
};

const MenuBody: React.FC<{ at: Where; items: ContextMenuEntry[]; returnTo: HTMLElement | null; onClose: () => void }> = ({ at, items, returnTo, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  const typeahead = useRef({ text: "", at: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = at.x + w + 8 > window.innerWidth;
    // Under an element (keyboard / anchor): flip above it, not above the point.
    const flipY = at.y + h + 8 > window.innerHeight;
    const top = flipY ? (at.rect ? at.rect.top - 4 - h : at.y - h) : at.y;
    const left = flipX ? (at.rect ? at.rect.right - w : at.x - w) : at.x;
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - w - 8)), top: Math.max(8, top), origin: `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}` });
  }, [at]);

  // Focus the first item once the menu is placed (it is visibility: hidden until then).
  const placed = pos !== null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!placed || !el) return;
    const list = [...el.querySelectorAll<HTMLElement>(MENU_ITEM)];
    if (list.length) focusMenuItem(list, 0);
    else el.focus({ preventScroll: true });
  }, [placed]);

  // Layer stack + focus return (before React removes the menu, while focus is still readable).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    floatingLayers.push(el);
    return () => {
      floatingLayers.splice(floatingLayers.indexOf(el), 1);
      if (el.contains(document.activeElement) && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [returnTo]);

  useEffect(() => {
    const shut = () => close.current();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) shut();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && floatingLayers[floatingLayers.length - 1] === ref.current) {
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
    if (!ref.current?.contains(e.target as Node)) return;
    if (e.key === "Tab") {
      // Tab leaves the menu: close it, focus goes back to where the menu came from.
      e.preventDefault();
      close.current();
      return;
    }
    menuNavigate(e, ref.current, typeahead.current);
  };

  return (
    <Portal>
      <div
        ref={ref}
        role="menu"
        aria-label="Context menu"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        className={cn("kit-pop-in fixed z-(--z-menu) min-w-[200px] max-w-[300px] p-1 outline-none", surface.raised)}
        style={{ left: pos?.left ?? at.x, top: pos?.top ?? at.y, transformOrigin: pos?.origin, visibility: pos ? undefined : "hidden" }}
      >
        {items.map((it, i) => {
          if ("separator" in it) return <div key={i} role="separator" className="mx-1 my-1 h-px bg-line" />;
          if ("heading" in it)
            return (
              <div key={i} className="truncate px-2 pt-1.5 pb-1 text-label uppercase text-fg-meta">
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
              className={menuRowClass(it.tone === "danger")}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{it.icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className="shrink-0 font-mono text-meta text-fg-meta">{it.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </Portal>
  );
};
