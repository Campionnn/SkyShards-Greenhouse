/**
 * Runs the frequency sweep's (frequency, seed) jobs on a few Web Workers at once, streaming each
 * result as it finishes. `cancel()` terminates everything (Cancel, a new sweep, or unmount).
 */
import type { Scenario } from "../../../simulator";
import type { SweepRequest, SweepResponse } from "./protocol";
import type { SweepRun } from "./sweep";

export interface SweepJob {
  every: number;
  seed: number;
}

export interface SweepCallbacks {
  /** Fraction done (0..1) of job `index`. */
  onProgress?: (index: number, fraction: number) => void;
  onRun?: (index: number, run: SweepRun) => void;
}

/** What the pool needs from a Worker (a fake in tests). */
export interface SweepWorkerLike {
  postMessage(message: SweepRequest): void;
  onmessage: ((event: MessageEvent<SweepResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

/** `hardwareConcurrency - 1`, between 1 and 6. */
export function sweepPoolSize(cores: number | undefined = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency): number {
  const n = typeof cores === "number" && Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(6, n - 1));
}

const createWorker = (): SweepWorkerLike => new Worker(new URL("./sweep.worker.ts", import.meta.url), { type: "module" }) as unknown as SweepWorkerLike;

export class SweepPool {
  private workers = new Set<SweepWorkerLike>();
  private generation = 0;
  private rejectActive: ((e: Error) => void) | null = null;
  private readonly size: number;
  private readonly create: () => SweepWorkerLike;

  constructor(size = sweepPoolSize(), create: () => SweepWorkerLike = createWorker) {
    this.size = size;
    this.create = create;
  }

  /** Run every job; resolves with the runs in job order (rejects only when cancelled). */
  run(scenario: Scenario, cycles: number, jobs: readonly SweepJob[], cb: SweepCallbacks = {}): Promise<SweepRun[]> {
    this.cancel();
    const gen = ++this.generation;
    const runs: (SweepRun | undefined)[] = jobs.map(() => undefined);
    let next = 0;
    let finished = 0;
    return new Promise<SweepRun[]>((resolve, reject) => {
      this.rejectActive = reject;
      const live = () => gen === this.generation;
      const startOne = () => {
        if (!live()) return;
        const index = next++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        const worker = this.create();
        this.workers.add(worker);
        const done = (r: SweepRun) => {
          worker.terminate();
          this.workers.delete(worker);
          if (!live()) return;
          runs[index] = r;
          cb.onProgress?.(index, 1);
          cb.onRun?.(index, r);
          finished++;
          if (finished === jobs.length) {
            this.rejectActive = null;
            resolve(runs as SweepRun[]);
          } else startOne();
        };
        worker.onmessage = (event) => {
          const m = event.data;
          if (m.type === "progress") {
            if (live()) cb.onProgress?.(index, m.total ? m.done / m.total : 0);
          } else done(m.run);
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          done({ every: job.every, seed: job.seed, ok: false, error: event.message || "The worker crashed.", summary: null });
        };
        worker.postMessage({ reqId: index, scenario, every: job.every, seed: job.seed, cycles });
      };
      if (jobs.length === 0) {
        this.rejectActive = null;
        resolve([]);
        return;
      }
      for (let i = 0; i < Math.min(this.size, jobs.length); i++) startOne();
    });
  }

  cancel(): void {
    this.generation++;
    for (const w of this.workers) w.terminate();
    this.workers.clear();
    const reject = this.rejectActive;
    this.rejectActive = null;
    reject?.(new Error("cancelled"));
  }
}
