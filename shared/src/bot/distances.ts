// Static all-pairs MOVE distances over the empty board, precomputed at module
// load. One "move" = one road step OR one unobstructed rail slide (any length,
// including the central corner curves) — i.e. the number of turns a generic
// mobile (non-engineer) piece needs to travel between two cells on an empty
// board. This is an admissible lower bound under occupancy, and far more honest
// than the Manhattan distance previously used by the spatial evaluation
// (Manhattan walks through the cross's empty corners and ignores rails).
//
// 129 cells → 129 BFS runs over one-move neighbor lists. A few ms at startup.

import { BOARD } from '../board.js';
import { legalMovesFromCell, type MoveContext } from '../moves.js';

const CELL_IDS: string[] = [...BOARD.cells.keys()];
const INDEX = new Map<string, number>(CELL_IDS.map((id, i) => [i >= 0 ? id : id, i]));

/** dist[i][j] = moves for a mobile piece from cell i to cell j on an empty board. */
const DIST: Int8Array[] = [];

function buildNeighbors(): string[][] {
  // One-move reachability per source cell: place a lone generic mobile piece
  // (排长 — slides but can't corner) on the cell and ask the move generator.
  // HQ cells return [] (HQ immobility) — correct: you can enter but not leave.
  const out: string[][] = [];
  for (const from of CELL_IDS) {
    const ctx: MoveContext = {
      pieceAt: (cellId) =>
        cellId === from
          ? { id: 'probe', cellId: from, kind: 'PAIZHANG', owner: 'N' }
          : null,
      isAlly: (a, b) => a === b,
    };
    out.push(legalMovesFromCell(ctx, from));
  }
  return out;
}

function buildDistances(): void {
  const neighbors = buildNeighbors();
  const n = CELL_IDS.length;
  for (let src = 0; src < n; src++) {
    const row = new Int8Array(n).fill(-1);
    row[src] = 0;
    const queue = [src];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const d = row[cur]!;
      for (const nb of neighbors[cur]!) {
        const ni = INDEX.get(nb)!;
        if (row[ni] === -1) {
          row[ni] = d + 1;
          queue.push(ni);
        }
      }
    }
    DIST.push(row);
  }
}

buildDistances();

/**
 * Move distance between two cells for a generic mobile piece on an empty
 * board. Returns a large sentinel (64) when unreachable (e.g. FROM an HQ,
 * where pieces are immobile).
 */
export function moveDistance(fromCellId: string, toCellId: string): number {
  const i = INDEX.get(fromCellId);
  const j = INDEX.get(toCellId);
  if (i === undefined || j === undefined) return 64;
  const d = DIST[i]![j]!;
  return d < 0 ? 64 : d;
}
