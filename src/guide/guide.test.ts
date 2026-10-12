import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../simulator";
import {
  ALOE_FRAGMENT,
  buildCatalog,
  confirmPlot,
  confirmationOf,
  createGuideEnv,
  decideLogin,
  explain,
  farmOf,
  groupedItems,
  initialState,
  parseFlows,
  projectLogin,
  restoreState,
  scriptKnobs,
  farmTips,
  setFacts,
  setFarm,
  startNewCheckIn,
  toInput,
  undoPlot,
  validate,
  type FlowsFile,
  type GuideState,
} from "./index";

const guideEnv = createGuideEnv();
const data = guideEnv.engine.data;
const flow: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);
const GOAL = { all_in_aloe: 2, devourer: 2, glasscorn: 2, phantomleaf: 2, timestalk: 2 };

const start = (inventory?: Record<string, number>): GuideState => initialState(flow, defaultSettings(), inventory);
const withFarms = (state: GuideState, farms: Record<number, string>): GuideState => Object.entries(farms).reduce((s, [id, farm]) => setFarm(s, Number(id), farm), state);

describe("parseFlows", () => {
  it("accepts the shipped flow", () => {
    expect(flow.plots.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("rejects junk, missing plots, scriptless plots and flows without hub/done", () => {
    expect(() => parseFlows("nope")).toThrow(/valid JSON/);
    expect(() => parseFlows("{}")).toThrow(/no plots/);
    expect(() => parseFlows(JSON.stringify({ plots: [{ id: 1, flow: { steps: [{ id: "hub" }] } }] }))).toThrow(/no script/);
    expect(() => parseFlows(JSON.stringify({ plots: [{ id: 1, script: { source: "x" }, flow: { steps: [{ id: "hub" }] } }] }))).toThrow(/"done"/);
  });
});

describe("the farm catalog", () => {
  it("reads the goal from the Done step instead of hardcoding it", () => {
    expect(Object.fromEntries(catalog.goal.map((g) => [g.item, g.count]))).toEqual(GOAL);
  });

  it("derives costs from the layout: placed items are paid, base crops and fire are free", () => {
    const glasscorn = farmOf(catalog, 1, "glasscorn");
    expect(glasscorn.cost).toEqual(expect.arrayContaining([{ item: "startlevine", count: 6 }, { item: "chloronite", count: 6 }]));
    expect(glasscorn.products).toEqual([{ item: "glasscorn", count: 1 }]);
    expect(farmOf(catalog, 1, "commons").cost).toEqual([{ item: "dead_plant", count: 7 }]);
    for (const plotId of catalog.plots) {
      for (const farm of catalog.farms[plotId]) expect(farm.cost.some((c) => c.item === "fire")).toBe(false);
    }
    expect(farmOf(catalog, 1, "commons").free.some((c) => c.item === "fire")).toBe(true);
  });

  it("names farms from their labels, and the hub as empty farmland", () => {
    expect(farmOf(catalog, 2, "devourer").name).toBe("Devourer");
    expect(farmOf(catalog, 1, "hub").name).toBe("Empty farmland");
    expect(farmOf(catalog, 1, "blast-cheese-cheese").name).toBe("Cheesebite focus");
    expect(() => farmOf(catalog, 1, "nope")).toThrow(/no farm called/);
  });

  it("lets the player report fragments and groups supplies and the goal first", () => {
    expect(catalog.items).toContain(ALOE_FRAGMENT);
    const groups = groupedItems(data, catalog);
    expect(groups[0]).toEqual({ group: "supplies", items: ["dead_plant", "fermento"] });
    expect(groups[1].group).toBe("goal");
    expect(groups[1].items.indexOf(ALOE_FRAGMENT)).toBe(groups[1].items.indexOf("all_in_aloe") + 1);
  });
});

describe("decideLogin", () => {
  it("sends the starter stock to affordable farms and records exactly what it places", () => {
    const outcomes = decideLogin(flow, toInput(start()), guideEnv);
    expect(outcomes.map((o) => [o.plotId, o.from, o.to, o.action])).toEqual([
      [1, "hub", "commons", "enter"],
      [2, "hub", "lonelily", "enter"],
      [3, "hub", "commons", "enter"],
    ]);
    expect(outcomes[0].spent).toEqual([{ item: "dead_plant", count: 7 }]);
    expect(outcomes[0].placedCells.filter((c) => c.paid)).toHaveLength(7);
    expect(outcomes[0].placedCells.some((c) => c.kind === "fire" && !c.paid)).toBe(true);
  });

  it("decides the plots in order against shared stock, so nothing is spent twice", () => {
    const outcomes = decideLogin(flow, toInput(start()), guideEnv);
    for (let i = 1; i < outcomes.length; i++) expect(outcomes[i].inventoryBefore).toEqual(outcomes[i - 1].inventoryAfter);
    const spent = outcomes.flatMap((o) => o.spent).reduce((n, s) => n + (s.item === "dead_plant" ? s.count : 0), 0);
    expect(outcomes[2].inventoryAfter.dead_plant).toBe(250 - spent);
  });

  it("never invents stock, never records debt and never moves time", () => {
    const { state, outcomes } = projectLogin(flow, toInput(start({ dead_plant: 3 })), guideEnv);
    expect(state.cycle).toBe(0);
    expect(state.elapsedSeconds).toBe(0);
    expect(state.summary.debtEvents).toBe(0);
    for (const o of outcomes) for (const s of o.spent) expect(o.inventoryBefore[s.item] ?? 0).toBeGreaterThanOrEqual(s.count);
  });

  it("skips plots the player already did this visit", () => {
    const first = decideLogin(flow, toInput(start()), guideEnv);
    const after = confirmPlot(start(), first[0]);
    const next = decideLogin(flow, toInput(after), guideEnv);
    expect(next.map((o) => o.plotId)).toEqual([2, 3]);
    // Plot 3 sees the same stock it saw when Plot 1's spend was projected.
    expect(next[1].inventoryBefore.dead_plant).toBe(first[2].inventoryBefore.dead_plant);
  });

  it("keeps a working farm and says what it is waiting for", () => {
    const outcomes = decideLogin(flow, toInput(withFarms(start(), { 1: "commons", 2: "uncommons", 3: "rares" })), guideEnv);
    for (const o of outcomes) {
      expect(o.action).toBe("stay");
      expect(o.why).toMatch(/^working /);
      expect(o.waitFor.length).toBeGreaterThan(0);
    }
    const ex = explain(outcomes[0], catalog, data);
    expect(ex.verb).toBe("stay");
    expect(ex.headline).toBe("Keep Commons farm");
    expect(ex.reason).toMatch(/Keep it until you have \d+ /);
  });

  it("re-places a reported missing input from stock, on the exact cell", () => {
    const farm = farmOf(catalog, 1, "commons");
    const deadPlant = farm.layout.plants.find((p) => p.kindId === "dead_plant")!;
    const state = setFacts(withFarms(start(), { 1: "commons" }), 1, { missing: [deadPlant], standing: [], primed: [], devourerRefresh: false });
    const plot1 = decideLogin(flow, toInput(state), guideEnv)[0];
    expect(plot1.action).toBe("stay");
    expect(plot1.spent).toEqual([{ item: "dead_plant", count: 1 }]);
    expect(plot1.placedCells).toEqual([{ row: deadPlant.row, col: deadPlant.col, kind: "dead_plant", paid: true }]);
  });

  it("reports a missing input it can't afford instead of pretending the farm is complete", () => {
    const farm = farmOf(catalog, 1, "glasscorn");
    const missing = farm.layout.plants.filter((p) => p.kindId === "startlevine").slice(0, 2);
    const state = setFacts(withFarms(start({ dead_plant: 250, fermento: 50, glasscorn: 1 }), { 1: "glasscorn" }), 1, { missing, standing: [], primed: [], devourerRefresh: false });
    const plot1 = decideLogin(flow, toInput(state), guideEnv)[0];
    // With no Startlevine in stock, either the gap stays open or the plot moves on; it never pays for it.
    expect(plot1.spent.some((s) => s.item === "startlevine")).toBe(false);
    if (plot1.to === "glasscorn") expect(plot1.short).toEqual([{ item: "startlevine", count: 2 }]);
  });

  it("is Done for every plot once the goal is owned", () => {
    const outcomes = decideLogin(flow, toInput(start({ ...GOAL })), guideEnv);
    for (const o of outcomes) {
      expect(o.action).toBe("done");
      expect(explain(o, catalog, data).verb).toBe("done");
    }
  });

  it("counts fragments toward the Aloe goal, like the game does", () => {
    const outcomes = decideLogin(flow, toInput(start({ ...GOAL, all_in_aloe: 0, [ALOE_FRAGMENT]: 18 })), guideEnv);
    expect(outcomes.every((o) => o.action === "done")).toBe(true);
  });

  it("gives the same answer for the same input", () => {
    const input = toInput(withFarms(start({ dead_plant: 400 }), { 1: "commons" }));
    expect(decideLogin(flow, input, createGuideEnv())).toEqual(decideLogin(flow, input, guideEnv));
  });

  it("refuses a farm the plot does not have", () => {
    expect(() => decideLogin(flow, toInput(withFarms(start(), { 1: "nope" })), guideEnv)).toThrow(/no farm called/);
  });
});

describe("trust-and-correct check-ins", () => {
  it("confirming moves the plot and takes off what it placed, and undo puts it back", () => {
    const state = start();
    const [plot1] = decideLogin(flow, toInput(state), guideEnv);
    const confirmation = confirmationOf(state, plot1);
    const after = confirmPlot(state, plot1);
    expect(after.plots[1]).toEqual({ farm: "commons", acted: true });
    expect(after.inventory.dead_plant).toBe(243);
    expect(after.memory.builtOnce).toEqual(plot1.builtOnce);
    const undone = undoPlot(after, confirmation);
    expect(undone.plots[1]).toEqual(state.plots[1]);
    expect(undone.inventory).toEqual(state.inventory);
  });

  it("starting the next check-in keeps farms and facts but forgets who acted", () => {
    const state = start();
    const outcomes = decideLogin(flow, toInput(state), guideEnv);
    const done = outcomes.reduce((s, o) => confirmPlot(s, o), state);
    expect(Object.values(done.plots).every((p) => p.acted)).toBe(true);
    const next = startNewCheckIn(done);
    expect(next.plots).toEqual({ 1: { farm: "commons" }, 2: { farm: "lonelily" }, 3: { farm: "commons" } });
  });

  it("validates items and farms in plain words", () => {
    expect(validate(start({ [ALOE_FRAGMENT]: 4 }), catalog, data)).toEqual([]);
    expect(validate(start({ not_an_item: 1 }), catalog, data)).toEqual([expect.stringMatching(/isn't an item/)]);
  });

  it("restores a saved state and discards old shapes and farms the flow no longer has", () => {
    const saved = { version: 2, ...withFarms(start({ dead_plant: 10 }), { 1: "commons" }) };
    const restored = restoreState(JSON.parse(JSON.stringify(saved)), flow, catalog, defaultSettings());
    expect(restored?.plots[1].farm).toBe("commons");
    expect(restored?.inventory).toEqual({ dead_plant: 10 });
    expect(restoreState({ checkIn: { inventory: {} } }, flow, catalog, defaultSettings())).toBeNull();
    const gone = restoreState({ ...saved, plots: { 1: { farm: "retired-farm" } } }, flow, catalog, defaultSettings());
    expect(gone?.plots[1].farm).toBe("hub");
  });
});

describe("tips", () => {
  it("reads the break stages from the shipped script's knobs", () => {
    expect(scriptKnobs(flow)).toEqual({ jellyStage: 12, aloeStage: 10 });
    const jelly = farmTips(["magic_jellybean"], [], scriptKnobs(flow));
    expect(jelly[0]).toMatch(/stage 12/);
    expect(farmTips(["all_in_aloe"], [], { jellyStage: 12, aloeStage: 7 })[0]).toMatch(/stage 7/);
    expect(farmTips([], ["blastberry", "turtlellini"], scriptKnobs(flow))[0]).toMatch(/primed/);
  });

  it("never says ripe", () => {
    const all = farmTips(Object.keys(data.mutations), Object.keys(data.mutations), scriptKnobs(flow)).join(" ");
    expect(all).not.toMatch(/ripe/i);
  });
});
