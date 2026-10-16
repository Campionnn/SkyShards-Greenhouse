import { describe, expect, it } from "vitest";
import type { PolicyOverrides } from "../flow/types";
import { inject, layout, plantAt, singlePlot, start, TIMER_ONLY } from "../testHelpers";
import type { ActivitySchedule, SimulationState } from "./state";

// Player policies for placed layout items:
// - placedUpkeep "replaceBeforeDecay": swap a placed mutation that would decay before the next
//   session for a fresh one, like base crops' harvestBeforeDecay.
// - onlyReplaceForEmptyTargets: only re-place requirement inputs while a target they feed is empty.

const ONLINE: ActivitySchedule = { kind: "everyN", n: 1, offset: 0 };
/** No base crops standing and Flora 0: cycles are exactly 4 h. */
const CYCLE = 4 * 3600;
const eng = TIMER_ONLY;

describe("placedUpkeep: replaceBeforeDecay", () => {
  const setup = (policies: PolicyOverrides, inventory: Record<string, number> = { puffercloud: 5 }) => {
    const s = start(
      singlePlot(layout([["puffercloud", 0, 0]]), { activity: ONLINE, policies, inventory, config: { waterLossMin: 0, waterLossMax: 0 } }),
      eng
    );
    const p = plantAt(s, 1, 0, 0)!;
    // The tick takes one cycle off, leaving half a cycle: it decays before the next session.
    p.decaySecondsRemaining = 1.5 * CYCLE;
    return { s, id: p.id };
  };

  it("swaps a placed mutation that would decay before the next session for a fresh one", () => {
    const { s, id } = setup({ placedUpkeep: "replaceBeforeDecay" });
    const r = eng.run(s, 1);
    const p = plantAt(r.state, 1, 0, 0)!;
    expect(p.kindId).toBe("puffercloud");
    expect(p.id).not.toBe(id);
    expect(p.decaySecondsRemaining).toBe(eng.data.mutations.puffercloud.decayDays * 86400);
    expect(r.state.inventory.puffercloud).toBe(4);
    expect(r.state.summary.decayed.puffercloud ?? 0).toBe(0);
    expect(r.state.summary.replacements).toBe(1);
    // It never decays: replaced again each time it comes due.
    const later = eng.run(r.state, 60);
    expect(later.state.summary.decayed.puffercloud ?? 0).toBe(0);
    expect(plantAt(later.state, 1, 0, 0)!.isDeadPlant).toBe(false);
  });

  it("leaves it alone while the timer has more than a session left", () => {
    const { s, id } = setup({ placedUpkeep: "replaceBeforeDecay" });
    plantAt(s, 1, 0, 0)!.decaySecondsRemaining = 3 * CYCLE;
    const r = eng.run(s, 1);
    expect(plantAt(r.state, 1, 0, 0)!.id).toBe(id);
    expect(r.state.inventory.puffercloud).toBe(5);
  });

  it("default (leaveUntilDecay): it decays into a Dead Plant and is re-placed afterwards", () => {
    const { s } = setup({});
    const r = eng.run(s, 2);
    expect(r.state.summary.decayed.puffercloud).toBe(1);
    expect(plantAt(r.state, 1, 0, 0)!.kindId).toBe("puffercloud");
    expect(r.state.inventory.puffercloud).toBe(4);
  });

  it("never swaps on credit: out of stock, it is left to decay without debt", () => {
    const { s, id } = setup({ placedUpkeep: "replaceBeforeDecay" }, {});
    const r = eng.run(s, 1);
    expect(plantAt(r.state, 1, 0, 0)!.id).toBe(id);
    expect(r.state.summary.debtEvents).toBe(0);
  });

  it("is deterministic and splittable", () => {
    const { s } = setup({ placedUpkeep: "replaceBeforeDecay" });
    const whole = eng.run(s, 40).state;
    const split = eng.run(eng.run(s, 17).state, 23).state;
    expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
  });
});

describe("onlyReplaceForEmptyTargets", () => {
  // A Devourer target ringed by 4 Zombud + 4 Puffercloud, plus one Puffercloud feeding no target.
  const RING: [string, number, number][] = [
    ["zombud", 4, 4], ["zombud", 4, 5], ["zombud", 4, 6], ["zombud", 5, 4],
    ["puffercloud", 5, 6], ["puffercloud", 6, 4], ["puffercloud", 6, 5], ["puffercloud", 6, 6],
  ];
  const setup = (policies: PolicyOverrides): SimulationState => {
    const s = start(
      singlePlot(layout([...RING, ["puffercloud", 0, 0]], [["devourer", 5, 5]]), {
        activity: ONLINE,
        policies: { spawnedHarvest: "never", ...policies },
        inventory: { zombud: 10, puffercloud: 10 },
        config: { waterLossMin: 0, waterLossMax: 0 },
      }),
      eng
    );
    // A fully grown Devourer (no more roots) stands on its target.
    const m = eng.data.mutations.devourer;
    inject(s, 1, "devourer", 5, 5, "spawned", { stage: m.growthStages!, lockedEffects: [], fullyGrownAtCycle: 0 }, eng);
    return s;
  };
  const without = (s: SimulationState, row: number, col: number) => {
    s.plots[0].plants = s.plots[0].plants.filter((p) => !(p.row === row && p.col === col));
    return s;
  };

  it("doesn't re-place a lost input while its target holds the mutation", () => {
    const s = without(without(setup({ onlyReplaceForEmptyTargets: true }), 4, 4), 0, 0);
    const r = eng.run(s, 1);
    expect(plantAt(r.state, 1, 4, 4)).toBeUndefined();
    expect(r.state.inventory.zombud).toBe(10);
    // An input that feeds no target is always re-placed.
    expect(plantAt(r.state, 1, 0, 0)?.kindId).toBe("puffercloud");
  });

  it("re-places it once the target is empty again", () => {
    const s = without(without(setup({ onlyReplaceForEmptyTargets: true }), 4, 4), 5, 5);
    const r = eng.run(s, 1);
    expect(plantAt(r.state, 1, 4, 4)?.kindId).toBe("zombud");
    expect(r.state.inventory.zombud).toBe(9);
  });

  it("off (default): the lost input is re-placed even though the target is full", () => {
    const s = without(setup({}), 4, 4);
    const r = eng.run(s, 1);
    expect(plantAt(r.state, 1, 4, 4)?.kindId).toBe("zombud");
    expect(r.state.inventory.zombud).toBe(9);
  });

  it("with replaceBeforeDecay, inputs of a full target are left to decay", () => {
    const s = setup({ onlyReplaceForEmptyTargets: true, placedUpkeep: "replaceBeforeDecay" });
    const zombud = plantAt(s, 1, 4, 4)!;
    const far = plantAt(s, 1, 0, 0)!;
    zombud.decaySecondsRemaining = 1.5 * CYCLE;
    far.decaySecondsRemaining = 1.5 * CYCLE;
    const r = eng.run(s, 1);
    expect(plantAt(r.state, 1, 4, 4)!.id).toBe(zombud.id);
    expect(plantAt(r.state, 1, 0, 0)!.id).not.toBe(far.id);
  });
});
