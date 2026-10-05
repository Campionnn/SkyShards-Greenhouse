import { THUNDERLING_CHARGE_PER_STAGE, THUNDERLING_MAX_CHARGE, type SimConfig } from "../config";
import type { GameData } from "../data/types";
import type { Occupancy } from "../sim/plants";
import type { PlantState } from "../sim/state";

// Growth gates (SPECIAL_GATES.md): block growth until the player clears them
// in an active session. Destruction effects are in sim/destruction.ts.

export const SNOOZLING_SLEEP_STAGES = [5, 10, 15];
export const CHEESEBITE_RAT_STAGES = [4, 7];

export interface GateEnv {
  data: GameData;
  config: SimConfig;
  occ: Occupancy;
  /** The player is online this cycle (Noctilume advances only then). */
  active: boolean;
  noctilumeTimeChange: boolean;
}

interface Gate {
  /** Reason growth is blocked this cycle, or null. */
  blocks?: (p: PlantState, env: GateEnv) => string | null;
  /** After the plant advanced a stage. */
  onAdvanced?: (p: PlantState, env: GateEnv) => void;
}

export const GATES: Record<string, Gate> = {
  snoozling: {
    blocks: (p) => (p.gate.asleep ? "asleep" : null),
    onAdvanced: (p) => {
      if (SNOOZLING_SLEEP_STAGES.includes(p.stage)) p.gate.asleep = true;
    },
  },
  cheesebite: {
    blocks: (p) => (p.gate.ratAlive ? "rat" : null),
    onAdvanced: (p) => {
      if (CHEESEBITE_RAT_STAGES.includes(p.stage)) p.gate.ratAlive = true;
    },
  },
  noctilume: {
    // No day/night cycle is modelled: advances only on online ticks, when the player sets the time.
    blocks: (_p, env) => (env.active && env.noctilumeTimeChange ? null : "waiting for the player to set the time"),
  },
  thunderling: {
    // At max charge it stops growing until discharged. Placed Thunderlings never grow, so build none.
    blocks: (p) => ((p.gate.charge ?? 0) >= THUNDERLING_MAX_CHARGE ? "overcharged" : null),
    onAdvanced: (p) => {
      p.gate.charge = Math.min(THUNDERLING_MAX_CHARGE, (p.gate.charge ?? 0) + THUNDERLING_CHARGE_PER_STAGE);
    },
  },
  fleshtrap: {
    blocks: (p) => ((p.gate.hunger ?? 0) <= 0 ? "hungry" : null),
    onAdvanced: (p, env) => {
      p.gate.hunger = Math.max(0, (p.gate.hunger ?? 0) - env.config.fleshtrapHungerPerStage);
    },
  },
};

/** Documented rules that are not modelled, per kind. */
export const UNMODELLED_RULES: Record<string, string> = {
  thunderling: "Discharging into Thunder/Storm/Hurricane in a Bottle (bottle charge) is not modelled.",
  fleshtrap: "Feeding bonus drops (+20/+40%, cap +100%) are not modelled.",
  zombud: "Zombud mob fight assumed won (1 Zombud per adjacent Dead Plant), on harvest and on decay alike. A decay fills no empty cells and drops no crop bundle.",
  timestalk: "Harvest-time clone fight assumed won (1 Timestalk per harvest, no yield scaling).",
};

export function growthBlockedBy(p: PlantState, env: GateEnv): string | null {
  return GATES[p.kindId]?.blocks?.(p, env) ?? null;
}

export function afterAdvance(p: PlantState, env: GateEnv): void {
  GATES[p.kindId]?.onAdvanced?.(p, env);
}
