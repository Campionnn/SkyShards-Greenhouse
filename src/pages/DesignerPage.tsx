import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, LayoutTemplate, ClipboardCheck } from "lucide-react";
import {
  CropSelectionPalette,
  DesignerActions,
  DesignerGrid,
  LayoutCropSummary,
  LayoutHistoryControls,
  MutationValidator,
  Panel,
} from "../components";
import { COMPASS_RESERVE } from "../components/grid";
import { useToast } from "../components/ui/toastContext";
import { useDesigner, useGreenhouseData } from "../context";
import { useFitCellSize } from "../hooks";
import { decodeDesign } from "../utilities";
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
  
  // Cells fit the available width; the grid never scrolls.
  const fitRef = useRef<HTMLDivElement>(null);
  const gridSize = useFitCellSize(fitRef, { reserve: COMPASS_RESERVE });

  // Share-image export, called by the Playwright renderer via window.exportGrid.
  const exportGridForShare = useCallback(async (): Promise<string> => {
    if (!gridRef.current) {
      throw new Error('Grid not available');
    }
    
    const gridElement = gridRef.current.getGridElement();
    if (!gridElement) {
      throw new Error('Grid element not found');
    }
    
    // Crop info for the watermark.
    const inputCrops = aggregateCropInfo(
      inputPlacements.map(p => {
        const def = getCropDef(p.cropId) || getMutationDef(p.cropId);
        return { cropId: p.cropId, cropName: def?.name || p.cropId.replace(/_/g, ' ') };
      })
    );
    
    // Target crops always count, even when hidden.
    const targetCrops = aggregateCropInfo(
      targetPlacements.map(p => {
        const def = getMutationDef(p.cropId) || getCropDef(p.cropId);
        return { cropId: p.cropId, cropName: def?.name || p.cropId.replace(/_/g, ' ') };
      })
    );
    
    const options = {
      scale: 2, // Discord targets ~800px; larger images get heavily compressed.
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
  
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).exportGrid = exportGridForShare;
    
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).exportGrid;
    };
  }, [exportGridForShare]);
  
  // Layout load state, read by Playwright via window.layoutLoadState.
  const [layoutLoadState, setLayoutLoadState] = useState<'pending' | 'loaded' | 'error' | 'no-layout'>('pending');
  
  const loadLayoutFromCode = useCallback(async (layoutCode: string) => {
    if (!layoutCode) {
      setLayoutLoadState('no-layout');
      throw new Error('No layout code provided');
    }
    
    setLayoutLoadState('pending');
    
    try {
      const { inputs, targets, groundTiles } = decodeDesign(layoutCode);
      
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
      
      loadFromSolverResult(crops, mutations, groundTiles);
      setLayoutLoadState('loaded');
      
      return { inputs: crops, targets: mutations };
    } catch (err) {
      setLayoutLoadState('error');
      throw err;
    }
  }, [getCropDef, getMutationDef, loadFromSolverResult]);
  
  // Exposed for Playwright.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).loadLayoutFromCode = loadLayoutFromCode;
    
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).loadLayoutFromCode;
    };
  }, [loadLayoutFromCode]);
  
  // Load the ?layout= share code once, after greenhouse data has loaded.
  useEffect(() => {
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
        {/* Actions and validation column: sticky on desktop, scrolls internally. */}
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
                <LayoutHistoryControls />
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
            
            <LayoutCropSummary />
          </div>
        </div>
        
        {/* Palette column with the Inputs/Targets switch, sticky like the left column. */}
        <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 h-[500px] lg:h-[calc(100vh-2rem)] order-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 xl:col-start-3 xl:row-span-1 lg:sticky lg:top-4 min-h-0">
          <CropSelectionPalette className="h-full" />
        </div>
      </div>
    </div>
  );
};
