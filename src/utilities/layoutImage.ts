/**
 * The layout image: one data-driven 2D-canvas drawing of a Designer layout. Its main use is the
 * Discord embed of a share link (SkyShards-API /share/<code>.png, rendered by src/share/render-entry.ts
 * bundled by scripts/build-share-render.mjs); the Designer's Export draws the same picture
 * (layoutImageBrowser.ts). It never reads the DOM, so it looks the same everywhere.
 *
 * Landscape, because Discord shrinks embeds to roughly 400–520px wide: the grid on the left, the title,
 * counts and the Targets / Inputs lists in a column on the right, text a step larger than the page's.
 *
 * Plain functions on a CanvasRenderingContext2D (the browser's, or @napi-rs/canvas's, which has the
 * same API) and an asset lookup; nothing here imports a browser or Node API. Colours are the design
 * tokens (src/index.css @theme) as sRGB hex, since a canvas outside the page can't read CSS variables;
 * layoutImage.test.ts fails if they drift from index.css.
 */

/** Design tokens as hex (oklch → sRGB of the @theme values). */
export const IMAGE_TOKENS = {
  surfacePanel: "#131313",
  surfaceCard: "#181818",
  surfaceHover: "#252525",
  line: "#2e2e2e",
  lineStrong: "#3d3d3d",
  fg: "#f2f2f2",
  fgBody: "#dbdbdb",
  fgMuted: "#b4b4b4",
  fgMeta: "#9a9a9a",
  select: "#45e6f6",
} as const;

export const IMAGE_FONT = `Inter, "Segoe UI", system-ui, sans-serif`;

/** Geometry, in CSS pixels (the image is drawn at `scale` canvas pixels per CSS pixel). */
const G = {
  pad: 24,
  cell: 48,
  gap: 2,
  cardPad: 12,
  colGap: 24,
  colW: 300,
  rowH: 28,
  icon: 20,
  titleH: 22,
  metaH: 18,
  headGap: 20,
  labelH: 22,
  sectionGap: 14,
  subColGap: 12,
  brandH: 24,
  brandGap: 20,
} as const;
const GRID = 10;
const GRID_PX = GRID * G.cell + (GRID - 1) * G.gap; // 498
const CARD = GRID_PX + G.cardPad * 2; // 522
const COL_X = G.pad + CARD + G.colGap;
export const LAYOUT_IMAGE_WIDTH = COL_X + G.colW + G.pad; // 870

/** Dark crops that blend into farmland get a white glow (constants/styles.ts CROPS_NEEDING_GLOW). */
const GLOW_ON_FARMLAND = new Set(["choconut", "chocoberry", "dead_plant"]);

export interface LayoutImagePlacement {
  cropId: string;
  name: string;
  size: number;
  position: [number, number];
  ground: string;
  kind: "input" | "target";
}

export interface LayoutImageModel {
  title: string;
  placements: LayoutImagePlacement[];
  groundTiles: Array<{ ground: string; position: [number, number] }>;
  /** False: that kind draws only its ground on the grid (the lists always count it). Default true. */
  showInputs?: boolean;
  showTargets?: boolean;
}

/**
 * Anything the context's drawImage accepts that has a size: an HTMLImageElement in the browser, an
 * @napi-rs/canvas Image on the server (structurally typed, as the two aren't the same type).
 */
export interface ImageAsset {
  readonly width: number;
  readonly height: number;
}
/** drawImage on whichever image type the context takes. */
const draw = (ctx: CanvasRenderingContext2D, img: ImageAsset, x: number, y: number, w: number, h: number) =>
  ctx.drawImage(img as unknown as CanvasImageSource, x, y, w, h);

export interface LayoutImageAssets {
  crop(cropId: string): ImageAsset | null | undefined;
  ground(ground: string): ImageAsset | null | undefined;
  /** The site mark (public/brand/aloe-aqua-64.png) for the "Greenhouse by SkyShards" lockup. */
  brand?(): ImageAsset | null | undefined;
}

export interface ListEntry {
  cropId: string;
  name: string;
  count: number;
}

/** Placements of one kind per crop, most first (ties keep first-seen order), like LayoutCropSummary. */
export function countByCrop(placements: LayoutImagePlacement[], kind: "input" | "target"): ListEntry[] {
  const m = new Map<string, ListEntry>();
  for (const p of placements) {
    if (p.kind !== kind) continue;
    const e = m.get(p.cropId);
    if (e) e.count++;
    else m.set(p.cropId, { cropId: p.cropId, name: p.name, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Header numbers: "3 targets · 24 inputs · 52 cells" (ground doesn't count as cells). */
export function layoutImageMeta(placements: LayoutImagePlacement[]): string {
  const inputs = placements.filter((x) => x.kind === "input").length;
  const targets = placements.length - inputs;
  const cells = placements.reduce((s, x) => s + x.size * x.size, 0);
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  return [targets && n(targets, "target"), inputs && n(inputs, "input"), n(cells, "cell")].filter(Boolean).join(" · ");
}

const font = (size: number, weight: 400 | 500 | 600 | 700) => `${weight} ${size}px ${IMAGE_FONT}`;
const NAME_FONT = font(13, 400);
const COUNT_FONT = font(13, 400);

type Measure = (text: string, f: string) => number;

/** Truncates with an ellipsis to fit `max` px. */
function fit(text: string, max: number, f: string, measure: Measure): string {
  if (measure(text, f) <= max) return text;
  let s = text;
  while (s.length > 1 && measure(s + "…", f) > max) s = s.slice(0, -1);
  return s + "…";
}

interface Section {
  label: string;
  top: number;
  list: ListEntry[];
  cols: number;
}

interface Plan {
  width: number;
  height: number;
  top: number;
  sections: Section[];
  brandTop: number;
}

/**
 * The right column. Sections stack; each is one column of rows, or two narrower ones when one column
 * would run past the grid's bottom. Past even that, the image simply grows taller.
 */
function plan(model: LayoutImageModel): Plan {
  const top = G.pad;
  const lists = ([["Targets", "target"], ["Inputs", "input"]] as const)
    .map(([label, kind]) => ({ label, list: countByCrop(model.placements, kind) }))
    .filter((s) => s.list.length);
  const headH = G.titleH + G.metaH + G.headGap;
  // The brand lockup sits at the column's foot, level with the grid card's bottom (or below the lists).
  const footH = G.brandGap + G.brandH;
  const heightFor = (cols: number[]) =>
    lists.reduce((h, s, i) => h + (i ? G.sectionGap : 0) + G.labelH + Math.ceil(s.list.length / cols[i]) * G.rowH, headH) + footH;
  // Smallest column counts that fit the card's height; the longer list splits first.
  let cols = lists.map(() => 1);
  if (heightFor(cols) > CARD) {
    const order = lists.map((_, i) => i).sort((a, b) => lists[b].list.length - lists[a].list.length);
    for (const i of order) {
      if (heightFor(cols) <= CARD) break;
      cols = cols.map((c, j) => (j === i ? 2 : c));
    }
  }
  let y = top + headH;
  const sections: Section[] = lists.map((s, i) => {
    if (i) y += G.sectionGap;
    const sec = { label: s.label, top: y, list: s.list, cols: cols[i] };
    y += G.labelH + Math.ceil(s.list.length / cols[i]) * G.rowH;
    return sec;
  });
  const bottom = Math.max(top + CARD, y + footH);
  return { width: LAYOUT_IMAGE_WIDTH, height: bottom + G.pad, top, sections, brandTop: bottom - G.brandH };
}

/** The image's size in CSS pixels (multiply by the scale for the canvas). */
export function measureLayoutImage(model: LayoutImageModel): { width: number; height: number } {
  const p = plan(model);
  return { width: p.width, height: p.height };
}

function measurer(ctx: CanvasRenderingContext2D): Measure {
  return (text, f) => {
    ctx.font = f;
    return ctx.measureText(text).width;
  };
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Ground texture tiled per cell over a footprint (pixel art, so no smoothing). */
function drawGround(ctx: CanvasRenderingContext2D, img: ImageAsset | null | undefined, x: number, y: number, w: number, h: number, radius: number, tile: number = G.cell) {
  ctx.save();
  rr(ctx, x, y, w, h, radius);
  ctx.clip();
  if (img) {
    ctx.imageSmoothingEnabled = false;
    // Repeats every cell size, like the grid's `background-size: cell`.
    for (let ty = 0; ty < h; ty += tile) for (let tx = 0; tx < w; tx += tile) draw(ctx, img, x + tx, y + ty, tile, tile);
  } else {
    ctx.fillStyle = IMAGE_TOKENS.surfaceHover;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/** An icon contained (aspect kept) and centred in a square box; initials when it's missing. */
function drawIcon(ctx: CanvasRenderingContext2D, img: ImageAsset | null | undefined, name: string, x: number, y: number, box: number, glow = false, glowBlur = 5) {
  if (!img) {
    ctx.save();
    ctx.fillStyle = IMAGE_TOKENS.fgMuted;
    ctx.font = font(Math.max(9, Math.round(box * 0.32)), 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 2).toUpperCase(), x + box / 2, y + box / 2);
    ctx.restore();
    return;
  }
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k;
  const h = img.height * k;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (glow) {
    ctx.shadowColor = "rgba(255, 255, 255, 0.7)";
    ctx.shadowBlur = glowBlur;
  }
  draw(ctx, img, x + (box - w) / 2, y + (box - h) / 2, w, h);
  ctx.restore();
}

/**
 * A grid card's geometry: cell size, gap between cells and the card's inner padding (CSS px). Every
 * other measure inside the card (cell / ground / outline radii, glow) scales with the cell, so the
 * 48px cell of the full image draws exactly as it always has.
 */
export interface GridGeom {
  cell: number;
  gap: number;
  pad: number;
  /** The card's corner radius (rounded-container). */
  radius: number;
}

/** The full layout image's grid (48px cells). */
const LAYOUT_GRID_GEOM: GridGeom = { cell: G.cell, gap: G.gap, pad: G.cardPad, radius: 12 };

/** The card's outer side: 10 cells, 9 gaps, the padding on both sides. */
export function gridCardSize(g: GridGeom): number {
  return GRID * g.cell + (GRID - 1) * g.gap + 2 * g.pad;
}

/** One grid card (background card, empty cells, ground, plants, target outlines) with its top-left at (x0, y0). */
function drawGridCard(ctx: CanvasRenderingContext2D, model: LayoutImageModel, assets: LayoutImageAssets, x0: number, y0: number, g: GridGeom) {
  const t = IMAGE_TOKENS;
  const k = g.cell / G.cell;
  const size = gridCardSize(g);
  ctx.save();
  rr(ctx, x0 + 0.5, y0 + 0.5, size - 1, size - 1, g.radius);
  ctx.fillStyle = t.surfaceCard;
  ctx.fill();
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const step = g.cell + g.gap;
  const gx = x0 + g.pad;
  const gy = y0 + g.pad;
  const at = (r: number, c: number) => ({ x: gx + c * step, y: gy + r * step });
  // Hairlines: 1px on big cells, thinner on small ones so the grid doesn't turn into a mesh.
  const hair = g.cell >= 28 ? 1 : 0.75;
  ctx.lineWidth = hair;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const { x, y } = at(r, c);
      rr(ctx, x + hair / 2, y + hair / 2, g.cell - hair, g.cell - hair, 6 * k);
      ctx.fillStyle = t.surfaceHover;
      ctx.fill();
      ctx.strokeStyle = t.lineStrong;
      ctx.stroke();
    }
  }
  for (const { ground, position: [r, c] } of model.groundTiles) {
    const { x, y } = at(r, c);
    drawGround(ctx, assets.ground(ground), x, y, g.cell, g.cell, 2 * k, g.cell);
  }

  const showInputs = model.showInputs ?? true;
  const showTargets = model.showTargets ?? true;
  const outline = g.cell >= 28 ? 2 : 1.5;
  // Inputs first, targets on top (as the Designer grid stacks them).
  const ordered = [...model.placements.filter((x) => x.kind === "input"), ...model.placements.filter((x) => x.kind === "target")];
  for (const pl of ordered) {
    const { x, y } = at(pl.position[0], pl.position[1]);
    const span = pl.size * g.cell + (pl.size - 1) * g.gap;
    const groundImg = assets.ground(pl.ground);
    if (!(pl.kind === "input" ? showInputs : showTargets)) {
      for (let r = 0; r < pl.size; r++) for (let c = 0; c < pl.size; c++) drawGround(ctx, groundImg, x + c * step, y + r * step, g.cell, g.cell, 2 * k, g.cell);
      continue;
    }
    drawGround(ctx, groundImg, x, y, span, span, 4 * k, g.cell);
    const box = span * (pl.size === 1 ? 0.8 : 0.6);
    drawIcon(ctx, assets.crop(pl.cropId), pl.name, x + (span - box) / 2, y + (span - box) / 2, box, pl.ground === "farmland" && GLOW_ON_FARMLAND.has(pl.cropId), Math.max(2, 5 * k));
    if (pl.kind === "target") {
      // TARGET_GLOW: a flat inset outline in the select role.
      rr(ctx, x + outline / 2, y + outline / 2, span - outline, span - outline, 3 * k);
      ctx.strokeStyle = t.select;
      ctx.lineWidth = outline;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The brand lockup (mark · "Greenhouse" · "by SkyShards"); `align: "right"` ends it at x. Returns its width. */
function drawBrand(ctx: CanvasRenderingContext2D, assets: LayoutImageAssets, x: number, cy: number, sizes: { mark: number; name: number; by: number; gap: number }, align: "left" | "right" = "left"): number {
  const mark = assets.brand?.();
  const markW = mark ? (mark.width / mark.height) * sizes.mark : 0;
  const nameF = font(sizes.name, 700);
  const byF = font(sizes.by, 500);
  ctx.font = nameF;
  const nameW = ctx.measureText("Greenhouse").width;
  ctx.font = byF;
  const byW = ctx.measureText("by SkyShards").width;
  const total = (mark ? markW + sizes.gap : 0) + nameW + sizes.gap + byW;
  let bx = align === "right" ? x - total : x;
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  if (mark) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    draw(ctx, mark, bx, cy - sizes.mark / 2, markW, sizes.mark);
    bx += markW + sizes.gap;
  }
  ctx.font = nameF;
  ctx.fillStyle = IMAGE_TOKENS.fg;
  ctx.fillText("Greenhouse", bx, cy);
  bx += nameW + sizes.gap;
  ctx.font = byF;
  ctx.fillStyle = IMAGE_TOKENS.fgMeta;
  ctx.fillText("by SkyShards", bx, cy + 1);
  ctx.restore();
  return total;
}

// ---------------------------------------------------------------------------
// Grid only: one square card (thumbnails, Discord media galleries)
// ---------------------------------------------------------------------------

/** The grid-only image's grid (CSS px; rendered at 3x by the share renderer). */
export const GRID_IMAGE_GEOM: GridGeom = { cell: 32, gap: 2, pad: 8, radius: 12 };
/** Panel margin around the card. */
const GRID_IMAGE_MARGIN = 8;

/** The grid-only image's size in CSS pixels: a square. */
export function measureLayoutGrid(): { width: number; height: number } {
  const side = gridCardSize(GRID_IMAGE_GEOM) + 2 * GRID_IMAGE_MARGIN;
  return { width: side, height: side };
}

/** The grid of a layout alone, as a square card on the panel (no lists, no title, no brand). */
export function drawLayoutGrid(ctx: CanvasRenderingContext2D, model: LayoutImageModel, assets: LayoutImageAssets, scale = 3): void {
  const { width, height } = measureLayoutGrid();
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = IMAGE_TOKENS.surfacePanel;
  ctx.fillRect(0, 0, width, height);
  drawGridCard(ctx, model, assets, GRID_IMAGE_MARGIN, GRID_IMAGE_MARGIN, GRID_IMAGE_GEOM);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Flow: 1–3 plots side by side (the flow share embed)
// ---------------------------------------------------------------------------

export interface FlowImagePlot {
  model: LayoutImageModel;
  /** Header above the grid, e.g. "Plot 1". */
  label: string;
  /** Meta line under it (the step's label); defaults to the plot's targets. */
  sub?: string;
}

export interface FlowImageModel {
  plots: FlowImagePlot[];
  /** Optional title, top left. */
  title?: string | null;
}

/** Most plots the flow image draws (the game has 3); extra plots are dropped. */
export const FLOW_IMAGE_MAX_PLOTS = 3;

/**
 * The flow image is laid out at the size Discord shows it (~520 CSS px wide) and rendered at 3x, so its
 * type uses the page's scale as-is: title 15, plot header 13 semibold, meta 12, brand 13/11.
 */
const F = {
  pad: 12,
  plotGap: 10,
  titleH: 20,
  titleGap: 10,
  headH: 18,
  metaH: 16,
  headGap: 6,
  footGap: 10,
  brandH: 18,
  // One plot: the grid on the left, a column on the right.
  colGap: 14,
  colW: 172,
  rowH: 22,
  icon: 16,
  labelH: 20,
  sectionGap: 8,
} as const;
const FLOW_TYPE = { title: font(15, 600), head: font(13, 600), meta: font(12, 400), label: font(12, 600), row: font(12, 400) } as const;
const FLOW_BRAND = { mark: 16, name: 13, by: 11, gap: 6 } as const;

/** Grid geometry by plot count: as big as the ~520px width allows. */
export function flowGridGeom(plots: number): GridGeom {
  if (plots <= 1) return { cell: 28, gap: 2, pad: 6, radius: 12 };
  if (plots === 2) return { cell: 21, gap: 2, pad: 6, radius: 12 };
  return { cell: 14, gap: 1, pad: 5, radius: 8 };
}

export interface FlowImagePlan {
  width: number;
  height: number;
  geom: GridGeom;
  /** Each plot's grid card top-left (header and meta sit above it, except with one plot). */
  cards: Array<{ x: number; y: number }>;
  /** Top of the plot headers (plots ≥ 2) or of the right column (one plot). */
  headTop: number;
  /** Title baseline-centre y, when there is a title (plots ≥ 2). */
  titleY: number | null;
  /** The brand lockup's centre y and right edge. */
  brandY: number;
  brandRight: number;
}

/** Where everything goes; pure maths (no canvas), exported for tests. */
export function planFlowImage(flow: FlowImageModel): FlowImagePlan {
  const n = Math.max(1, Math.min(FLOW_IMAGE_MAX_PLOTS, flow.plots.length));
  const geom = flowGridGeom(n);
  const card = gridCardSize(geom);
  if (n === 1) {
    // Landscape with one plot: grid left, title / plot / lists / brand in a column on the right.
    const width = F.pad * 2 + card + F.colGap + F.colW;
    const height = F.pad * 2 + card;
    return { width, height, geom, cards: [{ x: F.pad, y: F.pad }], headTop: F.pad, titleY: null, brandY: F.pad + card - F.brandH / 2, brandRight: width - F.pad };
  }
  const width = F.pad * 2 + n * card + (n - 1) * F.plotGap;
  const hasTitle = Boolean(flow.title);
  const headTop = F.pad + (hasTitle ? F.titleH + F.titleGap : 0);
  const cardY = headTop + F.headH + F.metaH + F.headGap;
  const footTop = cardY + card + F.footGap;
  const height = footTop + F.brandH + F.pad;
  return {
    width,
    height,
    geom,
    cards: Array.from({ length: n }, (_, i) => ({ x: F.pad + i * (card + F.plotGap), y: cardY })),
    headTop,
    titleY: hasTitle ? F.pad + F.titleH / 2 : null,
    brandY: footTop + F.brandH / 2,
    brandRight: width - F.pad,
  };
}

/** The flow image's size in CSS pixels (multiply by the scale for the canvas). */
export function measureFlowImage(flow: FlowImageModel): { width: number; height: number } {
  const p = planFlowImage(flow);
  return { width: p.width, height: p.height };
}

/** A plot's default meta line: its targets, most first ("4 Ashwreath, 1 Godseed"); else its numbers. */
export function targetSummary(placements: LayoutImagePlacement[]): string {
  const targets = countByCrop(placements, "target");
  if (!targets.length) return layoutImageMeta(placements);
  return targets.map((e) => `${e.count} ${e.name}`).join(", ");
}

/**
 * How many rows each list gets in a column `rows` rows tall, targets first. A list that doesn't fit
 * shows one row fewer and a "+ N more" row. Exported for tests.
 */
export function fitLists(lengths: number[], rows: number): number[] {
  const out = lengths.map(() => 0);
  let left = rows;
  lengths.forEach((len, i) => {
    // Leave the lists after this one 2 rows each (or fewer, if that's all they have), but never drop this one below 2.
    const reserve = lengths.slice(i + 1).reduce((s, l) => s + Math.min(l, 2), 0);
    const give = Math.max(0, Math.max(Math.min(len, left - reserve), Math.min(len, 2, left)));
    out[i] = give;
    left -= give;
  });
  return out;
}

/** Draws the flow image at the context's origin, `scale` canvas pixels per CSS pixel. Size the canvas with measureFlowImage × scale. */
export function drawFlowImage(ctx: CanvasRenderingContext2D, flow: FlowImageModel, assets: LayoutImageAssets, scale = 3): void {
  const measure = measurer(ctx);
  const p = planFlowImage(flow);
  const plots = flow.plots.slice(0, FLOW_IMAGE_MAX_PLOTS);
  const t = IMAGE_TOKENS;
  const card = gridCardSize(p.geom);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = t.surfacePanel;
  ctx.fillRect(0, 0, p.width, p.height);

  const text = (s: string, f: string, colour: string, x: number, y: number, max: number) => {
    ctx.font = f;
    ctx.fillStyle = colour;
    ctx.fillText(fit(s, max, f, measure), x, y);
  };

  if (plots.length <= 1) {
    const plot = plots[0];
    const { x, y } = p.cards[0];
    if (plot) drawGridCard(ctx, plot.model, assets, x, y, p.geom);
    const colX = x + card + F.colGap;
    let cy = p.headTop;
    const head = flow.title || plot?.label || "";
    // With a title the meta line names the plot (and its step); without one, the step or the numbers.
    const sub = !plot ? "" : flow.title ? [plot.label, plot.sub].filter(Boolean).join(" · ") : (plot.sub ?? layoutImageMeta(plot.model.placements));
    text(head, FLOW_TYPE.title, t.fg, colX, cy + F.titleH / 2, F.colW);
    cy += F.titleH;
    if (sub) {
      text(sub, FLOW_TYPE.meta, t.fgMeta, colX, cy + F.metaH / 2 + 1, F.colW);
      cy += F.metaH;
    }
    cy += F.headGap + 4;
    if (plot) {
      const lists = ([["Targets", "target"], ["Inputs", "input"]] as const)
        .map(([label, kind]) => ({ label, list: countByCrop(plot.model.placements, kind) }))
        .filter((s) => s.list.length);
      const bottom = p.brandY - F.brandH / 2 - F.sectionGap;
      const space = bottom - cy - lists.length * F.labelH - Math.max(0, lists.length - 1) * F.sectionGap;
      const shown = fitLists(lists.map((s) => s.list.length), Math.max(0, Math.floor(space / F.rowH)));
      lists.forEach((s, i) => {
        if (!shown[i]) return;
        if (i) cy += F.sectionGap;
        text(s.label, FLOW_TYPE.label, t.fgMuted, colX, cy + F.labelH / 2 - 1, F.colW);
        cy += F.labelH;
        const rows = shown[i];
        const more = s.list.length - rows;
        const entries = more > 0 ? s.list.slice(0, rows - 1) : s.list;
        for (const e of entries) {
          const ry = cy + F.rowH / 2;
          drawIcon(ctx, assets.crop(e.cropId), e.name, colX, ry - F.icon / 2, F.icon);
          const count = `×${e.count}`;
          ctx.font = FLOW_TYPE.row;
          const countW = ctx.measureText(count).width;
          ctx.fillStyle = t.fgMeta;
          ctx.fillText(count, colX + F.colW - countW, ry);
          text(e.name, FLOW_TYPE.row, t.fgBody, colX + F.icon + 8, ry, F.colW - F.icon - 8 - countW - 8);
          cy += F.rowH;
        }
        if (more > 0) {
          text(`+ ${more + 1} more`, FLOW_TYPE.row, t.fgMeta, colX + F.icon + 8, cy + F.rowH / 2, F.colW - F.icon - 8);
          cy += F.rowH;
        }
      });
    }
  } else {
    if (p.titleY !== null && flow.title) text(flow.title, FLOW_TYPE.title, t.fg, F.pad, p.titleY, p.width - 2 * F.pad);
    plots.forEach((plot, i) => {
      const { x, y } = p.cards[i];
      text(plot.label, FLOW_TYPE.head, t.fg, x + 2, p.headTop + F.headH / 2, card - 4);
      text(plot.sub ?? targetSummary(plot.model.placements), FLOW_TYPE.meta, t.fgMeta, x + 2, p.headTop + F.headH + F.metaH / 2, card - 4);
      drawGridCard(ctx, plot.model, assets, x, y, p.geom);
    });
  }

  drawBrand(ctx, assets, p.brandRight, p.brandY, FLOW_BRAND, "right");
  ctx.restore();
}

/**
 * Draws the image at the context's origin, `scale` canvas pixels per CSS pixel. Size the canvas
 * with measureLayoutImage × scale first.
 */
export function drawLayoutImage(ctx: CanvasRenderingContext2D, model: LayoutImageModel, assets: LayoutImageAssets, scale = 2): void {
  const measure = measurer(ctx);
  const p = plan(model);
  const t = IMAGE_TOKENS;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.fillStyle = t.surfacePanel;
  ctx.fillRect(0, 0, p.width, p.height);

  drawGridCard(ctx, model, assets, G.pad, p.top, LAYOUT_GRID_GEOM);

  // ---- Right column: title, numbers, lists ----
  const colX = COL_X;
  const titleF = font(17, 600);
  ctx.font = titleF;
  ctx.fillStyle = t.fg;
  ctx.fillText(fit(model.title, G.colW, titleF, measure), colX, p.top + G.titleH / 2);
  ctx.font = font(13, 400);
  ctx.fillStyle = t.fgMeta;
  ctx.fillText(fit(layoutImageMeta(model.placements), G.colW, font(13, 400), measure), colX, p.top + G.titleH + G.metaH / 2 + 2);

  for (const s of p.sections) {
    ctx.font = font(13, 600);
    ctx.fillStyle = t.fgMuted;
    ctx.fillText(s.label, colX, s.top + G.labelH / 2 - 2);
    const colW = (G.colW - (s.cols - 1) * G.subColGap) / s.cols;
    const rows = Math.ceil(s.list.length / s.cols);
    s.list.forEach((e, i) => {
      // Column-major, so each column reads top to bottom, most first.
      const c = Math.floor(i / rows);
      const r = i % rows;
      const x = colX + c * (colW + G.subColGap);
      const y = s.top + G.labelH + r * G.rowH;
      const cy = y + G.rowH / 2;
      drawIcon(ctx, assets.crop(e.cropId), e.name, x, cy - G.icon / 2, G.icon);
      const count = `×${e.count}`;
      ctx.font = COUNT_FONT;
      const countW = ctx.measureText(count).width;
      ctx.fillStyle = t.fgMeta;
      ctx.fillText(count, x + colW - countW, cy);
      ctx.font = NAME_FONT;
      ctx.fillStyle = t.fgBody;
      ctx.fillText(fit(e.name, colW - G.icon - 8 - countW - 8, NAME_FONT, measure), x + G.icon + 8, cy);
    });
  }

  // Brand lockup, as in the site header: mark · "Greenhouse" · "by SkyShards".
  drawBrand(ctx, assets, colX, p.brandTop + G.brandH / 2, { mark: 22, name: 15, by: 13, gap: 8 });
  ctx.restore();
}

/** Minimal crop/mutation definitions the model needs (data.json shape). */
export interface CropDefLite {
  name?: string;
  size?: number;
  ground?: string;
}

/**
 * Builds the model from decoded placements and the greenhouse data. Inputs look up crops first,
 * targets mutations first (as the Designer's loadLayoutFromCode does).
 */
export function buildLayoutImageModel(
  decoded: {
    inputs: Array<{ cropId: string; position: [number, number] }>;
    targets: Array<{ cropId: string; position: [number, number] }>;
    groundTiles: Array<{ ground: string; position: [number, number] }>;
  },
  crops: Record<string, CropDefLite | undefined>,
  mutations: Record<string, CropDefLite | undefined>,
  title = LAYOUT_IMAGE_TITLE,
): LayoutImageModel {
  const one = (cropId: string, position: [number, number], kind: "input" | "target"): LayoutImagePlacement => {
    const def = kind === "input" ? (crops[cropId] ?? mutations[cropId]) : (mutations[cropId] ?? crops[cropId]);
    return { cropId, position, kind, name: def?.name ?? cropId.replace(/_/g, " "), size: def?.size ?? 1, ground: def?.ground ?? "farmland" };
  };
  return {
    title,
    placements: [...decoded.inputs.map((p) => one(p.cropId, p.position, "input")), ...decoded.targets.map((p) => one(p.cropId, p.position, "target"))],
    groundTiles: decoded.groundTiles,
  };
}

export const LAYOUT_IMAGE_TITLE = "Greenhouse layout";
