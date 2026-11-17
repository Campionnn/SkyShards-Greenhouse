import { describe, expect, it } from "vitest";
import { createEngine } from "../simulator/engine";
import { flow, layout, scenario, step } from "../simulator/testHelpers";
import { distribution, histogram, mcPoints, quantile } from "./montecarlo";
import { submissionFromScenario } from "./rules";
import { enteredPlayerStats, runStatsSeed, withStats } from "./statsTest";
import { tierStats } from "./tiers";
import { runOnce } from "./verify";

describe("Monte Carlo statistics", () => {
  it("quantiles interpolate like numpy", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 1)).toBe(10);
    expect(quantile(s, 0.5)).toBeCloseTo(5.5);
    expect(quantile(s, 0.05)).toBeCloseTo(1.45);
    expect(quantile(s, 0.95)).toBeCloseTo(9.55);
    expect(quantile([7], 0.3)).toBe(7);
  });

  it("summarises a distribution", () => {
    const d = distribution([10, 20, 30, 40, -5])!;
    expect(d.n).toBe(5);
    expect(d.median).toBe(20);
    expect(d.mean).toBe(19);
    expect(d.min).toBe(-5);
    expect(d.max).toBe(40);
    expect(d.lossShare).toBeCloseTo(0.2);
    expect(d.sd).toBeCloseTo(Math.sqrt(((10 - 19) ** 2 + 1 + 121 + 441 + 576) / 4));
    expect(d.meanMargin).toBeCloseTo((1.96 * d.sd) / Math.sqrt(5));
    expect(d.lo).toBeLessThan(d.q1);
    expect(d.hi).toBeGreaterThan(d.q3);
    expect(distribution([])).toBeNull();
    expect(distribution([NaN, 3])!.n).toBe(1);
    expect(distribution([3])!.meanMargin).toBe(0);
  });

  it("histograms count every value", () => {
    const v = Array.from({ length: 100 }, (_, i) => i);
    const h = histogram(v);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(100);
    expect(h[0].from).toBe(0);
    expect(h[h.length - 1].to).toBe(99);
    expect(histogram([5, 5])).toEqual([{ from: 5, to: 5, count: 2 }]);
  });

  it("points per frequency leave failed seeds out", () => {
    const pts = mcPoints(
      [
        { every: 1, value: 100 },
        { every: 1, value: 300 },
        { every: 1, value: null },
        { every: 2, value: 50, effort: 10 },
      ],
      [1, 2, 4],
    );
    expect(pts[0]).toMatchObject({ every: 1, profitPerDay: 200, runs: 3, failed: 1, n: 2 });
    expect(pts[1]).toMatchObject({ profitPerDay: 50, effortAvg: 10 });
    expect(pts[2]).toMatchObject({ profitPerDay: null, runs: 0, dist: null });
  });
});

describe("Test with your stats", () => {
  const engine = createEngine();
  const sub = () => submissionFromScenario(scenario([flow([step("one", layout([["wheat", 0, 0], ["carrot", 0, 2]]))])], { policies: { baseCropUpkeep: "harvestWhenGrown" } }));

  it("with the max tier's stats it equals the server's own run", () => {
    const a = runStatsSeed(engine, { submission: sub(), kind: "normal", stats: tierStats("max"), every: 2, seed: 9, cycles: 200, wallMs: 60_000 });
    const b = runOnce(engine, sub(), "normal", "max", 2, 9, 200, { wallMs: 60_000 });
    expect(a.ok).toBe(true);
    expect(a.result!.produced).toEqual(b.result!.produced);
  });

  it("swaps in the viewer's exact stats", () => {
    const slow = { ...tierStats("low"), farmingFortune: 0 };
    const e = withStats(engine, slow);
    const st = e.initState(scenario([flow([step("one", layout([["wheat", 0, 0]]))])])).state;
    expect(st.scenario.settings.playerStats.cropGrowth).toBe(slow.cropGrowth);
    expect(st.scenario.settings.playerStats.farmingFortune).toBe(0);
    const max = runStatsSeed(engine, { submission: sub(), kind: "ironman_kit", stats: tierStats("max"), every: 1, seed: 3, cycles: 200, wallMs: 60_000 });
    const low = runStatsSeed(engine, { submission: sub(), kind: "ironman_kit", stats: slow, every: 1, seed: 3, cycles: 200, wallMs: 60_000 });
    const wheat = (r: typeof max) => r.result!.produced.wheat ?? 0;
    expect(wheat(low)).toBeLessThan(wheat(max));
  });

  it("from nothing returns the from-nothing result", () => {
    const o = runStatsSeed(engine, { submission: sub(), kind: "ironman", stats: tierStats("max"), every: 1, seed: 1, cycles: 200, wallMs: 60_000 });
    expect(o.ok).toBe(true);
    expect(o.result?.prep).toBeDefined();
  });

  it("entered stats fill the full player stats", () => {
    const s = enteredPlayerStats({ ...tierStats("mid"), cropFortune: { wheat: 50 }, tools: [] });
    expect(s.cropGrowth).toBe(tierStats("mid").cropGrowth);
    expect(s.cropFortune).toEqual({ wheat: 50 });
    expect(s.tools).toBeUndefined();
    expect(s.startTimeOfDay).toBe(0);
  });
});
