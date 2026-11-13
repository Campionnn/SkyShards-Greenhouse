import { createContext, useContext } from "react";

/** A button on the toast (e.g. Undo). Clicking it runs `onClick` and closes the toast. */
export type ToastAction = { label: string; onClick: () => void };

export type ToastContextValue = {
  /**
   * Shows a toast and returns its id. Titles are sentence case ("Removed Plot 3", not "REMOVED").
   * - `id`: re-using an id replaces that toast instead of stacking a copy.
   * - `variant`: "info" (default, neutral), "success" (go), "warning" (warn), "error" (problem;
   *   announced at once as an alert).
   * - `duration`: ms on screen, at least 4s (10s when there is an `action`), paused while the
   *   pointer or focus is on the toasts and while the tab is hidden.
   * - `action`: one button (e.g. Undo); clicking it runs `onClick` and closes the toast.
   */
  toast: (opts: {
    id?: string;
    title: string;
    description?: string;
    variant?: "success" | "error" | "info" | "warning";
    duration?: number;
    action?: ToastAction;
  }) => string;
  /** Closes one toast (with its exit fade). */
  dismiss: (id: string) => void;
  /** Closes every toast at once. */
  dismissAll: () => void;
};

/** Default and minimum time on screen: long enough to read a sentence (OD toast standard: ≥4s). */
export const TOAST_MIN_MS = 4000;
/**
 * A toast with an action (Undo) stays at least this long. It still times out: an Undo restores the
 * state from before the action, so offering it minutes later would throw away everything since.
 */
export const TOAST_ACTION_MIN_MS = 10000;
/** At most this many toasts at once; the oldest goes first. */
export const TOAST_MAX = 3;

/**
 * The modal `<dialog>`s open right now (in the browser's top layer), in document order. The toast
 * stack renders inside the topmost one, so a toast (an Undo) shown while a modal is open can be seen
 * and clicked. A non-modal `dialog.show()` is not in the top layer and is skipped.
 */
export function openModalDialogs(root: ParentNode = document): HTMLDialogElement[] {
  return [...root.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter((d) => {
    try {
      return d.matches(":modal");
    } catch {
      return true;
    }
  });
}

/** Effective time on screen for a toast. */
export function toastDuration(opts: { duration?: number; action?: ToastAction }): number {
  const asked = opts.duration ?? TOAST_MIN_MS;
  return Math.max(asked, opts.action ? TOAST_ACTION_MIN_MS : TOAST_MIN_MS);
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
};
