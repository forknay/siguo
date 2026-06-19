// Game engine: pure reducer + helpers for Si Guo Jun Qi.
//
// Holds the full canonical GameState and exposes high-level operations:
//   createGameState, submitSetup, applyMove, currentSeatLegalMoves, etc.
//
// All mutations are immutable (state in → new state out) so the engine plays nicely
// with a server-authoritative + client-mirror model and is trivial to test.

import {
  type ZoneId,
  zoneCellId,
  ZONES,
  getCell,
} from './board.js';
import { resolveCombat, type CombatResult } from './combat.js';
import {
  legalMovesForSeat,
  legalMovesFromCell,
  type MoveContext,
  type PieceRef,
  type SeatId,
} from './moves.js';
import type { PieceKind } from './pieces.js';
import { type Layout, validateLayout, hqCellIds } from './setup.js';

export type { SeatId } from './moves.js';

export type TeamId = 'A' | 'B';
export type GameMode = '2v2' | 'ffa';
export const STALEMATE_LIMIT = 70;

export interface SeatInfo {
  playerId: string;
  displayName: string;
  isBot: boolean;
  eliminated: boolean;
  setupReady: boolean;
}

export interface PieceState {
  id: string;
  kind: PieceKind;
  owner: SeatId;
  cellId: string;
}

export interface CombatLog {
  fromCell: string;
  toCell: string;
  result: CombatResult;
  attackerSeat: SeatId;
  defenderSeat: SeatId;
  turnIndex: number;
}

export type GameResult =
  | { kind: 'TEAM_WIN'; team: TeamId }
  | { kind: 'PLAYER_WIN'; seat: SeatId }
  | { kind: 'DRAW'; reason: 'STALEMATE' | 'AGREEMENT' };

export interface GameState {
  mode: GameMode;
  teams: Record<SeatId, TeamId>;
  seats: Record<SeatId, SeatInfo>;
  pieces: Record<string, PieceState>;
  cellIndex: Record<string, string>;
  knownToPlayers: Record<string, SeatId[]>;
  flagRevealed: Record<SeatId, boolean>;
  marshalDead: Record<SeatId, boolean>;
  phase: 'SETUP' | 'PLAYING' | 'ENDED';
  turn: SeatId;
  turnIndex: number;
  movesSinceCapture: number;
  lastCombat: CombatLog | null;
  /** Most recent move per seat (from→to cell ids) for last-move highlighting. */
  lastMoveBySeat: Partial<Record<SeatId, { from: string; to: string }>>;
  /** Append-only history of every move applied to the state. */
  moveHistory: MoveRecord[];
  result: GameResult | null;
}

/**
 * History entries. Discriminated by `kind`. Old serialized data without `kind`
 * is treated as a normal move for backward compatibility — see `isMoveEntry`
 * and `isResignEntry` helpers.
 */
export type MoveRecord = MoveEntry | ResignEntry;

export interface MoveEntry {
  kind?: 'move';
  seat: SeatId;
  from: string;
  to: string;
  turnIndex: number;
  /** Set when this move resolved combat. */
  combat?: {
    winner: 'attacker' | 'defender' | 'tie';
    /** Defender's seat — present so the captures panel + bot belief inference
     *  can identify which seat owned the piece sitting at `to` before this move. */
    defenderSeat: SeatId;
    /** Piece kinds. Under strict fog (default), projectView strips these from
     *  viewers other than the owner of each piece — the bot has to infer. */
    attackerKind?: PieceKind;
    defenderKind?: PieceKind;
  };
}

export interface ResignEntry {
  kind: 'resign';
  seat: SeatId;
  turnIndex: number;
}

export function isResignEntry(r: MoveRecord): r is ResignEntry {
  return (r as ResignEntry).kind === 'resign';
}

export function isMoveEntry(r: MoveRecord): r is MoveEntry {
  return !isResignEntry(r);
}

/** 2v2 team mapping: N+S vs E+W. */
export const TEAMS_2V2: Record<SeatId, TeamId> = { N: 'A', S: 'A', E: 'B', W: 'B' };

/** FFA: every seat is its own "team" (just a placeholder so type checks pass). */
export const TEAMS_FFA: Record<SeatId, TeamId> = { N: 'A', E: 'A', S: 'A', W: 'A' };

export function isAlly(state: GameState, a: SeatId, b: SeatId): boolean {
  if (a === b) return true;
  if (state.mode === 'ffa') return false;
  return state.teams[a] === state.teams[b];
}

/** Build a fresh game in SETUP phase with empty pieces. */
export function createGameState(
  mode: GameMode,
  seats: Record<SeatId, SeatInfo>,
): GameState {
  return {
    mode,
    teams: mode === '2v2' ? TEAMS_2V2 : TEAMS_FFA,
    seats,
    pieces: {},
    cellIndex: {},
    knownToPlayers: {},
    flagRevealed: { N: false, E: false, S: false, W: false },
    marshalDead: { N: false, E: false, S: false, W: false },
    phase: 'SETUP',
    turn: 'N',
    turnIndex: 0,
    movesSinceCapture: 0,
    lastCombat: null,
    lastMoveBySeat: {},
    moveHistory: [],
    result: null,
  };
}

let pieceIdCounter = 0;
function newPieceId(): string {
  pieceIdCounter += 1;
  return `p${pieceIdCounter}`;
}

/** Apply a player's setup layout to the state. Returns errors if invalid. */
export function submitSetup(
  state: GameState,
  seat: SeatId,
  layout: Layout,
): { state: GameState } | { errors: string[] } {
  if (state.phase !== 'SETUP') {
    return { errors: [`Cannot submit setup in phase ${state.phase}`] };
  }
  if (state.seats[seat].setupReady) {
    return { errors: [`Seat ${seat} already submitted setup`] };
  }
  const errs = validateLayout(seat as ZoneId, layout);
  if (errs.length > 0) return { errors: errs.map((e) => e.message) };

  const newPieces = { ...state.pieces };
  const newCellIndex = { ...state.cellIndex };
  const newKnown = { ...state.knownToPlayers };
  for (const [cellId, kind] of Object.entries(layout)) {
    const id = newPieceId();
    newPieces[id] = { id, kind, owner: seat, cellId };
    newCellIndex[cellId] = id;
    newKnown[id] = [seat]; // owner knows their own pieces
  }

  const newSeats = { ...state.seats, [seat]: { ...state.seats[seat], setupReady: true } };
  const allReady = ZONES.every((z) => newSeats[z].setupReady);

  return {
    state: {
      ...state,
      seats: newSeats,
      pieces: newPieces,
      cellIndex: newCellIndex,
      knownToPlayers: newKnown,
      phase: allReady ? 'PLAYING' : 'SETUP',
      turn: 'N',
      turnIndex: 0,
    },
  };
}

/** Build a MoveContext from the current GameState.
 *
 *  Eliminated players' pieces are treated as INVISIBLE for movement purposes:
 *  slides pass through them, road moves can land on them, no combat triggers.
 *  This implements TODO "dead pieces should not interfere with movement."
 */
export function moveContextFor(state: GameState): MoveContext {
  return {
    pieceAt: (cellId) => {
      const pid = state.cellIndex[cellId];
      if (!pid) return null;
      const p = state.pieces[pid]!;
      if (state.seats[p.owner].eliminated) return null;
      return { id: p.id, cellId: p.cellId, kind: p.kind, owner: p.owner } satisfies PieceRef;
    },
    isAlly: (a, b) => isAlly(state, a, b),
  };
}

/** Cells the piece at `cellId` can legally move to. */
export function legalMoves(state: GameState, cellId: string): string[] {
  if (state.phase !== 'PLAYING') return [];
  const piece = pieceAt(state, cellId);
  if (!piece) return [];
  if (piece.owner !== state.turn) return [];
  if (state.seats[piece.owner].eliminated) return [];
  return legalMovesFromCell(moveContextFor(state), cellId);
}

/** Every legal (from,to) for the seat whose turn it is. */
export function legalMovesForTurn(state: GameState): Array<{ from: string; to: string }> {
  if (state.phase !== 'PLAYING') return [];
  const seat = state.turn;
  if (state.seats[seat].eliminated) return [];
  const owned = Object.values(state.pieces).filter((p) => p.owner === seat);
  return legalMovesForSeat(
    moveContextFor(state),
    seat,
    owned.map((p) => ({ id: p.id, cellId: p.cellId, kind: p.kind, owner: p.owner })),
  );
}

export function pieceAt(state: GameState, cellId: string): PieceState | null {
  const pid = state.cellIndex[cellId];
  if (!pid) return null;
  return state.pieces[pid] ?? null;
}

export function pieceOwnerSeat(state: GameState, pieceId: string): SeatId {
  return state.pieces[pieceId]!.owner;
}

/** Apply a move (with combat resolution and post-move state transitions). */
export function applyMove(
  state: GameState,
  seat: SeatId,
  from: string,
  to: string,
): { state: GameState } | { error: string } {
  if (state.phase !== 'PLAYING') return { error: `Phase is ${state.phase}` };
  if (state.turn !== seat) return { error: `Not seat ${seat}'s turn` };
  if (state.seats[seat].eliminated) return { error: `Seat ${seat} is eliminated` };

  const piece = pieceAt(state, from);
  if (!piece) return { error: `No piece at ${from}` };
  if (piece.owner !== seat) return { error: `Piece at ${from} not owned by ${seat}` };

  const legal = legalMovesFromCell(moveContextFor(state), from);
  if (!legal.includes(to)) return { error: `Illegal destination ${to}` };

  // Apply the move (possibly with combat).
  const rawTarget = pieceAt(state, to);
  // Frozen (dead-owner) pieces don't fight — they're silently removed when a
  // live piece lands on them, so movement isn't impeded by abandoned obstacles.
  const targetIsFrozen = rawTarget ? state.seats[rawTarget.owner].eliminated : false;
  const target = rawTarget && !targetIsFrozen ? rawTarget : null;
  let newPieces = { ...state.pieces };
  let newCellIndex = { ...state.cellIndex };
  let newKnown = { ...state.knownToPlayers };
  let combatLog: CombatLog | null = null;
  let movesSinceCapture = state.movesSinceCapture + 1;
  let newMarshalDead = { ...state.marshalDead };
  let newFlagRevealed = { ...state.flagRevealed };
  const eliminatedSeats: SeatId[] = [];

  if (!target) {
    // Plain move into an empty (or frozen-only) cell. Clear any frozen piece.
    if (targetIsFrozen && rawTarget) {
      delete newPieces[rawTarget.id];
    }
    delete newCellIndex[from];
    newCellIndex[to] = piece.id;
    newPieces[piece.id] = { ...piece, cellId: to };
  } else {
    // Combat.
    const result = resolveCombat(piece.kind, target.kind);
    combatLog = {
      fromCell: from,
      toCell: to,
      result,
      attackerSeat: piece.owner,
      defenderSeat: target.owner,
      turnIndex: state.turnIndex,
    };
    // Per the hidden-identity rule (v1 strict), combatants do NOT learn each other's
    // piece kinds. The surviving piece (if any) stays face-down to everyone.
    // (Debug mode in the client/server overlay handles full-information testing.)

    // Apply removals.
    delete newCellIndex[from];
    if (result.outcome.winner === 'attacker') {
      delete newPieces[target.id];
      newCellIndex[to] = piece.id;
      newPieces[piece.id] = { ...piece, cellId: to };
      if (target.kind === 'JUNQI') {
        // Owner of the flag is eliminated.
        eliminatedSeats.push(target.owner);
      }
      if (target.kind === 'SILING' && !newMarshalDead[target.owner]) {
        newMarshalDead[target.owner] = true;
        newFlagRevealed[target.owner] = true;
      }
      movesSinceCapture = 0;
    } else if (result.outcome.winner === 'defender') {
      // Mine survives non-engineer attack, or rank-based defender win.
      delete newPieces[piece.id];
      // newCellIndex[to] remains pointing to defender.
      if (piece.kind === 'SILING' && !newMarshalDead[piece.owner]) {
        newMarshalDead[piece.owner] = true;
        newFlagRevealed[piece.owner] = true;
      }
      movesSinceCapture = 0;
    } else {
      // Tie: both removed.
      delete newPieces[piece.id];
      delete newPieces[target.id];
      delete newCellIndex[to];
      if (target.kind === 'JUNQI') eliminatedSeats.push(target.owner);
      if (piece.kind === 'SILING' && !newMarshalDead[piece.owner]) {
        newMarshalDead[piece.owner] = true;
        newFlagRevealed[piece.owner] = true;
      }
      if (target.kind === 'SILING' && !newMarshalDead[target.owner]) {
        newMarshalDead[target.owner] = true;
        newFlagRevealed[target.owner] = true;
      }
      movesSinceCapture = 0;
    }
  }

  let newSeats = { ...state.seats };
  for (const elim of eliminatedSeats) {
    newSeats[elim] = { ...newSeats[elim], eliminated: true };
    // Reveal eliminated player's pieces to everyone (they're frozen, no point hiding).
    for (const p of Object.values(newPieces)) {
      if (p.owner === elim) {
        newKnown = mergeKnownToPlayers(newKnown, p.id, ZONES as readonly SeatId[]);
      }
    }
  }

  // Advance turn (skip eliminated seats).
  let nextTurn = nextSeat(state.turn);
  let safety = 4;
  while (newSeats[nextTurn].eliminated && safety-- > 0) {
    nextTurn = nextSeat(nextTurn);
  }

  // Check end-of-game.
  let phase: GameState['phase'] = state.phase;
  let result: GameResult | null = null;
  const endResult = computeEnd(state.mode, newSeats, movesSinceCapture);
  if (endResult) {
    phase = 'ENDED';
    result = endResult;
  }

  const moveRecord: MoveEntry = {
    kind: 'move',
    seat,
    from,
    to,
    turnIndex: state.turnIndex,
    ...(combatLog
      ? {
          combat: {
            winner: combatLog.result.outcome.winner,
            defenderSeat: combatLog.defenderSeat,
            attackerKind: combatLog.result.attackerKind,
            defenderKind: combatLog.result.defenderKind,
          },
        }
      : {}),
  };
  const lastMoveBySeat = { ...state.lastMoveBySeat, [seat]: { from, to } };

  return {
    state: {
      ...state,
      pieces: newPieces,
      cellIndex: newCellIndex,
      knownToPlayers: newKnown,
      seats: newSeats,
      marshalDead: newMarshalDead,
      flagRevealed: newFlagRevealed,
      turn: nextTurn,
      turnIndex: state.turnIndex + 1,
      movesSinceCapture,
      lastCombat: combatLog,
      lastMoveBySeat,
      moveHistory: [...state.moveHistory, moveRecord],
      phase,
      result,
    },
  };
}

/**
 * Rollout-only fast move application. Identical combat / elimination / turn /
 * win-condition semantics to `applyMove`, but skips everything a Monte Carlo
 * simulation doesn't need:
 *
 *   - NO legality validation — the caller must pass a move that came from
 *     `legalMovesForTurn` (the engine would otherwise regenerate the full
 *     legal-move set per ply just to re-check it).
 *   - NO `knownToPlayers` updates (rollouts run in a concrete sampled world).
 *   - NO `moveHistory` append (the array spread grows linearly with game
 *     length — by midgame that's 100+ entries copied per simulated ply).
 *   - NO `lastCombat` record.
 *
 * `lastMoveBySeat` IS maintained — the rollout policy's anti-shuffle filter
 * reads it. Never use this for real games: it trusts the caller blindly.
 */
export function applyMoveForRollout(
  state: GameState,
  seat: SeatId,
  from: string,
  to: string,
): GameState {
  const piece = pieceAt(state, from)!;
  const rawTarget = pieceAt(state, to);
  const targetIsFrozen = rawTarget ? state.seats[rawTarget.owner].eliminated : false;
  const target = rawTarget && !targetIsFrozen ? rawTarget : null;

  const newPieces = { ...state.pieces };
  const newCellIndex = { ...state.cellIndex };
  let movesSinceCapture = state.movesSinceCapture + 1;
  let newMarshalDead = state.marshalDead;
  let newFlagRevealed = state.flagRevealed;
  const eliminatedSeats: SeatId[] = [];

  const markMarshalDead = (owner: SeatId) => {
    if (newMarshalDead === state.marshalDead) {
      newMarshalDead = { ...state.marshalDead };
      newFlagRevealed = { ...state.flagRevealed };
    }
    newMarshalDead[owner] = true;
    newFlagRevealed[owner] = true;
  };

  if (!target) {
    if (targetIsFrozen && rawTarget) delete newPieces[rawTarget.id];
    delete newCellIndex[from];
    newCellIndex[to] = piece.id;
    newPieces[piece.id] = { ...piece, cellId: to };
  } else {
    const result = resolveCombat(piece.kind, target.kind);
    delete newCellIndex[from];
    if (result.outcome.winner === 'attacker') {
      delete newPieces[target.id];
      newCellIndex[to] = piece.id;
      newPieces[piece.id] = { ...piece, cellId: to };
      if (target.kind === 'JUNQI') eliminatedSeats.push(target.owner);
      if (target.kind === 'SILING' && !newMarshalDead[target.owner]) markMarshalDead(target.owner);
      movesSinceCapture = 0;
    } else if (result.outcome.winner === 'defender') {
      delete newPieces[piece.id];
      if (piece.kind === 'SILING' && !newMarshalDead[piece.owner]) markMarshalDead(piece.owner);
      movesSinceCapture = 0;
    } else {
      delete newPieces[piece.id];
      delete newPieces[target.id];
      delete newCellIndex[to];
      if (target.kind === 'JUNQI') eliminatedSeats.push(target.owner);
      if (piece.kind === 'SILING' && !newMarshalDead[piece.owner]) markMarshalDead(piece.owner);
      if (target.kind === 'SILING' && !newMarshalDead[target.owner]) markMarshalDead(target.owner);
      movesSinceCapture = 0;
    }
  }

  let newSeats = state.seats;
  if (eliminatedSeats.length > 0) {
    newSeats = { ...state.seats };
    for (const elim of eliminatedSeats) {
      newSeats[elim] = { ...newSeats[elim], eliminated: true };
    }
  }

  let nextTurn = nextSeat(state.turn);
  let safety = 4;
  while (newSeats[nextTurn].eliminated && safety-- > 0) {
    nextTurn = nextSeat(nextTurn);
  }

  let phase: GameState['phase'] = state.phase;
  let result: GameResult | null = null;
  const endResult = computeEnd(state.mode, newSeats, movesSinceCapture);
  if (endResult) {
    phase = 'ENDED';
    result = endResult;
  }

  return {
    ...state,
    pieces: newPieces,
    cellIndex: newCellIndex,
    seats: newSeats,
    marshalDead: newMarshalDead,
    flagRevealed: newFlagRevealed,
    turn: nextTurn,
    turnIndex: state.turnIndex + 1,
    movesSinceCapture,
    lastMoveBySeat: { ...state.lastMoveBySeat, [seat]: { from, to } },
    phase,
    result,
  };
}

/** Voluntary resignation by a seat. */
export function applyResign(state: GameState, seat: SeatId): GameState {
  if (state.phase !== 'PLAYING') return state;
  const newSeats = { ...state.seats, [seat]: { ...state.seats[seat], eliminated: true } };
  let nextTurn = state.turn === seat ? nextSeat(seat) : state.turn;
  let safety = 4;
  while (newSeats[nextTurn].eliminated && safety-- > 0) nextTurn = nextSeat(nextTurn);

  // Reveal resigner's pieces.
  let newKnown = { ...state.knownToPlayers };
  for (const p of Object.values(state.pieces)) {
    if (p.owner === seat) {
      newKnown = mergeKnownToPlayers(newKnown, p.id, ZONES as readonly SeatId[]);
    }
  }
  // Also mark their flag as revealed (game over for them).
  const newFlagRevealed = { ...state.flagRevealed, [seat]: true };

  const result = computeEnd(state.mode, newSeats, state.movesSinceCapture);
  const resignEntry: ResignEntry = { kind: 'resign', seat, turnIndex: state.turnIndex };
  return {
    ...state,
    seats: newSeats,
    knownToPlayers: newKnown,
    flagRevealed: newFlagRevealed,
    turn: nextTurn,
    phase: result ? 'ENDED' : state.phase,
    moveHistory: [...state.moveHistory, resignEntry],
    result,
  };
}

function nextSeat(seat: SeatId): SeatId {
  const order: SeatId[] = ['N', 'E', 'S', 'W'];
  const i = order.indexOf(seat);
  return order[(i + 1) % 4]!;
}

function mergeKnownToPlayers(
  table: Record<string, SeatId[]>,
  pieceId: string,
  seats: readonly SeatId[],
): Record<string, SeatId[]> {
  const cur = new Set(table[pieceId] ?? []);
  for (const s of seats) cur.add(s);
  return { ...table, [pieceId]: Array.from(cur) };
}

function computeEnd(
  mode: GameMode,
  seats: Record<SeatId, SeatInfo>,
  movesSinceCapture: number,
): GameResult | null {
  if (movesSinceCapture >= STALEMATE_LIMIT) {
    return { kind: 'DRAW', reason: 'STALEMATE' };
  }
  if (mode === '2v2') {
    const teamA = ZONES.filter((z) => TEAMS_2V2[z] === 'A');
    const teamB = ZONES.filter((z) => TEAMS_2V2[z] === 'B');
    const aOut = teamA.every((z) => seats[z].eliminated);
    const bOut = teamB.every((z) => seats[z].eliminated);
    if (aOut && bOut) return { kind: 'DRAW', reason: 'AGREEMENT' };
    if (aOut) return { kind: 'TEAM_WIN', team: 'B' };
    if (bOut) return { kind: 'TEAM_WIN', team: 'A' };
    return null;
  }
  // FFA: last seat standing wins.
  const alive = ZONES.filter((z) => !seats[z].eliminated);
  if (alive.length === 1) return { kind: 'PLAYER_WIN', seat: alive[0]! };
  if (alive.length === 0) return { kind: 'DRAW', reason: 'AGREEMENT' };
  return null;
}

/** Convenience: HQ cell ids for a seat. Re-exported for tests / UI. */
export { hqCellIds, zoneCellId, getCell };
