import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FlipHorizontal2,
  FlipVertical2,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { useDesigner } from "../../context";
import { useToast } from "../ui/toastContext";
import { canNudge, describeTransform, type LayoutTransform } from "../../utilities";

// Layout-wide tools shared by the Designer page and the simulator's embedded
// stage editor: nudge / rotate / mirror the whole layout, and clear parts of
// it. Both read the nearest DesignerProvider, so they act on whichever layout
// they are mounted next to.

/** One icon button inside a joined ToolGroup: the group draws the border and dividers. */
const segmentButton =
  "flex-1 min-w-0 flex items-center justify-center text-slate-300 hover:bg-slate-700/70 hover:text-slate-100 active:bg-slate-600/70 disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-slate-700/70";

const clearButton =
  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800/60 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer";

interface LayoutToolsProps {
  className?: string;
  /** Show a toast after each transform (off keeps rapid nudging quiet). */
  toastOnTransform?: boolean;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

/** Typing somewhere keeps the browser's own text undo. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

const historyButton =
  "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 hover:text-slate-200 disabled:opacity-40 disabled:hover:bg-slate-700/30 disabled:hover:text-slate-300 disabled:cursor-not-allowed cursor-pointer";

/**
 * Undo / redo buttons for the nearest DesignerProvider, plus the keyboard
 * shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y). Mount one per provider.
 */
export const LayoutHistoryControls: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { undo, redo, canUndo, canRedo } = useDesigner();

  useEffect(() => {
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
  }, [undo, redo]);

  return (
    <div className={`flex items-center gap-1.5 ${className}`} role="group" aria-label="Undo and redo">
      <button type="button" className={historyButton} disabled={!canUndo} onClick={undo} title={`Undo (${MOD}+Z)`} aria-label="Undo">
        <Undo2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Undo</span>
      </button>
      <button type="button" className={historyButton} disabled={!canRedo} onClick={redo} title={`Redo (${MOD}+Shift+Z)`} aria-label="Redo">
        <Redo2 className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Redo</span>
      </button>
    </div>
  );
};

/** Nudge pad (arrows), rotate 90 degrees either way, mirror on either axis. */
export const LayoutTransformControls: React.FC<LayoutToolsProps> = ({ className = "", toastOnTransform = false }) => {
  const { inputPlacements, targetPlacements, groundTiles, transformLayout } = useDesigner();
  const { toast } = useToast();
  const pieces = [...inputPlacements, ...targetPlacements];
  const empty = pieces.length === 0 && groundTiles.length === 0;
  // Ground-only layouts can always nudge (tiles that fall off are dropped).
  const nudgeOk = (dRow: number, dCol: number) => (pieces.length === 0 ? groundTiles.length > 0 : canNudge(pieces, dRow, dCol));

  const apply = useCallback((t: LayoutTransform) => {
    const result = transformLayout(t);
    if (!result.success) {
      toast({ title: "Can't do that", description: result.error, variant: "warning", duration: 2500 });
      return;
    }
    if (result.droppedGround) {
      toast({
        title: describeTransform(t),
        description: `${result.droppedGround} ground tile${result.droppedGround === 1 ? "" : "s"} moved off the grid and were removed`,
        variant: "warning",
        duration: 3000,
      });
    } else if (toastOnTransform) {
      toast({ title: describeTransform(t), variant: "success", duration: 1500 });
    }
  }, [transformLayout, toast, toastOnTransform]);

  const tool = (t: LayoutTransform, disabled: boolean, label: string, icon: React.ReactNode) => (
    <button
      key={label}
      type="button"
      className={segmentButton}
      disabled={disabled}
      onClick={() => apply(t)}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
  const nudge = (dRow: number, dCol: number, dir: string, icon: React.ReactNode) =>
    tool({ kind: "nudge", dRow, dCol }, !nudgeOk(dRow, dCol), `Nudge ${dir} one cell`, icon);

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <ToolGroup caption="Nudge">
        {nudge(0, -1, "left", <ArrowLeft className="w-4 h-4" />)}
        {nudge(-1, 0, "up", <ArrowUp className="w-4 h-4" />)}
        {nudge(1, 0, "down", <ArrowDown className="w-4 h-4" />)}
        {nudge(0, 1, "right", <ArrowRight className="w-4 h-4" />)}
      </ToolGroup>
      <ToolGroup caption="Rotate / mirror">
        {tool({ kind: "rotate", direction: "ccw" }, empty, "Rotate 90° counter-clockwise", <RotateCcw className="w-4 h-4" />)}
        {tool({ kind: "rotate", direction: "cw" }, empty, "Rotate 90° clockwise", <RotateCw className="w-4 h-4" />)}
        {tool({ kind: "mirror", axis: "horizontal" }, empty, "Mirror left to right", <FlipHorizontal2 className="w-4 h-4" />)}
        {tool({ kind: "mirror", axis: "vertical" }, empty, "Mirror top to bottom", <FlipVertical2 className="w-4 h-4" />)}
      </ToolGroup>
    </div>
  );
};

/** A captioned row of joined icon buttons (one segmented control). */
const ToolGroup: React.FC<{ caption: string; children: React.ReactNode }> = ({ caption, children }) => (
  <div className="flex-1 min-w-[120px]" role="group" aria-label={caption}>
    <div className="text-[10px] text-slate-500 mb-1 select-none">{caption}</div>
    <div className="flex h-9 rounded-lg border border-slate-600/50 bg-slate-800/60 overflow-hidden divide-x divide-slate-600/50">{children}</div>
  </div>
);

/** Clear inputs / targets / ground, and clear everything (click twice). */
export const LayoutClearControls: React.FC<LayoutToolsProps> = ({ className = "" }) => {
  const {
    inputPlacements,
    targetPlacements,
    groundTiles,
    clearInputPlacements,
    clearTargetPlacements,
    clearGroundTiles,
    clearAllPlacements,
    undo,
  } = useDesigner();
  const { toast } = useToast();
  const [confirmAll, setConfirmAll] = useState(false);
  // Clearing by mistake is the easy one to regret: offer undo right on the toast.
  const undoAction = { label: "Undo", onClick: () => { undo(); } };
  const total = inputPlacements.length + targetPlacements.length + groundTiles.length;

  const clearAll = () => {
    if (!confirmAll) {
      setConfirmAll(true);
      return;
    }
    clearAllPlacements();
    setConfirmAll(false);
    toast({ title: "Layout cleared", variant: "success", duration: 4000, action: undoAction });
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <button
        type="button"
        className={clearButton}
        disabled={inputPlacements.length === 0}
        title="Remove every input crop"
        onClick={() => {
          clearInputPlacements();
          toast({ title: "Input placements cleared", variant: "success", duration: 4000, action: undoAction });
        }}
      >
        <RotateCcw className="w-4 h-4" /> Inputs
      </button>
      <button
        type="button"
        className={clearButton}
        disabled={targetPlacements.length === 0}
        title="Remove every target mutation"
        onClick={() => {
          clearTargetPlacements();
          toast({ title: "Target placements cleared", variant: "success", duration: 4000, action: undoAction });
        }}
      >
        <RotateCcw className="w-4 h-4" /> Targets
      </button>
      <button
        type="button"
        className={clearButton}
        disabled={groundTiles.length === 0}
        title="Erase all painted ground tiles"
        onClick={() => {
          clearGroundTiles();
          toast({ title: "Ground tiles cleared", variant: "success", duration: 4000, action: undoAction });
        }}
      >
        <RotateCcw className="w-4 h-4" /> Ground
      </button>
      <button
        type="button"
        onClick={clearAll}
        onBlur={() => setConfirmAll(false)}
        disabled={total === 0}
        className={`flex items-center justify-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          confirmAll
            ? "bg-red-500/80 text-white hover:bg-red-500 border-red-500"
            : "bg-slate-800/60 border-slate-600/50 text-slate-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300"
        }`}
        title={confirmAll ? "Click again to confirm" : "Clear everything (inputs, targets and ground)"}
      >
        <Trash2 className="w-4 h-4" /> {confirmAll ? "Confirm" : "All"}
      </button>
    </div>
  );
};
