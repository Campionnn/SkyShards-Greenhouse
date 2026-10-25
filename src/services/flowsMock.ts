/**
 * DEV-ONLY canned leaderboard data, for checking the /flows pages without the real API.
 * Enabled with `localStorage.setItem("skyshards-flows-mock", "1")` in a dev build; every caller
 * checks `flowsMockEnabled()`, which is a constant `false` in production builds, so the data below
 * is tree-shaken out of the bundle.
 */
import type { AuthUser, CurvePoint, FlowCell, FlowDetail, FlowListEntry, FlowListResponse, FlowSeedResult, FlowStatusResponse } from "../leaderboard/api";
import type { RunResult } from "../leaderboard/result";
import { BOARD_RUN_KIND, boardFrom, BOARDS, parseSubmission, RUN_KINDS, type Board, type RunKind, type SubmissionFile } from "../leaderboard/rules";
import { summarizeSubmission, type FlowSummary } from "../leaderboard/summary";
import { EVERY, TIERS, type TierId } from "../leaderboard/tiers";
import { defaultGameData } from "../simulator/data/default";

export const MOCK_KEY = "skyshards-flows-mock";
export const MOCK_TOKEN = "mock-token";

export function flowsMockEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export const MOCK_USER: AuthUser = { id: "80351110224678912", username: "greenthumb", global_name: "Green Thumb", avatar: null };

const LAYOUT_A = "RctJDsIwEETRC_0FY4AlhAzXsNs2CeDExICElMNjr_Jq0ypVBzo8RyyODWtGDggrDJE9BSe2fFHs5pFfujwhfUSm-TmG--PmnDE-u1ZVXfuyL33nnLV9prMYhxil0Y0MlxQRLTJkS7fsVKtb9XmfX5PK_g";
const LAYOUT_B = "q9QxNNQpqjE0rUlKSkwCYj09vSTHRBDUS9ZLTEwEikLEwKIgFkgwCSQLEksCiyVCgB4cJENwsh4qAAA";

/** What one run kind of a spec produces at every = 1, max tier, plus the v2 diagnostics. */
interface KindSpec {
  /** Multiplies the spec's produced counts. */
  factor: number;
  startItems?: Record<string, number>;
  sessionOnly?: string[];
  usedUp?: Record<string, number>;
  upkeep?: Record<string, number>;
  starved?: { plot: number; step: string; item: string; cells: number }[];
  /** The cycle the layouts were complete from (null: never); missing = from the start. */
  complete?: number | null;
  /** The second-half rate as a share of the window rate (a ramp: > 1). */
  steady?: number;
  slowing?: boolean;
}

interface Spec {
  id: string;
  title: string;
  author: { id: string; name: string; avatar: string | null };
  plots: number;
  cycles: number;
  ageDays: number;
  stale?: boolean;
  /** Produced per day at every = 1, max tier. */
  produced: Record<string, number>;
  consumed: Record<string, number>;
  bought: Record<string, number>;
  built: Record<string, number>;
  /** How fast value falls off with rarer logins (0 = not at all). */
  falloff: number;
  effort: [number, number];
  description: string;
  /** Likes all time and in the last 30 days. */
  likes?: [number, number];
  /** Per run kind; missing kinds make the spec's numbers unchanged. */
  kinds?: Partial<Record<RunKind, KindSpec>>;
  /** Step ids and labels per plot (the payload; the default is one unlabelled step). */
  steps?: { id: string; label?: string }[][];
}

const SPECS: Spec[] = [
  {
    id: "mockChloro01",
    likes: [14, 9],
    title: "Chloronite engine with wheat filler",
    author: { id: MOCK_USER.id, name: "Green Thumb", avatar: null },
    plots: 3,
    cycles: 2000,
    ageDays: 2,
    produced: { wheat: 120000, chloronite: 40, magic_jellybean: 6, coalroot: 12, scourroot: 9, ethereal_vine: 3, cropie: 18 },
    consumed: { dead_plant: 12, fermento: 3 },
    bought: { dead_plant: 12, fermento: 3 },
    built: { chloronite: 4, magic_jellybean: 6 },
    falloff: 0.08,
    effort: [45, 290],
    description:
      "### How it works\nThree plots of **Chloronite** around a wheat core. Harvest every login, re-place *dead plants* when they decay.\n\n- Plot 1 and 2: Chloronite\n- Plot 3: Jellybean support\n\n> Works best online every 1-3 cycles.\n\n[links are not rendered](https://example.com)",
    kinds: {
      strict: { factor: 0.97, complete: 220, steady: 1.04, starved: [{ plot: 3, step: "step-1", item: "magic_jellybean", cells: 0.6 }] },
      borrow: { factor: 1, startItems: { chloronite: 4, magic_jellybean: 6 }, complete: 0 },
    },
  },
  {
    // The owner's aloe flow: deadlocks from nothing (slowing, stalls on Jellybeans), 88.8M with the kit.
    id: "mockAloe0002",
    likes: [31, 2],
    title: "All-in Aloe slow cook (very long title to check that wrapping works on a phone without truncation)",
    author: { id: "175928847299117063", name: "Aloe Vera Enjoyer", avatar: null },
    plots: 2,
    cycles: 5000,
    ageDays: 20,
    stale: true,
    produced: { all_in_aloe: 2.4, wheat: 60000, sunflower: 30000, moonflower: 30000, helianthus: 1.2 },
    consumed: {},
    bought: {},
    built: { all_in_aloe: 2, magic_jellybean: 40 },
    falloff: 0.02,
    effort: [12, 60],
    description: "Low effort. Log in whenever. The Jellybean step needs its 53 beans before it moves on.",
    steps: [[{ id: "s-aloe", label: "All-in Aloe" }, { id: "s-bean", label: "Jellybean" }], [{ id: "step-1" }]],
    kinds: {
      strict: {
        factor: 0,
        slowing: true,
        complete: null,
        steady: 0,
        starved: [
          { plot: 1, step: "s-aloe", item: "magic_jellybean", cells: 34.2 },
          { plot: 1, step: "s-bean", item: "magic_jellybean", cells: 6.1 },
          { plot: 2, step: "step-1", item: "all_in_aloe", cells: 1.4 },
        ],
      },
      borrow: { factor: 1, startItems: { magic_jellybean: 141, all_in_aloe: 2, blastberry: 1 }, sessionOnly: ["blastberry"], complete: 0 },
    },
  },
  {
    id: "mockGlass003",
    likes: [6, 0],
    title: "Glasscorn trio",
    author: { id: "228537642583588864", name: "corncob", avatar: null },
    plots: 1,
    cycles: 3000,
    ageDays: 40,
    produced: { glasscorn: 6, sugar_cane: 90000, cactus: 30000 },
    consumed: { fermento: 8 },
    bought: { fermento: 8 },
    built: { glasscorn: 1 },
    falloff: 0.15,
    effort: [80, 410],
    description: "",
    kinds: {
      // maga-like: a little short of Cindershade all run, never quite complete (below the Stall threshold).
      strict: { factor: 0.93, complete: null, steady: 1, starved: [{ plot: 1, step: "step-1", item: "cindershade", cells: 0.9 }] },
      borrow: { factor: 1, startItems: { glasscorn: 1, cindershade: 4 }, upkeep: { cindershade: 0.04 }, complete: 0 },
    },
  },
  {
    // A chorus flow earning Chorus Fruit: uses up 26 Witherbloom once on the borrow board, no upkeep.
    id: "mockChorus09",
    likes: [9, 5],
    title: "Chorus overflow farm",
    author: { id: "601238847711002624", name: "endermage", avatar: null },
    plots: 3,
    cycles: 4000,
    ageDays: 5,
    produced: { chorus_fruit: 48, potato: 50000, carrot: 58000, sugar_cane: 66000, chloronite: 3, magic_jellybean: 2 },
    consumed: { dead_plant: 6 },
    bought: { dead_plant: 6 },
    built: { chloronite: 15, magic_jellybean: 9, witherbloom: 26 },
    falloff: 0.06,
    effort: [60, 220],
    description: "Chorus Fruit teleport-overflow on three plots. Rebuild the Witherbloom ring once.",
    kinds: {
      strict: { factor: 0.34, complete: 1500, steady: 1.6, starved: [{ plot: 2, step: "step-1", item: "witherbloom", cells: 3.1 }, { plot: 3, step: "step-1", item: "witherbloom", cells: 2.4 }] },
      borrow: { factor: 1, startItems: { chloronite: 15, magic_jellybean: 9, witherbloom: 26 }, usedUp: { witherbloom: 26 }, complete: 0 },
    },
  },
  {
    id: "mockNoct0006",
    likes: [3, 3],
    title: "Noctilume night shift",
    author: { id: "312548796201451520", name: "moonlit", avatar: null },
    plots: 3,
    cycles: 5000,
    ageDays: 1,
    produced: { noctilume: 14, wild_rose: 220000, cactus: 40000, ethereal_vine: 2, helianthus: 0.6 },
    consumed: { dead_plant: 4 },
    bought: { dead_plant: 4 },
    built: { noctilume: 2, wild_rose: 0 },
    falloff: 0.11,
    effort: [22, 140],
    description: "Set the time each login. Three identical plots; nothing to rebuild.",
    kinds: { strict: { factor: 1, complete: 0 }, borrow: { factor: 1, startItems: {}, complete: 0 } },
  },
  {
    // Devourer: an infinite-input flow. Huge with borrowing, but ~91 Zombud + Puffercloud a day of upkeep.
    id: "mockDevr0007",
    title: "Devourer root farm",
    author: { id: "443201775698612224", name: "Rooted", avatar: null },
    plots: 2,
    cycles: 2000,
    ageDays: 9,
    produced: { devourer: 3.2, brown_mushroom: 150000, red_mushroom: 150000, pumpkin: 70000, cropie: 6 },
    consumed: { fermento: 2 },
    bought: { fermento: 2, zombud: 91, puffercloud: 90 },
    built: { zombud: 8, puffercloud: 6 },
    falloff: 0.05,
    effort: [140, 620],
    description: "Heavy: clear roots every login and rebuild the Zombud ring after each Devourer.",
    kinds: {
      strict: { factor: 0.27, complete: 1400, steady: 1.1, starved: [{ plot: 1, step: "step-1", item: "zombud", cells: 2.2 }] },
      borrow: {
        factor: 1,
        startItems: { zombud: 41720.3, puffercloud: 41377.6 },
        usedUp: { zombud: 41720.3, puffercloud: 41377.6 },
        upkeep: { zombud: 91.3, puffercloud: 90.5 },
        complete: 0,
      },
    },
  },
  {
    id: "mockVeil0008",
    likes: [22, 11],
    title: "Veilshroom carpet, zero upkeep",
    author: { id: "512088963174449152", name: "fungi", avatar: null },
    plots: 1,
    cycles: 2000,
    ageDays: 14,
    produced: { veilshroom: 210, brown_mushroom: 80000, red_mushroom: 30000 },
    consumed: {},
    bought: {},
    built: {},
    falloff: 0.01,
    effort: [8, 30],
    description: "Plant it, forget it. Log in whenever you like.",
    kinds: { strict: { factor: 1, complete: 0 }, borrow: { factor: 1, startItems: {}, complete: 0 } },
  },
];

const KIND_BOARD: Record<RunKind, Board> = { strict: "ironman_strict", borrow: "ironman_borrow", normal: "normal" };

/** A result for one cell: the spec scaled by run kind, tier and frequency, plus a little per-seed noise. */
function resultFor(s: Spec, runKind: RunKind, tier: TierId, every: number, noise = 1, seed = false): RunResult {
  const k: KindSpec = s.kinds?.[runKind] ?? { factor: 1 };
  const tierF = { max: 1, high: 0.85, mid: 0.65, low: 0.45 }[tier];
  const everyF = Math.max(0.1, 1 - s.falloff * (every - 1));
  const f = tierF * everyF * noise * k.factor;
  const scale = (m: Record<string, number>, n: number) => Object.fromEntries(Object.entries(m).filter(([, v]) => v * n > 0).map(([i, v]) => [i, v * n]));
  const sessions = Math.round(2000 / every);
  const end = Math.ceil(s.cycles * 1.25);
  const days = (end * 1.75) / 24 / tierF;
  const produced = scale(s.produced, f);
  const normal = runKind === "normal";
  const r: RunResult = {
    cycles: end,
    days,
    window: { from: s.cycles, to: end, cuts: Math.floor((end - s.cycles) / 25) + 1 },
    produced,
    consumed: scale(s.consumed, tierF),
    bought: normal ? scale(s.bought, tierF) : {},
    built: normal ? s.built : {},
    shortfall: {},
    uptime: 0.97 * everyF * (k.factor > 0 ? 1 : 0.2),
    sustainable: every <= 6 && k.factor > 0,
    effort: {
      sessions,
      avg: s.effort[0] * Math.sqrt(every),
      peak: s.effort[1] * Math.sqrt(every),
      byKind: { harvest: 20 * every, water: 3, place: 2.5, remove: 1.2, gate: 0.5, stepChange: 0.1 },
    },
    halted: false,
    bySource: bySourceOf(produced),
    stepTime: Object.fromEntries(stepsOf(s).map((steps, i) => [String(i + 1), Object.fromEntries(steps.map((st) => [st.id, 1 / steps.length]))])),
    starved: (k.starved ?? []).map((e) => ({ ...e, cells: Math.round(e.cells * (1 + 0.1 * (every - 1)) * 1000) / 1000 })),
    ramp: { complete: k.complete === undefined ? 0 : k.complete, produced: scale(s.produced, tierF * everyF * noise * (k.steady ?? k.factor)), bought: normal ? scale(s.bought, tierF) : {} },
  };
  if (runKind === "borrow") {
    r.startItems = k.startItems ?? {};
    r.sessionOnly = k.sessionOnly ?? [];
    r.usedUp = k.usedUp ?? {};
    r.upkeep = scale(k.upkeep ?? {}, tierF);
  }
  if (seed && k.slowing) r.trail = { from: Math.floor(end * 0.8), produced: {}, consumed: {}, bought: {}, shortfall: {}, bySource: {} };
  if (!seed && k.slowing) r.slowing = true;
  return r;
}

/** Split produced items over plausible sources: each mutation item to itself, crops and rares to the mutations and wheat. */
function bySourceOf(produced: Record<string, number>): Record<string, Record<string, number>> {
  const data = defaultGameData();
  const muts = Object.keys(produced).filter((k) => data.mutations[k]);
  const out: Record<string, Record<string, number>> = {};
  for (const [item, n] of Object.entries(produced)) {
    if (data.mutations[item]) (out[item] ??= {})[item] = n;
    else if (muts.length) muts.forEach((m, i) => ((out[m] ??= {})[item] = (n * (muts.length - i)) / ((muts.length * (muts.length + 1)) / 2)));
    else (out[item] ??= {})[item] = n;
  }
  return out;
}

const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

const stepsOf = (s: Spec): { id: string; label?: string }[][] => Array.from({ length: s.plots }, (_, i) => s.steps?.[i] ?? [{ id: "step-1" }]);

const payloadOf = (s: Spec): SubmissionFile =>
  ({
    kind: "skyshards-greenhouse-flows",
    version: 2,
    plots: stepsOf(s).map((steps, i) => ({
      id: i + 1,
      flow: { steps: steps.map((st, j) => ({ ...st, layout: { code: (i + j) % 2 ? LAYOUT_B : LAYOUT_A }, exits: steps.length > 1 ? [{ when: [{ kind: "cycles", n: 40 }] }] : [] })), loop: steps.length > 1, startIndex: 0 },
    })),
    settings: { policies: {} },
  }) as unknown as SubmissionFile;

const delay = <T>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));

const summaryOf = (s: Spec): FlowSummary => {
  const sub = parseSubmission(payloadOf(s)).submission;
  if (!sub) return { plots: [], targets: [], inputs: [], steps: 0, scripted: false };
  const out = summarizeSubmission(sub, defaultGameData());
  // The two sample layouts grow Chloronite-ish targets; show the spec's mutations instead, so the
  // mock list looks like the flows it describes.
  const mutations = Object.keys(s.produced).filter((k) => defaultGameData().mutations[k]);
  const inputs = Object.keys(s.built).filter((k) => defaultGameData().mutations[k]);
  return mutations.length ? { ...out, targets: mutations, inputs } : out;
};

const curvePoint = (r: RunResult): CurvePoint => ({ produced: r.produced, bought: r.bought, consumed: r.consumed, effort: { avg: r.effort.avg, peak: r.effort.peak }, ...(r.slowing ? { slowing: true as const } : {}) });

/** The list endpoint (`GET /flows`): one board's cells, its curve, and on `ironman_strict` the borrow cell as `borrowPoint`. */
export function mockList(rawBoard: Board | "ironman", tier: TierId, every: number, plots?: number): Promise<FlowListResponse> {
  const board = boardFrom(rawBoard) ?? "ironman_strict";
  const runKind = BOARD_RUN_KIND[board];
  const entries: FlowListEntry[] = SPECS.filter((s) => !plots || s.plots === plots).map((s) => {
    const used = s.id === "mockGlass003" && tier !== "max" ? "max" : tier;
    const cell = resultFor(s, runKind, used, every);
    const curve = Object.fromEntries(EVERY.map((n) => [String(n), curvePoint(resultFor(s, runKind, used, n))]));
    return {
      id: s.id,
      title: s.title,
      excerpt: s.description.slice(0, 240),
      author: s.author,
      boards: [...BOARDS],
      plots: s.plots,
      cycles: s.cycles,
      createdAt: ago(s.ageDays),
      updatedAt: ago(Math.max(0, s.ageDays - 1)),
      stale: !!s.stale,
      estimated: used !== tier,
      cell,
      spread: { seeds: 5, values: [], best: 1, median: 1, worst: 1, ratio: 1.04 + s.falloff },
      seeds: used === "max" ? 5 : 3,
      effort: cell.effort,
      summary: summaryOf(s),
      thumb: { plot: 1, step: "step-1", layout: payloadOf(s).plots[s.plots > 1 ? 1 : 0].flow.steps[0].layout, share: 0.72 },
      curve,
      ...(board === "ironman_strict" ? { borrowPoint: curvePoint(resultFor(s, "borrow", used, every)) } : {}),
      ...likesOf(s),
    };
  });
  return delay({ engineVersion: "mock", board, runKind, tier, every, truncated: false, entries } as FlowListResponse);
}

/** The detail endpoint (`GET /flows/{id}`): cells and seed rows per run kind, each with its board. */
export function mockDetail(id: string): Promise<FlowDetail | null> {
  const s = SPECS.find((x) => x.id === id);
  if (!s) return delay(null);
  const cells: FlowCell[] = [];
  const seeds: FlowSeedResult[] = [];
  for (const runKind of RUN_KINDS)
    for (const tier of TIERS)
      for (const every of EVERY) {
        const board = KIND_BOARD[runKind];
        cells.push({ runKind, board, tier, every, median: resultFor(s, runKind, tier, every), spread: { seeds: 5, values: [], best: 1, median: 1, worst: 1, ratio: 1.1 + s.falloff }, seeds: tier === "max" ? 5 : 3, engineVersion: "mock" });
        if (tier === "max") for (let i = 0; i < 5; i++) seeds.push({ runKind, board, tier, every, seedIndex: i, ok: true, error: null, result: resultFor(s, runKind, tier, every, [1, 0.94, 1.08, 0.97, 1.12][i], true) });
      }
  return delay({
    id: s.id,
    title: s.title,
    description: s.description,
    author: s.author,
    boards: [...BOARDS],
    plots: s.plots,
    cycles: s.cycles,
    status: s.id === "mockChloro01" ? "pending" : "live",
    createdAt: ago(s.ageDays),
    updatedAt: ago(Math.max(0, s.ageDays - 1)),
    engineVersion: "mock",
    stale: !!s.stale,
    payload: payloadOf(s),
    summary: summaryOf(s),
    thumb: { plot: 1, step: "step-1", layout: payloadOf(s).plots[s.plots > 1 ? 1 : 0].flow.steps[0].layout, share: 0.72 },
    cells,
    seeds,
    ...likesOf(s),
    liked: mockLiked.has(s.id),
  });
}

/** The mock user's likes this session (the spec counts don't include them). */
const mockLiked = new Set<string>(["mockVeil0008"]);

function likesOf(s: Spec): { likes: number; likes30d: number } {
  const [all, recent] = s.likes ?? [0, 0];
  const mine = mockLiked.has(s.id) ? 1 : 0;
  return { likes: all + mine, likes30d: recent + mine };
}

export function mockSetLike(id: string, liked: boolean): Promise<{ id: string; liked: boolean; likes: number; likes30d: number }> {
  const s = SPECS.find((x) => x.id === id);
  if (!s) return Promise.reject(new Error("Flow not found"));
  if (liked) mockLiked.add(id);
  else mockLiked.delete(id);
  return delay({ id, liked, ...likesOf(s) }, 150);
}

export function mockMyLikes(): Promise<string[]> {
  return delay([...mockLiked], 100);
}

export function mockStatus(): Promise<FlowStatusResponse> {
  return delay({
    status: "pending",
    rejectReason: null,
    jobs: [
      { id: 1, runKind: "strict", board: "ironman_strict", tier: "max", priority: "A", status: "done", done: 35, total: 35, queuePosition: null, error: null },
      { id: 2, runKind: "borrow", board: "ironman_borrow", tier: "max", priority: "A", status: "running", done: 12, total: 35, queuePosition: null, error: null },
      { id: 3, runKind: "normal", board: "normal", tier: "max", priority: "A", status: "queued", done: 0, total: 35, queuePosition: 2, error: null },
    ],
  });
}

export function mockSubmit(): Promise<{ id: string; status: "pending" }> {
  return delay({ id: "mockChloro01", status: "pending" }, 600);
}

// ---- Admin (moderation) -------------------------------------------------------------------------

/** The admin key the mock accepts. */
export const MOCK_ADMIN_KEY = "mock";

const epoch = (days: number) => Math.round(Date.now() / 1000 - days * 86400);

type MockRow = Record<string, unknown> & { id: string; owner_id: string; status: string };

/** Raw `entries` rows as the API's admin list returns them; mutated by the mock actions. */
let adminRows: MockRow[] | null = null;
const rows = (): MockRow[] =>
  (adminRows ??= [
    ...SPECS.map((s, i) => ({
      id: s.id,
      owner_id: s.author.id,
      title: s.title,
      description: s.description,
      boards: "all",
      cycles: s.cycles,
      plots: s.plots,
      status: i === 0 ? "pending" : "live",
      reject_reason: null,
      engine_version: "mock",
      report_count: i === 1 ? 2 : 0,
      hidden_by_admin: 0,
      hidden_reason: null,
      prev_status: null,
      created_at: epoch(s.ageDays),
      updated_at: epoch(Math.max(0, s.ageDays - 1)),
      author_username: s.author.name.toLowerCase().replace(/\s+/g, ""),
      author_global_name: s.author.name,
      author_avatar: s.author.avatar,
      reports: i === 1 ? [{ reporter_id: "1", reason: "Copied from my flow", created_at: epoch(1) }, { reporter_id: "2", reason: "", created_at: epoch(0.5) }] : [],
    })),
    {
      id: "mockSpam0004",
      owner_id: "990000000000000001",
      title: "FREE COINS click here",
      description: "spam",
      boards: "ironman",
      cycles: 2000,
      plots: 1,
      status: "hidden",
      reject_reason: null,
      engine_version: "mock",
      report_count: 5,
      hidden_by_admin: 0,
      hidden_reason: "reports",
      prev_status: "live",
      created_at: epoch(3),
      updated_at: epoch(3),
      author_username: "spammer",
      author_global_name: null,
      author_avatar: null,
      reports: [{ reporter_id: "3", reason: "spam", created_at: epoch(2) }],
    },
    {
      id: "mockCheat005",
      owner_id: "990000000000000002",
      title: "Lucky seed run",
      description: "",
      boards: "normal",
      cycles: 2000,
      plots: 2,
      status: "rejected",
      reject_reason: "Best seed beats the median by more than 2x (outlier).",
      engine_version: "mock",
      report_count: 1,
      hidden_by_admin: 0,
      hidden_reason: null,
      prev_status: null,
      created_at: epoch(5),
      updated_at: epoch(5),
      author_username: "lucky",
      author_global_name: "Lucky",
      author_avatar: null,
      reports: [],
    },
  ]);

export function mockAdminList(status?: string): Promise<{ entries: MockRow[] }> {
  const all = rows();
  const entries = !status ? all : status === "reported" ? all.filter((r) => Number(r.report_count) > 0) : all.filter((r) => r.status === status);
  return delay({ entries: entries.map((r) => ({ ...r })) });
}

export function mockAdminAction(id: string, action: "hide" | "unhide" | "delete"): Promise<Record<string, unknown> | null> {
  const all = rows();
  const row = all.find((r) => r.id === id);
  if (!row) return delay(null);
  if (action === "delete") {
    adminRows = all.filter((r) => r !== row);
    return delay({ id, deleted: true });
  }
  if (action === "hide") {
    if (row.status !== "hidden") Object.assign(row, { prev_status: row.status, status: "hidden" });
    Object.assign(row, { hidden_reason: "admin", hidden_by_admin: 1 });
  } else {
    if (row.status === "hidden") Object.assign(row, { status: row.prev_status ?? "live", prev_status: null });
    Object.assign(row, { hidden_reason: null, hidden_by_admin: 0, report_count: 0, reports: [] });
  }
  return delay({ id, status: row.status });
}

export function mockAdminBan(userId: string, ban: boolean): Promise<{ id: string; banned: boolean } | null> {
  const mine = rows().filter((r) => r.owner_id === userId);
  if (!mine.length) return delay(null);
  for (const r of mine) {
    if (ban && r.status !== "hidden") Object.assign(r, { prev_status: r.status, status: "hidden", hidden_reason: "ban", hidden_by_admin: 0 });
    if (!ban && r.status === "hidden" && r.hidden_reason === "ban") Object.assign(r, { status: r.prev_status ?? "live", prev_status: null, hidden_reason: null });
  }
  return delay({ id: userId, banned: ban });
}

/** The admin fields `GET /flows/{id}` adds when the admin key is sent. */
export function mockAdminDetailExtras(id: string): Pick<FlowDetail, "status" | "rejectReason" | "hidden" | "hiddenReason" | "reportCount"> | null {
  const r = rows().find((x) => x.id === id);
  if (!r) return null;
  return {
    status: r.status as FlowDetail["status"],
    rejectReason: (r.reject_reason as string | null) ?? null,
    hidden: r.status === "hidden",
    hiddenReason: (r.hidden_reason as string | null) ?? null,
    reportCount: Number(r.report_count) || 0,
  };
}
