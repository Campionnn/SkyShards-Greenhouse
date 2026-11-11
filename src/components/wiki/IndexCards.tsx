import React from "react";
import { Link } from "react-router-dom";
import { wikiPath, type WikiEntry } from "../../wiki/slugs";
import { kindOf, nameOf, recipeOf, specialShort, usedInOf } from "./articleModel";
import { IconTile, ItemIcon } from "./ItemIcon";
import type { WikiData } from "./useWikiData";

// The index's items (research/wiki-v2, direction C): base crops as name chips, and each mutation as its
// recipe card. Names are neutral; the group heading above says the rarity.

/** "6 Coalroot, 2 Thornshade" (or the special rule): the card's tooltip and accessible description. */
function needsText(wiki: WikiData, id: string): string {
  const r = recipeOf(wiki, id);
  if (r.special) return specialShort(r.special) ?? "";
  return r.needs.map((n) => (n.count != null ? `${n.count} ${nameOf(wiki, n.id)}` : nameOf(wiki, n.id))).join(", ");
}

/**
 * A mutation as its recipe: icon + name, "used in N" on the right, and under the name what it needs: each
 * ingredient's count, its icon tile and its name. The names wrap onto more lines rather than hide (a card
 * with 4 or 5 needs grows a line); below a 15rem card they hide and the tooltip (and the screen reader text)
 * keeps every name.
 */
const MutationCard: React.FC<{ wiki: WikiData; id: string }> = ({ wiki, id }) => {
  const r = recipeOf(wiki, id);
  const used = usedInOf(wiki, id).length;
  const name = nameOf(wiki, id);
  const needs = needsText(wiki, id);
  return (
    <Link
      to={wikiPath(id)}
      title={`${name} · ${kindOf(wiki, id)}\nNeeds ${needs}`}
      className="focus-ring @container/card flex h-full min-w-0 items-start gap-2.5 rounded-control border border-line bg-surface-card px-2.5 py-2 transition-colors duration-(--duration-hover) hover:border-line-strong hover:bg-surface-hover"
    >
      <ItemIcon id={id} name={name} size={28} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{name}</span>
          {used > 0 && <span className="shrink-0 text-meta tabular-nums text-fg-meta">used in {used}</span>}
        </span>
        <span className="sr-only">Needs {needs}</span>
        <span aria-hidden className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {r.needs.length > 0 && !r.special ? (
            r.needs.map((n) => (
              <span key={n.id} className="inline-flex min-w-0 items-center gap-1 text-secondary tabular-nums text-fg-muted">
                {n.count}
                <IconTile id={n.id} name={nameOf(wiki, n.id)} size={14} />
                <span className="hidden truncate @min-[15rem]/card:inline">{nameOf(wiki, n.id)}</span>
              </span>
            ))
          ) : (
            <span className="text-secondary text-fg-muted">{specialShort(r.special)}</span>
          )}
        </span>
      </span>
    </Link>
  );
};

/** A group's items on the index: base crops as a wrap of name chips, mutations as a grid of recipe cards. */
export const IndexGroupItems: React.FC<{ wiki: WikiData; groupKey: string; entries: WikiEntry[] }> = ({ wiki, groupKey, entries }) =>
  groupKey === "base-crops" ? (
    <ul className="flex flex-wrap gap-1">
      {entries.map((e) => (
        <li key={e.id}>
          <Link
            to={wikiPath(e.id)}
            title={`${e.name} · Base crop`}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-control border border-line bg-surface-card pr-2.5 pl-1.5 text-body text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg pointer-coarse:h-11"
          >
            <ItemIcon id={e.id} name={e.name} size={20} />
            {e.name}
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <ul className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 15.5rem), 1fr))" }}>
      {entries.map((e) => (
        <li key={e.id} className="min-w-0">
          <MutationCard wiki={wiki} id={e.id} />
        </li>
      ))}
    </ul>
  );
