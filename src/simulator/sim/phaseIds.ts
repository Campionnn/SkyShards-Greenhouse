import { PLAYER_PHASES } from "./player";
import { TICK_PHASES } from "./tick";

// The phase ids in the order the engine runs them, for the page's stop picker (Step by: Detail).
// Read from the phase lists themselves, so the picker can't drift from the engine.

/** The game tick's phases (`TICK_PHASES`), in order, with their one-line summaries. */
export const GAME_TICK_PHASE_IDS: readonly { id: string; summary: string }[] = TICK_PHASES.map(({ id, summary }) => ({ id, summary }));

/** The player session's phases (`PLAYER_PHASES`), in order, with their one-line summaries. */
export const SESSION_PHASE_IDS: readonly { id: string; summary: string }[] = PLAYER_PHASES.map(({ id, summary }) => ({ id, summary }));
