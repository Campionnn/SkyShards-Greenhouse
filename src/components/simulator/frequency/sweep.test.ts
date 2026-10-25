import { describe, expect, it } from "vitest";
import { engine, LAYOUT_A_CODE, scenario, flow, step } from "../../../simulator/testHelpers";
import type { RunSummary } from "../../../simulator";
import { slackFrom } from "../../../leaderboard/view";
import { clampSweepParams, runSweepCell, scheduleEvery, SWEEP_EVERY, sweepKey, sweepPoints, sweepScenario, sweepSeeds, type SweepRun } from "./sweep";
import { SweepPool, type SweepWorkerLike } from "./sweepPool";
import type { SweepRequest, SweepResponse } from "./protocol";

const base = () => scenario([flow([step("step-1", { code: LAYOUT_A_CODE })])]);

const fakeSummary = (profit: number, days = 1): RunSummary => ({ profit, elapsedSeconds: days * 86400, cyclesRun: 100 }) as RunSummary;
const ok = (every: number, seed: number, profit: number): SweepRun => ({ every, seed, ok: true, error: null, summary: fakeSummary(profit) });

describe("frequency sweep", () => {
  it("replaces only the online schedule and the seed", () => {
    const sc = base();
    const s = sweepScenario(sc, 4, 99);
    expect(s.settings.activity).toEqual({ kind: "everyN", n: 4, offset: 0 });
    expect(s.settings.seed).toBe(99);
    expect({ ...s.settings, activity: sc.settings.activity, seed: sc.settings.seed }).toEqual(sc.settings);
    expect(s.plots).toBe(sc.plots);
  });

  it("seeds start at the scenario's own and are reproducible", () => {
    expect(sweepSeeds(10, 3)).toEqual([10, 11, 12]);
    expect(sweepSeeds(5, 0)).toEqual([5]);
  });

  it("clamps the parameters", () => {
    expect(clampSweepParams({ seeds: 0, cycles: 5 })).toEqual({ seeds: 1, cycles: 100 });
    expect(clampSweepParams({ seeds: 3.7, cycles: NaN })).toEqual({ seeds: 3, cycles: 2000 });
  });

  it("the key ignores the online schedule but not the rest", () => {
    const sc = base();
    const p = { seeds: 3, cycles: 2000 };
    const other = { ...sc, settings: { ...sc.settings, activity: { kind: "everyN" as const, n: 6, offset: 0 } } };
    expect(sweepKey(other, p)).toBe(sweepKey(sc, p));
    expect(sweepKey({ ...sc, settings: { ...sc.settings, seed: sc.settings.seed + 1 } }, p)).not.toBe(sweepKey(sc, p));
    expect(sweepKey(sc, { ...p, cycles: 3000 })).not.toBe(sweepKey(sc, p));
  });

  it("highlights the schedule's frequency, or none for time windows", () => {
    expect(scheduleEvery({ kind: "everyN", n: 6, offset: 0 })).toBe(6);
    expect(scheduleEvery({ kind: "everyN", n: 5, offset: 2 })).toBe(4);
    expect(scheduleEvery({ kind: "windows", windows: [] })).toBeNull();
  });

  it("points are the median per frequency, failed runs left out", () => {
    const runs = [ok(1, 1, 100), ok(1, 2, 300), ok(1, 3, 200), { every: 2, seed: 1, ok: false, error: "x", summary: null }, ok(2, 2, 50)];
    const pts = sweepPoints(runs);
    expect(pts.map((p) => p.every)).toEqual([...SWEEP_EVERY]);
    expect(pts[0]).toMatchObject({ every: 1, profitPerDay: 200, runs: 3, failed: 0 });
    expect(pts[1]).toMatchObject({ every: 2, profitPerDay: 50, runs: 2, failed: 1 });
    expect(pts[2].profitPerDay).toBeNull();
    // Forgiving uses the leaderboard's own formula on these points.
    expect(slackFrom(pts, 1)).toBeCloseTo(0.25);
  });

  it("points carry the median effort per login of runs with logins", () => {
    const runs = [1, 2, 3].map((seed) => runSweepCell(engine, base(), 2, seed, 30));
    const want = runs.map((r) => r.summary!.effort!.total / r.summary!.effort!.sessions).sort((a, b) => a - b)[1];
    expect(sweepPoints(runs).find((p) => p.every === 2)?.effortAvg).toBeCloseTo(want);
    expect(sweepPoints(runs).find((p) => p.every === 1)?.effortAvg).toBeUndefined();
  });

  it("runs one cell with the engine", () => {
    const r = runSweepCell(engine, base(), 2, 7, 50);
    expect(r.ok).toBe(true);
    expect(r.summary?.cyclesRun).toBe(50);
    // Same as running the swept scenario directly.
    const direct = engine.run(engine.initState(sweepScenario(base(), 2, 7)).state, 50).state.summary;
    expect(r.summary?.profit).toBe(direct.profit);
  });
});

class FakeWorker implements SweepWorkerLike {
  onmessage: ((event: MessageEvent<SweepResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  private readonly log: SweepRequest[];
  constructor(log: SweepRequest[]) {
    this.log = log;
  }
  postMessage(m: SweepRequest) {
    this.log.push(m);
    queueMicrotask(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: { type: "result", reqId: m.reqId, run: ok(m.every, m.seed, m.every * 10) } } as MessageEvent<SweepResponse>);
    });
  }
  terminate() {
    this.terminated = true;
  }
}

describe("sweep pool", () => {
  it("runs every job and returns them in order", async () => {
    const log: SweepRequest[] = [];
    const pool = new SweepPool(2, () => new FakeWorker(log));
    const seen: number[] = [];
    const runs = await pool.run(base(), 10, [{ every: 1, seed: 1 }, { every: 2, seed: 1 }, { every: 4, seed: 1 }], { onRun: (i) => seen.push(i) });
    expect(runs.map((r) => r.every)).toEqual([1, 2, 4]);
    expect(seen.sort()).toEqual([0, 1, 2]);
    expect(log.every((m) => m.cycles === 10)).toBe(true);
  });

  it("cancel rejects the active run", async () => {
    const pool = new SweepPool(1, () => new FakeWorker([]));
    const p = pool.run(base(), 10, [{ every: 1, seed: 1 }, { every: 2, seed: 1 }]);
    pool.cancel();
    await expect(p).rejects.toThrow("cancelled");
  });
});
