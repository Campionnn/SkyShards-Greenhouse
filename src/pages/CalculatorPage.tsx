/**
 * The Calculator (`/`): pick mutation targets, Solve, read the best layout.
 *
 * Desktop: a left rail (Targets, Solve, More settings) · the result in the centre (score line, the
 * large grid, the legend; the progress bar while solving) · Priorities & locks in a right rail, which
 * drops under the result below ~1100px. Phone: the result first, a setup fold, and a sticky Solve bar.
 */
import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown, Grid3x3, Square } from "lucide-react";
import { useGridState, useGreenhouseData, useLockedPlacements } from "../context";
import { GridManagerModal, FirstTimeVisitorModal, useToast } from "../components";
import { MutationTargets, SolverResults, CropConfigurationsPanel, EffectWeightsPanel, LocalSolverPanel } from "../components";
import { UniqueCropsPanel, useUniqueCrops } from "../components"; // UNIQUE_CROPS
import { solveGreenhouseWithJob, SolveCancelledError, toSolveErrorInfo, loadLocalSolverSettings } from "../services";
import type { SolveErrorInfo } from "../services";
import { LocalStorageManager } from "../utilities";
import type { SolveSession, SolveRunMeta } from "../components/calculator/solverStatus";
import type { SolveResponse, MutationGoal } from "../types/greenhouse";
import { cn } from "../components/ui/cn";
import { InfoHint } from "../components/ui/InfoHint";
import { KitButton } from "../components/ui/kit";
import { surface } from "../components/ui/surface";

const setupError = (title: string, message: string, suggestion: string): SolveErrorInfo => ({
  kind: "invalid_request",
  title,
  message,
  suggestions: [suggestion],
});

export const CalculatorPage: React.FC = () => {
  const { getUnlockedCellsArray, unlockedCells } = useGridState();
  const { selectedMutations, isLoading: dataLoading, effectWeights } = useGreenhouseData();
  const { getLocksForAPI, priorities } = useLockedPlacements();
  const { toast } = useToast();
  const uniqueCrops = useUniqueCrops(); // UNIQUE_CROPS

  const [isGridModalOpen, setIsGridModalOpen] = useState(false);
  const [isFirstTimeModalOpen, setIsFirstTimeModalOpen] = useState(false);

  // First-visit modal: only when nothing is customised and the visit flag is unset.
  useEffect(() => {
    const timer = setTimeout(() => {
      const gridConfig = LocalStorageManager.loadGridConfig();
      const mutationTargets = LocalStorageManager.loadMutationTargets();
      const designerInputs = LocalStorageManager.loadDesignerInputs();
      const designerTargets = LocalStorageManager.loadDesignerTargets();
      const lockedPlacements = LocalStorageManager.loadLockedPlacements();
      const priorities = LocalStorageManager.loadPriorities();
      const hasVisited = localStorage.getItem("skyshards-has-visited");
      
      // The default grid is 12 cells in a 4x4 diamond.
      const isDefaultGrid = gridConfig && gridConfig.size === 12;
      
      const hasUserData = 
        (!isDefaultGrid && gridConfig && gridConfig.size > 0) ||
        (mutationTargets && mutationTargets.length > 0) ||
        (designerInputs && designerInputs.length > 0) ||
        (designerTargets && designerTargets.length > 0) ||
        (lockedPlacements && lockedPlacements.length > 0) ||
        (priorities && Object.keys(priorities).length > 0);
      
      if (!hasUserData && !hasVisited) {
        setIsFirstTimeModalOpen(true);
      }
      
      localStorage.setItem("skyshards-has-visited", "true");
    }, 100); // Let the contexts initialise first.
    
    return () => clearTimeout(timer);
  }, []);

  const [error, setError] = useState<SolveErrorInfo | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [previewResult, setPreviewResult] = useState<SolveResponse | null>(null);
  // Live solve status; null when nothing is running.
  const [session, setSession] = useState<SolveSession | null>(null);
  const [runMeta, setRunMeta] = useState<SolveRunMeta | null>(null);
  const isLoading = session !== null;

  const abortControllerRef = useRef<AbortController | null>(null);
  // Latest preview, readable from the async solve without a stale closure.
  const previewRef = useRef<SolveResponse | null>(null);

  const handleSolve = useCallback(async () => {
    const cells = getUnlockedCellsArray();

    if (cells.length === 0) {
      setError(setupError("No cells unlocked", "Your greenhouse has no unlocked cells to plant in.", "Press the cells button at the top and unlock the cells you have."));
      return;
    }

    if (selectedMutations.length === 0) {
      setError(setupError("No targets", "Nothing to optimize for yet.", "Add at least one mutation target in the Targets panel."));
      return;
    }

    const startedAt = Date.now();
    const settings = loadLocalSolverSettings();

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
          effect_weights: effectWeights,
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
        // Stopped before a result arrived: keep the live preview, if any. The cast is needed because
        // TS narrows the ref to null after the reset above, unaware the callbacks set it since.
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
  }, [getUnlockedCellsArray, selectedMutations, priorities, getLocksForAPI, effectWeights, toast, uniqueCrops]);

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

  const displayResult = result || previewResult;


  const solveButton = (className?: string, touch?: boolean) => (
    <KitButton
      variant={isLoading ? "danger" : "primary"}
      size={touch ? "touch" : "md"}
      className={className}
      onClick={isLoading ? handleCancel : handleSolve}
      disabled={dataLoading}
      loading={session?.phase === "cancelling"}
    >
      {isLoading ? (
        <>
          <Square /> {session?.phase === "cancelling" ? "Stopping…" : "Stop solving"}
        </>
      ) : (
        "Solve"
      )}
    </KitButton>
  );

  const cellsButton = (
    <KitButton size="md" onClick={() => setIsGridModalOpen(true)} title="Choose which cells of your greenhouse are unlocked">
      <Grid3x3 /> {unlockedCount} cells
    </KitButton>
  );

  /** More settings: effect weights, unique crops, the local solver. */
  const moreSettings = (
    <details className="group/more border-t border-line pt-2">
      <summary className="focus-ring flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-inner text-label uppercase text-fg-meta pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        More settings <ChevronDown aria-hidden className="size-3.5 transition-transform duration-(--duration-ink) group-open/more:rotate-180" />
      </summary>
      <div className="space-y-2 pt-1">
        <EffectWeightsPanel />
        <UniqueCropsPanel />
        <LocalSolverPanel />
      </div>
    </details>
  );

  return (
    <>
      <div className="@container w-full py-3 max-md:pb-24 sm:py-4">
        <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-hero text-fg max-sm:text-title">Calculator</h1>
          <InfoHint title="How the Calculator works" width={320} label="How the Calculator works">
            Pick the mutations you want, mark which cells you've unlocked, and Solve: the solver finds the crop layout that spawns the most of them. Priorities make it use a
            crop less; locks keep a crop where you put it.
          </InfoHint>
          <span className="ml-auto">{cellsButton}</span>
        </header>

        <div className="grid grid-cols-1 gap-5 @min-[48rem]:grid-cols-[15rem_minmax(0,1fr)] @min-[69rem]:grid-cols-[16rem_minmax(0,1fr)_17rem] @min-[69rem]:items-start">
          {/* Setup rail: sticky on desktop; on phones a fold under the result. */}
          <aside aria-label="Setup" className="order-2 @min-[48rem]:sticky @min-[48rem]:top-4 @min-[48rem]:order-1 @min-[48rem]:self-start">
            <details className={cn("group/setup @min-[48rem]:hidden", surface.card, "p-3")}>
              <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-inner text-body text-fg-body [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 truncate">
                  Targets ({selectedMutations.length}) · settings
                </span>
                <ChevronDown aria-hidden className="size-4 text-fg-meta transition-transform duration-(--duration-ink) group-open/setup:rotate-180" />
              </summary>
              <div className="space-y-4 pt-2">
                <MutationTargets />
                {moreSettings}
              </div>
            </details>
            <div className="hidden space-y-4 @min-[48rem]:block">
              <MutationTargets />
              {solveButton("w-full")}
              {moreSettings}
            </div>
          </aside>

          <main aria-label="Result" className="order-1 min-w-0 @min-[48rem]:order-2">
            <SolverResults
              result={displayResult}
              error={error}
              session={session}
              runMeta={result ? runMeta : null}
              onClear={handleClearResults}
              onDismissError={handleDismissError}
              onRetry={error && error.kind !== "invalid_request" ? handleSolve : undefined}
            />
          </main>

          <aside aria-label="Priorities & locks" className="order-3 min-w-0 @min-[48rem]:col-start-2 @min-[69rem]:sticky @min-[69rem]:top-4 @min-[69rem]:col-start-3 @min-[69rem]:row-start-1">
            <CropConfigurationsPanel />
          </aside>
        </div>
      </div>

      {/* Phone: Solve stays in reach. */}
      <div className="fixed inset-x-0 bottom-0 z-(--z-bar) border-t border-line bg-surface-panel px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        {solveButton("w-full", true)}
      </div>

      <GridManagerModal isOpen={isGridModalOpen} onClose={() => setIsGridModalOpen(false)} />

      <FirstTimeVisitorModal isOpen={isFirstTimeModalOpen} onClose={() => setIsFirstTimeModalOpen(false)} onConfigureGrid={() => setIsGridModalOpen(true)} />
    </>
  );
};