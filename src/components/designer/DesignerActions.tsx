import React, { useCallback, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { Save, FolderOpen, Share2, X, Image, Film, Download, ClipboardCopy, Loader2, FlaskConical } from "lucide-react";
import { LayoutClearControls, LayoutTransformControls } from "./LayoutTools";
import { motion, AnimatePresence } from "framer-motion";
import { useDesigner, useGreenhouseData } from "../../context";
import { useToast } from "../ui/toastContext";
import { copyShareLink, encodeDesign, makeIncomingLayout, simulatorHandoffState } from "../../utilities";
import { 
  loadLayouts, 
  saveLayouts,
  deleteLayout,
  renameLayout,
  updateLayout,
  generateLayoutId,
} from "../../utilities/layoutStorage";
import {
  captureGridAsPng,
  captureGridAsGif,
  copyBlobToClipboard,
  downloadBlob,
  aggregateCropInfo,
  type ExportOptions,
} from "../../utilities/gridExport";
import type { SavedLayout } from "../../types/layout";
import type { DesignerGridHandle } from "./DesignerGrid";
import { SaveLayoutModal } from "./SaveLayoutModal";
import { LoadLayoutModal, type LoadableLayout } from "./LoadLayoutModal";

interface DesignerActionsProps {
  className?: string;
  gridRef?: RefObject<DesignerGridHandle | null>;
  showTargets?: boolean;
}

type ExportFormat = "png" | "gif";
type ExportStep = "choose-format" | "exporting" | "choose-action";

export const DesignerActions: React.FC<DesignerActionsProps> = ({ 
  className = "",
  gridRef,
  showTargets = true,
}) => {
  const {
    inputPlacements,
    targetPlacements,
    groundTiles,
    loadFromSolverResult,
    undo,
    placementFocus,
  } = useDesigner();
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  
  const [exportStep, setExportStep] = useState<ExportStep>("choose-format");
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentExportBlob, setCurrentExportBlob] = useState<Blob | null>(null);
  const [hasExportedOnce, setHasExportedOnce] = useState(false);
  
  const resetExportState = useCallback(() => {
    setExportStep("choose-format");
    setExportFormat(null);
    setExportProgress(0);
    setCurrentExportBlob(null);
  }, []);
  
  const handleOpenSave = useCallback(() => {
    if (inputPlacements.length === 0 && targetPlacements.length === 0 && groundTiles.length === 0) {
      return; // the button is disabled in this state
    }
    setSavedLayouts(loadLayouts()); // for the overwrite check
    setIsSaveModalOpen(true);
  }, [inputPlacements.length, targetPlacements.length, groundTiles.length]);
  
  const handleSaveLayout = useCallback((name: string, overwriteId?: string) => {
    const now = Date.now();
    
    if (overwriteId) {
      const success = updateLayout(overwriteId, {
        name,
        modifiedAt: now,
        groundTiles,
        inputs: inputPlacements.map(p => ({
          cropId: p.cropId,
          position: p.position,
        })),
        targets: targetPlacements.map(p => ({
          cropId: p.cropId,
          position: p.position,
        })),
      });
      
      if (success) {
        setIsSaveModalOpen(false);
        toast({
          title: "Layout updated",
          description: `"${name}" has been updated`,
          variant: "success",
          duration: 3000,
        });
      } else {
        toast({
          title: "Failed to update layout",
          variant: "error",
          duration: 3000,
        });
      }
    } else {
      const newLayout: SavedLayout = {
        id: generateLayoutId(),
        name,
        savedAt: now,
        modifiedAt: now,
        groundTiles,
        inputs: inputPlacements.map(p => ({
          cropId: p.cropId,
          position: p.position,
        })),
        targets: targetPlacements.map(p => ({
          cropId: p.cropId,
          position: p.position,
        })),
      };
      
      const layouts = loadLayouts();
      layouts.push(newLayout);
      saveLayouts(layouts);
      
      setIsSaveModalOpen(false);
      toast({
        title: "Layout saved",
        description: `"${name}" has been saved`,
        variant: "success",
        duration: 3000,
      });
    }
  }, [inputPlacements, targetPlacements, groundTiles, toast]);
  
  // Opens even with nothing saved: it also offers the last Calculator result and a paste box.
  const handleOpenLoad = useCallback(() => {
    setSavedLayouts(loadLayouts());
    setIsLoadModalOpen(true);
  }, []);
  
  const handleLoadLayout = useCallback((layout: LoadableLayout, name: string) => {
    const crops = layout.inputs.map(p => {
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
    
    const mutations = layout.targets.map(p => {
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
    
    const hadLayout = inputPlacements.length + targetPlacements.length + groundTiles.length > 0;
    loadFromSolverResult(crops, mutations, layout.groundTiles);
    setIsLoadModalOpen(false);
    
    toast({
      title: hadLayout ? "Layout replaced" : "Layout loaded",
      description: name,
      variant: "success",
      duration: hadLayout ? 5000 : 3000,
      // Loading is one undo step, so Undo brings the previous layout back.
      action: hadLayout ? { label: "Undo", onClick: () => { undo(); } } : undefined,
    });
  }, [loadFromSolverResult, getCropDef, getMutationDef, toast, undo, inputPlacements.length, targetPlacements.length, groundTiles.length]);
  
  const handleDeleteLayout = useCallback((layoutId: string) => {
    const success = deleteLayout(layoutId);
    if (success) {
      setSavedLayouts(loadLayouts());
      toast({
        title: "Layout deleted",
        variant: "success",
        duration: 2000,
      });
    } else {
      toast({
        title: "Failed to delete layout",
        variant: "error",
        duration: 3000,
      });
    }
  }, [toast]);
  
  const handleRenameLayout = useCallback((layoutId: string, newName: string) => {
    const success = renameLayout(layoutId, newName);
    if (success) {
      setSavedLayouts(loadLayouts());
      toast({
        title: "Layout renamed",
        description: `Renamed to "${newName}"`,
        variant: "success",
        duration: 2000,
      });
    } else {
      toast({
        title: "Failed to rename layout",
        variant: "error",
        duration: 3000,
      });
    }
  }, [toast]);
  
  // Copies a share link to the clipboard.
  const handleExportCode = useCallback(async () => {
    try {
      await copyShareLink(encodeDesign(inputPlacements, targetPlacements, groundTiles));
      toast({
        title: "Share link copied!",
        description: "Paste this link in Discord or share with others",
        variant: "success",
        duration: 3000,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Failed to encode design",
        variant: "error",
        duration: 5000,
      });
    }
  }, [inputPlacements, targetPlacements, groundTiles, toast]);
  
  // Opens the layout in the Simulator via router state.
  const handleSimulate = useCallback(() => {
    const nameOf = (id: string) => getMutationDef(id)?.name || getCropDef(id)?.name || id.replace(/_/g, " ");
    const layout = makeIncomingLayout({ inputs: inputPlacements, targets: targetPlacements, groundTiles }, "designer", nameOf, "Designer layout");
    navigate("/simulator", { state: simulatorHandoffState(layout) });
  }, [inputPlacements, targetPlacements, groundTiles, getCropDef, getMutationDef, navigate]);

  const getExportOptions = useCallback((): ExportOptions => {
    const inputCrops = aggregateCropInfo(inputPlacements);
    const targetCrops = aggregateCropInfo(targetPlacements);
    
    return {
      scale: 2,
      includeWatermark: true,
      watermarkUrl: "greenhouse.skyshards.com",
      watermarkTitle: "Greenhouse Designer",
      inputCrops,
      targetCrops,
      showTargets,
    };
  }, [inputPlacements, targetPlacements, showTargets]);
  
  const handleSelectExportFormat = useCallback(async (format: ExportFormat) => {
    if (!gridRef?.current) {
      toast({
        title: "Export failed",
        description: "Grid not available for export",
        variant: "error",
        duration: 3000,
      });
      return;
    }
    
    const gridElement = gridRef.current.getGridElement();
    if (!gridElement) {
      toast({
        title: "Export failed",
        description: "Grid element not found",
        variant: "error",
        duration: 3000,
      });
      return;
    }
    
    setExportFormat(format);
    setExportStep("exporting");
    setExportProgress(0);
    setHasExportedOnce(true);
    // A list highlight would fade most of the exported grid: drop it and let the grid repaint first.
    if (placementFocus.active) {
      placementFocus.clear();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    
    try {
      const options = getExportOptions();
      let result;
      
      if (format === "png") {
        result = await captureGridAsPng(gridElement, options);
        setCurrentExportBlob(result.blob);
        setExportStep("choose-action");
      } else {
        // GIFs are downloaded directly; browsers do not reliably copy them.
        const cropIds = [
          ...inputPlacements.map(p => p.cropId),
          ...(showTargets ? targetPlacements.map(p => p.cropId) : []),
        ];
        result = await captureGridAsGif(gridElement, options, cropIds, setExportProgress);
        
        const filename = `SkyShards-designer-${Date.now()}.gif`;
        downloadBlob(result.blob, filename);
        
        toast({
          title: "GIF Downloaded!",
          description: `Saved as ${filename}`,
          variant: "success",
          duration: 3000,
        });
        resetExportState();
      }
    } catch (err) {
      console.error("Export failed:", err);
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Failed to capture grid",
        variant: "error",
        duration: 5000,
      });
      resetExportState();
    }
  }, [gridRef, getExportOptions, inputPlacements, targetPlacements, showTargets, toast, resetExportState, placementFocus]);
  
  const handleDownload = useCallback(() => {
    if (!currentExportBlob) return;
    
    const filename = `SkyShards-designer-${Date.now()}.${exportFormat}`;
    downloadBlob(currentExportBlob, filename);
    
    toast({
      title: "Downloaded!",
      description: `Saved as ${filename}`,
      variant: "success",
      duration: 3000,
    });
    resetExportState();
  }, [currentExportBlob, exportFormat, toast, resetExportState]);
  
  const handleCopyToClipboard = useCallback(async () => {
    if (!currentExportBlob) return;
    
    const success = await copyBlobToClipboard(currentExportBlob);
    
    if (success) {
      toast({
        title: "Copied to clipboard!",
        description: "PNG image copied successfully",
        variant: "success",
        duration: 3000,
      });
      resetExportState();
    } else {
      // Fall back to a download.
      toast({
        title: "Clipboard not supported",
        description: "Downloading image instead...",
        variant: "warning",
        duration: 3000,
      });
      handleDownload();
    }
  }, [currentExportBlob, toast, resetExportState, handleDownload]);
  
  const totalPlacements = inputPlacements.length + targetPlacements.length + groundTiles.length;
  
  const buttonVariants = {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 20 },
  };
  
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Action Buttons */}
      <div className="space-y-2">
      <div className="text-xs text-slate-400 uppercase tracking-wider">Save & Share</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleOpenSave}
          disabled={totalPlacements === 0}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800/60 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:bg-slate-700/60 hover:border-slate-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-4 h-4" />
          Save
        </button>
        
        <button
          onClick={handleOpenLoad}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800/60 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:bg-slate-700/60 hover:border-slate-500/50 transition-colors"
          title="From your saved layouts, the last Calculator result, or paste a share link"
        >
          <FolderOpen className="w-4 h-4" />
          Load
        </button>
        
        <button
          onClick={handleExportCode}
          disabled={totalPlacements === 0}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800/60 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:bg-slate-700/60 hover:border-slate-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Share2 className="w-4 h-4" />
          Share Layout
        </button>
        
        <button
          onClick={handleSimulate}
          disabled={totalPlacements === 0}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-sm text-amber-300 hover:bg-amber-500/30 hover:border-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Run this layout in the Simulator"
        >
          <FlaskConical className="w-4 h-4" />
          Simulate
        </button>
      </div>
      </div>
      
      {/* Export Image Section */}
      <div className="space-y-2">
        <div className="text-xs text-slate-400 uppercase tracking-wider">Export Image</div>
        <div className="grid grid-cols-2 gap-2 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {exportStep === "choose-format" && (
              <>
                <motion.button
                  key="png-btn"
                  variants={buttonVariants}
                  initial={hasExportedOnce ? "initial" : false}
                  animate="animate"
                  exit="exit"
                  onClick={() => handleSelectExportFormat("png")}
                  disabled={totalPlacements === 0}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/20 border border-blue-500/30 rounded-lg text-sm text-blue-300 hover:bg-blue-500/30 hover:border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Image className="w-4 h-4" />
                  PNG
                </motion.button>
                
                <motion.button
                  key="gif-btn"
                  variants={buttonVariants}
                  initial={hasExportedOnce ? "initial" : false}
                  animate="animate"
                  exit="exit"
                  onClick={() => handleSelectExportFormat("gif")}
                  disabled={totalPlacements === 0}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg text-sm text-purple-300 hover:bg-purple-500/30 hover:border-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Film className="w-4 h-4" />
                  GIF
                </motion.button>
              </>
            )}
            
            {exportStep === "exporting" && (
              <motion.div
                key="exporting"
                variants={buttonVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="col-span-2 flex flex-col items-center justify-center gap-2 px-3 py-3 bg-slate-800/60 border border-slate-600/50 rounded-lg"
              >
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Exporting {exportFormat?.toUpperCase()}...</span>
                </div>
                {exportFormat === "gif" && (
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                    <div 
                      className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${exportProgress}%` }}
                    />
                  </div>
                )}
              </motion.div>
            )}
            
            {exportStep === "choose-action" && (
              <>
                <motion.button
                  key="clipboard-btn"
                  variants={buttonVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  onClick={handleCopyToClipboard}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-500/50 transition-colors"
                >
                  <ClipboardCopy className="w-4 h-4" />
                  Copy
                </motion.button>
                
                <motion.button
                  key="download-btn"
                  variants={buttonVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-sm text-amber-300 hover:bg-amber-500/30 hover:border-amber-500/50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download
                </motion.button>
                
                <motion.button
                  key="cancel-btn"
                  variants={buttonVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  onClick={resetExportState}
                  className="col-span-2 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </motion.button>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
      
      {/* Transform: nudge / rotate / mirror the whole layout */}
      <div className="space-y-2">
        <div className="text-xs text-slate-400 uppercase tracking-wider">Transform</div>
        <LayoutTransformControls />
      </div>

      {/* Clear Buttons */}
      <div className="space-y-2">
        <div className="text-xs text-slate-400 uppercase tracking-wider">Clear</div>
        <LayoutClearControls />
      </div>
      
      {/* Save Layout Modal */}
      <SaveLayoutModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveLayout}
        existingLayouts={savedLayouts.map(l => ({ id: l.id, name: l.name }))}
      />
      
      {/* Load Layout Modal */}
      <LoadLayoutModal
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        onLoad={handleLoadLayout}
        onDelete={handleDeleteLayout}
        onRename={handleRenameLayout}
        layouts={savedLayouts}
        replacing={totalPlacements > 0}
      />
    </div>
  );
};
