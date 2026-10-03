import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useWikiData } from "../components/wiki/useWikiData";
import { resolveSlug, wikiPath } from "../wiki/slugs";

/**
 * Catch-all route. A single path segment naming a crop or mutation
 * (/gloomgourd, /All-in_Aloe, ...) redirects to its wiki page; anything
 * else goes to the calculator, as unknown paths always have.
 */
export const ShortLinkRedirect: React.FC = () => {
  const location = useLocation();
  const { wiki, error } = useWikiData();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length !== 1 || error) return <Navigate to="/" replace />;
  if (!wiki) return null; // data.json is still loading

  const entry = resolveSlug(wiki.index, segments[0]);
  return <Navigate to={entry ? wikiPath(entry.id) : "/"} replace />;
};
