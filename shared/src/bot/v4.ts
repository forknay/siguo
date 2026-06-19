// Bot v4 — v3.1 plus the IDEAS.md shortlist:
//
//   B4  Opponent-reply minimization: post-racing survivors are scored
//       pessimistically against the opponent's top-3 replies (blend 0.7·worst
//       + 0.3·mean) instead of pure mean rollouts. Fixes the "one crushing
//       refutation hides in the average" blind spot.
//   D7  True graph move-distances (precomputed all-pairs table) replace
//       Manhattan in BOTH the spatial evaluation and the partner-coordination
//       root bias — pieces travel on rails, not through walls.
//   D5  Stalemate-clock awareness: leading + stale clock = bad, trailing +
//       stale clock = good (the 70-move draw becomes a strategic resource).
//   I2  Trade policy: a material lead counts more in sparser positions, so
//       rollouts simplify when ahead and avoid trades when behind.
//   D6  Camp refuge: small bonus for high-value pieces sheltered in camps.
//   C1  Roster-aware rank estimates (in belief.ts) sharpen all of the above.

import { ZONES, type SeatId, type ZoneId } from '../board.js';
import { smartValidSetup, type Layout } from '../setup.js';
import { createGameState, submitSetup, type SeatInfo } from '../engine.js';
import type { Bot, BotMoveContext, BotSetupContext } from './types.js';
import { runMonteCarlo, RACING_MC, seededRng, type MonteCarloOptions } from './mc.js';
import { playOutFromSampled } from './rollout.js';
import { evaluateRollout, V4_SPATIAL } from './evaluate.js';
import { runIsmcts, type IsmctsOptions } from './ismcts.js';
import { moveDistance } from './distances.js';
import { likelyFlagCell } from './flaghypothesis.js';
import {
  biasBombTowardFlag,
  engineerBias,
  observedLosingAttackPenalty,
} from './v3_1.js';

const PARTNER_COORD_BONUS = 25;

export interface SetupMCOptions {
  /** Candidate layouts generated (each = smartValidSetup + bomb bias). */
  candidates: number;
  /** Random full-board worlds each candidate is probed in. */
  worlds: number;
  /** Plies simulated per probe. */
  plies: number;
}

/**
 * E3 — setup-time Monte Carlo. Generate `candidates` smart layouts, drop each
 * into `worlds` random full-board games, play `plies` of fast-policy moves,
 * and keep the layout with the best average material outcome. One-time cost
 * at game start (~candidates × worlds × plies ply-sims ≈ tens of ms).
 */
export function pickSetupMC(seat: SeatId, random: () => number, opts: SetupMCOptions): Layout {
  const mkSeat = (id: string): SeatInfo =>
    ({ playerId: id, displayName: id, isBot: true, eliminated: false, setupReady: false });

  let bestLayout: Layout | null = null;
  let bestScore = -Infinity;
  for (let c = 0; c < opts.candidates; c++) {
    const layout = biasBombTowardFlag(
      seat,
      smartValidSetup(seat, Math.floor(random() * 0xffffffff)),
    );
    let score = 0;
    for (let w = 0; w < opts.worlds; w++) {
      const worldSeed = Math.floor(random() * 0xffffffff);
      let state = createGameState('2v2', {
        N: mkSeat('n'), E: mkSeat('e'), S: mkSeat('s'), W: mkSeat('w'),
      });
      for (const z of ZONES) {
        const zl = z === seat
          ? layout
          : smartValidSetup(z as ZoneId, (worldSeed + z.charCodeAt(0)) >>> 0);
        const r = submitSetup(state, z as ZoneId, zl);
        if ('errors' in r) throw new Error(`setupMC: ${r.errors.join(',')}`);
        state = r.state;
      }
      const end = playOutFromSampled(state, opts.plies, seededRng(worldSeed ^ 0xa5a5a5a5), undefined, {
        greedyEps: 0.7,
      });
      score += evaluateRollout(end, seat);
    }
    score /= opts.worlds;
    if (score > bestScore) {
      bestScore = score;
      bestLayout = layout;
    }
  }
  return bestLayout!;
}

/** Factory so config variants (sample count, info weight, …) can be laddered
 *  against each other in the eval harness without copy-pasting the bot. */
export function makeV4Bot(
  name: string,
  overrides: Partial<MonteCarloOptions> = {},
  description = 'v4-config variant',
  setupMC?: SetupMCOptions,
): Bot {
  return {
    name,
    description,
    pickSetup(ctx: BotSetupContext) {
      if (setupMC) return pickSetupMC(ctx.seat, ctx.random, setupMC);
      const layout = smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
      return biasBombTowardFlag(ctx.seat, layout);
    },
    pickMove(ctx: BotMoveContext) {
      return runMonteCarlo(ctx, {
        // The depth-scaling experiment (BOT.md) showed SHALLOW rollouts win:
        // d3 beat d9 in both orientations — the fast playout policy is noisy,
        // so long playouts dilute the root move's signal while the static eval
        // near the root is comparatively reliable. v4 therefore pairs short
        // rollouts with an EXACT opponent ply (reply-min) and spends the
        // savings on more samples.
        samples: 24,
        depth: 4,
        racing: RACING_MC,
        replyMin: { k: 3, blend: 0.7 },
        spatial: V4_SPATIAL,
        rootBias: (move, view, beliefs) =>
          partnerCoordinationBiasGraph(move, view, ctx.seat)
          + engineerBias(move, view, beliefs)
          + observedLosingAttackPenalty(move, view, beliefs),
        ...overrides,
      });
    },
  };
}

export const v4: Bot = makeV4Bot(
  'v4-replymin',
  {},
  'v3.1 + opponent-reply minimization, true graph distances, stalemate-clock awareness, trade policy, camp refuge, roster-aware beliefs.',
);

/** E1 — fixed-layout variant for offline setup curation: plays v4.2's search
 *  but always opens with the layout generated by `layoutSeed`. Used by the
 *  setup-search ladder to find layouts that beat the SOTA's setup meta. */
export function makeV4BotWithLayout(name: string, layoutSeed: number): Bot {
  const base = makeV4Bot(name, { samples: 44, playoutPolicy: { greedyEps: 0.7 } });
  return {
    ...base,
    description: `v4.2 search with fixed layout seed ${layoutSeed}`,
    pickSetup(ctx: BotSetupContext) {
      return biasBombTowardFlag(ctx.seat, smartValidSetup(ctx.seat, layoutSeed));
    },
  };
}

/** v5 — ISMCTS escalation (sanctioned by the ladder once flat MC plateaued).
 *  One UCB tree shared across determinizations; see ismcts.ts. */
export function makeV5Bot(
  name: string,
  opts: IsmctsOptions,
  description = 'ISMCTS config variant',
): Bot {
  return {
    name,
    description,
    pickSetup(ctx: BotSetupContext) {
      const layout = smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
      return biasBombTowardFlag(ctx.seat, layout);
    },
    pickMove(ctx: BotMoveContext) {
      return runIsmcts(ctx, opts);
    },
  };
}

/** v4.2 — the strength-campaign champion (2026-06-12). v4 + capture-first
 *  greedy-ε playouts at S=44. Measured 80.2% net vs v3.1-spatial over 96
 *  games (the only config family member whose advantage replicated across
 *  seed blocks). All other levers tried — info value, UCB root, CRN, deeper
 *  exact replies, setup-time MC, playout advance bias, depth 6, S=60 —
 *  measured worse; see BOT.md §P4 and IDEAS.md for the full ladder. */
export const v4_2: Bot = makeV4Bot(
  'v4.2-greedy',
  { samples: 44, playoutPolicy: { greedyEps: 0.7 } },
  'v4 + capture-first greedy-ε playouts (low-noise rollouts). 80.2% vs v3.1 over 96 games.',
);

/** v4.1 = v4 + H1 information value (emergent probing / bomb baiting) + I3
 *  dead-partner urgency. H1 was deliberately deferred until information could
 *  be modeled properly; the rollout-credit scheme in infovalue.ts is that
 *  model. INFO_W 60 ≈ half a 排长 per flag-adjacent unknown. */
export const v4_1: Bot = makeV4Bot(
  'v4.1-info',
  {
    spatial: { ...V4_SPATIAL, downPlayerUrgency: true },
    infoWeight: 60,
  },
  'v4 + information-value rollout credit (emergent probing/bomb-baiting) + dead-partner urgency.',
);

/** v3.1's partner coordination, but measured in true board moves (D7). */
function partnerCoordinationBiasGraph(
  move: { from: string; to: string },
  view: BotMoveContext['view'],
  seat: SeatId,
): number {
  if (view.mode !== '2v2') return 0;
  const myTeam = view.teams[seat];
  const seats = ['N', 'E', 'S', 'W'] as SeatId[];
  const opponents = seats.filter((s) => view.teams[s] !== myTeam);
  const partner = seats.find((s) => s !== seat && view.teams[s] === myTeam);
  if (opponents.length !== 2 || !partner) return 0;

  const partnerCells = view.pieces.filter((p) => p.owner === partner).map((p) => p.cellId);
  if (partnerCells.length === 0) return 0;

  const [oppA, oppB] = opponents as [SeatId, SeatId];
  const flagA = likelyFlagCell(view, oppA);
  const flagB = likelyFlagCell(view, oppB);
  const dA = flagA ? nearestMoveDistance(partnerCells, flagA) : Infinity;
  const dB = flagB ? nearestMoveDistance(partnerCells, flagB) : Infinity;
  // Partner presses the flag they can reach sooner; I take the other one.
  const myTargetFlag = dA <= dB ? flagB : flagA;
  if (!myTargetFlag) return 0;

  const before = moveDistance(move.from, myTargetFlag);
  const after = moveDistance(move.to, myTargetFlag);
  return PARTNER_COORD_BONUS * Math.sign(before - after);
}

function nearestMoveDistance(cells: string[], target: string): number {
  let best = Infinity;
  for (const c of cells) {
    const d = moveDistance(c, target);
    if (d < best) best = d;
  }
  return best;
}
