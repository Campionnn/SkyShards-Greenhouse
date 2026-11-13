import { useCallback, useEffect, useState, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { useDesigner, useGreenhouseData } from "../../../context";
import { useToast } from "../../ui/toastContext";
import { decodeDesign } from "../../../utilities";
import { captureGridAsPng, aggregateCropInfo } from "../../../utilities/gridExport";
import type { DesignerGridHandle } from "../DesignerGrid";

/**
 * The share-image renderer's contract (SkyShards-API utils/image_generator.py, D73–D77). It opens
 * /designer at 1200×900, waits for `[data-grid-container]`, then calls `window.loadLayoutFromCode(code)`,
 * waits for `window.layoutLoadState !== "pending"`, and calls `window.exportGrid()` for a PNG data URL.
 * Keep the names, the return shapes and the "Failed to decode design" error text.
 * Also loads `?layout=<code>` once, after the greenhouse data (D73).
 */
export function useDesignerPageHooks(gridRef: RefObject<DesignerGridHandle | null>, showTargets: boolean) {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { inputPlacements, targetPlacements, loadFromSolverResult } = useDesigner();
  const { getCropDef, getMutationDef, isLoading: isDataLoading } = useGreenhouseData();
  const [hasLoadedFromUrl, setHasLoadedFromUrl] = useState(false);

  // Share image, called by the renderer via window.exportGrid.
  const exportGridForShare = useCallback(async (): Promise<string> => {
    if (!gridRef.current) throw new Error("Grid not available");
    const gridElement = gridRef.current.getGridElement();
    if (!gridElement) throw new Error("Grid element not found");

    // Crop info for the watermark.
    const inputCrops = aggregateCropInfo(
      inputPlacements.map((p) => {
        const def = getCropDef(p.cropId) || getMutationDef(p.cropId);
        return { cropId: p.cropId, cropName: def?.name || p.cropId.replace(/_/g, " ") };
      }),
    );
    // Target crops always count, even when hidden.
    const targetCrops = aggregateCropInfo(
      targetPlacements.map((p) => {
        const def = getMutationDef(p.cropId) || getCropDef(p.cropId);
        return { cropId: p.cropId, cropName: def?.name || p.cropId.replace(/_/g, " ") };
      }),
    );
    const result = await captureGridAsPng(gridElement, {
      scale: 2, // Discord targets ~800px; larger images get heavily compressed.
      includeWatermark: true,
      watermarkUrl: "greenhouse.skyshards.com",
      watermarkTitle: "Greenhouse Designer",
      inputCrops,
      targetCrops,
      showTargets,
    });
    return result.dataUrl;
  }, [gridRef, inputPlacements, targetPlacements, showTargets, getCropDef, getMutationDef]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.exportGrid = exportGridForShare;
    return () => {
      delete w.exportGrid;
    };
  }, [exportGridForShare]);

  // Layout load state, read by the renderer via window.layoutLoadState. It's written to window at once
  // as well as through the effect below: the renderer polls right after loadLayoutFromCode settles, and a
  // state that only lands on the next render would still read the previous one ("error" after a bad code).
  const [layoutLoadState, setLayoutLoadStateRaw] = useState<"pending" | "loaded" | "error" | "no-layout">("pending");
  const setLayoutLoadState = useCallback((s: "pending" | "loaded" | "error" | "no-layout") => {
    (window as unknown as Record<string, unknown>).layoutLoadState = s;
    setLayoutLoadStateRaw(s);
  }, []);

  const loadLayoutFromCode = useCallback(
    async (layoutCode: string) => {
      if (!layoutCode) {
        setLayoutLoadState("no-layout");
        throw new Error("No layout code provided");
      }
      setLayoutLoadState("pending");
      try {
        const { inputs, targets, groundTiles } = decodeDesign(layoutCode);
        const crops = inputs.map((p) => {
          const cropDef = getCropDef(p.cropId);
          const mutationDef = getMutationDef(p.cropId);
          return { id: p.cropId, name: cropDef?.name || mutationDef?.name || p.cropId.replace(/_/g, " "), position: p.position, size: cropDef?.size || mutationDef?.size || 1 };
        });
        const mutations = targets.map((p) => {
          const mutationDef = getMutationDef(p.cropId);
          const cropDef = getCropDef(p.cropId);
          return { id: p.cropId, name: mutationDef?.name || cropDef?.name || p.cropId.replace(/_/g, " "), position: p.position, size: mutationDef?.size || cropDef?.size || 1 };
        });
        loadFromSolverResult(crops, mutations, groundTiles);
        setLayoutLoadState("loaded");
        return { inputs: crops, targets: mutations };
      } catch (err) {
        setLayoutLoadState("error");
        throw err;
      }
    },
    [getCropDef, getMutationDef, loadFromSolverResult, setLayoutLoadState],
  );

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.loadLayoutFromCode = loadLayoutFromCode;
    return () => {
      delete w.loadLayoutFromCode;
    };
  }, [loadLayoutFromCode]);

  // Load the ?layout= share code once, after the greenhouse data has loaded.
  useEffect(() => {
    if (isDataLoading || hasLoadedFromUrl) return;
    const layoutCode = searchParams.get("layout");
    if (!layoutCode) {
      setLayoutLoadState("no-layout");
      setHasLoadedFromUrl(true);
      return;
    }
    loadLayoutFromCode(layoutCode)
      .then(({ inputs, targets }) => {
        setHasLoadedFromUrl(true);
        toast({ title: "Layout loaded", description: `Loaded ${inputs.length} inputs and ${targets.length} targets from shared link`, variant: "success", duration: 3000 });
      })
      .catch((err) => {
        setHasLoadedFromUrl(true);
        toast({ title: "Failed to load layout", description: err instanceof Error ? err.message : "Invalid layout code in URL", variant: "error", duration: 5000 });
      });
  }, [searchParams, isDataLoading, hasLoadedFromUrl, loadLayoutFromCode, toast, setLayoutLoadState]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.layoutLoadState = layoutLoadState;
    return () => {
      delete w.layoutLoadState;
    };
  }, [layoutLoadState]);
}
