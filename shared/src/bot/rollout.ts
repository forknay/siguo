// Fast policy + rollout for v3-mc. Takes a concrete (sampled) GameState and
// plays out D plies using a streamlined version of v2.1's EV scoring. Each
// turn, the current seat sees the full sampled world (debug-mode view) —
// rollouts are perfect-info within the sampled world. This is much faster
// than per-ply fog projection, at the cost of slightly overestimating
// opponent skill. First-pass simplification; see BOT.md § Rollout policy.

import {
  applyMoveForRollout,
  applyResign,
  legalMovesForTurn,
  type GameState,
  type SeatId,
} from '../engine.js';
import { getCell, getRoadNeighbors } from '../board.js';
import { TEAMS_2V2 } from '../engine.js';
import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import { PIECE_VALUE, strongMoveBonus } from './values.js';
import { creditCombatInfo, type InfoTracker } from './infovalue.js';
import { moveDistance } from './distances.js';

export interface PlayoutPolicy {
  /**
   * Probability of playing the argmax-weight move at each ply instead of a
   * weighted draw. The weighted draw injects a lot of variance into rollout
   * values (the depth experiment showed playout noise dominates); a greedier
   * playout estimates "reasonable continuation" with less noise. Keep < 1 so
   * rollouts still explore (and to avoid deterministic playout blind spots).
   */
  greedyEps: number;
  /**
   * Penalize quiet moves onto squares a stronger adjacent enemy (or a bomb)
   * could capture next ply (×0.2 weight). The unmodified policy hangs pieces
   * constantly, which is SYSTEMATIC rollout error, not just variance — every
   * line through a hung piece undervalues the position. Road/camp adjacency
   * approximation (rail snipes not checked); camps are attack-proof, so
   * destinations in camps are never "hanging".
   */
  avoidHanging?: boolean;
  /**
   * Additive weight for quiet moves that reduce graph distance to the nearest
   * enemy flag (and −1× for moves that increase it). Greedy playouts argmax
   * over quiet weights that are otherwise near-uniform (1 + strong bonus), so
   * without a directional term "greedy" quiet play is arbitrary shuffling.
   */
  advanceBias?: number;
}

/** Step the state forward `depth` plies using the fast policy. */
export function playOutFromSampled(
  initial: GameState,
  depth: number,
  rng: () => number,
  info?: InfoTracker,
  policy?: PlayoutPolicy,
): GameState {
  let state = initial;
  for (let d = 0; d < depth; d++) {
    if (state.phase !== 'PLAYING') break;
    const seat = state.turn;
    if (state.seats[seat].eliminated) break; // engine should have advanced; safety
    const pick = fastPickMove(state, seat, rng, policy);
    if (!pick) {
      state = applyResign(state, seat);
      continue;
    }
    if (info) creditCombatInfo(info, state, pick.from, pick.to);
    // The pick came from legalMovesForTurn, so we can skip re-validation and
    // all the bookkeeping a real game needs (history, knowledge sets).
    state = applyMoveForRollout(state, seat, pick.from, pick.to);
  }
  return state;
}

interface ScoredMove { from: string; to: string; weight: number; isAttack: boolean }

/** Score every legal move for the current seat (shared by the rollout policy
 *  and the reply-minimization probe). Anti-shuffle applied. Deterministic. */
function scoreMoves(state: GameState, seat: SeatId, policy?: PlayoutPolicy): ScoredMove[] {
  const moves = legalMovesForTurn(state);
  const myLast = state.lastMoveBySeat[seat];
  const out: ScoredMove[] = [];
  // Enemy flag cells (concrete in the sampled world) for the advance bias.
  let enemyFlags: string[] | null = null;
  if (policy?.advanceBias) {
    enemyFlags = [];
    const myTeam = state.mode === '2v2' ? TEAMS_2V2[seat] : null;
    for (const p of Object.values(state.pieces)) {
      if (p.kind !== 'JUNQI' || state.seats[p.owner].eliminated) continue;
      const enemy = state.mode === '2v2' ? TEAMS_2V2[p.owner] !== myTeam : p.owner !== seat;
      if (enemy) enemyFlags.push(p.cellId);
    }
  }
  for (const m of moves) {
    if (myLast && m.from === myLast.to && m.to === myLast.from) continue;
    const myPieceId = state.cellIndex[m.from];
    const targetId = state.cellIndex[m.to];
    if (!myPieceId) continue;
    const myKind = state.pieces[myPieceId]!.kind;
    const target = targetId ? state.pieces[targetId] : undefined;
    if (!target) {
      // Base weight 1 + a small strong-piece activation bias so rollouts don't
      // leave heavyweights parked (mirrors the root-level bias in v3-mc).
      let weight = 1 + strongMoveBonus(myKind);
      if (enemyFlags && enemyFlags.length > 0 && policy?.advanceBias) {
        let before = Infinity;
        let after = Infinity;
        for (const f of enemyFlags) {
          const db = moveDistance(m.from, f);
          const da = moveDistance(m.to, f);
          if (db < before) before = db;
          if (da < after) after = da;
        }
        weight += policy.advanceBias * Math.sign(before - after);
      }
      if (policy?.avoidHanging && hangsAt(state, seat, myKind, m.to)) weight *= 0.2;
      out.push({ from: m.from, to: m.to, weight, isAttack: false });
    } else {
      // Same-team is filtered by legalMovesForTurn; nothing to do here.
      out.push({ from: m.from, to: m.to, weight: fastScoreAttack(myKind, target.kind, m.to), isAttack: true });
    }
  }
  return out;
}

/** Would `myKind` standing on `to` be capturable by a stronger road-adjacent enemy? */
function hangsAt(state: GameState, seat: SeatId, myKind: PieceKind, to: string): boolean {
  if (myKind === 'ZHADAN') return false; // a bomb "hanging" trades up
  if (getCell(to).type === 'CAMP') return false; // camps are attack-proof
  const myRank = PIECE_DEFS[myKind].rank ?? 0;
  const myTeam = state.mode === '2v2' ? TEAMS_2V2[seat] : null;
  for (const nb of getRoadNeighbors(to)) {
    const pid = state.cellIndex[nb];
    if (!pid) continue;
    const p = state.pieces[pid]!;
    const enemy = state.mode === '2v2' ? TEAMS_2V2[p.owner] !== myTeam : p.owner !== seat;
    if (!enemy) continue;
    if (p.kind === 'ZHADAN') return true;
    const r = PIECE_DEFS[p.kind].rank;
    if (r !== null && r > myRank) return true;
  }
  return false;
}

/**
 * Opponent's strongest K replies by the fast policy's own scoring — used by
 * B4 reply-minimization to ask "what's the worst they can do to me next ply?".
 * Deterministic (no sampling): top attacks first, then best quiet move so a
 * pure-positional refutation (e.g. stepping onto our flag lane) is included.
 */
export function fastTopKMoves(state: GameState, k: number): Array<{ from: string; to: string }> {
  const scored = scoreMoves(state, state.turn);
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.weight - a.weight);
  const top = scored.slice(0, k);
  // Ensure at least one quiet move is represented if the top-K are all attacks.
  if (top.every((m) => m.isAttack)) {
    const quiet = scored.find((m) => !m.isAttack);
    if (quiet && top.length >= k) top[top.length - 1] = quiet;
    else if (quiet) top.push(quiet);
  }
  return top.map(({ from, to }) => ({ from, to }));
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
  policy?: PlayoutPolicy,
): { from: string; to: string } | null {
  const scored = scoreMoves(state, seat, policy);
  if (scored.length === 0) {
    const moves = legalMovesForTurn(state);
    if (moves.length === 0) return null;
    const fallback = moves[Math.floor(rng() * moves.length)]!;
    return { from: fallback.from, to: fallback.to };
  }
  if (policy && rng() < policy.greedyEps) {
    // Capture-first argmax. Attack weights (EV/5, a clean 排长 capture ≈ 5)
    // and quiet weights (1 + strongMoveBonus, up to ~13 for 司令) live on
    // different scales, so a single argmax would prefer shuffling heavyweights
    // over taking free material. Play the best clearly-winning attack if one
    // exists; otherwise the best quiet move.
    let bestAttack: ScoredMove | null = null;
    let bestQuiet: ScoredMove | null = null;
    for (const m of scored) {
      if (m.isAttack) {
        if (!bestAttack || m.weight > bestAttack.weight) bestAttack = m;
      } else if (!bestQuiet || m.weight > bestQuiet.weight) {
        bestQuiet = m;
      }
    }
    const best = bestAttack && bestAttack.weight > 4 ? bestAttack : bestQuiet ?? bestAttack!;
    return { from: best.from, to: best.to };
  }
  const attacks = scored.filter((m) => m.isAttack);
  const empties = scored.filter((m) => !m.isAttack);
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
