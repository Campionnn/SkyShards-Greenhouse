import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cleanManual } from "../../services/playerImport";
import { ManualSources } from "./ManualSources";
import { PlayerImportBox, PlayerImportPanel } from "./PlayerImportBox";

// SSR smoke tests: SSR runs no effects or fetches, so the box only renders its first (empty) state.
describe("PlayerImportBox", () => {
  it("is a compact button; the form lives in the modal panel", () => {
    const button = renderToString(<PlayerImportBox onImport={() => {}} compact />);
    expect(button).toContain("Import from Hypixel");
    expect(button).not.toContain("Minecraft username");
    const panel = renderToString(<PlayerImportPanel onImport={() => {}} />);
    expect(panel).toContain("Minecraft username");
    expect(panel).toContain("Import");
    expect(button + panel).not.toMatch(/elite/i);
  });

  it("renders the manual sources grouped, preset to max, with conditions", () => {
    const sources = cleanManual([
      { id: "rosewaterFlasks", label: "Rosewater Flasks", group: "permanent", input: "select", options: [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} · +${n}`, add: { farmingFortune: n } })), default: 5 },
      { id: "mooshroomStrength", label: "Mooshroom Strength", group: "permanent", input: "number", number: { min: 0, max: 1780, step: 10, unit: "Strength", rate: { farmingFortune: 0.035 }, floor: true }, default: 1780 },
      { id: "harvestHarbinger", label: "Harvest Harbinger", group: "temporary", condition: "Potion, 25 min", input: "select", options: [{ value: 0, label: "Off", add: {} }, { value: 1, label: "On", add: { farmingFortune: 50 } }], default: 1 },
    ]);
    expect(sources).toHaveLength(3);
    const atMax = renderToString(<ManualSources sources={sources} choices={{}} onChange={() => {}} onReset={() => {}} />);
    expect(atMax).toContain("Permanent");
    expect(atMax).toContain("Temporary");
    expect(atMax).not.toContain("Chips");
    expect(atMax).toContain("Potion, 25 min");
    expect(atMax).toContain("+62 FF");
    expect(atMax).not.toContain("Reset to max");
    const lowered = renderToString(<ManualSources sources={sources} choices={{ harvestHarbinger: 0 }} onChange={() => {}} onReset={() => {}} />);
    expect(lowered).toContain("Reset to max");
  });
});
