import { describe, expect, it } from "vitest";
import { valueResult } from "../leaderboard/pricing";
import type { RunResult } from "../leaderboard/result";
import { defaultGameData, unitPrices, DEFAULT_BAZAAR_PRICING } from "../simulator";
import { withoutCropQuotes } from "./useBazaarPrices";

const data = defaultGameData();
const pricing = { ...DEFAULT_BAZAAR_PRICING, taxPercent: 0 };
// Wheat sells far above NPC on the Bazaar; Chloronite (a mutation) only sells there.
const quotes = { wheat: { lowestSellOffer: 100, highestBuyOrder: 90 }, chloronite: { lowestSellOffer: 125_000, highestBuyOrder: 120_000 } };

describe("crops at NPC price", () => {
  it("drops only base-crop quotes, so crops fall back to NPC and mutations keep the Bazaar", () => {
    const q = withoutCropQuotes(quotes)!;
    expect(Object.keys(q)).toEqual(["chloronite"]);
    expect(unitPrices(data, "wheat", quotes, pricing)).toMatchObject({ sell: 100, sellFrom: "bazaar" });
    expect(unitPrices(data, "wheat", q, pricing)).toMatchObject({ sell: data.crops.wheat.sellPrice, sellFrom: "npc" });
    expect(unitPrices(data, "chloronite", q, pricing)).toMatchObject({ sell: 125_000, sellFrom: "bazaar" });
    expect(withoutCropQuotes(null)).toBeNull();
  });

  it("re-prices a leaderboard result", () => {
    const r = { produced: { wheat: 1000, chloronite: 1 }, bought: {}, built: {} } as unknown as RunResult;
    expect(valueResult(data, r, "normal", quotes, pricing).revenuePerDay).toBe(1000 * 100 + 125_000);
    expect(valueResult(data, r, "normal", withoutCropQuotes(quotes)!, pricing).revenuePerDay).toBe(1000 * data.crops.wheat.sellPrice + 125_000);
  });
});
