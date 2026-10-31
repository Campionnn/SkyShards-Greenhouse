import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { haveText, prepText, upkeepNeedText, type FlowRow } from "../../../leaderboard/view";
import { cn } from "../../ui/cn";
import { InfoHint } from "../../ui/InfoHint";
import { LinkButton } from "../../ui/Card";
import { LayoutBoxes } from "../FlowVisuals";
import { Coins } from "./RankingRow";
import { thumbOf, type RankingLinkState } from "./rankingHelpers";

/**
 * F43–F44: flows set apart from the "from nothing" ranking. Their starting items can't be made within
 * the run, or they stop once those run out (upkeep they never grow). No rank; one line says which,
 * and the number with the starting items links there. The header says it once in warn; rows are muted.
 */

/** One set-apart flow. */
export const CantMakeRow: React.FC<{ row: FlowRow; rankingSearch?: string; phone?: boolean }> = ({ row, rankingSearch, phone }) => {
  const { entry } = row;
  const state: RankingLinkState = { rankingSearch: rankingSearch ?? "" };
  const why = row.cantMake ? (
    <>
      {prepText(row.cantMake)}
      {haveText(row.cantMake) && <span className="text-fg-meta"> (by then the builder had {haveText(row.cantMake)})</span>}
    </>
  ) : (
    <>
      Stops once its starting items run out
      {upkeepNeedText(entry.cell?.upkeep) && (
        <>
          : it needs <span className="text-fg-body">{upkeepNeedText(entry.cell?.upkeep)}</span> it doesn't grow
        </>
      )}
    </>
  );
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-2 py-2 @min-[36rem]:grid-cols-[auto_minmax(0,1fr)_auto]" data-testid="cant-make-row">
      <span className="hidden opacity-70 @min-[36rem]:block" aria-hidden>
        <LayoutBoxes layout={thumbOf(row)} cell={3} />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-secondary">
          <Link to={`/flows/${encodeURIComponent(entry.id)}?board=ironman`} state={state} className="focus-ring truncate rounded-inner font-medium text-fg-body hover:text-fg hover:underline">
            {entry.title}
          </Link>
          <span className="shrink-0 text-fg-meta">{entry.author.name}</span>
        </div>
        <p className="text-secondary text-fg-muted" data-testid={row.stops && !row.cantMake ? "stops-line" : undefined}>
          {why}
        </p>
      </div>
      <Link
        to={`/flows/${encodeURIComponent(entry.id)}?board=ironman&kit=1`}
        state={state}
        title="This flow when you already own the starting items"
        className="focus-ring hit-area inline-flex items-baseline gap-1 rounded-control px-1.5 py-1 text-secondary whitespace-nowrap text-fg-meta transition-colors duration-(--duration-hover) hover:bg-surface-hover"
      >
        {row.altPerDay !== null ? (
          <>
            <Coins value={row.altPerDay} />
            <span>/day {phone ? "with items" : "with the starting items"}</span>
          </>
        ) : (
          "With the starting items"
        )}
        <ArrowUpRight aria-hidden className="size-3 self-center" />
      </Link>
    </li>
  );
};

/** The collapsible section (closed by default; open when nothing else matches). */
export const CantMakeSection: React.FC<{ rows: FlowRow[]; onSwitch: () => void; defaultOpen?: boolean; rankingSearch?: string; phone?: boolean }> = ({ rows, onSwitch, defaultOpen = false, rankingSearch, phone }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="@container mt-3 border-t border-line pt-1" data-testid="cant-make-section">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="focus-ring flex min-h-8 cursor-pointer items-center gap-1.5 rounded-control px-2 transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:min-h-11"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 text-fg-meta transition-transform duration-(--duration-ink)", open && "rotate-90")} />
          <span className="text-body font-medium text-warn">Not ranked from nothing ({rows.length})</span>
        </button>
        <InfoHint title="Not ranked from nothing" label="Why these aren't ranked">
          From an empty inventory these flows either can't get their starting items before the scored part of the run, or stop earning once the starting items run out (they use items every day that they don't grow). They are ranked with "I have the starting items".
        </InfoHint>
        <LinkButton className="ml-auto" onClick={onSwitch}>
          Rank them with the starting items
        </LinkButton>
      </div>
      {open && (
        <ul className="kit-fade-in divide-y divide-line">
          {rows.map((r) => (
            <CantMakeRow key={r.entry.id} row={r} rankingSearch={rankingSearch} phone={phone} />
          ))}
        </ul>
      )}
    </section>
  );
};
