import type { Policies, PolicyOverrides } from "./types";

export const DEFAULT_POLICIES: Policies = {
  spawnedHarvest: "whenFullyGrown",
  layoutInputSpawns: "keep",
  baseCropUpkeep: "leaveUntilDecay",
  watering: "toMax",
  gateInteractions: { wakeSnoozling: true, vacuumRat: true, noctilumeTime: true, feedFleshtrap: true, clearRoots: true },
  replaceDecayed: true,
  fixGround: true,
};

/** Scenario defaults, then plot overrides, then stage overrides. */
export function mergePolicies(base: Policies, ...layers: (PolicyOverrides | undefined)[]): Policies {
  let out: Policies = { ...base, gateInteractions: { ...base.gateInteractions } };
  for (const layer of layers) {
    if (!layer) continue;
    const { gateInteractions, ...rest } = layer;
    out = { ...out, ...rest, gateInteractions: { ...out.gateInteractions, ...gateInteractions } };
  }
  return out;
}
