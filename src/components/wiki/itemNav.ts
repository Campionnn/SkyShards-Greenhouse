import { createContext } from "react";

/**
 * How item links inside wiki content navigate. null (the default) renders router
 * links to /wiki/<slug>; the info modal provides a callback that swaps the modal
 * to the clicked item instead.
 */
export const ItemNavContext = createContext<((id: string) => void) | null>(null);
