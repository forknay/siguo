import { describe, it, expect } from 'vitest';
import {
  createGameState,
  submitSetup,
  applyMove,
  applyResign,
  legalMoves,
  legalMovesForTurn,
  pieceAt,
  type SeatId,
  type GameState,
  type SeatInfo,
  hqCellIds,
} from '../src/engine.js';
import { randomValidSetup } from '../src/setup.js';
import { ZONES, zoneCellId } from '../src/board.js';

function seatInfo(id: string, isBot = false): SeatInfo {
  return { playerId: id, displayName: id, isBot, eliminated: false, setupReady: false };
}

function freshState(mode: '2v2' | 'ffa' = '2v2'): GameState {
  return createGameState(mode, {
    N: seatInfo('alice'),
    E: seatInfo('bob'),
    S: seatInfo('carol'),
    W: seatInfo('dave'),
  });
}

function startWithRandomSetup(mode: '2v2' | 'ffa' = '2v2', seedBase = 100): GameState {
  let state = freshState(mode);
  for (let i = 0; i < 4; i++) {
    const seat = (ZONES[i] as SeatId);
    const r = submitSetup(state, seat, randomValidSetup(seat, seedBase + i));
    if ('errors' in r) throw new Error(r.errors.join(', '));
    state = r.state;
  }
  expect(state.phase).toBe('PLAYING');
  return state;
}

describe('createGameState + submitSetup', () => {
  it('starts in SETUP and transitions to PLAYING when all four submit', () => {
    let state = freshState();
    expect(state.phase).toBe('SETUP');
    for (let i = 0; i < 4; i++) {
      const seat = (ZONES[i] as SeatId);
      const r = submitSetup(state, seat, randomValidSetup(seat, 10 + i));
      expect('state' in r).toBe(true);
      state = (r as { state: GameState }).state;
    }
    expect(state.phase).toBe('PLAYING');
    expect(Object.keys(state.pieces).length).toBe(4 * 25);
  });

  it('rejects an invalid layout', () => {
    let state = freshState();
    const bad = randomValidSetup('N', 1);
    // Corrupt: remove a piece (wrong count).
    const firstKey = Object.keys(bad)[0]!;
    delete bad[firstKey];
    const r = submitSetup(state, 'N', bad);
    expect('errors' in r).toBe(true);
  });
});

describe('applyMove — plain move', () => {
  it('rejects move when it isn\'t the seat\'s turn', () => {
    const state = startWithRandomSetup('2v2', 200);
    expect(state.turn).toBe('N');
    const owned = Object.values(state.pieces).find((p) => p.owner === 'E');
    expect(owned).toBeDefined();
    const moves = legalMoves(state, owned!.cellId);
    expect(moves).toEqual([]); // not E's turn
  });

  it('moves a piece into an empty cell and advances turn', () => {
    const state = startWithRandomSetup('2v2', 300);
    // Find an N piece that has at least one legal move.
    const choices = legalMovesForTurn(state);
    expect(choices.length).toBeGreaterThan(0);
    const { from, to } = choices[0]!;
    const r = applyMove(state, 'N', from, to);
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    // Turn advanced.
    expect(next.turn).toBe('E');
    expect(next.turnIndex).toBe(1);
    // movesSinceCapture incremented (no combat).
    expect(next.movesSinceCapture).toBe(1);
    // Piece relocated.
    expect(pieceAt(next, from)).toBeNull();
    expect(pieceAt(next, to)).not.toBeNull();
  });
});

describe('applyMove — combat and elimination', () => {
  // We synthesize a small handcrafted state for predictable combat tests.
  function craftedState(
    pieces: Array<{ cell: string; owner: SeatId; kind: import('../src/pieces.js').PieceKind }>,
    mode: '2v2' | 'ffa' = '2v2',
    turn: SeatId = 'N',
  ): GameState {
    const state = freshState(mode);
    let counter = 0;
    const newPieces: GameState['pieces'] = {};
    const cellIndex: GameState['cellIndex'] = {};
    const knownToPlayers: GameState['knownToPlayers'] = {};
    for (const p of pieces) {
      counter += 1;
      const id = `c${counter}`;
      newPieces[id] = { id, kind: p.kind, owner: p.owner, cellId: p.cell };
      cellIndex[p.cell] = id;
      knownToPlayers[id] = [p.owner];
    }
    return {
      ...state,
      pieces: newPieces,
      cellIndex,
      knownToPlayers,
      phase: 'PLAYING',
      turn,
      seats: { ...state.seats, N: { ...state.seats.N, setupReady: true }, E: { ...state.seats.E, setupReady: true }, S: { ...state.seats.S, setupReady: true }, W: { ...state.seats.W, setupReady: true } },
    };
  }

  it('higher rank wins, attacker moves into target cell', () => {
    const state = craftedState([
      { cell: zoneCellId('N', 2, 3), owner: 'N', kind: 'SILING' },
      { cell: zoneCellId('N', 2, 4), owner: 'E', kind: 'PAIZHANG' }, // enemy, adjacent on rail
    ]);
    const r = applyMove(state, 'N', zoneCellId('N', 2, 3), zoneCellId('N', 2, 4));
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    expect(pieceAt(next, zoneCellId('N', 2, 4))!.kind).toBe('SILING');
    expect(next.movesSinceCapture).toBe(0);
    expect(next.lastCombat).not.toBeNull();
    expect(next.lastCombat!.result.outcome.winner).toBe('attacker');
  });

  it('engineer defuses mine', () => {
    const state = craftedState([
      { cell: zoneCellId('N', 3, 1), owner: 'N', kind: 'GONGBING' },
      { cell: zoneCellId('N', 2, 1), owner: 'E', kind: 'DILEI' },
    ]);
    const r = applyMove(state, 'N', zoneCellId('N', 3, 1), zoneCellId('N', 2, 1));
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    expect(pieceAt(next, zoneCellId('N', 2, 1))!.kind).toBe('GONGBING');
  });

  it('non-engineer dies to mine, mine stays', () => {
    const state = craftedState([
      { cell: zoneCellId('N', 3, 1), owner: 'N', kind: 'TUANZHANG' },
      { cell: zoneCellId('N', 2, 1), owner: 'E', kind: 'DILEI' },
    ]);
    const r = applyMove(state, 'N', zoneCellId('N', 3, 1), zoneCellId('N', 2, 1));
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    expect(pieceAt(next, zoneCellId('N', 2, 1))!.kind).toBe('DILEI');
    expect(pieceAt(next, zoneCellId('N', 3, 1))).toBeNull();
  });

  it('flag capture eliminates owner, turn skips them', () => {
    const [hqA] = hqCellIds('E');
    const state = craftedState([
      { cell: zoneCellId('N', 6, 3), owner: 'N', kind: 'SILING' },
      // Place enemy flag at an E HQ. We need a piece that can reach the flag in one move
      // — use rail. E's HQ at (E, 1, 2) which is hqCellIds('E')[0].
      { cell: hqA, owner: 'E', kind: 'JUNQI' },
    ]);
    // N(6,3) is not adjacent to E's HQ — we need to construct a more direct test.
    // Instead: place SILING adjacent to flag via road.
    const state2 = craftedState([
      { cell: zoneCellId('E', 2, 2), owner: 'N', kind: 'SILING' },
      { cell: zoneCellId('E', 1, 2), owner: 'E', kind: 'JUNQI' },
    ]);
    const r = applyMove(state2, 'N', zoneCellId('E', 2, 2), zoneCellId('E', 1, 2));
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    expect(next.seats.E.eliminated).toBe(true);
    // Turn would have gone N→E, but E eliminated so it skips to S.
    expect(next.turn).toBe('S');
    // Sanity: avoid unused-var lint
    expect(state.pieces).toBeDefined();
  });

  it('killing Marshal triggers flag-reveal for the dead Marshal\'s owner', () => {
    const state = craftedState([
      { cell: zoneCellId('N', 2, 3), owner: 'N', kind: 'SILING' },
      { cell: zoneCellId('N', 2, 4), owner: 'E', kind: 'SILING' }, // tie!
    ]);
    const r = applyMove(state, 'N', zoneCellId('N', 2, 3), zoneCellId('N', 2, 4));
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    expect(next.marshalDead.N).toBe(true);
    expect(next.marshalDead.E).toBe(true);
    expect(next.flagRevealed.N).toBe(true);
    expect(next.flagRevealed.E).toBe(true);
  });

  it('bomb causes mutual destruction', () => {
    const state = craftedState([
      { cell: zoneCellId('N', 2, 3), owner: 'N', kind: 'ZHADAN' },
      { cell: zoneCellId('N', 2, 4), owner: 'E', kind: 'SILING' },
    ]);
    const r = applyMove(state, 'N', zoneCellId('N', 2, 3), zoneCellId('N', 2, 4));
    expect('state' in r).toBe(true);
    const next = (r as { state: GameState }).state;
    expect(pieceAt(next, zoneCellId('N', 2, 4))).toBeNull();
    expect(pieceAt(next, zoneCellId('N', 2, 3))).toBeNull();
    expect(next.lastCombat!.result.outcome.winner).toBe('tie');
  });
});

describe('team win', () => {
  it('2v2: when both team B flags are captured, team A wins', () => {
    // Construct end-game by hand: eliminate E then W.
    let state = startWithRandomSetup('2v2', 400);
    state = { ...state, seats: { ...state.seats, E: { ...state.seats.E, eliminated: true } } };
    const r = applyResign(state, 'W');
    expect(r.phase).toBe('ENDED');
    expect(r.result).toEqual({ kind: 'TEAM_WIN', team: 'A' });
  });
});

describe('resign + FFA', () => {
  it('FFA: last seat standing wins', () => {
    let state = startWithRandomSetup('ffa', 500);
    state = applyResign(state, 'N');
    state = applyResign(state, 'E');
    state = applyResign(state, 'S');
    expect(state.phase).toBe('ENDED');
    expect(state.result).toEqual({ kind: 'PLAYER_WIN', seat: 'W' });
  });
});
