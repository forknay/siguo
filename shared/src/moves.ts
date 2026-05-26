// Legal-move generator for Si Guo Jun Qi.
//
// Movement summary:
//   Roads (one step) — orthogonal neighbors + the 4 X-diagonals around the camp cluster.
//   Rails (multi-step slide) — only mobile pieces standing on a rail cell may use rails.
//     - Non-engineer: pick one direction; slide while empty; stop at the first non-empty
//       cell (combat if enemy, blocked if ally) or at the rail terminus.
//     - Engineer: BFS across rail-connected cells; can turn corners freely.
//
// Special cell rules:
//   * Camps (行营) hold at most one piece; cannot be attacked. A move into a camp is
//     legal only if the camp is empty.
//   * HQs: a piece occupying an HQ cannot leave it (HQ immobility, v1 rule).
//   * Central cells (the 3×3 九宫) are stoppable rail nodes — pieces may rest on them.
//   * Teammates block each other; you can never stop on a teammate's cell.

import {
  BOARD,
  DIRECTIONS,
  type Direction,
  getCell,
  getRailNeighbor,
  getRoadNeighbors,
} from './board.js';
import { PIECE_DEFS, type PieceKind } from './pieces.js';

export type SeatId = 'N' | 'E' | 'S' | 'W';

export interface PieceRef {
  id: string;
  kind: PieceKind;
  owner: SeatId;
  cellId: string;
}

export interface MoveContext {
  /** Return the piece at the given cell, or null if empty. */
  pieceAt: (cellId: string) => PieceRef | null;
  /** True if two seats are on the same side (FFA: always false unless equal). */
  isAlly: (a: SeatId, b: SeatId) => boolean;
}

/** All cells the piece at `fromCellId` may legally move to in one turn. */
export function legalMovesFromCell(ctx: MoveContext, fromCellId: string): string[] {
  const piece = ctx.pieceAt(fromCellId);
  if (!piece) return [];
  const cell = getCell(fromCellId);
  const def = PIECE_DEFS[piece.kind];
  if (!def.mobile) return [];
  if (cell.type === 'HQ') return []; // HQ immobility

  const out = new Set<string>();

  // Road moves: every orthogonal neighbor + X-diagonals.
  for (const neighborId of getRoadNeighbors(fromCellId)) {
    if (canStopAt(ctx, piece, neighborId)) out.add(neighborId);
  }

  // Rail moves: only if standing on rail.
  if (cell.onRail) {
    if (piece.kind === 'GONGBING') {
      bfsRail(ctx, piece, fromCellId, out);
    } else {
      for (const dir of DIRECTIONS) {
        slideRail(ctx, piece, fromCellId, dir, out);
      }
    }
  }

  return Array.from(out);
}

/** All legal (from, to) move pairs for a seat in the current state. */
export function legalMovesForSeat(
  ctx: MoveContext,
  seat: SeatId,
  ownedPieces: PieceRef[],
): Array<{ from: string; to: string }> {
  const moves: Array<{ from: string; to: string }> = [];
  for (const piece of ownedPieces) {
    if (piece.owner !== seat) continue;
    for (const to of legalMovesFromCell(ctx, piece.cellId)) {
      moves.push({ from: piece.cellId, to });
    }
  }
  return moves;
}

function canStopAt(ctx: MoveContext, mover: PieceRef, cellId: string): boolean {
  const cell = getCell(cellId);
  const occupant = ctx.pieceAt(cellId);
  if (occupant && ctx.isAlly(occupant.owner, mover.owner)) return false;
  if (cell.type === 'CAMP') {
    // Camps are safe (cannot be attacked) and may not be entered if occupied.
    if (occupant) return false;
  }
  return true;
}

function slideRail(
  ctx: MoveContext,
  mover: PieceRef,
  fromCellId: string,
  dir: Direction,
  out: Set<string>,
): void {
  let current = fromCellId;
  while (true) {
    const nextId = getRailNeighbor(current, dir);
    if (!nextId) return;
    const next = getCell(nextId);
    const occupant = ctx.pieceAt(nextId);
    if (occupant) {
      if (ctx.isAlly(occupant.owner, mover.owner)) return; // blocked
      if (next.type !== 'CAMP') out.add(nextId);
      return;
    }
    // Empty cell — legal stop.
    out.add(nextId);
    current = nextId;
  }
}

function bfsRail(
  ctx: MoveContext,
  mover: PieceRef,
  fromCellId: string,
  out: Set<string>,
): void {
  const visited = new Set<string>([fromCellId]);
  const queue: string[] = [fromCellId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const rails = BOARD.rails.get(cur);
    if (!rails) continue;
    for (const dir of DIRECTIONS) {
      const nextId = rails[dir];
      if (!nextId || visited.has(nextId)) continue;
      visited.add(nextId);
      const next = getCell(nextId);
      const occupant = ctx.pieceAt(nextId);
      if (occupant) {
        if (ctx.isAlly(occupant.owner, mover.owner)) continue;
        if (next.type !== 'CAMP') out.add(nextId);
        continue;
      }
      out.add(nextId);
      queue.push(nextId);
    }
  }
}
