// Keyboard shortcuts for the simulator's run controls (Step / Back / Run / Stop / Undo).
// The key -> action mapping is pure so it can be tested without a DOM.

export type RunShortcutAction = "step" | "back" | "run" | "toggleRun" | "stop" | "undo";

/** The parts of a KeyboardEvent the mapping looks at. */
export interface ShortcutKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Shown in the shortcuts hint and button titles. */
export const RUN_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "→ or .", action: "Step one cycle (hold to keep stepping)" },
  { keys: "← or ,", action: "Back one cycle (hold to keep going back)" },
  { keys: "Space", action: "Run N cycles, or Stop while running" },
  { keys: "Shift + →", action: "Run N cycles" },
  { keys: "Esc", action: "Stop a run" },
  { keys: "Ctrl/⌘ + Z", action: "Undo the last Step / Run / inventory change" },
];

export function runShortcutFor(e: ShortcutKey): RunShortcutAction | null {
  if (e.altKey) return null;
  if (e.ctrlKey || e.metaKey) {
    return e.key.toLowerCase() === "z" && !e.shiftKey ? "undo" : null;
  }
  switch (e.key) {
    case "ArrowRight":
      return e.shiftKey ? "run" : "step";
    case ".":
      return "step";
    case "ArrowLeft":
    case ",":
      return e.shiftKey ? null : "back";
    case " ":
    case "Spacebar":
      return e.shiftKey ? null : "toggleRun";
    case "Escape":
      return "stop";
    default:
      return null;
  }
}

/** Targets that keep their own keyboard behaviour (typing, sliders, selects, buttons for Space). */
export function ownsKeys(target: EventTarget | null, action: RunShortcutAction): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // Space activates a focused button / link / tab natively (unless it's disabled, e.g. Run mid-run).
  if (target.matches(":disabled")) return false;
  if (action === "toggleRun" && (tag === "BUTTON" || tag === "A" || target.getAttribute("role") === "button" || target.getAttribute("role") === "tab")) return true;
  return false;
}

/** A dialog or the flow editor overlay is open: the page behind it shouldn't react. */
export function modalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[aria-modal="true"], dialog[open]') !== null;
}
