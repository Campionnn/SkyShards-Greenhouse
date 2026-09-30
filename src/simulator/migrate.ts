// Upgrades scenario JSON saved before the stage -> step rename (localStorage
// and exported flow files). Pure: returns a converted copy and leaves the
// input untouched. Unknown input is returned as it is; callers validate.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

const RENAMED_CONFIG: Record<string, string> = {
  stageBaselineSeconds: "cycleBaselineSeconds",
  keepIdenticalOnStageChange: "keepIdenticalOnStepChange",
};

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

/** One saved plot: `flow.stages` -> `flow.steps`, and the renamed trigger. */
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
    out.settings = { ...settings, config };
  }
  return out as T;
}
