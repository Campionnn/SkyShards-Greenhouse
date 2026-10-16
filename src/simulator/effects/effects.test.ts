import { describe, expect, it } from "vitest";
import { effectiveEffects, effectsGivenBy, simulateEffects, type SimPlacement } from "../../utilities/effectSimulation";

// Effect simulation shared by the designer and the simulator (mirrors SkyShards-API tests/test_effects.py).

const at = (id: string, row: number, col: number, extra: Partial<SimPlacement> = {}): SimPlacement => ({
  id,
  position: [row, col],
  size: extra.size ?? 1,
  ...extra,
});
const held = (sim: ReturnType<typeof simulateEffects>, r: number, c: number) => [...sim.heldAt(r, c)].sort();

/** The jellybean's buff, tracked through the rose grids below. */
const BUFF = "improved_xp_boost";

/** Rows split by "/": Y = magic jellybean, R = wild rose, "." = empty. Row 0 is the plot's north edge. */
function roseGrid(spec: string): SimPlacement[] {
  const out: SimPlacement[] = [];
  spec.split("/").forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === "Y") out.push(at("magic_jellybean", r, c));
      else if (ch === "R") out.push(at("wild_rose", r, c));
    })
  );
  return out;
}

/**
 * The pre-Oct-13 model, kept here only to check the new one is a superset of it: each relay took
 * ONE turn in Java HashMap order ((13 * col + row) % table, table 16 doubling past 75% full) and
 * passed on only what it held on its turn. 1x1 plants only.
 */
function legacyHeld(placements: SimPlacement[]): Map<string, Set<string>> {
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const has = new Map<string, Set<string>>();
  const byCell = new Map(placements.map((p) => [`${p.position[0]},${p.position[1]}`, p]));
  for (const k of byCell.keys()) has.set(k, new Set());
  const give = (p: SimPlacement, payload: Iterable<string>) => {
    for (const [dr, dc] of DIRS) {
      const r = p.position[0] + dr;
      const c = p.position[1] + dc;
      if (r < 0 || c < 0 || r >= 10 || c >= 10) continue;
      const q = byCell.get(`${r},${c}`);
      if (q && q.id !== "fire") for (const e of payload) has.get(`${r},${c}`)!.add(e);
    }
  };
  const key = (p: SimPlacement) => `${p.position[0]},${p.position[1]}`;
  for (const p of placements) give(p, effectsGivenBy(p.id));
  const relays = placements.filter((p) => has.get(key(p))!.has("effect_spread"));
  let table = 16;
  while (relays.length > 0.75 * table) table *= 2;
  const slot = (p: SimPlacement) => (13 * p.position[1] + p.position[0]) % table;
  relays.sort((a, b) => slot(a) - slot(b) || a.position[0] - b.position[0] || a.position[1] - b.position[1]);
  for (const p of relays) give(p, [...has.get(key(p))!].filter((e) => e !== "effect_spread"));
  return has;
}

/** Deterministic pseudo-random 10x10 layout of 1x1 plants (LCG, no Math.random). */
function randomLayout(seed: number): SimPlacement[] {
  const kinds = ["wild_rose", "wild_rose", "wild_rose", "wheat", "potato", "carrot", "nether_wart", "magic_jellybean", "cindershade", "fire"];
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const out: SimPlacement[] = [];
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) if (next() < 0.65) out.push(at(kinds[Math.floor(next() * kinds.length)], r, c));
  return out;
}

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

  it("a relay chain only passes through relays: a plant holding no effect_spread stops it", () => {
    // Row: nether_wart - A - rose - B. A and B relay (next to the rose); the rose itself doesn't.
    const sim = simulateEffects([at("nether_wart", 5, 5), at("wheat", 5, 6), at("wild_rose", 5, 7), at("wheat", 5, 8)]);
    // A relays improved_harvest_boost to the rose, but the rose does not relay it on to B.
    expect(held(sim, 5, 7)).toContain("improved_harvest_boost");
    expect(held(sim, 5, 8)).not.toContain("improved_harvest_boost");
  });

  it("relays share what they hold until nothing changes, in every direction", () => {
    // A west-running row of roses: under the old HashMap turn order the buff stopped after
    // two roses going west (grid D1); now the whole connected group holds it.
    const sim = simulateEffects(roseGrid("RRRRRRRYRR"));
    for (let c = 0; c < 10; c++) if (c !== 7) expect(held(sim, 0, c)).toContain(BUFF);
  });

  it("immunity blocks negatives for the holder but they still spread", () => {
    expect([...effectiveEffects(["immunity", "harvest_loss", "harvest_boost"])]).toEqual(["immunity", "harvest_boost"]);
  });

  it("improved_x hides x", () => {
    for (const base of ["xp_boost", "harvest_boost", "water_retain"]) {
      expect(effectiveEffects([base, `improved_${base}`]).has(base)).toBe(false);
    }
  });

  it("a multi-cell plant is one entity with one shared set", () => {
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

  it("a slot keeps everything it receives, effect_spread included, without becoming a relay (the dried-out plant rule)", () => {
    // A wheat flagged as a slot between a rose and a potato: it receives effect_spread
    // and immunity, gives nothing, and doesn't relay.
    const sim = simulateEffects([at("wild_rose", 5, 5), at("wheat", 5, 6, { isSlot: true }), at("potato", 5, 7)]);
    expect(held(sim, 5, 6)).toEqual(["effect_spread", "immunity"]);
    expect(held(sim, 5, 7)).toEqual([]); // no harvest_boost (not given), nothing relayed
    expect(held(sim, 5, 5)).toEqual([]); // the rose gets nothing back either
  });

  it("effects never leave the plot's own grid", () => {
    const sim = simulateEffects([at("wild_rose", 0, 9), at("wheat", 0, 8)]);
    expect(held(sim, 0, 8)).toEqual(["effect_spread"]);
  });

  it("Fire is inert scenery: it never holds a received effect and so can never relay one", () => {
    // Fire sits next to a Wild Rose (effect_spread) and a wheat (immunity).
    const sim = simulateEffects([at("wild_rose", 5, 5), at("wheat", 5, 4), at("fire", 5, 6), at("wheat", 5, 7)]);
    expect(held(sim, 5, 6)).toEqual([]);
    // The plant past Fire gets nothing, because inert Fire never relays.
    expect(held(sim, 5, 7)).toEqual([]);
  });
});

describe("effect spread since the Oct 13 2026 fix: direction-independent", () => {
  // In-game grids recorded by the user after the fix (screenshot): a jellybean among wild roses,
  // and EVERY rose held the jellybean's buff. The same layouts as the community's pre-fix
  // experiments D1-D6 and E1-E4, where the HashMap turn order left some roses unbuffed.
  const OBSERVED: Record<string, string> = {
    D1: "RRRRRRRYRR",
    D2: "RRRRRRYRRR",
    D3: "RRRRRYRRRR",
    D4: "RRRRYRRRRR",
    D5: "RRRYRRRRRR",
    D6: "RRYRRRRRRR",
    E1: ".RRR.../R.R.R../RRYRR../R.R.R../.RRR...",
    E2: "RRRRY../R...R../R...R../....R../RRRRR..",
    E3: "RRRRR../R...Y../R...R../....R../RRRRR..",
    E4: "RRRRR../....R../R...R../R...R../RRRRY..",
  };

  for (const [id, spec] of Object.entries(OBSERVED)) {
    it(`grid ${id}: every rose holds the jellybean's buff`, () => {
      const placements = roseGrid(spec);
      const sim = simulateEffects(placements);
      const missing = placements
        .filter((p) => p.id === "wild_rose" && !sim.heldAt(...p.position).has(BUFF))
        .map((p) => p.position.join(","));
      expect(missing).toEqual([]);
    });
  }

  it("the legacy helper reproduces a recorded pre-fix grid (D1: only 2 roses west of the jellybean)", () => {
    const old = legacyHeld(roseGrid(OBSERVED.D1));
    // (0,7) is the jellybean itself (a rose relays its buff back to it).
    const buffed = [...old].filter(([k, s]) => k !== "0,7" && s.has(BUFF)).map(([k]) => k).sort();
    expect(buffed).toEqual(["0,5", "0,6", "0,8", "0,9"]);
  });

  it("the old model really did miss roses in these grids (so they pin the change)", () => {
    for (const spec of Object.values(OBSERVED)) {
      const old = legacyHeld(roseGrid(spec));
      const roses = roseGrid(spec).filter((p) => p.id === "wild_rose");
      expect(roses.some((p) => !old.get(p.position.join(","))!.has(BUFF))).toBe(true);
    }
  });

  it("is a superset of the old HashMap-order model on every layout", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const placements = randomLayout(seed);
      const sim = simulateEffects(placements);
      for (const [cell, set] of legacyHeld(placements)) {
        const [r, c] = cell.split(",").map(Number);
        const now = sim.heldAt(r, c);
        for (const e of set) expect(now.has(e), `seed ${seed} cell ${cell} lost ${e}`).toBe(true);
      }
    }
  });

  it("rotating or mirroring a layout rotates or mirrors the result", () => {
    const transforms: Array<(r: number, c: number) => [number, number]> = [
      (r, c) => [c, 9 - r], // 90 degrees
      (r, c) => [9 - r, 9 - c], // 180 degrees
      (r, c) => [r, 9 - c], // mirror east-west
      (r, c) => [9 - r, c], // mirror north-south
    ];
    for (let seed = 1; seed <= 100; seed++) {
      const placements = randomLayout(seed);
      const base = simulateEffects(placements);
      for (const t of transforms) {
        const moved = simulateEffects(placements.map((p) => ({ ...p, position: t(...p.position) })));
        for (const p of placements) expect(held(moved, ...t(...p.position))).toEqual(held(base, ...p.position));
      }
    }
  });

  it("effects pass along a long winding chain of relays", () => {
    // A snake of roses from a jellybean at the top-left corner to the bottom-right corner.
    const snake = ["YRRRRRRRRR", ".........R", "RRRRRRRRRR", "R.........", "RRRRRRRRRR", ".........R", "RRRRRRRRRR", "R.........", "RRRRRRRRRR", ".........R"];
    const sim = simulateEffects(roseGrid(snake.join("/")));
    expect(held(sim, 9, 9)).toContain(BUFF);
  });
});
