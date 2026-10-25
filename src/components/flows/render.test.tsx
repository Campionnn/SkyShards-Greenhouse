import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GreenhouseDataProvider } from "../../context";
import { flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step } from "../../simulator/testHelpers";
import { normalizeAdminRow } from "../../services/adminService";
import { mockAdminList, mockDetail, mockList } from "../../services/flowsMock";
import { normalizeDetail } from "../../services/flowsService";
import { AuthCallbackPage } from "../../pages/AuthCallbackPage";
import { FlowDetailView, ModerationBox } from "../../pages/FlowDetailPage";
import { AdminCards, AdminTable, FlowsAdminPage } from "../../pages/FlowsAdminPage";
import { FlowRowItem, FlowsPage } from "../../pages/FlowsPage";
import { rankEntries, DEFAULT_FILTERS, type ViewSettings } from "../../leaderboard/view";
import type { Board } from "../../leaderboard/rules";
import { DEFAULT_BAZAAR_PRICING } from "../../simulator";
import { defaultGameData } from "../../simulator/data/default";
import { SubmitFlowPanel, type TestState } from "../simulator/SubmitFlowDialog";
import { SettingsPanel } from "../simulator/ScenarioPanels";
import { ToastProvider } from "../ui";
import { ReportPanel } from "./FlowDetailSections";
import { FilterBar, OwnedImportPanel } from "./FlowFilters";
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

const fetchMock = vi.fn(async () => new Response(JSON.stringify(await mockList("ironman_strict", "max", 1)), { status: 200 }));
beforeAll(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(() => vi.unstubAllGlobals());

const wrap = (node: React.ReactNode, url = "/") =>
  renderToString(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <GreenhouseDataProvider>{node}</GreenhouseDataProvider>
      </ToastProvider>
    </MemoryRouter>
  );
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const DATA = defaultGameData();

/** The ranked rows of the mock list on a board, rendered with the page's row component. */
async function renderRows(board: Board) {
  const list = await mockList(board, "max", 1);
  const s: ViewSettings = { board, quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false, now: Date.now() };
  const rows = rankEntries(DATA, list.entries, s, 1);
  const like = { liked: false, busy: false };
  return text(wrap(<ol>{rows.map((r, i) => <FlowRowItem key={r.entry.id} row={r} top={rows[0].profitPerDay ?? 0} every={1} board={board} index={i} like={like} sort="profit" />)}</ol>));
}

describe("leaderboard pages render", () => {
  it("/flows renders the stats panel, the three boards, sorting, filters and a loading state", () => {
    const html = text(wrap(<FlowsPage />));
    for (const s of ["Flow rankings", "Your stats", "How often you log in", "Crop Growth", "Farming Fortune", "Per-crop fortune", "Import from Hypixel", "Farming armor", "Scored at", "Profit per effort", "Most forgiving", "Steady rate", "Search flows, authors, crops", "Loading the rankings..."]) {
      expect(html).toContain(s);
    }
    for (const s of ["from nothing", "with starting items", "Normal", "Earning"]) expect(html).toContain(s);
    expect(html).toContain('data-testid="filter-bar"');
    expect(html).toContain('data-testid="tier-meter"');
    // "Least upkeep" and the starting-item filters only exist on the "with starting items" board.
    expect(html).not.toContain("Least upkeep");
    expect(html).not.toContain("No upkeep");
    // Friendly inputs: Bioanalysis is a dropdown of the accessories, the upgrades are tier lists.
    for (const s of ["Bioanalysis", "Artifact · +15%", "Talisman · +5%", "Tier 9 · +50%", "Evergreen Chip"]) expect(html).toContain(s);
  });

  it("/flows?board=ironman_borrow: the starting-item filters and the upkeep sort; ?board=ironman is from nothing", () => {
    const html = text(wrap(<FlowsPage />, "/flows?board=ironman_borrow&noUpkeep=1&maxStart=60"));
    for (const s of ["Least upkeep", "No upkeep", "Starting items", "≤ 60", "≤ 200", "I own the starting items", "already own the items"]) expect(html).toContain(s);
    expect(html).toMatch(/aria-pressed="true"[^>]*>No upkeep/);
    const old = text(wrap(<FlowsPage />, "/flows?board=ironman"));
    expect(old).toContain("A fresh ironman start");
    expect(old).not.toContain("I own the starting items");
  });

  it("ranking rows on 'from nothing': Kit chips (+% and 'needed'), Stall, Slowing", async () => {
    const html = await renderRows("ironman_strict");
    expect(html).toMatch(/Kit \+\d+%/);
    expect(html).toContain("Kit needed");
    expect(html).toContain("Makes nothing from scratch; with the starting items:");
    expect(html).toContain(">Stall<");
    // The ranking has no step labels: the step id names it.
    expect(html).toContain("Plot 1, step s-aloe: 34 Magic Jellybean cells empty on average.");
    expect(html).toContain(">Slowing<");
    expect(html).not.toMatch(/Infinity|NaN/);
    expect(html).not.toContain("starting items</span>");
  });

  it("ranking rows on 'with starting items': upkeep and the starting-item count with the items as a tooltip", async () => {
    const html = await renderRows("ironman_borrow");
    expect(html).toContain('data-testid="row-kit"');
    expect(html).toContain("92 Zombud + 91 Puffercloud /day");
    expect(html).toContain(">None<");
    expect(html).toContain("83,099 starting items");
    expect(html).toContain('title="83,099 items: 41,721 Zombud, 41,378 Puffercloud"');
    expect(html).toContain("No starting items");
    expect(html).not.toContain("Kit ");
  });

  it("ranking rows on Normal: no ironman parts; links keep the board", async () => {
    const html = await renderRows("normal");
    expect(html).toContain("coins / day");
    expect(html).not.toContain('data-testid="row-kit"');
    expect(html).not.toMatch(/Kit |>Stall</);
    expect(html).toContain('href="/flows/mockDevr0007?board=normal"');
  });

  it("the filter bar on each board, and the owned-items import", () => {
    const none = () => {};
    const strict = text(wrap(<FilterBar board="ironman_strict" filters={{ ...DEFAULT_FILTERS, earning: ["chorus_fruit"] }} earningOptions={["chorus_fruit"]} owned={null} onChange={none} onImportOwned={none} />));
    expect(strict).toContain("Chorus Fruit");
    expect(strict).toContain("top 3");
    expect(strict).toContain("Clear filters");
    expect(strict).not.toContain("No upkeep");
    const borrow = text(wrap(<FilterBar board="ironman_borrow" filters={DEFAULT_FILTERS} earningOptions={[]} owned={{ username: "Ke5o", profile: "Banana", items: { zombud: 3 }, at: 1 }} onChange={none} onImportOwned={none} />));
    for (const s of ["No upkeep", "Starting items", "Any", "I own the starting items", "Import your items again"]) expect(borrow).toContain(s);
    const panel = text(wrap(<OwnedImportPanel owned={{ username: "Ke5o", profile: "Banana", items: { zombud: 3 }, at: 1 }} onSave={none} onClose={none} />));
    for (const s of ["Items you own", "Minecraft username", "Look up", "Forget my items", "1 item types from Ke5o (Banana)"]) expect(panel).toContain(s);
  });

  it("/flows/:id renders every section from a full entry", async () => {
    const detail = normalizeDetail((await mockDetail("mockChloro01"))!);
    const html = text(wrap(<FlowDetailView detail={detail} onChange={() => {}} onReload={() => {}} />));
    for (const s of ["Chloronite engine with wheat filler", "Open in simulator", "Copy link", "Profit by online frequency", "forgiving", "What you earn", "Where it comes from", "Top earners", "The flow", "Plot 1", "Consistency across seeds", "Work per login", "Description", "Mutations / day", "Seed spread"]) {
      expect(html).toContain(s);
    }
    // Three numbers, one per board; the current (the default: from nothing) highlighted.
    expect(html).toContain('data-testid="board-numbers"');
    for (const s of ["Ironman · from nothing", "Ironman · with starting items", "Normal · Bazaar"]) expect(html).toContain(s);
    expect(html).toMatch(/aria-selected="true"[^>]*>.{0,400}Ironman · from nothing/s);
    expect(html).toContain("Layout complete after ~");
    expect(html).not.toMatch(/paid back|on credit|Infinity|NaN/i);
    // Restricted Markdown: headings and emphasis render; links are unwrapped to text.
    expect(html).toContain("<h3>How it works</h3>");
    expect(html).toContain("<strong>Chloronite</strong>");
    expect(html).not.toContain("<a href=\"https://example.com");
    expect(html).toContain("links are not rendered");
    // Logged out: no owner or report buttons.
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain(">Report<");
  });

  it("/flows/:id?board=ironman_borrow: What you need, upkeep, used up, returned each session", async () => {
    const devourer = normalizeDetail((await mockDetail("mockDevr0007"))!);
    const html = text(wrap(<FlowDetailView detail={devourer} onChange={() => {}} onReload={() => {}} />, "/flows/mockDevr0007?board=ironman_borrow"));
    expect(html).toContain('data-testid="what-you-need"');
    for (const s of ["What you need", "needs 41,721", "bring 52,152", "uses up", "Zombud once", "92</span> Zombud / day", "Upkeep per day"]) expect(html).toContain(s);
    // The current board is the highlighted number.
    expect(html).toMatch(/aria-selected="true"[^>]*>.{0,400}Ironman · with starting items/s);
    const aloe = normalizeDetail((await mockDetail("mockAloe0002"))!);
    const a = text(wrap(<FlowDetailView detail={aloe} onChange={() => {}} onReload={() => {}} />, "/flows/mockAloe0002?board=ironman_borrow"));
    expect(a).toContain("returned each session");
    expect(a).toContain("None: it gives back everything it borrows.");
  });

  it("/flows/:id on from nothing: Kit needed, Stall, Slowing, the empty-cells panel and an honest ramp line", async () => {
    const aloe = normalizeDetail((await mockDetail("mockAloe0002"))!);
    const html = text(wrap(<FlowDetailView detail={aloe} onChange={() => {}} onReload={() => {}} />, "/flows/mockAloe0002?board=ironman"));
    for (const s of ["Kit needed", ">Stall<", ">Slowing<", "Empty layout cells", "Plot 1, step 1 (All-in Aloe): 34 Magic Jellybean cells empty on average", "Layout never complete (some cells stay empty)"]) expect(html).toContain(s);
    expect(html).toContain('data-testid="empty-cells"');
    expect(html).not.toContain('data-testid="what-you-need"');
    // A flow with no empty cells hides the panel.
    const veil = normalizeDetail((await mockDetail("mockVeil0008"))!);
    expect(text(wrap(<FlowDetailView detail={veil} onChange={() => {}} onReload={() => {}} />))).not.toContain("Empty layout cells");
  });

  it("an old entry (pre-v2 'ironman' cells with payback fields) still renders", async () => {
    const d = (await mockDetail("mockGlass003"))!;
    const old = normalizeDetail({
      ...d,
      boards: ["ironman"] as unknown as typeof d.boards,
      cells: d.cells
        .filter((c) => c.runKind === "strict")
        .map((c) => {
          const old: Record<string, unknown> = { ...c, board: "ironman", median: { ...c.median, ramp: undefined, starved: undefined, peakDebt: { glasscorn: 1 }, paybackCycle: 120, solvent: true } };
          delete old.runKind;
          return old;
        }) as unknown as typeof d.cells,
      seeds: [],
    });
    const html = text(wrap(<FlowDetailView detail={old} onChange={() => {}} onReload={() => {}} />));
    expect(html).toContain("Glasscorn trio");
    expect(html).toContain("not verified yet");
    expect(html).not.toContain("Layout complete");
    expect(html).not.toMatch(/paid back/i);
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
    for (const s of ["Chloronite engine with wheat filler", "FREE COINS click here", "by reports", "Rejected: Best seed", "All boards", ">Ironman<", "990000000000000001", "Copied from my flow", "> Hide<", "> Unhide<", "> Delete<", "> Ban<", "> Unban<"]) {
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
    expect(html).toContain("Leave an empty line to start a new paragraph");
    expect(html).toContain("Test with 3 random seeds per board");
    expect(html).toContain("Normal too");
    expect(html).toContain("The score averages a secret window just after this length.");
    for (const s of ["Compare with", "From nothing", "With starting items"]) expect(html).toContain(s);
    // No board choice and no payback text any more.
    expect(html).not.toMatch(/Boards<|Pick at least one board|paid back|PAYBACK|on credit/i);
    // Logged out: the footer's action is the Discord login, not a disabled Submit.
    expect(html).toContain("Log in to submit");
    expect(html).toContain("kept while you log in");
    expect(html).not.toMatch(/>\s*Submit<\/button>/);
  });

  it("lists checkSubmission errors", () => {
    const broken = scenario([flow([step("a", { code: LAYOUT_A_CODE }, [], { exits: [{ to: "nowhere", when: [{ kind: "cycles", n: 5 }] }] })])]);
    const html = text(wrap(<SubmitFlowPanel scenario={broken} onChange={() => {}} onClose={() => {}} />));
    expect(html).toContain('data-testid="submit-errors"');
  });

  it("refuses forceEffects with the friendly message", () => {
    const forced = { ...sc, script: { source: "function onTick() { forceEffects('wheat', ['immunity']) }" } };
    const html = text(wrap(<SubmitFlowPanel scenario={forced} onChange={() => {}} onClose={() => {}} />));
    expect(html).toContain('data-testid="submit-errors"');
    expect(html).toContain("forceEffects() is a debugging tool");
  });

  it("the local test panels: numbers per board, spread, starting items, upkeep, used up, starved cells, seed errors", async () => {
    const list = async (b: Board) => (await mockList(b, "max", 1)).entries.find((e) => e.id === "mockDevr0007")!.cell!;
    const strict = await list("ironman_strict");
    const borrow = await list("ironman_borrow");
    const ok = (r: typeof strict) => ({ seed: 1, ok: true, error: null, result: r, wallMs: 1 });
    const initial: TestState = {
      running: false,
      every: 1,
      cycles: 2000,
      error: null,
      kinds: [
        { runKind: "strict", progress: [1, 1, 1], outcomes: [ok(strict), ok(strict), ok(strict)] },
        { runKind: "borrow", progress: [1, 1, 1], outcomes: [ok(borrow), ok(borrow), ok(borrow)] },
        { runKind: "normal", progress: [1, 1, 0.4], outcomes: [ok(strict), { seed: 2, ok: false, error: "script error: boom at cycle 12", result: null, wallMs: 1 }, undefined] },
      ],
    };
    const html = text(wrap(<SubmitFlowPanel scenario={sc} onChange={() => {}} onClose={() => {}} initialTest={initial} />));
    expect(html).toContain('data-testid="seed-test"');
    for (const k of ["strict", "borrow", "normal"]) expect(html).toContain(`data-testid="test-${k}"`);
    for (const s of [
      "Seed 2 failed: script error: boom at cycle 12",
      "A failed seed makes the server reject the submission.",
      "2/3 seeds",
      "Spread (best / median): 1.00×",
      "83,099 items: 41,721 Zombud, 41,378 Puffercloud",
      "92 Zombud + 91 Puffercloud /day",
      "Used up once: 41,721 Zombud, 41,378 Puffercloud",
      "Plot 1, step-1: 2.2 Zombud cells empty on average",
    ]) {
      expect(html).toContain(s);
    }
    expect(html).not.toMatch(/Infinity|NaN/);
  });
});

describe("simulator settings: the leaderboard rules", () => {
  it("the run-kind selector and the notes for setupFromStock and leaderboardRules (with a way to clear them)", () => {
    const base = scenario([flow([step("a", { code: LAYOUT_A_CODE }, [])])]);
    const ruled = { ...base, settings: { ...base.settings, config: { ...base.settings.config, freePlacedItems: ["dead_plant", "fermento"], setupFromStock: true, leaderboardRules: true } } };
    const html = text(wrap(<SettingsPanel scenario={ruled} onChange={() => {}} />));
    for (const s of ["Apply leaderboard rules", "From nothing", "With starting items", "Normal"]) expect(html).toContain(s);
    // The Advanced tab holds the notes; render the panel there.
    expect(html).toContain("Advanced (3)");
  });
});
