import React, { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { uptimeRatio, type RunSummary, type SpotReport, type SustainabilityReport, type UptimeCounts } from "../../simulator";
import { InfoHint } from "../ui";
import { Segmented } from "../ui/kit";
import { CropImage } from "../shared";
import { debtText, spotFailureText, formatCoins, formatCount, formatDuration, nameOf } from "./format";
import { DisclosureCard, Fact, LinkButton, ResultCard } from "./page/ResultCard";

// ---- Money ----------------------------------------------------------------

/** Table head cell: the one place uppercase labels are allowed. */
const TH = "pb-1.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500";

/** "+12.4M", "−10k", "0" with the sign and colour the Money tables use. */
const signed = (n: number) => (n > 0 ? `+${formatCoins(n)}` : n < 0 ? `−${formatCoins(-n)}` : "0");
const moneyTone = (n: number, strong?: boolean) => (n < 0 ? "text-red-300" : n === 0 ? "text-slate-600" : strong ? "text-slate-50" : "text-slate-200");

export interface MoneyRow<T> {
  label: string;
  get: (v: T) => number;
  strong?: boolean;
  hint?: string;
}

/**
 * The Money table shared by the NPC and Bazaar cards: one row per category, the last Step / Run
 * and the total (or, with Per day, the rate). The profit row's total is the coin figure.
 */
export function MoneyTable<T>({ rows, now, before, mode, days }: { rows: MoneyRow<T>[]; now: T; before: T | null; mode: "total" | "perDay"; days: number }) {
  return (
    <table className="w-full border-collapse text-[12.5px] tabular-nums">
      <thead>
        <tr>
          <th className={`${TH} text-left`}>
            <span className="sr-only">Category</span>
          </th>
          <th className={TH} title="Change from the last Step / Run">
            Last run
          </th>
          <th className={`${TH} w-24`}>{mode === "perDay" ? "Per day" : "Total"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const total = r.get(now);
          const delta = total - (before ? r.get(before) : 0);
          const value = mode === "perDay" ? (days > 0 ? total / days : 0) : total;
          const profit = r.label === "Profit";
          return (
            <tr key={r.label} className={r.strong ? "font-semibold" : ""}>
              <td className={`border-t py-[7px] text-left ${r.strong ? "border-slate-600/50 text-slate-100" : "border-slate-700/50 text-slate-400"}`}>
                <span className="inline-flex items-center gap-1">
                  {r.label}
                  {r.hint && (
                    <InfoHint title={r.label} width={260}>
                      {r.hint}
                    </InfoHint>
                  )}
                </span>
              </td>
              <td className={`border-t py-[7px] text-right ${r.strong ? "border-slate-600/50" : "border-slate-700/50"} ${moneyTone(delta, r.strong)}`}>{signed(delta)}</td>
              <td
                className={`border-t py-[7px] text-right ${r.strong ? "border-slate-600/50" : "border-slate-700/50"} ${profit && value > 0 ? "text-yellow-400" : moneyTone(value, r.strong)}`}
              >
                {value < 0 ? `−${formatCoins(-value)}` : formatCoins(value)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const MONEY_MODES = [
  { value: "total" as const, label: "Total" },
  { value: "perDay" as const, label: "Per day", title: "Divide every figure by the simulated days" },
];

/** Ledger by category: the last Step / Run, and the total or the per-day rate. */
export const MoneyPanel: React.FC<{
  summary: RunSummary;
  previous: RunSummary | null;
  /** Current cycle length in seconds (one growth stage); depends on standing unique crops plus the Flora shard. */
  cycleSeconds?: number;
  className?: string;
}> = ({ summary, previous, cycleSeconds, className }) => {
  const [showPlots, setShowPlots] = useState(false);
  const [mode, setMode] = useState<"total" | "perDay">("total");
  const rows: MoneyRow<RunSummary>[] = [
    { label: "Crops", get: (s) => s.revenue.crops, hint: "Base-crop drops (incl. mutation bundles), valued at NPC price when harvested." },
    {
      label: "Rare crops",
      get: (s) => s.revenue.rareCrops ?? 0,
      hint: "Armor tiered-bonus drops (Cropie, Squash, Fermento, Helianthus) and mutations' own Ethereal Vine. Overbloom raises the chance for both. Harvest yield does not scale either (the Advanced \"Legacy: yield scales mutation items\" setting brings back the old yield-scaled Ethereal Vine count). Wiki NPC prices (override in Advanced).",
    },
    { label: "Harvest Bounty", get: (s) => s.revenue.rareDrops, hint: "Bonus Drops rolls (not boosted by Overbloom). Wiki NPC prices; chips and Iridium are not NPC-sellable." },
    {
      label: "Mutation items",
      get: (s) => s.revenue.mutationItems,
      hint: "NPC-only: mutation items are Bazaar-only, so they count as 0 coins. They go to inventory as planting stock. The count is the mutation's base count (1, or Chloronite / Jellybean / All-in Aloe specifics): harvest yield, Farming Fortune and Evergreen don't scale it. The Advanced \"Legacy: yield scales mutation items\" setting brings back the old yield-scaled count.",
    },
    { label: "Revenue", get: (s) => s.coinsRealised, strong: true },
    { label: "Replacements", get: (s) => -s.costs.replacements, hint: "NPC value of items re-placed after decay. Mutation items count 0; fermento (250k) and dead plants (500) use their NPC price." },
    { label: "Supplies", get: (s) => -s.costs.supplies, hint: "NPC value of items the layout needed but did not have (mutation items count 0; see Sustainability)." },
    { label: "Profit", get: (s) => s.profit, strong: true },
  ];
  const spawned = Object.values(summary.spawned).reduce((a, b) => a + b, 0);

  return (
    <ResultCard
      title="Money"
      className={className}
      hint="NPC prices. Last run is the change from the last Step / Run; Per day divides by the simulated days."
      actions={<Segmented label="Money figures" value={mode} onChange={setMode} options={MONEY_MODES} />}
    >
      <MoneyTable rows={rows} now={summary} before={previous} mode={mode} days={summary.elapsedSeconds / 86400} />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Fact label="Ran" value={formatCount(summary.cyclesRun)} suffix={`cycles · ${formatDuration(summary.elapsedSeconds)}`} />
        {cycleSeconds !== undefined && cycleSeconds > 0 && (
          <>
            <Fact
              label="Cycle"
              value={`${formatDuration(cycleSeconds)} ${Math.round(cycleSeconds % 60)}s`}
              title="Time per cycle: one growth stage at the current stats and the Unique Crop Bonus (crops standing plus the Flora shard, capped at 10). It changes if that count changes."
            />
            <Fact value={`~${(86400 / cycleSeconds).toFixed(1)}`} suffix="cycles/day" title="24 h / time per cycle, at the current cycle length." />
          </>
        )}
        <Fact value={formatCount(spawned)} suffix={`spawned (${summary.mutationsPerDay.toFixed(1)}/day)`} title="Mutations spawned" />
        <Fact label="Rivals" value={`${summary.rivals.spawned} / ${summary.rivals.cleared}`} suffix="spawned / cleared" title="Other mutations that won the roll in a cell labelled for a target." />
        <Fact value={formatCount(summary.replacements)} suffix="re-placements" />
        <LinkButton className="ml-auto" onClick={() => setShowPlots((v) => !v)} aria-expanded={showPlots}>
          {showPlots ? "Hide per plot" : "Per plot"}
        </LinkButton>
      </div>
      {showPlots && (
        <div className="mt-3 border-t border-slate-700/50 pt-2.5">
          <p className="mb-1.5 text-[11px] text-slate-500">Diagnostics for this run: they sum to the total, not a ranking.</p>
          <table className="w-full text-[12px] tabular-nums">
            <tbody>
              {Object.entries(summary.perPlot).map(([id, p]) => (
                <tr key={id}>
                  <td className="py-0.5 text-slate-400">Plot {id}</td>
                  <td className="py-0.5 text-right text-slate-200">{formatCoins(p.revenue)}</td>
                  <td className="py-0.5 text-right text-slate-500">{p.spawned} spawned</td>
                  <td className="py-0.5 text-right text-slate-500">{p.harvested} harvested</td>
                  <td className="py-0.5 text-right text-slate-500">{p.decayed} decayed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ResultCard>
  );
};

// ---- Sustainability -------------------------------------------------------

const pct = (x: number) => `${(x * 100).toFixed(x >= 0.999 || x === 0 ? 0 : 1)}%`;

/** Uptime figures: red once requirements were missing, amber for other downtime, plain when fully up. */
const uptimeTone = (u: UptimeCounts) => (u.requirements > 0 ? "text-red-300" : uptimeRatio(u) < 0.999 ? "text-amber-200" : "text-slate-100");

/** Stacked bar: up (growing, ready) in slate; downtime: halted and blocked in amber, missing requirements in red. */
const UptimeBar: React.FC<{ u: UptimeCounts; className?: string }> = ({ u, className = "" }) => {
  const w = (n: number) => `${u.watched > 0 ? (n / u.watched) * 100 : 0}%`;
  const halted = u.halted ?? 0;
  return (
    <span
      className={`flex h-[5px] overflow-hidden rounded-full bg-slate-700/40 ${className}`}
      title={`growing ${u.growing} · ready ${u.ready} · halted (dried out) ${halted} · blocked ${u.blocked} · no requirements ${u.requirements}`}
    >
      <span className="bg-slate-300/80" style={{ width: w(u.growing) }} />
      <span className="bg-slate-400/50" style={{ width: w(u.ready) }} />
      <span className="bg-amber-400/50" style={{ width: w(halted) }} />
      <span className="bg-amber-500/90" style={{ width: w(u.blocked) }} />
      <span className="bg-red-400" style={{ width: w(u.requirements) }} />
    </span>
  );
};

// ---- Uptime tree: plot > flow step > mutation > cell ------------------

/** Columns: label, uptime (bar + %), no requirements, blocked, halted. */
const UPTIME_COLS = "grid-cols-[minmax(0,1fr)_auto_3.75rem_3.75rem_3.25rem]";

interface UptimeNode {
  key: string;
  label: React.ReactNode;
  counts: UptimeCounts;
  /** Earliest cycle any spot under this node lacked its requirements. */
  firstRequirementsCycle: number | null;
  children: UptimeNode[];
}

function sumCounts(spots: SpotReport[]): UptimeCounts {
  const u = { watched: 0, growing: 0, ready: 0, requirements: 0, blocked: 0, halted: 0 };
  for (const s of spots) {
    u.watched += s.watched;
    u.growing += s.growing;
    u.ready += s.ready;
    u.requirements += s.requirements;
    u.blocked += s.blocked;
    u.halted += s.halted ?? 0;
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
                .map((s) => node(`${s.row},${s.col}`, <span className="text-slate-500">cell ({s.row},{s.col})</span>, [s], []));
              return node(
                mutationId,
                <span className="flex min-w-0 items-center gap-1.5">
                  <CropImage cropId={mutationId} cropName={nameOf(mutationId)} size="custom" width={16} height={16} showFallback className="shrink-0" />
                  <span className="break-words text-slate-300">{nameOf(mutationId)}</span>
                  <span className="text-slate-500">{mSpots.length === 1 ? `(${mSpots[0].row},${mSpots[0].col})` : `· ${mSpots.length} cells`}</span>
                </span>,
                mSpots,
                mSpots.length > 1 ? cells.sort(worstFirst) : []
              );
            })
            .sort(worstFirst);
          const label = (
            <span className="break-words text-slate-300">
              {first.stepIndex >= 0 && <span className="text-slate-500">Step {first.stepIndex + 1} · </span>}
              {first.stepLabel}
              {first.stepIndex < 0 && <span className="text-slate-500"> (removed)</span>}
            </span>
          );
          return node(stepId, label, stepSpots, mutations);
        });
      return node(
        plotId,
        <span className="font-medium text-slate-100">
          Plot {plotId}
          <span className="font-normal text-slate-500">
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

const zeroOr = (n: number, tone: string) => <span className={`text-right tabular-nums ${n > 0 ? tone : "text-slate-600"}`}>{formatCount(n)}</span>;

const UptimeRow: React.FC<{ n: UptimeNode; depth: number; open: Set<string>; toggle: (id: string) => void; path: string }> = ({ n, depth, open, toggle, path }) => {
  const id = `${path}/${n.key}`;
  const expandable = n.children.length > 0;
  const isOpen = open.has(id);
  const up = uptimeRatio(n.counts);
  return (
    <>
      <div
        className={`grid ${UPTIME_COLS} items-center gap-x-3 border-t border-slate-700/50 py-[7px] text-[12.5px] ${expandable ? "cursor-pointer transition-colors duration-150 hover:bg-slate-700/20" : ""}`}
        onClick={expandable ? () => toggle(id) : undefined}
        role={expandable ? "button" : undefined}
        aria-expanded={expandable ? isOpen : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(id);
                }
              }
            : undefined
        }
      >
        <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 18 }}>
          {expandable ? (
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {n.label}
        </div>
        <span className="flex items-center justify-end gap-2.5">
          <UptimeBar u={n.counts} className="hidden w-[120px] @lg:flex" />
          <span className={`w-12 text-right tabular-nums ${uptimeTone(n.counts)} ${depth === 0 ? "font-semibold" : ""}`}>{pct(up)}</span>
        </span>
        <span title={n.firstRequirementsCycle !== null ? `First at cycle ${n.firstRequirementsCycle}` : undefined} className="text-right">
          {zeroOr(n.counts.requirements, "text-red-300")}
        </span>
        {zeroOr(n.counts.blocked, "text-slate-200")}
        {zeroOr(n.counts.halted, "text-slate-200")}
      </div>
      {isOpen && n.children.map((c) => <UptimeRow key={c.key} n={c} depth={depth + 1} open={open} toggle={toggle} path={id} />)}
    </>
  );
};

function useUptimeTree(spots: SpotReport[]) {
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
  return { tree, open, toggle, expandAll, collapseAll: () => setOpen(new Set()) };
}

const TreeControls: React.FC<{ t: ReturnType<typeof useUptimeTree> }> = ({ t }) => (
  <span className="flex items-center gap-3">
    <LinkButton onClick={t.expandAll}>Expand all</LinkButton>
    <LinkButton disabled={t.open.size === 0} onClick={t.collapseAll}>
      Collapse all
    </LinkButton>
  </span>
);

const TreeTable: React.FC<{ t: ReturnType<typeof useUptimeTree> }> = ({ t }) => (
  <div className="@container overflow-x-auto scrollbar-dark" role="table" aria-label="Uptime by plot, step and mutation">
    <div className={`grid ${UPTIME_COLS} min-w-[26rem] gap-x-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500`} role="row">
      <span className="pl-[18px]">Plot / step / mutation</span>
      <span className="text-right">Uptime</span>
      <span className="text-right" title="Cycles a checked cell sat empty without its requirements">
        No req.
      </span>
      <span className="text-right" title="Cycles something else blocked a checked cell">
        Blocked
      </span>
      <span className="text-right" title="Cycles a checked cell's mutation stood there dried out (halted until watered). Downtime, but not a sustainability failure.">
        Halted
      </span>
    </div>
    <div className="min-w-[26rem]">
      {t.tree.map((n) => (
        <UptimeRow key={n.key} n={n} depth={0} open={t.open} toggle={t.toggle} path="" />
      ))}
    </div>
  </div>
);

/** Checked-target uptime, grouped by plot; expand a plot for its flow steps, a step for its mutations, a mutation for its cells. */
export const UptimeTree: React.FC<{ spots: SpotReport[] }> = ({ spots }) => {
  const t = useUptimeTree(spots);
  return (
    <div>
      <div className="mb-1.5 flex justify-end">
        <TreeControls t={t} />
      </div>
      <TreeTable t={t} />
    </div>
  );
};

const UPTIME_HINT = (
  <>
    <p>
      Uptime of the target cells you check (every target unless you pick some for a step in the flow editor). Every cycle, at the spawn roll, each checked
      target cell is one of: growing (its mutation is there), halted (its mutation is there but dried out, halted until watered), ready (empty and its
      requirements hold), blocked (a rival, Dead Plant or root is in the way) or missing requirements (empty, and the neighbours or ground it needs are not
      there, for example because a placed item decayed and there was no stock to re-place it, or a neighbour dried out and doesn't count until watered).
    </p>
    <p>Uptime = (growing + ready) / checked cycles. Only missing requirements makes the flow not sustainable; halted and blocked cycles only lower uptime.</p>
  </>
);

/** One line under the uptime card's title: sustainable or not, with the counts behind it. */
const UptimeStatus: React.FC<{ report: SustainabilityReport; summary: RunSummary }> = ({ report, summary }) => {
  const t = report.totals;
  const down = [t.blocked > 0 && `${formatCount(t.blocked)} blocked`, t.halted > 0 && `${formatCount(t.halted)} halted (dried out)`].filter(Boolean).join(" · ");
  if (t.watched === 0) {
    return <p className="text-[12.5px] text-slate-400">No target cells checked yet. Add targets to a step's layout, or pick which to check in the flow editor.</p>;
  }
  return (
    <div className="mb-3 space-y-2">
      {report.sustainable ? (
        <p className="text-[12.5px] text-slate-300">
          <span className="font-medium text-slate-100">Sustainable:</span> checked targets never lacked their requirements in {formatCount(summary.cyclesRun)} cycles.
          {down && <span className="text-slate-500"> {down} cell-cycles.</span>}
        </p>
      ) : (
        <div className="text-[12.5px]">
          <p className="font-medium text-red-200">Not sustainable{report.firstFailure ? `: ${spotFailureText(report.firstFailure)}.` : "."}</p>
          <p className="mt-0.5 text-slate-400">
            {formatCount(t.requirements)} of {formatCount(t.watched)} checked cell-cycles without requirements
            {down && ` · ${down}`}
          </p>
        </div>
      )}
      <UptimeBar u={t} />
    </div>
  );
};

const LOSS_LABEL = {
  decayed: "decayed",
  destroyed: "destroyed",
  extended: "decay timers extended (minimum not met)",
  driedOut: "dried out (halted)",
};

/**
 * Sustainability, as the page's tab body: the uptime of the checked targets (with the full tree)
 * on the left; stock shortfalls, mutation debt, placed items and losses on the right. Lays out
 * by its own width (container query), so it also fits a narrow column.
 */
export const SustainabilityPanel: React.FC<{ report: SustainabilityReport; summary: RunSummary; className?: string }> = ({ report, summary, className = "" }) => {
  const [showAll, setShowAll] = useState(false);
  const tree = useUptimeTree(report.spots);
  const watched = report.items.filter((i) => i.consumed > 0 || i.shortfall > 0);
  const losses = [
    ...Object.entries(summary.decayed).map(([k, n]) => ({ k, n, what: LOSS_LABEL.decayed })),
    ...Object.entries(summary.destroyed).map(([k, n]) => ({ k, n, what: LOSS_LABEL.destroyed })),
    // Not a loss: the timer ran out before the minimum was met, so it stood on (+24h each). Older saved summaries lack `extended`.
    ...Object.entries(summary.extended ?? {}).map(([k, n]) => ({ k, n, what: LOSS_LABEL.extended })),
    // Not a loss: the plant stands until watered. Counted each time one dries out.
    ...Object.entries(summary.driedOut).map(([k, n]) => ({ k, n, what: LOSS_LABEL.driedOut })),
  ].sort((a, b) => b.n - a.n);
  const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
  const t = report.totals;
  const side = report.debtCount > 0 || report.borrowedCount > 0 || watched.length > 0 || losses.length > 0;

  return (
    <div className={`@container ${className}`}>
      <div className={`grid grid-cols-1 items-start gap-5 ${side ? "@4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""}`}>
        <ResultCard
          title="Uptime of checked targets"
          hint={UPTIME_HINT}
          hintTitle="How uptime is counted"
          hintWidth={340}
          meta={t.watched > 0 ? <span className={uptimeTone(t)}>{pct(report.uptime)}</span> : undefined}
          actions={report.spots.length > 0 ? <TreeControls t={tree} /> : undefined}
        >
          <UptimeStatus report={report} summary={summary} />
          {report.spots.length > 0 && <TreeTable t={tree} />}
        </ResultCard>

        {side && (
          <div className="flex min-w-0 flex-col gap-5">
            {report.debtCount > 0 && (
              <ResultCard
                title="Stock shortfalls"
                meta={`${formatCount(report.debtCount)}${report.firstDebt ? ` · first at cycle ${report.firstDebt.cycle}` : ""}`}
                hint="A placement found the inventory short of an item. Missing items often take away a checked target's requirements."
              >
                <p className="text-[12.5px] text-slate-300">
                  {report.firstDebt && <>{debtText(report.firstDebt)}. </>}
                  <span className="text-slate-500">
                    {report.debtCount} shortfall{report.debtCount === 1 ? "" : "s"} · {formatCount(report.unfilledCellCycles)} failed placement attempts.
                  </span>
                </p>
                {report.debts.length > 1 && (
                  <>
                    <ul className="mt-2.5 max-h-40 space-y-1 overflow-y-auto overscroll-contain text-[12px] tabular-nums text-slate-500 scrollbar-dark">
                      {report.debts.slice(0, showAll ? undefined : 6).map((d, i) => (
                        <li key={i}>
                          cycle {d.cycle} · plot {d.plotId} · <span className="text-slate-300">{nameOf(d.item)}</span> at ({d.row},{d.col}) · had {d.available}
                        </li>
                      ))}
                    </ul>
                    {report.debts.length > 6 && (
                      <LinkButton className="mt-2" onClick={() => setShowAll((v) => !v)}>
                        {showAll ? "Fewer" : `All ${report.debts.length}`}
                      </LinkButton>
                    )}
                  </>
                )}
              </ResultCard>
            )}

            {report.borrowedCount > 0 && (
              <ResultCard title="Mutation debt" meta={`${formatCount(report.borrowedCount)} placed without stock`} hint="Allow mutation debt is on (Advanced). A real player would need these items first.">
                <p className="text-[12.5px] text-slate-300">
                  {report.items
                    .filter((i) => i.borrowed > 0)
                    .map((i) => `${formatCount(i.borrowed)} ${nameOf(i.item)}${i.stock < 0 ? ` (still owed ${formatCount(-i.stock)})` : ""}`)
                    .join(", ")}
                </p>
              </ResultCard>
            )}

            {watched.length > 0 && (
              <DisclosureCard title="Placed items" meta={`${watched.length} kind${watched.length === 1 ? "" : "s"}`}>
                <table className="w-full text-[12.5px] tabular-nums">
                  <thead>
                    <tr>
                      <th className={`${TH} text-left`}>Item</th>
                      <th className={TH}>Used</th>
                      <th className={TH}>Made</th>
                      <th className={TH} title="Lowest stock seen">
                        Min
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {watched.map((i) => (
                      <tr key={i.item}>
                        <td className={`border-t border-slate-700/50 py-1.5 ${i.status === "bottleneck" ? "text-red-300" : i.status === "borrowed" ? "text-pink-300" : "text-slate-300"}`} title={i.status}>
                          {nameOf(i.item)}
                          {i.permanent && <span className="text-slate-500"> (never decays)</span>}
                        </td>
                        <td className="border-t border-slate-700/50 py-1.5 text-right text-slate-200">{formatCount(i.consumed)}</td>
                        <td className="border-t border-slate-700/50 py-1.5 text-right text-slate-200">{formatCount(i.produced)}</td>
                        <td className={`border-t border-slate-700/50 py-1.5 text-right ${i.minStock < 0 ? "text-red-300" : i.minStock === 0 ? "text-amber-200" : "text-slate-200"}`}>
                          {formatCount(i.minStock)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DisclosureCard>
            )}

            {losses.length > 0 && (
              <DisclosureCard title="Losses, halts and decay extensions" meta={`${formatCount(sum(summary.decayed))} decayed · ${formatCount(sum(summary.driedOut))} halted`}>
                <ul className="space-y-1 text-[12.5px] text-slate-300">
                  {losses.slice(0, 8).map((l) => (
                    <li key={`${l.what}-${l.k}`}>
                      <span className="tabular-nums text-slate-100">{formatCount(l.n)}</span> {nameOf(l.k)} <span className="text-slate-500">{l.what}</span>
                    </li>
                  ))}
                </ul>
              </DisclosureCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
