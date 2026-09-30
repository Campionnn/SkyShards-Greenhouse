import { describe, expect, it } from "vitest";
import { engine, layout, singlePlot, start } from "../testHelpers";
import type { SimulationState } from "../sim/state";
import { drive } from "./driver";
import { createTimeline, type Timeline } from "./timeline";

const busy = () => start(singlePlot(layout([["pumpkin", 4, 4], ["melon", 4, 6], ["wheat", 2, 2], ["wheat", 2, 3]]), { seed: 17 }));
const noYield = () => Promise.resolve();
const json = (s: SimulationState) => JSON.stringify(s);

/** A Step / Run the way the worker does it. */
async function runOn(tl: Timeline, ticks: number, stopAfterSlices?: number) {
  tl.beginRun();
  let slices = 0;
  const r = await drive(engine, tl.current(), ticks, {
    retainEvents: "none",
    shouldStop: () => stopAfterSlices !== undefined && ++slices > stopAfterSlices,
    yieldToEventLoop: noYield,
    checkpoints: { every: tl.checkpointEvery, save: tl.checkpoint },
  });
  tl.endRun(r.state, r.cyclesRun);
  return r;
}

describe("session timeline (going back)", () => {
  it("checkpointing does not change a run's result", async () => {
    const s = busy();
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 7 });
    await runOn(tl, 150);
    expect(json(tl.current())).toBe(json(engine.run(s, 150).state));
  });

  it("Back goes exactly one cycle, all the way to the setup state", async () => {
    const s = busy();
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 10, recentStates: 4 });
    await runOn(tl, 60);
    for (let cycle = 59; cycle >= 0; cycle--) {
      const back = tl.stepBack();
      expect(back!.cycle).toBe(cycle);
      expect(json(back!)).toBe(json(cycle === 0 ? s : engine.run(s, cycle).state));
    }
    expect(tl.info().canStepBack).toBe(false);
    expect(tl.stepBack()).toBeNull();
    expect(tl.info().lastAction).toBeNull();
  });

  it("Undo takes back whole Runs and Steps, newest first", async () => {
    const s = busy();
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 16 });
    await runOn(tl, 100);
    await runOn(tl, 1);
    await runOn(tl, 1);
    expect(tl.info().lastAction).toEqual({ kind: "run", fromCycle: 101, cycles: 1 });
    expect(tl.undo()!.state.cycle).toBe(101);
    expect(tl.undo()!.state.cycle).toBe(100);
    const r = tl.undo()!;
    expect(r.action).toEqual({ kind: "run", fromCycle: 0, cycles: 100 });
    expect(json(r.state)).toBe(json(s));
    expect(tl.undo()).toBeNull();
  });

  it("a stopped run undoes as the part that ran", async () => {
    const tl = createTimeline(engine, busy());
    const r = await runOn(tl, 400, 3);
    expect(r.truncated).toBe(true);
    expect(tl.info().lastAction).toEqual({ kind: "run", fromCycle: 0, cycles: r.cyclesRun });
  });

  it("going back reverts inventory changes too, and Undo reverts just the change", async () => {
    const s = busy();
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 10 });
    await runOn(tl, 30);
    const before = tl.current();
    const changed = engine.addItems(before, { chloronite: 5 });
    tl.itemsChanged(changed, { chloronite: 5 });
    await runOn(tl, 25);
    const withItems = engine.run(changed, 25).state;
    expect(json(tl.current())).toBe(json(withItems));

    // Back one cycle stays on the changed history.
    expect(json(tl.stepBack()!)).toBe(json(engine.run(changed, 24).state));
    // Undo: the (shortened) run, then the inventory change.
    expect(tl.info().lastAction).toEqual({ kind: "run", fromCycle: 30, cycles: 24 });
    expect(json(tl.undo()!.state)).toBe(json(changed));
    const undone = tl.undo()!;
    expect(undone.action).toEqual({ kind: "items", cycle: 30, items: { chloronite: 5 } });
    expect(json(undone.state)).toBe(json(before));
    expect(undone.state.inventory.chloronite ?? 0).toBe(before.inventory.chloronite ?? 0);
  });

  it("Back past an inventory change drops it and its undo entry", async () => {
    const s = busy();
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 10 });
    await runOn(tl, 20);
    tl.itemsChanged(engine.addItems(tl.current(), { chloronite: 5 }), { chloronite: 5 });
    await runOn(tl, 5);
    for (let i = 0; i < 6; i++) tl.stepBack();
    expect(json(tl.current())).toBe(json(engine.run(s, 19).state));
    expect(tl.info().lastAction).toEqual({ kind: "run", fromCycle: 0, cycles: 19 });
    // Running again re-simulates without the change.
    await runOn(tl, 11);
    expect(json(tl.current())).toBe(json(engine.run(s, 30).state));
  });

  it("stays bounded on long runs and still goes back exactly", async () => {
    const s = busy();
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 5, maxPeriodicCheckpoints: 4, recentStates: 3 });
    await runOn(tl, 300);
    expect(tl.checkpointEvery()).toBeGreaterThan(5);
    expect(json(tl.stepBack()!)).toBe(json(engine.run(s, 299).state));
    expect(json(tl.undo()!.state)).toBe(json(s));
  });
});
