import { describe, expect, it } from 'vitest';
import { createGameState, submitSetup, type GameState, type SeatInfo } from '../src/engine.js';
import { projectView } from '../src/view.js';
import { randomValidSetup } from '../src/setup.js';
import { ZONES, type ZoneId } from '../src/board.js';
import { computeBeliefs } from '../src/bot/belief.js';
import {
  computeInfoValues,
  creditCombatInfo,
  forkInfoTracker,
  makeInfoTracker,
} from '../src/bot/infovalue.js';

function seat(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: false, eliminated: false, setupReady: false };
}

function freshGame(): GameState {
  let state = createGameState('2v2', {
    N: seat('n'), E: seat('e'), S: seat('s'), W: seat('w'),
  });
  for (const z of ZONES) {
    const r = submitSetup(state, z as ZoneId, randomValidSetup(z as ZoneId, 42));
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return state;
}

describe('H1 information value', () => {
  it('prices every living enemy piece, none of our own or partner', () => {
    const state = freshGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    const values = computeInfoValues(view, beliefs, 'N');
    const byId = new Map(view.pieces.map((p) => [p.id, p]));
    expect(values.size).toBeGreaterThan(0);
    for (const id of values.keys()) {
      const p = byId.get(id)!;
      // N's team is N+S; enemies are E and W.
      expect(['E', 'W']).toContain(p.owner);
    }
    // Fresh game: nothing is known, so 50 enemy pieces are all priced.
    expect(values.size).toBe(50);
  });

  it('values flag-adjacent unknowns above far-away ones', () => {
    const state = freshGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    const values = computeInfoValues(view, beliefs, 'N');
    const byId = new Map(view.pieces.map((p) => [p.id, p]));
    // The max-valued enemy piece should sit in the enemy's back area (close to
    // the flag hypothesis), not on the front line.
    let bestId = '';
    let best = -1;
    for (const [id, v] of values) {
      if (v > best) { best = v; bestId = id; }
    }
    const bestPiece = byId.get(bestId)!;
    const row = parseInt(bestPiece.cellId.split('-')[1]!, 10);
    expect(row).toBeLessThanOrEqual(3); // own-zone rows 1–3 are the back half
  });

  it('credits a combat once per piece, and forks isolate branches', () => {
    const state = freshGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    const values = computeInfoValues(view, beliefs, 'N');

    // Find any enemy piece and pretend our piece attacks it.
    const enemy = Object.values(state.pieces).find((p) => ['E', 'W'].includes(p.owner))!;
    const mine = Object.values(state.pieces).find((p) => p.owner === 'N')!;
    // Build a fake state slice where our piece sits adjacent (cellIndex only).
    const fake = {
      ...state,
      cellIndex: { [mine.cellId]: mine.id, [enemy.cellId]: enemy.id },
    } as typeof state;

    const t = makeInfoTracker('N', 60, values);
    creditCombatInfo(t, fake, mine.cellId, enemy.cellId);
    const after = t.bonus;
    expect(after).toBeGreaterThan(0);
    // Second combat with the same piece: no double credit.
    creditCombatInfo(t, fake, mine.cellId, enemy.cellId);
    expect(t.bonus).toBe(after);
    // Fork inherits credit but accumulates independently.
    const f = forkInfoTracker(t);
    creditCombatInfo(f, fake, mine.cellId, enemy.cellId);
    expect(f.bonus).toBe(after);
    expect(f.credited.has(enemy.id)).toBe(true);
  });

  it('moves to empty cells credit nothing', () => {
    const state = freshGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    const values = computeInfoValues(view, beliefs, 'N');
    const mine = Object.values(state.pieces).find((p) => p.owner === 'N')!;
    const t = makeInfoTracker('N', 60, values);
    creditCombatInfo(t, state, mine.cellId, 'C-2-2');
    expect(t.bonus).toBe(0);
  });
});
