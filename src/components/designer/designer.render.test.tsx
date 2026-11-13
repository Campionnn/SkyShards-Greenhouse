import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DesignerProvider, GreenhouseDataProvider, InfoModalProvider } from "../../context";
import type { DesignerPlacement } from "../../context";
import { LAYOUT_B_CODE, step } from "../../simulator/testHelpers";
import { ToastProvider } from "../ui";
import { EffectTooltip } from "../grid/EffectTooltip";
import { LayoutWorkspace } from "../simulator/flowgraph/LayoutWorkspace";
import { DesignerGrid } from "./DesignerGrid";

// Server-renders the Designer grid and the flow editor's layout workspace (no browser needed), to
// catch render-time errors and pin the parts other pages rely on: [data-grid-container] (the share
// image renderer waits for it), the optional hint line, token colours, and one Undo / Redo group.

const wrap = (node: React.ReactNode) =>
  renderToString(
    <MemoryRouter>
      <ToastProvider>
        <GreenhouseDataProvider>
          <InfoModalProvider>{node}</InfoModalProvider>
        </GreenhouseDataProvider>
      </ToastProvider>
    </MemoryRouter>,
  ).replace(/<!-- -->/g, "");

const p = (id: string, cropId: string, position: [number, number], size = 1, isMutation = false): DesignerPlacement => ({ id, cropId, cropName: cropId, size, position, isMutation });
const LAYOUT = {
  inputs: [p("i1", "cocoa_beans", [0, 0]), p("i2", "pumpkin", [0, 2])],
  targets: [p("t1", "chocoberry", [4, 5], 1, true)],
  groundTiles: [],
};

const grid = (props: React.ComponentProps<typeof DesignerGrid> = {}) =>
  wrap(
    <DesignerProvider persist={false} initialPlacements={LAYOUT}>
      <DesignerGrid cellSize={40} gap={2} {...props} />
    </DesignerProvider>,
  );

describe("DesignerGrid", () => {
  it("renders the grid container with its placements", () => {
    const html = grid();
    expect(html).toContain("data-grid-container");
    expect(html.match(/cursor:grab/g)?.length).toBe(3);
  });

  it("shows the hint line by default and drops it with hint={false}", () => {
    expect(grid()).toContain("Select a crop from the palette to begin placing");
    expect(grid({ hint: false })).not.toContain("Select a crop from the palette to begin placing");
  });

  it("draws on tokens, not literal colours", () => {
    const html = grid({ showTargets: false });
    expect(html).not.toMatch(/#[0-9a-f]{6}\b|rgba\(/i);
    expect(html).not.toMatch(/slate-|text-sm|rounded-sm/);
  });
});

describe("EffectTooltip", () => {
  it("names the cell 1-based, as Check does", () => {
    const html = renderToString(
      <EffectTooltip id="choconut" name="Choconut" position={[4, 5]} size={2} has={[]} gives={[]} cellSize={40} gap={2} gridWidth={418} gridHeight={418} note="target" />,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("row 5, col 6 · 2x2 · target");
    expect(html).not.toContain("(4, 5)");
  });
});

describe("LayoutWorkspace", () => {
  const html = wrap(<LayoutWorkspace plotId={1} step={step("a", { code: LAYOUT_B_CODE })} index={0} onChange={() => {}} onClose={() => {}} />);

  it("renders the bar, the grid, the Show control and the palette", () => {
    expect(html).toContain('aria-label="Layout of step 1"');
    expect(html).toContain("Load layout…");
    expect(html).toContain("Copy code");
    expect(html).toContain("Done");
    expect(html).toContain("data-grid-container");
    expect(html).toContain("Show on the grid: All");
    expect(html).toContain("Pick an item in the palette to place it");
    expect(html).toContain("Inputs");
  });

  it("has exactly one Undo / Redo group (one Ctrl+Z listener) and no hint line under the grid", () => {
    expect(html.match(/aria-label="Undo and redo"/g)?.length).toBe(1);
    expect(html).not.toContain("Select a crop from the palette to begin placing");
  });

  it("has no TRANSFORM / CLEAR eyebrow blocks", () => {
    expect(html).not.toMatch(/>Transform<\/span>|>Clear<\/span>/);
  });
});
