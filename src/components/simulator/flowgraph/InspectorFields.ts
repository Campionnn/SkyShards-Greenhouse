import type { Policies, PolicyOverrides } from "../../../simulator";
import { CLEAR_TARGET_BLOCKERS_HELP, FIX_GROUND_HELP, GATE_FIELDS, ONLY_FOR_EMPTY_TARGETS_HELP, POLICY_FIELDS } from "../policyFields";

// Every action a step or plot can override, as one table: the five policy selects, the re-placing
// switches and the gate interactions (each its own override inside `gateInteractions`).
export interface Field {
  id: string;
  section: string;
  label: string;
  help?: string;
  options: { value: string; label: string }[];
  /** The override's value, or undefined when inherited. */
  get: (o: PolicyOverrides) => string | undefined;
  /** Sets (or with undefined, removes) the override. Returns a new object. */
  set: (o: PolicyOverrides, v: string | undefined) => PolicyOverrides;
  effective: (p: Policies) => string;
}

const YES_NO = [
  { value: "yes", label: "yes" },
  { value: "no", label: "no" },
];

const boolField = (
  key: "replaceDecayed" | "fixGround" | "clearTargetBlockers" | "onlyReplaceForEmptyTargets",
  section: string,
  label: string,
  missing: boolean,
  help?: string
): Field => ({
  id: key,
  section,
  label,
  help,
  options: YES_NO,
  get: (o) => (o[key] === undefined ? undefined : o[key] ? "yes" : "no"),
  set: (o, v) => {
    const next = { ...o };
    if (v === undefined) delete next[key];
    else next[key] = v === "yes";
    return next;
  },
  effective: (p) => ((p[key] ?? missing) ? "yes" : "no"),
});

export const ACTION_FIELDS: Field[] = [
  ...POLICY_FIELDS.map(
    (f): Field => ({
      id: f.key,
      section: "Harvest & upkeep",
      label: f.label,
      help: f.title,
      options: f.options,
      get: (o) => o[f.key] as string | undefined,
      set: (o, v) => {
        const next = { ...o } as Record<string, unknown>;
        if (v === undefined) delete next[f.key];
        else next[f.key] = v;
        return next as PolicyOverrides;
      },
      effective: (p) => (p[f.key] as string | undefined) ?? f.options[0].value,
    })
  ),
  boolField("replaceDecayed", "Re-placing", "Re-place missing plants", true, "Clear Dead Plants and re-place what the layout is missing from inventory."),
  boolField("onlyReplaceForEmptyTargets", "Re-placing", "Re-place inputs only for empty targets", false, ONLY_FOR_EMPTY_TARGETS_HELP),
  boolField("fixGround", "Re-placing", "Fix wrong target ground", true, FIX_GROUND_HELP),
  boolField("clearTargetBlockers", "Re-placing", "Clear spawns off target cells", true, CLEAR_TARGET_BLOCKERS_HELP),
  ...GATE_FIELDS.map(
    (g): Field => ({
      id: `gate.${g.key}`,
      section: "Gate interactions",
      label: g.label,
      options: YES_NO,
      get: (o) => (o.gateInteractions?.[g.key] === undefined ? undefined : o.gateInteractions[g.key] ? "yes" : "no"),
      set: (o, v) => {
        const gates = { ...(o.gateInteractions ?? {}) };
        if (v === undefined) delete gates[g.key];
        else gates[g.key] = v === "yes";
        const next = { ...o };
        if (Object.keys(gates).length) next.gateInteractions = gates;
        else delete next.gateInteractions;
        return next;
      },
      effective: (p) => (p.gateInteractions[g.key] ? "yes" : "no"),
    })
  ),
];

export const labelOf = (f: Field, v: string) => f.options.find((o) => o.value === v)?.label ?? v;

/** How many fields `value` overrides (gate interactions count one each). */
export function overrideCount(value: PolicyOverrides | undefined): number {
  return value ? ACTION_FIELDS.filter((f) => f.get(value) !== undefined).length : 0;
}

