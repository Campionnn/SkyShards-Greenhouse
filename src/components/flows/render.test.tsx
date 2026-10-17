import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GreenhouseDataProvider } from "../../context";
import { flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step } from "../../simulator/testHelpers";
import { mockDetail, mockList } from "../../services/flowsMock";
import { AuthCallbackPage } from "../../pages/AuthCallbackPage";
import { FlowDetailView } from "../../pages/FlowDetailPage";
import { FlowsPage } from "../../pages/FlowsPage";
import { SubmitFlowPanel } from "../simulator/SubmitFlowDialog";
import { ToastProvider } from "../ui";
import { ReportPanel } from "./FlowDetailSections";
import { FlowMarkdown } from "./FlowMarkdown";

// Server-render the leaderboard pages and the submit dialog body with a fake fetch, to catch
// render-time errors. SSR runs no effects, so pages show their first (loading) state.

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const fetchMock = vi.fn(async () => new Response(JSON.stringify(await mockList("ironman", "max", 1)), { status: 200 }));
beforeAll(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => vi.unstubAllGlobals());

const wrap = (node: React.ReactNode) =>
  renderToString(
    <MemoryRouter>
      <ToastProvider>
        <GreenhouseDataProvider>{node}</GreenhouseDataProvider>
      </ToastProvider>
    </MemoryRouter>
  );
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe("leaderboard pages render", () => {
  it("/flows renders the controls and a loading state", () => {
    const html = text(wrap(<FlowsPage />));
    expect(html).toContain("Flow leaderboard");
    expect(html).toContain("Online every");
    expect(html).toContain("Stat tier");
    expect(html).toContain("Use my yield stats");
    expect(html).toContain("Search title or author");
    expect(html).toContain("Loading the leaderboard...");
  });

  it("/flows/:id renders every section from a full entry", async () => {
    const detail = (await mockDetail("mockChloro01"))!;
    const html = text(wrap(<FlowDetailView detail={detail} onChange={() => {}} onReload={() => {}} />));
    for (const s of ["Chloronite engine with wheat filler", "Open in simulator", "Copy link", "Profit by online frequency", "Forgiving:", "Items per day", "Starting layouts", "Per-seed results", "Effort per login"]) {
      expect(html).toContain(s);
    }
    // Restricted Markdown: headings and emphasis render; links are unwrapped to text.
    expect(html).toContain("<h3>How it works</h3>");
    expect(html).toContain("<strong>Chloronite</strong>");
    expect(html).not.toContain("<a href=\"https://example.com");
    expect(html).toContain("links are not rendered");
    // Logged out: no owner or report buttons.
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain(">Report<");
  });

  it("the auth callback without a fragment explains itself", () => {
    expect(text(wrap(<AuthCallbackPage />))).toContain("Nothing to do here");
  });

  it("the report dialog body", () => {
    const html = text(wrap(<ReportPanel id="x" onClose={() => {}} />));
    expect(html).toContain("Report this flow");
    expect(html).toContain("0 / 200");
  });

  it("FlowMarkdown drops images and raw HTML", () => {
    const html = renderToString(<FlowMarkdown text={"**hi** ![img](x.png) <b>raw</b> [l](https://x.y)"} />);
    expect(html).toContain("<strong>hi</strong>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<a ");
  });
});

describe("submit dialog renders", () => {
  const sc = scenario([LAYOUT_A_CODE, LAYOUT_B_CODE].map((code) => flow([step("a", { code }, [])])), { inventory: { chloronite: 3 } });

  it("shows login, the rules diff with Apply, the fields and the seed test button", () => {
    const html = text(wrap(<SubmitFlowPanel scenario={sc} onChange={() => {}} onClose={() => {}} />));
    expect(html).toContain("Submit to the leaderboard");
    expect(html).toContain("Log in with Discord");
    expect(html).toContain("Your 2 plots");
    expect(html).toContain("starting inventory is not empty");
    expect(html).toContain("Apply the rules here");
    expect(html).toContain("0 / 60");
    expect(html).toContain("0 / 2000");
    expect(html).toContain("Test with 5 random seeds");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Submit<\/button>/s);
  });

  it("lists checkSubmission errors", () => {
    const broken = scenario([flow([step("a", { code: LAYOUT_A_CODE }, [], { exits: [{ to: "nowhere", when: [{ kind: "cycles", n: 5 }] }] })])]);
    const html = text(wrap(<SubmitFlowPanel scenario={broken} onChange={() => {}} onClose={() => {}} />));
    expect(html).toContain('data-testid="submit-errors"');
  });
});
