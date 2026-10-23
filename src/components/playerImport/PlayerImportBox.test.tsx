import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerImportBox } from "./PlayerImportBox";

// SSR smoke test: SSR runs no effects or fetches, so only the first (empty) state renders.
describe("PlayerImportBox", () => {
  it("renders the username form", () => {
    const html = renderToString(<PlayerImportBox onImport={() => {}} compact />);
    expect(html).toContain("Minecraft username");
    expect(html).toContain("Import");
    expect(html).not.toMatch(/elite/i);
  });
});
