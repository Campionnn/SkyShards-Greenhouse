import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { engine, flow, layout, scenario, start, step } from "../../../simulator/testHelpers";
import { ToastProvider } from "../../ui";
import { exportFlows, importFlows } from "../scenarioEdit";
import { ScriptDocs } from "./ScriptDocs";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptHaltBanner, ScriptPanel } from "./ScriptPanel";
import { getScript, setScript } from "./scriptEdit";

const spec = layout([["wheat", 4, 4]], [["chloronite", 5, 5]]);
const base = scenario([flow([step("a", spec)]), flow([step("a", spec)])]);
const sc = setScript(
  setScript(base, 1, { source: "let n = 0; let list = [1, { a: 2 }]; function onTick() { n++; log('tick', n); metric('n', n) }" }),
  "controller",
  { source: "shared.goal = 5" }
);

describe("script UI", () => {
  const state = engine.run(start(sc), 5).state;

  it("the scripts panel shows variables, metrics and the console", () => {
    const html = renderToString(<ScriptPanel scenario={sc} state={state} onEdit={() => {}} />);
    expect(html).toContain("Variables");
    expect(html).toContain("list");
    expect(html).toContain("goal");
    expect(html).toContain("tick 5");
    expect(html).toContain("Metrics");
  });

  it("without scripts it explains what they are for", () => {
    const html = renderToString(<ScriptPanel scenario={base} state={engine.run(start(base), 1).state} onEdit={() => {}} />);
    expect(html).toContain("No scripts in this scenario");
  });

  it("the editor and the reference render", () => {
    const html = renderToString(
      <ToastProvider>
        <ScriptEditor scenario={sc} target={1} onTargetChange={() => {}} onChange={() => {}} onClose={() => {}} />
      </ToastProvider>
    );
    expect(html).toContain("Controller");
    expect(html).toContain("Plot 2");
    expect(renderToString(<ScriptDocs kind="controller" />)).toContain("getPlot");
  });

  it("a halt shows a banner", () => {
    const bad = engine.run(start(setScript(base, 1, { source: "function onTick() { null.x }" })), 3).state;
    const html = renderToString(<ScriptHaltBanner halt={bad.scripts!.halt!} onEdit={() => {}} />);
    expect(html).toContain("Script error at cycle 0");
    expect(html).toContain("line 1");
  });

  it("scripts travel in flows files and setScript removes empty ones", () => {
    const file = exportFlows(sc);
    expect(file.script?.source).toContain("shared.goal");
    const back = importFlows(base, JSON.stringify(file));
    expect(getScript(back, 1)?.source).toContain("onTick");
    expect(getScript(back, "controller")?.source).toContain("goal");
    expect(getScript(setScript(sc, 1, { source: "  " }), 1)).toBeUndefined();
    // Files without scripts import exactly as before.
    const plain = importFlows(base, JSON.stringify(exportFlows(base)));
    expect(plain.plots[0]).not.toHaveProperty("script");
    expect(plain).not.toHaveProperty("script");
    expect(() => importFlows(base, JSON.stringify({ ...file, script: { source: 5 } }))).toThrow(/Controller script/);
  });
});
