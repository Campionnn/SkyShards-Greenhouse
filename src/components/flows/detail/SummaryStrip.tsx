import React from "react";
import { SlidersHorizontal, UserRound } from "lucide-react";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import type { CellKind } from "../../../leaderboard/rules";
import { TIER_LABEL } from "../../../leaderboard/view";
import { ARMOR_SET_LABEL } from "../../../simulator";
import { formatCoins } from "../../simulator/format";
import { cn } from "../../ui/cn";
import { InfoHint } from "../../ui/InfoHint";
import { KitButton, Pill } from "../../ui/kit";
import { surface } from "../../ui/surface";
import { BoardNumbers } from "../FlowDetailSections";
import { EffortMeter } from "../FlowVisuals";
import { FrequencyPicker } from "../stats/FrequencyPicker";
import { isDefaultStats, statsSummary } from "../stats/statsSummary";
import type { DetailModel } from "./detailModel";
import { deltaText, forgivingText, needSummary, numberSub, upkeepSummary } from "./detailText";

/**
 * The verdict strip (direction A): whose stats the numbers are for (with Edit and Import right
 * there), the three board numbers, five facts, and the login frequency as an inline control.
 */

const FORGIVING_HINT =
  "How much of your profit you keep when you come back later than planned: your frequency up to twice it, the slightly-late logins counting most. 100% means being late costs nothing; 100%+ means logging in a little later even earns more. n/a at 12 cycles (nothing slower was simulated) or with no profit.";

/** One fact: a meta label, a tabular value, a meta sub-line that may wrap to two lines. */
const Fact: React.FC<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: "warn"; title?: string }> = ({ label, value, sub, tone, title }) => (
  <div className="min-w-0" title={title}>
    <div className="flex items-center gap-1 truncate text-meta text-fg-meta">{label}</div>
    <div className={cn("truncate text-title tabular-nums", tone === "warn" ? "text-warn" : "text-fg")}>{value}</div>
    {sub && <div className="line-clamp-2 text-meta text-fg-meta">{sub}</div>}
  </div>
);

/** The stats row: "These numbers are for max stats · Use yours" while default, else the stats in use. */
const StatsRow: React.FC<{ viewer: FlowViewer; phone: boolean; onEdit: () => void; onImport: () => void }> = ({ viewer, phone, onEdit, onImport }) => {
  const mine = !isDefaultStats(viewer);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line", phone ? "px-2 pb-2.5" : "px-4 py-2.5")} data-testid="stats-row">
      {mine ? (
        <p className="min-w-0 text-body text-fg-body">
          <span className="font-semibold text-fg">Your stats</span>{" "}
          <button type="button" onClick={onEdit} className="focus-ring cursor-pointer rounded-inner text-left underline decoration-fg-meta underline-offset-[3px] transition-colors duration-(--duration-hover) hover:text-fg">
            {statsSummary(viewer)} · {ARMOR_SET_LABEL[viewer.stats.armorSet]}
          </button>
        </p>
      ) : (
        <p className="min-w-0 text-body text-fg-body">
          These numbers are for <b className="font-semibold text-fg">max stats</b>.{" "}
          <span className="text-fg-muted">See them with yours:</span>
        </p>
      )}
      <span className={cn("flex shrink-0 gap-2", phone ? "w-full" : "ml-auto")}>
        <KitButton size="md" className={phone ? "flex-1" : undefined} onClick={onEdit} aria-haspopup="dialog">
          <SlidersHorizontal /> {mine ? "Edit" : "Set your stats"}
        </KitButton>
        <KitButton size="md" variant={mine ? "neutral" : "accent"} className={phone ? "flex-1" : undefined} onClick={onImport} aria-haspopup="dialog">
          <UserRound /> Import from Hypixel
        </KitButton>
      </span>
    </div>
  );
};

export const SummaryStrip: React.FC<{
  viewer: FlowViewer;
  m: DetailModel;
  phone: boolean;
  onKind: (k: CellKind) => void;
  onEditStats: () => void;
  onImport: () => void;
}> = ({ viewer, m, phone, onKind, onEditStats, onImport }) => {
  const mine = !isDefaultStats(viewer);
  const deltas = mine
    ? Object.fromEntries(m.numbers.map((n) => [n.kind, deltaText(n.profitPerDay, m.maxNumbers.find((x) => x.kind === n.kind)?.profitPerDay ?? null)]))
    : undefined;
  const sel = m.numbers.find((n) => n.kind === m.kind);
  const selSub = sel ? numberSub(sel, m.numbers) : null;
  const effort = m.shown?.result.effort;
  const need = needSummary(m.needLines);
  const upkeep = upkeepSummary(m.upkeep);
  const days = m.rampDays;
  const then = m.steady !== null ? `then ${formatCoins(m.steady)}/day` : null;
  const ramp =
    days === undefined
      ? { value: "—", sub: "not recorded for this entry", warn: false }
      : days === null
        ? { value: "Never", sub: [then, "some cells stay empty"].filter(Boolean).join(" · "), warn: true }
        : { value: days <= 0 ? "From the start" : days < 1 ? "Under a day" : `~${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`, sub: then ?? "", warn: false };
  const rampTitle = days === undefined ? undefined : `Layout complete ${days === null ? "never (some cells stay empty)" : days <= 0 ? "from the start" : `after ~${Math.max(1, Math.round(days))} days`}${then ? ` · ${then}` : ""}`;

  return (
    <section className={cn(surface.card, phone ? "space-y-3 p-2" : "overflow-hidden")} aria-label="Summary" data-testid="summary-strip">
      <StatsRow viewer={viewer} phone={phone} onEdit={onEditStats} onImport={onImport} />
      <BoardNumbers numbers={m.numbers} current={m.kind} onSelect={onKind} tierLabel={TIER_LABEL[m.tierShown]} every={viewer.every} deltas={deltas} compact={phone} />
      {phone && selSub && <p className={cn("px-2 text-secondary", selSub.warn ? "text-warn" : "text-fg-muted")}>{selSub.text[0].toUpperCase() + selSub.text.slice(1)}</p>}
      <div className={cn("grid gap-x-4 gap-y-3 border-t border-line", phone ? "grid-cols-2 px-2 pt-3" : "grid-cols-5 px-4 py-3")}>
        {m.board === "normal" ? (
          <>
            <Fact label="To build" value={m.value ? formatCoins(m.value.buildCost) : "—"} sub="once, the starting layouts" />
            <Fact label="Supplies" value={m.value ? formatCoins(m.value.boughtPerDay) : "—"} sub="bought per day" />
          </>
        ) : (
          <>
            <Fact label="To start with" value={need.value} sub={need.sub} />
            <Fact label="Upkeep per day" value={upkeep.value} sub={upkeep.sub} tone={m.upkeep.length ? "warn" : undefined} />
          </>
        )}
        <Fact
          label="Effort per login"
          value={effort ? Math.round(effort.avg) : "—"}
          sub={effort ? <EffortMeter avg={effort.avg} peak={effort.peak} /> : undefined}
          title={effort ? `Effort per login: ${Math.round(effort.avg)} on average, ${Math.round(effort.peak)} at the heaviest` : undefined}
        />
        <Fact
          label={
            <>
              Forgiving
              <InfoHint title="Forgiving" width={300}>
                {FORGIVING_HINT}
              </InfoHint>
            </>
          }
          value={forgivingText(m.forgiving)}
          sub="when you log in late"
        />
        <Fact label="Layout complete" value={ramp.value} sub={ramp.sub} tone={ramp.warn ? "warn" : undefined} title={rampTitle} />
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line text-secondary text-fg-meta", phone ? "px-2 pt-2.5" : "px-4 py-2")}>
        <FrequencyPicker viewer={viewer} />
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          coins / day · {TIER_LABEL[m.tierShown]} tier
          {m.shown?.scaled && (
            <InfoHint title="Estimated" trigger={<span className="underline decoration-dotted underline-offset-[3px]">est.</span>} label="Why estimated">
              Crop and rare-crop numbers are scaled from the wiki maxima to your yield stats.
            </InfoHint>
          )}
          {!m.exact && m.cell && <Pill tone="warn">max-tier stand-in</Pill>}
        </span>
      </div>
    </section>
  );
};
