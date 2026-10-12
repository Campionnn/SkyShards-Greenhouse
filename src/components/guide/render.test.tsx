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
const state = initialState(flow, defaultSettings());
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
      canUndo={false}
      onConfirm={noop}
      onUndo={noop}
      onPickFarm={noop}
      onEditFacts={noop}
      onOpenInventory={noop}
      {...overrides}
    />
  ));

describe("FarmPicture", () => {
  it("draws the real crops, ground and target cells of a layout", () => {
    const html = renderToString(<FarmPicture layout={farmOf(catalog, 1, "glasscorn").layout} nameOf={(id) => id} cellSize={20} />);
    expect(html).toContain("/greenhouse/crops/startlevine.png");
    expect(html).toContain("/greenhouse/crops/glasscorn.png");
    expect(html).toContain("/greenhouse/ground/");
    expect(html).toContain("border-dashed");
  });

  it("turns layout anchors into buttons in pick mode", () => {
    const html = renderToString(<FarmPicture layout={farmOf(catalog, 1, "glasscorn").layout} nameOf={(id) => id} cellSize={20} onPick={noop} />);
    expect(html).toContain("<button");
    expect(html).toContain("Target cell for glasscorn");
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
    expect(html).toContain("Not on Empty farmland?");
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
  }, 60_000);

  it("streams, fails and stalls honestly", () => {
    expect(strip({ forecast: null, plan: null, progress: { done: 3, total: 12 } })).toContain("3/12");
    expect(strip({ error: "boom" })).toContain("Forecast failed: boom");
    expect(strip({ forecast: { ...forecast, seconds: null, logins: null, completed: 0 } })).toContain("reached Done");
  });
});

describe("format", () => {
  it("formats durations and schedules", () => {
    expect(formatDuration(1392735)).toBe("16d 2h");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(0)).toBe("0m");
    expect(scheduleText({ kind: "everyN", n: 3, offset: 0 })).toBe("every 12 hours");
    expect(scheduleText({ kind: "windows", windows: [{ from: 18, to: 23 }] })).toBe("1 daily window");
  });
});
