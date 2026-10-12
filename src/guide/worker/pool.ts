/**
 * A small worker pool that streams forecast runs.
 *
 * Seeds are independent, so each is its own request and whichever worker is free takes the next.
 * Results arrive as they finish (`onProgress`). A new forecast cancels the previous one: pending
 * seeds are dropped, and workers still busy with a stale seed are terminated and replaced, so a
 * changed check-in never waits behind obsolete work. Finished forecasts are cached by input.
 */
import type { FlowsFile } from "../flow";
import type { GuideInput, RunTimeline } from "../types";
import { inputKey, type GuideRequest, type GuideResponse } from "./protocol";

/** `hardwareConcurrency - 1`, capped at 6, never below 1. */
export function poolSize(cores: number | undefined = typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency): number {
  const n = typeof cores === "number" && Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(6, n - 1));
}

export interface ForecastProgress {
  done: number;
  total: number;
  /** Finished runs so far, in seed order. */
  timelines: RunTimeline[];
}

export interface ForecastRequest {
  flow: FlowsFile;
  input: GuideInput;
  seeds: number[];
  maxCycles?: number;
  onProgress?: (progress: ForecastProgress) => void;
}

/** What the pool needs from a Worker (a fake one in tests). */
export interface WorkerLike {
  postMessage(message: GuideRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<GuideResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface Slot {
  worker: WorkerLike;
  job: { reqId: number; seed: number; generation: number } | null;
}

export class ForecastCancelled extends Error {
  constructor() {
    super("Forecast cancelled.");
    this.name = "ForecastCancelled";
  }
}

const MAX_CACHE = 8;

export class GuidePool {
  readonly size: number;
  private readonly create: () => WorkerLike;
  private slots: Slot[] = [];
  private flow: FlowsFile | null = null;
  private generation = 0;
  private reqId = 0;
  private cache = new Map<string, RunTimeline[]>();
  private active: {
    generation: number;
    queue: number[];
    results: Map<number, RunTimeline>;
    request: ForecastRequest;
    resolve: (runs: RunTimeline[]) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(size = poolSize(), create: () => WorkerLike = () => new Worker(new URL("./guide.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike) {
    this.size = size;
    this.create = create;
  }

  private spawn(): Slot {
    const slot: Slot = { worker: this.create(), job: null };
    slot.worker.addEventListener("message", (event: MessageEvent<GuideResponse>) => this.onMessage(slot, event.data));
    slot.worker.addEventListener("error", (event: ErrorEvent) => this.fail(slot, new Error(event.message || "The forecast worker crashed.")));
    if (this.flow) slot.worker.postMessage({ type: "flow", flow: this.flow });
    return slot;
  }

  private ensure(flow: FlowsFile): void {
    if (this.flow !== flow) {
      this.flow = flow;
      for (const slot of this.slots) slot.worker.postMessage({ type: "flow", flow });
    }
    while (this.slots.length < this.size) this.slots.push(this.spawn());
  }

  /** Run every seed. Resolves with the runs in seed order; rejects with ForecastCancelled when superseded. */
  forecast(request: ForecastRequest): Promise<RunTimeline[]> {
    this.cancel();
    const key = inputKey(request.input, request.seeds);
    const cached = this.cache.get(key);
    if (cached) {
      request.onProgress?.({ done: cached.length, total: cached.length, timelines: cached });
      return Promise.resolve(cached);
    }
    this.ensure(request.flow);
    const generation = ++this.generation;
    return new Promise<RunTimeline[]>((resolve, reject) => {
      this.active = {
        generation,
        queue: [...request.seeds],
        results: new Map(),
        request,
        resolve: (runs) => {
          if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, runs);
          resolve(runs);
        },
        reject,
      };
      for (const slot of this.slots) this.dispatch(slot);
    });
  }

  private dispatch(slot: Slot): void {
    const active = this.active;
    if (!active || slot.job) return;
    const seed = active.queue.shift();
    if (seed === undefined) return;
    const reqId = ++this.reqId;
    slot.job = { reqId, seed, generation: active.generation };
    slot.worker.postMessage({ type: "seed", reqId, input: active.request.input, seed, maxCycles: active.request.maxCycles });
  }

  private onMessage(slot: Slot, response: GuideResponse): void {
    const job = slot.job;
    if (!job || job.reqId !== response.reqId) return;
    slot.job = null;
    const active = this.active;
    if (!active || active.generation !== job.generation) return;
    if (response.type === "error") {
      this.fail(slot, new Error(response.message));
      return;
    }
    active.results.set(response.seed, response.timeline);
    const ordered = [...active.results].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
    active.request.onProgress?.({ done: ordered.length, total: active.request.seeds.length, timelines: ordered });
    if (ordered.length === active.request.seeds.length) {
      this.active = null;
      active.resolve(ordered);
      return;
    }
    this.dispatch(slot);
  }

  private fail(slot: Slot, error: Error): void {
    slot.job = null;
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.reject(error);
  }

  /** Drop the current forecast and replace any worker still busy with it. */
  cancel(): void {
    const active = this.active;
    this.active = null;
    if (active) active.reject(new ForecastCancelled());
    this.slots = this.slots.map((slot) => {
      if (!slot.job) return slot;
      slot.worker.terminate();
      return this.spawn();
    });
  }

  dispose(): void {
    this.cancel();
    for (const slot of this.slots) slot.worker.terminate();
    this.slots = [];
    this.cache.clear();
  }
}
