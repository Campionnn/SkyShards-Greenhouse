/**
 * A tiny pool for the submit dialog's local seed test: one Web Worker per seed (up to `size` at
 * once), results streamed as they finish. `cancel()` terminates everything (dialog closed or the
 * test restarted).
 */
import type { RunResult } from "../result";
import type { LocalTestRequest, LocalTestResponse } from "./protocol";

export interface SeedOutcome {
  seed: number;
  ok: boolean;
  error: string | null;
  result: RunResult | null;
  wallMs: number;
}

export interface LocalTestCallbacks {
  /** Fraction done per seed index (0..1). */
  onProgress?: (index: number, fraction: number) => void;
  onSeed?: (index: number, outcome: SeedOutcome) => void;
}

/** What the pool needs from a Worker (a fake in tests). */
export interface TestWorkerLike {
  postMessage(message: LocalTestRequest): void;
  onmessage: ((event: MessageEvent<LocalTestResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export function testPoolSize(cores: number | undefined = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency): number {
  const n = typeof cores === "number" && Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(5, n - 1));
}

const createWorker = (): TestWorkerLike => new Worker(new URL("./localTest.worker.ts", import.meta.url), { type: "module" }) as unknown as TestWorkerLike;

export class LocalTestPool {
  private workers = new Set<TestWorkerLike>();
  private cancelled = false;
  private readonly size: number;
  private readonly create: () => TestWorkerLike;

  constructor(size = testPoolSize(), create: () => TestWorkerLike = createWorker) {
    this.size = size;
    this.create = create;
  }

  /** Run every seed; resolves with the outcomes in seed order (rejects only when cancelled). */
  run(base: Omit<LocalTestRequest, "reqId" | "seed">, seeds: number[], cb: LocalTestCallbacks = {}): Promise<SeedOutcome[]> {
    this.cancel();
    this.cancelled = false;
    const outcomes: (SeedOutcome | undefined)[] = seeds.map(() => undefined);
    let next = 0;
    let finished = 0;
    return new Promise<SeedOutcome[]>((resolve, reject) => {
      const startOne = () => {
        if (this.cancelled) return;
        const index = next++;
        if (index >= seeds.length) return;
        const worker = this.create();
        this.workers.add(worker);
        const done = (o: SeedOutcome) => {
          worker.terminate();
          this.workers.delete(worker);
          if (this.cancelled) return;
          outcomes[index] = o;
          cb.onProgress?.(index, 1);
          cb.onSeed?.(index, o);
          finished++;
          if (finished === seeds.length) resolve(outcomes as SeedOutcome[]);
          else startOne();
        };
        worker.onmessage = (event) => {
          const m = event.data;
          if (m.type === "progress") cb.onProgress?.(index, m.total ? m.done / m.total : 0);
          else done({ seed: seeds[index], ok: m.ok, error: m.error, result: m.result, wallMs: m.wallMs });
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          done({ seed: seeds[index], ok: false, error: event.message || "The test worker crashed.", result: null, wallMs: 0 });
        };
        worker.postMessage({ ...base, reqId: index, seed: seeds[index] });
      };
      this.rejectActive = reject;
      for (let i = 0; i < Math.min(this.size, seeds.length); i++) startOne();
      if (seeds.length === 0) resolve([]);
    });
  }

  private rejectActive: ((e: Error) => void) | null = null;

  cancel(): void {
    this.cancelled = true;
    for (const w of this.workers) w.terminate();
    this.workers.clear();
    const reject = this.rejectActive;
    this.rejectActive = null;
    reject?.(new Error("cancelled"));
  }
}

/** Five random 31-bit seeds. */
export function randomSeeds(n = 5): number[] {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 2 ** 31));
}
