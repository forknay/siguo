// Flag-hypothesis: rank the cells that could hold a given opponent's flag.
//
// The flag never moves, so it sits in one of that seat's two HQ cells for the
// whole game. We can rule out an HQ once we observe a piece move OUT of it
// (the flag can't move, so a piece that left wasn't the flag — and an HQ holds
// at most one piece, so that HQ is now flag-free). We also rule in an HQ if the
// flag has been publicly revealed there (Marshal-death reveal).

import { getCell, type SeatId, type ZoneId } from '../board.js';
import { hqCellIds } from '../setup.js';
import { type MoveRecord, isResignEntry } from '../engine.js';
import type { PlayerView } from '../view.js';

export interface FlagHypothesis {
  seat: SeatId;
  /** Candidate HQ cell ids that could still hold the flag, most-likely first. */
  candidates: string[];
  /** True once the flag location is certain (1 candidate or publicly revealed). */
  certain: boolean;
}

export function flagHypothesisFor(view: PlayerView, seat: SeatId): FlagHypothesis {
  const [hqA, hqB] = hqCellIds(seat as ZoneId);
  let candidates = [hqA, hqB];

  // If the flag is revealed, the flag-piece's cell is known (it's the HQ whose
  // piece is visibly JUNQI). The view exposes flagRevealed; the actual cell is
  // whichever HQ currently holds a piece the viewer can see as JUNQI.
  if (view.flagRevealed[seat]) {
    const flagPiece = view.pieces.find((p) => p.owner === seat && p.kind === 'JUNQI');
    if (flagPiece) {
      return { seat, candidates: [flagPiece.cellId], certain: true };
    }
  }

  // Rule out an HQ if a piece has moved OUT of it.
  const vacatedHQs = hqsVacatedByMoves(view.moveHistory);
  candidates = candidates.filter((c) => !vacatedHQs.has(c));

  // If a candidate HQ is currently empty, the flag isn't there (flag never
  // leaves, so an empty HQ never held it — or it was captured, ending the game).
  const occupied = new Set(view.pieces.filter((p) => p.owner === seat).map((p) => p.cellId));
  const occupiedCandidates = candidates.filter((c) => occupied.has(c));
  if (occupiedCandidates.length > 0) candidates = occupiedCandidates;

  return { seat, candidates, certain: candidates.length <= 1 };
}

function hqsVacatedByMoves(history: MoveRecord[]): Set<string> {
  const vacated = new Set<string>();
  for (const rec of history) {
    if (isResignEntry(rec)) continue;
    const cell = getCell(rec.from);
    if (cell.type === 'HQ') vacated.add(rec.from);
  }
  return vacated;
}

/** The single most-likely flag cell for a seat (first candidate), or null. */
export function likelyFlagCell(view: PlayerView, seat: SeatId): string | null {
  const h = flagHypothesisFor(view, seat);
  return h.candidates[0] ?? null;
}
