import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDesigner, useGreenhouseData } from "../../../context";
import { useToast } from "../../ui/toastContext";
import { decodeDesign } from "../../../utilities";
import { LAYOUT_IMAGE_TITLE } from "../../../utilities/layoutImage";
import { blobToDataUrl, renderLayoutImage, toImagePlacements } from "../../../utilities/layoutImageBrowser";

/**
 * Window hooks for tooling (research/designer-v2/verify, screenshots): `window.loadLayoutFromCode(code)`,
 * `window.layoutLoadState` ("pending" | "loaded" | "error" | "no-layout") and `window.exportGrid()`, which
 * returns the layout image (layoutImage.ts) as a PNG data URL. Share embeds no longer use them: the API
 * draws the same image itself (tools/share-render, no browser). Also loads `?layout=<code>` once, after
 * the greenhouse data.
 */
export function useDesignerPageHooks() {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { inputPlacements, targetPlacements, groundTiles, loadFromSolverResult } = useDesigner();
  const { getCropDef, getMutationDef, isLoading: isDataLoading } = useGreenhouseData();
  const [hasLoadedFromUrl, setHasLoadedFromUrl] = useState(false);

  const exportGrid = useCallback(async (): Promise<string> => {
    const groundOf = (id: string) => getCropDef(id)?.ground || getMutationDef(id)?.ground || "farmland";
    const { blob, url } = await renderLayoutImage({ title: LAYOUT_IMAGE_TITLE, placements: toImagePlacements(inputPlacements, targetPlacements, groundOf), groundTiles });
    URL.revokeObjectURL(url);
    return blobToDataUrl(blob);
  }, [inputPlacements, targetPlacements, groundTiles, getCropDef, getMutationDef]);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.exportGrid = exportGrid;
    return () => {
      delete w.exportGrid;
    };
  }, [exportGrid]);
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
