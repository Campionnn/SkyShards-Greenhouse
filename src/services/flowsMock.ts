/**
 * DEV-ONLY canned leaderboard data, for checking the /flows pages without the real API.
 * Enabled with `localStorage.setItem("skyshards-flows-mock", "1")` in a dev build; every caller
 * checks `flowsMockEnabled()`, which is a constant `false` in production builds, so the data below
 * is tree-shaken out of the bundle.
 */
import type { AuthUser, FlowCell, FlowDetail, FlowListEntry, FlowListResponse, FlowSeedResult, FlowStatusResponse } from "../leaderboard/api";
import type { RunResult } from "../leaderboard/result";
import type { Board, SubmissionFile } from "../leaderboard/rules";
import { EVERY, TIERS, type TierId } from "../leaderboard/tiers";

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

const plot = (id: number, code: string) => ({ id, flow: { steps: [{ id: "step-1", layout: { code }, exits: [] }], loop: false, startIndex: 0 } });

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
}

const SPECS: Spec[] = [
  {
    id: "mockChloro01",
    title: "Chloronite engine with wheat filler",
    author: { id: MOCK_USER.id, name: "Green Thumb", avatar: null },
    plots: 3,
    cycles: 2000,
    ageDays: 2,
    produced: { wheat: 120000, chloronite: 40, ethereal_vine: 3, cropie: 18 },
    consumed: { dead_plant: 12, fermento: 3 },
    bought: { dead_plant: 12, fermento: 3 },
    built: { chloronite: 4, magic_jellybean: 6 },
    falloff: 0.08,
    effort: [45, 290],
    description:
      "### How it works\nThree plots of **Chloronite** around a wheat core. Harvest every login, re-place *dead plants* when they decay.\n\n- Plot 1 and 2: Chloronite\n- Plot 3: Jellybean support\n\n> Works best online every 1-3 cycles.\n\n[links are not rendered](https://example.com)",
  },
  {
    id: "mockAloe0002",
    title: "All-in Aloe slow cook (very long title to check that wrapping works on a phone without truncation)",
    author: { id: "175928847299117063", name: "Aloe Vera Enjoyer", avatar: null },
    plots: 2,
    cycles: 5000,
    ageDays: 20,
    stale: true,
    produced: { all_in_aloe: 2.4, potato: 60000, helianthus: 1.2 },
    consumed: {},
    bought: {},
    built: { all_in_aloe: 2 },
    falloff: 0.02,
    effort: [12, 60],
    description: "Low effort. Log in whenever.",
  },
  {
    id: "mockGlass003",
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
  },
];

/** A result for one cell: the spec scaled by tier and frequency, plus a little per-seed noise. */
function resultFor(s: Spec, board: Board, tier: TierId, every: number, noise = 1): RunResult {
  const tierF = { max: 1, high: 0.85, mid: 0.65, low: 0.45 }[tier];
  const everyF = Math.max(0.1, 1 - s.falloff * (every - 1));
  const f = tierF * everyF * noise;
  const scale = (m: Record<string, number>, k: number) => Object.fromEntries(Object.entries(m).map(([i, n]) => [i, n * k]));
  const sessions = Math.round(2000 / every);
  return {
    cycles: s.cycles,
    days: s.cycles * 1.75 / 24 / tierF,
    produced: scale(s.produced, f),
    consumed: scale(s.consumed, tierF),
    bought: board === "normal" ? scale(s.bought, tierF) : {},
    built: board === "normal" ? s.built : {},
    shortfall: {},
    uptime: 0.97 * everyF,
    sustainable: every <= 6,
    effort: {
      sessions,
      avg: s.effort[0] * Math.sqrt(every),
      peak: s.effort[1] * Math.sqrt(every),
      byKind: { harvest: 20 * every, water: 3, place: 2.5, remove: 1.2, gate: 0.5, stepChange: 0.1 },
    },
    halted: false,
  };
}

const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

const payloadOf = (s: Spec): SubmissionFile =>
  ({
    kind: "skyshards-greenhouse-flows",
    version: 2,
    plots: [plot(1, LAYOUT_A), plot(2, LAYOUT_B), plot(3, LAYOUT_A)].slice(0, s.plots),
    settings: { policies: {} },
  }) as unknown as SubmissionFile;

const delay = <T>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export function mockList(board: Board, tier: TierId, every: number, plots?: number): Promise<FlowListResponse> {
  const entries: FlowListEntry[] = SPECS.filter((s) => !plots || s.plots === plots).map((s) => {
    const cell = resultFor(s, board, s.id === "mockGlass003" && tier !== "max" ? "max" : tier, every);
    return {
      id: s.id,
      title: s.title,
      author: s.author,
      plots: s.plots,
      cycles: s.cycles,
      createdAt: ago(s.ageDays),
      updatedAt: ago(Math.max(0, s.ageDays - 1)),
      stale: !!s.stale,
      estimated: s.id === "mockGlass003" && tier !== "max",
      cell,
      spread: { [String(every)]: 1.1 + s.falloff },
      effort: cell.effort,
    };
  });
  return delay({ engineVersion: "mock", entries });
}

export function mockDetail(id: string): Promise<FlowDetail | null> {
  const s = SPECS.find((x) => x.id === id);
  if (!s) return delay(null);
  const boards: Board[] = ["ironman", "normal"];
  const cells: FlowCell[] = [];
  const seeds: FlowSeedResult[] = [];
  for (const board of boards)
    for (const tier of TIERS)
      for (const every of EVERY) {
        cells.push({ board, tier, every, median: resultFor(s, board, tier, every), spread: { [String(every)]: 1.1 + s.falloff }, seeds: tier === "max" ? 5 : 3, engineVersion: "mock" });
        if (tier === "max") for (let i = 0; i < 5; i++) seeds.push({ board, tier, every, seedIndex: i, result: resultFor(s, board, tier, every, [1, 0.94, 1.08, 0.97, 1.12][i]) });
      }
  return delay({
    id: s.id,
    title: s.title,
    description: s.description,
    author: s.author,
    boards,
    plots: s.plots,
    cycles: s.cycles,
    status: s.id === "mockChloro01" ? "pending" : "live",
    createdAt: ago(s.ageDays),
    updatedAt: ago(Math.max(0, s.ageDays - 1)),
    engineVersion: "mock",
    stale: !!s.stale,
    payload: payloadOf(s),
    cells,
    seeds,
  });
}

export function mockStatus(): Promise<FlowStatusResponse> {
  return delay({
    status: "pending",
    rejectReason: null,
    jobs: [
      { board: "ironman", tier: "max", priority: "A", status: "done", error: null },
      { board: "normal", tier: "max", priority: "A", status: "running", error: null },
      { board: "ironman", tier: "high", priority: "B", status: "queued", error: null },
    ],
  });
}

export function mockSubmit(): Promise<{ id: string; status: "pending" }> {
  return delay({ id: "mockChloro01", status: "pending" }, 600);
}
