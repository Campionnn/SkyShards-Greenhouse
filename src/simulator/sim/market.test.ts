import { describe, expect, it } from "vitest";
import { bazaarBuyPrice, bazaarSellPrice, BAZAAR_PRODUCTS, COMPACTED_CROPS, DEFAULT_BAZAAR_PRICING, parseBazaar, withOverrides, type BazaarPricing, type BazaarQuote } from "../economy/bazaar";
import { unitPrices, valueMarket, valueRun } from "../economy/valuation";
import type { Scenario, SimulationState, TimedEvent } from "./state";
import { reservePlan } from "./market";
import { engine, flow, layout, plantAt, scenario, singlePlot, start, step, TIMER_ONLY } from "../testHelpers";

const normal = (sc: Scenario, extra: Partial<Scenario["settings"]> = {}): Scenario => ({ ...sc, settings: { ...sc.settings, profile: "normal", ...extra } });
const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) => events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);
const json = (s: SimulationState) => JSON.stringify(s);

const chloroniteLayout = layout([["chloronite", 5, 5]]);

describe("normal profile: the engine", () => {
  it("ironman (no profile, or 'ironman') never gets market counts, so its states are unchanged", () => {
    const sc = singlePlot(chloroniteLayout);
    const plain = engine.run(start(sc), 30);
    const iron = engine.run(start({ ...sc, settings: { ...sc.settings, profile: "ironman" } }), 30);
    expect(plain.summary.market).toBeUndefined();
    expect(iron.summary.market).toBeUndefined();
    // Same run apart from the setting itself.
    const strip = (s: SimulationState) => json({ ...s, scenario: { ...s.scenario, settings: { ...s.scenario.settings, profile: undefined } } });
    expect(strip(iron.state)).toBe(strip(plain.state));
  });

  it("setup stays free but is counted as what building the layout costs", () => {
    const s = start(normal(singlePlot(layout([["chloronite", 5, 5], ["fermento", 0, 0], ["fire", 9, 9], ["wheat", 1, 1]]))));
    expect(s.summary.market).toEqual({ produced: {}, bought: {}, sold: {}, built: { chloronite: 1, fermento: 1 } });
    expect(s.inventory).toEqual({});
  });

  it("a placement short of stock buys the shortfall instead of going short", () => {
    const sc = normal(singlePlot(chloroniteLayout));
    const r = TIMER_ONLY.run(start(sc, TIMER_ONLY), 18); // decays at cycle 17, re-placed that session
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("chloronite");
    expect(r.state.debts).toEqual([]);
    expect(r.summary.debtEvents).toBe(0);
    expect(r.summary.market!.bought).toEqual({ chloronite: 1 });
    expect(r.state.inventory.chloronite ?? 0).toBe(0);
    expect(ofKind(r.events, "bought")).toEqual([expect.objectContaining({ item: "chloronite", row: 5, col: 5, qty: 1 })]);
    // The same run in ironman goes short.
    const iron = TIMER_ONLY.run(start(singlePlot(chloroniteLayout), TIMER_ONLY), 18);
    expect(iron.summary.debtEvents).toBe(1);
  });

  it("stock is used first; only the missing units are bought", () => {
    const sc = normal(
      scenario([flow([step("bare", layout([["wheat", 1, 1]]), [{ kind: "cycles", n: 1 }]), step("use", layout([["chloronite", 5, 5], ["chloronite", 5, 7], ["fermento", 0, 0]]))])], {
        inventory: { chloronite: 1 },
      })
    );
    const r = engine.run(start(sc), 3);
    expect(plantAt(r.state, 1, 5, 7)?.kindId).toBe("chloronite");
    expect(plantAt(r.state, 1, 0, 0)?.kindId).toBe("fermento"); // fermento is on the Bazaar too
    expect(r.summary.market!.bought).toEqual({ chloronite: 1, fermento: 1 });
    expect(r.summary.placedItems).toEqual({ chloronite: 2, fermento: 1 });
    expect(r.state.debts).toEqual([]);
  });

  it("surplus mutation items above the reserve are sold after the session; the reserve is kept", () => {
    // Plot 1 grows Gloomgourd (pumpkin and melon either side of an empty target); its layout places none, so the
    // automatic reserve of Gloomgourd is 0 and every harvested one is sold.
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]);
    const sc = normal(singlePlot(spec, { stats: { mutationChanceBonus: 1e6 } }));
    const r = engine.run(start(sc), 40);
    const harvested = r.summary.harvested.gloomgourd ?? 0;
    expect(harvested).toBeGreaterThan(0);
    expect(r.summary.market!.sold.gloomgourd).toBe(r.summary.market!.produced.gloomgourd);
    expect(r.state.inventory.gloomgourd ?? 0).toBe(0);
    // Not mutation items: kept.
    expect(r.summary.market!.sold.pumpkin).toBeUndefined();
    expect(r.state.inventory.pumpkin ?? 0).toBeGreaterThan(0);

    // A reserve override keeps that many.
    const kept = engine.run(start(normal(singlePlot(spec, { stats: { mutationChanceBonus: 1e6 } }), { reserve: { gloomgourd: 3 } })), 40);
    expect(kept.state.inventory.gloomgourd).toBe(Math.min(3, kept.summary.market!.produced.gloomgourd));
  });

  it("the automatic reserve: the most any one step places, summed over plots, raised to inventory triggers", () => {
    const sc = normal(
      scenario([
        flow([
          step("a", layout([["chloronite", 1, 1], ["chloronite", 1, 3]]), [{ kind: "inventoryAtLeast", item: "duskbloom", qty: 7 }]),
          step("b", layout([["chloronite", 1, 1], ["chloronite", 1, 3], ["chloronite", 1, 5]])),
        ]),
        flow([step("c", layout([["chloronite", 1, 1], ["fermento", 3, 3]]))]),
      ])
    );
    const plan = reservePlan(sc, engine.data);
    expect(plan.reserve).toEqual({ chloronite: 4, duskbloom: 7 }); // fermento is not a mutation: never sold
    expect(plan.auto.fermento).toBe(1);
    expect(reservePlan({ ...sc, settings: { ...sc.settings, reserve: { chloronite: 0 } } }, engine.data).reserve.chloronite).toBe(0);
  });

  it("layoutShort never holds for an item the player can buy", () => {
    const steps = [
      step("a", layout([["wheat", 1, 1]]), [{ kind: "cycles", n: 1 }]),
      step("b", layout([["chloronite", 5, 5]]), [{ kind: "layoutShort" }], { exits: [] }),
      step("c", layout()),
    ];
    const iron = engine.run(start(scenario([flow(steps)])), 3);
    expect(iron.state.flows[0].stepIndex).toBe(2); // short, moved on
    const norm = engine.run(start(normal(scenario([flow(steps)]))), 3);
    expect(norm.state.flows[0].stepIndex).toBe(1); // bought it and stayed
    expect(plantAt(norm.state, 1, 5, 5)?.kindId).toBe("chloronite");
  });

  it("stays deterministic and splittable", () => {
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6], ["chloronite", 0, 0]], [["gloomgourd", 4, 5]]);
    const s = start(normal(singlePlot(spec, { stats: { mutationChanceBonus: 1e6 } })), TIMER_ONLY);
    const whole = TIMER_ONLY.run(s, 60);
    const split = TIMER_ONLY.run(TIMER_ONLY.run(s, 25).state, 35);
    expect(json(split.state)).toBe(json(whole.state));
  });
});

const quote = (lowestSellOffer: number | null, highestBuyOrder: number | null): BazaarQuote => ({ lowestSellOffer, highestBuyOrder });

describe("Bazaar prices", () => {
  it("parses a /v2/skyblock/bazaar response from the top of the order book, not quick_status", () => {
    const book = (...prices: number[]) => prices.map((pricePerUnit) => ({ amount: 10, pricePerUnit, orders: 1 }));
    const snap = parseBazaar({
      success: true,
      lastUpdated: 1234,
      products: {
        // buy_summary = sell offers (cheapest first), sell_summary = buy orders (highest first).
        NOCTILUME: { buy_summary: book(650_579.5, 650_579.6), sell_summary: book(490_290.8, 490_290.7), quick_status: { buyPrice: 1, sellPrice: 1 } },
        "INK_SACK:3": { buy_summary: book(13.2), sell_summary: book(0.5) },
        GODSEED: { buy_summary: [], sell_summary: [] },
        GLASSCORN: { buy_summary: book(81_944.2), sell_summary: [] },
        DIAMOND: { buy_summary: book(58), sell_summary: book(5) },
      },
    });
    expect(snap.lastUpdated).toBe(1234);
    expect(snap.quotes.noctilume).toEqual({ lowestSellOffer: 650_579.5, highestBuyOrder: 490_290.8 });
    expect(snap.quotes.cocoa_beans).toEqual({ lowestSellOffer: 13.2, highestBuyOrder: 0.5 });
    expect(snap.quotes.godseed).toEqual({ lowestSellOffer: null, highestBuyOrder: null }); // empty book
    expect(snap.quotes.glasscorn).toEqual({ lowestSellOffer: 81_944.2, highestBuyOrder: null });
    expect(Object.keys(snap.quotes)).not.toContain("DIAMOND");
    expect(() => parseBazaar({ success: false })).toThrow();
    expect(() => parseBazaar(null)).toThrow();
  });

  it("prices base crops from their double-compacted product, per crop, on both sides; raw crop only as a fallback", () => {
    const book = (...prices: number[]) => prices.map((pricePerUnit) => ({ amount: 10, pricePerUnit, orders: 1 }));
    const snap = parseBazaar({
      success: true,
      products: {
        DOUBLE_PLANT: { buy_summary: book(11.7), sell_summary: book(0.3) }, // thin raw book: ignored
        COMPACTED_SUNFLOWER: { buy_summary: book(77_600), sell_summary: book(75_480) },
        ENCHANTED_HAY_BALE: { buy_summary: book(152_240), sell_summary: [] },
        CACTUS: { buy_summary: book(8.6), sell_summary: book(0.4) }, // no ENCHANTED_CACTUS in this response
      },
    });
    expect(snap.quotes.sunflower.lowestSellOffer).toBeCloseTo(77_600 / 25_600, 9); // sell order
    expect(snap.quotes.sunflower.highestBuyOrder).toBeCloseTo(75_480 / 25_600, 9); // instant sell
    expect(snap.quotes.wheat).toEqual({ lowestSellOffer: 152_240 / 25_600, highestBuyOrder: null });
    expect(snap.quotes.cactus).toEqual({ lowestSellOffer: 8.6, highestBuyOrder: 0.4 }); // fallback
    // Every base crop the greenhouse drops has a compacted product (25,600 crops = 160 enchanted).
    for (const id of engine.data.cropIds) {
      if (["fire", "dead_plant", "fermento"].includes(id)) continue;
      expect(COMPACTED_CROPS[id], id).toMatchObject({ per: 25_600 });
    }
    expect(COMPACTED_CROPS.seeds.product).toBe("BOX_OF_SEEDS");
    // Both sell sides use the compacted price, after tax; the NPC (3 per Sunflower) still wins when it pays more.
    const pricing = (sell: "order" | "instant"): BazaarPricing => ({ buy: "instant", sell, taxPercent: 1 });
    const rich = { sunflower: { lowestSellOffer: 120_000 / 25_600, highestBuyOrder: 110_000 / 25_600 } };
    expect(unitPrices(engine.data, "sunflower", rich, pricing("instant"))).toMatchObject({ sellFrom: "bazaar" });
    expect(unitPrices(engine.data, "sunflower", rich, pricing("instant")).sell).toBeCloseTo((110_000 / 25_600) * 0.99, 9);
    expect(unitPrices(engine.data, "sunflower", rich, pricing("order")).sell).toBeCloseTo((120_000 / 25_600) * 0.99, 9);
    expect(unitPrices(engine.data, "sunflower", snap.quotes, pricing("instant"))).toEqual({ sell: 3, sellFrom: "npc", buy: 77_600 / 25_600 });
  });

  it("maps every greenhouse mutation to a product", () => {
    for (const id of engine.data.mutationIds) if (id !== "jerryflower") expect(BAZAAR_PRODUCTS[id], id).toBeDefined();
  });

  it("manual prices replace one side of the live book; untouched items and sides stay live", () => {
    const live = { noctilume: quote(650_000, 490_000), chloronite: quote(125_000, 87_000) };
    const q = withOverrides(live, { noctilume: { lowestSellOffer: 400_000 }, glasscorn: { highestBuyOrder: 5_000 } })!;
    expect(q.noctilume).toEqual({ lowestSellOffer: 400_000, highestBuyOrder: 490_000 });
    expect(q.chloronite).toEqual(live.chloronite);
    expect(q.glasscorn).toEqual({ lowestSellOffer: null, highestBuyOrder: 5_000 }); // no live quote, only yours
    expect(withOverrides(null, {})).toBeNull();
    expect(withOverrides(null, { wheat: { highestBuyOrder: 3 } })).toEqual({ wheat: { lowestSellOffer: null, highestBuyOrder: 3 } });
    expect(DEFAULT_BAZAAR_PRICING.taxPercent).toBe(1);
  });

  it("buy and sell sides, tax, and fallbacks", () => {
    const q = quote(100, 80); // instant buy 100, instant sell 80
    expect(bazaarBuyPrice(q, "instant")).toBe(100);
    expect(bazaarBuyPrice(q, "order")).toBe(80);
    expect(bazaarSellPrice(q, "order", 0)).toBe(100);
    expect(bazaarSellPrice(q, "instant", 1.25)).toBeCloseTo(79);
    expect(bazaarBuyPrice(quote(null, 80), "instant")).toBe(80);
    expect(bazaarSellPrice(quote(100, null), "instant", 0)).toBe(100);
    expect(bazaarSellPrice(undefined, "order", 0)).toBeNull();
  });

  it("sells each item where it pays more: mutation items on the Bazaar, crops at the better of NPC and Bazaar", () => {
    const pricing: BazaarPricing = { buy: "instant", sell: "order", taxPercent: 0 };
    const quotes = { wheat: quote(2, 1), cropie: quote(30_000, 25_000), chloronite: quote(125_000, 87_000) };
    expect(unitPrices(engine.data, "wheat", quotes, pricing)).toEqual({ sell: 2.5, sellFrom: "npc", buy: 2 });
    expect(unitPrices(engine.data, "cropie", quotes, pricing)).toMatchObject({ sell: 30_000, sellFrom: "bazaar" });
    expect(unitPrices(engine.data, "chloronite", quotes, pricing)).toEqual({ sell: 125_000, sellFrom: "bazaar", buy: 125_000 });
    expect(unitPrices(engine.data, "fire", quotes, pricing)).toEqual({ sell: 0, sellFrom: "none", buy: null });
  });

  it("values a run: revenue at sell price, own-stock placements at sell price, purchases at buy price", () => {
    const pricing: BazaarPricing = { buy: "instant", sell: "instant", taxPercent: 0 };
    const quotes = { chloronite: quote(120, 100), cropie: quote(30, 20) };
    const v = valueMarket(
      engine.data,
      { produced: { chloronite: 5, cropie: 2 }, bought: { chloronite: 2 }, sold: { chloronite: 3 }, built: { chloronite: 4 } },
      { chloronite: 3 },
      quotes,
      pricing
    );
    expect(v.revenue.mutationItems).toBe(500);
    expect(v.revenue.rareCrops).toBe(25_000 * 2); // Cropie's NPC price (25k) beats its Bazaar price here
    expect(v.ownStock).toBe(1 * 100); // 3 placed, 2 of them bought
    expect(v.bought).toBe(2 * 120);
    expect(v.profit).toBe(v.revenueTotal - 100 - 240);
    expect(v.sold).toBe(300);
    expect(v.buildCost).toBe(4 * 120);
  });

  it("profit doesn't depend on when the surplus is sold (end-to-end, different reserves)", () => {
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]);
    const base = singlePlot(spec, { stats: { mutationChanceBonus: 1e6 } });
    const quotes = { gloomgourd: quote(1_600, 5), pumpkin: quote(8, 1) };
    const pricing: BazaarPricing = { buy: "instant", sell: "order", taxPercent: 1.25 };
    const a = engine.run(start(normal(base)), 30).summary;
    const b = engine.run(start(normal(base, { reserve: { gloomgourd: 1000 } })), 30).summary;
    expect(b.market!.sold).toEqual({});
    expect(valueRun(engine.data, a, quotes, pricing)!.profit).toBeCloseTo(valueRun(engine.data, b, quotes, pricing)!.profit, 6);
    expect(valueRun(engine.data, engine.run(start(base), 5).summary, quotes, pricing)).toBeNull();
  });
});
