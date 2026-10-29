import { DEFAULT_CONFIG, type SimConfig } from "../simulator/config";
import type { GameData } from "../simulator/data/types";
import { DEFAULT_POLICIES, mergePolicies } from "../simulator/flow/policies";
import type { Policies, PolicyOverrides } from "../simulator/flow/types";
import { MAX_PLOTS, validateScenario, type ScenarioIssue } from "../simulator/flow/validate";
import { migrateScenario } from "../simulator/migrate";
import { defaultSettings } from "../simulator/scenario";
import type { Scenario, ScenarioPlot, Settings } from "../simulator/sim/state";
import { identifierUses } from "../simulator/script/check";
import { DEBUG_SCRIPT_APIS } from "../simulator/script/overrides";
import type { ScriptDef } from "../simulator/script/types";
import { activityEvery, tierStats, type TierId } from "./tiers";

/**
 * The leaderboard rules (docs/plans/flow-leaderboard.md §4, docs/plans/leaderboard-boards-v2.md):
 * what a submission may contain and the settings every verification run uses. Shared by the
 * server CLI (which enforces them) and the page (which previews them and applies them locally
 * with "Apply leaderboard rules").
 *
 * A submission is a flows file (`skyshards-greenhouse-flows`, v1 or v2): `plots` (flows, steps,
 * layouts, triggers, watch lists, policy overrides, plot scripts), the controller `script` and
 * `settings.policies` (action defaults). Everything else in the file is ignored: the server sets
 * the seed, online schedule, player stats, starting inventory, config and profile per run.
 *
 * Every flow is verified under three run kinds, one per board, and appears on all three boards:
 * - `strict` ("Ironman · from nothing"): empty inventory, the starting layouts paid from it, no
 *   borrowing ever; a missing item leaves its cell empty.
 * - `borrow` ("Ironman · with starting items"): empty inventory, but any mutation item can be
 *   placed before it is owned (the stock goes negative). Results show the starting items it needs.
 * - `normal` ("Normal"): the normal profile; free starting layouts (their cost shown as the build
 *   cost), shortfalls bought on the Bazaar, surplus sold.
 */

export type RunKind = "strict" | "borrow" | "normal";
export const RUN_KINDS: readonly RunKind[] = ["strict", "borrow", "normal"];

/** The three boards, one per run kind. */
export type Board = "ironman_strict" | "ironman_borrow" | "normal";
export const BOARDS: readonly Board[] = ["ironman_strict", "ironman_borrow", "normal"];
export const BOARD_RUN_KIND: Readonly<Record<Board, RunKind>> = { ironman_strict: "strict", ironman_borrow: "borrow", normal: "normal" };
export const RUN_KIND_BOARD: Readonly<Record<RunKind, Board>> = { strict: "ironman_strict", borrow: "ironman_borrow", normal: "normal" };

/** A board from a URL, an old client or an old entry: `ironman` (the one ironman board before v2) is `ironman_strict`. */
export function boardFrom(raw: unknown): Board | null {
  if (raw === "ironman") return "ironman_strict";
  return BOARDS.includes(raw as Board) ? (raw as Board) : null;
}

/** A run kind from a request: a run kind, or a board name (old clients send `board`). */
export function runKindFrom(raw: unknown): RunKind | null {
  if (RUN_KINDS.includes(raw as RunKind)) return raw as RunKind;
  const board = boardFrom(raw);
  return board ? BOARD_RUN_KIND[board] : null;
}

/** Ironman boards are priced at NPC prices (mutation items 0); normal at the Bazaar. */
export const isIronmanBoard = (b: Board): boolean => b !== "normal";

export const MIN_CYCLES = 2000;
export const MAX_CYCLES = 5000;
export const DEFAULT_CYCLES = 2000;
/** Serialized submission payload size cap (bytes of JSON). */
export const MAX_PAYLOAD_BYTES = 256 * 1024;
/** Ironman: placed supplies with an unlimited supply. */
export const IRONMAN_FREE_ITEMS: readonly string[] = ["dead_plant", "fermento"];

/**
 * The secret end window (plan §4.3). Each seed runs to `endCycles(C) = ceil(C × END_WINDOW)`
 * cycles, C being the author's length. The score is the mean of the per-day rates at the cut
 * points C, C + CUT_STEP, ... (up to the end): scripts can't see where the run is judged.
 * Mirrored in SkyShards-API leaderboard/config.py.
 */
export const END_WINDOW = 1.25;
export const CUT_STEP = 25;
/**
 * "Still producing": a seed whose rate over the last TRAIL_SHARE of the run is below TRAIL_MIN ×
 * its window-mean rate is slowing down; a cell where most seeds are is scored at the trailing rate.
 */
export const TRAIL_SHARE = 0.2;
export const TRAIL_MIN = 0.6;

/** Cycles one verification run simulates for a scored length of `cycles` (the author's, clamped by the caller). */
export const endCycles = (cycles: number): number => Math.ceil(Math.max(1, Math.floor(cycles)) * END_WINDOW);

export const FLOWS_FILE_KIND = "skyshards-greenhouse-flows";

/** What a submission carries, after normalisation. */
export interface Submission {
  plots: ScenarioPlot[];
  script?: ScriptDef;
  policies: Policies;
}

/** The flows file a submission is sent as (a v2 file with only the allowed sections). */
export interface SubmissionFile {
  kind: typeof FLOWS_FILE_KIND;
  version: 2;
  plots: ScenarioPlot[];
  script?: ScriptDef;
  settings: { policies: Policies };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function readScript(raw: unknown, where: string, errors: string[]): ScriptDef | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || typeof raw.source !== "string") {
    errors.push(`${where}: expected { source: "..." }.`);
    return undefined;
  }
  if (!raw.source.trim()) return undefined;
  return raw.enabled === false ? { source: raw.source, enabled: false } : { source: raw.source };
}

const POLICY_CHOICES: Record<string, readonly string[]> = {
  spawnedHarvest: ["whenFullyGrown", "beforeDecay", "never"],
  layoutInputSpawns: ["keep", "harvest"],
  baseCropUpkeep: ["leaveUntilDecay", "harvestWhenGrown", "harvestBeforeDecay"],
  watering: ["toMax", "never"],
  placedUpkeep: ["leaveUntilDecay", "replaceBeforeDecay"],
};
const POLICY_BOOLEANS = ["replaceDecayed", "fixGround", "clearTargetBlockers", "onlyReplaceForEmptyTargets"] as const;

/** Keep only known policy keys with valid values; drop the rest (never throws). */
export function sanitizePolicies(raw: unknown): PolicyOverrides {
  if (!isRecord(raw)) return {};
  const out: PolicyOverrides = {};
  for (const [key, allowed] of Object.entries(POLICY_CHOICES)) {
    const v = raw[key];
    if (typeof v === "string" && allowed.includes(v)) (out as Record<string, unknown>)[key] = v;
  }
  for (const key of POLICY_BOOLEANS) if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  if (isRecord(raw.gateInteractions)) {
    const gates: Partial<Policies["gateInteractions"]> = {};
    for (const key of Object.keys(DEFAULT_POLICIES.gateInteractions) as (keyof Policies["gateInteractions"])[]) {
      if (typeof raw.gateInteractions[key] === "boolean") gates[key] = raw.gateInteractions[key] as boolean;
    }
    if (Object.keys(gates).length) out.gateInteractions = gates;
  }
  return out;
}

export interface ParsedSubmission {
  submission: Submission | null;
  errors: string[];
}

/**
 * Read a submission from flows-file JSON (already parsed). Structural checks only; game checks
 * (`validateScenario`) happen in `checkSubmission`. Unknown sections are dropped, not rejected,
 * so an export with Player settings or Advanced config still submits (those are the server's).
 */
export function parseSubmission(raw: unknown): ParsedSubmission {
  const errors: string[] = [];
  const file = migrateScenario(raw) as unknown;
  if (!isRecord(file)) return { submission: null, errors: ["Expected an exported flows file."] };
  if (file.kind !== undefined && file.kind !== FLOWS_FILE_KIND) errors.push("Not a SkyShards flows file.");
  const plots = file.plots;
  if (!Array.isArray(plots) || plots.length === 0) return { submission: null, errors: [...errors, "No plots found. Export your flows from the simulator."] };
  if (plots.length > MAX_PLOTS) errors.push(`At most ${MAX_PLOTS} plots; the file has ${plots.length}.`);
  const seen = new Set<number>();
  const clean: ScenarioPlot[] = [];
  plots.forEach((p: unknown, i: number) => {
    const where = `Plot ${i + 1}`;
    if (!isRecord(p)) return errors.push(`${where} is not an object.`);
    const id = p.id;
    if (![1, 2, 3].includes(id as number) || seen.has(id as number)) return errors.push(`${where}: id must be a unique 1, 2 or 3.`);
    seen.add(id as number);
    const flow = p.flow;
    const steps = isRecord(flow) ? flow.steps : undefined;
    if (!Array.isArray(steps) || steps.length === 0) return errors.push(`${where}: no steps.`);
    for (const [j, s] of steps.entries()) {
      if (!isRecord(s) || typeof s.id !== "string" || !s.layout || !Array.isArray(s.exits)) {
        return errors.push(`${where}, step ${j + 1}: needs an id, a layout and an exits list.`);
      }
    }
    const f = flow as Record<string, unknown>;
    const cleanSteps = structuredClone(steps) as ScenarioPlot["flow"]["steps"];
    // Step-level policy overrides get the same cleaning as the plot's and the defaults.
    for (const s of cleanSteps) {
      if (!("policies" in s)) continue;
      const policies = sanitizePolicies(s.policies);
      if (Object.keys(policies).length) s.policies = policies;
      else delete s.policies;
    }
    const plot: ScenarioPlot = {
      id: id as number,
      flow: {
        steps: cleanSteps,
        loop: !!f.loop,
        startIndex: Math.min(Math.max(0, Math.floor(Number(f.startIndex) || 0)), steps.length - 1),
      },
    };
    const policies = sanitizePolicies(p.policies);
    if (Object.keys(policies).length) plot.policies = policies;
    const script = readScript(p.script, `${where} script`, errors);
    if (script) plot.script = script;
    clean.push(plot);
  });
  if (errors.length) return { submission: null, errors };
  const submission: Submission = {
    plots: clean.sort((a, b) => a.id - b.id),
    policies: mergePolicies(DEFAULT_POLICIES, sanitizePolicies(isRecord(file.settings) ? file.settings.policies : undefined)),
  };
  const script = readScript(file.script, "Controller script", errors);
  if (errors.length) return { submission: null, errors };
  if (script) submission.script = script;
  return { submission, errors: [] };
}

/** Build the submission from a scenario in the simulator (the page's Submit dialog). */
export function submissionFromScenario(sc: Scenario): Submission {
  const out: Submission = {
    plots: structuredClone(sc.plots),
    policies: mergePolicies(DEFAULT_POLICIES, sanitizePolicies(sc.settings.policies)),
  };
  if (sc.script?.source.trim()) out.script = structuredClone(sc.script);
  return out;
}

/** The flows file a submission travels as. */
export function submissionFile(s: Submission): SubmissionFile {
  const file: SubmissionFile = { kind: FLOWS_FILE_KIND, version: 2, plots: s.plots, settings: { policies: s.policies } };
  if (s.script) file.script = s.script;
  return structuredClone(file);
}

/** A run's settings under the rules: everything except the submission's policies is fixed. */
export interface RunSpec {
  runKind: RunKind;
  tier: TierId;
  every: number;
  seed: number;
}

/**
 * The config every verification run of a run kind uses: the defaults, plus
 * - ironman kinds: unlimited Dead Plants and Fermento; strict pays the starting layouts from the
 *   (empty) stock, borrow may place any mutation item before it is owned;
 * - normal: nothing else (the normal profile buys and sells instead).
 * `leaderboardRules` refuses the debug script APIs and hides the credit settings from scripts.
 */
export function ruleConfig(runKind: RunKind): SimConfig {
  const config: SimConfig = structuredClone(DEFAULT_CONFIG);
  delete config.forcedEffects;
  config.leaderboardRules = true;
  if (runKind === "strict") {
    config.freePlacedItems = [...IRONMAN_FREE_ITEMS];
    config.setupFromStock = true;
  } else if (runKind === "borrow") {
    config.freePlacedItems = [...IRONMAN_FREE_ITEMS];
    config.bootstrapDebt = true;
    config.allowMutationDebt = true;
  }
  return config;
}

export function ruleSettings(policies: Policies, spec: RunSpec): Settings {
  const settings = defaultSettings();
  settings.seed = spec.seed;
  settings.playerStats = tierStats(spec.tier);
  settings.activity = activityEvery(spec.every);
  settings.playerActions = true;
  settings.policies = structuredClone(policies);
  settings.config = ruleConfig(spec.runKind);
  if (spec.runKind === "normal") settings.profile = "normal";
  else delete settings.profile;
  delete settings.reserve;
  return settings;
}

/** The scenario one verification run simulates (an empty starting inventory unless `inventory` is given). */
export function ruleScenario(s: Submission, spec: RunSpec, inventory: Readonly<Record<string, number>> = {}): Scenario {
  const sc: Scenario = { plots: structuredClone(s.plots), startingInventory: { ...inventory }, settings: ruleSettings(s.policies, spec) };
  if (s.script) sc.script = structuredClone(s.script);
  return sc;
}

/**
 * Apply the rules to a scenario in the simulator without changing its flows: the page's "Apply
 * leaderboard rules" button. `seed` and `every` are the user's own test values (the server's
 * seeds are secret).
 */
export function applyRules(sc: Scenario, runKind: RunKind, every: number, seed: number, tier: TierId = "max"): Scenario {
  return {
    ...sc,
    startingInventory: {},
    settings: ruleSettings(mergePolicies(DEFAULT_POLICIES, sanitizePolicies(sc.settings.policies)), { runKind, tier, every, seed }),
  };
}

/** Which rule settings a scenario differs in (for the page's "your settings differ" note). */
export function ruleDifferences(sc: Scenario, runKind: RunKind): string[] {
  const diffs: string[] = [];
  const rules = ruleSettings(sc.settings.policies, { runKind, tier: "max", every: 1, seed: sc.settings.seed });
  if (Object.values(sc.startingInventory).some((n) => n > 0)) diffs.push("starting inventory is not empty");
  const stats = sc.settings.playerStats;
  const ruleStats = rules.playerStats;
  if ((Object.keys(ruleStats) as (keyof typeof ruleStats)[]).some((k) => stats[k] !== ruleStats[k])) diffs.push("player stats are not the wiki maximums");
  if (sc.settings.activity.kind !== "everyN" || sc.settings.activity.offset !== 0) diffs.push("online schedule is not 'every N cycles'");
  if (sc.settings.playerActions === false) diffs.push("player actions are off");
  const cfg = sc.settings.config as unknown as Record<string, unknown>;
  const ruleCfg = rules.config as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(cfg), ...Object.keys(ruleCfg)]);
  for (const k of keys) if (JSON.stringify(cfg[k]) !== JSON.stringify(ruleCfg[k])) diffs.push(`advanced setting "${k}" differs`);
  if ((sc.settings.profile === "normal") !== (runKind === "normal")) diffs.push(`profile is not ${runKind === "normal" ? "normal" : "ironman"}`);
  return diffs;
}

/** Every script of a submission with its place in the flow, for messages. */
function submissionScripts(s: Submission): { where: string; source: string }[] {
  const out: { where: string; source: string }[] = [];
  const add = (where: string, def: ScriptDef | undefined) => {
    if (def && def.enabled !== false && def.source.trim()) out.push({ where, source: def.source });
  };
  add("Controller script", s.script);
  for (const p of s.plots) {
    add(`Plot ${p.id} script`, p.script);
    for (const [i, step] of p.flow.steps.entries()) {
      for (const exit of step.exits) {
        const exprs: string[] = [];
        const walk = (conds: readonly unknown[]) => {
          for (const c of conds as { kind?: string; expr?: unknown; of?: unknown[] }[]) {
            if (c?.kind === "script" && typeof c.expr === "string") exprs.push(c.expr);
            else if (c?.kind === "group" && Array.isArray(c.of)) walk(c.of);
          }
        };
        walk(exit.when ?? []);
        for (const expr of exprs) out.push({ where: `Plot ${p.id}, step ${i + 1} (${step.label || step.id}) exit condition`, source: expr });
      }
    }
  }
  return out;
}

/** The submission's uses of the debug script APIs (`forceEffects` and friends), as error messages. */
export function debugApiErrors(s: Submission): string[] {
  const errors: string[] = [];
  for (const { where, source } of submissionScripts(s)) {
    const uses = identifierUses(source, DEBUG_SCRIPT_APIS);
    if (!uses.length) continue;
    const distinct = [...new Set(uses.map((u) => `${u.name}()`))];
    const many = distinct.length > 1;
    errors.push(
      `${where}, line ${uses[0].line}: ${distinct.join(", ")} ${many ? "are debugging tools and aren't" : "is a debugging tool and isn't"} allowed on the leaderboard. ` +
        "Forced effects give plants effects no layout earns. Remove it, or do the real thing in the script (e.g. place a Blastberry next to the plant, harvest, and pick the Blastberry back up before the next tick)."
    );
  }
  return errors;
}

export interface SubmissionCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  plots: number;
  /** Bytes of the serialized submission file. */
  bytes: number;
}

/** Everything the server rejects a submission for (before simulating), in one place. */
export function checkSubmission(s: Submission, data: GameData): SubmissionCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bytes = JSON.stringify(submissionFile(s)).length;
  if (bytes > MAX_PAYLOAD_BYTES) errors.push(`The flows are too large (${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_PAYLOAD_BYTES / 1024} KB).`);
  if (s.plots.length === 0) errors.push("Add at least one plot.");
  if (s.plots.length > MAX_PLOTS) errors.push(`At most ${MAX_PLOTS} plots.`);
  if (!errors.length) {
    let issues: ScenarioIssue[];
    try {
      issues = validateScenario(ruleScenario(s, { runKind: "strict", tier: "max", every: 1, seed: 1 }), data);
    } catch (e) {
      issues = [{ level: "error", path: "Scenario", message: e instanceof Error ? e.message : String(e) }];
    }
    for (const i of issues) (i.level === "error" ? errors : warnings).push(`${i.path}: ${i.message}`);
    errors.push(...debugApiErrors(s));
  }
  return { ok: errors.length === 0, errors, warnings, plots: s.plots.length, bytes };
}

/** Clamp a requested cycle count into the allowed range. */
export function clampCycles(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_CYCLES;
  return Math.min(MAX_CYCLES, Math.max(MIN_CYCLES, Math.floor(n)));
}
