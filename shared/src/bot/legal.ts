// Compute the bot's legal moves directly from a PlayerView. This is the
// fog-of-war replacement for legalMovesForSeat — the bot uses ONLY information
// visible in its filtered view, not the server-side GameState.

import { legalMovesFromCell, type MoveContext, type PieceRef, type SeatId } from '../moves.js';
import type { PieceKind } from '../pieces.js';
import type { PlayerView } from '../view.js';

const UNKNOWN_PLACEHOLDER: PieceKind = 'PAIZHANG';

/**
 * Build a MoveContext that uses the bot's view. For destinations, the engine's
 * legal-move generator only needs the OWNER (to decide ally vs enemy) and the
 * kind of the MOVING piece (to decide engineer-corner BFS vs slide). Opponent
 * kinds are irrelevant for legality — they only matter once combat resolves
 * server-side. So an unknown enemy piece can carry a placeholder kind.
 */
export function viewMoveContext(view: PlayerView): MoveContext {
  const byCell = new Map<string, PieceRef>();
  for (const p of view.pieces) {
    // Dead (frozen) pieces do not hinder movement — slides pass through them,
    // and they cannot be attacked. They mirror the engine-side filter in
    // moveContextFor. Skip them so legalMovesForBot agrees with applyMove.
    if (p.frozen) continue;
    byCell.set(p.cellId, {
      id: p.id,
      cellId: p.cellId,
      kind: p.kind ?? UNKNOWN_PLACEHOLDER,
      owner: p.owner,
    });
  }
  return {
    pieceAt: (cellId) => byCell.get(cellId) ?? null,
    isAlly: (a, b) => {
      if (a === b) return true;
      if (view.mode === 'ffa') return false;
      return view.teams[a] === view.teams[b];
    },
  };
}

/** Every legal (from,to) move the seat can make this turn, based on the view. */
export function legalMovesForBot(
  view: PlayerView,
  seat: SeatId,
): Array<{ from: string; to: string }> {
  const ctx = viewMoveContext(view);
  const out: Array<{ from: string; to: string }> = [];
  for (const p of view.pieces) {
    if (p.owner !== seat) continue;
    // Eliminated owner check is unnecessary — the engine wouldn't be calling
    // the bot if it weren't their turn — but defensive.
    if (view.seats[seat].eliminated) continue;
    for (const to of legalMovesFromCell(ctx, p.cellId)) {
      out.push({ from: p.cellId, to });
    }
  }
  return out;
}

/** PRNG factory — small Mulberry32, mirrors the one in setup.ts. */
export function botRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
