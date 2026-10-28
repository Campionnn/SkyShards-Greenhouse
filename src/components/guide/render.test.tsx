import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../simulator";
import {
  buildCatalog,
  buildPlan,
  createGuideEnv,
  decideLogin,
  farmOf,
  flowNeeds,
  initialState,
  parseFlows,
  runForecast,
  scriptKnobs,
  scriptPlan,
  setFarm,
  summarise,
  toInput,
  type FlowsFile,
} from "../../guide";
import { FarmPicture } from "./FarmPicture";
import { PlotCard } from "./PlotCard";
import { ForecastStrip } from "./ForecastStrip";
import { ImportDialog } from "./ImportDialog";
import { FlowNeedsPanel } from "./FlowNeeds";
import { HowTo } from "./HowTo";
import { formatDuration, scheduleText, timeAgo } from "./format";

// Server-render the Guide's panels against real decisions (no browser, no workers).

const guideEnv = createGuideEnv();
const data = guideEnv.engine.data;
const flow: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);
const knobs = scriptKnobs(flow);
// Enough Choconut + Ashwreath that Plot 1 goes to the (paid) Commons farm, not the free Choconut farm.
const state = initialState(flow, defaultSettings(), { dead_plant: 250, fermento: 50, ashwreath: 60, choconut: 120 });
const outcomes = decideLogin(flow, toInput(state), guideEnv);
const noop = () => {};
/** SSR text without React's <!-- --> separators and with entities decoded. */
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const card = (plotId: number, overrides: Partial<Parameters<typeof PlotCard>[0]> = {}) =>
  text(renderToString(
    <PlotCard
      plotId={plotId}
      plot={state.plots[plotId]}
      outcome={outcomes.find((o) => o.plotId === plotId) ?? null}
      catalog={catalog}
      data={data}
      knobs={knobs}
      next={plotId === 1}
      earlier={[]}
      zombudPerHarvest={0}
      canUndo={false}
      onConfirm={noop}
      onSkip={noop}
      onUndo={noop}
      onPickFarm={noop}
      onDevourerRefresh={noop}
      onOpenInventory={noop}
      {...overrides}
    />
  ));

describe("FarmPicture", () => {
  it("draws the real crops, ground and target cells of a layout", () => {
    const html = renderToString(<FarmPicture layout={farmOf(catalog, 1, "glasscorn").layout} nameOf={(id) => id} cellSize={20} />);
    expect(html).toContain("/greenhouse/crops/startlevine.png");
    expect(html).toContain("/greenhouse/crops/glasscorn.png");
    expect(html).toContain("data:image/png;base64"); // inlined ground texture
    expect(html).toContain("border-dashed");
  });

  it("names every crop and target cell for screen readers and hover cards", () => {
    const html = renderToString(<FarmPicture layout={farmOf(catalog, 1, "glasscorn").layout} nameOf={(id) => id} cellSize={20} />);
    expect(html).toContain('aria-label="Target: glasscorn"');
    expect(html).toContain('aria-label="startlevine"');
    expect(html).toContain("cursor-help");
    // Thumbnails have no hover cards.
    expect(renderToString(<FarmPicture layout={farmOf(catalog, 1, "glasscorn").layout} nameOf={(id) => id} cellSize={13} tooltips={false} />)).not.toContain("cursor-help");
  });
});

describe("PlotCard", () => {
  it("shows the destination farm, its cost and a per-plot confirmation", () => {
    const html = card(1);
    expect(html).toContain("Plot 1");
    expect(html).toContain("Next up");
    expect(html).toContain("Switch to Commons farm");
    expect(html).toContain("Place from your inventory");
    expect(html).toContain("Dead Plant");
    expect(html).toContain("Did it: Plot 1 is on Commons farm");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Now on Empty farmland");
    expect(html).toContain("Not right?");
    // The confirm button comes before the farm picture, so it never moves when sections below change.
    expect(html.indexOf("Did it: Plot 1")).toBeLessThan(html.indexOf("Place from your inventory"));
    expect(html.indexOf("Did it: Plot 1")).toBeLessThan(html.indexOf("data:image/png;base64"));
    expect(html).not.toContain("What's on the plot");
  });

  it("shows progress bars and tips when keeping a farm", () => {
    const jelly = setFarm(state, 2, "jelly");
    const [, plot2] = decideLogin(flow, toInput(jelly), guideEnv);
    const html = card(2, { plot: jelly.plots[2], outcome: plot2 });
    expect(html).toContain("Magic Jellybean");
    if (plot2.action === "stay") {
      expect(html).toContain("Done with Plot 2");
      expect(html).toContain("stage 12");
    }
  });

  it("shows a done plot with undo", () => {
    const html = card(1, { outcome: null, plot: { farm: "commons", acted: true }, canUndo: true });
    expect(html).toContain("Done this visit");
    expect(html).toContain("Undo");
  });

  it("says a done plot is set up and which plots are still to do", () => {
    const waiting = card(1, { outcome: null, plot: { farm: "commons", acted: true }, visitPlots: [1, 2, 3], checked: [1] });
    expect(waiting).toContain("Plot 1 is set up on Commons farm");
    expect(waiting).toContain("Waiting on Plots 2 and 3");
    const last = card(3, { outcome: null, plot: { farm: "commons", acted: true }, visitPlots: [1, 2, 3], checked: [1, 2, 3] });
    expect(last).toContain("Every plot is done for this visit");
  });

  it("tells you to press every plot's button", () => {
    const html = card(1, { visitPlots: [1, 2, 3] });
    expect(html).toContain("press all 3 to finish this visit");
    expect(html).toContain("Pressing takes the 8 Dead Plant off");
  });

  it("shows what a farm is working towards, with whole-flow totals, even on a switch", () => {
    const needs = flowNeeds(scriptPlan(flow)!, state.inventory);
    const html = card(1, { needs });
    expect(html).toContain("Switch to Commons farm");
    expect(html).toContain("Working towards");
    expect(html).toMatch(/Gloomgourd/);
    expect(html).toMatch(/Whole flow: 0 of ~\d+ covered/);
    // A done card shows the farm it stands on too.
    expect(card(1, { needs, outcome: null, plot: { farm: "commons", acted: true } })).toContain("Working towards");
  });
});

describe("FlowNeedsPanel", () => {
  it("sums the whole flow and lists items once opened", () => {
    const html = text(renderToString(<FlowNeedsPanel needs={flowNeeds(scriptPlan(flow)!, state.inventory)} catalog={catalog} data={data} />));
    expect(html).toMatch(/of ~[\d,]+ mutations covered/);
    expect(html).toContain("items done");
  });
});

describe("HowTo", () => {
  it("explains the three steps near the top, including pressing every plot's button", () => {
    const html = text(renderToString(<HowTo plotCount={3} loginOrder="Plot 1, then 2, then 3" />));
    expect(html).toContain("How to use this guide");
    expect(html).toContain("Press the button on all 3 cards");
    expect(html).not.toMatch(/\b(buy|bought|bazaar|shopping)\b/i);
  });
});

describe("ForecastStrip", () => {
  const runs = runForecast(flow, toInput(state), guideEnv, [1]);
  const forecast = summarise(runs, state.inventory);
  const plan = buildPlan(runs);
  const strip = (props: Partial<Parameters<typeof ForecastStrip>[0]>) =>
    text(renderToString(<ForecastStrip forecast={forecast} plan={plan} progress={null} error={null} catalog={catalog} data={data} outcomes={outcomes} onOpenSettings={noop} {...props} />));

  it("summarises time to Done and supplies on one line", () => {
    const html = strip({});
    expect(html).toContain("to Done");
    expect(html).toContain("Plan");
    // Dead Plants and Fermento are farmed, never bought.
    expect(html).not.toMatch(/bazaar|\bbuy\b|bought/i);
  }, 60_000);

  it("shows clearly that the forecast is still calculating", () => {
    const starting = strip({ forecast: null, plan: null, progress: { done: 0, total: 12 } });
    expect(starting).toContain("Calculating the forecast");
    expect(starting).toContain("Starting the simulations");
    expect(starting).toContain('role="progressbar"');
    const partial = strip({ progress: { done: 3, total: 12 } });
    expect(partial).toContain("Simulated 3 of 12 runs");
    expect(partial).toContain("Still calculating");
    expect(strip({})).not.toContain("Still calculating");
  });

  it("streams, fails and stalls honestly", () => {
    expect(strip({ error: "boom" })).toContain("Forecast failed: boom");
    expect(strip({ forecast: { ...forecast, seconds: null, logins: null, completed: 0 } })).toContain("reached Done");
  });
});

describe("ImportDialog", () => {
  it("asks for a username and names where it looks, never shopping words", () => {
    const html = text(renderToString(<ImportDialog open inventory={state.inventory} catalog={catalog} data={data} onApply={noop} onClose={noop} />));
    expect(html).toContain("Import from Hypixel");
    expect(html).toContain("Minecraft username");
    expect(html).toMatch(/sacks, ender chest, backpacks/);
    expect(html).not.toMatch(/\b(buy|bought|bazaar|shopping)\b/i);
    expect(renderToString(<ImportDialog open={false} inventory={state.inventory} catalog={catalog} data={data} onApply={noop} onClose={noop} />)).toBe("");
  });

  it("opens as Import again for the same player after a first import", () => {
    const lastImport = { username: "Ke5o", profileId: "p1", profileName: "Apple", fetchedAt: Date.now() - 600_000, appliedAt: Date.now() - 600_000, items: {} };
    const html = text(renderToString(<ImportDialog open inventory={state.inventory} catalog={catalog} data={data} lastImport={lastImport} onApply={noop} onClose={noop} />));
    expect(html).toContain("Import again from Hypixel");
    expect(html).toContain('value="Ke5o"');
  });
});

describe("format", () => {
  it("formats durations and schedules", () => {
    expect(formatDuration(1392735)).toBe("16d 2h");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(0)).toBe("0m");
    expect(scheduleText(12, { kind: "everyN", n: 3, offset: 0 })).toBe("every 12 hours");
    expect(scheduleText(null, { kind: "windows", windows: [{ from: 18, to: 23 }] })).toBe("1 daily window");
    expect(timeAgo(1_000, 20_000)).toBe("just now");
    expect(timeAgo(0, 4 * 60_000)).toBe("4 min ago");
    expect(timeAgo(0, 3 * 3_600_000)).toBe("3 h ago");
    expect(timeAgo(0, 2 * 86_400_000)).toBe("2 days ago");
  });
});
