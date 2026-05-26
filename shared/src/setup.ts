// Setup validation + random valid layout generator.

import {
  type ZoneId,
  type Cell,
  BOARD,
  setupCellsForZone,
  zoneCellId,
} from './board.js';
import { PIECE_DEFS, type PieceKind, PIECE_KINDS_ORDERED } from './pieces.js';

/** A setup layout: cellId → piece kind. Must cover all 25 placeable cells for a zone. */
export type Layout = Record<string, PieceKind>;

export interface SetupError {
  code:
    | 'WRONG_COUNT'
    | 'MISSING_FLAG_IN_HQ'
    | 'FLAG_OUTSIDE_HQ'
    | 'MINE_OUTSIDE_BACK_ROWS'
    | 'BOMB_IN_FRONT_LINE'
    | 'PIECE_IN_CAMP'
    | 'PIECE_OUTSIDE_ZONE'
    | 'CELL_NOT_FOUND'
    | 'WRONG_PIECE_COUNT';
  message: string;
  cellId?: string;
  pieceKind?: PieceKind;
}

/** Validate a player's setup layout. Returns [] if valid, else list of errors. */
export function validateLayout(zone: ZoneId, layout: Layout): SetupError[] {
  const errors: SetupError[] = [];
  const placedCells = Object.keys(layout);
  const placeable = setupCellsForZone(zone);
  const placeableIds = new Set(placeable.map((c) => c.id));

  if (placedCells.length !== placeable.length) {
    errors.push({
      code: 'WRONG_COUNT',
      message: `Expected ${placeable.length} pieces placed, got ${placedCells.length}`,
    });
  }

  // Count pieces by kind.
  const counts: Partial<Record<PieceKind, number>> = {};
  for (const [cellId, kind] of Object.entries(layout)) {
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (!BOARD.cells.has(cellId)) {
      errors.push({ code: 'CELL_NOT_FOUND', message: `Cell ${cellId} not found`, cellId });
      continue;
    }
    const cell = BOARD.cells.get(cellId)!;
    if (cell.zone !== zone) {
      errors.push({
        code: 'PIECE_OUTSIDE_ZONE',
        message: `Piece on ${cellId} is outside zone ${zone}`,
        cellId,
        pieceKind: kind,
      });
      continue;
    }
    if (!placeableIds.has(cellId)) {
      // The only non-placeable cells in a zone are camps.
      if (cell.type === 'CAMP') {
        errors.push({
          code: 'PIECE_IN_CAMP',
          message: `Cell ${cellId} is a camp; cannot place a piece here at setup`,
          cellId,
          pieceKind: kind,
        });
      }
      continue;
    }
    // Piece-specific zone rules:
    if (kind === 'JUNQI' && cell.type !== 'HQ') {
      errors.push({
        code: 'FLAG_OUTSIDE_HQ',
        message: `Flag must be placed in an HQ cell, not ${cellId}`,
        cellId,
        pieceKind: kind,
      });
    }
    if (kind === 'DILEI' && cell.row > 2) {
      errors.push({
        code: 'MINE_OUTSIDE_BACK_ROWS',
        message: `Mine on ${cellId} (row ${cell.row}); mines must be in rows 1-2`,
        cellId,
        pieceKind: kind,
      });
    }
    if (kind === 'ZHADAN' && cell.row === 6) {
      errors.push({
        code: 'BOMB_IN_FRONT_LINE',
        message: `Bomb on ${cellId} (front line); bombs may not be in row 6`,
        cellId,
        pieceKind: kind,
      });
    }
  }

  // Per-piece count check.
  for (const kind of PIECE_KINDS_ORDERED) {
    const want = PIECE_DEFS[kind].count;
    const got = counts[kind] ?? 0;
    if (got !== want) {
      errors.push({
        code: 'WRONG_PIECE_COUNT',
        message: `Expected ${want} ${kind} pieces, got ${got}`,
        pieceKind: kind,
      });
    }
  }

  // Flag must be in HQ — already covered by FLAG_OUTSIDE_HQ. Also check at least one
  // flag was placed (covered by count check).
  const flagCell = Object.entries(layout).find(([, k]) => k === 'JUNQI');
  if (flagCell && BOARD.cells.get(flagCell[0])?.type !== 'HQ') {
    // Already flagged above.
  }

  return errors;
}

// --- Random setup ---

/** Mulberry32 PRNG — small, deterministic given a seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Build a valid random layout for the given zone using the canonical v1 constraints.
 * Algorithm: pick HQ for flag, fill mines in rows 1-2, fill bombs in rows 1-5, fill
 * the rest with the remaining mobile soldiers.
 */
export function randomValidSetup(zone: ZoneId, seed?: number): Layout {
  const rand = rng(seed ?? Math.floor(Math.random() * 0xffffffff));
  const cells = setupCellsForZone(zone);
  const layout: Layout = {};

  const byPredicate = (pred: (c: Cell) => boolean): Cell[] =>
    cells.filter((c) => pred(c) && !(c.id in layout));

  // 1. Flag in a random HQ.
  const hqCells = shuffle(byPredicate((c) => c.type === 'HQ'), rand);
  const flagHq = hqCells[0]!;
  layout[flagHq.id] = 'JUNQI';

  // 2. Mines (count 3) in rows 1-2, excluding the flag's HQ.
  const mineSpots = shuffle(byPredicate((c) => c.row <= 2), rand);
  for (let i = 0; i < PIECE_DEFS.DILEI.count; i++) {
    const c = mineSpots[i];
    if (!c) throw new Error('Not enough cells for mines (shouldn\'t happen)');
    layout[c.id] = 'DILEI';
  }

  // 3. Bombs (count 2) in rows 1-5, excluding occupied cells.
  const bombSpots = shuffle(byPredicate((c) => c.row <= 5), rand);
  for (let i = 0; i < PIECE_DEFS.ZHADAN.count; i++) {
    const c = bombSpots[i];
    if (!c) throw new Error('Not enough cells for bombs');
    layout[c.id] = 'ZHADAN';
  }

  // 4. Remaining mobile pieces fill the rest in random order.
  const remainingCells = shuffle(byPredicate(() => true), rand);
  const remainingPieces: PieceKind[] = [];
  for (const def of Object.values(PIECE_DEFS)) {
    if (def.kind === 'JUNQI' || def.kind === 'DILEI' || def.kind === 'ZHADAN') continue;
    for (let i = 0; i < def.count; i++) remainingPieces.push(def.kind);
  }
  const shuffledPieces = shuffle(remainingPieces, rand);

  if (remainingCells.length !== shuffledPieces.length) {
    throw new Error(
      `Setup arithmetic error: ${remainingCells.length} cells vs ${shuffledPieces.length} pieces`,
    );
  }
  for (let i = 0; i < remainingCells.length; i++) {
    layout[remainingCells[i]!.id] = shuffledPieces[i]!;
  }

  return layout;
}

/** Convenience: get the two HQ cell ids for a zone. */
export function hqCellIds(zone: ZoneId): [string, string] {
  return [zoneCellId(zone, 1, 2), zoneCellId(zone, 1, 4)];
}
