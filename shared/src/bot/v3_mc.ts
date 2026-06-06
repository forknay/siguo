// Bot v3-mc — belief-sampled Monte Carlo.
//
// For each of S sampled belief worlds, evaluate every legal root move via a
// D-ply rollout with the fast policy. Pick the move with the highest mean
// utility across samples. See BOT.md § v3.5 for the full design.

import { applyMove } from '../engine.js';
import { smartValidSetup } from '../setup.js';
import type { PieceKind } from '../pieces.js';
import type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
import { legalMovesForBot } from './legal.js';
import { computeBeliefs } from './belief.js';
import { sampleConcreteWorld, SampleInfeasibleError } from './sampler.js';
import { playOutFromSampled } from './rollout.js';
import { evaluateRollout } from './evaluate.js';
import { strongMoveBonus } from './values.js';
import { v2_1 } from './v2_1.js';

const DEFAULT_SAMPLES = 20;
const DEFAULT_DEPTH = 6;
const MAX_RESAMPLE_ATTEMPTS = 4;

export const v3_mc: Bot = {
  name: 'v3-mc',
  description: 'Belief-sampled Monte Carlo. For each of S sampled worlds, evaluates every legal root move via a D-ply rollout with the v2.1 fast policy. Picks max-mean utility.',

  pickSetup(ctx: BotSetupContext) {
    return smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
  },

  pickMove(ctx: BotMoveContext): PickedMove | null {
    const { view, seat, random } = ctx;
    const moves = legalMovesForBot(view, seat);
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0]!;

    const beliefs = computeBeliefs(view, seat);

    // scoreSums[i] = sum of utilities for moves[i]; visits[i] = samples that scored it.
    const scoreSums = new Array<number>(moves.length).fill(0);
    const visits = new Array<number>(moves.length).fill(0);

    let successfulSamples = 0;
    for (let s = 0; s < DEFAULT_SAMPLES; s++) {
      const sampleSeed = Math.floor(random() * 0xffffffff);
      let sampled;
      let attempt = 0;
      while (attempt < MAX_RESAMPLE_ATTEMPTS) {
        try {
          sampled = sampleConcreteWorld(view, beliefs, seat, seededRng(sampleSeed + attempt));
          break;
        } catch (e) {
          if (e instanceof SampleInfeasibleError) {
            attempt += 1;
            continue;
          }
          throw e;
        }
      }
      if (!sampled) continue; // skip this sample if we couldn't make one

      successfulSamples += 1;
      // Per-move sub-RNG for the rollout.
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i]!;
        const r = applyMove(sampled, seat, m.from, m.to);
        if ('error' in r) continue;
        const finalState = playOutFromSampled(
          r.state,
          DEFAULT_DEPTH,
          seededRng(sampleSeed ^ (i * 0x9e3779b1)),
        );
        scoreSums[i] = scoreSums[i]! + evaluateRollout(finalState, seat);
        visits[i] = visits[i]! + 1;
      }
    }

    // If sampling failed entirely, fall back to v2.1.
    if (successfulSamples === 0) return v2_1.pickMove(ctx);

    // Index own piece kinds by cell so we can add a tiny strong-piece bias to
    // the mean utility — breaks near-ties toward activating 司令 / 军长 instead
    // of leaving them parked. Far smaller than typical material-driven deltas.
    const kindByCell = new Map<string, PieceKind>();
    for (const p of view.pieces) {
      if (p.owner === seat && p.kind) kindByCell.set(p.cellId, p.kind);
    }

    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      if (visits[i]! === 0) continue;
      const mean = scoreSums[i]! / visits[i]!;
      const movingKind = kindByCell.get(moves[i]!.from);
      const bias = movingKind ? strongMoveBonus(movingKind) : 0;
      const score = mean + bias;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const pick = moves[bestIdx]!;
    return { from: pick.from, to: pick.to };
  },
};

/** Local mulberry32 for sub-RNGs without re-importing botRng (which is in legal.ts). */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
