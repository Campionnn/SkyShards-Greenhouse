import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const usePageTitle = () => {
  const location = useLocation();

  useEffect(() => {
    // Wiki pages set a per-item title themselves.
    if (location.pathname === "/wiki" || location.pathname.startsWith("/wiki/")) return;

    const getTitle = () => {
      const path = location.pathname;

      switch (path) {
        case "/":
          return "Greenhouse · Grid";
        case "/simulator":
          return "Greenhouse · Simulator";
        case "/calculator":
          return "Greenhouse · Calculator";
        case "/about":
          return "Greenhouse · About";
        case "/contact":
          return "Greenhouse · Contact";
        case "/privacy-policy":
          return "Greenhouse · Privacy Policy";
        default:
          return "Greenhouse · Calculator";
      }
    };

    document.title = getTitle();
  }, [location.pathname]);
};
