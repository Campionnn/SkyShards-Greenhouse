import { describe, expect, it } from "vitest";
import { engine, layout, singlePlot, start } from "../testHelpers";
import { drive } from "./driver";

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

  it("reports progress, ending on the final cycle", async () => {
    const seen: number[] = [];
    await drive(engine, busy(), 60, { retainEvents: "none", shouldStop: () => false, onProgress: (p) => seen.push(p.done), yieldToEventLoop: noYield });
    expect(seen[seen.length - 1]).toBe(60);
  });
});
