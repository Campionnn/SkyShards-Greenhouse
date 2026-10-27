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
  initialState,
  parseFlows,
  runForecast,
  scriptKnobs,
  setFarm,
  summarise,
  toInput,
  type FlowsFile,
} from "../../guide";
import { FarmPicture } from "./FarmPicture";
import { PlotCard } from "./PlotCard";
import { ForecastStrip } from "./ForecastStrip";
import { formatDuration, scheduleText } from "./format";

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

describe("format", () => {
  it("formats durations and schedules", () => {
    expect(formatDuration(1392735)).toBe("16d 2h");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(0)).toBe("0m");
    expect(scheduleText(12, { kind: "everyN", n: 3, offset: 0 })).toBe("every 12 hours");
    expect(scheduleText(null, { kind: "windows", windows: [{ from: 18, to: 23 }] })).toBe("1 daily window");
  });
});
