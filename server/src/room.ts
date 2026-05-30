// Room / lobby state machine. One Room per concurrent game.

import {
  createGameState,
  submitSetup,
  applyMove,
  applyResign,
  type BotSpeed,
  type GameState,
  type GameMode,
  type SeatId,
  type SeatInfo,
} from '@siguo/shared';
import { LATEST_BOT, botRng, projectView, encodeGame } from '@siguo/shared';
import type { CombatReveal, LobbyUpdate, ServerMessage } from '@siguo/shared';

const ZONES: SeatId[] = ['N', 'E', 'S', 'W'];

export type SeatOccupant =
  | { kind: 'empty' }
  | { kind: 'human'; token: string; displayName: string; socketId: string | null }
  | { kind: 'bot'; displayName: string };

const ALL_SEATS: SeatId[] = ['N', 'E', 'S', 'W'];

export class Room {
  readonly code: string;
  mode: GameMode;
  hostToken: string;
  /** Seat → who sits there. */
  occupants: Record<SeatId, SeatOccupant> = { N: { kind: 'empty' }, E: { kind: 'empty' }, S: { kind: 'empty' }, W: { kind: 'empty' } };
  state: GameState | null = null;
  /** Snapshot of the per-seat setup layouts at game-start (used to build replays). */
  setupSnapshot: Record<SeatId, Parameters<typeof submitSetup>[2]> | null = null;
  botSpeed: BotSpeed = 'normal';
  /** Seats that have a pending draw offer that hasn't been accepted/cancelled. */
  pendingDrawOffers: Set<SeatId> = new Set();

  constructor(code: string, mode: GameMode, hostToken: string) {
    this.code = code;
    this.mode = mode;
    this.hostToken = hostToken;
  }

  setBotSpeed(s: BotSpeed): void {
    this.botSpeed = s;
  }

  // ---- Draw offers ----

  offerDraw(seat: SeatId): void {
    this.pendingDrawOffers.add(seat);
  }

  cancelDraw(seat: SeatId): void {
    this.pendingDrawOffers.delete(seat);
  }

  /** Accept all pending draws — if every non-eliminated seat has offered, the game ends. */
  acceptDraw(seat: SeatId): boolean {
    if (!this.state || this.state.phase !== 'PLAYING') return false;
    this.pendingDrawOffers.add(seat);
    const alive = ZONES.filter((z) => !this.state!.seats[z].eliminated);
    const allAgreed = alive.every((z) => this.pendingDrawOffers.has(z));
    if (!allAgreed) return false;
    this.state = {
      ...this.state,
      phase: 'ENDED',
      result: { kind: 'DRAW', reason: 'AGREEMENT' },
    };
    this.pendingDrawOffers.clear();
    return true;
  }

  // ---- Lobby helpers ----

  findEmptySeat(): SeatId | null {
    return ALL_SEATS.find((s) => this.occupants[s].kind === 'empty') ?? null;
  }

  seatForToken(token: string): SeatId | null {
    for (const s of ALL_SEATS) {
      const o = this.occupants[s];
      if (o.kind === 'human' && o.token === token) return s;
    }
    return null;
  }

  isHost(token: string): boolean {
    return this.hostToken === token;
  }

  setHumanSeat(seat: SeatId, token: string, displayName: string, socketId: string): boolean {
    if (this.occupants[seat].kind !== 'empty') return false;
    this.occupants[seat] = { kind: 'human', token, displayName, socketId };
    return true;
  }

  takeOverSeat(token: string, displayName: string, socketId: string): SeatId | null {
    // Reconnect path: if the token already owns a seat, just rebind socket.
    for (const s of ALL_SEATS) {
      const o = this.occupants[s];
      if (o.kind === 'human' && o.token === token) {
        this.occupants[s] = { ...o, displayName, socketId };
        return s;
      }
    }
    // Otherwise take the first empty seat.
    const empty = this.findEmptySeat();
    if (!empty) return null;
    return this.setHumanSeat(empty, token, displayName, socketId) ? empty : null;
  }

  releaseSeat(seat: SeatId): void {
    this.occupants[seat] = { kind: 'empty' };
  }

  addBot(seat: SeatId): boolean {
    if (this.occupants[seat].kind !== 'empty') return false;
    this.occupants[seat] = { kind: 'bot', displayName: `Bot-${seat}` };
    return true;
  }

  removeBot(seat: SeatId): boolean {
    if (this.occupants[seat].kind !== 'bot') return false;
    this.occupants[seat] = { kind: 'empty' };
    return true;
  }

  bindSocket(seat: SeatId, socketId: string | null): void {
    const o = this.occupants[seat];
    if (o.kind === 'human') this.occupants[seat] = { ...o, socketId };
  }

  socketIdForSeat(seat: SeatId): string | null {
    const o = this.occupants[seat];
    if (o.kind === 'human') return o.socketId;
    return null;
  }

  // ---- Phase transitions ----

  allSeatsFilled(): boolean {
    return ALL_SEATS.every((s) => this.occupants[s].kind !== 'empty');
  }

  startGame(): boolean {
    if (!this.allSeatsFilled()) return false;
    const seats: Record<SeatId, SeatInfo> = {} as Record<SeatId, SeatInfo>;
    for (const s of ALL_SEATS) {
      const o = this.occupants[s];
      const name =
        o.kind === 'human' ? o.displayName : o.kind === 'bot' ? o.displayName : 'empty';
      const isBot = o.kind === 'bot';
      const playerId = o.kind === 'human' ? o.token : `bot-${s}`;
      seats[s] = { playerId, displayName: name, isBot, eliminated: false, setupReady: false };
    }
    this.state = createGameState(this.mode, seats);
    this.setupSnapshot = { N: {}, E: {}, S: {}, W: {} } as Record<SeatId, Parameters<typeof submitSetup>[2]>;
    // Pre-submit setup for all bot seats via the shared bot's pickSetup.
    for (const s of ALL_SEATS) {
      if (this.occupants[s].kind === 'bot') {
        const layout = LATEST_BOT.pickSetup({ seat: s, random: botRng(this.code.charCodeAt(0) * 7 + s.charCodeAt(0)) });
        const r = submitSetup(this.state, s, layout);
        if ('errors' in r) throw new Error('bot setup errors: ' + r.errors.join(','));
        this.state = r.state;
        this.setupSnapshot[s] = layout;
      }
    }
    return true;
  }

  submitHumanSetup(
    seat: SeatId,
    layout: Parameters<typeof submitSetup>[2],
  ): { ok: true } | { ok: false; errors: string[] } {
    if (!this.state) return { ok: false, errors: ['No game in progress'] };
    const r = submitSetup(this.state, seat, layout);
    if ('errors' in r) return { ok: false, errors: r.errors };
    this.state = r.state;
    if (!this.setupSnapshot) {
      this.setupSnapshot = { N: {}, E: {}, S: {}, W: {} } as Record<SeatId, Parameters<typeof submitSetup>[2]>;
    }
    this.setupSnapshot[seat] = layout;
    return { ok: true };
  }

  attemptMove(
    seat: SeatId,
    from: string,
    to: string,
  ):
    | { ok: true; combat: { full: CombatReveal; safe: CombatReveal } | null }
    | { ok: false; error: string } {
    if (!this.state) return { ok: false, error: 'No game in progress' };
    const before = this.state;
    const r = applyMove(this.state, seat, from, to);
    if ('error' in r) return { ok: false, error: r.error };
    this.state = r.state;
    const combat = this.state.lastCombat;
    let reveal: { full: CombatReveal; safe: CombatReveal } | null = null;
    if (combat && combat !== before.lastCombat) {
      reveal = {
        full: {
          type: 'CombatReveal',
          attackerKind: combat.result.attackerKind,
          defenderKind: combat.result.defenderKind,
          fromCell: combat.fromCell,
          toCell: combat.toCell,
          winner: combat.result.outcome.winner,
          attackerSeat: combat.attackerSeat,
          defenderSeat: combat.defenderSeat,
        },
        safe: {
          type: 'CombatReveal',
          fromCell: combat.fromCell,
          toCell: combat.toCell,
          winner: combat.result.outcome.winner,
          attackerSeat: combat.attackerSeat,
          defenderSeat: combat.defenderSeat,
        },
      };
    }
    return { ok: true, combat: reveal };
  }

  resign(seat: SeatId): void {
    if (!this.state) return;
    this.state = applyResign(this.state, seat);
  }

  // ---- Messages to broadcast ----

  lobbyUpdateMessage(lanUrls: string[]): LobbyUpdate {
    const seats: LobbyUpdate['seats'] = {} as LobbyUpdate['seats'];
    for (const s of ALL_SEATS) {
      const o = this.occupants[s];
      const setupReady = this.state ? this.state.seats[s].setupReady : false;
      if (o.kind === 'empty') seats[s] = { kind: 'empty', displayName: null, ready: false };
      else if (o.kind === 'human') seats[s] = { kind: 'human', displayName: o.displayName, ready: setupReady };
      else seats[s] = { kind: 'bot', displayName: o.displayName, ready: setupReady };
    }
    return {
      type: 'LobbyUpdate',
      roomCode: this.code,
      mode: this.mode,
      hostToken: this.hostToken,
      lanUrls,
      botSpeed: this.botSpeed,
      pendingDrawOffers: Array.from(this.pendingDrawOffers),
      seats,
    };
  }

  /** Render the state for a specific seat (or null spectator) as a StateUpdate. */
  stateUpdateForSeat(seat: SeatId | null, debug = false): ServerMessage | null {
    if (!this.state) return null;
    return { type: 'StateUpdate', view: projectView(this.state, seat, { debug }) };
  }

  /** Build a replay text payload from the current state + setup snapshot. */
  buildReplayString(): string | null {
    if (!this.state || !this.setupSnapshot) return null;
    return encodeGame(this.setupSnapshot, this.mode, this.state.moveHistory);
  }

  /** Reset the room back to the lobby (post-game). Keeps seats; clears game state. */
  returnToLobby(): void {
    this.state = null;
    this.setupSnapshot = null;
    this.pendingDrawOffers.clear();
  }
}
