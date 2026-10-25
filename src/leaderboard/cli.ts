import { parseBazaar, type BazaarQuote } from "../simulator/economy/bazaar";
import type { ItemId } from "../simulator/data/types";
import { createEngine } from "../simulator/engine";
import { checkSubmission, clampCycles, parseSubmission, RUN_KINDS, runKindFrom, type RunKind } from "./rules";
import { summarizeSubmission } from "./summary";
import { EVERY, TIERS, type TierId } from "./tiers";
import { CPU_MS_BACKSTOP, outlierCheck, verifyJob, WALL_MS_BACKSTOP, type VerifyRun } from "./verify";

/**
 * The verifier CLI (docs/plans/flow-leaderboard.md §5.3, §6.2, docs/plans/leaderboard-boards-v2.md).
 * One JSON request on stdin, one JSON reply on stdout, progress lines on stderr. Bundled by
 * scripts/build-verify.mjs into a self-contained `verify.mjs` that the API runs as a subprocess;
 * `ENGINE_VERSION` is baked in by the bundler (a hash of the bundle's engine sources).
 *
 * Requests:
 *   {mode: "version"}
 *     -> {engineVersion, every, tiers, runKinds}
 *   {mode: "check", payload}
 *     -> {ok, errors, warnings, plots, bytes, summary: FlowSummary | null}  (summary.ts)
 *   {mode: "verify", payload, runKind, tier, cycles, runs: [{every, seed, seedIndex}], wallMsPerRun?, cpuMsPerRun?, scriptStepsPerRun?,
 *     bazaar?: {item: {buy, sell}} | raw Hypixel response | null, outlierRatio?}
 *     -> {engineVersion, runKind, results: [{every, seedIndex, seed, ok, error, result, wallMs, cpuMs}], outlier?}
 *   `runKind` is strict | borrow | normal; old requests may send `board` instead (ironman = strict).
 *   `cycles` is the author's length; each run simulates it plus the secret end window (rules.ts endCycles).
 */

declare const __ENGINE_VERSION__: string | undefined;
export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ === "string" ? __ENGINE_VERSION__ : "dev";

export interface CliRequest {
  mode: "version" | "check" | "verify";
  payload?: unknown;
  runKind?: RunKind;
  /** Old requests: a board name (`ironman` = strict). */
  board?: string;
  tier?: TierId;
  cycles?: number;
  runs?: VerifyRun[];
  wallMsPerRun?: number;
  cpuMsPerRun?: number;
  scriptStepsPerRun?: number;
  bazaar?: unknown;
  outlierRatio?: number;
}

/**
 * Per-run caps. The deciding one is the deterministic script step cap (same verdict on any
 * machine); CPU and wall time are generous backstops only.
 */
const DEFAULT_CPU_MS = CPU_MS_BACKSTOP;
const DEFAULT_WALL_MS = WALL_MS_BACKSTOP;
const DEFAULT_OUTLIER_RATIO = 2;

/** Accept `{item: {buy, sell}}` (the API's snapshot) or a raw `/v2/skyblock/bazaar` body. */
function readQuotes(raw: unknown): Record<ItemId, BazaarQuote> {
  if (!raw || typeof raw !== "object") return {};
  const body = raw as Record<string, unknown>;
  if (body.success === true && body.products) return parseBazaar(raw).quotes;
  const out: Record<ItemId, BazaarQuote> = {};
  for (const [item, q] of Object.entries(body)) {
    if (!q || typeof q !== "object") continue;
    const { buy, sell } = q as { buy?: unknown; sell?: unknown };
    out[item] = {
      lowestSellOffer: typeof buy === "number" && buy > 0 ? buy : null,
      highestBuyOrder: typeof sell === "number" && sell > 0 ? sell : null,
    };
  }
  return out;
}

export function handle(req: CliRequest, progress: (line: string) => void = () => {}): unknown {
  const engine = createEngine();
  switch (req.mode) {
    case "version":
      return { engineVersion: ENGINE_VERSION, every: [...EVERY], tiers: [...TIERS], runKinds: [...RUN_KINDS] };
    case "check": {
      const parsed = parseSubmission(req.payload);
      if (!parsed.submission) return { ok: false, errors: parsed.errors, warnings: [], plots: 0, bytes: 0, summary: null };
      const check = checkSubmission(parsed.submission, engine.data);
      return { ...check, summary: check.ok ? summarizeSubmission(parsed.submission, engine.data) : null };
    }
    case "verify": {
      const parsed = parseSubmission(req.payload);
      if (!parsed.submission) throw new Error(`invalid payload: ${parsed.errors.join("; ")}`);
      const check = checkSubmission(parsed.submission, engine.data);
      if (!check.ok) throw new Error(`submission fails the rules: ${check.errors.join("; ")}`);
      const runKind = runKindFrom(req.runKind ?? req.board);
      const tier = req.tier;
      if (!runKind) throw new Error(`runKind must be one of ${RUN_KINDS.join(", ")}`);
      if (!tier || !TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(", ")}`);
      const runs = Array.isArray(req.runs) ? req.runs : [];
      for (const r of runs) {
        if (!Number.isInteger(r.every) || r.every < 1 || !Number.isInteger(r.seed) || !Number.isInteger(r.seedIndex)) throw new Error("each run needs integer every, seed and seedIndex");
      }
      const job = {
        submission: parsed.submission,
        runKind,
        tier,
        cycles: clampCycles(req.cycles),
        runs,
        wallMsPerRun: typeof req.wallMsPerRun === "number" && req.wallMsPerRun > 0 ? req.wallMsPerRun : DEFAULT_WALL_MS,
        cpuMsPerRun: typeof req.cpuMsPerRun === "number" && req.cpuMsPerRun > 0 ? req.cpuMsPerRun : DEFAULT_CPU_MS,
        scriptStepsPerRun: typeof req.scriptStepsPerRun === "number" && req.scriptStepsPerRun > 0 ? req.scriptStepsPerRun : undefined,
      };
      const results = verifyJob(engine, job, (done, total) => progress(`progress ${done}/${total}`));
      const quotes = readQuotes(req.bazaar);
      const outlier = outlierCheck(engine, results, runKind, quotes, typeof req.outlierRatio === "number" ? req.outlierRatio : DEFAULT_OUTLIER_RATIO);
      return { engineVersion: ENGINE_VERSION, runKind, results, outlier };
    }
    default:
      throw new Error(`unknown mode "${(req as { mode?: unknown }).mode}"`);
  }
}

/** Node entry: stdin -> stdout. Exit code 1 on an error (the message is written as JSON on stdout). */
export async function main(stdin: NodeJS.ReadableStream, stdout: { write(s: string): unknown }, stderr: { write(s: string): unknown }): Promise<number> {
  const chunks: string[] = [];
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) chunks.push(chunk as string);
  let req: CliRequest;
  try {
    req = JSON.parse(chunks.join("")) as CliRequest;
  } catch {
    stdout.write(JSON.stringify({ error: "stdin is not valid JSON" }) + "\n");
    return 1;
  }
  try {
    const reply = handle(req, (line) => stderr.write(line + "\n"));
    stdout.write(JSON.stringify(reply) + "\n");
    return 0;
  } catch (e) {
    stdout.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + "\n");
    return 1;
  }
}
