// Wire protocol: Zod schemas for every socket message + TypeScript inference.
//
// Server is authoritative. Clients send intents (CreateRoom, JoinRoom, SubmitSetup,
// Move, Resign, etc.); the server validates against the live GameState and emits
// `StateUpdate` (filtered per viewer) and event broadcasts.

import { z } from 'zod';

export const SeatIdSchema = z.enum(['N', 'E', 'S', 'W']);
export type SeatIdW = z.infer<typeof SeatIdSchema>;

export const GameModeSchema = z.enum(['2v2', 'ffa']);
export type GameModeW = z.infer<typeof GameModeSchema>;

export const PieceKindSchema = z.enum([
  'SILING', 'JUNZHANG', 'SHIZHANG', 'LUZHANG', 'TUANZHANG',
  'YINGZHANG', 'LIANZHANG', 'PAIZHANG', 'GONGBING',
  'ZHADAN', 'DILEI', 'JUNQI',
]);

// ---- Client → Server ----

export const CreateRoomMsg = z.object({
  type: z.literal('CreateRoom'),
  hostName: z.string().min(1).max(20),
  mode: GameModeSchema,
  /** Debug mode: when true, this client sees opponent piece ranks (for testing). */
  debug: z.boolean().optional(),
});

export const JoinRoomMsg = z.object({
  type: z.literal('JoinRoom'),
  roomCode: z.string().regex(/^[A-Z0-9]{4}$/),
  playerName: z.string().min(1).max(20),
  /** Optional persistent token from prior session (reconnect). */
  playerToken: z.string().optional(),
  /** Debug mode: when true, this client sees opponent piece ranks (for testing). */
  debug: z.boolean().optional(),
});

export const SetSeatMsg = z.object({
  type: z.literal('SetSeat'),
  seat: SeatIdSchema,
  /** Action to take on this seat. */
  action: z.enum(['take', 'release', 'addBot', 'removeBot']),
});

export const StartGameMsg = z.object({ type: z.literal('StartGame') });

export const SubmitSetupMsg = z.object({
  type: z.literal('SubmitSetup'),
  layout: z.record(z.string(), PieceKindSchema),
});

export const MoveMsg = z.object({
  type: z.literal('Move'),
  from: z.string(),
  to: z.string(),
});

export const ResignMsg = z.object({ type: z.literal('Resign') });

export const ChatMsg = z.object({
  type: z.literal('Chat'),
  text: z.string().min(1).max(200),
});

export const ClientMessage = z.discriminatedUnion('type', [
  CreateRoomMsg,
  JoinRoomMsg,
  SetSeatMsg,
  StartGameMsg,
  SubmitSetupMsg,
  MoveMsg,
  ResignMsg,
  ChatMsg,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- Server → Client ----

export const RoomCreatedMsg = z.object({
  type: z.literal('RoomCreated'),
  roomCode: z.string(),
  playerToken: z.string(),
  seat: SeatIdSchema,
});

export const RoomJoinedMsg = z.object({
  type: z.literal('RoomJoined'),
  roomCode: z.string(),
  playerToken: z.string(),
  seat: SeatIdSchema.nullable(),
  mode: GameModeSchema,
});

export const LobbyUpdateMsg = z.object({
  type: z.literal('LobbyUpdate'),
  roomCode: z.string(),
  mode: GameModeSchema,
  hostToken: z.string(),
  lanUrls: z.array(z.string()),
  seats: z.record(
    SeatIdSchema,
    z.object({
      kind: z.enum(['empty', 'human', 'bot']),
      displayName: z.string().nullable(),
      ready: z.boolean(),
    }),
  ),
});

export const StateUpdateMsg = z.object({
  type: z.literal('StateUpdate'),
  view: z.unknown(),
});

export const CombatRevealMsg = z.object({
  type: z.literal('CombatReveal'),
  /** Kinds present only in debug mode. In normal play these are omitted. */
  attackerKind: PieceKindSchema.optional(),
  defenderKind: PieceKindSchema.optional(),
  fromCell: z.string(),
  toCell: z.string(),
  winner: z.enum(['attacker', 'defender', 'tie']),
  /** Seat of the attacker — used by the client to phrase the outcome message. */
  attackerSeat: SeatIdSchema,
  defenderSeat: SeatIdSchema,
});

export const ChatBroadcastMsg = z.object({
  type: z.literal('ChatBroadcast'),
  seat: SeatIdSchema.nullable(),
  displayName: z.string(),
  text: z.string(),
  channel: z.enum(['all', 'team']),
});

export const ErrorMsg = z.object({
  type: z.literal('Error'),
  message: z.string(),
});

export const ServerMessage = z.discriminatedUnion('type', [
  RoomCreatedMsg,
  RoomJoinedMsg,
  LobbyUpdateMsg,
  StateUpdateMsg,
  CombatRevealMsg,
  ChatBroadcastMsg,
  ErrorMsg,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type CreateRoom = z.infer<typeof CreateRoomMsg>;
export type JoinRoom = z.infer<typeof JoinRoomMsg>;
export type SetSeat = z.infer<typeof SetSeatMsg>;
export type SubmitSetup = z.infer<typeof SubmitSetupMsg>;
export type Move = z.infer<typeof MoveMsg>;
export type Resign = z.infer<typeof ResignMsg>;
export type Chat = z.infer<typeof ChatMsg>;
export type LobbyUpdate = z.infer<typeof LobbyUpdateMsg>;
export type RoomCreated = z.infer<typeof RoomCreatedMsg>;
export type RoomJoined = z.infer<typeof RoomJoinedMsg>;
export type StateUpdate = z.infer<typeof StateUpdateMsg>;
export type CombatReveal = z.infer<typeof CombatRevealMsg>;
export type ChatBroadcast = z.infer<typeof ChatBroadcastMsg>;
