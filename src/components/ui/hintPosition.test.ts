import { describe, expect, it } from "vitest";
import { EDGE, placeBeside, placeTooltip, TIP_GAP, type Rect } from "./hintPosition";

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height, right: left + width, bottom: top + height });
const VW = 1366;
const VH = 768;
const tip = { width: 120, height: 30 };

describe("placeTooltip", () => {
  it("bottom: centred under the trigger", () => {
    const p = placeTooltip(rect(500, 100, 40, 28), tip, "bottom", VW, VH);
    expect(p).toEqual({ top: 128 + TIP_GAP, left: 520 - 60, side: "bottom" });
  });

  it("bottom: flips above when the bottom is short, and stays in the window sideways", () => {
    const p = placeTooltip(rect(2, 740, 40, 28), tip, "bottom", VW, VH);
    expect(p.side).toBe("top");
    expect(p.top).toBe(740 - TIP_GAP - 30);
    expect(p.left).toBe(EDGE);
  });

  it("top: above, or below when there is no room above", () => {
    expect(placeTooltip(rect(500, 300, 40, 28), tip, "top", VW, VH).side).toBe("top");
    expect(placeTooltip(rect(500, 10, 40, 28), tip, "top", VW, VH)).toMatchObject({ side: "bottom", top: 38 + TIP_GAP });
  });

  it("right: beside the trigger, centred, clamped to the window", () => {
    expect(placeTooltip(rect(16, 300, 36, 36), tip, "right", VW, VH)).toEqual({ top: 318 - 15, left: 52 + TIP_GAP, side: "right" });
    expect(placeTooltip(rect(16, 2, 36, 20), tip, "right", VW, VH).top).toBe(EDGE);
  });

  it("right: flips left at the right edge, then under on a narrow window", () => {
    expect(placeTooltip(rect(1300, 300, 36, 36), tip, "right", VW, VH)).toMatchObject({ side: "left", left: 1300 - TIP_GAP - 120 });
    expect(placeTooltip(rect(40, 300, 36, 36), tip, "right", 160, VH).side).toBe("bottom");
  });
});

describe("placeBeside", () => {
  const rail = rect(132, 60, 176, 600);
  it("opens right of the column, its top level with the trigger", () => {
    const p = placeBeside(rect(140, 200, 160, 28), rail, { width: 320, height: 240 }, VW, VH);
    expect(p).toMatchObject({ top: 200, left: 308 + EDGE, maxHeight: VH - 16 });
    expect(p?.origin).toBe("0px 14px");
  });

  it("clamps the top so the bottom stays on screen", () => {
    const p = placeBeside(rect(140, 600, 160, 28), rail, { width: 320, height: 400 }, VW, VH);
    expect(p?.top).toBe(VH - EDGE - 400);
  });

  it("caps a panel taller than the window (the body scrolls)", () => {
    const p = placeBeside(rect(140, 600, 160, 28), rail, { width: 320, height: 2000 }, VW, VH);
    expect(p).toMatchObject({ top: EDGE, maxHeight: VH - 16 });
  });

  it("returns null without room beside the column", () => {
    expect(placeBeside(rect(10, 100, 100, 28), rect(0, 0, 390, 800), { width: 320, height: 200 }, 390, 844)).toBeNull();
  });
});
