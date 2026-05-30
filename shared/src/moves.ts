// Legal-move generator for Si Guo Jun Qi.
//
// Movement summary:
//   Roads (one step) — orthogonal neighbors + the 4 X-diagonals around the camp cluster.
//   Rails (multi-step slide) — only mobile pieces standing on a rail cell may use rails.
//     - Non-engineer: pick one direction; slide while empty; stop at the first non-empty
//       cell (combat if enemy, blocked if ally) or at the rail terminus. Additionally,
//       the four corner cells of the central rail (the smooth banked curves where two
//       adjacent zones meet) are passable by any piece — a non-engineer slide may
//       follow the curve from one zone's front line through the corner cell to the
//       neighboring zone's front line.
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
  if (cell.transitOnly) return false;
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
  let currentDir = dir;
  while (true) {
    const nextId = getRailNeighbor(current, currentDir);
    if (!nextId) return;
    const next = getCell(nextId);
    const occupant = ctx.pieceAt(nextId);
    const curveExitDir = CORNER_CURVE_EXITS[nextId]?.[currentDir];
    if (occupant) {
      // Corner-curve cells (C-1-1, C-1-3, C-3-1, C-3-3) host TWO logical roads:
      // the regular rail through the corner cell AND the curved highway that
      // bypasses it. A piece sitting on the corner cell occupies the rail-road
      // but does NOT block the curve. So: combat/block applies normally on the
      // corner road, but the curve continuation fires regardless.
      if (curveExitDir) {
        if (!ctx.isAlly(occupant.owner, mover.owner) && next.type !== 'CAMP') {
          out.add(nextId);
        }
        slideRail(ctx, mover, nextId, curveExitDir, out);
        return;
      }
      if (ctx.isAlly(occupant.owner, mover.owner)) return;
      if (next.type !== 'CAMP') out.add(nextId);
      return;
    }
    // Empty cell — legal stop unless it's a transit-only junction (C-2-2).
    if (!next.transitOnly) out.add(nextId);
    // Empty corner cell — fork into the curve direction as before.
    if (curveExitDir) {
      slideRail(ctx, mover, nextId, curveExitDir, out);
    }
    current = nextId;
  }
}

/**
 * Curve-bypass edges: pairs of zone front-line cells that are connected via the
 * curved highway through a corner cell. These edges exist independently of the
 * corner cell's occupancy, so engineers can traverse them even when the corner
 * is blocked. Used by the engineer rail BFS.
 */
const CURVE_BYPASSES: Record<string, string[]> = {
  'W-6-5': ['N-6-1'],
  'N-6-1': ['W-6-5'],
  'N-6-5': ['E-6-1'],
  'E-6-1': ['N-6-5'],
  'W-6-1': ['S-6-5'],
  'S-6-5': ['W-6-1'],
  'E-6-5': ['S-6-1'],
  'S-6-1': ['E-6-5'],
};

/**
 * Corner cells of the central 3×3 rail grid are visually rendered as smooth
 * banked curves connecting two zones' front lines. A slide that ENTERS a corner
 * cell in one direction may continue THROUGH the curve and exit perpendicular,
 * without counting as a 90° turn for non-engineers.
 *
 * Encoded as: cornerCellId → entry-direction → curve-exit direction.
 *   C(1,1): connects W(6,5) ↔ N(6,1). East-entry curves north; south-entry curves west.
 *   C(1,3): connects N(6,5) ↔ E(6,1). South-entry curves east;  west-entry curves north.
 *   C(3,1): connects W(6,1) ↔ S(6,5). East-entry curves south;  north-entry curves west.
 *   C(3,3): connects E(6,5) ↔ S(6,1). West-entry curves south;  north-entry curves east.
 */
const CORNER_CURVE_EXITS: Record<string, Partial<Record<Direction, Direction>>> = {
  'C-1-1': { E: 'N', S: 'W' },
  'C-1-3': { W: 'N', S: 'E' },
  'C-3-1': { E: 'S', N: 'W' },
  'C-3-3': { W: 'S', N: 'E' },
};

/**
 * Reconstruct the ordered list of cells a move traverses, for path-following
 * animations and replay rendering.
 *
 *   - Road step? returns [from, to].
 *   - Rail slide (non-engineer): walks each direction; if the reached cell list
 *     contains the destination, returns the prefix up to it (handles curve corners).
 *   - Rail BFS (engineer): if no straight slide found, runs a BFS over rail edges
 *     + curve bypasses to find the SHORTEST rail path. Returns the path with
 *     intermediate cells included.
 *
 * Falls back to [from, to] if nothing matches (caller can still animate straight).
 */
export function pathOfMove(fromCellId: string, toCellId: string): string[] {
  const from = getCell(fromCellId);
  if (fromCellId === toCellId) return [fromCellId];

  // Road step?
  if (getRoadNeighbors(fromCellId).includes(toCellId)) {
    return [fromCellId, toCellId];
  }

  // Single-direction rail slide?
  if (from.onRail) {
    for (const dir of DIRECTIONS) {
      const trail = walkRail(fromCellId, dir);
      const idx = trail.indexOf(toCellId);
      if (idx >= 0) return [fromCellId, ...trail.slice(0, idx + 1)];
    }
    // Engineer multi-leg BFS — find shortest rail-path including curve bypasses.
    const bfsPath = railShortestPath(fromCellId, toCellId);
    if (bfsPath) return bfsPath;
  }

  return [fromCellId, toCellId];
}

/** BFS along rail edges + CURVE_BYPASSES to find the shortest cell path. */
function railShortestPath(fromCellId: string, toCellId: string): string[] | null {
  const parents = new Map<string, string | null>([[fromCellId, null]]);
  const queue: string[] = [fromCellId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toCellId) {
      // Reconstruct.
      const path: string[] = [];
      let n: string | null = cur;
      while (n !== null) {
        path.unshift(n);
        n = parents.get(n) ?? null;
      }
      return path;
    }
    const rails = BOARD.rails.get(cur);
    if (rails) {
      for (const dir of DIRECTIONS) {
        const next = rails[dir];
        if (next && !parents.has(next)) {
          parents.set(next, cur);
          queue.push(next);
        }
      }
    }
    const bypasses = CURVE_BYPASSES[cur];
    if (bypasses) {
      for (const next of bypasses) {
        if (!parents.has(next)) {
          parents.set(next, cur);
          queue.push(next);
        }
      }
    }
  }
  return null;
}

/** Trace a single non-engineer slide direction including curve exits. */
function walkRail(fromCellId: string, dir: Direction): string[] {
  const path: string[] = [];
  let current = fromCellId;
  let currentDir = dir;
  // Cap iterations to avoid pathological loops.
  for (let i = 0; i < 50; i++) {
    const nextId = getRailNeighbor(current, currentDir);
    if (!nextId) return path;
    path.push(nextId);
    const curveExit = CORNER_CURVE_EXITS[nextId]?.[currentDir];
    if (curveExit) currentDir = curveExit;
    current = nextId;
  }
  return path;
}

function bfsRail(
  ctx: MoveContext,
  mover: PieceRef,
  fromCellId: string,
  out: Set<string>,
): void {
  const visited = new Set<string>([fromCellId]);
  const queue: string[] = [fromCellId];
  const visit = (nextId: string) => {
    if (visited.has(nextId)) return;
    visited.add(nextId);
    const next = getCell(nextId);
    const occupant = ctx.pieceAt(nextId);
    if (occupant) {
      if (ctx.isAlly(occupant.owner, mover.owner)) return;
      if (next.type !== 'CAMP') out.add(nextId);
      return;
    }
    if (!next.transitOnly) out.add(nextId);
    queue.push(nextId);
  };
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const rails = BOARD.rails.get(cur);
    if (rails) {
      for (const dir of DIRECTIONS) {
        const nextId = rails[dir];
        if (nextId) visit(nextId);
      }
    }
    // Curve-bypass edges: independent of corner-cell occupancy.
    const bypasses = CURVE_BYPASSES[cur];
    if (bypasses) {
      for (const nextId of bypasses) visit(nextId);
    }
  }
}
