import { describe, it, expect } from 'vitest';
import { computeBeliefs, estimateRank, AVG_MOBILE_RANK } from '../src/bot/belief.js';
import {
  applyMove, applyResign, createGameState, submitSetup,
  type GameState, type SeatInfo,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { projectView } from '../src/view.js';
import { ZONES, zoneCellId, type ZoneId } from '../src/board.js';
import type { SeatId } from '../src/moves.js';

function seat(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: false, eliminated: false, setupReady: false };
}

function freshPlayingGame(): GameState {
  let state = createGameState('2v2', { N: seat('a'), E: seat('b'), S: seat('c'), W: seat('d') });
  for (const z of ZONES) {
    const r = submitSetup(state, z as ZoneId, randomValidSetup(z as ZoneId, 1));
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return state;
}

describe('estimateRank — value table', () => {
  it('returns the actual rank for known soldiers', () => {
    expect(estimateRank('SILING', false, false, false)).toBe(9);
    expect(estimateRank('PAIZHANG', true, false, false)).toBe(2);
  });

  it('uses special scores for bomb / mine / flag', () => {
    expect(estimateRank('JUNQI', false, true, true)).toBe(0);
    expect(estimateRank('ZHADAN', false, false, false)).toBe(10);
    expect(estimateRank('DILEI', false, false, true)).toBe(8);
  });

  it('unknown + in HQ + unmoved → low (flag candidate)', () => {
    expect(estimateRank(null, false, true, true)).toBeLessThan(2);
  });

  it('unknown + back-row + unmoved → high (mine candidate)', () => {
    expect(estimateRank(null, false, false, true)).toBeGreaterThan(6);
  });

  it('unknown + has moved → average mobile rank', () => {
    expect(estimateRank(null, true, false, false)).toBeCloseTo(AVG_MOBILE_RANK, 1);
  });
});

describe('computeBeliefs — kind reveal from combat history', () => {
  it('own pieces have knownKind set from the view', () => {
    const state = freshPlayingGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    for (const p of view.pieces) {
      if (p.owner !== 'N') continue;
      const b = beliefs.get(p.id)!;
      expect(b.knownKind).not.toBeNull();
    }
  });

  it('opponent kinds stay null in fresh game (no combat)', () => {
    const state = freshPlayingGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    for (const p of view.pieces) {
      if (p.owner === 'N' || p.owner === 'S') continue; // skip self + teammate
      const b = beliefs.get(p.id)!;
      expect(b.knownKind).toBeNull();
    }
  });

  it('strict fog: viewer never learns the opponent kind, but bounds their rank', () => {
    // N's SILING (rank 9) attacks E's PAIZHANG (rank 2). N wins.
    //
    // Under strict fog:
    //   - E (the defender) learns nothing about the attacker's kind — just that
    //     attacker survived against a known-rank-2 PAIZHANG. So attacker rank ≥ 3.
    //   - S (uninvolved) learns nothing about either kind.
    const state = freshPlayingGame();
    const newState: GameState = {
      ...state,
      pieces: {
        ...state.pieces,
        synth_n: { id: 'synth_n', kind: 'SILING', owner: 'N', cellId: zoneCellId('N', 2, 3) },
        synth_e: { id: 'synth_e', kind: 'PAIZHANG', owner: 'E', cellId: zoneCellId('N', 2, 4) },
      },
      cellIndex: {
        ...state.cellIndex,
        [zoneCellId('N', 2, 3)]: 'synth_n',
        [zoneCellId('N', 2, 4)]: 'synth_e',
      },
      knownToPlayers: {
        ...state.knownToPlayers,
        synth_n: ['N'],
        synth_e: ['E'],
      },
      turn: 'N',
    };
    const existingNat23 = state.cellIndex[zoneCellId('N', 2, 3)];
    const existingNat24 = state.cellIndex[zoneCellId('N', 2, 4)];
    if (existingNat23 && existingNat23 !== 'synth_n') delete newState.pieces[existingNat23];
    if (existingNat24 && existingNat24 !== 'synth_e') delete newState.pieces[existingNat24];

    const r = applyMove(newState, 'N', zoneCellId('N', 2, 3), zoneCellId('N', 2, 4));
    expect('state' in r).toBe(true);
    const after = (r as { state: GameState }).state;

    // E's view: knownKind stays null (strict fog). minRank should be ≥ 3.
    const eView = projectView(after, 'E');
    const eBeliefs = computeBeliefs(eView, 'E');
    const eSyn = eBeliefs.get('synth_n');
    expect(eSyn?.knownKind).toBeNull();
    expect(eSyn?.minRank).toBeGreaterThanOrEqual(3);

    // S's view: knows nothing.
    const sView = projectView(after, 'S');
    const sBeliefs = computeBeliefs(sView, 'S');
    const sSyn = sBeliefs.get('synth_n');
    expect(sSyn?.knownKind).toBeNull();
    expect(sSyn?.minRank).toBeNull();
  });

  it('mine confidence: heavy piece dying to back-row unmoved cell raises mineConfidence', () => {
    // E's 司令 (rank 9) attacks an unmoved back-row piece at N(2,3). The defender
    // wins (i.e., it was a mine). E's belief about N(2,3) should show high mineConfidence.
    const state = freshPlayingGame();
    const newState: GameState = {
      ...state,
      pieces: {
        ...state.pieces,
        synth_e: { id: 'synth_e', kind: 'SILING', owner: 'E', cellId: zoneCellId('N', 2, 4) },
        synth_n: { id: 'synth_n', kind: 'DILEI', owner: 'N', cellId: zoneCellId('N', 2, 3) },
      },
      cellIndex: {
        ...state.cellIndex,
        [zoneCellId('N', 2, 4)]: 'synth_e',
        [zoneCellId('N', 2, 3)]: 'synth_n',
      },
      knownToPlayers: {
        ...state.knownToPlayers,
        synth_e: ['E'],
        synth_n: ['N'],
      },
      turn: 'E',
    };
    const ex23 = state.cellIndex[zoneCellId('N', 2, 3)];
    const ex24 = state.cellIndex[zoneCellId('N', 2, 4)];
    if (ex23 && ex23 !== 'synth_n') delete newState.pieces[ex23];
    if (ex24 && ex24 !== 'synth_e') delete newState.pieces[ex24];

    const r = applyMove(newState, 'E', zoneCellId('N', 2, 4), zoneCellId('N', 2, 3));
    expect('state' in r).toBe(true);
    const after = (r as { state: GameState }).state;

    const eView = projectView(after, 'E');
    const eBeliefs = computeBeliefs(eView, 'E');
    // synth_n (the surviving mine) should now have high mine confidence.
    const mineBelief = eBeliefs.get('synth_n');
    expect(mineBelief?.mineConfidence).toBeGreaterThan(0.5);
  });

  it('resign entries are skipped (no kind inference from them)', () => {
    const state = freshPlayingGame();
    const after = applyResign(state, 'N');
    const view = projectView(after, 'E');
    const beliefs = computeBeliefs(view, 'E');
    // Should not throw, should produce beliefs for surviving pieces.
    expect(beliefs.size).toBeGreaterThan(0);
  });

  it('opponent pieces in HQ (unmoved) get the low-rank flag candidate estimate', () => {
    const state = freshPlayingGame();
    const view = projectView(state, 'N');
    const beliefs = computeBeliefs(view, 'N');
    const ePieces = view.pieces.filter((p) => p.owner === 'E');
    const hqPiece = ePieces.find((p) => {
      const b = beliefs.get(p.id)!;
      return b.inHQ;
    });
    expect(hqPiece).toBeDefined();
    const b = beliefs.get(hqPiece!.id)!;
    expect(b.estimatedRank).toBeLessThan(2);
  });
});
