import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { footprint } from "../grid/cells";
import { engine, flow, layout, scenario, step } from "../testHelpers";
import type { Scenario, SimulationState } from "./state";

// Invariants over random small scenarios. Each run is short; fast-check
// explores the space of layouts, seeds, schedules and split points.

const KINDS = ["wheat", "potato", "carrot", "pumpkin", "melon", "cocoa_beans", "nether_wart", "wild_rose", "fire", "gloomgourd", "choconut", "chloronite"];

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    cells: fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { minLength: 0, maxLength: 14 }),
    kinds: fc.array(fc.constantFrom(...KINDS), { minLength: 14, maxLength: 14 }),
    seed: fc.integer({ min: 0, max: 1_000_000 }),
    n: fc.integer({ min: 1, max: 4 }),
    stock: fc.integer({ min: 0, max: 5 }),
    upkeep: fc.constantFrom("leaveUntilDecay" as const, "harvestWhenGrown" as const, "harvestBeforeDecay" as const),
    plots: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ cells, kinds, seed, n, stock, upkeep, plots }) => {
    const spec = layout(cells.map((c, i) => [kinds[i], Math.floor(c / 10), c % 10]));
    const f = flow([step("a", spec, [{ kind: "cycles", n: 5 }]), step("b", layout(spec.plants.slice(0, 3).map((p) => [p.kindId, p.row, p.col])), [{ kind: "cycles", n: 4 }])], true);
    return scenario(Array.from({ length: plots }, () => f), {
      seed,
      activity: { kind: "everyN", n, offset: 0 },
      policies: { baseCropUpkeep: upkeep },
      inventory: { fire: stock, gloomgourd: stock, choconut: stock, chloronite: stock },
    });
  });

const json = (s: SimulationState) => JSON.stringify(s);

describe("properties", () => {
  it("run(s, a + b) === run(run(s, a), b) for any split", () => {
    fc.assert(
      fc.property(arbScenario, fc.integer({ min: 0, max: 25 }), fc.integer({ min: 0, max: 25 }), (sc, a, b) => {
        const s = engine.initState(sc).state;
        return json(engine.run(engine.run(s, a).state, b).state) === json(engine.run(s, a + b).state);
      }),
      { numRuns: 40 }
    );
  });

  it("inventory conservation: stock = starting + produced - consumed, and never negative", () => {
    fc.assert(
      fc.property(arbScenario, (sc) => {
        const r = engine.run(engine.initState(sc).state, 40, { retainEvents: "none" });
        for (const [item, row] of Object.entries(r.state.ledger)) {
          const expected = (sc.startingInventory[item] ?? 0) + row.produced - row.consumed;
          if ((r.state.inventory[item] ?? 0) !== expected) return false;
          if ((r.state.inventory[item] ?? 0) < 0) return false;
        }
        return true;
      }),
      { numRuns: 40 }
    );
  });

  it("plots stay well-formed: footprints on the grid, disjoint, plants sorted", () => {
    fc.assert(
      fc.property(arbScenario, (sc) => {
        const r = engine.run(engine.initState(sc).state, 40, { retainEvents: "none" });
        for (const plot of r.state.plots) {
          const seen = new Set<number>();
          let prev = -1;
          for (const p of plot.plants) {
            if (p.row < 0 || p.col < 0 || p.row + p.size > 10 || p.col + p.size > 10) return false;
            for (const c of footprint(p.row, p.col, p.size)) {
              if (seen.has(c)) return false;
              seen.add(c);
            }
            const key = p.row * 10 + p.col;
            if (key < prev) return false;
            prev = key;
          }
        }
        return true;
      }),
      { numRuns: 40 }
    );
  });

  it("spawns never exceed cycles x cells, and revenue reconciles to profit", () => {
    fc.assert(
      fc.property(arbScenario, (sc) => {
        const cycles = 30;
        const r = engine.run(engine.initState(sc).state, cycles, { retainEvents: "none" });
        const spawned = Object.values(r.summary.spawned).reduce((a, b) => a + b, 0);
        const revenue = r.summary.revenue.crops + r.summary.revenue.rareDrops + r.summary.revenue.rareCrops + r.summary.revenue.mutationItems;
        return spawned <= cycles * 100 * sc.plots.length && r.summary.profit === revenue - r.summary.costs.replacements - r.summary.costs.supplies;
      }),
      { numRuns: 30 }
    );
  });

  it("with nothing that can spawn, more starting stock never adds debt", () => {
    // Monotonicity only holds when spawning is off: a filled cell changes eligibility, and so the RNG path.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 }), (low, extra) => {
        const build = (stock: number) =>
          scenario([flow([step("a", layout([["chloronite", 1, 1], ["chloronite", 1, 3], ["chloronite", 3, 1]]))])], {
            config: { spawnCells: "slotsOnly" },
            inventory: { chloronite: stock },
          });
        const debts = (stock: number) => engine.run(engine.initState(build(stock)).state, 60, { retainEvents: "none" }).summary.debtEvents;
        return debts(low + extra) <= debts(low);
      }),
      { numRuns: 25 }
    );
  });
});

it("a 500-cycle, 3-plot run stays fast enough for the worker", () => {
  const busy = scenario(
    [1, 2, 3].map(() =>
      flow([step("a", layout(KINDS.slice(0, 8).flatMap((k, i) => [[k, 2, i] as [string, number, number], [k, 6, i] as [string, number, number]])))])
    ),
    { inventory: {} }
  );
  const t = performance.now();
  engine.run(engine.initState(busy).state, 500, { retainEvents: "none" });
  expect(performance.now() - t).toBeLessThan(10_000);
});
