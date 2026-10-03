import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, ScanSearch } from "lucide-react";
import { InfoHint, SegmentedControl, useToast } from "../components/ui";
import { LayoutPickerDialog } from "../components/simulator/LayoutPicker";
import { InventoryPanel, MoneyPanel, SustainabilityPanel } from "../components/simulator/ReportPanels";
import { EventLog, RunControls, FlowTimeline } from "../components/simulator/RunPanels";
import { PlotMarkLegend, PlotView } from "../components/simulator/PlotView";
import { buttonClass } from "../components/simulator/styles";
import { FlowEditor } from "../components/simulator/FlowEditor";
import { ScenarioPanel, SettingsPanel } from "../components/simulator/ScenarioPanels";
import { addPlot, isBlankScenario, placeLayout, type LayoutDestination } from "../components/simulator/scenarioEdit";
import { useSimulation } from "../hooks/useSimulation";
import { DEFAULT_CONFIG, DEFAULT_POLICIES, defaultSettings, migrateScenario, scenarioFromShareCodes, type Scenario } from "../simulator";
import { extractLayoutCode, LocalStorageManager, readIncomingLayout, SOURCE_LABEL, type IncomingLayout } from "../utilities";

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
  const settled = useDebounced(scenario, 300);
  const { view, run, step, stepBack, undo, stop, reset, addItems } = useSimulation(settled);

  useEffect(() => {
    LocalStorageManager.saveSimulatorScenario(settled);
  }, [settled]);

  // Clear the handoff from the history entry so a reload or Back doesn't offer it again.
  useEffect(() => {
    const fresh = readIncomingLayout(location.state);
    if (!fresh) return;
    setIncoming(fresh);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);

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
    if (editingPlot === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editingPlot]);

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
        {state && (
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
        )}
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
      />

      <div className="space-y-4 min-w-0">
          {state ? (
            <div className="space-y-3">
              {plotIds.length > 1 && (
                <SegmentedControl
                  size="xs"
                  className="max-w-md"
                  value={focused === null ? ALL : String(focused)}
                  onChange={setFocus}
                  options={[{ value: ALL, label: "All plots" }, ...plotIds.map((id) => ({ value: String(id), label: `Plot ${id}` }))]}
                />
              )}
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
              <PlotMarkLegend />
            </div>
          ) : (
            <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-6 text-xs text-slate-400">
              {view.status === "error" ? "The scenario has errors - see the Scenario panel below." : "Setting up..."}
            </div>
          )}

          {snapshot && state && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <MoneyPanel summary={state.summary} previous={view.previousSummary} cycleSeconds={state.lastCycleSeconds} />
                <SustainabilityPanel report={snapshot.report} summary={state.summary} />
              </div>
              <InventoryPanel
                state={state}
                onAddItems={addItems}
                busy={view.status === "running"}
                startingInventory={scenario.startingInventory}
                onStartingInventoryChange={(startingInventory) => setScenario((sc) => ({ ...sc, startingInventory }))}
              />
            </>
          )}

          {state && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <EventLog log={view.log} plotIds={plotIds} />
              <FlowTimeline flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} />
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
