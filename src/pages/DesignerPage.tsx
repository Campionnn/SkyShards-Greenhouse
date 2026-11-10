/**
 * The Designer (`/designer`): paint a greenhouse layout, check its targets, share or export it.
 *
 * Desktop (research/designer-v2, direction B + the judge's steals): the actions and Check in a sticky left
 * rail, the grid as large as fits in the centre (with the pick status above and the summary below), the
 * palette in a sticky right rail. Column widths come from the page's own width (designerFrame.ts). Phone:
 * a top icon toolbar, the grid full width, and a bottom sheet with Palette | Check above the adhesion ad.
 *
 * The share-image renderer (SkyShards-API) loads this page at 1200×900 and drives it through the window
 * hooks in useDesignerPageHooks.ts: the grid must render on first paint.
 */
import React, { useCallback, useRef, useState } from "react";
import { DesignerActions, LayoutCropSummary, MutationValidator, CropSelectionPalette } from "../components/designer";
import type { DesignerGridHandle } from "../components/designer";
import { GridVisibilityToggle } from "../components/grid";
import { useTargetsVisible, useInputsVisible } from "../hooks";
import { useDesigner } from "../context";
import { cn } from "../components/ui/cn";
import { DesignerFacts, DesignerPageHint } from "../components/designer/page/DesignerHeader";
import { GridStage, type GridGeometry } from "../components/designer/page/GridStage";
import { StartCard } from "../components/designer/page/StartCard";
import { DesignerPhone } from "../components/designer/page/DesignerPhone";
import { COARSE_QUERY, frameFor, GRID_HEIGHT_RESERVE, PHONE_QUERY, useElementWidth, useFillViewport, useMediaQuery } from "../components/designer/page/designerFrame";
import { useDesignerPageHooks } from "../components/designer/page/useDesignerPageHooks";
import { useLastCalculatorLayout, type DesignerActionsApi } from "../components/designer/actionsModel";
import { useCheckState } from "../components/designer/checkModel";
import { CheckRing } from "../components/designer/CheckRing";
import { PickStatus } from "../components/designer/PickStatus";

const rule = <span aria-hidden className="block h-px shrink-0 bg-line" />;

export const DesignerPage: React.FC = () => {
  const [showTargets, setShowTargets] = useTargetsVisible();
  const [showInputs, setShowInputs] = useInputsVisible();
  const gridRef = useRef<DesignerGridHandle>(null);
  useDesignerPageHooks(gridRef, showTargets);

  const { inputPlacements, targetPlacements, groundTiles, selectedCropForPlacement, selectedGround } = useDesigner();
  const empty = inputPlacements.length + targetPlacements.length + groundTiles.length === 0;
  const lastCalculator = useLastCalculatorLayout();
  const [actionsApi, setActionsApi] = useState<DesignerActionsApi | null>(null);
  const onActionsReady = useCallback((api: DesignerActionsApi) => setActionsApi(api), []);
  const showStart = empty && !selectedCropForPlacement && !selectedGround;
  // One Check state shared by the list (the rail or the sheet) and the ring on the grid.
  const check = useCheckState();
  /** What the stage draws over the grid: the Check ring, and on an empty layout the start card. */
  const overlay = (where: string) => (geo: GridGeometry) => (
    <>
      <CheckRing check={check} cellSize={geo.cellSize} gap={geo.gap} offsetX={geo.x} offsetY={geo.y} />
      {showStart && (
        <StartCard
          geo={geo}
          where={where}
          onLoad={() => actionsApi?.openLoad()}
          lastCalculator={lastCalculator}
          onLastCalculator={() => lastCalculator && actionsApi?.loadLayout(lastCalculator.layout, lastCalculator.name)}
        />
      )}
    </>
  );

  const show = <GridVisibilityToggle inputsVisible={showInputs} onInputsVisibleChange={setShowInputs} targetsVisible={showTargets} onTargetsVisibleChange={setShowTargets} />;

  const pageRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(pageRef);
  const phone = useMediaQuery(PHONE_QUERY);
  const touch = useMediaQuery(COARSE_QUERY);
  const f = frameFor(width || 902, touch);

  const leftOuter = useRef<HTMLElement>(null);
  const leftInner = useRef<HTMLDivElement>(null);
  const rightOuter = useRef<HTMLElement>(null);
  const rightInner = useRef<HTMLDivElement>(null);
  useFillViewport(leftOuter, leftInner, "height");
  useFillViewport(rightOuter, rightInner, "height");

  if (phone) {
    return (
      <div ref={pageRef} className="w-full">
        <DesignerPhone
          gridRef={gridRef}
          showInputs={showInputs}
          showTargets={showTargets}
          show={show}
          check={check}
          onActionsReady={onActionsReady}
          overlay={overlay("below")}
        />
      </div>
    );
  }

  return (
    <div ref={pageRef} className="w-full py-3">
      <header className="mb-3 flex h-7 min-w-0 items-center gap-x-2">
        <h1 className="shrink-0 text-hero text-fg">Designer</h1>
        <DesignerPageHint />
        <DesignerFacts className="ml-1" />
      </header>

      {/* At least a viewport tall, so both rails reach the bottom of the screen on a short layout. */}
      <div className="grid min-h-[calc(100dvh-3rem)] items-start" style={{ gridTemplateColumns: `${f.left}px minmax(0, 1fr) ${f.right}px`, columnGap: f.gap }}>
        {/* Left: the actions, then Check. Sticky; the Check rows scroll on their own. */}
        <aside ref={leftOuter} aria-label="Layout tools" className="min-w-0 self-stretch contain-size">
          <div ref={leftInner} className={cn("sticky top-4 flex min-h-0 flex-col gap-3 overflow-hidden rounded-container border border-line bg-surface-panel", f.narrow ? "p-1.5" : "p-2")}>
            <DesignerActions gridRef={gridRef} showTargets={showTargets} variant="rail" railRef={leftInner} onReady={onActionsReady} className="shrink-0" />
            {rule}
            <MutationValidator check={check} fill className="min-h-0 flex-1" />
          </div>
        </aside>

        {/* Centre: what the next click does + Show, the grid, the summary. */}
        <section aria-label="Grid" className="min-w-0">
          <GridStage
            gridRef={gridRef}
            maxCell={f.maxCell}
            heightReserve={GRID_HEIGHT_RESERVE}
            showInputs={showInputs}
            showTargets={showTargets}
            above={
              <div className="flex h-7 min-w-0 items-center gap-2">
                <PickStatus where="in the palette" />
                <span className="ml-auto" />
                {show}
              </div>
            }
            below={<LayoutCropSummary className="mt-3" />}
            overlay={overlay("in the palette")}
          />
        </section>

        {/* Right: the palette. Sticky, as tall as the visible column; only the tiles scroll. */}
        <aside ref={rightOuter} aria-label="Palette" className="min-w-0 self-stretch contain-size">
          <div ref={rightInner} className={cn("sticky top-4 flex min-h-0 flex-col overflow-hidden rounded-container border border-line bg-surface-panel", f.narrow ? "p-1.5" : "p-2")}>
            <CropSelectionPalette className="min-h-0 flex-1" />
          </div>
        </aside>
      </div>
    </div>
  );
};
