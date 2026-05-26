import { describe, it, expect } from 'vitest';
import { validateLayout, randomValidSetup, hqCellIds } from '../src/setup.js';
import { PIECE_DEFS, PIECES_PER_PLAYER } from '../src/pieces.js';
import { zoneCellId, ZONES } from '../src/board.js';

describe('randomValidSetup', () => {
  it('produces 25 placements covering all placeable cells', () => {
    const layout = randomValidSetup('N', 42);
    expect(Object.keys(layout).length).toBe(PIECES_PER_PLAYER);
  });

  it('passes validation for every zone with multiple seeds', () => {
    for (const zone of ZONES) {
      for (const seed of [1, 7, 31, 123, 999, 2024]) {
        const layout = randomValidSetup(zone, seed);
        const errs = validateLayout(zone, layout);
        if (errs.length > 0) {
          throw new Error(
            `Seed ${seed} zone ${zone} produced errors: ${JSON.stringify(errs)}`,
          );
        }
      }
    }
  });

  it('is deterministic given a seed', () => {
    const a = randomValidSetup('S', 42);
    const b = randomValidSetup('S', 42);
    expect(a).toEqual(b);
  });
});

describe('validateLayout', () => {
  it('flag must be in an HQ', () => {
    const layout = randomValidSetup('N', 7);
    // Move the flag from its HQ to a non-HQ cell.
    const [hqA] = hqCellIds('N');
    const flagCellEntry = Object.entries(layout).find(([, k]) => k === 'JUNQI');
    const flagCell = flagCellEntry![0];
    const swapCell = zoneCellId('N', 3, 1); // a station
    const other = layout[swapCell]!;
    layout[flagCell] = other;
    layout[swapCell] = 'JUNQI';
    const errs = validateLayout('N', layout);
    expect(errs.some((e) => e.code === 'FLAG_OUTSIDE_HQ')).toBe(true);
    // sanity: the flag was actually moved
    expect(flagCell).not.toBe(hqA);
  });

  it('mine must be in rows 1-2', () => {
    const layout = randomValidSetup('E', 9);
    const mineCellEntry = Object.entries(layout).find(([, k]) => k === 'DILEI')!;
    const row5Cell = zoneCellId('E', 5, 3);
    const other = layout[row5Cell]!;
    // Only swap if it doesn't break another rule trivially
    layout[mineCellEntry[0]] = other;
    layout[row5Cell] = 'DILEI';
    const errs = validateLayout('E', layout);
    expect(errs.some((e) => e.code === 'MINE_OUTSIDE_BACK_ROWS')).toBe(true);
  });

  it('bomb cannot be in front line (row 6)', () => {
    const layout = randomValidSetup('W', 13);
    const bombEntry = Object.entries(layout).find(([, k]) => k === 'ZHADAN')!;
    const row6Cell = zoneCellId('W', 6, 3);
    const other = layout[row6Cell]!;
    layout[bombEntry[0]] = other;
    layout[row6Cell] = 'ZHADAN';
    const errs = validateLayout('W', layout);
    expect(errs.some((e) => e.code === 'BOMB_IN_FRONT_LINE')).toBe(true);
  });

  it('correct piece counts', () => {
    const layout = randomValidSetup('S', 5);
    const errs = validateLayout('S', layout);
    expect(errs).toEqual([]);
    // Sanity: counts match definitions.
    const counts: Record<string, number> = {};
    for (const k of Object.values(layout)) counts[k] = (counts[k] ?? 0) + 1;
    for (const def of Object.values(PIECE_DEFS)) {
      expect(counts[def.kind] ?? 0).toBe(def.count);
    }
  });
});
