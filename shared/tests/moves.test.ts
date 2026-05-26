import { describe, it, expect } from 'vitest';
import {
  legalMovesFromCell,
  type MoveContext,
  type PieceRef,
  type SeatId,
} from '../src/moves.js';
import { zoneCellId, centerCellId } from '../src/board.js';
import type { PieceKind } from '../src/pieces.js';

function ctxFromMap(
  map: Record<string, { owner: SeatId; kind: PieceKind }>,
  allies: Record<SeatId, SeatId[]> = { N: ['N'], E: ['E'], S: ['S'], W: ['W'] },
): MoveContext {
  const refs: Record<string, PieceRef> = {};
  for (const [cell, info] of Object.entries(map)) {
    refs[cell] = { id: cell, cellId: cell, kind: info.kind, owner: info.owner };
  }
  return {
    pieceAt: (id) => refs[id] ?? null,
    isAlly: (a, b) => a === b || (allies[a]?.includes(b) ?? false),
  };
}

describe('road moves', () => {
  it('single orthogonal step into empty cells', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 3, 3)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 3, 3)));
    expect(moves.has(zoneCellId('N', 2, 3))).toBe(true);
    expect(moves.has(zoneCellId('N', 4, 3))).toBe(true);
    expect(moves.has(zoneCellId('N', 3, 2))).toBe(true);
    expect(moves.has(zoneCellId('N', 3, 4))).toBe(true);
    // N(3,3) is not on the rail, so rail-distance cells should not appear.
    expect(moves.has(zoneCellId('N', 6, 3))).toBe(false);
  });

  it('cannot move into a camp occupied by anyone (camps hold at most 1)', () => {
    // Place an ally in a camp; the center camp is reachable only by road; the inner
    // station N(4,2) is road-adjacent to camp N(4,3) (well actually N(4,2) is the inner
    // station and the center camp is N(4,3) — let's use the diagonal X-road).
    const ctx = ctxFromMap({
      [zoneCellId('N', 3, 3)]: { owner: 'N', kind: 'LIANZHANG' },
      [zoneCellId('N', 4, 3)]: { owner: 'N', kind: 'SHIZHANG' }, // ally in center camp
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 3, 3)));
    // N(3,3) is orthogonally adjacent to N(4,3) (center camp) — but it's occupied by ally.
    expect(moves.has(zoneCellId('N', 4, 3))).toBe(false);
  });

  it('center camp diagonals work both ways', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 4, 3)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 4, 3)));
    expect(moves.has(zoneCellId('N', 3, 2))).toBe(true);
    expect(moves.has(zoneCellId('N', 3, 4))).toBe(true);
    expect(moves.has(zoneCellId('N', 5, 2))).toBe(true);
    expect(moves.has(zoneCellId('N', 5, 4))).toBe(true);
  });

  it('cannot stop on a teammate', () => {
    // 2v2 mode: N and S are allies.
    const ctx = ctxFromMap(
      {
        [zoneCellId('N', 6, 3)]: { owner: 'N', kind: 'LIANZHANG' },
      },
      { N: ['N', 'S'], S: ['N', 'S'], E: ['E', 'W'], W: ['E', 'W'] },
    );
    // Place teammate at the rail-reachable opposite zone front line.
    const map: Record<string, { owner: SeatId; kind: PieceKind }> = {
      [zoneCellId('N', 6, 3)]: { owner: 'N', kind: 'LIANZHANG' },
      [zoneCellId('S', 6, 3)]: { owner: 'S', kind: 'TUANZHANG' },
    };
    const ctx2 = ctxFromMap(map, {
      N: ['N', 'S'], S: ['N', 'S'], E: ['E', 'W'], W: ['E', 'W'],
    });
    const moves = new Set(legalMovesFromCell(ctx2, zoneCellId('N', 6, 3)));
    expect(moves.has(zoneCellId('S', 6, 3))).toBe(false);
    // Sanity: ctx variable used to keep the linter happy
    expect(ctx).toBeDefined();
  });
});

describe('HQ immobility', () => {
  it('a piece in an HQ has no legal moves', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 1, 2)]: { owner: 'N', kind: 'DILEI' }, // mine in flag-HQ
    });
    expect(legalMovesFromCell(ctx, zoneCellId('N', 1, 2))).toEqual([]);
  });
});

describe('immobile pieces', () => {
  it('mines and flags have no legal moves', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 2, 3)]: { owner: 'N', kind: 'DILEI' },
      [zoneCellId('N', 1, 4)]: { owner: 'N', kind: 'JUNQI' },
    });
    expect(legalMovesFromCell(ctx, zoneCellId('N', 2, 3))).toEqual([]);
    expect(legalMovesFromCell(ctx, zoneCellId('N', 1, 4))).toEqual([]);
  });
});

describe('non-engineer rail slides', () => {
  it('slides along a clear ring in one direction', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 2, 1)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 2, 1)));
    // East along row 2:
    expect(moves.has(zoneCellId('N', 2, 2))).toBe(true);
    expect(moves.has(zoneCellId('N', 2, 5))).toBe(true);
    // South along col 1:
    expect(moves.has(zoneCellId('N', 3, 1))).toBe(true);
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);
  });

  it('non-engineer cannot turn the corner of the zone ring', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 2, 3)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 2, 3)));
    // From (N, 2, 3) sliding west reaches the corner (N,2,1) but cannot continue south.
    expect(moves.has(zoneCellId('N', 2, 1))).toBe(true);
    expect(moves.has(zoneCellId('N', 3, 1))).toBe(false); // would require south after west
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(false);
  });

  it('non-engineer can slide straight through the central area to the opposite zone', () => {
    // Place a non-engineer at N(6, 3); the path through center col 2 to S(6, 3) is clear.
    const ctx = ctxFromMap({
      [zoneCellId('N', 6, 3)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 6, 3)));
    expect(moves.has(zoneCellId('S', 6, 3))).toBe(true);
    // The straight south slide does NOT reach E(6, *) (would require turn).
    expect(moves.has(zoneCellId('E', 6, 1))).toBe(false);
  });

  it('non-engineer CAN stop in the center (九宫 are stoppable)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 6, 3)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 6, 3)));
    // From N(6,3) sliding south the piece can stop at C(1,2), C(2,2), C(3,2), or S(6,3).
    expect(moves.has('C-1-2')).toBe(true);
    expect(moves.has('C-2-2')).toBe(true);
    expect(moves.has('C-3-2')).toBe(true);
  });

  it('non-engineer at front-line col 2 cannot reach the center directly (no rail link)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 6, 2)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 6, 2)));
    // No central cells should appear — col 2 has no rail link to the center.
    for (const m of moves) expect(m.startsWith('C-')).toBe(false);
  });

  it('slide stops at first enemy piece (combat target)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 2, 1)]: { owner: 'N', kind: 'LIANZHANG' },
      [zoneCellId('N', 4, 1)]: { owner: 'E', kind: 'TUANZHANG' }, // enemy
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 2, 1)));
    expect(moves.has(zoneCellId('N', 3, 1))).toBe(true);  // empty stop along the way
    expect(moves.has(zoneCellId('N', 4, 1))).toBe(true);  // combat target
    expect(moves.has(zoneCellId('N', 5, 1))).toBe(false); // cannot pass enemy
  });

  it('slide blocked by ally — cannot stop on or pass', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 2, 1)]: { owner: 'N', kind: 'LIANZHANG' },
      [zoneCellId('N', 4, 1)]: { owner: 'N', kind: 'TUANZHANG' }, // ally
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 2, 1)));
    expect(moves.has(zoneCellId('N', 3, 1))).toBe(true);
    expect(moves.has(zoneCellId('N', 4, 1))).toBe(false);
    expect(moves.has(zoneCellId('N', 5, 1))).toBe(false);
  });
});

describe('engineer rail BFS', () => {
  it('engineer can turn corners — reach N(3,1) from N(2,3) on the ring', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 2, 3)]: { owner: 'N', kind: 'GONGBING' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 2, 3)));
    expect(moves.has(zoneCellId('N', 3, 1))).toBe(true);
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);
    expect(moves.has(zoneCellId('N', 6, 5))).toBe(true);
  });

  it('engineer can reach adjacent-zone front lines through the center corner', () => {
    // W(6, 5) connects via C(1, 1) to N(6, 1) (corner turn).
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'GONGBING' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('W', 6, 5)));
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);
  });

  it('engineer can stop in the central area (and reach all 9 central cells)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 6, 3)]: { owner: 'N', kind: 'GONGBING' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 6, 3)));
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 3; c++) {
        expect(moves.has(centerCellId(r, c))).toBe(true);
      }
    }
  });
});

describe('camp interactions', () => {
  it('cannot attack into a camp containing an enemy', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 3, 3)]: { owner: 'N', kind: 'LIANZHANG' },
      [zoneCellId('N', 4, 3)]: { owner: 'E', kind: 'PAIZHANG' }, // enemy in center camp
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 3, 3)));
    expect(moves.has(zoneCellId('N', 4, 3))).toBe(false);
  });

  it('can enter an empty camp', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 3, 3)]: { owner: 'N', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 3, 3)));
    expect(moves.has(zoneCellId('N', 4, 3))).toBe(true);
  });
});
