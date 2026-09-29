import React, { useMemo, useState } from "react";
import { Coins, Minus, Package, Plus, ShieldCheck, ShieldAlert } from "lucide-react";
import type { RunSummary, SimulationState, SustainabilityReport } from "../../simulator";
import { InfoHint, Panel, SectionLabel, SegmentedControl } from "../ui";
import { CropImage } from "../shared";
import { allItemIds, debtText, formatCoins, formatCount, formatDuration, formatRate, itemCategory, nameOf, npcPriceFor, type ItemCategory } from "./format";
import { IdSelect, Stat } from "./controls";
import { InventoryEditor } from "./ScenarioPanels";
import { buttonClass, inputClass } from "./styles";

// ---- Money ----------------------------------------------------------------

const perDay = (value: number, summary: RunSummary) => (summary.elapsedSeconds > 0 ? value / (summary.elapsedSeconds / 86400) : 0);

/**
 * The running ledger: this call's delta, the cumulative total, and the
 * per-day rate. Categorised, because a net number hides where money comes from.
 */
export const MoneyPanel: React.FC<{
  summary: RunSummary;
  previous: RunSummary | null;
  /** Current growth-stage (cycle) length in seconds; it depends on the unique crops standing. */
  stageSeconds?: number;
}> = ({ summary, previous, stageSeconds }) => {
  const [showPlots, setShowPlots] = useState(false);
  const rows: { label: string; get: (s: RunSummary) => number; strong?: boolean; negative?: boolean; hint?: string }[] = [
    { label: "Crops", get: (s) => s.revenue.crops, hint: "Base-crop drops (incl. mutation bundles), valued at NPC price when harvested." },
    {
      label: "Rare crops",
      get: (s) => s.revenue.rareCrops ?? 0,
      hint: "Armor tiered-bonus drops (Cropie, Squash, Fermento, Helianthus) and mutations' own Ethereal Vine. Overbloom raises the chance for both. Harvest yield (Plant Yield upgrade, unique crops, Harvest Boost/Loss) additionally scales only the Ethereal Vine count, not the armor drops. Wiki NPC prices (override in Advanced).",
    },
    { label: "Harvest Bounty", get: (s) => s.revenue.rareDrops, hint: "Bonus Drops rolls (not boosted by Overbloom). Wiki NPC prices; chips and Iridium are not NPC-sellable." },
    { label: "Mutation items", get: (s) => s.revenue.mutationItems, hint: "NPC-only: mutation items are Bazaar-only, so they count as 0 coins. They go to inventory as planting stock. The count itself scales with the greenhouse yield sum (Plant Yield upgrade + unique-crop bonus + Harvest Boost/Loss), not Farming Fortune or Evergreen." },
    { label: "Revenue", get: (s) => s.coinsRealised, strong: true },
    { label: "Replacements", get: (s) => -s.costs.replacements, negative: true, hint: "NPC value of items re-placed after decay. Mutation items count 0; fermento (250k) and dead plants (500) use their NPC price." },
    { label: "Supplies", get: (s) => -s.costs.supplies, negative: true, hint: "NPC value of items the layout needed but did not have (mutation items count 0; see Sustainability)." },
    { label: "Profit", get: (s) => s.profit, strong: true },
  ];
  const spawned = Object.values(summary.spawned).reduce((a, b) => a + b, 0);

  return (
    <Panel title="Money" icon={<Coins />} description="NPC prices. Delta = the last Step / Run.">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 text-xs">
        <span />
        <span className="text-slate-500 text-right">delta</span>
        <span className="text-slate-500 text-right">total</span>
        <span className="text-slate-500 text-right">/day</span>
        {rows.map((r) => {
          const total = r.get(summary);
          const delta = total - (previous ? r.get(previous) : 0);
          const cls = r.strong ? "text-slate-100 font-medium" : "text-slate-300";
          return (
            <React.Fragment key={r.label}>
              <span className={`${cls} flex items-center gap-1`}>
                {r.label}
                {r.hint && (
                  <InfoHint title={r.label} width={240}>
                    {r.hint}
                  </InfoHint>
                )}
              </span>
              <span className="text-right text-slate-400">{formatCoins(delta)}</span>
              <span className={`text-right ${cls}`}>{formatCoins(total)}</span>
              <span className={`text-right ${r.strong ? "text-emerald-300" : "text-slate-400"}`}>{formatCoins(perDay(total, summary))}</span>
            </React.Fragment>
          );
        })}
      </div>
      <div className="border-t border-slate-700/60 mt-3 pt-2">
        <Stat label="Cycles run" value={formatCount(summary.cyclesRun)} />
        <Stat label="Simulated time" value={formatDuration(summary.elapsedSeconds)} />
        {stageSeconds !== undefined && stageSeconds > 0 && (
          <>
            <Stat
              label="Time per cycle"
              value={`${formatDuration(stageSeconds)} ${Math.round(stageSeconds % 60)}s`}
              title="One growth stage at the current stats and unique crops standing. It changes if the unique-crop count changes."
            />
            <Stat label="Cycles per day" value={`~${(86400 / stageSeconds).toFixed(1)}`} title="24 h / time per cycle, at the current cycle length." />
          </>
        )}
        <Stat label="Mutations spawned" value={`${formatCount(spawned)} (${summary.mutationsPerDay.toFixed(1)}/day)`} />
        <Stat label="Rivals" value={`${summary.rivals.spawned} spawned, ${summary.rivals.cleared} cleared`} title="Other mutations that won the roll in a cell labelled for a target." />
        <Stat label="Re-placements" value={formatCount(summary.replacements)} />
      </div>
      <button className="mt-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer" onClick={() => setShowPlots((v) => !v)}>
        {showPlots ? "Hide" : "Show"} per-plot breakdown
      </button>
      {showPlots && (
        <div className="mt-1 text-xs text-slate-400 space-y-0.5">
          <p className="text-[11px] text-slate-500">Diagnostics for this run - they sum to the total, not a ranking.</p>
          {Object.entries(summary.perPlot).map(([id, p]) => (
            <div key={id} className="flex justify-between">
              <span>Plot {id}</span>
              <span>
                {formatCoins(p.revenue)} · {p.spawned} spawned · {p.harvested} harvested · {p.decayed} decayed
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

// ---- Sustainability -------------------------------------------------------

/** The debt test: would the layout ever need an item it does not have? */
export const SustainabilityPanel: React.FC<{ report: SustainabilityReport; summary: RunSummary }> = ({ report, summary }) => {
  const [showAll, setShowAll] = useState(false);
  const watched = report.items.filter((i) => i.consumed > 0 || i.shortfall > 0);
  const losses = [
    ...Object.entries(summary.decayed).map(([k, n]) => ({ k, n, what: "decayed" })),
    ...Object.entries(summary.destroyed).map(([k, n]) => ({ k, n, what: "destroyed" })),
    ...Object.entries(summary.diedOfThirst).map(([k, n]) => ({ k, n, what: "died of thirst" })),
  ].sort((a, b) => b.n - a.n);

  return (
    <Panel
      title="Sustainability"
      icon={report.sustainable ? <ShieldCheck /> : <ShieldAlert />}
      description="Would it ever need an item it doesn't have? The starting layout is placed free; after that, re-placing mutation items, fire, fermento and dead plants draws on the inventory. Base crops are always free."
    >
      {report.sustainable ? (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-200">
          Never went into debt in {formatCount(summary.cyclesRun)} cycles.
        </div>
      ) : (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-200 space-y-1">
          <div className="font-medium">Not sustainable</div>
          {report.firstDebt && <div>{debtText(report.firstDebt)}.</div>}
          <div className="text-red-300/80">
            {report.debtCount} shortfall{report.debtCount === 1 ? "" : "s"} · {report.unfilledCellCycles} failed placement attempts
          </div>
        </div>
      )}

      {report.debts.length > 1 && (
        <div className="mt-3">
          <SectionLabel>Shortfalls</SectionLabel>
          <ul className="text-xs text-slate-300 space-y-0.5 max-h-32 overflow-y-auto scrollbar-dark">
            {report.debts.slice(0, showAll ? undefined : 6).map((d, i) => (
              <li key={i}>
                cycle {d.cycle} · plot {d.plotId} · {nameOf(d.item)} at ({d.row},{d.col}) · had {d.available}
              </li>
            ))}
          </ul>
          {report.debts.length > 6 && (
            <button className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer mt-1" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Fewer" : `All ${report.debts.length}`}
            </button>
          )}
        </div>
      )}

      {watched.length > 0 && (
        <div className="mt-3">
          <SectionLabel>Placed items</SectionLabel>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs">
            <span className="text-slate-500">item</span>
            <span className="text-slate-500 text-right">used</span>
            <span className="text-slate-500 text-right">made</span>
            <span className="text-slate-500 text-right" title="Lowest stock seen">min</span>
            {watched.map((i) => (
              <React.Fragment key={i.item}>
                <span className={i.status === "bottleneck" ? "text-red-300" : "text-slate-300"} title={i.status}>
                  {nameOf(i.item)}
                  {i.permanent && <span className="text-slate-500"> (never decays)</span>}
                </span>
                <span className="text-right text-slate-400">{formatCount(i.consumed)}</span>
                <span className="text-right text-slate-400">{formatCount(i.produced)}</span>
                <span className={`text-right ${i.minStock === 0 ? "text-amber-300" : "text-slate-400"}`}>{formatCount(i.minStock)}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {losses.length > 0 && (
        <div className="mt-3">
          <SectionLabel>Losses</SectionLabel>
          <ul className="text-xs text-slate-300 space-y-0.5">
            {losses.slice(0, 8).map((l) => (
              <li key={`${l.what}-${l.k}`}>
                {formatCount(l.n)} {nameOf(l.k)} {l.what}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
};

// ---- Inventory ------------------------------------------------------------

const SECTIONS: { key: ItemCategory; title: string; hint: string }[] = [
  {
    key: "mutation",
    title: "Mutations",
    hint: "Mutation items: planting stock for re-placing. Bazaar-only, so they are worth 0 at NPC.",
  },
  { key: "crop", title: "Crops", hint: "Base-crop drops (including mutation bundles) and seeds, at NPC price." },
  {
    key: "rareCrop",
    title: "Rare crops",
    hint: "Armor tiered-bonus drops (Cropie, Squash, Fermento, Helianthus) and a harvested mutation's own Ethereal Vine. Their chances are multiplied by (1 + Overbloom/100).",
  },
  {
    key: "other",
    title: "Other drops",
    hint: "Harvest Bounty drops from plants holding Bonus Drops (not affected by Overbloom), cleared Dead Plants and anything else.",
  },
];

/**
 * The shared inventory, grouped, with NPC values. Items can be added to (or
 * removed from) the live run without restarting it; the starting stock (which
 * restarts the run) is edited here too.
 */
export const InventoryPanel: React.FC<{
  state: SimulationState;
  /** Change the live run's inventory (negative = remove). Omit for a read-only panel. */
  onAddItems?: (items: Record<string, number>) => void;
  /** A run is in progress: live changes are blocked until it stops. */
  busy?: boolean;
  startingInventory?: Record<string, number>;
  onStartingInventoryChange?: (v: Record<string, number>) => void;
}> = ({ state, onAddItems, busy = false, startingInventory, onStartingInventoryChange }) => {
  const settings = state.scenario.settings;
  const price = useMemo(() => npcPriceFor(settings.config.rareDropValues), [settings.config.rareDropValues]);
  const [showStart, setShowStart] = useState(false);
  const [mode, setMode] = useState<"total" | "perDay">("total");
  const perDay = mode === "perDay";
  const days = state.elapsedSeconds / 86400;

  const grouped = useMemo(() => {
    const out: Record<ItemCategory, { id: string; qty: number; unit: number; value: number }[]> = { mutation: [], crop: [], rareCrop: [], other: [] };
    // Total: what is held now. Per day: what the run has produced, per simulated day
    // (starting stock and items you added are not production).
    const source: [string, number][] = perDay
      ? days > 0
        ? Object.entries(state.ledger).map(([id, row]) => [id, row.produced / days])
        : []
      : Object.entries(state.inventory);
    for (const [id, qty] of source) {
      if (qty <= 0) continue;
      const unit = price(id);
      out[itemCategory(id)].push({ id, qty, unit, value: unit * qty });
    }
    for (const list of Object.values(out)) list.sort((a, b) => b.value - a.value || b.qty - a.qty || nameOf(a.id).localeCompare(nameOf(b.id)));
    return out;
  }, [state.inventory, state.ledger, perDay, days, price]);

  const total = Object.values(grouped).flat().reduce((a, r) => a + r.value, 0);
  const injected = Object.entries(state.summary.injected).filter(([, n]) => n !== 0);
  const qtyText = (n: number) => (perDay ? formatRate(n) : formatCount(n));
  const suffix = perDay ? "/day" : "";

  return (
    <Panel
      title="Inventory"
      icon={<Package />}
      description={
        perDay
          ? `Produced per simulated day (${days > 0 ? `${days.toFixed(1)} days so far` : "run it first"}). NPC value made per day: ${formatCoins(total)}.`
          : `Shared by all plots. Unique crops: ${state.uniqueCropCount}/12. NPC value of everything held: ${formatCoins(total)}.`
      }
      actions={
        <>
          <InfoHint title="Total vs per day" width={260}>
            Total: what the inventory holds right now, including the starting stock and anything you added. Per day: what the run has produced
            (harvests, cleared Dead Plants), divided by the simulated days. Spending on re-placements is not subtracted.
          </InfoHint>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: "total", label: "Total held" },
              { value: "perDay", label: "Per day" },
            ]}
          />
        </>
      }
    >
      {onAddItems && <AddItemsRow onAdd={onAddItems} disabled={busy} />}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
        {SECTIONS.map((s) => {
          const rows = grouped[s.key];
          const count = rows.reduce((a, r) => a + r.qty, 0);
          const value = rows.reduce((a, r) => a + r.value, 0);
          return (
            <div key={s.key} className="bg-slate-900/30 border border-slate-700/40 rounded-md p-2 min-w-0">
              <div className="flex items-center gap-1 text-xs text-slate-200 font-medium">
                {s.title}
                <InfoHint title={s.title} width={260}>
                  {s.hint}
                </InfoHint>
                <span className="ml-auto text-[11px] font-normal text-slate-400 tabular-nums">
                  {qtyText(count)}
                  {suffix} · <span className="text-amber-200">{formatCoins(value)}{suffix}</span>
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="text-[11px] text-slate-500 mt-1.5">{perDay ? "None produced yet." : "None yet."}</p>
              ) : (
                <div className="mt-1.5 grid grid-cols-[auto_1fr_auto_auto] gap-x-2 gap-y-1 items-center text-xs max-h-72 overflow-y-auto scrollbar-dark pr-1">
                  <span />
                  <span className="text-[10px] text-slate-500">item</span>
                  <span className="text-[10px] text-slate-500 text-right">{perDay ? "per day" : "count"}</span>
                  <span className="text-[10px] text-slate-500 text-right">{perDay ? "NPC value/day" : "NPC value"}</span>
                  {rows.map((r) => (
                    <React.Fragment key={r.id}>
                      <CropImage cropId={r.id} cropName={nameOf(r.id)} size="xs" showFallback />
                      <span className="text-slate-300 break-words min-w-0">{nameOf(r.id)}</span>
                      <span className="text-emerald-300 tabular-nums text-right">{qtyText(r.qty)}</span>
                      <span
                        className={`tabular-nums text-right ${r.unit > 0 ? "text-amber-200" : "text-slate-500"}`}
                        title={r.unit > 0 ? `${formatCount(r.unit)} coins each` : "Not NPC-sellable"}
                      >
                        {r.unit > 0 ? formatCoins(r.value) : "-"}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {injected.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">
          Added by you this run (not counted as revenue or as produced):{" "}
          {injected.map(([id, n]) => `${n > 0 ? "+" : ""}${formatCount(n)} ${nameOf(id)}`).join(", ")}. Reset restarts from the starting stock.
        </p>
      )}

      {startingInventory && onStartingInventoryChange && (
        <div className="border-t border-slate-700/60 mt-3 pt-2">
          <button className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer" onClick={() => setShowStart((v) => !v)}>
            {showStart ? "Hide" : "Edit"} starting stock ({Object.keys(startingInventory).length} item{Object.keys(startingInventory).length === 1 ? "" : "s"})
          </button>
          {showStart && (
            <div className="mt-2 max-w-md">
              <InventoryEditor value={startingInventory} onChange={onStartingInventoryChange} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};

/** Pick an item and a quantity; add it to (or take it from) the live run. */
const AddItemsRow: React.FC<{ onAdd: (items: Record<string, number>) => void; disabled: boolean }> = ({ onAdd, disabled }) => {
  const ids = useMemo(() => allItemIds(), []);
  const [item, setItem] = useState(ids.includes("chloronite") ? "chloronite" : ids[0]);
  const [qty, setQty] = useState(10);
  const n = Math.max(0, Math.floor(qty || 0));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <IdSelect className="flex-1 min-w-40" value={item} ids={ids} onChange={setItem} />
      <input
        type="number"
        min={1}
        className={`${inputClass} w-20 text-right`}
        value={qty}
        onChange={(e) => setQty(e.target.valueAsNumber)}
        aria-label="Quantity"
      />
      <button className={buttonClass.primary} disabled={disabled || n <= 0} onClick={() => onAdd({ [item]: n })} title="Add to the current run without restarting it">
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
      <button className={buttonClass.neutral} disabled={disabled || n <= 0} onClick={() => onAdd({ [item]: -n })} title="Remove from the current run (never below 0)">
        <Minus className="w-3.5 h-3.5" /> Remove
      </button>
      {disabled && <span className="text-[11px] text-slate-500">Stop the run to change the inventory.</span>}
    </div>
  );
};

