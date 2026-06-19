// Bot v3.1 — v3-mc plus the v3 backlog heuristics:
//   - Spatial evaluation: flag-proximity offense + own-flag safety defense
//     (via evaluate.ts V31_SPATIAL weights).
//   - Partner coordination: small root bias toward the opposing seat the
//     partner is NOT already pressuring (2v2 only).
//   - Bomb placement bias: nudge one bomb into the flag's column so an
//     attacker breaking toward the flag is more likely to hit it.

import { getCell, zoneCellId, type SeatId, type ZoneId } from '../board.js';
import { smartValidSetup, type Layout } from '../setup.js';
import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { legalMovesFromCell } from '../moves.js';
import type { Bot, BotMoveContext, BotSetupContext } from './types.js';
import { runMonteCarlo, RACING_MC, type Beliefs } from './mc.js';
import { viewMoveContext } from './legal.js';
import { V31_SPATIAL } from './evaluate.js';
import { likelyFlagCell } from './flaghypothesis.js';

// Root-bias magnitudes are kept small relative to the spatial-evaluation deltas
// (flag advance/safety contribute ~tens of points) so they only break ties and
// don't make the planner passive.
const PARTNER_COORD_BONUS = 25;
const ENGINEER_REVEAL_PENALTY = 12;
const ENGINEER_PROBE_BONUS = 30;
/** Soft penalty for attacking a piece we've observed to be stronger (#3). A
 *  penalty rather than a hard prune so the rollout can still choose it when the
 *  simulated payoff (path-clear, sacrifice) justifies the loss. */
const OBSERVED_LOSING_ATTACK_PENALTY = 120;
/** Placeholder non-engineer kind for testing "could a non-engineer make this move?" */
const NON_ENGINEER: PieceKind = 'PAIZHANG';

/**
 * Factory for v3.1-config bots with adjustable search budget. The depth-scaling
 * experiment registers `S=12` variants at depths {3, 6, 9, 12}; the production
 * `v3.1-spatial` is `makeV31Bot('v3.1-spatial', { samples: 20, depth: 9 })`.
 */
export function makeV31Bot(
  name: string,
  budget: { samples: number; depth: number },
  description = `v3.1 config @ S=${budget.samples}, D=${budget.depth}`,
): Bot {
  return {
    name,
    description,
    pickSetup(ctx: BotSetupContext) {
      const layout = smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
      return biasBombTowardFlag(ctx.seat, layout);
    },
    pickMove(ctx: BotMoveContext) {
      return runMonteCarlo(ctx, {
        samples: budget.samples,
        depth: budget.depth,
        racing: RACING_MC,
        spatial: V31_SPATIAL,
        rootBias: (move, view, beliefs) =>
          partnerCoordinationBias(move, view, ctx.seat)
          + engineerBias(move, view, beliefs)
          + observedLosingAttackPenalty(move, view, beliefs),
      });
    },
  };
}

// Racing prunes ~75% of root moves after 6 screening samples, which pays for
// the deeper rollouts (6 → 9 plies) at roughly the same wall time.
export const v3_1: Bot = makeV31Bot(
  'v3.1-spatial',
  { samples: 20, depth: 9 },
  'v3-mc + flag-hypothesis offense, own-flag safety defense, partner coordination, and flag-column bomb placement.',
);

/**
 * #3 — penalize attacks against a piece we've OBSERVED to be stronger than our
 * attacker. `minRank` is only set from a prior combat where this piece survived
 * against a known rank, so it's hard evidence. Bombs are excluded automatically:
 * a bomb never survives combat, so it never carries a minRank. This is a soft
 * penalty (not a hard prune) so the rollout can still pick the move when the
 * simulated payoff justifies the loss.
 */
export function observedLosingAttackPenalty(
  move: { from: string; to: string },
  view: BotMoveContext['view'],
  beliefs: Beliefs,
): number {
  const me = view.pieces.find((p) => p.cellId === move.from);
  const myKind = me?.kind;
  if (!myKind) return 0;
  const myRank = PIECE_DEFS[myKind].rank;
  if (myRank === null) return 0; // bombs/specials: no penalty
  const target = view.pieces.find((p) => p.cellId === move.to && p.owner !== me!.owner);
  if (!target) return 0;
  const b = beliefs.get(target.id);
  if (!b || b.knownKind) return 0; // known kinds handled by the rollout EV
  return b.minRank != null && b.minRank > myRank ? -OBSERVED_LOSING_ATTACK_PENALTY : 0;
}

/**
 * #1 + #2 — engineer-specific biases:
 *   - Bonus for probing a suspected mine (mineConfidence > 0). Engineers are the
 *     only piece that survives a mine, so they should gather that information.
 *   - Penalty for an engineer-only move (one a non-engineer couldn't make, i.e.
 *     a rail corner-turn) that ISN'T a mine probe — such a move publicly reveals
 *     the piece is an engineer for no gain.
 */
export function engineerBias(
  move: { from: string; to: string },
  view: BotMoveContext['view'],
  beliefs: Beliefs,
): number {
  const me = view.pieces.find((p) => p.cellId === move.from);
  if (me?.kind !== 'GONGBING') return 0;

  // Mine confidence on the destination cell (opponent piece sitting there).
  const targetPiece = view.pieces.find((p) => p.cellId === move.to);
  const targetBelief = targetPiece ? beliefs.get(targetPiece.id) : undefined;
  const mineConf = targetBelief?.mineConfidence ?? 0;
  if (mineConf > 0) return ENGINEER_PROBE_BONUS * mineConf; // #2 probe suspected mine

  // Otherwise, penalize moves that reveal the engineer (engineer-only routes).
  return isEngineerOnlyMove(view, move.from, move.to) ? -ENGINEER_REVEAL_PENALTY : 0;
}

/** True if `to` is unreachable from `from` for a non-engineer (needs cornering). */
function isEngineerOnlyMove(view: BotMoveContext['view'], from: string, to: string): boolean {
  const base = viewMoveContext(view);
  const nonEngCtx = {
    pieceAt: (id: string) => {
      const p = base.pieceAt(id);
      if (id === from && p) return { ...p, kind: NON_ENGINEER };
      return p;
    },
    isAlly: base.isAlly,
  };
  const nonEngDests = new Set(legalMovesFromCell(nonEngCtx, from));
  return !nonEngDests.has(to);
}

/** In 2v2, bias root moves toward the opponent the partner is NOT pressuring. */
function partnerCoordinationBias(
  move: { from: string; to: string },
  view: BotMoveContext['view'],
  seat: SeatId,
): number {
  if (view.mode !== '2v2') return 0;
  const myTeam = view.teams[seat];
  const opponents = (['N', 'E', 'S', 'W'] as SeatId[]).filter((s) => view.teams[s] !== myTeam);
  const partner = (['N', 'E', 'S', 'W'] as SeatId[]).find(
    (s) => s !== seat && view.teams[s] === myTeam,
  );
  if (opponents.length !== 2 || !partner) return 0;

  // Partner's focus = the opponent whose flag is closest to the partner's pieces.
  const partnerCells = view.pieces.filter((p) => p.owner === partner).map((p) => p.cellId);
  if (partnerCells.length === 0) return 0;
  const partnerCentroid = centroid(partnerCells);

  const [oppA, oppB] = opponents as [SeatId, SeatId];
  const flagA = likelyFlagCell(view, oppA);
  const flagB = likelyFlagCell(view, oppB);
  const dA = flagA ? distToCentroid(flagA, partnerCentroid) : Infinity;
  const dB = flagB ? distToCentroid(flagB, partnerCentroid) : Infinity;
  // Partner focuses the nearer flag; I should press the OTHER opponent.
  const myTargetFlag = dA <= dB ? flagB : flagA;
  if (!myTargetFlag) return 0;

  // Reward moves that advance toward my target opponent's flag.
  const from = getCell(move.from);
  const to = getCell(move.to);
  const flag = getCell(myTargetFlag);
  const before = Math.abs(from.x - flag.x) + Math.abs(from.y - flag.y);
  const after = Math.abs(to.x - flag.x) + Math.abs(to.y - flag.y);
  const delta = before - after; // >0 = closer
  return PARTNER_COORD_BONUS * Math.sign(delta);
}

/** Swap a bomb into the flag's column (rows 3-4) if one isn't already there. */
export function biasBombTowardFlag(seat: SeatId, layout: Layout): Layout {
  const flagEntry = Object.entries(layout).find(([, k]) => k === 'JUNQI');
  if (!flagEntry) return layout;
  const flagCol = getCell(flagEntry[0]).col;

  // Is a bomb already in the flag column?
  const bombInCol = Object.entries(layout).some(
    ([cellId, k]) => k === 'ZHADAN' && getCell(cellId).col === flagCol,
  );
  if (bombInCol) return layout;

  // Find a bomb to relocate and a target cell (rows 3-4, flag column, holding a
  // mobile soldier we can displace).
  const bombCell = Object.keys(layout).find((c) => layout[c] === 'ZHADAN');
  if (!bombCell) return layout;
  const targetRow = 3 + (flagCol % 2); // 3 or 4, deterministic-ish per column
  const targetCell = zoneCellId(seat as ZoneId, targetRow, flagCol);
  const occupant = layout[targetCell];
  // Only swap if the target currently holds a relocatable mobile soldier.
  if (!occupant) return layout;
  const def = PIECE_DEFS[occupant];
  if (!def.mobile || occupant === 'GONGBING') return layout;
  if (targetCell === bombCell) return layout;

  const next = { ...layout };
  next[targetCell] = 'ZHADAN';
  next[bombCell] = occupant;
  return next;
}

function centroid(cellIds: string[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const id of cellIds) {
    const c = getCell(id);
    x += c.x; y += c.y;
  }
  return { x: x / cellIds.length, y: y / cellIds.length };
}

function distToCentroid(cellId: string, c: { x: number; y: number }): number {
  const cell = getCell(cellId);
  return Math.abs(cell.x - c.x) + Math.abs(cell.y - c.y);
}
