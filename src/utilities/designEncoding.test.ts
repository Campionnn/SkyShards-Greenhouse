import { describe, expect, it } from "vitest";
import { deflateRaw, inflateRaw } from "pako";
import { decodeDesign, encodeDesign, GROUND_TYPES } from "./designEncoding";
import { CROP_IDS, MUTATION_IDS } from "../constants/cropMapping";

function payload(code: string): string {
  const raw = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  return inflateRaw(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)), { to: "string" });
}

function codeOf(payload: string): string {
  const bytes = deflateRaw(payload);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("ground tiles in designer share codes", () => {
  it("preserves legacy codes without ground tiles", () => {
    const decoded = decodeDesign(encodeDesign([{ cropId: "wheat", position: [0, 0] }], []));
    expect(decoded.groundTiles).toEqual([]);
    expect(decoded.inputs).toEqual([{ cropId: "wheat", position: [0, 0] }]);
  });

  it("round trips every ground type as a digit in an otherwise empty cell", () => {
    const groundTiles = GROUND_TYPES.map((ground, col) => ({ ground, position: [0, col + 1] as [number, number] }));
    const code = encodeDesign([{ cropId: "wheat", position: [0, 0] }], [{ cropId: "chloronite", position: [1, 1] }], groundTiles);
    expect(payload(code).split("|")[2].slice(0, 7)).toBe("a012345");
    expect(decodeDesign(code)).toEqual({
      inputs: [{ cropId: "wheat", position: [0, 0] }],
      targets: [{ cropId: "chloronite", position: [1, 1] }],
      groundTiles,
    });
  });

  it("round trips doubled ground digits alongside more than 26 input crops", () => {
    const ids = [...CROP_IDS, ...MUTATION_IDS].slice(0, 27);
    const inputs = ids.map((cropId, i) => ({ cropId, position: [Math.floor(i / 10), i % 10] as [number, number] }));
    const groundTiles = [{ ground: "sand" as const, position: [9, 9] as [number, number] }];
    const code = encodeDesign(inputs, [], groundTiles);
    expect(payload(code).split("|")[2]).toHaveLength(200);
    expect(payload(code).split("|")[2].slice(-2)).toBe("11");
    expect(decodeDesign(code)).toEqual({ inputs, targets: [], groundTiles });
    expect(decodeDesign(codeOf(`||00${"..".repeat(99)}`)).groundTiles).toEqual([{ ground: "farmland", position: [0, 0] }]);
    expect(() => decodeDesign(codeOf(`||01${"..".repeat(99)}`))).toThrow(/Invalid ground tile/);
  });

  it("rejects ground tiles beneath plants or targets and invalid coordinates", () => {
    expect(() => encodeDesign([{ cropId: "wheat", position: [0, 0] }], [], [{ ground: "sand", position: [0, 0] }])).toThrow(/overlaps/);
    expect(() => encodeDesign([], [], [{ ground: "sand", position: [10, 0] }])).toThrow(/outside/);
    expect(() => decodeDesign(codeOf(`||6${".".repeat(99)}`))).toThrow(/Invalid ground tile/);
  });
});
