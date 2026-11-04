import React, { useMemo, useState } from "react";
import { DEFAULT_BAZAAR_PRICING, defaultGameData, type BazaarPricing, type BazaarQuote, type RunSummary } from "../../simulator";
import { moneyBySource } from "../../leaderboard/view";
import { getRarityTextColor } from "../../utilities/rarity";
import { CropImage } from "../shared";
import { Segmented } from "../ui/kit";
import { formatCoins, formatRate, nameOf, rarityOf } from "./format";
import { LinkButton, ResultCard } from "./page/ResultCard";

const data = defaultGameData();

/** Rows shown before "Show all". */
const ROWS = 8;

/**
 * Where the run's money comes from, by the plant that was harvested: the same "money by source"
 * the leaderboard shows, from the live run (RunSummary.bySource), at the page's prices.
 */
export const EarningsPanel: React.FC<{ summary: RunSummary; quotes: Record<string, BazaarQuote> | null; pricing: BazaarPricing | null; className?: string }> = ({
  summary,
  quotes,
  pricing,
  className,
}) => {
  const [only, setOnly] = useState<"mutations" | "all">("mutations");
  const [all, setAll] = useState(false);
  const days = summary.elapsedSeconds / 86400;
  const board = quotes ? "normal" : "ironman";
  const lines = useMemo(() => {
    if (!summary.bySource || !(days > 0)) return [];
    const perDay = Object.fromEntries(Object.entries(summary.bySource).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([i, n]) => [i, n / days]))]));
    return moneyBySource(data, perDay, board, quotes ?? {}, pricing ?? DEFAULT_BAZAAR_PRICING).filter((l) => l.coinsPerDay > 0);
  }, [summary.bySource, days, board, quotes, pricing]);
  const shown = only === "mutations" ? lines.filter((l) => l.isMutation) : lines;
  const total = lines.reduce((s, l) => s + l.coinsPerDay, 0);
  const top = shown[0]?.coinsPerDay ?? 0;
  const visible = all ? shown : shown.slice(0, ROWS);

  return (
    <ResultCard
      title="Earning plants"
      className={className}
      hint={
        board === "normal"
          ? "Coins per day from each plant's harvests, at your Bazaar prices. The % is its share of everything harvested."
          : "Coins per day from each plant's harvests, at NPC prices (mutation items count 0 on ironman). The % is its share of everything harvested."
      }
      actions={
        <Segmented
          label="Which plants"
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
        <p className="text-[12.5px] text-slate-500">{days > 0 ? "Nothing harvested for money yet." : "Run the simulation to see this."}</p>
      ) : (
        <>
          <ul className="space-y-0.5" aria-label="Earnings by plant">
            {visible.map((l) => {
              const share = total > 0 ? l.coinsPerDay / total : 0;
              const rarity = rarityOf(l.kind);
              return (
                <li key={l.kind} className="grid grid-cols-[minmax(0,10rem)_1fr_5.5rem_2.25rem] items-center gap-3 py-[5px] text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <CropImage cropId={l.kind} cropName={nameOf(l.kind)} size="custom" width={18} height={18} showFallback className="shrink-0" />
                    <span
                      className={`truncate ${rarity ? getRarityTextColor(rarity) : "text-slate-300"}`}
                      title={`${nameOf(l.kind)}: ${Object.entries(l.items)
                        .map(([i, n]) => `${formatRate(n)} ${nameOf(i)}/day`)
                        .join(", ")}`}
                    >
                      {nameOf(l.kind)}
                    </span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-400/10">
                    <span className="block h-full rounded-full bg-yellow-400/75" style={{ width: `${top > 0 ? (l.coinsPerDay / top) * 100 : 0}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-slate-200">{formatCoins(l.coinsPerDay)}/day</span>
                  <span className="text-right tabular-nums text-slate-500">{Math.round(share * 100)}%</span>
                </li>
              );
            })}
          </ul>
          {shown.length > ROWS && (
            <LinkButton className="mt-2" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${shown.length}`}
            </LinkButton>
          )}
        </>
      )}
    </ResultCard>
  );
};
