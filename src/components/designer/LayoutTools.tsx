import React, { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Eraser, FlipHorizontal2, FlipVertical2, Redo2, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useDesigner } from "../../context";
import { useToast } from "../ui/toastContext";
import { KitButton } from "../ui/kit";
import { KitTooltip } from "../ui/Hint";
import { MenuItem, MenuLabel, MenuSeparator, Popover } from "../ui/Popover";
import { cn } from "../ui/cn";
import { canNudge, describeTransform, type LayoutTransform } from "../../utilities";
import { REDO_KEYS, UNDO_KEYS, useLayoutHistoryKeys } from "./actionsModel";

// Whole-layout tools for the Designer page and the simulator's step layout editor (LayoutWorkspace):
// Undo / Redo, the Transform toolbar (nudge, rotate, mirror) and the Clear menu. They act on the nearest
// DesignerProvider. Looks: research/designer-v2 (the approved mockup's HistoryButtons, TransformBar and
// ClearItems).

/**
 * A control's name, its shortcut (Kbd chips) and one line of hint, on hover and keyboard focus
 * (the kit's KitTooltip). It wraps the control, so a disabled button still says why.
 */
export const ActionTip: React.FC<{ label: string; kbd?: string[]; hint?: string; side?: "right" | "bottom" | "top"; className?: string; children: React.ReactNode }> = ({
  label,
  kbd,
  hint,
  side = "right",
  className,
  children,
}) => (
  <KitTooltip label={label} kbd={kbd} hint={hint} side={side} className={className}>
    {children}
  </KitTooltip>
);

// ---- Undo / Redo ----------------------------------------------------------------------------------------

/**
 * Undo and Redo as two labelled buttons (the shortcut is in the tooltip). With `keys` (the default) it
 * also owns Ctrl/⌘+Z, Ctrl/⌘+Shift+Z and Ctrl+Y; pass `keys={false}` where something else mounts
 * `useLayoutHistoryKeys()`, so exactly one listener runs per provider.
 */
export const LayoutHistoryControls: React.FC<{ className?: string; keys?: boolean }> = ({ className, keys = true }) => {
  const { undo, redo, canUndo, canRedo } = useDesigner();
  useLayoutHistoryKeys(keys);
  return (
    <div role="group" aria-label="Undo and redo" className={cn("grid grid-cols-2 gap-1", className)}>
      <ActionTip label="Undo" kbd={UNDO_KEYS}>
        <KitButton aria-label="Undo" disabled={!canUndo} onClick={undo} className="w-full px-2">
          <Undo2 /> Undo
        </KitButton>
      </ActionTip>
      <ActionTip label="Redo" kbd={REDO_KEYS}>
        <KitButton aria-label="Redo" disabled={!canRedo} onClick={redo} className="w-full px-2">
          <Redo2 /> Redo
        </KitButton>
      </ActionTip>
    </div>
  );
};

// ---- Transform --------------------------------------------------------------------------------------------

interface LayoutToolsProps {
  className?: string;
  /** Show a toast after each transform (off keeps rapid nudging quiet). */
  toastOnTransform?: boolean;
  /** 44px segments (a phone popover). */
  touch?: boolean;
}

/**
 * Nudge, and rotate / mirror, as one joined toolbar of two rows of four (D11). Each segment has its name
 * as aria-label and tooltip. Rotate and mirror are off on an empty layout; a nudge is off when something
 * would leave the grid; a ground-only layout can always nudge, and tiles that fall off are dropped (D12).
 */
export const LayoutTransformControls: React.FC<LayoutToolsProps> = ({ className, toastOnTransform = false, touch }) => {
  const { inputPlacements, targetPlacements, groundTiles, transformLayout } = useDesigner();
  const { toast } = useToast();
  const pieces = [...inputPlacements, ...targetPlacements];
  const empty = pieces.length === 0 && groundTiles.length === 0;
  const nudgeOk = (dRow: number, dCol: number) => (pieces.length === 0 ? groundTiles.length > 0 : canNudge(pieces, dRow, dCol));

  const apply = useCallback(
    (t: LayoutTransform) => {
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
    },
    [transformLayout, toast, toastOnTransform],
  );

  const seg = (t: LayoutTransform, off: boolean, label: string, icon: React.ReactNode) => (
    <ActionTip key={label} label={label} hint={off && t.kind === "nudge" && pieces.length ? "Something would leave the grid" : undefined} className="min-w-0 flex-1">
      <button
        type="button"
        aria-label={label}
        disabled={off}
        onClick={() => apply(t)}
        className={cn(
          "focus-ring-inset flex w-full min-w-0 cursor-pointer items-center justify-center text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-3.5",
          touch ? "h-11" : "h-7 pointer-coarse:h-11",
        )}
      >
        {icon}
      </button>
    </ActionTip>
  );
  const nudge = (dRow: number, dCol: number, dir: string, icon: React.ReactNode) => seg({ kind: "nudge", dRow, dCol }, !nudgeOk(dRow, dCol), `Nudge ${dir} one cell`, icon);
  const row = "flex divide-x divide-line";

  return (
    <div role="toolbar" aria-label="Transform" className={cn("divide-y divide-line overflow-hidden rounded-control border border-line-strong bg-surface-control", className)}>
      <div role="group" aria-label="Nudge" className={row}>
        {nudge(0, -1, "left", <ArrowLeft />)}
        {nudge(-1, 0, "up", <ArrowUp />)}
        {nudge(1, 0, "down", <ArrowDown />)}
        {nudge(0, 1, "right", <ArrowRight />)}
      </div>
      <div role="group" aria-label="Rotate / mirror" className={row}>
        {seg({ kind: "rotate", direction: "ccw" }, empty, "Rotate 90° counter-clockwise", <RotateCcw />)}
        {seg({ kind: "rotate", direction: "cw" }, empty, "Rotate 90° clockwise", <RotateCw />)}
        {seg({ kind: "mirror", axis: "horizontal" }, empty, "Mirror left to right", <FlipHorizontal2 />)}
        {seg({ kind: "mirror", axis: "vertical" }, empty, "Mirror top to bottom", <FlipVertical2 />)}
      </div>
    </div>
  );
};

// ---- Clear ------------------------------------------------------------------------------------------------

/**
 * The Clear menu's items: Inputs / Targets / Ground with their counts, then Everything. Each clears at
 * once as one undo step, with an Undo toast (D14, D15; Everything replaces the click-twice "All").
 */
export const ClearMenuItems: React.FC<{ close: () => void }> = ({ close }) => {
  const { inputPlacements, targetPlacements, groundTiles, clearInputPlacements, clearTargetPlacements, clearGroundTiles, clearAllPlacements, undo } = useDesigner();
  const { toast } = useToast();
  const run = (fn: () => void, title: string) => () => {
    fn();
    close();
    toast({ title, variant: "success", duration: 4000, action: { label: "Undo", onClick: () => void undo() } });
  };
  const total = inputPlacements.length + targetPlacements.length + groundTiles.length;
  return (
    <>
      <MenuLabel>Clear</MenuLabel>
      <MenuItem icon={<Eraser />} hint={`${inputPlacements.length} placed`} disabled={!inputPlacements.length} onSelect={run(clearInputPlacements, "Input placements cleared")}>
        Inputs
      </MenuItem>
      <MenuItem icon={<Eraser />} hint={`${targetPlacements.length} placed`} disabled={!targetPlacements.length} onSelect={run(clearTargetPlacements, "Target placements cleared")}>
        Targets
      </MenuItem>
      <MenuItem icon={<Eraser />} hint={`${groundTiles.length} painted`} disabled={!groundTiles.length} onSelect={run(clearGroundTiles, "Ground tiles cleared")}>
        Ground
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 />} tone="danger" hint="Inputs, targets and ground · Undo brings it back" disabled={!total} onSelect={run(clearAllPlacements, "Layout cleared")}>
        Everything
      </MenuItem>
    </>
  );
};

/** "Clear ▾": a full-width button that opens the Clear menu. Disabled when the layout is empty. */
export const LayoutClearControls: React.FC<LayoutToolsProps & { defaultOpen?: boolean }> = ({ className, defaultOpen }) => {
  const { inputPlacements, targetPlacements, groundTiles } = useDesigner();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const empty = inputPlacements.length + targetPlacements.length + groundTiles.length === 0;
  // `#pop=clear` (screenshots): open once the button exists.
  useEffect(() => {
    if (defaultOpen && anchor) setOpen(true);
  }, [defaultOpen, anchor]);
  return (
    <>
      <ActionTip label="Clear" hint={empty ? "Nothing to clear" : "Inputs, targets, ground or everything"} className={cn("flex", className)}>
        <KitButton
          ref={setAnchor}
          disabled={empty}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn("w-full justify-between px-2", open && "bg-surface-hover text-fg")}
        >
          <span className="inline-flex items-center gap-1.5">
            <Eraser className="size-3.5" /> Clear
          </span>
          <ChevronDown className={cn("size-3.5 text-fg-meta transition-transform duration-(--duration-ink)", open && "rotate-180")} />
        </KitButton>
      </ActionTip>
      <Popover anchor={anchor} open={open && !empty} onClose={() => setOpen(false)} label="Clear" role="menu" width={260}>
        <ClearMenuItems close={() => setOpen(false)} />
      </Popover>
    </>
  );
};
