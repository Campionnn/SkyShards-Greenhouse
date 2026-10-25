import React, { useMemo, useState } from "react";
import { Sprout } from "lucide-react";
import { DEFAULT_BAZAAR_PRICING, defaultGameData, type BazaarPricing, type BazaarQuote, type RunSummary } from "../../simulator";
import { moneyBySource } from "../../leaderboard/view";
import { getRarityTextColor } from "../../utilities/rarity";
import { CropImage } from "../shared";
import { Panel, SegmentedControl } from "../ui";
import { formatCoins, formatRate, nameOf, rarityOf } from "./format";

const data = defaultGameData();

/**
 * Where the run's money comes from, by the plant that was harvested: the same "money by source"
 * the leaderboard shows, from the live run (RunSummary.bySource), at the page's prices.
 */
export const EarningsPanel: React.FC<{ summary: RunSummary; quotes: Record<string, BazaarQuote> | null; pricing: BazaarPricing | null }> = ({ summary, quotes, pricing }) => {
  const [only, setOnly] = useState<"mutations" | "all">("mutations");
  const days = summary.elapsedSeconds / 86400;
  const board = quotes ? "normal" : "ironman_strict";
  const lines = useMemo(() => {
    if (!summary.bySource || !(days > 0)) return [];
    const perDay = Object.fromEntries(Object.entries(summary.bySource).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([i, n]) => [i, n / days]))]));
    return moneyBySource(data, perDay, board, quotes ?? {}, pricing ?? DEFAULT_BAZAAR_PRICING).filter((l) => l.coinsPerDay > 0);
  }, [summary.bySource, days, board, quotes, pricing]);
  const shown = only === "mutations" ? lines.filter((l) => l.isMutation) : lines;
  const total = lines.reduce((s, l) => s + l.coinsPerDay, 0);
  return (
    <Panel
      title="Earning plants"
      icon={<Sprout />}
      description={board === "normal" ? "Coins per day from each plant's harvests, at your Bazaar prices." : "Coins per day from each plant's harvests, at NPC prices (mutation items count 0 on ironman)."}
      actions={
        <SegmentedControl
          size="xs"
          nowrap
          value={only}
          onChange={setOnly}
          options={[
            { value: "mutations", label: "Mutations" },
            { value: "all", label: "All" },
          ]}
        />
      }
    >
      {shown.length === 0 ? (
        <p className="text-xs text-slate-500">{days > 0 ? "Nothing harvested for money yet." : "Run the simulation to see this."}</p>
      ) : (
        /* 8 rows visible (20 px each, 6 px apart); the rest scroll. The stable gutter and right
           padding keep the scrollbar (overlay ones included) clear of the % column. */
        <ul className="max-h-[202px] space-y-1.5 overflow-y-auto overscroll-contain scrollbar-dark pr-3 [scrollbar-gutter:stable]" aria-label="Earnings by plant">
          {shown.map((l) => {
            const share = total > 0 ? l.coinsPerDay / total : 0;
            const rarity = rarityOf(l.kind);
            return (
              <li key={l.kind} className="grid h-5 grid-cols-[1.25rem_minmax(0,9rem)_1fr_auto_2.5rem] items-center gap-2 text-xs">
                <CropImage cropId={l.kind} cropName={nameOf(l.kind)} size="custom" width={18} height={18} showFallback />
                <span className={`truncate ${rarity ? getRarityTextColor(rarity) : "text-slate-300"}`} title={Object.entries(l.items).map(([i, n]) => `${formatRate(n)} ${nameOf(i)}/day`).join(", ")}>
                  {nameOf(l.kind)}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-slate-700/40">
                  <span className={`block h-full rounded-full ${l.isMutation ? "bg-amber-400/70" : "bg-emerald-400/70"}`} style={{ width: `${share * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-emerald-300">{formatCoins(l.coinsPerDay)}/day</span>
                <span className="text-right tabular-nums text-slate-500">{Math.round(share * 100)}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
};
