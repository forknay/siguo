// Per-player view projection. Replaces hidden piece kinds with `null` so the wire
// payload never contains information the player isn't allowed to see.

import { type GameState, type SeatId, type PieceState, type MoveRecord, isAlly } from './engine.js';
import { hqCellIds } from './setup.js';
import type { PieceKind } from './pieces.js';

export interface VisiblePiece {
  id: string;
  cellId: string;
  owner: SeatId;
  /** Null when the viewer isn't allowed to know the rank. */
  kind: PieceKind | null;
  /** True when this is an eliminated player's piece (still on board, frozen). */
  frozen: boolean;
}

export interface PlayerView {
  mode: GameState['mode'];
  teams: GameState['teams'];
  seats: GameState['seats'];
  phase: GameState['phase'];
  turn: SeatId;
  turnIndex: number;
  movesSinceCapture: number;
  flagRevealed: GameState['flagRevealed'];
  marshalDead: GameState['marshalDead'];
  pieces: VisiblePiece[];
  lastCombat: GameState['lastCombat'];
  lastMoveBySeat: GameState['lastMoveBySeat'];
  moveHistory: MoveRecord[];
  result: GameState['result'];
  viewerSeat: SeatId | null; // null for spectator
}

export function projectView(
  state: GameState,
  viewerSeat: SeatId | null,
  options: { debug?: boolean } = {},
): PlayerView {
  const visible: VisiblePiece[] = [];
  for (const p of Object.values(state.pieces)) {
    visible.push({
      id: p.id,
      cellId: p.cellId,
      owner: p.owner,
      kind: options.debug || rankVisibleTo(state, p, viewerSeat) ? p.kind : null,
      frozen: state.seats[p.owner].eliminated,
    });
  }

  // Strict fog: strip combat piece kinds from moveHistory entries the viewer
  // wasn't a party to. The viewer always keeps the kind of THEIR OWN piece
  // (attacker if rec.seat === viewer; defender if combat.defenderSeat === viewer).
  const filteredHistory = options.debug
    ? state.moveHistory
    : state.moveHistory.map((rec) => {
        if (rec.kind === 'resign') return rec;
        if (!rec.combat) return rec;
        const { combat } = rec;
        const viewerIsAttacker = rec.seat === viewerSeat;
        const viewerIsDefender = combat.defenderSeat === viewerSeat;
        if (viewerIsAttacker && viewerIsDefender) return rec; // edge case (own-team)
        const next = { ...rec, combat: { ...combat } };
        if (!viewerIsAttacker) delete next.combat.attackerKind;
        if (!viewerIsDefender) delete next.combat.defenderKind;
        return next;
      });
  return {
    mode: state.mode,
    teams: state.teams,
    seats: state.seats,
    phase: state.phase,
    turn: state.turn,
    turnIndex: state.turnIndex,
    movesSinceCapture: state.movesSinceCapture,
    flagRevealed: state.flagRevealed,
    marshalDead: state.marshalDead,
    pieces: visible,
    lastCombat: state.lastCombat,
    lastMoveBySeat: state.lastMoveBySeat,
    moveHistory: filteredHistory,
    result: state.result,
    viewerSeat,
  };
}

function rankVisibleTo(
  state: GameState,
  piece: PieceState,
  viewer: SeatId | null,
): boolean {
  // Owner always sees their own pieces (during play).
  if (viewer !== null && piece.owner === viewer) return true;

  // Game over: reveal everyone.
  if (state.phase === 'ENDED') return true;

  // Per-piece reveal list (set on combat or owner elimination).
  if (viewer !== null && state.knownToPlayers[piece.id]?.includes(viewer)) return true;

  // Flag-on-HQ reveal: when an owner's 司令 dies, the flag becomes visible publicly.
  if (piece.kind === 'JUNQI' && state.flagRevealed[piece.owner]) return true;

  // Spectator (viewer == null) — only see public reveals (handled above).
  return false;
}

/** Convenience for the UI: cells in the viewer's own zone (for setup highlighting). */
export function viewerCells(view: PlayerView): string[] {
  if (!view.viewerSeat) return [];
  return view.pieces.filter((p) => p.owner === view.viewerSeat).map((p) => p.cellId);
}

// Helpers re-exported so the UI doesn't have to import from setup.ts.
export { hqCellIds, isAlly };
