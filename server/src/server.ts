// Express + Socket.IO entry. Server-authoritative game state.

import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  ClientMessage,
  type SeatId,
  type ServerMessage,
  ZONES_ALIAS,
} from './shared-re.js';
import { Room } from './room.js';
import { lanUrls } from './net.js';
import { maybeScheduleBotTurn } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, lan: lanUrls(PORT) });
});
// Serve built client assets in production.
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const rooms = new Map<string, Room>();
function newRoomCode(): string {
  // 4 chars, alphanumeric (no ambiguous I/O/0/1).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  while (true) {
    let code = '';
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
}

function broadcastLobby(room: Room) {
  const msg = room.lobbyUpdateMessage(lanUrls(PORT));
  io.to(room.code).emit('message', msg);
}

/** Track which connected sockets have debug mode enabled. */
const debugSockets = new Set<string>();

function broadcastState(room: Room) {
  for (const seat of ZONES_ALIAS) {
    const sid = room.socketIdForSeat(seat);
    if (!sid) continue;
    const msg = room.stateUpdateForSeat(seat, debugSockets.has(sid));
    if (msg) io.to(sid).emit('message', msg);
  }
}

function sendError(socketId: string, message: string) {
  const msg: ServerMessage = { type: 'Error', message };
  io.to(socketId).emit('message', msg);
}

function emit(socketId: string, msg: ServerMessage) {
  io.to(socketId).emit('message', msg);
}

io.on('connection', (socket) => {
  let bound: { roomCode: string; seat: SeatId | null; token: string; debug: boolean } | null = null;

  socket.on('message', (raw) => {
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      sendError(socket.id, 'Malformed message');
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case 'CreateRoom': {
        const code = newRoomCode();
        const token = crypto.randomBytes(16).toString('hex');
        const room = new Room(code, msg.mode, token);
        room.setHumanSeat('N', token, msg.hostName, socket.id);
        rooms.set(code, room);
        socket.join(code);
        bound = { roomCode: code, seat: 'N', token, debug: !!msg.debug };
        if (bound.debug) debugSockets.add(socket.id);
        const reply: ServerMessage = { type: 'RoomCreated', roomCode: code, playerToken: token, seat: 'N' };
        emit(socket.id, reply);
        broadcastLobby(room);
        break;
      }
      case 'JoinRoom': {
        const room = rooms.get(msg.roomCode.toUpperCase());
        if (!room) {
          sendError(socket.id, `No room ${msg.roomCode}`);
          return;
        }
        const token = msg.playerToken ?? crypto.randomBytes(16).toString('hex');
        const seat = room.takeOverSeat(token, msg.playerName, socket.id);
        socket.join(room.code);
        bound = { roomCode: room.code, seat, token, debug: !!msg.debug };
        if (bound.debug) debugSockets.add(socket.id);
        const reply: ServerMessage = {
          type: 'RoomJoined',
          roomCode: room.code,
          playerToken: token,
          seat,
          mode: room.mode,
        };
        emit(socket.id, reply);
        broadcastLobby(room);
        if (seat && room.state) {
          const st = room.stateUpdateForSeat(seat, bound.debug);
          if (st) emit(socket.id, st);
        }
        break;
      }
      case 'SetSeat': {
        if (!bound) { sendError(socket.id, 'Not in a room'); return; }
        const room = rooms.get(bound.roomCode);
        if (!room) return;
        if (!room.isHost(bound.token)) { sendError(socket.id, 'Only host can change seats'); return; }
        switch (msg.action) {
          case 'addBot': room.addBot(msg.seat); break;
          case 'removeBot': room.removeBot(msg.seat); break;
          case 'release': room.releaseSeat(msg.seat); break;
          // 'take' currently a no-op (humans get seats on JoinRoom).
        }
        broadcastLobby(room);
        break;
      }
      case 'StartGame': {
        if (!bound) return;
        const room = rooms.get(bound.roomCode);
        if (!room) return;
        if (!room.isHost(bound.token)) { sendError(socket.id, 'Only host can start'); return; }
        if (!room.allSeatsFilled()) { sendError(socket.id, 'Need 4 players (or bots)'); return; }
        if (!room.startGame()) { sendError(socket.id, 'Failed to start'); return; }
        broadcastLobby(room);
        broadcastState(room);
        // Bots that are first in the turn order (e.g. if N is a bot) will need a kick.
        maybeScheduleBotTurn(room, () => {
          broadcastState(room);
          broadcastLobby(room);
          maybeScheduleBotTurn(room, () => {
            broadcastState(room);
            broadcastLobby(room);
            // (recursion handled below via centralized helper)
          });
        });
        break;
      }
      case 'SubmitSetup': {
        if (!bound?.seat) return;
        const room = rooms.get(bound.roomCode);
        if (!room) return;
        const result = room.submitHumanSetup(bound.seat, msg.layout);
        if (!result.ok) { sendError(socket.id, result.errors.join('; ')); return; }
        broadcastLobby(room);
        broadcastState(room);
        // If all humans + bots are ready, the engine has already transitioned to PLAYING.
        chainBotTurns(room);
        break;
      }
      case 'Move': {
        if (!bound?.seat) return;
        const room = rooms.get(bound.roomCode);
        if (!room) return;
        const result = room.attemptMove(bound.seat, msg.from, msg.to);
        if (!result.ok) { sendError(socket.id, result.error); return; }
        // Reveal combat to all four players (kind only included for debug sockets).
        if (result.combat && room.state) {
          for (const s of ZONES_ALIAS) {
            const sid = room.socketIdForSeat(s);
            if (!sid) continue;
            emit(sid, debugSockets.has(sid) ? result.combat.full : result.combat.safe);
          }
        }
        broadcastState(room);
        broadcastLobby(room);
        chainBotTurns(room);
        break;
      }
      case 'Resign': {
        if (!bound?.seat) return;
        const room = rooms.get(bound.roomCode);
        if (!room) return;
        room.resign(bound.seat);
        broadcastState(room);
        broadcastLobby(room);
        chainBotTurns(room);
        break;
      }
      case 'Chat': {
        if (!bound) return;
        const room = rooms.get(bound.roomCode);
        if (!room) return;
        const occ = bound.seat ? room.occupants[bound.seat] : null;
        const name = occ?.kind === 'human' ? occ.displayName : 'spectator';
        const broadcast: ServerMessage = {
          type: 'ChatBroadcast',
          seat: bound.seat,
          displayName: name,
          text: msg.text,
          channel: 'all',
        };
        io.to(room.code).emit('message', broadcast);
        break;
      }
    }
  });

  socket.on('disconnect', () => {
    debugSockets.delete(socket.id);
    if (!bound) return;
    const room = rooms.get(bound.roomCode);
    if (!room || !bound.seat) return;
    room.bindSocket(bound.seat, null);
    broadcastLobby(room);
  });
});

/** Run all consecutive bot turns, broadcasting after each. */
function chainBotTurns(room: Room): void {
  const scheduled = maybeScheduleBotTurn(room, () => {
    broadcastState(room);
    broadcastLobby(room);
    chainBotTurns(room);
  });
  if (!scheduled) {
    // Nothing to do — wait for the next human action.
  }
}

httpServer.listen(PORT, '0.0.0.0', () => {
  const urls = lanUrls(PORT);
  // eslint-disable-next-line no-console
  console.log(`siguo server listening on http://0.0.0.0:${PORT}`);
  for (const u of urls) console.log(`  LAN: ${u}`);
});
