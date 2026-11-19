import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { GAME_TICK_PHASE_IDS, SESSION_PHASE_IDS } from "../../../simulator";
import { categoryOf, cleanStepBy, DEFAULT_STEP_BY, filterSummary, itemIds, onCount, withCategory, withItem } from "./stepBy";
import { StopPickerPanel } from "./StopPicker";

describe("step by", () => {
  it("lists every phase the engine runs, in its order", () => {
    expect(itemIds(categoryOf("tickPhase"))).toEqual(GAME_TICK_PHASE_IDS.map((p) => p.id));
    expect(itemIds(categoryOf("sessionPhase"))).toEqual(SESSION_PHASE_IDS.map((p) => p.id));
  });

  it("turning single items off and on, and the category with them", () => {
    let f = withCategory({ kinds: [] }, "tickPhase", true);
    expect(onCount(f, categoryOf("tickPhase"))).toBe(GAME_TICK_PHASE_IDS.length);
    f = withItem(f, "tickPhase", "effects", false);
    expect(f.off?.tickPhase).toEqual(["effects"]);
    expect(filterSummary(f)).toBe(`Game tick (${GAME_TICK_PHASE_IDS.length - 1} of ${GAME_TICK_PHASE_IDS.length})`);
    f = withItem(f, "tickPhase", "effects", true);
    expect(f.off).toBeUndefined();
    // Off one by one: the last one takes the category off; picking one item turns it back on.
    for (const id of itemIds(categoryOf("tickPhase"))) f = withItem(f, "tickPhase", id, false);
    expect(f.kinds).not.toContain("tickPhase");
    f = withItem(f, "tickPhase", "growth", true);
    expect(f.kinds).toContain("tickPhase");
    expect(onCount(f, categoryOf("tickPhase"))).toBe(1);
  });

  it("reads older saves and drops junk", () => {
    expect(cleanStepBy({ detail: true, kinds: ["tickPhase", "nope"] })).toEqual({ detail: true, filter: { kinds: ["tickPhase"] } });
    expect(cleanStepBy({ detail: true, filter: { kinds: ["scriptHook"], off: { scriptHook: ["onTick", 3] }, plots: [2, "x"], skipIdle: true } })).toEqual({
      detail: true,
      filter: { kinds: ["scriptHook"], off: { scriptHook: ["onTick"] }, plots: [2], skipIdle: true },
    });
    expect(cleanStepBy(null)).toEqual(DEFAULT_STEP_BY);
  });

  it("the picker renders every category, numbered phases and the plot row", () => {
    const html = renderToStaticMarkup(React.createElement(StopPickerPanel, { filter: { kinds: ["tickPhase"], off: { tickPhase: ["effects"] } }, onChange: () => {}, plotIds: [1, 2], large: false }));
    for (const label of ["Game tick", "Player session", "Player actions", "Script actions", "Script hooks", "All plots", "Plot 2", "Skip phases that changed nothing"]) expect(html).toContain(label);
    // The game tick is open (partly picked): its phases show, "Effects" not pressed.
    expect(html).toMatch(/aria-pressed="false"[^>]*>(<span[^>]*>\d+<\/span>)?Effects/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>(<span[^>]*>\d+<\/span>)?Destruction/);
  });
});
