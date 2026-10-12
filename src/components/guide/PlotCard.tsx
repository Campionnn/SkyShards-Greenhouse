/**
 * One plot's column on the dashboard: where it is now, where it should go (as a real picture),
 * what that costs, what to do while there, and a per-plot confirmation.
 */
import React from "react";
import { ArrowDown, ArrowRight, Check, Eye, ListChecks, MapPin, RotateCcw, ShoppingCart, Undo2 } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import {
  GENERAL_TIPS,
  explain,
  farmOf,
  farmTips,
  hasFacts,
  itemName,
  type Catalog,
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
  switch: { badge: "bg-violet-500/20 text-violet-200 ring-violet-400/40", label: "Switch" },
  stay: { badge: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/40", label: "Keep" },
  rebuild: { badge: "bg-amber-500/15 text-amber-200 ring-amber-400/40", label: "Rebuild" },
  clear: { badge: "bg-slate-500/20 text-slate-200 ring-slate-400/40", label: "Clear" },
  wait: { badge: "bg-slate-500/20 text-slate-300 ring-slate-400/30", label: "Wait" },
  supplies: { badge: "bg-red-500/15 text-red-200 ring-red-400/40", label: "Buy supplies" },
  done: { badge: "bg-yellow-500/15 text-yellow-200 ring-yellow-400/40", label: "Done" },
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
  /** The plot was confirmed this visit and can be undone. */
  canUndo: boolean;
  onConfirm: () => void;
  onUndo: () => void;
  onPickFarm: () => void;
  onEditFacts: () => void;
  onOpenInventory: () => void;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
    {children}
  </div>
);

export const PlotCard: React.FC<PlotCardProps> = ({ plotId, plot, outcome, catalog, data, knobs, next, canUndo, onConfirm, onUndo, onPickFarm, onEditFacts, onOpenInventory }) => {
  const name = (id: string) => itemName(data, id);
  const current = farmOf(catalog, plotId, plot.farm);

  if (!outcome) {
    return (
      <article className="flex flex-col gap-3 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-3 sm:p-4" aria-label={`Plot ${plotId}`}>
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-100">Plot {plotId}</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/40">
            <Check className="h-3.5 w-3.5" /> Done this visit
          </span>
        </header>
        <p className="text-sm text-slate-300">
          Now on <span className="font-medium text-slate-100">{current.name}</span>.
        </p>
        <FarmPicture layout={current.layout} nameOf={name} maxCell={26} facts={plot.facts} />
        {canUndo && (
          <button type="button" className={`${buttonClass.ghost} self-start`} onClick={onUndo}>
            <Undo2 className="h-3.5 w-3.5" /> Undo, I didn't do this
          </button>
        )}
      </article>
    );
  }

  const target = farmOf(catalog, plotId, outcome.to);
  const ex = explain(outcome, catalog, data);
  const style = VERB_STYLE[ex.verb];
  const moving = outcome.from !== outcome.to;
  const free = tally(outcome.placedCells.filter((c) => !c.paid).map((c) => c.kind));
  const tips = target.kind === "farm" ? farmTips(target.products.map((p) => p.item), target.cost.map((c) => c.item), knobs) : [];
  const waiting = outcome.waitFor.filter((w) => w.target > 0);
  const unknown = !hasFacts(plot.facts) && current.kind === "farm";

  return (
    <article
      className={`flex flex-col gap-4 rounded-xl border bg-slate-800/50 p-3 sm:p-4 ${next ? "border-violet-500/60 shadow-[0_0_0_1px_rgba(139,92,246,0.25)]" : "border-slate-700/70"}`}
      aria-label={`Plot ${plotId}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-slate-100">Plot {plotId}</h3>
          {next && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-medium text-violet-200">Next up</span>}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${style.badge}`}>{style.label}</span>
      </header>

      {/* Where it is -> where it goes */}
      <div className="flex flex-col gap-2">
        {moving && (
          <>
            <button
              type="button"
              onClick={onPickFarm}
              className="guide-press flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/50 p-1.5 text-left hover:border-slate-500"
              title="Not on this farm? Pick the right one"
            >
              <FarmPicture layout={current.layout} nameOf={name} cellSize={6} compass={false} className="!w-auto shrink-0" />
              <span className="min-w-0 text-xs">
                <span className="block text-slate-500">Now</span>
                <span className="block truncate font-medium text-slate-200">{current.name}</span>
              </span>
              <MapPin className="ml-auto h-4 w-4 shrink-0 text-slate-500" />
            </button>
            <ArrowDown className="mx-auto h-4 w-4 text-violet-300" aria-hidden />
          </>
        )}
        <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-sm">
            {moving ? <ArrowRight className="h-4 w-4 text-violet-300" aria-hidden /> : null}
            <span className="font-semibold text-slate-100">{target.name}</span>
            {target.label !== target.name && target.kind === "farm" && <span className="truncate text-xs text-slate-500">· {target.label.slice(target.name.length).replace(/^[\s:(]+|\)$/g, "")}</span>}
          </p>
          <FarmPicture layout={target.layout} nameOf={name} maxCell={34} highlight={outcome.placedCells.filter((c) => c.paid)} facts={moving ? undefined : plot.facts} />
          {target.products.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-400">
              Grows:
              {target.products.map((p) => (
                <ItemChip key={p.item} id={p.item} name={name(p.item)} compact tone="muted" />
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-100">{ex.headline}</p>
        {ex.reason && <p className="mt-0.5 text-sm text-slate-400">{ex.reason}</p>}
      </div>

      {/* What to do */}
      <div className="flex flex-col gap-3">
        {moving && outcome.from !== "hub" && outcome.from !== "supplies" && (
          <Section title="First, clear the old farm">
            <p className="text-xs text-slate-400">Harvest anything fully grown on {current.name}, then break the rest. Plants already in the right spot for the new farm can stay.</p>
          </Section>
        )}
        {outcome.spent.length > 0 && (
          <Section title={moving ? "Place from your inventory" : "Re-place from your inventory"}>
            <div className="flex flex-wrap gap-1">
              {outcome.spent.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone="cost" />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">These have a gold outline on the picture. Confirming takes them off your stock.</p>
          </Section>
        )}
        {free.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer select-none list-none text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
              Plant for free · {free.reduce((n, s) => n + s.count, 0)} base crops
            </summary>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {free.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} compact />
              ))}
            </div>
          </details>
        )}
        {outcome.short.length > 0 && (
          <Section title="Can't afford yet">
            <div className="flex flex-wrap gap-1">
              {outcome.short.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone="warn" />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Leave those cells empty for now.</p>
          </Section>
        )}
        {outcome.harvested.length > 0 && (
          <Section title="Harvest now">
            <div className="flex flex-wrap gap-1">
              {outcome.harvested.map((s) => (
                <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone="gain" />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Drops are random, so add what you actually got under What you own.</p>
          </Section>
        )}
        {ex.verb === "stay" && waiting.length > 0 && (
          <Section title="Working towards">
            <ul className="space-y-1">
              {waiting.slice(0, 6).map((w) => {
                const pct = Math.min(100, Math.round((100 * w.have) / Math.max(1, w.target)));
                return (
                  <li key={w.item} className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="w-28 shrink-0 truncate sm:w-32">{name(w.item)}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-700">
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
        {target.kind === "farm" && (
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">Every visit</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {GENERAL_TIPS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {unknown && (
        <p className="rounded-md border border-slate-700/60 bg-slate-900/50 px-2 py-1.5 text-[11px] text-slate-400">
          This assumes {current.name} is complete and nothing is growing on its target cells.{" "}
          <button type="button" onClick={onEditFacts} className="font-medium text-violet-300 underline-offset-2 hover:underline">
            Tell me what's there
          </button>
        </p>
      )}

      <footer className="mt-auto flex flex-col gap-2 pt-1">
        {ex.verb === "supplies" ? (
          <button type="button" className={buttonClass.primary} onClick={onOpenInventory}>
            <ShoppingCart className="h-4 w-4" /> Update what you own
          </button>
        ) : ex.verb === "done" ? null : (
          <button type="button" className={buttonClass.primary} onClick={onConfirm}>
            <Check className="h-4 w-4" /> {ex.verb === "stay" || ex.verb === "wait" ? `Done with Plot ${plotId}` : `Did it: Plot ${plotId} is on ${target.name}`}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={buttonClass.ghost} onClick={onPickFarm}>
            <RotateCcw className="h-3.5 w-3.5" /> Not on {current.name}?
          </button>
          {current.kind === "farm" && (
            <button type="button" className={buttonClass.ghost} onClick={onEditFacts}>
              {hasFacts(plot.facts) ? <ListChecks className="h-3.5 w-3.5 text-violet-300" /> : <Eye className="h-3.5 w-3.5" />} What's on the plot
            </button>
          )}
        </div>
      </footer>
    </article>
  );
};
