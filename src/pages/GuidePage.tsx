/**
 * The Rose Dragon Guide (`/guide`): a three-plot dashboard.
 *
 * Top: what you own and the forecast strip. Middle: one card per plot showing where it is, where it
 * should go (as the real layout), what to place and what to do there, with a per-plot "done"
 * button. The cards are one login, worked out Plot 1 -> 2 -> 3 against shared stock, so following
 * them in order never double-spends. Confirming a plot subtracts what it placed; harvests are
 * entered by the player.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Backpack, RefreshCw, Settings2 } from "lucide-react";
import { defaultSettings } from "../simulator";
import { LocalStorageManager } from "../utilities/localStorageManager";
import {
  allActed,
  buildCatalog,
  buildPlan,
  confirmPlot,
  confirmationOf,
  createGuideEnv,
  decideLogin,
  farmOf,
  initialState,
  itemName,
  loadShippedFlow,
  restoreState,
  scriptKnobs,
  setFacts,
  setFarm,
  setItem,
  startNewCheckIn,
  summarise,
  toInput,
  undoPlot,
  validate,
  PRECISION_SEEDS,
  type Catalog,
  type Confirmation,
  type FlowsFile,
  type Forecast,
  type GuideState,
  type Plan,
  type PlotOutcome,
} from "../guide";
import { ForecastCancelled, GuidePool } from "../guide/worker/pool";
import { PlotCard } from "../components/guide/PlotCard";
import { FarmGallery } from "../components/guide/FarmGallery";
import { FactsDialog } from "../components/guide/FactsDialog";
import { InventoryDialog } from "../components/guide/InventoryDialog";
import { ForecastStrip } from "../components/guide/ForecastStrip";
import { SettingsDialog } from "../components/guide/SettingsDialog";
import { ItemChip } from "../components/guide/primitives";
import { buttonClass, scheduleText, without, type Precision } from "../components/guide/format";
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

type Open = { kind: "inventory" } | { kind: "settings" } | { kind: "farm"; plotId: number } | { kind: "facts"; plotId: number } | null;

interface Loaded {
  flow: FlowsFile;
  catalog: Catalog;
}

function load(flow: FlowsFile, catalog: Catalog): { state: GuideState; precision: Precision } {
  const saved = LocalStorageManager.loadGuideState();
  const state = restoreState(saved, flow, catalog, defaultSettings()) ?? initialState(flow, defaultSettings());
  return { state, precision: saved?.precision ?? "quick" };
}

export const GuidePage: React.FC = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<GuideState | null>(null);
  const [precision, setPrecision] = useState<Precision>("quick");
  const [open, setOpen] = useState<Open>(null);
  const [confirmed, setConfirmed] = useState<Record<number, Confirmation>>({});

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

  // Persist (debounced).
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => LocalStorageManager.saveGuideState({ version: 2, ...state, precision }), 300);
    return () => clearTimeout(timer);
  }, [state, precision]);

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
    if (!flow || !forecastInput || !pool || problems.length || decideError) return;
    const seeds = PRECISION_SEEDS[precision];
    let live = true;
    setForecastError(null);
    setProgress({ done: 0, total: seeds.length });
    pool
      .forecast({
        flow,
        input: forecastInput,
        seeds,
        onProgress: ({ done, total, timelines }) => {
          if (!live) return;
          setProgress({ done, total });
          // Show numbers early, once a few runs are in, and refine them as the rest land.
          if (done >= Math.min(3, total)) {
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
  }, [flow, forecastInput, precision, problems.length, decideError]);

  const update = useCallback((fn: (s: GuideState) => GuideState) => setState((s) => (s ? fn(s) : s)), []);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-lg border border-red-700 bg-red-950/40 p-4 text-sm text-red-200">{loadError}</p>
      </div>
    );
  }
  if (!flow || !catalog || !state) return <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-400">Loading the Rose Dragon flow…</div>;

  // The cards use the settled state's decisions; a plot confirmed since then shows as done at once.
  const knobs = scriptKnobs(flow);
  const outcomeFor = (plotId: number) => (state.plots[plotId]?.acted ? null : (outcomes.find((o) => o.plotId === plotId && o.from === state.plots[plotId]?.farm) ?? null));
  const nextPlot = catalog.plots.find((id) => !state.plots[id]?.acted);
  const stale = settled !== state;
  const owned = catalog.goal.filter((g) => (state.inventory[g.item] ?? 0) >= g.count).length;
  const supplies = ["dead_plant", "fermento"];
  const factsPlot = open?.kind === "facts" ? open.plotId : null;

  return (
    <div className="guide-root mx-auto max-w-7xl space-y-4 px-3 py-5 sm:px-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-100">Rose Dragon Guide</h1>
          <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400" aria-label="How to use this page">
            <li>
              <span className="mr-1 font-semibold text-violet-300">1</span>Harvest, then update what you own
            </li>
            <li>
              <span className="mr-1 font-semibold text-violet-300">2</span>Do the plots left to right
            </li>
            <li>
              <span className="mr-1 font-semibold text-violet-300">3</span>Open the plan to see what's next
            </li>
          </ol>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => setOpen({ kind: "settings" })} title="How often you play, your stats">
            <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">Online {scheduleText(state.settings.activity)}</span>
            <span className="sm:hidden">Settings</span>
          </button>
        </div>
      </header>

      {/* What you own: the few numbers that matter, one tap to edit everything. */}
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-800/40 px-3 py-2.5 sm:px-4" aria-label="What you own">
        <span className="text-sm font-medium text-slate-200">What you own</span>
        {supplies.map((id) => (
          <ItemChip key={id} id={id} name={itemName(data, id)} count={state.inventory[id] ?? 0} tone={(state.inventory[id] ?? 0) > 0 ? "default" : "warn"} />
        ))}
        <span className="text-xs text-slate-400">
          Goal {owned}/{catalog.goal.length} legendaries · {Object.values(state.inventory).filter((n) => n > 0).length} items tracked
        </span>
        <button type="button" className={`${buttonClass.primary} ml-auto`} onClick={() => setOpen({ kind: "inventory" })}>
          <Backpack className="h-4 w-4" /> Update
        </button>
      </section>

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

      {(problems.length > 0 || decideError) && (
        <div className="rounded-lg border border-red-700/70 bg-red-950/30 p-3 text-sm text-red-200">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {decideError && <p>{decideError}</p>}
        </div>
      )}

      {allActed(state) ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-700/50 bg-emerald-950/20 px-4 py-3">
          <div>
            <p className="font-medium text-emerald-100">All three plots are done for this visit.</p>
            <p className="text-sm text-slate-400">Next time you're online, add what you harvested, then start the next check-in.</p>
          </div>
          <button
            type="button"
            className={buttonClass.primary}
            onClick={() => {
              setConfirmed({});
              update(startNewCheckIn);
              setOpen({ kind: "inventory" });
            }}
          >
            <RefreshCw className="h-4 w-4" /> I'm back: next check-in
          </button>
        </section>
      ) : null}

      <div className={`grid gap-3 lg:grid-cols-3 ${stale ? "opacity-80 transition-opacity motion-reduce:transition-none" : ""}`}>
        {catalog.plots.map((plotId) => {
          const plot = state.plots[plotId];
          const outcome = outcomeFor(plotId);
          if (!plot.acted && !outcome) {
            return (
              <div key={plotId} className="flex min-h-48 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-800/30 text-sm text-slate-500">
                Working out Plot {plotId}…
              </div>
            );
          }
          return (
            <PlotCard
              key={plotId}
              plotId={plotId}
              plot={plot}
              outcome={outcome}
              catalog={catalog}
              data={data}
              knobs={knobs}
              next={plotId === nextPlot && !!outcome}
              canUndo={!!confirmed[plotId]}
              onConfirm={() => {
                if (!outcome) return;
                setConfirmed((c) => ({ ...c, [plotId]: confirmationOf(state, outcome) }));
                update((s) => confirmPlot(s, outcome));
              }}
              onUndo={() => {
                const c = confirmed[plotId];
                if (!c) return;
                setConfirmed((all) => without(all, plotId));
                update((s) => undoPlot(s, c));
              }}
              onPickFarm={() => setOpen({ kind: "farm", plotId })}
              onEditFacts={() => setOpen({ kind: "facts", plotId })}
              onOpenInventory={() => setOpen({ kind: "inventory" })}
            />
          );
        })}
      </div>

      <p className="pb-6 text-[11px] leading-relaxed text-slate-500">
        The cards are the shipped Rose Dragon flow's own decisions for exactly what you entered, worked out in login order (Plot 1, then 2, then 3) so they never
        spend the same stock twice. Confirming a plot takes off what it placed; harvests are random, so you add those. The forecast plays the flow forward from
        here many times.
      </p>

      <InventoryDialog
        open={open?.kind === "inventory"}
        inventory={state.inventory}
        catalog={catalog}
        data={data}
        onChange={(item, amount) => update((s) => setItem(s, item, amount))}
        onClose={() => setOpen(null)}
      />
      <SettingsDialog
        open={open?.kind === "settings"}
        settings={state.settings}
        precision={precision}
        onChange={(settings) => update((s) => ({ ...s, settings }))}
        onPrecision={setPrecision}
        onReset={() => {
          LocalStorageManager.clearGuideState();
          setConfirmed({});
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
            setConfirmed((all) => without(all, open.plotId));
            update((s) => setFarm(s, open.plotId, farm));
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {factsPlot !== null && (
        <FactsDialog
          key={`${factsPlot}:${state.plots[factsPlot].farm}`}
          open
          plotId={factsPlot}
          farm={farmOf(catalog, factsPlot, state.plots[factsPlot].farm)}
          facts={state.plots[factsPlot].facts}
          data={data}
          onSave={(facts) => update((s) => setFacts(s, factsPlot, facts))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
};
