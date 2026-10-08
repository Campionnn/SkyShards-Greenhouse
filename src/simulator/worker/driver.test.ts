import { describe, expect, it } from "vitest";
import { engine, layout, singlePlot, start } from "../testHelpers";
import { drive } from "./driver";
import { createTimeline } from "./timeline";

const busy = () => start(singlePlot(layout([["pumpkin", 4, 4], ["melon", 4, 6], ["wheat", 2, 2], ["wheat", 2, 3]]), { seed: 17 }));
const noYield = () => Promise.resolve();

describe("worker driver (time-sliced run)", () => {
  it("slicing a run gives exactly the result of one uninterrupted run", async () => {
    const s = busy();
    const sliced = await drive(engine, s, 150, { retainEvents: "all", shouldStop: () => false, yieldToEventLoop: noYield });
    const whole = engine.run(s, 150);
    expect(JSON.stringify(sliced.state)).toBe(JSON.stringify(whole.state));
    expect(sliced.events.length).toBe(whole.events.length);
    expect(sliced.eventCounts).toEqual(whole.eventCounts);
  });

  it("stop leaves a consistent state that continues like an uninterrupted run", async () => {
    const s = busy();
    let checks = 0;
    const stopped = await drive(engine, s, 400, { retainEvents: "none", shouldStop: () => ++checks > 3, yieldToEventLoop: noYield });
    expect(stopped.truncated).toBe(true);
    expect(stopped.cyclesRun).toBeLessThan(400);
    const rest = engine.run(stopped.state, 400 - stopped.cyclesRun);
    expect(JSON.stringify(rest.state)).toBe(JSON.stringify(engine.run(s, 400).state));
  });

  it("stops at a script pause or error; the timeline replays through pauses", async () => {
    const sc = singlePlot(layout([["wheat", 4, 4]]), { seed: 3 });
    sc.plots[0].script = { source: "function onCycleEnd() { if (cycle === 6) pause('look') }" };
    const s = start(sc);
    const paused = await drive(engine, s, 50, { retainEvents: "none", shouldStop: () => false, yieldToEventLoop: noYield });
    expect(paused.cyclesRun).toBe(7);
    expect(paused.truncated).toBe(true);
    expect(paused.state.scripts?.halt?.kind).toBe("pause");
    const tl = createTimeline(engine, s, { firstCheckpointEvery: 4 });
    tl.beginRun();
    tl.endRun(paused.state, paused.cyclesRun);
    const more = await drive(engine, tl.current(), 5, { retainEvents: "none", shouldStop: () => false, yieldToEventLoop: noYield });
    tl.beginRun();
    tl.endRun(more.state, more.cyclesRun);
    expect(more.cyclesRun).toBe(5);
    // Going back across the pause rebuilds exactly the state the session passed through.
    expect(JSON.stringify(tl.stepBack())).toBe(JSON.stringify(engine.run(s, 11, { ignorePauses: true }).state));

    sc.plots[0].script = { source: "function onTick() { if (cycle === 2) fail('nope') }" };
    const failed = await drive(engine, start(sc), 50, { retainEvents: "none", shouldStop: () => false, yieldToEventLoop: noYield });
    expect(failed.cyclesRun).toBe(3);
    expect(failed.state.scripts?.halt).toMatchObject({ kind: "error", message: "nope" });
  });

  it("reports progress, ending on the final cycle", async () => {
    const seen: number[] = [];
    await drive(engine, busy(), 60, { retainEvents: "none", shouldStop: () => false, onProgress: (p) => seen.push(p.done), yieldToEventLoop: noYield });
    expect(seen[seen.length - 1]).toBe(60);
  });
});
