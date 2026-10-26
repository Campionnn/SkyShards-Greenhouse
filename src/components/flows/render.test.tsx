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
import { CantStartSection, FlowRowItem, FlowsPage } from "../../pages/FlowsPage";
import { DEFAULT_FILTERS, maxProfit, rankEntries, splitRanked, type ViewSettings } from "../../leaderboard/view";
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

/**
 * The mock list on a board, rendered like the page: ranked rows with the page's row component,
 * then (from nothing) the open "Can't start" section. `ranked` / `blocked` are the split rows.
 */
async function renderRows(board: Board) {
  const list = await mockList(board, "max", 1);
  const s: ViewSettings = { board, quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false, now: Date.now() };
  const { ranked, cantStart } = splitRanked(rankEntries(DATA, list.entries, s, 1));
  const like = { liked: false, busy: false };
  const top = maxProfit(ranked);
  const ranks = text(wrap(<ol>{ranked.map((r, i) => <FlowRowItem key={r.entry.id} row={r} top={top} every={1} board={board} index={i} like={like} sort="profit" />)}</ol>));
  const section = cantStart.length ? text(wrap(<CantStartSection rows={cantStart} onSwitch={() => {}} defaultOpen />)) : "";
  return { html: ranks + section, ranks, section, ranked, blocked: cantStart };
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

  it("ranking rows on 'from nothing': Kit +N% and Stall on ranked rows; flows that can't start are set apart", async () => {
    const r = await renderRows("ironman_strict");
    // 7 mock flows: Devourer and the aloe flow can't start from nothing; the other 5 are ranked 1-5.
    expect(r.ranked.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.blocked.map((x) => x.entry.id).sort()).toEqual(["mockAloe0002", "mockDevr0007"]);
    expect(r.blocked.every((x) => x.rank === 0)).toBe(true);
    expect(r.ranks).not.toContain("Devourer root farm");
    expect(r.ranks).toMatch(/Kit \+\d+%/);
    expect(r.ranks).toContain(">Stall<");
    // The ranking has no step labels: the step id names it.
    expect(r.ranks).toContain("Plot 3, step-1: 5.6 Magic Jellybean cells empty on average.");
    expect(r.html).not.toMatch(/Infinity|NaN/);
    // The set-apart section: its count, the explanation, each row's reason and a way to the other board.
    expect(r.section).toContain('data-testid="cant-start-section"');
    expect(r.section).toContain("Can't start from nothing (2)");
    expect(r.section).toContain("These flows place items they never grow, so a fresh ironman can't run them. They are ranked on");
    expect(r.section).toContain("Never grows Puffercloud, Zombud: 65 cells empty on plot 1");
    expect(r.section).toContain("Never grows Magic Jellybean: 28.8 cells empty on plot 1");
    expect(r.section).toContain('href="/flows/mockDevr0007?board=ironman_borrow"');
    expect(r.section).toContain("/day with starting items");
    // No Kit or Stall chips there: the reason line replaces them.
    expect(r.section).not.toMatch(/Kit |>Stall</);
  });

  it("ranking rows on 'with starting items': to start, then per day; nothing set apart", async () => {
    const r = await renderRows("ironman_borrow");
    const html = r.html;
    expect(r.blocked).toHaveLength(0);
    expect(r.ranked.map((x) => x.entry.id)).toContain("mockDevr0007");
    expect(html).toContain('data-testid="row-kit"');
    expect(html).toContain("281 items to start");
    expect(html).toContain('title="To start with: 281 items: 165 Zombud, 116 Puffercloud"');
    expect(html).toContain('title="Needs 165 Zombud, 116 Puffercloud to start, then 93 Zombud + 91 Puffercloud per day."');
    expect(html).toContain("93 Zombud + 91 Puffercloud /day");
    expect(html).toContain("nothing per day");
    expect(html).toContain("Nothing to start with");
    expect(html).not.toContain("Kit ");
    expect(html).not.toContain("Can't start");
  });

  it("ranking rows on Normal: no ironman parts; links keep the board", async () => {
    const { html, blocked } = await renderRows("normal");
    expect(blocked).toHaveLength(0);
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
    for (const s of [
      "What you need",
      "Needs 165 Zombud, 116 Puffercloud to start, then 93 Zombud + 91 Puffercloud per day.",
      "To start with",
      "needs 165",
      "bring 207",
      "uses up",
      "98</span> Zombud once",
      "Then per day (upkeep)",
      "93</span> Zombud / day",
    ]) expect(html).toContain(s);
    // The current board is the highlighted number; "from nothing" can't start.
    expect(html).toMatch(/aria-selected="true"[^>]*>.{0,400}Ironman · with starting items/s);
    expect(html).toContain('data-testid="board-cant-start"');
    expect(html).not.toContain('data-testid="cant-start-note"');
    const aloe = normalizeDetail((await mockDetail("mockAloe0002"))!);
    const a = text(wrap(<FlowDetailView detail={aloe} onChange={() => {}} onReload={() => {}} />, "/flows/mockAloe0002?board=ironman_borrow"));
    expect(a).toContain("returned each session");
    expect(a).toContain("None: it gives back everything it borrows.");
  });

  it("/flows/:id on from nothing for a flow that can't start: the 'Can't start' tile and note, the empty cells kept", async () => {
    const devourer = normalizeDetail((await mockDetail("mockDevr0007"))!);
    const html = text(wrap(<FlowDetailView detail={devourer} onChange={() => {}} onReload={() => {}} />, "/flows/mockDevr0007?board=ironman"));
    expect(html).toContain('data-testid="board-cant-start"');
    expect(html).toMatch(/data-testid="board-cant-start"[^>]*>.{0,300}Can't start.{0,200}Never grows Puffercloud, Zombud: 65 cells empty on plot 1/s);
    expect(html).toContain('data-testid="cant-start-note"');
    expect(html).toContain("Can't start from nothing:</b> it places Puffercloud and Zombud but never grows them (65 cells empty on plot 1). See");
    expect(html).not.toContain("Top earners");
    expect(html).toContain("for what it makes when you own them.");
    // The ranking-related bits are replaced: no Kit / Stall / Slowing chips, ramp line or forgiving.
    expect(html).not.toMatch(/Kit needed|Kit \+|>Stall<|>Slowing<|Layout complete|Layout never/);
    // The empty-cells panel stays (author feedback).
    for (const s of ["Empty layout cells", 'data-testid="empty-cells"', "Plot 1, step 1: 38 Zombud cells empty on average", "Plot 1, step 1: 27 Puffercloud cells empty on average"]) expect(html).toContain(s);
    expect(html).not.toContain('data-testid="what-you-need"');
    // A flow that starts keeps its number and chips: Stall on the Chloronite engine.
    const chloro = normalizeDetail((await mockDetail("mockChloro01"))!);
    const c = text(wrap(<FlowDetailView detail={chloro} onChange={() => {}} onReload={() => {}} />, "/flows/mockChloro01?board=ironman_strict"));
    expect(c).not.toContain("Can't start");
    expect(c).toContain(">Stall<");
    expect(c).toContain("Plot 3, step 1: 5.6 Magic Jellybean cells empty on average");
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
    for (const s of ["Chloronite engine with wheat filler", "FREE COINS click here", "by reports", "Rejected: Best seed", "All boards", ">Ironman<", "990000000000000001", "Copied from my flow", "> Hide<", "> Unhide<", "> Delete<", "> Ban<", "> Unban<", "> Limit<"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain('href="/flows/mockSpam0004"');
    expect(html).not.toContain("/ day");
    rows[0] = { ...rows[0], author_submission_limit: 50 };
    expect(text(wrap(<AdminTable rows={rows} busy={null} act={() => {}} />))).toContain("50 / day");
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
      // The strict devourer run can't start: said instead of only the number.
      'data-testid="test-cant-start"',
      "Can't start from nothing: never grows Puffercloud, Zombud: 65 cells empty on plot 1.",
      "Needs 165 Zombud, 116 Puffercloud to start, then 93 Zombud + 91 Puffercloud per day.",
      "To start with: <span",
      "281 items: 165 Zombud, 116 Puffercloud",
      "93 Zombud + 91 Puffercloud /day",
      "Used up once: 98 Zombud, 11 Puffercloud",
      "Plot 1, step-1: 38 Zombud cells empty on average",
    ]) {
      expect(html).toContain(s);
    }
    expect(html).toMatch(/data-testid="test-strict".{0,300}Can't start/s);
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
