import { describe, expect, it } from "vitest";
import { defaultGameData } from "../simulator/data/default";
import { flow, layout, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step } from "../simulator/testHelpers";
import { submissionFromScenario } from "./rules";
import { summarizeSubmission } from "./summary";
import { cycleHours, snapToTier, TIER_STATS } from "./tiers";

const data = defaultGameData();

describe("summarizeSubmission", () => {
  it("lists targets, paid placements, start-step crops, steps and thumbnails per plot", () => {
    const sc = scenario([
      flow([step("a", { code: LAYOUT_A_CODE }, [{ kind: "cycles", n: 5 }]), step("b", { code: LAYOUT_B_CODE })], true),
      flow([step("c", layout([["wheat", 0, 0], ["chloronite", 2, 2], ["fire", 4, 4]], [["chorus_fruit", 6, 6]]))]),
    ]);
    sc.plots[1].script = { source: "function onTick() {}" };
    const s = summarizeSubmission(submissionFromScenario(sc), data);
    expect(s.plots).toHaveLength(2);
    expect(s.steps).toBe(3);
    expect(s.scripted).toBe(true);
    expect(s.plots[0]).toMatchObject({ id: 1, steps: 2, loop: true, scripted: false, thumb: LAYOUT_A_CODE });
    expect(s.plots[1]).toMatchObject({ id: 2, steps: 1, thumb: null, crops: { wheat: 1 }, placed: { chloronite: 1 }, targets: { chorus_fruit: 1 } });
    expect(s.plots[1].placed.fire).toBeUndefined(); // free
    expect(s.targets).toContain("chorus_fruit");
    expect(s.inputs).toContain("chloronite");
    // Targets over all plots, most cells first.
    const counts = s.targets.map((t) => s.plots.reduce((n, p) => n + (p.targets[t] ?? 0), 0));
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

describe("snapToTier", () => {
  it("snaps each preset to itself and in-between stats to the nearest", () => {
    for (const t of ["max", "high", "mid", "low"] as const) expect(snapToTier(TIER_STATS[t]).tier).toBe(t);
    const between = { ...TIER_STATS.mid, cropGrowth: 120 };
    expect(snapToTier(between).tier).toBe("mid");
    const s = snapToTier(TIER_STATS.max);
    expect(s.position).toBe(1);
    expect(snapToTier(TIER_STATS.low).position).toBe(0);
    expect(s.scores.max).toBeGreaterThan(s.scores.low);
  });

  it("cycle length follows growth speed (4 h at nothing, ~1.75 h at max)", () => {
    expect(cycleHours({ cropGrowth: 0, speedAttribute: 0, growthUpgradeTier: 0, floraShard: 0, mutationChanceBonus: 0, miningFortune: 0 })).toBe(4);
    expect(cycleHours(TIER_STATS.max)).toBeCloseTo(4 / (1 + 0.525 + 0.01 + 0.5 + 0.25), 5);
  });
});
