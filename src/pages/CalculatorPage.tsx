import React, { useState, useRef, useCallback, useEffect } from "react";
import { Play, Grid3x3, Square } from "lucide-react";
import { useGridState, useGreenhouseData, useLockedPlacements } from "../context";
import { GridManagerModal, FirstTimeVisitorModal, Panel, useToast } from "../components";
import { MutationTargets, SolverResults, CropConfigurationsPanel, EffectWeightsPanel, LocalSolverPanel } from "../components";
import { solveGreenhouseWithJob } from "../services";
import { LocalStorageManager } from "../utilities";
import type { SolveResponse, MutationGoal, JobProgress } from "../types/greenhouse";

export const CalculatorPage: React.FC = () => {
  const { getUnlockedCellsArray, unlockedCells } = useGridState();
  const { selectedMutations, isLoading: dataLoading, effectiveEffectWeights } = useGreenhouseData();
  const { getLocksForAPI, priorities } = useLockedPlacements();
  const { toast } = useToast();

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  
  // Job progress state
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [previewResult, setPreviewResult] = useState<SolveResponse | null>(null);
  
  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSolve = useCallback(async () => {
    const cells = getUnlockedCellsArray();

    if (cells.length === 0) {
      setError("No cells are unlocked. Go to the Grid tab to configure your greenhouse.");
      return;
    }

    if (selectedMutations.length === 0) {
      setError("No mutation targets selected. Add at least one target to optimize for.");
      return;
    }

    // Reset state
    setIsLoading(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setQueuePosition(null);
    setPreviewResult(null);

    // Create abort controller for this solve
    abortControllerRef.current = new AbortController();

    try {
      // Convert selected mutations to API format
      const targets: MutationGoal[] = selectedMutations.map((m) => ({
        mutation: m.id,
        maximize: m.mode === "maximize",
        count: m.mode === "target" ? m.targetCount : null,
      }));

      const response = await solveGreenhouseWithJob(
        { 
          cells, 
          targets,
          priorities: Object.keys(priorities).length > 0 ? priorities : undefined,
          locks: getLocksForAPI().length > 0 ? getLocksForAPI() : undefined,
          effect_weights: effectiveEffectWeights,
        },
        {
          onProgress: (p) => {
            setProgress(p);
            setQueuePosition(null);
          },
          onQueuePosition: (pos) => {
            setQueuePosition(pos);
            setProgress(null);
          },
          onPreviewUpdate: (preview) => {
            setPreviewResult(preview);
          },
          onEndpoint: (endpoint) => {
            if (endpoint.fallback) {
              toast({
                id: "local-solver-fallback",
                title: "Local solver not reachable",
                description: "Solving on the server instead. Start the local solver or turn off \"Solve locally\".",
                variant: "warning",
              });
            }
          },
        },
        abortControllerRef.current.signal
      );

      setResult(response);
      setPreviewResult(null);
    } catch (err) {
      if (err instanceof Error && err.message === "Job cancelled") {
        // If we have a preview result, show it as the final result
        if (previewResult) {
          setResult({ ...previewResult, status: "CANCELLED" });
        }
      } else {
        setError(err instanceof Error ? err.message : "Failed to solve");
        setResult(null);
      }
    } finally {
      setIsLoading(false);
      setProgress(null);
      setQueuePosition(null);
      abortControllerRef.current = null;
    }
  }, [getUnlockedCellsArray, selectedMutations, previewResult, priorities, getLocksForAPI, effectiveEffectWeights, toast]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);
  
  const handleClearResults = useCallback(() => {
    setResult(null);
    setPreviewResult(null);
    setError(null);
    setProgress(null);
    setQueuePosition(null);
  }, []);

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
                <span>Stop solving</span>
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
              isLoading={false}
              progress={progress}
              queuePosition={queuePosition}
              onClear={handleClearResults}
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


