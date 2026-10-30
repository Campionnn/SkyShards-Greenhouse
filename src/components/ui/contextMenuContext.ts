import { createContext, useContext } from "react";
import type React from "react";
import { cn } from "./cn";

// The context-menu hook and types (the provider and menu are in ContextMenu.tsx), plus the keyboard
// and look helpers every kit menu shares (Popover menus, Dropdown, ContextMenu).

export type ContextMenuEntry =
  | {
      label: React.ReactNode;
      onSelect: () => void;
      icon?: React.ReactNode;
      /** Shortcut hint shown on the right (e.g. "Del", "Ctrl D"). */
      shortcut?: string;
      disabled?: boolean;
      tone?: "danger";
      title?: string;
    }
  | { separator: true }
  | { heading: React.ReactNode };

/**
 * What `openContextMenu` needs from the event. A React mouse event fits as is. Opening from a
 * button (not a right-click) can pass a fake one with coordinates, or `anchor`: the menu then sits
 * under that element (or rect) and flips above it when there is no room.
 */
export type ContextMenuEvent = {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation?: () => void;
  currentTarget?: EventTarget | null;
  nativeEvent?: Event;
  anchor?: Element | DOMRectReadOnly | null;
};

export type OpenContextMenu = (e: ContextMenuEvent, items: ContextMenuEntry[]) => void;

export const ContextMenuContext = createContext<OpenContextMenu | null>(null);

/**
 * Open a context menu at the pointer. Outside a provider it does nothing (the browser menu shows).
 * Keyboard users get it for free: inside a ContextMenuProvider, Shift+F10 or the Menu key on a
 * focused element fires that element's onContextMenu, and the menu opens at the element with its
 * first item focused; closing it puts focus back on the element.
 */
export function useContextMenu(): OpenContextMenu {
  const open = useContext(ContextMenuContext);
  return open ?? (() => {});
}

// ---- Shared by every kit menu -------------------------------------------------------------------

export const MENU_ITEM = '[role^="menuitem"]:not([disabled])';

/** One menu row: body text, the hover fill, an inset focus ring (an outside ring would be clipped). */
export const menuRowClass = (danger?: boolean) =>
  cn(
    "flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-body transition-colors duration-(--duration-hover) focus-ring-inset hover:bg-surface-hover focus-visible:bg-surface-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
    danger ? "text-problem" : "text-fg-body"
  );

/**
 * Floating layers open right now, oldest first (popovers and context menus). Escape and outside
 * presses belong to the top one, and a press inside a layer opened from another (a menu inside a
 * popover) doesn't close the one underneath.
 */
export const floatingLayers: HTMLElement[] = [];

/** Whether `node` is inside a floating layer opened after `layer`. */
export const insideLayerAbove = (layer: HTMLElement, node: Node) => floatingLayers.slice(floatingLayers.indexOf(layer) + 1).some((l) => l.contains(node));

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex],[contenteditable="true"]';

/** The controls Tab reaches inside `el`, in order. */
export const focusablesIn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.tabIndex >= 0 && x.getClientRects().length > 0 && getComputedStyle(x).visibility !== "hidden");

/** Focus the control after (or before) `from` in Tab order, skipping floating layers (Tab out of a menu). */
export function focusNextAfter(from: HTMLElement, back: boolean) {
  const root = from.closest<HTMLElement>('[aria-modal="true"]') ?? document.body;
  const list = focusablesIn(root).filter((el) => !floatingLayers.some((l) => l.contains(el)) && !from.contains(el));
  const target = back
    ? list.filter((el) => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).pop()
    : list.find((el) => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  (target ?? from).focus();
}

/** Focus item `i` of a menu and make it the one tab stop (roving tabindex). */
export function focusMenuItem(items: HTMLElement[], i: number) {
  items.forEach((it, k) => (it.tabIndex = k === i ? 0 : -1));
  items[i]?.focus({ preventScroll: true });
  items[i]?.scrollIntoView({ block: "nearest" });
}

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Arrow keys, Home and End move between a menu's items (wrapping); a letter jumps to the next item
 * starting with it (type several quickly to match more). Enter and Space are the items' own button
 * behaviour. Returns true when it handled the key.
 */
export function menuNavigate(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target" | "preventDefault" | "stopPropagation">,
  panel: HTMLElement | null,
  typeahead: { text: string; at: number }
): boolean {
  if (!panel) return false;
  const items = [...panel.querySelectorAll<HTMLElement>(MENU_ITEM)];
  if (!items.length) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === "ArrowDown") next = (at + 1) % items.length;
  else if (e.key === "ArrowUp") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
  else if ((e.key === "Home" || e.key === "End") && !isField(e.target)) next = e.key === "Home" ? 0 : items.length - 1;
  else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey && !isField(e.target)) {
    const now = Date.now();
    typeahead.text = now - typeahead.at < 600 ? typeahead.text + e.key.toLowerCase() : e.key.toLowerCase();
    typeahead.at = now;
    const from = typeahead.text.length > 1 ? Math.max(at, 0) : at + 1;
    for (let k = 0; k < items.length; k++) {
      const i = (from + k) % items.length;
      if ((items[i].textContent ?? "").trim().toLowerCase().startsWith(typeahead.text)) {
        next = i;
        break;
      }
    }
    if (next < 0) return false;
  } else return false;
  e.preventDefault();
  e.stopPropagation();
  focusMenuItem(items, next);
  return true;
}
