import { describe, it, expect } from 'vitest';
import {
  applyMove,
  applyMoveForRollout,
  createGameState,
  legalMovesForTurn,
  submitSetup,
  type GameState,
  type SeatInfo,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { ZONES, type ZoneId } from '../src/board.js';
import { botRng } from '../src/bot/index.js';

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

describe('applyMoveForRollout ≡ applyMove (game semantics)', () => {
  it('matches piece positions, turn, eliminations, and result over 120 random legal plies', () => {
    // Two parallel games applying the SAME move sequence: one through the
    // validated applyMove, one through the rollout fast path. All gameplay-
    // relevant state must stay identical (the fast path only skips history
    // and knowledge bookkeeping).
    for (const gameSeed of [11, 22, 33]) {
      let full = freshState(gameSeed);
      let fast = freshState(gameSeed);
      const rng = botRng(gameSeed * 7);
      for (let ply = 0; ply < 120; ply++) {
        if (full.phase !== 'PLAYING') break;
        const moves = legalMovesForTurn(full);
        if (moves.length === 0) break;
        const m = moves[Math.floor(rng() * moves.length)]!;
        const r = applyMove(full, full.turn, m.from, m.to);
        expect('state' in r).toBe(true);
        full = (r as { state: GameState }).state;
        fast = applyMoveForRollout(fast, fast.turn, m.from, m.to);

        // Compare gameplay-relevant state.
        expect(fast.turn).toBe(full.turn);
        expect(fast.phase).toBe(full.phase);
        expect(fast.movesSinceCapture).toBe(full.movesSinceCapture);
        expect(fast.result).toEqual(full.result);
        for (const z of ZONES) {
          expect(fast.seats[z].eliminated).toBe(full.seats[z].eliminated);
          expect(fast.marshalDead[z]).toBe(full.marshalDead[z]);
          expect(fast.flagRevealed[z]).toBe(full.flagRevealed[z]);
        }
        // Compare by board contents (piece ids differ between the two games —
        // the engine's id counter is module-global — but cell/kind/owner must match).
        const fullCells = Object.values(full.pieces).map((p) => `${p.cellId}:${p.owner}:${p.kind}`).sort();
        const fastCells = Object.values(fast.pieces).map((p) => `${p.cellId}:${p.owner}:${p.kind}`).sort();
        expect(fastCells).toEqual(fullCells);
      }
    }
  });
});
