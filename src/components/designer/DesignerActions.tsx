import React, { useCallback, useEffect, type RefObject } from "react";
import { Film, FlaskConical, FolderOpen, Image as ImageIcon, Save, Share2 } from "lucide-react";
import { KitButton } from "../ui/kit";
import { cn } from "../ui/cn";
import type { DesignerGridHandle } from "./DesignerGrid";
import { ActionTip, LayoutClearControls, LayoutHistoryControls, LayoutTransformControls } from "./LayoutTools";
import { SaveLayoutModal } from "./SaveLayoutModal";
import { LoadLayoutModal } from "./LoadLayoutModal";
import { SharePopover } from "./SharePopover";
import { ExportPopover } from "./ExportPopover";
import { PhoneToolbar } from "./PhoneToolbar";
import { useActionPops, useActionsApi, useExportCropIds, useExportOptions, useLayoutActions, type DesignerActionsApi } from "./actionsModel";

interface DesignerActionsProps {
  className?: string;
  /** The grid to export (a ref object; a callback ref can't be read, so it exports nothing). */
  gridRef?: React.Ref<DesignerGridHandle>;
  /** Whether the grid shows the targets (the export draws what the grid shows; its target list always counts them). */
  showTargets?: boolean;
  /**
   * `rail` (default): the desktop left rail, top to bottom: Undo · Redo | Save · Load, Share · Simulate,
   * PNG · GIF | Transform, Clear ▾. Natural height, no scroll of its own. `toolbar`: the phone's row of
   * eight 44px icons (one Export button; Transform and Simulate under More).
   */
  variant?: "rail" | "toolbar";
  /** The rail column: the Share and Export popovers open beside it. */
  railRef?: RefObject<HTMLElement | null>;
  /** Open a popover on load: share | export | png | gif | clear | transform (the `#pop=` screenshot states). */
  initialPop?: string;
  /** Hands the page the actions its empty-grid card needs (Load, Last Calculator result). */
  onReady?: (api: DesignerActionsApi) => void;
}

/**
 * The Designer's page actions (D04–D17): Undo / Redo (and their shortcut), Save, Load, Share, Simulate,
 * Export PNG / GIF, Transform and Clear, on the nearest DesignerProvider. It also renders the Save and
 * Load dialogs. Mount one per provider: it owns the Ctrl+Z listener.
 */
export const DesignerActions: React.FC<DesignerActionsProps> = ({ className, gridRef, showTargets = true, variant = "rail", railRef, initialPop, onReady }) => {
  const actions = useLayoutActions();
  const api = useActionsApi(actions);
  useEffect(() => {
    onReady?.(api);
  }, [onReady, api]);
  const pops = useActionPops(initialPop);
  const exportOptions = useExportOptions(showTargets);
  const cropIds = useExportCropIds(showTargets);
  const gridEl = useCallback(() => (gridRef && typeof gridRef === "object" ? (gridRef.current?.getGridElement() ?? null) : null), [gridRef]);
  const { pop, ref, open, close, anchor } = pops;
  const empty = actions.empty;

  const popovers = (
    <>
      <SharePopover anchor={anchor} beside={railRef?.current} open={pop === "share" && !empty} onClose={close} code={actions.shareCode} />
      <ExportPopover
        anchor={anchor}
        beside={railRef?.current}
        open={(pop === "export" || pop === "gif") && !empty}
        onClose={close}
        initial={pop === "gif" ? "gif" : "png"}
        gridEl={gridEl}
        options={exportOptions}
        cropIds={cropIds}
        onDone={close}
      />
    </>
  );
  const dialogs = (
    <>
      <SaveLayoutModal isOpen={actions.saveOpen} onClose={actions.closeSave} onSave={actions.onSave} existingLayouts={actions.saved.map((l) => ({ id: l.id, name: l.name }))} />
      <LoadLayoutModal
        isOpen={actions.loadOpen}
        onClose={actions.closeLoad}
        onLoad={actions.loadLayout}
        onDelete={actions.onDelete}
        onRename={actions.onRename}
        layouts={actions.saved}
        replacing={!empty}
      />
    </>
  );

  if (variant === "toolbar") {
    return (
      <>
        <PhoneToolbar actions={actions} pops={pops} className={className} />
        {popovers}
        {dialogs}
      </>
    );
  }

  const rule = <span aria-hidden className="block h-px shrink-0 bg-line" />;
  const pair = "grid grid-cols-2 gap-1";
  const on = (p: typeof pop) => pop === p && "bg-surface-hover text-fg";
  return (
    <div className={cn("@container/actions space-y-2", className)}>
      <LayoutHistoryControls />
      {rule}
      <div className={pair}>
        <ActionTip label="Save" hint={empty ? "Place something first" : "Keep it in this browser"}>
          <KitButton disabled={empty} onClick={actions.openSave} className="w-full px-2">
            <Save /> Save
          </KitButton>
        </ActionTip>
        <ActionTip label="Load" hint="Saved layouts, the last Calculator result, or a share link">
          <KitButton onClick={actions.openLoad} className="w-full px-2">
            <FolderOpen /> Load
          </KitButton>
        </ActionTip>
      </div>
      {/* Sized to their labels (Simulate is the long one), so both keep their words in a narrow rail. */}
      <div className="flex gap-1">
        <ActionTip label="Share" hint={empty ? "Place something first" : "A link for Discord"} className="flex-auto">
          <KitButton ref={ref("share")} disabled={empty} aria-haspopup="dialog" aria-expanded={pop === "share"} onClick={() => open("share")} className={cn("w-full px-2", on("share"))}>
            <Share2 /> Share
          </KitButton>
        </ActionTip>
        <ActionTip label="Simulate" hint="Run this layout in the Simulator" className="flex-auto">
          <KitButton disabled={empty} onClick={actions.simulate} className="w-full gap-1 px-2 @max-[10rem]/actions:px-1.5">
            <FlaskConical className="@max-[10rem]/actions:hidden" /> Simulate
          </KitButton>
        </ActionTip>
      </div>
      <div className={pair}>
        <ActionTip label="Export PNG" hint="A picture to copy or download">
          <KitButton ref={ref("export")} disabled={empty} aria-haspopup="dialog" aria-expanded={pop === "export"} onClick={() => open("export")} className={cn("w-full px-2", on("export"))}>
            <ImageIcon /> PNG
          </KitButton>
        </ActionTip>
        <ActionTip label="Export GIF" hint="Animated crops move; downloads">
          <KitButton ref={ref("gif")} disabled={empty} aria-haspopup="dialog" aria-expanded={pop === "gif"} onClick={() => open("gif")} className={cn("w-full px-2", on("gif"))}>
            <Film /> GIF
          </KitButton>
        </ActionTip>
      </div>
      {rule}
      <LayoutTransformControls />
      <LayoutClearControls defaultOpen={initialPop === "clear"} />
      {popovers}
      {dialogs}
    </div>
  );
};
