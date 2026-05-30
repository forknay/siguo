// Bot driver. Schedules bot turns after a botSpeed-controlled delay. The
// actual move/setup logic lives in @siguo/shared so we can run bot-vs-bot
// games deterministically in tests + an eval harness.

import {
  LATEST_BOT,
  botRng,
  projectView,
  type BotSpeed,
  type GameState,
  type SeatId,
} from '@siguo/shared';
import type { Room } from './room.js';

const SPEED_DELAYS: Record<BotSpeed, [number, number]> = {
  slow:    [1200, 1800],
  normal:  [300, 700],
  fast:    [80, 180],
  instant: [0, 0],
};

export function maybeScheduleBotTurn(
  room: Room,
  onMoveApplied: () => void,
): boolean {
  if (!room.state || room.state.phase !== 'PLAYING') return false;
  const seat = room.state.turn;
  const occupant = room.occupants[seat];
  if (occupant.kind !== 'bot') return false;

  const [min, max] = SPEED_DELAYS[room.botSpeed];
  const delay = min + Math.random() * (max - min);
  setTimeout(() => {
    runBotMove(room, seat);
    onMoveApplied();
  }, delay);
  return true;
}

function runBotMove(room: Room, seat: SeatId): void {
  if (!room.state || room.state.phase !== 'PLAYING' || room.state.turn !== seat) return;
  const view = projectView(room.state, seat, { debug: false });
  const random = botRng(seedFor(room.state, seat));
  const pick = LATEST_BOT.pickMove({
    view,
    seat,
    history: room.state.moveHistory,
    random,
  });
  if (!pick) {
    room.resign(seat);
    return;
  }
  room.attemptMove(seat, pick.from, pick.to);
}

/** Derive a per-turn PRNG seed so bots are deterministic-ish per game state. */
function seedFor(state: GameState, seat: SeatId): number {
  const base = state.turnIndex * 31 + seat.charCodeAt(0);
  return (base ^ (state.movesSinceCapture * 17)) >>> 0;
}
