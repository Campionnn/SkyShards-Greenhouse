import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, LayoutTemplate, ClipboardCheck } from "lucide-react";
import {
  CropSelectionPalette,
  DesignerActions,
  DesignerGrid,
  MutationValidator,
  Panel,
} from "../components";
import { CropImage } from "../components/shared";
import { useToast } from "../components/ui/toastContext";
import { useDesigner, useGreenhouseData } from "../context";
import { useFitCellSize } from "../hooks";
import { decodeDesign, getRarityTextColor } from "../utilities";
import { captureGridAsPng, aggregateCropInfo } from "../utilities/gridExport";
import type { DesignerGridHandle } from "../components";

export const DesignerPage: React.FC = () => {
  const [showTargets, setShowTargets] = useState(true);
  const gridRef = useRef<DesignerGridHandle>(null);
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { inputPlacements, targetPlacements, loadFromSolverResult } = useDesigner();
  const { getCropDef, getMutationDef, isLoading: isDataLoading } = useGreenhouseData();
  const [hasLoadedFromUrl, setHasLoadedFromUrl] = useState(false);
  
  // Grid sizing: fit the available width, never scroll
  const fitRef = useRef<HTMLDivElement>(null);
  const gridSize = useFitCellSize(fitRef);

  // Get crop counts for display
  const inputCropCounts = React.useMemo(() => {
    const counts = new Map<string, { name: string; rarity: string; count: number }>();
    for (const p of inputPlacements) {
      const existing = counts.get(p.cropId);
      if (existing) {
        existing.count++;
      } else {
        const mutationDef = getMutationDef(p.cropId);
        counts.set(p.cropId, { 
          name: p.cropName, 
          rarity: mutationDef?.rarity || "common",
          count: 1 
        });
      }
    }
    return Array.from(counts.entries()).map(([cropId, data]) => ({ cropId, ...data }));
  }, [inputPlacements, getMutationDef]);
  
  const targetCropCounts = React.useMemo(() => {
    const counts = new Map<string, { name: string; rarity: string; count: number }>();
    for (const p of targetPlacements) {
      const existing = counts.get(p.cropId);
      if (existing) {
        existing.count++;
      } else {
        const mutationDef = getMutationDef(p.cropId);
        counts.set(p.cropId, { 
          name: p.cropName, 
          rarity: mutationDef?.rarity || "common",
          count: 1 
        });
      }
    }
    return Array.from(counts.entries()).map(([cropId, data]) => ({ cropId, ...data }));
  }, [targetPlacements, getMutationDef]);
  
  const totalInputCells = React.useMemo(() => {
    return inputPlacements.reduce((sum, p) => sum + (p.size * p.size), 0);
  }, [inputPlacements]);
  
  const totalTargetCells = React.useMemo(() => {
    return targetPlacements.reduce((sum, p) => sum + (p.size * p.size), 0);
  }, [targetPlacements]);
  
// Export grid function for Playwright-based share image generation
  const exportGridForShare = useCallback(async (): Promise<string> => {
    if (!gridRef.current) {
      throw new Error('Grid not available');
    }
    
    const gridElement = gridRef.current.getGridElement();
    if (!gridElement) {
      throw new Error('Grid element not found');
    }
    
    // Build crop info for the watermark
    const inputCrops = aggregateCropInfo(
      inputPlacements.map(p => {
        const def = getCropDef(p.cropId) || getMutationDef(p.cropId);
        return { cropId: p.cropId, cropName: def?.name || p.cropId.replace(/_/g, ' ') };
      })
    );
    
    // Always include target crops in the count, even if hidden visually
    const targetCrops = aggregateCropInfo(
      targetPlacements.map(p => {
        const def = getMutationDef(p.cropId) || getCropDef(p.cropId);
        return { cropId: p.cropId, cropName: def?.name || p.cropId.replace(/_/g, ' ') };
      })
    );
    
    const options = {
      scale: 2,  // 2x scale - Discord targets ~800px, too large causes aggressive compression
      includeWatermark: true,
      watermarkUrl: "greenhouse.skyshards.com",
      watermarkTitle: "Greenhouse Designer",
      inputCrops,
      targetCrops,
      showTargets,
    };
    
    const result = await captureGridAsPng(gridElement, options);
    return result.dataUrl;
  }, [gridRef, inputPlacements, targetPlacements, showTargets, getCropDef, getMutationDef]);
  
  // Expose exportGrid to window for Playwright access
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).exportGrid = exportGridForShare;
    
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).exportGrid;
    };
  }, [exportGridForShare]);
  
  // Track layout loading state for Playwright
  const [layoutLoadState, setLayoutLoadState] = useState<'pending' | 'loaded' | 'error' | 'no-layout'>('pending');
  
  // Function to load a layout from an encoded string
  const loadLayoutFromCode = useCallback(async (layoutCode: string) => {
    if (!layoutCode) {
      setLayoutLoadState('no-layout');
      throw new Error('No layout code provided');
    }
    
    setLayoutLoadState('pending');
    
    try {
      const { inputs, targets } = decodeDesign(layoutCode);
      
      // Convert to the format expected by loadFromSolverResult
      const crops = inputs.map(p => {
        const cropDef = getCropDef(p.cropId);
        const mutationDef = getMutationDef(p.cropId);
        const displayName = cropDef?.name || mutationDef?.name || p.cropId.replace(/_/g, " ");
        return {
          id: p.cropId,
          name: displayName,
          position: p.position,
          size: cropDef?.size || mutationDef?.size || 1,
        };
      });
      
      const mutations = targets.map(p => {
        const mutationDef = getMutationDef(p.cropId);
        const cropDef = getCropDef(p.cropId);
        const displayName = mutationDef?.name || cropDef?.name || p.cropId.replace(/_/g, " ");
        return {
          id: p.cropId,
          name: displayName,
          position: p.position,
          size: mutationDef?.size || cropDef?.size || 1,
        };
      });
      
      loadFromSolverResult(crops, mutations);
      setLayoutLoadState('loaded');
      
      return { inputs: crops, targets: mutations };
    } catch (err) {
      setLayoutLoadState('error');
      throw err;
    }
  }, [getCropDef, getMutationDef, loadFromSolverResult]);
  
  // Expose loadLayoutFromCode to window for Playwright access
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).loadLayoutFromCode = loadLayoutFromCode;
    
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).loadLayoutFromCode;
    };
  }, [loadLayoutFromCode]);
  
  // Auto-load layout from URL parameter
  useEffect(() => {
    // Wait for greenhouse data to load and only run once
    if (isDataLoading || hasLoadedFromUrl) return;
    
    const layoutCode = searchParams.get("layout");
    if (!layoutCode) {
      setLayoutLoadState('no-layout');
      setHasLoadedFromUrl(true);
      return;
    }
    
    loadLayoutFromCode(layoutCode)
      .then(({ inputs, targets }) => {
        setHasLoadedFromUrl(true);
        toast({
          title: "Layout loaded",
          description: `Loaded ${inputs.length} inputs and ${targets.length} targets from shared link`,
          variant: "success",
          duration: 3000,
        });
      })
      .catch((err) => {
        setHasLoadedFromUrl(true);
        toast({
          title: "Failed to load layout",
          description: err instanceof Error ? err.message : "Invalid layout code in URL",
          variant: "error",
          duration: 5000,
        });
      });
  }, [searchParams, isDataLoading, hasLoadedFromUrl, loadLayoutFromCode, toast]);
  
  // Expose layout load state to window for Playwright to check
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).layoutLoadState = layoutLoadState;
    
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).layoutLoadState;
    };
  }, [layoutLoadState]);
  
  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-2xl">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[300px_minmax(0,1fr)_380px] gap-4 lg:gap-6 lg:items-start">
        {/* Left column: layout actions + validation. Sticky on desktop, scrolls internally. */}
        <div className="order-2 space-y-4 lg:col-start-1 lg:row-start-2 xl:row-start-1 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto scrollbar-dark xl:pr-1">
          <Panel title="Layout" icon={<LayoutTemplate />}>
            <DesignerActions gridRef={gridRef} showTargets={showTargets} />
          </Panel>

          <Panel title="Mutation Status" icon={<ClipboardCheck />}>
            <MutationValidator />
          </Panel>
        </div>

        <div className="flex flex-col items-center order-1 min-w-0 lg:col-start-1 lg:row-start-1 xl:col-start-2">
          <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 sm:p-4 w-full">
            <div className="flex flex-col sm:flex-row items-center justify-between mb-4 gap-2">
              <h3 className="text-sm font-medium text-slate-200">Greenhouse Designer</h3>
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setShowTargets(!showTargets)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 hover:text-slate-200"
                  title={showTargets ? "Hide target mutations" : "Show target mutations"}
                >
                  {showTargets ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Hide Targets</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Show Targets</span>
                    </>
                  )}
                </button>
                <div className="flex gap-2 sm:gap-4 text-xs text-slate-400">
                </div>
              </div>
            </div>
            
            {/* Grid Layout */}
            <div className="mb-4">
              <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                Grid Layout
              </h4>
              <div ref={fitRef} className="w-full flex flex-col items-center">
                <DesignerGrid
                  ref={gridRef}
                  showTargets={showTargets}
                  cellSize={gridSize.cellSize}
                  gap={gridSize.gap}
                />
              </div>
            </div>
            
            {/* Crop Counts Display */}
            {(targetCropCounts.length > 0 || inputCropCounts.length > 0) && (
              <>
                {/* Target Mutations */}
                {targetCropCounts.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                      Target Mutations
                    </h4>
                    <div className="space-y-2">
                      {targetCropCounts.map(({ cropId, name, rarity, count }) => (
                        <div
                          key={cropId}
                          className="flex items-center justify-between bg-slate-700/30 rounded-md px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <CropImage
                              cropId={cropId}
                              cropName={name}
                              size="xs"
                              showFallback={false}
                            />
                            <span className={`text-sm ${getRarityTextColor(rarity)}`}>{name}</span>
                          </div>
                          <span className="text-sm font-medium text-emerald-400">x{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Input Crops */}
                {inputCropCounts.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                      Input Crops
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {inputCropCounts.map(({ cropId, name, count }) => (
                        <div
                          key={cropId}
                          className="flex items-center gap-2 bg-slate-700/30 rounded-md px-2 py-1"
                        >
                          <CropImage
                            cropId={cropId}
                            cropName={name}
                            size="xs"
                            showFallback={false}
                          />
                          <span className="text-xs text-slate-300">{name}</span>
                          <span className="text-xs text-slate-500">x{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Total Cells Used */}
                <div className="bg-slate-700/30 rounded-md px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Total Cells Used:</span>
                    <span className="text-sm font-medium text-emerald-400">
                      {totalInputCells + totalTargetCells}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Right column: the palette, with the Inputs/Targets switch. Same sticky treatment as the left. */}
        <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 h-[500px] lg:h-[calc(100vh-2rem)] order-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 xl:col-start-3 xl:row-span-1 lg:sticky lg:top-4 min-h-0">
          <CropSelectionPalette className="h-full" />
        </div>
      </div>
    </div>
  );
};
