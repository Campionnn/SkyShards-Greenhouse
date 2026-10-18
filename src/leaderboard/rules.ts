import { DEFAULT_CONFIG, type SimConfig } from "../simulator/config";
import type { GameData } from "../simulator/data/types";
import { DEFAULT_POLICIES, mergePolicies } from "../simulator/flow/policies";
import type { Policies, PolicyOverrides } from "../simulator/flow/types";
import { MAX_PLOTS, validateScenario, type ScenarioIssue } from "../simulator/flow/validate";
import { migrateScenario } from "../simulator/migrate";
import { defaultSettings } from "../simulator/scenario";
import type { Scenario, ScenarioPlot, Settings } from "../simulator/sim/state";
import type { ScriptDef } from "../simulator/script/types";
import { activityEvery, tierStats, type TierId } from "./tiers";

/**
 * The leaderboard rules (docs/plans/flow-leaderboard.md §4): what a submission may contain and
 * the settings every verification run uses. Shared by the server CLI (which enforces them) and
 * the page (which previews them and applies them locally with "Apply leaderboard rules").
 *
 * A submission is a flows file (`skyshards-greenhouse-flows`, v1 or v2): `plots` (flows, steps,
 * layouts, triggers, watch lists, policy overrides, plot scripts), the controller `script` and
 * `settings.policies` (action defaults). Everything else in the file is ignored: the server sets
 * the seed, online schedule, player stats, starting inventory, config and profile per run.
 */

export type Board = "ironman" | "normal";
export const BOARDS: readonly Board[] = ["ironman", "normal"];

export const MIN_CYCLES = 2000;
export const MAX_CYCLES = 5000;
export const DEFAULT_CYCLES = 2000;
/** Serialized submission payload size cap (bytes of JSON). */
export const MAX_PAYLOAD_BYTES = 256 * 1024;
/** Ironman: placed supplies with an unlimited supply. */
export const IRONMAN_FREE_ITEMS: readonly string[] = ["dead_plant", "fermento"];
/**
 * Ironman: the starting layouts are bought on credit (`config.bootstrapDebt`) and every item's
 * debt must be paid back by this cycle. A grid cell whose seeds mostly miss it is insolvent: left
 * out of that frequency's ranking. Missing it at max stats, online every cycle, rejects the entry.
 */
export const PAYBACK_CYCLES = 1000;

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
    const plot: ScenarioPlot = {
      id: id as number,
      flow: {
        steps: structuredClone(steps) as ScenarioPlot["flow"]["steps"],
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
  board: Board;
  tier: TierId;
  every: number;
  seed: number;
}

/** The config every verification run uses: defaults; ironman adds free supplies and a starting layout bought on credit. */
export function ruleConfig(board: Board): SimConfig {
  const config: SimConfig = structuredClone(DEFAULT_CONFIG);
  delete config.forcedEffects;
  if (board === "ironman") {
    config.freePlacedItems = [...IRONMAN_FREE_ITEMS];
    config.bootstrapDebt = true;
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
  settings.config = ruleConfig(spec.board);
  if (spec.board === "normal") settings.profile = "normal";
  else delete settings.profile;
  delete settings.reserve;
  return settings;
}

/** The scenario one verification run simulates. */
export function ruleScenario(s: Submission, spec: RunSpec): Scenario {
  const sc: Scenario = { plots: structuredClone(s.plots), startingInventory: {}, settings: ruleSettings(s.policies, spec) };
  if (s.script) sc.script = structuredClone(s.script);
  return sc;
}

/**
 * Apply the rules to a scenario in the simulator without changing its flows: the page's "Apply
 * leaderboard rules" button. `seed` and `every` are the user's own test values (the server's
 * seeds are secret).
 */
export function applyRules(sc: Scenario, board: Board, every: number, seed: number, tier: TierId = "max"): Scenario {
  return {
    ...sc,
    startingInventory: {},
    settings: ruleSettings(mergePolicies(DEFAULT_POLICIES, sanitizePolicies(sc.settings.policies)), { board, tier, every, seed }),
  };
}

/** Which rule settings a scenario differs in (for the page's "your settings differ" note). */
export function ruleDifferences(sc: Scenario, board: Board): string[] {
  const diffs: string[] = [];
  const rules = ruleSettings(sc.settings.policies, { board, tier: "max", every: 1, seed: sc.settings.seed });
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
  if ((sc.settings.profile === "normal") !== (board === "normal")) diffs.push(`profile is not ${board}`);
  return diffs;
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
      issues = validateScenario(ruleScenario(s, { board: "ironman", tier: "max", every: 1, seed: 1 }), data);
    } catch (e) {
      issues = [{ level: "error", path: "Scenario", message: e instanceof Error ? e.message : String(e) }];
    }
    for (const i of issues) (i.level === "error" ? errors : warnings).push(`${i.path}: ${i.message}`);
  }
  return { ok: errors.length === 0, errors, warnings, plots: s.plots.length, bytes };
}

/** Clamp a requested cycle count into the allowed range. */
export function clampCycles(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_CYCLES;
  return Math.min(MAX_CYCLES, Math.max(MIN_CYCLES, Math.floor(n)));
}
