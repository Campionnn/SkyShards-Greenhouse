import { describe, expect, it } from "vitest";
import type { RunTimeline } from "../types";
import type { FlowsFile } from "../flow";
import { defaultSettings } from "../../simulator";
import { ForecastCancelled, GuidePool, poolSize, type WorkerLike } from "./pool";
import { inputKey, type GuideRequest, type GuideResponse } from "./protocol";

// The pool's scheduling, streaming, cancellation and caching, with fake workers (no engine).

const timeline = (seed: number): RunTimeline => ({ seed, visits: [], farms: {}, cycles: seed, elapsedSeconds: seed, logins: 1, done: true, debtEvents: 0, supplyNeed: {}, supplyShortAt: {} });
const flow = { plots: [] } as unknown as FlowsFile;
const input = { inventory: { dead_plant: 1 }, plots: { 1: { farm: "hub" } }, settings: defaultSettings() };

class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  static fail = false;
  posted: GuideRequest[] = [];
  terminated = false;
  private listeners: ((e: MessageEvent<GuideResponse>) => void)[] = [];
  constructor() {
    FakeWorker.all.push(this);
  }
  addEventListener(type: string, listener: (e: never) => void): void {
    if (type === "message") this.listeners.push(listener as (e: MessageEvent<GuideResponse>) => void);
  }
  postMessage(request: GuideRequest): void {
    this.posted.push(request);
    if (request.type !== "seed") return;
    setTimeout(() => {
      if (this.terminated) return;
      const data: GuideResponse = FakeWorker.fail
        ? { type: "error", reqId: request.reqId, seed: request.seed, message: "boom" }
        : { type: "seedDone", reqId: request.reqId, seed: request.seed, timeline: timeline(request.seed) };
      for (const l of this.listeners) l({ data } as MessageEvent<GuideResponse>);
    }, 1);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const make = (size = 2) => {
  FakeWorker.all = [];
  FakeWorker.fail = false;
  return new GuidePool(size, () => new FakeWorker());
};

describe("GuidePool", () => {
  it("sizes itself from the core count", () => {
    expect(poolSize(8)).toBe(6);
    expect(poolSize(4)).toBe(3);
    expect(poolSize(1)).toBe(1);
    expect(poolSize(0)).toBe(1);
  });

  it("spreads seeds, streams progress and returns runs in seed order", async () => {
    const pool = make(2);
    const progress: number[] = [];
    const runs = await pool.forecast({ flow, input, seeds: [3, 1, 2], onProgress: (p) => progress.push(p.done) });
    expect(runs.map((r) => r.seed)).toEqual([1, 2, 3]);
    expect(progress).toEqual([1, 2, 3]);
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all.every((w) => w.posted[0].type === "flow")).toBe(true);
  });

  it("serves an identical input from the cache", async () => {
    const pool = make(1);
    await pool.forecast({ flow, input, seeds: [1, 2] });
    const sent = FakeWorker.all[0].posted.length;
    const again = await pool.forecast({ flow, input, seeds: [1, 2] });
    expect(again.map((r) => r.seed)).toEqual([1, 2]);
    expect(FakeWorker.all[0].posted.length).toBe(sent);
  });

  it("never serves another flow's cached runs, and sends workers the new flow", async () => {
    const pool = make(1);
    await pool.forecast({ flow, input, seeds: [1] });
    const other = { plots: [{ id: 1 }] } as unknown as FlowsFile;
    const sent = FakeWorker.all[0].posted.length;
    await pool.forecast({ flow: other, input, seeds: [1] });
    const posted = FakeWorker.all[0].posted.slice(sent);
    expect(posted.map((r) => r.type)).toEqual(["flow", "seed"]);
  });

  it("cancels a superseded forecast and replaces busy workers", async () => {
    const pool = make(2);
    const first = pool.forecast({ flow, input, seeds: [1, 2, 3, 4] });
    const second = pool.forecast({ flow, input: { ...input, inventory: { dead_plant: 2 } }, seeds: [5] });
    await expect(first).rejects.toBeInstanceOf(ForecastCancelled);
    expect((await second).map((r) => r.seed)).toEqual([5]);
    expect(FakeWorker.all.filter((w) => w.terminated)).toHaveLength(2);
  });

  it("rejects when a worker reports an error", async () => {
    const pool = make(1);
    FakeWorker.fail = true;
    await expect(pool.forecast({ flow, input, seeds: [1] })).rejects.toThrow("boom");
  });
});

describe("inputKey", () => {
  it("ignores order and zero stock, and changes with anything that matters", () => {
    const a = inputKey(input, [1, 2]);
    expect(inputKey({ ...input, inventory: { dead_plant: 1, fermento: 0 } }, [1, 2])).toBe(a);
    expect(inputKey({ ...input, inventory: { dead_plant: 2 } }, [1, 2])).not.toBe(a);
    expect(inputKey({ ...input, plots: { 1: { farm: "commons" } } }, [1, 2])).not.toBe(a);
    expect(inputKey(input, [1, 3])).not.toBe(a);
    expect(inputKey({ ...input, settings: { ...input.settings, activity: { kind: "everyN", n: 6, offset: 0 } } }, [1, 2])).not.toBe(a);
  });
});
