import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../simulator";
import { applyImportedItems, buildCatalog, createGuideEnv, initialState, inventoryChanges, parseFlows, sinceLastImport, trackedFound, trackedItems, validate, type FlowsFile } from "./index";

const guideEnv = createGuideEnv();
const data = guideEnv.engine.data;
const flow: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);

describe("Import from Hypixel (Guide inventory)", () => {
  const state = initialState(flow, defaultSettings(), { dead_plant: 40, fermento: 50, ashwreath: 3 });
  // What the server found in sacks, ender chest, backpacks and inventory.
  const found = { dead_plant: 210, fermento: 50, godseed: 6, wheat: 999, not_a_thing: 4 };
  const sources = { dead_plant: { sacks: 64, inventory: 146 }, godseed: { sacks: 6 } };

  it("lists only tracked items whose total changes, with where they were found", () => {
    const changes = inventoryChanges(catalog, state.inventory, found, sources);
    const byItem = Object.fromEntries(changes.map((c) => [c.item, c]));
    expect(byItem.dead_plant).toEqual({ item: "dead_plant", have: 40, found: 210, sources: { sacks: 64, inventory: 146 } });
    // Equal totals are not a change.
    expect(byItem.fermento).toBeUndefined();
    // Owned in the Guide but not found anywhere: back to 0.
    expect(byItem.ashwreath).toMatchObject({ have: 3, found: 0, sources: {} });
    // Untracked items (base crops, unknown ids) are never touched.
    expect(byItem.wheat).toBeUndefined();
    expect(byItem.not_a_thing).toBeUndefined();
    for (const c of changes) expect(catalog.items).toContain(c.item);
  });

  it("follows catalog order and counts the tracked items found", () => {
    const changes = inventoryChanges(catalog, state.inventory, found, sources);
    const order = changes.map((c) => catalog.items.indexOf(c.item));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(trackedFound(catalog, found)).toBe(catalog.items.filter((i) => ["dead_plant", "fermento", "godseed"].includes(i)).length);
  });

  it("sets the ticked items to their imported totals and leaves the rest", () => {
    const changes = inventoryChanges(catalog, state.inventory, found, sources);
    const all = applyImportedItems(state, changes);
    expect(all.inventory.dead_plant).toBe(210);
    expect(all.inventory.ashwreath).toBeUndefined();
    expect(all.inventory.fermento).toBe(50);
    expect(validate(all, catalog, data)).toEqual([]);
    const some = applyImportedItems(state, changes, new Set(["dead_plant"]));
    expect(some.inventory).toEqual({ ...state.inventory, dead_plant: 210 });
    // Nothing else in the state changes.
    expect({ ...all, inventory: state.inventory }).toEqual(state);
  });

  it("keeps the tracked counts of a lookup and compares a new one with it", () => {
    expect(trackedItems(catalog, found)).toEqual({ dead_plant: 210, fermento: 50, ...(catalog.items.includes("godseed") ? { godseed: 6 } : {}) });
    const previous = { profileId: "p1", items: { dead_plant: 210 } };
    // Same count on Hypixel as last import: probably not saved yet.
    expect(sinceLastImport(previous, "p1", "dead_plant", 210)).toBe(0);
    expect(sinceLastImport(previous, "p1", "dead_plant", 250)).toBe(40);
    expect(sinceLastImport(previous, "p1", "fermento", 50)).toBe(50);
    // Another profile, or no earlier import: nothing to compare.
    expect(sinceLastImport(previous, "p2", "dead_plant", 210)).toBeNull();
    expect(sinceLastImport(undefined, "p1", "dead_plant", 210)).toBeNull();
  });

  it("ignores junk counts", () => {
    const junk = inventoryChanges(catalog, {}, { dead_plant: -5, fermento: Number.NaN, godseed: 2.7 } as Record<string, number>);
    expect(junk.map((c) => [c.item, c.found])).toEqual(catalog.items.includes("godseed") ? [["godseed", 2]] : []);
  });
});
