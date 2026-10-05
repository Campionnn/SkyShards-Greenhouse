import { defaultGameData } from "../../src/simulator/data/default";

/**
 * A random starting inventory (deterministic per `n`): each mutation is owned with some
 * chance, in an amount that is sometimes 1 (an awkward leftover) and sometimes plenty.
 * Higher tiers are rarer. Legendaries 1-3.
 */
export function randomInventory(n: number): Record<string, number> {
  let x = (n * 2654435761) >>> 0 || 1;
  const rnd = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const data = defaultGameData();
  const own: Record<string, number> = { common: 0.6, uncommon: 0.45, rare: 0.35, epic: 0.25, legendary: 0.3 };
  const top: Record<string, number> = { common: 40, uncommon: 25, rare: 12, epic: 8 };
  const inv: Record<string, number> = {};
  for (const id of data.mutationIds) {
    const m = data.mutations[id];
    if (m.spawnWeight <= 0 && id !== "shellfruit") continue;
    if (rnd() > own[m.rarity]) continue;
    inv[id] = m.rarity === "legendary" ? 1 + Math.floor(rnd() * 3) : rnd() < 0.3 ? 1 : 1 + Math.floor(rnd() * top[m.rarity]);
  }
  return inv;
}

/** Starting inventories the test harness runs the flow from (Fermento/Dead Plants are added as free stock). */
export const INVENTORIES: Record<string, Record<string, number>> = {
  empty: {},
  // a few commons from the bazaar
  commons: { ashwreath: 30, choconut: 30, dustgrain: 12, gloomgourd: 12, scourroot: 12, veilshroom: 14, witherbloom: 18, shadevine: 8 },
  // already through the uncommons + some rares
  rares: {
    ashwreath: 30, choconut: 40, dustgrain: 12, gloomgourd: 12, scourroot: 20, veilshroom: 20, witherbloom: 20, shadevine: 8,
    chocoberry: 17, creambloom: 25, duskbloom: 30, thornshade: 14, cindershade: 11, coalroot: 13, lonelily: 12,
    magic_jellybean: 25, chloronite: 22, soggybud: 20,
  },
  // one of each legendary already owned
  halfLegendary: { all_in_aloe: 1, devourer: 1, glasscorn: 1, phantomleaf: 1, timestalk: 1 },
  // owns devourer x2 and glasscorn x2: those lines must be skipped
  devGlassDone: { devourer: 2, glasscorn: 3 },
  // everything but the aloe line
  aloeOnly: { devourer: 2, glasscorn: 2, phantomleaf: 2, timestalk: 2 },
  // already owns it all: every plot should go straight to done
  allDone: { all_in_aloe: 2, devourer: 2, glasscorn: 2, phantomleaf: 2, timestalk: 2 },
  // late game: epics in stock
  epics: { snoozling: 6, thunderling: 8, puffercloud: 6, stoplight_petal: 6, zombud: 6, chorus_fruit: 10, shellfruit: 8, startlevine: 8, chloronite: 20, magic_jellybean: 25 },
};

