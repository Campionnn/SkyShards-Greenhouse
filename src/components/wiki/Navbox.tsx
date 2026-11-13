import React from "react";
import { Link } from "react-router-dom";
import { GroupLinks } from "./Browse";
import { groupsOf } from "./navModel";
import type { WikiData } from "./useWikiData";

/**
 * All crops & mutations at the foot of every article (the Hypixel wiki's navbox), compact: one row per group,
 * 16px icon + name links in the secondary size, neutral names (the row label says the rarity), the current
 * item marked. Browse sideways from any page; every item is a crawlable /wiki/<slug> link.
 */
export const Navbox: React.FC<{ wiki: WikiData; current: string | null }> = ({ wiki, current }) => (
  <nav aria-labelledby="wiki-navbox-title" className="@container/navbox min-w-0">
    <div className="mb-1 flex min-w-0 items-center gap-2 border-b border-line pb-1.5">
      <h2 id="wiki-navbox-title" className="text-body font-semibold text-fg">
        All crops &amp; mutations
      </h2>
      <span className="text-meta tabular-nums text-fg-meta">{wiki.index.entries.length}</span>
    </div>
    <div className="divide-y divide-line">
      {groupsOf(wiki.index.entries).map((g) => (
        <div key={g.key} className="grid min-w-0 gap-x-3 gap-y-1 py-1.5 @min-[36rem]/navbox:grid-cols-[6.5rem_minmax(0,1fr)]">
          <Link
            to={{ pathname: "/wiki", hash: `#${g.key}` }}
            className="focus-ring inline-flex h-6 items-center self-start rounded-inner text-secondary text-fg-meta transition-colors duration-(--duration-hover) hover:text-fg-body pointer-coarse:h-11"
          >
            {g.title}
          </Link>
          <GroupLinks group={g} current={current} size="sm" />
        </div>
      ))}
    </div>
  </nav>
);
