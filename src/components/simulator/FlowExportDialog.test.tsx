import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlowExportPanel } from "./FlowExportDialog";

const render = () => renderToStaticMarkup(<FlowExportPanel onClose={() => undefined} onExport={() => undefined} />);

describe("flow export options", () => {
  it("defaults to the original flows-only export with optional setup unchecked", () => {
    const html = render();
    const checkboxes = html.match(/<input[^>]+type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(7);
    expect(checkboxes[0]).toContain('checked=""');
    expect(checkboxes[0]).toContain('disabled=""');
    for (const checkbox of checkboxes.slice(1)) expect(checkbox).not.toContain('checked=""');
    expect(html).toContain("Always included");
    expect(html).toContain("All plots, steps, layouts, exits, loops, checked targets, plot/step policy overrides, and the plot and controller scripts.");
  });

  it("explains each section, preserves omitted settings, and offers explicit download or cancel", () => {
    const html = render();
    for (const label of ["Starting inventory", "Player settings", "Online schedule", "Action defaults", "Advanced settings", "Random seed"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("not the live inventory");
    expect(html).toContain("starting time of day");
    expect(html).toContain("Anything left out stays unchanged.");
    expect(html).toContain("Download JSON");
    expect(html).toContain("Cancel");
    expect(html).toContain('aria-label="Close export dialog"');
  });
});
