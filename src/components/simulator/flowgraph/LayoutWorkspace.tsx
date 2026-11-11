import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ChevronRight, Copy, ExternalLink, FolderInput } from "lucide-react";
import { DesignerProvider } from "../../../context";
import type { FlowStep, StepLayout } from "../../../simulator";
import type { LayoutTransform } from "../../../utilities";
import { CropSelectionPalette, LayoutClearControls, LayoutCropSummary, LayoutHistoryControls, LayoutTransformControls, MutationValidator } from "../../designer";
import { CheckRing } from "../../designer/CheckRing";
import { useCheckState } from "../../designer/checkModel";
import { GridStage } from "../../designer/page/GridStage";
import { PickStatus } from "../../designer/PickStatus";
import { GridVisibilityToggle } from "../../grid/GridVisibilityToggle";
import { useToast } from "../../ui";
import { cn } from "../../ui/cn";
import { InfoHint } from "../../ui/InfoHint";
import { KitButton } from "../../ui/kit";
import { surface } from "../../ui/surface";
import { LayoutPickerDialog } from "../LayoutPicker";
import { layoutCode, layoutToPlacements, placementsToCode } from "../scenarioEdit";
import { stepTitle } from "./shared";

// A step's layout, full screen: the Designer's own grid, palette, tools and Check on a private,
// non-persisting DesignerProvider (the Designer page's saved layout is never touched). Opened from the
// inspector's "Edit layout" or by double-clicking a node.
//
// Columns, as the Designer page (research/designer-v2, docs/plans/designer-revamp.md):
// - xl: tools + Check · the grid · the palette (260 · grid · 400; 280 · grid · 440 at 2xl).
// - lg: the grid · the palette; the tools + Check go under the grid.
// - below lg: stacked (grid, palette, tools + Check).
// Undo · Redo sit at the top of the tools column at xl and in the grid card's top row below it, rendered
// in one place only: LayoutHistoryControls owns the Ctrl+Z listener (exactly one per provider).

const XL = "(min-width: 1280px)";
/**
 * Window height the grid leaves for the rest at xl, so the whole grid sits inside its card: the
 * simulator's bar and this workspace's bar (52 + 52), the padding (16 + 12 above, 12 + 16 below) and
 * the row above the grid (28 + 8).
 */
const HEIGHT_RESERVE = 196;

/** Whether a media query matches (false where matchMedia is missing: SSR, tests). */
function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}

const Rule: React.FC = () => <span aria-hidden className="block h-px shrink-0 bg-line" />;

/**
 * What the grid draws, for this workspace only: local state that starts with everything shown, so hiding
 * crops in a step layout never changes the Designer's and Calculator's saved Show preference.
 */
function useLocalVisibility() {
  const [inputs, setInputs] = useState(true);
  const [targets, setTargets] = useState(true);
  return { inputs, setInputs, targets, setTargets };
}

/** The workspace body inside the provider: tools + Check, the grid stage, the palette. */
const WorkspaceBody: React.FC = () => {
  const xl = useMedia(XL);
  const show = useLocalVisibility();
  // One Check state for the list in the tools card and the ring over the grid (as the Designer page).
  const check = useCheckState();
  const card = cn(surface.card, "min-w-0");

  return (
    <div className="scrollbar-dark grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[260px_minmax(0,1fr)_400px] xl:overflow-hidden 2xl:grid-cols-[280px_minmax(0,1fr)_440px]">
      {/* Tools + Check: the left column at xl; under the grid and the palette below it. */}
      {/* At xl the column's height (Check fills it and scrolls inside); below xl, under the grid at its content height. */}
      <div className={cn(card, "order-3 flex flex-col gap-3 p-3 xl:order-1 xl:min-h-0 xl:overflow-hidden")}>
        {xl && (
          <>
            <LayoutHistoryControls className="shrink-0" />
            <Rule />
          </>
        )}
        <div className="shrink-0 space-y-2">
          <LayoutTransformControls />
          <LayoutClearControls />
        </div>
        <Rule />
        {/* At xl the card is the column's height: Check fills the rest (its rows scroll, the target card stays in view). */}
        <MutationValidator check={check} fill={xl} className={xl ? "min-h-0 flex-1" : undefined} />
      </div>

      {/* The grid: Show (+ Undo · Redo below xl) above it, the summary under it. */}
      <div className={cn(card, "scrollbar-dark order-1 flex flex-col p-3 xl:order-2 xl:min-h-0 xl:overflow-y-auto")}>
        <GridStage
          maxCell={60}
          heightReserve={xl ? HEIGHT_RESERVE : undefined}
          showInputs={show.inputs}
          showTargets={show.targets}
          overlay={(geo) => <CheckRing check={check} cellSize={geo.cellSize} gap={geo.gap} offsetX={geo.x} offsetY={geo.y} />}
          above={
            // One row; on a phone the pick status takes its own line above Show and Undo · Redo.
            <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              <PickStatus where="in the palette" className="mr-auto max-sm:basis-full" />
              <GridVisibilityToggle inputsVisible={show.inputs} onInputsVisibleChange={show.setInputs} targetsVisible={show.targets} onTargetsVisibleChange={show.setTargets} className="shrink-0" />
              {!xl && <LayoutHistoryControls className="w-44 shrink-0 max-sm:ml-auto" />}
            </div>
          }
          below={<LayoutCropSummary className="mt-3" />}
        />
      </div>

      {/* The palette fills a fixed-height box (520px below xl, the column's height at xl). */}
      <div className={cn(card, "relative order-2 h-[520px] xl:order-3 xl:h-auto xl:min-h-0")}>
        <div className="absolute inset-3 flex min-h-0 flex-col">
          <CropSelectionPalette className="h-full" />
        </div>
      </div>
    </div>
  );
};

export const LayoutWorkspace: React.FC<{
  plotId: number;
  step: FlowStep;
  index: number;
  onChange: (layout: StepLayout, transform?: LayoutTransform) => void;
  onClose: () => void;
}> = ({ plotId, step, index, onChange, onClose }) => {
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const [picking, setPicking] = useState(false);
  const [closing, setClosing] = useState(false);
  const code = layoutCode(step.layout);
  // Re-read the layout only when the editor is (re)mounted, not on every edit it produced.
  const initial = useMemo(() => layoutToPlacements(step.layout), [version, step.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return onClose();
    setClosing(true);
    window.setTimeout(onClose, 150);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || picking || e.defaultPrevented) return;
      // A modal dialog on top (the item info dialog, Load…) owns this Escape.
      if (document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className={cn("absolute inset-0 z-30 flex flex-col bg-surface-page transition-[opacity,transform] duration-150 ease-snappy", closing ? "scale-[0.99] opacity-0" : "kit-pop-in")}
      style={{ transformOrigin: "center 40%" }}
      role="region"
      aria-label={`Layout of step ${index + 1}`}
    >
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line bg-surface-panel px-2 sm:gap-2 sm:px-3">
        <KitButton variant="ghost" onClick={close} aria-label="Back to the flow" className="px-2 sm:px-2.5">
          <ArrowLeft /> <span className="hidden sm:inline">Back to flow</span>
        </KitButton>
        <span className="hidden h-6 w-px bg-line-strong sm:block" aria-hidden />
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-body text-fg-meta" aria-label="Breadcrumb">
          <span className="hidden shrink-0 md:inline">Plot {plotId}</span>
          <ChevronRight className="hidden size-3.5 shrink-0 md:block" />
          <span className="min-w-0 truncate text-fg-body" title={stepTitle(step, index)}>
            {stepTitle(step, index)}
          </span>
          <ChevronRight className="size-3.5 shrink-0" />
          <span className="shrink-0 font-semibold text-fg">Layout</span>
          <InfoHint title="Inputs and targets">
            Inputs are planted (base crops and fire are free; mutation items come from the inventory after setup). Targets are empty cells labelled with the mutation expected to spawn there.
          </InfoHint>
        </nav>
        <KitButton onClick={() => setPicking(true)} aria-label="Load layout" title="Replace this step's layout with one from the Calculator, the Designer, your saved layouts or a share link">
          <FolderInput /> <span className="hidden md:inline">Load layout…</span>
        </KitButton>
        <KitButton
          aria-label="Copy layout code"
          title="Copy this layout's share code"
          className="max-sm:hidden"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            toast({ title: "Layout code copied", variant: "success", duration: 2000 });
          }}
        >
          <Copy /> <span className="hidden lg:inline">Copy code</span>
        </KitButton>
        <a
          className="focus-ring hidden h-7 shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control px-2.5 text-secondary font-medium text-fg-body transition-[background-color,transform] duration-150 ease-snappy hover:bg-surface-hover active:scale-[0.97] sm:inline-flex [&>svg]:size-3.5"
          href={`/designer?layout=${encodeURIComponent(code)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in the Designer (new tab)"
          title="Open in the Designer (new tab)"
        >
          <span className="hidden lg:inline">Designer</span> <ExternalLink />
        </a>
        <KitButton variant="primary" onClick={close} className="px-3">
          Done
        </KitButton>
      </div>

      {picking && (
        <LayoutPickerDialog
          title="Load a layout into this step"
          useLabel="Replace this step's layout"
          onClose={() => setPicking(false)}
          onUse={(picked) => {
            const before = step.layout;
            onChange({ code: picked.code });
            setVersion((v) => v + 1);
            setPicking(false);
            toast({
              title: "Step layout replaced",
              description: picked.name,
              variant: "success",
              duration: 5000,
              action: {
                label: "Undo",
                onClick: () => {
                  onChange(before);
                  setVersion((v) => v + 1);
                },
              },
            });
          }}
        />
      )}

      <DesignerProvider
        key={`${plotId}-${step.id}-${version}`}
        persist={false}
        initialPlacements={initial}
        onChange={(inputs, targets, groundTiles, transform) => onChange({ code: placementsToCode(inputs, targets, groundTiles) }, transform)}
      >
        <WorkspaceBody />
      </DesignerProvider>
    </div>
  );
};
