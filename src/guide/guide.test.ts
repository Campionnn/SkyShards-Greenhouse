import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../simulator";
import {
  ALOE_FRAGMENT,
  buildCatalog,
  confirmPlot,
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
  goalOwned,
  goalProgress,
  guideDefaultSettings,
  hoursPerCycle,
  hoursToCycles,
  setFacts,
  simulatorScenario,
  skipPlot,
  withSettings,
  zombudYield,
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
const LEGENDS = { all_in_aloe: 2, devourer: 2, glasscorn: 2, phantomleaf: 2, timestalk: 2 };
/** Every non-legendary mutation once (Godseed and Jerryflower are legendaries: not part of it). */
const ONE_OF_EACH = Object.fromEntries(Object.entries(data.mutations).filter(([, m]) => m.rarity !== "legendary").map(([id]) => [id, 1]));
const GOAL = { ...ONE_OF_EACH, ...LEGENDS };

const SUPPLIES = { dead_plant: 250, fermento: 50 };
/** Enough Choconut + Ashwreath that the free Choconut farm is not needed: Plot 1 goes to Commons. */
const COMMONS_READY = { ...SUPPLIES, ashwreath: 60, choconut: 120 };
const start = (inventory: Record<string, number> = SUPPLIES): GuideState => initialState(flow, defaultSettings(), inventory);
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

describe("simulatorScenario", () => {
  it("hands the Simulator every plot's flow and script, starting from the player's farms and stock", () => {
    const farm = catalog.farms[2].find((f) => f.kind === "farm")!.id;
    const state = setFarm(start({ dead_plant: 10, fermento: 0 }), 2, farm);
    const sc = simulatorScenario(flow, toInput(state));
    expect(sc.plots.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(sc.plots.every((p) => p.script?.source)).toBe(true);
    expect(sc.plots[1].flow.steps[sc.plots[1].flow.startIndex ?? 0].id).toBe(farm);
    expect(sc.plots[0].flow.steps[sc.plots[0].flow.startIndex ?? 0].id).toBe("hub");
    expect(sc.startingInventory).toEqual({ dead_plant: 10 });
    expect(sc.plots[1]).not.toBe(flow.plots[1]); // a copy: the shipped flow is untouched
  });

  it("gives every farm a share code for the Designer", () => {
    expect(catalog.farms[1].filter((f) => f.kind === "farm").every((f) => !!f.code)).toBe(true);
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
    expect(farmOf(catalog, 1, "commons").cost).toEqual([{ item: "dead_plant", count: 8 }]);
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
  it("sends the starter stock to the free Choconut farm first", () => {
    const outcomes = decideLogin(flow, toInput(start()), guideEnv);
    expect(outcomes.map((o) => [o.plotId, o.from, o.to, o.action])).toEqual([
      [1, "hub", "choco", "enter"],
      [2, "hub", "lonelily", "enter"],
      [3, "hub", "choco", "enter"],
    ]);
    expect(outcomes[0].spent).toEqual([]);
  });

  it("sends stock to an affordable farm and records exactly what it places", () => {
    const outcomes = decideLogin(flow, toInput(start(COMMONS_READY)), guideEnv);
    expect(outcomes[0].to).toBe("commons");
    expect(outcomes[0].spent).toEqual([{ item: "dead_plant", count: 8 }]);
    expect(outcomes[0].placedCells.filter((c) => c.paid)).toHaveLength(8);
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
    const outcomes = decideLogin(flow, toInput(withFarms(start(), { 1: "commons", 2: "cream", 3: "rares" })), guideEnv);
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
    const state = setFacts(withFarms(start(), { 1: "commons" }), 1, { missing: [deadPlant], standing: [], devourerRefresh: false });
    const plot1 = decideLogin(flow, toInput(state), guideEnv)[0];
    expect(plot1.action).toBe("stay");
    expect(plot1.spent).toEqual([{ item: "dead_plant", count: 1 }]);
    expect(plot1.placedCells).toEqual([{ row: deadPlant.row, col: deadPlant.col, kind: "dead_plant", paid: true }]);
  });

  it("reports a missing input it can't afford instead of pretending the farm is complete", () => {
    const farm = farmOf(catalog, 1, "glasscorn");
    const missing = farm.layout.plants.filter((p) => p.kindId === "startlevine").slice(0, 2);
    const state = setFacts(withFarms(start({ dead_plant: 250, fermento: 50, glasscorn: 1 }), { 1: "glasscorn" }), 1, { missing, standing: [], devourerRefresh: false });
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
    const state = start(COMMONS_READY);
    const [plot1] = decideLogin(flow, toInput(state), guideEnv);
    const after = confirmPlot(state, plot1);
    expect(after.plots[1]).toMatchObject({ farm: "commons", acted: true });
    expect(after.inventory.dead_plant).toBe(242);
    expect(after.memory.builtOnce).toEqual(plot1.builtOnce);
    expect(after.confirmations[1].delta).toEqual({ dead_plant: -8 });
    // The undo record is plain data, so it survives a save and reload.
    const reloaded = restoreState(JSON.parse(JSON.stringify({ version: 3, ...after })), flow, catalog, defaultSettings())!;
    const undone = undoPlot(reloaded, 1);
    expect(undone.plots[1]).toEqual(state.plots[1]);
    expect(undone.inventory).toEqual(state.inventory);
  });

  it("starting the next check-in keeps farms and facts but forgets who acted", () => {
    const state = start();
    const outcomes = decideLogin(flow, toInput(state), guideEnv);
    const done = outcomes.reduce((s, o) => confirmPlot(s, o), state);
    expect(Object.values(done.plots).every((p) => p.acted)).toBe(true);
    const next = startNewCheckIn(done);
    expect(next.plots).toEqual({ 1: { farm: "choco" }, 2: { farm: "lonelily" }, 3: { farm: "choco" } });
    expect(next.confirmations).toEqual({});
  });

  it("validates items and farms in plain words", () => {
    expect(validate(start({ [ALOE_FRAGMENT]: 4 }), catalog, data)).toEqual([]);
    expect(validate(start({ not_an_item: 1 }), catalog, data)).toEqual([expect.stringMatching(/isn't an item/)]);
  });

  it("restores a saved state and discards old shapes and farms the flow no longer has", () => {
    const saved = { version: 3, ...withFarms(start({ dead_plant: 10 }), { 1: "commons" }) };
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

describe("playtest fixes", () => {
  it("assumes a Shellfruit farm's Blastberries primed by the next visit, so it pops instead of waiting forever", () => {
    const state = withFarms(start({ ...SUPPLIES, turtlellini: 9, blastberry: 8 }), { 3: "shellfruit" });
    const plot3 = decideLogin(flow, toInput(state), guideEnv).find((o) => o.plotId === 3)!;
    expect(plot3.why).not.toBe("waiting for the Blastberries to prime");
    expect(plot3.harvested).toEqual([{ item: "shellfruit", count: 9 }]);
    expect(plot3.to).not.toBe("shellfruit");
  });

  it("credits placements paid for by the same visit's harvest, so stock isn't lost", () => {
    // The playtest's late game: popped Shellfruit go straight into Phantomleaf + Timestalk.
    const state = withFarms(start({ ...SUPPLIES, chorus_fruit: 15, stoplight_petal: 15, shellfruit: 0, all_in_aloe: 2, devourer: 2, glasscorn: 2 }), { 3: "shellfruit" });
    const plot3 = decideLogin(flow, toInput(state), guideEnv).find((o) => o.plotId === 3)!;
    expect(plot3.to).toBe("pt");
    expect(plot3.spent).toContainEqual({ item: "shellfruit", count: 6 });
    expect(plot3.selfFunded).toEqual([{ item: "shellfruit", count: 6 }]);
    const after = confirmPlot(state, plot3);
    expect(after.inventory.shellfruit ?? 0).toBe(0); // the 6 placed came from the pop; the player adds the 3 extras
    expect(after.inventory.chorus_fruit).toBe(15 - 7);
    expect(undoPlot(after, 3).inventory).toEqual(state.inventory);
  });

  it("converts the check-in interval with the player's real cycle length", () => {
    const stats = defaultSettings().playerStats;
    expect(hoursPerCycle(stats)).toBeLessThan(2); // default stats: ~1.75 h per cycle
    expect(hoursToCycles(24, stats)).toBe(Math.round(24 / hoursPerCycle(stats)));
    const slow = { ...stats, cropGrowth: 0, growthUpgradeTier: 0, floraShard: 0 };
    expect(hoursPerCycle(slow)).toBeGreaterThan(hoursPerCycle(stats));
    const daily = withSettings(start(), defaultSettings(), 24);
    expect(daily.checkEvery).toBe(24);
    expect(daily.settings.activity).toEqual({ kind: "everyN", n: hoursToCycles(24, daily.settings.playerStats), offset: 0 });
  });

  it("says exactly how many more supplies a blocked plot needs, and lets the player skip it", () => {
    // The playtest's dead end: plenty of mutations, no Dead Plants or Fermento.
    const inventory: Record<string, number> = {};
    for (const id of catalog.items) inventory[id] = 200;
    Object.assign(inventory, { dead_plant: 0, fermento: 0, all_in_aloe: 2, all_in_aloe_fragment: 0, devourer: 0, glasscorn: 2, phantomleaf: 2, timestalk: 2, zombud: 0 });
    const state = start(inventory);
    const plot2 = decideLogin(flow, toInput(state), guideEnv).find((o) => o.plotId === 2)!;
    expect(plot2.to).toBe("supplies");
    expect(plot2.supplyBlock).toEqual({ farm: "zombud", need: [{ item: "dead_plant", count: 8 }] });
    expect(explain(plot2, catalog, data).headline).toBe("Needs 8 more Dead Plant");
    expect(JSON.stringify(explain(plot2, catalog, data))).not.toMatch(/bazaar|buy|bought/i);
    const skipped = skipPlot(state, 2);
    expect(skipped.plots[2]).toMatchObject({ farm: "hub", acted: true });
    expect(skipped.inventory).toEqual(state.inventory);
    expect(undoPlot(skipped, 2).plots[2]).toEqual(state.plots[2]);
  });

  it("counts 9 fragments as one All-in Aloe toward the goal", () => {
    const total = Object.keys(GOAL).length;
    expect(goalOwned(catalog, { ...GOAL, all_in_aloe: 0, [ALOE_FRAGMENT]: 18 })).toBe(total);
    expect(goalOwned(catalog, { ...GOAL, all_in_aloe: 1, [ALOE_FRAGMENT]: 8 })).toBe(total - 1);
  });

  it("splits the goal into the legendaries and one of every other mutation", () => {
    const none = goalProgress(catalog, {});
    expect(none.legendaries).toMatchObject({ owned: 0, total: 5 });
    expect(none.others.total).toBe(Object.keys(ONE_OF_EACH).length);
    expect(none.others.missing.map((g) => g.item)).not.toContain("godseed");
    const legendsOnly = goalProgress(catalog, { ...LEGENDS, lonelily: 3 });
    expect(legendsOnly.legendaries.owned).toBe(5);
    expect(legendsOnly.others.owned).toBe(1);
    expect(goalProgress(catalog, GOAL).others.missing).toEqual([]);
  });

  it("is not Done with only the legendaries: one of every other mutation is still needed", () => {
    const outcomes = decideLogin(flow, toInput(start({ ...SUPPLIES, ...LEGENDS })), guideEnv);
    expect(outcomes.some((o) => o.action !== "done")).toBe(true);
  });

  it("books Zombud harvests from the card: Zombuds in, ring Dead Plants out", () => {
    const perHarvest = zombudYield(catalog, 2, "zombud");
    expect(perHarvest).toBe(4);
    const state = withFarms(start({ ...SUPPLIES, cindershade: 10, fleshtrap: 4 }), { 2: "zombud" });
    const plot2 = decideLogin(flow, toInput(state), guideEnv).find((o) => o.plotId === 2)!;
    const after = confirmPlot(state, plot2, { zombudHarvests: 2, zombudPerHarvest: perHarvest });
    const spentDead = plot2.spent.find((s) => s.item === "dead_plant")?.count ?? 0;
    expect(after.inventory.zombud).toBe(8);
    expect(after.inventory.dead_plant).toBe(250 - spentDead - 8);
    expect(undoPlot(after, 2).inventory).toEqual(state.inventory);
  });

  it("keeps what is still true about a farm after a Keep, and marks what it couldn't afford", () => {
    const farm = farmOf(catalog, 1, "glasscorn");
    const slot = farm.layout.slots[0];
    const missing = farm.layout.plants.filter((p) => p.kindId === "startlevine").slice(0, 1);
    const state = setFacts(withFarms(start({ ...SUPPLIES, glasscorn: 1, chloronite: 2 }), { 1: "glasscorn" }), 1, {
      missing,
      standing: [{ row: slot.row, col: slot.col, kind: "glasscorn", stage: 3, fullyGrown: false }],
      devourerRefresh: false,
    });
    const plot1 = decideLogin(flow, toInput(state), guideEnv)[0];
    // With 0 Startlevine the gap can't be refilled. Either way, what is still true is kept.
    const after = confirmPlot(state, plot1);
    if (plot1.to === "glasscorn") {
      expect(after.plots[1].facts?.missing).toEqual(plot1.shortCells);
      expect(after.plots[1].facts?.standing).toHaveLength(1);
      expect(startNewCheckIn(after).plots[1].factsFromEarlier).toBe(true);
    } else {
      // Moving to another farm clears the old farm's facts.
      expect(after.plots[1].facts).toBeUndefined();
    }
  });

  it("shows fully grown targets the player reported under Harvest now", () => {
    const farm = farmOf(catalog, 2, "jelly");
    const slot = farm.layout.slots[0];
    const state = setFacts(withFarms(start({ ...SUPPLIES, duskbloom: 20 }), { 2: "jelly" }), 2, {
      missing: [],
      standing: [{ row: slot.row, col: slot.col, kind: "magic_jellybean", stage: 4, fullyGrown: true }],
      devourerRefresh: false,
    });
    const plot2 = decideLogin(flow, toInput(state), guideEnv).find((o) => o.plotId === 2)!;
    expect(plot2.to).toBe("jelly");
    expect(plot2.harvestReady).toEqual([{ item: "magic_jellybean", count: 1 }]);
  });

  it("splits a step label into a name and a readable detail", () => {
    expect(farmOf(catalog, 3, "shellfruit")).toMatchObject({ name: "Shellfruit", detail: "place them · blast Turtlellini" });
    expect(farmOf(catalog, 2, "devourer").detail).toBe("keep inputs while growing");
    expect(farmOf(catalog, 1, "commons").detail).toBe("");
    expect(farmOf(catalog, 1, "choco").detail).toBe("no Dead Plants or Fermento");
  });

  it("starts a new player with nothing owned", () => {
    expect(initialState(flow, defaultSettings()).inventory).toEqual({});
  });

  it("starts a new player on the Guide's mid-game stats, and keeps a returning player's own", () => {
    const fresh = initialState(flow, guideDefaultSettings());
    expect(fresh.settings.playerStats).toMatchObject({
      floraShard: 0,
      cropGrowth: 100,
      growthUpgradeTier: 4,
      plantYieldUpgrade: 0.1,
      mutationChanceBonus: 0,
      miningFortune: 1000,
      farmingFortune: 1500,
      evergreenChip: 0.2,
    });
    // The Simulator keeps its own defaults.
    expect(defaultSettings().playerStats.floraShard).toBe(10);
    // A saved player's stats win over the new defaults; a stat missing from an old save is filled in.
    const own = { ...fresh.settings.playerStats, farmingFortune: 2500 } as Partial<typeof fresh.settings.playerStats>;
    delete own.miningFortune;
    const restored = restoreState(JSON.parse(JSON.stringify({ version: 3, ...fresh, settings: { ...fresh.settings, playerStats: own } })), flow, catalog, guideDefaultSettings())!;
    expect(restored.settings.playerStats.farmingFortune).toBe(2500);
    expect(restored.settings.playerStats.miningFortune).toBe(1000);
  });
});