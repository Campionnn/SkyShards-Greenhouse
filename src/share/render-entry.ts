// Node entry of the share-image renderer (scripts/build-share-render.mjs -> dist-share/share-render.mjs),
// run by SkyShards-API utils/image_generator.py as one long-lived worker per API process: no browser.
//
// Protocol: one JSON request per stdin line, one JSON reply per stdout line, in order.
//   {"id": 1, "code": "<share code>"}                  full layout image (grid + lists + brand)
//   {"id": 1, "kind": "grid", "code": "<share code>"}  the grid alone, a square card
//   {"id": 1, "kind": "flow", "plots": [{"code", "label"?, "sub"?}, …], "title"?: "…"}
//                                                      1–3 plots side by side (the flow embed)
//     ->  {"id": 1, "ok": true, "png": "<base64>", "ms": 12}
//     ->  {"id": 1, "ok": false, "invalid": true, "error": "Failed to decode design: …"}
//   {"id": 2, "kind": "describe", "code": "<share code>"}
//     ->  {"id": 2, "ok": true, "targets": [{"id", "name", "count"}], "inputs": [...], "cells": 52,
//          "meta": "3 targets · 24 inputs · 52 cells"}
//   {"id": 3, "ping": true}                            ->  {"id": 3, "ok": true, "version": "<render version>"}
// On start it writes {"ready": true, "version": …} once. Assets are read from --assets <dir>
// (crops/, ground/, brand/, fonts/, data.json; default: the folder of this script).
import { createInterface } from "node:readline";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts, type Image } from "@napi-rs/canvas";
import { decodeDesign } from "../utilities/designEncoding";
import {
  buildLayoutImageModel,
  countByCrop,
  drawFlowImage,
  drawLayoutGrid,
  drawLayoutImage,
  FLOW_IMAGE_MAX_PLOTS,
  layoutImageMeta,
  measureFlowImage,
  measureLayoutGrid,
  measureLayoutImage,
  type CropDefLite,
  type FlowImagePlot,
} from "../utilities/layoutImage";

declare const __RENDER_VERSION__: string;

const argAssets = process.argv.indexOf("--assets");
const ASSETS = argAssets > 0 ? process.argv[argAssets + 1] : dirname(fileURLToPath(import.meta.url));
/** Canvas px per CSS px: the full image at 2x (870 wide), grid and flow at 3x (laid out at Discord's size). */
const SCALE = { layout: 2, grid: 3, flow: 3 } as const;
const MAX_LABEL = 80;

async function loadDir(dir: string): Promise<Map<string, Image>> {
  const m = new Map<string, Image>();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".png")) continue;
    try {
      // First frame only for APNGs (animated crops), which is what a still embed shows.
      m.set(f.slice(0, -4), await loadImage(readFileSync(join(dir, f))));
    } catch {
      /* a broken icon draws as initials */
    }
  }
  return m;
}

/** A layout code problem (bad request), not a renderer problem: the API doesn't retry these. */
class InvalidRequest extends Error {}

const str = (v: unknown, max = MAX_LABEL): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

async function main() {
  const fontsDir = join(ASSETS, "fonts");
  if (existsSync(fontsDir)) for (const f of readdirSync(fontsDir)) if (f.endsWith(".ttf")) GlobalFonts.registerFromPath(join(fontsDir, f), "Inter");
  const data = JSON.parse(readFileSync(join(ASSETS, "data.json"), "utf8")) as { crops: Record<string, CropDefLite>; mutations: Record<string, CropDefLite> };
  const [crops, grounds, brand] = await Promise.all([loadDir(join(ASSETS, "crops")), loadDir(join(ASSETS, "ground")), loadDir(join(ASSETS, "brand"))]);
  const assets = { crop: (id: string) => crops.get(id), ground: (g: string) => grounds.get(g), brand: () => brand.get("aloe-aqua-64") };

  const model = (code: unknown) => {
    if (typeof code !== "string" || !code) throw new InvalidRequest("No layout code");
    return buildLayoutImageModel(decodeDesign(code), data.crops, data.mutations);
  };
  const ctxOf = (w: number, h: number, scale: number) => {
    const canvas = createCanvas(Math.round(w * scale), Math.round(h * scale));
    return { canvas, ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D };
  };

  const renderLayout = (code: unknown) => {
    const m = model(code);
    const { width, height } = measureLayoutImage(m);
    const { canvas, ctx } = ctxOf(width, height, SCALE.layout);
    drawLayoutImage(ctx, m, assets, SCALE.layout);
    return canvas.encode("png");
  };
  const renderGrid = (code: unknown) => {
    const m = model(code);
    const { width, height } = measureLayoutGrid();
    const { canvas, ctx } = ctxOf(width, height, SCALE.grid);
    drawLayoutGrid(ctx, m, assets, SCALE.grid);
    return canvas.encode("png");
  };
  const renderFlow = (plots: unknown, title: unknown) => {
    if (!Array.isArray(plots) || !plots.length) throw new InvalidRequest("No plots");
    const list: FlowImagePlot[] = plots.slice(0, FLOW_IMAGE_MAX_PLOTS).map((p, i) => {
      const o = (p ?? {}) as { code?: unknown; label?: unknown; sub?: unknown };
      return { model: model(o.code), label: str(o.label) ?? `Plot ${i + 1}`, sub: str(o.sub, 120) };
    });
    const flow = { plots: list, title: str(title, 120) ?? null };
    const { width, height } = measureFlowImage(flow);
    const { canvas, ctx } = ctxOf(width, height, SCALE.flow);
    drawFlowImage(ctx, flow, assets, SCALE.flow);
    return canvas.encode("png");
  };
  const describe = (code: unknown) => {
    const m = model(code);
    const list = (kind: "input" | "target") => countByCrop(m.placements, kind).map((e) => ({ id: e.cropId, name: e.name, count: e.count }));
    return {
      targets: list("target"),
      inputs: list("input"),
      cells: m.placements.reduce((s, x) => s + x.size * x.size, 0),
      meta: layoutImageMeta(m.placements),
    };
  };

  const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ ready: true, version: __RENDER_VERSION__ });

  // Requests are handled one at a time, in order, so replies match the order they were asked.
  let chain: Promise<void> = Promise.resolve();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    chain = chain.then(async () => {
      let id: unknown = null;
      try {
        const req = JSON.parse(line) as { id?: unknown; kind?: unknown; code?: unknown; plots?: unknown; title?: unknown; ping?: unknown };
        id = req.id ?? null;
        if (req.ping) {
          out({ id, ok: true, version: __RENDER_VERSION__ });
          return;
        }
        const kind = req.kind ?? "layout";
        const t = performance.now();
        try {
          if (kind === "describe") {
            out({ id, ok: true, ...describe(req.code), ms: Math.round(performance.now() - t) });
            return;
          }
          let png: Buffer;
          if (kind === "layout") png = await renderLayout(req.code);
          else if (kind === "grid") png = await renderGrid(req.code);
          else if (kind === "flow") png = await renderFlow(req.plots, req.title);
          else throw new InvalidRequest(`Unknown request kind: ${String(kind)}`);
          out({ id, ok: true, png: png.toString("base64"), ms: Math.round(performance.now() - t) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          out({ id, ok: false, invalid: e instanceof InvalidRequest || /decode/i.test(msg), error: msg });
        }
      } catch (e) {
        out({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  });
  rl.on("close", () => void chain.then(() => process.exit(0)));
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ready: false, error: e instanceof Error ? e.message : String(e) }) + "\n");
  process.exit(1);
});
