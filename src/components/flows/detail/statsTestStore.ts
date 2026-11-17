import { useSyncExternalStore } from "react";
import type { CellKind, Submission } from "../../../leaderboard/rules";
import type { StatsTestOutcome } from "../../../leaderboard/statsTest";
import type { PlayerStats } from "../../../simulator";
import { randomSeeds } from "../../../leaderboard/worker/pool";
import { WALL_MS_BACKSTOP } from "../../../leaderboard/verify";
import { StatsTestPool, type StatsJob } from "../../../leaderboard/worker/statsPool";

/**
 * "Test with your stats" on /flows/:id: one test at a time, kept outside React so it keeps running
 * (and its result stays) when the viewer switches tabs. Jobs go seed-major so every frequency fills
 * in together.
 */

export interface StatsTest {
  flowId: string;
  /** What the test depends on (flow, number, stats, frequencies, seeds); a different key = stale. */
  key: string;
  kind: CellKind;
  everys: number[];
  seeds: number;
  jobs: { every: number; seed: number }[];
  progress: number[];
  outcomes: (StatsTestOutcome | undefined)[];
  running: boolean;
  error: string | null;
  startedAt: number;
}

let current: StatsTest | null = null;
let pool: StatsTestPool | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let pending: ReturnType<typeof setTimeout> | null = null;
/** Coalesce the many progress updates into one render every 200 ms. */
const emitSoon = () => {
  pending ??= setTimeout(() => {
    pending = null;
    emit();
  }, 200);
};
const patch = (f: (t: StatsTest) => StatsTest) => {
  if (current) current = f(current);
};

export function statsTestKey(flowId: string, kind: CellKind, stats: PlayerStats, everys: readonly number[], seeds: number, cycles: number): string {
  return JSON.stringify([flowId, kind, stats, everys, seeds, cycles]);
}

export function startStatsTest(args: { flowId: string; key: string; submission: Submission; kind: CellKind; stats: PlayerStats; everys: number[]; seeds: number; cycles: number }): void {
  pool?.cancel();
  pool = new StatsTestPool();
  const seeds = randomSeeds(args.seeds);
  const jobs = seeds.flatMap((seed) => args.everys.map((every) => ({ every, seed })));
  const specs: StatsJob[] = jobs.map((j) => ({ submission: args.submission, kind: args.kind, stats: args.stats, every: j.every, seed: j.seed, cycles: args.cycles, wallMs: WALL_MS_BACKSTOP }));
  current = {
    flowId: args.flowId,
    key: args.key,
    kind: args.kind,
    everys: args.everys,
    seeds: args.seeds,
    jobs,
    progress: jobs.map(() => 0),
    outcomes: jobs.map(() => undefined),
    running: true,
    error: null,
    startedAt: Date.now(),
  };
  emit();
  const mine = pool;
  mine
    .run(specs, {
      onProgress: (i, f) => {
        patch((t) => {
          if (t.progress[i] === f) return t;
          const progress = [...t.progress];
          progress[i] = f;
          return { ...t, progress };
        });
        emitSoon();
      },
      onOutcome: (i, o) => {
        patch((t) => {
          const outcomes = [...t.outcomes];
          outcomes[i] = o;
          return { ...t, outcomes };
        });
        emitSoon();
      },
    })
    .then(() => {
      if (pool !== mine) return;
      patch((t) => ({ ...t, running: false }));
      emit();
    })
    .catch((e: unknown) => {
      if (pool !== mine) return;
      patch((t) => ({ ...t, running: false, error: e instanceof Error && e.message === "cancelled" ? "Stopped." : String(e) }));
      emit();
    });
}

export function stopStatsTest(): void {
  pool?.cancel();
}

export function clearStatsTest(): void {
  pool?.cancel();
  pool = null;
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The test for this flow (null when none, or another flow's). */
export function useStatsTest(flowId: string): StatsTest | null {
  const t = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return t && t.flowId === flowId ? t : null;
}
