import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LAYOUT_A_CODE, LAYOUT_B_CODE, flow, scenario, step } from "../testHelpers";
import type { WorkerRequest, WorkerResponse } from "./protocol";

// Drives the real worker module through its message protocol, with a fake
// `self` standing in for the DedicatedWorkerGlobalScope.

const posted: WorkerResponse[] = [];
let send: (msg: WorkerRequest) => Promise<void>;

beforeAll(async () => {
  const fakeSelf = { postMessage: (m: WorkerResponse) => posted.push(structuredClone(m)), onmessage: null as unknown };
  vi.stubGlobal("self", fakeSelf);
  await import("./engine.worker");
  send = async (msg) => {
    await (fakeSelf.onmessage as (e: { data: WorkerRequest }) => Promise<void>)({ data: msg });
  };
});
afterAll(() => vi.unstubAllGlobals());

const last = <T extends WorkerResponse["type"]>(type: T) =>
  [...posted].reverse().find((m): m is Extract<WorkerResponse, { type: T }> => m.type === type)!;

const sc = scenario([LAYOUT_A_CODE, LAYOUT_B_CODE, LAYOUT_B_CODE].map((code) => flow([step("s", { code })])));

describe("session worker", () => {
  it("init -> ready with a snapshot; the starting layouts are placed free", async () => {
    await send({ type: "init", reqId: 1, scenario: sc });
    const ready = last("ready");
    expect(ready.reqId).toBe(1);
    expect(ready.snapshot.state.cycle).toBe(0);
    expect(ready.snapshot.report.sustainable).toBe(true);
    expect(ready.snapshot.state.plots[0].plants).toHaveLength(82);
  });

  it("step and run are the same message, and they compose", async () => {
    for (let i = 0; i < 5; i++) await send({ type: "run", reqId: 10 + i, ticks: 1, retainEvents: "all" });
    await send({ type: "run", reqId: 20, ticks: 45, retainEvents: "summary" });
    const stepped = last("result").snapshot.state;
    expect(stepped.cycle).toBe(50);

    await send({ type: "reset", reqId: 21 });
    expect(last("ready").snapshot.state.cycle).toBe(0);
    await send({ type: "run", reqId: 22, ticks: 50, retainEvents: "none" });
    expect(JSON.stringify(last("result").snapshot.state)).toBe(JSON.stringify(stepped));
  });

  it("keeps only the recent events and drops noisy kinds when asked", async () => {
    await send({ type: "run", reqId: 30, ticks: 40, retainEvents: "all", keepLastCycles: 5, dropKinds: ["advanced"] });
    const r = last("result");
    const minCycle = Math.min(...r.events.map((e) => e.cycle));
    expect(minCycle).toBeGreaterThanOrEqual(r.snapshot.state.cycle - 5);
    expect(r.events.some((e) => e.kind === "advanced")).toBe(false);
    expect(r.eventCounts.advanced).toBeGreaterThan(0);
  });

  it("back goes one cycle, undo takes back a whole run or inventory change", async () => {
    await send({ type: "init", reqId: 31, scenario: sc });
    const setup = last("ready").snapshot.state;
    expect(last("ready").history).toEqual({ canStepBack: false, lastAction: null });
    await send({ type: "run", reqId: 32, ticks: 30, retainEvents: "none" });
    const at30 = last("result").snapshot.state;
    await send({ type: "addItems", reqId: 33, items: { chloronite: 3 } });
    const changed = last("updated").snapshot.state;
    expect(last("updated").history.lastAction).toEqual({ kind: "items", cycle: 30, items: { chloronite: 3 } });
    await send({ type: "run", reqId: 34, ticks: 1, retainEvents: "none" });

    // Back one cycle keeps the inventory change (it happened before that cycle).
    await send({ type: "back", reqId: 35, to: "cycle" });
    let r = last("rewound");
    expect(r.undone).toBeNull();
    expect(JSON.stringify(r.snapshot.state)).toBe(JSON.stringify(changed));

    await send({ type: "back", reqId: 36, to: "undo" });
    r = last("rewound");
    expect(r.undone).toEqual({ kind: "items", cycle: 30, items: { chloronite: 3 } });
    expect(JSON.stringify(r.snapshot.state)).toBe(JSON.stringify(at30));
    await send({ type: "back", reqId: 37, to: "undo" });
    r = last("rewound");
    expect(r.undone).toEqual({ kind: "run", fromCycle: 0, cycles: 30 });
    expect(JSON.stringify(r.snapshot.state)).toBe(JSON.stringify(setup));
    expect(r.history).toEqual({ canStepBack: false, lastAction: null });

    await send({ type: "back", reqId: 38, to: "cycle" });
    expect(last("error").message).toBe("Already at the start");
  });

  it("reports scenario errors instead of throwing", async () => {
    await send({ type: "init", reqId: 40, scenario: { ...sc, plots: [] } });
    const err = last("error");
    expect(err.reqId).toBe(40);
    expect(err.issues?.some((i) => i.level === "error")).toBe(true);
  });
});
