import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";

const VIRTUAL_ID = "virtual:greenhouse-images";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const CROP_DIR = "public/greenhouse/crops";
const GROUND_DIR = "public/greenhouse/ground";

const listPngs = (dir: string): string[] =>
  readdirSync(resolve(__dirname, dir))
    .filter((file) => file.toLowerCase().endsWith(".png"))
    .sort();

/**
 * `virtual:greenhouse-images`:
 * - `cropImageUrls`: URL of every crop/mutation icon in public/greenhouse/crops, so the
 *   app can preload all of them without a hand-kept list.
 * - `groundImageDataUrls`: every ground texture in public/greenhouse/ground inlined as a
 *   data URL (~300 bytes each), so ground tiles never wait on the network at all.
 */
export const greenhouseImagesPlugin = () => ({
  name: "greenhouse-images",
  resolveId(id: string) {
    return id === VIRTUAL_ID ? RESOLVED_ID : null;
  },
  load(id: string) {
    if (id !== RESOLVED_ID) return null;
    const crops = listPngs(CROP_DIR).map((file) => `/greenhouse/crops/${file}`);
    const ground: Record<string, string> = {};
    for (const file of listPngs(GROUND_DIR)) {
      const base64 = readFileSync(resolve(__dirname, GROUND_DIR, file)).toString("base64");
      ground[file.replace(/\.png$/i, "")] = `data:image/png;base64,${base64}`;
    }
    return `export const cropImageUrls = ${JSON.stringify(crops)};\nexport const groundImageDataUrls = ${JSON.stringify(ground)};\n`;
  },
});
