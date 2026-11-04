import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Copy, ExternalLink, FolderInput } from "lucide-react";
import { DesignerProvider } from "../../../context";
import { useFitCellSize } from "../../../hooks";
import type { FlowStep, StepLayout } from "../../../simulator";
import { getGridDimensions, type LayoutTransform } from "../../../utilities";
import { CropSelectionPalette, DesignerGrid, LayoutClearControls, LayoutCropSummary, LayoutHistoryControls, LayoutTransformControls, MutationValidator } from "../../designer";
import { useToast } from "../../ui";
import { InfoHint } from "../../ui/InfoHint";
import { KitButton, KitLabel } from "../../ui/kit";
import { surface } from "../../ui/surface";
import { LayoutPickerDialog } from "../LayoutPicker";
import { layoutCode, layoutToPlacements, placementsToCode } from "../scenarioEdit";
import { stepTitle } from "./shared";

// A step's layout, full screen: the Designer's own grid, palette, transform/clear tools and
// validator on a private, non-persisting DesignerProvider (the Designer page's saved layout is
// never touched). Opened from the inspector's "Edit layout" or by double-clicking a node.

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
  const fitRef = useRef<HTMLDivElement>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: 60 });
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
      if (e.key !== "Escape" || picking) return;
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
      className={`absolute inset-0 z-30 flex flex-col bg-surface-page transition-[opacity,transform] duration-150 ease-snappy ${closing ? "opacity-0 scale-[0.99]" : "kit-pop-in"}`}
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
          <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 md:block" />
          <span className="min-w-0 truncate text-fg-body" title={stepTitle(step, index)}>
            {stepTitle(step, index)}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
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
          className="focus-ring hidden h-7 shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control px-2.5 text-secondary font-medium text-fg-body transition-[background-color,transform] duration-150 ease-snappy hover:bg-surface-hover active:scale-[0.97] sm:inline-flex [&>svg]:h-3.5 [&>svg]:w-3.5"
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
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 scrollbar-dark lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[260px_minmax(0,1fr)_400px] 2xl:grid-cols-[280px_minmax(0,1fr)_440px] xl:overflow-hidden">
          <div className={`order-2 space-y-4 p-3 xl:order-1 xl:overflow-y-auto scrollbar-dark ${surface.card}`}>
            <div className="space-y-2">
              <KitLabel>Transform</KitLabel>
              <LayoutTransformControls />
            </div>
            <div className="space-y-2">
              <KitLabel>Clear</KitLabel>
              <LayoutClearControls />
            </div>
            <div className="border-t border-line pt-3">
              <MutationValidator />
            </div>
          </div>
          <div className={`order-1 flex min-w-0 flex-col p-3 xl:order-2 xl:overflow-y-auto scrollbar-dark ${surface.card}`}>
            <LayoutHistoryControls className="mb-2 justify-end" />
            <div ref={fitRef} className="flex w-full flex-col items-center">
              <DesignerGrid cellSize={cellSize} gap={gap} />
            </div>
            {/* As wide as the grid above it, not the whole card. */}
            <div className="mx-auto mt-4 w-full" style={{ maxWidth: getGridDimensions(cellSize, gap).width }}>
              <LayoutCropSummary />
            </div>
          </div>
          <div className={`relative order-3 h-[520px] xl:h-auto ${surface.card}`}>
            <div className="absolute inset-3">
              <CropSelectionPalette className="h-full" />
            </div>
          </div>
        </div>
      </DesignerProvider>
    </div>
  );
};
