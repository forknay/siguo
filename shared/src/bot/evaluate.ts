// Terminal-aware utility for v3-mc / v3.1 rollouts. Returns a single number per
// rollout-end state, from MY team's perspective. Higher = better for me.
//
// The base evaluation (material + Marshal-alive + win/loss sentinels) is what
// v3-mc uses. v3.1 passes `spatial` weights to add:
//   - flag-proximity: reward our pieces being near the enemy flag (offense).
//   - own-flag safety: penalty for enemy pieces near our flag (defense).
// Because rollouts run in a concrete sampled world, the flag cells are known
// exactly within each sample; averaging across samples gives the right expected
// value.

import { getCell, type SeatId } from '../board.js';
import { type GameState, type PieceState, STALEMATE_LIMIT, TEAMS_2V2 } from '../engine.js';
import { PIECE_VALUE } from './values.js';
import { moveDistance } from './distances.js';

const WIN_BONUS = 100_000;
const LOSE_PENALTY = -100_000;
const MARSHAL_ALIVE_BONUS = 500;
/** Initial material per team (both seats' full rosters), for trade-policy scaling. */
const TEAM_START_MATERIAL = (() => {
  let one = 0;
  for (const [k, v] of Object.entries(PIECE_VALUE)) {
    if (k === 'JUNQI') continue; // flag value is a win sentinel, not material
    const count = k === 'SILING' || k === 'JUNZHANG' ? 1
      : k === 'SHIZHANG' || k === 'LUZHANG' || k === 'TUANZHANG' || k === 'YINGZHANG' || k === 'ZHADAN' ? 2
      : 3;
    one += v * count;
  }
  return one * 2;
})();

export interface SpatialWeights {
  /** Reward per unit of "closeness" of our nearest piece to an enemy flag. */
  flagAdvance: number;
  /** Penalty per unit of "closeness" of the nearest enemy to our flag. */
  flagSafety: number;
  /** Use the precomputed graph move-distance table instead of Manhattan (D7). */
  graphDistance?: boolean;
  /** Stalemate-clock awareness weight (D5): leading + stale clock = bad. */
  clock?: number;
  /** Trade-policy strength (I2): material lead counts more in sparser positions. */
  tradeScale?: number;
  /** Camp refuge bonus per high-value own piece sheltered in a camp (D6). */
  campRefuge?: number;
  /**
   * I3 — dead-partner urgency. When our partner is eliminated it's 1v2: even
   * trades lose the attrition race, so the trade-policy sign flips (avoid
   * simplifying) and flag-advance is boosted (play for the snipe; the
   * stalemate clock already rewards running out the 70-move draw when behind).
   */
  downPlayerUrgency?: boolean;
  /**
   * Loss-forensics fix (2026-06-12): multiplier on `flagSafety` for a flag
   * whose location is PUBLIC (`flagRevealed`, i.e. its marshal died). In the
   * analyzed losses our flags fell 2–10 turns after the reveal — the opponent
   * rails straight in while the defense term stays at peacetime weight.
   * Symmetrically multiplies `flagAdvance` toward revealed ENEMY flags.
   * NOTE: the ×3 symmetric variant (`v4-flagurgent`) regressed (62.5%) —
   * boosting offense at material's expense lost more than the defense gained.
   * Prefer `revealedDefenseUrgency` (defense-only, softer) instead.
   */
  revealedFlagUrgency?: number;
  /**
   * Loss-forensics fix v2 (2026-06-13): DEFENSE-ONLY reveal urgency. Multiplies
   * `flagSafety` for a revealed OWN flag but leaves offense at peacetime weight,
   * targeting loss pattern (a) — our flag falling shortly after our marshal's
   * death — without over-weighting the race the way the symmetric ×3 did.
   * Applied independently of (and in addition to) `revealedFlagUrgency`.
   */
  revealedDefenseUrgency?: number;
}

/** Score the rollout end state from `mySeat`'s perspective. */
export function evaluateRollout(
  state: GameState,
  mySeat: SeatId,
  spatial?: SpatialWeights,
): number {
  // Terminal result short-circuits.
  if (state.result) {
    if (state.result.kind === 'TEAM_WIN') {
      return state.result.team === TEAMS_2V2[mySeat] ? WIN_BONUS : LOSE_PENALTY;
    }
    if (state.result.kind === 'PLAYER_WIN') {
      return state.result.seat === mySeat ? WIN_BONUS : LOSE_PENALTY;
    }
    if (state.result.kind === 'DRAW') return 0;
  }

  const myTeam = state.mode === '2v2' ? TEAMS_2V2[mySeat] : null;
  const isMine = (owner: SeatId) =>
    state.mode === '2v2' ? TEAMS_2V2[owner] === myTeam : owner === mySeat;

  let myTeamMaterial = 0;
  let oppTeamMaterial = 0;
  let myMarshalAlive = false;
  let partnerMarshalAlive = false;
  const myMobile: PieceState[] = [];
  const oppMobile: PieceState[] = [];
  const myFlags: PieceState[] = [];
  const oppFlags: PieceState[] = [];

  for (const p of Object.values(state.pieces)) {
    if (state.seats[p.owner].eliminated) continue;
    const mine = isMine(p.owner);
    const v = PIECE_VALUE[p.kind];
    if (mine) myTeamMaterial += v; else oppTeamMaterial += v;
    if (p.kind === 'SILING') {
      if (mine && p.owner === mySeat) myMarshalAlive = true;
      else if (mine) partnerMarshalAlive = true;
    }
    if (p.kind === 'JUNQI') {
      (mine ? myFlags : oppFlags).push(p);
    } else if (p.kind !== 'DILEI') {
      (mine ? myMobile : oppMobile).push(p);
    }
  }

  const materialDelta = myTeamMaterial - oppTeamMaterial;
  let utility = materialDelta / 10;

  // I3: 1v2 after losing the partner — flip trade policy, press for the flag.
  const partnerDead = !!spatial?.downPlayerUrgency
    && state.mode === '2v2'
    && (['N', 'E', 'S', 'W'] as SeatId[]).some(
      (s) => s !== mySeat && TEAMS_2V2[s] === myTeam && state.seats[s].eliminated,
    );

  // I2 trade policy: the same lead is worth more in a sparser position, so
  // rollouts prefer simplifying when ahead and avoid trades when behind.
  // Down a player, the sign flips: we lose any attrition race, avoid trades.
  if (spatial?.tradeScale) {
    const sparsity = 1 - Math.min(1, (myTeamMaterial + oppTeamMaterial) / TEAM_START_MATERIAL);
    utility += (materialDelta / 10) * spatial.tradeScale * sparsity * (partnerDead ? -1 : 1);
  }

  if (myMarshalAlive) utility += MARSHAL_ALIVE_BONUS;
  if (partnerMarshalAlive) utility += MARSHAL_ALIVE_BONUS / 2;

  // D5 clock awareness: a stale capture clock pushes toward the 70-move draw.
  // Leading → a draw robs us (penalty grows with the clock); trailing → the
  // draw is a save (reward running the clock).
  if (spatial?.clock) {
    const clockFrac = state.movesSinceCapture / STALEMATE_LIMIT;
    const leadFrac = Math.max(-1, Math.min(1, materialDelta / 500));
    utility -= spatial.clock * clockFrac * leadFrac;
  }

  if (spatial) {
    const dist = spatial.graphDistance ? graphNearest : manhattanNearest;
    const advanceW = spatial.flagAdvance * (partnerDead ? 1.5 : 1);
    const urgency = spatial.revealedFlagUrgency ?? 1;
    // Offense: our nearest mobile piece to each enemy flag. Closer = better.
    // A revealed enemy flag is a free target — race for it.
    for (const flag of oppFlags) {
      const d = dist(flag, myMobile);
      if (d !== null) {
        utility += advanceW * (state.flagRevealed[flag.owner] ? urgency : 1) * (1 / (1 + d));
      }
    }
    // Defense: nearest enemy mobile piece to our flag. Closer = worse. A
    // revealed OWN flag is under the gun — defense escalates past peacetime.
    // `revealedDefenseUrgency` (defense-only) stacks on `revealedFlagUrgency`.
    const defenseUrgency = urgency * (spatial.revealedDefenseUrgency ?? 1);
    for (const flag of myFlags) {
      const d = dist(flag, oppMobile);
      if (d !== null) {
        utility -= spatial.flagSafety * (state.flagRevealed[flag.owner] ? defenseUrgency : 1) * (1 / (1 + d));
      }
    }

    // D6 camp refuge: high-value own pieces parked in attack-proof camps.
    if (spatial.campRefuge) {
      for (const p of myMobile) {
        if (PIECE_VALUE[p.kind] >= 175 && getCell(p.cellId).type === 'CAMP') {
          utility += spatial.campRefuge;
        }
      }
    }
  }

  return utility;
}

function manhattanNearest(target: PieceState, from: PieceState[]): number | null {
  if (from.length === 0) return null;
  const t = getCell(target.cellId);
  let best = Infinity;
  for (const p of from) {
    const c = getCell(p.cellId);
    const d = Math.abs(c.x - t.x) + Math.abs(c.y - t.y);
    if (d < best) best = d;
  }
  return best;
}

/** True board move-distance (D7) — pieces travel on rails, not through walls. */
function graphNearest(target: PieceState, from: PieceState[]): number | null {
  if (from.length === 0) return null;
  let best = Infinity;
  for (const p of from) {
    const d = moveDistance(p.cellId, target.cellId);
    if (d < best) best = d;
  }
  return best === Infinity ? null : best;
}

/** v3.1's spatial weights — tuned small relative to material magnitudes. */
export const V31_SPATIAL: SpatialWeights = {
  flagAdvance: 300,
  flagSafety: 400,
};

/** v4's weights: graph distances + clock + trade policy + camp refuge.
 *  Flag weights bumped because graph distances are systematically smaller
 *  than Manhattan (a cross-board rail trip is ~2–3 moves, not ~10 cells),
 *  so 1/(1+d) saturates higher. */
export const V4_SPATIAL: SpatialWeights = {
  flagAdvance: 350,
  flagSafety: 450,
  graphDistance: true,
  clock: 250,
  tradeScale: 0.6,
  campRefuge: 40,
};
