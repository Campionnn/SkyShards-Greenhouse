import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { groupKeyOf, groupTitleOf, nameOf } from "./articleModel";
import type { WikiData } from "./useWikiData";

const crumb =
  "hit-area focus-ring rounded-inner text-fg-meta transition-colors duration-(--duration-hover) hover:text-fg-body pointer-coarse:inline-flex pointer-coarse:h-11 pointer-coarse:items-center pointer-coarse:px-1";

/** Wiki › Rare › Chloronite. "Rare" opens the index at that group (/wiki#rare); the last crumb is the page. */
export const Breadcrumbs: React.FC<{ wiki: WikiData; id: string }> = ({ wiki, id }) => {
  const entry = wiki.index.byId.get(id);
  const key = entry ? groupKeyOf(entry) : "base-crops";
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-secondary">
        <li className="shrink-0">
          <Link to="/wiki" className={crumb}>
            Wiki
          </Link>
        </li>
        <li aria-hidden className="shrink-0">
          <ChevronRight className="size-3 text-fg-meta" />
        </li>
        <li className="shrink-0">
          <Link to={{ pathname: "/wiki", hash: `#${key}` }} className={crumb}>
            {groupTitleOf(key)}
          </Link>
        </li>
        <li aria-hidden className="shrink-0">
          <ChevronRight className="size-3 text-fg-meta" />
        </li>
        <li aria-current="page" className="min-w-0 truncate text-fg-body" title={nameOf(wiki, id)}>
          {nameOf(wiki, id)}
        </li>
      </ol>
    </nav>
  );
};
