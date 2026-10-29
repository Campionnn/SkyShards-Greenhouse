import React, { useEffect, useMemo, useRef, useState } from "react";
import { Coins, Pencil, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { BAZAAR_PRODUCTS, COMPACTED_CROPS, defaultGameData, type BazaarOverride, type BazaarPricing, type MarketValuation, type RunSummary } from "../../simulator";
import type { BazaarPricesView } from "../../hooks/useBazaarPrices";
import { BodyPortal, InfoHint, Panel, PortalHost, SegmentedControl } from "../ui";
import { CropImage } from "../shared";
import { getRarityTextColor } from "../../utilities/rarity";
import { priceAge, priceRun, type Quotes } from "./bazaarFormat";
import { formatCoins, formatCount, nameOf, rarityOf } from "./format";
import { Leader, LeadValue, NumberInput, Stat } from "./controls";
import { buttonClass, inputClass } from "./styles";

// Normal-profile (Bazaar) panels. The engine counts what was produced, bought, sold and built
// (RunSummary.market); everything here prices those counts with the current Bazaar data (live
// order book plus the user's manual overrides), so a refresh, a side change or an override never
// re-runs the simulation. The inventory table (both profiles) is in InventoryTable.tsx.

const data = defaultGameData();
const perDayOf = (value: number, s: RunSummary) => (s.elapsedSeconds > 0 ? value / (s.elapsedSeconds / 86400) : 0);

/** Buy / sell side, tax, price age, Refresh and the price editor. */
export const BazaarPriceControls: React.FC<{ bazaar: BazaarPricesView; now: number; onEditPrices: () => void }> = ({ bazaar, now, onEditPrices }) => {
  const { pricing, setPricing, prices, loading, error, refresh, overrides } = bazaar;
  const overrideCount = Object.keys(overrides).length;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <label className="flex items-center gap-2 text-slate-400" title="What buying costs: an instant buy pays the cheapest sell offer now; a buy order matches the highest buy order and you wait.">
        Buy
        <SegmentedControl
          size="xs"
          nowrap
          value={pricing.buy}
          onChange={(buy) => setPricing({ ...pricing, buy })}
          options={[
            { value: "instant", label: "Instant buy" },
            { value: "order", label: "Buy order" },
          ]}
        />
      </label>
      <label className="flex items-center gap-2 text-slate-400" title="What selling brings: a sell order matches the cheapest sell offer and you wait; an instant sell takes the highest buy order now.">
        Sell
        <SegmentedControl
          size="xs"
          nowrap
          value={pricing.sell}
          onChange={(sell) => setPricing({ ...pricing, sell })}
          options={[
            { value: "order", label: "Sell order" },
            { value: "instant", label: "Instant sell" },
          ]}
        />
      </label>
      <label className="flex items-center gap-1.5 text-slate-400" title="Bazaar sales tax, taken from every sale. Buying is untaxed.">
        Tax
        <NumberInput
          min={0}
          max={100}
          step={0.125}
          className={`${inputClass} w-16 text-right`}
          value={pricing.taxPercent}
          onChange={(taxPercent) => setPricing({ ...pricing, taxPercent })}
          aria-label="Bazaar sales tax in percent"
        />
        %
      </label>
      <span className="flex flex-wrap items-center gap-2 ml-auto">
        <span className={error ? "text-amber-300" : "text-slate-500"} title={prices ? `Bazaar data from ${new Date(prices.lastUpdated || prices.fetchedAt).toLocaleString()}` : undefined}>
          {loading
            ? "Fetching prices..."
            : error
              ? prices
                ? `Couldn't refresh (${error}); prices from ${priceAge(prices.fetchedAt, now)}`
                : `Couldn't load prices: ${error}`
              : prices
                ? `Prices ${priceAge(prices.fetchedAt, now)}`
                : "No prices yet"}
        </span>
        <button className={buttonClass.neutral} onClick={onEditPrices} title="Set your own price for an item, e.g. when its Bazaar price is being manipulated">
          <Pencil className="w-3 h-3" /> Edit prices{overrideCount > 0 ? ` (${overrideCount} set)` : ""}
        </button>
        <button className={buttonClass.neutral} onClick={refresh} disabled={loading} title="Fetch the latest Bazaar prices (does not restart the simulation; your own prices stay)">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </span>
    </div>
  );
};

/** Money at Bazaar prices: revenue by category, stock used, purchases, profit; plus sold and the one-off build cost. */
export const BazaarMoneyPanel: React.FC<{
  summary: RunSummary;
  previous: RunSummary | null;
  quotes: Quotes | null;
  pricing: BazaarPricing;
  cycleSeconds?: number;
}> = ({ summary, previous, quotes, pricing, cycleSeconds }) => {
  const now = priceRun(summary, quotes, pricing);
  const before = priceRun(previous, quotes, pricing);
  if (!summary.market) return null;

  const rows: { label: string; get: (v: MarketValuation) => number; strong?: boolean; hint?: string }[] = [
    { label: "Crops", get: (v) => v.revenue.crops, hint: "Base-crop drops (including mutation bundles), each at the better of its NPC price and its Bazaar price." },
    { label: "Rare crops", get: (v) => v.revenue.rareCrops, hint: "Armor bonus drops (Cropie, Squash, Fermento, Helianthus) and Ethereal Vine, at the better of NPC and Bazaar." },
    { label: "Harvest Bounty", get: (v) => v.revenue.rareDrops, hint: "Bonus Drops rolls (chips, spores, Iridium...), at the better of NPC and Bazaar." },
    {
      label: "Mutation items",
      get: (v) => v.revenue.mutationItems,
      hint: "Every mutation item the run produced, at its Bazaar sell price. The ones you keep for re-placing are charged back below as \"Stock used\", so this is the same whether they are sold now or later.",
    },
    { label: "Revenue", get: (v) => v.revenueTotal, strong: true },
    {
      label: "Stock used",
      get: (v) => -v.ownStock,
      hint: "Items placed from your own stock (re-placing after decay, later flow steps), at their sell price: you could have sold them instead.",
    },
    { label: "Bought", get: (v) => -v.bought, hint: "Items bought on the Bazaar because a placement was short of stock, at the buy price." },
    { label: "Profit", get: (v) => v.profit, strong: true },
  ];

  return (
    <Panel
      title="Money (Bazaar)"
      icon={<Coins />}
      description="Normal profile: prices from the Bazaar. Delta = the last Step / Run."
      actions={
        <InfoHint title="How profit is counted" width={320}>
          Everything the run produces is valued at what it sells for (mutation items on the Bazaar, everything else at the better of NPC and Bazaar, after
          tax). Items you place from your own stock cost what you could have sold them for, and items you have to buy cost the Bazaar buy price. So
          profit doesn't depend on when you sell. The starting layouts are free in the run; what buying them costs is shown separately as a one-off.
        </InfoHint>
      }
    >
      {!now ? (
        <p className="text-xs text-slate-400">Waiting for Bazaar prices...</p>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
            <span />
            <span className="text-slate-500 text-right">delta</span>
            <span className="text-slate-500 text-right">total</span>
            <span className="text-slate-500 text-right">/day</span>
            {rows.map((r) => {
              const total = r.get(now);
              const delta = total - (before ? r.get(before) : 0);
              const cls = r.strong ? "text-slate-100 font-medium" : "text-slate-300";
              const day = perDayOf(total, summary);
              return (
                <React.Fragment key={r.label}>
                  <span className={`${cls} flex items-center gap-1`}>
                    {r.label}
                    {r.hint && (
                      <InfoHint title={r.label} width={260}>
                        {r.hint}
                      </InfoHint>
                    )}
                    <Leader className="-mr-3" />
                  </span>
                  <LeadValue className="text-slate-400">{formatCoins(delta)}</LeadValue>
                  <span className={`text-right ${cls}`}>{formatCoins(total)}</span>
                  <span className={`text-right ${r.strong ? (day < 0 ? "text-red-300" : "text-emerald-300") : "text-slate-400"}`}>{formatCoins(day)}</span>
                </React.Fragment>
              );
            })}
          </div>
          <div className="border-t border-slate-700/60 mt-3 pt-2">
            <Stat
              label="Cost to build (one-off)"
              value={formatCoins(now.buildCost)}
              title="Buying every item the starting layouts place, at the buy price. Not part of the profit: the run starts with them placed."
            />
            <Stat label="Mutations sold so far" value={formatCoins(now.sold)} title="Mutation items sold above the reserve after each online session. Already counted in the profit." />
            {cycleSeconds !== undefined && cycleSeconds > 0 && <Stat label="Cycles per day" value={`~${(86400 / cycleSeconds).toFixed(1)}`} />}
            {now.unpriced.length > 0 && (
              <Stat
                label="No price for"
                tone="bad"
                value={now.unpriced.map(nameOf).join(", ")}
                title="These items have no NPC price and no Bazaar quote, so they count as 0 coins. Set a price with Edit prices."
              />
            )}
          </div>
        </>
      )}
    </Panel>
  );
};

// ---- Price editor -------------------------------------------------------------

type PriceEditorProps = { bazaar: BazaarPricesView; focusItem: string | null; itemIds: string[]; onClose: () => void };

/** Native modal dialog (Escape, inert background) around the price editor. */
export const BazaarPriceDialog: React.FC<PriceEditorProps> = (props) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  const { onClose } = props;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    setHost(element);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <BodyPortal>
      <dialog
        ref={dialog}
        aria-labelledby="bazaar-prices-title"
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-3xl max-h-[calc(100dvh-2rem)] p-0 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const b = e.currentTarget.getBoundingClientRect();
          if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) onClose();
        }}
      >
        <PortalHost container={host}>
          <BazaarPricePanel {...props} />
        </PortalHost>
      </dialog>
    </BodyPortal>
  );
};

/** The price editor body (separate from the dialog for server-render tests). */
export const BazaarPricePanel: React.FC<PriceEditorProps> = ({ bazaar, focusItem, itemIds, onClose }) => {
  const { overrides, setOverrides, prices } = bazaar;
  const live = prices?.quotes ?? {};
  const [query, setQuery] = useState(focusItem ? nameOf(focusItem) : "");
  const [all, setAll] = useState(false);
  const ids = useMemo(() => {
    const base = all ? Object.keys(BAZAAR_PRODUCTS) : [...new Set([...itemIds, ...Object.keys(overrides)])].filter((id) => id in BAZAAR_PRODUCTS);
    const q = query.trim().toLowerCase();
    return base
      .filter((id) => !q || nameOf(id).toLowerCase().includes(q) || id.includes(q))
      .sort((a, b) => Number(!(a in overrides)) - Number(!(b in overrides)) || Number(!data.mutations[a]) - Number(!data.mutations[b]) || nameOf(a).localeCompare(nameOf(b)));
  }, [all, itemIds, overrides, query]);

  const set = (id: string, side: keyof BazaarOverride, value: number | null) => {
    const next = { ...overrides };
    const o: BazaarOverride = { ...next[id] };
    if (value === null || !(value > 0)) delete o[side];
    else o[side] = value;
    if (Object.keys(o).length) next[id] = o;
    else delete next[id];
    setOverrides(next);
  };
  const count = Object.keys(overrides).length;

  return (
    <div className="flex flex-col max-h-[calc(100dvh-2rem)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-5">
        <h2 id="bazaar-prices-title" className="text-base font-semibold text-slate-100">
          Bazaar prices
        </h2>
        <button type="button" className={`${buttonClass.icon} p-2`} onClick={onClose} aria-label="Close price editor">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="px-4 pt-3 sm:px-5 space-y-2">
        <p className="text-xs leading-relaxed text-slate-400">
          Replace a live price with your own, for example when an item's Bazaar price is being manipulated. Leave a box empty to use the live price.
          Your prices are kept in this browser and survive Refresh. The run never restarts: only the money figures change.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-48">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input className={`${inputClass} w-full pl-7`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items" aria-label="Search items" />
          </label>
          <SegmentedControl
            size="xs"
            nowrap
            value={all ? "all" : "used"}
            onChange={(v) => setAll(v === "all")}
            options={[
              { value: "used", label: "This scenario" },
              { value: "all", label: "All items" },
            ]}
          />
          <button className={buttonClass.neutral} disabled={count === 0} onClick={() => setOverrides({})} title="Remove every price you set">
            <RotateCcw className="w-3 h-3" /> Clear all ({count})
          </button>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto scrollbar-dark px-4 py-3 sm:px-5">
        <div className="grid grid-cols-[minmax(9rem,1fr)_auto_auto_1.5rem] gap-x-3 gap-y-1.5 items-center text-xs">
          <span className="text-[10px] text-slate-500">item</span>
          <span className="text-[10px] text-slate-500 text-right" title="The cheapest sell offer: what an instant buy pays, and where a sell order sits">
            instant buy price
            <span className="block text-slate-600">lowest sell offer</span>
          </span>
          <span className="text-[10px] text-slate-500 text-right" title="The highest buy order: what an instant sell receives, and where a buy order sits">
            instant sell price
            <span className="block text-slate-600">highest buy order</span>
          </span>
          <span />
          {ids.map((id) => {
            const o = overrides[id];
            const q = live[id];
            // Base crops trade compacted: prices here are per compacted item, stored per crop.
            const compacted = COMPACTED_CROPS[id];
            const k = compacted?.per ?? 1;
            const shown = (v: number | null | undefined) => (v === null || v === undefined ? v : v * k);
            const stored = (v: number | null) => (v === null ? null : v / k);
            const label = compacted ? compacted.name : nameOf(id);
            return (
              <React.Fragment key={id}>
                <span className="flex items-center gap-1.5 min-w-0">
                  <CropImage cropId={id} cropName={nameOf(id)} size="xs" showFallback />
                  <span className="min-w-0">
                    <span className={`${data.mutations[id] ? getRarityTextColor(rarityOf(id) ?? "common") : "text-slate-300"} break-words`}>{nameOf(id)}</span>
                    {compacted && (
                      <span className="block text-[10px] text-slate-500" title={`Crops are sold compacted. Prices are per ${compacted.name} (${formatCount(compacted.per)} crops).`}>
                        per {compacted.name} ({formatCount(compacted.per)})
                      </span>
                    )}
                  </span>
                  <Leader className="-mr-3" />
                </span>
                <PriceInput value={shown(o?.lowestSellOffer) ?? undefined} live={shown(q?.lowestSellOffer) ?? null} onChange={(v) => set(id, "lowestSellOffer", stored(v))} label={`Instant buy price of ${label}`} />
                <PriceInput value={shown(o?.highestBuyOrder) ?? undefined} live={shown(q?.highestBuyOrder) ?? null} onChange={(v) => set(id, "highestBuyOrder", stored(v))} label={`Instant sell price of ${label}`} />
                {o ? (
                  <button
                    className={buttonClass.icon}
                    onClick={() => setOverrides(Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== id)))}
                    title="Back to live prices"
                    aria-label={`Live prices for ${nameOf(id)}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                ) : (
                  <span />
                )}
              </React.Fragment>
            );
          })}
        </div>
        {ids.length === 0 && <p className="text-xs text-slate-500">No items match.</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-3 sm:px-5">
        <button type="button" className={buttonClass.primary} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
};

/** A price box: empty = the live price (shown as the placeholder). Commits on blur / Enter; accepts 650k, 1.2m, 1,234. */
const PriceInput: React.FC<{ value: number | undefined; live: number | null; onChange: (v: number | null) => void; label: string }> = ({ value, live, onChange, label }) => {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setDraft(value === undefined ? "" : String(value));
  }
  const commit = () => {
    const n = parseCoins(draft);
    if (n === undefined) setDraft(value === undefined ? "" : String(value));
    else if (n !== (value ?? null)) onChange(n);
  };
  return (
    <input
      className={`${inputClass} w-32 text-right ${value !== undefined ? "border-sky-400/60 text-sky-200" : ""}`}
      value={draft}
      placeholder={live === null ? "no live price" : `live ${formatCoins(live)}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      inputMode="decimal"
      aria-label={label}
      title="Coins per unit; 650k, 1.2m and 1,234 all work. Empty = the live price."
    />
  );
};

/** "650k" -> 650000; "" -> null (use live); invalid -> undefined. */
function parseCoins(text: string): number | null | undefined {
  const t = text.trim().replace(/,/g, "");
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([kmb])?$/i.exec(t);
  if (!m) return undefined;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  const n = Number(m[1]) * mult;
  return n > 0 ? n : null;
}
