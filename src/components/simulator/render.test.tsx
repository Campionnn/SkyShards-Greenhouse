import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GreenhouseDataProvider, InfoModalProvider } from "../../context";
import type { SimulationView } from "../../hooks/useSimulation";
import { defaultGameData, sanityCheck, withOverrides } from "../../simulator";
import { getRarityTextColor } from "../../utilities/rarity";
import { engine, flow, inject, LAYOUT_A_CODE, LAYOUT_B_CODE, layout, scenario, singlePlot, start as startOf, step } from "../../simulator/testHelpers";
import { ToastProvider } from "../ui";
import { PlotMarkLegend, PlotView } from "./PlotView";
import { LayoutPickerPanel } from "./LayoutPicker";
import { MoneyPanel, SustainabilityPanel, UptimeTree } from "./ReportPanels";
import { InventoryTable } from "./InventoryTable";
import { WatchPicker } from "./flowgraph/TargetsTab";
import { FlowEditorContext, type FlowEditorApi, type InspectorTab } from "./flowgraph/context";
import { Inspector } from "./flowgraph/Inspector";
import { StepList } from "./flowgraph/StepList";
import { explicitExits } from "./flowgraph/model";
import { EventLog, FlowTimeline } from "./RunPanels";
import { CommandBar } from "./page/CommandBar";
import { KpiStrip } from "./page/KpiStrip";
import { ScenarioTab } from "./page/ScenarioTab";
import { AloeHarvestPreview, SettingsPanel } from "./ScenarioPanels";
import { SimTooltip } from "./SimTooltip";
import { closestBlocked, hoveredCellOffset } from "./sanityFormat";
import { describeEvent, formatCoins, formatCount, nameOf, plantIconOf } from "./format";
import { BazaarMoneyPanel, BazaarPricePanel } from "./BazaarPanels";
import { bazaarProfit, priceAge } from "./bazaarFormat";
import { FrequencyPanel } from "./frequency/FrequencyPanel";
import { EffortPanel } from "./EffortPanel";

// Server-render every simulator panel against a real simulation, to catch
// render-time errors (no browser needed).

const sc = scenario(
  [LAYOUT_A_CODE, LAYOUT_B_CODE].map((code, i) =>
    flow([step("a", { code }, [{ kind: "cycles", n: 10 }]), step("b", { code }, [])], i === 0)
  ),
  { inventory: { chloronite: 30, magic_jellybean: 20 } }
);
const start = engine.initState(sc);
const before = engine.run(start.state, 40);
const after = engine.run(before.state, 1);
const view: SimulationView = {
  status: "ready",
  snapshot: { state: after.state, report: engine.analyse(after.state) },
  previousSummary: before.summary,
  lastCycleEvents: after.events,
  log: [...before.events.slice(-50), ...after.events],
  progress: null,
  lastCall: { cyclesRun: 1, truncated: false },
  error: null,
  issues: [],
  warnings: [],
  history: { canStepBack: true, lastAction: { kind: "run", fromCycle: 40, cycles: 1 } },
  rewound: null,
};

const wrap = (node: React.ReactNode) =>
  renderToString(
    <MemoryRouter>
      <ToastProvider>
        <GreenhouseDataProvider>
          <InfoModalProvider>{node}</InfoModalProvider>
        </GreenhouseDataProvider>
      </ToastProvider>
    </MemoryRouter>
  );

describe("simulator panels render", () => {
  const state = after.state;

  it("inventory mutation names use their rarity colors without recoloring other items", () => {
    const data = defaultGameData();
    const inventory = Object.fromEntries([...data.mutationIds, "wheat", "fermento", "dead_plant"].map((id) => [id, 10]));
    const inventoryState = startOf(singlePlot(layout(), { inventory }));
    const html = wrap(<InventoryTable state={inventoryState} />);

    for (const id of data.mutationIds) {
      const mutation = data.mutations[id];
      expect(html).toContain(`<span class="${getRarityTextColor(mutation.rarity ?? "common")} break-words min-w-0">${mutation.name}</span>`);
    }
    // Fermento is a rare crop: that section starts collapsed, so it is not rendered.
    for (const name of ["Wheat", "Dead Plant"]) {
      expect(html).toContain(`<span class="text-slate-300 break-words min-w-0">${name}</span>`);
    }
  });

  it("plots", () => {
    const html = wrap(
      <>
        {state.plots.map((p) => (
          <PlotView key={p.id} plot={p} runner={state.flows.find((f) => f.plotId === p.id)} def={state.scenario.plots.find((d) => d.id === p.id)} events={after.events} cycleSeconds={state.lastCycleSeconds} config={state.scenario.settings.config} />
        ))}
        <PlotMarkLegend />
      </>
    );
    // SSR puts a <!-- --> marker between adjacent text nodes.
    expect(html.replace(/<!-- -->/g, "")).toContain("Plot 1");
    expect(html).toContain("Step");
  });

  it("plant hover cards show the minimum-mutation counters, the pool and what happens when the timer runs out", () => {
    const plot = structuredClone(state.plots[0]);
    const card = (plant: (typeof plot.plants)[number]) =>
      renderToString(
        <SimTooltip target={{ kind: "plant", plant }} cellSize={40} gap={2} gridWidth={420} gridHeight={420} cycleSeconds={14400} config={state.scenario.settings.config} plot={plot} />
      ).replace(/<!-- -->/g, "");
    const base = plot.plants.find((p) => p.origin === "planted")!;

    const fresh = card({ ...base, timesMutated: 0, mutatesRemaining: 12, decaySecondsRemaining: 3600 });
    expect(fresh).toContain("Times mutated");
    expect(fresh).toContain("Mutates remaining");
    expect(fresh).toContain("not pooled - hasn&#x27;t helped yet");
    expect(fresh).toContain("then +24h (minimum not met)");
    expect(fresh).not.toMatch(/text-red-300">in /); // it would only be extended: not shown as about to decay

    // Pooled: helped and fully grown, standing on the plot (the pool is read from the plot).
    const pooled = { ...base, id: -1, stage: base.readyStage, lockedEffects: [], timesMutated: 12, mutatesRemaining: -3, decaySecondsRemaining: 3600 };
    plot.plants = plot.plants.map((p) => (p === base ? pooled : p));
    const done = card(pooled);
    expect(done).toMatch(/combined -?\d+ \(pooled\)/);
    expect(done).toMatch(/text-red-300">in /); // it would decay if the pool is <= 0
    plot.plants = plot.plants.map((p) => (p === pooled ? base : p));

    const naCard = card({ ...base, mutatesRemaining: null, decaySecondsRemaining: 3600 });
    expect(naCard).toContain("none (timer only)");
    expect(naCard).toContain("then decays");
    expect(naCard).toMatch(/text-red-300">in /);

    const jelly = card({ ...base, kindId: "magic_jellybean", mutatesRemaining: "infinite", decaySecondsRemaining: null });
    expect(jelly).toContain("∞");
    expect(jelly).toContain("never decays");

    const dead = card({ ...base, kindId: "dead_plant", isDeadPlant: true, origin: "placed", timesMutated: 0, mutatesRemaining: 10, decaySecondsRemaining: 3 * 86400 });
    expect(dead).toContain("Mutates remaining");
    expect(dead).toContain("then +24h (minimum not met)");
  });

  it("Sanity Check: the plot view gets hover targets only while it is on, and the card lists spawnable and blocked mutations", () => {
    const sc2 = singlePlot(
      { ...layout([["pumpkin", 4, 3], ["melon", 4, 5], ["wheat", 7, 7]], [["chloronite", 1, 1]]), groundTiles: [{ ground: "farmland", row: 4, col: 4 }] }
    );
    const s = startOf(sc2);
    const plot = s.plots[0];
    const view = (on: boolean) =>
      renderToString(<PlotView plot={plot} runner={s.flows[0]} def={s.scenario.plots[0]} events={[]} cycleSeconds={s.lastCycleSeconds} config={s.scenario.settings.config} sanityState={on ? s : undefined} />);
    // Hover targets are handlers, not DOM, so both render the same at rest.
    expect(view(true).replace(/<!-- -->/g, "")).toContain("Plot 1");
    expect(view(false).replace(/<!-- -->/g, "")).toContain("Plot 1");

    const r = sanityCheck(s, engine.data, 1, 4, 4);
    const card = (result: typeof r, row = 4, col = 4) =>
      renderToString(<SimTooltip target={{ kind: "check", row, col, result }} cellSize={40} gap={2} gridWidth={420} gridHeight={420} cycleSeconds={14400} config={s.scenario.settings.config} plot={plot} />).replace(/<!-- -->/g, "");
    const html = card(r);
    expect(html).toContain("Sanity Check");
    expect(html).toContain("Can spawn here now");
    expect(html).toContain("Gloomgourd");
    expect(html).toContain("30%");
    expect(html).toContain("Can&#x27;t spawn here");
    expect(html).toMatch(/needs \d+× /); // a requirement reason
    expect(html).toMatch(/\+\d+ more/); // the cap
    expect(html).not.toMatch(/best|rank/i);
    // Closest-first display cap, not a ranking: fewest missing first, then data.json order.
    const { shown, more } = closestBlocked(r, 6);
    expect(shown).toHaveLength(6);
    expect(more).toBe(r.cannot.length - 6);
    expect(shown.map((e) => e.missingCount)).toEqual([...shown.map((e) => e.missingCount)].sort((a, b) => a - b));

    // An occupied cell says so; a slot keeps its card and gets the check appended.
    const occ = sanityCheck(s, engine.data, 1, 7, 7);
    expect(card(occ, 7, 7)).toContain("stands here");
    const slotCheck = sanityCheck(s, engine.data, 1, 1, 1);
    const slotHtml = renderToString(
      <SimTooltip target={{ kind: "slot", slot: plot.slots[0], ineligibleCycles: 0, check: slotCheck }} cellSize={40} gap={2} gridWidth={420} gridHeight={420} cycleSeconds={14400} config={s.scenario.settings.config} plot={plot} />
    ).replace(/<!-- -->/g, "");
    expect(slotHtml).toContain("Empty target cell.");
    expect(slotHtml).toContain("Sanity Check");
    expect(slotHtml).toContain("Can spawn here now");
    const noCheck = renderToString(
      <SimTooltip target={{ kind: "slot", slot: plot.slots[0], ineligibleCycles: 0 }} cellSize={40} gap={2} gridWidth={420} gridHeight={420} cycleSeconds={14400} config={s.scenario.settings.config} plot={plot} />
    );
    expect(noCheck).not.toContain("Sanity Check");
    // The Plot view shows the check card only via a hovered TooltipTarget "check".
    expect(view(true)).not.toContain("Can spawn here now");
  });

  it("Sanity Check on multi-cell elements: the plant card appends the check of the hovered cell, the slot card names the cell", () => {
    const farmland = Array.from({ length: 9 }, (_, i) => ({ ground: "farmland", row: 4 + Math.floor(i / 3), col: 4 + (i % 3) }));
    const s = startOf(singlePlot({ ...layout([["wheat", 4, 3]], [["godseed", 4, 4]]), groundTiles: farmland }));
    const plot = structuredClone(s.plots[0]);
    const tip = (target: React.ComponentProps<typeof SimTooltip>["target"]) =>
      renderToString(<SimTooltip target={target} cellSize={40} gap={2} gridWidth={420} gridHeight={420} cycleSeconds={14400} config={s.scenario.settings.config} plot={plot} />).replace(/<!-- -->/g, "");

    // A Godseed on the 3x3: the card gains a check section for the hovered cell only when given one.
    const godseed = startOf(singlePlot({ ...layout([["wheat", 4, 3]]), groundTiles: farmland }));
    const gs = inject(godseed, 1, "godseed", 4, 4, "placed");
    const plain = tip({ kind: "plant", plant: gs });
    expect(plain).not.toContain("Sanity Check");
    const centre = sanityCheck(godseed, engine.data, 1, 5, 5);
    const withCheck = tip({ kind: "plant", plant: gs, check: centre });
    expect(withCheck).toContain("Sanity Check");
    expect(withCheck).toContain("row 5, col 5");
    expect(withCheck).toContain("stands here");
    expect(withCheck).toContain("once the cell is free");
    expect(withCheck).toContain("Lonelily");
    expect(withCheck).toContain(plain.slice(plain.indexOf("Type"), plain.indexOf("Gives"))); // the plant card itself is untouched

    // A slot card hovered at an inner cell names that cell and notes it is not the anchor.
    const slot = plot.slots[0];
    const inner = sanityCheck(s, engine.data, 1, 5, 5);
    const slotHtml = tip({ kind: "slot", slot, ineligibleCycles: 0, check: inner });
    expect(slotHtml).toContain("Empty target cell.");
    expect(slotHtml).toContain("row 5, col 5");
    expect(slotHtml).toContain("not the target&#x27;s top-left (4, 4)");
    // The anchor itself needs no such note.
    expect(tip({ kind: "slot", slot, ineligibleCycles: 0, check: sanityCheck(s, engine.data, 1, 4, 4) })).not.toContain("not the target");
  });

  it("hoveredCellOffset maps the mouse to a cell of a multi-cell element (clamped, scale-aware)", () => {
    const rect = { left: 100, top: 50, width: 3 * 40 + 2 * 2, height: 3 * 40 + 2 * 2 }; // 3x3, cell 40, gap 2
    const at = (x: number, y: number) => hoveredCellOffset(x, y, rect, 3, 40, 2);
    expect(at(100, 50)).toEqual({ dr: 0, dc: 0 });
    expect(at(100 + 41, 50 + 85)).toEqual({ dr: 2, dc: 0 });
    expect(at(100 + 45, 50 + 45)).toEqual({ dr: 1, dc: 1 });
    expect(at(100 + 500, 50 - 20)).toEqual({ dr: 0, dc: 2 }); // clamped
    // Rendered at half scale: the same fractions land in the same cells.
    const half = { left: 0, top: 0, width: rect.width / 2, height: rect.height / 2 };
    expect(hoveredCellOffset(half.width - 1, half.height / 2, half, 3, 40, 2)).toEqual({ dr: 1, dc: 2 });
  });

  it("plantIconOf: a Turtlellini shows cracked after one Blastberry hit", () => {
    expect(plantIconOf({ kindId: "turtlellini", gate: {} })).toBe("turtlellini");
    expect(plantIconOf({ kindId: "turtlellini", gate: { exploded: 1 } })).toBe("cracked_turtlellini");
    expect(plantIconOf({ kindId: "shellfruit", gate: {} })).toBe("shellfruit");
    expect(plantIconOf({ kindId: "wheat", gate: { exploded: 1 } })).toBe("wheat");
  });

  it("describeEvent: decayExtended, and a decayed dead plant leaves nothing", () => {
    const at = { cycle: 1, plotId: 1, plantId: 1, row: 2, col: 3 };
    expect(describeEvent({ ...at, kind: "decayExtended", kindId: "wheat", mutatesRemaining: 3, combined: null })).toBe(
      "Wheat's decay timer ran out at (2,3) but it has 3 mutations left to help create - extended 24h"
    );
    expect(describeEvent({ ...at, kind: "decayExtended", kindId: "wheat", mutatesRemaining: -1, combined: 5 })).toContain("shared pool");
    expect(describeEvent({ ...at, kind: "decayed", kindId: "dead_plant" })).toBe("Dead Plant decayed at (2,3)");
    expect(describeEvent({ ...at, kind: "decayed", kindId: "wheat" })).toBe("Wheat decayed at (2,3) and left a Dead Plant");
    expect(describeEvent({ ...at, kind: "decayed", kindId: "zombud", drops: { zombud: 3 }, coinValue: 0 })).toContain(
      "3 adjacent Dead Plants became Zombud mobs"
    );
  });

  it("the outcomes list counts decay extensions, and tolerates a summary without them", () => {
    const summary = { ...state.summary, extended: { wheat: 3 } };
    const html = wrap(<SustainabilityPanel report={view.snapshot!.report} summary={summary} />).replace(/<!-- -->/g, "");
    expect(html).toContain("decay timers extended (minimum not met)");
    const old: Partial<typeof state.summary> = { ...state.summary };
    delete old.extended;
    expect(() => wrap(<SustainabilityPanel report={view.snapshot!.report} summary={old as typeof state.summary} />)).not.toThrow();
  });

  it("placed items and losses are separate disclosures, collapsed by default", () => {
    const report = view.snapshot!.report;
    const watched = report.items.filter((item) => item.consumed > 0 || item.shortfall > 0);
    expect(watched.length).toBeGreaterThan(0);
    const summary = { ...state.summary, extended: { wheat: 3 } };
    const html = wrap(<SustainabilityPanel report={report} summary={summary} />).replace(/<!-- -->/g, "");
    const disclosures = [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)];

    expect(disclosures).toHaveLength(2);
    for (const [attributes, content] of disclosures.map((match) => [match[1], match[2]])) {
      expect(attributes).not.toMatch(/\bopen(?:\s|=|$)/);
      expect(content).toMatch(/^<summary\b[^>]*>/);
      expect(content).toContain("group-open:rotate-180"); // the chevron turns when it opens
    }
    expect(disclosures[0][2]).toMatch(/<summary\b[^>]*><span[^>]*>Placed items<\/span>/);
    expect(disclosures[0][2]).toContain(">Used</th>");
    expect(disclosures[0][2]).not.toContain("decay timers extended");
    expect(disclosures[1][2]).toMatch(/<summary\b[^>]*><span[^>]*>Losses, halts and decay extensions<\/span>/);
    expect(disclosures[1][2]).toMatch(/>3<\/span> Wheat <span[^>]*>decay timers extended \(minimum not met\)/);
  });

  it("empty sustainability detail sections stay hidden", () => {
    const report = { ...view.snapshot!.report, items: [] };
    const summary = { ...state.summary, decayed: {}, destroyed: {}, extended: {}, driedOut: {} };
    const html = wrap(<SustainabilityPanel report={report} summary={summary} />);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Placed items");
    expect(html).not.toContain("Losses, halts and decay extensions");
  });

  it("the Advanced tab counts the settings changed from their defaults", () => {
    const tuned = structuredClone(sc);
    tuned.settings.config.waterLossMin = 2;
    tuned.settings.config.armorRareCropBug = false;
    const html = wrap(<SettingsPanel scenario={tuned} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Advanced (2)"); // one per changed setting
    const plain = wrap(<SettingsPanel scenario={sc} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(plain).toContain("Advanced");
    expect(plain).not.toMatch(/Advanced \(\d+\)/);
  });
  it("the Online tab's aloe preview lists when the player harvests, per session", () => {
    const at = (activity: typeof sc.settings.activity, config = {}) => {
      const s = structuredClone(sc);
      s.settings.activity = activity;
      s.settings.playerStats.startTimeOfDay = 0;
      s.settings.config = { ...s.settings.config, ...config };
      return wrap(<AloeHarvestPreview settings={s.settings} liveCycleSeconds={7200} />).replace(/<!-- -->/g, "");
    };
    expect(at({ kind: "everyN", n: 4, offset: 0 })).toContain("harvested at <span class=\"text-emerald-300\">stage 12</span>");
    const windows = at({ kind: "windows", windows: [{ from: 8, to: 14 }] });
    // 2h cycles, online 08:00-14:00: sessions at 08 and 10 are next online in 1 cycle, the 12:00 one in
    // 10 cycles (20h). One row per harvest stage, highest first.
    const rows = [...windows.matchAll(/<tr><td[^>]*>stage (\d+)\+<\/td><td>(.*?)<\/td><\/tr>/g)].map((m) => [Number(m[1]), m[2].replace(/<[^>]+>/g, "")]);
    expect(rows).toEqual([
      [14, "1 cycle"],
      [rows[1]?.[0], "10 cycles (20h 0m)"],
    ]);
    expect(rows[1][0]).toBeLessThan(14);
    expect(at({ kind: "everyN", n: 1, offset: 0 }, { aloeAutoHarvest: false, aloeHarvestStage: 11 })).toContain("always harvested at stage 11");
  });
  it("the legend omits freezing and does not promise eligibility before evaluation", () => {
    const html = renderToString(<PlotMarkLegend />);
    expect(html).not.toMatch(/frozen|freeze/i);
    expect(html).toContain("ready or not yet evaluated");
    expect(html).toContain("checked target blocked by something else");
    expect(html).toContain("checked target standing there dried out (halted");
  });

  it("the legend highlights the entries drawn on the hovered element", () => {
    const plain = renderToString(<PlotMarkLegend />);
    expect(plain).not.toContain("data-active");
    expect(plain).not.toContain("opacity-40");
    const lit = renderToString(<PlotMarkLegend highlight={["indicator:spawn", "mark:harvested"]} />);
    expect(lit.match(/data-active/g)).toHaveLength(2);
    expect(lit).toContain("opacity-40");
  });

  it("hover cards explain the grid icons on the hovered element with the legend's wording", () => {
    const s = startOf(singlePlot(layout([["wheat", 4, 3]], [["chloronite", 1, 1]])));
    const plot = s.plots[0];
    const tip = (target: React.ComponentProps<typeof SimTooltip>["target"], markers?: React.ComponentProps<typeof SimTooltip>["markers"]) =>
      renderToString(<SimTooltip target={target} cellSize={40} gap={2} gridWidth={420} gridHeight={420} cycleSeconds={14400} config={s.scenario.settings.config} plot={plot} markers={markers} />).replace(/<!-- -->/g, "");
    const slot = { kind: "slot" as const, slot: plot.slots[0], ineligibleCycles: 0, watched: true, watchStatus: "blocked" as const };
    expect(tip(slot)).not.toContain("On the grid");
    const html = tip(slot, [{ indicator: "slotBlocked" }, { mark: "harvested", label: "harvested (last cycle)" }]);
    expect(html).toContain("On the grid");
    expect(html).toContain("checked target blocked by something else"); // same text as the legend
    expect(renderToString(<PlotMarkLegend />)).toContain("checked target blocked by something else");
    expect(html).toContain("✦");
    expect(html).toContain("harvested (last cycle)");
  });

  it("the frequency panel waits for Compute before simulating", () => {
    const text = wrap(<FrequencyPanel scenario={sc} />).replace(/<!-- -->/g, "");
    expect(text).toContain("Profit by online frequency");
    expect(text).toContain("Compute");
    expect(text).toContain("21 runs (7 frequencies × 3 seeds)");
  });

  it("report panels", () => {
    const html = wrap(
      <>
        <MoneyPanel summary={state.summary} previous={before.summary} />
        <SustainabilityPanel report={view.snapshot!.report} summary={state.summary} />
        <InventoryTable state={state} />
        <InventoryTable state={view.snapshot!.state} onAddItems={() => {}} startingInventory={{ chloronite: 3 }} onStartingInventoryChange={() => {}} />
        <InventoryTable state={start.state} onAddItems={() => {}} startingInventory={{ chloronite: 3 }} onStartingInventoryChange={() => {}} />
      </>
    );
    expect(html).toContain("Profit");
    expect(html).toContain("Started with");
    expect(html).toContain("This is what you start with");
    expect(html).toContain("Sustainab");
  });

  it("the effort panel shows per-login effort and its breakdown, or waits for the first login", () => {
    const html = wrap(<EffortPanel summary={state.summary} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Effort");
    expect(html).toContain("avg per login");
    expect(html).toContain("heaviest login");
    expect(html).toContain(`${formatCount(state.summary.effort!.sessions)} logins`);
    expect(html).toContain("Harvests");
    expect(html).toContain("Effort by action, per login");
    expect(html).not.toMatch(/emerald|amber|orange/); // one slate ramp
    const empty = wrap(<EffortPanel summary={start.state.summary} />);
    expect(empty).toContain("No logins yet");
  });

  it("ironman inventory: one row per item, made from the ledger in Total, net and NPC values, no Bazaar", () => {
    const html = wrap(<InventoryTable state={state} onAddItems={() => {}} startingInventory={{}} onStartingInventoryChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain(">Inventory</h3>");
    expect(html).not.toMatch(/Bazaar|Instant buy|reserve|Edit prices/);
    // The totals sit in the card header as one line, not as summary cards.
    expect(html).toMatch(/aria-label="Totals"[^]*mutations net[^]*shortfall/);
    expect(html).toContain(">net</span>");
    expect(html).toContain(">NPC</span>");
    const table = html.slice(html.indexOf('data-testid="inventory-items"'));
    // Every item at most once, and Total shows what the run made (not only what is held). The most
    // valuable crop is in its section's first 5 rows.
    const made = Object.entries(state.ledger).filter(([, row]) => row.produced > 0);
    expect(made.length).toBeGreaterThan(0);
    for (const [id] of made) expect(table.split(`>${nameOf(id)}</span>`).length - 1).toBeLessThanOrEqual(1);
    const npc = (id: string) => defaultGameData().crops[id]?.sellPrice ?? 0;
    const [topCrop, topRow] = made.filter(([id]) => npc(id) > 0).sort((a, b) => b[1].produced * npc(b[0]) - a[1].produced * npc(a[0]))[0];
    expect(table).toContain(`>${nameOf(topCrop)}</span>`);
    expect(table).toContain(formatCount(topRow.produced));
    // Mutations have no NPC price: their section says so instead of "made worth 0", unless Dead Plants
    // (listed with the mutations, NPC-sellable) were made.
    const mutationMade = made.some(([id]) => defaultGameData().mutations[id]);
    if (mutationMade && !state.ledger.dead_plant?.produced) expect(table).toContain("no NPC price");
    if (state.ledger.dead_plant?.produced) expect(table).toMatch(/Mutations<\/span>.*?made worth/);
  });

  it("inventory sections over 5 rows scroll (every row rendered, columns kept by a subgrid); problems sort first", () => {
    const data = defaultGameData();
    // 8 mutations held, 2 base crops: Mutations scrolls, Crops does not.
    const muts = data.mutationIds.slice(0, 8);
    const inventory = Object.fromEntries([...muts.map((id) => [id, 3]), ["wheat", 4], ["carrot", 2]]);
    const s = startOf(singlePlot(layout(), { inventory }));
    // One mutation went into debt: it must be listed first, visible without scrolling.
    const debtor = muts[7];
    s.inventory[debtor] = -2;
    const html = wrap(<InventoryTable state={s} />).replace(/<!-- -->/g, "");
    const section = (key: string) => {
      const start = html.indexOf(`data-section="${key}"`);
      const tag = html.lastIndexOf("<div", start);
      return { tag: html.slice(tag, html.indexOf(">", start) + 1), body: html.slice(start, html.indexOf('data-section="', start + 20) >>> 0 || undefined) };
    };
    const mut = section("mutation");
    for (const id of muts) expect(mut.body).toContain(`>${nameOf(id)}</span>`); // all rendered, none hidden
    expect(mut.body.indexOf(`>${nameOf(debtor)}</span>`)).toBe(Math.min(...muts.map((id) => mut.body.indexOf(`>${nameOf(id)}</span>`))));
    expect(mut.tag).toContain("overflow-y-auto");
    expect(mut.tag).toContain("grid-cols-subgrid");
    expect(mut.tag).toContain("max-height:10.5rem");
    expect(html).toContain("8 · scroll for more");
    const crop = section("crop");
    expect(crop.tag).not.toContain("overflow-y-auto"); // only 2: no scroll box
    expect(html).not.toMatch(/Show \d+ more|Show fewer/);
  });

  it("inventory sections collapse: rare crops and other drops start collapsed; Dead Plants list under mutations", () => {
    const data = defaultGameData();
    const inventory = { [data.mutationIds[0]]: 2, wheat: 4, dead_plant: 3, fermento: 1, cropie: 1 };
    const html = wrap(<InventoryTable state={startOf(singlePlot(layout(), { inventory }))} />).replace(/<!-- -->/g, "");
    const mut = html.slice(html.indexOf('data-section="mutation"'), html.indexOf('data-section="crop"'));
    expect(mut).toContain(">Dead Plant</span>");
    expect(html).toMatch(/aria-expanded="true"[^>]*data-section-toggle="mutation"/);
    expect(html).toMatch(/aria-expanded="true"[^>]*data-section-toggle="crop"/);
    expect(html).toMatch(/aria-expanded="false"[^>]*data-section-toggle="rareCrop"/);
    // Collapsed: the header (with its count) shows, the rows do not.
    expect(html).not.toContain('data-section="rareCrop"');
    expect(html).not.toContain(">Fermento</span>");
  });

  it("normal profile: Bazaar money, prices, reserve and the run bar profit render from counts and quotes", () => {
    const normalSc = { ...sc, settings: { ...sc.settings, profile: "normal" as const } };
    const s0 = engine.initState(normalSc).state;
    const r = engine.run(s0, 60);
    expect(r.summary.market).toBeDefined();
    const quotes = Object.fromEntries(
      [...Object.keys(r.summary.market!.produced), ...Object.keys(r.summary.market!.built), "chloronite", "magic_jellybean"].map((id) => [
        id,
        { lowestSellOffer: 1000, highestBuyOrder: 800 },
      ])
    );
    const pricing = { buy: "instant" as const, sell: "order" as const, taxPercent: 1 };
    const overrides = { chloronite: { highestBuyOrder: 50 } };
    const bazaar = {
      prices: { fetchedAt: 0, lastUpdated: 0, quotes },
      quotes: withOverrides(quotes, overrides),
      loading: false,
      error: null,
      refresh: () => {},
      pricing,
      setPricing: () => {},
      overrides,
      setOverrides: () => {},
    };
    const html = wrap(
      <>
        <BazaarMoneyPanel summary={r.summary} previous={s0.summary} quotes={quotes} pricing={pricing} cycleSeconds={r.state.lastCycleSeconds} />
        <InventoryTable state={r.state} bazaar={{ scenario: normalSc, view: bazaar, now: 90_000, onReserveChange: () => {} }} onAddItems={() => {}} />
        <PlotMarkLegend normalProfile />
      </>
    ).replace(/<!-- -->/g, "");
    expect(html).toMatch(/>Money<\/h3>[^]*?Bazaar prices/);
    expect(html).toContain("Stock used");
    expect(html).toContain("Cost to build (one-off)");
    expect(html).toContain("Mutations sold so far");
    expect(html).toContain("Inventory &amp; Bazaar");
    expect(html).toContain("Instant buy");
    expect(html).toContain("Sell order");
    expect(html).toMatch(/Prices <b[^>]*>1m ago<\/b>/);
    expect(html).toMatch(/Edit prices<span[^>]*>1 set<\/span>/);
    // The header's profit total is the Money panel's profit (same valuation, overrides applied).
    const cardProfit = bazaarProfit(r.summary, bazaar.quotes, pricing)!.profit;
    expect(html).toMatch(new RegExp(`>${formatCoins(cardProfit).replace(".", "\\.")}</b> profit<`));
    expect(html).toContain("Reserve of Chloronite");
    // Base crops show the double-compacted item's price (both sides), not one crop's.
    const wheatHtml = wrap(
      <InventoryTable
        state={startOf(singlePlot(layout(), { inventory: { wheat: 100 } }))}
        bazaar={{
          scenario: normalSc,
          view: { ...bazaar, quotes: { wheat: { lowestSellOffer: 200_000 / 25_600, highestBuyOrder: 190_000 / 25_600 } }, overrides: {} },
          now: 90_000,
          onReserveChange: () => {},
        }}
      />
    ).replace(/<!-- -->/g, "");
    expect(wheatHtml).toContain("per Enchanted Hay Bale");
    expect(wheatHtml).toContain(`>${formatCoins(200_000 * 0.99)}</span>`); // sell order, after tax, per Hay Bale
    expect(wheatHtml).toContain(`>${formatCoins(200_000)}</span>`); // instant buy, per Hay Bale
    expect(wheatHtml).toContain("One crop: 7.73 / 7.81");
    expect(html).toContain("bought on the Bazaar");
    expect(html).not.toContain("NaN");
    // One table: every item appears exactly once (no separate inventory and Bazaar lists).
    const table = html.slice(html.indexOf('data-testid="inventory-items"'));
    for (const name of ["Chloronite", "Wheat"]) expect(table.split(`>${name}</span>`).length - 1).toBeLessThanOrEqual(1);
    // Made in Total matches the ledger (not 0 while Per day shows a number).
    const madeWheat = r.state.ledger.wheat?.produced ?? 0;
    if (madeWheat > 0) expect(table).toContain(formatCount(madeWheat));
    // The price editor lists live prices as placeholders and your price in the box.
    const editor = wrap(<BazaarPricePanel bazaar={bazaar} focusItem="chloronite" itemIds={["chloronite", "wheat"]} onClose={() => {}} />).replace(/<!-- -->/g, "");
    expect(editor).toContain("Bazaar prices");
    expect(editor).toContain('value="50"');
    expect(editor).toContain("live 1.0k");
    expect(editor).toContain("Clear all (1)");
    // Without prices yet: no crash, a waiting line.
    expect(wrap(<BazaarMoneyPanel summary={r.summary} previous={null} quotes={null} pricing={pricing} />)).toContain("Waiting for Bazaar prices");
    // Ironman: no Bazaar panel content and no Bazaar mark in the legend.
    expect(renderToString(<BazaarMoneyPanel summary={state.summary} previous={null} quotes={quotes} pricing={pricing} />)).toBe("");
    expect(renderToString(<PlotMarkLegend />)).not.toContain("Bazaar");
    // The run bar shows the Bazaar profit when a pricer is given.
    const v = bazaarProfit(r.summary, quotes, pricing)!;
    const bar = wrap(
      <KpiStrip view={{ ...view, snapshot: { state: r.state, report: engine.analyse(r.state) } }} plotCount={2} priceSummary={(s) => bazaarProfit(s, quotes, pricing)} />
    ).replace(/<!-- -->/g, "");
    expect(bar).toContain(formatCoins(v.profit));
    expect(priceAge(0, 30_000)).toBe("just now");
  });

  it("run controls, log and timeline", () => {
    const html = wrap(
      <>
        <CommandBar
          scenario={sc}
          onChange={() => {}}
          view={view}
          profile="ironman"
          onProfileChange={() => {}}
          onRun={() => {}}
          onStep={() => {}}
          onStepBack={() => {}}
          onUndo={() => {}}
          onStop={() => {}}
          onReset={() => {}}
          seed={1}
          onSeedChange={() => {}}
          changedSettings={0}
          onOpenSettings={() => {}}
          problems={[]}
          shareMenu={() => null}
        />
        <KpiStrip view={view} plotCount={2} />
        <EventLog log={view.log} plotIds={[1, 2]} />
        <FlowTimeline flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} />
      </>
    );
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("Ran 1 cycle on 2 plots");
    expect(text).toContain("Reset");
    expect(text).toContain(`aria-label="Cycles to run"`);
    expect(text).toContain("Back");
    expect(text).toContain("Undo the step from cycle 40");
  });

  it("timeline uses accessible inspection tracks and bounded searchable plot legends", () => {
    const html = wrap(<FlowTimeline flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} />).replace(/<!-- -->/g, "");
    expect(html).toContain('aria-label="Plot 1 step timeline"');
    expect(html).toContain('aria-label="Timeline cycle range"');
    expect(html).toContain('aria-label="Search Plot 1 steps"');
    expect(html).toContain("Step timeline"); // the how-to moved into the card's InfoHint (closed in SSR)
    expect(html).toContain('aria-label="More info"');
    expect(html).toContain("max-h-52 overflow-y-auto");
    expect(html).toContain("Plot 1 steps");
    expect(html).not.toContain("<details open");
  });

  it("timeline shows each step's days and share of the whole run", () => {
    const html = wrap(<FlowTimeline flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} elapsedSeconds={state.elapsedSeconds} />).replace(/<!-- -->/g, "");
    expect(state.elapsedSeconds).toBeGreaterThan(0);
    expect(html).toContain('aria-label="Plot 1 time per step"');
    expect(html).toMatch(/\d+(\.\d)?%/);
    expect(html).toContain("of run");
    expect(html).not.toContain("NaN");
  });

  it("timeline renders initial and newly entered zero-cycle visits safely", () => {
    const initial = startOf(sc);
    const html = wrap(<FlowTimeline flows={initial.flows} defs={sc.plots} cycle={0} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Shared cycle clock · 0 cycles");
    expect(html).toContain('aria-valuenow="0"');
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("run controls after going back", () => {
    const rewound: SimulationView = { ...view, lastCall: null, rewound: { undone: { kind: "run", fromCycle: 0, cycles: 40 } } };
    const html = wrap(
      <KpiStrip view={rewound} plotCount={2} />
    );
    expect(html.replace(/<!-- -->/g, "")).toContain("Undid a run of 40 cycles");
  });

  it("scenario and settings panels", () => {
    const html = wrap(
      <>
        <ScenarioTab scenario={sc} onChange={() => {}} onEditFlow={() => {}} onDuplicate={() => {}} onRemove={() => {}} onLoadLayout={() => {}} issues={[]} warnings={[]} error={null} onExport={() => {}} onImport={() => {}} onSubmit={() => {}} />
        <SettingsPanel scenario={sc} onChange={() => {}} />
      </>
    );
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("Plot 1");
    expect(text).toContain("Export flows");
    expect(text).toContain("Submit to leaderboard");
  });

  describe("the flow editor", () => {
    const routed = scenario([
      flow(
        [
          step("s1", { code: LAYOUT_B_CODE }, [{ kind: "cycles", n: 2 }]),
          step("s2", { code: LAYOUT_A_CODE }, [], {
            exits: [
              { to: "s3", when: [{ kind: "stepVisits", count: 3, sinceStep: "s3" }] },
              {
                to: "s1",
                when: [{ kind: "group", match: "any", of: [{ kind: "cycles", n: 3 }, { kind: "inventoryBelow", item: "chloronite", qty: 4 }] }, { kind: "cycles", n: 1 }],
              },
              { to: "s2", checkOnEntry: true, when: [{ kind: "layoutShort" }] },
            ],
            policies: { replaceDecayed: false, gateInteractions: { clearRoots: false } },
          }),
          step("s3", { code: LAYOUT_B_CODE }, [], { exits: [{ when: [{ kind: "cycles", n: 5 }] }] }),
        ],
        false
      ),
    ]);
    // As the shell shows it: explicit targets everywhere except the finish exit on the last step.
    const plot = explicitExits(routed.plots[0]);
    const noop = () => {};
    const editor = (over: Partial<FlowEditorApi>, node: React.ReactNode) => {
      const api: FlowEditorApi = {
        scenario: { ...routed, plots: [plot] },
        plot,
        plotId: 1,
        selected: 1,
        select: noop,
        tab: "exits",
        setTab: noop,
        openExit: 1,
        setOpenExit: noop,
        hotExit: null,
        setHotExit: noop,
        edit: noop,
        editStep: noop,
        addStep: () => 0,
        deleteStep: noop,
        duplicateStep: noop,
        openAddMenu: noop,
        openLayout: noop,
        focusStep: noop,
        registerCanvas: noop,
        scripted: false,
        showAllWires: true,
        setShowAllWires: noop,
        ...over,
      };
      return wrap(<FlowEditorContext.Provider value={api}>{node}</FlowEditorContext.Provider>).replace(/<!-- -->/g, "");
    };
    const inspector = (tab: InspectorTab, over: Partial<FlowEditorApi> = {}) => editor({ tab, ...over }, <Inspector />);

    it("the exits tab: ordered exits with explicit targets, conditions as sentences", () => {
      const html = inspector("exits");
      expect(html).toContain("Step 2 of 3");
      expect(html).toContain("3. s3"); // exit 1 goes to step 3 (explicit target)
      expect(html).toContain("1. s1");
      expect(html).toContain("This step again (restart)");
      expect(html).toContain("OTHERWISE");
      expect(html).toContain("when entered 3+ times since 3. s3"); // collapsed exit 1
      // Exit 2 is open: ALL / ANY, the nested group and its sentences.
      expect(html).toContain("Take this exit when");
      expect(html).toContain(">ALL<");
      expect(html).toContain(">ANY<");
      expect(html).toContain("of this group");
      expect(html).toContain("cycles spent in this step");
      expect(html).toContain("in stock is below");
      expect(html).toContain("Also check on arrival");
      expect(html).toContain("also on arrival"); // exit 3, collapsed
    });

    it("a step-visits sentence names its step", () => {
      const html = inspector("exits", { openExit: 0 });
      expect(html).toContain("This step was entered");
      expect(html).toContain("entering 3. s3");
    });

    it("a finish exit on the last step of a non-looping flow", () => {
      const html = inspector("exits", { selected: 2, openExit: 0 });
      expect(html).toContain("Finish (hold this step)");
    });

    it("the checked targets and actions tabs", () => {
      expect(inspector("targets")).toContain("18 of 18 checked");
      const actions = inspector("actions");
      expect(actions).toContain("Overridden here");
      expect(actions).toContain("Re-place missing plants");
      expect(actions).toContain("Break Devourer roots");
      expect(actions).toContain("Inherited");
      expect(actions).toContain("harvest when fully grown"); // effective inherited value
    });

    it("the plot settings with no step selected", () => {
      const html = inspector("exits", { selected: null });
      expect(html).toContain("Plot 1 flow");
      expect(html).toContain("Start step");
      expect(html).toContain("Plot actions");
    });

    it("the phone step list shows every step with its exits", () => {
      const html = editor({}, <StepList onOpen={noop} onOpenPlot={noop} />);
      expect(html).toContain("Plot settings");
      expect(html).toContain("Steps · 3");
      expect(html).toContain("START");
      expect(html).toContain("3. s3</span><span class=\"text-slate-500\"> when </span>");
      expect(html).toContain("Finish (hold this step)");
    });
  });
  it("the layout picker: an incoming layout asks where it goes", () => {
    const incoming = { code: LAYOUT_A_CODE, name: "Chloronite x4", from: "calculator" as const };
    const html = wrap(<LayoutPickerPanel title="t" incoming={incoming} scenario={sc} onPlace={() => {}} onClose={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("From the Calculator");
    expect(html).toContain("Chloronite x4");
    expect(html).toContain("Where should it go?");
    expect(html).toContain("Add as Plot 3");
    expect(html).toContain("Next step of Plot 2");
    const one = wrap(<LayoutPickerPanel title="t" incoming={incoming} onUse={() => {}} useLabel="Replace this step&#x27;s layout" onClose={() => {}} />);
    expect(one).not.toContain("Where should it go?");
  });

  it("the uptime tree groups checked targets by plot, collapsed by default", () => {
    const report = view.snapshot!.report;
    expect(report.spots.length).toBeGreaterThan(0);
    expect(report.spots.every((s) => s.stepIndex >= 0)).toBe(true);
    const html = wrap(<UptimeTree spots={report.spots} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Plot 1");
    expect(html).toContain("Plot 2");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Step 1 · "); // steps stay hidden until a plot is expanded
    expect(html).toMatch(/>Blocked<\/span><span[^>]*>Halted<\/span>/); // its own column, next to blocked
  });

  it("the checked-target picker lists a layout's targets", () => {
    const html = wrap(<WatchPicker step={step("a", { code: LAYOUT_A_CODE })} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("18 of 18 checked");
    const some = wrap(<WatchPicker step={step("a", { code: LAYOUT_A_CODE }, [], { watch: [] })} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(some).toContain("0 of 18 checked");
  });
});
