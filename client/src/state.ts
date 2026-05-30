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
            set({ view: null, phase: 'lobby', pendingCombat: null });
            break;
          }
          const view = raw.view as PlayerView;
          const newPhase: Phase = view.phase === 'SETUP'
            ? 'setup'
            : view.phase === 'PLAYING' || view.phase === 'ENDED'
              ? 'play'
              : 'lobby';
          set({ view, phase: newPhase });
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
      if (roomCode && playerToken) {
        // Best-effort reconnect.
        get().send({
          type: 'JoinRoom',
          roomCode,
          playerName: 'reconnecting',
          playerToken,
          debug: DEBUG_MODE,
        });
      }
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
}));

export const leaveRoom = () => {
  clearPersisted();
  useGame.setState({
    roomCode: null,
    playerToken: null,
    seat: null,
    lobby: null,
    view: null,
    pendingCombat: null,
    phase: 'landing',
  });
};
