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
function drawGround(ctx: CanvasRenderingContext2D, img: ImageAsset | null | undefined, x: number, y: number, w: number, h: number, radius: number) {
  ctx.save();
  rr(ctx, x, y, w, h, radius);
  ctx.clip();
  if (img) {
    ctx.imageSmoothingEnabled = false;
    // Repeats every cell size, like the grid's `background-size: cell`.
    for (let ty = 0; ty < h; ty += G.cell) for (let tx = 0; tx < w; tx += G.cell) draw(ctx, img, x + tx, y + ty, G.cell, G.cell);
  } else {
    ctx.fillStyle = IMAGE_TOKENS.surfaceHover;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/** An icon contained (aspect kept) and centred in a square box; initials when it's missing. */
function drawIcon(ctx: CanvasRenderingContext2D, img: ImageAsset | null | undefined, name: string, x: number, y: number, box: number, glow = false) {
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
    ctx.shadowBlur = 5;
  }
  draw(ctx, img, x + (box - w) / 2, y + (box - h) / 2, w, h);
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

  // ---- Grid card ----
  const cardX = G.pad;
  const cardY = p.top;
  rr(ctx, cardX + 0.5, cardY + 0.5, CARD - 1, CARD - 1, 12);
  ctx.fillStyle = t.surfaceCard;
  ctx.fill();
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const gx = cardX + G.cardPad;
  const gy = cardY + G.cardPad;
  const at = (r: number, c: number) => ({ x: gx + c * (G.cell + G.gap), y: gy + r * (G.cell + G.gap) });
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const { x, y } = at(r, c);
      rr(ctx, x + 0.5, y + 0.5, G.cell - 1, G.cell - 1, 6);
      ctx.fillStyle = t.surfaceHover;
      ctx.fill();
      ctx.strokeStyle = t.lineStrong;
      ctx.stroke();
    }
  }
  for (const { ground, position: [r, c] } of model.groundTiles) {
    const { x, y } = at(r, c);
    drawGround(ctx, assets.ground(ground), x, y, G.cell, G.cell, 2);
  }

  const showInputs = model.showInputs ?? true;
  const showTargets = model.showTargets ?? true;
  // Inputs first, targets on top (as the Designer grid stacks them).
  const ordered = [...model.placements.filter((x) => x.kind === "input"), ...model.placements.filter((x) => x.kind === "target")];
  for (const pl of ordered) {
    const { x, y } = at(pl.position[0], pl.position[1]);
    const span = pl.size * G.cell + (pl.size - 1) * G.gap;
    const groundImg = assets.ground(pl.ground);
    if (!(pl.kind === "input" ? showInputs : showTargets)) {
      for (let r = 0; r < pl.size; r++) for (let c = 0; c < pl.size; c++) drawGround(ctx, groundImg, x + c * (G.cell + G.gap), y + r * (G.cell + G.gap), G.cell, G.cell, 2);
      continue;
    }
    drawGround(ctx, groundImg, x, y, span, span, 4);
    const box = span * (pl.size === 1 ? 0.8 : 0.6);
    drawIcon(ctx, assets.crop(pl.cropId), pl.name, x + (span - box) / 2, y + (span - box) / 2, box, pl.ground === "farmland" && GLOW_ON_FARMLAND.has(pl.cropId));
    if (pl.kind === "target") {
      // TARGET_GLOW: a flat 2px inset outline in the select role.
      rr(ctx, x + 1, y + 1, span - 2, span - 2, 3);
      ctx.strokeStyle = t.select;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

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
  const by = p.brandTop + G.brandH / 2;
  const mark = assets.brand?.();
  let bx = colX;
  if (mark) {
    const h = 22;
    const w = (mark.width / mark.height) * h;
    ctx.imageSmoothingEnabled = true;
    draw(ctx, mark, bx, by - h / 2, w, h);
    bx += w + 8;
  }
  ctx.font = font(15, 700);
  ctx.fillStyle = t.fg;
  ctx.fillText("Greenhouse", bx, by);
  bx += ctx.measureText("Greenhouse").width + 8;
  ctx.font = font(13, 500);
  ctx.fillStyle = t.fgMeta;
  ctx.fillText("by SkyShards", bx, by + 1);
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
