// H1 — information-value term (DD-H1 in IDEAS.md). Under fog, *learning* has
// real value that a material-only evaluation can't see. Before search we
// price every enemy piece by how much we'd learn from fighting it:
//
//   infoValue[pieceId] = w_unknown × relevance(cell)
//
//   w_unknown  = 1.0 if we know nothing (no kind, no rank bounds)
//                0.4 if we have bounds but not the kind
//                0   if the kind is known (nothing left to learn)
//   relevance  = 1 / (1 + moveDistance(cell, owner's likely flag))
//                — back-row unknowns guarding the flag are the juicy ones.
//
// During rollouts, the first combat that pits one of MY OWN pieces against a
// priced enemy piece credits its value once (strict fog: only combats we're a
// party to reveal kinds to us in the real game). This makes probe-and-bait
// EMERGENT: a rollout where a cheap piece dies revealing a flag-guard scores
// better than passive shuffling — the bomb-baiting behavior that was deferred
// until information could be modeled.

import type { SeatId } from '../board.js';
import type { BotMoveContext } from './types.js';
import type { PieceBelief } from './belief.js';
import { moveDistance } from './distances.js';
import { likelyFlagCell } from './flaghypothesis.js';
import type { GameState } from '../engine.js';

/** Per-piece information value for every living enemy piece. */
export function computeInfoValues(
  view: BotMoveContext['view'],
  beliefs: Map<string, PieceBelief>,
  mySeat: SeatId,
): Map<string, number> {
  const myTeam = view.mode === '2v2' ? view.teams[mySeat] : null;
  const isEnemy = (owner: SeatId) =>
    view.mode === '2v2' ? view.teams[owner] !== myTeam : owner !== mySeat;

  const flagBySeat = new Map<SeatId, string | null>();
  const values = new Map<string, number>();
  for (const p of view.pieces) {
    if (!isEnemy(p.owner)) continue;
    const b = beliefs.get(p.id);
    if (b?.knownKind) continue; // nothing left to learn
    const w = b && (b.minRank != null || b.maxRank != null) ? 0.4 : 1.0;
    if (!flagBySeat.has(p.owner)) flagBySeat.set(p.owner, likelyFlagCell(view, p.owner));
    const flag = flagBySeat.get(p.owner);
    const relevance = flag ? 1 / (1 + moveDistance(p.cellId, flag)) : 0.2;
    values.set(p.id, w * relevance);
  }
  return values;
}

/** Mutable per-(sample, root-move) accumulator threaded through a rollout. */
export interface InfoTracker {
  mySeat: SeatId;
  /** infoWeight × infoValue credited on first combat per priced piece. */
  weight: number;
  values: Map<string, number>;
  credited: Set<string>;
  bonus: number;
}

export function makeInfoTracker(
  mySeat: SeatId,
  weight: number,
  values: Map<string, number>,
): InfoTracker {
  return { mySeat, weight, values, credited: new Set(), bonus: 0 };
}

/** Shallow fork: shared price list, branch-local credit/bonus. */
export function forkInfoTracker(t: InfoTracker): InfoTracker {
  return { ...t, credited: new Set(t.credited) };
}

/**
 * Call BEFORE a move is applied. If the destination is occupied this is a
 * combat; credit any priced enemy piece fighting one of MY pieces (the only
 * combats whose outcome the real fog-of-war view reveals to me).
 */
export function creditCombatInfo(t: InfoTracker, state: GameState, from: string, to: string): void {
  const defenderId = state.cellIndex[to];
  if (!defenderId) return;
  const attackerId = state.cellIndex[from];
  if (!attackerId) return;
  const attacker = state.pieces[attackerId]!;
  const defender = state.pieces[defenderId]!;
  // My piece attacks a priced enemy…
  if (attacker.owner === t.mySeat) creditPiece(t, defenderId);
  // …or a priced enemy attacks my piece.
  if (defender.owner === t.mySeat) creditPiece(t, attackerId);
}

function creditPiece(t: InfoTracker, pieceId: string): void {
  if (t.credited.has(pieceId)) return;
  const v = t.values.get(pieceId);
  if (v === undefined) return;
  t.credited.add(pieceId);
  t.bonus += t.weight * v;
}
