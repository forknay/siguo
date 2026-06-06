// Bot registry — all known versions live here so the eval harness and the
// lobby can refer to them by name. Adding a new bot version: write a new
// file (e.g. v2.ts), import it, append to BOTS.

import type { Bot } from './types.js';
import { v0 } from './v0.js';
import { v1 } from './v1.js';
import { v2 } from './v2.js';
import { v2_1 } from './v2_1.js';
import { v3_mc } from './v3_mc.js';

export type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
export { legalMovesForBot, viewMoveContext, botRng } from './legal.js';
export { computeBeliefs, estimateRank, type PieceBelief } from './belief.js';
export { PIECE_VALUE } from './values.js';
export { sampleConcreteWorld, SampleInfeasibleError, ROSTER } from './sampler.js';
export { v0, v1, v2, v2_1, v3_mc };

/** All bots available. Ordered oldest → newest. */
export const BOTS: readonly Bot[] = [v0, v1, v2, v2_1, v3_mc];

/** Look up a bot by its `name` field. Throws on miss. */
export function botByName(name: string): Bot {
  const b = BOTS.find((b) => b.name === name);
  if (!b) throw new Error(`Unknown bot '${name}'. Known: ${BOTS.map((b) => b.name).join(', ')}`);
  return b;
}

/** Most recent bot — the default when seats are filled in the lobby. */
export const LATEST_BOT = BOTS[BOTS.length - 1]!;
