/**
 * Local solver client (SkyShards-Solver on 127.0.0.1:8765) with an on-disk cache,
 * so re-running the generator never re-solves a layout it already has.
 *
 * Only used while DESIGNING layouts (tools/rose-dragon/design.ts). The generated
 * flow stores plain share codes; nothing at runtime talks to the solver.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, "cache");
const BASE = process.env.SOLVER_URL ?? "http://127.0.0.1:8765";

export interface Goal {
  mutation: string;
  maximize?: boolean;
  count?: number | null;
}

export interface Lock {
  name: string;
  size: number;
  position: [number, number];
}

export interface SolveRequest {
  /** Cells the solver may use; default: the whole 10x10 plot. */
  cells?: [number, number][];
  targets: Goal[];
  priorities?: Record<string, number>;
  locks?: Lock[];
  timeLimit?: number;
  /** Value of an effect on a spawned target (e.g. improved_harvest_boost: 0.3); negatives take negative weights. */
  effectWeights?: Record<string, number>;
  /** Minimum distinct crop groups on the grid. */
  uniqueCrops?: number;
}

export interface SolveResult {
  status: string;
  placements: { crop: string; position: [number, number]; size: number }[];
  mutations: { mutation: string; position: [number, number]; size: number }[];
  score?: number;
}

export const ALL_CELLS: [number, number][] = Array.from({ length: 100 }, (_, i) => [Math.floor(i / 10), i % 10]);

/** Cells inside a rectangle (inclusive rows/cols). */
export function rect(r0: number, c0: number, r1: number, c1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([r, c]);
  return out;
}

/** Default crop priorities (public/greenhouse/default_priorities.json): the solver's tie-break, lower = cheaper. */
export function defaultPriorities(): Record<string, number> {
  const p = join(HERE, "..", "..", "public", "greenhouse", "default_priorities.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Cache files read or written by this process (cli-generate --prune deletes the others). */
export const usedCacheFiles = new Set<string>();
export const CACHE_PATH = CACHE_DIR;

// At most 2 solves at a time: the local solver shares its threads between jobs.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export async function solve(req: SolveRequest): Promise<SolveResult> {
  return slot(() => solveNow(req));
}

async function solveNow(req: SolveRequest): Promise<SolveResult> {
  const body = {
    cells: req.cells ?? ALL_CELLS,
    targets: req.targets.map((t) => ({ mutation: t.mutation, maximize: !!t.maximize, count: t.maximize ? null : t.count ?? 1 })),
    priorities: req.priorities ?? defaultPriorities(),
    locks: req.locks ?? [],
    effect_weights: req.effectWeights ?? {},
    ...(req.uniqueCrops ? { unique_crops: req.uniqueCrops } : {}),
  };
  const timeLimit = req.timeLimit ?? 20;
  const key = createHash("sha1").update(JSON.stringify({ body, timeLimit })).digest("hex").slice(0, 16);
  const file = join(CACHE_DIR, `${key}.json`);
  usedCacheFiles.add(`${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).result as SolveResult;

  const res = await fetch(`${BASE}/greenhouse/solver?time_limit=${timeLimit}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`solver HTTP ${res.status}: ${await res.text()}`);
  const result = (await res.json()) as SolveResult;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify({ request: body, timeLimit, result }, null, 1));
  return result;
}
