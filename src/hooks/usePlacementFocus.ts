import { useCallback, useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from "react";

/**
 * "Find it on the grid": hovering an entry in a list beside a grid (a mutation, a crop to plant)
 * highlights every placement of it and fades the rest; clicking pins the highlight until the entry
 * is clicked again, anything else is clicked, or Escape is pressed.
 *
 * Keys are free-form strings; use `focusKey` so the same plant as an input and as a target stay
 * apart. Pass the keys that currently have a placement: a key with nothing on the grid never
 * fades the grid, and a pin whose placements are gone (removed, new solve) is dropped.
 */

export type FocusKind = "input" | "target";

export const focusKey = (kind: FocusKind, id: string): string => `${kind}:${id}`;

/** How one grid placement is drawn while something is focused. */
export type FocusVisual = "focused" | "dimmed" | null;

/** Props for a list entry that focuses a key (spread onto a div: it acts as a toggle button). */
export interface FocusItemProps {
  /** Marks list entries, so pressing one doesn't count as a click elsewhere. */
  "data-focus-item": "";
  role: "button";
  tabIndex: number;
  "aria-pressed": boolean;
  title: string;
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface PlacementFocus {
  /** The key being shown: the hovered entry first, else the pinned one; null for none. */
  active: string | null;
  pinned: string | null;
  /** True when the key has a placement on the grid (only those entries are interactive). */
  has: (key: string) => boolean;
  visualFor: (key: string) => FocusVisual;
  itemProps: (key: string, name: string) => FocusItemProps;
  clear: () => void;
}

export function usePlacementFocus(available: ReadonlySet<string> | null): PlacementFocus {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinnedRaw, setPinned] = useState<string | null>(null);

  const has = useCallback((key: string) => !available || available.has(key), [available]);
  const pinned = pinnedRaw !== null && has(pinnedRaw) ? pinnedRaw : null;
  const active = hovered !== null && has(hovered) ? hovered : pinned;

  // A pin ends on Escape or on a press anywhere outside the list entries (an entry's own click toggles or switches it).
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    const onDown = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-focus-item]")) return;
      setPinned(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [pinned]);

  const visualFor = useCallback(
    (key: string): FocusVisual => (active === null ? null : key === active ? "focused" : "dimmed"),
    [active]
  );

  const itemProps = useCallback(
    (key: string, name: string): FocusItemProps => {
      const toggle = () => setPinned((p) => (p === key ? null : key));
      return {
        "data-focus-item": "",
        role: "button",
        tabIndex: 0,
        "aria-pressed": pinned === key,
        title: pinned === key ? `${name}: highlighted on the grid. Click anywhere else to stop.` : `${name}: click to keep highlighted on the grid`,
        // Mouse only: on touch a tap would leave a sticky hover; taps pin through onClick.
        onPointerEnter: (e) => {
          if (e.pointerType === "mouse") setHovered(key);
        },
        onPointerLeave: (e) => {
          if (e.pointerType === "mouse") setHovered((h) => (h === key ? null : h));
        },
        // Keyboard focus previews like hover; the focus a mouse click gives does not.
        onFocus: (e) => {
          if (e.currentTarget.matches(":focus-visible")) setHovered(key);
        },
        onBlur: () => setHovered((h) => (h === key ? null : h)),
        onClick: toggle,
        onKeyDown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        },
      };
    },
    [pinned]
  );

  const clear = useCallback(() => {
    setHovered(null);
    setPinned(null);
  }, []);

  return useMemo(() => ({ active, pinned, has, visualFor, itemProps, clear }), [active, pinned, has, visualFor, itemProps, clear]);
}
