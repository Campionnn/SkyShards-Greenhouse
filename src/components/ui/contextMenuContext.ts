import { createContext, useContext } from "react";
import type React from "react";

// The context-menu hook and types (the provider and menu are in ContextMenu.tsx).

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

export type OpenContextMenu = (e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: ContextMenuEntry[]) => void;

export const ContextMenuContext = createContext<OpenContextMenu | null>(null);

/** Open a context menu at the pointer. Outside a provider it does nothing (the browser menu shows). */
export function useContextMenu(): OpenContextMenu {
  const open = useContext(ContextMenuContext);
  return open ?? (() => {});
}