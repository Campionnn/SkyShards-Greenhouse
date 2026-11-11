import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { KitButton } from "../ui/kit";
import { Popover } from "../ui/Popover";
import { cn } from "../ui/cn";
import { wikiPath } from "../../wiki/slugs";
import { ItemIcon } from "./ItemIcon";
import { groupsOf, type Group } from "./navModel";
import type { WikiData } from "./useWikiData";

// Browse (research/wiki-v2 G2: direction B's Browse button, kept in C): every crop and mutation in one
// grouped list, opened from a button beside the search (and on the phone's find bar). The same group
// blocks are the navbox's rows at the foot of every article (Navbox.tsx). Names are neutral: the group
// heading says the rarity (the rarity colour is only on the item's own title).

/** One group's items as wrapping icon links (Browse and the navbox), the current one marked in the select role. */
export const GroupLinks: React.FC<{ group: Group; current: string | null; onPicked?: () => void; size?: "sm" | "md" }> = ({ group, current, onPicked, size = "md" }) => (
  <ul className="flex min-w-0 flex-wrap gap-x-1 gap-y-0.5">
    {group.entries.map((e) => {
      const on = e.id === current;
      return (
        <li key={e.id} className="min-w-0">
          <Link
            to={wikiPath(e.id)}
            aria-current={on ? "page" : undefined}
            onClick={onPicked}
            className={cn(
              "focus-ring inline-flex min-w-0 items-center rounded-control transition-colors duration-(--duration-hover) pointer-coarse:h-11",
              size === "md" ? "h-7 gap-1.5 px-1.5 text-body" : "h-6 gap-1 rounded-inner px-1 text-secondary",
              on ? "bg-select/10 font-medium text-fg ring-1 ring-select ring-inset" : size === "md" ? "text-fg-body hover:bg-surface-hover hover:text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            <ItemIcon id={e.id} name={e.name} size={size === "md" ? 18 : 16} />
            <span className="truncate">{e.name}</span>
          </Link>
        </li>
      );
    })}
  </ul>
);

/** Every crop and mutation, one block per group (each group whole at any width), the current item marked. */
export const GroupedList: React.FC<{ wiki: WikiData; current: string | null; onPicked?: () => void }> = ({ wiki, current, onPicked }) => (
  <div className="divide-y divide-line">
    {groupsOf(wiki.index.entries).map((g) => (
      <section key={g.key} aria-label={g.title} className="py-1.5 first:pt-0.5 last:pb-0.5">
        <h3 className="px-1.5 pb-0.5 text-label uppercase text-fg-meta">
          {g.title} <span className="tabular-nums">{g.entries.length}</span>
        </h3>
        <GroupLinks group={g} current={current} onPicked={onPicked} />
      </section>
    ))}
  </div>
);

/** "Browse": the grouped list of everything in a popover under the button (closes on a pick, Escape or a press outside). */
export const BrowseButton: React.FC<{ wiki: WikiData; current: string | null; className?: string }> = ({ wiki, current, className }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <KitButton ref={setAnchor} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className={cn("h-9 px-3 pointer-coarse:h-11", className)}>
        Browse <ChevronDown aria-hidden className={cn("transition-transform duration-(--duration-ink)", open && "rotate-180")} />
      </KitButton>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="All crops and mutations" align="end" width={760} className="scrollbar-dark overflow-y-auto overscroll-contain p-2">
        <GroupedList wiki={wiki} current={current} onPicked={() => setOpen(false)} />
      </Popover>
    </>
  );
};
