/**
 * The Calculator (`/`): pick mutation targets, Solve, read the best layout.
 *
 * Wide (page ≥ 69rem): a left rail (Targets, Solve, More settings) · the result in the centre (score
 * line, the large grid, the legend; the progress bar while solving) · Priorities & locks in a right
 * rail. Both rails are sticky with their own scroll. Mid widths: one sticky left rail with
 * Targets | Priorities tabs, so the lock brush stays beside the grid. Phone: the result first, a
 * setup fold, the priorities, and a sticky Solve bar.
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
import { KitButton, TabPanel, Tabs } from "../components/ui/kit";
import { surface } from "../components/ui/surface";
import { ResultFocusProvider } from "../components/calculator/ResultLists";
import { StickyRail } from "../components/calculator/StickyRail";
import { useCalculatorLayout } from "../components/calculator/calculatorLayout";

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

  // One tree per layout (measured from the page's own width), so every panel renders once.
  const pageRef = useRef<HTMLDivElement>(null);
  const layout = useCalculatorLayout(pageRef);
  const [railTab, setRailTab] = useState<"targets" | "priorities">("targets");

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

  /** More settings: effect weights, unique crops, the local solver. Open by default (it fills the rail). */
  const moreSettings = (
    <details open className="group/more border-t border-line pt-2">
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

  const setup = (
    <div className="space-y-4">
      <MutationTargets />
      {layout === "wide" && solveButton("w-full")}
      {moreSettings}
    </div>
  );

  const resultSection = (
    <section aria-label="Result" className="min-w-0">
      <SolverResults
        result={displayResult}
        error={error}
        session={session}
        runMeta={result ? runMeta : null}
        onClear={handleClearResults}
        onDismissError={handleDismissError}
        onRetry={error && error.kind !== "invalid_request" ? handleSolve : undefined}
        lists="inline"
      />
    </section>
  );

  let body: React.ReactNode = null;
  if (layout === "phone") {
    // Phone: the result first, then the setup fold and the priorities, stacked in the page.
    body = (
      <div className="grid grid-cols-1 gap-5">
        {resultSection}
        <details className={cn("group/setup", surface.card, "p-3")} open={selectedMutations.length === 0 || undefined}>
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-inner text-body text-fg-body [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 truncate">Targets ({selectedMutations.length}) · settings</span>
            <ChevronDown aria-hidden className="size-4 text-fg-meta transition-transform duration-(--duration-ink) group-open/setup:rotate-180" />
          </summary>
          <div className="pt-2">{setup}</div>
        </details>
        <aside aria-label="Priorities & locks" className="min-w-0">
          <CropConfigurationsPanel inFlow />
        </aside>
      </div>
    );
  } else if (layout === "mid") {
    // Mid widths: one sticky left rail with Targets | Priorities, so the brush sits beside the grid.
    body = (
      <div className="grid grid-cols-[17rem_minmax(0,1fr)] items-start gap-5">
        <StickyRail label="Setup">
          <Tabs
            idPrefix="calc-rail"
            label="Setup"
            value={railTab}
            onChange={setRailTab}
            items={[
              { value: "targets", label: "Targets", count: selectedMutations.length || null },
              { value: "priorities", label: "Priorities" },
            ]}
            className="shrink-0"
          />
          <TabPanel idPrefix="calc-rail" value={railTab} className="scrollbar-dark mt-3 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
            {railTab === "targets" ? setup : <CropConfigurationsPanel className="min-h-0 flex-1" inFlow />}
          </TabPanel>
          {/* Solve stays under both tabs. */}
          <div className="shrink-0 border-t border-line pt-3">{solveButton("w-full")}</div>
        </StickyRail>
        {resultSection}
      </div>
    );
  } else if (layout === "wide") {
    body = (
      <div className="grid grid-cols-[16rem_minmax(0,1fr)_17rem] gap-5">
        <StickyRail label="Setup" innerClassName="scrollbar-dark overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          {setup}
        </StickyRail>
        {resultSection}
        <StickyRail label="Priorities & locks">
          <CropConfigurationsPanel className="min-h-0 flex-1" />
        </StickyRail>
      </div>
    );
  }

  return (
    <>
      {/* Phone: room under the content for the Solve bar and the ad below it. */}
      <div ref={pageRef} className="w-full py-3 max-md:pb-[calc(6rem+var(--ad-bottom,0px))] sm:py-4">
        <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-hero text-fg max-sm:text-title">Calculator</h1>
          <InfoHint title="How the Calculator works" width={320} label="How the Calculator works">
            Pick the mutations you want, mark which cells you've unlocked, and Solve: the solver finds the crop layout that spawns the most of them. Priorities make it use a
            crop less; locks keep a crop where you put it.
          </InfoHint>
          <span className="ml-auto">{cellsButton}</span>
        </header>

        <ResultFocusProvider result={displayResult}>{body}</ResultFocusProvider>
      </div>

      {/* Phone: Solve stays in reach. It docks on top of Mediavine's adhesion ad (`--ad-bottom`,
          useBottomAdInset in the site Layout) instead of under it, like the simulator's run bar; the
          ad already covers the home-indicator area, so the safe-area padding shrinks by it. */}
      {layout === "phone" && (
        <div
          className="fixed inset-x-0 z-(--z-bar) border-t border-line bg-surface-panel px-3 pt-2"
          style={{ bottom: "var(--ad-bottom, 0px)", paddingBottom: "max(0.5rem, calc(0.5rem + env(safe-area-inset-bottom, 0px) - var(--ad-bottom, 0px)))" }}
        >
          {solveButton("w-full", true)}
        </div>
      )}

      <GridManagerModal isOpen={isGridModalOpen} onClose={() => setIsGridModalOpen(false)} />

      <FirstTimeVisitorModal isOpen={isFirstTimeModalOpen} onClose={() => setIsFirstTimeModalOpen(false)} onConfigureGrid={() => setIsGridModalOpen(true)} />
    </>
  );
};