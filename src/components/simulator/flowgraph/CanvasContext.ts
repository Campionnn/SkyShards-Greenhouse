import { createContext, useContext } from "react";

// Stable callbacks the canvas hands to its nodes. Nodes are memoised, so they must not read the
// editor context (it changes on every edit); these never change identity and always call the
// latest editor API.

export interface CanvasActions {
  /** Click on exit row j of step i: select it and open that exit in the inspector. */
  exitClick: (step: number, exit: number) => void;
  /** Hovering an exit row (null when leaving). */
  exitHover: (step: number, exit: number | null) => void;
  /** Click on "+ Add exit": opens the add menu at the pointer, wired from this step. */
  addExit: (step: number, screen: { x: number; y: number }) => void;
}

const noop = () => {};
export const CanvasActionsContext = createContext<CanvasActions>({ exitClick: noop, exitHover: noop, addExit: noop });

export const useCanvasActions = () => useContext(CanvasActionsContext);