import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GreenhouseDataProvider, InfoModalProvider } from "../../context";
import type { SimulationView } from "../../hooks/useSimulation";
import { engine, flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, stage } from "../../simulator/testHelpers";
import { ToastProvider } from "../ui";
import { PlotMarkLegend, PlotView } from "./PlotView";
import { InventoryPanel, MoneyPanel, SustainabilityPanel } from "./ReportPanels";
import { RotationEditor } from "./RotationEditor";
import { EventLog, RunControls, StageTimeline } from "./RunPanels";
import { ScenarioPanel, SettingsPanel } from "./ScenarioPanels";

// Server-render every simulator panel against a real simulation, to catch
// render-time errors (no browser needed).

const sc = scenario(
  [LAYOUT_A_CODE, LAYOUT_B_CODE].map((code, i) =>
    flow([stage("a", { code }, [{ kind: "cycles", n: 10 }]), stage("b", { code }, [])], i === 0)
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

  it("plots", () => {
    const html = wrap(
      <>
        {state.plots.map((p) => (
          <PlotView key={p.id} plot={p} runner={state.flows.find((f) => f.plotId === p.id)} def={state.scenario.plots.find((d) => d.id === p.id)} events={after.events} stageSeconds={state.lastStageSeconds} config={state.scenario.settings.config} />
        ))}
        <PlotMarkLegend />
      </>
    );
    // SSR puts a <!-- --> marker between adjacent text nodes.
    expect(html.replace(/<!-- -->/g, "")).toContain("Plot 1");
    expect(html).toContain("Stage");
  });

  it("report panels", () => {
    const html = wrap(
      <>
        <MoneyPanel summary={state.summary} previous={before.summary} />
        <SustainabilityPanel report={view.snapshot!.report} summary={state.summary} />
        <InventoryPanel state={state} />
      </>
    );
    expect(html).toContain("Profit");
    expect(html).toContain("Sustainab");
  });

  it("run controls, log and timeline", () => {
    const html = wrap(
      <>
        <RunControls view={view} plotCount={2} onRun={() => {}} onStep={() => {}} onStop={() => {}} onReset={() => {}} seed={1} onSeedChange={() => {}} />
        <EventLog log={view.log} plotIds={[1, 2]} />
        <StageTimeline flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} />
      </>
    );
    expect(html.replace(/<!-- -->/g, "")).toContain("Ran 1 cycle on 2 plot(s)");
  });

  it("scenario, settings and the rotation editor (embedded designer)", () => {
    const html = wrap(
      <>
        <ScenarioPanel scenario={sc} onChange={() => {}} onEditRotation={() => {}} issues={[]} warnings={[]} error={null} />
        <SettingsPanel scenario={sc} onChange={() => {}} />
        <RotationEditor scenario={sc} plotId={1} onChange={() => {}} onClose={() => {}} />
      </>
    );
    expect(html.replace(/<!-- -->/g, "")).toContain("Plot 1 rotation");
    expect(html).toContain("Leave this stage when");
  });
});
