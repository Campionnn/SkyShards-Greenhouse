import React, { useEffect, useState } from "react";
import { TabPanel, Tabs } from "../../ui/kit";
import { CropSelectionPalette, PaletteModeSwitch } from "../CropSelectionPalette";
import { DesignerActions } from "../DesignerActions";
import { LayoutCropSummary } from "../LayoutCropSummary";
import { MutationValidator } from "../MutationValidator";
import { PickedChip, PickStatus } from "../PickStatus";
import type { DesignerGridHandle } from "../DesignerGrid";
import type { DesignerActionsApi } from "../actionsModel";
import type { CheckState } from "../checkModel";
import { DesignerFacts, DesignerPageHint } from "./DesignerHeader";
import { GridStage, type GridGeometry } from "./GridStage";

type SheetTab = "palette" | "check";

/**
 * The Designer on a phone (patterns.md §8): a compact header, the actions as one row of 44px icons, the
 * grid full width, and the palette and Check in a bottom sheet. The sheet docks above Mediavine's adhesion
 * ad (`--ad-bottom`, kept up to date by the site Layout) and folds when an item is picked, so the top of
 * the grid stays in view while painting.
 */
export const DesignerPhone: React.FC<{
  gridRef: React.Ref<DesignerGridHandle>;
  showInputs: boolean;
  showTargets: boolean;
  show: React.ReactNode;
  check: CheckState;
  onActionsReady: (api: DesignerActionsApi) => void;
  overlay: (geo: GridGeometry) => React.ReactNode;
}> = ({ gridRef, showInputs, showTargets, show, check, onActionsReady, overlay }) => {
  const [tab, setTab] = useState<SheetTab>("palette");
  const [open, setOpen] = useState(false);
  const invalid = check.checks.filter((c) => !c.v.isValid).length;
  // Keyboard focus scrolls controls clear of the sheet (the document is the scroller).
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "calc(10rem + var(--ad-bottom, 0px))";
    return () => {
      root.style.scrollPaddingBottom = before;
    };
  }, []);

  return (
    <>
      {/* The folded sheet is ~150px (handle, peek row, tabs) plus the ad: the page ends above it, and
          focused controls scroll clear of it. */}
      <div className="w-full pt-1 pb-[calc(11rem+var(--ad-bottom,0px))]">
        <header className="mb-1.5 flex min-w-0 items-center gap-1.5">
          <h1 className="shrink-0 text-title text-fg">Designer</h1>
          <DesignerPageHint />
          <DesignerFacts compact className="ml-auto" />
        </header>
        <div className="sticky top-0 z-(--z-sticky) mb-2 border-y border-line bg-surface-page px-0.5 py-1">
          <DesignerActions gridRef={gridRef} showTargets={showTargets} variant="toolbar" onReady={onActionsReady} />
        </div>
        <GridStage
          gridRef={gridRef}
          maxCell={64}
          showInputs={showInputs}
          showTargets={showTargets}
          above={
            <div className="flex h-11 min-w-0 items-center gap-2">
              <PickStatus where="below" />
              <span className="ml-auto" />
              {show}
            </div>
          }
          below={<LayoutCropSummary className="mt-3" />}
          overlay={overlay}
        />
      </div>

      <div
        role="region"
        aria-label="Palette and Check"
        className="fixed inset-x-0 z-(--z-bar) rounded-t-container border-t border-line-strong bg-surface-panel"
        style={{ bottom: "var(--ad-bottom, 0px)", paddingBottom: "max(0px, calc(env(safe-area-inset-bottom, 0px) - var(--ad-bottom, 0px)))" }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Fold the sheet down" : "Open the sheet"}
          onClick={() => setOpen((o) => !o)}
          className="focus-ring-inset flex h-11 w-full cursor-pointer items-center justify-center"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-line-control" />
        </button>
        <div className="flex min-w-0 items-center gap-2 px-3 pb-2">
          <div className="min-w-0 flex-1">
            <PickedChip />
          </div>
          <PaletteModeSwitch className="shrink-0" />
        </div>
        <Tabs
          idPrefix="designer-sheet"
          label="Palette and Check"
          value={tab}
          onChange={(t) => {
            if (t === tab && open) setOpen(false);
            else {
              setTab(t);
              setOpen(true);
            }
          }}
          items={[
            { value: "palette", label: "Palette" },
            { value: "check", label: "Check", count: invalid || null },
          ]}
          // 44px tabs on a phone (the kit's tabs are 38px).
          className="px-3 [&_[role=tab]]:h-11"
        />
        {open && (
          // About 40% of the screen: the top of the grid stays in view while you pick.
          <TabPanel idPrefix="designer-sheet" value={tab} className="flex h-[min(40dvh,340px)] min-h-0 flex-col px-3 pt-3 pb-2">
            {tab === "palette" ? (
              <CropSelectionPalette showMode={false} onPicked={() => setOpen(false)} className="min-h-0 flex-1" />
            ) : (
              <MutationValidator check={check} fill touch heading={false} className="min-h-0 flex-1" />
            )}
          </TabPanel>
        )}
      </div>
    </>
  );
};
