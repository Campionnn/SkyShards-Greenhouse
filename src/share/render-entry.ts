// Node entry of the share-image renderer (scripts/build-share-render.mjs -> dist-share/share-render.mjs),
// run by SkyShards-API utils/image_generator.py as one long-lived worker per API process: no browser.
//
// Protocol: one JSON request per stdin line, one JSON reply per stdout line, in order.
//   {"id": 1, "code": "<share code>"}  ->  {"id": 1, "ok": true, "png": "<base64>", "ms": 12}
//                                      ->  {"id": 1, "ok": false, "invalid": true, "error": "Failed to decode design: …"}
//   {"id": 2, "ping": true}            ->  {"id": 2, "ok": true, "version": "<render version>"}
// On start it writes {"ready": true, "version": …} once. Assets are read from --assets <dir>
// (crops/, ground/, brand/, fonts/, data.json; default: the folder of this script).
import { createInterface } from "node:readline";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts, type Image } from "@napi-rs/canvas";
import { decodeDesign } from "../utilities/designEncoding";
import { buildLayoutImageModel, drawLayoutImage, measureLayoutImage, type CropDefLite } from "../utilities/layoutImage";

declare const __RENDER_VERSION__: string;

const argAssets = process.argv.indexOf("--assets");
const ASSETS = argAssets > 0 ? process.argv[argAssets + 1] : dirname(fileURLToPath(import.meta.url));
const SCALE = 2;

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

async function main() {
  const fontsDir = join(ASSETS, "fonts");
  if (existsSync(fontsDir)) for (const f of readdirSync(fontsDir)) if (f.endsWith(".ttf")) GlobalFonts.registerFromPath(join(fontsDir, f), "Inter");
  const data = JSON.parse(readFileSync(join(ASSETS, "data.json"), "utf8")) as { crops: Record<string, CropDefLite>; mutations: Record<string, CropDefLite> };
  const [crops, grounds, brand] = await Promise.all([loadDir(join(ASSETS, "crops")), loadDir(join(ASSETS, "ground")), loadDir(join(ASSETS, "brand"))]);
  const assets = { crop: (id: string) => crops.get(id), ground: (g: string) => grounds.get(g), brand: () => brand.get("aloe-aqua-64") };

  const render = (code: string) => {
    const model = buildLayoutImageModel(decodeDesign(code), data.crops, data.mutations);
    const { width, height } = measureLayoutImage(model);
    const canvas = createCanvas(width * SCALE, height * SCALE);
    drawLayoutImage(canvas.getContext("2d") as unknown as CanvasRenderingContext2D, model, assets, SCALE);
    return canvas.encode("png");
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
        const req = JSON.parse(line) as { id?: unknown; code?: unknown; ping?: unknown };
        id = req.id ?? null;
        if (req.ping) {
          out({ id, ok: true, version: __RENDER_VERSION__ });
          return;
        }
        if (typeof req.code !== "string" || !req.code) {
          out({ id, ok: false, invalid: true, error: "No layout code" });
          return;
        }
        const t = performance.now();
        let png: Buffer;
        try {
          png = await render(req.code);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          out({ id, ok: false, invalid: /decode/i.test(msg), error: msg });
          return;
        }
        out({ id, ok: true, png: png.toString("base64"), ms: Math.round(performance.now() - t) });
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
