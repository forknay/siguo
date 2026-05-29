import { describe, it, expect } from 'vitest';
import {
  encodeGame, decodeGame, buildReplayInitialState, applyMovesUpTo, setupsFromState,
} from '../src/replay.js';
import {
  createGameState, submitSetup, applyMove, legalMoves,
  type GameState, type SeatInfo,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { ZONES, type ZoneId } from '../src/board.js';
import type { SeatId } from '../src/moves.js';

function seat(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: false, eliminated: false, setupReady: false };
}

function freshFinishedSetup(): { state: GameState; setups: Record<SeatId, ReturnType<typeof randomValidSetup>> } {
  let state = createGameState('2v2', { N: seat('a'), E: seat('b'), S: seat('c'), W: seat('d') });
  const setups: Record<SeatId, ReturnType<typeof randomValidSetup>> = {} as Record<SeatId, ReturnType<typeof randomValidSetup>>;
  for (const z of ZONES) {
    const layout = randomValidSetup(z as ZoneId, 500 + (z.charCodeAt(0) % 10));
    setups[z as SeatId] = layout;
    const r = submitSetup(state, z as SeatId, layout);
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return { state, setups };
}

describe('replay encoding round-trip', () => {
  it('encodes and decodes setups', () => {
    const { setups } = freshFinishedSetup();
    const encoded = encodeGame(setups, '2v2', []);
    const decoded = decodeGame(encoded);
    for (const z of ZONES) {
      expect(decoded.setups[z]).toEqual(setups[z]);
    }
  });

  it('round-trip preserves move list', () => {
    const { state, setups } = freshFinishedSetup();
    // Apply a couple of moves so we have history.
    let s = state;
    for (let i = 0; i < 4; i++) {
      const r = applyMove(s, s.turn, ...firstLegalMove(s));
      if ('error' in r) break;
      s = r.state;
    }
    const encoded = encodeGame(setups, '2v2', s.moveHistory);
    const decoded = decodeGame(encoded);
    expect(decoded.moves.length).toBe(s.moveHistory.length);

    // Replay should arrive at the same state.
    const replayInitial = buildReplayInitialState(decoded);
    const replayFinal = applyMovesUpTo(replayInitial, decoded.moves, decoded.moves.length);
    // Piece kinds at every cell should match.
    for (const p of Object.values(s.pieces)) {
      const rp = Object.values(replayFinal.pieces).find((q) => q.cellId === p.cellId);
      expect(rp?.kind).toBe(p.kind);
    }
  });
});

function firstLegalMove(state: GameState): [string, string] {
  const owned = Object.values(state.pieces).filter((p) => p.owner === state.turn);
  for (const p of owned) {
    const dests = legalMoves(state, p.cellId);
    if (dests.length > 0) return [p.cellId, dests[0]!];
  }
  throw new Error('no legal moves');
}

describe('setupsFromState (pre-move snapshot)', () => {
  it('reads piece placements directly from state', () => {
    const { state, setups } = freshFinishedSetup();
    const snap = setupsFromState(state);
    for (const z of ZONES) {
      expect(Object.keys(snap[z]).sort()).toEqual(Object.keys(setups[z]).sort());
    }
  });
});
