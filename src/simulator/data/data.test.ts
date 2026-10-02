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

  it("reads crop decay as DAYS too: 3 for base crops and dead plants, 0 (never) for fire / fermento", () => {
    expect(data.crops.wheat.decayDays).toBe(3);
    expect(data.crops.dead_plant.decayDays).toBe(3);
    expect(data.crops.fire.decayDays).toBe(0);
    expect(data.crops.fermento.decayDays).toBe(0);
    const values = new Set(Object.values(data.crops).map((c) => c.decayDays));
    expect([...values].sort()).toEqual([0, 3]);
  });

  it("reads the minimum mutation value of each kind", () => {
    expect(data.crops.wheat.minimumMutations).toBe(12);
    expect(data.crops.red_mushroom.minimumMutations).toBe(12);
    expect(data.crops.dead_plant.minimumMutations).toBe(10);
    expect(data.crops.fire.minimumMutations).toBeNull();
    expect(data.mutations.dustgrain.minimumMutations).toBe(10);
    expect(data.mutations.coalroot.minimumMutations).toBe(10);
    expect(data.mutations.creambloom.minimumMutations).toBe(8);
    expect(data.mutations.fleshtrap.minimumMutations).toBe(6);
    expect(data.mutations.fleshtrap.decayDays).toBe(0); // has a minimum, but no timer: still never decays
    expect(data.mutations.shellfruit.minimumMutations).toBe(6);
    expect(data.mutations.magic_jellybean.minimumMutations).toBe("infinite");
    expect(data.mutations.stoplight_petal.minimumMutations).toBeNull();
    expect(data.mutations.turtlellini.minimumMutations).toBeNull();
    expect(data.mutations.godseed.minimumMutations).toBeNull();
  });

  it("gives every crop and mutation a minimum mutation value (int > 0, \"infinite\" or null)", () => {
    const valid = (v: unknown) => v === null || v === "infinite" || (Number.isInteger(v) && (v as number) > 0);
    for (const k of [...Object.values(data.crops), ...Object.values(data.mutations)]) {
      expect(k, k.id).toHaveProperty("minimumMutations");
      expect(valid(k.minimumMutations), `${k.id}: ${String(k.minimumMutations)}`).toBe(true);
    }
    const raw = greenhouseData as unknown as Record<"crops" | "mutations", Record<string, Record<string, unknown>>>;
    for (const section of ["crops", "mutations"] as const) {
      for (const [id, k] of Object.entries(raw[section])) expect(k, `${section}.${id}`).toHaveProperty("minimum_mutations");
    }
    for (const [id, c] of Object.entries(raw.crops)) expect(c, `crops.${id}`).toHaveProperty("decay");
  });

  it("fails loudly when minimum_mutations is missing or malformed", () => {
    const missing = structuredClone(greenhouseData) as { mutations: Record<string, Record<string, unknown>> };
    delete missing.mutations.dustgrain.minimum_mutations;
    expect(() => loadGameData(missing)).toThrow(GameDataError);
    expect(() => loadGameData(missing)).toThrow(/mutations\.dustgrain\.minimum_mutations/);

    const missingCrop = structuredClone(greenhouseData) as { crops: Record<string, Record<string, unknown>> };
    delete missingCrop.crops.wheat.minimum_mutations;
    expect(() => loadGameData(missingCrop)).toThrow(/crops\.wheat\.minimum_mutations/);

    const missingDecay = structuredClone(greenhouseData) as { crops: Record<string, Record<string, unknown>> };
    delete missingDecay.crops.wheat.decay;
    expect(() => loadGameData(missingDecay)).toThrow(/crops\.wheat\.decay/);

    for (const badValue of [0, -1, 2.5, "Infinite", "never"]) {
      const bad = structuredClone(greenhouseData) as { mutations: Record<string, Record<string, unknown>> };
      bad.mutations.dustgrain.minimum_mutations = badValue;
      expect(() => loadGameData(bad), String(badValue)).toThrow(GameDataError);
    }
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
