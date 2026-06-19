// Bot registry — all known versions live here so the eval harness and the
// lobby can refer to them by name. Adding a new bot version: write a new
// file (e.g. v2.ts), import it, append to BOTS.

import type { Bot } from './types.js';
import { v0 } from './v0.js';
import { v1 } from './v1.js';
import { v2 } from './v2.js';
import { v2_1 } from './v2_1.js';
import { v3_mc } from './v3_mc.js';
import { v3_1, makeV31Bot } from './v3_1.js';
import { v4, v4_1, v4_2, makeV4Bot, makeV4BotWithLayout, makeV5Bot } from './v4.js';

// E1 setup-curation candidates: v4.2 search with a fixed opening layout.
// Layout seeds are arbitrary but stable; the setup-search ladder ranks them
// against the SOTA and the winner gets promoted into a curated book.
const layoutCandidates: Bot[] = Array.from({ length: 24 }, (_, i) =>
  makeV4BotWithLayout(`v4-L${i}`, 90000 + i * 137),
);
import { V4_SPATIAL } from './evaluate.js';
import { RACING_MC } from './mc.js';

// v4 config-ladder variants (experiment-only, not for live play). v4's
// depth-4 search costs ~½ of v3.1's budget, so sample count can rise to ~44
// at compute parity.
const v4Variants: Bot[] = [
  makeV4Bot('v4-s44', { samples: 44 }),
  makeV4Bot('v4.1-i25-s44', {
    samples: 44,
    infoWeight: 25,
    spatial: { ...V4_SPATIAL, downPlayerUrgency: true },
  }),
  // Greedy-ε playouts: less playout noise per rollout (same depth/sample budget).
  makeV4Bot('v4-greedy', { samples: 44, playoutPolicy: { greedyEps: 0.7 } }),
  // + don't-hang-pieces playout term (systematic playout error, not variance).
  makeV4Bot('v4-safe', { samples: 44, playoutPolicy: { greedyEps: 0.7, avoidHanging: true } }),
  // Higher greed: playouts argmax 85% of plies.
  makeV4Bot('v4-greedy85', { samples: 44, playoutPolicy: { greedyEps: 0.85 } }),
  // Depth interaction re-test: greedy playouts are low-noise, so the old
  // "deeper is worse" result (measured with noisy playouts) may not hold.
  makeV4Bot('v4-greedy-d6', { samples: 44, depth: 6, playoutPolicy: { greedyEps: 0.7 } }),
  // More worlds sampled, slightly past compute parity (~410ms vs v3.1's 368ms).
  makeV4Bot('v4-greedy-s60', { samples: 60, playoutPolicy: { greedyEps: 0.7 } }),
  // Directional quiet playouts: greedy argmax needs a tie-breaking objective.
  makeV4Bot('v4-greedy-adv', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7, advanceBias: 0.8 },
  }),
  // Combined candidate: noise (greedy) + direction (advance) + safety (hanging).
  makeV4Bot('v4-combo', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7, advanceBias: 0.8, avoidHanging: true },
  }),
  // B2 common random numbers: paired rollout seeds across root moves.
  makeV4Bot('v4-greedy-crn', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    commonRandomNumbers: true,
  }),
  // Stronger reply-min pessimism on the greedy base.
  makeV4Bot('v4-greedy-k4', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    replyMin: { k: 4, blend: 0.85 },
  }),
  // Stacked candidate: greedy + avoid-hanging + CRN (each ≈ baseline alone).
  makeV4Bot('v4-stack', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7, avoidHanging: true },
    commonRandomNumbers: true,
  }),
  // Ablation: no reply-min (it predates greedy playouts; k4 already hurt).
  // Freed budget funds S=64 at roughly the same wall time.
  makeV4Bot('v4-noreply', {
    samples: 64,
    playoutPolicy: { greedyEps: 0.7 },
    replyMin: null,
  }),
  // Ablation: spatial-only evaluation (drop clock/trade/camp extras).
  makeV4Bot('v4-lite-eval', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    spatial: { flagAdvance: 350, flagSafety: 450, graphDistance: true },
  }),
  // Wide opening screen: 12 screening samples when branching > 50 moves.
  makeV4Bot('v4-widescreen', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    racing: { ...RACING_MC, wideAt: 50, screenSamplesWide: 12 },
  }),
  // Deep reply-min: model BOTH opponents' refutations (k=2 each to cap cost).
  makeV4Bot('v4-deepreply', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    replyMin: { k: 2, blend: 0.7, k2: 2 },
  }),
  // Deep reply-min with fuller first-opponent coverage (k=3, k2=2).
  makeV4Bot('v4-deepreply3', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    replyMin: { k: 3, blend: 0.7, k2: 2 },
  }),
  // Deep reply-min + wide opening screen (orthogonal: exactness + screening).
  makeV4Bot('v4-deepwide', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    replyMin: { k: 2, blend: 0.7, k2: 2 },
    racing: { ...RACING_MC, wideAt: 50, screenSamplesWide: 12 },
  }),
  // Sample scaling re-test under capture-first playouts (~600ms, no parity cap).
  makeV4Bot('v4-big', { samples: 88, playoutPolicy: { greedyEps: 0.7 } }),
  // v5 ISMCTS first config — tune iterations to ~400-600ms via bench.
  makeV5Bot('v5-ismcts', {
    iterations: 1500,
    c: 250,
    rolloutDepth: 4,
    maxTreeDepth: 8,
    clip: 2500,
    worldEvery: 4,
    spatial: V4_SPATIAL,
    playoutPolicy: { greedyEps: 0.7 },
  }),
  // Loss-forensics fix: escalate flag offense/defense once a flag is revealed.
  makeV4Bot('v4-flagurgent', {
    samples: 44,
    playoutPolicy: { greedyEps: 0.7 },
    spatial: { ...V4_SPATIAL, revealedFlagUrgency: 3 },
  }),
  // E3 setup-time MC: pick the best of 10 candidate layouts by simulation.
  makeV4Bot(
    'v4-greedy-setup',
    { samples: 44, playoutPolicy: { greedyEps: 0.7 } },
    'v4-greedy + setup-time MC',
    { candidates: 10, worlds: 4, plies: 24 },
  ),
  // B1 UCB root bandit (replaces racing; reply-min on every pull).
  makeV4Bot('v4-ucb', {
    playoutPolicy: { greedyEps: 0.7, avoidHanging: true },
    ucb: { c: 300, pullBudget: 500, warmupPulls: 2, worldEvery: 8, clip: 2500 },
  }),
];

// Depth-scaling experiment variants (fixed S=12 so depth is the only variable;
// smaller S also keeps experiment games fast). Not used in live play.
const depthVariants: Bot[] = [3, 6, 9, 12].map((d) =>
  makeV31Bot(`v3.1-d${d}`, { samples: 12, depth: d }),
);

export type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
export { legalMovesForBot, viewMoveContext, botRng } from './legal.js';
export { computeBeliefs, estimateRank, type PieceBelief } from './belief.js';
export { PIECE_VALUE } from './values.js';
export { sampleConcreteWorld, SampleInfeasibleError, ROSTER } from './sampler.js';
export { flagHypothesisFor, likelyFlagCell } from './flaghypothesis.js';
export { makeV31Bot } from './v3_1.js';
export { moveDistance } from './distances.js';
export { v0, v1, v2, v2_1, v3_mc, v3_1, v4, v4_1, v4_2 };

/** All bots available. Ordered oldest → newest (LATEST_BOT = last NON-experiment bot). */
export const BOTS: readonly Bot[] = [v0, v1, v2, v2_1, v3_mc, ...depthVariants, ...v4Variants, v3_1, v4, v4_1, v4_2];

/** Look up a bot by its `name` field. Throws on miss. */
export function botByName(name: string): Bot {
  const b = BOTS.find((b) => b.name === name);
  if (!b) throw new Error(`Unknown bot '${name}'. Known: ${BOTS.map((b) => b.name).join(', ')}`);
  return b;
}

/** Most recent bot — the default when seats are filled in the lobby. */
export const LATEST_BOT = BOTS[BOTS.length - 1]!;
