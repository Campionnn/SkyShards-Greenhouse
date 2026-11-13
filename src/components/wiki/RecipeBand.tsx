import React from "react";
import { ArrowRight, X } from "lucide-react";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { getGroundImagePath } from "../../types/greenhouse";
import { Pill } from "../ui/kit";
import { cn } from "../ui/cn";
import { surface } from "../ui/surface";
import { itemOf, kindOf, nameOf, needTitle, pictureCaption, pictureKind, recipeOf, requirementLayout, ringSentence, usedInOf, type WikiLookup } from "./articleModel";
import { IconTile, ItemIcon } from "./ItemIcon";
import { ItemLink } from "./ItemLink";

/**
 * The static requirement picture (decisions.md G2): the target, and around it the crops the recipe needs
 * (exact counts of ring cells), each on its own ground texture. A multi-cell ingredient is drawn once at its
 * real size, sticking out of the ring, so Plantboy Advance shows the 2 Snoozling it takes, not 6
 * (requirementLayout). Lonelily: an empty ring (✕). Godseed: a dashed "any crops" ring. No server call.
 */
export const RingPicture: React.FC<{ data: GreenhouseDataJSON; id: string; cell: number }> = ({ data, id, cell: wanted }) => {
  const item = itemOf(data, id);
  const kind = pictureKind(data, id);
  if (!item || !kind) return null;
  const recipe = recipeOf(data, id);
  const gap = 2;
  const layout = requirementLayout(data, item.size, kind === "ring" ? recipe.needs : []);
  const ring = layout.ring;
  // Big ingredients sticking out make the picture bigger than the ring: up to 1.6× the ring's size, then
  // smaller cells.
  const longest = Math.max(layout.rows, layout.cols);
  const budget = Math.round(1.6 * (wanted * (item.size + 2) + gap * (item.size + 1)));
  const cell = Math.min(wanted, Math.max(14, Math.floor((budget - gap * (longest - 1)) / longest)));
  const span = (k: number) => k * cell + (k - 1) * gap;
  const pos = (k: number) => 4 + k * (cell + gap);
  const label =
    kind === "ring"
      ? ringSentence(data, id, recipe.needs)
      : kind === "empty-ring"
        ? `${item.name} with every cell around it empty`
        : `${item.name} with crops around it that give all of its effects`;
  const t = layout.target;
  return (
    <div role="img" aria-label={label} className="relative shrink-0 rounded-control border border-line bg-surface-well" style={{ width: span(layout.cols) + 10, height: span(layout.rows) + 10 }}>
      {layout.bigs.map((b) => (
        <span
          key={`big-${b.row}-${b.col}`}
          title={`${nameOf(data, b.id)}: covers ${b.ringCells} of the cells around it`}
          className="absolute grid place-items-center overflow-hidden rounded-inner"
          style={{
            left: pos(b.col),
            top: pos(b.row),
            width: span(b.size),
            height: span(b.size),
            backgroundImage: `url(${getGroundImagePath(itemOf(data, b.id)?.ground ?? "farmland")})`,
            backgroundSize: `${cell}px ${cell}px`,
          }}
        >
          <ItemIcon id={b.id} name={nameOf(data, b.id)} size={Math.round(span(b.size) * 0.8)} />
        </span>
      ))}
      {ring.map((c) => (
        <span
          key={`${c.row}-${c.col}`}
          className={cn("absolute grid place-items-center overflow-hidden rounded-inner", !c.id && (kind === "any-ring" ? "border border-dashed border-line-control" : "bg-surface-hover/60"))}
          style={{
            left: pos(c.col),
            top: pos(c.row),
            width: cell,
            height: cell,
            backgroundImage: c.id ? `url(${getGroundImagePath(itemOf(data, c.id)?.ground ?? "farmland")})` : undefined,
            backgroundSize: "cover",
          }}
        >
          {c.id && <ItemIcon id={c.id} name={nameOf(data, c.id)} size={Math.round(cell * 0.8)} />}
          {!c.id && kind === "empty-ring" && <X aria-hidden className="size-3 text-fg-meta" />}
        </span>
      ))}
      <span
        className="absolute grid place-items-center overflow-hidden rounded-inner ring-2 ring-select ring-inset"
        style={{ left: pos(t.col), top: pos(t.row), width: span(item.size), height: span(item.size), backgroundImage: `url(${getGroundImagePath(item.ground)})`, backgroundSize: "cover" }}
      >
        <ItemIcon id={id} name={item.name} size={Math.round(span(item.size) * 0.8)} />
      </span>
    </div>
  );
};

/**
 * One row of the band: the icon on its tile, the name (neutral), then the count in words. `tight`: the count
 * sits right after the name (a one-column band), not at the far end of the row.
 */
const BandRow: React.FC<{ data: GreenhouseDataJSON; id: string; count: React.ReactNode; countTitle?: string; tight?: boolean }> = ({ data, id, count, countTitle, tight }) => {
  const name = nameOf(data, id);
  return (
    <ItemLink
      id={id}
      title={`${name} · ${kindOf(data, id)}`}
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-control px-1.5 transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:min-h-11",
        tight && "w-fit max-w-full pr-3",
      )}
    >
      <IconTile id={id} name={name} size={20} />
      <span className={cn("min-w-0 text-body leading-tight text-fg", !tight && "flex-1")}>{name}</span>
      <span className={cn("shrink-0 text-secondary tabular-nums text-fg-muted", tight && "ml-1")} title={countTitle}>
        {count}
      </span>
    </ItemLink>
  );
};

/** "Used in" rows: what needs this item, and how many ("Chorus Fruit · needs 5"). */
const UsedInRows: React.FC<{ wiki: WikiLookup; id: string; tight?: boolean }> = ({ wiki, id, tight }) => {
  const used = usedInOf(wiki, id);
  if (!used.length) return <p className="px-1.5 text-body text-fg-muted">Not an ingredient in any mutation.</p>;
  return (
    <ul className={cn("space-y-px", tight && "flex flex-wrap gap-x-4 space-y-0")}>
      {used.map((u) => (
        <li key={u.id} className="min-w-0">
          <BandRow
            data={wiki.data}
            id={u.id}
            tight={tight}
            count={u.count != null ? `needs ${u.count}` : <Pill title="The special rule uses it">special</Pill>}
            countTitle={u.count != null ? `${nameOf(wiki.data, u.id)} needs ${u.count} ${nameOf(wiki.data, id)} around it` : undefined}
          />
        </li>
      ))}
    </ul>
  );
};

/**
 * The recipe band, the article's first answer: [Needs, with counts] → [the picture] → [Used in]. One
 * horizontal flow; in a narrow container (a phone, the dialog at 390) it stacks: Needs / ↓ picture ↓ / Used
 * in. `compact`: the dialog's smaller picture. `level`: the heading level of "Needs" / "Used in" (h2 on the
 * page, h3 in the dialog).
 *
 * Labels: Needs rows say "×6" (six of it); Used in rows say "needs 5" (that mutation needs five of this one:
 * "Chorus Fruit · needs 5"). The special rule (Lonelily, Godseed, Jerryflower, Shellfruit) sits in Needs.
 * A base crop has no recipe: the band is just "Used in", its rows with the count right after the name.
 */
export const RecipeBand: React.FC<{ wiki: WikiLookup; id: string; compact?: boolean; level?: "h2" | "h3" }> = ({ wiki, id, compact, level = "h2" }) => {
  const data = wiki.data;
  const item = itemOf(data, id);
  if (!item) return null;
  const recipe = recipeOf(data, id);
  const used = usedInOf(wiki, id);
  const kind = pictureKind(data, id);
  const cell = compact ? (item.size === 3 ? 24 : item.size === 2 ? 30 : 34) : item.size === 3 ? 28 : item.size === 2 ? 36 : 42;
  const caption = pictureCaption(data, id);
  const H = level;
  const head = (title: string, n: number) => (
    <div className="mb-1 flex items-baseline gap-1.5 px-1.5">
      <H className="text-label uppercase text-fg-meta">{title}</H>
      {n > 0 && <span className="text-meta tabular-nums text-fg-meta">{n}</span>}
    </div>
  );

  if (!item.mutation)
    return (
      <section aria-label="Recipe" className="min-w-0">
        <div className={cn(surface.card, "p-3")}>
          {head("Used in", used.length)}
          <UsedInRows wiki={wiki} id={id} tight />
        </div>
      </section>
    );

  const arrow = <ArrowRight aria-hidden className="size-4 shrink-0 text-fg-meta @max-[34rem]/band:rotate-90" />;
  const col = "max-w-80 min-w-0 flex-1 basis-0 @max-[34rem]/band:w-full @max-[34rem]/band:max-w-none @max-[34rem]/band:basis-auto";
  return (
    <section aria-label="Recipe" className="@container/band min-w-0">
      <div className={cn(surface.card, "flex min-w-0 items-center justify-center gap-4 p-3 @max-[34rem]/band:flex-col @max-[34rem]/band:items-stretch @max-[34rem]/band:gap-2")}>
        <div className={col}>
          {head("Needs", recipe.needs.length)}
          {recipe.needs.length > 0 && (
            <ul className="space-y-px">
              {recipe.needs.map((n) => (
                <li key={n.id}>
                  {n.count != null ? (
                    <BandRow data={data} id={n.id} count={`×${n.count}`} countTitle={needTitle(data, n)} />
                  ) : (
                    <BandRow data={data} id={n.id} count={<Pill title="Not placed around it: the rule below uses it">special</Pill>} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {recipe.note && <p className={cn("px-1.5 text-body text-fg-body", recipe.needs.length > 0 && "mt-1.5")}>{recipe.note}</p>}
          {recipe.special === "all_positive_crop_effects" && (
            <ul aria-label="Effects it needs" className="mt-2 flex flex-wrap gap-1 px-1.5">
              {item.positive_buffs.map((e) => (
                <li key={e}>
                  <Pill title={data.effects[e]?.description}>{data.effects[e]?.name ?? e}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-3 @max-[34rem]/band:flex-col @max-[34rem]/band:gap-2">
          {arrow}
          {kind ? (
            <figure className="flex shrink-0 flex-col items-center gap-1.5">
              <RingPicture data={data} id={id} cell={cell} />
              {caption && <figcaption className="max-w-44 text-center text-meta text-fg-meta">{caption}</figcaption>}
            </figure>
          ) : (
            // No layout to draw (Jerryflower, Shellfruit): the item itself, as big as a 1×1 picture.
            <div className="grid shrink-0 place-items-center rounded-control border border-line bg-surface-well" style={{ width: cell * 3 + 14, height: cell * 3 + 14 }}>
              <ItemIcon id={id} name={item.name} size={Math.round(cell * 1.6)} />
            </div>
          )}
          {arrow}
        </div>
        <div className={col}>
          {head("Used in", used.length)}
          <UsedInRows wiki={wiki} id={id} />
        </div>
      </div>
    </section>
  );
};
