import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, ScanSearch } from "lucide-react";
import { InfoHint, SegmentedControl, useToast } from "../components/ui";
import { LayoutPickerDialog } from "../components/simulator/LayoutPicker";
import { MoneyPanel, SustainabilityPanel } from "../components/simulator/ReportPanels";
import { EventLog, RunControls, FlowTimeline } from "../components/simulator/RunPanels";
import { PlotMarkLegend, PlotView } from "../components/simulator/PlotView";
import { buttonClass } from "../components/simulator/styles";
import { FlowEditor } from "../components/simulator/FlowEditor";
import { ScenarioPanel, SettingsPanel } from "../components/simulator/ScenarioPanels";
import { addPlot, isBlankScenario, placeLayout, type LayoutDestination } from "../components/simulator/scenarioEdit";
import { ScriptEditor } from "../components/simulator/script/ScriptEditor";
import { ScriptHaltBanner, ScriptPanel } from "../components/simulator/script/ScriptPanel";
import type { ScriptTarget } from "../components/simulator/script/scriptEdit";
import { BazaarMoneyPanel } from "../components/simulator/BazaarPanels";
import { InventoryTable } from "../components/simulator/InventoryTable";
import { bazaarProfit } from "../components/simulator/bazaarFormat";
import { useSimulation } from "../hooks/useSimulation";
import { useBazaarPrices } from "../hooks/useBazaarPrices";
import { useProfileMode } from "../hooks/useProfileMode";
import { DEFAULT_CONFIG, DEFAULT_POLICIES, defaultSettings, migrateScenario, scenarioFromShareCodes, type ProfileMode, type RunSummary, type Scenario } from "../simulator";
import { extractLayoutCode, LocalStorageManager, readIncomingLayout, readIncomingScenario, SOURCE_LABEL, type IncomingLayout } from "../utilities";

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

const ALL = "all";

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
  const [focus, setFocus] = useState<string>(ALL);
  // A layout handed over by a Simulate button on another page.
  const [incoming, setIncoming] = useState<IncomingLayout | null>(() => readIncomingLayout(location.state));
  const [picking, setPicking] = useState(false);
  /** Sanity Check inspector: hovering an empty cell or slot shows which mutations could spawn there. */
  const [sanityCheckOn, setSanityCheckOn] = useState(false);
  /** Script editor overlay: which script is open. */
  const [scripting, setScripting] = useState<ScriptTarget | null>(null);
  // Ironman / normal profile: a site-wide setting (localStorage), applied to the scenario the engine runs.
  const [profile, setProfile] = useProfileMode();
  const bazaar = useBazaarPrices(profile === "normal");
  /** Re-renders the price age once a minute. */
  const now = useNow(profile === "normal" ? 60_000 : null);
  const settled = useDebounced(scenario, 300);
  const engineScenario = useMemo(() => withProfile(settled, profile), [settled, profile]);
  const { view, run, step, stepBack, undo, stop, reset, addItems } = useSimulation(engineScenario);
  /** Live Bazaar quotes with the user's manual prices on top. */
  const quotes = bazaar.quotes;
  /** Normal profile: the run bar's profit at Bazaar prices. */
  const priceSummary = useMemo(
    () => (profile === "normal" ? (s: RunSummary) => bazaarProfit(s, quotes, bazaar.pricing) : undefined),
    [profile, quotes, bazaar.pricing]
  );

  useEffect(() => {
    LocalStorageManager.saveSimulatorScenario(settled);
  }, [settled]);

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
      setFocus(ALL);
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
    setFocus(ALL);
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
  const focused = focus !== ALL && plotIds.includes(Number(focus)) ? Number(focus) : null;
  const shownPlots = state?.plots.filter((p) => focused === null || p.id === focused) ?? [];
  const cols = focused !== null ? "grid-cols-1" : shownPlots.length >= 3 ? "grid-cols-1 lg:grid-cols-3" : shownPlots.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1";

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-2xl space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-emerald-400" />
        <h1 className="text-sm font-medium text-slate-200">Greenhouse Simulator</h1>
        <InfoHint title="What this tool does" width={320}>
          It runs the scenario you enter forward in time, cycle by cycle, and reports what it earns and whether it ever needs an item it does not have. It
          never generates, ranks or fixes layouts. Mutations like Chorus Fruit wander and every spawn is a dice roll, so there is no closed form: the
          answer has to be simulated.
        </InfoHint>
        <span className="text-xs text-slate-500 hidden md:inline">Evaluates one scenario. Step and Run use the same engine.</span>
        <div className="flex items-center gap-2 ml-auto">
          <SegmentedControl
            size="xs"
            nowrap
            value={profile}
            onChange={setProfile}
            options={[
              { value: "ironman", label: "Ironman", title: "No Bazaar: every item comes from your own harvests" },
              { value: "normal", label: "Normal", tone: "blue", title: "Buys what a layout is short of and sells surplus mutations on the Bazaar" },
            ]}
          />
          <InfoHint title="Profile mode" width={300}>
            Ironman (the default) has no Bazaar: placements come from your own harvests, and a missing item leaves its cell empty. Normal profile buys
            whatever a placement is short of and sells surplus mutation items after every online session, priced live from the Hypixel Bazaar. Your
            choice is remembered in this browser for the whole site.
          </InfoHint>
        </div>
      </div>

      <RunControls
        view={view}
        plotCount={scenario.plots.length}
        onRun={run}
        onStep={step}
        onStepBack={stepBack}
        onUndo={undo}
        onStop={stop}
        onReset={reset}
        seed={scenario.settings.seed}
        onSeedChange={(seed) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, seed } }))}
        priceSummary={priceSummary}
      />
      {state?.scripts?.halt && (
        <ScriptHaltBanner
          halt={state.scripts.halt}
          onEdit={() => {
            const key = state.scripts!.halt!.script;
            setScripting(key === "global" ? "controller" : Number(key.replace("plot:", "")));
          }}
        />
      )}

      <div className="space-y-4 min-w-0">
          {state ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {plotIds.length > 1 && (
                  <SegmentedControl
                    size="xs"
                    className="max-w-md flex-1 min-w-[16rem]"
                    value={focused === null ? ALL : String(focused)}
                    onChange={setFocus}
                    options={[{ value: ALL, label: "All plots" }, ...plotIds.map((id) => ({ value: String(id), label: `Plot ${id}` }))]}
                  />
                )}
                <div className="flex items-center gap-2 ml-auto">
                  {sanityCheckOn && <span className="text-xs text-slate-500 hidden sm:inline">Hover an empty cell or target slot.</span>}
                  <button
                    type="button"
                    className={`${sanityCheckOn ? buttonClass.primary : buttonClass.neutral} flex-shrink-0`}
                    aria-pressed={sanityCheckOn}
                    onClick={() => setSanityCheckOn((on) => !on)}
                    title="Hover an empty cell or target slot to see which mutations could spawn there now, and why the others can't"
                  >
                    <ScanSearch className="w-3 h-3" />
                    Sanity Check
                  </button>
                </div>
              </div>
              <div className={`grid gap-3 ${cols}`}>
                {shownPlots.map((plot) => (
                  <div key={plot.id} className={focused !== null ? "max-w-[720px] w-full mx-auto" : ""}>
                    <PlotView
                      plot={plot}
                      runner={state.flows.find((f) => f.plotId === plot.id)}
                      def={state.scenario.plots.find((p) => p.id === plot.id)}
                      events={eventsFor(plot.id)}
                      onEditFlow={() => setEditingPlot(plot.id)}
                      maxCell={focused !== null ? 72 : 52}
                      openDebts={Object.keys(state.openDebts)}
                      cycleSeconds={state.lastCycleSeconds}
                      config={state.scenario.settings.config}
                      sanityState={sanityCheckOn ? state : undefined}
                    />
                  </div>
                ))}
              </div>
              <PlotMarkLegend normalProfile={!!state.summary.market} />
            </div>
          ) : (
            <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-6 text-xs text-slate-400">
              {view.status === "error" ? "The scenario has errors - see the Scenario panel below." : "Setting up..."}
            </div>
          )}

          {snapshot && state && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {state.summary.market ? (
                  <BazaarMoneyPanel
                    summary={state.summary}
                    previous={view.previousSummary}
                    quotes={quotes}
                    pricing={bazaar.pricing}
                    cycleSeconds={state.lastCycleSeconds}
                  />
                ) : (
                  <MoneyPanel summary={state.summary} previous={view.previousSummary} cycleSeconds={state.lastCycleSeconds} />
                )}
                <SustainabilityPanel report={snapshot.report} summary={state.summary} />
              </div>
              {/* One inventory table for both profiles; normal adds the Bazaar to it. */}
              <InventoryTable
                state={state}
                bazaar={
                  state.summary.market
                    ? { scenario, view: bazaar, now, onReserveChange: (reserve) => setScenario((sc) => ({ ...sc, settings: { ...sc.settings, reserve } })) }
                    : undefined
                }
                onAddItems={addItems}
                busy={view.status === "running"}
                startingInventory={scenario.startingInventory}
                onStartingInventoryChange={(startingInventory) => setScenario((sc) => ({ ...sc, startingInventory }))}
              />
            </>
          )}

          <ScriptPanel scenario={scenario} state={state ?? null} onEdit={setScripting} />

          {state && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <EventLog log={view.log} plotIds={plotIds} />
              <FlowTimeline key={`${state.scenario.settings.seed}-${state.cycle === 0 ? "setup" : "run"}`} flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} elapsedSeconds={state.elapsedSeconds} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <ScenarioPanel
              scenario={scenario}
              onChange={setScenario}
              onEditFlow={setEditingPlot}
              onLoadLayout={() => setPicking(true)}
              issues={view.issues}
              warnings={view.warnings}
              error={view.status === "error" ? view.error : null}
            />
            <SettingsPanel scenario={scenario} onChange={setScenario} cycleSecondsNow={state?.lastCycleSeconds} />
          </div>
      </div>

      {editingPlot !== null && scenario.plots.some((p) => p.id === editingPlot) && (
        <div className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm overflow-y-auto scrollbar-dark" role="dialog" aria-modal="true">
          <div className="container mx-auto max-w-screen-2xl px-2 sm:px-4 py-6">
            <div className="bg-slate-900 rounded-lg shadow-2xl">
              <FlowEditor
                key={`${editing!.plotId}-${editing!.step}`}
                scenario={scenario}
                plotId={editingPlot}
                initialStep={editing!.step}
                onChange={setScenario}
                onClose={() => setEditingPlot(null)}
              />
            </div>
          </div>
        </div>
      )}

      {scripting !== null && (scripting === "controller" || scenario.plots.some((p) => p.id === scripting)) && (
        <div className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm overflow-y-auto scrollbar-dark" role="dialog" aria-modal="true" aria-label="Script editor">
          <div className="container mx-auto max-w-screen-2xl px-2 sm:px-4 py-6">
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

      {(incoming || picking) && (
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
      )}
    </div>
  );
};
