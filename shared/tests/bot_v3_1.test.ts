import { describe, it, expect } from 'vitest';
import { v3_1, botRng } from '../src/bot/index.js';
import { strongMoveBonus, STRONG_MOVE_BIAS } from '../src/bot/values.js';
import {
  createGameState, submitSetup,
  type GameState, type SeatInfo,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { projectView } from '../src/view.js';
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

describe('strong-move bias (#50/#4)', () => {
  it('uses the reduced 1.3 multiplier', () => {
    expect(STRONG_MOVE_BIAS).toBe(1.3);
    expect(strongMoveBonus('SILING')).toBeCloseTo(9 * 1.3, 5);
    expect(strongMoveBonus('PAIZHANG')).toBeCloseTo(2 * 1.3, 5);
  });

  it('rank-less specials get zero bias', () => {
    expect(strongMoveBonus('ZHADAN')).toBe(0);
    expect(strongMoveBonus('DILEI')).toBe(0);
    expect(strongMoveBonus('JUNQI')).toBe(0);
  });

  it('stronger pieces always get a larger bonus', () => {
    expect(strongMoveBonus('SILING')).toBeGreaterThan(strongMoveBonus('JUNZHANG'));
    expect(strongMoveBonus('JUNZHANG')).toBeGreaterThan(strongMoveBonus('LIANZHANG'));
  });
});

describe('v3.1 bot', () => {
  it('pickSetup produces a valid 25-piece layout (with flag-column bomb bias)', () => {
    const layout = v3_1.pickSetup({ seat: 'N', random: botRng(1) });
    expect(Object.keys(layout).length).toBe(25);
    // Exactly 2 bombs, 3 mines, 1 flag still present after the bias swap.
    const counts: Record<string, number> = {};
    for (const k of Object.values(layout)) counts[k] = (counts[k] ?? 0) + 1;
    expect(counts.ZHADAN).toBe(2);
    expect(counts.DILEI).toBe(3);
    expect(counts.JUNQI).toBe(1);
  });

  it('pickMove returns a legal move without throwing (small smoke run)', () => {
    const state = freshState(2);
    const view = projectView(state, 'N');
    const pick = v3_1.pickMove({ view, seat: 'N', history: state.moveHistory, random: botRng(3) });
    expect(pick).not.toBeNull();
    if (pick) {
      expect(typeof pick.from).toBe('string');
      expect(typeof pick.to).toBe('string');
    }
  });
});
