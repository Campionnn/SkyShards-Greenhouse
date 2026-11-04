import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { titleForPath } from "../seo/routes";

/** Keeps document.title in step with the route (titles live in src/seo/routes.ts). */
export const usePageTitle = () => {
  const location = useLocation();

  useEffect(() => {
    // Wiki pages set a per-item title themselves.
    if (location.pathname === "/wiki" || location.pathname.startsWith("/wiki/")) return;
    document.title = titleForPath(location.pathname);
  }, [location.pathname]);
};
