import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Coins, Minus, Package, Plus, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import { uptimeRatio, type RunSummary, type SimulationState, type SpotReport, type SustainabilityReport, type UptimeCounts } from "../../simulator";
import { InfoHint, Panel, SectionLabel, SegmentedControl } from "../ui";
import { CropImage } from "../shared";
import { allItemIds, debtText, spotFailureText, formatCoins, formatCount, formatDuration, formatRate, itemCategory, nameOf, npcPriceFor, type ItemCategory } from "./format";
import { IdSelect, NumberInput, Stat } from "./controls";
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
  /** Current cycle length in seconds (one growth stage); it depends on the unique crops standing plus the Flora shard. */
  cycleSeconds?: number;
}> = ({ summary, previous, cycleSeconds }) => {
  const [showPlots, setShowPlots] = useState(false);
  const rows: { label: string; get: (s: RunSummary) => number; strong?: boolean; negative?: boolean; hint?: string }[] = [
    { label: "Crops", get: (s) => s.revenue.crops, hint: "Base-crop drops (incl. mutation bundles), valued at NPC price when harvested." },
    {
      label: "Rare crops",
      get: (s) => s.revenue.rareCrops ?? 0,
      hint: "Armor tiered-bonus drops (Cropie, Squash, Fermento, Helianthus) and mutations' own Ethereal Vine. Overbloom raises the chance for both. Harvest yield (Plant Yield upgrade, the Unique Crop Bonus, Harvest Boost/Loss) additionally scales only the Ethereal Vine count, not the armor drops. Wiki NPC prices (override in Advanced).",
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
        {cycleSeconds !== undefined && cycleSeconds > 0 && (
          <>
            <Stat
              label="Time per cycle"
              value={`${formatDuration(cycleSeconds)} ${Math.round(cycleSeconds % 60)}s`}
              title="One growth stage at the current stats and the Unique Crop Bonus (crops standing plus the Flora shard, capped at 10). It changes if that count changes."
            />
            <Stat label="Cycles per day" value={`~${(86400 / cycleSeconds).toFixed(1)}`} title="24 h / time per cycle, at the current cycle length." />
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

const pct = (x: number) => `${(x * 100).toFixed(x >= 0.999 || x === 0 ? 0 : 1)}%`;

const uptimeTone = (x: number) => (x >= 0.999 ? "text-emerald-300" : x >= 0.9 ? "text-amber-300" : "text-red-300");

/** Stacked bar: growing / ready (up) vs blocked / missing requirements (down). */
const UptimeBar: React.FC<{ u: UptimeCounts }> = ({ u }) => {
  const w = (n: number) => `${u.watched > 0 ? (n / u.watched) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 w-full rounded overflow-hidden bg-slate-700/60" title={`growing ${u.growing} · ready ${u.ready} · blocked ${u.blocked} · no requirements ${u.requirements}`}>
      <div className="bg-emerald-500/90" style={{ width: w(u.growing) }} />
      <div className="bg-emerald-300/60" style={{ width: w(u.ready) }} />
      <div className="bg-orange-400/80" style={{ width: w(u.blocked) }} />
      <div className="bg-red-500/90" style={{ width: w(u.requirements) }} />
    </div>
  );
};

// ---- Uptime tree: plot > flow step > mutation > cell ------------------

interface UptimeNode {
  key: string;
  label: React.ReactNode;
  counts: UptimeCounts;
  /** Earliest cycle any spot under this node lacked its requirements. */
  firstRequirementsCycle: number | null;
  children: UptimeNode[];
}

function sumCounts(spots: SpotReport[]): UptimeCounts {
  const u = { watched: 0, growing: 0, ready: 0, requirements: 0, blocked: 0 };
  for (const s of spots) {
    u.watched += s.watched;
    u.growing += s.growing;
    u.ready += s.ready;
    u.requirements += s.requirements;
    u.blocked += s.blocked;
  }
  return u;
}

function firstCycle(spots: SpotReport[]): number | null {
  let min: number | null = null;
  for (const s of spots) if (s.firstRequirementsCycle !== null && (min === null || s.firstRequirementsCycle < min)) min = s.firstRequirementsCycle;
  return min;
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return [...out.entries()];
}

const node = (key: string, label: React.ReactNode, spots: SpotReport[], children: UptimeNode[]): UptimeNode => ({
  key,
  label,
  counts: sumCounts(spots),
  firstRequirementsCycle: firstCycle(spots),
  children,
});

/** Lowest uptime first within a level, so problems surface at the top. */
const worstFirst = (a: UptimeNode, b: UptimeNode) => uptimeRatio(a.counts) - uptimeRatio(b.counts);

function buildUptimeTree(spots: SpotReport[]): UptimeNode[] {
  return groupBy(spots, (s) => String(s.plotId))
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([plotId, plotSpots]) => {
      const steps = groupBy(plotSpots, (s) => s.stepId)
        .sort((a, b) => (a[1][0].stepIndex < 0 ? 1e9 : a[1][0].stepIndex) - (b[1][0].stepIndex < 0 ? 1e9 : b[1][0].stepIndex))
        .map(([stepId, stepSpots]) => {
          const first = stepSpots[0];
          const mutations = groupBy(stepSpots, (s) => s.mutationId)
            .map(([mutationId, mSpots]) => {
              const cells = mSpots
                .sort((a, b) => a.row - b.row || a.col - b.col)
                .map((s) => node(`${s.row},${s.col}`, <span className="text-slate-400">cell ({s.row},{s.col})</span>, [s], []));
              return node(
                mutationId,
                <span className="flex items-center gap-1.5 min-w-0">
                  <CropImage cropId={mutationId} cropName={nameOf(mutationId)} size="xs" showFallback />
                  <span className="text-slate-300 break-words">{nameOf(mutationId)}</span>
                  <span className="text-slate-500">
                    {mSpots.length === 1 ? `(${mSpots[0].row},${mSpots[0].col})` : `×${mSpots.length}`}
                  </span>
                </span>,
                mSpots,
                mSpots.length > 1 ? cells.sort(worstFirst) : []
              );
            })
            .sort(worstFirst);
          const label = (
            <span className="text-slate-300 break-words">
              {first.stepIndex >= 0 && <span className="text-slate-500">Step {first.stepIndex + 1} · </span>}
              {first.stepLabel}
              {first.stepIndex < 0 && <span className="text-slate-500"> (removed)</span>}
            </span>
          );
          return node(stepId, label, stepSpots, mutations);
        });
      return node(
        plotId,
        <span className="text-slate-100 font-medium">
          Plot {plotId}
          <span className="text-slate-500 font-normal">
            {" "}
            · {plotSpots.length} target{plotSpots.length === 1 ? "" : "s"}
            {steps.length > 1 ? ` in ${steps.length} steps` : ""}
          </span>
        </span>,
        plotSpots,
        steps
      );
    });
}

const UptimeRow: React.FC<{ n: UptimeNode; depth: number; open: Set<string>; toggle: (id: string) => void; path: string }> = ({
  n,
  depth,
  open,
  toggle,
  path,
}) => {
  const id = `${path}/${n.key}`;
  const expandable = n.children.length > 0;
  const isOpen = open.has(id);
  const up = uptimeRatio(n.counts);
  return (
    <>
      <div
        className={`grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_3.5rem] gap-x-3 items-center py-1 rounded ${
          expandable ? "cursor-pointer hover:bg-slate-700/30" : ""
        } ${depth === 0 ? "border-t border-slate-700/50 first:border-t-0" : ""}`}
        onClick={expandable ? () => toggle(id) : undefined}
        role={expandable ? "button" : undefined}
        aria-expanded={expandable ? isOpen : undefined}
      >
        <div className="min-w-0" style={{ paddingLeft: depth * 16 }}>
          <div className="flex items-center gap-1 min-w-0">
            {expandable ? (
              isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
              )
            ) : (
              <span className="w-3.5 flex-shrink-0" />
            )}
            {n.label}
          </div>
          <div className="pl-[18px] mt-0.5">
            <UptimeBar u={n.counts} />
          </div>
        </div>
        <span className={`text-right tabular-nums ${uptimeTone(up)} ${depth === 0 ? "font-medium" : ""}`}>{pct(up)}</span>
        <span
          className={`text-right tabular-nums ${n.counts.requirements > 0 ? "text-red-300" : "text-slate-500"}`}
          title={n.firstRequirementsCycle !== null ? `First at cycle ${n.firstRequirementsCycle}` : undefined}
        >
          {formatCount(n.counts.requirements)}
        </span>
        <span className={`text-right tabular-nums ${n.counts.blocked > 0 ? "text-orange-300" : "text-slate-500"}`}>{formatCount(n.counts.blocked)}</span>
      </div>
      {isOpen && n.children.map((c) => <UptimeRow key={c.key} n={c} depth={depth + 1} open={open} toggle={toggle} path={id} />)}
    </>
  );
};

/** Checked-target uptime, grouped by plot; expand a plot for its flow steps, a step for its mutations, a mutation for its cells. */
export const UptimeTree: React.FC<{ spots: SpotReport[] }> = ({ spots }) => {
  const tree = useMemo(() => buildUptimeTree(spots), [spots]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = () => {
    const all = new Set<string>();
    const walk = (n: UptimeNode, path: string) => {
      const id = `${path}/${n.key}`;
      if (n.children.length) all.add(id);
      n.children.forEach((c) => walk(c, id));
    };
    tree.forEach((n) => walk(n, ""));
    setOpen(all);
  };

  return (
    <div className="text-xs">
      <div className="flex items-center justify-end gap-2 mb-1">
        <button className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer" onClick={expandAll}>
          Expand all
        </button>
        <button className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer disabled:opacity-40" disabled={open.size === 0} onClick={() => setOpen(new Set())}>
          Collapse all
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_3.5rem] gap-x-3 pb-1 text-slate-500">
        <span className="pl-[18px]">plot / step / mutation</span>
        <span className="text-right">uptime</span>
        <span className="text-right" title="Cycles a checked cell sat empty without its requirements">no req.</span>
        <span className="text-right" title="Cycles something else blocked a checked cell">blocked</span>
      </div>
      {tree.map((n) => (
        <UptimeRow key={n.key} n={n} depth={0} open={open} toggle={toggle} path="" />
      ))}
    </div>
  );
};

/**
 * The uptime test: do the target cells you marked (every target by default)
 * always stay able to grow their mutation? Debt is shown as a likely cause.
 */
export const SustainabilityPanel: React.FC<{ report: SustainabilityReport; summary: RunSummary }> = ({ report, summary }) => {
  const [showAll, setShowAll] = useState(false);
  const watched = report.items.filter((i) => i.consumed > 0 || i.shortfall > 0);
  const losses = [
    ...Object.entries(summary.decayed).map(([k, n]) => ({ k, n, what: "decayed" })),
    ...Object.entries(summary.destroyed).map(([k, n]) => ({ k, n, what: "destroyed" })),
    ...Object.entries(summary.diedOfThirst).map(([k, n]) => ({ k, n, what: "died of thirst" })),
  ].sort((a, b) => b.n - a.n);
  const t = report.totals;

  return (
    <Panel
      title="Sustainability"
      icon={report.sustainable ? <ShieldCheck /> : <ShieldAlert />}
      description="Uptime of the target cells you check (every target unless you pick some for a step in the flow editor). A checked cell is up while its mutation stands there or could spawn there now. It is down while something else blocks it, or while it sits empty without the requirements to grow its mutation - that last one means the flow is not sustainable."
      actions={
        <InfoHint title="How uptime is counted" width={300}>
          Every cycle, at the spawn roll, each checked target cell is one of: growing (its mutation is there), ready (empty and its requirements hold),
          blocked (a rival, Dead Plant or root is in the way) or missing requirements (empty, and the neighbours or ground it needs are not there - for
          example because a placed item decayed and there was no stock to re-place it). Uptime = (growing + ready) / checked cycles.
        </InfoHint>
      }
    >
      {t.watched === 0 ? (
        <div className="rounded-md bg-slate-700/30 border border-slate-600/40 px-3 py-2 text-xs text-slate-300">
          No target cells checked yet. Add targets to a step's layout, or pick which to check in the flow editor.
        </div>
      ) : report.sustainable ? (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-200 space-y-1.5">
          <div>
            Sustainable: checked targets never lacked their requirements in {formatCount(summary.cyclesRun)} cycles.
            <span className={`ml-1 font-medium ${uptimeTone(report.uptime)}`}>{pct(report.uptime)} uptime</span>
            {t.blocked > 0 && <span className="text-emerald-300/70"> ({formatCount(t.blocked)} blocked cell-cycles)</span>}
          </div>
          <UptimeBar u={t} />
        </div>
      ) : (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-200 space-y-1.5">
          <div className="font-medium">
            Not sustainable · <span className={uptimeTone(report.uptime)}>{pct(report.uptime)} uptime</span>
          </div>
          {report.firstFailure && <div>{spotFailureText(report.firstFailure)}.</div>}
          <div className="text-red-300/80">
            {formatCount(t.requirements)} of {formatCount(t.watched)} checked cell-cycles without requirements
            {t.blocked > 0 && ` · ${formatCount(t.blocked)} blocked`}
          </div>
          <UptimeBar u={t} />
        </div>
      )}

      {report.spots.length > 0 && (
        <div className="mt-3">
          <SectionLabel>Uptime by plot</SectionLabel>
          <UptimeTree spots={report.spots} />
        </div>
      )}

      {report.debtCount > 0 && (
        <div className="mt-3 text-xs text-slate-300">
          <SectionLabel>Stock shortfalls</SectionLabel>
          <p className="text-slate-400">
            {report.firstDebt && <>{debtText(report.firstDebt)}. </>}
            {report.debtCount} shortfall{report.debtCount === 1 ? "" : "s"} · {report.unfilledCellCycles} failed placement attempts. Missing items often
            take away a checked target's requirements.
          </p>
        </div>
      )}

      {report.debts.length > 1 && (
        <div className="mt-2">
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

/** Apply a delta (negative = remove) to an item map, never below 0; zero entries are dropped. */
function applyDelta(base: Record<string, number>, delta: Record<string, number>): Record<string, number> {
  const out = { ...base };
  for (const [id, d] of Object.entries(delta)) {
    const next = Math.max(0, Math.floor((out[id] ?? 0) + d));
    if (next > 0) out[id] = next;
    else delete out[id];
  }
  return out;
}

/**
 * The shared inventory, grouped, with NPC values. There is one inventory and
 * one way to change it: before the first cycle, a change IS the starting
 * inventory (saved with the scenario); once the run has started, it changes
 * the live run, and can be kept as part of the start.
 */
export const InventoryPanel: React.FC<{
  state: SimulationState;
  /** Change the live run's inventory (negative = remove). Omit for a read-only panel. */
  onAddItems?: (items: Record<string, number>) => void;
  /** A run is in progress: changes are blocked until it stops. */
  busy?: boolean;
  startingInventory?: Record<string, number>;
  onStartingInventoryChange?: (v: Record<string, number>) => void;
}> = ({ state, onAddItems, busy = false, startingInventory, onStartingInventoryChange }) => {
  const settings = state.scenario.settings;
  const price = useMemo(() => npcPriceFor(settings.config.rareDropValues), [settings.config.rareDropValues]);
  const [mode, setMode] = useState<"total" | "perDay">("total");
  const perDay = mode === "perDay";
  const days = state.elapsedSeconds / 86400;
  const injected = Object.entries(state.summary.injected).filter(([, n]) => n !== 0);
  const canEditStart = !!startingInventory && !!onStartingInventoryChange;
  // Nothing has happened yet: the inventory is the starting inventory, so edit that.
  const atStart = canEditStart && state.cycle === 0 && injected.length === 0;
  // Show the edited starting inventory straight away (the restart is debounced).
  const held = atStart ? startingInventory : state.inventory;
  const canChange = atStart || !!onAddItems;

  const change = (items: Record<string, number>) => {
    if (atStart) onStartingInventoryChange!(applyDelta(startingInventory!, items));
    else onAddItems?.(items);
  };
  const keepInjected = () => {
    if (!canEditStart) return;
    onStartingInventoryChange!(applyDelta(startingInventory!, Object.fromEntries(injected)));
  };

  const grouped = useMemo(() => {
    const out: Record<ItemCategory, { id: string; qty: number; gross: number; net: number; unit: number; value: number }[]> = { mutation: [], crop: [], rareCrop: [], other: [] };
    // Total: what is held now. Per day: what the run has produced, per simulated day
    // (starting stock and items you added are not production). Mutations also get gross
    // (produced) and net (produced minus what the run spent placing them) figures, over
    // the whole run in Total mode and per simulated day in Per day mode.
    const div = perDay ? days : 1;
    const ids = perDay ? Object.keys(state.ledger) : [...new Set([...Object.keys(held), ...Object.keys(state.ledger)])];
    for (const id of ids) {
      const category = itemCategory(id);
      const row = state.ledger[id];
      const have = held[id] ?? 0;
      const gross = row && div > 0 ? row.produced / div : 0;
      const net = row && div > 0 ? (row.produced - row.consumed) / div : 0;
      const qty = perDay ? gross : have;
      // A mutation that is only ever spent (never produced) still shows, with a negative net.
      if (qty <= 0 && !(category === "mutation" && (gross > 0 || net !== 0))) continue;
      const unit = price(id);
      out[category].push({ id, qty, gross, net, unit, value: unit * qty });
    }
    for (const list of Object.values(out)) list.sort((a, b) => b.value - a.value || b.qty - a.qty || nameOf(a.id).localeCompare(nameOf(b.id)));
    return out;
  }, [held, state.ledger, perDay, days, price]);

  const total = Object.values(grouped).flat().reduce((a, r) => a + r.value, 0);
  const qtyText = (n: number) => (perDay ? formatRate(n) : formatCount(n));
  const suffix = perDay ? "/day" : "";

  return (
    <Panel
      title="Inventory"
      icon={<Package />}
      description={
        perDay
          ? `Produced per simulated day (${days > 0 ? `${days.toFixed(1)} days so far` : "run it first"}). NPC value made per day: ${formatCoins(total)}.`
          : `Shared by all plots. Unique crops: ${state.uniqueCropsStanding ?? 0} standing + Flora ${state.scenario.settings.playerStats.floraShard ?? 0} = ${state.uniqueCropCount}/${state.scenario.settings.config.uniqueCropCap}. NPC value of everything held: ${formatCoins(total)}.`
      }
      actions={
        <>
          <InfoHint title="Total vs per day" width={260}>
            Total: what the inventory holds right now: what you started with, plus what the run made, minus what it spent, plus any changes you made. Per day: what the run has produced
            (harvests, cleared Dead Plants), divided by the simulated days. That is gross. The Mutations section also shows gross and net (gross minus
            what the run spent placing that mutation, including re-placements), over the whole run in Total mode and per day in Per day mode.
          </InfoHint>
          <SegmentedControl
            size="xs"
            nowrap
            value={mode}
            onChange={setMode}
            options={[
              { value: "total", label: "Total" },
              { value: "perDay", label: "Per day" },
            ]}
          />
        </>
      }
    >
      {canChange && (
        <div className="space-y-1">
          <AddItemsRow onAdd={change} disabled={busy} />
          <p className="text-[11px] text-slate-500">
            {busy
              ? "Stop the run to change the inventory."
              : atStart
                ? "This is what you start with. It is saved with the scenario and used again on every Reset. Placing the starting layouts is free; this stock pays for mutation items, fire, fermento and dead plants placed later (re-placing after decay, or a later step)."
                : "The run has started: changes apply to it from now on (not revenue, not produced). Reset goes back to the starting inventory."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
        {SECTIONS.map((s) => {
          const rows = grouped[s.key];
          const count = rows.reduce((a, r) => a + r.qty, 0);
          const value = rows.reduce((a, r) => a + r.value, 0);
          const isMut = s.key === "mutation";
          // Mutations: held (Total only), gross and net. Everything else: count and NPC value.
          const showValue = !isMut;
          const showHeld = isMut && !perDay;
          // A remove-all button per row, while the inventory can be changed.
          const showRemove = !perDay && canChange;
          const cols = 4 + (showHeld ? 1 : 0) + (showRemove ? 1 : 0);
          const gridCols = ["", "", "", "", "grid-cols-[auto_1fr_auto_auto]", "grid-cols-[auto_1fr_auto_auto_auto]", "grid-cols-[auto_1fr_auto_auto_auto_auto]"][cols];
          const netCell = (n: number) => (
            <span className={`tabular-nums text-right ${n < 0 ? "text-red-300" : n > 0 ? "text-emerald-300" : "text-slate-500"}`}>
              {n < 0 ? "-" : n > 0 ? "+" : ""}
              {perDay ? formatRate(Math.abs(n)) : formatCount(Math.abs(n))}
            </span>
          );
          const grossTitle = perDay ? "Gross: produced per simulated day, before what the run spent placing it." : "Gross: produced over the whole run, before what the run spent placing it.";
          const netTitle = perDay
            ? "Net: produced minus spent on placements (including re-placements), per simulated day."
            : "Net: produced minus spent on placements (including re-placements), over the whole run.";
          return (
            <div key={s.key} className="bg-slate-900/30 border border-slate-700/40 rounded-md p-2 min-w-0">
              <div className="flex items-center gap-1 text-xs text-slate-200 font-medium">
                {s.title}
                <InfoHint title={s.title} width={260}>
                  {s.hint}
                </InfoHint>
                <span className="ml-auto text-[11px] font-normal text-slate-400 tabular-nums">
                  {qtyText(count)}
                  {suffix}
                  {showValue && (
                    <>
                      {" "}· <span className="text-amber-200">{formatCoins(value)}{suffix}</span>
                    </>
                  )}
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="text-[11px] text-slate-500 mt-1.5">{perDay ? "None produced yet." : "None yet."}</p>
              ) : (
                <div
                  className={`mt-1.5 grid ${gridCols} gap-x-2 gap-y-1 items-center text-xs max-h-72 overflow-y-auto scrollbar-dark [scrollbar-gutter:stable] pr-3`}
                >
                  <span />
                  <span className="text-[10px] text-slate-500">item</span>
                  {isMut ? (
                    <>
                      {showHeld && (
                        <span className="text-[10px] text-slate-500 text-right" title="How many you hold right now, ready to place.">
                          held
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 text-right" title={grossTitle}>
                        {perDay ? "gross/day" : "gross"}
                      </span>
                      <span className="text-[10px] text-slate-500 text-right" title={netTitle}>
                        {perDay ? "net/day" : "net"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-slate-500 text-right">{perDay ? "per day" : "count"}</span>
                  )}
                  {showValue && <span className="text-[10px] text-slate-500 text-right">{perDay ? "NPC value/day" : "NPC value"}</span>}
                  {showRemove && <span />}
                  {rows.map((r) => (
                    <React.Fragment key={r.id}>
                      <CropImage cropId={r.id} cropName={nameOf(r.id)} size="xs" showFallback />
                      <span className="text-slate-300 break-words min-w-0">{nameOf(r.id)}</span>
                      {isMut ? (
                        <>
                          {showHeld && <span className="text-slate-100 tabular-nums text-right">{formatCount(r.qty)}</span>}
                          <span className="text-emerald-300 tabular-nums text-right">{qtyText(r.gross)}</span>
                          {netCell(r.net)}
                        </>
                      ) : (
                        <span className="text-emerald-300 tabular-nums text-right">{qtyText(r.qty)}</span>
                      )}
                      {showValue && (
                        <span
                          className={`tabular-nums text-right ${r.unit > 0 ? "text-amber-200" : "text-slate-500"}`}
                          title={r.unit > 0 ? `${formatCount(r.unit)} coins each` : "Not NPC-sellable"}
                        >
                          {r.unit > 0 ? formatCoins(r.value) : "-"}
                        </span>
                      )}
                      {showRemove &&
                        (r.qty > 0 ? (
                          <button
                            className="text-slate-500 hover:text-red-300 disabled:opacity-40 disabled:hover:text-slate-500 cursor-pointer disabled:cursor-not-allowed"
                            disabled={busy}
                            onClick={() => change({ [r.id]: -r.qty })}
                            title={`Remove all ${nameOf(r.id)} from the inventory`}
                            aria-label={`Remove all ${nameOf(r.id)}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <span />
                        ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!atStart && (canEditStart || injected.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-700/60 mt-3 pt-2 text-[11px] text-slate-500">
          <span className="min-w-0">
            Started with:{" "}
            {startingInventory && Object.keys(startingInventory).length
              ? Object.entries(startingInventory)
                  .map(([id, n]) => `${formatCount(n)} ${nameOf(id)}`)
                  .join(", ")
              : "nothing"}
            .
            {injected.length > 0 && (
              <>
                {" "}Changed by you since: {injected.map(([id, n]) => `${n > 0 ? "+" : ""}${formatCount(n)} ${nameOf(id)}`).join(", ")}.
              </>
            )}
          </span>
          {canEditStart && injected.length > 0 && (
            <button
              className={`${buttonClass.neutral} ml-auto`}
              disabled={busy}
              onClick={keepInjected}
              title="Add your changes to the starting inventory. This restarts the run from cycle 0."
            >
              Keep for next time (restarts)
            </button>
          )}
        </div>
      )}
    </Panel>
  );
};

/** Pick an item and a quantity; add it to (or take it from) the inventory. */
const AddItemsRow: React.FC<{ onAdd: (items: Record<string, number>) => void; disabled: boolean }> = ({ onAdd, disabled }) => {
  const ids = useMemo(() => allItemIds(), []);
  const [item, setItem] = useState(ids.includes("chloronite") ? "chloronite" : ids[0]);
  const [qty, setQty] = useState(10);
  const n = Math.max(0, Math.floor(qty || 0));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <IdSelect className="flex-1 min-w-40" value={item} ids={ids} onChange={setItem} />
      <NumberInput
        integer
        min={1}
        className={`${inputClass} w-20 text-right`}
        value={qty}
        onChange={setQty}
        aria-label="Quantity"
      />
      <button className={buttonClass.primary} disabled={disabled || n <= 0} onClick={() => onAdd({ [item]: n })} title="Add to the inventory">
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
      <button className={buttonClass.neutral} disabled={disabled || n <= 0} onClick={() => onAdd({ [item]: -n })} title="Remove from the inventory (never below 0)">
        <Minus className="w-3.5 h-3.5" /> Remove
      </button>
    </div>
  );
};

