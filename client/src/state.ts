// Client-side store. Wraps the Socket.IO connection and the latest server view.

import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientMessage,
  ServerMessage,
  LobbyUpdate,
  CombatReveal,
  PlayerView,
  GameMode,
} from '@siguo/shared';

type Phase = 'landing' | 'lobby' | 'setup' | 'play';

interface PendingCombat extends CombatReveal {
  dismissed: boolean;
}

/** Debug mode is enabled by visiting the app with ?debug=1 in the URL. */
const DEBUG_MODE: boolean = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1';
  } catch {
    return false;
  }
})();

/** Room code from an invite link (?room=ABCD), or '' if there isn't one. */
export const INVITE_ROOM: string = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get('room') ?? '';
    return raw.toUpperCase().slice(0, 4);
  } catch {
    return '';
  }
})();

interface GameStore {
  socket: Socket | null;
  phase: Phase;
  roomCode: string | null;
  playerToken: string | null;
  seat: 'N' | 'E' | 'S' | 'W' | null;
  mode: GameMode | null;
  debug: boolean;
  lobby: LobbyUpdate | null;
  view: PlayerView | null;
  /** Every PLAYING/ENDED PlayerView received, one per move. Lets the player
   *  scrub backward through the game in real time. Each cached view was already
   *  fog-projected by the server at its timestamp, so scrubbing leaks nothing. */
  viewHistory: PlayerView[];
  /** Scrub position: 0 = present (latest view), negative = N steps back. */
  scrubOffset: number;
  pendingCombat: PendingCombat | null;
  chatLog: Array<{ name: string; text: string; ts: number }>;
  lastError: string | null;
  /** Server-provided replay text (received after RequestReplay). */
  replayText: string | null;
  /** Pasted replay text the user wants to watch right now. When set, App
   *  renders the Replay screen with this payload. */
  pastedReplay: string | null;
  /** When true, App renders the standalone Designer screen. */
  designerMode: boolean;

  // actions
  connect: () => Promise<void>;
  send: (msg: ClientMessage) => void;
  setPhase: (phase: Phase) => void;
  dismissCombat: () => void;
  clearError: () => void;
  /** Move the scrub cursor by delta (clamped). Negative = back in time. */
  scrubBy: (delta: number) => void;
  /** Jump to an absolute scrub offset (clamped). 0 = present. */
  setScrubOffset: (offset: number) => void;
}

function loadPersisted(): { roomCode: string | null; playerToken: string | null } {
  try {
    const raw = localStorage.getItem('siguo:session');
    if (!raw) return { roomCode: null, playerToken: null };
    const parsed = JSON.parse(raw) as { roomCode: string; playerToken: string };
    return parsed;
  } catch {
    return { roomCode: null, playerToken: null };
  }
}

function persist(roomCode: string, playerToken: string) {
  localStorage.setItem('siguo:session', JSON.stringify({ roomCode, playerToken }));
}

function clearPersisted() {
  localStorage.removeItem('siguo:session');
}

export const useGame = create<GameStore>((set, get) => ({
  socket: null,
  phase: 'landing',
  roomCode: null,
  playerToken: null,
  seat: null,
  mode: null,
  debug: DEBUG_MODE,
  lobby: null,
  view: null,
  viewHistory: [],
  scrubOffset: 0,
  pendingCombat: null,
  chatLog: [],
  lastError: null,
  replayText: null,
  pastedReplay: null,
  designerMode: false,

  connect: async () => {
    if (get().socket) return;
    const socket = io({ autoConnect: true });
    set({ socket });
    socket.on('message', (raw: ServerMessage) => {
      switch (raw.type) {
        case 'RoomCreated':
          persist(raw.roomCode, raw.playerToken);
          set({
            roomCode: raw.roomCode,
            playerToken: raw.playerToken,
            seat: raw.seat,
            phase: 'lobby',
          });
          break;
        case 'RoomJoined':
          persist(raw.roomCode, raw.playerToken);
          set({
            roomCode: raw.roomCode,
            playerToken: raw.playerToken,
            seat: raw.seat,
            mode: raw.mode,
            phase: 'lobby',
          });
          break;
        case 'LobbyUpdate':
          set({ lobby: raw, mode: raw.mode });
          break;
        case 'StateUpdate': {
          if (raw.view === null) {
            // Server reset the game back to lobby (e.g. ReturnToLobby).
            set({ view: null, phase: 'lobby', pendingCombat: null, viewHistory: [], scrubOffset: 0 });
            break;
          }
          const view = raw.view as PlayerView;
          const newPhase: Phase = view.phase === 'SETUP'
            ? 'setup'
            : view.phase === 'PLAYING' || view.phase === 'ENDED'
              ? 'play'
              : 'lobby';
          set((s) => {
            // Only accumulate a scrub timeline during PLAYING/ENDED. Dedup by
            // move count so re-broadcasts of the same state don't yank a
            // scrubbing player back to present.
            if (view.phase !== 'PLAYING' && view.phase !== 'ENDED') {
              return { view, phase: newPhase, viewHistory: [], scrubOffset: 0 };
            }
            const last = s.viewHistory[s.viewHistory.length - 1];
            const isNewMove = !last || last.moveHistory.length !== view.moveHistory.length;
            if (!isNewMove) {
              // Same move count — just refresh the latest entry, keep scrub pos.
              const hist = s.viewHistory.slice();
              if (hist.length > 0) hist[hist.length - 1] = view;
              else hist.push(view);
              return { view, phase: newPhase, viewHistory: hist };
            }
            // Genuinely new move → append and snap back to present.
            return {
              view,
              phase: newPhase,
              viewHistory: [...s.viewHistory, view].slice(-400),
              scrubOffset: 0,
            };
          });
          break;
        }
        case 'CombatReveal':
          set({ pendingCombat: { ...raw, dismissed: false } });
          break;
        case 'ChatBroadcast':
          set((s) => ({
            chatLog: [
              ...s.chatLog,
              { name: raw.displayName, text: raw.text, ts: Date.now() },
            ].slice(-50),
          }));
          break;
        case 'Error':
          set({ lastError: raw.message });
          break;
        case 'ReplayPayload':
          set({ replayText: raw.text });
          break;
      }
    });

    socket.on('connect', () => {
      const { roomCode, playerToken } = loadPersisted();
      if (!roomCode || !playerToken) return;
      // An invite link (?room=ABCD) for a *different* room beats a stale saved
      // session — otherwise clicking a friend's link silently drops you back
      // into whatever room you last played in.
      if (INVITE_ROOM && INVITE_ROOM !== roomCode) {
        clearPersisted();
        return;
      }
      // Best-effort reconnect.
      get().send({
        type: 'JoinRoom',
        roomCode,
        playerName: 'reconnecting',
        playerToken,
        debug: DEBUG_MODE,
      });
    });

    socket.on('disconnect', () => {
      // keep state; reconnect will re-bind
    });
  },

  send: (msg) => {
    const sock = get().socket;
    if (!sock) return;
    sock.emit('message', msg);
  },

  setPhase: (phase) => set({ phase }),
  dismissCombat: () => set({ pendingCombat: null }),
  clearError: () => set({ lastError: null }),
  scrubBy: (delta) => set((s) => ({ scrubOffset: clampOffset(s.scrubOffset + delta, s.viewHistory.length) })),
  setScrubOffset: (offset) => set((s) => ({ scrubOffset: clampOffset(offset, s.viewHistory.length) })),
}));

/** Clamp a scrub offset to the valid range for a history of `len` views. */
function clampOffset(offset: number, len: number): number {
  const minOffset = -(Math.max(0, len - 1));
  if (offset > 0) return 0;
  if (offset < minOffset) return minOffset;
  return offset;
}

export const leaveRoom = () => {
  clearPersisted();
  useGame.setState({
    roomCode: null,
    playerToken: null,
    seat: null,
    lobby: null,
    view: null,
    viewHistory: [],
    scrubOffset: 0,
    pendingCombat: null,
    phase: 'landing',
  });
};
