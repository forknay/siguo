import { describe, it, expect } from 'vitest';
import { flagHypothesisFor, likelyFlagCell } from '../src/bot/flaghypothesis.js';
import {
  createGameState, submitSetup,
  type GameState, type SeatInfo,
} from '../src/engine.js';
import { projectView } from '../src/view.js';
import { hqCellIds, randomValidSetup } from '../src/setup.js';
import { ZONES, type ZoneId } from '../src/board.js';

function seat(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: false, eliminated: false, setupReady: false };
}

function freshState(s = 1): GameState {
  let state = createGameState('2v2', { N: seat('n'), E: seat('e'), S: seat('s'), W: seat('w') });
  for (const z of ZONES) {
    const r = submitSetup(state, z as ZoneId, randomValidSetup(z as ZoneId, s));
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return state;
}

describe('flagHypothesisFor', () => {
  it('starts with both HQ cells as candidates', () => {
    const state = freshState(1);
    const view = projectView(state, 'N');
    const h = flagHypothesisFor(view, 'E');
    const [hqA, hqB] = hqCellIds('E');
    // Both HQ cells are occupied at game start, so both remain candidates.
    expect(h.candidates).toContain(hqA);
    expect(h.candidates).toContain(hqB);
    expect(h.certain).toBe(false);
  });

  it('rules out an empty HQ (non-flag piece captured) — flag must be the occupied one', () => {
    // HQ pieces are immobile, so narrowing happens when the NON-flag HQ piece
    // is captured, leaving that HQ empty. Simulate by emptying one E HQ cell.
    const base = freshState(2);
    const [hqA] = hqCellIds('E');
    const occupantId = base.cellIndex[hqA];
    const pieces = { ...base.pieces };
    const cellIndex = { ...base.cellIndex };
    if (occupantId) { delete pieces[occupantId]; delete cellIndex[hqA]; }
    const crafted: GameState = { ...base, pieces, cellIndex };
    const view = projectView(crafted, 'N');
    const h = flagHypothesisFor(view, 'E');
    expect(h.candidates).not.toContain(hqA);
    expect(h.certain).toBe(true); // only the occupied HQ remains
  });

  it('likelyFlagCell returns one of the HQ cells', () => {
    const state = freshState(3);
    const view = projectView(state, 'N');
    const cell = likelyFlagCell(view, 'S');
    const [hqA, hqB] = hqCellIds('S');
    expect([hqA, hqB]).toContain(cell);
  });
});
