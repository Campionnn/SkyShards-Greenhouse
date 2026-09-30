import { describe, expect, it } from "vitest";
import { engine, flow, inject, layout, plantAt, scenario, stage, start } from "../testHelpers";
import type { SimulationState, TimedEvent } from "../sim/state";
import type { Trigger } from "./types";

// Hybrid rotations: a mutation grown in one stage is used as an input of the
// next stage while it is still growing. The user's example: grow 9 Magic
// Jellybeans (120 stages, never decay) in a sugar cane + duskbloom layout,
// then use those same 9 jellybeans - still growing - as Chorus Fruit inputs.

/** Sugar cane + duskbloom around 9 empty Magic Jellybean targets (sand). */
const JELLYBEAN_CODE = "M9MprTE0rElMTEoEYj09vUTHJEcgBrFIFsMPAA";
/** 15 Magic Jellybean + chloronite inputs around 9 Chorus Fruit targets. Its jellybeans at
 *  (1,1) (1,3) (1,5) (3,1) (3,3) (3,5) (5,1) (5,3) (5,5) are the cells the first layout grows. */
const CHORUS_CODE = "MzTUqawxNK3RS0pMSkpMTNLT00t0BEEQKwkCUMXwqsMLAA";
const JELLY_CELLS: [number, number][] = [1, 3, 5].flatMap((r) => [1, 3, 5].map((c) => [r, c] as [number, number]));

const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);
const stageIdOf = (s: SimulationState) => s.scenario.plots[0].flow.stages[s.flows[0].stageIndex].id;

function hybrid(config: Record<string, unknown> = {}, useExit: Trigger[] = [{ kind: "fullyGrown", mutationId: "magic_jellybean", count: 9 }]) {
  return scenario(
    [
      flow(
        [
          stage("grow", { code: JELLYBEAN_CODE }, [{ kind: "targetsFilled", count: 0 }]),
          stage("use", { code: CHORUS_CODE }, useExit),
        ],
        true
      ),
    ],
    { seed: 7, config, inventory: { magic_jellybean: 50, chloronite: 500, duskbloom: 500 } }
  );
}

/** Step until the plot enters `stageId`; returns the state and every event on the way. */
function runUntilStage(s: SimulationState, stageId: string, max: number) {
  const events: TimedEvent[] = [];
  for (let i = 0; i < max; i++) {
    const r = engine.run(s, 1);
    events.push(...r.events);
    s = r.state;
    if (ofKind(r.events, "stageChanged").some((e) => e.toStage === stageId)) return { state: s, events };
  }
  throw new Error(`never reached stage ${stageId} in ${max} cycles`);
}

describe("hybrid rotations (spawnsFillLayoutInputs)", () => {
  it("the full cycle: fill targets -> keep them as chorus inputs while growing -> harvest when fully grown", () => {
    let s = start(hybrid());
    // Stage 1: wait for all 9 jellybean targets to be filled.
    const toUse = runUntilStage(s, "use", 400);
    s = toUse.state;
    const spawnedJellies = ofKind(toUse.events, "spawned").filter((e) => e.mutationId === "magic_jellybean");
    expect(spawnedJellies.length).toBeGreaterThanOrEqual(9);

    // The 9 spawned jellybeans are still there, still growing, and are the chorus layout's inputs.
    for (const [r, c] of JELLY_CELLS) {
      const p = plantAt(s, 1, r, c);
      expect(p).toMatchObject({ kindId: "magic_jellybean", origin: "spawned" });
      expect(p!.stage).toBeLessThan(120);
    }
    // Only the 6 jellybeans the first layout did not grow were placed from inventory.
    const placedJellies = ofKind(toUse.events, "placed").filter((e) => e.kindId === "magic_jellybean");
    expect(placedJellies).toHaveLength(6);
    expect(s.inventory.magic_jellybean).toBe(50 - 6);
    expect(ofKind(toUse.events, "destroyed").some((e) => e.kindId === "magic_jellybean")).toBe(false);

    // Stage 2: growing jellybeans count as inputs, so Chorus Fruit spawns long before they are fully grown.
    const back = runUntilStage(s, "grow", 1000);
    const chorus = ofKind(back.events, "spawned").filter((e) => e.mutationId === "chorus_fruit");
    expect(chorus.length).toBeGreaterThan(0);
    const firstFullyGrownJelly = back.events.find((e) => e.kind === "fullyGrown" && e.kindId === "magic_jellybean");
    expect(chorus[0].cycle).toBeLessThan(firstFullyGrownJelly!.cycle);
    // Nobody harvested the jellybeans while the chorus layout used them.
    const beforeSwitch = back.events.filter((e) => e.kind !== "stageChanged" && e.cycle < back.state.cycle - 1);
    expect(ofKind(beforeSwitch, "harvested").some((e) => e.kindId === "magic_jellybean")).toBe(false);

    // Back to stage 1: the fully grown jellybeans are harvested (base x10 at stage 120, scaled by
    // the yield sum) and the targets reopen.
    const lastCycle = ofKind(back.events, "harvested").filter((e) => e.kindId === "magic_jellybean" && e.origin === "spawned");
    expect(lastCycle).toHaveLength(9);
    expect(lastCycle.every((e) => e.cycle === back.state.cycle - 1)).toBe(true);
    expect(lastCycle.every((e) => (e.drops.magic_jellybean ?? 0) >= 5)).toBe(true);
    for (const [r, c] of JELLY_CELLS) expect(plantAt(back.state, 1, r, c)).toBeUndefined();
    expect(stageIdOf(back.state)).toBe("grow");
  });

  it("with spawnsFillLayoutInputs off the growing jellybeans are broken and all 15 are placed from inventory", () => {
    const { state, events } = runUntilStage(start(hybrid({ spawnsFillLayoutInputs: false })), "use", 400);
    expect(ofKind(events, "destroyed").filter((e) => e.kindId === "magic_jellybean")).toHaveLength(9);
    expect(ofKind(events, "placed").filter((e) => e.kindId === "magic_jellybean")).toHaveLength(15);
    for (const [r, c] of JELLY_CELLS) expect(plantAt(state, 1, r, c)).toMatchObject({ kindId: "magic_jellybean", origin: "placed" });
  });

  it("layoutInputSpawns: harvest treats a spawn used as an input like any other spawn", () => {
    // One fully grown spawned wheat-ring input... use a quick mutation: a spawned chloronite where the layout places one.
    const spec = layout([["chloronite", 4, 4]]);
    const keep = start(scenario([flow([stage("a", spec)])], { config: { spawnCells: "slotsOnly" } }));
    const plot = keep.plots[0];
    plot.plants = [];
    inject(keep, 1, "chloronite", 4, 4, "spawned", { stage: 10 });
    const kept = engine.run(keep, 2).state;
    expect(plantAt(kept, 1, 4, 4)).toMatchObject({ kindId: "chloronite", origin: "spawned" });

    const harvest = structuredClone(keep);
    harvest.scenario.settings.policies.layoutInputSpawns = "harvest";
    const r = engine.run(harvest, 1);
    expect(ofKind(r.events, "harvested").map((e) => e.kindId)).toEqual(["chloronite"]);
    // ...and the layout input is then re-placed from inventory (with the chloronite it just dropped).
    expect(ofKind(r.events, "placed").map((e) => [e.kindId, e.origin])).toEqual([["chloronite", "placed"]]);
    expect(plantAt(r.state, 1, 4, 4)).toMatchObject({ kindId: "chloronite", origin: "placed" });
  });

  it("a kept input is still harvested just before it would decay", () => {
    const spec = layout([["chloronite", 4, 4]]);
    const s = start(scenario([flow([stage("a", spec)])], { config: { spawnCells: "slotsOnly" } }));
    s.plots[0].plants = [];
    inject(s, 1, "chloronite", 4, 4, "spawned", { stage: 10, decaySecondsRemaining: 14400 * 2 + 1 });
    const r = engine.run(s, 3);
    const h = ofKind(r.events, "harvested");
    expect(h.map((e) => e.kindId)).toEqual(["chloronite"]);
    expect(ofKind(r.events, "decayed")).toHaveLength(0);
  });
});

describe("new triggers", () => {
  it("targetsFilled counts slots holding their labelled mutation, growing or not", () => {
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5], ["gloomgourd", 6, 5]]);
    // Not harvested, so the trigger (checked after the player's harvest) sees them standing.
    const sc = scenario([flow([stage("a", spec, [{ kind: "targetsFilled", count: 1 }]), stage("b", layout())])], {
      config: { spawnCells: "slotsOnly" },
      policies: { spawnedHarvest: "never" },
    });
    const s = start(sc);
    inject(s, 1, "gloomgourd", 4, 5, "spawned");
    expect(stageIdOf(engine.run(s, 1).state)).toBe("b");

    const all = structuredClone(sc);
    all.plots[0].flow.stages[0].exit = [{ kind: "targetsFilled", count: 0 }];
    const s2 = start(all);
    inject(s2, 1, "gloomgourd", 4, 5, "spawned");
    expect(stageIdOf(engine.run(s2, 1).state)).toBe("a"); // only 1 of 2
    inject(s2, 1, "gloomgourd", 6, 5, "spawned");
    expect(stageIdOf(engine.run(s2, 1).state)).toBe("b");
  });

  it("mutationHarvested counts natural spawns harvested in the stage", () => {
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]);
    const sc = scenario([flow([stage("a", spec, [{ kind: "mutationHarvested", mutationId: "gloomgourd", count: 1 }]), stage("b", layout())])], {
      config: { spawnCells: "slotsOnly" },
    });
    const s = start(sc);
    inject(s, 1, "gloomgourd", 4, 5, "spawned", { stage: 1000 });
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "harvested").map((e) => e.kindId)).toContain("gloomgourd");
    expect(stageIdOf(r.state)).toBe("b");
  });

  it("validation warns about a targetsFilled trigger on a layout without targets", () => {
    const issues = engine.validate(scenario([flow([stage("a", layout([["wheat", 0, 0]]), [{ kind: "targetsFilled", count: 0 }]), stage("b", layout())], true)]));
    expect(issues.some((i) => i.level === "warning" && /no targets/.test(i.message))).toBe(true);
  });
});
