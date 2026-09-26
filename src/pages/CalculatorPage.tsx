import React, { useState, useRef, useCallback, useEffect } from "react";
import { Play, Grid3x3, Square } from "lucide-react";
import { useGridState, useGreenhouseData, useLockedPlacements } from "../context";
import { GridManagerModal, FirstTimeVisitorModal, Panel, useToast } from "../components";
import { MutationTargets, SolverResults, CropConfigurationsPanel, EffectWeightsPanel, LocalSolverPanel } from "../components";
import { UniqueCropsPanel, useUniqueCrops } from "../components"; // UNIQUE_CROPS
import { solveGreenhouseWithJob, SolveCancelledError, toSolveErrorInfo, loadLocalSolverSettings } from "../services";
import type { SolveErrorInfo } from "../services";
import { LocalStorageManager } from "../utilities";
import type { SolveSession, SolveRunMeta } from "../components/calculator/solverStatus";
import type { SolveResponse, MutationGoal } from "../types/greenhouse";

const setupError = (title: string, message: string, suggestion: string): SolveErrorInfo => ({
  kind: "invalid_request",
  title,
  message,
  suggestions: [suggestion],
});

export const CalculatorPage: React.FC = () => {
  const { getUnlockedCellsArray, unlockedCells } = useGridState();
  const { selectedMutations, isLoading: dataLoading, effectiveEffectWeights } = useGreenhouseData();
  const { getLocksForAPI, priorities } = useLockedPlacements();
  const { toast } = useToast();
  const uniqueCrops = useUniqueCrops(); // UNIQUE_CROPS

  // Modal state
  const [isGridModalOpen, setIsGridModalOpen] = useState(false);
  const [isFirstTimeModalOpen, setIsFirstTimeModalOpen] = useState(false);

  // Check if user is a first-time visitor
  useEffect(() => {
    // Small delay to ensure contexts have initialized
    const timer = setTimeout(() => {
      // Check if the user has actually customized anything
      const gridConfig = LocalStorageManager.loadGridConfig();
      const mutationTargets = LocalStorageManager.loadMutationTargets();
      const designerInputs = LocalStorageManager.loadDesignerInputs();
      const designerTargets = LocalStorageManager.loadDesignerTargets();
      const lockedPlacements = LocalStorageManager.loadLockedPlacements();
      const priorities = LocalStorageManager.loadPriorities();
      const hasVisited = localStorage.getItem("skyshards-has-visited");
      
      // Check if grid config is the default (12 cells in a 4x4 diamond pattern)
      const isDefaultGrid = gridConfig && gridConfig.size === 12;
      
      // Check if there's any actual user data (non-empty, non-default)
      const hasUserData = 
        (!isDefaultGrid && gridConfig && gridConfig.size > 0) || // Non-default grid
        (mutationTargets && mutationTargets.length > 0) || // Has mutation targets
        (designerInputs && designerInputs.length > 0) || // Has designer inputs
        (designerTargets && designerTargets.length > 0) || // Has designer targets
        (lockedPlacements && lockedPlacements.length > 0) || // Has locked placements
        (priorities && Object.keys(priorities).length > 0); // Has custom priorities
      
      // If no user data AND hasn't visited before, show the first-time modal
      if (!hasUserData && !hasVisited) {
        setIsFirstTimeModalOpen(true);
      }
      
      // Mark as visited
      localStorage.setItem("skyshards-has-visited", "true");
    }, 100); // Small delay to let contexts initialize
    
    return () => clearTimeout(timer);
  }, []);

  // Solver state
  const [error, setError] = useState<SolveErrorInfo | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [previewResult, setPreviewResult] = useState<SolveResponse | null>(null);
  // Live solve status; null when nothing is running
  const [session, setSession] = useState<SolveSession | null>(null);
  // Facts about the finished solve
  const [runMeta, setRunMeta] = useState<SolveRunMeta | null>(null);
  const isLoading = session !== null;

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);
  // Latest preview, readable from the async solve without a stale closure
  const previewRef = useRef<SolveResponse | null>(null);

  const handleSolve = useCallback(async () => {
    const cells = getUnlockedCellsArray();

    if (cells.length === 0) {
      setError(setupError("No cells unlocked", "Your greenhouse has no unlocked cells to plant in.", "Press Configure in the Grid panel and unlock the cells you have."));
      return;
    }

    if (selectedMutations.length === 0) {
      setError(setupError("No targets", "Nothing to optimize for yet.", "Add at least one mutation target in the Targets panel."));
      return;
    }

    const startedAt = Date.now();
    const settings = loadLocalSolverSettings();

    // Reset state
    setError(null);
    setResult(null);
    setPreviewResult(null);
    setRunMeta(null);
    previewRef.current = null;
    setSession({
      phase: "submitting",
      startedAt,
      endpoint: null,
      queuePosition: null,
      queueStart: null,
      progress: null,
      timeLimit: null,
      lastImprovementAt: null,
    });

    abortControllerRef.current = new AbortController();
    let lastSolutions: number | null = null;

    try {
      // Convert selected mutations to API format
      const targets: MutationGoal[] = selectedMutations.map((m) => ({
        mutation: m.id,
        maximize: m.mode === "maximize",
        count: m.mode === "target" ? m.targetCount : null,
      }));

      const { result: response, run } = await solveGreenhouseWithJob(
        {
          cells,
          targets,
          priorities: Object.keys(priorities).length > 0 ? priorities : undefined,
          locks: getLocksForAPI().length > 0 ? getLocksForAPI() : undefined,
          effect_weights: effectiveEffectWeights,
          unique_crops: uniqueCrops > 0 ? uniqueCrops : undefined, // UNIQUE_CROPS
        },
        {
          onEndpoint: (endpoint) => {
            setSession((s) => s && { ...s, endpoint, timeLimit: endpoint.local ? settings.timeLimit : null });
            if (endpoint.fallback) {
              toast({
                id: "local-solver-fallback",
                title: "Local solver not reachable",
                description: "Solving on the server instead. Start the local solver or turn off \"Solve locally\".",
                variant: "warning",
              });
            }
          },
          onQueuePosition: (pos) => {
            setSession((s) =>
              s && s.phase !== "cancelling"
                ? { ...s, phase: "queued", queuePosition: pos, queueStart: Math.max(s.queueStart ?? 0, pos) }
                : s
            );
          },
          onProgress: (p) => {
            lastSolutions = p.solutions_found;
            setSession((s) => {
              if (!s) return s;
              const improved = p.solutions_found > (s.progress?.solutions_found ?? 0);
              return {
                ...s,
                phase: s.phase === "cancelling" ? "cancelling" : "running",
                queuePosition: null,
                progress: p,
                lastImprovementAt: improved ? p.elapsed_seconds : s.lastImprovementAt,
              };
            });
          },
          onPreviewUpdate: (preview) => {
            previewRef.current = preview;
            setPreviewResult(preview);
          },
          onCancelling: () => {
            setSession((s) => s && { ...s, phase: "cancelling" });
          },
        },
        abortControllerRef.current.signal
      );

      setResult(response);
      setRunMeta({
        endpoint: run.endpoint,
        serverSeconds: run.serverSeconds,
        queuedSeconds: run.queuedSeconds,
        wallSeconds: (Date.now() - startedAt) / 1000,
        solutionsFound: lastSolutions,
      });
    } catch (err) {
      if (err instanceof SolveCancelledError) {
        // Stopped before the server handed back a result: keep the live preview if there was one.
        // (typed explicitly: TS narrows the ref to null after the reset above,
        // not knowing the callbacks set it meanwhile)
        const preview = previewRef.current as SolveResponse | null;
        if (preview) {
          setResult({ ...preview, status: "CANCELLED" });
          setRunMeta({
            endpoint: null,
            serverSeconds: null,
            queuedSeconds: null,
            wallSeconds: (Date.now() - startedAt) / 1000,
            solutionsFound: lastSolutions,
          });
        }
      } else {
        setError(toSolveErrorInfo(err));
        setResult(null);
      }
    } finally {
      setPreviewResult(null);
      setSession(null);
      abortControllerRef.current = null;
    }
  }, [getUnlockedCellsArray, selectedMutations, priorities, getLocksForAPI, effectiveEffectWeights, toast, uniqueCrops]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleClearResults = useCallback(() => {
    setResult(null);
    setPreviewResult(null);
    setError(null);
    setRunMeta(null);
  }, []);

  const handleDismissError = useCallback(() => setError(null), []);

  const unlockedCount = unlockedCells.size;

  // Determine what to show in the results area
  const displayResult = result || previewResult;

  return (
    <>
      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px] xl:grid-cols-[320px_minmax(0,1fr)_380px] gap-4 lg:gap-6 lg:items-start">
          {/* Left column: setup. Sticky on desktop, scrolls internally when tall, Solve pinned. */}
          <aside className="order-2 lg:order-1 flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)]">
            <div className="flex-1 min-h-0 lg:overflow-y-auto scrollbar-dark space-y-3 lg:pr-1">
              <Panel
                title="Grid"
                icon={<Grid3x3 />}
                actions={
                  <>
                    <span className="text-xs text-slate-400">{unlockedCount} cells</span>
                    <button
                      onClick={() => setIsGridModalOpen(true)}
                      className="px-2 py-1 text-xs bg-slate-700/50 hover:bg-slate-700/70 border border-slate-600/50 hover:border-emerald-500/50 rounded-md text-slate-300 hover:text-emerald-300 transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Choose which cells of your greenhouse are unlocked"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Configure
                    </button>
                  </>
                }
              >
                <p className="text-xs text-slate-500">Which cells of the 10x10 plot you have unlocked.</p>
              </Panel>

              <MutationTargets />

              <EffectWeightsPanel />

              <UniqueCropsPanel />

              <LocalSolverPanel />
            </div>

            {/* Solve */}
            <button
              onClick={isLoading ? handleCancel : handleSolve}
              disabled={dataLoading}
              className={`w-full flex-shrink-0 px-4 py-3 font-semibold rounded-lg text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                isLoading
                  ? "bg-red-500/80 hover:bg-red-600 text-white shadow-red-900/30"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-900/30"
              }`}
            >
              {isLoading ? (
                <span>{session?.phase === "cancelling" ? "Stopping..." : "Stop solving"}</span>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Solve</span>
                </>
              )}
            </button>
          </aside>

          {/* Centre column: the solution */}
          <div className="order-1 lg:order-2 min-w-0">
            <SolverResults
              result={displayResult}
              error={error}
              session={session}
              runMeta={result ? runMeta : null}
              onClear={handleClearResults}
              onDismissError={handleDismissError}
              onRetry={error && error.kind !== "invalid_request" ? handleSolve : undefined}
            />
          </div>

          {/* Right column: crop priorities & locks, full height, sticky */}
          <div className="order-3 flex flex-col min-h-0 h-[500px] lg:h-[calc(100vh-2rem)] lg:sticky lg:top-4">
            <CropConfigurationsPanel className="flex-1 overflow-hidden" />
          </div>
        </div>
      </div>

      {/* Grid Manager Modal */}
      <GridManagerModal
        isOpen={isGridModalOpen}
        onClose={() => setIsGridModalOpen(false)}
      />

      {/* First Time Visitor Modal */}
      <FirstTimeVisitorModal
        isOpen={isFirstTimeModalOpen}
        onClose={() => setIsFirstTimeModalOpen(false)}
        onConfigureGrid={() => setIsGridModalOpen(true)}
      />
    </>
  );
};


