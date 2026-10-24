import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatInput } from "./StatInput";
import { STAT_FIELDS } from "./statFields";

const noop = () => {};
const render = (key: keyof typeof STAT_FIELDS, value: number, variant?: "row" | "stacked") =>
  renderToStaticMarkup(<StatInput def={STAT_FIELDS[key]} value={value} onChange={noop} variant={variant} />);

/** The `<option>` elements of the markup, as { value, label, selected }. */
function options(html: string) {
  return [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, label]) => ({
    value: /value="([^"]*)"/.exec(attrs)?.[1],
    label: label.replace(/&amp;/g, "&"),
    selected: /selected=""/.test(attrs),
  }));
}
const selected = (html: string) => options(html).filter((o) => o.selected).map((o) => o.label);

describe("StatInput", () => {
  it("select: shows the game choices and selects the stored value", () => {
    const html = render("mutationChanceBonus", 0.1);
    expect(options(html).map((o) => o.label)).toEqual(["None", "Talisman · +5%", "Ring · +10%", "Artifact · +15%"]);
    expect(selected(html)).toEqual(["Ring · +10%"]);
    expect(html).toContain("Bioanalysis");
    expect(html).not.toContain("Custom");
  });

  it("select: a value that matches no choice is kept as Custom, not snapped to the nearest", () => {
    const html = render("mutationChanceBonus", 0.12);
    expect(selected(html)).toEqual(["Custom (0.12)"]);
    expect(options(html)[0]).toMatchObject({ value: "custom", label: "Custom (0.12)" });
  });

  it("select: tiers and levels use their own labels", () => {
    expect(selected(render("growthUpgradeTier", 9))).toEqual(["Tier 9 · +50%"]);
    expect(selected(render("plantYieldUpgrade", 0.2))).toEqual(["Tier 10 · +20%"]);
    expect(selected(render("floraShard", 0))).toEqual(["None"]);
    expect(selected(render("floraShard", 10))).toEqual(["Level 10 · +10 unique"]);
  });

  it("chip: shows rarity and level for a value a chip can reach, with the resulting bonus", () => {
    const html = render("evergreenChip", 0.6);
    expect(selected(html)).toEqual(["Legendary", "Level 20"]);
    expect(html).toContain("+60%");
    expect(html).toContain('aria-label="Evergreen Chip rarity"');
    expect(html).toContain('aria-label="Evergreen Chip level"');
    // Legendary goes to level 20 (plus "No chip").
    expect(options(html).filter((o) => /^Level |^No chip/.test(o.label))).toHaveLength(21);
  });

  it("chip: picks the rarity that reaches the value exactly", () => {
    const epic = render("evergreenChip", 0.375);
    expect(selected(epic)).toEqual(["Epic", "Level 15"]);
    expect(epic).toContain("+37.5%");
    // 0.2 = Rare 10 = Epic 8 = no Legendary level: the highest rarity that hits it wins.
    expect(selected(render("evergreenChip", 0.2))).toEqual(["Epic", "Level 8"]);
    expect(selected(render("evergreenChip", 0.02))).toEqual(["Rare", "Level 1"]);
  });

  it("chip: zero is No chip; an unreachable value is kept as Custom", () => {
    expect(selected(render("evergreenChip", 0))).toEqual(["Legendary", "No chip"]);
    const custom = render("evergreenChip", 0.47);
    expect(selected(custom)).toEqual(["Custom", "Custom"]);
    expect(custom).toContain("+47%");
  });

  it("number: renders a number input with the stat's range", () => {
    const html = render("farmingFortune", 1234);
    expect(html).toContain('type="number"');
    expect(html).toContain('value="1234"');
    expect(html).toContain('max="4000"');
    expect(html).toContain("Farming Fortune");
  });

  it("labels are tied to their control, in both variants", () => {
    for (const variant of ["row", "stacked"] as const) {
      const html = render("farmingFortune", 0, variant);
      const forId = /<label for="([^"]+)"/.exec(html)?.[1];
      expect(forId).toBeTruthy();
      expect(html).toContain(`id="${forId}"`);
    }
    expect(render("farmingFortune", 0, "stacked")).toContain("w-full");
  });
});
