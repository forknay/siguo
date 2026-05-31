// Per-piece belief tracking under STRICT fog of war.
//
// Inference rules (local-only — no constraint propagation):
//
//   - Own pieces: kind known directly from the view.
//   - Opponent piece sitting at a cell where the viewer was a combatant in the
//     MOST RECENT combat at that cell (and the piece is the survivor) → derive
//     rank bounds from the combat outcome + the viewer's own known piece rank.
//   - Per-cell `mineConfidence` 0..1 derived from position + failed attacks.
//     Cells where high-rank attackers died are very likely mines.
//   - Position priors: HQ + unmoved → flag candidate; back-row + unmoved
//     bias toward mine.
//
// The cell-trail tracking is approximate — when a survivor moves later we
// transfer its bounds along its trail. Pieces with no combat history retain
// only the position-prior estimate.

import { getCell } from '../board.js';
import { type MoveRecord, type SeatId, isResignEntry } from '../engine.js';
import { PIECE_DEFS, type PieceKind } from '../pieces.js';
import type { PlayerView } from '../view.js';

export interface PieceBelief {
  pieceId: string;
  owner: SeatId;
  cellId: string;
  alive: boolean;
  /** Definitely this kind (own pieces, or revealed by an exception like flag-reveal). */
  knownKind: PieceKind | null;
  /** Lower bound on the piece's rank (1..9), null if no constraint. */
  minRank: number | null;
  /** Upper bound on the piece's rank (1..9), null if no constraint. */
  maxRank: number | null;
  /** Best single-number rank estimate for combat scoring. */
  estimatedRank: number;
  /** Per-cell mine confidence (only meaningful for opponent pieces in back row). */
  mineConfidence: number;
  /** Indicators */
  hasMoved: boolean;
  inHQ: boolean;
  inBackRow: boolean;
}

/** Average rank of the 19 mobile soldier pieces in the roster. */
export const AVG_MOBILE_RANK = 4.16;

interface CellTrail {
  /** Most-recent rank bound on the piece currently at this cell (lower bound). */
  minRank?: number;
  /** Most-recent rank bound on the piece currently at this cell (upper bound). */
  maxRank?: number;
  /** Per-cell mine confidence from observed failed attacks. */
  mineHits: number;
  /** Has any successful non-engineer move into this cell occurred? (decays mine confidence) */
  cleared: boolean;
}

function emptyTrail(): CellTrail {
  return { mineHits: 0, cleared: false };
}

/** Build belief records for every piece in the current view. */
export function computeBeliefs(view: PlayerView, viewerSeat: SeatId): Map<string, PieceBelief> {
  const beliefs = new Map<string, PieceBelief>();

  // Map cellId → current trail (bounds + mine hits for the piece sitting there).
  const cellTrails = new Map<string, CellTrail>();
  const movedIntoCell = new Set<string>();

  for (const rec of view.moveHistory) {
    if (isResignEntry(rec)) continue;
    const { from, to, combat } = rec;
    // movedIntoCell is updated per-branch below; defender-survives must NOT
    // mark the cell as moved-into because the defender hasn't moved.

    if (!combat) {
      // Plain move: the piece at `from` moved to `to`. Transfer trail; the
      // destination cell is now "cleared" (a piece walked in without dying).
      const existing = cellTrails.get(from) ?? emptyTrail();
      cellTrails.delete(from);
      cellTrails.set(to, { ...existing, mineHits: 0, cleared: true });
      // The piece itself moved → mark hasMoved for the destination.
      movedIntoCell.add(to);
      continue;
    }

    // Determine ranks we can derive (only when viewer was a combatant).
    const viewerIsAttacker = rec.seat === viewerSeat;
    const viewerIsDefender = combat.defenderSeat === viewerSeat;
    const attackerRank = viewerIsAttacker && combat.attackerKind
      ? PIECE_DEFS[combat.attackerKind].rank
      : null;
    const defenderRank = viewerIsDefender && combat.defenderKind
      ? PIECE_DEFS[combat.defenderKind].rank
      : null;
    const attackerKindKnown = viewerIsAttacker ? combat.attackerKind : undefined;

    if (combat.winner === 'tie') {
      cellTrails.delete(from);
      cellTrails.delete(to);
      continue;
    }

    if (combat.winner === 'attacker') {
      // Attacker moves to `to`, killing defender.
      const fromTrail = cellTrails.get(from) ?? emptyTrail();
      cellTrails.delete(from);
      const newTrail: CellTrail = { ...fromTrail, mineHits: 0, cleared: true };
      if (defenderRank !== null) {
        newTrail.minRank = Math.max(newTrail.minRank ?? 0, defenderRank + 1);
      }
      cellTrails.set(to, newTrail);
      movedIntoCell.add(to);
    } else if (combat.winner === 'defender') {
      // Defender stays in place. Attacker dies. The defender did NOT move.
      cellTrails.delete(from);
      const toTrail = cellTrails.get(to) ?? emptyTrail();
      if (attackerRank !== null && attackerKindKnown !== 'GONGBING') {
        // Our attacker died — defender is mine OR rank ≥ our attacker's.
        if (attackerRank >= 7) toTrail.mineHits += 1; // strong signal: only mines beat heavies
        else if (attackerRank >= 5) toTrail.mineHits += 0.6;
        else toTrail.mineHits += 0.3;
        toTrail.minRank = Math.max(toTrail.minRank ?? 0, attackerRank);
      } else if (attackerKindKnown === 'GONGBING') {
        // Engineer attacked and lost → defender was NOT a mine (engineer would
        // have won). Must be a ranked piece > 1.
        toTrail.cleared = true;
        toTrail.minRank = Math.max(toTrail.minRank ?? 0, 2);
      }
      cellTrails.set(to, toTrail);
      // movedIntoCell is NOT updated — defender stayed put.
    }
  }

  for (const p of view.pieces) {
    const cell = getCell(p.cellId);
    const inHQ = cell.type === 'HQ';
    const inBackRow = cell.row <= 2;
    const hasMoved = movedIntoCell.has(p.cellId);
    const trail = cellTrails.get(p.cellId) ?? emptyTrail();

    let knownKind: PieceKind | null = p.kind ?? null;

    // Mine confidence: only meaningful for opponent pieces.
    // Sum a position prior + observed hits, capped at 1.
    let mineConfidence = 0;
    if (p.owner !== viewerSeat) {
      if (inBackRow && !hasMoved && !trail.cleared) mineConfidence += 0.3;
      mineConfidence += trail.mineHits * 0.3;
      if (trail.cleared) mineConfidence = 0;
      if (knownKind === 'DILEI') mineConfidence = 1;
      mineConfidence = Math.min(1, mineConfidence);
    }

    beliefs.set(p.id, {
      pieceId: p.id,
      owner: p.owner,
      cellId: p.cellId,
      alive: !p.frozen,
      knownKind,
      minRank: trail.minRank ?? null,
      maxRank: trail.maxRank ?? null,
      estimatedRank: estimateRank(knownKind, hasMoved, inHQ, inBackRow, trail.minRank, mineConfidence),
      mineConfidence,
      hasMoved,
      inHQ,
      inBackRow,
    });
  }

  return beliefs;
}

/**
 * Single-number rank for scoring. Higher = stronger; bombs and mines have
 * sentinel-high values so non-engineer attackers correctly avoid them.
 *
 * Priority order:
 *   1. Known kind → its actual rank (or special for bomb/mine/flag).
 *   2. Inferred minRank from combat history → use that (or its midpoint with 9).
 *   3. Position priors: HQ unmoved (flag candidate) → low; back-row unmoved → high.
 *   4. Has moved → narrow toward soldier average.
 *   5. Default to roster average.
 */
export function estimateRank(
  knownKind: PieceKind | null,
  hasMoved: boolean,
  inHQ: boolean,
  inBackRow: boolean,
  minRank?: number | null | undefined,
  mineConfidence?: number,
): number {
  if (knownKind) {
    const rank = PIECE_DEFS[knownKind].rank;
    if (rank !== null) return rank;
    if (knownKind === 'JUNQI') return 0;
    if (knownKind === 'ZHADAN') return 10;
    if (knownKind === 'DILEI') return 8;
    return AVG_MOBILE_RANK;
  }
  // Inferred bound takes precedence over the back-row prior (more info).
  if (minRank != null && minRank > 0) {
    // The piece is at LEAST this strong. Midpoint between bound and ceiling.
    return Math.min(9, (minRank + 9) / 2);
  }
  // High mine confidence → treat as dangerous.
  if (mineConfidence != null && mineConfidence > 0.5) return 8;
  if (inHQ && !hasMoved) return 1.5; // flag candidate
  if (inBackRow && !hasMoved) return 7; // mine/defender bias
  if (hasMoved) return AVG_MOBILE_RANK;
  return AVG_MOBILE_RANK;
}

/** Used by setup priors. */
export type { MoveRecord };
