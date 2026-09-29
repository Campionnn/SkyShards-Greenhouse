import { describe, expect, it } from "vitest";
import { effectiveEffects, relayTableSize, simulateEffects, type SimPlacement } from "../../utilities/effectSimulation";

// Ported from SkyShards-API tests/test_effects.py, run against the frontend's
// effect port (the one implementation the designer and the simulator share).

const at = (id: string, row: number, col: number, extra: Partial<SimPlacement> = {}): SimPlacement => ({
  id,
  position: [row, col],
  size: extra.size ?? 1,
  ...extra,
});
const held = (sim: ReturnType<typeof simulateEffects>, r: number, c: number) => [...sim.heldAt(r, c)].sort();

describe("effect propagation (4-way cardinal)", () => {
  it("nothing holds its own listed buffs; neighbours do, diagonals do not", () => {
    const sim = simulateEffects([at("wheat", 5, 5), at("potato", 5, 6), at("carrot", 6, 6)]);
    expect(held(sim, 5, 5)).toEqual(["immunity"]); // from potato, not its own harvest_boost
    expect(held(sim, 5, 6)).toContain("harvest_boost");
    expect(held(sim, 6, 6)).toEqual(["immunity"]); // carrot is diagonal to wheat: no harvest_boost
  });

  it("a lone wild rose relays nothing; the plants next to it do, but never effect_spread itself", () => {
    const sim = simulateEffects([at("wild_rose", 5, 5), at("wheat", 5, 6), at("potato", 5, 7)]);
    // wheat holds effect_spread (from the rose) and immunity (from potato) -> relays immunity to the rose.
    expect(held(sim, 5, 6)).toEqual(["effect_spread", "immunity"]);
    expect(held(sim, 5, 5)).toEqual(["harvest_boost", "immunity"]);
    expect(held(sim, 5, 7)).toContain("harvest_boost");
    expect(held(sim, 5, 7)).not.toContain("effect_spread");
  });

  it("relay table sizes double past 12 / 24 / 48 / 96 spreaders", () => {
    expect([12, 13, 24, 25, 48, 49, 96, 97].map(relayTableSize)).toEqual([16, 32, 32, 64, 64, 128, 128, 256]);
  });

  it("turn order decides reach: relays hand on only what they hold on their turn", () => {
    // Row: nether_wart - A - rose - B - (empty). A and B both relay (next to the rose).
    // B at (5,8) and A at (5,6): slots (13*8+5)%16=13 and (13*6+5)%16=3, so A goes first.
    const sim = simulateEffects([at("nether_wart", 5, 5), at("wheat", 5, 6), at("wild_rose", 5, 7), at("wheat", 5, 8)]);
    expect(sim.relayOrder).toEqual([
      [5, 6],
      [5, 8],
    ]);
    // A relays improved_harvest_boost to the rose, but the rose does not relay (it holds no effect_spread).
    expect(held(sim, 5, 7)).toContain("improved_harvest_boost");
    expect(held(sim, 5, 8)).not.toContain("improved_harvest_boost");
  });

  it("immunity blocks negatives for the holder but they still spread", () => {
    expect([...effectiveEffects(["immunity", "harvest_loss", "harvest_boost"])]).toEqual(["immunity", "harvest_boost"]);
  });

  it("improved_x hides x", () => {
    for (const base of ["xp_boost", "harvest_boost", "water_retain"]) {
      expect(effectiveEffects([base, `improved_${base}`]).has(base)).toBe(false);
    }
  });

  it("a multi-cell plant is one entity with one shared set and one relay turn", () => {
    // Noctilume (2x2) lists effect_spread; a wheat next to it relays. The noctilume itself receives once.
    const sim = simulateEffects([at("noctilume", 4, 4, { size: 2 }), at("potato", 3, 4)]);
    expect(held(sim, 4, 4)).toEqual(held(sim, 5, 5));
    expect(held(sim, 5, 5)).toContain("immunity");
  });

  it("a mutation slot receives but never pushes", () => {
    const sim = simulateEffects([at("ashwreath", 5, 5, { isSlot: true }), at("ashwreath", 5, 6, { isSlot: true })]);
    expect(held(sim, 5, 5)).toEqual([]);
    expect(held(sim, 5, 6)).toEqual([]);
  });

  it("effects never leave the plot's own grid", () => {
    const sim = simulateEffects([at("wild_rose", 0, 9), at("wheat", 0, 8)]);
    expect(held(sim, 0, 8)).toEqual(["effect_spread"]);
  });

  it("Fire is inert scenery: it never holds a received effect and so can never relay one", () => {
    // Fire sits right next to a Wild Rose (effect_spread) and a wheat (immunity):
    // both would normally be picked up and relayed onward.
    const sim = simulateEffects([at("wild_rose", 5, 5), at("wheat", 5, 4), at("fire", 5, 6), at("wheat", 5, 7)]);
    expect(held(sim, 5, 6)).toEqual([]);
    // The plant past Fire gets nothing, because inert Fire never relays.
    expect(held(sim, 5, 7)).toEqual([]);
    expect(sim.relayOrder).not.toContainEqual([5, 6]);
  });
});
