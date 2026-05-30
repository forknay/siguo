// Bot interfaces — versioned so we can run e.g. v1 vs v2 in the eval harness.

import type { Layout } from '../setup.js';
import type { MoveRecord, SeatId } from '../engine.js';
import type { PlayerView } from '../view.js';

export interface PickedMove {
  from: string;
  to: string;
}

export interface BotMoveContext {
  /** Fog-of-war filtered view for the bot's seat. */
  view: PlayerView;
  /** The bot's seat. */
  seat: SeatId;
  /** Full move history visible to the bot. (Same MoveRecord[] used by replay.) */
  history: MoveRecord[];
  /** Deterministic PRNG — bot must use this for any randomness. */
  random: () => number;
}

export interface BotSetupContext {
  seat: SeatId;
  /** Deterministic PRNG. */
  random: () => number;
}

/**
 * A bot has a stable name (used in eval reports + the lobby) and produces a
 * Layout at setup time and a PickedMove during play.
 */
export interface Bot {
  /** Short stable identifier, e.g. "v1-fog" or "v2-belief". */
  name: string;
  /** Human-readable description for UI tooltips and eval reports. */
  description: string;
  pickSetup(ctx: BotSetupContext): Layout;
  /** Return null only if there are no legal moves — caller will resign. */
  pickMove(ctx: BotMoveContext): PickedMove | null;
}
