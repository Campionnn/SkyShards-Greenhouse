// The layout image (Discord share embeds and the Designer's Export), drawn with @napi-rs/canvas as the
// API's renderer does. Checks the tokens match index.css, the counting, sizes, and that it draws.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { encodeDesign, decodeDesign } from "./designEncoding";
import {
  buildLayoutImageModel,
  countByCrop,
  drawFlowImage,
  drawLayoutGrid,
  drawLayoutImage,
  fitLists,
  FLOW_IMAGE_MAX_PLOTS,
  GRID_IMAGE_GEOM,
  gridCardSize,
  IMAGE_TOKENS,
  LAYOUT_IMAGE_WIDTH,
  layoutImageMeta,
  measureFlowImage,
  measureLayoutGrid,
  measureLayoutImage,
  planFlowImage,
  targetSummary,
} from "./layoutImage";

const data = JSON.parse(readFileSync("public/greenhouse/data.json", "utf8"));

/** oklch(L% C H) → sRGB hex (as the tokens were converted). */
function oklchHex(L: number, C: number, H: number): string {
  L /= 100;
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return "#" + rgb.map((x) => Math.round(Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) * 255).toString(16).padStart(2, "0")).join("");
}

describe("layout image", () => {
  it("uses the design tokens of src/index.css", () => {
    const css = readFileSync("src/index.css", "utf8");
    const name = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    for (const [k, hex] of Object.entries(IMAGE_TOKENS)) {
      const m = css.match(new RegExp(`--color-${name(k)}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
      expect(m, `--color-${name(k)}`).toBeTruthy();
      expect(oklchHex(+m![1], +m![2], +m![3]), k).toBe(hex);
    }
  });

  const code = encodeDesign(
    [
      { cropId: "wheat", position: [0, 0] },
      { cropId: "wheat", position: [0, 2] },
      { cropId: "fire", position: [5, 5] },
    ],
    [
      { cropId: "ashwreath", position: [0, 1] },
      { cropId: "godseed", position: [2, 2] },
    ],
    [{ ground: "sand", position: [9, 9] }],
  );
  const model = buildLayoutImageModel(decodeDesign(code), data.crops, data.mutations);

  it("builds the model from a share code: names, sizes, grounds, kinds", () => {
    const god = model.placements.find((p) => p.cropId === "godseed")!;
    expect(god).toMatchObject({ kind: "target", size: 3, name: "Godseed" });
    expect(model.placements.find((p) => p.cropId === "fire")).toMatchObject({ kind: "input", ground: data.crops.fire.ground });
    expect(countByCrop(model.placements, "input")).toEqual([
      { cropId: "wheat", name: "Wheat", count: 2 },
      { cropId: "fire", name: "Fire", count: 1 },
    ]);
    expect(layoutImageMeta(model.placements)).toBe("2 targets · 3 inputs · 13 cells");
  });

  it("is landscape, fixed width, and grows only for long lists", () => {
    const small = measureLayoutImage(model);
    expect(small.width).toBe(LAYOUT_IMAGE_WIDTH);
    expect(small.width / small.height).toBeGreaterThan(1.4);
    const many = { ...model, placements: Object.keys(data.mutations).map((id, i) => ({ cropId: id, name: data.mutations[id].name, size: 1, ground: "farmland", position: [Math.floor(i / 10), i % 10] as [number, number], kind: "target" as const })) };
    expect(measureLayoutImage(many).height).toBeGreaterThanOrEqual(small.height);
  });

  it("draws: the background, the grid, a target outline", async () => {
    const icon = await loadImage(readFileSync("public/greenhouse/crops/wheat.png"));
    const scale = 1;
    const { width, height } = measureLayoutImage(model);
    const canvas = createCanvas(width * scale, height * scale);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    drawLayoutImage(ctx, model, { crop: () => icon, ground: () => null }, scale);
    const px = (x: number, y: number) => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    };
    expect(px(2, 2)).toBe(IMAGE_TOKENS.surfacePanel);
    // The ashwreath target at (0,1): its select-coloured outline 1px inside its box.
    const gx = 24 + 12 + 1 * 50;
    const gy = 24 + 12;
    expect(px(gx + 1, gy + 24)).toBe(IMAGE_TOKENS.select);
    expect(canvas.toBuffer("image/png").length).toBeGreaterThan(1000);
  });

  it("grid only: a square card with the same cell maths", () => {
    const { width, height } = measureLayoutGrid();
    expect(width).toBe(height);
    expect(gridCardSize(GRID_IMAGE_GEOM)).toBe(10 * GRID_IMAGE_GEOM.cell + 9 * GRID_IMAGE_GEOM.gap + 2 * GRID_IMAGE_GEOM.pad);
    expect(width).toBeGreaterThan(gridCardSize(GRID_IMAGE_GEOM));
  });

  it("grid only: draws the panel and outlines targets in select", () => {
    const scale = 1;
    const { width, height } = measureLayoutGrid();
    const canvas = createCanvas(width * scale, height * scale);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    drawLayoutGrid(ctx, model, { crop: () => null, ground: () => null }, scale);
    const d = ctx.getImageData(1, 1, 1, 1).data;
    expect("#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")).toBe(IMAGE_TOKENS.surfacePanel);
  });
});

describe("flow image plan", () => {
  const model = buildLayoutImageModel(
    decodeDesign(encodeDesign([{ cropId: "wheat", position: [0, 0] }, { cropId: "wheat", position: [0, 2] }, { cropId: "fire", position: [5, 5] }], [{ cropId: "ashwreath", position: [0, 1] }, { cropId: "godseed", position: [2, 2] }], [])),
    data.crops,
    data.mutations,
  );
  const m = { title: "", placements: [], groundTiles: [] };
  const plots = (n: number) => Array.from({ length: n }, (_, i) => ({ model: m, label: `Plot ${i + 1}` }));
  // Discord shows images about 520 CSS px wide.
  const SHOWN = 520;

  it("is landscape at 1, 2 and 3 plots, with or without a title", () => {
    for (const n of [1, 2, 3])
      for (const title of [null, "A flow"]) {
        const { width, height } = measureFlowImage({ plots: plots(n), title });
        expect(width / height, `${n} plots, title ${title}`).toBeGreaterThan(1.3);
      }
  });

  it("keeps cells legible at Discord's width", () => {
    for (const n of [1, 2, 3]) {
      const p = planFlowImage({ plots: plots(n), title: "A flow" });
      // A cell, as shown when the whole image is scaled to SHOWN px wide.
      expect(p.geom.cell * (SHOWN / p.width), `${n} plots`).toBeGreaterThanOrEqual(11);
    }
  });

  it("puts plots side by side without overlap, inside the image", () => {
    for (const n of [1, 2, 3]) {
      const p = planFlowImage({ plots: plots(n), title: "A flow" });
      const card = gridCardSize(p.geom);
      expect(p.cards).toHaveLength(n);
      p.cards.forEach((c, i) => {
        expect(c.x + card).toBeLessThanOrEqual(p.width);
        expect(c.y + card).toBeLessThanOrEqual(p.height);
        if (i) expect(c.x).toBeGreaterThanOrEqual(p.cards[i - 1].x + card);
        if (i) expect(c.y).toBe(p.cards[0].y);
      });
      expect(p.brandRight).toBeLessThanOrEqual(p.width);
    }
  });

  it("caps at three plots; the title only adds height", () => {
    expect(planFlowImage({ plots: plots(5) }).cards).toHaveLength(FLOW_IMAGE_MAX_PLOTS);
    const a = planFlowImage({ plots: plots(3) });
    const b = planFlowImage({ plots: plots(3), title: "T" });
    expect(b.width).toBe(a.width);
    expect(b.height).toBeGreaterThan(a.height);
    expect(a.titleY).toBeNull();
  });

  it("summarises a plot by its targets", () => {
    expect(targetSummary(model.placements)).toBe("1 Ashwreath, 1 Godseed");
    expect(targetSummary(model.placements.filter((p) => p.kind === "input"))).toBe("3 inputs · 3 cells");
  });

  it("fits the one-plot lists: targets first, at least 2 rows each when possible", () => {
    expect(fitLists([3, 4], 10)).toEqual([3, 4]);
    expect(fitLists([10, 10], 8)).toEqual([6, 2]);
    expect(fitLists([1, 10], 8)).toEqual([1, 7]);
    expect(fitLists([10, 1], 4)).toEqual([3, 1]);
    expect(fitLists([5, 5], 1)).toEqual([1, 0]);
    expect(fitLists([], 5)).toEqual([]);
  });

  it("draws 1 and 3 plots", () => {
    for (const n of [1, 3]) {
      const flow = { plots: Array.from({ length: n }, (_, i) => ({ model, label: `Plot ${i + 1}`, sub: i ? undefined : "Step 2" })), title: "A flow" };
      const { width, height } = measureFlowImage(flow);
      const canvas = createCanvas(width, height);
      drawFlowImage(canvas.getContext("2d") as unknown as CanvasRenderingContext2D, flow, { crop: () => null, ground: () => null }, 1);
      expect(canvas.toBuffer("image/png").length).toBeGreaterThan(1000);
    }
  });
});
