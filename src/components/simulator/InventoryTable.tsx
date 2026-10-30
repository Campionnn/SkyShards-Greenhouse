import React, { useMemo, useRef, useState } from "react";
import { ChevronRight, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { COMPACTED_CROPS, defaultGameData, reservePlan, UNIQUE_CROP_CAP, type Scenario, type SimulationState } from "../../simulator";
import type { BazaarPricesView } from "../../hooks/useBazaarPrices";
import { InfoHint } from "../ui";
import { IconButton, KitButton, Segmented } from "../ui/kit";
import { CropImage } from "../shared";
import { getRarityTextColor } from "../../utilities/rarity";
import { BazaarPriceControls, BazaarPriceDialog } from "./BazaarPanels";
import { applyItemDelta, buildItemRows, priceRun, type ItemRow } from "./bazaarFormat";
import { allItemIds, formatCoins, formatCount, formatRate, formatUnitPrice, nameOf, rarityOf, type ItemCategory } from "./format";
import { NumberInput } from "./controls";
import { ItemPicker } from "./ItemPicker";
import { ResultCard } from "./page/ResultCard";

// The simulator's inventory panel, for both profiles (ironman and normal / Bazaar).

const data = defaultGameData();

const SECTIONS: { key: ItemCategory; title: string; hint: string }[] = [
  { key: "mutation", title: "Mutations", hint: "Mutation items (planting stock for re-placing) and Dead Plants (from clearing decayed plants)." },
  { key: "crop", title: "Crops", hint: "Base-crop drops (including mutation bundles) and seeds." },
  {
    key: "rareCrop",
    title: "Rare crops",
    hint: "Armor tiered-bonus drops (Cropie, Squash, Fermento, Helianthus) and a harvested mutation's own Ethereal Vine. Their chances are multiplied by (1 + Overbloom/100).",
  },
  { key: "other", title: "Other drops", hint: "Harvest Bounty drops from plants holding Bonus Drops (not affected by Overbloom) and anything else." },
];

/** Sections that start collapsed. */
const COLLAPSED_BY_DEFAULT: Partial<Record<ItemCategory, boolean>> = { rareCrop: true, other: true };

/** The section a row is listed under: Dead Plants sit with the mutations (they are placed like them). */
const sectionOf = (r: ItemRow): ItemCategory => (r.id === "dead_plant" ? "mutation" : r.category);

/** Grid columns. Normal: item, held, made, used, bought, sold, price, reserve, worth, remove. Ironman: item, held, made, used, net, price, worth, remove. */
const COLS_NORMAL = "grid-cols-[minmax(10rem,1.6fr)_repeat(5,minmax(5rem,auto))_minmax(7.5rem,auto)_minmax(5.5rem,auto)_minmax(5.5rem,auto)_2rem]";
const COLS_IRONMAN = "grid-cols-[minmax(10rem,1.6fr)_repeat(4,minmax(5.25rem,auto))_minmax(5.5rem,auto)_minmax(5.5rem,auto)_2rem]";
/** Rows a section shows before it scrolls (problems first, then the most valuable). */
const ROWS_SHOWN = 5;

/** A per-crop price with 2 decimals (3.93), where `formatCoins` would round it to a whole coin. */
const formatPerCrop = (n: number): string => (n >= 1000 ? formatCoins(n) : n.toFixed(2));

/** Everything the normal profile adds to the inventory table. */
export interface InventoryBazaar {
  scenario: Scenario;
  view: BazaarPricesView;
  now: number;
  onReserveChange: (reserve: Record<string, number>) => void;
}

/**
 * The shared inventory, one row per item, in both profiles. Every column follows the Total /
 * Per day toggle. Ironman (no `bazaar`): held, made, used, net (made − used: whether the run keeps
 * its stock up) and NPC values; mutation items have no NPC price. Normal profile (`bazaar`): the
 * Bazaar in the same table: prices (live order book plus your overrides, editable in a modal),
 * bought and sold with coins, reserve, and the profit. Before the first cycle, changes edit the
 * starting inventory (saved with the scenario); after that they change the live run.
 */
export const InventoryTable: React.FC<{
  state: SimulationState;
  bazaar?: InventoryBazaar;
  /** Change the live run's inventory (negative = remove). Omit for a read-only panel. */
  onAddItems?: (items: Record<string, number>) => void;
  busy?: boolean;
  startingInventory?: Record<string, number>;
  onStartingInventoryChange?: (v: Record<string, number>) => void;
}> = ({ state, bazaar, onAddItems, busy = false, startingInventory, onStartingInventoryChange }) => {
  const normal = !!bazaar;
  const [mode, setMode] = useState<"total" | "perDay">("total");
  /** The price editor: false = closed, null = open on no item, an id = open on that item. */
  const [editing, setEditing] = useState<string | null | false>(false);
  const [collapsed, setCollapsed] = useState<Partial<Record<ItemCategory, boolean>>>(COLLAPSED_BY_DEFAULT);
  const toggleSection = (key: ItemCategory) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const perDay = mode === "perDay";
  const days = state.elapsedSeconds / 86400;
  const scale = (n: number) => (perDay ? (days > 0 ? n / days : 0) : n);
  const qty = (n: number) => (perDay ? formatRate(scale(n)) : formatCount(n));
  const coins = (n: number) => formatCoins(scale(n));

  const injected = Object.entries(state.summary.injected).filter(([, n]) => n !== 0);
  const canEditStart = !!startingInventory && !!onStartingInventoryChange;
  const atStart = canEditStart && state.cycle === 0 && injected.length === 0;
  const held = atStart ? startingInventory : state.inventory;
  const canChange = atStart || !!onAddItems;
  const change = (items: Record<string, number>) => {
    if (atStart) onStartingInventoryChange!(applyItemDelta(startingInventory!, items));
    else onAddItems?.(items);
  };

  const scenario = bazaar?.scenario;
  const plan = useMemo(() => {
    if (!scenario) return { reserve: {}, auto: {} } as ReturnType<typeof reservePlan>;
    try {
      return reservePlan(scenario, data);
    } catch {
      return { reserve: {}, auto: {} };
    }
  }, [scenario]);
  const reserveOverrides = useMemo(() => scenario?.settings.reserve ?? {}, [scenario]);
  const quotes = bazaar?.view.quotes ?? null;
  const pricing = bazaar?.view.pricing ?? null;
  const overrides = bazaar?.view.overrides ?? null;

  const rows = useMemo(
    () =>
      buildItemRows({
        state,
        held,
        bazaar: pricing && overrides ? { quotes, pricing, reserve: plan.reserve, reserveOverrides, overridden: overrides } : undefined,
      }),
    [state, held, quotes, pricing, plan.reserve, reserveOverrides, overrides]
  );
  const grouped = useMemo(() => {
    const out = new Map<ItemCategory, ItemRow[]>(SECTIONS.map((s) => [s.key, []]));
    const sellOf = (r: ItemRow) => r.prices?.sell ?? 0;
    for (const r of rows) out.get(sectionOf(r))!.push(r);
    // Problems first, so the 5-row cut never hides them: a stock below 0 (mutation debt) or a net
    // loss (placed more than made). Then the most valuable, then the most made.
    const trouble = (r: ItemRow) => (r.held < 0 || r.made - r.used < 0 ? 1 : 0);
    for (const list of out.values())
      list.sort(
        (a, b) =>
          trouble(b) - trouble(a) ||
          b.made * sellOf(b) - a.made * sellOf(a) ||
          b.made - a.made ||
          b.held - a.held ||
          nameOf(a.id).localeCompare(nameOf(b.id))
      );
    return out;
  }, [rows]);

  const totals = rows.reduce(
    (t, r) => {
      const s = r.prices?.sell ?? 0;
      return { held: t.held + r.held * s, made: t.made + r.made * s, sold: t.sold + r.sold * s, bought: t.bought + r.bought * (r.prices?.buy ?? 0) };
    },
    { held: 0, made: 0, sold: 0, bought: 0 }
  );
  const mutationRows = rows.filter((r) => r.category === "mutation");
  const mutationNet = mutationRows.reduce((a, r) => a + r.made - r.used, 0);
  const mutationsHeld = mutationRows.reduce((a, r) => a + r.held, 0);
  const shortItems = state.summary.debtEvents;

  const setReserve = (id: string, n: number | null) => {
    if (!bazaar) return;
    const next = { ...reserveOverrides };
    if (n === null) delete next[id];
    else next[id] = n;
    bazaar.onReserveChange(next);
  };

  // Normal: the same valuation as the Money panel and the run bar, so the three always agree.
  const profit = bazaar ? priceRun(state.summary, quotes, bazaar.view.pricing)?.profit ?? 0 : 0;

  type Total = { label: string; value: string; title: string; tone?: string };
  const totalsLine: Total[] = normal
    ? [
        ...(perDay
          ? []
          : [
              {
                label: "holding",
                value: formatCoins(totals.held),
                title: "What everything in the inventory now sells for. Lower than Made by what was sold and what was placed from stock; higher by your starting stock and purchases.",
              },
            ]),
        { label: perDay ? "made / day" : "made", value: coins(totals.made), title: "Everything the run produced, at what it sells for (the Money panel's revenue)." },
        { label: perDay ? "sold / day" : "sold", value: coins(totals.sold), title: "Mutation items sold above their reserve after each online session." },
        { label: perDay ? "bought / day" : "bought", value: coins(totals.bought), title: "Items bought because a placement was short of stock." },
        {
          label: perDay ? "profit / day" : "profit",
          value: coins(profit),
          title: "The Money panel's profit: everything made, minus items placed from your own stock (at what they sell for), minus what was bought.",
          tone: profit < 0 ? "text-red-300" : "text-yellow-400",
        },
      ]
    : [
        // Ironman has no "Holding" coin figure: only mutations (no NPC price), fermento and dead plants are
        // ever placed, so the NPC value held is the NPC value made (plus starting stock). The mutation
        // stock is what an ironman actually holds.
        ...(perDay
          ? []
          : [
              {
                label: "mutations held",
                value: formatCount(mutationsHeld),
                title: "Mutation items in stock now, ready to re-place. They have no NPC price, so no coin value.",
                tone: mutationsHeld < 0 ? "text-red-300" : undefined,
              },
            ]),
        { label: perDay ? "made / day (NPC)" : "made (NPC)", value: coins(totals.made), title: "NPC value of everything the run produced (the Money panel's revenue)." },
        {
          label: perDay ? "mutations net / day" : "mutations net",
          value: `${mutationNet > 0 ? "+" : ""}${qty(mutationNet)}`,
          title: "Mutation items produced minus mutation items placed. Below 0 means the flow uses more than it grows.",
          tone: mutationNet < 0 ? "text-red-300" : undefined,
        },
        {
          label: shortItems === 1 ? "shortfall" : "shortfalls",
          value: formatCount(shortItems),
          title: "Times a placement was short of an item (see Sustainability). Not scaled per day.",
          tone: shortItems > 0 ? "text-red-300" : undefined,
        },
      ];

  const ready = !normal || !!quotes;
  const head = (text: string, title: string, perDaySuffix = true) => (
    <span className="px-3 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500" title={title}>
      {text}
      {perDay && perDaySuffix ? "/day" : ""}
    </span>
  );

  return (
    <ResultCard
      title={normal ? "Inventory & Bazaar" : "Inventory"}
      meta={`Shared by all plots · unique crops ${state.uniqueCropsStanding ?? 0} + Flora ${state.scenario.settings.playerStats.floraShard ?? 0} = ${state.uniqueCropCount}/${UNIQUE_CROP_CAP}`}
      hintTitle="Reading the table"
      hintWidth={340}
      hint={
        <>
          <p>{normal ? "A placement short of stock is bought; after every online session, mutation items above their reserve are sold." : "Values are NPC prices; mutation items have none."}</p>
          <p>
            {normal ? (
              <>
                Held: in the inventory now. Made: produced by the run. Used: placed, from stock or bought. Bought and Sold: Bazaar trades, with the coins they cost or
                brought. Sell / buy: what one sells for and what one costs (npc = the NPC pays more than the Bazaar; click it to set your own price). Reserve: how many of
                a mutation are kept for re-placing instead of sold (automatic: the most any step places, per plot, added up; type a number to override, which restarts
                the run). Worth: what the items made sell for.
              </>
            ) : (
              <>
                Held: in the inventory now (what you started with, plus what the run made, minus what it placed, plus your changes). Made: produced by the run (harvests,
                cleared Dead Plants). Used: placed (re-placing after decay, later steps). Net: made minus used, so a mutation going negative means the flow uses more
                than it grows. NPC: what one sells for to an NPC. Worth: NPC value of what was made.
              </>
            )}{" "}
            Per day divides every column by the simulated days.
          </p>
        </>
      }
      actions={
        <>
          <span className="flex flex-wrap items-center justify-end gap-x-1.5 text-[12px] text-slate-500" aria-label="Totals">
            {totalsLine.map((x, i) => (
              <span key={x.label} title={x.title} className="whitespace-nowrap">
                {i > 0 && <span className="mr-1.5 text-slate-600">·</span>}
                <b className={`font-semibold tabular-nums ${x.tone ?? "text-slate-200"}`}>{ready ? x.value : "..."}</b> {x.label}
              </span>
            ))}
            {perDay && <span className="whitespace-nowrap text-slate-600">· {days > 0 ? `${days.toFixed(1)} days so far` : "run it first"}</span>}
          </span>
          <span className="mx-1 hidden h-5 w-px bg-slate-700/60 sm:block" aria-hidden />
          <Segmented
            label="Inventory figures"
            value={mode}
            onChange={setMode}
            options={[
              { value: "total", label: "Total" },
              { value: "perDay", label: "Per day", title: "Divide every column by the simulated days" },
            ]}
          />
        </>
      }
    >
      {bazaar && <BazaarPriceControls bazaar={bazaar.view} now={bazaar.now} onEditPrices={() => setEditing(null)} className="mb-3" />}

      {canChange && (
        <div className="mb-3 space-y-1.5">
          <AddItemsRow onAdd={change} disabled={busy} held={held} />
          <p className="text-[11px] text-slate-500">
            {busy
              ? "Stop the run to change the inventory."
              : atStart
                ? normal
                  ? "This is what you start with (saved with the scenario, used again on every Reset). Placing the starting layouts is free."
                  : "This is what you start with. It is saved with the scenario and used again on every Reset. Placing the starting layouts is free; this stock pays for mutation items, fermento and dead plants placed later (re-placing after decay, or a later step)."
                : "The run has started: changes apply to it from now on (not revenue, not produced). Reset goes back to the starting inventory."}
          </p>
        </div>
      )}

      <div className="overflow-x-auto scrollbar-dark">
        <div className={`grid ${normal ? COLS_NORMAL : COLS_IRONMAN} items-center text-[12.5px] ${normal ? "min-w-[58rem]" : "min-w-[44rem]"}`} data-testid="inventory-items">
          <span className="py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">item</span>
          {head(perDay ? "" : "held", "In the inventory now", false)}
          {head("made", "Produced by the run")}
          {head("used", normal ? "Spent placing it (re-placing, later steps), from stock or bought" : "Spent placing it (re-placing after decay, later steps)")}
          {normal ? (
            <>
              {head("bought", "Bought on the Bazaar because a placement was short; below it, the coins it cost")}
              {head("sold", "Sold on the Bazaar above the reserve; below it, the coins it brought")}
              <span
                className="px-3 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500"
                title={`Sells for (${bazaar!.view.pricing.sell === "order" ? "sell order" : "instant sell"}, after tax) / costs to buy (${bazaar!.view.pricing.buy === "order" ? "buy order" : "instant buy"}). Click a price to set your own.`}
              >
                sell / buy
              </span>
              {head("reserve", "Mutation items kept for re-placing instead of sold", false)}
            </>
          ) : (
            <>
              {head("net", "Made minus used. Below 0: the run places more than it makes")}
              {head("NPC", "NPC sell price of one", false)}
            </>
          )}
          {head("worth", normal ? "What the items made sell for" : "NPC value of the items made")}
          <span />

          {SECTIONS.map((s) => {
            const list = grouped.get(s.key)!;
            if (!list.length) return null;
            const worth = list.reduce((a, r) => a + r.made * (r.prices?.sell ?? 0), 0);
            const isCollapsed = !!collapsed[s.key];
            const sectionId = `inventory-section-${s.key}`;
            return (
              <React.Fragment key={s.key}>
                <div className="col-span-full flex items-center gap-2 pt-4 pb-1.5">
                  <button
                    type="button"
                    className="-ml-1 flex cursor-pointer items-center gap-1 rounded px-1 text-slate-500 transition-colors duration-150 hover:text-slate-200"
                    onClick={() => toggleSection(s.key)}
                    aria-expanded={!isCollapsed}
                    aria-controls={sectionId}
                    title={isCollapsed ? `Show ${s.title.toLowerCase()}` : `Hide ${s.title.toLowerCase()}`}
                    data-section-toggle={s.key}
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`} />
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em]">{s.title}</span>
                  </button>
                  <InfoHint title={s.title} width={260}>
                    {s.key === "mutation"
                      ? normal
                        ? `${s.hint} Valued at their Bazaar sell price; whatever is above the reserve is sold after each online session.`
                        : `${s.hint} Mutation items are Bazaar-only, so they are worth 0 at NPC.`
                      : `${s.hint} ${normal ? "Valued at the better of NPC and Bazaar." : "Valued at NPC price."}`}
                  </InfoHint>
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {list.length}
                    {!isCollapsed && list.length > ROWS_SHOWN ? " · scroll for more" : ""}
                  </span>
                  <span className="ml-auto text-[12px] tabular-nums text-slate-500">
                    {s.key === "mutation" && !normal && worth === 0 ? (
                      "no NPC price"
                    ) : (
                      <>
                        made worth <span className="font-medium text-yellow-400">{ready ? coins(worth) : "..."}</span>
                        {perDay ? "/day" : ""}
                      </>
                    )}
                  </span>
                </div>
                {/* About 5 rows tall, the rest scrolls. A subgrid, so the columns line up with the header; every
                    section reserves the scrollbar's width (stable gutter), scrolling or not, so they all stay the
                    same width. Row lines are drawn by the first cell (clipped to the section's width). */}
                {!isCollapsed && (
                  <div
                    id={sectionId}
                    className={`col-span-full grid grid-cols-subgrid items-center auto-rows-[minmax(2rem,auto)] overflow-x-hidden [scrollbar-gutter:stable] scrollbar-dark ${
                      list.length > ROWS_SHOWN ? "overflow-y-auto overscroll-contain" : "overflow-y-hidden"
                    }`}
                    style={list.length > ROWS_SHOWN ? { maxHeight: `${ROWS_SHOWN * 2 + 0.5}rem` } : undefined}
                    data-section={s.key}
                    role="group"
                    aria-label={`${s.title}, ${list.length} item${list.length === 1 ? "" : "s"}`}
                    tabIndex={list.length > ROWS_SHOWN ? 0 : undefined}
                  >
                    {list.map((r) => (
                      <ItemLine
                        key={r.id}
                        r={r}
                        normal={normal}
                        perDay={perDay}
                        qty={qty}
                        coins={coins}
                        autoReserve={plan.auto[r.id] ?? 0}
                        onReserve={setReserve}
                        onEditPrice={() => setEditing(r.id)}
                        onRemove={!perDay && canChange && r.held > 0 ? () => change({ [r.id]: -r.held }) : undefined}
                        busy={busy}
                      />
                    ))}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        {rows.length === 0 && <p className="mt-2 text-[12.5px] text-slate-500">{normal ? "Nothing held, made or traded yet." : "Nothing held or made yet."}</p>}
      </div>

      {!atStart && (canEditStart || injected.length > 0) && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-slate-700/50 pt-3 text-[12px] text-slate-500">
          <span className="min-w-0">
            Started with:{" "}
            {startingInventory && Object.keys(startingInventory).length
              ? Object.entries(startingInventory)
                  .map(([id, n]) => `${formatCount(n)} ${nameOf(id)}`)
                  .join(", ")
              : "nothing"}
            .
            {injected.length > 0 && <> Changed by you since: {injected.map(([id, n]) => `${n > 0 ? "+" : ""}${formatCount(n)} ${nameOf(id)}`).join(", ")}.</>}
          </span>
          {canEditStart && injected.length > 0 && (
            <KitButton
              className="ml-auto"
              disabled={busy}
              onClick={() => onStartingInventoryChange!(applyItemDelta(startingInventory!, Object.fromEntries(injected)))}
              title="Add your changes to the starting inventory. This restarts the run from cycle 0."
            >
              Keep for next time (restarts)
            </KitButton>
          )}
        </div>
      )}

      {bazaar && editing !== false && <BazaarPriceDialog bazaar={bazaar.view} focusItem={editing} itemIds={rows.map((r) => r.id)} onClose={() => setEditing(false)} />}
    </ResultCard>
  );
};
const ItemLine: React.FC<{
  r: ItemRow;
  normal: boolean;
  perDay: boolean;
  qty: (n: number) => string;
  coins: (n: number) => string;
  autoReserve: number;
  onReserve: (id: string, n: number | null) => void;
  onEditPrice: () => void;
  onRemove?: () => void;
  busy: boolean;
}> = ({ r, normal, perDay, qty, coins, autoReserve, onReserve, onEditPrice, onRemove, busy }) => {
  const isMut = r.category === "mutation";
  const p = r.prices;
  // Normal profile, base crops: the price cell shows the double-compacted item's price (what is
  // actually traded, e.g. Compacted Sunflower), both sides. An NPC price there is the NPC price
  // of the compacted item, which is exactly 25,600 crops' worth. Counts and coins elsewhere stay per crop.
  const compacted = normal ? COMPACTED_CROPS[r.id] : undefined;
  const unit = compacted?.per ?? 1;
  const num = (n: number, cls = "text-slate-200") => <Cell className={n ? cls : "text-slate-600"}>{n ? qty(n) : "—"}</Cell>;
  const trade = (n: number, unit: number) =>
    n ? (
      <Cell className="leading-tight">
        <span>
          <span className="text-slate-200">{qty(n)}</span>
          <span className="block text-[10.5px] text-slate-500">{p ? coins(n * unit) : "..."}</span>
        </span>
      </Cell>
    ) : (
      <Cell className="text-slate-600">—</Cell>
    );
  const net = r.made - r.used;
  return (
    <>
      <Cell first>
        <span className="flex min-w-0 items-center gap-2">
          <CropImage cropId={r.id} cropName={nameOf(r.id)} size="custom" width={20} height={20} showFallback className="shrink-0" />
          <span className={`${isMut ? getRarityTextColor(rarityOf(r.id) ?? "common") : "text-slate-300"} break-words min-w-0`}>{nameOf(r.id)}</span>
        </span>
      </Cell>
      {perDay ? (
        // No held figure per day.
        <Cell />
      ) : (
        <Cell
          className={r.held < 0 ? "text-red-300" : r.held ? "text-slate-100" : "text-slate-600"}
          title={r.held < 0 ? "Below 0: placed on mutation debt (Advanced › Allow mutation debt); later harvests pay it back." : undefined}
        >
          {r.held ? formatCount(r.held) : "—"}
        </Cell>
      )}
      {num(r.made)}
      {num(r.used)}
      {normal ? (
        <>
          {trade(r.bought, p?.buy ?? 0)}
          {trade(r.sold, p?.sell ?? 0)}
          <Cell>
            <button
              type="button"
              onClick={onEditPrice}
              className={`-mx-1.5 cursor-pointer rounded-md px-1.5 py-0.5 text-right tabular-nums transition-colors duration-150 hover:bg-slate-700/50 ${r.overridden ? "shadow-[inset_0_0_0_1px_rgba(56,189,248,0.45)]" : ""}`}
              title={[
                r.overridden ? "Your own price (click to change)." : p?.sellFrom === "npc" ? "The NPC pays more than the Bazaar (click to set your own Bazaar price)." : "Click to set your own price.",
                compacted
                  ? `Crops are sold compacted: this is the price of one ${compacted.name} (${formatCount(compacted.per)} crops). One crop: ${p ? formatPerCrop(p.sell) : "..."} / ${p && p.buy !== null ? formatPerCrop(p.buy) : "-"}.`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className={r.overridden ? "text-sky-200" : "text-slate-200"}>{p ? (p.sellFrom === "none" ? "-" : formatCoins(p.sell * unit)) : "..."}</span>
              {p?.sellFrom === "npc" && <span className="text-[10.5px] text-slate-500"> npc</span>}
              <span className="text-slate-600"> / </span>
              <span className={r.overridden ? "text-sky-200" : "text-slate-400"}>{p ? (p.buy === null ? "-" : formatCoins(p.buy * unit)) : "..."}</span>
              {compacted && <span className="block text-[10.5px] leading-tight text-slate-500">per {compacted.name}</span>}
            </button>
          </Cell>
          <Cell className="gap-0.5">
            {r.reserve === null ? (
              <span className="text-slate-600" title="Only mutation items are sold; this is kept">
                kept
              </span>
            ) : (
              <>
                <NumberInput
                  integer
                  min={0}
                  className={`h-[26px] w-14 rounded-md border bg-slate-950/50 px-2 text-right text-[12.5px] tabular-nums text-slate-100 transition-colors duration-150 focus:border-emerald-500/60 focus:outline-none ${
                    r.reserveSet ? "border-emerald-500/50" : "border-slate-700/60"
                  }`}
                  value={r.reserve}
                  onChange={(n) => onReserve(r.id, n)}
                  aria-label={`Reserve of ${nameOf(r.id)}`}
                  title={r.reserveSet ? `Your reserve (automatic: ${formatCount(autoReserve)})` : "Automatic reserve; type a number to override"}
                />
                {r.reserveSet && (
                  <IconButton className="h-6 w-6" onClick={() => onReserve(r.id, null)} title="Back to the automatic reserve" aria-label={`Automatic reserve for ${nameOf(r.id)}`}>
                    <RotateCcw />
                  </IconButton>
                )}
              </>
            )}
          </Cell>
        </>
      ) : (
        <>
          {/* Nothing used: net just repeats made, so it stays quiet; it stands out once placements eat into it. */}
          <Cell className={net < 0 ? "text-red-300" : !net ? "text-slate-600" : r.used ? "text-slate-200" : "text-slate-500"}>{net ? `${net > 0 ? "+" : "−"}${qty(Math.abs(net))}` : "—"}</Cell>
          <Cell className={p && p.sell > 0 ? "text-slate-300" : "text-slate-600"} title={p && p.sell > 0 ? `${formatUnitPrice(p.sell)} coins each` : "Not NPC-sellable"}>
            {p && p.sell > 0 ? formatUnitPrice(p.sell) : "—"}
          </Cell>
        </>
      )}
      <Cell className={r.made && p && p.sell > 0 ? "text-yellow-400" : "text-slate-600"}>{r.made && p && p.sell > 0 ? coins(r.made * p.sell) : "—"}</Cell>
      <Cell last>
        {onRemove && (
          <button
            className="cursor-pointer text-slate-500 transition-colors duration-150 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onClick={onRemove}
            title={`Remove all ${nameOf(r.id)} from the inventory`}
            aria-label={`Remove all ${nameOf(r.id)}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </Cell>
    </>
  );
};

/** A table cell of the inventory grid: right-aligned figures, and the row's top line (a continuous rule, since the grid has no column gap). */
const Cell: React.FC<{ children?: React.ReactNode; className?: string; title?: string; first?: boolean; last?: boolean }> = ({ children, className = "", title, first, last }) => (
  <span
    title={title}
    className={`flex h-full min-w-0 items-center border-t border-slate-700/50 py-1 tabular-nums ${first ? "pr-3" : last ? "justify-center" : "justify-end px-3"} ${className}`}
  >
    {children}
  </span>
);
/** Pick an item and a quantity; add it to (or take it from) the inventory. */
const AddItemsRow: React.FC<{ onAdd: (items: Record<string, number>) => void; disabled: boolean; held?: Record<string, number> }> = ({ onAdd, disabled, held }) => {
  const ids = useMemo(() => allItemIds(), []);
  const [item, setItem] = useState(ids.includes("chloronite") ? "chloronite" : ids[0]);
  const [qty, setQty] = useState(10);
  const qtyRef = useRef<HTMLSpanElement>(null);
  const n = Math.max(0, Math.floor(qty || 0));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ItemPicker
        className="flex-1 min-w-56"
        value={item}
        ids={ids}
        onChange={setItem}
        held={held}
        disabled={disabled}
        onPicked={() => {
          const input = qtyRef.current?.querySelector("input");
          input?.focus();
          input?.select();
        }}
      />
      <span ref={qtyRef} className="contents">
        <NumberInput
          integer
          min={1}
          className="h-8 w-20 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2.5 text-right text-[13px] font-medium tabular-nums text-slate-100 transition-colors duration-150 focus:border-emerald-500/60 focus:outline-none"
          value={qty}
          onChange={setQty}
          aria-label="Quantity"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !disabled && n > 0) onAdd({ [item]: n });
          }}
        />
      </span>
      <KitButton size="md" disabled={disabled || n <= 0} onClick={() => onAdd({ [item]: n })} title="Add to the inventory">
        <Plus /> Add
      </KitButton>
      <KitButton size="md" variant="ghost" disabled={disabled || n <= 0} onClick={() => onAdd({ [item]: -n })} title="Remove from the inventory (never below 0)">
        <Minus /> Remove
      </KitButton>
    </div>
  );
};

