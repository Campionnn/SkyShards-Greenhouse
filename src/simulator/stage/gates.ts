import type { SimConfig } from "../config";
import type { GameData } from "../data/types";
import type { Occupancy } from "../sim/plants";
import type { PlantState } from "../sim/state";

// Mutations with non-default growth rules (SPECIAL_GATES.md), data-driven.
// A gate blocks growth; the player clears it during an active session
// (waking, vacuuming, feeding, changing the time). Destruction effects
// (Devourer, Chorus Fruit, Blastberry) live in sim/destruction.ts.

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
    // No natural day/night cycle is modelled: the player sets the craved time
    // whenever they are online, so it advances on online ticks only.
    blocks: (_p, env) => (env.active && env.noctilumeTimeChange ? null : "waiting for the player to set the time"),
  },
  fleshtrap: {
    blocks: (p) => ((p.gate.hunger ?? 0) <= 0 ? "hungry" : null),
    onAdvanced: (p, env) => {
      p.gate.hunger = Math.max(0, (p.gate.hunger ?? 0) - env.config.fleshtrapHungerPerStage);
    },
  },
};

/** Kinds whose rules are documented but deliberately not modelled, with the reason. */
export const UNMODELLED_RULES: Record<string, string> = {
  thunderling: "Charge build-up source is unpublished; the 16,000-charge explosion is not modelled.",
  fleshtrap: "Feeding bonus drops (+20/+40%, cap +100%) are not modelled.",
  zombud: "Harvest-time Zombuddy fight assumed won.",
  timestalk: "Harvest-time clone fight assumed won.",
};

export function growthBlockedBy(p: PlantState, env: GateEnv): string | null {
  return GATES[p.kindId]?.blocks?.(p, env) ?? null;
}

export function afterAdvance(p: PlantState, env: GateEnv): void {
  GATES[p.kindId]?.onAdvanced?.(p, env);
}
