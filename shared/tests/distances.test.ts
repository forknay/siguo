import { describe, it, expect } from 'vitest';
import { moveDistance } from '../src/bot/distances.js';

describe('static move-distance table', () => {
  it('adjacent road cells are 1 move apart', () => {
    expect(moveDistance('N-3-3', 'N-3-4')).toBe(1);
    expect(moveDistance('N-3-3', 'N-2-3')).toBe(1);
  });

  it('a straight rail slide across the board is a single move', () => {
    // N front line col 3 → through the center → S front line col 3.
    expect(moveDistance('N-6-3', 'S-6-3')).toBe(1);
  });

  it('the central corner curve counts as one move (W front → N flank)', () => {
    expect(moveDistance('W-6-5', 'N-6-1')).toBe(1);
  });

  it('ring travel needing a corner takes 2 moves for a non-engineer', () => {
    // N-2-1 → (slide along col 1) → N-6-1 → (slide along row 6) → N-6-5.
    expect(moveDistance('N-2-1', 'N-6-5')).toBe(2);
  });

  it('HQ cells are exit-impossible but enterable', () => {
    expect(moveDistance('N-1-2', 'N-2-2')).toBe(64); // out of HQ: immobile
    expect(moveDistance('N-2-2', 'N-1-2')).toBe(1);  // into HQ: fine
  });

  it('is far tighter than Manhattan across zones', () => {
    // Manhattan from N-6-1 (x=-2,y=-3) to S-6-1 (x=2,y=3) is 10;
    // the rail gets there in ≤ 3 moves.
    expect(moveDistance('N-6-1', 'S-6-1')).toBeLessThanOrEqual(3);
  });

  it('symmetric pairs of plain stations agree in both directions', () => {
    expect(moveDistance('N-3-3', 'N-5-3')).toBe(moveDistance('N-5-3', 'N-3-3'));
  });
});
