import { createContext } from "react";

/**
 * Where `Portal` renders when no explicit container is given. Modal `<dialog>`s provide themselves
 * (`PortalHost`): a modal dialog sits in the browser's top layer, so anything portaled to <body>
 * from inside it (tooltips, popovers) would render underneath it, and its inert background would
 * swallow hover.
 */
export const PortalContainerContext = createContext<Element | null>(null);
