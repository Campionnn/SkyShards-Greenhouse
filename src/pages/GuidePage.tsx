/**
 * The Rose Dragon Guide (`/guide`): a dashboard for the three-plot flow, or the two-plot flow for
 * players with only Plots 1 and 2 (switch in the header; each version keeps its own saved state).
 *
 * Top: what you own and the forecast strip. Middle: one card per plot showing where it is, where it
 * should go (as the real layout), what to place and what to do there, with a per-plot "done"
 * button. The cards are one login, worked out Plot 1 -> 2 (-> 3) against shared stock, so following
 * them in order never double-spends. Confirming a plot applies only the deterministic stock changes;
 * ordinary harvests are entered by the player.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, FlaskConical, LoaderCircle, Pencil, Plus, RefreshCw, SkipForward, SlidersHorizontal } from "lucide-react";
import { cn } from "../components/ui/cn";
import { IconButton, KitButton, Segmented } from "../components/ui/kit";
import { surface } from "../components/ui/surface";
import { LocalStorageManager, type StoredGuideState } from "../utilities/localStorageManager";
import type { SimulatorScenarioHandoff } from "../utilities/layoutHandoff";
import {
  STORAGE_VERSION,
  allActed,
  applyImportedItems,
  buildCatalog,
  buildPlan,
  confirmPlot,
  createGuideEnv,
  decideLogin,
  baselineTotals,
  farmOf,
  flowFingerprint,
  flowNeeds,
  goalOwned,
  goalProgress,
  guideDefaultSettings,
  initialState,
  itemName,
  loadShippedFlow,
  emptyFacts,
  FLOW_VARIANTS,
  FLOW_VARIANT_ORDER,
  restoreState,
  scriptKnobs,
  scriptMarks,
  setFacts,
  setFarm,
  setItem,
  simulatorScenario,
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
  type FlowVariant,
  type Forecast,
  type GuideState,
  type Plan,
  type PlotOutcome,
  type RunTimeline,
} from "../guide";
import { ForecastCancelled, GuidePool, poolSize } from "../guide/worker/pool";
import { PlotCard } from "../components/guide/PlotCard";
import { FarmGallery } from "../components/guide/FarmGallery";
import { InventoryDialog, type InventoryMode } from "../components/guide/InventoryDialog";
import { ImportDialog } from "../components/guide/ImportDialog";
import { ForecastStrip } from "../components/guide/ForecastStrip";
import { SettingsDialog } from "../components/guide/SettingsDialog";
import { FlowNeedsPanel } from "../components/guide/FlowNeeds";
import { HowTo, HowToHint } from "../components/guide/HowTo";
import { scheduleText, timeAgo, type Precision } from "../components/guide/format";
import { liveSkipped, loadSkipped, saveSkipped, type SkippedPlots } from "../components/guide/skipped";
import "../components/guide/guide.css";

const guideEnv = createGuideEnv();
/** Runs from an empty start behind the whole-flow totals (the median of these). */
const TOTALS_SEEDS = Array.from({ length: 16 }, (_, i) => 1001 + i);
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

type Open = { kind: "inventory"; mode: InventoryMode } | { kind: "import" } | { kind: "settings" } | { kind: "farm"; plotId: number } | null;

interface Loaded {
  flow: FlowsFile;
  catalog: Catalog;
}

function load(flow: FlowsFile, catalog: Catalog, variant: FlowVariant): { state: GuideState; precision: Precision; fresh: boolean } {
  const saved = LocalStorageManager.loadGuideState(variant);
  const restored = restoreState(saved, flow, catalog, guideDefaultSettings());
  return { state: restored ?? initialState(flow, guideDefaultSettings()), precision: saved?.precision ?? "quick", fresh: !restored };
}

const toStored = (state: GuideState, precision: Precision): StoredGuideState => ({ version: STORAGE_VERSION, ...state, precision });

/** "Plot 1, then 2, then 3" / "Plot 1, then 2". */
const loginOrder = (plots: number[]) => `Plot ${plots[0]}${plots.slice(1).map((id) => `, then ${id}`).join("")}`;
const COUNT_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three" };

/** Which flow the Guide follows: every plot unlocked, or only Plots 1 and 2. Each keeps its own saved progress. */
const VariantSwitch: React.FC<{ value: FlowVariant; onChange: (variant: FlowVariant) => void }> = ({ value, onChange }) => (
  <Segmented<FlowVariant>
    label="Flow version"
    value={value}
    onChange={onChange}
    options={FLOW_VARIANT_ORDER.map((v) => ({
      value: v,
      label: FLOW_VARIANTS[v].label,
      title:
        v === "two"
          ? "Only Plots 1 and 2 unlocked: the same farms, with Plot 3's work done on Plot 1. Your progress here is saved separately."
          : "All three plots unlocked. Your progress here is saved separately.",
    }))}
  />
);

/** The Guide: the chosen flow version's dashboard, remounted from scratch when the version changes. */
export const GuidePage: React.FC = () => {
  const [variant, setVariant] = useState<FlowVariant>(() => LocalStorageManager.loadGuideVariant());
  const choose = useCallback((next: FlowVariant) => {
    LocalStorageManager.saveGuideVariant(next);
    setVariant(next);
  }, []);
  return <GuideBoard key={variant} variant={variant} onVariant={choose} />;
};

const GuideBoard: React.FC<{ variant: FlowVariant; onVariant: (variant: FlowVariant) => void }> = ({ variant, onVariant }) => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<GuideState | null>(null);
  const [precision, setPrecision] = useState<Precision>("quick");
  const [open, setOpen] = useState<Open>(null);
  const navigate = useNavigate();
  // Plots skipped this visit and what each still needs (the saved state can't tell a skip from a confirm).
  const [skippedStore, setSkippedStore] = useState<SkippedPlots>(() => loadSkipped(variant));
  const setSkipped = useCallback(
    (fn: (s: SkippedPlots) => SkippedPlots) =>
      setSkippedStore((s) => {
        const next = fn(s);
        saveSkipped(variant, next);
        return next;
      }),
    [variant]
  );

  useEffect(() => {
    let cancelled = false;
    loadShippedFlow(variant)
      .then((flow) => {
        if (cancelled) return;
        const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);
        const restored = load(flow, catalog, variant);
        setLoaded({ flow, catalog });
        setState(restored.state);
        setPrecision(restored.precision);
      })
      .catch((error: unknown) => !cancelled && setLoadError(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [variant]);

  // Persist: debounced while typing, and flushed when the page is hidden, closed or switched to the other flow.
  const latest = useRef<{ state: GuideState; precision: Precision } | null>(null);
  useEffect(() => {
    if (!state) return;
    latest.current = { state, precision };
    const timer = setTimeout(() => LocalStorageManager.saveGuideState(toStored(state, precision), variant), 300);
    return () => clearTimeout(timer);
  }, [state, precision, variant]);
  useEffect(() => {
    const flush = () => latest.current && LocalStorageManager.saveGuideState(toStored(latest.current.state, latest.current.precision), variant);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [variant]);

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

  // Whole-flow totals: simulated runs of the flow from an empty start, with the player's schedule
  // and stats. Remembered per flow version and settings; a separate small pool, so they never cancel
  // (or wait behind) the check-in's own forecast.
  const marks = useMemo(() => (flow ? scriptMarks(flow) : {}), [flow]);
  const totalsKey = useMemo(
    () => (flow && settled ? JSON.stringify([flowFingerprint(flow), settled.settings.activity, settled.settings.playerStats, TOTALS_SEEDS.length]) : null),
    [flow, settled]
  );
  const [baseline, setBaseline] = useState<{ key: string; runs: number; totals: Record<string, number> } | null>(() => LocalStorageManager.loadGuideFlowTotals(variant));
  const [forecastRuns, setForecastRuns] = useState<{ runs: RunTimeline[]; inventory: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!flow || !catalog || !settled || !totalsKey || baseline?.key === totalsKey) return;
    const pool = new GuidePool(Math.min(2, poolSize()));
    let live = true;
    const empty = toInput(initialState(flow, settled.settings));
    pool
      .forecast({ flow, input: empty, seeds: TOTALS_SEEDS })
      .then((runs) => {
        if (!live) return;
        const next = { key: totalsKey, runs: runs.length, totals: baselineTotals(runs, catalog) };
        LocalStorageManager.saveGuideFlowTotals(next, variant);
        setBaseline(next);
      })
      .catch(() => {})
      .finally(() => pool.dispose());
    return () => {
      live = false;
      pool.dispose();
    };
    // `settled` only matters through totalsKey (its schedule and stats).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, catalog, totalsKey, variant]);
  const needs = useMemo(
    () =>
      catalog
        ? flowNeeds(baseline?.key === totalsKey ? baseline.totals : null, forecastRuns?.runs ?? null, catalog, forecastRuns?.inventory ?? {}, marks, baseline?.runs ?? 0)
        : null,
    [catalog, baseline, totalsKey, forecastRuns, marks]
  );

  // Re-render "updated 4 min ago" now and then.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

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
            setForecastRuns({ runs: timelines, inventory: forecastInput.inventory });
          }
        },
      })
      .then((runs) => {
        if (!live) return;
        setForecast(summarise(runs, forecastInput.inventory));
        setPlan(buildPlan(runs));
        setForecastRuns({ runs, inventory: forecastInput.inventory });
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
        LocalStorageManager.saveGuideState(toStored(next, precision), variant);
        return next;
      }),
    [precision, variant]
  );
  const update = useCallback((fn: (s: GuideState) => GuideState) => setState((s) => (s ? fn(s) : s)), []);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 py-10">
        <p className="rounded-container border border-problem/30 bg-problem/10 p-4 text-body text-problem" role="alert">
          {loadError}
        </p>
        <div className="flex justify-center">
          <VariantSwitch value={variant} onChange={onVariant} />
        </div>
      </div>
    );
  }
  if (!flow || !catalog || !state) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading">
        <LoaderCircle className="size-6 animate-spin text-fg-meta motion-reduce:animate-none" aria-hidden />
      </div>
    );
  }
  const plotCount = catalog.plots.length;
  const plotsWord = COUNT_WORDS[plotCount] ?? String(plotCount);

  // The cards use the settled state's decisions; a plot confirmed since then shows as done at once.
  const knobs = scriptKnobs(flow);
  const outcomeFor = (plotId: number) => (state.plots[plotId]?.acted ? null : (outcomes.find((o) => o.plotId === plotId && o.from === state.plots[plotId]?.farm) ?? null));
  const nextPlot = catalog.plots.find((id) => !state.plots[id]?.acted);
  const stale = settled !== state;
  const goalState = goalProgress(catalog, state.inventory);
  const tracked = Object.values(state.inventory).filter((n) => n > 0).length;
  const lastImport = state.lastImport?.appliedAt !== undefined ? state.lastImport : undefined;
  const confirmedSinceImport = lastImport ? Object.keys(state.confirmations).filter((id) => Object.keys(state.confirmations[Number(id)].delta).length > 0).length : 0;
  const checked = catalog.plots.filter((id) => state.plots[id]?.acted);
  const skipped = liveSkipped(skippedStore, (id) => !!state.plots[id]?.acted && !!state.confirmations[id]);
  /** "7 Dead Plant", "7 Dead Plant and 2 Fermento" (what a supplies card was short of). */
  const needText = (outcome: PlotOutcome | null) => (outcome?.supplyBlock?.need ?? []).map((b) => `${b.count} ${itemName(data, b.item)}`).join(" and ");
  const simulatorHandoff = () =>
    navigate("/simulator", {
      state: {
        incomingScenario: { scenario: simulatorScenario(flow, toInput(state)), name: plotCount === 2 ? "the two-plot Rose Dragon flow" : "the Rose Dragon flow" },
      } satisfies SimulatorScenarioHandoff,
    });
  const simulatorTitle = `Load all ${plotsWord} plots' flows and scripts into the Simulator, starting from your farms and what you own now`;
  // What the plots grew since last visit: the farms they stood on before this visit's confirmations
  // (empty farmland grows Lonelilies), then the farms they're on now.
  const harvestable = catalog.plots.flatMap((id) => {
    const before = state.confirmations[id]?.before.farm;
    const farms = before && before !== state.plots[id].farm ? [before, state.plots[id].farm] : [state.plots[id].farm];
    return farms.flatMap((farm) => {
      try {
        return farmOf(catalog, id, farm).products.map((p) => p.item);
      } catch {
        return [];
      }
    });
  });
  const schedule = scheduleText(state.checkEvery, state.settings.activity);

  return (
    <div className="guide-root @container w-full space-y-3 overflow-x-clip py-3 sm:py-4">
      {/* Title, how-to hint, flow version; the Simulator hand-off and "how you play" on the right. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-hero text-fg">Rose Dragon Guide</h1>
        <HowToHint plotCount={plotCount} loginOrder={loginOrder(catalog.plots)} />
        <VariantSwitch value={variant} onChange={onVariant} />
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <KitButton variant="ghost" size="md" className="max-sm:hidden" onClick={simulatorHandoff} title={simulatorTitle}>
            <FlaskConical /> Simulator
          </KitButton>
          <IconButton variant="ghost" size="md" className="sm:hidden" onClick={simulatorHandoff} title={simulatorTitle} aria-label="Open in the Simulator">
            <FlaskConical />
          </IconButton>
          <KitButton size="md" onClick={() => setOpen({ kind: "settings" })} aria-label={`How you play: online ${schedule}, your stats, forecast precision`} title="When you're online, your stats and the forecast precision">
            <SlidersHorizontal /> {state.checkEvery !== null ? `Every ${Number.isInteger(state.checkEvery) ? state.checkEvery : state.checkEvery.toFixed(1)} h` : schedule}
          </KitButton>
        </span>
      </header>

      <HowTo plotCount={plotCount} loginOrder={loginOrder(catalog.plots)} />

      {(problems.length > 0 || decideError) && (
        <div className="rounded-container border border-problem/30 bg-problem/10 p-3 text-body text-problem" role="alert">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {decideError && <p>{decideError}</p>}
        </div>
      )}

      {/* The status panel: the forecast (or Done), the whole flow, and what you own with its actions. */}
      <section className={cn(surface.card, "space-y-2 px-4 py-3")} aria-label="Status">
        {done ? (
          <div aria-label="Done" className="space-y-1">
            <h2 className="text-hero text-fg">You have everything for the Rose Dragon.</h2>
            <p className="text-body text-fg-body">
              Every legendary ingredient is in your inventory ({goalState.legendaries.items.map((g) => `${g.count}× ${itemName(data, g.item)}`).join(", ")})
              {goalState.others.total > 0 ? ", plus one of every other mutation" : ""}. Your plots are free for whatever comes next.
            </p>
          </div>
        ) : (
          <ForecastStrip forecast={forecast} plan={plan} progress={progress} error={forecastError} catalog={catalog} data={data} outcomes={outcomes} onOpenSettings={() => setOpen({ kind: "settings" })} />
        )}
        {/* One row while the column is 800px or more (1366 and 1024 windows): whole flow, then the stock (shrinks and truncates), then its fixed actions. */}
        <div className="flex flex-nowrap items-center gap-x-5 gap-y-2 border-t border-line pt-2 @max-[50rem]:flex-wrap">
          {!done && needs && <FlowNeedsPanel needs={needs} catalog={catalog} data={data} className="max-w-full shrink-0 @max-[50rem]:shrink" />}
          {tracked === 0 ? (
            <section className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2" aria-label="What you own">
              <span className="min-w-0 flex-1 basis-64 text-secondary text-fg-muted">
                <b className="font-semibold text-fg">Start by entering what you own.</b> Until then, the cards only use farms that cost nothing.
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                <KitButton size="md" onClick={() => setOpen({ kind: "import" })} title="Count what's in your sacks, ender chest and backpacks">
                  <RefreshCw /> Import from Hypixel
                </KitButton>
                <KitButton variant="primary" size="md" onClick={() => setOpen({ kind: "inventory", mode: "set" })}>
                  <Pencil /> Enter what I own
                </KitButton>
              </span>
            </section>
          ) : (
            <section className="flex min-w-0 flex-1 items-center gap-x-3 gap-y-2 @max-[50rem]:basis-full @max-[50rem]:flex-wrap" aria-label="What you own">
              <span
                className="min-w-0 flex-1 truncate text-secondary tabular-nums text-fg-muted @max-[50rem]:basis-full @max-[50rem]:whitespace-normal"
                title={`${goalState.legendaries.owned}/${goalState.legendaries.total} Rose Dragon legendaries · ${goalState.others.owned}/${goalState.others.total} one of each other mutation · ${tracked} items tracked`}
              >
                <b className="font-semibold text-fg">
                  {goalState.legendaries.owned}/{goalState.legendaries.total}
                </b>{" "}
                legendaries
                {goalState.others.total > 0 && (
                  <>
                    {" · "}
                    <b
                      className="font-semibold text-fg"
                      title={goalState.others.missing.length ? `Still missing one of: ${goalState.others.missing.map((g) => itemName(data, g.item)).join(", ")}` : "You have one of every other mutation"}
                    >
                      {goalState.others.owned}/{goalState.others.total}
                    </b>{" "}
                    one of each
                  </>
                )}{" "}
                · {tracked} tracked
                {lastImport && (
                  <span
                    className="text-fg-meta"
                    title={`Last Hypixel import: ${new Date(lastImport.appliedAt ?? lastImport.fetchedAt).toLocaleString()}${lastImport.profileName ? ` (${lastImport.username}, ${lastImport.profileName})` : ""}`}
                  >
                    {" "}
                    · imported {timeAgo(lastImport.appliedAt ?? lastImport.fetchedAt)}
                    {confirmedSinceImport > 0 && `, ${confirmedSinceImport} plot${confirmedSinceImport === 1 ? "" : "s"} confirmed since`}
                  </span>
                )}
              </span>
              <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
                <KitButton
                  size="md"
                  onClick={() => setOpen({ kind: "import" })}
                  title={lastImport ? `Look ${lastImport.username} up again and see what changed since ${timeAgo(lastImport.appliedAt ?? lastImport.fetchedAt)}` : "Set your totals from your sacks, ender chest and backpacks"}
                >
                  <RefreshCw /> {lastImport ? "Import again" : "Import"}
                </KitButton>
                <KitButton variant="ghost" size="md" onClick={() => setOpen({ kind: "inventory", mode: "set" })} title="Correct the totals in your inventory">
                  <Pencil /> Edit
                </KitButton>
                {!done && (
                  <KitButton size="md" onClick={() => setOpen({ kind: "inventory", mode: "add" })} title="Type what you just harvested; it's added to what you have">
                    <Plus /> Add harvest
                  </KitButton>
                )}
              </span>
            </section>
          )}
        </div>
      </section>

      {!done && allActed(state) && (
        <section className={cn(surface.card, "flex flex-wrap items-center justify-between gap-3 px-4 py-3")} aria-label="This visit">
          <p className="text-body text-fg-body">
            <b className="font-semibold text-fg">
              {Object.keys(skipped).length > 0 ? `All ${plotsWord} plots are done or skipped for this visit.` : `All ${plotsWord} plots are done for this visit.`}
            </b>{" "}
            Next time you're online, harvest, then press Next check-in.
          </p>
          <KitButton
            variant="primary"
            size="md"
            onClick={() => {
              commit(startNewCheckIn);
              setSkipped(() => ({}));
              setOpen({ kind: "inventory", mode: "add" });
            }}
          >
            <RefreshCw /> Next check-in
          </KitButton>
        </section>
      )}

      {/* The one progress element: this visit, plot by plot. */}
      {!done && !allActed(state) && (
        <ol className="flex min-w-0 flex-wrap items-center gap-1" aria-label="This visit">
          {catalog.plots.map((id, i) => {
            const isSkipped = id in skipped;
            const isDone = checked.includes(id) && !isSkipped;
            return (
              <li key={id} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden className="h-px w-3 bg-line-control" />}
                <span
                  aria-current={id === nextPlot ? "step" : undefined}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-control border px-2 text-secondary",
                    isDone || isSkipped ? "border-line text-fg-meta" : id === nextPlot ? "border-select/60 bg-select/10 text-select-fg" : "border-line-strong text-fg-muted",
                    isSkipped && "border-dashed",
                  )}
                >
                  {isDone && <Check aria-hidden className="size-3" />}
                  {isSkipped && <SkipForward aria-hidden className="size-3" />}Plot {id}
                  {isSkipped && <span className="sr-only"> (skipped)</span>}
                </span>
              </li>
            );
          })}
          <li className="ml-2 text-secondary tabular-nums text-fg-meta">
            {checked.length - Object.keys(skipped).length} of {plotCount} done
            {Object.keys(skipped).length > 0 && ` · ${Object.keys(skipped).length} skipped`}
            {nextPlot !== undefined && checked.length > 0 ? ` · next: Plot ${nextPlot}` : ""}
          </li>
        </ol>
      )}

      {!done && (
        <div className={cn("grid min-w-0 grid-cols-1 gap-3", plotCount === 2 ? "@min-[52rem]:grid-cols-2" : "@min-[52rem]:grid-cols-3", stale && "opacity-80 transition-opacity motion-reduce:transition-none")}>
          {catalog.plots.map((plotId) => {
            const plot = state.plots[plotId];
            const outcome = outcomeFor(plotId);
            if (!plot.acted && !outcome) {
              return (
                <div key={plotId} className={cn(surface.card, "flex min-h-48 items-center justify-center text-secondary text-fg-meta")}>
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
                onConfirm={(extras) => {
                  if (!outcome) return;
                  commit((s) => confirmPlot(s, outcome, extras));
                  setSkipped((s) => {
                    const next = { ...s };
                    delete next[plotId];
                    return next;
                  });
                }}
                onSkip={() => {
                  const need = needText(outcome);
                  commit((s) => skipPlot(s, plotId));
                  setSkipped((s) => ({ ...s, [plotId]: need }));
                }}
                onUndo={() => {
                  commit((s) => undoPlot(s, plotId));
                  setSkipped((s) => {
                    const next = { ...s };
                    delete next[plotId];
                    return next;
                  });
                }}
                onPickFarm={() => setOpen({ kind: "farm", plotId })}
                onDevourerRefresh={(on) =>
                  commit((s) => setFacts(s, plotId, { ...(s.plots[plotId].facts ?? emptyFacts()), devourerRefresh: on }))
                }
                onOpenInventory={() => setOpen({ kind: "inventory", mode: "add" })}
                needs={needs}
                inventory={state.inventory}
                visitPlots={catalog.plots}
                checked={checked}
                skipped={plot.acted ? skipped[plotId] : undefined}
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
        harvestable={harvestable}
        onChange={(item, amount) => update((s) => setItem(s, item, amount))}
        onClose={() => {
          commit((s) => s);
          setOpen(null);
        }}
      />
      <ImportDialog
        open={open?.kind === "import"}
        inventory={state.inventory}
        catalog={catalog}
        data={data}
        lastImport={state.lastImport}
        onApply={(changes, record) => commit((s) => ({ ...applyImportedItems(s, changes), lastImport: record }))}
        onLookup={(record) => commit((s) => ({ ...s, lastImport: record }))}
        onClose={() => setOpen(null)}
      />
      <SettingsDialog
        open={open?.kind === "settings"}
        settings={state.settings}
        checkEvery={state.checkEvery}
        precision={precision}
        onChange={(settings, checkEvery) => commit((s) => withSettings(s, settings, checkEvery))}
        onPrecision={setPrecision}
        onReset={() => {
          LocalStorageManager.clearGuideState(variant);
          setSkipped(() => ({}));
          latest.current = null;
          setState(initialState(flow, guideDefaultSettings()));
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
            setSkipped((s) => {
              const next = { ...s };
              delete next[open.plotId];
              return next;
            });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
};
