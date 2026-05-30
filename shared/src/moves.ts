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
 * animations and replay rendering. For road moves the path is [from, to]; for
 * rail slides the path enumerates the intermediate rail cells (including any
 * curve corners). The function is best-effort — if no rail path is found, the
 * straight-line [from, to] is returned as a fallback.
 *
 * Note: this re-derives the path; the engine's combat resolution still happens
 * inside applyMove. We do not have access to MoveContext here, so we walk every
 * rail direction and pick whichever direction's slide arrives at `to`.
 */
export function pathOfMove(fromCellId: string, toCellId: string): string[] {
  const from = getCell(fromCellId);
  // Road step?
  if (getRoadNeighbors(fromCellId).includes(toCellId)) {
    return [fromCellId, toCellId];
  }
  // Rail slide: try each direction; if the reached cell list contains toCellId
  // we return the prefix up to and including it.
  if (from.onRail) {
    for (const dir of DIRECTIONS) {
      const trail = walkRail(fromCellId, dir);
      const idx = trail.indexOf(toCellId);
      if (idx >= 0) return [fromCellId, ...trail.slice(0, idx + 1)];
    }
  }
  return [fromCellId, toCellId];
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
