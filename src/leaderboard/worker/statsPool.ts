/**
 * Runs "Test with your stats" seeds on a few reused Web Workers, streaming outcomes as they finish.
 * `cancel()` terminates everything (Stop, a new test, or leaving the page).
 */
import type { StatsTestOutcome, StatsTestRequest } from "../statsTest";
import type { StatsTestResponse } from "./statsTest.worker";

export interface StatsWorkerLike {
  postMessage(message: StatsTestRequest): void;
  onmessage: ((event: MessageEvent<StatsTestResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export function statsPoolSize(cores: number | undefined = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency): number {
  const n = typeof cores === "number" && Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(8, n - 1));
}

const createWorker = (): StatsWorkerLike => new Worker(new URL("./statsTest.worker.ts", import.meta.url), { type: "module" }) as unknown as StatsWorkerLike;

export type StatsJob = Omit<StatsTestRequest, "reqId">;

export class StatsTestPool {
  private workers = new Set<StatsWorkerLike>();
  private generation = 0;
  private rejectActive: ((e: Error) => void) | null = null;
  private readonly size: number;
  private readonly create: () => StatsWorkerLike;

  constructor(size = statsPoolSize(), create: () => StatsWorkerLike = createWorker) {
    this.size = size;
    this.create = create;
  }

  run(jobs: readonly StatsJob[], cb: { onProgress?: (i: number, f: number) => void; onOutcome?: (i: number, o: StatsTestOutcome) => void } = {}): Promise<StatsTestOutcome[]> {
    this.cancel();
    const gen = ++this.generation;
    const out: (StatsTestOutcome | undefined)[] = jobs.map(() => undefined);
    let next = 0;
    let finished = 0;
    return new Promise((resolve, reject) => {
      this.rejectActive = reject;
      const live = () => gen === this.generation;
      const retire = (w: StatsWorkerLike) => {
        w.terminate();
        this.workers.delete(w);
      };
      const feed = (w: StatsWorkerLike) => {
        if (!live()) return;
        const index = next++;
        if (index >= jobs.length) return retire(w);
        const job = jobs[index];
        let settled = false;
        const done = (o: StatsTestOutcome, crashed: boolean) => {
          if (settled || !live()) return;
          settled = true;
          out[index] = o;
          cb.onProgress?.(index, 1);
          cb.onOutcome?.(index, o);
          finished++;
          if (crashed) retire(w);
          if (finished === jobs.length) {
            this.rejectActive = null;
            for (const x of this.workers) x.terminate();
            this.workers.clear();
            resolve(out as StatsTestOutcome[]);
          } else if (crashed) spawn();
          else feed(w);
        };
        w.onmessage = (e) => {
          const m = e.data;
          if (m.reqId !== index) return;
          if (m.type === "progress") {
            if (live()) cb.onProgress?.(index, m.total ? m.done / m.total : 0);
          } else done(m.outcome, false);
        };
        w.onerror = (e) => {
          e.preventDefault?.();
          done({ every: job.every, seed: job.seed, ok: false, error: e.message || "The test worker crashed.", result: null, wallMs: 0 }, true);
        };
        w.postMessage({ ...job, reqId: index });
      };
      const spawn = () => {
        if (!live() || next >= jobs.length) return;
        const w = this.create();
        this.workers.add(w);
        feed(w);
      };
      if (!jobs.length) {
        this.rejectActive = null;
        resolve([]);
        return;
      }
      for (let i = 0; i < Math.min(this.size, jobs.length); i++) spawn();
    });
  }

  cancel(): void {
    this.generation++;
    for (const w of this.workers) w.terminate();
    this.workers.clear();
    const r = this.rejectActive;
    this.rejectActive = null;
    r?.(new Error("cancelled"));
  }
}
