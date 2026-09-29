import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseApng } from "./apng";
import { ANIMATED_CROPS, getLcmFrameCount } from "./gridExport";

const cropPath = (id: string) => resolve(__dirname, "../../public/greenhouse/crops", `${id}.png`);
const load = (id: string) => new Uint8Array(readFileSync(cropPath(id)));

/** Frame counts the designer's GIF export is built around (1 frame per second). */
const EXPECTED_FRAMES: Record<string, number> = {
  all_in_aloe: 5,
  fire: 5,
  noctilume: 2,
  shellfruit: 2,
  startlevine: 2,
};

describe("animated crop icons", () => {
  it("lists exactly the expected crops", () => {
    expect([...ANIMATED_CROPS].sort()).toEqual(Object.keys(EXPECTED_FRAMES).sort());
  });

  for (const [id, count] of Object.entries(EXPECTED_FRAMES)) {
    it(`${id}.png is a real APNG with ${count} frames of 1s each`, () => {
      const bytes = load(id);
      expect(String.fromCharCode(...bytes.subarray(1, 4))).toBe("PNG"); // not a GIF in disguise
      const apng = parseApng(bytes);
      expect(apng.frames).toHaveLength(count);
      expect(apng.numPlays).toBe(0);
      for (const f of apng.frames) {
        expect(f.delayMs).toBe(1000);
        expect(f.left + f.width).toBeLessThanOrEqual(apng.width);
        expect(f.top + f.height).toBeLessThanOrEqual(apng.height);
        // Each frame is re-emitted as a standalone PNG the browser can decode.
        expect(parseApng(f.png).frames).toHaveLength(1);
      }
    });
  }

  it("parses a static crop icon as a single frame", () => {
    expect(parseApng(load("wheat")).frames).toHaveLength(1);
  });

  it("GIF export length covers whole loops of every animation", () => {
    expect(getLcmFrameCount([])).toBe(1);
    expect(getLcmFrameCount([5, 2])).toBe(10);
    expect(getLcmFrameCount([5, 5, 2, 2, 2])).toBe(10);
  });
});
