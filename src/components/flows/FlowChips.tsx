import React from "react";
import { Package, PauseCircle, TrendingDown } from "lucide-react";
import type { PrepInfo } from "../../leaderboard/result";
import { kitListText, prepText, starvedText, stepIdName, upkeepText, type StallInfo, type StepNamer } from "../../leaderboard/view";
import { cn } from "../ui/cn";
import { Badge } from "./FlowControls";

/**
 * The ranking row's small pieces (docs/plans/leaderboard-boards-v2.md §7.1, leaderboard-v3.md §8):
 * the starting-items line, a plot that stalls for lack of stock, and a cell that slows down at the end.
 */

export const SLOWING_TITLE = "Production falls off at the end of the run; scored at its last-20% rate.";
export const STALL_EXPLAIN = "The stock ran out. Nobody tops it up during a run, so a flow that uses items it doesn't grow stalls unless its own steps make them again.";

/** "Starting items: 2 Zombud, 3 Cindershade · made in ~4 days" (or "No starting items"); the tooltip lists the whole kit. */
export const StartingItemsLine: React.FC<{ prep: PrepInfo; className?: string; title?: string }> = ({ prep, className = "", title }) => {
  const empty = Object.keys(prep.kit).length === 0;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)} title={title ?? (empty ? "Starts from an empty inventory" : `Starting items: ${kitListText(prep.kit)}`)} data-testid="starting-items">
      <Package aria-hidden className="size-3 shrink-0 text-fg-meta" />
      <span className={cn("min-w-0 truncate", prep.done ? "text-fg-body" : "text-warn")}>{prepText(prep)}</span>
    </div>
  );
};

/**
 * "Stall": a plot averages ≥ 5 layout cells empty because the stock ran out. Nobody tops the stock
 * up in a run, so a flow that uses items it never grows stalls unless its own steps make them.
 */
export const StallChip: React.FC<{ stall: StallInfo; stepName?: StepNamer }> = ({ stall, stepName = stepIdName }) => (
  <Badge tone="estimated" title={`${starvedText(stall.top, stepName)}: ${STALL_EXPLAIN.charAt(0).toLowerCase()}${STALL_EXPLAIN.slice(1)}`} icon={<PauseCircle aria-hidden />}>
    Stall
  </Badge>
);

export const SlowingBadge: React.FC = () => (
  <Badge tone="warn" title={SLOWING_TITLE} icon={<TrendingDown aria-hidden />}>
    Slowing
  </Badge>
);

/** The upkeep: "None" (or `noneText`) as a plain value, else the items per day in warn. */
export const UpkeepValue: React.FC<{ upkeep: unknown; className?: string; noneText?: string }> = ({ upkeep, className = "", noneText = "None" }) => {
  const text = upkeepText(upkeep);
  const none = text === "None";
  return (
    <span
      className={cn(none ? "text-fg-body" : "text-warn", className)}
      title={
        none
          ? "Grows back everything it uses: nothing to supply after the starting items"
          : "It uses these up faster than it grows them. Nothing supplies them during a run: you'd have to, every day, on top of the starting items, or the flow's own steps must make them"
      }
    >
      {none ? noneText : text}
    </span>
  );
};
