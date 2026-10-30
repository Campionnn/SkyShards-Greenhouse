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
import { CantMakeSection, FlowRowItem, FlowsPage } from "../../pages/FlowsPage";
import { DEFAULT_FILTERS, maxProfit, rankEntries, splitRanked, type ViewSettings } from "../../leaderboard/view";
import type { Board } from "../../leaderboard/rules";
import { DEFAULT_BAZAAR_PRICING } from "../../simulator";
import { defaultGameData } from "../../simulator/data/default";
import { SubmitFlowPanel, type TestState } from "../simulator/SubmitFlowDialog";
import { SettingsPanel } from "../simulator/ScenarioPanels";
import { CommandBar } from "../simulator/page/CommandBar";
import { LeaderboardTab } from "../simulator/page/LeaderboardTab";
import { FromNothingBanner } from "../simulator/FromNothingBanner";
import { previewScenarioOf, withPreviewSeed } from "../simulator/fromNothingPreview";
import { ToastProvider } from "../ui";
import { ReportPanel } from "./FlowDetailSections";
import { FilterBar } from "./FlowFilters";
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
 * The mock list on a board (and the starting-items switch), rendered like the page: ranked rows
 * with the page's row component, then (from nothing) the open "can't make its starting items"
 * section. `ranked` / `blocked` are the split rows.
 */
async function renderRows(board: Board, kit = false) {
  const list = await mockList(board, "max", 1, undefined, kit);
  const s: ViewSettings = { board, kit, quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false, now: Date.now() };
  const { ranked, cantMake } = splitRanked(rankEntries(DATA, list.entries, s, 1));
  const like = { liked: false, busy: false };
  const top = maxProfit(ranked);
  const ranks = text(wrap(<ol>{ranked.map((r, i) => <FlowRowItem key={r.entry.id} row={r} top={top} every={1} board={board} kit={kit} index={i} like={like} sort="profit" />)}</ol>));
  const section = cantMake.length ? text(wrap(<CantMakeSection rows={cantMake} onSwitch={() => {}} defaultOpen />)) : "";
  return { html: ranks + section, ranks, section, ranked, blocked: cantMake };
}

describe("leaderboard pages render", () => {
  it("/flows renders the stats panel, the two boards, the starting-items switch, sorting, filters and a loading state", () => {
    const html = text(wrap(<FlowsPage />));
    for (const s of ["Flow rankings", "Your stats", "How often you log in", "Crop Growth", "Farming Fortune", "Per-crop fortune", "Import from Hypixel", "Farming armor", "Scored at", "Profit per effort", "Most forgiving", "Search flows, authors, crops", "Loading the rankings..."]) {
      expect(html).toContain(s);
    }
    for (const s of ["Ironman", "Normal", "Earning", "I have the starting items"]) expect(html).toContain(s);
    expect(html).not.toMatch(/from nothing<\/button>|with starting items<\/button>/);
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>.{0,600}I have the starting items/s);
    expect(html).toContain('data-testid="filter-bar"');
    expect(html).toContain('data-testid="tier-meter"');
    // Ironman (the default) has the starting-items switch in the filter bar and the starting-item filters in both modes.
    for (const s of ["No upkeep", "Starting items"]) expect(html).toContain(s);
    for (const s of ["Least upkeep", "Steady rate", "I own the starting items"]) expect(html).not.toContain(s);
    expect(html).toMatch(/data-testid="filter-bar".{0,4000}data-testid="kit-switch"/s);
    expect(html).toContain("each flow's starting items are made first");
    // Friendly inputs: Bioanalysis is a dropdown of the accessories, the upgrades are tier lists.
    for (const s of ["Bioanalysis", "Artifact · +15%", "Talisman · +5%", "Tier 9 · +50%", "Evergreen Chip"]) expect(html).toContain(s);
  });

  it("/flows?board=ironman&kit=1 and v2's links: the switch on, the filters kept; Normal has neither", () => {
    const html = text(wrap(<FlowsPage />, "/flows?board=ironman&kit=1&noUpkeep=1&maxStart=60"));
    for (const s of ["No upkeep", "Starting items", "≤ 60", "≤ 200", "As if you already own each flow's starting items"]) expect(html).toContain(s);
    expect(html).toMatch(/aria-pressed="true"[^>]*>No upkeep/);
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    // v2's links open the right view.
    expect(text(wrap(<FlowsPage />, "/flows?board=ironman_borrow"))).toMatch(/role="switch" aria-checked="true"/);
    const strict = text(wrap(<FlowsPage />, "/flows?board=ironman_strict"));
    expect(strict).toMatch(/role="switch" aria-checked="false"/);
    expect(strict).toContain("each flow's starting items are made first");
    const normal = text(wrap(<FlowsPage />, "/flows?board=normal&kit=1"));
    expect(normal).not.toContain("I have the starting items");
    expect(normal).not.toContain("No upkeep");
    expect(normal).toContain("Bazaar prices");
  });

  it("ranking rows from nothing: the starting-items line, upkeep and Stall; flows whose starting items can't be made are set apart", async () => {
    const r = await renderRows("ironman");
    // 8 mock flows: the Godseed flow's starting items can't be made and the Devourer flow stops once its
    // starting items run out (upkeep): both set apart; the other 6 are ranked 1-6.
    expect(r.ranked.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.blocked.map((x) => x.entry.id).sort()).toEqual(["mockDevr0007", "mockGods0009"]);
    expect(r.blocked.every((x) => x.rank === 0)).toBe(true);
    expect(r.ranks).not.toContain("Godseed showcase");
    // The starting-items line: the kit, largest first, and how long the builder takes; the tooltip lists the whole kit.
    expect(r.ranks).toContain('data-testid="starting-items"');
    expect(r.section).toMatch(/Stops once its starting items run out: it needs 93 Zombud \+ 91 Puffercloud a day it doesn't grow/);
    expect(r.ranks).toMatch(/Starting items: 141 Magic Jellybean, 2 All-in Aloe, 1 Blastberry · made in ~12 days/);
    expect(r.ranks).toMatch(/Starting items: 26 Witherbloom, 15 Chloronite, 9 Magic Jellybean · made in ~5 days/);
    expect(r.ranks).toContain('title="Starting items: 141 Magic Jellybean, 2 All-in Aloe, 1 Blastberry"');
    expect(r.ranks).toContain("No starting items");
    // Upkeep in both modes, Stall as before, and no v2 Kit chip.
    expect(r.ranks).toContain('data-testid="row-upkeep"');
    expect(r.ranks).toContain("0.04 Cindershade /day");
    expect(r.ranks).toContain(">Stall<");
    expect(r.ranks).toContain("Plot 3, step-1: 5.6 Magic Jellybean cells empty on average: the stock ran out.");
    expect(r.ranks).toContain("Needs daily");
    expect(r.html).not.toMatch(/Kit \+|Kit needed|Infinity|NaN/);
    // The set-apart section: its count, the explanation, the kit and the number with the starting items.
    expect(r.section).toContain('data-testid="cant-make-section"');
    expect(r.section).toContain("Not ranked from nothing (2)");
    expect(r.section).toContain("can't get their starting items before the scored part of the run, or stop earning once the");
    expect(r.section).toContain("Starting items: 1 Godseed · can't be made within the run");
    expect(r.section).toContain('href="/flows/mockGods0009?board=ironman&kit=1"');
    expect(r.section).toContain("/day with the starting items");
  });

  it("ranking rows with the starting items: the same line, the from-nothing number in the tooltip, nothing set apart", async () => {
    const r = await renderRows("ironman", true);
    expect(r.blocked).toHaveLength(0);
    expect(r.ranked.map((x) => x.entry.id)).toContain("mockGods0009");
    const html = r.html;
    expect(html).toMatch(/Starting items: 165 Zombud, 116 Puffercloud · made in/);
    expect(html).toMatch(/title="From nothing: [\d.]+[kMB]?\/day \(making the starting items first\)"/);
    expect(html).toContain("93 Zombud + 91 Puffercloud /day");
    expect(html).toContain('href="/flows/mockDevr0007?board=ironman&kit=1"');
    expect(html).not.toContain("Can't make its starting items");
  });

  it("ranking rows on Normal: no ironman parts; links keep the board", async () => {
    const { html, blocked } = await renderRows("normal");
    expect(blocked).toHaveLength(0);
    expect(html).toContain("coins / day");
    expect(html).not.toContain('data-testid="row-upkeep"');
    expect(html).not.toContain('data-testid="starting-items"');
    expect(html).not.toMatch(/Kit |>Stall</);
    expect(html).toContain('href="/flows/mockDevr0007?board=normal"');
  });

  it("the filter bar on each board", () => {
    const none = () => {};
    const normal = text(wrap(<FilterBar board="normal" filters={{ ...DEFAULT_FILTERS, earning: ["chorus_fruit"] }} earningOptions={["chorus_fruit"]} kitSwitch={<span>KIT</span>} onChange={none} />));
    expect(normal).toContain("Chorus Fruit");
    expect(normal).toContain("top 3");
    expect(normal).toContain("Clear filters");
    expect(normal).not.toContain("No upkeep");
    const borrow = text(wrap(<FilterBar board="ironman" filters={DEFAULT_FILTERS} earningOptions={[]} kitSwitch={<span>KIT</span>} onChange={none} />));
    for (const s of ["KIT", "No upkeep", "Starting items", "Any"]) expect(borrow).toContain(s);
    expect(borrow).not.toContain("I own the starting items");
    expect(normal).not.toContain("KIT");
  });

  it("/flows/:id renders every section from a full entry", async () => {
    const detail = normalizeDetail((await mockDetail("mockChloro01"))!);
    const html = text(wrap(<FlowDetailView detail={detail} onChange={() => {}} onReload={() => {}} />));
    for (const s of ["Chloronite engine with wheat filler", "Open in simulator", "Copy link", "Profit by online frequency", "forgiving", "What you earn", "Where it comes from", "Top earners", "The flow", "Plot 1", "Consistency across seeds", "Work per login", "Description", "Mutations / day", "Seed spread"]) {
      expect(html).toContain(s);
    }
    // Three numbers: from nothing, with the starting items, normal; the current (the default: from nothing) highlighted.
    expect(html).toContain('data-testid="board-numbers"');
    for (const s of ["Ironman · from nothing", "Ironman · with the starting items", "Normal · Bazaar"]) expect(html).toContain(s);
    expect(html).toMatch(/aria-selected="true"[^>]*>.{0,400}Ironman · from nothing/s);
    // The builder line under the numbers.
    expect(html).toContain('data-testid="builder-line"');
    expect(html).toMatch(/Starting items: 6 Magic Jellybean, 4 Chloronite · made in ~3 days/);
    expect(html).toContain("The site's builder makes the starting items in ~3 days, then this flow runs from exactly them. The builder's crops meanwhile count.");
    expect(html).toContain("starting items made in 3 days");
    // "What you need" on both ironman variants.
    expect(html).toContain('data-testid="what-you-need"');
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

  it("/flows/:id with the starting items (and v2's ?board=ironman_borrow): What you need, upkeep, used up, returned each session", async () => {
    const devourer = normalizeDetail((await mockDetail("mockDevr0007"))!);
    for (const url of ["/flows/mockDevr0007?board=ironman&kit=1", "/flows/mockDevr0007?board=ironman_borrow"]) {
      const html = text(wrap(<FlowDetailView detail={devourer} onChange={() => {}} onReload={() => {}} />, url));
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
      // The current number is "with the starting items"; the builder line says it ran real (upkeep).
      expect(html).toMatch(/aria-selected="true"[^>]*>.{0,400}Ironman · with the starting items/s);
      expect(html).toMatch(/The site's builder makes the starting items in ~\d+ days \(\d+–\d+\), then this flow runs from exactly them/);
    }
    const aloe = normalizeDetail((await mockDetail("mockAloe0002"))!);
    const a = text(wrap(<FlowDetailView detail={aloe} onChange={() => {}} onReload={() => {}} />, "/flows/mockAloe0002?board=ironman&kit=1"));
    expect(a).toContain("returned each session");
    expect(a).toContain("None: it gives back everything it borrows.");
  });

  it("/flows/:id from nothing: the number, the builder line, What you need and the empty cells; a kit that can't be made is said so", async () => {
    const devourer = normalizeDetail((await mockDetail("mockDevr0007"))!);
    const html = text(wrap(<FlowDetailView detail={devourer} onChange={() => {}} onReload={() => {}} />, "/flows/mockDevr0007?board=ironman_strict"));
    expect(html).toMatch(/aria-selected="true"[^>]*>.{0,400}Ironman · from nothing/s);
    expect(html).toContain('data-testid="what-you-need"');
    expect(html).toContain("Top earners");
    for (const s of ["Empty layout cells", 'data-testid="empty-cells"', "Plot 1, step 1: 30 Zombud cells empty on average"]) expect(html).toContain(s);
    expect(html).not.toMatch(/Kit needed|Kit \+|Can't start/);
    // It stops from nothing: the tile and the note say why, in the game's terms.
    expect(html).toContain("stops once its starting items run out");
    expect(html).toContain('data-testid="stops-note"');
    expect(html).toMatch(/it uses 93 Zombud \+ 91 Puffercloud a day that it doesn't grow\. Leftover placed items that never helped enough mutations don't decay/);
    // A flow that stalls keeps its chips.
    const chloro = normalizeDetail((await mockDetail("mockChloro01"))!);
    const c = text(wrap(<FlowDetailView detail={chloro} onChange={() => {}} onReload={() => {}} />, "/flows/mockChloro01?board=ironman"));
    expect(c).toContain(">Stall<");
    expect(c).toContain("Plot 3, step 1: 5.6 Magic Jellybean cells empty on average");
    // The Godseed flow: the builder can't make its kit within the run.
    const gods = normalizeDetail((await mockDetail("mockGods0009"))!);
    const g = text(wrap(<FlowDetailView detail={gods} onChange={() => {}} onReload={() => {}} />, "/flows/mockGods0009?board=ironman"));
    expect(g).toContain("can't make its starting items in time");
    expect(g).toContain("The site's builder couldn't make the starting items before the scored part of the run (it had 0 of 1 Godseed), so this flow has no from-nothing number.");
    // A flow with no empty cells hides the panel; one with no starting items says so.
    const veil = normalizeDetail((await mockDetail("mockVeil0008"))!);
    const v = text(wrap(<FlowDetailView detail={veil} onChange={() => {}} onReload={() => {}} />));
    expect(v).not.toContain("Empty layout cells");
    expect(v).toContain("No starting items");
    expect(v).toContain("no starting items needed");
  });

  it("an old entry (pre-v2 'ironman' cells with payback fields) still renders", async () => {
    const d = (await mockDetail("mockGlass003"))!;
    const old = normalizeDetail({
      ...d,
      boards: ["ironman"] as unknown as typeof d.boards,
      cells: d.cells
        .filter((c) => c.cellKind === "ironman")
        .map((c) => {
          const old: Record<string, unknown> = { ...c, board: "ironman", median: { ...c.median, ramp: undefined, starved: undefined, prep: undefined, peakDebt: { glasscorn: 1 }, paybackCycle: 120, solvent: true } };
          delete old.runKind;
          delete old.cellKind;
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
    expect(html).toContain('data-testid="rules-diff"');
    expect(html).toContain("Apply the Ironman rules");
    expect(html).toContain("0 / 60");
    expect(html).toContain("0 / 2000");
    expect(html).toContain("Leave an empty line to start a new paragraph");
    expect(html).toContain("Test with 3 random seeds");
    // Every flow goes on every board: said, and the local test always runs both (no "Normal too" option).
    expect(html).toContain('data-testid="submit-boards"');
    for (const b of ["Ironman · from nothing", "Ironman · with the starting items"]) expect(html).toContain(b);
    expect(html).not.toContain("Normal too");
    expect(html).toContain("Every board, like the server");
    expect(html).toContain("The score averages a secret window just after this length.");
    expect(html).toContain("the site's builder makes your flow's starting items first");
    // One set of rules (the site's Ironman / Normal switch), no choice among engine set-ups.
    expect(html).not.toMatch(/Compare with|Strict \(no borrowing\)|builder first/);
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

  it("the local test panels: both ironman numbers per seed, the builder, spread, starting items, upkeep, used up, starved cells, seed errors", async () => {
    const cellOf = async (kit: boolean, id = "mockDevr0007") => (await mockList("ironman", "max", 1, undefined, kit)).entries.find((e) => e.id === id)!.cell!;
    const kitCell = await cellOf(true);
    const fromNothing = await cellOf(false);
    const never = await cellOf(false, "mockGods0009");
    const ok = (r: typeof kitCell, f: typeof kitCell | null) => ({ seed: 1, ok: true, error: null, result: r, fromNothing: f, wallMs: 1 });
    const initial: TestState = {
      running: false,
      every: 1,
      cycles: 2000,
      error: null,
      kinds: [
        { runKind: "ironman", progress: [1, 1, 1], outcomes: [{ ...ok(kitCell, fromNothing), stitchCheck: { stitched: 1, real: 1.2, diff: 0.2, ok: false } }, ok(kitCell, fromNothing), ok(kitCell, fromNothing)] },
        { runKind: "normal", progress: [1, 1, 0.4], outcomes: [ok(kitCell, null), { seed: 2, ok: false, error: "script error: boom at cycle 12", result: null, wallMs: 1 }, undefined] },
      ],
    };
    const html = text(wrap(<SubmitFlowPanel scenario={sc} onChange={() => {}} onClose={() => {}} onWatchFromNothing={() => {}} initialTest={initial} />));
    expect(html).toContain('data-testid="seed-test"');
    // The from-nothing card offers to watch it in the simulator (the builder, then the flow).
    expect(html).toContain("Watch it in the simulator");
    for (const k of ["ironman", "ironman_kit", "normal"]) expect(html).toContain(`data-testid="test-${k}"`);
    for (const s of [
      "From nothing",
      "With the starting items",
      "Seed 2 failed: script error: boom at cycle 12",
      "A failed seed makes the server reject the submission.",
      "2/3 seeds",
      "Spread (best / median): 1.00×",
      'data-testid="test-prep"',
      "differed from a real run by 20%",
      "Needs 165 Zombud, 116 Puffercloud to start, then 93 Zombud + 91 Puffercloud per day.",
      "To start with: <span",
      "281 items: 165 Zombud, 116 Puffercloud",
      "93 Zombud + 91 Puffercloud /day",
      "Used up once: 98 Zombud, 11 Puffercloud",
      'data-testid="test-upkeep-note"',
      "Nothing supplies these during a run, so from nothing your flow stalls once its starting items are used up.",
    ]) {
      expect(html).toContain(s);
    }
    expect(html).not.toMatch(/Infinity|NaN|Can't start/);
    // The Devourer from nothing stops once its starting items run out: said on the from-nothing card.
    expect(html).toContain('data-testid="test-stops"');
    expect(html).toContain("it uses 93 Zombud + 91 Puffercloud a day that it doesn't grow");
    // A kit the builder can't make: said on the from-nothing card.
    const cant: TestState = { ...initial, kinds: [{ runKind: "ironman", progress: [1, 1, 1], outcomes: [ok(kitCell, never), ok(kitCell, never), ok(kitCell, never)] }] };
    const c = text(wrap(<SubmitFlowPanel scenario={sc} onChange={() => {}} onClose={() => {}} initialTest={cant} />));
    expect(c).toContain('data-testid="test-cant-make"');
    expect(c).toContain("The builder can't make the starting items (1 Godseed) within the run");
  });
});

describe("the simulator's Leaderboard tab", () => {
  it("rules with Apply and Watch from nothing, test options, the submit form and its readiness", () => {
    const sc = scenario([flow([step("a", { code: LAYOUT_A_CODE }, [])])], { inventory: { chloronite: 3 } });
    const html = text(wrap(<LeaderboardTab scenario={sc} onChange={() => {}} profile="ironman" onWatchFromNothing={() => {}} />));
    for (const s of [
      'data-testid="leaderboard-tab"',
      'data-testid="leaderboard-rules"',
      'data-testid="rules-diff"',
      "starting inventory is not empty",
      "Apply Ironman rules",
      "Watch from nothing",
      "Test like the server",
      'data-testid="test-options"',
      "Seeds",
      "Stats",
      "Online every",
      "Boards",
      "Run test",
      "Submit to the leaderboard",
      "goes on every board",
      "The flow is valid",
      "Not under the Ironman rules",
      "Needs a title",
    ])
      expect(html).toContain(s);
    // Normal board: no from-nothing preview.
    const normal = text(wrap(<LeaderboardTab scenario={sc} onChange={() => {}} profile="normal" onWatchFromNothing={() => {}} />));
    expect(normal).toContain("Apply Normal rules");
    expect(normal).not.toContain("Watch from nothing");
  });
});

describe("simulator settings: the leaderboard rules", () => {
  it("the Rules chip names the board's state, and the Advanced tab holds the rule notes", () => {
    const base = scenario([flow([step("a", { code: LAYOUT_A_CODE }, [])])]);
    const ruled = { ...base, settings: { ...base.settings, config: { ...base.settings.config, freePlacedItems: ["dead_plant", "fermento"], setupFromStock: true, leaderboardRules: true } } };
    const bar = (sc: typeof base) =>
      text(
        wrap(
          <CommandBar
            scenario={sc}
            onChange={() => {}}
            view={{ status: "ready", snapshot: null, previousSummary: null, lastCycleEvents: [], log: [], progress: null, lastCall: null, error: null, issues: [], warnings: [], history: { canStepBack: false, lastAction: null }, rewound: null }}
            profile="ironman"
            onProfileChange={() => {}}
            onRun={() => {}}
            onStep={() => {}}
            onStepBack={() => {}}
            onUndo={() => {}}
            onStop={() => {}}
            onReset={() => {}}
            seed={1}
            onSeedChange={() => {}}
            changedSettings={3}
            onOpenSettings={() => {}}
            problems={[]}
            shareMenu={() => null}
          />
        )
      );
    // The chip shows whether the scenario matches the Ironman board's set-up; one chip, no four-way select.
    expect(bar(base)).toContain("Leaderboard rules (Ironman board)");
    expect(bar(base)).toMatch(/>off</);
    expect(bar(base)).not.toMatch(/From nothing \(builder first\)|Strict \(no borrowing\)|Import the builder/);
    expect(bar(ruled)).toContain("3 changed");
    // The notes for setupFromStock / leaderboardRules / free supplies live in the Advanced tab.
    const adv = text(wrap(<SettingsPanel bare tab="advanced" scenario={ruled} onChange={() => {}} />));
    expect(adv).toContain('data-testid="setup-from-stock-note"');
    expect(adv).toContain('data-testid="leaderboard-rules-note"');
    expect(adv).toContain("Unlimited supplies");
  });
});

describe("simulator: the from-nothing preview", () => {
  const preview = {
    kit: { zombud: 3, puffercloud: 2 },
    every: 4,
    part: "builder" as const,
    builder: scenario([flow([step("a", { code: LAYOUT_A_CODE }, [])])]),
    flow: scenario([flow([step("b", { code: LAYOUT_B_CODE }, [])])]),
  };
  it("the banner: both parts, the builder's progress on the starting items, and the way back", () => {
    const html = text(wrap(<FromNothingBanner preview={preview} inventory={{ zombud: 5, puffercloud: 1 }} onPart={() => {}} onExit={() => {}} />));
    for (const s of ["From nothing, as the Ironman board runs it", "Back to my flow", "1 · Builder makes the starting items", "2 · Your flow from exactly those", "3 / 3 Zombud", "1 / 2 Puffercloud", "online every 4 cycles", "Your flows are untouched"]) expect(html).toContain(s);
    expect(html).not.toContain("all made");
    const done = text(wrap(<FromNothingBanner preview={preview} inventory={{ zombud: 3, puffercloud: 2 }} onPart={() => {}} onExit={() => {}} />));
    expect(done).toContain("all made: run part 2");
    const flowPart = text(wrap(<FromNothingBanner preview={{ ...preview, part: "flow" }} inventory={null} onPart={() => {}} onExit={() => {}} />));
    expect(flowPart).toContain("it starts with exactly these items");
    expect(flowPart).toContain(">3 Zombud<");
    const none = text(wrap(<FromNothingBanner preview={{ ...preview, kit: {}, builder: null, part: "flow" }} inventory={null} onPart={() => {}} onExit={() => {}} />));
    expect(none).toContain("needs no starting items");
    expect(none).not.toContain("1 · Builder");
  });
  it("previewScenarioOf / withPreviewSeed change only the running part", () => {
    expect(previewScenarioOf(preview)).toBe(preview.builder);
    const seeded = withPreviewSeed(preview, 42);
    expect(seeded.builder!.settings.seed).toBe(42);
    expect(seeded.flow).toBe(preview.flow);
    expect(previewScenarioOf({ ...preview, part: "flow" })).toBe(preview.flow);
    expect(previewScenarioOf({ ...preview, builder: null })).toBe(preview.flow);
  });
});
