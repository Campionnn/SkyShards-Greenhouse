import { describe, expect, it } from "vitest";
import { engine, flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, start, step } from "../testHelpers";
import { GAME_TICK_PHASE_IDS, SESSION_PHASE_IDS } from "../sim/phaseIds";
import { scanCycle, stopMatches } from "./stopFilter";

const sc = scenario([LAYOUT_A_CODE, LAYOUT_B_CODE].map((code) => flow([step("s", { code })])));

describe("stop filter", () => {
  it("picks single phases, in the order the engine runs them", () => {
    const s = start(sc);
    const scan = scanCycle(engine, s, { kinds: ["tickPhase"], off: { tickPhase: ["effects", "soggybud", "spawn", "decay"] } });
    const picked = scan.stops.filter((_x, i) => scan.chosen[i]).map((x) => `${x.plotId}:${x.id}`);
    expect(picked).toEqual(["1:destruction", "1:growth", "1:water", "2:destruction", "2:growth", "2:water"]);
  });

  it("limits to plots; stops of no single plot always count", () => {
    const f = { kinds: ["sessionPhase" as const, "playerAction" as const], plots: [2] };
    expect(stopMatches(f, { kind: "sessionPhase", plotId: 1, id: "water" })).toBe(false);
    expect(stopMatches(f, { kind: "sessionPhase", plotId: 2, id: "water" })).toBe(true);
    expect(stopMatches(f, { kind: "playerAction", plotId: null, id: "sell" })).toBe(true);
  });

  it("debug.* stands for every debug tool", () => {
    const f = { kinds: ["scriptAction" as const], off: { scriptAction: ["debug.*"] } };
    expect(stopMatches(f, { kind: "scriptAction", plotId: 1, id: "debug.spawn" })).toBe(false);
    expect(stopMatches(f, { kind: "scriptAction", plotId: 1, id: "place" })).toBe(true);
  });

  it("skipping idle phases drops phases that changed nothing, and only those", () => {
    const s = engine.run(start(sc), 5).state;
    const all = scanCycle(engine, s, { kinds: ["tickPhase", "sessionPhase"] });
    const busy = scanCycle(engine, s, { kinds: ["tickPhase", "sessionPhase"], skipIdle: true });
    const picked = (x: typeof all) => x.stops.filter((_s, i) => x.chosen[i]).map((p) => `${p.plotId}:${p.id}`);
    expect(picked(all)).toHaveLength(2 * (GAME_TICK_PHASE_IDS.length + SESSION_PHASE_IDS.length));
    // Growth always moves something on these plots; a session marker never changes the plot.
    expect(picked(busy)).toContain("1:growth");
    expect(picked(busy).length).toBeLessThan(picked(all).length);
    expect(picked(busy).every((p) => picked(all).includes(p))).toBe(true);
  });

  it("scanning never changes the state it starts from", () => {
    const s = engine.run(start(sc), 3).state;
    const before = JSON.stringify(s);
    scanCycle(engine, s, { kinds: ["tickPhase", "sessionPhase", "playerAction"], skipIdle: true });
    expect(JSON.stringify(s)).toBe(before);
  });
});
