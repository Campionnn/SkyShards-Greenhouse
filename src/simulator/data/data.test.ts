import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import greenhouseData from "../../../public/greenhouse/data.json";
import { defaultGameData } from "./default";
import { GameDataError, KNOWN_SPECIALS, loadGameData } from "./load";

const data = defaultGameData();
const siblingPath = resolve(__dirname, "../../../../SkyShards-API/data.json");

describe("game data", () => {
  it("has 17 crops, 40 mutations and 12 effects", () => {
    expect(data.cropIds).toHaveLength(17);
    expect(data.mutationIds).toHaveLength(40);
    expect(Object.keys(data.effects)).toHaveLength(12);
  });

  it("carries spawn weights and NPC sell prices (the fields the old frontend copy lacked)", () => {
    expect(data.mutations.gloomgourd.spawnWeight).toBe(30);
    expect(data.mutations.lonelily.spawnWeight).toBe(6);
    expect(data.crops.pumpkin.sellPrice).toBe(10);
  });

  it("maps snake_case to camelCase in one place", () => {
    const m = data.mutations.magic_jellybean;
    expect(m.growthStages).toBe(120);
    expect(m.requiresWatering).toBe(true);
    expect(m.positiveBuffs).toEqual(["improved_xp_boost"]);
  });

  it("reads decay as DAYS; 0 means never", () => {
    expect(data.mutations.noctilume.decayDays).toBe(6); // the one wiki-published value
    expect(data.mutations.magic_jellybean.decayDays).toBe(0);
    const values = new Set(Object.values(data.mutations).map((m) => m.decayDays));
    for (const v of values) expect([0, 3, 5, 6, 10]).toContain(v);
  });

  it("handles every special explicitly", () => {
    for (const m of Object.values(data.mutations)) {
      if (m.special) expect(KNOWN_SPECIALS).toHaveProperty(m.special);
    }
  });

  it("fails loudly on an unknown special", () => {
    const bad = structuredClone(greenhouseData) as { mutations: Record<string, Record<string, unknown>> };
    bad.mutations.gloomgourd.special = "summon_a_dragon";
    expect(() => loadGameData(bad)).toThrow(GameDataError);
  });

  it("derives the effect tables from data, never hardcoded", () => {
    expect(data.negativeEffects).toEqual(["harvest_loss", "water_drain", "xp_loss"]);
    expect(data.improvedOf).toEqual({
      xp_boost: "improved_xp_boost",
      harvest_boost: "improved_harvest_boost",
      water_retain: "improved_water_retain",
    });
    expect(Object.keys(data.specialEffectSets)).toEqual(["godseed"]);
  });

  it("has 12 unique-crop groups, not 14 (sun/moonflower and the mushrooms merge)", () => {
    expect(data.uniqueCropGroups).toHaveLength(12);
    expect(data.uniqueCropGroups).toContainEqual(["sunflower", "moonflower"]);
    expect(data.uniqueCropGroups).toContainEqual(["red_mushroom", "brown_mushroom"]);
  });

  it.skipIf(!existsSync(siblingPath))("is a verbatim copy of SkyShards-API/data.json (run `pnpm sync:data`)", () => {
    const backend = JSON.parse(readFileSync(siblingPath, "utf8"));
    expect(greenhouseData).toEqual(backend);
  });
});
