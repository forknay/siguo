// Fast policy + rollout for v3-mc. Takes a concrete (sampled) GameState and
// plays out D plies using a streamlined version of v2.1's EV scoring. Each
// turn, the current seat sees the full sampled world (debug-mode view) —
// rollouts are perfect-info within the sampled world. This is much faster
// than per-ply fog projection, at the cost of slightly overestimating
// opponent skill. First-pass simplification; see BOT.md § Rollout policy.

import {
  applyMove,
  applyResign,
  legalMovesForTurn,
  type GameState,
  type SeatId,
} from '../engine.js';
import { getCell } from '../board.js';
import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { PIECE_VALUE, strongMoveBonus } from './values.js';

/** Step the state forward `depth` plies using the fast policy. */
export function playOutFromSampled(
  initial: GameState,
  depth: number,
  rng: () => number,
): GameState {
  let state = initial;
  for (let d = 0; d < depth; d++) {
    if (state.phase !== 'PLAYING') break;
    const seat = state.turn;
    if (state.seats[seat].eliminated) break; // engine should have advanced; safety
    const pick = fastPickMove(state, seat, rng);
    if (!pick) {
      state = applyResign(state, seat);
      continue;
    }
    const r = applyMove(state, seat, pick.from, pick.to);
    if ('error' in r) {
      // Shouldn't happen for legal moves, but be defensive.
      state = applyResign(state, seat);
      continue;
    }
    state = r.state;
  }
  return state;
}

/**
 * v2.1-style EV move pick, but using the engine's full state (concrete kinds,
 * no belief inference). Much faster than the belief-driven pickMove. Same
 * scoring shape as v2.1 so the bot's expectations are calibrated.
 */
function fastPickMove(
  state: GameState,
  seat: SeatId,
  rng: () => number,
): { from: string; to: string } | null {
  const moves = legalMovesForTurn(state);
  if (moves.length === 0) return null;

  const myLast = state.lastMoveBySeat[seat];

  const attacks: Array<{ from: string; to: string; weight: number }> = [];
  const empties: Array<{ from: string; to: string; weight: number }> = [];

  for (const m of moves) {
    // Anti-shuffle.
    if (myLast && m.from === myLast.to && m.to === myLast.from) continue;

    const myPieceId = state.cellIndex[m.from];
    const targetId = state.cellIndex[m.to];
    if (!myPieceId) continue;
    const myKind = state.pieces[myPieceId]!.kind;
    const target = targetId ? state.pieces[targetId] : undefined;

    if (!target) {
      // Base weight 1 + a small strong-piece activation bias so rollouts don't
      // leave heavyweights parked (mirrors the root-level bias in v3-mc).
      empties.push({ from: m.from, to: m.to, weight: 1 + strongMoveBonus(myKind) });
      continue;
    }
    // Same-team is filtered by legalMovesForTurn; nothing to do here.
    const w = fastScoreAttack(myKind, target.kind, m.to);
    attacks.push({ from: m.from, to: m.to, weight: w });
  }

  if (attacks.length === 0 && empties.length === 0) {
    const fallback = moves[Math.floor(rng() * moves.length)]!;
    return { from: fallback.from, to: fallback.to };
  }
  // v2.1's adaptive attack share.
  const maxAttackWeight = attacks.reduce((m, a) => Math.max(m, a.weight), 0);
  const attackShare = maxAttackWeight >= 30 ? 0.9 : 0.7;
  const r = rng();
  if (attacks.length > 0 && r < attackShare) return weighted(attacks, rng);
  if (empties.length > 0) return weighted(empties, rng);
  return weighted(attacks, rng);
}

/** EV scoring with KNOWN kinds (sampled world, no belief uncertainty). */
function fastScoreAttack(
  myKind: PieceKind,
  theirKind: PieceKind,
  toCellId: string,
): number {
  if (theirKind === 'JUNQI') return 200;
  if (theirKind === 'DILEI') return myKind === 'GONGBING' ? 60 : -PIECE_VALUE[myKind];
  if (theirKind === 'ZHADAN') return -PIECE_VALUE[myKind] / 2;

  if (myKind === 'ZHADAN') {
    let w = 30 + (PIECE_DEFS[theirKind].rank ?? 0) * 5;
    if (theirKind === 'SILING') w *= 3;
    else if (theirKind === 'JUNZHANG') w *= 2;
    const cell = getCell(toCellId);
    if (cell.type === 'HQ') w *= 2;
    return w;
  }

  const myRank = PIECE_DEFS[myKind].rank ?? 0;
  const theirRank = PIECE_DEFS[theirKind].rank ?? 0;
  if (myRank === 0 || theirRank === 0) return 1;

  const myValue = PIECE_VALUE[myKind];
  const theirValue = PIECE_VALUE[theirKind];

  let w: number;
  if (myRank > theirRank) w = theirValue;             // we win
  else if (myRank < theirRank) w = -myValue;          // we lose
  else w = -(myValue + theirValue) / 4;               // tie

  return w / 5;
}

function weighted<T extends { weight: number }>(items: T[], rng: () => number): T {
  const shift = Math.min(...items.map((i) => i.weight));
  const offset = shift < 0 ? -shift + 0.01 : 0;
  const total = items.reduce((s, i) => s + i.weight + offset, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight + offset;
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}
