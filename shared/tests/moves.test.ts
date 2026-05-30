import { describe, it, expect } from 'vitest';
import {
  legalMovesFromCell,
  pathOfMove,
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
    // From N(6,3) sliding south the piece can stop at C(1,2) or C(3,2). C(2,2) is
    // transit-only — pieces pass through but cannot rest there. S(6,3) is also a
    // legal stop further along the slide.
    expect(moves.has('C-1-2')).toBe(true);
    expect(moves.has('C-2-2')).toBe(false);
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

  it('engineer can stop in 8 of the 9 central cells (C-2-2 is transit-only)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 6, 3)]: { owner: 'N', kind: 'GONGBING' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 6, 3)));
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 3; c++) {
        const expected = !(r === 2 && c === 2);
        expect(moves.has(centerCellId(r, c))).toBe(expected);
      }
    }
  });
});

describe('pathOfMove', () => {
  it('road step returns [from, to]', () => {
    expect(pathOfMove(zoneCellId('N', 3, 3), zoneCellId('N', 3, 4))).toEqual([
      zoneCellId('N', 3, 3),
      zoneCellId('N', 3, 4),
    ]);
  });

  it('single-direction rail slide enumerates intermediate cells', () => {
    const path = pathOfMove(zoneCellId('N', 6, 3), zoneCellId('S', 6, 3));
    expect(path[0]).toBe(zoneCellId('N', 6, 3));
    expect(path[path.length - 1]).toBe(zoneCellId('S', 6, 3));
    expect(path).toContain(centerCellId(1, 2));
    expect(path).toContain(centerCellId(2, 2));
    expect(path).toContain(centerCellId(3, 2));
  });

  it('engineer BFS finds a multi-leg rail path through corners', () => {
    // N(2,3) → N(5,1) requires going west to corner (2,1) then south. BFS path.
    const path = pathOfMove(zoneCellId('N', 2, 3), zoneCellId('N', 5, 1));
    expect(path[0]).toBe(zoneCellId('N', 2, 3));
    expect(path[path.length - 1]).toBe(zoneCellId('N', 5, 1));
    expect(path).toContain(zoneCellId('N', 2, 1));
  });
});

describe('central-corner curves (non-engineer)', () => {
  it('W(6,5) sliding east curves through C(1,1) to reach N(6,1)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'LIANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('W', 6, 5)));
    expect(moves.has('C-1-1')).toBe(true);
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);
    // And the curve continues further north along N's col 1 ring.
    expect(moves.has(zoneCellId('N', 2, 1))).toBe(true);
    // Straight continuation along the central top row is still available.
    expect(moves.has('C-1-2')).toBe(true);
    expect(moves.has(zoneCellId('E', 6, 1))).toBe(true);
  });

  it('N(6,5) sliding south curves through C(1,3) to reach E(6,1)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('N', 6, 5)]: { owner: 'N', kind: 'TUANZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('N', 6, 5)));
    expect(moves.has(zoneCellId('E', 6, 1))).toBe(true);
    expect(moves.has(zoneCellId('E', 2, 1))).toBe(true);
    // Straight south through the center continues to S(6,1) (S is rotated 180°
    // so N's col 5 maps to S's col 1 globally).
    expect(moves.has(zoneCellId('S', 6, 1))).toBe(true);
  });

  it('S(6,5) sliding north curves through C(3,1) to reach W(6,1)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('S', 6, 5)]: { owner: 'S', kind: 'JUNZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('S', 6, 5)));
    expect(moves.has(zoneCellId('W', 6, 1))).toBe(true);
  });

  it('curve blocked by ally on the curve-exit zone front line', () => {
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'LIANZHANG' },
      [zoneCellId('N', 6, 1)]: { owner: 'W', kind: 'PAIZHANG' }, // ally in W team
    }, { N: ['N'], E: ['E'], S: ['S'], W: ['W'] });
    // For non-team mode (each its own team), the W piece at N(6,1) is an enemy.
    // Let's use teammate aliasing so this is an ally:
    const tmCtx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'LIANZHANG' },
      [zoneCellId('N', 6, 1)]: { owner: 'W', kind: 'PAIZHANG' },
    }, { N: ['W', 'N'], E: ['E'], S: ['S'], W: ['W', 'N'] });
    const moves = new Set(legalMovesFromCell(tmCtx, zoneCellId('W', 6, 5)));
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(false);
    // The curve cell C(1,1) itself is still reachable as a stop.
    expect(moves.has('C-1-1')).toBe(true);
    // Sanity: ctx ref used to keep linter quiet.
    expect(ctx).toBeDefined();
  });

  it('curve stops at enemy on curve-exit cell (combat target)', () => {
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'LIANZHANG' },
      [zoneCellId('N', 6, 1)]: { owner: 'N', kind: 'PAIZHANG' }, // enemy
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('W', 6, 5)));
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);  // combat target
    expect(moves.has(zoneCellId('N', 5, 1))).toBe(false); // can't pass through
  });
});

describe('curve bypasses a piece sitting on the corner cell', () => {
  it('non-engineer slide curves around an enemy on C-1-1', () => {
    // W slides east from W(6,5); an enemy sits on the corner cell C-1-1.
    // Standard corner road: combat at C-1-1 is legal.
    // Curve road: bypasses C-1-1 and reaches N(6,1).
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'LIANZHANG' },
      'C-1-1':                  { owner: 'N', kind: 'PAIZHANG' },
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('W', 6, 5)));
    expect(moves.has('C-1-1')).toBe(true);                  // combat target on corner
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);    // curve bypasses
    expect(moves.has(zoneCellId('N', 2, 1))).toBe(true);    // and continues north
  });

  it('non-engineer slide curves around even when corner has a teammate', () => {
    const allies: Record<SeatId, SeatId[]> = { N: ['N', 'W'], W: ['N', 'W'], E: ['E', 'S'], S: ['E', 'S'] };
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'LIANZHANG' },
      'C-1-1':                  { owner: 'N', kind: 'PAIZHANG' }, // ally
    }, allies);
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('W', 6, 5)));
    expect(moves.has('C-1-1')).toBe(false);                 // blocked by ally on corner
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);    // curve still passes
  });

  it('engineer can still reach across the curve when corner is blocked', () => {
    const ctx = ctxFromMap({
      [zoneCellId('W', 6, 5)]: { owner: 'W', kind: 'GONGBING' },
      'C-1-1':                  { owner: 'W', kind: 'PAIZHANG' }, // own ally blocks corner
    });
    const moves = new Set(legalMovesFromCell(ctx, zoneCellId('W', 6, 5)));
    expect(moves.has(zoneCellId('N', 6, 1))).toBe(true);
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
