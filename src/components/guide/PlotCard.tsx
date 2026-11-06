/**
 * One plot's column on the dashboard, top to bottom: the header, the confirm button(s) (first, so
 * they never move when the sections below open, close or change), the instruction (its reason in a
 * hint), the destination farm as a large picture (where the plot is now under it), then what to do
 * and what the farm is working towards.
 */
import React, { useState } from "react";
import { ArrowRight, Check, ChevronRight, ExternalLink, Minus, Plus, SkipForward, Undo2 } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import {
  GENERAL_TIPS,
  explain,
  farmOf,
  farmTips,
  itemName,
  type Catalog,
  type ConfirmExtras,
  type FlowNeeds,
  type ItemCount,
  type PlotInput,
  type PlotOutcome,
  type ScriptKnobs,
  type Verb,
} from "../../guide";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { IconButton, KitButton, KitLabel, Pill, type Tone } from "../ui/kit";
import { surface } from "../ui/surface";
import { FarmPicture } from "./FarmPicture";
import { WorkingTowards } from "./FlowNeeds";
import { ItemChip } from "./primitives";
import { confirmHintText, confirmLabel } from "./format";

/** One badge style (the kit's Pill); colour only where it means something. */
const VERB_BADGE: Record<Verb, { label: string; tone: Tone }> = {
  switch: { label: "Switch", tone: "neutral" },
  stay: { label: "Keep", tone: "neutral" },
  rebuild: { label: "Rebuild", tone: "warn" },
  clear: { label: "Clear", tone: "neutral" },
  wait: { label: "Wait", tone: "neutral" },
  supplies: { label: "Needs supplies", tone: "warn" },
  done: { label: "Done", tone: "neutral" },
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
  /** Whole-flow totals (null when the flow's script has no build plan). */
  needs?: FlowNeeds | null;
  /** What the player owns now: the done-this-visit card's progress reads it. */
  inventory?: Record<string, number>;
  /** Plots in this visit (login order) and which of them are already checked, for "waiting on" lines. */
  visitPlots?: number[];
  checked?: number[];
  /** The plot was skipped this visit (not done): what it still needs, e.g. "7 Dead Plant". */
  skipped?: string;
}

/** "Plot 2", "Plots 2 and 3". */
const plotList = (ids: number[]) => (ids.length === 1 ? `Plot ${ids[0]}` : `Plots ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`);

/** "37 base crops", "31 base crops and 6 fire", "4 fire". */
function freeLabel(free: ItemCount[]): string {
  const fire = free.filter((f) => f.item === "fire").reduce((n, f) => n + f.count, 0);
  const crops = free.filter((f) => f.item !== "fire").reduce((n, f) => n + f.count, 0);
  return [crops ? `${crops} base crop${crops === 1 ? "" : "s"}` : "", fire ? `${fire} fire` : ""].filter(Boolean).join(" and ");
}

/** A step on the card: a short label (with its explanation in a hint) over its content. */
const Section: React.FC<{ title: string; hint?: React.ReactNode; hintTitle?: string; children: React.ReactNode }> = ({ title, hint, hintTitle, children }) => (
  <section className="space-y-1.5">
    <KitLabel
      actions={
        hint ? (
          <InfoHint title={hintTitle ?? title} label={`About: ${title}`} width={280}>
            {hint}
          </InfoHint>
        ) : undefined
      }
    >
      {title}
    </KitLabel>
    {children}
  </section>
);

const Chips: React.FC<{ items: ItemCount[]; name: (id: string) => string; tone?: React.ComponentProps<typeof ItemChip>["tone"]; compact?: boolean }> = ({ items, name, tone, compact }) => (
  <div className="flex flex-wrap gap-1">
    {items.map((s) => (
      <ItemChip key={s.item} id={s.item} name={name(s.item)} count={s.count} tone={tone} compact={compact} />
    ))}
  </div>
);

/** A collapsible section; the confirm button is above it, so opening it never moves the button. */
const Fold: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <details className="group">
    <summary className="focus-ring flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-inner text-secondary font-medium text-fg-muted select-none transition-colors duration-(--duration-hover) hover:text-fg [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden className="size-3.5 transition-transform duration-(--duration-ink) group-open:rotate-90 motion-reduce:transition-none" />
      {title}
    </summary>
    <div className="pt-1.5">{children}</div>
  </details>
);

const TipList: React.FC<{ tips: readonly string[] }> = ({ tips }) => (
  <ul className="list-disc space-y-1 pl-4 text-secondary text-fg-body">
    {tips.map((t) => (
      <li key={t}>{t}</li>
    ))}
  </ul>
);

const CardHeader: React.FC<{ plotId: number; next?: boolean; badge: React.ReactNode }> = ({ plotId, next, badge }) => (
  <header className="flex min-h-6 flex-wrap items-center gap-2">
    <h2 className="text-title text-fg">Plot {plotId}</h2>
    {badge}
    {next && (
      <Pill strong className="ml-auto bg-select/15 text-select-fg">
        <ArrowRight aria-hidden /> Next up
      </Pill>
    )}
  </header>
);

/** The destination's name and its Designer link. */
const FarmLine: React.FC<{ name: string; detail?: string; moving: boolean; code?: string }> = ({ name, detail, moving, code }) => (
  <div className="flex min-w-0 items-center gap-1.5 text-secondary">
    {moving && <ArrowRight aria-hidden className="size-3.5 shrink-0 text-fg-meta" />}
    <span className="truncate font-medium text-fg-body" title={detail ? `${name} · ${detail}` : name}>
      {name}
    </span>
    {code && (
      <a
        className="hit-area focus-ring ml-auto inline-flex shrink-0 items-center gap-1 rounded-inner text-meta text-fg-meta transition-colors duration-(--duration-hover) hover:text-fg"
        href={`/designer?layout=${encodeURIComponent(code)}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open ${name} in the Designer (new tab). It replaces the layout you have there.`}
      >
        <ExternalLink aria-hidden className="size-3" /> Designer
      </a>
    )}
  </div>
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
  needs = null,
  inventory = {},
  visitPlots = [],
  checked = [],
  skipped,
}) => {
  const name = (id: string) => itemName(data, id);
  const current = farmOf(catalog, plotId, plot.farm);
  const reportedZombuds = (plot.facts?.standing ?? []).filter((s) => s.kind === "zombud" && s.fullyGrown).length;
  const [zombuds, setZombuds] = useState(reportedZombuds);
  const othersLeft = visitPlots.filter((id) => id !== plotId && !checked.includes(id));

  if (!outcome) {
    // Waiting on other plots: say which. Once every plot is through, the page's banner carries the
    // "Next check-in" instruction, so the cards don't repeat it.
    const waitingLine = othersLeft.length
      ? `Waiting on ${plotList(othersLeft)}. This card stays as it is until the next visit: do ${othersLeft.length === 1 ? "that plot" : "those plots"} and press ${othersLeft.length === 1 ? "its" : "their"} button too.`
      : null;
    return (
      <article className={cn(surface.card, "flex min-w-0 flex-col gap-3 p-3")} aria-label={`Plot ${plotId}`}>
        <CardHeader
          plotId={plotId}
          badge={
            skipped !== undefined ? (
              <Pill>
                <SkipForward aria-hidden /> Skipped
              </Pill>
            ) : (
              <Pill>
                <Check aria-hidden /> Done this visit
              </Pill>
            )
          }
        />
        <div className="space-y-0.5">
          {skipped !== undefined ? (
            <p className="text-title text-fg">{skipped ? `Skipped this visit · still needs ${skipped}` : "Skipped this visit"}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-title text-fg">
              <Check aria-hidden className="size-4 shrink-0 text-fg-muted" /> Plot {plotId} is set up on {current.name}
            </p>
          )}
          {waitingLine && <p className="text-secondary text-fg-muted">{waitingLine}</p>}
        </div>
        {canUndo && (
          <KitButton size="md" className="self-start" onClick={onUndo}>
            <Undo2 /> {skipped !== undefined ? "Undo skip" : "Undo, I didn't do this"}
          </KitButton>
        )}
        <FarmPicture layout={current.layout} nameOf={name} data={data} maxCell={30} facts={plot.facts} />
        {needs && current.products.length > 0 && <WorkingTowards products={current.products.map((p) => p.item)} needs={needs} inventory={inventory} data={data} />}
      </article>
    );
  }

  const target = farmOf(catalog, plotId, outcome.to);
  const ex = explain(outcome, catalog, data);
  const badge = VERB_BADGE[ex.verb];
  const moving = outcome.from !== outcome.to && ex.verb !== "supplies";
  const free = tally(outcome.placedCells.filter((c) => !c.paid).map((c) => c.kind));
  const tips = target.kind === "farm" ? farmTips(target.products.map((p) => p.item), target.cost.map((c) => c.item), knobs) : [];
  const waiting = outcome.waitFor.filter((w) => w.target > 0);
  const showZombuds = zombudPerHarvest > 0 && !moving && ex.verb !== "done";
  const devourerFarm = !moving && current.products.some((p) => p.item === "devourer");
  // Items an earlier plot this visit places that this card's numbers already account for.
  const before = earlier.filter((e) => e.spent.length > 0);
  const harvestNow = [...outcome.harvested, ...outcome.harvestReady.filter((h) => !outcome.harvested.some((x) => x.item === h.item))];
  const spentTotal = outcome.spent.reduce((s, x) => s + x.count, 0);
  const spentWord = spentTotal > 0 ? (outcome.spent.length === 1 ? `the ${spentTotal} ${name(outcome.spent[0].item)}` : `the ${spentTotal} items it places`) : "";
  const towards = ex.verb !== "done" ? target.products.map((p) => p.item) : [];
  const label = confirmLabel(ex.verb, plotId, target.name);
  const hint = confirmHintText(visitPlots.length, spentWord);

  return (
    <article
      className={cn(surface.card, "flex min-w-0 flex-col gap-3 p-3", next && "border-select/70 ring-1 ring-select/40")}
      aria-label={`Plot ${plotId}`}
      aria-current={next ? "step" : undefined}
    >
      <CardHeader plotId={plotId} next={next} badge={<Pill tone={badge.tone}>{badge.label}</Pill>} />

      {/* The action, first: the same place on every card, whatever opens, closes or changes below. */}
      {ex.verb === "supplies" ? (
        <div className="flex flex-wrap gap-2">
          <KitButton size="md" className="min-w-32 flex-1" onClick={onOpenInventory} aria-label={`Add supplies for Plot ${plotId}`}>
            <Plus /> Add supplies
          </KitButton>
          <KitButton size="md" className="min-w-32 flex-1" onClick={onSkip} aria-label={`Skip Plot ${plotId} for now`}>
            <SkipForward /> Skip for now
          </KitButton>
        </div>
      ) : ex.verb === "done" ? null : (
        <div className="flex items-center gap-2" data-testid="plot-confirm">
          <KitButton
            // One primary on the page: the next plot's confirm. Later plots can still be confirmed.
            variant={next ? "primary" : "neutral"}
            size="md"
            className="flex-1"
            aria-label={label.aria}
            aria-describedby={`plot-${plotId}-confirm-hint`}
            onClick={() => onConfirm(showZombuds ? { zombudHarvests: zombuds, zombudPerHarvest } : {})}
          >
            <Check /> {label.text}
          </KitButton>
          <span id={`plot-${plotId}-confirm-hint`} className="sr-only">
            {hint}
          </span>
          <InfoHint title="Do it in the game first" label={`About Plot ${plotId}'s button`} width={280}>
            <p>{hint}</p>
          </InfoHint>
        </div>
      )}

      <div className="flex min-w-0 items-start gap-1.5">
        <h3 className="min-w-0 text-title text-fg">{ex.headline}</h3>
        {ex.reason && (
          <InfoHint title="Why" label={`Why: ${ex.headline}`} width={300} className="mt-0.5">
            <p>{ex.reason}</p>
          </InfoHint>
        )}
      </div>

      {/* Where it goes, large, with where it is now under it. */}
      <div className="min-w-0 space-y-1.5">
        <FarmLine name={target.name} detail={target.detail} moving={moving} code={target.code && target.kind === "farm" ? target.code : undefined} />
        <FarmPicture layout={target.layout} nameOf={name} data={data} maxCell={34} highlight={outcome.placedCells.filter((c) => c.paid)} facts={moving ? undefined : plot.facts} />
        {target.products.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-meta text-fg-meta">
            Grows
            {target.products.map((p) => (
              <ItemChip key={p.item} id={p.item} name={name(p.item)} compact tone="muted" />
            ))}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2 text-meta text-fg-meta">
          <span className="min-w-0 truncate">
            {moving ? "Now on " : "On "}
            <span className="text-fg-body">{current.name}</span>
          </span>
          <LinkButton className="ml-auto shrink-0 text-meta" onClick={onPickFarm} aria-label={`Wrong farm? Pick the farm Plot ${plotId} is on (now ${current.name})`}>
            Wrong farm?
          </LinkButton>
        </div>
      </div>

      {/* What to do */}
      <div className="flex flex-col gap-3">
        {moving && outcome.from !== "hub" && outcome.from !== "supplies" && (
          <Section title="First, clear the old farm">
            <p className="text-secondary text-fg-body">Harvest anything fully grown on {current.name}, then break the rest. Plants already in the right spot for the new farm can stay.</p>
          </Section>
        )}
        {harvestNow.length > 0 && (
          <Section
            title="Harvest now"
            hint={
              outcome.selfFunded.length
                ? "Some of this goes straight back onto the plot. When you add your harvest under What you own, count only what's left after placing."
                : "The counts are plants, not drops. Drops are random, so add what you actually got under What you own."
            }
          >
            <Chips items={harvestNow} name={name} tone="gain" />
          </Section>
        )}
        {outcome.spent.length > 0 && (
          <Section title={moving ? "Place from your inventory" : "Re-place from your inventory"} hint="These have a gold corner on the picture. Confirming takes them off your stock.">
            <Chips items={outcome.spent} name={name} tone="cost" />
          </Section>
        )}
        {outcome.short.length > 0 && (
          <Section title="Can't afford yet" hint="Leave those cells empty for now. They stay marked missing, so the Guide asks again next visit.">
            <Chips items={outcome.short} name={name} tone="warn" />
          </Section>
        )}
        {showZombuds && (
          <Section
            title="Zombuds harvested this visit"
            hint={`Each harvest gives ${zombudPerHarvest} Zombuds and uses the ${zombudPerHarvest} Dead Plants around it, which you then put back.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className={cn(surface.well, "inline-flex items-center p-0.5")}>
                <IconButton size="md" onClick={() => setZombuds(Math.max(0, zombuds - 1))} disabled={zombuds === 0} aria-label="One fewer Zombud harvested">
                  <Minus />
                </IconButton>
                <span className="w-8 text-center text-body tabular-nums text-fg" aria-live="polite">
                  {zombuds}
                </span>
                <IconButton size="md" onClick={() => setZombuds(zombuds + 1)} aria-label="One more Zombud harvested">
                  <Plus />
                </IconButton>
              </div>
              {zombuds > 0 && (
                <span className="min-w-0 flex-1 text-secondary text-fg-muted">
                  Confirming adds {zombuds * zombudPerHarvest} Zombuds and takes {zombuds * zombudPerHarvest} Dead Plants.
                </span>
              )}
            </div>
          </Section>
        )}
        {devourerFarm && (
          <label className={cn(surface.well, "flex cursor-pointer items-start gap-2 p-2 text-secondary text-fg-body")}>
            <input type="checkbox" className="focus-ring mt-0.5 size-3.5 shrink-0 cursor-pointer accent-go" checked={!!plot.facts?.devourerRefresh} onChange={(e) => onDevourerRefresh(e.target.checked)} />
            <span>A Devourer was harvested here, or one of the farm's plants decayed, since it was built. The farm then has to be rebuilt.</span>
          </label>
        )}
        {needs && towards.length > 0 ? (
          <WorkingTowards
            products={towards}
            needs={needs}
            inventory={outcome.inventoryAfter}
            waitFor={ex.verb === "stay" ? waiting : []}
            data={data}
            footnote={
              before.length > 0 && (
                <p className="mt-1 text-meta text-fg-meta">
                  Counts are after {before.map((e) => `Plot ${e.plotId}`).join(" and ")} {before.length === 1 ? "places its" : "place their"} items this visit.
                </p>
              )
            }
          />
        ) : (
          ex.verb === "stay" &&
          waiting.length > 0 && (
            <Section title="Working towards">
              <ul className="space-y-1">
                {waiting.slice(0, 6).map((w) => (
                  <li key={w.item} className="flex items-center justify-between gap-2 text-secondary text-fg-body">
                    <span className="truncate">{name(w.item)}</span>
                    <span className="tabular-nums text-fg-muted">
                      {w.have}/{w.target}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )
        )}
        {tips.length > 0 && (
          <Section title="While you're here">
            <TipList tips={tips} />
          </Section>
        )}
        {free.length > 0 && (
          <Fold title={`Plant for free · ${freeLabel(free)}`}>
            <Chips items={free} name={name} compact />
          </Fold>
        )}
        {target.kind === "farm" && (
          <Fold title="Every visit">
            <TipList tips={GENERAL_TIPS} />
          </Fold>
        )}
      </div>
    </article>
  );
};
