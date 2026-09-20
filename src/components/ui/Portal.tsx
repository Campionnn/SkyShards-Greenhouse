import React from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children into <body> instead of where it sits in the tree.
 *
 * Overlays need this whenever an ancestor creates a stacking context - a
 * sticky or transformed column, for instance. Inside one, `position: fixed`
 * is confined to that ancestor and no z-index can lift the overlay above
 * later siblings (this is why the designer's Save/Load modals appeared
 * beneath the grid and the palette).
 */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
};
