import { describe, it, expect } from 'vitest';
import {
  createGameState,
  submitSetup,
  type GameState,
  type SeatInfo,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { projectView } from '../src/view.js';
import { ZONES, type ZoneId } from '../src/board.js';
import type { SeatId } from '../src/moves.js';

function seatInfo(id: string): SeatInfo {
  return { playerId: id, displayName: id, isBot: false, eliminated: false, setupReady: false };
}
function freshGame(): GameState {
  let state = createGameState('2v2', {
    N: seatInfo('a'), E: seatInfo('b'), S: seatInfo('c'), W: seatInfo('d'),
  });
  for (const z of ZONES) {
    const r = submitSetup(state, z as ZoneId as SeatId, randomValidSetup(z as ZoneId, 1));
    if ('errors' in r) throw new Error(r.errors.join(','));
    state = r.state;
  }
  return state;
}

describe('projectView', () => {
  it('owner sees own piece kinds; opponents do not', () => {
    const state = freshGame();
    const viewN = projectView(state, 'N');
    const myPieces = viewN.pieces.filter((p) => p.owner === 'N');
    expect(myPieces.length).toBe(25);
    for (const p of myPieces) expect(p.kind).not.toBeNull();

    const enemyPieces = viewN.pieces.filter((p) => p.owner === 'E');
    for (const p of enemyPieces) expect(p.kind).toBeNull();
  });

  it('teammate pieces are hidden (hidden allied default for v1)', () => {
    const state = freshGame();
    const viewN = projectView(state, 'N');
    const teammatePieces = viewN.pieces.filter((p) => p.owner === 'S');
    for (const p of teammatePieces) expect(p.kind).toBeNull();
  });

  it('after Marshal death, the flag becomes visible to all', () => {
    const state = freshGame();
    // Hack: mark E\'s Marshal as dead and flag revealed.
    const next: GameState = {
      ...state,
      marshalDead: { ...state.marshalDead, E: true },
      flagRevealed: { ...state.flagRevealed, E: true },
    };
    const viewN = projectView(next, 'N');
    const eFlag = viewN.pieces.find((p) => p.owner === 'E');
    // find by JUNQI specifically: but flag kind is hidden until reveal; we know its location.
    const eFlagPiece = Object.values(next.pieces).find((p) => p.owner === 'E' && p.kind === 'JUNQI');
    expect(eFlagPiece).toBeDefined();
    const projected = viewN.pieces.find((p) => p.id === eFlagPiece!.id);
    expect(projected!.kind).toBe('JUNQI');
    // sanity ref
    expect(eFlag).toBeDefined();
  });

  it('on ENDED phase, everything is revealed', () => {
    const state = freshGame();
    const next: GameState = { ...state, phase: 'ENDED', result: { kind: 'DRAW', reason: 'AGREEMENT' } };
    const viewN = projectView(next, 'N');
    for (const p of viewN.pieces) expect(p.kind).not.toBeNull();
  });
});
