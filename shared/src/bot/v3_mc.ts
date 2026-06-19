// Bot v3-mc — belief-sampled Monte Carlo (base version, frozen for measurement).
//
// For each of S sampled belief worlds, evaluate every legal root move via a
// D-ply rollout with the fast policy. Pick the move with the highest mean
// utility across samples. See BOT.md § v3.5 for the full design. The MC core is
// shared via mc.ts; this version uses the defaults (material-only eval, no
// partner coordination).

import { smartValidSetup } from '../setup.js';
import type { Bot, BotSetupContext } from './types.js';
import { runMonteCarlo, DEFAULT_MC } from './mc.js';

export const v3_mc: Bot = {
  name: 'v3-mc',
  description: 'Belief-sampled Monte Carlo. For each of S sampled worlds, evaluates every legal root move via a D-ply rollout with the v2.1 fast policy. Picks max-mean utility.',

  pickSetup(ctx: BotSetupContext) {
    return smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
  },

  pickMove(ctx) {
    return runMonteCarlo(ctx, DEFAULT_MC);
  },
};
