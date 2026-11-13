import React, { useState } from "react";
import type { GreenhouseDataJSON, InfoTableJSON } from "../../services/greenhouseDataService";
import { getEffectDescription } from "../../context";
import { InfoHint } from "../ui/InfoHint";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { nameOf, TABLE_LIMIT, type Item } from "./articleModel";
import { ItemIcon } from "./ItemIcon";
import { ItemLink } from "./ItemLink";

/**
 * A detail section: a title (h2 on the page, h3 in the dialog) on a hairline, an optional ? hint and a count,
 * then the body. No card and no icon: the article's sections sit on the page.
 */
export const Section: React.FC<{ id: string; title: string; level: "h2" | "h3"; meta?: React.ReactNode; hint?: string; children: React.ReactNode }> = ({ id, title, level, meta, hint, children }) => {
  const H = level;
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-2 flex min-h-7 min-w-0 items-center gap-2 border-b border-line pb-1.5">
        <H id={id} className="text-body font-semibold text-fg">
          {title}
        </H>
        {hint && (
          <InfoHint title={title} width={300}>
            {hint}
          </InfoHint>
        )}
        {meta != null && <span className="text-meta tabular-nums text-fg-meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
};

/** Body prose at a readable measure. */
export const Prose: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="max-w-prose text-body leading-relaxed text-fg-body">{children}</p>;

/**
 * A harvest table, shown (not behind a disclosure): short ones (Chloronite's 5 rows) in full; long ones
 * (All-in Aloe's 24) show the first 8 and "Show all 24 rows". Numbers right-aligned and tabular.
 */
export const HarvestTable: React.FC<{ table: InfoTableJSON }> = ({ table }) => {
  const [all, setAll] = useState(false);
  const long = table.rows.length > TABLE_LIMIT + 2;
  const rows = long && !all ? table.rows.slice(0, TABLE_LIMIT) : table.rows;
  return (
    <figure className="mt-3 max-w-xl min-w-0">
      <figcaption className="mb-1 text-secondary font-medium text-fg-body">{table.title ?? "Table"}</figcaption>
      <table className="w-full border-collapse text-secondary tabular-nums">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={cn("border-b border-line-strong pb-1 font-medium text-fg-meta", i === 0 ? "text-left" : "pl-3 text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={cn("py-1", i === 0 ? "text-left text-fg-body" : "pl-3 text-right text-fg")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {long && (
        <LinkButton className="mt-2" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? `Show the first ${TABLE_LIMIT} rows` : `Show all ${table.rows.length} rows`}
        </LinkButton>
      )}
    </figure>
  );
};

/** Effects: the name from data.effects ("Improved XP Boost") and what it does; negative ones in the problem role, under their own label. */
export const Effects: React.FC<{ data: GreenhouseDataJSON; item: Item }> = ({ data, item }) => {
  const row = (e: string, bad: boolean) => (
    <li key={e} className="min-w-0">
      <span className={cn("text-body font-medium", bad ? "text-problem" : "text-fg")}>{data.effects[e]?.name ?? e.replace(/_/g, " ")}</span>
      <p className="text-secondary text-fg-muted">{getEffectDescription(e, data.effects)}</p>
    </li>
  );
  return (
    <div className="space-y-3">
      {item.positive_buffs.length > 0 && (
        <div>
          <p className="mb-1 text-label uppercase text-fg-meta">Positive</p>
          <ul className="space-y-1.5">{item.positive_buffs.map((e) => row(e, false))}</ul>
        </div>
      )}
      {item.negative_buffs.length > 0 && (
        <div>
          <p className="mb-1 text-label uppercase text-fg-meta">Negative</p>
          <ul className="space-y-1.5">{item.negative_buffs.map((e) => row(e, true))}</ul>
        </div>
      )}
    </div>
  );
};

/**
 * Drops (mutations) or Base yield (crops): icon, name, tabular amount; two columns where they fit (Godseed's
 * 14). Wheat's `seeds` is not an item: text, no link. A mutation without drops says so (Jerryflower).
 */
export const Drops: React.FC<{ data: GreenhouseDataJSON; item: Item }> = ({ data, item }) => {
  const drops = Object.entries(item.drops ?? {});
  if (!drops.length) return <p className="text-body text-fg-muted">Drops nothing when harvested.</p>;
  const row = (d: string, n: number) => (
    <>
      <ItemIcon id={d} name={nameOf(data, d)} size={18} />
      <span className="min-w-0 flex-1 truncate text-body text-fg-body" title={nameOf(data, d)}>
        {nameOf(data, d)}
      </span>
      <span className="shrink-0 text-body tabular-nums text-fg">{n.toLocaleString("en-US")}</span>
    </>
  );
  const rowClass = "flex h-8 min-w-0 items-center gap-2 px-1 pointer-coarse:h-11";
  return (
    <div className="@container/drops">
      <ul className={cn("grid gap-x-6", drops.length > 6 && "@min-[26rem]/drops:grid-cols-2")}>
        {drops.map(([d, n]) => (
          <li key={d} className="min-w-0 border-b border-line last:border-0 @min-[26rem]/drops:[&:nth-last-child(2):nth-child(odd)]:border-0">
            {data.mutations[d] || data.crops[d] ? (
              <ItemLink id={d} className={cn(rowClass, "transition-colors duration-(--duration-hover) hover:bg-surface-hover")}>
                {row(d, n)}
              </ItemLink>
            ) : (
              <span className={rowClass}>{row(d, n)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
