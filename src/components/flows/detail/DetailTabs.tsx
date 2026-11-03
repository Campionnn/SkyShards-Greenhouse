import React from "react";
import type { FlowDetail } from "../../../leaderboard/api";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import { builderText, percent, prepText, ratioText, TIER_LABEL } from "../../../leaderboard/view";
import { cycleHours } from "../../../leaderboard/tiers";
import { EFFORT_WEIGHTS } from "../../../simulator";
import type { EffortKind } from "../../../simulator/sim/state";
import { formatCoins, formatRate, nameOf } from "../../simulator/format";
import { Fact } from "../../ui/Card";
import { cn } from "../../ui/cn";
import { InfoHint } from "../../ui/InfoHint";
import { KitLabel, Pill, TabPanel, Tabs } from "../../ui/kit";
import { EmptyCells, FlowWalkthrough, ItemBreakdown, SeedTable, SourceBreakdown, WhatYouNeed } from "../FlowDetailSections";
import { FlowMarkdown } from "../FlowMarkdown";
import { MutationChip, SplitBar, SplitLegend } from "../FlowVisuals";
import { EFFORT_LABEL } from "../flowsDisplay";
import { FrequencyChart } from "../FrequencyChart";
import { simHref } from "../ranking/rankingHelpers";
import type { DetailModel } from "./detailModel";
import { DETAIL_TABS, forgivingText, SEEDS_MAX_TIER, SEEDS_OTHER_TIERS, type DetailTab } from "./detailText";

/** The detail page's sections as sticky tabs (direction A); the tab is in the URL (`?tab=`). */

const H2: React.FC<{ children: React.ReactNode; hint?: React.ReactNode; meta?: React.ReactNode; small?: boolean }> = ({ children, hint, meta, small }) => (
  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
    <h2 className={small ? "text-body font-semibold text-fg" : "text-title text-fg"}>{children}</h2>
    {hint && (
      <InfoHint title={typeof children === "string" ? children : undefined} width={300}>
        {hint}
      </InfoHint>
    )}
    {meta && <span className="min-w-0 text-secondary tabular-nums text-fg-meta">{meta}</span>}
  </div>
);

const FORGIVING_HINT =
  "How much of your profit you keep when you come back later than planned. It compares the points in the shaded Forgiving range (your frequency up to twice it) with yours, counting the slightly-late ones the most. 100% means being late costs nothing; a low % means the flow falls apart if you miss a login. n/a at 12 cycles (nothing slower was simulated) or with no profit.";

/** Work per login by action (F83), weighted by the engine's effort weights. */
const EffortList: React.FC<{ m: DetailModel }> = ({ m }) => {
  const effort = m.shown?.result.effort;
  const rows = effort
    ? Object.entries(effort.byKind)
        .map(([k, n]) => ({ k, n: n ?? 0, weight: EFFORT_WEIGHTS[k as EffortKind] ?? 1 }))
        .map((r) => ({ ...r, w: r.n * r.weight }))
        .filter((r) => r.n > 0)
        .sort((a, b) => b.w - a.w)
    : [];
  if (!rows.length) return <p className="text-secondary text-fg-meta">{effort ? "No actions recorded." : "Not verified at this frequency yet."}</p>;
  const total = rows.reduce((s, r) => s + r.w, 0);
  return (
    <ul className="space-y-1.5" aria-label="Effort by action">
      {rows.map((r) => (
        <li
          key={r.k}
          className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-secondary"
          title={`${EFFORT_LABEL[r.k] ?? r.k}: ${r.weight} effort each, ${Math.round((r.w / total) * 100)}% of the work`}
        >
          <span className="truncate text-fg-body">{EFFORT_LABEL[r.k] ?? r.k}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <span className="block h-full origin-left rounded-full bg-fg-meta/60" style={{ transform: `scaleX(${total > 0 ? r.w / total : 0})` }} />
          </span>
          <span className="w-24 whitespace-nowrap text-right tabular-nums text-fg-muted">{formatRate(r.n)} / login</span>
        </li>
      ))}
    </ul>
  );
};

/** The builder line (F59): how the starting items are made from nothing, and why it stops. */
const BuilderLine: React.FC<{ m: DetailModel }> = ({ m }) =>
  m.prep ? (
    <div className="space-y-1" data-testid="builder-line">
      <p className={cn("text-secondary", Object.keys(m.prep.kit).length === 0 ? "text-fg-body" : m.prep.done ? "text-fg-body" : "text-warn")} data-testid="starting-items">
        {prepText(m.prep)}
      </p>
      <p className={cn("text-secondary", m.prep.done ? "text-fg-muted" : "text-warn")}>{builderText(m.prep)}</p>
      {m.stopsNote && (
        <p className="text-secondary text-warn" data-testid="stops-note">
          {m.stopsNote}
        </p>
      )}
    </div>
  ) : null;

const NeedPanel: React.FC<{ m: DetailModel; phone: boolean }> = ({ m, phone }) => {
  if (!m.cell) return <p className="text-secondary text-fg-meta">Not verified at this frequency yet.</p>;
  if (m.board === "normal")
    return (
      <div className="space-y-1">
        <p className="text-body text-fg-body">
          Buys what it is short of: <b className="font-semibold tabular-nums text-fg">{m.value ? formatCoins(m.value.boughtPerDay) : "—"}</b> a day, plus{" "}
          <b className="font-semibold tabular-nums text-fg">{m.value ? formatCoins(m.value.buildCost) : "—"}</b> once to build the starting layouts.
        </p>
        <p className="text-secondary text-fg-muted">Nothing to bring: every placement is bought on the Bazaar.</p>
      </div>
    );
  const empty = m.starved.length > 0 && (
    <section className="space-y-1" aria-label="Empty layout cells">
      <KitLabel
        actions={
          <InfoHint title="Empty layout cells">Cells the layouts couldn't fill for lack of stock, on average over the run. 5 or more (the highlighted counts) hold a plot back.</InfoHint>
        }
      >
        Empty layout cells
      </KitLabel>
      <EmptyCells starved={m.cell.median.starved} stepName={m.stepName} limit={phone ? 4 : 6} />
    </section>
  );
  return (
    <div className={cn("grid items-start gap-8", !phone && empty ? "grid-cols-2" : "grid-cols-1")}>
      <WhatYouNeed result={m.cell.median}>
        <BuilderLine m={m} />
      </WhatYouNeed>
      {empty}
    </div>
  );
};

const EarnPanel: React.FC<{ m: DetailModel; phone: boolean }> = ({ m, phone }) => (
  <div className="space-y-5">
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
      <Fact label="Revenue / day" value={m.value ? formatCoins(m.value.revenuePerDay) : "—"} />
      {m.board === "normal" ? (
        <Fact label="Supplies / day" value={m.value ? formatCoins(m.value.boughtPerDay) : "—"} suffix={m.value && m.value.buildCost > 0 ? `· ${formatCoins(m.value.buildCost)} to build once` : undefined} />
      ) : (
        <Fact label="Supplies to farm" value={m.supplies === "none" ? "None" : m.supplies} />
      )}
      <Fact label="Mutations / day" value={formatRate(m.mutationsPerDay)} />
    </div>
    {m.split && (
      <div className="max-w-lg">
        <SplitBar split={m.split} fraction={1} className="h-2" />
        <SplitLegend split={m.split} className="mt-1.5" />
      </div>
    )}
    {m.earning.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-secondary text-fg-meta">Top earners</span>
        {m.earning.slice(0, 3).map((t) => (
          <MutationChip key={t.id} id={t.id} size="md" earning={t.coinsPerDay} />
        ))}
        {m.earning.length > 3 && <Pill>+{m.earning.length - 3} · {m.earning.slice(3).map((t) => nameOf(t.id)).join(", ")}</Pill>}
      </div>
    )}
    <div className={cn("grid items-start gap-8", phone ? "grid-cols-1" : "grid-cols-2")}>
      <section className="space-y-1" aria-label="What you earn">
        <H2 small hint="Each item the flow produces, per day, at your prices.">
          What you earn
        </H2>
        <ItemBreakdown lines={m.items} />
        {m.value && m.value.unpriced.length > 0 && <p className="text-meta text-warn">No price for some items; they count as 0.</p>}
      </section>
      <section className="space-y-1" aria-label="Where it comes from">
        <H2 small hint="Which plants' harvests the money comes from, with what each drops.">
          Where it comes from
        </H2>
        <SourceBreakdown lines={m.sources} />
      </section>
    </div>
  </div>
);

const ProofPanel: React.FC<{ m: DetailModel; viewer: FlowViewer; phone: boolean }> = ({ m, viewer, phone }) => {
  const r = m.shown?.result;
  const seeds = (m.cell ? viewerSeeds(m, viewer) : []) as Parameters<typeof SeedTable>[0]["seeds"];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Fact label="Target uptime" value={r ? percent(r.uptime) : "—"} suffix={r ? (r.sustainable ? "· sustainable" : "· has downtime") : undefined} />
        <Fact label="Seed spread" value={ratioText(m.spread)} suffix={`· ${m.seedCount || (m.tierShown === "max" ? SEEDS_MAX_TIER : SEEDS_OTHER_TIERS)} secret seeds`} title="Best seed / median seed. Lower is more consistent." />
      </div>
      <div className={cn("grid items-start gap-8", !phone && seeds.length ? "grid-cols-2" : "grid-cols-1")}>
        <section className="space-y-2" aria-label="Work per login">
          <H2 small hint="Weighted by how much work each action is." meta={r ? `avg ${Math.round(r.effort.avg)} · heaviest ${Math.round(r.effort.peak)}` : null}>
            Work per login
          </H2>
          <EffortList m={m} />
        </section>
        {seeds.length > 0 && (
          <section className="space-y-2" aria-label="Consistency across seeds">
            <H2 small>Consistency across seeds</H2>
            <SeedTable seeds={seeds} board={viewer.board} quotes={viewer.quotes} pricing={viewer.bazaar.pricing} />
          </section>
        )}
      </div>
    </div>
  );
};

/** The seed rows of the shown cell (its kind, tier and frequency). */
function viewerSeeds(m: DetailModel, viewer: FlowViewer) {
  return m.cell ? (m.cellSeeds ?? []).filter((s) => s.tier === m.tierShown && s.every === viewer.every) : [];
}

export const DetailTabs: React.FC<{
  detail: FlowDetail;
  viewer: FlowViewer;
  m: DetailModel;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
  phone: boolean;
}> = ({ detail, viewer, m, tab, onTab, phone }) => (
  <div>
    <div className={cn("sticky top-0 z-(--z-sticky) bg-surface-page", phone && "-mx-3 px-3")}>
      <Tabs value={tab} onChange={onTab} items={DETAIL_TABS.map((t) => ({ value: t.value, label: phone ? t.short : t.label }))} idPrefix="flow-detail" label="Sections" scroll={phone} />
    </div>
    <TabPanel idPrefix="flow-detail" value={tab} className="kit-fade-in pt-4" key={tab}>
      {tab === "need" && <NeedPanel m={m} phone={phone} />}
      {tab === "earn" && <EarnPanel m={m} phone={phone} />}
      {tab === "freq" && (
        <section className="space-y-2" aria-label="Profit by online frequency">
          <H2 hint={FORGIVING_HINT} meta={`${forgivingText(m.forgiving)} forgiving · ${TIER_LABEL[m.tierShown]} tier`}>
            Profit by online frequency
          </H2>
          <FrequencyChart points={m.points} selected={viewer.every} hoursPerCycle={cycleHours(viewer.stats)} onSelect={viewer.setEvery} height={phone ? 150 : 200} />
        </section>
      )}
      {tab === "flow" && (
        <div className="space-y-6">
          {detail.description?.trim() ? (
            <section className="space-y-1.5" aria-label="Description">
              <H2 small>Description</H2>
              <FlowMarkdown text={detail.description} />
            </section>
          ) : null}
          <section className="space-y-2" aria-label="The flow">
            <H2 small hint="Every plot, step by step, as the real layouts. Hover a cell to see what it is. Edit in simulator loads the flow and opens the chosen step's layout.">
              The flow
            </H2>
            <FlowWalkthrough detail={detail} stacked={phone} simAt={(plot, step) => simHref(detail.id, viewer.board, viewer.kit, { plot, step })} />
          </section>
        </div>
      )}
      {tab === "proof" && <ProofPanel m={m} viewer={viewer} phone={phone} />}
    </TabPanel>
  </div>
);
