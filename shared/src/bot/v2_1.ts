// Bot v2.1 — v2 + two bug fixes:
//
//   1. Anti-shuffle: filter out any candidate move that exactly reverses the
//      bot's most recent move by the same piece (A→B last turn, B→A now).
//      Catches the "shuffle backward and forward" loop the user observed.
//
//   2. EV-based combat scoring: instead of linear `10 + myRank - theirRank`,
//      compute expected value using piece values and the belief's minRank /
//      maxRank bounds. A rank-5 attacker against a piece with inferred
//      minRank=7 now correctly scores deeply negative (we lose for sure),
//      so the bot stops throwing weaker pieces at known-strong opponents.
//
//   3. Empty-move directional bias: empty moves toward enemy territory get
//      a small positive bias over moves toward own backline. Plus the attack
//      share bumps from 70% → 90% when any attack has weight ≥ 30.

import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { getCell } from '../board.js';
import { smartValidSetup } from '../setup.js';
import type { Bot, BotMoveContext, BotSetupContext, PickedMove } from './types.js';
import { legalMovesForBot, viewMoveContext } from './legal.js';
import { computeBeliefs, type PieceBelief } from './belief.js';
import { PIECE_VALUE } from './values.js';

const MINE_FILTER_THRESHOLD = 0.4;
const STRONG_ATTACK_THRESHOLD = 30;

export const v2_1: Bot = {
  name: 'v2.1-fixes',
  description: 'v2 with anti-shuffle filter, EV-based combat scoring, and empty-move directional bias.',

  pickSetup(ctx: BotSetupContext) {
    return smartValidSetup(ctx.seat, Math.floor(ctx.random() * 0xffffffff));
  },

  pickMove(ctx: BotMoveContext): PickedMove | null {
    const { view, seat, random } = ctx;
    const moves = legalMovesForBot(view, seat);
    if (moves.length === 0) return null;

    const beliefs = computeBeliefs(view, seat);
    const moveCtx = viewMoveContext(view);
    const myLastMove = view.lastMoveBySeat[seat];

    // Single-pass indexes for the hot move loop: per-cell piece + belief +
    // opponent-centroid sums. Avoids O(moves × pieces) scans inside the loop.
    const pieceByCell = new Map<string, (typeof view.pieces)[number]>();
    const beliefByCell = new Map<string, PieceBelief>();
    let sumX = 0, sumY = 0, oppCount = 0;
    for (const p of view.pieces) {
      pieceByCell.set(p.cellId, p);
      const b = beliefs.get(p.id);
      if (b) beliefByCell.set(p.cellId, b);
      if (!isSameTeam(view, seat, p.owner)) {
        const cell = getCell(p.cellId);
        sumX += cell.x; sumY += cell.y; oppCount += 1;
      }
    }
    const opponentCentroid: Vec | null = oppCount > 0 ? { x: sumX / oppCount, y: sumY / oppCount } : null;

    const attacks: Array<{ from: string; to: string; weight: number }> = [];
    const empties: Array<{ from: string; to: string; weight: number }> = [];

    for (const m of moves) {
      // Anti-shuffle: drop any move that exactly reverses our last move with
      // the same piece. (Our last move went from X→Y; this candidate goes Y→X
      // by the same piece, which is currently at Y.)
      if (myLastMove && m.from === myLastMove.to && m.to === myLastMove.from) {
        continue;
      }

      const me = pieceByCell.get(m.from);
      const myKind = me?.kind ?? null;
      const target = moveCtx.pieceAt(m.to);
      const isFrozen = target ? view.seats[target.owner].eliminated : false;
      const isAlly = target ? isSameTeam(view, seat, target.owner) : false;
      const targetBelief = target ? beliefs.get(target.id) : undefined;
      const cellMineConfidence = beliefByCell.get(m.to)?.mineConfidence ?? 0;

      // Mine filter: non-engineer skips high-confidence-mine cells entirely.
      if (myKind !== 'GONGBING' && cellMineConfidence > MINE_FILTER_THRESHOLD) continue;

      if (!target || isFrozen || isAlly) {
        empties.push({ from: m.from, to: m.to, weight: emptyMoveWeight(m, opponentCentroid) });
        continue;
      }
      const w = scoreAttackEV(myKind, targetBelief, m.to, cellMineConfidence);
      attacks.push({ ...m, weight: w });
    }

    if (attacks.length === 0 && empties.length === 0) {
      const fallback = moves[Math.floor(random() * moves.length)]!;
      return { from: fallback.from, to: fallback.to };
    }

    // Compute attack share dynamically: if any attack has high weight, prefer
    // attacks heavily (90%); otherwise the old 70%.
    const maxAttackWeight = attacks.reduce((m, a) => Math.max(m, a.weight), 0);
    const attackShare = maxAttackWeight >= STRONG_ATTACK_THRESHOLD ? 0.9 : 0.7;

    const r = random();
    let pick: { from: string; to: string };
    if (attacks.length > 0 && r < attackShare) {
      pick = weightedPick(attacks, random);
    } else if (empties.length > 0) {
      pick = weightedPick(empties, random);
    } else {
      pick = weightedPick(attacks, random);
    }
    return { from: pick.from, to: pick.to };
  },
};

function isSameTeam(view: BotMoveContext['view'], a: string, b: string): boolean {
  if (a === b) return true;
  if (view.mode === 'ffa') return false;
  return (view.teams as Record<string, string>)[a] === (view.teams as Record<string, string>)[b];
}

interface Vec { x: number; y: number; }

/**
 * Score an empty move by how much it advances the moving piece toward the
 * opponent centroid. Reversal moves are already filtered above; this just
 * breaks ties between sideways/backward/forward options.
 */
function emptyMoveWeight(move: { from: string; to: string }, centroid: Vec | null): number {
  if (!centroid) return 1;
  const from = getCell(move.from);
  const to = getCell(move.to);
  const distBefore = Math.hypot(centroid.x - from.x, centroid.y - from.y);
  const distAfter = Math.hypot(centroid.x - to.x, centroid.y - to.y);
  // delta > 0 = move closer to opponents.
  const delta = distBefore - distAfter;
  // Base weight 1, plus up to ~1.5 extra for forward moves.
  return Math.max(0.2, 1 + delta * 0.5);
}

/**
 * Expected-value combat scoring.
 *
 *   - Sentinel-known cases (mine/bomb/flag) are kept from v2.
 *   - For everything else, compute P(win), P(lose), P(tie) from the
 *     attacker's known rank vs the target's `[minRank..maxRank]` bound.
 *     If the target's bounds aren't tight, fall back to `estimatedRank`.
 *   - Weight = P(win) · value(target) − P(lose) · value(myself) −
 *             P(tie) · (½ value(both)). All scaled to keep magnitudes
 *     comparable with v2 — values divided by 5.
 */
function scoreAttackEV(
  myKind: PieceKind | null,
  target: PieceBelief | undefined,
  toCellId: string,
  cellMineConfidence: number,
): number {
  if (!target || !myKind) return 5;

  // Engineer always loves probable mines.
  if (myKind === 'GONGBING' && cellMineConfidence > 0.4) {
    return 30 + 20 * cellMineConfidence;
  }

  // Bomb offense (unchanged from v2 logic, rescaled).
  if (myKind === 'ZHADAN') {
    let w = 30 + target.estimatedRank * 5;
    if (target.knownKind === 'SILING') w *= 3;
    else if (target.knownKind === 'JUNZHANG') w *= 2;
    const cell = getCell(toCellId);
    if (cell.type === 'HQ') w *= 2;
    return w;
  }

  // Known sentinels.
  if (target.knownKind === 'JUNQI') return 200; // capture = win
  if (target.knownKind === 'DILEI') return myKind === 'GONGBING' ? 60 : -PIECE_VALUE.SILING / 10;
  if (target.knownKind === 'ZHADAN') return -PIECE_VALUE[myKind] / 5;

  const myRank = PIECE_DEFS[myKind].rank ?? 0;
  if (myRank === 0) return 1; // shouldn't happen for kinds reaching here.

  // Derive the target's rank distribution.
  const lower = target.minRank ?? 1;
  const upper = target.maxRank ?? 9;
  const range = Math.max(1, upper - lower + 1);

  // P(myRank > theirRank) approximated by fraction of [lower..upper] strictly < myRank.
  const winCount = Math.max(0, Math.min(upper, myRank - 1) - lower + 1);
  // P(tie) — equal rank cases inside the band.
  const tieCount = (lower <= myRank && myRank <= upper) ? 1 : 0;
  // Everything else is a loss.
  const loseCount = range - winCount - tieCount;
  const pWin = winCount / range;
  const pTie = tieCount / range;
  const pLose = loseCount / range;

  // Expected-value calculation.
  // For winning: we gain target's value (approx via estimatedRank → PIECE_VALUE).
  // For losing: we lose our own value.
  // For tying: both die — roughly net 0, but heavily negative if our piece is valuable.
  const myValue = PIECE_VALUE[myKind];
  const theirEstKind = approximateKindFromRank(target.estimatedRank);
  const theirValue = theirEstKind ? PIECE_VALUE[theirEstKind] : 50;
  const tieValue = -(myValue + theirValue) / 4;

  let w = pWin * theirValue - pLose * myValue + pTie * tieValue;

  // Mine suspicion for non-engineers (already filtered for very-high; this
  // handles the moderate band).
  if (myKind !== 'GONGBING' && cellMineConfidence > 0) {
    // Mine kills attacker for sure → subtract attacker value × confidence.
    w -= myValue * cellMineConfidence;
  }

  // Heavyweight reluctance on the front line for the bomb-hides-here case.
  const cell = getCell(toCellId);
  const onFrontline = cell.row === 6 || cell.zone === 'C';
  if (!target.knownKind && onFrontline) {
    if (myKind === 'SILING') w *= 0.2;
    else if (myKind === 'JUNZHANG') w *= 0.5;
  }

  // Scale to v2-ish magnitudes (v2 attack weights were ~5–50).
  return w / 5;
}

function approximateKindFromRank(rank: number): PieceKind | null {
  const ranks: Array<[PieceKind, number]> = [
    ['SILING', 9], ['JUNZHANG', 8], ['SHIZHANG', 7], ['LUZHANG', 6],
    ['TUANZHANG', 5], ['YINGZHANG', 4], ['LIANZHANG', 3], ['PAIZHANG', 2],
    ['GONGBING', 1],
  ];
  let best: PieceKind | null = null;
  let bestDist = Infinity;
  for (const [k, r] of ranks) {
    const d = Math.abs(r - rank);
    if (d < bestDist) { bestDist = d; best = k; }
  }
  return best;
}

function weightedPick<T extends { weight: number }>(items: T[], random: () => number): T {
  // Shift all weights to be non-negative so weightedPick can use them.
  const minWeight = items.reduce((m, i) => Math.min(m, i.weight), 0);
  const shift = minWeight < 0 ? -minWeight + 0.01 : 0;
  const total = items.reduce((s, i) => s + i.weight + shift, 0);
  let r = random() * total;
  for (const it of items) {
    r -= it.weight + shift;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}
