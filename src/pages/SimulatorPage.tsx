import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Download, FolderInput, Pencil, Trash2, Trophy, Upload } from "lucide-react";
import { useToast } from "../components/ui";
import { Tabs } from "../components/ui/kit";
import { MenuItem, MenuSeparator } from "../components/ui/Popover";
import { surface } from "../components/ui/surface";
import { LayoutPickerDialog } from "../components/simulator/LayoutPicker";
import { MoneyPanel, SustainabilityPanel } from "../components/simulator/ReportPanels";
import { EarningsPanel } from "../components/simulator/EarningsPanel";
import { EffortPanel } from "../components/simulator/EffortPanel";
import { FrequencyPanel } from "../components/simulator/frequency/FrequencyPanel";
import { EventLog, FlowTimeline } from "../components/simulator/RunPanels";
import { PlotView } from "../components/simulator/PlotView";
import { FlowGraphEditor } from "../components/simulator/flowgraph/FlowGraphEditor";
import { engineKey, withoutEditorUi } from "../components/simulator/flowgraph/model";
import { changedAdvancedSettings } from "../components/simulator/page/pageHelpers";
import { FromNothingBanner, FromNothingPreparing } from "../components/simulator/FromNothingBanner";
import { previewScenarioOf, useFromNothingPreview, withPreviewSeed } from "../components/simulator/fromNothingPreview";
import { addPlot, duplicatePlot, importFlows, isBlankScenario, nextPlotId, placeLayout, removePlot, type LayoutDestination } from "../components/simulator/scenarioEdit";
import { spotFailureText } from "../components/simulator/format";
import { CommandBar, ShareMenuItems, type PageProblem } from "../components/simulator/page/CommandBar";
import { KpiCompact, KpiStrip } from "../components/simulator/page/KpiStrip";
import { MobileChips, MobileRunBar } from "../components/simulator/page/Mobile";
import { PlotsRow } from "../components/simulator/page/PlotsRow";
import { plotUptime } from "../components/simulator/page/plotUptime";
import { ScenarioTab } from "../components/simulator/page/ScenarioTab";
import { SettingsDrawer, type DrawerTab } from "../components/simulator/page/SettingsDrawer";
import { useShare } from "../components/simulator/page/useShare";
import { applyRules, boardFrom, type Board, type RuleKind } from "../leaderboard/rules";
import { getFlow } from "../services/flowsService";
import { ScriptEditor } from "../components/simulator/script/ScriptEditor";
import { ScriptHaltBanner, ScriptPanel } from "../components/simulator/script/ScriptPanel";
import type { ScriptTarget } from "../components/simulator/script/scriptEdit";
import { BazaarMoneyPanel } from "../components/simulator/BazaarPanels";
import { InventoryTable } from "../components/simulator/InventoryTable";
import { bazaarProfit } from "../components/simulator/bazaarFormat";
import { useSimulation } from "../hooks/useSimulation";
import { useBazaarPrices } from "../hooks/useBazaarPrices";
import { useProfileMode } from "../hooks/useProfileMode";
import { DEFAULT_CONFIG, DEFAULT_POLICIES, defaultSettings, MAX_PLOTS, migrateScenario, scenarioFromShareCodes, type ProfileMode, type RunSummary, type Scenario } from "../simulator";
import { extractLayoutCode, LocalStorageManager, readIncomingLayout, readIncomingScenario, SOURCE_LABEL, type IncomingLayout } from "../utilities";

type ResultTab = "overview" | "inventory" | "sustain" | "timeline" | "events" | "scripts";
const TAB_KEY = "skyshards-simulator-tab";
const RESULT_TABS: readonly ResultTab[] = ["overview", "inventory", "sustain", "timeline", "events", "scripts"];
/** Migrates a saved scenario and fills missing settings from the defaults. */
function withDefaults(saved: Scenario): Scenario {
  const sc = migrateScenario(saved);
  const base = defaultSettings();
  return {
    ...sc,
    startingInventory: sc.startingInventory ?? {},
    settings: {
      ...base,
      ...sc.settings,
      playerStats: { ...base.playerStats, ...sc.settings?.playerStats },
      policies: { ...DEFAULT_POLICIES, ...sc.settings?.policies, gateInteractions: { ...DEFAULT_POLICIES.gateInteractions, ...sc.settings?.policies?.gateInteractions } },
      config: { ...DEFAULT_CONFIG, ...sc.settings?.config },
    },
  };
}

function initialScenario(params: URLSearchParams): Scenario {
  const fromUrl = ["p1", "p2", "p3"].map((k) => params.get(k)).filter((c): c is string => !!c).map(extractLayoutCode);
  if (fromUrl.length) return scenarioFromShareCodes(fromUrl);
  const saved = LocalStorageManager.loadSimulatorScenario();
  if (saved) return withDefaults(saved);
  return addPlot({ plots: [], startingInventory: {}, settings: defaultSettings() });
}

/** Debounces scenario edits so typing doesn't restart the simulation on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * The scenario the engine runs: the profile mode is a site-wide setting, not part of the saved
 * scenario, so it is applied here. Ironman drops the key, keeping old runs byte-identical.
 */
function withProfile(sc: Scenario, profile: ProfileMode): Scenario {
  const { profile: _saved, ...settings } = sc.settings;
  void _saved;
  return profile === "normal" ? { ...sc, settings: { ...settings, profile } } : { ...sc, settings };
}

/** The current time, refreshed every `ms` (null: never). */
function useNow(ms: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const SimulatorPage: React.FC = () => {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [scenario, setScenario] = useState<Scenario>(() => initialScenario(params));
  const [editing, setEditing] = useState<{ plotId: number; step: number } | null>(null);
  const editingPlot = editing?.plotId ?? null;
  const setEditingPlot = (plotId: number | null) => setEditing(plotId === null ? null : { plotId, step: 0 });
  // Results tab (remembered), settings drawer, and the plot whose layout "Replace" is picking for.
  const [tab, setTabState] = useState<ResultTab>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(TAB_KEY) : null;
    return RESULT_TABS.includes(saved as ResultTab) ? (saved as ResultTab) : "overview";
  });
  const setTab = (t: ResultTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Private mode: the tab just isn't remembered.
    }
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("player");
  const [replacing, setReplacing] = useState<number | null>(null);
  // The results tab bar sticks right under the command bar, whatever its height.
  const barRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(96);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A layout handed over by a Simulate button on another page.
  const [incoming, setIncoming] = useState<IncomingLayout | null>(() => readIncomingLayout(location.state));
  const [picking, setPicking] = useState(false);
  /** Sanity Check inspector: hovering an empty cell or slot shows which mutations could spawn there. */
  const [sanityCheckOn, setSanityCheckOn] = useState(false);
  // Legend entries drawn on the hovered grid element, per plot (the legend highlights their union).
  const [hoverMarkers, setHoverMarkers] = useState<Record<number, string[]>>({});
  const onHoverMarkers = useCallback((plotId: number, keys: string[]) => {
    setHoverMarkers((prev) => {
      const old = prev[plotId] ?? [];
      if (old.length === keys.length && old.every((k, i) => k === keys[i])) return prev;
      return { ...prev, [plotId]: keys };
    });
  }, []);
  const legendHighlight = useMemo(() => [...new Set(Object.values(hoverMarkers).flat())], [hoverMarkers]);
  /** Script editor overlay: which script is open. */
  const [scripting, setScripting] = useState<ScriptTarget | null>(null);
  // Ironman / normal profile: a site-wide setting (localStorage), applied to the scenario the engine runs.
  const [profile, setProfile] = useProfileMode();
  const bazaar = useBazaarPrices(profile === "normal");
  /** Re-renders the price age once a minute. */
  const now = useNow(profile === "normal" ? 60_000 : null);
  const debounced = useDebounced(scenario, 300);
  // What the engine runs: editor-only data (flow editor positions, notes, frames) stripped, and
  // the same object while nothing the engine reads changed, so moving a node never restarts a run.
  const engineCache = useRef<{ key: string; scenario: Scenario } | null>(null);
  const settled = useMemo(() => {
    const key = engineKey(debounced);
    if (engineCache.current?.key !== key) engineCache.current = { key, scenario: withoutEditorUi(debounced) };
    return engineCache.current.scenario;
  }, [debounced]);
  // "Watch from nothing": runs the builder / the flow from its starting items instead of the user's
  // scenario, which stays as it is (and saved) underneath.
  const fromNothing = useFromNothingPreview(scenario);
  const preview = fromNothing.preview;
  const previewScenario = useMemo(() => (preview ? previewScenarioOf(preview) : null), [preview]);
  const engineScenario = useMemo(() => withProfile(previewScenario ?? settled, previewScenario ? "ironman" : profile), [previewScenario, settled, profile]);
  const { view, run, step, stepBack, undo, stop, reset, addItems } = useSimulation(engineScenario);
  /** Live Bazaar quotes with the user's manual prices on top. */
  const quotes = bazaar.quotes;
  /** Normal profile: the run bar's profit at Bazaar prices. */
  const priceSummary = useMemo(
    () => (profile === "normal" ? (s: RunSummary) => bazaarProfit(s, quotes, bazaar.pricing) : undefined),
    [profile, quotes, bazaar.pricing]
  );

  // Saved with the editor data (node positions, notes, frames).
  useEffect(() => {
    LocalStorageManager.saveSimulatorScenario(debounced);
  }, [debounced]);

  /** The router state already loaded, so a re-run effect (StrictMode) doesn't load it twice. */
  const handledState = useRef<unknown>(null);
  // Clear the handoff from the history entry so a reload or Back doesn't offer it again.
  useEffect(() => {
    const whole = readIncomingScenario(location.state);
    if (whole) {
      if (handledState.current === location.state) return;
      handledState.current = location.state;
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
      let next: Scenario;
      try {
        next = withDefaults(whole.scenario as Scenario);
      } catch (error) {
        toast({ title: "Could not load the flow", description: error instanceof Error ? error.message : String(error), variant: "error" });
        return;
      }
      let before: Scenario | null = null;
      setScenario((sc) => {
        before = sc;
        return next;
      });
      setEditing(null);
      toast({
        id: "simulator-scenario-loaded",
        title: `Loaded ${whole.name}`,
        description: `${next.plots.length} plot${next.plots.length === 1 ? "" : "s"}, starting from where you are now.`,
        variant: "success",
        duration: 6000,
        action: { label: "Undo", onClick: () => before && setScenario(before) },
      });
      return;
    }
    const fresh = readIncomingLayout(location.state);
    if (!fresh) return;
    setIncoming(fresh);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate, toast]);

  // `?flow=ID[&board=B]`: open a leaderboard entry under that board's rules (without a board, the
  // site profile's: ironman = from nothing), online every cycle, a random seed; then strip the
  // parameters so a reload doesn't load it again.
  const flowParam = params.get("flow");
  const boardParam = boardFrom(params.get("board"));
  const handledFlow = useRef<string | null>(null);
  const scenarioRef = useRef(scenario);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);
  useEffect(() => {
    if (!flowParam || handledFlow.current === flowParam) return;
    handledFlow.current = flowParam;
    const rest = new URLSearchParams(location.search);
    rest.delete("flow");
    rest.delete("board");
    const strip = () => navigate(`${location.pathname}${rest.size ? `?${rest}` : ""}`, { replace: true, state: location.state });
    const board: Board = boardParam ?? (profile === "normal" ? "normal" : "ironman");
    // Ironman entries open as they run with their starting items (the borrow set-up shows what they need); normal as normal.
    const rules: RuleKind = board === "normal" ? "normal" : "borrow";
    getFlow(flowParam)
      .then((detail) => {
        const before = scenarioRef.current;
        let next: Scenario;
        try {
          const imported = importFlows(before, JSON.stringify(detail.payload));
          const ruled = applyRules(imported, rules, 1, Math.floor(Math.random() * 2 ** 31));
          // The profile is site-wide; keep the scenario's own value.
          next = { ...ruled, settings: { ...ruled.settings } };
          if (before.settings.profile) next.settings.profile = before.settings.profile;
          else delete next.settings.profile;
        } catch (e) {
          strip();
          toast({ title: "Could not load the flow", description: e instanceof Error ? e.message : String(e), variant: "error" });
          return;
        }
        setScenario(next);
        // The board's profile is site-wide: switch the simulator's mode to match it.
        if ((board === "normal") !== (profile === "normal")) setProfile(board === "normal" ? "normal" : "ironman");
        strip();
        setEditing(null);
        toast({
          id: "simulator-flow-loaded",
          title: `Loaded ${detail.title} by ${detail.author.name}`,
          description: `Under the ${board === "normal" ? "Normal" : "Ironman, with the starting items"} rules: max stats, empty inventory, online every cycle, a random seed.`,
          variant: "success",
          duration: 8000,
          action: { label: "Undo", onClick: () => setScenario(before) },
        });
      })
      .catch((e: unknown) => {
        strip();
        toast({ title: "Could not load the flow", description: e instanceof Error ? e.message : String(e), variant: "error" });
      });
  }, [flowParam, boardParam, location.pathname, location.search, location.state, navigate, profile, setProfile, toast]);

  const place = (layout: IncomingLayout, dest: LayoutDestination) => {
    const before = scenario;
    const r = placeLayout(before, dest, { code: layout.code }, layout.name);
    setIncoming(null);
    setPicking(false);
    if (!r) {
      toast({ title: "Could not add the layout", description: "All three plots are in use.", variant: "warning" });
      return;
    }
    setScenario(r.scenario);
    const where =
      dest.kind === "appendStep" && !isBlankScenario(before) ? `Step ${r.stepIndex + 1} of Plot ${r.plotId}` : `Plot ${r.plotId}`;
    toast({
      id: "simulator-layout-placed",
      title: `Loaded into ${where}`,
      description: dest.kind === "appendStep" && !isBlankScenario(before) ? "Set when the plot should move on to it in the flow." : layout.name,
      variant: "success",
      duration: 6000,
      action: { label: "Undo", onClick: () => setScenario(before) },
    });
    if (dest.kind === "appendStep" && !isBlankScenario(before)) setEditing({ plotId: r.plotId, step: r.stepIndex });
    // Picked from inside the flow editor: it stays open on the plot that got the layout.
    else if (editing) setEditing({ plotId: r.plotId, step: 0 });
  };

  const loadMany = (codes: string[]) => {
    const before = scenario;
    setScenario(scenarioFromShareCodes(codes, scenario.settings));
    setPicking(false);
    toast({
      id: "simulator-layout-placed",
      title: `Loaded ${codes.length} plots`,
      description: "Uppercase cells are empty target slots; lowercase cells are planted.",
      variant: "success",
      duration: 6000,
      action: { label: "Undo", onClick: () => setScenario(before) },
    });
  };

  // The flow editor is a full-screen overlay; lock the page behind it.
  useEffect(() => {
    if (editingPlot === null && scripting === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editingPlot, scripting]);

  const snapshot = view.snapshot;
  const state = snapshot?.state;
  const plotIds = useMemo(() => state?.plots.map((p) => p.id) ?? [], [state]);
  const eventsFor = (plotId: number) => view.lastCycleEvents.filter((e) => e.plotId === plotId);
  const plotCount = (previewScenario ?? scenario).plots.length;

  // ---- Plot actions (⋯ menus, Add-plot tile, drawer Scenario tab) -------------------------------
  const duplicate = (plotId: number) => {
    const id = nextPlotId(scenario);
    if (id === null) return;
    const before = scenario;
    setScenario(duplicatePlot(scenario, plotId));
    toast({ id: "simulator-plot-duplicated", title: `Duplicated Plot ${plotId} as Plot ${id}`, description: "Same steps, layouts, exits, checked targets and policy overrides.", variant: "success", duration: 6000, action: { label: "Undo", onClick: () => setScenario(before) } });
  };
  const remove = (plotId: number) => {
    if (scenario.plots.length <= 1) return;
    const before = scenario;
    setScenario(removePlot(scenario, plotId));
    toast({ id: "simulator-plot-removed", title: `Removed Plot ${plotId}`, variant: "success", duration: 6000, action: { label: "Undo", onClick: () => setScenario(before) } });
  };
  const replaceLayout = (plotId: number) => {
    setReplacing(plotId);
    setPicking(true);
  };
  const plotMenu = (plotId: number) => (close: () => void) => (
    <>
      <MenuItem icon={<Pencil />} onSelect={() => (close(), setEditingPlot(plotId))}>
        Edit flow
      </MenuItem>
      <MenuItem icon={<FolderInput />} onSelect={() => (close(), replaceLayout(plotId))} hint="Its flow becomes this one layout">
        Replace with a layout…
      </MenuItem>
      <MenuItem icon={<Copy />} disabled={scenario.plots.length >= MAX_PLOTS} onSelect={() => (close(), duplicate(plotId))}>
        Duplicate plot
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} tone="danger" disabled={scenario.plots.length <= 1} onSelect={() => (close(), remove(plotId))}>
        Remove plot
      </MenuItem>
    </>
  );

  const share = useShare(scenario, setScenario, (every) => void fromNothing.start(every));

  // ---- Problems: scenario errors/warnings and the sustainability verdict --------------------------
  const goTab = (t: ResultTab) => {
    setTab(t);
    tabsRef.current?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  };
  const problems: PageProblem[] = [];
  const firstFailure = snapshot?.report.firstFailure;
  if (view.status === "error" && view.error && !view.issues.length) problems.push({ level: "error", where: "Scenario", message: view.error });
  for (const i of [...view.issues.filter((x) => x.level === "error"), ...view.warnings]) {
    const plot = /^Plot (\d+)/.exec(i.path);
    const stepM = /Step (\d+)/.exec(i.path);
    problems.push({
      level: i.level === "error" ? "error" : "warning",
      where: i.path,
      message: i.message,
      action: plot ? { label: stepM ? "Open step" : "Open flow", run: () => setEditing({ plotId: Number(plot[1]), step: stepM ? Number(stepM[1]) - 1 : 0 }) } : undefined,
    });
  }
  if (state?.summary.uptime && state.summary.uptime.requirements > 0) {
    problems.unshift({
      level: "unsustainable",
      where: "Not sustainable",
      message: firstFailure ? spotFailureText(firstFailure) : "A checked target sat empty without the requirements for its mutation.",
      action: { label: "Sustainability", run: () => goTab("sustain") },
    });
  }

  const changedSettings = changedAdvancedSettings(scenario.settings);
  const resultTabs: { value: ResultTab; label: string; count?: number | null }[] = [
    { value: "overview", label: "Overview" },
    { value: "inventory", label: state?.summary.market ? "Inventory & Bazaar" : "Inventory" },
    { value: "sustain", label: "Sustainability", count: state?.summary.uptime && state.summary.uptime.requirements > 0 ? 1 : null },
    { value: "timeline", label: "Timeline" },
    { value: "events", label: "Events" },
    ...(!preview ? [{ value: "scripts" as const, label: "Scripts" }] : []),
  ];

  const runProps = {
    onRun: run,
    onStep: step,
    onStepBack: stepBack,
    onUndo: undo,
    onStop: stop,
    onReset: reset,
  };

  return (
    <div className="w-full">
      {/* Sticky command bar + KPIs */}
      <header className="@container sticky top-0 z-30 rounded-b-xl border-b border-slate-700/50 bg-slate-950/85 backdrop-blur-xl backdrop-saturate-150" ref={barRef}>
        <CommandBar
          scenario={scenario}
          onChange={setScenario}
          view={view}
          profile={profile}
          onProfileChange={setProfile}
          {...runProps}
          seed={previewScenario ? previewScenario.settings.seed : scenario.settings.seed}
          onSeedChange={(seed) => (preview ? fromNothing.setPreview(withPreviewSeed(preview, seed)) : setScenario((sc) => ({ ...sc, settings: { ...sc.settings, seed } })))}
          changedSettings={changedSettings}
          onOpenSettings={(t) => {
            if (t) setDrawerTab(t as DrawerTab);
            setDrawerOpen(true);
          }}
          problems={problems}
          shareMenu={(close) => (
            <ShareMenuItems close={close} onExport={share.openExport} onImport={share.openImport} onSubmit={share.openSubmit} icons={{ dl: <Download />, ul: <Upload />, trophy: <Trophy /> }} />
          )}
          onWatchFromNothing={(every) => void fromNothing.start(every)}
          watching={fromNothing.preparing !== null || !!preview}
          preview={!!preview}
        />
        <div className="flex h-12 items-center gap-3 px-3 md:hidden">
          <span className="text-[13px] font-semibold text-slate-100">Simulator</span>
          <KpiCompact view={view} plotCount={plotCount} priceSummary={priceSummary} />
        </div>
        <KpiStrip view={view} plotCount={plotCount} priceSummary={priceSummary} />
        {view.status === "running" && view.progress && (
          <div className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden" aria-hidden>
            <div className="h-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" style={{ width: `${(view.progress.done / Math.max(1, view.progress.total)) * 100}%` }} />
          </div>
        )}
      </header>

      <div className="space-y-3 pt-4">
        {/* Phone: the frequent settings as a scroller */}
        <MobileChips scenario={scenario} onOpenSettings={(t) => (setDrawerTab(t), setDrawerOpen(true))} />

        {fromNothing.preparing !== null && <FromNothingPreparing progress={fromNothing.preparing} onCancel={fromNothing.exit} />}
        {preview && <FromNothingBanner preview={preview} inventory={state?.inventory ?? null} onPart={(part) => fromNothing.setPreview({ ...preview, part })} onExit={fromNothing.exit} />}
        {state?.scripts?.halt && (
          <ScriptHaltBanner
            halt={state.scripts.halt}
            onEdit={() => {
              const key = state.scripts!.halt!.script;
              setScripting(key === "global" ? "controller" : Number(key.replace("plot:", "")));
            }}
          />
        )}

        {state ? (
          <PlotsRow
            plots={state.plots}
            render={(plot) => (
              <PlotView
                plot={plot}
                runner={state.flows.find((f) => f.plotId === plot.id)}
                def={state.scenario.plots.find((p) => p.id === plot.id)}
                events={eventsFor(plot.id)}
                onEditFlow={preview ? undefined : () => setEditingPlot(plot.id)}
                menu={preview ? undefined : plotMenu(plot.id)}
                maxCell={52}
                fitHeight
                uptime={plotUptime(state, plot.id)}
                openDebts={Object.keys(state.openDebts)}
                cycleSeconds={state.lastCycleSeconds}
                config={state.scenario.settings.config}
                sanityState={sanityCheckOn ? state : undefined}
                onHoverMarkers={onHoverMarkers}
              />
            )}
            canAdd={!preview && scenario.plots.length < MAX_PLOTS}
            nextPlotNumber={nextPlotId(scenario) ?? scenario.plots.length + 1}
            onLoadLayout={() => setPicking(true)}
            onEmptyPlot={() => setScenario(addPlot(scenario))}
            normalProfile={!!state.summary.market}
            legendHighlight={legendHighlight}
            sanityOn={sanityCheckOn}
            onSanityToggle={() => setSanityCheckOn((on) => !on)}
          />
        ) : (
          <div className={`p-6 text-[12.5px] text-slate-400 ${surface.card}`}>
            {view.status === "error" ? "The scenario has errors: open Problems at the top." : "Setting up…"}
          </div>
        )}

        {/* Results */}
        <div ref={tabsRef} className="sticky z-20 border-b border-slate-700/50 bg-slate-950/90 px-1 backdrop-blur-xl" style={{ top: barHeight }}>
          <Tabs<ResultTab> value={tab} onChange={(t) => setTab(t)} items={resultTabs} className="!border-b-0 overflow-x-auto scrollbar-none" />
        </div>
        <div className="pb-[calc(6rem+var(--ad-bottom,0px))] pt-2 md:pb-10">
          {snapshot && state && tab === "overview" && (
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-5">
                <FrequencyPanel
                  scenario={engineScenario}
                  priceSummary={priceSummary}
                  onUseEvery={preview ? undefined : (n: number) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, activity: { kind: "everyN", n, offset: 0 } } }))}
                />
                <EarningsPanel summary={state.summary} quotes={state.summary.market ? quotes : null} pricing={state.summary.market ? bazaar.pricing : null} />
              </div>
              <div className="min-w-0 space-y-5">
                {state.summary.market ? (
                  <BazaarMoneyPanel summary={state.summary} previous={view.previousSummary} quotes={quotes} pricing={bazaar.pricing} cycleSeconds={state.lastCycleSeconds} />
                ) : (
                  <MoneyPanel summary={state.summary} previous={view.previousSummary} cycleSeconds={state.lastCycleSeconds} />
                )}
                <EffortPanel summary={state.summary} />
              </div>
            </div>
          )}
          {snapshot && state && tab === "inventory" && (
            <InventoryTable
              state={state}
              bazaar={state.summary.market ? { scenario, view: bazaar, now, onReserveChange: (reserve) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, reserve } })) } : undefined}
              onAddItems={addItems}
              busy={view.status === "running"}
              startingInventory={preview ? undefined : scenario.startingInventory}
              onStartingInventoryChange={preview ? undefined : (startingInventory) => setScenario((sc) => ({ ...sc, startingInventory }))}
            />
          )}
          {snapshot && state && tab === "sustain" && <SustainabilityPanel report={snapshot.report} summary={state.summary} />}
          {state && tab === "timeline" && (
            <FlowTimeline key={`${state.scenario.settings.seed}-${state.cycle === 0 ? "setup" : "run"}`} flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} elapsedSeconds={state.elapsedSeconds} />
          )}
          {state && tab === "events" && <EventLog log={view.log} plotIds={plotIds} />}
          {!preview && tab === "scripts" && <ScriptPanel scenario={scenario} state={state ?? null} onEdit={setScripting} />}
        </div>
      </div>

      {/* Phone: run controls at the thumb */}
      <MobileRunBar view={view} {...runProps} />

      <SettingsDrawer
        open={drawerOpen}
        tab={drawerTab}
        onTab={setDrawerTab}
        onClose={() => setDrawerOpen(false)}
        scenario={scenario}
        onChange={setScenario}
        cycleSecondsNow={state?.lastCycleSeconds}
        scenarioTab={
          <ScenarioTab
            scenario={scenario}
            onChange={setScenario}
            onEditFlow={setEditingPlot}
            onDuplicate={duplicate}
            onRemove={remove}
            onLoadLayout={() => setPicking(true)}
            issues={view.issues}
            warnings={view.warnings}
            error={view.status === "error" ? view.error : null}
            onExport={share.openExport}
            onImport={share.openImport}
            onSubmit={share.openSubmit}
          />
        }
      />
      {share.dialogs}

      {editingPlot !== null && scenario.plots.some((p) => p.id === editingPlot) && (
        <FlowGraphEditor
          scenario={scenario}
          plotId={editingPlot}
          initialStep={editing!.step}
          onChange={setScenario}
          onSwitchPlot={(plotId) => setEditing({ plotId, step: 0 })}
          onClose={() => setEditingPlot(null)}
          onEditScript={(target) => setScripting(target)}
          onLoadLayout={() => setPicking(true)}
        />
      )}

      {scripting !== null && (scripting === "controller" || scenario.plots.some((p) => p.id === scripting)) && (
        <div className="fixed inset-0 z-[45] bg-slate-950/85 backdrop-blur-sm overflow-y-auto scrollbar-dark" style={{ bottom: "var(--ad-bottom, 0px)" }} role="dialog" aria-modal="true" aria-label="Script editor">
          <div className="w-full max-w-screen-2xl mx-auto px-2 sm:px-4 py-6">
            <div className="bg-slate-900 rounded-lg shadow-2xl">
              <ScriptEditor
                scenario={scenario}
                target={scripting}
                onTargetChange={setScripting}
                onChange={setScenario}
                onClose={() => setScripting(null)}
                halt={state?.scripts?.halt ?? null}
              />
            </div>
          </div>
        </div>
      )}

      {(incoming || picking) &&
        (replacing !== null && !incoming ? (
          <LayoutPickerDialog
            title={`Replace Plot ${replacing}'s flow with a layout`}
            useLabel={`Replace Plot ${replacing}`}
            onUse={(picked) => {
              place(picked, { kind: "replacePlot", plotId: replacing });
              setReplacing(null);
            }}
            onClose={() => {
              setPicking(false);
              setReplacing(null);
            }}
          />
        ) : (
          <LayoutPickerDialog
            title={incoming ? `${SOURCE_LABEL[incoming.from]}: add it to the simulation` : "Load a layout"}
            incoming={incoming}
            scenario={scenario}
            onPlace={place}
            onLoadMany={loadMany}
            onClose={() => {
              setIncoming(null);
              setPicking(false);
            }}
          />
        ))}
    </div>
  );
};
