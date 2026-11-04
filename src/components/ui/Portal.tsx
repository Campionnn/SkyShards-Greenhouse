import React, { useContext } from "react";
import { createPortal } from "react-dom";
import { PortalContainerContext } from "./portalContext";

/** Wrap a modal `<dialog>`'s content so its portals render inside it. */
export const PortalHost: React.FC<{ container: Element | null; children: React.ReactNode }> = ({ container, children }) => (
  <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
);

/**
 * Renders children into <body> (or the enclosing modal dialog). Needed for overlays under an
 * ancestor that creates a stacking context (e.g. a sticky or transformed column), where
 * `position: fixed` is confined and no z-index lifts them above later siblings.
 * `container` overrides the target; `null` falls back to the context / <body>.
 */
export const Portal: React.FC<{ children: React.ReactNode; container?: Element | null }> = ({ children, container }) => {
  const inherited = useContext(PortalContainerContext);
  if (typeof document === "undefined") return null;
  return createPortal(children, container ?? inherited ?? document.body);
};

/** A dialog itself always goes to <body>, even when opened from inside another dialog. */
export const BodyPortal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
};
