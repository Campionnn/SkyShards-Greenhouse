/**
 * The Rose Dragon Guide (`/guide`): a three-plot dashboard.
 *
 * Top: what you own and the forecast strip. Middle: one card per plot showing where it is, where it
 * should go (as the real layout), what to place and what to do there, with a per-plot "done"
 * button. The cards are one login, worked out Plot 1 -> 2 -> 3 against shared stock, so following
 * them in order never double-spends. Confirming a plot applies only the deterministic stock changes;
 * ordinary harvests are entered by the player.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Backpack, Compass, Loader2, PartyPopper, Pencil, Plus, RefreshCw, Settings2 } from "lucide-react";
import { InfoHint } from "../components/ui/InfoHint";
import { defaultSettings } from "../simulator";
import { LocalStorageManager, type StoredGuideState } from "../utilities/localStorageManager";
import {
  STORAGE_VERSION,
  allActed,
  buildCatalog,
  buildPlan,
  confirmPlot,
  createGuideEnv,
  decideLogin,
  farmOf,
  goalOwned,
  initialState,
  itemName,
  loadShippedFlow,
  emptyFacts,
  restoreState,
  scriptKnobs,
  setFacts,
  setFarm,
  setItem,
  skipPlot,
  startNewCheckIn,
  summarise,
  toInput,
  undoPlot,
  validate,
  withSettings,
  zombudYield,
  PRECISION_SEEDS,
  type Catalog,
  type FlowsFile,
  type Forecast,
  type GuideState,
  type Plan,
  type PlotOutcome,
} from "../guide";
import { ForecastCancelled, GuidePool } from "../guide/worker/pool";
import { PlotCard } from "../components/guide/PlotCard";
import { FarmGallery } from "../components/guide/FarmGallery";
import { InventoryDialog, type InventoryMode } from "../components/guide/InventoryDialog";
import { ForecastStrip } from "../components/guide/ForecastStrip";
import { SettingsDialog } from "../components/guide/SettingsDialog";
import { ItemChip } from "../components/guide/primitives";
import { buttonClass, scheduleText, type Precision } from "../components/guide/format";
import "../components/guide/guide.css";

const guideEnv = createGuideEnv();
const data = guideEnv.engine.data;

/** Typing must not re-run the projection and a forecast on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

type Open = { kind: "inventory"; mode: InventoryMode } | { kind: "settings" } | { kind: "farm"; plotId: number } | null;

interface Loaded {
  flow: FlowsFile;
  catalog: Catalog;
}

function load(flow: FlowsFile, catalog: Catalog): { state: GuideState; precision: Precision; fresh: boolean } {
  const saved = LocalStorageManager.loadGuideState();
  const restored = restoreState(saved, flow, catalog, defaultSettings());
  return { state: restored ?? initialState(flow, defaultSettings()), precision: saved?.precision ?? "quick", fresh: !restored };
}

const toStored = (state: GuideState, precision: Precision): StoredGuideState => ({ version: STORAGE_VERSION, ...state, precision });

export const GuidePage: React.FC = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<GuideState | null>(null);
  const [precision, setPrecision] = useState<Precision>("quick");
  const [open, setOpen] = useState<Open>(null);

  useEffect(() => {
    let cancelled = false;
    loadShippedFlow()
      .then((flow) => {
        if (cancelled) return;
        const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);
        const restored = load(flow, catalog);
        setLoaded({ flow, catalog });
        setState(restored.state);
        setPrecision(restored.precision);
      })
      .catch((error: unknown) => !cancelled && setLoadError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist: debounced while typing, and flushed when the page is hidden or closed.
  const latest = useRef<{ state: GuideState; precision: Precision } | null>(null);
  useEffect(() => {
    if (!state) return;
    latest.current = { state, precision };
    const timer = setTimeout(() => LocalStorageManager.saveGuideState(toStored(state, precision)), 300);
    return () => clearTimeout(timer);
  }, [state, precision]);
  useEffect(() => {
    const flush = () => latest.current && LocalStorageManager.saveGuideState(toStored(latest.current.state, latest.current.precision));
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const settled = useDebounced(state, 250);
  const flow = loaded?.flow;
  const catalog = loaded?.catalog;

  const problems = useMemo(() => (settled && catalog ? validate(settled, catalog, data) : []), [settled, catalog]);
  const { outcomes, decideError } = useMemo(() => {
    if (!flow || !settled || problems.length) return { outcomes: [] as PlotOutcome[], decideError: null as string | null };
    try {
      return { outcomes: decideLogin(flow, toInput(settled), guideEnv), decideError: null };
    } catch (error) {
      return { outcomes: [] as PlotOutcome[], decideError: error instanceof Error ? error.message : String(error) };
    }
  }, [flow, settled, problems.length]);

  const done = !!catalog && !!state && goalOwned(catalog, state.inventory) === catalog.goal.length;

  // Forecast: from the start of this login (plots already done this visit stay done).
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const poolRef = useRef<GuidePool | null>(null);
  useEffect(() => {
    const pool = new GuidePool();
    poolRef.current = pool;
    return () => pool.dispose();
  }, []);
  const forecastInput = useMemo(() => (settled ? toInput(settled) : null), [settled]);
  useEffect(() => {
    const pool = poolRef.current;
    if (!flow || !forecastInput || !pool || problems.length || decideError || done) return;
    const seeds = PRECISION_SEEDS[precision];
    let live = true;
    setForecastError(null);
    setProgress({ done: 0, total: seeds.length });
    pool
      .forecast({
        flow,
        input: forecastInput,
        seeds,
        onProgress: ({ done: n, total, timelines }) => {
          if (!live) return;
          setProgress({ done: n, total });
          // Show numbers early, once a few runs are in, and refine them as the rest land.
          if (n >= Math.min(3, total)) {
            setForecast(summarise(timelines, forecastInput.inventory));
            setPlan(buildPlan(timelines));
          }
        },
      })
      .then((runs) => {
        if (!live) return;
        setForecast(summarise(runs, forecastInput.inventory));
        setPlan(buildPlan(runs));
        setProgress(null);
      })
      .catch((error: unknown) => {
        if (!live || error instanceof ForecastCancelled) return;
        setForecastError(error instanceof Error ? error.message : String(error));
        setProgress(null);
      });
    return () => {
      live = false;
    };
  }, [flow, forecastInput, precision, problems.length, decideError, done]);

  /** Apply a change and save at once (confirmations must survive a reload right after). */
  const commit = useCallback(
    (fn: (s: GuideState) => GuideState) =>
      setState((s) => {
        if (!s) return s;
        const next = fn(s);
        LocalStorageManager.saveGuideState(toStored(next, precision));
        return next;
      }),
    [precision]
  );
  const update = useCallback((fn: (s: GuideState) => GuideState) => setState((s) => (s ? fn(s) : s)), []);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-lg border border-red-700 bg-red-950/40 p-4 text-sm text-red-200">{loadError}</p>
      </div>
    );
  }
  if (!flow || !catalog || !state) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-hidden />
      </div>
    );
  }

  // The cards use the settled state's decisions; a plot confirmed since then shows as done at once.
  const knobs = scriptKnobs(flow);
  const outcomeFor = (plotId: number) => (state.plots[plotId]?.acted ? null : (outcomes.find((o) => o.plotId === plotId && o.from === state.plots[plotId]?.farm) ?? null));
  const nextPlot = catalog.plots.find((id) => !state.plots[id]?.acted);
  const stale = settled !== state;
  const owned = goalOwned(catalog, state.inventory);
  const supplies = ["dead_plant", "fermento"];
  const tracked = Object.values(state.inventory).filter((n) => n > 0).length;

  return (
    <div className="guide-root container mx-auto max-w-screen-2xl space-y-4 overflow-x-clip px-2 py-4 sm:px-4 sm:py-6">
      {/* Same header row as the Simulator: icon, small title, info hint, one action on the right. */}
      <header className="flex flex-wrap items-center gap-2">
        <Compass className="h-4 w-4 text-emerald-400" aria-hidden />
        <h1 className="text-sm font-medium text-slate-200">Rose Dragon Guide</h1>
        <InfoHint title="How to use this page" width={320}>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Harvest, then update what you own.</li>
            <li>Do the plots left to right. Each card's button is what you do on that plot this visit.</li>
            <li>Open the plan to see what comes next.</li>
          </ol>
          <p>
            The cards are the shipped Rose Dragon flow's own decisions for exactly what you entered, worked out in login order (Plot 1, then 2, then 3) so they never
            spend the same stock twice. Confirming a plot takes off what it placed; harvests are random, so you add those. Hover or tap any cell of a farm to see what it
            is.
          </p>
        </InfoHint>
        <span className="hidden text-xs text-slate-500 md:inline">Harvest, update what you own, then do the plots left to right.</span>
        <button
          type="button"
          className={`${buttonClass.neutral} ml-auto`}
          onClick={() => setOpen({ kind: "settings" })}
          aria-label="How you play: schedule and stats"
          title="When you're online, your stats and the forecast precision"
        >
          <Settings2 className="h-3.5 w-3.5" /> <span>Online {scheduleText(state.checkEvery, state.settings.activity)}</span>
        </button>
      </header>

      {/* What you own: one panel. Empty, it asks for a first entry; afterwards its main action is
          the thing you do every visit (add a harvest), with editing the totals as the alternative. */}
      {tracked === 0 ? (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3" aria-label="What you own">
          <Backpack className="hidden h-4 w-4 shrink-0 text-emerald-400 sm:block" aria-hidden />
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-sm font-medium text-emerald-200">Start by entering what you own</h2>
            <p className="text-xs text-slate-400">
              The plan depends on your stock: the Dead Plants and Fermento you've farmed, and any mutations you already have. Until then, the cards below only use
              farms that cost nothing.
            </p>
          </div>
          <button type="button" className={buttonClass.primary} onClick={() => setOpen({ kind: "inventory", mode: "set" })}>
            <Backpack className="h-4 w-4" /> Enter what I own
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-slate-600/30 bg-slate-800/40 px-4 py-3 sm:flex-row sm:items-center" aria-label="What you own">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Backpack className="h-4 w-4 text-emerald-400" aria-hidden />
            <h2 className="text-sm font-medium text-slate-200">What you own</h2>
            {supplies.map((id) => (
              <ItemChip key={id} id={id} name={itemName(data, id)} count={state.inventory[id] ?? 0} tone={(state.inventory[id] ?? 0) > 0 ? "default" : "muted"} />
            ))}
            <span className="text-xs text-slate-400">
              <span className={owned === catalog.goal.length ? "text-emerald-300" : "text-slate-300"}>
                {owned}/{catalog.goal.length}
              </span>{" "}
              Rose Dragon legendaries · {tracked} item{tracked === 1 ? "" : "s"} tracked
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => setOpen({ kind: "inventory", mode: "set" })}
              title="Correct the totals in your inventory"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit totals
            </button>
            {!done && (
              <button
                type="button"
                className={buttonClass.primary}
                onClick={() => setOpen({ kind: "inventory", mode: "add" })}
                title="Type what you just harvested; it's added to what you have"
              >
                <Plus className="h-4 w-4" /> Add a harvest
              </button>
            )}
          </div>
        </section>
      )}

      {done ? (
        <section className="flex flex-col items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-8 text-center" aria-label="Done">
          <PartyPopper className="h-8 w-8 text-yellow-300" aria-hidden />
          <h2 className="text-lg font-semibold text-yellow-200">You have everything for the Rose Dragon.</h2>
          <p className="max-w-xl text-sm text-slate-300">
            Every legendary ingredient is in your inventory ({catalog.goal.map((g) => `${g.count}× ${itemName(data, g.item)}`).join(", ")}). Your plots are free for
            whatever comes next.
          </p>
        </section>
      ) : (
        <ForecastStrip
          forecast={forecast}
          plan={plan}
          progress={progress}
          error={forecastError}
          catalog={catalog}
          data={data}
          outcomes={outcomes}
          onOpenSettings={() => setOpen({ kind: "settings" })}
        />
      )}

      {(problems.length > 0 || decideError) && (
        <div className="rounded-lg border border-red-700/70 bg-red-950/30 p-3 text-sm text-red-200" role="alert">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {decideError && <p>{decideError}</p>}
        </div>
      )}

      {!done && allActed(state) && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-emerald-200">All three plots are done for this visit.</p>
            <p className="text-xs text-slate-400">Next time you're online, harvest, then start the next check-in and add what you got.</p>
          </div>
          <button
            type="button"
            className={buttonClass.primary}
            onClick={() => {
              commit(startNewCheckIn);
              setOpen({ kind: "inventory", mode: "add" });
            }}
          >
            <RefreshCw className="h-4 w-4" /> I'm back: next check-in
          </button>
        </section>
      )}

      {!done && (
        <div className={`grid min-w-0 gap-3 lg:grid-cols-3 ${stale ? "opacity-80 transition-opacity motion-reduce:transition-none" : ""}`}>
          {catalog.plots.map((plotId) => {
            const plot = state.plots[plotId];
            const outcome = outcomeFor(plotId);
            if (!plot.acted && !outcome) {
              return (
                <div key={plotId} className="flex min-h-48 items-center justify-center rounded-lg border border-slate-600/30 bg-slate-800/40 text-xs text-slate-400">
                  Working out Plot {plotId}…
                </div>
              );
            }
            const earlier = outcomes.filter((o) => o.plotId < plotId).map((o) => ({ plotId: o.plotId, spent: o.spent }));
            const perHarvest = outcome && outcome.from === outcome.to ? zombudYield(catalog, plotId, outcome.to) : 0;
            return (
              <PlotCard
                key={`${plotId}:${plot.farm}:${plot.acted ? 1 : 0}`}
                plotId={plotId}
                plot={plot}
                outcome={outcome}
                catalog={catalog}
                data={data}
                knobs={knobs}
                next={plotId === nextPlot && !!outcome}
                earlier={earlier}
                zombudPerHarvest={perHarvest}
                canUndo={!!state.confirmations[plotId]}
                onConfirm={(extras) => outcome && commit((s) => confirmPlot(s, outcome, extras))}
                onSkip={() => commit((s) => skipPlot(s, plotId))}
                onUndo={() => commit((s) => undoPlot(s, plotId))}
                onPickFarm={() => setOpen({ kind: "farm", plotId })}
                onDevourerRefresh={(on) =>
                  commit((s) => setFacts(s, plotId, { ...(s.plots[plotId].facts ?? emptyFacts()), devourerRefresh: on }))
                }
                onOpenInventory={() => setOpen({ kind: "inventory", mode: "add" })}
              />
            );
          })}
        </div>
      )}

      <InventoryDialog
        open={open?.kind === "inventory"}
        mode={open?.kind === "inventory" ? open.mode : undefined}
        inventory={state.inventory}
        catalog={catalog}
        data={data}
        harvestable={catalog.plots.flatMap((id) => farmOf(catalog, id, state.plots[id].farm).products.map((p) => p.item))}
        onChange={(item, amount) => update((s) => setItem(s, item, amount))}
        onClose={() => {
          commit((s) => s);
          setOpen(null);
        }}
      />
      <SettingsDialog
        open={open?.kind === "settings"}
        settings={state.settings}
        checkEvery={state.checkEvery}
        precision={precision}
        onChange={(settings, checkEvery) => commit((s) => withSettings(s, settings, checkEvery))}
        onPrecision={setPrecision}
        onReset={() => {
          LocalStorageManager.clearGuideState();
          setState(initialState(flow, defaultSettings()));
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
      {open?.kind === "farm" && (
        <FarmGallery
          open
          plotId={open.plotId}
          current={state.plots[open.plotId].farm}
          catalog={catalog}
          data={data}
          onPick={(farm) => {
            commit((s) => setFarm(s, open.plotId, farm));
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
};
