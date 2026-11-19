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

  it("steps stop by stop inside a cycle, never changing where Step and Run lead", async () => {
    await send({ type: "init", reqId: 50, scenario: sc });
    await send({ type: "run", reqId: 51, ticks: 3, retainEvents: "none" });
    const at3 = last("result").snapshot.state;
    await send({ type: "run", reqId: 52, ticks: 2, retainEvents: "none" });
    const at5 = last("result").snapshot.state;
    await send({ type: "back", reqId: 53, to: "undo" });

    // Through cycle 3 by session phases, then past its end: the cycle finishes like a Step.
    let reqId = 60;
    const seen: string[] = [];
    for (;;) {
      await send({ type: "stepStop", reqId: ++reqId, dir: "next", filter: { kinds: ["sessionPhase"] } });
      const m = posted[posted.length - 1];
      if (m.type !== "stopped") break;
      expect(m.position!.cycle).toBe(3);
      expect(m.snapshot.state.cycle).toBe(3);
      seen.push(`${m.position!.stop.plotId}:${m.position!.stop.id}`);
    }
    expect(seen[0]).toBe("1:session");
    expect(seen.filter((x) => x.endsWith(":session"))).toHaveLength(3);
    expect(last("result").snapshot.state.cycle).toBe(4);

    // Previous from a cycle's start: the last such stop of the cycle before; then back to its start.
    await send({ type: "stepStop", reqId: ++reqId, dir: "prev", filter: { kinds: ["sessionPhase"] } });
    let m = last("stopped");
    expect(m.position!.cycle).toBe(3);
    expect(m.position!.index).toBe(m.position!.count);
    await send({ type: "back", reqId: ++reqId, to: "cycle" });
    expect(JSON.stringify(last("rewound").snapshot.state)).toBe(JSON.stringify(at3));

    // From the middle of a cycle a plain Run finishes it and goes on: the same states as before.
    await send({ type: "stepStop", reqId: ++reqId, dir: "next", filter: { kinds: ["tickPhase", "playerAction"] } });
    m = last("stopped");
    expect(m.position!.cycle).toBe(3);
    await send({ type: "run", reqId: ++reqId, ticks: 2, retainEvents: "none" });
    expect(JSON.stringify(last("result").snapshot.state)).toBe(JSON.stringify(at5));
  });

  it("reports scenario errors instead of throwing", async () => {
    await send({ type: "init", reqId: 40, scenario: { ...sc, plots: [] } });
    const err = last("error");
    expect(err.reqId).toBe(40);
    expect(err.issues?.some((i) => i.level === "error")).toBe(true);
  });
});
