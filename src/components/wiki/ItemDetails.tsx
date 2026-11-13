import React, { useMemo, useRef } from "react";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { Pill } from "../ui/kit";
import { cn } from "../ui/cn";
import { balanceColumns, capitalise, detailKeys, estimateHeights, foldedByDefault, itemOf, rarityClass, treeOutline, useWidth, type DetailKey } from "./articleModel";
import { FactGrid } from "./FactGrid";
import { ItemIcon } from "./ItemIcon";
import { RecipeBand } from "./RecipeBand";
import { Drops, Effects, HarvestTable, Prose, Section } from "./Sections";
import { TreeOutline } from "./TreeOutline";

// The wiki article body (research/wiki-v2: the G3 mockup, approved), shared by the /wiki/<slug> page and the
// app-wide info dialog (CropMutationInfoModal): ItemHeader is the title row; ItemDetails is facts → recipe
// band → details. The page adds breadcrumbs, search, Browse and the navbox around them (WikiPage).
//
// Rarity colour: the item's own title only (the h1 / the dialog h2). Every other name is neutral.

export type ItemDetailsVariant = "modal" | "page";

interface ItemHeaderProps {
  id: string;
  data: GreenhouseDataJSON;
  /** Right of the title (Copy link, Hypixel Wiki; in the dialog Open in Wiki, Hypixel, Close). */
  actions?: React.ReactNode;
  variant: ItemDetailsVariant;
  /** The title element (h1 on the page, h2 in the dialog): the page focuses it after an in-page navigation. */
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** The title's id (the dialog is labelled by it). */
  headingId?: string;
  /** Before the icon (the dialog's Back after a swap). */
  lead?: React.ReactNode;
}

/** The title row: the icon tile, the name (rarity colour: it's the item's own title) and its kind; actions on the right. */
export const ItemHeader: React.FC<ItemHeaderProps> = ({ id, data, actions, variant, headingRef, headingId, lead }) => {
  const item = itemOf(data, id);
  if (!item) return null;
  const page = variant === "page";
  const H = page ? "h1" : "h2";
  const rarity = item.mutation?.rarity ?? null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {lead}
      <div className={cn("grid shrink-0 place-items-center rounded-container border border-line bg-surface-well", page ? "size-14" : "size-12")}>
        <ItemIcon id={id} name={item.name} size={page ? 44 : 36} />
      </div>
      <div className="min-w-0 flex-1">
        <H ref={headingRef} id={headingId} tabIndex={page ? -1 : undefined} className={cn("leading-tight break-words outline-none", page ? "text-hero" : "text-title", rarityClass(rarity))}>
          {item.name}
        </H>
        <div className="mt-1">
          {/* The dialog says only the rarity, so the pill doesn't wrap beside three header buttons at 390. */}
          <Pill className="whitespace-nowrap">{rarity ? (page ? `${capitalise(rarity)} mutation` : capitalise(rarity)) : "Base crop"}</Pill>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
};

interface ItemDetailsProps {
  id: string;
  data: GreenhouseDataJSON;
  usedIn: Map<string, string[]>;
  variant: ItemDetailsVariant;
}

/**
 * Everything known about a crop or mutation: the facts, the recipe band (Needs → picture → Used in), then
 * the details as sections, not tabs (a visitor from Google scrolls, and Ctrl+F finds the drops and the tree).
 * Empty sections are left out. Two columns where there's room (the page from 760px, the dialog from 700),
 * split so they end at about the same height, each in reading order; one column on a phone.
 * Render with key={id} so the tree's folds and the table reset per item.
 */
export const ItemDetails: React.FC<ItemDetailsProps> = ({ id, data, usedIn, variant }) => {
  const box = useRef<HTMLDivElement>(null);
  const page = variant === "page";
  const width = useWidth(box, page ? 902 : 848);
  const item = itemOf(data, id);
  const tree = useMemo(() => treeOutline(data, id), [data, id]);
  const wiki = useMemo(() => ({ data, usedIn }), [data, usedIn]);
  if (!item) return <p className="text-body text-problem">No crop or mutation called “{id}”.</p>;

  const m = item.mutation;
  const level = page ? "h2" : "h3";
  const p = `wiki-${variant}`;
  const drops = Object.keys(item.drops ?? {}).length;
  const section: Record<DetailKey, () => React.ReactNode> = {
    growing: () => (
      <Section key="growing" id={`${p}-growing`} title="Growing" level={level}>
        <Prose>{m?.growing_info}</Prose>
      </Section>
    ),
    harvest: () => (
      <Section key="harvest" id={`${p}-harvest`} title="Harvest" level={level}>
        <Prose>{m?.harvest_info}</Prose>
        {m?.harvest_table && <HarvestTable table={m.harvest_table} />}
      </Section>
    ),
    notes: () => (
      <Section key="notes" id={`${p}-notes`} title="Notes" level={level}>
        <Prose>{item.notes}</Prose>
      </Section>
    ),
    effects: () => (
      <Section key="effects" id={`${p}-effects`} title="Effects" level={level} meta={item.positive_buffs.length + item.negative_buffs.length}>
        <Effects data={data} item={item} />
      </Section>
    ),
    drops: () => (
      <Section key="drops" id={`${p}-drops`} title={m ? "Drops" : "Base yield"} level={level} meta={drops || undefined} hint={m ? undefined : "Per harvest, before Farming Fortune and Yield buffs."}>
        <Drops data={data} item={item} />
      </Section>
    ),
    tree: () => (
      <Section
        key="tree"
        id={`${p}-tree`}
        title="Crafting tree"
        level={level}
        hint="Everything it's made from, down to the base crops. A mutation that appears twice is listed in full once; the repeat says “see above”."
      >
        <TreeOutline data={data} id={id} nodes={tree} />
      </Section>
    ),
  };
  const keys = detailKeys(data, item);
  const twoCol = width >= (page ? 760 : 700) && keys.length > 1;
  let details: React.ReactNode;
  if (!twoCol) details = <div className="space-y-6">{keys.map((k) => section[k]())}</div>;
  else {
    const [left, right] = balanceColumns(keys, estimateHeights(item, (width - 32) / 2, tree, foldedByDefault(tree)));
    details = (
      <div className="grid grid-cols-2 items-start gap-x-8">
        <div className="min-w-0 space-y-6">{left.map((k) => section[k]())}</div>
        <div className="min-w-0 space-y-6">{right.map((k) => section[k]())}</div>
      </div>
    );
  }

  return (
    <div ref={box} className={cn("min-w-0", page ? "space-y-3" : "space-y-4")}>
      <FactGrid item={item} variant={variant} />
      <RecipeBand wiki={wiki} id={id} compact={!page} level={level} />
      <div className={page ? "pt-3" : "pt-2"}>{details}</div>
    </div>
  );
};
