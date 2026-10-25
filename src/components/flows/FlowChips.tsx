import React from "react";
import { Package, PauseCircle, TrendingDown } from "lucide-react";
import { kitText, starvedText, stepIdName, upkeepText, type KitGain, type StallInfo, type StepNamer } from "../../leaderboard/view";
import { Badge } from "./FlowControls";

/**
 * The leaderboard v2 row chips (docs/plans/leaderboard-boards-v2.md §7.1): what the starting items
 * add on "from nothing", a plot that stalls for lack of stock, and a cell that slows down at the end.
 */

export const SLOWING_TITLE = "Production falls off at the end of the run; scored at its last-20% rate.";

/** "Kit +34%" / "Kit needed" (the "from nothing" board). */
export const KitChip: React.FC<{ kit: KitGain }> = ({ kit }) => {
  const t = kitText(kit);
  return (
    <Badge tone="info" title={t.title} icon={<Package />}>
      {t.label}
    </Badge>
  );
};

/** Amber "Stall": a plot averages ≥ 5 layout cells empty for lack of stock. */
export const StallChip: React.FC<{ stall: StallInfo; stepName?: StepNamer }> = ({ stall, stepName = stepIdName }) => (
  <Badge tone="estimated" title={`${starvedText(stall.top, stepName)}.`} icon={<PauseCircle />}>
    Stall
  </Badge>
);

export const SlowingBadge: React.FC = () => (
  <Badge tone="warn" title={SLOWING_TITLE} icon={<TrendingDown />}>
    Slowing
  </Badge>
);

/** "Upkeep: None" in emerald, else the items per day in amber. */
export const UpkeepValue: React.FC<{ upkeep: unknown; className?: string }> = ({ upkeep, className = "" }) => {
  const text = upkeepText(upkeep);
  const none = text === "None";
  return (
    <span
      className={`${none ? "text-emerald-300" : "text-amber-300"} ${className}`}
      title={none ? "Gives back everything it borrows" : "Borrowed items it never gives back: you must supply these every day"}
    >
      {text}
    </span>
  );
};
