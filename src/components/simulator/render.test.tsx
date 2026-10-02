import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GreenhouseDataProvider, InfoModalProvider } from "../../context";
import type { SimulationView } from "../../hooks/useSimulation";
import { engine, flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step } from "../../simulator/testHelpers";
import { ToastProvider } from "../ui";
import { PlotMarkLegend, PlotView } from "./PlotView";
import { LayoutPickerPanel } from "./LayoutPicker";
import { InventoryPanel, MoneyPanel, SustainabilityPanel, UptimeTree } from "./ReportPanels";
import { FlowEditor, WatchPicker } from "./FlowEditor";
import { EventLog, RunControls, FlowTimeline } from "./RunPanels";
import { KindDecayOverrides, ScenarioPanel, SettingsPanel } from "./ScenarioPanels";
import { SimTooltip } from "./SimTooltip";
import { describeEvent } from "./format";

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

  it("describeEvent: decayExtended, and a decayed dead plant leaves nothing", () => {
    const at = { cycle: 1, plotId: 1, plantId: 1, row: 2, col: 3 };
    expect(describeEvent({ ...at, kind: "decayExtended", kindId: "wheat", mutatesRemaining: 3, combined: null })).toBe(
      "Wheat's decay timer ran out at (2,3) but it has 3 mutations left to help create - extended 24h"
    );
    expect(describeEvent({ ...at, kind: "decayExtended", kindId: "wheat", mutatesRemaining: -1, combined: 5 })).toContain("shared pool");
    expect(describeEvent({ ...at, kind: "decayed", kindId: "dead_plant" })).toBe("Dead Plant decayed at (2,3)");
    expect(describeEvent({ ...at, kind: "decayed", kindId: "wheat" })).toBe("Wheat decayed at (2,3) and left a Dead Plant");
  });

  it("the outcomes list counts decay extensions, and tolerates a summary without them", () => {
    const summary = { ...state.summary, extended: { wheat: 3 } };
    const html = wrap(<SustainabilityPanel report={view.snapshot!.report} summary={summary} />).replace(/<!-- -->/g, "");
    expect(html).toContain("decay timers extended (minimum not met)");
    const old: Partial<typeof state.summary> = { ...state.summary };
    delete old.extended;
    expect(() => wrap(<SustainabilityPanel report={view.snapshot!.report} summary={old as typeof state.summary} />)).not.toThrow();
  });

  it("the Advanced tab counts per-kind decay overrides", () => {
    const tuned = structuredClone(sc);
    tuned.settings.config.decayDaysOverrides = { wheat: 2 };
    tuned.settings.config.minimumMutationsOverrides = { wheat: 3, chloronite: "none" };
    const html = wrap(<SettingsPanel scenario={tuned} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Advanced (2)"); // one per kind overridden

    const table = wrap(<KindDecayOverrides config={tuned.settings.config} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(table).toContain("Decay per kind");
    expect(table).toContain("Wheat");
    expect(table).toContain("Chloronite");
    expect(table).toContain("Override"); // the add picker
    const empty = wrap(<KindDecayOverrides config={sc.settings.config} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(empty).toContain("Every kind uses the game data");
  });

  it("the legend omits freezing and does not promise eligibility before evaluation", () => {
    const html = renderToString(<PlotMarkLegend />);
    expect(html).not.toMatch(/frozen|freeze/i);
    expect(html).toContain("ready or not yet evaluated");
    expect(html).toContain("checked target blocked by something else");
    expect(html).toContain("checked target standing there dried out (halted");
  });

  it("report panels", () => {
    const html = wrap(
      <>
        <MoneyPanel summary={state.summary} previous={before.summary} />
        <SustainabilityPanel report={view.snapshot!.report} summary={state.summary} />
        <InventoryPanel state={state} />
        <InventoryPanel state={view.snapshot!.state} onAddItems={() => {}} startingInventory={{ chloronite: 3 }} onStartingInventoryChange={() => {}} />
        <InventoryPanel state={start.state} onAddItems={() => {}} startingInventory={{ chloronite: 3 }} onStartingInventoryChange={() => {}} />
      </>
    );
    expect(html).toContain("Profit");
    expect(html).toContain("Started with");
    expect(html).toContain("This is what you start with");
    expect(html).toContain("Sustainab");
  });

  it("run controls, log and timeline", () => {
    const html = wrap(
      <>
        <RunControls
          view={view}
          plotCount={2}
          onRun={() => {}}
          onStep={() => {}}
          onStepBack={() => {}}
          onUndo={() => {}}
          onStop={() => {}}
          onReset={() => {}}
          seed={1}
          onSeedChange={() => {}}
        />
        <EventLog log={view.log} plotIds={[1, 2]} />
        <FlowTimeline flows={state.flows} defs={state.scenario.plots} cycle={state.cycle} />
      </>
    );
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("Ran 1 cycle on 2 plot(s)");
    expect(text).toContain("Back");
    expect(text).toContain("Undo the step from cycle 40");
  });

  it("run controls after going back", () => {
    const rewound: SimulationView = { ...view, lastCall: null, rewound: { undone: { kind: "run", fromCycle: 0, cycles: 40 } } };
    const html = wrap(
      <RunControls
        view={rewound}
        plotCount={2}
        onRun={() => {}}
        onStep={() => {}}
        onStepBack={() => {}}
        onUndo={() => {}}
        onStop={() => {}}
        onReset={() => {}}
        seed={1}
        onSeedChange={() => {}}
      />
    );
    expect(html.replace(/<!-- -->/g, "")).toContain("Undid a run of 40 cycles");
  });

  it("scenario, settings and the flow editor (embedded designer)", () => {
    const html = wrap(
      <>
        <ScenarioPanel scenario={sc} onChange={() => {}} onEditFlow={() => {}} issues={[]} warnings={[]} error={null} />
        <SettingsPanel scenario={sc} onChange={() => {}} />
        <FlowEditor scenario={sc} plotId={1} onChange={() => {}} onClose={() => {}} />
      </>
    );
    expect(html.replace(/<!-- -->/g, "")).toContain("Plot 1 flow");
    expect(html).toContain("Leave this step when");
    expect(html).toContain("checked targets");
  });

  it("the flow editor with routes, a chosen next step and AND/OR groups", () => {
    const routed = scenario([
      flow(
        [
          step("s1", { code: LAYOUT_B_CODE }, [{ kind: "cycles", n: 2 }]),
          step("s2", { code: LAYOUT_B_CODE }, [{ kind: "group", match: "any", of: [{ kind: "cycles", n: 3 }, { kind: "inventoryBelow", item: "chloronite", qty: 4 }] }, { kind: "cycles", n: 1 }], {
            next: "s1",
            routes: [{ to: "s3", when: [{ kind: "stepVisits", count: 3, sinceStep: "s3" }] }],
          }),
          step("s3", { code: LAYOUT_B_CODE }, [{ kind: "cycles", n: 5 }], { next: "s1" }),
        ],
        false
      ),
    ]);
    const html = wrap(<FlowEditor scenario={routed} plotId={1} initialStep={1} onChange={() => {}} onClose={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Routes to other steps");
    expect(html).toContain("ANY (OR)");
    expect(html).toContain("then go to");
    expect(html).toContain("→ 3. s3 if entered this step 3+ times since 3. s3");
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
    expect(html).toContain(">halted</span>"); // its own column, next to blocked
  });

  it("the checked-target picker lists a layout's targets", () => {
    const html = wrap(<WatchPicker step={step("a", { code: LAYOUT_A_CODE })} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(html).toContain("18 of 18 checked");
    const some = wrap(<WatchPicker step={step("a", { code: LAYOUT_A_CODE }, [], { watch: [] })} onChange={() => {}} />).replace(/<!-- -->/g, "");
    expect(some).toContain("0 of 18 checked");
  });
});
