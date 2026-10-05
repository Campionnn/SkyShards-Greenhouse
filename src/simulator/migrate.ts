// Converts older saved scenario JSON (localStorage, exported flow files):
// flow `stages` -> `steps`, a step's `exit`/`next`/`routes` -> `exits`, renamed
// triggers and config keys, removed config keys dropped. Pure: returns a converted copy. Unknown input is returned as is.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

const RENAMED_CONFIG: Record<string, string> = {
  stageBaselineSeconds: "cycleBaselineSeconds",
  keepIdenticalOnStageChange: "keepIdenticalOnStepChange",
  deathWater: "haltWater",
};

/**
 * Config keys that are no longer settings. Their values are now fixed in code
 * (config.ts constants) or come from data.json (decay timers, minimum
 * mutations) and the wiki price table (NPC prices). Saved values are dropped.
 */
export const REMOVED_CONFIG: readonly string[] = [
  // Older removals.
  "baseCropDecayHours",
  "nullStageKindsDecay",
  // Fixed values and model switches.
  "weightModel",
  "supportPerCell",
  "supportCap",
  "spawnCells",
  "maxWater",
  "harvestWindowCycles",
  "rootSpreadChance",
  "bountyRollsPerHarvest",
  "fleshtrapInitialHunger",
  "magicJellybeanMultiplierCap",
  "perfectPlay",
  "minigameFailChance",
  "blankFillTo",
  "haltWater",
  "cycleBaselineSeconds",
  "uniqueCropCap",
  "uniqueCropGrowthPerCrop",
  "uniqueCropYieldPerCrop",
  "thunderlingChargePerStage",
  "thunderlingMaxCharge",
  "decayExtensionHours",
  "devourerRootChance",
  // Per-kind decay overrides (data.json is used) and NPC price overrides.
  "decayDaysOverrides",
  "minimumMutationsOverrides",
  "rareDropValues",
];

function migrateCondition(c: unknown): unknown {
  if (!isObj(c)) return c;
  if (c.kind === "group") return { ...c, of: Array.isArray(c.of) ? c.of.map(migrateCondition) : c.of };
  if (c.kind !== "stageVisits") return c;
  const { sinceStage, ...rest } = c;
  return { ...rest, kind: "stepVisits", ...(sinceStage !== undefined ? { sinceStep: sinceStage } : {}) };
}

const migrateExit = (e: unknown): unknown => (isObj(e) && Array.isArray(e.when) ? { ...e, when: e.when.map(migrateCondition) } : e);

/**
 * One step. Before 0.27.3 a step had `routes` (conditional jumps, checked first) plus one
 * "normal exit" (`exit` + `exitMatch`, going to `next` or the following step). Both are now
 * one ordered `exits` list: the routes, then the normal exit. A `next` naming a step that
 * doesn't exist used to fall back to the following step, so it is dropped.
 */
function migrateStep(s: unknown, stepIds: ReadonlySet<unknown>): unknown {
  if (!isObj(s)) return s;
  const { exit, exitMatch, next, routes, checkExitsOnEntry, ...out } = s;
  // Briefly a per-step flag; now per exit: a flagged step had every exit checked on arrival.
  const onEntry = (e: unknown): unknown => (checkExitsOnEntry === true && isObj(e) ? { ...e, checkOnEntry: true } : e);
  if (Array.isArray(s.exits)) return { ...out, exits: s.exits.map(migrateExit).map(onEntry) };
  if (!Array.isArray(exit) && !Array.isArray(routes)) return s; // not a step we recognise
  const exits: unknown[] = Array.isArray(routes) ? routes.map(migrateExit) : [];
  if (Array.isArray(exit) && exit.length > 0) {
    const normal: Json = { when: exit.map(migrateCondition) };
    if (exitMatch === "any") normal.match = "any";
    if (typeof next === "string" && stepIds.has(next)) normal.to = next;
    exits.push(normal);
  }
  return { ...out, exits };
}

/** One saved plot: `flow.stages` -> `flow.steps`, `stageVisits` -> `stepVisits`, exits/routes -> `exits`. */
export function migratePlot(p: unknown): unknown {
  if (!isObj(p) || !isObj(p.flow)) return p;
  const { stages, ...flow } = p.flow;
  const steps = flow.steps ?? stages;
  if (!Array.isArray(steps)) return { ...p, flow: { ...flow, steps } };
  const ids = new Set(steps.map((s) => (isObj(s) ? s.id : undefined)));
  return { ...p, flow: { ...flow, steps: steps.map((s) => migrateStep(s, ids)) } };
}

/** A saved scenario, or any object with a `plots` list (an exported flows file). */
export function migrateScenario<T>(raw: T): T {
  if (!isObj(raw)) return raw;
  const out: Json = { ...raw };
  if (Array.isArray(raw.plots)) out.plots = raw.plots.map(migratePlot);
  const settings = raw.settings;
  if (isObj(settings) && isObj(settings.config)) {
    const config: Json = { ...settings.config };
    for (const [from, to] of Object.entries(RENAMED_CONFIG)) {
      if (from in config) {
        if (!(to in config)) config[to] = config[from];
        delete config[from];
      }
    }
    for (const key of REMOVED_CONFIG) delete config[key];
    // Saved before auto aloe harvest: a save on the old default (14) goes to auto, a deliberate other stage stays fixed.
    if (!("aloeAutoHarvest" in config) && typeof config.aloeHarvestStage === "number") config.aloeAutoHarvest = config.aloeHarvestStage === 14;
    out.settings = { ...settings, config };
  }
  return out as T;
}
