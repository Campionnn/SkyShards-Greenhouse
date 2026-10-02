// Converts older saved scenario JSON (localStorage, exported flow files):
// flow `stages` -> `steps`, renamed triggers and config keys, reshaped decay
// config. Pure: returns a converted copy. Unknown input is returned as is.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

const RENAMED_CONFIG: Record<string, string> = {
  stageBaselineSeconds: "cycleBaselineSeconds",
  keepIdenticalOnStageChange: "keepIdenticalOnStepChange",
  deathWater: "haltWater",
};

/**
 * The 14 harvestable base crops (not fire / dead_plant / fermento). Hard-coded
 * so migration doesn't depend on game data; scenarioEdit.test.ts checks it.
 */
export const BASE_CROP_IDS: readonly string[] = [
  "wheat",
  "potato",
  "carrot",
  "pumpkin",
  "melon",
  "cocoa_beans",
  "sugar_cane",
  "cactus",
  "nether_wart",
  "red_mushroom",
  "brown_mushroom",
  "moonflower",
  "sunflower",
  "wild_rose",
];

/** Default of the removed `baseCropDecayHours` key. */
const OLD_BASE_CROP_DECAY_HOURS = 72;

/**
 * Converts `baseCropDecayHours` to per-crop `decayDaysOverrides` (only if not
 * 72; 0 stays 0 = never; existing overrides win) and drops `nullStageKindsDecay`.
 */
function migrateDecayConfig(config: Json): void {
  if ("baseCropDecayHours" in config) {
    const hours = config.baseCropDecayHours;
    if (typeof hours === "number" && Number.isFinite(hours) && hours !== OLD_BASE_CROP_DECAY_HOURS) {
      const overrides: Json = isObj(config.decayDaysOverrides) ? { ...config.decayDaysOverrides } : {};
      const days = Math.max(0, hours) / 24;
      for (const id of BASE_CROP_IDS) if (!(id in overrides)) overrides[id] = days;
      config.decayDaysOverrides = overrides;
    }
    delete config.baseCropDecayHours;
  }
  delete config.nullStageKindsDecay;
}

function migrateCondition(c: unknown): unknown {
  if (!isObj(c)) return c;
  if (c.kind === "group") return { ...c, of: Array.isArray(c.of) ? c.of.map(migrateCondition) : c.of };
  if (c.kind !== "stageVisits") return c;
  const { sinceStage, ...rest } = c;
  return { ...rest, kind: "stepVisits", ...(sinceStage !== undefined ? { sinceStep: sinceStage } : {}) };
}

function migrateStep(s: unknown): unknown {
  if (!isObj(s)) return s;
  const out: Json = { ...s };
  if (Array.isArray(s.exit)) out.exit = s.exit.map(migrateCondition);
  if (Array.isArray(s.routes)) out.routes = s.routes.map((r) => (isObj(r) && Array.isArray(r.when) ? { ...r, when: r.when.map(migrateCondition) } : r));
  return out;
}

/** One saved plot: `flow.stages` -> `flow.steps`, `stageVisits` -> `stepVisits`. */
export function migratePlot(p: unknown): unknown {
  if (!isObj(p) || !isObj(p.flow)) return p;
  const { stages, ...flow } = p.flow;
  const steps = flow.steps ?? stages;
  return { ...p, flow: { ...flow, steps: Array.isArray(steps) ? steps.map(migrateStep) : steps } };
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
    migrateDecayConfig(config);
    out.settings = { ...settings, config };
  }
  return out as T;
}
