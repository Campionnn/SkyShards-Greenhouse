import React from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into <body>. Needed for overlays under an ancestor that
 * creates a stacking context (e.g. a sticky or transformed column), where
 * `position: fixed` is confined and no z-index lifts them above later siblings.
 */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
};
