import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Coins, ShieldCheck, ShieldAlert } from "lucide-react";
import { uptimeRatio, type RunSummary, type SpotReport, type SustainabilityReport, type UptimeCounts } from "../../simulator";
import { InfoHint, Panel, SectionLabel } from "../ui";
import { CropImage } from "../shared";
import { debtText, spotFailureText, formatCoins, formatCount, formatDuration, nameOf } from "./format";
import { Leader, Stat } from "./controls";

// ---- Money ----------------------------------------------------------------

const perDay = (value: number, summary: RunSummary) => (summary.elapsedSeconds > 0 ? value / (summary.elapsedSeconds / 86400) : 0);

/** Ledger by category: this call's delta, cumulative total and per-day rate. */
export const MoneyPanel: React.FC<{
  summary: RunSummary;
  previous: RunSummary | null;
  /** Current cycle length in seconds (one growth stage); depends on standing unique crops plus the Flora shard. */
  cycleSeconds?: number;
}> = ({ summary, previous, cycleSeconds }) => {
  const [showPlots, setShowPlots] = useState(false);
  const rows: { label: string; get: (s: RunSummary) => number; strong?: boolean; negative?: boolean; hint?: string }[] = [
    { label: "Crops", get: (s) => s.revenue.crops, hint: "Base-crop drops (incl. mutation bundles), valued at NPC price when harvested." },
    {
      label: "Rare crops",
      get: (s) => s.revenue.rareCrops ?? 0,
      hint: "Armor tiered-bonus drops (Cropie, Squash, Fermento, Helianthus) and mutations' own Ethereal Vine. Overbloom raises the chance for both. Harvest yield does not scale either (the Advanced \"Legacy: yield scales mutation items\" setting brings back the old yield-scaled Ethereal Vine count). Wiki NPC prices (override in Advanced).",
    },
    { label: "Harvest Bounty", get: (s) => s.revenue.rareDrops, hint: "Bonus Drops rolls (not boosted by Overbloom). Wiki NPC prices; chips and Iridium are not NPC-sellable." },
    { label: "Mutation items", get: (s) => s.revenue.mutationItems, hint: "NPC-only: mutation items are Bazaar-only, so they count as 0 coins. They go to inventory as planting stock. The count is the mutation's base count (1, or Chloronite / Jellybean / All-in Aloe specifics): harvest yield, Farming Fortune and Evergreen don't scale it. The Advanced \"Legacy: yield scales mutation items\" setting brings back the old yield-scaled count." },
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
                <Leader className="-mr-3" />
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

/** Stacked bar: growing / ready (up) vs halted / blocked / missing requirements (down). */
const UptimeBar: React.FC<{ u: UptimeCounts }> = ({ u }) => {
  const w = (n: number) => `${u.watched > 0 ? (n / u.watched) * 100 : 0}%`;
  const halted = u.halted ?? 0;
  return (
    <div
      className="flex h-1.5 w-full rounded overflow-hidden bg-slate-700/60"
      title={`growing ${u.growing} · ready ${u.ready} · halted (dried out) ${halted} · blocked ${u.blocked} · no requirements ${u.requirements}`}
    >
      <div className="bg-emerald-500/90" style={{ width: w(u.growing) }} />
      <div className="bg-emerald-300/60" style={{ width: w(u.ready) }} />
      <div className="bg-amber-600/90" style={{ width: w(halted) }} />
      <div className="bg-orange-400/80" style={{ width: w(u.blocked) }} />
      <div className="bg-red-500/90" style={{ width: w(u.requirements) }} />
    </div>
  );
};

// ---- Uptime tree: plot > flow step > mutation > cell ------------------

/** Columns: label, uptime, no requirements, blocked, halted. */
const UPTIME_COLS = "grid-cols-[minmax(0,1fr)_3.5rem_3rem_3.5rem_3rem]";

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
        className={`grid ${UPTIME_COLS} gap-x-3 items-center py-1 rounded ${
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
        <span className={`text-right tabular-nums ${n.counts.halted > 0 ? "text-amber-500" : "text-slate-500"}`}>{formatCount(n.counts.halted)}</span>
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
      <div className={`grid ${UPTIME_COLS} gap-x-3 pb-1 text-slate-500`}>
        <span className="pl-[18px]">plot / step / mutation</span>
        <span className="text-right">uptime</span>
        <span className="text-right" title="Cycles a checked cell sat empty without its requirements">no req.</span>
        <span className="text-right" title="Cycles something else blocked a checked cell">blocked</span>
        <span className="text-right" title="Cycles a checked cell's mutation stood there dried out (halted until watered). Downtime, but not a sustainability failure.">
          halted
        </span>
      </div>
      {tree.map((n) => (
        <UptimeRow key={n.key} n={n} depth={0} open={open} toggle={toggle} path="" />
      ))}
    </div>
  );
};

/** Uptime of the checked target cells (every target by default), with debt shown as a likely cause. */
export const SustainabilityPanel: React.FC<{ report: SustainabilityReport; summary: RunSummary }> = ({ report, summary }) => {
  const [showAll, setShowAll] = useState(false);
  const watched = report.items.filter((i) => i.consumed > 0 || i.shortfall > 0);
  const losses = [
    ...Object.entries(summary.decayed).map(([k, n]) => ({ k, n, what: "decayed" })),
    ...Object.entries(summary.destroyed).map(([k, n]) => ({ k, n, what: "destroyed" })),
    // Not a loss: the timer ran out before the minimum was met, so it stood on (+24h each). Older saved summaries lack `extended`.
    ...Object.entries(summary.extended ?? {}).map(([k, n]) => ({ k, n, what: "decay timers extended (minimum not met)" })),
    // Not a loss: the plant stands until watered. Counted each time one dries out.
    ...Object.entries(summary.driedOut).map(([k, n]) => ({ k, n, what: "dried out (halted)" })),
  ].sort((a, b) => b.n - a.n);
  const t = report.totals;

  return (
    <Panel
      title="Sustainability"
      icon={report.sustainable ? <ShieldCheck /> : <ShieldAlert />}
      description="Uptime of the target cells you check (every target unless you pick some for a step in the flow editor). A checked cell is up while its mutation stands there or could spawn there now. It is down while its mutation stands there dried out, while something else blocks it, or while it sits empty without the requirements to grow its mutation - that last one means the flow is not sustainable."
      actions={
        <InfoHint title="How uptime is counted" width={300}>
          Every cycle, at the spawn roll, each checked target cell is one of: growing (its mutation is there), halted (its mutation is there but dried out,
          halted until watered), ready (empty and its requirements hold), blocked (a rival, Dead Plant or root is in the way) or missing requirements (empty,
          and the neighbours or ground it needs are not there - for example because a placed item decayed and there was no stock to re-place it, or a
          neighbour dried out and doesn't count until watered). Uptime = (growing + ready) / checked cycles. Only missing requirements makes the flow not
          sustainable; halted and blocked cycles only lower uptime.
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
            {(t.blocked > 0 || t.halted > 0) && (
              <span className="text-emerald-300/70">
                {" "}
                ({[t.blocked > 0 && `${formatCount(t.blocked)} blocked`, t.halted > 0 && `${formatCount(t.halted)} halted (dried out)`].filter(Boolean).join(", ")} cell-cycles)
              </span>
            )}
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
            {t.halted > 0 && ` · ${formatCount(t.halted)} halted (dried out)`}
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

      {report.borrowedCount > 0 && (
        <div className="mt-3 text-xs text-slate-300">
          <SectionLabel>Mutation debt</SectionLabel>
          <p className="text-slate-400">
            {formatCount(report.borrowedCount)} mutation item{report.borrowedCount === 1 ? "" : "s"} placed without stock (Allow mutation debt is on):{" "}
            {report.items
              .filter((i) => i.borrowed > 0)
              .map((i) => `${formatCount(i.borrowed)} ${nameOf(i.item)}${i.stock < 0 ? ` (still owed ${formatCount(-i.stock)})` : ""}`)
              .join(", ")}
            . A real player would need these items first.
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
        <details className="group mt-3">
          <summary className="flex items-center gap-1.5 rounded py-1 text-xs font-medium text-slate-400 uppercase tracking-wide cursor-pointer list-none hover:text-slate-200 focus-visible:outline-emerald-400 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="w-3.5 h-3.5 shrink-0 group-open:rotate-90" />
            Placed items
          </summary>
          <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-xs">
            <span className="text-slate-500">item</span>
            <span className="text-slate-500 text-right">used</span>
            <span className="text-slate-500 text-right">made</span>
            <span className="text-slate-500 text-right" title="Lowest stock seen">min</span>
            {watched.map((i) => (
              <React.Fragment key={i.item}>
                <span className={i.status === "bottleneck" ? "text-red-300" : i.status === "borrowed" ? "text-pink-300" : "text-slate-300"} title={i.status}>
                  {nameOf(i.item)}
                  {i.permanent && <span className="text-slate-500"> (never decays)</span>}
                </span>
                <span className="text-right text-slate-400">{formatCount(i.consumed)}</span>
                <span className="text-right text-slate-400">{formatCount(i.produced)}</span>
                <span className={`text-right ${i.minStock < 0 ? "text-red-300" : i.minStock === 0 ? "text-amber-300" : "text-slate-400"}`}>{formatCount(i.minStock)}</span>
              </React.Fragment>
            ))}
          </div>
        </details>
      )}

      {losses.length > 0 && (
        <details className="group mt-3">
          <summary className="flex items-center gap-1.5 rounded py-1 text-xs font-medium text-slate-400 uppercase tracking-wide cursor-pointer list-none hover:text-slate-200 focus-visible:outline-emerald-400 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="w-3.5 h-3.5 shrink-0 group-open:rotate-90" />
            Losses, halts and decay extensions
          </summary>
          <ul className="mt-2 text-xs text-slate-300 space-y-0.5">
            {losses.slice(0, 8).map((l) => (
              <li key={`${l.what}-${l.k}`}>
                {formatCount(l.n)} {nameOf(l.k)} {l.what}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
};
