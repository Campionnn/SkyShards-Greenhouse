// The Designer's page actions as hooks and helpers (research/designer-v2, the approved mockup's MockLib):
// the Ctrl+Z listener, Save / Load / Rename / Delete on the browser's saved layouts, loading a layout as
// one undo step, Share, Simulate, what the PNG / GIF export draws, and which popover of the rail or the
// phone toolbar is open. The components are DesignerActions.tsx, LayoutTools.tsx, ExportPopover.tsx,
// SharePopover.tsx and PhoneToolbar.tsx (react-refresh: a .tsx file exports components only).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDesigner, useGreenhouseData } from "../../context";
import { useToast } from "../ui/toastContext";
import { decodeDesign, encodeDesign, LocalStorageManager, makeIncomingLayout, simulatorHandoffState, type GroundTile } from "../../utilities";
import { aggregateCropInfo, type ExportOptions } from "../../utilities/gridExport";
import { deleteLayout, generateLayoutId, loadLayouts, renameLayout, restoreLayout, saveLayouts, updateLayout } from "../../utilities/layoutStorage";
import type { OptimizedPlacement, SavedLayout } from "../../types/layout";

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** The shortcut modifier as the tooltips show it. */
export const MOD = IS_MAC ? "⌘" : "Ctrl";
export const UNDO_KEYS = [MOD, "Z"];
export const REDO_KEYS = [MOD, "Shift", "Z"];

/** A layout as the Designer loads it. */
export interface LoadableLayout {
  inputs: OptimizedPlacement[];
  targets: OptimizedPlacement[];
  groundTiles: GroundTile[];
}

/** What DesignerActions hands the page (onReady): the empty grid's start card opens Load or loads the last Calculator result. */
export interface DesignerActionsApi {
  openLoad(): void;
  openSave(): void;
  /** The Load modal's own load: one undo step, the "Layout loaded" / "Layout replaced" toast (with Undo when replacing). */
  loadLayout(layout: LoadableLayout, name: string): void;
}

// ---- Keyboard ---------------------------------------------------------------------------------------

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/**
 * Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z and Ctrl+Y redo (D17). Ignored in text fields and with Alt. Mount it
 * once per DesignerProvider: the buttons can render in several places, the listener must not.
 */
export function useLayoutHistoryKeys(enabled = true) {
  const { undo, redo } = useDesigner();
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      const wantsRedo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
      const wantsUndo = key === "z" && !e.shiftKey;
      if (!wantsUndo && !wantsRedo) return;
      e.preventDefault();
      if (wantsRedo) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, undo, redo]);
}

// ---- Names ------------------------------------------------------------------------------------------

export function useNameOf() {
  const { getCropDef, getMutationDef } = useGreenhouseData();
  return useCallback((id: string) => getMutationDef(id)?.name || getCropDef(id)?.name || id.replace(/_/g, " "), [getCropDef, getMutationDef]);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---- The last Calculator result (D81) ---------------------------------------------------------------

export interface LastCalculatorLayout {
  name: string;
  savedAt: number;
  layout: LoadableLayout;
}

/** The Calculator's last result (`skyshards-last-solver-layout`), decoded; null when missing or unreadable. */
export function readLastCalculatorLayout(): LastCalculatorLayout | null {
  const last = LocalStorageManager.loadLastSolverLayout();
  if (!last) return null;
  try {
    const d = decodeDesign(last.code);
    return { name: last.name || "Last Calculator result", savedAt: last.savedAt, layout: { inputs: d.inputs, targets: d.targets, groundTiles: d.groundTiles } };
  } catch {
    return null;
  }
}

/** The last Calculator result, read once (the Calculator writes it on another page). */
export function useLastCalculatorLayout(): LastCalculatorLayout | null {
  const [last] = useState(readLastCalculatorLayout);
  return last;
}

// ---- Save / Load / Share / Simulate -------------------------------------------------------------------

/** The rail's and the phone toolbar's actions on the real state and the browser's saved layouts (D04–D07, D56–D72). */
export function useLayoutActions() {
  const { inputPlacements, targetPlacements, groundTiles, loadFromSolverResult, undo } = useDesigner();
  const { getCropDef, getMutationDef } = useGreenhouseData();
  const { toast } = useToast();
  const navigate = useNavigate();
  const nameOf = useNameOf();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saved, setSaved] = useState<SavedLayout[]>([]);
  const total = inputPlacements.length + targetPlacements.length + groundTiles.length;
  const refresh = useCallback(() => setSaved(loadLayouts()), []);
  const undoAction = useMemo(() => ({ label: "Undo", onClick: () => void undo() }), [undo]);

  const openSave = useCallback(() => {
    if (total === 0) return; // the button is disabled then
    refresh(); // for the overwrite check
    setSaveOpen(true);
  }, [total, refresh]);

  // Opens with nothing saved too: it also offers the last Calculator result and a paste box.
  const openLoad = useCallback(() => {
    refresh();
    setLoadOpen(true);
  }, [refresh]);

  /** One undo step (D71); "Layout replaced" carries Undo. Clears the crop and ground pick (loadFromSolverResult). */
  const loadLayout = useCallback(
    (layout: LoadableLayout, name: string) => {
      const sized = (ps: OptimizedPlacement[], target: boolean) =>
        ps.map((p) => {
          const crop = getCropDef(p.cropId);
          const mutation = getMutationDef(p.cropId);
          const def = target ? (mutation ?? crop) : (crop ?? mutation);
          return { id: p.cropId, name: def?.name || p.cropId.replace(/_/g, " "), position: p.position, size: def?.size || 1 };
        });
      const had = total > 0;
      loadFromSolverResult(sized(layout.inputs, false), sized(layout.targets, true), layout.groundTiles);
      setLoadOpen(false);
      toast({ title: had ? "Layout replaced" : "Layout loaded", description: name, variant: "success", duration: had ? 5000 : 3000, action: had ? undoAction : undefined });
    },
    [getCropDef, getMutationDef, loadFromSolverResult, toast, total, undoAction],
  );

  const onSave = useCallback(
    (name: string, overwriteId?: string) => {
      const now = Date.now();
      const cells = {
        groundTiles,
        inputs: inputPlacements.map((p) => ({ cropId: p.cropId, position: p.position })),
        targets: targetPlacements.map((p) => ({ cropId: p.cropId, position: p.position })),
      };
      if (overwriteId) {
        // Keeps the layout's id and savedAt (D58).
        if (updateLayout(overwriteId, { name, modifiedAt: now, ...cells })) {
          setSaveOpen(false);
          toast({ title: "Layout updated", description: `"${name}" has been updated`, variant: "success", duration: 3000 });
        } else toast({ title: "Failed to update layout", variant: "error", duration: 3000 });
        return;
      }
      const layouts = loadLayouts();
      layouts.push({ id: generateLayoutId(), name, savedAt: now, modifiedAt: now, ...cells });
      saveLayouts(layouts);
      setSaveOpen(false);
      toast({ title: "Layout saved", description: `"${name}" has been saved`, variant: "success", duration: 3000 });
    },
    [groundTiles, inputPlacements, targetPlacements, toast],
  );

  const onRename = useCallback(
    (id: string, name: string) => {
      if (renameLayout(id, name)) {
        refresh();
        toast({ title: "Layout renamed", description: `Renamed to "${name}"`, variant: "success", duration: 2000 });
      } else toast({ title: "Failed to rename layout", variant: "error", duration: 3000 });
    },
    [refresh, toast],
  );

  /**
   * One click deletes (D67, decisions.md G3/G4: no click-twice). The toast's Undo puts the same layout
   * (id, savedAt, modifiedAt) back at the same place in the list; it stays at least 10s.
   */
  const onDelete = useCallback(
    (id: string) => {
      const before = loadLayouts();
      const index = before.findIndex((l) => l.id === id);
      const layout = before[index];
      if (!layout || !deleteLayout(id)) {
        toast({ title: "Failed to delete layout", variant: "error", duration: 3000 });
        return;
      }
      refresh();
      toast({
        title: "Layout deleted",
        description: layout.name,
        variant: "success",
        action: {
          label: "Undo",
          onClick: () => {
            restoreLayout(layout, index);
            refresh();
          },
        },
      });
    },
    [refresh, toast],
  );

  /** The layout's share code (encodeDesign); Share turns it into the link and copies it. */
  const shareCode = useCallback(() => encodeDesign(inputPlacements, targetPlacements, groundTiles), [inputPlacements, targetPlacements, groundTiles]);

  /** The Simulator with this layout (D07): its name is the target summary, else "Designer layout". */
  const simulate = useCallback(() => {
    const layout = makeIncomingLayout({ inputs: inputPlacements, targets: targetPlacements, groundTiles }, "designer", nameOf, "Designer layout");
    navigate("/simulator", { state: simulatorHandoffState(layout) });
  }, [inputPlacements, targetPlacements, groundTiles, nameOf, navigate]);

  return {
    total,
    empty: total === 0,
    saveOpen,
    loadOpen,
    closeSave: useCallback(() => setSaveOpen(false), []),
    closeLoad: useCallback(() => setLoadOpen(false), []),
    saved,
    openSave,
    openLoad,
    loadLayout,
    onSave,
    onRename,
    onDelete,
    shareCode,
    simulate,
  };
}
export type LayoutActions = ReturnType<typeof useLayoutActions>;

/** A stable API for the page: the functions always call the latest actions. */
export function useActionsApi(actions: LayoutActions): DesignerActionsApi {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  return useMemo(
    () => ({
      openLoad: () => latest.current.openLoad(),
      openSave: () => latest.current.openSave(),
      loadLayout: (layout: LoadableLayout, name: string) => latest.current.loadLayout(layout, name),
    }),
    [],
  );
}

// ---- Export -------------------------------------------------------------------------------------------

/** What the PNG / GIF export draws (D10): 2×, the "Greenhouse Designer" watermark; targets are listed even when hidden. */
export function useExportOptions(showTargets: boolean): () => ExportOptions {
  const { inputPlacements, targetPlacements } = useDesigner();
  return useCallback(
    () => ({
      scale: 2,
      includeWatermark: true,
      watermarkUrl: "greenhouse.skyshards.com",
      watermarkTitle: "Greenhouse Designer",
      inputCrops: aggregateCropInfo(inputPlacements),
      targetCrops: aggregateCropInfo(targetPlacements),
      showTargets,
    }),
    [inputPlacements, targetPlacements, showTargets],
  );
}

/** The crops a GIF animates: the inputs, and the targets when they are shown. */
export function useExportCropIds(showTargets: boolean): () => string[] {
  const { inputPlacements, targetPlacements } = useDesigner();
  return useCallback(() => [...inputPlacements.map((p) => p.cropId), ...(showTargets ? targetPlacements.map((p) => p.cropId) : [])], [inputPlacements, targetPlacements, showTargets]);
}

export const twoFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * After clearing a list highlight, waits until the grid has repainted and the fade back (placementStyles
 * FOCUS_TRANSITION, 150ms) has finished, so a capture right after a pin isn't half-faded.
 */
export async function focusSettled() {
  await twoFrames();
  await new Promise((r) => setTimeout(r, 170));
}

/** Waits (up to `ms`) for the grid's images, so the capture doesn't miss a crop that is still loading. */
export async function imagesReady(el: HTMLElement, ms = 4000) {
  const t = Date.now();
  while ([...el.querySelectorAll("img")].some((i) => !i.complete) && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100));
}

// ---- Popovers of the rail and the phone toolbar ------------------------------------------------------------

export type ActionPop = "share" | "export" | "gif" | "clear" | "transform" | "more";

/**
 * Which popover is open and the button it hangs from. `open(p)` toggles; `open(p, via)` anchors it to
 * another button (the phone's More → Transform, its one Export button → GIF). `initialPop` opens one on
 * load (the `#pop=` screenshot states: share | export | png | gif | clear | transform).
 */
export function useActionPops(initialPop?: string) {
  const [pop, setPop] = useState<ActionPop | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const refs = useRef<Partial<Record<ActionPop, HTMLElement | null>>>({});
  const ref = useCallback(
    (k: ActionPop) => (el: HTMLElement | null) => {
      refs.current[k] = el;
    },
    [],
  );
  const open = useCallback((p: ActionPop, via: ActionPop = p) => {
    setPop((cur) => {
      if (cur === p) return null;
      setAnchor(refs.current[via] ?? null);
      return p;
    });
  }, []);
  const close = useCallback(() => setPop(null), []);
  useEffect(() => {
    const p = initialPop === "png" ? "export" : initialPop;
    if (!p || !["share", "export", "gif", "clear", "transform"].includes(p)) return;
    const k = p as ActionPop;
    // Once the anchors exist (the phone's one Export button serves GIF too; Transform hangs from More there).
    const id = window.setTimeout(() => {
      const el = refs.current[k] ?? (k === "transform" ? refs.current.more : k === "gif" ? refs.current.export : null);
      if (!el) return;
      setAnchor(el);
      setPop(k);
    }, 250);
    return () => window.clearTimeout(id);
  }, [initialPop]);
  return { pop, anchor, ref, open, close };
}
export type ActionPops = ReturnType<typeof useActionPops>;
