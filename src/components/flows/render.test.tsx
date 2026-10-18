import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GreenhouseDataProvider } from "../../context";
import { flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step } from "../../simulator/testHelpers";
import { normalizeAdminRow } from "../../services/adminService";
import { mockAdminList, mockDetail, mockList } from "../../services/flowsMock";
import { AuthCallbackPage } from "../../pages/AuthCallbackPage";
import { FlowDetailView, ModerationBox } from "../../pages/FlowDetailPage";
import { AdminCards, AdminTable, FlowsAdminPage } from "../../pages/FlowsAdminPage";
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
  it("/flows renders the stats panel, sorting, filters and a loading state", () => {
    const html = text(wrap(<FlowsPage />));
    for (const s of ["Flow rankings", "Your stats", "How often you log in", "Crop Growth", "Farming Fortune", "Farming armor", "Scored at", "Profit per effort", "Most forgiving", "Search title or author", "Loading the rankings..."]) {
      expect(html).toContain(s);
    }
    expect(html).toContain('data-testid="tier-meter"');
  });

  it("/flows/:id renders every section from a full entry", async () => {
    const detail = (await mockDetail("mockChloro01"))!;
    const html = text(wrap(<FlowDetailView detail={detail} onChange={() => {}} onReload={() => {}} />));
    for (const s of ["Chloronite engine with wheat filler", "Open in simulator", "Copy link", "Profit by online frequency", "forgiving", "Where the money comes from", "The flow", "Plot 1", "Consistency across seeds", "Work per login", "Notes from the author", "Mutations / day", "Seed spread"]) {
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

describe("admin page renders", () => {
  it("locked: the admin key form", () => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    const html = text(wrap(<FlowsAdminPage />));
    expect(html).toContain("Leaderboard moderation");
    expect(html).toContain("Admin key");
    expect(html).toContain('type="password"');
    expect(html).toContain("Unlock");
    expect(html).not.toContain("Reported");
  });

  it("unlocked: filters, refresh, lock and the loading state", () => {
    const s = new MemoryStorage();
    s.setItem("skyshards-admin-key", "k");
    vi.stubGlobal("sessionStorage", s);
    const html = text(wrap(<FlowsAdminPage />));
    for (const label of ["All", "Reported", "Hidden", "Pending", "Rejected", "Live", "Refresh", "Lock", "Loading..."]) expect(html).toContain(label);
    expect(html).not.toContain("Unlock");
  });

  it("the table and cards show every column and the actions", async () => {
    const rows = (await mockAdminList()).entries.map(normalizeAdminRow);
    const html = text(wrap(<><AdminTable rows={rows} busy={null} act={() => {}} /><AdminCards rows={rows} busy={null} act={() => {}} /></>));
    for (const s of ["Chloronite engine with wheat filler", "FREE COINS click here", "by reports", "Rejected: Best seed", "Ironman + Normal", "990000000000000001", "Copied from my flow", "> Hide<", "> Unhide<", "> Delete<", "> Ban<", "> Unban<"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain('href="/flows/mockSpam0004"');
  });

  it("the detail page's moderation box", async () => {
    const detail = { ...(await mockDetail("mockAloe0002"))!, status: "hidden" as const, hidden: true, hiddenReason: "ban", reportCount: 2 };
    const html = text(wrap(<ModerationBox detail={detail} onReload={() => {}} />));
    for (const s of ["Moderation", "banned", "2 reports", "> Unhide<", "> Delete<"]) expect(html).toContain(s);
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
