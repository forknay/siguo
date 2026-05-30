// Bot registry — all known versions live here so the eval harness and the
// lobby can refer to them by name. Adding a new bot version: write a new
// file (e.g. v2.ts), import it, append to BOTS.

import type { Bot } from './types.js';
import { v1 } from './v1.js';

export type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
export { legalMovesForBot, viewMoveContext, botRng } from './legal.js';
export { v1 };

/** All bots available. Ordered oldest → newest. */
export const BOTS: readonly Bot[] = [v1];

/** Look up a bot by its `name` field. Throws on miss. */
export function botByName(name: string): Bot {
  const b = BOTS.find((b) => b.name === name);
  if (!b) throw new Error(`Unknown bot '${name}'. Known: ${BOTS.map((b) => b.name).join(', ')}`);
  return b;
}

/** Most recent bot — the default when seats are filled in the lobby. */
export const LATEST_BOT = BOTS[BOTS.length - 1]!;
