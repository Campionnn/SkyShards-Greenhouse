/**
 * One plot's column on the dashboard: what to do (the confirm button sits at the top of the card,
 * so it never moves when the sections below open, close or change), where the plot is now, where
 * it should go (as a real picture), what that costs and what to do while there.
 */
import React, { useState } from "react";
import { ArrowRight, Check, ChevronRight, ExternalLink, MapPin, Minus, Package, Plus, SkipForward, Undo2 } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import {
  GENERAL_TIPS,
  explain,
  farmOf,
  farmTips,
  itemName,
  type Catalog,
  type ConfirmExtras,
  type ItemCount,
  type PlotInput,
  type PlotOutcome,
  type ScriptKnobs,
  type Verb,
} from "../../guide";
import { FarmPicture } from "./FarmPicture";
import { ItemChip } from "./primitives";
import { buttonClass } from "./format";

const VERB_STYLE: Record<Verb, { badge: string; label: string }> = {
  switch: { badge: "border-blue-500/30 bg-blue-500/15 text-blue-300", label: "Switch" },
  stay: { badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300", label: "Keep" },
  rebuild: { badge: "border-amber-500/30 bg-amber-500/15 text-amber-300", label: "Rebuild" },
  clear: { badge: "border-slate-500/30 bg-slate-500/15 text-slate-300", label: "Clear" },
  wait: { badge: "border-slate-500/30 bg-slate-500/15 text-slate-400", label: "Wait" },
  supplies: { badge: "border-amber-500/30 bg-amber-500/15 text-amber-300", label: "Needs supplies" },
  done: { badge: "border-yellow-500/30 bg-yellow-500/15 text-yellow-300", label: "Done" },
};

function tally(kinds: string[]): ItemCount[] {
  const map = new Map<string, number>();
  for (const k of kinds) map.set(k, (map.get(k) ?? 0) + 1);
  return [...map].map(([item, count]) => ({ item, count })).sort((a, b) => b.count - a.count);
}

export interface PlotCardProps {
  plotId: number;
  plot: PlotInput;
  /** Null while this plot has already been done this visit. */
  outcome: PlotOutcome | null;
  catalog: Catalog;
  data: GameData;
  knobs: ScriptKnobs;
  /** This is the next plot to do, in login order. */
  next: boolean;
  /** Earlier plots in this visit that place items, for "after Plot 1 places…" notes. */
  earlier: { plotId: number; spent: ItemCount[] }[];
  /** Zombuds (and Dead Plants used) per harvest when the destination is a Zombud farm, else 0. */
  zombudPerHarvest: number;
  /** The plot was confirmed this visit and can be undone. */
  canUndo: boolean;
  onConfirm: (extras: ConfirmExtras) => void;
  onSkip: () => void;
  onUndo: () => void;
  onPickFarm: () => void;
  /** A Devourer farm: "a Devourer was harvested here (or a plant decayed) since it was built". */
  onDevourerRefresh: (on: boolean) => void;
  onOpenInventory: () => void;
}

/** "37 base crops", "31 base crops and 6 fire", "4 fire". */
function freeLabel(free: ItemCount[]): string {
  const fire = free.filter((f) => f.item === "fire").reduce((n, f) => n + f.count, 0);
  const crops = free.filter((f) => f.item !== "fire").reduce((n, f) => n + f.count, 0);
  return [crops ? `${crops} base crop${crops === 1 ? "" : "s"}` : "", fire ? `${fire} fire` : ""].filter(Boolean).join(" and ");
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</h4>
    {children}
  </div>
);

/** A collapsible section; the confirm button is above it, so opening it never moves the button. */
const Fold: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <details className="group">
    <summary className="flex min-h-8 cursor-pointer select-none list-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-200 [&::-webkit-details-marker]:hidden">
      <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      {title}
    </summary>
    <div className="mt-1.5">{children}</div>
  </details>
);

const CARD = "flex min-w-0 flex-col gap-4 rounded-lg border bg-slate-800/40 p-4";

const CardHeader: React.FC<{ plotId: number; next?: boolean; badge: React.ReactNode }> = ({ plotId, next, badge }) => (
  <header className="flex min-h-6 flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-medium text-slate-200">Plot {plotId}</h2>
      {next && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Next up</span>}
    </div>
    {badge}
  </header>
);

export const PlotCard: React.FC<PlotCardProps> = ({
  plotId,
  plot,
  outcome,
  catalog,
  data,
  knobs,
  next,
  earlier,
  zombudPerHarvest,
  canUndo,
  onConfirm,
  onSkip,
  onUndo,
  onPickFarm,
  onDevourerRefresh,
  onOpenInventory,
}) => {
  const name = (id: string) => itemName(data, id);
  const current = farmOf(catalog, plotId, plot.farm);
  const reportedZombuds = (plot.facts?.standing ?? []).filter((s) => s.kind === "zombud" && s.fullyGrown).length;
  const [zombuds, setZombuds] = useState(reportedZombuds);

  if (!outcome) {
    return (
      <article className={`${CARD} border-emerald-500/30`} aria-label={`Plot ${plotId}`}>
        <CardHeader
          plotId={plotId}
          badge={
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
              <Check className="h-3 w-3" /> Done this visit
            </span>
          }
        />
        {canUndo && (
          <button type="button" className={buttonClass.secondary} onClick={onUndo}>
            <Undo2 className="h-4 w-4" /> Undo, I didn't do this
          </button>
        )}
        <p className="text-xs text-slate-400">
          On <span className="font-medium text-slate-200">{current.name}</span>.
        </p>
        <FarmPicture layout={current.layout} nameOf={name} data={data} maxCell={26} facts={plot.facts} />
      </article>
    );
  }

  const target = farmOf(catalog, plotId, outcome.to);
  const ex = explain(outcome, catalog, data);
  const style = VERB_STYLE[ex.verb];
  const moving = outcome.from !== outcome.to && ex.verb !== "supplies";
  const free = tally(outcome.placedCells.filter((c) => !c.paid).map((c) => c.kind));
  const tips = target.kind === "farm" ? farmTips(target.products.map((p) => p.item), target.cost.map((c) => c.item), knobs) : [];
  const waiting = outcome.waitFor.filter((w) => w.target > 0);
  const showZombuds = zombudPerHarvest > 0 && !moving && ex.verb !== "done";
  const devourerFarm = !moving && current.products.some((p) => p.item === "devourer");
  // Items an earlier plot this visit places that this card's numbers already account for.
  const before = earlier.filter((e) => e.spent.length > 0);
  const harvestNow = [...outcome.harvested, ...outcome.harvestReady.filter((h) => !outcome.harvested.some((x) => x.item === h.item))];

  return (
    <article className={`${CARD} ${next ? "border-emerald-500/40" : "border-slate-600/30"}`} aria-label={`Plot ${plotId}`}>
      <CardHeader plotId={plotId} next={next} badge={<span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${style.badge}`}>{style.label}</span>} />

      {/* The action, first: the same place on every card, whatever opens, closes or changes below. */}
      <div className="flex flex-col gap-2">
        {ex.verb === "supplies" ? (
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <button type="button" className={`${buttonClass.primary} flex-1`} onClick={onOpenInventory}>
              <Package className="h-4 w-4" /> I have more now
            </button>
            <button type="button" className={`${buttonClass.secondary} flex-1`} onClick={onSkip}>
              <SkipForward className="h-4 w-4" /> Skip Plot {plotId} for now
            </button>
          </div>
        ) : ex.verb === "done" ? null : (
          <button type="button" className={buttonClass.primary} onClick={() => onConfirm(showZombuds ? { zombudHarvests: zombuds, zombudPerHarvest } : {})}>
            <Check className="h-4 w-4 shrink-0" />
            <span className="min-w-0">{ex.verb === "stay" || ex.verb === "wait" ? `Done with Plot ${plotId}` : `Did it: Plot ${plotId} is on ${target.name}`}</span>
          </button>
        )}
        <div>
          <p className="text-sm font-semibold text-slate-100">{ex.headline}</p>
          {ex.reason && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{ex.reason}</p>}
        </div>
      </div>

      {/* Where it is -> where it goes */}
      <div className="min-w-0 rounded-lg border border-slate-600/30 bg-slate-900/40 p-2">
        <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
            {moving && <ArrowRight className="h-3.5 w-3.5 shrink-0 self-center text-emerald-400" aria-hidden />}
            <span className="font-medium text-slate-100">{target.name}</span>
            {target.detail && <span className="text-xs text-slate-500">· {target.detail}</span>}
          </p>
          {target.code && target.kind === "farm" && (
            <a
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
              href={`/designer?layout=${encodeURIComponent(target.code)}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${target.name} in the Designer (new tab). It replaces the layout you have there.`}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Designer
            </a>
          )}
        </div>
        <FarmPicture layout={target.layout} nameOf={name} data={data} maxCell={34} highlight={outcome.placedCells.filter((c) => c.paid)} facts={moving ? undefined : plot.facts} />
        {target.products.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            Grows:
            {target.products.map((p) => (
              <ItemChip key={p.item} id={p.item} name={name(p.item)} compact tone="muted" />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onPickFarm}
          className="mt-1.5 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-200"
          title={`Not on ${current.name}? Pick the farm Plot ${plotId} is on`}
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {moving ? "Now on " : "On "}
            <span className="text-slate-300">{current.name}</span>
          </span>
          <span className="ml-auto shrink-0 text-slate-500 underline-offset-2 hover:underline">Not right?</span>
        </button>
      </div>

      {/* What to do */}
      <div className="flex flex-col gap-3">
        {moving && outcome.from !== "hub" && outcome.from !== "supplies" && (
          <Section title="First, clear the old farm">
            <p className="text-xs text-slate-300">Harvest anything fully grown on {current.name}, then break the rest. Plants already in the right spot for the new farm can stay.</p>
          </Section>
        )}
        {harvestNow.length > 0 && (
          <Section title="Harvest now">
            <div className="flex flex-wrap gap-1">
              {harvestNow.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone="gain" />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {outcome.selfFunded.length
                ? `Some of this goes straight back onto the plot. When you add your harvest under What you own, count only what's left after placing.`
                : `The counts are plants, not drops. Drops are random, so add what you actually got under What you own.`}
            </p>
          </Section>
        )}
        {outcome.spent.length > 0 && (
          <Section title={moving ? "Place from your inventory" : "Re-place from your inventory"}>
            <div className="flex flex-wrap gap-1">
              {outcome.spent.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone="cost" />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">These have a gold corner on the picture. Confirming takes them off your stock.</p>
          </Section>
        )}
        {outcome.short.length > 0 && (
          <Section title="Can't afford yet">
            <div className="flex flex-wrap gap-1">
              {outcome.short.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone="warn" />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Leave those cells empty for now. They stay marked missing, so the Guide asks again next visit.</p>
          </Section>
        )}
        {showZombuds && (
          <Section title="Zombuds harvested this visit">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-md border border-slate-600/40 bg-slate-900/60">
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center text-slate-300 transition-colors hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setZombuds(Math.max(0, zombuds - 1))}
                  disabled={zombuds === 0}
                  aria-label="One fewer Zombud harvested"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm tabular-nums text-slate-100" aria-live="polite">
                  {zombuds}
                </span>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center text-slate-300 transition-colors hover:bg-slate-700/60"
                  onClick={() => setZombuds(zombuds + 1)}
                  aria-label="One more Zombud harvested"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <span className="min-w-0 flex-1 text-xs text-slate-400">
                Each harvest gives {zombudPerHarvest} Zombuds and uses the {zombudPerHarvest} Dead Plants around it, which you then put back.
                {zombuds > 0 && ` Confirming adds ${zombuds * zombudPerHarvest} Zombuds and takes ${zombuds * zombudPerHarvest} Dead Plants.`}
              </span>
            </div>
          </Section>
        )}
        {devourerFarm && (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-600/30 bg-slate-900/40 p-2 text-xs text-slate-300">
            <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={!!plot.facts?.devourerRefresh} onChange={(e) => onDevourerRefresh(e.target.checked)} />
            <span>A Devourer was harvested here, or one of the farm's plants decayed, since it was built. The farm then has to be rebuilt.</span>
          </label>
        )}
        {ex.verb === "stay" && waiting.length > 0 && (
          <Section title="Working towards">
            <ul className="space-y-1">
              {waiting.slice(0, 6).map((w) => {
                const pct = Math.min(100, Math.round((100 * w.have) / Math.max(1, w.target)));
                return (
                  <li key={w.item} className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="w-28 shrink-0 truncate sm:w-32">{name(w.item)}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuenow={w.have} aria-valuemax={w.target} aria-label={name(w.item)}>
                      <span className="block h-full rounded-full bg-emerald-400/80" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-14 shrink-0 text-right tabular-nums text-slate-400">
                      {w.have}/{w.target}
                    </span>
                  </li>
                );
              })}
            </ul>
            {waiting.length > 6 && <p className="mt-1 text-[11px] text-slate-500">and {waiting.length - 6} more</p>}
            {before.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">
                Counts are after {before.map((e) => `Plot ${e.plotId}`).join(" and ")} {before.length === 1 ? "places its" : "place their"} items this visit.
              </p>
            )}
          </Section>
        )}
        {tips.length > 0 && (
          <Section title="While you're here">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Section>
        )}
        {free.length > 0 && (
          <Fold title={`Plant for free · ${freeLabel(free)}`}>
            <div className="flex flex-wrap gap-1">
              {free.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} compact />
              ))}
            </div>
          </Fold>
        )}
        {target.kind === "farm" && (
          <Fold title="Every visit">
            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-300">
              {GENERAL_TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Fold>
        )}
      </div>
    </article>
  );
};
